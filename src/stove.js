// -----------------------------------------------------------------------------
// One Aduro stove: where to reach it, what it reports, what it is asked.
//
// Port of the coordinator of the Home Assistant integration
// (https://github.com/NewImproved/Aduro, MIT, Copyright (c) 2024 NewImproved),
// with the depletion prediction of the heat level mode only (src/prediction.js):
//   - reach: fixed IP, else mediated discovery, else the Aduro cloud relay;
//   - read: status + operating data on every poll, network and consumption
//     every 5 minutes;
//   - follow-up of the commands: a change is "in progress" until the stove
//     reports it, re-sent up to 3 times, abandoned after 100 s or when the
//     stove is stopped from elsewhere;
//   - wood mode: optional automatic return to pellets once the fire dies;
//   - pellets: what is left in the hopper, from the daily consumption;
//     low level alert and optional automatic stop;
//   - alerts: smoke too hot, wood fire dying, both after a duration;
//   - forced fan / auger: manual mode kept alive, stopped after a duration.
//
// No Gladys here: the bridge turns `snapshot()` into device states and the
// `onEvent` callback into scene events. Clock, sleep and timers are injected
// for the tests.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  CLOUD_RELAY,
  DISCOVERY_PAYLOAD,
  FUNCTIONS,
  decodeFrame,
  encodeFrame,
  parseDiscovery,
  sameSerial,
} from './protocol.js';
import {
  HEAT_LEVEL_POWER,
  OPERATION_MODE,
  RUNNING_STATES,
  STOPPED_STATES,
  WOOD_STATE,
  heatLevelFromPower,
  parseConsumption,
  parseNetwork,
  parseOperating,
  parseStatus,
  stateLabel,
} from './readings.js';
import { Learner } from './prediction.js';
import { DEFAULT_STATE } from './store.js';

const logger = createLogger({ name: 'stove' });

export const TIMING = {
  NETWORK_REFRESH_MS: 5 * 60 * 1000,
  CONSUMPTION_REFRESH_MS: 5 * 60 * 1000,
  REDISCOVERY_LOCAL_MS: 60 * 60 * 1000,
  REDISCOVERY_CLOUD_MS: 15 * 60 * 1000,
  FAILURES_BEFORE_REDISCOVERY: 3,
  COMMAND_RESEND_AFTER_MS: 30 * 1000,
  COMMAND_GIVE_UP_AFTER_MS: 100 * 1000,
  MAX_RESENDS: 3,
  STEP_DELAY_MS: 3000,
  MANUAL_DELAY_MS: 1000,
  KEEP_ALIVE_MS: 20 * 1000,
  STARTUP_TIMER_S: 870,
  SHUTDOWN_TIMER_S: 120,
};

// Smoke temperature under which a dying wood fire hands over to pellets.
const WOOD_RESUME_SMOKE_TEMP = 110;
// The forced fan stops above this smoke temperature.
const FORCE_FAN_MAX_SMOKE_TEMP = 320;
// `manual.output_std` values.
const MANUAL_OUTPUT = { FAN: 2, AUGER: 5 };

// States that are a fault the user should look at.
export const FAULT_STATES = new Set(['11', '13', '15', '17', '18', '19', '20', '33', '34', '35']);

export const TRANSPORT = { LOCAL: 'local', CLOUD: 'cloud', UNREACHABLE: 'unreachable' };

const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

