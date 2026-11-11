/* Building blocks of pages: cards, rows, tags, coupons tickets. */
import { S } from './state.js';
import { KINDS, STATUS, catOf, dirUrl, isOpen, km, kmText, nameOf, optLabel, subIcon, subLabel } from './data.js';
import { T, api, app, areaName, esc, fmtDate, ls, money, num } from './util.js';

/* ---------------- components ---------------- */
export const media = (it, cls = '', color, ic) => {
  const img = it.images?.[0];
  return `<div class="media ${cls}" style="--c:${esc(color || catOf(it).color)}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async">`
    : `<div class="gen"><div class="ring">${icon(ic || subIcon(it), 40)}</div></div>`}</div>`;
};
export const starsHtml = (v, size = 14) => `<span class="stars">${[1, 2, 3, 4, 5].map(i => icon('star', size, v >= i - .3 ? 'on' : '')).join('')}</span>`;
export const rateTag = it => it.rating ? `<span class="rate">${icon('star', 13)}${num(it.rating.toFixed(1))}<span class="muted" style="font-weight:400">(${num(it.reviews)})</span></span>` : '';
export const statusTag = it => { const [t, k] = STATUS[it.status] || STATUS.pending; return `<span class="tag ${k}">${k === 'ok' ? icon('check', 12) : ''}${T(t)}</span>`; };
export function openTag(it) {
  const o = isOpen(it);
  if (o && it.hours === '24h') return `<span class="tag ok">${T('২৪ ঘণ্টা')}</span>`;
  return o === true ? `<span class="tag ok">${T('খোলা')}</span>` : o === false ? `<span class="tag bad">${T('বন্ধ')}</span>` : '';
}
export const saved = () => ls.get('saved', []);
export const isSaved = id => saved().includes(id);
const heart = id => `<button class="heartbtn ${isSaved(id) ? 'on' : ''}" data-save="${esc(id)}" aria-label="${T('সেভ')}">${icon('heart', 17)}</button>`;
// Grid card: photo (with distance on it), then kind · area, the name on up to two lines, and open/price/rating in one row.
function cardStatus(it) {
  if (it.price) return `<span class="price">${money(it.price)}</span>`;
  const o = isOpen(it);
  if (o && it.hours === '24h') return `<span class="st ok">${T('২৪ ঘণ্টা খোলা')}</span>`;
  return o === true ? `<span class="st ok">${T('এখন খোলা')}</span>` : o === false ? `<span class="st bad">${T('এখন বন্ধ')}</span>` : '';
}
export function gcard(it) {
  const d = km(it);
  return `<a class="gcard${it.sponsored ? ' spons' : ''}" href="#/p/${esc(it.id)}"${it.sponsored ? ` data-imp="${esc(it.id)}"` : ''}>
    <div class="gtop">${media(it)}${d != null ? `<span class="dist">${icon('nav', 11)}${kmText(d)}</span>` : ''}</div>${heart(it.id)}
    ${it.sponsored ? '<span class="flag tag glass">Sponsored</span>' : it.demo ? `<span class="flag tag dark">${T('নমুনা')}</span>` : it.halal ? `<span class="flag tag halal">${icon('halal', 12)}${T('হালাল')}</span>` : ''}
    <div class="cap"><small>${esc(subLabel(it))}${it.area ? ' · ' + esc(areaName(it.area)) : ''}</small><b class="gname">${nameT(it)}</b>
      <div class="meta">${cardStatus(it)}${it.rating ? `<span class="rate">${icon('star', 12)}${num(it.rating.toFixed(1))}<em>(${num(it.reviews)})</em></span>` : ''}</div></div></a>`;
}
/* Paid promotion: sponsored listings take the first slots of every list and search, in an order that rotates
   per visit so every sponsor gets a fair share of the top spot. */
const SEED = Math.floor(Math.random() * 1e9);
export const rot = id => { let h = SEED; for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761) >>> 0; return h; };
export function promote(list, slots = 3) {
  const sp = list.filter(i => i.sponsored).sort((a, b) => rot(a.id) - rot(b.id)).slice(0, slots);
  return sp.length ? [...sp, ...list.filter(i => !sp.includes(i))] : list;
}
// Distance-first list: nearest highlighted, distance + walking time in a badge, one-tap directions.
export const walkText = k => k < 2 ? T('হেঁটে {n} মিনিট', { n: num(Math.max(1, Math.round(k / 4.5 * 60))) }) : T('রিকশা/গাড়িতে ~{n} মিনিট', { n: num(Math.max(5, Math.round(k / 15 * 60))) });
function nearRow(it, first) {
  const d = km(it);
  return `<div class="nrow${first ? ' nearest' : ''}${it.sponsored ? ' spons' : ''}"${it.sponsored ? ` data-imp="${esc(it.id)}"` : ''}>
    <a class="nmain" href="#/p/${esc(it.id)}">${media(it)}<div class="body">${first ? `<span class="tag ok">${icon('nav', 12)}${T('সবচেয়ে কাছে')}</span>` : ''}
      <b>${nameT(it)}</b><div class="sub">${esc(subLabel(it))}${it.area ? ' · ' + esc(areaName(it.area)) : ''}</div>
      <div class="meta">${it.sponsored ? '<span class="tag ad">Sponsored</span>' : ''}${halalTag(it)}${openTag(it)}</div></div></a>
    <a class="ndist" href="${esc(dirUrl(it))}" target="_blank" rel="noopener" data-map="${esc(it.id)}" aria-label="${T('দিকনির্দেশ')}">
      <b>${kmText(d)}</b><small>${walkText(d)}</small><span>${icon('nav', 13)}${T('পথ দেখুন')}</span></a></div>`;
}
export function nearList(list) {
  const known = list.filter(i => km(i) != null), unknown = list.filter(i => km(i) == null);
  const firstPlain = known.find(i => !i.sponsored);
  return `${known.length ? `<div class="nlist">${known.map(i => nearRow(i, i === firstPlain)).join('')}</div>` : ''}
    ${unknown.length ? `<div class="sechead" style="margin-top:18px"><h2 style="font-size:14px">${T('দূরত্ব জানা নেই')}</h2><small class="muted">${T('ম্যাপ লোকেশন যোগ হয়নি')}</small></div>
      <div class="rows">${unknown.map(row).join('')}</div>` : ''}
    ${!list.length ? empty(T('কিছু পাওয়া যায়নি'), T('অন্য শব্দে খুঁজুন বা ফিল্টার বদলান।')) : ''}`;
}
// Several role-labelled numbers (OC, duty officer, emergency desk …), each with its own call button.
const fmtPhone = p => /^01\d{9}$/.test(p) ? p.slice(0, 5) + '-' + p.slice(5) : p;
export const contactLines = (it, cls = '') => (it.contacts || []).map(c => `<a class="cline ${cls}" href="tel:${esc(c.phone)}" data-call-track="${esc(it.id)}">
    <span class="ct"><b>${esc(c.role ? T(c.role) : T('ফোন'))}</b>${c.name ? `<small>${esc(c.name)}</small>` : ''}</span>
    <em>${num(esc(fmtPhone(c.phone)))}</em><i>${icon('phone', 17)}</i></a>`).join('');
export function ecard(it) {
  return `<div class="ecard"><a class="ehead" href="#/p/${esc(it.id)}">${media(it)}<div class="body"><b>${nameT(it)}</b>
    <div class="sub">${esc(subLabel(it))}${it.area ? ' · ' + esc(areaName(it.area)) : ''}${km(it) != null ? ' · ' + kmText(km(it)) : ''}</div></div>${icon('chevR', 18)}</a>
    <div class="clist">${contactLines(it)}</div></div>`;
}
/* ---------- coupons ---------- */
const offerTag = it => S.D.offers?.[it.id] ? `<span class="tag offer">${icon('tag', 12)}${T('অফার')}</span>` : '';
export function ticket(c, { claimed, listingLink } = {}) {
  const code = claimed?.code;
  return `<div class="ticket${claimed?.used ? ' used' : ''}"><div class="tk-l">${icon('tag', 24)}</div>
    <div class="tk-b">${listingLink ? `<a class="tk-shop" href="#/p/${esc(c.listing)}">${esc(c.listingName || '')} ${icon('chevR', 13)}</a>` : ''}
      <b>${esc(c.title)}</b>${c.details ? `<small>${esc(c.details)}</small>` : ''}
      <em>${c.ends ? T('{d} পর্যন্ত', { d: fmtDate(c.ends) }) : T('মেয়াদ নেই')}${c.maxClaims ? ' · ' + T('প্রথম {n} জন', { n: num(c.maxClaims) }) : ''}</em>
      ${code ? `<div class="tk-code"><span>${esc(code)}</span><button class="linkbtn" data-copy="${esc(code)}">${T('কপি')}</button></div>
        <small class="tk-hint">${claimed.used ? T('ব্যবহার করা হয়েছে') : T('দোকানে কোডটি দেখান')}</small>`
        : c.full ? `<span class="tag bad">${T('শেষ হয়ে গেছে')}</span>` : `<button class="btn sm" data-claim="${esc(c.id)}">${icon('tag', 15)}${T('কুপন নিন')}</button>`}</div></div>`;
}
export async function loadCoupons(id) {
  const box = app.querySelector('[data-coupons]'); if (!box) return;
  try {
    const r = await api('/listings/' + id + '/coupons');
    const mine = Object.fromEntries(r.mine.map(m => [m.coupon, m]));
    const extra = r.mine.filter(m => !r.coupons.some(c => c.id === m.coupon)).map(m => ({ id: m.coupon, title: m.title, details: m.details, ends: m.ends }));
    const all = [...r.coupons, ...extra];
    box.innerHTML = all.length ? `<h3 class="tk-head">${icon('tag', 16)}${T('অফার ও কুপন')}</h3>${all.map(c => ticket(c, { claimed: mine[c.id] })).join('')}` : '';
  } catch { box.innerHTML = ''; }
}
// Blue tick: a badge the admin gives to trusted / official businesses.
const SEAL = (() => { const pts = []; for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 10.2 : 12; pts.push((12 + r * Math.cos(a)).toFixed(2) + ' ' + (12 + r * Math.sin(a)).toFixed(2)); } return 'M' + pts.join('L') + 'Z'; })();
const tick = (size = 17) => `<svg class="bluetick" width="${size}" height="${size}" viewBox="0 0 24 24" role="img" aria-label="${T('ভেরিফায়েড')}"><title>${T('ভেরিফায়েড প্রতিষ্ঠান')}</title>
  <path d="${SEAL}" fill="#1d9bf0" stroke="#1d9bf0" stroke-width="1.6" stroke-linejoin="round"/><path d="m7.6 12.3 3 3 5.8-6.2" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// In one-line spots the name is ellipsized but the tick stays visible; in headings it simply follows the text.
