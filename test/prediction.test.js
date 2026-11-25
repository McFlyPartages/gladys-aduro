import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEARNING, Learner, predictionText } from '../src/prediction.js';

const MINUTE = 60 * 1000;
const START = new Date('2026-11-24T10:00:00Z').getTime();

/**
 * Burn at `level` for `minutes`, `kgPerHour`, the consumption arriving every
 * 5 minutes like the stove's reads.
 */
function burn(learner, { level, minutes, kgPerHour, from, state = '5' }) {
  let now = from;
  for (let elapsed = 0; elapsed < minutes; elapsed += 5) {
    learner.observe({ state, heatLevel: level, mode: 0, now });
    now += 5 * MINUTE;
    learner.addConsumption((kgPerHour * 5) / 60);
  }
  learner.observe({ state, heatLevel: level, mode: 0, now });
  return now;
}

test('the rate of a level is learned from 30-minute periods', () => {
  const learner = new Learner();
  burn(learner, { level: 2, minutes: 120, kgPerHour: 0.8, from: START });
  const learned = learner.data.levels[2];
  assert.equal(Math.round(learned.hours * 10) / 10, 2);
  assert.equal(Math.round(learned.kg * 100) / 100, 1.6);
  assert.equal(Math.round(learner.rate(2) * 100) / 100, 0.8);
  assert.equal(learner.rate(1), null);
});

test('a short period is ignored, a level change after 15 minutes is kept', () => {
  const learner = new Learner();
  let now = burn(learner, { level: 1, minutes: 10, kgPerHour: 0.4, from: START });
  now = burn(learner, { level: 3, minutes: 20, kgPerHour: 1.2, from: now });
  learner.observe({ state: '5', heatLevel: 2, mode: 0, now });
  assert.equal(learner.data.levels[1].hours, 0);
  assert.ok(learner.data.levels[3].hours > 0.3);
});

test('a period without consumption is not learned', () => {
  const learner = new Learner();
  burn(learner, { level: 2, minutes: 60, kgPerHour: 0, from: START });
  assert.equal(learner.data.levels[2].hours, 0);
});

test('an ignition is learned from the start-up states to state 5', () => {
  const learner = new Learner();
  learner.observe({ state: '2', heatLevel: 2, mode: 0, now: START });
  learner.addConsumption(0.1);
  learner.observe({ state: '4', heatLevel: 2, mode: 0, now: START + 5 * MINUTE });
  learner.addConsumption(0.08);
  learner.observe({ state: '5', heatLevel: 2, mode: 0, now: START + 10 * MINUTE });
  assert.equal(learner.data.startup.count, 1);
  assert.equal(Math.round(learner.startupKg * 100) / 100, 0.18);
});

test('wood mode drops the running periods', () => {
  const learner = new Learner();
  learner.observe({ state: '5', heatLevel: 2, mode: 0, now: START });
  learner.observe({ state: '9', heatLevel: 2, mode: 2, now: START + 40 * MINUTE });
  assert.equal(learner.period, null);
});

test('prediction: learning first, then pellets / rate, an ignition when off', () => {
  const learner = new Learner();
  const situation = { mode: 0, state: '5', heatLevel: 2, pelletsLeft: 8, now: START };
  assert.deepEqual(learner.predict(situation), { status: 'learning', learnedHours: 0 });

  burn(learner, { level: 2, minutes: 180, kgPerHour: 1, from: START - 200 * MINUTE });
  const burning = learner.predict(situation);
  assert.equal(burning.status, 'ok');
  assert.equal(burning.hours, 8);
  assert.equal(burning.at, START + 8 * 3600 * 1000);
  assert.equal(burning.confidence, 'medium');

  const off = learner.predict({ ...situation, state: '14' });
  assert.ok(Math.abs(off.hours - 7.85) <= 0.05, `${off.hours}`); // 8 kg - 0.15 kg default ignition
  const reserved = learner.predict({ ...situation, reserve: 2 });
  assert.equal(reserved.hours, 6);
  assert.equal(learner.predict({ ...situation, pelletsLeft: 0.1, state: '14' }).status, 'empty');
});

test('prediction: high confidence after 10 recent hours, none outside heat level mode', () => {
  const learner = new Learner();
  burn(learner, { level: 3, minutes: 10 * 60, kgPerHour: 1.2, from: START });
  const now = START + 10 * 3600 * 1000;
  const situation = { mode: 0, state: '5', heatLevel: 3, pelletsLeft: 6, now };
  assert.equal(learner.predict(situation).confidence, 'high');
  const old = { ...situation, now: now + (LEARNING.RECENT_DAYS + 1) * 24 * 3600 * 1000 };
  assert.equal(learner.predict(old).confidence, 'medium');
  assert.deepEqual(learner.predict({ ...situation, mode: 1 }), { status: 'temperature_mode' });
  assert.deepEqual(learner.predict({ ...situation, mode: 2 }), { status: 'wood_mode' });
});

test('what was learned survives a restart', () => {
  const learner = new Learner();
  burn(learner, { level: 1, minutes: 150, kgPerHour: 0.4, from: START });
  const reloaded = new Learner(JSON.parse(JSON.stringify(learner.data)));
  assert.equal(reloaded.rate(1), learner.rate(1));
});

test('texts of the prediction feature', () => {
  const at = new Date('2026-11-25T22:30:00Z').getTime();
  const ok = { status: 'ok', hours: 12, at, confidence: 'high' };
  assert.equal(predictionText(ok, 'fr', 2, 'Europe/Paris'), 'mer. 25 nov., 23:30 (fiable)');
  assert.equal(predictionText(ok, 'en', 2, 'Europe/Paris'), 'Wed 25 Nov, 23:30 (reliable)');
  assert.equal(
    predictionText({ status: 'learning', learnedHours: 0.5 }, 'fr', 2),
    'Apprentissage (0.5 h sur 2 h à la puissance II)',
  );
  assert.equal(
    predictionText({ status: 'temperature_mode' }, 'en', 1),
    'Not available in temperature mode',
  );
});
