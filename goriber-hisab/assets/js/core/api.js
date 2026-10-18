/**
 * REST client. Adds the WP nonce and tenant headers, normalises errors into
 * ApiError { message, code, status, errors{field: msg} }.
 */
import { state } from './state.js';

export class ApiError extends Error {
  constructor(message, { code = 'error', status = 0, errors = {} } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.errors = errors;
  }
  get offline() { return this.status === 0; }
}

/**
 * Build the endpoint URL. With plain permalinks the REST root is
 * "…/index.php?rest_route=/goriber-hisab/v1/", so extra parameters must be
 * joined with "&", not a second "?".
 */
export function endpoint(path, params) {
  const base = window.BZL.restUrl + path.replace(/^\//, '');
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    q.append(k, String(v));
  }
  const s = q.toString();
  return s ? `${base}${base.includes('?') ? '&' : '?'}${s}` : base;
}

/* ------------------------------------------------------------------ Offline reads
 * Every successful GET is kept in IndexedDB (per business + branch). When
 * the phone is offline the last saved answer is returned instead, so any
 * screen opened before keeps working. Writes are never faked: sales go
 * through the offline queue (offline.js), everything else needs internet.
 */
const READS = 'gh-reads';
const MAX_READS = 800;
let readsDb;
function reads() {
  if (!readsDb) {
    readsDb = new Promise((resolve, reject) => {
      const r = indexedDB.open(READS, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('r');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }).catch(() => null);
  }
  return readsDb;
}
const readKey = (url) => `${window.BZL.userId || 0}:${state.businessId || 0}:${state.branchId || 0}:${url.replace(/([?&])_=[^&]*/, '$1')}`;
let writes = 0;
async function saveRead(url, data) {
  const d = await reads();
  if (!d) return;
  try {
    const t = d.transaction('r', 'readwrite');
    t.objectStore('r').put({ at: Date.now(), data }, readKey(url));
    if (++writes % 50 === 0) pruneReads(d);
  } catch { /* storage full or private mode */ }
}
function pruneReads(d) {
  const t = d.transaction('r', 'readwrite');
  const st = t.objectStore('r');
  const all = [];
  st.openCursor().onsuccess = (e) => {
    const c = e.target.result;
    if (c) { all.push([c.key, c.value.at]); c.continue(); return; }
    if (all.length <= MAX_READS) return;
    all.sort((a, b) => a[1] - b[1]).slice(0, all.length - MAX_READS).forEach(([k]) => st.delete(k));
  };
}
async function savedRead(url) {
  const d = await reads();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const g = d.transaction('r', 'readonly').objectStore('r').get(readKey(url));
      g.onsuccess = () => resolve(g.result || null);
      g.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

/** The WP REST nonce expires after a day; the app (cached shell) asks for a new one. */
let renewing = null;
function renewNonce() {
  if (!renewing) {
    const ajax = window.BZL.ajaxUrl || `${window.BZL.adminUrl}admin-ajax.php`;
    renewing = fetch(`${ajax}${ajax.includes('?') ? '&' : '?'}action=rest-nonce`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((n) => { n = n.trim(); if (/^[a-f0-9]{6,}$/i.test(n)) { window.BZL.nonce = n; return true; } return false; })
      .catch(() => false)
      .finally(() => { setTimeout(() => { renewing = null; }, 0); });
  }
  return renewing;
}

export async function request(method, path, body, params, retried = false) {
  const headers = { 'X-WP-Nonce': window.BZL.nonce, Accept: 'application/json' };
  if (state.businessId) headers['X-Hisab-Business'] = String(state.businessId);
  if (state.branchId) headers['X-Hisab-Branch'] = String(state.branchId);
  const init = { method, headers, credentials: 'same-origin' };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const url = endpoint(path, params);
  const offlineRead = async () => {
    // Working offline is a feature of the Android app; the website needs internet.
    if (!window.GoriberHisabNative) return null;
    const saved = method === 'GET' ? await savedRead(url) : null;
    if (saved) {
      state.savedDataAt = saved.at;
      document.dispatchEvent(new CustomEvent('gh:saved-data', { detail: saved.at }));
      return saved;
    }
    return null;
  };
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    const saved = await offlineRead();
    if (saved) return saved.data;
    throw new ApiError('You appear to be offline. Check your internet connection.', { code: 'offline', status: 0 });
  }
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    if (res.status === 403 && data?.code === 'rest_cookie_invalid_nonce') {
      if (!retried && await renewNonce()) return request(method, path, body, params, true);
      throw new ApiError('Your session has expired. Please reload the page.', { code: 'session', status: 403 });
    }
    if (res.status >= 500 && method === 'GET') {
      // Server or hosting trouble: show what we saved rather than nothing.
      const saved = await offlineRead();
      if (saved) return saved.data;
    }
    if (res.status === 402 && data?.code === 'hisab_subscription') {
      // The shop's subscription ran out mid-session: show the renewal screen.
      setTimeout(() => location.reload(), 2500);
    }
    throw new ApiError(data?.message || `Request failed (${res.status})`, {
      code: data?.code || 'http_error',
      status: res.status,
      errors: data?.data?.errors || {},
    });
  }
  if (method === 'GET' && window.GoriberHisabNative) {
    saveRead(url, data);
    state.savedDataAt = 0;
  }
  return data;
}

/** Forget everything saved on this device (log out). */
export function clearSavedReads() {
  try { indexedDB.deleteDatabase(READS); } catch { /* ignore */ }
  readsDb = null;
}

export const api = {
  get: (path, params) => request('GET', path, undefined, params),
  post: (path, body) => request('POST', path, body ?? {}),
  put: (path, body) => request('PUT', path, body ?? {}),
  del: (path) => request('DELETE', path),
  upload: (file, purpose) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('purpose', purpose);
    return request('POST', 'uploads', fd);
  },
};