export const nameT = (it, size) => !it.blueTick ? esc(nameOf(it)) : size > 20 ? esc(nameOf(it)) + ' ' + tick(size)
: `<span class="nmt"><span class="nm">${esc(nameOf(it))}</span>${tick(size)}</span>`;
export const halalTag = it => it.halal ? `<span class="tag halal">${icon('halal', 13)}${T('হালাল')}</span>` : '';
export function row(it) {
  const d = km(it);
  const act = it.phone ? `<span class="act ${it.cat === 'emergency' ? 'red' : ''}" data-call="${esc(it.phone)}" data-id="${esc(it.id)}" role="button" aria-label="${T('কল')}">${icon('phone', 18)}</span>`
    : `<span class="act">${icon('chevR', 18)}</span>`;
  return `<a class="row${it.sponsored ? ' spons' : ''}" href="#/p/${esc(it.id)}"${it.sponsored ? ` data-imp="${esc(it.id)}"` : ''}>${media(it)}<div class="body"><b>${nameT(it)}</b>
    <div class="sub">${esc(subLabel(it))}${it.area ? ' · ' + esc(areaName(it.area)) : ''}${d != null ? ' · ' + kmText(d) : ''}</div>
    <div class="meta">${offerTag(it)}${rateTag(it)}${openTag(it)}${halalTag(it)}${it.price ? `<span class="tag">${money(it.price)}</span>` : ''}${it.sponsored ? '<span class="tag ad">Sponsored</span>' : ''}${it.demo ? `<span class="tag">${T('নমুনা')}</span>` : ''}</div></div>${act}</a>`;
}
// sp must be true (not a list index): call it as list.map(it => wcard(it)), never list.map(wcard)
export const wcard = (it, sp = false) => `<a class="wcard" href="#/p/${esc(it.id)}"${sp === true ? ` data-imp="${esc(it.id)}"` : ''}>${media(it)}${sp === true ? '<span class="flag tag glass">Sponsored</span>' : ''}<div class="t"><b>${nameT(it)}</b><small>${icon('pin', 13)}${esc(areaName(it.area) || T('যশোর'))}${km(it) != null ? ' · ' + kmText(km(it)) : ''}</small></div></a>`;
export function crow(a) {
  const k = KINDS[a.kind];
  const meta = a.kind === 'job' ? [a.company, optLabel('jobType', a.jobType)] : a.kind === 'rent' ? [optLabel('propertyType', a.propertyType), a.rooms && T('{n} রুম', { n: num(a.rooms) })]
    : a.kind === 'tuition' ? [a.tuitionType && optLabel('tuitionType', a.tuitionType), a.subject, a.classLevel]
    : [optLabel('seatType', a.seatType), a.gender && optLabel('gender', a.gender)], d = km(a);
  return `<a class="row" href="#/ad/${esc(a.id)}">${media(a, '', k.color, k.icon)}<div class="body"><b>${esc(a.title)}</b>
    <div class="sub">${esc(meta.filter(Boolean).join(' · '))}${a.area ? ' · ' + esc(areaName(a.area)) : ''}${d != null ? ' · ' + kmText(d) : ''}</div>
    <div class="meta">${a.price ? `<span class="tag ok">${money(a.price)}${a.kind !== 'job' ? ' / ' + T('মাসে') : ''}</span>` : ''}<span class="muted">${fmtDate(a.t, { day: 'numeric', month: 'short' })}</span></div></div>
    <span class="act">${icon('chevR', 18)}</span></a>`;
}
export const empty = (title, msg, extra = '', ic = 'search') => `<div class="empty"><div class="eic">${icon(ic, 30)}</div><b>${title}</b>${msg ? `<div>${msg}</div>` : ''}${extra}</div>`;
export const topbar = (title, right = '<span class="spacer"></span>') => `<header class="topbar"><button class="roundbtn" data-back aria-label="${T('ফিরে যান')}">${icon('back', 20)}</button><h1>${esc(title)}</h1>${right}</header>`;