export class Stove {
  /**
   * @param {{ client: object, config: object, store: object, saved?: object,
   *   discover?: (payload: Buffer) => Promise<Array<{ source_ip: string, payload_base64: string }>>,
   *   onEvent?: (key: string, data: object) => void | Promise<void>,
   *   onChange?: () => void, now?: () => number, sleep?: (ms: number) => Promise<void>,
   *   timers?: { setInterval: Function, clearInterval: Function, setTimeout: Function,
   *   clearTimeout: Function } }} options
   */
  constructor({
    client,
    config,
    store,
    saved = DEFAULT_STATE,
    discover = null,
    onEvent = () => {},
    onChange = () => {},
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timers = { setInterval, clearInterval, setTimeout, clearTimeout },
  }) {
    this.client = client;
    this.config = config;
    this.store = store;
    this.discover = discover;
    this.onEvent = onEvent;
    this.onChange = onChange;
    this.now = now;
    this.sleep = sleep;
    this.timers = timers;

    this.saved = { ...DEFAULT_STATE, ...saved };
    this.learner = new Learner(this.saved.learning);

    this.host = null;
    this.transport = TRANSPORT.UNREACHABLE;
    this.lastDiscovery = null;
    this.firmware = null;
    this.failures = 0;
    this.lastNetworkRead = null;
    this.lastConsumptionRead = null;

    this.data = { status: null, operating: null, network: null, consumption: null };

    // Command follow-up.
    this.target = { heatLevel: null, temperature: null, mode: null };
    this.changeStartedAt = null;
    this.changeInProgress = false;
    this.resends = 0;
    this.previous = null; // { state, heatLevel, temperature, mode }
    this.fastPolls = 0;

    // Wood mode.
    this.wasInWood = false;
    this.preWood = { mode: null, heatLevel: null, temperature: null };
    this.autoResumeSent = false;

    // Timers shown in the substate.
    this.startup1At = null;
    this.startup2At = null;
    this.shutdownAt = null;

    // Alerts.
    this.highSmoke = { since: null, active: false, sent: false };
    this.lowWood = { since: null, active: false, sent: false };
    this.lowPelletSent = false;
    this.shutdownSent = false;

    // Forced outputs.
    this.forced = {
      fan: { active: false, startedAt: null, interval: null, timeout: null, stopReason: null },
      auger: { active: false, startedAt: null, interval: null, timeout: null, stopReason: null },
    };
  }

  // --- Reaching the stove ----------------------------------------------------

  /** Pick the address to talk to. Never throws: unreachable is a state. */
  async connect() {
    const { stove_ip: fixedIp, cloud_relay: cloudRelay, prefer_local: preferLocal } = this.config;
    this.lastDiscovery = this.now();
    if (cloudRelay && !preferLocal) {
      this.useHost(CLOUD_RELAY, TRANSPORT.CLOUD);
      return;
    }
    if (fixedIp) {
      if (await this.answers(fixedIp)) {
        this.useHost(fixedIp, TRANSPORT.LOCAL);
        return;
      }
      logger.warn(`The stove does not answer at ${fixedIp}`);
    }
    const discovered = await this.discoverLocal();
    if (discovered) {
      this.firmware = { version: discovered.version, build: discovered.build };
      if (discovered.ip && !discovered.ip.startsWith('0.0.0.0')) {
        this.useHost(discovered.ip, TRANSPORT.LOCAL);
        return;
      }
    }
    if (cloudRelay) {
      this.useHost(CLOUD_RELAY, TRANSPORT.CLOUD);
      return;
    }
    this.host = fixedIp || null;
    this.transport = TRANSPORT.UNREACHABLE;
  }

  useHost(host, transport) {
    if (this.host !== host) {
      logger.info(
        `Talking to the stove through ${transport === TRANSPORT.CLOUD ? 'the Aduro cloud relay' : host}`,
      );
    }
    this.host = host;
    this.transport = transport;
  }

  async answers(host) {
    try {
      await this.client.getStatus(host);
      return true;
    } catch {
      return false;
    }
  }

