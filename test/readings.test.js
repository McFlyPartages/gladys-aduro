import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  heatLevelFromPower,
  parseConsumption,
  parseNetwork,
  parseOperating,
  parseStatus,
  stateLabel,
  substateLabel,
} from '../src/readings.js';
import {
  NETWORK_PAYLOAD,
  daysPayload,
  monthsPayload,
  operatingPayload,
  statusPayload,
} from './fixtures.js';

test('operating values are read at their positions', () => {
  const operating = parseOperating(operatingPayload({ power_pct: '100', state: '32' }));
  assert.equal(operating.boiler_temp, 21.5);
  assert.equal(operating.boiler_ref, 22);
  assert.equal(operating.state, '32');
  assert.equal(operating.substate, '5');
  assert.equal(operating.power_kw, 4.5);
  assert.equal(operating.heat_level, 3);
  assert.equal(operating.smoke_temp, 180);
  assert.equal(operating.shaft_temp, 60);
  assert.equal(operating.carbon_monoxide, 12);
  assert.equal(operating.operating_time_stove, 72000);
  assert.throws(() => parseOperating('1,2,3'), /too short/);
});

test('the heat level comes from an approximate power percentage', () => {
  assert.deepEqual([9, 30, 31, 52, 75, 76, 100].map(heatLevelFromPower), [1, 1, 2, 2, 2, 3, 3]);
});

test('status values are read at their positions', () => {
  assert.deepEqual(parseStatus(statusPayload({ mode: 1, total: 99.5, fixedPower: 50 })), {
    consumption_total: 99.5,
    operation_mode: 1,
    fixed_power: 50,
  });
});

test('network values are read', () => {
  assert.deepEqual(parseNetwork(NETWORK_PAYLOAD), {
    ssid: 'MyWifi',
    ip: '192.168.60.50',
    router_ip: '192.168.60.1',
    rssi: -61,
    mac: 'AA:BB:CC:DD:EE:FF',
  });
});

test('consumption: today, yesterday, this month and the year to date', () => {
  const days = new Array(31).fill(0);
  days[23] = 3.2; // the 24th
  days[22] = 5.1; // the 23rd
  const months = [10, 8, 6, 1, 0.002, 0, 0, 0, 0, 2, 30, 40]; // December is last year's
  const consumption = parseConsumption(
    { days: daysPayload(days), months: monthsPayload(months) },
    new Date('2026-11-24T10:00:00'),
  );
  const { per_day: perDay, per_month: perMonth, ...totals } = consumption;
  assert.deepEqual(totals, { day: 3.2, yesterday: 5.1, month: 30, year: 57 });
  assert.equal(perDay.length, 31);
  assert.deepEqual(perMonth, months);
});

test('on the 1st, yesterday is the last day of the previous month', () => {
  const days = new Array(31).fill(0);
  days[0] = 1;
  days[30] = 7;
  const consumption = parseConsumption(
    { days: daysPayload(days), months: monthsPayload(new Array(12).fill(0)) },
    new Date('2026-11-01T10:00:00'),
  );
  assert.equal(consumption.day, 1);
  assert.equal(consumption.yesterday, 7);
});

test('state labels, in English and French', () => {
  assert.equal(stateLabel('5', 2, 'en'), 'Power II');
  assert.equal(stateLabel('5', 3, 'fr'), 'Puissance III');
  assert.equal(stateLabel('14', 1, 'fr'), 'Éteint');
  assert.equal(stateLabel('99', 1, 'en'), 'Unknown state (99)');
});

test('substate labels, with the timer and the state-14 special case', () => {
  assert.equal(substateLabel('14', '0', 'en'), 'By button');
  assert.equal(substateLabel('14', '1', 'fr'), 'Combustion du bois ?');
  assert.equal(substateLabel('2', '0', 'en', 125), 'Ignition (02:05)');
  assert.equal(substateLabel('77', '3', 'en'), 'Unknown (77/3)');
});
