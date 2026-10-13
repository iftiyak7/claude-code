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
 * "…/index.php?rest_route=/bizledger/v1/", so extra parameters must be
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

export async function request(method, path, body, params) {
  const headers = { 'X-WP-Nonce': window.BZL.nonce, Accept: 'application/json' };
  if (state.businessId) headers['X-BizLedger-Business'] = String(state.businessId);
  if (state.branchId) headers['X-BizLedger-Branch'] = String(state.branchId);
  const init = { method, headers, credentials: 'same-origin' };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(endpoint(path, params), init);
  } catch (e) {
    throw new ApiError('You appear to be offline. Check your internet connection.', { code: 'offline', status: 0 });
  }
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    if (res.status === 403 && data?.code === 'rest_cookie_invalid_nonce') {
      throw new ApiError('Your session has expired. Please reload the page.', { code: 'session', status: 403 });
    }
    throw new ApiError(data?.message || `Request failed (${res.status})`, {
      code: data?.code || 'http_error',
      status: res.status,
      errors: data?.data?.errors || {},
    });
  }
  return data;
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