  /** Broadcast the NBE discovery through Gladys and keep our stove's reply. */
  async discoverLocal() {
    if (!this.discover) {
      return null;
    }
    try {
      // Same placeholders as pyduro, which the stoves answer.
      const frame = encodeFrame({
        serial: '<serial>',
        pin: '<pin>',
        functionId: FUNCTIONS.DISCOVER,
        payload: DISCOVERY_PAYLOAD,
      });
      const replies = await this.discover(Buffer.from(frame, 'latin1'));
      return Stove.pickDiscovery(replies, this.config.stove_serial);
    } catch (err) {
      logger.warn(`Discovery failed: ${err.message}`);
      return null;
    }
  }

  /** Our stove among the discovery replies, by serial number. */
  static pickDiscovery(replies, serial) {
    const stoves = [];
    for (const reply of replies ?? []) {
      try {
        const frame = Buffer.from(reply.payload_base64, 'base64').toString('latin1');
        const found = parseDiscovery(decodeFrame(frame).payload);
        if (found) {
          stoves.push({ ...found, ip: found.ip || reply.source_ip, source_ip: reply.source_ip });
        }
      } catch {
        // Not an NBE reply.
      }
    }
    return stoves.find((stove) => sameSerial(stove.serial, serial)) ?? null;
  }

  shouldRediscover() {
    if (this.lastDiscovery === null || this.host === null) {
      return true;
    }
    if (this.config.stove_ip && this.transport === TRANSPORT.LOCAL) {
      return false;
    }
    const every =
      this.transport === TRANSPORT.CLOUD
        ? TIMING.REDISCOVERY_CLOUD_MS
        : TIMING.REDISCOVERY_LOCAL_MS;
    return this.now() - this.lastDiscovery > every;
  }

  // --- Reading ---------------------------------------------------------------

  /** One poll cycle. Resolves false when the stove did not answer. */
  async poll() {
    if (this.shouldRediscover()) {
      await this.connect();
    }
    if (!this.host) {
      this.transport = TRANSPORT.UNREACHABLE;
      return false;
    }
    try {
      const status = parseStatus((await this.client.getStatus(this.host)).payload);
      const operating = parseOperating((await this.client.getOperating(this.host)).payload);
      // In heat level mode the level shown and followed is the one chosen
      // (regulation.fixed_power, exact) rather than the one measured from an
      // approximate power percentage. In temperature mode the stove picks
      // its own level: the measured one is all there is.
      if (status.operation_mode === OPERATION_MODE.HEAT_LEVEL && status.fixed_power > 0) {
        operating.heat_level = heatLevelFromPower(status.fixed_power);
      }
      logger.debug(
        `state ${operating.state}/${operating.substate}, mode ${status.operation_mode}, ` +
          `fixed_power ${status.fixed_power}, power_pct ${operating.power_pct}, ` +
          `level ${operating.heat_level} (measured ${operating.measured_level})`,
      );
      this.data.status = status;
      this.data.operating = operating;
      if (this.due(this.lastNetworkRead, TIMING.NETWORK_REFRESH_MS)) {
        this.data.network = parseNetwork(
          (await this.client.getSettings(this.host, 'wifi.router')).payload,
        );
        this.lastNetworkRead = this.now();
      }
      if (this.due(this.lastConsumptionRead, TIMING.CONSUMPTION_REFRESH_MS)) {
        const days = (await this.client.getConsumption(this.host, 'total_days')).payload;
        const months = (await this.client.getConsumption(this.host, 'total_months')).payload;
        this.data.consumption = parseConsumption({ days, months }, new Date(this.now()));
        this.lastConsumptionRead = this.now();
        this.trackPellets(this.data.consumption.day);
      }
    } catch (err) {
      this.failures += 1;
      logger.warn(`Reading the stove failed (${this.failures}): ${err.message}`);
      if (this.failures >= TIMING.FAILURES_BEFORE_REDISCOVERY) {
        this.failures = 0;
        this.lastDiscovery = null;
        this.transport = TRANSPORT.UNREACHABLE;
      }
      return false;
    }
    this.failures = 0;
    if (this.transport === TRANSPORT.UNREACHABLE) {
      this.transport = this.host === CLOUD_RELAY ? TRANSPORT.CLOUD : TRANSPORT.LOCAL;
    }
    if (this.fastPolls > 0) {
      this.fastPolls -= 1;
    }
    await this.process();
    return true;
  }

