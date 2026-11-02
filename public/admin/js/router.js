/* Router: from the address (#/…) to a page. */
import { pages } from './dashboard.js';
import { NAV, TITLES, renderLogin } from './shell.js';
import { S, T, api, owner, toast } from './util.js';

/* ---------------- router ---------------- */
export async function route() {
  if (!S.me) return renderLogin();
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/'), p = new URLSearchParams(query);
  let name = parts[0] || 'dashboard', params = [];
  if (name === 'listings' && parts[1]) { name = 'edit'; params = [parts[1]]; }
  if (!pages[name]) name = 'dashboard';
  const ownerOnly = NAV.flatMap(g => g[1]).filter(x => x[4]).map(x => x[0]);
  if (ownerOnly.includes(name) && !owner()) name = 'dashboard';
  try { await pages[name](params, p); } catch (e) { if (S.me) toast(e.message, true); }
  document.title = `${T(TITLES[name] || 'অ্যাডমিন')} · Jashore360`;
  if (pages.route !== path) window.scrollTo(0, 0);
  pages.route = path;
}
export const refreshList = async () => { S.listings = await api('/admin/listings'); };

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', () => { clearTimeout(pages.rz); pages.rz = setTimeout(() => location.hash.replace(/^#\/?/, '').split('?')[0] in { '': 1, dashboard: 1 } && route(), 250); });
}
