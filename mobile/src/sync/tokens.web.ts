/** Web build: sessionStorage so tokens don't outlive the browser session. */
const get = (k: string) => {
  try {
    return globalThis.sessionStorage?.getItem(k) ?? null;
  } catch {
    return null;
  }
};
const put = (k: string, v: string | null) => {
  try {
    if (v === null) globalThis.sessionStorage?.removeItem(k);
    else globalThis.sessionStorage?.setItem(k, v);
  } catch {
    /* ignore */
  }
};

export const tokens = {
  async get() {
    return { access: get('tadbeer.access'), refresh: get('tadbeer.refresh') };
  },
  async set(access: string, refresh: string) {
    put('tadbeer.access', access);
    put('tadbeer.refresh', refresh);
  },
  async clear() {
    put('tadbeer.access', null);
    put('tadbeer.refresh', null);
  },
};
