/**
 * Offline support: the app keeps working without internet.
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
    // Warm the saved answers the offline forms need (expense / income categories, suppliers).
    await Promise.all([
      api.get('accounts', { type: 'expense' }), api.get('accounts', { type: 'income' }),
      api.get('suppliers', { per_page: 25, page: 1 }),
    ].map((r) => r.catch(() => null)));
  } catch { /* keep old snapshot */ }
}

/* ------------------------------------------------------------------ Offline writes
 * Sales, new customers, due collections, expenses and purchases made without
 * internet wait here, in the order they were made, each with its own UUID.
 * The server ignores a UUID it has already seen, so sending twice is safe.
 * A customer made offline has no server id yet: later items point to it by
 * its UUID and get the real id when it has been sent.
 */
const KINDS = { sale: 'sales', customer: 'customers', payment: 'payments/receive', supplier_payment: 'payments/pay', expense: 'expenses', income: 'income', purchase: 'purchases' };

export async function queueWrite(kind, path, payload) {
  await tx('queue', 'readwrite', (s) => s.put({ uuid: payload.uuid, kind, path: path || KINDS[kind], business: state.businessId, branch: state.branchId, payload, created: Date.now(), error: null }));
  await localEffects(kind, payload);
  emit('queue', await queued());
}

export async function queueSale(payload) {
  return queueWrite('sale', 'sales', payload);
}

/**
 * Send now, or (in the app, without internet) keep it for later.
 * A kept item comes back as { ...payload, id: 0, queued: true }.
 */
export async function postOrQueue(kind, path, payload) {
  try {
    return await api.post(path, payload);
  } catch (err) {
    if (!err.offline || !window.GoriberHisabNative) throw err;
    await queueWrite(kind, path, payload);
    return { ...payload, id: 0, queued: true };
  }
}

/** What the phone shows meanwhile: stock goes down, the new customer can be found. */
async function localEffects(kind, payload) {
  try {
    if (kind === 'sale' || kind === 'purchase') {
      const products = (await cacheGet('products')) || [];
      const sign = kind === 'sale' ? -1 : 1;
      for (const it of payload.items || []) {
        const pr = products.find((x) => x.id === Number(it.product_id));
        if (pr && pr.track_stock) pr.stock_qty = String(Number(pr.stock_qty || 0) + sign * Number(it.qty || 0));
      }
      await cacheSet('products', products);
    }
    if (kind === 'customer') {
      const customers = (await cacheGet('customers')) || [];
      customers.unshift({ id: 0, uuid: payload.uuid, name: payload.name, phone: payload.phone || '', balance: '0', _local: true });
      await cacheSet('customers', customers);
    }
  } catch { /* the queue itself is what matters */ }
}

/** Server id of a customer made offline, once it has been sent. */
export async function localId(uuid) {
  const map = (await cacheGet('idmap')) || {};
  return map[uuid] || 0;
}

export async function queued() {
  try {
    const all = await tx('queue', 'readonly', (s) => s.getAll());
    return (all || []).filter((q) => q.business === state.businessId).sort((a, b) => a.created - b.created);
  } catch { return []; }
}

export async function discard(uuid) {
  await tx('queue', 'readwrite', (s) => s.delete(uuid));
  emit('queue', await queued());
}

let syncing = null;
export function sync() {
  if (!navigator.onLine) return Promise.resolve();
  if (!syncing) syncing = run().finally(() => { syncing = null; });
  return syncing;
}

async function run() {
  let sent = 0;
  try {
    const map = (await cacheGet('idmap')) || {};
    for (const item of await queued()) {
      const kind = item.kind || 'sale';
      const body = { ...item.payload };
      // Point to customers made offline by their real id.
      let waiting = false;
      for (const [ref, field] of [['customer_uuid', 'customer_id'], ['contact_uuid', 'contact_id']]) {
        if (!body[ref]) continue;
        if (!map[body[ref]]) { waiting = true; break; }
        body[field] = map[body[ref]];
        delete body[ref];
      }
      if (waiting) continue; // its customer could not be sent yet
      try {
        const res = await api.post(item.path || KINDS[kind] || 'sales', body);
        if (kind === 'customer' && res?.id) { map[item.uuid] = res.id; await cacheSet('idmap', map); }
        await tx('queue', 'readwrite', (s) => s.delete(item.uuid));
        sent++;
      } catch (err) {
        if (err.offline) break;
        item.error = err.message;
        await tx('queue', 'readwrite', (s) => s.put(item));
      }
    }
  } finally {
    emit('queue', await queued());
    if (sent) refreshSnapshot();
  }
}

window.addEventListener('online', () => { state.online = true; emit('online', true); sync(); });
window.addEventListener('offline', () => { state.online = false; emit('online', false); });
