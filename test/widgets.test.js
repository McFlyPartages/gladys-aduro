import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { Bridge } from '../src/bridge.js';
import { normalizeConfig } from '../src/config.js';
import { DEVICE_TYPE, FEATURE } from '../src/device.js';
import {
  IMAGE_KEYS,
  WIDGET,
  consumptionPoints,
  loadImage,
  pictureOf,
  statsWidget,
  stoveWidget,
} from '../src/widgets.js';
import { FakeClient, FakeClock, MemoryStore, PIN, SERIAL } from './fixtures.js';

const CONFIG = { stove_serial: SERIAL, stove_pin: PIN, stove_ip: '192.168.60.50' };

async function setup(client = new FakeClient()) {
  const gladys = createFakeGladys();
  await gladys.connect();
  const clock = new FakeClock();
  const bridge = new Bridge(gladys, {
    createClient: () => client,
    store: new MemoryStore(),
    timers: clock.timers,
    now: clock.now,
    sleep: clock.sleep,
  });
  const config = normalizeConfig(CONFIG);
  await bridge.start(config);
  gladys.onWidgetGet(WIDGET.STOVE, (options) => bridge.widget(WIDGET.STOVE, options));
  gladys.onWidgetGet(WIDGET.STATS, (options) => bridge.widget(WIDGET.STATS, options));
  gladys.onWidgetAction(WIDGET.STOVE, (key) => bridge.widgetAction(key));
  return { gladys, bridge, client, config, clock, ids: gladys.externalIds(DEVICE_TYPE, SERIAL) };
}

const byType = (content, type) => content.components.filter((component) => component.type === type);

test('the picture follows the stove: off, flame I to III, logs in wood mode', () => {
  assert.equal(pictureOf(null), 'off');
  assert.equal(pictureOf({ state: '14', heat_level: 3 }), 'off');
  assert.equal(pictureOf({ state: '2', heat_level: 3 }), 'ignition');
  assert.equal(pictureOf({ state: '4', heat_level: 3 }), 'ignition');
  assert.equal(pictureOf({ state: '6', heat_level: 2 }), 'off');
  assert.equal(pictureOf({ state: '5', heat_level: 2 }), 'l2');
  assert.equal(pictureOf({ state: '32', heat_level: 3 }), 'l3');
  assert.equal(pictureOf({ state: '9', heat_level: 1 }), 'wood');
});

test('every picture exists, animated, within the core limits', async () => {
  for (const [key, file] of Object.entries(IMAGE_KEYS)) {
    const base64 = await loadImage(key);
    assert.deepEqual(validateWidgetImage(base64), [], file);
    const bytes = await readFile(new URL(`../assets/${file}`, import.meta.url));
    if (!file.includes('off')) {
      assert.ok(bytes.includes(Buffer.from('ANIM')), `${file} is animated`);
    }
  }
  await assert.rejects(loadImage('../../etc/passwd'), /Unknown image/);
});

test('stove widget: picture, fire and room tiles, state, four buttons, within budget', async () => {
  const { gladys, ids } = await setup();
  const { success, data } = await gladys.fake.widgetGet(WIDGET.STOVE, { language: 'fr' });
  assert.ok(success);
  const content = data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(byType(content, 'image')[0].key, 'stove-l2-v2');
  assert.deepEqual(
    byType(content, 'value').map((tile) => tile.device_feature),
    [ids.feature(FEATURE.SMOKE_TEMPERATURE), ids.feature(FEATURE.ROOM_TEMPERATURE)],
  );
  assert.equal(byType(content, 'status')[0].items[0].value, 'Puissance II');
  const buttons = byType(content, 'button');
  assert.deepEqual(
    buttons.map((button) => button.label),
    ['Éteindre le poêle', 'Petite flamme', 'Flamme moyenne', 'Grande flamme'],
  );
  assert.equal(buttons[0].action.confirm, true);
  assert.deepEqual(
    buttons.slice(1).map((button) => button.style),
    ['secondary', 'primary', 'secondary'],
  );
});

