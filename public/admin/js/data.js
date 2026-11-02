/* Data the pages share: settings, listings, categories, saving settings. */
import { LANG, S, STATUS, T, api, esc } from './util.js';

/* ---------------- data ---------------- */
const SETTINGS = ['site', 'areas', 'categories', 'notices', 'ads', 'plans', 'payment', 'app', 'terms', 'popup', 'areaGeo'];
export const cats = () => S.settings.categories || [];
export const catOf = id => cats().find(c => c.id === id) || { bn: id, en: id, icon: 'info', color: '#8b95a7', subs: {} };
export const catName = c => LANG() === 'en' ? c.en || c.bn : c.bn;
export const subName = (c, s) => (LANG() === 'en' && c.subsEn?.[s]) || c.subs?.[s] || '';
export async function load(force) {
  const need = SETTINGS.filter(k => force || !S.settings[k]);
  const [lst, rv, rp, ...st] = await Promise.all([force || !S.listings ? api('/admin/listings') : S.listings,
    force || !S.reviews ? api('/admin/reviews') : S.reviews, force || !S.reports ? api('/admin/reports') : S.reports,
    ...need.map(k => api('/admin/settings/' + k))]);
  S.listings = lst; S.reviews = rv; S.reports = rp;
  need.forEach((k, i) => S.settings[k] = st[i]);
}
export const counts = () => ({ subs: S.listings?.filter(l => l._review === 'pending').length || 0, reports: S.reports?.filter(r => !r.done).length || 0,
  pays: S.counts?.payments || 0, cls: S.counts?.classifiedsPending || 0 });
export const thumb = (l, c = catOf(l.cat)) => `<span class="thumb" style="--c:${esc(c.color)}">${l.images?.[0] ? `<img src="${esc(l.images[0])}" alt="" loading="lazy">` : icon(c.icon, 20)}</span>`;
export const statusTag = s => { const [t, k] = STATUS[s] || STATUS.pending; return `<span class="tag ${k}">${T(t)}</span>`; };
export const empty = (t, m = '', ic = 'inbox') => `<div class="empty"><div class="eic">${icon(ic, 28)}</div><b>${t}</b>${m}</div>`;