  due(last, every) {
    return last === null || this.now() - last > every;
  }

  /** Whether the next poll should come soon (a change is expected). */
  get fastPolling() {
    return this.fastPolls > 0 || this.changeInProgress;
  }

  async process() {
    await this.followStates();
    this.learn();
    await this.followChange();
    this.followTimers();
    await this.checkPellets();
    await this.checkTemperatures();
    await this.checkForcedFan();
  }

  /** Wood mode, timers, changes made from the Aduro app or the stove itself. */
  async followStates() {
    const {
      state,
      substate,
      heat_level: heatLevel,
      boiler_ref: temperature,
      smoke_temp: smoke,
    } = this.data.operating;
    const mode = this.data.status.operation_mode;
    const inWood = state === WOOD_STATE;

    if (inWood && !this.wasInWood) {
      this.preWood = { mode, heatLevel, temperature };
      this.wasInWood = true;
      this.autoResumeSent = false;
    } else if (inWood) {
      // In temperature mode the stove goes back to pellets by itself.
      if (
        this.saved.auto_resume_wood &&
        this.preWood.mode === OPERATION_MODE.HEAT_LEVEL &&
        smoke <= WOOD_RESUME_SMOKE_TEMP &&
        !this.autoResumeSent
      ) {
        logger.info(`Wood fire dying (smoke ${smoke} °C), resuming pellets`);
        this.autoResumeSent = await this.resumePellets().catch((err) => {
          logger.error(`Automatic resume failed: ${err.message}`);
          return false;
        });
      }
    }
    if (!inWood && this.wasInWood) {
      this.wasInWood = false;
      this.autoResumeSent = false;
    }

    const previousState = this.previous?.state;
    if (state === '2' && previousState !== '2') {
      this.startup1At = this.now();
    }
    if (state === '4' && previousState !== '4') {
      this.startup2At = this.now();
    }
    if (state === '14' && substate === '0' && ['5', '32'].includes(previousState)) {
      this.shutdownAt = this.now();
    }
    if (state !== '14') {
      this.shutdownAt = null;
    }

    if (this.previous === null) {
      this.previous = { state, heatLevel, temperature, mode };
      return;
    }

    if (previousState !== state && FAULT_STATES.has(state)) {
      await this.emit('stove_fault', {
        state_code: Number(state),
        state_label: stateLabel(state, heatLevel, this.config.language),
      });
    }

    // Stopped from elsewhere: whatever we were waiting for will not come.
    if (STOPPED_STATES.has(state) && !STOPPED_STATES.has(previousState)) {
      this.clearChange();
      this.previous = { state, heatLevel, temperature, mode };
      return;
    }

    if (!this.changeInProgress) {
      const changedOutside =
        (mode === OPERATION_MODE.HEAT_LEVEL && heatLevel !== this.previous.heatLevel) ||
        (mode === OPERATION_MODE.TEMPERATURE && temperature !== this.previous.temperature) ||
        mode !== this.previous.mode;
      if (changedOutside) {
        logger.info('Settings changed from outside Gladys (Aduro app or stove panel)');
      }
    }
    this.previous = { state, heatLevel, temperature, mode };
  }

  clearChange() {
    this.changeInProgress = false;
    this.changeStartedAt = null;
    this.resends = 0;
    this.target = { heatLevel: null, temperature: null, mode: null };
  }

