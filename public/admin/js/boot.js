/* Start-up: check the session, then show the panel or the sign-in screen. */
import { load } from './data.js';
import { route } from './router.js';
import { S, api } from './util.js';

/* ---------------- boot ---------------- */
export async function boot() {
  try { S.me = await api('/admin/me'); } catch { return; }
  try { S.counts = await api('/admin/summary'); } catch {}
  await load(true);
  route();
}

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  boot();
}
