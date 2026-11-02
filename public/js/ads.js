/* Ads chosen by the admin: placement, area targeting, rotation, impressions. */
import { S } from './state.js';
import { rot } from './components.js';
import { PARENT, dist, isTown } from './data.js';
import { app, beacon, esc, loc, ls } from './util.js';

/* ---------------- ads (managed by the main admin) ---------------- */
// An ad may target areas: it then shows to people who chose one of them (or whose location is close to one).
function adAreaOk(a) {
  if (!a.areas?.length) return true;
  const cur = ls.get('area', '');
  if (cur && a.areas.some(t => t === cur || PARENT[cur] === t || (t === 'যশোর সদর' && isTown(cur)))) return true;
  return !!S.here && a.areas.some(t => { const g = S.D.areaGeo?.[t]; return g && dist({ lat: +g[0], lng: +g[1] }, S.here) <= 2; });
}
export const adsFor = (placement, cat) => (S.D.ads || []).filter(a => (a.placement || 'home') === placement && (!a.category || !cat || a.category === cat) && adAreaOk(a))
  .sort((x, y) => (!!(y.areas?.length) - !!(x.areas?.length)) || rot(x.id + placement) - rot(y.id + placement));
const seenAds = new Set();
export function adImpressions() {
  app.querySelectorAll('[data-ad]').forEach(el => { const id = el.dataset.ad; if (!seenAds.has(id)) { seenAds.add(id); beacon('/adtrack', { id, type: 'imp' }); } });
}
// Ad links may only point into the app, to a phone number or to a web page.
const safeLink = l => /^(#\/|tel:\+?[\d-]+$|https?:\/\/)/.test(l || '') ? l : '#/';
export function adCard(a, cls = 'banner') {
  const link = safeLink(a.link), ext = /^https?:/.test(link);
  const tgt = `data-ad="${esc(a.id)}" href="${esc(link)}" ${ext ? 'target="_blank" rel="noopener sponsored"' : ''}`;
  if (a.image && (a.layout === 'full' || a.layout === 'fulltext')) {
    return `<a class="${cls} full ${a.layout}" ${tgt}><img src="${esc(a.image)}" alt="${esc(loc(a, 'title'))}" loading="lazy">
      ${a.layout === 'fulltext' ? `<div class="btext">${loc(a, 'kicker') ? `<small>${esc(loc(a, 'kicker'))}</small>` : ''}<h3>${esc(loc(a, 'title'))}</h3>${loc(a, 'subtitle') ? `<p>${esc(loc(a, 'subtitle'))}</p>` : ''}</div>
      ${loc(a, 'cta') ? `<span class="bcta">${esc(loc(a, 'cta'))}</span>` : ''}` : ''}</a>`;
  }
  return `<a class="${cls} ${esc(a.theme || 'dark')}" ${tgt}>
    ${a.image ? `<img class="bimg" src="${esc(a.image)}" alt="" loading="lazy">` : `<span class="deco">${icon(a.link?.startsWith('tel:') ? 'phone' : a.link === '#/add' ? 'store' : 'sparkle', 150)}</span>`}
    <div class="btext">${loc(a, 'kicker') ? `<small>${esc(loc(a, 'kicker'))}</small>` : ''}<h3>${esc(loc(a, 'title'))}</h3>${loc(a, 'subtitle') ? `<p>${esc(loc(a, 'subtitle'))}</p>` : ''}</div>
    ${loc(a, 'cta') ? `<span class="bcta">${esc(loc(a, 'cta'))}</span>` : ''}</a>`;
}
export const adStrip = (placement, cat, style = '') => { const a = adsFor(placement, cat)[0]; return a ? `<div class="adslot-inline"${style ? ` style="${style}"` : ''}>${adCard(a, 'banner slim')}</div>` : ''; };
// One ad inside a result list, after the fourth row (or after the last when the list is shorter).
export const withListAd = (rows, cat) => { if (!rows.length) return ''; const ad = adStrip('list', cat, 'margin:4px 0'), at = Math.min(4, rows.length);
  return rows.slice(0, at).join('') + ad + rows.slice(at).join(''); };
