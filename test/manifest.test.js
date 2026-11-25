// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest itself is validated by the store indexer; these tests tie it
// to what the code expects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LIMITS, STOVE_MODELS } from '../src/config.js';
import { NBE_PORT } from '../src/protocol.js';
import { WIDGET } from '../src/widgets.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('../package.json'));

test('the manifest, package.json and the image tag carry the same version', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('config_schema and DEFAULT_CONFIG describe the same keys and defaults', () => {
  const fields = manifest.config_schema.filter((field) => field.type !== 'section');
  assert.deepEqual(fields.map((field) => field.key).sort(), Object.keys(DEFAULT_CONFIG).sort());
  for (const field of fields) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
  }
});

test('every manifest text is bilingual', () => {
  const texts = [manifest.description];
  for (const field of manifest.config_schema) {
    texts.push(field.label, field.description, field.placeholder);
    for (const link of field.links ?? []) {
      texts.push(link.label);
    }
  }
  for (const text of texts.filter(Boolean)) {
    assert.ok(text.en && text.fr, `missing translation in ${JSON.stringify(text)}`);
  }
  for (const text of Object.values(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100);
  }
});

test('the user documentation exists in both languages (300 characters minimum)', async () => {
  for (const language of ['en', 'fr']) {
    assert.ok((await read(`../docs/${language}.md`)).length >= 300);
  }
});

test('the numeric settings have the limits the code applies', () => {
  for (const field of manifest.config_schema.filter((item) => item.type === 'number')) {
    assert.deepEqual([field.min, field.max], LIMITS[field.key], `limits of ${field.key}`);
  }
  const models = manifest.config_schema.find((field) => field.key === 'stove_model');
  assert.deepEqual(
    models.options.map((option) => option.value),
    STOVE_MODELS,
  );
});

test('discovery is declared on the NBE port', () => {
  assert.deepEqual(manifest.network_discovery, [
    { type: 'udp-active-broadcast', ports: [NBE_PORT] },
  ]);
});

test('every scene trigger is fired by the code, and only those', async () => {
  const source = await read('../src/stove.js');
  const fired = new Set([...source.matchAll(/this\.emit\('([a-z_]+)'/g)].map((match) => match[1]));
  const declared = new Set(manifest.scene_triggers.map((trigger) => trigger.key));
  assert.deepEqual([...fired].sort(), [...declared].sort());
  for (const trigger of manifest.scene_triggers) {
    const texts = [trigger.label, ...trigger.fields.map((field) => field.label)];
    texts.push(...trigger.variables.map((variable) => variable.label));
    for (const text of texts) {
      assert.ok(text.en && text.fr, `missing translation in ${trigger.key}`);
    }
    // The bridge adds the device to every event.
    assert.ok(trigger.fields.some((field) => field.key === 'device' && field.source === 'devices'));
  }
});

test('every widget of the manifest has its handlers, and its texts are bilingual', async () => {
  const index = await read('../index.js');
  const keys = manifest.widgets.map((widget) => widget.key).sort();
  assert.deepEqual(keys, Object.values(WIDGET).sort());
  for (const name of Object.keys(WIDGET)) {
    assert.ok(index.includes(`onWidgetGet(WIDGET.${name}`), `onWidgetGet for ${name}`);
  }
  for (const widget of manifest.widgets) {
    const texts = [widget.label];
    for (const setting of widget.settings ?? []) {
      texts.push(setting.label, ...(setting.options ?? []).map((option) => option.label));
    }
    for (const text of texts) {
      assert.ok(text.en && text.fr, `missing translation in widget ${widget.key}`);
    }
  }
});
