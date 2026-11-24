/**
 * Single source of truth for app state. Reads are synchronous from memory
 * (instant UI); every mutation is written through to on-device storage and
 * flagged dirty for the sync engine. No network is ever needed to use the app.
 */
import { randomUUID } from 'expo-crypto';
import { create } from 'zustand';
import { storage } from '@/db/storage';
import { DEFAULT_SETTINGS, seedAmals } from '@/domain/defaults';
import { today } from '@/domain/dates';
import { logId } from '@/domain/progress';
import type { CollectionName, Collections, ISODate, Log, LogRef, Rec, Settings } from '@/domain/types';
import { COLLECTIONS } from '@/domain/types';

type Maps = { [K in CollectionName]: Record<string, Collections[K]> };

interface DataState extends Maps {
  ready: boolean;
  settings: Settings;
  /** Bumped on every mutation; the notification scheduler listens to it. */
  rev: number;

  hydrate(): void;
  upsert<K extends CollectionName>(c: K, rec: Omit<Collections[K], 'id' | 'updatedAt'> & { id?: string }): Collections[K];
  remove(c: CollectionName, id: string): void;
  /** Add `delta` to a day log (clamped at 0). Returns the new count. */
  bump(ref: LogRef, refId: string, delta: number, date?: ISODate, slot?: string): number;
  setCount(ref: LogRef, refId: string, count: number, date?: ISODate, slot?: string): void;
  toggleTask(id: string): void;
  updateSettings(patch: Partial<Settings>): void;
  /** Merge records pulled from the server (last-write-wins on updatedAt). */
  applyRemote(rows: { collection: string; data: Rec }[]): void;
  wipeLocal(): void;
}

const SETTINGS_KEY = 'settings';

const emptyMaps = (): Maps => ({ amals: {}, tasks: {}, reminders: {}, medicines: {}, routines: {}, logs: {} });

/** Strictly increasing per record so a newer local edit always wins. */
const nextStamp = (prev?: number) => Math.max(Date.now(), (prev ?? 0) + 1);

export const useData = create<DataState>()((set, get) => ({
  ...emptyMaps(),
  ready: false,
  settings: DEFAULT_SETTINGS,
  rev: 0,

  hydrate() {
    const maps = emptyMaps();
    const rows = storage.loadAll();
    for (const r of rows) {
      const c = r.collection as CollectionName;
      if (COLLECTIONS.includes(c)) (maps[c] as Record<string, Rec>)[r.data.id] = r.data;
    }
    let settings = DEFAULT_SETTINGS;
    const raw = storage.kvGet(SETTINGS_KEY);
    if (raw) {
      try {
        settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      } catch {
        /* corrupt settings → defaults */
      }
    }
    if (rows.length === 0 && !storage.kvGet('seeded')) {
      for (const a of seedAmals()) {
        maps.amals[a.id] = a;
        storage.put('amals', a, true);
      }
      storage.kvSet('seeded', '1');
    }
    set({ ...maps, settings, ready: true, rev: get().rev + 1 });
  },

  upsert(c, input) {
    const map = get()[c] as Record<string, Rec>;
    const id = input.id ?? randomUUID();
    const prev = map[id];
    const rec = { ...(prev ?? {}), ...input, id, updatedAt: nextStamp(prev?.updatedAt), deleted: false } as Collections[typeof c];
    storage.put(c, rec, true);
    set({ [c]: { ...map, [id]: rec }, rev: get().rev + 1 } as Partial<DataState>);
    return rec;
  },

  remove(c, id) {
    const map = get()[c] as Record<string, Rec>;
    const prev = map[id];
    if (!prev) return;
    const rec = { ...prev, deleted: true, updatedAt: nextStamp(prev.updatedAt) };
    storage.put(c, rec, true);
    set({ [c]: { ...map, [id]: rec }, rev: get().rev + 1 } as Partial<DataState>);
  },

  bump(ref, refId, delta, date = today(), slot) {
    const id = logId(date, ref, refId, slot);
    const prev = get().logs[id];
    const base = prev && !prev.deleted ? prev.count : 0;
    const count = Math.max(0, base + delta);
    get().setCount(ref, refId, count, date, slot);
    return count;
  },

  setCount(ref, refId, count, date = today(), slot) {
    const id = logId(date, ref, refId, slot);
    const logs = get().logs;
    const prev = logs[id];
    const rec: Log = { id, date, ref, refId, slot, count, updatedAt: nextStamp(prev?.updatedAt), deleted: false };
    storage.put('logs', rec, true);
    set({ logs: { ...logs, [id]: rec }, rev: get().rev + 1 });
  },

  toggleTask(id) {
    const t = get().tasks[id];
    if (!t) return;
    const done = !t.done;
    get().upsert('tasks', { ...t, done, doneAt: done ? Date.now() : undefined });
  },

  updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    storage.kvSet(SETTINGS_KEY, JSON.stringify(settings));
    set({ settings, rev: get().rev + 1 });
  },

  applyRemote(rows) {
    if (rows.length === 0) return;
    const s = get();
    const next: Partial<Maps> = {};
    for (const { collection, data } of rows) {
      const c = collection as CollectionName;
      if (!COLLECTIONS.includes(c) || !data?.id) continue;
      const cur = (next[c] ?? s[c])[data.id] as Rec | undefined;
      if (cur && data.updatedAt <= cur.updatedAt) continue; // ours is newer or the same
      const map = (next[c] ?? { ...s[c] }) as Record<string, Rec>;
      map[data.id] = data;
      storage.put(c, data, false);
      (next as Record<string, unknown>)[c] = map;
    }
    // only notify subscribers when something actually changed (prevents sync ping-pong)
    if (Object.keys(next).length > 0) set({ ...next, rev: s.rev + 1 } as Partial<DataState>);
  },

  wipeLocal() {
    storage.wipe();
    set({ ...emptyMaps(), settings: DEFAULT_SETTINGS, rev: get().rev + 1 });
  },
}));

/** Live (non-deleted) records of a collection, sorted. */
export function live<T extends Rec>(map: Record<string, T>): T[] {
  return Object.values(map).filter((r) => !r.deleted);
}