  /** Has the stove applied what we asked? Re-send, or give up. */
  async followChange() {
    if (!this.changeInProgress) {
      return;
    }
    const { heat_level: heatLevel, boiler_ref: temperature } = this.data.operating;
    const mode = this.data.status.operation_mode;
    const done =
      (this.target.heatLevel === null || this.target.heatLevel === heatLevel) &&
      (this.target.temperature === null || this.target.temperature === temperature) &&
      (this.target.mode === null || this.target.mode === mode);
    if (done) {
      this.clearChange();
      return;
    }
    const elapsed = this.now() - (this.changeStartedAt ?? this.now());
    if (elapsed > TIMING.COMMAND_RESEND_AFTER_MS && this.resends < TIMING.MAX_RESENDS) {
      this.resends += 1;
      logger.info(`The stove did not apply the change yet, sending it again (${this.resends})`);
      this.changeStartedAt = this.now();
      await this.resend().catch((err) => logger.warn(`Re-sending failed: ${err.message}`));
    } else if (elapsed > TIMING.COMMAND_GIVE_UP_AFTER_MS) {
      logger.error('The stove did not apply the change, giving up');
      this.clearChange();
    }
  }

  async resend() {
    if (this.target.mode !== null) {
      await this.client.set(this.host, 'regulation.operation_mode', this.target.mode);
    }
    await this.sleep(TIMING.STEP_DELAY_MS);
    if (this.target.heatLevel !== null) {
      await this.client.set(
        this.host,
        'regulation.fixed_power',
        HEAT_LEVEL_POWER[this.target.heatLevel],
      );
    }
    if (this.target.temperature !== null) {
      await this.client.set(this.host, 'boiler.temp', this.target.temperature);
    }
  }

  followTimers() {
    const remaining = (since, duration) => {
      if (since === null) {
        return 0;
      }
      return Math.max(0, duration - Math.floor((this.now() - since) / 1000));
    };
    const startup1 = remaining(this.startup1At, TIMING.STARTUP_TIMER_S);
    const startup2 = remaining(this.startup2At, TIMING.STARTUP_TIMER_S);
    const shutdown = remaining(this.shutdownAt, TIMING.SHUTDOWN_TIMER_S);
    if (startup1 === 0) {
      this.startup1At = null;
    }
    if (startup2 === 0) {
      this.startup2At = null;
    }
    if (shutdown === 0) {
      this.shutdownAt = null;
    }
    this.timersLeft = { startup1, startup2, shutdown };
  }

  /** Seconds left on the timer of the current state (start-up, shutdown). */
  timerFor(state, substate) {
    const left = this.timersLeft ?? { startup1: 0, startup2: 0, shutdown: 0 };
    if (state === '2') {
      return left.startup1;
    }
    if (state === '4') {
      return left.startup2;
    }
    if (state === '14' && substate === '0') {
      return left.shutdown;
    }
    return 0;
  }

  // --- Pellets ---------------------------------------------------------------

  /** Add the increase of today's consumption to the pellet counters. */
  trackPellets(today) {
    const date = new Date(this.now()).toDateString();
    const { last_day_consumption: last, last_day_date: lastDate } = this.saved;
    let increment = 0;
    if (last === null || last === undefined) {
      increment = 0;
    } else if (lastDate && lastDate !== date) {
      // Restarted across midnight: the stove's counter restarted from zero.
      increment = today;
    } else if (today > last) {
      increment = today - last;
    }
    this.saved.last_day_consumption = today;
    this.saved.last_day_date = date;
    if (increment > 0) {
      this.learner.addConsumption(increment);
      this.saved.pellets_consumed = round(this.saved.pellets_consumed + increment, 3);
      this.saved.pellets_consumed_total = round(this.saved.pellets_consumed_total + increment, 3);
    }
    this.persist();
  }

  /** Feed the depletion prediction with the current state. */
  learn() {
    const learned = this.learner.observe({
      state: this.data.operating.state,
      heatLevel: this.data.operating.heat_level,
      mode: this.data.status.operation_mode,
      now: this.now(),
    });
    if (learned) {
      this.saved.learning = this.learner.data;
      this.persist();
    }
  }

