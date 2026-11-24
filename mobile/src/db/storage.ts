/**
 * Native persistence — a single SQLite file on device. Everything the app
 * needs lives here, so the app is 100% usable offline. Writes are queued and
 * flushed in one transaction per tick to keep the UI thread free.
 */
import * as SQLite from 'expo-sqlite';
import type { Storage, StoredRow } from './types';

const db = SQLite.openDatabaseSync('tadbeer.db');

db.execSync(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS records (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    dirty INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (collection, id)
  );
  CREATE INDEX IF NOT EXISTS records_dirty ON records(dirty) WHERE dirty = 1;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
`);

type Pending = { collection: string; id: string; data: string; updatedAt: number; dirty: number };
let queue: Pending[] = [];
let scheduled = false;

function flush() {
  scheduled = false;
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  db.withTransactionSync(() => {
    for (const p of batch) {
      db.runSync(
        `INSERT INTO records (collection, id, data, updated_at, dirty) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, dirty = excluded.dirty
         WHERE excluded.updated_at >= records.updated_at`,
        p.collection,
        p.id,
        p.data,
        p.updatedAt,
        p.dirty,
      );
    }
  });
}

export const storage: Storage = {
  loadAll(): StoredRow[] {
    flush();
    return db
      .getAllSync<{ collection: string; data: string }>('SELECT collection, data FROM records')
      .map((r) => ({ collection: r.collection, data: JSON.parse(r.data) }));
  },

  put(collection, rec, dirty) {
    queue.push({ collection, id: rec.id, data: JSON.stringify(rec), updatedAt: rec.updatedAt, dirty: dirty ? 1 : 0 });
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 0);
    }
  },

  dirty(limit) {
    flush();
    return db
      .getAllSync<{ collection: string; data: string }>(
        'SELECT collection, data FROM records WHERE dirty = 1 LIMIT ?',
        limit,
      )
      .map((r) => ({ collection: r.collection, data: JSON.parse(r.data) }));
  },

  markClean(items) {
    flush();
    db.withTransactionSync(() => {
      for (const it of items) {
        // only clear if nothing changed locally since we pushed
        db.runSync(
          'UPDATE records SET dirty = 0 WHERE collection = ? AND id = ? AND updated_at = ?',
          it.collection,
          it.id,
          it.updatedAt,
        );
      }
    });
  },

  markAllDirty() {
    flush();
    db.runSync('UPDATE records SET dirty = 1');
  },

  kvGet(key) {
    return db.getFirstSync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)?.value ?? null;
  },

  kvSet(key, value) {
    db.runSync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  },

  wipe() {
    queue = [];
    db.execSync('DELETE FROM records; DELETE FROM kv;');
  },
};
