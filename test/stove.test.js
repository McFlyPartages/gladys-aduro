import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { CLOUD_RELAY, decodeFrame, encodeFrame } from '../src/protocol.js';
import { Stove, TIMING, TRANSPORT } from '../src/stove.js';
import { FakeClient, FakeClock, MemoryStore, PIN, SERIAL } from './fixtures.js';

const IP = '192.168.60.50';

function setup({ config = {}, client = new FakeClient(), saved, discover } = {}) {
  const clock = new FakeClock();
  const store = new MemoryStore();
  const events = [];
  const stove = new Stove({
    client,
    config: normalizeConfig({ stove_serial: SERIAL, stove_pin: PIN, stove_ip: IP, ...config }),
    store,
    saved,
    discover,
    onEvent: (key, data) => events.push([key, data]),
    now: clock.now,
    sleep: clock.sleep,
    timers: clock.timers,
  });
  return { stove, client, clock, store, events };
}

// A discovery reply frame, as the core relays it.
function discoveryReply(serial, ip) {
  const payload = `Serial=${serial};IP=${ip};Type=H2;Ver=705;Build=12;Lang=0`;
  const frame =
    `___gladys___${serial} 0001` + `0${String(payload.length).padStart(3, '0')}${payload}`;
  decodeFrame(frame); // sanity
  return {
    source_ip: ip,
    source_port: 8483,
    payload_base64: Buffer.from(frame, 'latin1').toString('base64'),
  };
}

test('a fixed IP that answers is used locally', async () => {
  const { stove, client } = setup();
  assert.equal(await stove.poll(), true);
  assert.equal(stove.host, IP);
  assert.equal(stove.transport, TRANSPORT.LOCAL);
  assert.ok(client.requests.every((host) => host === IP));
  assert.equal(stove.data.operating.heat_level, 2);
  assert.equal(stove.data.network.mac, 'AA:BB:CC:DD:EE:FF');
});

test('without an IP the stove is discovered through Gladys, by serial', async () => {
  let sent;
  const discover = async (payload) => {
    sent = payload.toString('latin1');
    return [discoveryReply('654321', '192.168.1.9'), discoveryReply(SERIAL, '192.168.1.7')];
  };
  const { stove } = setup({ config: { stove_ip: '' }, discover });
  await stove.poll();
  assert.ok(sent.includes('NBE Discovery'));
  assert.equal(
    sent,
    encodeFrame({
      serial: '<serial>',
      pin: '<pin>',
      functionId: 0,
      payload: 'NBE Discovery',
      now: Number(sent.slice(34, 44)) * 1000,
    }),
  );
  assert.equal(stove.host, '192.168.1.7');
  assert.deepEqual(stove.firmware, { version: '705', build: '12' });
});

test('not found locally: the cloud relay, unless it is disabled', async () => {
  const client = new FakeClient();
  client.failing = true;
  const cloud = setup({ client, config: { cloud_relay: true }, discover: async () => [] });
  await cloud.stove.connect();
  assert.equal(cloud.stove.host, CLOUD_RELAY);
  assert.equal(cloud.stove.transport, TRANSPORT.CLOUD);

  const local = setup({ client, config: { cloud_relay: false }, discover: async () => [] });
  assert.equal(await local.stove.poll(), false);
  assert.equal(local.stove.transport, TRANSPORT.UNREACHABLE);
});

test('"prefer local" off goes straight to the cloud relay', async () => {
  const { stove } = setup({ config: { cloud_relay: true, GLADYS_PREFER_LOCAL: false } });
  await stove.poll();
  assert.equal(stove.host, CLOUD_RELAY);
  assert.equal(stove.transport, TRANSPORT.CLOUD);
});

test('three failed polls in a row trigger a new discovery', async () => {
  const { stove, client } = setup();
  await stove.poll();
  client.failing = true;
  for (let i = 0; i < TIMING.FAILURES_BEFORE_REDISCOVERY; i += 1) {
    assert.equal(await stove.poll(), false);
  }
  assert.equal(stove.transport, TRANSPORT.UNREACHABLE);
  assert.ok(stove.shouldRediscover());
});

test('heat level: mode first, then the power, followed until applied', async () => {
  const { stove, client } = setup();
  await stove.poll();
  await stove.setHeatLevel(3);
  assert.deepEqual(client.sets, [
    ['regulation.operation_mode', 0],
    ['regulation.fixed_power', 100],
  ]);
  assert.ok(stove.changeInProgress);
  assert.ok(stove.fastPolling);
  await stove.poll();
  assert.equal(stove.changeInProgress, false);
  await assert.rejects(stove.setHeatLevel(4), /Invalid heat level/);
});

