// -----------------------------------------------------------------------------
// What must survive a restart: the pellet counters (the stove only knows its
// consumption, not what is left in the hopper) and the switches the user set
// on the device. One JSON file under /data, the only writable volume.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

export const DEFAULT_STATE = {
  // kg consumed since the last refill / since the last cleaning.
  pellets_consumed: 0,
  pellets_consumed_total: 0,
  // Last "today" consumption read, the baseline of the next increment.
  last_day_consumption: null,
  auto_shutdown: false,
  auto_resume_wood: false,
};

export class Store {
  constructor(directory = '/data') {
    this.path = join(directory, 'state.json');
    this.directory = directory;
    this.writing = Promise.resolve();
  }

  async load() {
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8'));
      return { ...DEFAULT_STATE, ...saved };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Unreadable ${this.path}, starting from scratch: ${err.message}`);
      }
      return { ...DEFAULT_STATE };
    }
  }

  /** Write atomically (temporary file + rename), one write at a time. */
  save(state) {
    const run = async () => {
      await mkdir(this.directory, { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
      await rename(temporary, this.path);
    };
    this.writing = this.writing.then(run, run).catch((err) => {
      logger.error(`Saving ${this.path} failed: ${err.message}`);
    });
    return this.writing;
  }
}
