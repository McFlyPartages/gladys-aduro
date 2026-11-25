import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { Bridge, FAST_POLL_INTERVAL_MS, MESSAGES, POLL_INTERVAL_MS } from '../src/bridge.js';
import { normalizeConfig } from '../src/config.js';
import { DEVICE_TYPE, FEATURE } from '../src/device.js';
import { FakeClient, FakeClock, MemoryStore, PIN, SERIAL } from './fixtures.js';

const CONFIG = { stove_serial: SERIAL, stove_pin: PIN, stove_ip: '192.168.60.50', language: 'fr' };

async function setup({
  config = CONFIG,
  client = new FakeClient(),
  store = new MemoryStore(),
} = {}) {
  const gladys = createFakeGladys();
  await gladys.connect();
  const clock = new FakeClock();
  const bridge = new Bridge(gladys, {
    createClient: () => client,
    store,
    timers: clock.timers,
    now: clock.now,
    sleep: clock.sleep,
  });
  await bridge.start(normalizeConfig(config));
  const ids = gladys.externalIds(DEVICE_TYPE, SERIAL);
  const state = (key) => gladys.fake.lastState(ids.feature(key));
  return { gladys, bridge, clock, client, store, ids, state };
}

test('without serial and PIN the integration asks for them', async () => {
  const { gladys } = await setup({ config: {} });
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: MESSAGES.notConfigured,
  });
  assert.deepEqual(gladys.fake.discoveredDevices, []);
});

test('the stove is published with its features, states and transport', async () => {
  const { gladys, ids, state } = await setup();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, ids.device);
  assert.equal(device.name, 'Aduro H2');
  assert.equal(device.features.length, Object.keys(FEATURE).length);
  assert.ok(
    device.params.some(
      ({ name, value }) => name === 'MAC_ADDRESS' && value === 'AA:BB:CC:DD:EE:FF',
    ),
  );
  const power = device.features.find(
    (feature) => feature.external_id === ids.feature(FEATURE.POWER),
  );
  assert.equal(power.name, 'Marche');

  assert.equal(state(FEATURE.POWER), 1);
  assert.equal(state(FEATURE.ROOM_TEMPERATURE), 21.5);
  assert.equal(state(FEATURE.TARGET_TEMPERATURE), 22);
  assert.equal(state(FEATURE.HEAT_LEVEL), '2');
  assert.equal(state(FEATURE.OPERATION_MODE), 'heat_level');
  assert.equal(state(FEATURE.STATE), 'Puissance II');
  assert.equal(state(FEATURE.OPERATING_TIME), 20);
  assert.equal(state(FEATURE.CONSUMPTION_TOTAL), 1234.5);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: ids.device,
    transport: 'local',
  });
});

test('polling every 45 s, every 5 s after a command', async () => {
  const { bridge, client, clock, ids } = await setup();
  const before = client.requests.length;
  await clock.advance(POLL_INTERVAL_MS);
  assert.ok(client.requests.length > before);

  await bridge.setValue({ external_id: ids.feature(FEATURE.TARGET_TEMPERATURE) }, 24);
  assert.deepEqual(client.sets.at(-1), ['boiler.temp', 24]);
  const afterCommand = client.requests.length;
  await clock.advance(FAST_POLL_INTERVAL_MS);
  assert.ok(client.requests.length > afterCommand);
});

test('heat level, mode, switches and buttons', async () => {
  const { bridge, client, ids, state } = await setup();
  const set = (key, value) => bridge.setValue({ external_id: ids.feature(key) }, value);

  await set(FEATURE.HEAT_LEVEL, '3');
  assert.deepEqual(client.sets.slice(-2), [
    ['regulation.operation_mode', 0],
    ['regulation.fixed_power', 100],
  ]);
  await set(FEATURE.OPERATION_MODE, 'temperature');
  assert.deepEqual(client.sets.at(-1), ['regulation.operation_mode', 1]);
  await assert.rejects(set(FEATURE.OPERATION_MODE, 'turbo'), /Unknown operation mode/);

  await set(FEATURE.POWER, 0);
  assert.deepEqual(client.sets.at(-1), ['misc.stop', 1]);

  await set(FEATURE.AUTO_SHUTDOWN, 1);
  assert.equal(state(FEATURE.AUTO_SHUTDOWN), 1);
  await set(FEATURE.RESET_ALARM, 1);
  assert.deepEqual(client.sets.at(-1), ['misc.reset_alarm', 1]);
  await assert.rejects(
    bridge.setValue({ external_id: `${ids.device}:nope` }, 1),
    /Unknown feature/,
  );
});

test('a command longer than the ack deadline is acknowledged and goes on', async () => {
  const client = new FakeClient();
  const { bridge, ids, clock } = await setup({ client });
  // A real sleep for the 3 s step, so the deadline timer wins the race.
  let release;
  bridge.stove.sleep = () => new Promise((resolve) => (release = resolve));
  const pending = bridge.setValue({ external_id: ids.feature(FEATURE.HEAT_LEVEL) }, '1');
  await new Promise((resolve) => setImmediate(resolve));
  await clock.advance(4000);
  await pending;
  assert.deepEqual(client.sets.at(-1), ['regulation.operation_mode', 0]);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(client.sets.at(-1), ['regulation.fixed_power', 10]);
});

test('an unreachable stove: status, badge, and no device', async () => {
  const client = new FakeClient();
  client.failing = true;
  const { gladys } = await setup({ client, config: { ...CONFIG, cloud_relay: false } });
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: MESSAGES.unreachable,
  });
  assert.deepEqual(gladys.fake.discoveredDevices, []);
});

test('alerts become scene events carrying the device', async () => {
  const client = new FakeClient();
  const { gladys, bridge, ids } = await setup({ client });
  client.state.operating = { state: '20' };
  await bridge.pollOnce();
  assert.deepEqual(gladys.fake.sceneEvents.at(-1), {
    key: 'stove_fault',
    data: { device: ids.device, state_code: 20, state_label: 'Arrêté' },
  });
});

test('states are replayed once the user created the device', async () => {
  const { gladys, bridge, ids } = await setup();
  const count = gladys.fake.states.length;
  await bridge.replayStates();
  assert.ok(gladys.fake.states.length > count);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: ids.device,
    transport: 'local',
  });
});

test('thresholds and language apply without a new session', async () => {
  const { bridge, client, state } = await setup();
  const requests = client.requests.length;
  await bridge.update(normalizeConfig({ ...CONFIG, language: 'en', pellet_capacity: 20 }));
  assert.equal(client.requests.length, requests);
  assert.equal(state(FEATURE.STATE), 'Power II');
  assert.equal(state(FEATURE.PELLETS_REMAINING), 20);
});

test('a poll asked during another one waits for it instead of overlapping', async () => {
  const { bridge, client } = await setup();
  const before = client.requests.length;
  await Promise.all([bridge.pollOnce(), bridge.pollOnce()]);
  assert.equal(client.requests.length - before, 2, 'status + operating, once');
});