test('stove widget buttons drive the stove', async () => {
  const { gladys, client } = await setup();
  const flame = await gladys.fake.widgetAction(WIDGET.STOVE, 'level_3', {});
  assert.equal(flame.success, true);
  assert.deepEqual(client.sets.slice(-2), [
    ['regulation.operation_mode', 0],
    ['regulation.fixed_power', 100],
  ]);
  await gladys.fake.widgetAction(WIDGET.STOVE, 'stop_stove', {});
  assert.deepEqual(client.sets.at(-1), ['misc.stop', 1]);
  await gladys.fake.widgetAction(WIDGET.STOVE, 'start_stove', {});
  assert.deepEqual(client.sets.at(-1), ['misc.start', 1]);
  const unknown = await gladys.fake.widgetAction(WIDGET.STOVE, 'turbo', {});
  assert.equal(unknown.success, false);
});

test('a stopped stove offers to start; wood mode shows the logs', async () => {
  const client = new FakeClient();
  client.state.operating = { state: '14', substate: '0' };
  const { bridge, config, gladys } = await setup(client);
  let content = stoveWidget(gladys, bridge.stove, config, 'en');
  assert.equal(byType(content, 'button')[0].label, 'Start the stove');
  assert.equal(byType(content, 'button')[0].action.key, 'start_stove');
  assert.equal(byType(content, 'image')[0].key, 'stove-off-v2');
  client.state.operating = { state: '9', smoke_temp: '250' };
  await bridge.pollOnce();
  content = stoveWidget(gladys, bridge.stove, config, 'en');
  assert.equal(byType(content, 'image')[0].key, 'stove-wood-v2');
});

test('the stove widget is refreshed when its look changes, not on every poll', async () => {
  const client = new FakeClient();
  const { gladys, bridge } = await setup(client);
  const calls = [];
  gladys.requestWidgetRefresh = (key) => calls.push(key);
  await bridge.pollOnce();
  assert.deepEqual(calls, []);
  client.state.operating = { state: '9', smoke_temp: '250' };
  await bridge.pollOnce();
  assert.deepEqual(calls, ['stove']);
});

test('stats widget: tiles, chart, status, within budget', async () => {
  const client = new FakeClient();
  client.state.days[23] = 4.2;
  client.state.months[10] = 60;
  const { gladys } = await setup(client);
  for (const period of ['days', 'months']) {
    const { data } = await gladys.fake.widgetGet(WIDGET.STATS, {
      language: 'fr',
      settings: { period },
    });
    assert.deepEqual(validateWidgetContent(data.content), [], period);
    assert.equal(byType(data.content, 'chart').length, 1);
    assert.equal(byType(data.content, 'status')[0].items.length, 9);
  }
});

test('an unreachable stove gets a simple widget', async () => {
  const gladys = createFakeGladys();
  const content = stoveWidget(gladys, null, normalizeConfig(CONFIG), 'en');
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(validateWidgetContent(statsWidget(gladys, null, {}, 'en')), []);
});

test('chart points: this month up to today, the rest from last month, in order', () => {
  const perDay = Array.from({ length: 31 }, (_, index) => index + 1);
  const points = consumptionPoints(
    { per_day: perDay, per_month: [] },
    new Date('2026-03-03T12:00:00'),
    'days',
  );
  // February 2026 has 28 days: days 4 to 28 are February's, 29 to 31 dropped.
  assert.equal(points.length, 28);
  assert.deepEqual(points[0], { t: '2026-02-04', v: 4 });
  assert.deepEqual(points.at(-1), { t: '2026-03-03', v: 3 });

  const months = consumptionPoints(
    { per_day: [], per_month: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0.002] },
    new Date('2026-11-24T12:00:00'),
    'months',
  );
  assert.deepEqual(months[0], { t: '2025-12-01', v: 0 });
  assert.deepEqual(months.at(-1), { t: '2026-11-01', v: 11 });
});