test('temperature: switches to temperature mode, then sets the point', async () => {
  const { stove, client } = setup();
  await stove.poll();
  await stove.setTemperature(23.4);
  assert.deepEqual(client.sets, [
    ['regulation.operation_mode', 1],
    ['boiler.temp', 23],
  ]);
  await assert.rejects(stove.setTemperature(40), /Invalid temperature/);
});

test('a change the stove ignores is sent again, then abandoned', async () => {
  const client = new FakeClient();
  const { stove, clock } = setup({ client });
  await stove.poll();
  client.applyWrites = false;
  await stove.setHeatLevel(1);
  client.sets = [];
  await clock.advance(TIMING.COMMAND_RESEND_AFTER_MS + 1);
  await stove.poll();
  assert.deepEqual(client.sets, [
    ['regulation.operation_mode', 0],
    ['regulation.fixed_power', 10],
  ]);
  for (let i = 0; i < 5 && stove.changeInProgress; i += 1) {
    await clock.advance(TIMING.COMMAND_GIVE_UP_AFTER_MS + 1);
    await stove.poll();
  }
  assert.equal(stove.changeInProgress, false);
  assert.ok(stove.resends <= TIMING.MAX_RESENDS);
});

test('a stop from elsewhere drops the pending change', async () => {
  const client = new FakeClient();
  const { stove } = setup({ client });
  await stove.poll();
  client.applyWrites = false;
  await stove.setHeatLevel(3);
  client.state.operating = { ...client.state.operating, state: '14', substate: '0' };
  await stove.poll();
  assert.equal(stove.changeInProgress, false);
});

test('a fault state fires the stove_fault event once', async () => {
  const client = new FakeClient();
  const { stove, events } = setup({ client });
  await stove.poll();
  client.state.operating = { state: '20' };
  await stove.poll();
  await stove.poll();
  const faults = events.filter(([key]) => key === 'stove_fault');
  assert.deepEqual(faults, [['stove_fault', { state_code: 20, state_label: 'Stopped' }]]);
});

test('pellets: counted from the daily consumption, refill and cleaning', async () => {
  const client = new FakeClient();
  const { stove, clock, store } = setup({ client, config: { pellet_capacity: 10 } });
  client.state.days[23] = 2;
  await stove.poll(); // baseline
  assert.equal(stove.pellets().percentage, 100);
  client.state.days[23] = 4.5;
  await clock.advance(TIMING.CONSUMPTION_REFRESH_MS + 1);
  await stove.poll();
  assert.deepEqual(stove.pellets(), {
    capacity: 10,
    consumed: 2.5,
    consumed_total: 2.5,
    amount: 7.5,
    percentage: 75,
  });
  assert.equal(store.state.pellets_consumed, 2.5);
  stove.refillPellets();
  assert.equal(stove.pellets().amount, 10);
  assert.equal(stove.pellets().consumed_total, 2.5);
  stove.cleaned();
  assert.equal(stove.pellets().consumed_total, 0);
});

test('pellets: a restart after midnight counts the whole new day', async () => {
  const client = new FakeClient();
  client.state.days[23] = 1.5;
  const saved = {
    pellets_consumed: 1,
    pellets_consumed_total: 1,
    last_day_consumption: 6,
    last_day_date: new Date('2026-11-23T20:00:00').toDateString(),
  };
  const { stove } = setup({ client, saved });
  await stove.poll();
  assert.equal(stove.saved.pellets_consumed, 2.5);
});

test('low pellets: one alert, and the automatic stop when enabled', async () => {
  const client = new FakeClient();
  const saved = { pellets_consumed: 9.6, last_day_consumption: 0, auto_shutdown: true };
  saved.last_day_date = new Date('2026-11-24T08:00:00').toDateString();
  const { stove, events } = setup({ client, saved, config: { pellet_capacity: 10 } });
  await stove.poll();
  await stove.poll();
  assert.deepEqual(
    events.map(([key]) => key),
    ['low_pellets', 'pellet_shutdown'],
  );
  assert.ok(client.sets.some(([path]) => path === 'misc.stop'));
});

