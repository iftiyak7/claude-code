/**
 * Offline-first sync. The device is the primary copy; the server is a backup
 * and a relay between the user's devices.
 *
 *   push: every record flagged dirty locally (batch of ≤ 500)
 *   pull: everything the server saw after our cursor
 *   merge: last-write-wins per record on `updatedAt`
 *
 * Runs on login, app foreground, a debounce after local edits, and manual
 * "Sync now". Any failure just leaves records dirty for the next attempt.
 */
import { create } from 'zustand';
import { storage } from '@/db/storage';
import type { Rec } from '@/domain/types';
import { useData } from '@/store/data';
import { api, ApiError, type AuthResult } from './api';
import { tokens } from './tokens';

const CURSOR = 'sync.cursor';
const USER = 'sync.user';
const LAST = 'sync.last';
const BATCH = 500;

interface SyncState {
  user: { id: string; email: string; name: string } | null;
  status: 'idle' | 'syncing' | 'error' | 'offline';
  lastSync: number | null;
}

export const useSync = create<SyncState>()(() => ({
  user: (() => {
    try {
      return JSON.parse(storage.kvGet(USER) ?? 'null');
    } catch {
      return null;
    }
  })(),
  status: 'idle',
  lastSync: Number(storage.kvGet(LAST)) || null,
}));

let inflight: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (!useSync.getState().user) return Promise.resolve();
  if (inflight) return inflight;
  inflight = run().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function run() {
  useSync.setState({ status: 'syncing' });
  try {
    let cursor = storage.kvGet(CURSOR) ?? '0';
    for (let round = 0; round < 50; round++) {
      const dirty = storage.dirty(BATCH);
      const res = await api.sync({
        cursor,
        changes: dirty.map((r) => ({
          collection: r.collection,
          id: r.data.id,
          updatedAt: r.data.updatedAt,
          deleted: !!r.data.deleted,
          data: r.data,
        })),
      });
      storage.markClean(dirty.map((r) => ({ collection: r.collection, id: r.data.id, updatedAt: r.data.updatedAt })));
      useData.getState().applyRemote(
        res.changes.map((c) => ({ collection: c.collection, data: { ...(c.data as Rec), deleted: c.deleted } })),
      );
      cursor = res.cursor;
      storage.kvSet(CURSOR, cursor);
      if (!res.hasMore && dirty.length < BATCH) break;
    }
    const now = Date.now();
    storage.kvSet(LAST, String(now));
    useSync.setState({ status: 'idle', lastSync: now });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await signOutLocal();
      return;
    }
    useSync.setState({ status: e instanceof ApiError ? 'error' : 'offline' });
  }
}

async function onAuth(r: AuthResult) {
  await tokens.set(r.accessToken, r.refreshToken);
  storage.kvSet(USER, JSON.stringify(r.user));
  // a fresh login uploads everything this device has and pulls the full history
  storage.kvSet(CURSOR, '0');
  storage.markAllDirty();
  useSync.setState({ user: r.user });
  if (r.user.name && !useData.getState().settings.name) useData.getState().updateSettings({ name: r.user.name });
  await syncNow();
}

export async function register(email: string, password: string, name: string) {
  await onAuth(await api.register(email.trim().toLowerCase(), password, name.trim()));
}

export async function login(email: string, password: string) {
  await onAuth(await api.login(email.trim().toLowerCase(), password));
}

async function signOutLocal() {
  await tokens.clear();
  storage.kvSet(USER, 'null');
  storage.kvSet(CURSOR, '0');
  useSync.setState({ user: null, status: 'idle' });
}

export async function logout() {
  await syncNow().catch(() => undefined);
  const { refresh } = await tokens.get();
  if (refresh) await api.logout(refresh);
  await signOutLocal();
}

/** Permanently erase the server account + all synced data. Local data stays on the device. */
export async function deleteAccount() {
  await api.deleteAccount();
  await signOutLocal();
}

let debounce: ReturnType<typeof setTimeout> | null = null;

/** Background sync a little while after the user stops editing. */
export function startAutoSync(): () => void {
  let lastRev = useData.getState().rev;
  const unsub = useData.subscribe((s) => {
    if (s.rev === lastRev) return;
    lastRev = s.rev;
    if (!useSync.getState().user) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void syncNow(), 8000);
  });
  void syncNow();
  return () => {
    unsub();
    if (debounce) clearTimeout(debounce);
  };
}
