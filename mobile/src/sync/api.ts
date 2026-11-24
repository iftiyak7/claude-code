import Constants from 'expo-constants';
import { tokens } from './tokens';

/** Override per build with EXPO_PUBLIC_API_URL (e.g. a local server during development). */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? 'https://api.tadbeerdaily.com';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

async function raw<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? 'http_error');
    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}

let refreshing: Promise<string | null> | null = null;

async function refreshAccess(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { refresh } = await tokens.get();
    if (!refresh) return null;
    try {
      const r = await raw<{ accessToken: string; refreshToken: string }>('/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: refresh }),
      });
      await tokens.set(r.accessToken, r.refreshToken);
      return r.accessToken;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await tokens.clear();
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Authenticated request with one transparent token refresh on 401. */
export async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
  let { access } = await tokens.get();
  if (!access) access = await refreshAccess();
  if (!access) throw new ApiError(401, 'not_logged_in');
  try {
    return await raw<T>(path, { ...init, token: access });
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    const fresh = await refreshAccess();
    if (!fresh) throw e;
    return raw<T>(path, { ...init, token: fresh });
  }
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string };
}

export const api = {
  register: (email: string, password: string, name: string) =>
    raw<AuthResult>('/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
  login: (email: string, password: string) =>
    raw<AuthResult>('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: (refreshToken: string) =>
    raw<null>('/v1/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => null),
  me: () => authed<{ id: string; email: string; name: string }>('/v1/me'),
  deleteAccount: () => authed<null>('/v1/me', { method: 'DELETE' }),
  sync: (body: SyncRequest) => authed<SyncResponse>('/v1/sync', { method: 'POST', body: JSON.stringify(body) }),
};

export interface SyncChange {
  collection: string;
  id: string;
  updatedAt: number;
  deleted: boolean;
  data: unknown;
}
export interface SyncRequest {
  cursor: string;
  changes: SyncChange[];
}
export interface SyncResponse {
  cursor: string;
  changes: SyncChange[];
  hasMore: boolean;
}
