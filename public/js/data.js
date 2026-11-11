/* Data helpers: listings, categories, opening hours, areas, location and distances. */
import { S } from './state.js';
import { APP_UA, LANG, T, areaName, esc, loc, ls, num } from './util.js';

/* ---------------- data helpers ---------------- */
export const items = () => S.D.listings;
export const getItem = id => S.D.listings.find(i => i.id === id) || (S.D.aliases?.[id] ? S.D.listings.find(i => i.id === S.D.aliases[id]) : undefined);
export const catOf = it => S.CAT[it.cat] || { bn: '', icon: 'info', color: '#0e9f6e', subs: {} };
export const catName = c => (LANG() === 'en' ? c.en || c.bn : c.bn) || '';
export const subName = (c, sub) => (LANG() === 'en' && c.subsEn?.[sub]) || c.subs?.[sub] || '';
export const subLabel = it => subName(catOf(it), it.sub) || catName(catOf(it));
export const subIcon = it => catOf(it).subIcons?.[it.sub] || catOf(it).icon;
export const nameOf = it => loc(it, 'name');
// "street, area, Jashore" without saying the area or Jashore twice when the street address already has them
export function fullAddress(it) {
  const addr = (it.address || '').trim(), low = addr.toLowerCase(), area = areaName(it.area);
  const parts = [addr];
  if (it.area && !addr.includes(it.area) && !(area && low.includes(area.toLowerCase()))) parts.push(area);
  const all = parts.join(' ').toLowerCase();
  if (!/যশোর|jashore|jessore/.test(all)) parts.push(T('যশোর'));
  return parts.filter(Boolean).join(', ');
}
// Jobs & rent: the admin can show it always, hide it, or (default) show it only once there are ads
export function showClassifieds() {
  const mode = S.D?.site?.classifieds || 'auto';
  return mode === 'show' || (mode !== 'hide' && Object.values(S.D?.classifiedCounts || {}).some(n => n > 0));
}
export const PRICE_UNIT = { restaurant: 'জনপ্রতি', hotel: 'প্রতি রাত', service: 'থেকে শুরু' };
export const STATUS = { verified: ['যাচাইকৃত', 'ok'], pending: ['যাচাই চলছে', 'warn'], needs_update: ['আপডেট প্রয়োজন', 'warn'],
  temp_closed: ['সাময়িক বন্ধ', 'bad'], closed: ['স্থায়ীভাবে বন্ধ', 'bad'] };
