/**
 * App-wide state: session bootstrap from /me plus a tiny pub/sub.
 */
const listeners = new Map();

export const state = {
  me: null, // full /me payload
  get ctx() { return this.me?.context || null; },
  get business() { return this.me?.context?.business || null; },
  get settings() { return this.me?.settings || {}; },
  businessId: Number(localStorage.getItem('bzl.business') || 0) || 0,
  branchId: Number(localStorage.getItem('bzl.branch') || 0) || 0,
  online: navigator.onLine,
};

export function can(permission) {
  return !!state.ctx?.permissions?.includes(permission);
}

export function canAny(...permissions) {
  return permissions.some(can);
}

export function setBusiness(id, branch = 0) {
  state.businessId = id;
  state.branchId = branch;
  try {
    localStorage.setItem('bzl.business', String(id));
    localStorage.setItem('bzl.branch', String(branch));
  } catch { /* storage may be unavailable */ }
}

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, payload) {
  (listeners.get(event) || []).forEach((fn) => fn(payload));
}

/** Per-viewer preference helpers (wrapped: storage can throw). */
export const prefs = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(`bzl.pref.${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`bzl.pref.${key}`, JSON.stringify(value)); } catch { /* ignore */ }
  },
};
