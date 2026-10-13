/**
 * Offline support for the POS.
 *
 *  - Catalogue and customer snapshots are cached in IndexedDB so product
 *    search keeps working without a connection.
 *  - Sales made offline are queued with their client UUID and replayed
 *    when the connection returns. The server deduplicates by UUID, so a
 *    retry can never create a second sale.
 *  - A sale the server rejects at sync time (e.g. stock ran out) stays in
 *    the queue with its error so a person can fix or discard it: nothing is
 *    silently dropped.
 */
import { api } from './api.js';
import { state, emit } from './state.js';

const DB = 'goriber-hisab';
let dbp;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('cache');
        d.createObjectStore('queue', { keyPath: 'uuid' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

const key = (name) => `${state.businessId}:${state.branchId}:${name}`;

export async function cacheSet(name, value) {
  try { await tx('cache', 'readwrite', (s) => s.put({ at: Date.now(), value }, key(name))); } catch { /* private mode */ }
}

export async function cacheGet(name) {
  try { const r = await tx('cache', 'readonly', (s) => s.get(key(name))); return r?.value ?? null; } catch { return null; }
}

/** Refresh the product + customer snapshot used offline. */
export async function refreshSnapshot() {
  if (!navigator.onLine) return;
  try {
    const [products, customers] = await Promise.all([
      api.get('products', { per_page: 500, orderby: 'name' }),
      api.get('customers', { per_page: 500, orderby: 'recent' }),
    ]);
    await cacheSet('products', products.items);
    await cacheSet('customers', customers.items);
  } catch { /* keep old snapshot */ }
}

export async function queueSale(payload) {
  await tx('queue', 'readwrite', (s) => s.put({ uuid: payload.uuid, business: state.businessId, branch: state.branchId, payload, created: Date.now(), error: null }));
  emit('queue', await queued());
}

export async function queued() {
  try {
    const all = await tx('queue', 'readonly', (s) => s.getAll());
    return (all || []).filter((q) => q.business === state.businessId);
  } catch { return []; }
}

export async function discard(uuid) {
  await tx('queue', 'readwrite', (s) => s.delete(uuid));
  emit('queue', await queued());
}

let syncing = false;
export async function sync() {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    for (const item of await queued()) {
      try {
        await api.post('sales', item.payload);
        await tx('queue', 'readwrite', (s) => s.delete(item.uuid));
      } catch (err) {
        if (err.offline) break;
        item.error = err.message;
        await tx('queue', 'readwrite', (s) => s.put(item));
      }
    }
  } finally {
    syncing = false;
    emit('queue', await queued());
  }
}

window.addEventListener('online', () => { state.online = true; emit('online', true); sync(); });
window.addEventListener('offline', () => { state.online = false; emit('online', false); });