  /** When the pellets run out at the current heat level (heat level mode). */
  prediction() {
    if (!this.data.operating || !this.data.status) {
      return null;
    }
    const { capacity, amount } = this.pellets();
    // With the automatic stop on, the stove stops before the hopper is empty.
    const reserve = this.saved.auto_shutdown ? (capacity * this.config.shutdown_level) / 100 : 0;
    return this.learner.predict({
      mode: this.data.status.operation_mode,
      state: this.data.operating.state,
      heatLevel: this.data.operating.heat_level,
      pelletsLeft: amount,
      reserve,
      now: this.now(),
    });
  }

  pellets() {
    const capacity = this.config.pellet_capacity;
    const amount = Math.max(0, capacity - this.saved.pellets_consumed);
    return {
      capacity,
      consumed: this.saved.pellets_consumed,
      consumed_total: this.saved.pellets_consumed_total,
      amount: round(amount),
      percentage: capacity > 0 ? round((amount / capacity) * 100, 1) : 0,
    };
  }

  async checkPellets() {
    if (this.saved.last_day_consumption === null) {
      return; // Nothing counted yet.
    }
    const { percentage, amount } = this.pellets();
    if (percentage <= this.config.low_pellet_level) {
      if (!this.lowPelletSent) {
        this.lowPelletSent = true;
        await this.emit('low_pellets', { percentage, remaining_kg: amount });
      }
    } else {
      this.lowPelletSent = false;
    }
    if (this.saved.auto_shutdown && percentage <= this.config.shutdown_level) {
      if (!this.shutdownSent) {
        this.shutdownSent = true;
        const running = RUNNING_STATES.has(this.data.operating?.state);
        logger.warn(`Pellets at ${percentage} %, stopping the stove`);
        if (running) {
          await this.stop().catch((err) => logger.error(`Automatic stop failed: ${err.message}`));
        }
        await this.emit('pellet_shutdown', { percentage, remaining_kg: amount });
      }
    } else if (percentage > this.config.shutdown_level) {
      this.shutdownSent = false;
    }
  }

  get lowPellets() {
    return (
      this.saved.last_day_consumption !== null &&
      this.pellets().percentage <= this.config.low_pellet_level
    );
  }

  // --- Temperature alerts ----------------------------------------------------

  async checkTemperatures() {
    const { smoke_temp: smoke, state } = this.data.operating;
    const now = this.now();
    const {
      high_smoke_temp: highTemp,
      high_smoke_duration: highDuration,
      low_wood_temp: lowTemp,
      low_wood_duration: lowDuration,
    } = this.config;

    if (smoke >= highTemp) {
      this.highSmoke.since ??= now;
      if (now - this.highSmoke.since >= highDuration * 1000) {
        this.highSmoke.active = true;
        if (!this.highSmoke.sent) {
          this.highSmoke.sent = true;
          logger.warn(`Smoke temperature ${smoke} °C above ${highTemp} °C`);
          await this.emit('high_smoke_temperature', { temperature: smoke });
        }
      }
    } else {
      this.highSmoke.since = null;
      this.highSmoke.active = false;
      // Hysteresis: a new alert only once the temperature really dropped.
      if (smoke < highTemp - 20) {
        this.highSmoke.sent = false;
      }
    }

    if (state === WOOD_STATE && smoke <= lowTemp) {
      this.lowWood.since ??= now;
      if (now - this.lowWood.since >= lowDuration * 1000) {
        this.lowWood.active = true;
        if (!this.lowWood.sent) {
          this.lowWood.sent = true;
          await this.emit('low_wood_temperature', { temperature: smoke });
        }
      }
    } else {
      this.lowWood.since = null;
      this.lowWood.active = false;
      if (state === WOOD_STATE && smoke > lowTemp + 10) {
        this.lowWood.sent = false;
      }
    }
  }

