// -----------------------------------------------------------------------------
// What the integration remembers across restarts, in /data/state.json (mode
// 0600, the only writable place of the container):
//   - `snapshots`: per Danfoss device, the values the scene triggers compare
//     (online, window, mode, fault, battery low);
//   - `external`: per Danfoss device, when an external temperature was last
//     sent (a radiator thermostat takes one every 5 minutes at most).
// A missing or unreadable file is an empty state: nothing fires on the first
// reading, the next ones compare to it.
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_PATH = '/data/state.json';

/**
 * @description Create the store.
 * @param {object} [options] - Options.
 * @param {string|null} [options.path] - The file (null: memory only, tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} The store.
 */
function createState({ path = DEFAULT_PATH, logger = null } = {}) {
  let data = { snapshots: {}, external: {} };
  let dirty = false;

  if (path) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      data = {
        snapshots:
          parsed?.snapshots && typeof parsed.snapshots === 'object' ? parsed.snapshots : {},
        external: parsed?.external && typeof parsed.external === 'object' ? parsed.external : {},
      };
    } catch (err) {
      if (err.code !== 'ENOENT') logger?.warn(`Unreadable ${path}, starting afresh`);
    }
  }

  return {
    snapshot: (id) => data.snapshots[id] ?? null,
    setSnapshot(id, snapshot) {
      if (JSON.stringify(data.snapshots[id]) === JSON.stringify(snapshot)) return;
      data.snapshots[id] = snapshot;
      dirty = true;
    },
    externalSentAt: (id) => data.external[id] ?? 0,
    setExternalSentAt(id, at) {
      data.external[id] = at;
      dirty = true;
    },
    /**
     * @description Drop the devices Danfoss no longer lists.
     * @param {string[]} ids - The ids to keep.
     */
    keep(ids) {
      const wanted = new Set(ids);
      for (const bucket of [data.snapshots, data.external]) {
        for (const id of Object.keys(bucket)) {
          if (!wanted.has(id)) {
            delete bucket[id];
            dirty = true;
          }
        }
      }
    },
    /** @description Write the file when something changed (atomically). */
    save() {
      if (!dirty || !path) return;
      try {
        mkdirSync(dirname(path), { recursive: true });
        const temporary = `${path}.tmp`;
        writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
        renameSync(temporary, path);
        dirty = false;
      } catch (err) {
        logger?.warn(`Unable to write ${path}: ${err.message}`);
      }
    },
  };
}

export { DEFAULT_PATH, createState };
