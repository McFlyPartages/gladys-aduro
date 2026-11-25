// -----------------------------------------------------------------------------
// Bridge between the stove and Gladys:
//
//   poll loop (45 s, 5 s while a change is expected) -> Stove.poll()
//   Stove readings  -> device + feature states published to Gladys
//   Stove transport -> local / cloud / unreachable badge
//   Stove events    -> scene triggers
//   Gladys commands -> Stove commands
//
// The UDP client, the store and the timers are injected so the tests never
// touch the network nor the disk.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { NBE_PORT } from './protocol.js';
import { Stove, TRANSPORT } from './stove.js';
import { DEVICE_TYPE, buildDevice, buildStates, runCommand } from './device.js';
import { WIDGET, pictureOf, runStoveAction, statsWidget, stoveWidget } from './widgets.js';

const logger = createLogger({ name: 'bridge' });

export const POLL_INTERVAL_MS = 45 * 1000;
export const FAST_POLL_INTERVAL_MS = 5 * 1000;
const COMMAND_ACK_DEADLINE_MS = 4000;
// Re-send unchanged values now and then, so they stay recently dated.
const HEARTBEAT_MS = 30 * 60 * 1000;

export const MESSAGES = {
  notConfigured: {
    en: 'Enter the serial number and the PIN code of the stove in the configuration.',
    fr: 'Renseignez le numéro de série et le code PIN du poêle dans la configuration.',
  },
  connecting: {
    en: 'Looking for the stove…',
    fr: 'Recherche du poêle…',
  },
  unreachable: {
    en: 'The stove does not answer: check its IP address, serial number and PIN code.',
    fr: 'Le poêle ne répond pas : vérifiez son adresse IP, son numéro de série et son code PIN.',
  },
  cloud: {
    en: 'Stove reached through the Aduro cloud relay (not found on the local network).',
    fr: 'Poêle joint par le relais cloud Aduro (introuvable sur le réseau local).',
  },
};

export class Bridge {
  /**
   * @param {object} gladys SDK instance
   * @param {{ createClient: (config: object) => object, store: object,
   *   timers?: object, now?: () => number, sleep?: (ms: number) => Promise<void> }} deps
   */
  constructor(gladys, { createClient, store, timers, now, sleep }) {
    this.gladys = gladys;
    this.createClient = createClient;
    this.store = store;
    this.timers = timers ?? { setInterval, clearInterval, setTimeout, clearTimeout };
    this.now = now;
    this.sleep = sleep;
    this.config = null;
    this.stove = null;
    this.timer = null;
    this.published = false;
    this.lastTransport = null;
    this.polling = null;
    this.widgetSignature = null;
  }

  /** (Re)start with a normalized configuration. */
  async start(config) {
    await this.stop();
    this.config = config;
    if (!config.stove_serial || !config.stove_pin) {
      await this.setStatus(false, MESSAGES.notConfigured);
      return;
    }
    await this.setStatus(false, MESSAGES.connecting);
    const saved = await this.store.load();
    this.stove = new Stove({
      client: this.createClient(config),
      config,
      store: this.store,
      saved,
      discover: (payload) =>
        this.gladys.scanNetwork('udp-active-broadcast', {
          port: NBE_PORT,
          payload,
          timeoutSeconds: 5,
        }),
      onEvent: (key, data) => this.publishEvent(key, data),
      onChange: () => {
        this.publishStates().catch((err) => logger.debug(`publishStates failed: ${err.message}`));
      },
      timers: this.timers,
      ...(this.now ? { now: this.now } : {}),
      ...(this.sleep ? { sleep: this.sleep } : {}),
    });
    await this.pollOnce();
  }

  /** Apply settings that need no new session (thresholds, language…). */
  async update(config) {
    const languageChanged = this.config?.language !== config.language;
    const modelChanged = this.config?.stove_model !== config.stove_model;
    this.config = config;
    if (this.stove) {
      this.stove.config = config;
      if (languageChanged || modelChanged) {
        await this.publishDevice();
      }
      await this.publishStates();
    }
  }

  async stop() {
    this.timers.clearTimeout(this.timer);
    this.timer = null;
    // Let a running poll finish before dropping the stove.
    await this.polling?.catch(() => {});
    this.stove?.dispose();
    this.stove = null;
    this.published = false;
    this.lastTransport = null;
  }