test('smoke too hot: an alert after the duration, again only after cooling down', async () => {
  const client = new FakeClient();
  const { stove, clock, events } = setup({ client });
  client.state.operating = { smoke_temp: '380' };
  await stove.poll();
  assert.equal(events.length, 0);
  await clock.advance(31 * 1000);
  await stove.poll();
  assert.deepEqual(events, [['high_smoke_temperature', { temperature: 380 }]]);
  client.state.operating = { smoke_temp: '360' }; // under the threshold, within the hysteresis
  await stove.poll();
  client.state.operating = { smoke_temp: '380' };
  await clock.advance(31 * 1000);
  await stove.poll();
  await stove.poll();
  assert.equal(events.length, 1);
});

test('wood mode: back to pellets with the former level once the fire dies', async () => {
  const client = new FakeClient();
  const { stove } = setup({ client, saved: { auto_resume_wood: true } });
  client.state.operating = { power_pct: '50', state: '5' };
  await stove.poll();
  client.state.operating = { power_pct: '50', state: '9', smoke_temp: '200' };
  await stove.poll();
  assert.deepEqual(client.sets, []);
  client.state.operating = { power_pct: '50', state: '9', smoke_temp: '100' };
  await stove.poll();
  assert.deepEqual(client.sets, [
    ['misc.start', 1],
    ['regulation.operation_mode', 0],
    ['regulation.fixed_power', 50],
  ]);
  client.sets = [];
  await stove.poll();
  assert.deepEqual(client.sets, [], 'resumed once only');
});

test('the resume button refuses outside wood mode', async () => {
  const { stove } = setup();
  await stove.poll();
  await assert.rejects(stove.resumeAfterWood(), /not in wood mode/);
});

test('forced fan: manual mode kept alive, stopped after its duration', async () => {
  const { stove, client, clock } = setup({ config: { force_fan_duration: 50 } });
  await stove.poll();
  await stove.startForced('fan');
  assert.deepEqual(client.sets, [
    ['manual.manual_mode', 1],
    ['manual.output_std', 2],
  ]);
  assert.ok(stove.forced.fan.active);
  await clock.advance(45 * 1000);
  assert.equal(client.sets.filter(([path]) => path === 'manual.keep_alive').length, 2);
  await clock.advance(10 * 1000);
  assert.equal(stove.forced.fan.active, false);
  assert.equal(stove.forced.fan.stopReason, 'timeout');
  assert.deepEqual(client.sets.at(-1), ['manual.manual_mode', 0]);
  assert.equal(clock.pending.length, 0);
});

test('forced fan stops when the smoke gets too hot; forced auger uses output 5', async () => {
  const client = new FakeClient();
  const { stove } = setup({ client });
  await stove.poll();
  await stove.startForced('fan');
  client.state.operating = { smoke_temp: '330' };
  await stove.poll();
  assert.equal(stove.forced.fan.stopReason, 'overheat');
  client.sets = [];
  await stove.startForced('auger');
  assert.deepEqual(client.sets.at(-1), ['manual.output_std', 5]);
  await stove.stopForced('auger');
  assert.equal(stove.forced.auger.stopReason, 'manual');
});

test('commands are refused while the stove is unreachable', async () => {
  const client = new FakeClient();
  client.failing = true;
  const { stove } = setup({ client, config: { cloud_relay: false } });
  await stove.poll();
  await assert.rejects(stove.start(), /unreachable/);
});

test('by default the cloud relay is never used', async () => {
  const client = new FakeClient();
  client.failing = true;
  const { stove } = setup({
    client,
    config: { GLADYS_PREFER_LOCAL: false },
    discover: async () => [],
  });
  await stove.poll();
  assert.notEqual(stove.host, CLOUD_RELAY);
  assert.equal(stove.transport, TRANSPORT.UNREACHABLE);
  assert.ok(client.requests.every((host) => host !== CLOUD_RELAY));
});

test('heat level mode: the level is the chosen one, not the measured one', async () => {
  const client = new FakeClient();
  client.state.fixedPower = 100;
  client.state.operating = { power_pct: '48' }; // measured: level II
  const { stove } = setup({ client });
  await stove.poll();
  assert.equal(stove.data.operating.heat_level, 3);
  assert.equal(stove.data.operating.measured_level, 2);
  client.state.mode = 1; // temperature mode: the stove picks, measured it is
  await stove.poll();
  assert.equal(stove.data.operating.heat_level, 2);
});
