/* Search: Bangla/English words, typos, intents like "near", "open now", budgets. */
import { S } from './state.js';
import { catOf, items } from './data.js';
import { areaName, toLatin } from './util.js';

/* ---------------- search ---------------- */
export const norm = s => toLatin(String(s || '').toLowerCase()).replace(/[.,!?।:;"'()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
let KEYS = [];
export const buildKeys = () => {
  KEYS = [];
  S.D.categories.forEach(c => {
    (c.keys || []).forEach(k => KEYS.push({ k: norm(k), cat: c.id }));
    [c.bn, c.en].forEach(k => k && KEYS.push({ k: norm(k), cat: c.id }));
    Object.entries(c.subs || {}).forEach(([sid, lbl]) => { KEYS.push({ k: norm(lbl), cat: c.id, sub: sid }); KEYS.push({ k: norm(sid), cat: c.id, sub: sid }); });
    Object.entries(c.subsEn || {}).forEach(([sid, lbl]) => KEYS.push({ k: norm(lbl), cat: c.id, sub: sid }));
  });
};
const SUBKEYS = { kacchi: 'biryani', kachchi: 'biryani', 'কাচ্চি': 'biryani', biryani: 'biryani', biriyani: 'biryani', 'বিরিয়ানি': 'biryani', pizza: 'fastfood',
  burger: 'fastfood', 'পিজা': 'fastfood', 'বার্গার': 'fastfood', coffee: 'cafe', cafe: 'cafe', 'কফি': 'cafe', 'চা': 'cafe', pharmacy: 'pharmacy',
  'ফার্মেসি': 'pharmacy', 'ফার্মেসী': 'pharmacy', 'ওষুধ': 'pharmacy', farmesi: 'pharmacy', dentist: 'dental', 'ডেন্টিস্ট': 'dental', 'দাঁত': 'dental',
  'চক্ষু': 'eye', 'চোখ': 'eye', police: 'police', 'পুলিশ': 'police', 'থানা': 'police', thana: 'police', fire: 'fire', 'ফায়ার': 'fire',
  ambulance: 'ambulance', 'অ্যাম্বুলেন্স': 'ambulance', 'এম্বুলেন্স': 'ambulance', 'মসজিদ': 'mosque', masjid: 'mosque', mosque: 'mosque',
  'ওসি': 'police', oc: 'police', 'নামাজ': 'mosque', namaz: 'mosque', 'ঈদগাহ': 'eidgah', eidgah: 'eidgah', 'হোমিও': 'homeo', 'হোমিওপ্যাথি': 'homeo', 'হোমিওপ্যাথিক': 'homeo',
  homeo: 'homeo', homio: 'homeo', homeopathy: 'homeo', homeopathic: 'homeo', 'চেম্বার': 'doctor', chamber: 'doctor' };
const KINDKEYS = { 'ভাড়া': 'rent', 'বাসা': 'rent', 'ফ্ল্যাট': 'rent', rent: 'rent', flat: 'rent', 'টুলেট': 'rent', tolet: 'rent', mess: 'mess', 'মেস': 'mess', 'সিট': 'mess',
  job: 'job', jobs: 'job', 'চাকরি': 'job', 'চাকরী': 'job', chakri: 'job', 'টিউশন': 'tuition', 'টিউশনি': 'tuition', tuition: 'tuition', tutor: 'tuition',
  'টিউটর': 'tuition', 'গৃহশিক্ষক': 'tuition', 'প্রাইভেট': 'tuition' };
const STOP = new Set(['যশোরে', 'যশোর', 'jashore', 'jessore', 'ভালো', 'valo', 'bhalo', 'best', 'good', 'আমার', 'খুঁজছি', 'চাই', 'কোথায়', 'in', 'the', 'a',
  'মধ্যে', 'টাকার', 'taka', 'tk', 'জন্য', 'সঙ্গে', 'নিয়ে', 'কম', 'বাজেটে', 'জায়গা', 'kothay', 'ki', 'কী', 'of', 'for', 'under', 'within']);
const NEAR = new Set(['কাছাকাছি', 'কাছে', 'near', 'nearby', 'nearest', 'kache', 'kachakachi', 'me']);
const OPEN = new Set(['খোলা', 'open', 'আজ', 'now', 'এখন', 'khola', '24', 'ঘণ্টা', 'today']);
export function search(text) {
  const tokens = norm(text).split(' ').filter(Boolean);
  const intent = { near: false, open: false, budget: null, cats: new Set(), sub: null, kind: null, halal: false }, words = [];
  tokens.forEach(t => {
    if (t === 'হালাল' || t === 'halal') return void (intent.halal = true);
    if (NEAR.has(t)) return void (intent.near = true);
    if (OPEN.has(t)) return void (intent.open = true);
    if (/^\d{2,5}$/.test(t) && +t >= 50 && t !== '999') return void (intent.budget = +t);
    if (STOP.has(t) || /^(a|b|ab|o)[+-]$/.test(t)) return;
    if (KINDKEYS[t]) intent.kind = KINDKEYS[t];
    if (SUBKEYS[t]) intent.sub = SUBKEYS[t];
    let hit = KEYS.find(x => x.k === t) || KEYS.find(x => t.length >= 3 && x.k.length >= 3 && (x.k.startsWith(t) || t.startsWith(x.k)));
    if (!hit && /^[a-z]{4,}$/.test(t)) hit = KEYS.find(x => /^[a-z]/.test(x.k) && lev(t, x.k) <= (t.length > 6 ? 2 : 1));
    if (hit) { intent.cats.add(hit.cat); if (hit.sub && !intent.sub) intent.sub = hit.sub; }
    words.push(t);
  });
  const scored = [];
  for (const it of items()) {
    const hay = norm([it.name, it.nameEn, it.area, areaName(it.area), it.address, (it.tags || []).join(' '), catOf(it).subs?.[it.sub], catOf(it).subsEn?.[it.sub], it.note, (it.contacts || []).map(c => [c.role, c.name].join(' ')).join(' ')].join(' '));
    let s = 0, nameHit = false;
    if (intent.cats.has(it.cat)) s += 4;
    if (intent.sub && intent.sub === it.sub) s += 4;
    for (const w of words) {
      if (norm(it.name).includes(w) || norm(it.nameEn).includes(w)) { s += 6; nameHit = true; }
      else if (hay.includes(w)) s += 3;
      else if (/^[a-z]{4,}$/.test(w) && hay.split(' ').some(h => lev(w, h) <= 1)) s += 2;
    }
    if (!words.length && intent.cats.has(it.cat)) s += 1;
    if (intent.cats.size && !intent.cats.has(it.cat) && s < 6) s = 0;
    if (s > 0) scored.push({ it, s: s + (it.rating || 0) / 5, nameHit });
  }
  const narrowed = intent.sub ? scored.filter(x => x.it.sub === intent.sub || x.nameHit) : [];
  const list = (narrowed.some(x => x.it.sub === intent.sub) ? narrowed : scored).sort((a, b) => b.s - a.s).map(x => x.it);
  return { list, intent };
}