  schedule() {
    if (!this.stove) {
      return;
    }
    const delay = this.stove.fastPolling ? FAST_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
    this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.pollOnce().catch((err) => logger.error('Poll failed', err));
    }, delay);
  }

  /** One poll and its publications, then the next one is scheduled. */
  async pollOnce() {
    const stove = this.stove;
    if (!stove) {
      return;
    }
    // A scan request or a command may ask while the timer's poll runs.
    if (this.polling) {
      await this.polling.catch(() => {});
      return;
    }
    this.polling = (async () => {
      const ok = await stove.poll();
      if (stove !== this.stove) {
        return;
      }
      if (ok) {
        await this.setStatus(
          true,
          stove.transport === TRANSPORT.CLOUD ? MESSAGES.cloud : undefined,
        );
        if (!this.published) {
          await this.publishDevice();
        }
        await this.publishStates();
        this.refreshWidgets();
      } else {
        await this.setStatus(false, MESSAGES.unreachable);
      }
      await this.publishTransport();
    })();
    try {
      await this.polling;
    } finally {
      this.polling = null;
      if (stove === this.stove) {
        this.schedule();
      }
    }
  }

  /** The device, once the stove answered (none before: no serial check). */
  devices() {
    if (!this.stove || !this.stove.data.operating) {
      return [];
    }
    return [buildDevice(this.gladys, this.stove, this.config)];
  }

  async publishDevice() {
    const devices = this.devices();
    if (devices.length === 0) {
      return;
    }
    await this.gladys.publishDiscoveredDevices(devices);
    this.published = true;
  }

  async publishStates() {
    if (!this.stove?.data.operating) {
      return;
    }
    const states = buildStates(this.gladys, this.stove, this.config);
    if (states.length > 0) {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    }
  }

  async publishTransport({ force = false } = {}) {
    if (!this.stove || !this.config) {
      return;
    }
    const transport = this.stove.transport;
    if (!force && transport === this.lastTransport) {
      return;
    }
    const externalId = this.gladys.externalIds(DEVICE_TYPE, this.config.stove_serial).device;
    await this.gladys.publishTransports([{ external_id: externalId, transport }]);
    this.lastTransport = transport;
  }

  async publishEvent(key, data) {
    const device = this.gladys.externalIds(DEVICE_TYPE, this.config.stove_serial).device;
    await this.gladys.publishSceneEvent(key, { device, ...data });
  }

  /** States Gladys dropped while the device did not exist yet. */
  async replayStates() {
    this.gladys.forgetPublishedStates();
    await this.publishStates();
    await this.publishTransport({ force: true });
  }

  async setValue(feature, value) {
    if (!this.stove) {
      throw new Error('The stove is not configured');
    }
    const command = runCommand(this.gladys, this.stove, this.config, feature.external_id, value);
    // Gladys waits 5 s for the ack, a mode + set point change takes longer
    // (two writes 3 s apart). Past the deadline the command goes on: Gladys
    // is told it was sent and the states will show the outcome.
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve('late'), COMMAND_ACK_DEADLINE_MS);
    });
    const outcome = await Promise.race([command, late]).finally(() =>
      this.timers.clearTimeout(timer),
    );
    if (outcome === 'late') {
      command.catch((err) =>
        logger.error(`Command on ${feature.external_id} failed: ${err.message}`),
      );
    } else if (!outcome) {
      throw new Error(`Unknown feature ${feature.external_id}`);
    }
    await this.publishStates();
    // Read the result soon.
    this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.pollOnce().catch((err) => logger.error('Poll failed', err));
    }, FAST_POLL_INTERVAL_MS);
  }

  /** Ask the dashboards to re-pull the stove widget when its look changed. */
  refreshWidgets() {
    const operating = this.stove?.data.operating;
    const status = this.stove?.data.status;
    if (!operating || !status) {
      return;
    }
    const signature = [
      pictureOf(operating),
      operating.state,
      operating.substate,
      status.operation_mode,
      operating.boiler_ref,
    ].join('|');
    if (signature !== this.widgetSignature) {
      this.widgetSignature = signature;
      try {
        this.gladys.requestWidgetRefresh(WIDGET.STOVE);
      } catch (err) {
        logger.debug(`requestWidgetRefresh failed: ${err.message}`);
      }
    }
  }

  /** Content of a dashboard widget. */
  widget(key, { language = 'en', settings = {} } = {}) {
    const config = this.config ?? {};
    if (key === WIDGET.STOVE) {
      return stoveWidget(this.gladys, this.stove, config, language);
    }
    return statsWidget(
      this.gladys,
      this.stove,
      config,
      language,
      settings,
      this.now?.() ?? Date.now(),
    );
  }

  /** A button of the stove widget; the next poll comes soon. */
  async widgetAction(actionKey) {
    const message = await runStoveAction(this.stove, actionKey);
    await this.publishStates();
    this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.pollOnce().catch((err) => logger.error('Poll failed', err));
    }, FAST_POLL_INTERVAL_MS);
    return message;
  }

  async setStatus(connected, message) {
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      logger.debug(`setConnectionStatus failed: ${err.message}`);
    }
  }
}
