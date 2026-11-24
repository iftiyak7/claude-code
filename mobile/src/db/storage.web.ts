/**
 * Web fallback (used by the browser build at app.tadbeerdaily.com and for
 * previews). Same contract as the SQLite store, backed by localStorage.
 */
import type { Rec } from '@/domain/types';
import type { Storage, StoredRow } from './types';

const KEY = 'tadbeer.records.v1';
const KV = 'tadbeer.kv.';

type Row = { c: string; d: Rec; dirty: boolean };
let rows: Record<string, Row> = {};

function safeGet(k: string): string | null {
  try {
    return globalThis.localStorage?.getItem(k) ?? null;
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    globalThis.localStorage?.setItem(k, v);
  } catch {
    /* storage full / blocked — keep in memory */
  }
}

try {
  rows = JSON.parse(safeGet(KEY) ?? '{}');
} catch {
  rows = {};
}

let t: ReturnType<typeof setTimeout> | null = null;
const persist = () => {
  if (t) return;
  t = setTimeout(() => {
    t = null;
    safeSet(KEY, JSON.stringify(rows));
  }, 50);
};

export const storage: Storage = {
  loadAll: (): StoredRow[] => Object.values(rows).map((r) => ({ collection: r.c, data: r.d })),
  put(collection, rec, dirty) {
    const k = `${collection}/${rec.id}`;
    const cur = rows[k];
    if (cur && cur.d.updatedAt > rec.updatedAt) return;
    rows[k] = { c: collection, d: rec, dirty };
    persist();
  },
  dirty: (limit) =>
    Object.values(rows)
      .filter((r) => r.dirty)
      .slice(0, limit)
      .map((r) => ({ collection: r.c, data: r.d })),
  markClean(items) {
    for (const it of items) {
      const r = rows[`${it.collection}/${it.id}`];
      if (r && r.d.updatedAt === it.updatedAt) r.dirty = false;
    }
    persist();
  },
  markAllDirty() {
    for (const r of Object.values(rows)) r.dirty = true;
    persist();
  },
  kvGet: (key) => safeGet(KV + key),
  kvSet: (key, value) => safeSet(KV + key, value),
  wipe() {
    rows = {};
    safeSet(KEY, '{}');
  },
};