  /** The "alert reset" button: forget the alerts already raised. */
  resetAlerts() {
    this.highSmoke = { since: null, active: false, sent: false };
    this.lowWood = { since: null, active: false, sent: false };
  }

  // --- Commands --------------------------------------------------------------

  requireHost() {
    if (!this.host || this.transport === TRANSPORT.UNREACHABLE) {
      throw new Error('The stove is unreachable');
    }
  }

  async send(path, value) {
    this.requireHost();
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.client.set(this.host, path, value);
        this.fastPolls = 5;
        return;
      } catch (err) {
        lastError = err;
        await this.sleep(TIMING.MANUAL_DELAY_MS);
      }
    }
    throw lastError;
  }

  startChange(target) {
    this.target = { heatLevel: null, temperature: null, mode: null, ...target };
    this.changeInProgress = true;
    this.changeStartedAt = this.now();
    this.resends = 0;
  }

  async start() {
    await this.send('misc.start', 1);
    this.changeInProgress = true;
    this.changeStartedAt = this.now();
  }

  async stop() {
    await this.send('misc.stop', 1);
    this.changeInProgress = true;
    this.changeStartedAt = this.now();
  }

  /** Heat level mode at level 1, 2 or 3: mode first, then the power. */
  async setHeatLevel(level) {
    if (!HEAT_LEVEL_POWER[level]) {
      throw new Error(`Invalid heat level ${level} (1 to 3)`);
    }
    this.startChange({ heatLevel: level, mode: OPERATION_MODE.HEAT_LEVEL });
    try {
      await this.send('regulation.operation_mode', OPERATION_MODE.HEAT_LEVEL);
      await this.sleep(TIMING.STEP_DELAY_MS);
      await this.send('regulation.fixed_power', HEAT_LEVEL_POWER[level]);
    } catch (err) {
      this.clearChange();
      throw err;
    }
  }

  /** Temperature mode with a set point: mode first, then the temperature. */
  async setTemperature(temperature) {
    const value = Math.round(Number(temperature));
    if (!Number.isFinite(value) || value < 5 || value > 35) {
      throw new Error(`Invalid temperature ${temperature} (5 to 35 °C)`);
    }
    this.startChange({ temperature: value, mode: OPERATION_MODE.TEMPERATURE });
    try {
      await this.send('regulation.operation_mode', OPERATION_MODE.TEMPERATURE);
      await this.sleep(TIMING.STEP_DELAY_MS);
      await this.send('boiler.temp', value);
    } catch (err) {
      this.clearChange();
      throw err;
    }
  }

  async setOperationMode(mode) {
    if (!Object.values(OPERATION_MODE).includes(mode)) {
      throw new Error(`Invalid operation mode ${mode}`);
    }
    const target = { mode };
    // Keep the current set point of the mode we switch to.
    if (mode === OPERATION_MODE.HEAT_LEVEL && this.data.operating) {
      target.heatLevel = this.data.operating.heat_level;
    } else if (mode === OPERATION_MODE.TEMPERATURE && this.data.operating) {
      target.temperature = this.data.operating.boiler_ref;
    }
    this.startChange(target);
    try {
      await this.send('regulation.operation_mode', mode);
    } catch (err) {
      this.clearChange();
      throw err;
    }
  }

  /** Back to pellets after wood mode, with the settings used before it. */
  async resumePellets() {
    await this.start();
    await this.sleep(TIMING.STEP_DELAY_MS);
    const { mode, heatLevel, temperature } = this.preWood;
    if (mode === OPERATION_MODE.HEAT_LEVEL && heatLevel !== null) {
      await this.setHeatLevel(heatLevel);
    } else if (mode === OPERATION_MODE.TEMPERATURE && temperature !== null) {
      await this.setTemperature(temperature);
    }
    return true;
  }

  async resumeAfterWood() {
    if (this.data.operating?.state !== WOOD_STATE) {
      throw new Error('The stove is not in wood mode');
    }
    await this.resumePellets();
  }

  async resetAlarm() {
    await this.send('misc.reset_alarm', 1);
    this.resetAlerts();
  }

  refillPellets() {
    this.saved.pellets_consumed = 0;
    this.lowPelletSent = false;
    this.shutdownSent = false;
    this.persist();
  }

  cleaned() {
    this.saved.pellets_consumed_total = 0;
    this.persist();
  }

  async setAutoShutdown(enabled) {
    this.saved.auto_shutdown = Boolean(enabled);
    this.persist();
  }

  async setAutoResumeWood(enabled) {
    const wasEnabled = this.saved.auto_resume_wood;
    this.saved.auto_resume_wood = Boolean(enabled);
    this.persist();
    // As the Home Assistant integration does: turning it off in wood mode
    // cancels the pending resume, which the stove only forgets on a stop.
    if (wasEnabled && !enabled && this.wasInWood) {
      await this.stop();
    }
  }

  // --- Forced fan and auger (manual mode) -----------------------------------

  async startForced(output) {
    const forced = this.forced[output];
    if (forced.active) {
      return;
    }
    await this.send('manual.manual_mode', 1);
    await this.sleep(TIMING.MANUAL_DELAY_MS);
    try {
      await this.send(
        'manual.output_std',
        output === 'fan' ? MANUAL_OUTPUT.FAN : MANUAL_OUTPUT.AUGER,
      );
    } catch (err) {
      await this.send('manual.manual_mode', 0).catch(() => {});
      throw err;
    }
    forced.active = true;
    forced.startedAt = this.now();
    forced.stopReason = null;
    forced.interval = this.timers.setInterval(() => {
      this.keepAlive(output).catch((err) => logger.error(`Keep-alive failed: ${err.message}`));
    }, TIMING.KEEP_ALIVE_MS);
    const seconds =
      output === 'fan' ? this.config.force_fan_duration : this.config.force_auger_duration;
    forced.timeout = this.timers.setTimeout(() => {
      this.stopForced(output, 'timeout').catch((err) =>
        logger.error(`Stopping failed: ${err.message}`),
      );
    }, seconds * 1000);
    this.onChange();
  }

  async stopForced(output, reason = 'manual') {
    const forced = this.forced[output];
    if (!forced.active) {
      return;
    }
    this.timers.clearInterval(forced.interval);
    this.timers.clearTimeout(forced.timeout);
    forced.active = false;
    forced.startedAt = null;
    forced.interval = null;
    forced.timeout = null;
    forced.stopReason = reason;
    this.onChange();
    // Leaving the manual mode is the only known way to stop the output.
    await this.send('manual.manual_mode', 0);
  }

  async keepAlive(output) {
    if (!this.forced[output].active) {
      return;
    }
    try {
      await this.send('manual.keep_alive', 1);
    } catch (err) {
      await this.stopForced(output, 'error');
      throw err;
    }
  }

  async checkForcedFan() {
    if (this.forced.fan.active && this.data.operating.smoke_temp > FORCE_FAN_MAX_SMOKE_TEMP) {
      logger.warn('Forced fan stopped: smoke temperature too high');
      await this.stopForced('fan', 'overheat').catch(() => {});
    }
  }

  /** Stop the timers; the outputs are left to the stove's own keep-alive. */
  dispose() {
    for (const forced of Object.values(this.forced)) {
      this.timers.clearInterval(forced.interval);
      this.timers.clearTimeout(forced.timeout);
    }
  }

  // --- Helpers ---------------------------------------------------------------

  persist() {
    this.store?.save({ ...this.saved });
  }

  async emit(key, data) {
    try {
      await this.onEvent(key, data);
    } catch (err) {
      logger.warn(`Publishing the ${key} event failed: ${err.message}`);
    }
  }

  get running() {
    return RUNNING_STATES.has(this.data.operating?.state);
  }
}