export const KINDS = {
  rent: { bn: 'বাসা ভাড়া', icon: 'home', color: '#4f6bed' },
  mess: { bn: 'মেস / সিট ভাড়া', icon: 'bed', color: '#0f9fa8' },
  job: { bn: 'চাকরি', icon: 'briefcase', color: '#f2711c' },
  tuition: { bn: 'টিউশন', icon: 'cap', color: '#7c5cff' }
};
export const OPTS = {
  propertyType: [['family', 'ফ্যামিলি বাসা'], ['bachelor', 'ব্যাচেলর বাসা'], ['flat', 'ফ্ল্যাট'], ['room', 'রুম'], ['shop', 'দোকান'], ['office', 'অফিস']],
  seatType: [['single', 'সিঙ্গেল রুম'], ['double', 'ডাবল রুম'], ['shared', 'শেয়ারড সিট']],
  gender: [['male', 'ছেলে'], ['female', 'মেয়ে']],
  jobType: [['full', 'ফুলটাইম'], ['part', 'পার্টটাইম'], ['intern', 'ইন্টার্নশিপ'], ['remote', 'রিমোট']],
  tuitionType: [['need', 'শিক্ষক চাই'], ['offer', 'পড়াতে চাই']],
  medium: [['bangla', 'বাংলা মাধ্যম'], ['english', 'ইংলিশ ভার্সন'], ['emedium', 'ইংলিশ মিডিয়াম'], ['madrasa', 'মাদ্রাসা']],
  tutorGender: [['any', 'যেকোনো'], ['male', 'পুরুষ শিক্ষক'], ['female', 'মহিলা শিক্ষক']]
};
export const optLabel = (k, v) => T((OPTS[k] || []).find(o => o[0] === v)?.[1] || v || '');
export function isOpen(it, d = new Date()) {
  if (it.status === 'closed' || it.status === 'temp_closed') return false;
  if (!it.hours) return null;
  if (it.hours === '24h') return true;
  if (it.off && it.off.includes(d.getDay())) return false;
  const [a, b] = it.hours.split('-').map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; });
  const now = d.getHours() * 60 + d.getMinutes();
  return b > a ? now >= a && now < b : now >= a || now < b;
}
export function hoursText(it) {
  if (!it.hours) return T('সময়সূচি জানা নেই');
  if (it.hours === '24h') return T('২৪ ঘণ্টা খোলা');
  const days = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'], daysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const f = t => {
    let [h, m] = t.split(':').map(Number);
    if (LANG() === 'en') { const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return `${h}${m ? ':' + String(m).padStart(2, '0') : ''} ${ap}`; }
    const p = h < 5 ? 'রাত' : h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : h < 18 ? 'বিকাল' : 'রাত';
    h = h % 12 || 12; return `${p} ${num(h)}${m ? ':' + num(String(m).padStart(2, '0')) : ''}টা`;
  };
  const [a, b] = it.hours.split('-');
  const off = it.off?.length ? (LANG() === 'en' ? ` · Closed ${it.off.map(x => daysEn[x]).join(', ')}` : ` · ${it.off.map(x => days[x]).join(', ')}বার বন্ধ`) : '';
  return `${f(a)} – ${f(b)}${off}`;
}
export function locate() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('geo'));
    navigator.geolocation.getCurrentPosition(p => { S.here = { lat: p.coords.latitude, lng: p.coords.longitude }; ls.set('loc', S.here); res(S.here); },
      rej, { timeout: 9000, maximumAge: 600000 });
  });
}
// Wherever someone is, lists show the nearest places first. So the phone's position is taken by itself once per visit:
// on list pages it may ask for permission (once; never again after "no"), elsewhere only if permission was already given.
let autoAsked = false;
export function autoLocate(then, askIfNeeded = true) {
  if (autoAsked || !navigator.geolocation) return;
  const run = () => { autoAsked = true; locate().then(() => { S.originCache = null; then(); }).catch(() => {}); };
  // inside the Android app the browser's permission state is not reliable; Android asks (and remembers a "no") itself
  const perm = !APP_UA && navigator.permissions?.query?.({ name: 'geolocation' });
  if (!perm) { if (askIfNeeded) run(); return; }
  perm.then(p => { if (p.state === 'granted' || (askIfNeeded && p.state === 'prompt')) run(); else if (p.state === 'denied') autoAsked = true; }).catch(() => askIfNeeded && run());
}
/* Areas: upazilas, plus localities of Jashore town that count as part of Sadar */
const UPAZILAS = ['যশোর সদর', 'ঝিকরগাছা', 'চৌগাছা', 'মনিরামপুর', 'কেশবপুর', 'অভয়নগর', 'বাঘারপাড়া', 'শার্শা'];
export const PARENT = { 'বেনাপোল': 'শার্শা', 'নওয়াপাড়া': 'অভয়নগর' };
export const isTown = a => a && !UPAZILAS.includes(a) && !PARENT[a];
const AREA_KM = 1.2;
export function inArea(it, a) {
  if (!a) return true;
  const ia = it.area || '';
  if (ia === a || (a === 'যশোর সদর' && isTown(ia)) || PARENT[ia] === a || !!(it.address && it.address.includes(a))) return true;
  const g = isTown(a) && S.D.areaGeo?.[a];
  return !!g && it.lat != null && it.lng != null && dist({ lat: +g[0], lng: +g[1] }, it) <= AREA_KM;
}
export function dist(o, p) {
  const r = x => x * Math.PI / 180, dLa = r(p.lat - o.lat), dLo = r(p.lng - o.lng);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(r(o.lat)) * Math.cos(r(p.lat)) * Math.sin(dLo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
// The map point of an area: the one saved for it, or else the middle of the places listed in it
// (by their area, or with its name in the address).
export function areaPoint(a) {
  const g = S.D?.areaGeo?.[a];
  if (g) return { lat: +g[0], lng: +g[1] };
  const pts = items().filter(i => i.lat != null && i.cat !== 'emergency' && (i.area === a || (a.length > 2 && (i.address || '').includes(a))));
  return pts.length ? { lat: pts.reduce((s, i) => s + i.lat, 0) / pts.length, lng: pts.reduce((s, i) => s + i.lng, 0) / pts.length } : null;
}
/* Town areas sorted by where they are: the centre first, then north, east, south and west of it. Inside each group the
   areas follow each other on the map (each next one is the closest not yet listed), so neighbours sit side by side.
   Areas with no known point go last, in the admin's order. */
const SIDES = ['শহরের কেন্দ্র', 'উত্তর দিক', 'পূর্ব দিক', 'দক্ষিণ দিক', 'পশ্চিম দিক'];
export function townGroups(town) {
  const pts = new Map(town.map(a => [a, areaPoint(a)]).filter(([, p]) => p));
  if (pts.size < 4) return [{ label: '', areas: town }];
  const all = [...pts.values()];
  const c = pts.get('দড়াটানা') || { lat: all.reduce((s, p) => s + p.lat, 0) / all.length, lng: all.reduce((s, p) => s + p.lng, 0) / all.length };
  const groups = SIDES.map(label => ({ label, areas: [] }));
  for (const [a, p] of pts) {
    const deg = (Math.atan2((p.lng - c.lng) * Math.cos(c.lat * Math.PI / 180), p.lat - c.lat) * 180 / Math.PI + 360) % 360;
    groups[dist(c, p) <= 1 ? 0 : 1 + Math.floor(((deg + 45) % 360) / 90)].areas.push(a);
  }
  for (const g of groups) {
    const left = [...g.areas], out = [];
    let at = c;
    while (left.length) {
      let best = 0;
      left.forEach((a, i) => { if (dist(at, pts.get(a)) < dist(at, pts.get(left[best]))) best = i; });
      at = pts.get(left[best]);
      out.push(...left.splice(best, 1));
    }
    g.areas = out;
  }
  const rest = town.filter(a => !pts.has(a));
  if (rest.length) groups.push({ label: 'অন্যান্য এলাকা', areas: rest });
  return groups.filter(g => g.areas.length);
}
// Distances are measured from the phone's location, or else from the centre of the chosen area.
export function origin() {
  if (S.here) return { lat: S.here.lat, lng: S.here.lng, gps: true };
  const a = ls.get('area', ''); if (!a || !S.D) return null;
  if (S.originCache?.a === a && S.originCache.v === S.D.v) return S.originCache.o;
  const o = areaPoint(a);
  if (o) o.area = a;
  S.originCache = { a, v: S.D.v, o };
  return o;
}
export function km(it) {
  const o = origin();
  if (!o || it.lat == null || it.lng == null) return null;
  return dist(o, it);
}
export const fromWhere = () => { const o = origin(); return !o ? '' : o.gps ? T('আপনার থেকে') : T('{a} থেকে', { a: esc(areaName(o.area)) }); };
export const kmText = k => k == null ? '' : Math.round(k * 20) * 50 < 1000 ? T('{n} মি.', { n: num(Math.round(k * 20) * 50) }) : T('{n} কিমি', { n: num(k.toFixed(k < 10 ? 1 : 0)) });
const mq = it => encodeURIComponent([it.nameEn || it.name, it.address, it.area, 'Jashore', 'Bangladesh'].filter(Boolean).join(', '));
const ll = it => it.lat != null && it.lng != null ? `${it.lat},${it.lng}` : null;
export const mapUrl = it => it.mapUrl || `https://www.google.com/maps/search/?api=1&query=${ll(it) || mq(it)}`;
export const dirUrl = it => `https://www.google.com/maps/dir/?api=1&destination=${ll(it) || mq(it)}`;

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  S.here = ls.get('loc', null);
  S.originCache = null;
}
