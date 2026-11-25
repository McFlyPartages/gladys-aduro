import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_STATE, Store } from '../src/store.js';

test('the state survives a restart, and a missing or broken file means defaults', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gladys-aduro-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  assert.deepEqual(await store.load(), DEFAULT_STATE);

  await store.save({ ...DEFAULT_STATE, pellets_consumed: 3.5, auto_shutdown: true });
  const loaded = await new Store(directory).load();
  assert.equal(loaded.pellets_consumed, 3.5);
  assert.equal(loaded.auto_shutdown, true);
  assert.ok(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')));

  await writeFile(join(directory, 'state.json'), '{broken');
  assert.deepEqual(await new Store(directory).load(), DEFAULT_STATE);
});
