/* Jashore360 — public app. Vanilla JS, data from /api/bootstrap. Strings are written in Bangla and wrapped in T(). */
(() => {
  'use strict';

  const app = document.getElementById('app');
  const nav = document.getElementById('fnav');
  let D = null, CAT = {}, ME = null;

  /* ---------------- utils & i18n ---------------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BN = '০১২৩৪৫৬৭৮৯';
  const toLatin = s => String(s ?? '').replace(/[০-৯]/g, d => BN.indexOf(d));
  const ls = {
    get(k, d) { try { const v = localStorage.getItem('j360.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('j360.' + k, JSON.stringify(v)); } catch {} }
  };
  const LANG = () => ls.get('lang', 'bn');
  const T = (s, v) => { let r = LANG() === 'en' ? (window.I18N_EN?.[s] ?? s) : s; return v ? r.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '') : r; };
  const num = n => LANG() === 'bn' ? String(n).replace(/\d/g, d => BN[d]) : String(n);
  const money = n => '৳' + num(Number(n).toLocaleString('en-IN'));
  const loc = (o, f) => (LANG() === 'en' && o?.[f + 'En']) || o?.[f] || '';
  const areaName = a => (LANG() === 'en' && window.AREA_EN?.[a]) || a || '';
  const fmtDate = (t, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => t ? new Date(typeof t === 'number' ? t * 1000 : t).toLocaleDateString(LANG() === 'bn' ? 'bn-BD' : 'en-GB', opts) : '';
  const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.5s-7.2-6.3-7.2-11.8a7.2 7.2 0 0 1 14.4 0c0 5.5-7.2 11.8-7.2 11.8z" fill="#fff"/><circle cx="12" cy="9.6" r="2.8" fill="#0e9f6e"/></svg>';
  const APP_UA = navigator.userAgent.match(/Jashore360App\/(\d+)/);

  let toastT;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800);
  }

  async function api(path, body, method) {
    const r = await fetch('/api' + path, {
      method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined
    });
    const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (r.status === 401 && ME) { ME = null; }
    if (!r.ok) throw new Error(T(data.error || 'সংযোগে সমস্যা হয়েছে, আবার চেষ্টা করুন'));
    return data;
  }
  const beacon = (path, data) => { try { navigator.sendBeacon('/api' + path, new Blob([JSON.stringify(data)], { type: 'application/json' })); } catch {} };
  const track = (id, type) => beacon('/track', { id, type });

  function compress(file, max = 1600, q = .82) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        cv.toBlob(b => b ? res(b) : rej(new Error(T('ছবিটি পড়া যায়নি'))), 'image/jpeg', q);
      };
      img.onerror = () => rej(new Error(T('ছবিটি পড়া যায়নি')));
      img.src = url;
    });
  }

  function upload(blob, type, onprogress) {
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open('POST', '/api/my/media');
      x.setRequestHeader('Content-Type', type);
      x.upload.onprogress = e => e.lengthComputable && onprogress(Math.round(e.loaded / e.total * 100));
      x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} x.status < 300 ? res(d) : rej(new Error(T(d.error || 'আপলোড হয়নি, আবার চেষ্টা করুন'))); };
      x.onerror = () => rej(new Error(T('আপলোড হয়নি — ইন্টারনেট সংযোগ পরীক্ষা করুন')));
      x.send(blob);
    });
  }

  /* ---------------- theme ---------------- */
  function applyTheme() {
    const t = ls.get('theme', 'auto');
    t === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t);
    document.documentElement.lang = LANG();
  }
  applyTheme();

  /* ---------------- data helpers ---------------- */
  const items = () => D.listings;
  const getItem = id => D.listings.find(i => i.id === id);
  const catOf = it => CAT[it.cat] || { bn: '', icon: 'info', color: '#0e9f6e', subs: {} };
  const catName = c => (LANG() === 'en' ? c.en || c.bn : c.bn) || '';
  const subName = (c, sub) => (LANG() === 'en' && c.subsEn?.[sub]) || c.subs?.[sub] || '';
  const subLabel = it => subName(catOf(it), it.sub) || catName(catOf(it));
  const subIcon = it => catOf(it).subIcons?.[it.sub] || catOf(it).icon;
  const nameOf = it => loc(it, 'name');
  const PRICE_UNIT = { restaurant: 'জনপ্রতি', hotel: 'প্রতি রাত', service: 'থেকে শুরু' };
  const STATUS = { verified: ['যাচাইকৃত', 'ok'], pending: ['যাচাই চলছে', 'warn'], needs_update: ['আপডেট প্রয়োজন', 'warn'],
    temp_closed: ['সাময়িক বন্ধ', 'bad'], closed: ['স্থায়ীভাবে বন্ধ', 'bad'] };
  const KINDS = {
    rent: { bn: 'বাসা ভাড়া', icon: 'home', color: '#4f6bed' },
    mess: { bn: 'মেস / সিট ভাড়া', icon: 'bed', color: '#0f9fa8' },
    job: { bn: 'চাকরি', icon: 'briefcase', color: '#f2711c' }
  };
  const OPTS = {
    propertyType: [['family', 'ফ্যামিলি বাসা'], ['bachelor', 'ব্যাচেলর বাসা'], ['flat', 'ফ্ল্যাট'], ['room', 'রুম'], ['shop', 'দোকান'], ['office', 'অফিস']],
    seatType: [['single', 'সিঙ্গেল রুম'], ['double', 'ডাবল রুম'], ['shared', 'শেয়ারড সিট']],
    gender: [['male', 'ছেলে'], ['female', 'মেয়ে']],
    jobType: [['full', 'ফুলটাইম'], ['part', 'পার্টটাইম'], ['intern', 'ইন্টার্নশিপ'], ['remote', 'রিমোট']]
  };
  const optLabel = (k, v) => T((OPTS[k] || []).find(o => o[0] === v)?.[1] || v || '');

  function isOpen(it, d = new Date()) {
    if (it.status === 'closed' || it.status === 'temp_closed') return false;
    if (!it.hours) return null;
    if (it.hours === '24h') return true;
    if (it.off && it.off.includes(d.getDay())) return false;
    const [a, b] = it.hours.split('-').map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; });
    const now = d.getHours() * 60 + d.getMinutes();
    return b > a ? now >= a && now < b : now >= a || now < b;
  }
  function hoursText(it) {
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

  let here = ls.get('loc', null);
  function locate() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('geo'));
      navigator.geolocation.getCurrentPosition(p => { here = { lat: p.coords.latitude, lng: p.coords.longitude }; ls.set('loc', here); res(here); },
        rej, { timeout: 9000, maximumAge: 600000 });
    });
  }
  function km(it) {
    if (!here || it.lat == null) return null;
    const r = x => x * Math.PI / 180, dLa = r(it.lat - here.lat), dLo = r(it.lng - here.lng);
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(r(here.lat)) * Math.cos(r(it.lat)) * Math.sin(dLo / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
  }
  const kmText = k => k == null ? '' : k < 1 ? T('{n} মি.', { n: num(Math.round(k * 20) * 50) }) : T('{n} কিমি', { n: num(k.toFixed(k < 10 ? 1 : 0)) });
  const mq = it => encodeURIComponent([it.nameEn || it.name, it.address, it.area, 'Jashore', 'Bangladesh'].filter(Boolean).join(', '));
  const mapUrl = it => `https://www.google.com/maps/search/?api=1&query=${mq(it)}`;
  const dirUrl = it => `https://www.google.com/maps/dir/?api=1&destination=${mq(it)}`;

  /* ---------------- components ---------------- */
  const media = (it, cls = '', color, ic) => {
    const img = it.images?.[0];
    return `<div class="media ${cls}" style="--c:${esc(color || catOf(it).color)}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async">`
      : `<div class="gen"><div class="ring">${icon(ic || subIcon(it), 40)}</div></div>`}</div>`;
  };
  const starsHtml = (v, size = 14) => `<span class="stars">${[1, 2, 3, 4, 5].map(i => icon('star', size, v >= i - .3 ? 'on' : '')).join('')}</span>`;
  const rateTag = it => it.rating ? `<span class="rate">${icon('star', 13)}${num(it.rating.toFixed(1))}<span class="muted" style="font-weight:400">(${num(it.reviews)})</span></span>` : '';
  const statusTag = it => { const [t, k] = STATUS[it.status] || STATUS.pending; return `<span class="tag ${k}">${k === 'ok' ? icon('check', 12) : ''}${T(t)}</span>`; };
  function openTag(it) {
    const o = isOpen(it);
    if (o && it.hours === '24h') return `<span class="tag ok">${T('২৪ ঘণ্টা')}</span>`;
    return o === true ? `<span class="tag ok">${T('খোলা')}</span>` : o === false ? `<span class="tag bad">${T('বন্ধ')}</span>` : '';
  }
  const saved = () => ls.get('saved', []);
  const isSaved = id => saved().includes(id);
  const heart = id => `<button class="heartbtn ${isSaved(id) ? 'on' : ''}" data-save="${esc(id)}" aria-label="${T('সেভ')}">${icon('heart', 17)}</button>`;

  function gcard(it) {
    return `<a class="gcard" href="#/p/${esc(it.id)}">${media(it)}${heart(it.id)}
      ${it.sponsored ? '<span class="flag tag glass">Sponsored</span>' : it.demo ? `<span class="flag tag dark">${T('নমুনা')}</span>` : ''}
      <div class="cap"><small>${esc(subLabel(it))}${it.area ? ' · ' + esc(areaName(it.area)) : ''}</small><b>${esc(nameOf(it))}</b>
        <div class="meta"><span>${it.price ? money(it.price) : isOpen(it) === true ? T('এখন খোলা') : ''}</span>${it.rating ? `<span class="rate">${icon('star', 12)}${num(it.rating.toFixed(1))}</span>` : ''}</div></div></a>`;
  }
  function row(it) {
    const d = km(it);
    const act = it.phone ? `<span class="act ${it.cat === 'emergency' ? 'red' : ''}" data-call="${esc(it.phone)}" data-id="${esc(it.id)}" role="button" aria-label="${T('কল')}">${icon('phone', 18)}</span>`
      : `<span class="act">${icon('chevR', 18)}</span>`;
    return `<a class="row" href="#/p/${esc(it.id)}">${media(it)}<div class="body"><b>${esc(nameOf(it))}</b>
      <div class="sub">${esc(subLabel(it))}${it.area ? ' · ' + esc(areaName(it.area)) : ''}${d != null ? ' · ' + kmText(d) : ''}</div>
      <div class="meta">${rateTag(it)}${openTag(it)}${it.price ? `<span class="tag">${money(it.price)}</span>` : ''}${it.sponsored ? '<span class="tag ad">Sponsored</span>' : ''}${it.demo ? `<span class="tag">${T('নমুনা')}</span>` : ''}</div></div>${act}</a>`;
  }
  const wcard = it => `<a class="wcard" href="#/p/${esc(it.id)}">${media(it)}<div class="t"><b>${esc(nameOf(it))}</b><small>${icon('pin', 13)}${esc(areaName(it.area) || T('যশোর'))}${km(it) != null ? ' · ' + kmText(km(it)) : ''}</small></div></a>`;
  function crow(a) {
    const k = KINDS[a.kind];
    const meta = a.kind === 'job' ? [a.company, optLabel('jobType', a.jobType)] : a.kind === 'rent' ? [optLabel('propertyType', a.propertyType), a.rooms && T('{n} রুম', { n: num(a.rooms) })]
      : [optLabel('seatType', a.seatType), a.gender && optLabel('gender', a.gender)];
    return `<a class="row" href="#/ad/${esc(a.id)}">${media(a, '', k.color, k.icon)}<div class="body"><b>${esc(a.title)}</b>
      <div class="sub">${esc(meta.filter(Boolean).join(' · '))}${a.area ? ' · ' + esc(areaName(a.area)) : ''}</div>
      <div class="meta">${a.price ? `<span class="tag ok">${money(a.price)}${a.kind !== 'job' ? ' / ' + T('মাসে') : ''}</span>` : ''}<span class="muted">${fmtDate(a.t, { day: 'numeric', month: 'short' })}</span></div></div>
      <span class="act">${icon('chevR', 18)}</span></a>`;
  }
  const empty = (title, msg, extra = '', ic = 'search') => `<div class="empty"><div class="eic">${icon(ic, 30)}</div><b>${title}</b>${msg ? `<div>${msg}</div>` : ''}${extra}</div>`;
  const topbar = (title, right = '<span class="spacer"></span>') => `<header class="topbar"><button class="roundbtn" data-back aria-label="${T('ফিরে যান')}">${icon('back', 20)}</button><h1>${esc(title)}</h1>${right}</header>`;

  /* ---------------- ads (managed by the main admin) ---------------- */
  const adsFor = (placement, cat) => (D.ads || []).filter(a => (a.placement || 'home') === placement && (!a.category || !cat || a.category === cat));
  const seenAds = new Set();
  function adImpressions() {
    app.querySelectorAll('[data-ad]').forEach(el => { const id = el.dataset.ad; if (!seenAds.has(id)) { seenAds.add(id); beacon('/adtrack', { id, type: 'imp' }); } });
  }
  function adCard(a, cls = 'banner') {
    const ext = /^https?:/.test(a.link || '');
    return `<a class="${cls} ${esc(a.theme || 'dark')}" data-ad="${esc(a.id)}" href="${esc(a.link || '#/')}" ${ext ? 'target="_blank" rel="noopener sponsored"' : ''}>
      ${a.image ? `<img class="bimg" src="${esc(a.image)}" alt="" loading="lazy">` : `<span class="deco">${icon(a.link?.startsWith('tel:') ? 'phone' : a.link === '#/add' ? 'store' : 'sparkle', 150)}</span>`}
      <div class="btext">${loc(a, 'kicker') ? `<small>${esc(loc(a, 'kicker'))}</small>` : ''}<h3>${esc(loc(a, 'title'))}</h3>${loc(a, 'subtitle') ? `<p>${esc(loc(a, 'subtitle'))}</p>` : ''}</div>
      ${loc(a, 'cta') ? `<span class="bcta">${esc(loc(a, 'cta'))}</span>` : ''}</a>`;
  }
  const adStrip = (placement, cat) => { const a = adsFor(placement, cat)[0]; return a ? `<div class="adslot-inline">${adCard(a, 'banner slim')}</div>` : ''; };

  /* ---------------- search ---------------- */
  const norm = s => toLatin(String(s || '').toLowerCase()).replace(/[.,!?।:;"'()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
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
  const buildKeys = () => {
    KEYS = [];
    D.categories.forEach(c => {
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
    ambulance: 'ambulance', 'অ্যাম্বুলেন্স': 'ambulance', 'এম্বুলেন্স': 'ambulance' };
  const KINDKEYS = { 'ভাড়া': 'rent', 'বাসা': 'rent', 'ফ্ল্যাট': 'rent', rent: 'rent', flat: 'rent', 'টুলেট': 'rent', tolet: 'rent', mess: 'mess', 'মেস': 'mess', 'সিট': 'mess',
    job: 'job', jobs: 'job', 'চাকরি': 'job', 'চাকরী': 'job', chakri: 'job' };
  const STOP = new Set(['যশোরে', 'যশোর', 'jashore', 'jessore', 'ভালো', 'valo', 'bhalo', 'best', 'good', 'আমার', 'খুঁজছি', 'চাই', 'কোথায়', 'in', 'the', 'a',
    'মধ্যে', 'টাকার', 'taka', 'tk', 'জন্য', 'সঙ্গে', 'নিয়ে', 'কম', 'বাজেটে', 'জায়গা', 'kothay', 'ki', 'কী', 'of', 'for', 'under', 'within']);
  const NEAR = new Set(['কাছাকাছি', 'কাছে', 'near', 'nearby', 'nearest', 'kache', 'kachakachi', 'me']);
  const OPEN = new Set(['খোলা', 'open', 'আজ', 'now', 'এখন', 'khola', '24', 'ঘণ্টা', 'today']);

  function search(text) {
    const tokens = norm(text).split(' ').filter(Boolean);
    const intent = { near: false, open: false, budget: null, cats: new Set(), sub: null, kind: null }, words = [];
    tokens.forEach(t => {
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
      const hay = norm([it.name, it.nameEn, it.area, areaName(it.area), it.address, (it.tags || []).join(' '), catOf(it).subs?.[it.sub], catOf(it).subsEn?.[it.sub], it.note].join(' '));
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

  /* ---------------- sheets ---------------- */
  function openSheet(html, mount) {
    closeSheet(true);
    const scrim = document.createElement('div'), sh = document.createElement('div');
    scrim.className = 'scrim'; sh.className = 'sheet'; sh.setAttribute('role', 'dialog');
    sh.innerHTML = `<div class="grab"></div>${html}`;
    document.body.append(scrim, sh);
    requestAnimationFrame(() => { scrim.classList.add('show'); sh.classList.add('show'); });
    scrim.onclick = () => closeSheet();
    mount && mount(sh);
    return sh;
  }
  function closeSheet(now) {
    document.querySelectorAll('.scrim, .sheet').forEach(el => { el.classList.remove('show'); now ? el.remove() : setTimeout(() => el.remove(), 300); });
  }
  const sheetHead = t => `<div class="shead"><h3>${t}</h3><button class="roundbtn" data-close aria-label="${T('বন্ধ')}">${icon('x', 18)}</button></div>`;

  function filterSheet(p) {
    const cats = D.categories.filter(c => c.id !== 'emergency');
    const budget = +p.get('budget') || 0;
    openSheet(`${sheetHead(T('ফিল্টার'))}
      <h4>${T('ক্যাটাগরি')}</h4><div class="pills wrap">${[{ id: '' }, ...cats].map(c =>
        `<button class="pill sm ${(p.get('cat') || '') === c.id ? 'on' : ''}" data-fcat="${c.id}">${c.icon ? icon(c.icon, 15) : ''}${esc(c.id ? catName(c) : T('সব'))}</button>`).join('')}</div>
      <h4>${T('বাজেট (জনপ্রতি)')}</h4><input class="range" type="range" min="0" max="2000" step="50" value="${budget || 2000}" data-fbudget>
      <div class="rangeval"><span>${money(0)}</span><b data-fbval>${budget ? T('{n} পর্যন্ত', { n: money(budget) }) : T('যেকোনো')}</b><span>${money(2000)}+</span></div>
      <h4>${T('সাজানো')}</h4><div class="seg">${[['', 'প্রাসঙ্গিক'], ['rating', 'রেটিং'], ['near', 'কাছাকাছি']].map(([k, v]) =>
        `<button class="${(p.get('sort') || '') === k ? 'on' : ''}" data-fsort="${k}">${T(v)}</button>`).join('')}</div>
      <label class="switch" style="margin-top:16px"><span>${T('শুধু এখন খোলা')}</span><input type="checkbox" data-fopen ${p.get('open') ? 'checked' : ''}></label>
      <div class="two" style="margin-top:20px"><button class="btn ghost" data-freset>${T('রিসেট')}</button><button class="btn" data-fapply>${T('ফলাফল দেখুন')}</button></div>`, sh => {
      const st = { cat: p.get('cat') || '', sort: p.get('sort') || '', budget, open: !!p.get('open') };
      sh.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if ('fcat' in b.dataset) { st.cat = b.dataset.fcat; sh.querySelectorAll('[data-fcat]').forEach(x => x.classList.toggle('on', x === b)); }
        if ('fsort' in b.dataset) { st.sort = b.dataset.fsort; sh.querySelectorAll('[data-fsort]').forEach(x => x.classList.toggle('on', x === b)); }
        if ('freset' in b.dataset) { closeSheet(); go('#/search'); }
        if ('fapply' in b.dataset) {
          st.open = sh.querySelector('[data-fopen]').checked;
          const np = new URLSearchParams();
          if (p.get('q')) np.set('q', p.get('q'));
          if (st.cat) np.set('cat', st.cat); if (st.sort) np.set('sort', st.sort);
          if (st.budget && st.budget < 2000) np.set('budget', st.budget); if (st.open) np.set('open', '1');
          closeSheet();
          if (st.sort === 'near' && !here) return doLocate('#/search?' + np);
          go('#/search?' + np);
        }
      });
      const r = sh.querySelector('[data-fbudget]');
      r.oninput = () => { st.budget = +r.value; sh.querySelector('[data-fbval]').textContent = +r.value >= 2000 ? T('যেকোনো') : T('{n} পর্যন্ত', { n: money(r.value) }); };
    });
  }

  function noticesSheet() {
    const list = D.notices || [];
    ls.set('seenNotices', list.map(n => n.id));
    openSheet(`${sheetHead(T('ঘোষণা ও আপডেট'))}${list.map(n => `<div class="notice"><small>${esc(fmtDate(n.date))}</small>
      <b style="display:block">${n.type === 'alert' ? '⚠ ' : ''}${esc(loc(n, 'title'))}</b><p>${esc(loc(n, 'body'))}</p></div>`).join('') || empty(T('কোনো ঘোষণা নেই'), '', '', 'bell')}`);
    document.querySelector('.homebar .dot')?.remove();
  }

  function areaSheet() {
    const cur = ls.get('area', '');
    openSheet(`${sheetHead(T('আপনার এলাকা'))}<p class="muted" style="margin:-6px 0 14px;font-size:13px">${T('এলাকা বাছলে সেই এলাকার তথ্য আগে দেখাবে।')}</p>
      <div class="pills wrap">${['', ...(D.areas || [])].map(a => `<button class="pill sm ${a === cur ? 'on' : ''}" data-area="${esc(a)}">${esc(a ? areaName(a) : T('পুরো যশোর'))}</button>`).join('')}</div>`, sh => {
      sh.addEventListener('click', e => { const b = e.target.closest('[data-area]'); if (b) { ls.set('area', b.dataset.area); closeSheet(); render(); } });
    });
  }

  function reportSheet(target) {
    const review = target.review;
    openSheet(`${sheetHead(review ? T('রিভিউ রিপোর্ট করুন') : T('ভুল তথ্য জানান'))}
      <div class="form"><label class="field"><span>${review ? T('কেন অনুপযুক্ত?') : T('কী ভুল আছে?')}</span>
      <textarea maxlength="600" placeholder="${review ? T('ভুয়া, অপমানজনক, ব্যক্তিগত তথ্য…') : T('ফোন নম্বর বদলেছে, ঠিকানা ভুল, বন্ধ হয়ে গেছে, ভুয়া বিজ্ঞাপন…')}"></textarea></label>
      <button class="btn block" data-send>${T('পাঠান')}</button></div>`, sh => {
      sh.querySelector('[data-send]').onclick = async () => {
        const reason = sh.querySelector('textarea').value.trim();
        if (!reason) return toast(T('কারণ লিখুন'));
        try { await api('/reports', { ...target, reason }); closeSheet(); toast(T('ধন্যবাদ! আমরা দ্রুত পর্যালোচনা করব।')); } catch (e) { toast(e.message); }
      };
    });
  }

  function reviewSheet(it) {
    if (!requireLogin()) return;
    const crit = catOf(it).criteria || [];
    const pick = (f, sm = '') => `<div class="starpick ${sm}" data-field="${f}">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-v="${i}" aria-label="${num(i)}">${icon('star', 24)}</button>`).join('')}</div>`;
    openSheet(`${sheetHead(T('রিভিউ লিখুন'))}<div class="form">
      <div style="text-align:center"><div class="muted" style="font-size:13px;margin-bottom:8px">${esc(nameOf(it))}</div>${pick('stars')}</div>
      ${crit.map((x, n) => `<div class="critrow"><span>${esc(T(x))}</span>${pick('c' + n, 'sm')}</div>`).join('')}
      <label class="field"><span>${T('অভিজ্ঞতা')}</span><textarea maxlength="1500" data-text placeholder="${T('কেমন লাগল? অন্যদের জন্য উপকারী তথ্য লিখুন')}"></textarea></label>
      <div class="photos" data-photos><label>${icon('camera', 22)}<input type="file" accept="image/*"></label></div>
      ${it.cat === 'hospital' ? `<div class="note warn">${icon('info', 16)}<span>${T('রোগীর ব্যক্তিগত তথ্য লিখবেন না। চিকিৎসক সম্পর্কে অভিযোগ বিশেষ মডারেশনে যায়।')}</span></div>` : ''}
      <p class="muted" style="font-size:12.5px;margin:0">${T('রিভিউতে আপনার নাম দেখাবে: {name}', { name: esc(ME.name) })}</p>
      <button class="btn block" data-submit>${T('রিভিউ জমা দিন')}</button></div>`, sh => {
      let photo = null;
      sh.addEventListener('click', e => {
        const b = e.target.closest('.starpick button');
        if (b) { const p = b.parentElement; p.dataset.val = b.dataset.v; p.querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.v <= +b.dataset.v)); }
        if (e.target.closest('[data-rmphoto]')) { photo = null; sh.querySelector('.ph')?.remove(); }
      });
      sh.querySelector('input[type=file]').onchange = async e => {
        try { photo = await compress(e.target.files[0], 1080, .78);
          sh.querySelector('.ph')?.remove();
          sh.querySelector('[data-photos]').insertAdjacentHTML('afterbegin', `<div class="ph"><img src="${photo}" alt=""><button data-rmphoto>${icon('x', 14)}</button></div>`);
        } catch (er) { toast(er.message); }
      };
      sh.querySelector('[data-submit]').onclick = async ev => {
        const stars = +sh.querySelector('[data-field=stars]').dataset.val || 0;
        if (!stars) return toast(T('স্টার রেটিং দিন'));
        const cr = {}; crit.forEach((k, n) => { const v = +sh.querySelector(`[data-field=c${n}]`).dataset.val; if (v) cr[k] = v; });
        ev.target.disabled = true;
        try {
          await api('/reviews', { listing: it.id, stars, crit: cr, text: sh.querySelector('[data-text]').value, photo });
          closeSheet(); toast(T('রিভিউয়ের জন্য ধন্যবাদ!')); await refresh(); render();
        } catch (er) { toast(er.message); ev.target.disabled = false; }
      };
    });
  }

  function requireLogin() {
    if (ME) return true;
    toast(T('এর জন্য অ্যাকাউন্টে লগইন করুন'));
    go('#/login?next=' + encodeURIComponent(location.hash.slice(1) || '/'));
    return false;
  }

  /* ---------------- pages ---------------- */
  const pages = {};

  pages.home = () => {
    const site = D.site || {}, area = ls.get('area', '');
    const unseen = (D.notices || []).some(n => !ls.get('seenNotices', []).includes(n.id));
    const pop = pages.home.pop || '';
    const pool = items().filter(i => i.cat !== 'emergency' && (!pop || i.cat === pop));
    const ranked = pool.slice().sort((a, b) => (!!b.featured - !!a.featured) || ((b.rating || 0) - (a.rating || 0)) || ((a.area === area) ? -1 : 0) || (!!a.demo - !!b.demo)).slice(0, 6);
    const near = here ? items().filter(i => i.lat != null && i.cat !== 'emergency').sort((a, b) => km(a) - km(b)).slice(0, 4) : [];
    const places = items().filter(i => i.cat === 'place');
    const recent = ls.get('recent', []).map(getItem).filter(Boolean).slice(0, 3);
    const cats = D.categories.filter(c => c.id !== 'emergency');
    const short = c => LANG() === 'en' ? c.en : c.bn.split(' ')[0];
    const quick = [['ambulance', 'ambulance', 'অ্যাম্বুলেন্স'], ['hospital', 'hospital', 'হাসপাতাল'], ['police', 'shield', 'পুলিশ'], ['fire', 'flame', 'ফায়ার'], ['', 'phone', 'সব নম্বর']];
    const headline = esc(loc(site, 'headline') || T('যশোরের সবকিছু খুঁজুন এক জায়গায়')).replace(/(যশোর\S*|Jashore)/, '<span>$1</span>');
    const banners = adsFor('home');
    const counts = D.classifiedCounts || {};
    const update = APP_UA && D.app?.versionCode > +APP_UA[1];
    return `
    <header class="homebar"><a class="brandmark" href="#/" aria-label="Jashore360">${LOGO}</a>
      <button class="loc" data-areasheet><small>${T('আপনার এলাকা')}</small><b>${esc(area ? areaName(area) : T('পুরো যশোর'))}${icon('chevD', 16)}</b></button>
      <button class="roundbtn lang" data-lang aria-label="Language">${LANG() === 'bn' ? 'EN' : 'বাং'}</button>
      <button class="roundbtn" data-notices aria-label="${T('ঘোষণা ও আপডেট')}">${icon('bell', 20)}${unseen ? '<i class="dot"></i>' : ''}</button></header>
    ${update ? `<a class="note" href="/download/jashore360.apk" style="margin-top:12px">${icon('download', 18)}<span><b>${T('নতুন ভার্সন এসেছে')}</b> — ${T('আপডেট করতে চাপুন')} (v${esc(D.app.versionName)})</span></a>` : ''}
    <h1 class="headline">${headline}</h1>
    <div class="searchrow"><a class="search" href="#/search">${icon('search', 20)}<span>${T('খুঁজুন: হাসপাতাল, কাচ্চি, বাসা ভাড়া…')}</span></a>
      <button class="filterbtn" data-filter aria-label="${T('ফিল্টার')}">${icon('sliders', 20)}</button></div>

    ${banners.length ? `<div class="banners" data-carousel>${banners.map(b => adCard(b)).join('')}</div>
      ${banners.length > 1 ? `<div class="dots" data-dots>${banners.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}` : ''}

    <section class="emg">
      <div class="emg-top"><span class="ib">${icon('siren', 22)}</span><div><b>${T('জরুরি সহায়তা')}</b><small>${esc(loc(site, 'hotlineNote'))}</small></div>
        <a class="callpill" href="tel:${esc(site.hotline || '999')}">${icon('phone', 18)}${num(site.hotline || '999')}</a></div>
      <div class="emg-grid">${quick.map(([s, i, t]) => `<a href="${s === 'hospital' ? '#/c/hospital?sub=govt' : '#/emergency' + (s ? '?sub=' + s : '')}"><span>${icon(i, 22)}</span>${T(t)}</a>`).join('')}</div>
    </section>

    <section class="sec"><div class="sechead"><h2>${T('ক্যাটাগরি')}</h2><a href="#/explore">${T('সব দেখুন')}${icon('chevR', 14)}</a></div>
      <div class="cats">${cats.map(c => `<a class="catt" href="#/c/${c.id}"><span style="--c:${esc(c.color)}">${icon(c.icon, 26)}</span>${esc(short(c))}</a>`).join('')}</div></section>

    <section class="sec"><div class="sechead"><h2>${T('ভাড়া ও চাকরি')}</h2></div>
      <div class="ktiles">${Object.entries(KINDS).map(([k, v]) => `<a href="#/ads/${k}" style="--c:${v.color}"><span>${icon(v.icon, 22)}</span><b>${T(v.bn)}</b><small>${T('{n}টি বিজ্ঞাপন', { n: num(counts[k] || 0) })}</small></a>`).join('')}</div></section>

    <section class="sec"><div class="sechead"><h2>${T('জনপ্রিয়')}</h2><a href="#/${pop ? 'c/' + pop : 'search'}">${T('সব দেখুন')}${icon('chevR', 14)}</a></div>
      <div class="pills">${[{ id: '' }, ...cats].map(c => `<button class="pill ${pop === c.id ? 'on' : ''}" data-pop="${c.id}">${esc(c.id ? short(c) : T('সব'))}</button>`).join('')}</div>
      <div class="grid2">${ranked.map(gcard).join('') || `<p class="muted">${T('এই ক্যাটাগরিতে এখনো তথ্য নেই।')}</p>`}</div></section>

    ${adStrip('inline')}

    <section class="sec"><div class="sechead"><h2>${T('আপনার কাছাকাছি')}</h2>${here ? `<button class="linkbtn" data-locate>${icon('refresh', 14)} ${T('রিফ্রেশ')}</button>` : ''}</div>
      ${here ? `<div class="rows">${near.map(row).join('')}</div>` :
        `<button class="row" style="width:100%;border:0;text-align:left" data-locate><span class="media" style="--c:#0e9f6e;width:56px;height:56px"><span class="gen"><span class="ring" style="width:70%">${icon('nav', 26)}</span></span></span>
        <span class="body"><b>${T('লোকেশন চালু করুন')}</b><span class="sub" style="white-space:normal">${T('কাছাকাছি হাসপাতাল, ফার্মেসি ও দোকান দূরত্বসহ দেখুন')}</span></span><span class="act">${icon('chevR', 18)}</span></button>`}</section>

    ${places.length ? `<section class="sec"><div class="sechead"><h2>${T('যশোর ঘুরে দেখুন')}</h2><a href="#/c/place">${T('সব দেখুন')}${icon('chevR', 14)}</a></div>
      <div class="wcards">${places.map(wcard).join('')}</div></section>` : ''}

    ${recent.length ? `<section class="sec"><div class="sechead"><h2>${T('সম্প্রতি দেখেছেন')}</h2></div><div class="rows">${recent.map(row).join('')}</div></section>` : ''}

    <a class="bizcta" href="#/add"><span>${icon('store', 24)}</span><div><b>${T('আপনার ব্যবসা যুক্ত করুন')}</b><small>${T('হাজারো মানুষের কাছে পৌঁছান — অ্যাকাউন্ট খুলে শুরু করুন')}</small></div>${icon('chevR', 18)}</a>
    <p class="foot">${esc(loc(site, 'disclaimer'))}</p>`;
  };

  pages.emergency = p => {
    const c = CAT.emergency || { subs: {}, subIcons: {} }, sub = p.get('sub') || '', site = D.site || {};
    let list = items().filter(i => i.cat === 'emergency' && (!sub || i.sub === sub || (i.pin && ['ambulance', 'police', 'fire'].includes(sub))));
    if (sub === 'blood') list = items().filter(i => i.sub === 'bloodbank' || (i.cat === 'emergency' && i.sub === 'blood'));
    list.sort((a, b) => (!!b.pin - !!a.pin) || (!!b.phone - !!a.phone));
    return `<div class="redhead"><div class="bar"><button class="roundbtn" data-back aria-label="${T('ফিরে যান')}">${icon('back', 20)}</button><h1>${T('জরুরি সেবা')}</h1><span class="spacer" style="width:44px"></span></div>
      <a class="call" href="tel:${esc(site.hotline || '999')}"><span class="ib">${icon('phone', 24)}</span><div><b>${T('{n} এ কল করুন', { n: num(site.hotline || '999') })}</b><small>${esc(loc(site, 'hotlineNote'))}</small></div></a></div>
    <div class="pills" style="margin-top:18px">${[['', 'সব', 'grid'], ...Object.keys(c.subs || {}).map(k => [k, null, c.subIcons?.[k]])].map(([k, v, ic]) =>
      `<a class="pill sm ${k === sub ? 'on' : ''}" href="#/emergency${k ? '?sub=' + k : ''}">${ic ? icon(ic, 15) : ''}${esc(v ? T(v) : subName(c, k))}</a>`).join('')}</div>
    ${loc(site, 'snakeTip') && (!sub || sub === 'hotline') ? `<div class="note warn">${icon('alert', 16)}<span><b>${T('সাপে কামড়ালে:')}</b> ${esc(loc(site, 'snakeTip'))} <a href="#/search?q=snake" style="color:var(--brand);font-weight:600">${T('হাসপাতাল দেখুন')}</a></span></div>` : ''}
    ${sub === 'blood' ? `<div class="note">${icon('droplet', 16)}<span>${T('রক্তদাতা নেটওয়ার্ক শীঘ্রই আসছে। এখন প্রয়োজনে নিকটস্থ সরকারি হাসপাতালের ব্লাড ব্যাংকে যোগাযোগ করুন।')}</span></div>` : ''}
    <div class="rows">${list.map(row).join('') || empty(T('এখনো তথ্য যুক্ত হয়নি'), T('যাচাই করে শীঘ্রই যুক্ত করা হবে।'))}</div>
    <p class="foot">${esc(loc(site, 'disclaimer'))}</p>`;
  };

  pages.browse = p => {
    const qtext = p.get('q') || '', cat = p.get('cat') || '', sub = p.get('sub') || '', open = !!p.get('open'), budget = +p.get('budget') || 0, sort = p.get('sort') || '';
    const c = CAT[cat];
    let list, intent = null;
    if (qtext) ({ list, intent } = search(qtext)); else list = items().filter(i => cat ? i.cat === cat : i.cat !== 'emergency');
    if (cat && qtext) list = list.filter(i => i.cat === cat);
    if (sub) list = list.filter(i => i.sub === sub);
    if (open || intent?.open) list = list.filter(i => isOpen(i) === true);
    const bud = budget || intent?.budget;
    if (bud) list = list.filter(i => !i.price || i.price <= bud);
    const area = ls.get('area', '');
    if (sort === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else if (sort === 'near' || intent?.near) list.sort((a, b) => (km(a) ?? 1e9) - (km(b) ?? 1e9));
    else if (!qtext) list.sort((a, b) => (!!b.sponsored - !!a.sponsored) || (!!b.featured - !!a.featured) || ((b.area === area) - (a.area === area)) ||
      ((a.status === 'closed') - (b.status === 'closed')) || (!!a.demo - !!b.demo) || (b.rating || 0) - (a.rating || 0));
    const active = !!(open || budget || sort || cat && qtext);
    const link = o => { const np = new URLSearchParams(p); Object.entries(o).forEach(([k, v]) => v ? np.set(k, v) : np.delete(k)); return (c && !qtext ? `#/c/${cat}` : '#/search') + (np.toString() ? '?' + np : ''); };
    const title = qtext ? T('খুঁজুন') : c ? catName(c) : T('সব তথ্য');
    const hist = ls.get('hist', []);
    if (qtext && !hist.includes(qtext)) ls.set('hist', [qtext, ...hist].slice(0, 8));
    const kindHit = intent?.kind || null;
    return `${topbar(title, `<button class="roundbtn" data-filter aria-label="${T('ফিল্টার')}">${icon('sliders', 20)}</button>`)}
      <div class="searchrow" style="margin-bottom:14px"><form class="search" data-search>${icon('search', 20)}<input name="q" type="search" value="${esc(qtext)}" placeholder="${c ? T('{c}-এ খুঁজুন', { c: esc(catName(c)) }) : T('যশোরে কী খুঁজছেন?')}" enterkeyhint="search" autocomplete="off" ${!qtext && !c ? 'autofocus' : ''}>
        ${qtext ? `<button type="button" class="clear" data-clear aria-label="${T('মুছুন')}">${icon('x', 16)}</button>` : ''}</form>
        <button class="filterbtn" data-filter aria-label="${T('ফিল্টার')}">${icon('sliders', 20)}${active ? '<i class="dot"></i>' : ''}</button></div>
      ${c ? adStrip('category', cat) : ''}
      ${c && Object.keys(c.subs || {}).length ? `<div class="pills"><a class="pill sm ${!sub ? 'on' : ''}" href="${link({ sub: '' })}">${T('সব')}</a>${Object.keys(c.subs).map(k =>
        `<a class="pill sm ${k === sub ? 'on' : ''}" href="${link({ sub: k })}">${esc(subName(c, k))}</a>`).join('')}</div>` : ''}
      ${kindHit ? `<a class="row" href="#/ads/${kindHit}" style="margin-bottom:12px"><span class="media" style="--c:${KINDS[kindHit].color};width:56px;height:56px"><span class="gen"><span class="ring" style="width:70%">${icon(KINDS[kindHit].icon, 24)}</span></span></span>
        <span class="body"><b>${T(KINDS[kindHit].bn)}</b><span class="sub">${T('{n}টি বিজ্ঞাপন', { n: num(D.classifiedCounts?.[kindHit] || 0) })}</span></span><span class="act">${icon('chevR', 18)}</span></a>` : ''}
      ${intent && (intent.cats.size || intent.open || intent.budget || intent.near) ? `<div class="pills">${[...intent.cats].map(id => CAT[id] ?
        `<a class="pill sm on" href="#/c/${id}${intent.sub && CAT[id].subs?.[intent.sub] ? '?sub=' + intent.sub : ''}">${icon(CAT[id].icon, 15)}${esc(catName(CAT[id]))}</a>` : '').join('')}
        ${intent.open ? `<span class="pill sm">${T('এখন খোলা')}</span>` : ''}${intent.budget ? `<span class="pill sm">${T('{n} পর্যন্ত', { n: money(intent.budget) })}</span>` : ''}
        ${intent.near ? (here ? `<span class="pill sm">${T('কাছাকাছি')}</span>` : `<button class="pill sm" data-locate>${icon('nav', 14)}${T('লোকেশন দিন')}</button>`) : ''}</div>` : ''}
      ${!qtext && !c ? (hist.length ? `<div class="sechead"><h2 style="font-size:15px">${T('সাম্প্রতিক সার্চ')}</h2><button class="linkbtn" data-clearhist>${T('মুছুন')}</button></div>
        <div class="pills wrap">${hist.map(h => `<a class="pill sm" href="#/search?q=${encodeURIComponent(h)}">${icon('clock', 14)}${esc(h)}</a>`).join('')}</div>` : '')
        + `<div class="sechead" style="margin-top:8px"><h2 style="font-size:15px">${T('জনপ্রিয় সার্চ')}</h2></div><div class="pills wrap">${['কাছাকাছি হাসপাতাল', 'আজ খোলা ফার্মেসি', '২০০ টাকার মধ্যে রেস্টুরেন্ট', 'কাচ্চি', 'বাসা ভাড়া', 'মোবাইল সার্ভিসিং', 'হোটেল']
          .map(s => `<a class="pill sm" href="#/search?q=${encodeURIComponent(T(s))}">${esc(T(s))}</a>`).join('')}</div>` : ''}
      ${qtext || c || active ? `<div class="count"><span>${T('{n}টি ফলাফল', { n: num(list.length) })}</span><select data-sort aria-label="${T('সাজানো')}">${[['', 'প্রাসঙ্গিক'], ['rating', 'সেরা রেটিং'], ['near', 'কাছাকাছি']]
        .map(([k, v]) => `<option value="${k}" ${sort === k ? 'selected' : ''}>${T(v)}</option>`).join('')}</select></div>
      <div class="rows">${list.map(row).join('') || (kindHit ? '' : empty(T('কিছু পাওয়া যায়নি'), T('অন্য শব্দে খুঁজুন বা ফিল্টার বদলান।'), `<a class="btn sm" href="#/add">${T('নতুন তথ্য যোগ করুন')}</a>`))}</div>` : ''}`;
  };

  pages.item = ([id]) => {
    const it = getItem(id);
    if (!it) return `${topbar('')}${empty(T('পাওয়া যায়নি'), T('তথ্যটি সরানো হয়েছে বা লিংক ভুল।'), `<a class="btn sm" href="#/">${T('হোমে ফিরুন')}</a>`)}`;
    if (pages.item.last !== id) { track(id, 'view'); pages.item.last = id; pages.item.tab = 'about'; }
    const c = catOf(it), d = km(it), tab = pages.item.tab || 'about', imgs = it.images || [];
    const rec = ls.get('recent', []).filter(x => x !== id); ls.set('recent', [id, ...rec].slice(0, 12));
    const related = items().filter(x => x.id !== id && (it.cat === 'place' ? ['restaurant', 'hotel'].includes(x.cat) && x.lat != null && it.lat != null : x.cat === it.cat))
      .map(x => ({ x, d: it.lat != null && x.lat != null ? Math.hypot(x.lat - it.lat, x.lng - it.lng) : 9 })).sort((a, b) => a.d - b.d).slice(0, 8).map(o => o.x);
    const infoRows = [
      (it.address || it.area) && ['pin', T('ঠিকানা'), esc([it.address, areaName(it.area), T('যশোর')].filter(Boolean).join(', ')) + (d != null ? ` <span class="muted">· ${kmText(d)}</span>` : '')],
      ['clock', T('সময়সূচি'), hoursText(it)],
      it.phone && ['phone', T('ফোন'), `<a href="tel:${esc(it.phone)}" data-call-track="${esc(id)}">${num(it.phone)}</a>${it.phone2 ? ` · <a href="tel:${esc(it.phone2)}">${num(it.phone2)}</a>` : ''}`],
      it.web && ['globe', T('ওয়েবসাইট'), `<a href="${esc(it.web)}" target="_blank" rel="noopener nofollow">${esc(it.web.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))}</a>`],
      it.facebook && ['facebook', T('ফেসবুক'), `<a href="${esc(it.facebook)}" target="_blank" rel="noopener nofollow">${T('পেজ দেখুন')}</a>`],
      ['shield', T('তথ্যের অবস্থা'), `${T(STATUS[it.status]?.[0] || '')}${it.verifiedAt ? ` · ${T('সর্বশেষ যাচাই')} ${esc(fmtDate(it.verifiedAt))}` : ''}`]
    ].filter(Boolean);
    return `<div class="detail">
      <div class="hero" style="--c:${esc(c.color)}">${imgs.length ? `<div class="media"><div class="slides" data-slides>${imgs.map(u => `<img src="${esc(u)}" alt="">`).join('')}</div></div>` : media(it)}
        <div class="hbar"><button class="roundbtn" data-back aria-label="${T('ফিরে যান')}">${icon('back', 20)}</button><button class="roundbtn" data-share="${esc(id)}" aria-label="${T('শেয়ার')}">${icon('share', 19)}</button></div>
        ${imgs.length > 1 ? `<div class="dots" data-dots>${imgs.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}</div>
      <div class="sheet-body">
        <div class="dtitle"><h1>${esc(nameOf(it))}</h1>${it.price ? `<div class="price"><b>${money(it.price)}</b><small>${T(PRICE_UNIT[it.cat] || 'আনুমানিক')}</small></div>` : ''}</div>
        <div class="dsub">${icon(subIcon(it), 15)}${esc(subLabel(it))}${it.area ? ` · ${esc(areaName(it.area))}` : ''}${it.rating ? ` · ${rateTag(it)}` : ''}</div>
        <div class="dtags">${statusTag(it)}${openTag(it)}${it.sponsored ? '<span class="tag ad">Sponsored</span>' : ''}${it.demo ? `<span class="tag">${T('নমুনা তথ্য')}</span>` : ''}</div>
        ${it.demo ? `<div class="note warn">${icon('info', 16)}<span>${T('এটি নমুনা তথ্য, বাস্তব প্রতিষ্ঠান নয়।')}</span></div>` : ''}
        ${!it.phone && it.cat === 'emergency' ? `<div class="note red">${icon('alert', 16)}<span>${T('স্থানীয় নম্বর যাচাই চলছে। জরুরি প্রয়োজনে ৯৯৯ এ কল করুন।')}</span></div>` : ''}
        <div class="tabs">${[['about', T('বিবরণ')], ['info', T('তথ্য')], ['reviews', T('রিভিউ') + (it.reviews ? ` (${num(it.reviews)})` : '')]].map(([k, v]) =>
          `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${v}</button>`).join('')}</div>
        <div data-tabbody>${tabBody(it, tab, infoRows, related)}</div>
        ${disclaimer('listing')}
        <button class="reportlink" data-report="${esc(id)}">${icon('flag', 14)}${T('তথ্য ভুল বা পুরনো? জানান')}</button>
        <div style="height:24px"></div>
      </div></div>
      <div class="actionbar"><button class="sq ${isSaved(id) ? 'on' : ''}" data-save="${esc(id)}" aria-label="${T('সেভ')}">${icon('heart', 22)}</button>
        <a class="sq" href="${dirUrl(it)}" target="_blank" rel="noopener" data-map="${esc(id)}" aria-label="${T('দিকনির্দেশ')}">${icon('nav', 21)}</a>
        ${it.phone ? `<a class="btn block ${it.cat === 'emergency' ? 'red' : 'dark'}" href="tel:${esc(it.phone)}" data-call-track="${esc(id)}">${icon('phone', 19)}${T('কল করুন')}</a>`
          : `<a class="btn block dark" href="${mapUrl(it)}" target="_blank" rel="noopener" data-map="${esc(id)}">${icon('map', 19)}${T('ম্যাপে দেখুন')}</a>`}</div>`;
  };

  function tabBody(it, tab, infoRows, related) {
    if (tab === 'info') return `<div class="info">${infoRows.map(([ic, l, v]) => `<div class="li"><span class="ib">${icon(ic, 18)}</span><div><small>${l}</small>${v}</div></div>`).join('')}</div>`;
    if (tab === 'reviews') {
      setTimeout(() => loadReviews(it), 0);
      return `<div data-rv><div class="boot" style="min-height:120px"><div class="spinner"></div></div></div>`;
    }
    const about = it.about || it.note;
    return `${about ? `<p class="prose">${esc(about)}</p>` : ''}
      ${videoBlock(it.videos)}
      ${it.features?.length ? `<div class="feat">${it.features.map(f => `<span>${icon('check', 15)}${esc(f)}</span>`).join('')}</div>` : ''}
      <div class="info" style="margin-top:16px">${infoRows.slice(0, 3).map(([ic, l, v]) => `<div class="li"><span class="ib">${icon(ic, 18)}</span><div><small>${l}</small>${v}</div></div>`).join('')}</div>
      ${related.length ? `<div class="sechead" style="margin-top:24px"><h2 style="font-size:16px">${T(it.cat === 'place' ? 'কাছাকাছি খাবার ও থাকা' : 'আরও দেখুন')}</h2></div>
        <div class="related">${related.map(x => `<a href="#/p/${esc(x.id)}">${media(x)}<small>${esc(nameOf(x))}</small></a>`).join('')}</div>` : ''}`;
  }

  async function loadReviews(it) {
    const box = document.querySelector('[data-rv]'); if (!box) return;
    let data;
    try { data = await api(`/listings/${it.id}/reviews`); } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    const rv = data.reviews, n = rv.length, avg = n ? rv.reduce((a, r) => a + r.stars, 0) / n : 0;
    const dist = [5, 4, 3, 2, 1].map(s => [s, rv.filter(r => r.stars === s).length]);
    const canReview = it.cat !== 'emergency' && !data.mine;
    box.innerHTML = `${n ? `<div class="rsum"><div class="big"><b>${num(avg.toFixed(1))}</b>${starsHtml(avg, 13)}<div class="muted" style="font-size:12px">${T('{n}টি রিভিউ', { n: num(n) })}</div></div>
      <div class="bars">${dist.map(([s, c]) => `<div class="bar">${num(s)}<i><u style="width:${n ? c / n * 100 : 0}%"></u></i></div>`).join('')}</div></div>` : ''}
      ${canReview ? `<button class="btn block ghost" style="margin-top:14px" data-writereview>${icon('edit', 18)}${ME ? T('রিভিউ লিখুন') : T('রিভিউ দিতে লগইন করুন')}</button>` : data.mine ? `<p class="muted" style="font-size:13px;margin:14px 0 0">${icon('check', 14)} ${T('আপনি রিভিউ দিয়েছেন')}</p>` : ''}
      <div style="margin-top:8px">${rv.map(r => `<div class="rv"><div class="who"><span class="av">${esc((r.name || '?')[0])}</span><div><b>${esc(r.name || T('ব্যবহারকারী'))}</b><small>${esc(fmtDate(r.t))}</small></div>${starsHtml(r.stars, 13)}</div>
        ${r.crit ? `<div class="crit">${Object.entries(r.crit).map(([k, v]) => `<span class="tag">${esc(T(k))} ${num(v)}/${num(5)}</span>`).join('')}</div>` : ''}
        ${r.text ? `<p>${esc(r.text)}</p>` : ''}${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy">` : ''}
        ${r.reply ? `<div class="reply"><b>${T('Jashore360 টিম / প্রতিষ্ঠানের উত্তর')}</b>${esc(r.reply)}</div>` : ''}
        <div class="acts"><button data-vote="${r.id}|1">${icon('thumb', 13)}${T('উপকারী')} ${r.up ? num(r.up) : ''}</button><button data-vote="${r.id}|0">${T('অনুপকারী')} ${r.down ? num(r.down) : ''}</button>
        <button data-reportrv="${r.id}">${icon('flag', 13)}${T('রিপোর্ট')}</button></div></div>`).join('') || (it.cat !== 'emergency' ? empty(T('এখনো রিভিউ নেই'), T('প্রথম রিভিউটি আপনিই দিন!'), '', 'msg') : '')}</div>`;
  }

  const videoBlock = v => v?.length ? `<div class="videos">${v.map(u => `<video src="${esc(u)}" controls playsinline preload="metadata"></video>`).join('')}</div>` : '';
  const DISC = {
    classified: ['classifiedDisclaimer', 'নিজ দায়িত্বে যাচাই করে চাকরি বা বাসা ভাড়া নিন। বিজ্ঞাপনদাতা বা বাড়ির মালিকের সাথে Jashore360-এর কোনো সম্পর্ক নেই। কোনো প্রতারণা বা ক্ষতি হলে Jashore360 দায়ী থাকবে না।'],
    listing: ['listingDisclaimer', 'তথ্য যাচাই করে নিজ দায়িত্বে সেবা নিন। প্রতিষ্ঠানের সেবা, দাম বা লেনদেনের জন্য Jashore360 দায়ী নয়।']
  };
  const disclaimer = k => `<div class="note warn disc">${icon('shield', 16)}<span>${esc(loc(D.site, DISC[k][0]) || T(DISC[k][1]))}</span></div>`;

  /* ---------------- classifieds ---------------- */
  const cache = { ads: {} };
  async function loadKind(kind) {
    cache.ads[kind] = await api('/classifieds?kind=' + kind);
    if (location.hash.startsWith('#/ads/' + kind)) render();
  }
  pages.ads = ([kind], p) => {
    const k = KINDS[kind]; if (!k) return pages.notfound();
    const list = cache.ads[kind];
    if (!list) loadKind(kind).catch(e => toast(e.message));
    const area = p.get('area') || '', sort = p.get('sort') || '';
    const rows = (list || []).filter(a => !area || a.area === area);
    if (sort === 'low') rows.sort((a, b) => (a.price || 1e12) - (b.price || 1e12));
    if (sort === 'high') rows.sort((a, b) => (b.price || 0) - (a.price || 0));
    return `${topbar(T(k.bn), `<a class="roundbtn" href="#/post/${kind}" aria-label="${T('বিজ্ঞাপন দিন')}">${icon('plus', 20)}</a>`)}
      <div class="pills">${Object.entries(KINDS).map(([x, v]) => `<a class="pill sm ${x === kind ? 'on' : ''}" href="#/ads/${x}">${icon(v.icon, 15)}${T(v.bn)}</a>`).join('')}</div>
      ${adStrip('classifieds')}
      <div class="count"><select data-adarea aria-label="${T('এলাকা')}"><option value="">${T('সব এলাকা')}</option>${(D.areas || []).map(a => `<option value="${esc(a)}" ${a === area ? 'selected' : ''}>${esc(areaName(a))}</option>`).join('')}</select>
        <select data-adsort aria-label="${T('সাজানো')}">${[['', 'নতুন আগে'], ['low', 'কম দাম আগে'], ['high', 'বেশি দাম আগে']].map(([x, v]) => `<option value="${x}" ${x === sort ? 'selected' : ''}>${T(v)}</option>`).join('')}</select></div>
      ${!list ? '<div class="boot" style="min-height:160px"><div class="spinner"></div></div>' : `<div class="rows">${rows.map(crow).join('') ||
        empty(T('এখনো কোনো বিজ্ঞাপন নেই'), T('প্রথম বিজ্ঞাপনটি আপনিই দিন — সম্পূর্ণ ফ্রি।'), `<a class="btn sm" href="#/post/${kind}">${T('বিজ্ঞাপন দিন')}</a>`, k.icon)}</div>`}
      ${list?.length ? disclaimer('classified') : ''}
      <a class="bizcta" href="#/post/${kind}"><span>${icon('megaphone', 22)}</span><div><b>${T('ফ্রি বিজ্ঞাপন দিন')}</b><small>${T('অ্যাডমিন যাচাইয়ের পর {n} দিন দেখাবে', { n: num(30) })}</small></div>${icon('chevR', 18)}</a>`;
  };

  pages.ad = ([id]) => {
    const a = cache.ad?.id === id ? cache.ad : Object.values(cache.ads).flat().find(x => x.id === id);
    if (!a) { api('/classifieds/' + id).then(r => { cache.ad = r; render(); }).catch(e => { cache.ad = { id, error: e.message }; render(); }); return `${topbar('')}<div class="boot"><div class="spinner"></div></div>`; }
    if (a.error) return `${topbar('')}${empty(T('পাওয়া যায়নি'), esc(a.error), `<a class="btn sm" href="#/">${T('হোমে ফিরুন')}</a>`)}`;
    const k = KINDS[a.kind], imgs = a.images || [];
    const facts = (a.kind === 'job' ? [['briefcase', 'প্রতিষ্ঠান', a.company], ['clock', 'ধরন', optLabel('jobType', a.jobType)], ['users', 'পদ সংখ্যা', a.vacancies && num(a.vacancies)],
      ['cap', 'যোগ্যতা', a.qualification], ['star', 'অভিজ্ঞতা', a.experience], ['calendar', 'আবেদনের শেষ তারিখ', a.deadline && fmtDate(a.deadline)], ['edit', 'আবেদনের নিয়ম', a.howToApply]]
      : a.kind === 'rent' ? [['home', 'ধরন', optLabel('propertyType', a.propertyType)], ['bed', 'রুম', a.rooms && num(a.rooms)], ['droplet', 'বাথরুম', a.baths && num(a.baths)],
        ['grid', 'আয়তন', a.size && T('{n} বর্গফুট', { n: num(a.size) })], ['layers', 'তলা', a.floor], ['calendar', 'কবে থেকে', a.availableFrom && fmtDate(a.availableFrom)], ['check', 'সুবিধা', a.facilities]]
      : [['bed', 'সিটের ধরন', optLabel('seatType', a.seatType)], ['users', 'কাদের জন্য', a.gender && optLabel('gender', a.gender)], ['grid', 'খালি সিট', a.seats && num(a.seats)],
        ['calendar', 'কবে থেকে', a.availableFrom && fmtDate(a.availableFrom)], ['check', 'সুবিধা', a.facilities]]).filter(f => f[2]);
    const wa = a.whatsapp || a.phone;
    return `<div class="detail">
      <div class="hero" style="--c:${k.color}">${imgs.length ? `<div class="media"><div class="slides" data-slides>${imgs.map(u => `<img src="${esc(u)}" alt="">`).join('')}</div></div>` : media(a, '', k.color, k.icon)}
        <div class="hbar"><button class="roundbtn" data-back aria-label="${T('ফিরে যান')}">${icon('back', 20)}</button><button class="roundbtn" data-sharead="${esc(id)}" aria-label="${T('শেয়ার')}">${icon('share', 19)}</button></div>
        ${imgs.length > 1 ? `<div class="dots" data-dots>${imgs.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}</div>
      <div class="sheet-body">
        <div class="dtitle"><h1>${esc(a.title)}</h1>${a.price ? `<div class="price"><b>${money(a.price)}</b><small>${T(a.kind === 'job' ? 'বেতন' : 'প্রতি মাসে')}</small></div>` : ''}</div>
        <div class="dsub">${icon(k.icon, 15)}${T(k.bn)}${a.area ? ` · ${esc(areaName(a.area))}` : ''} · ${esc(fmtDate(a.t))}</div>
        ${a.description ? `<p class="prose" style="margin-top:16px">${esc(a.description)}</p>` : ''}
        ${videoBlock(a.videos)}
        <div class="info" style="margin-top:12px">${facts.map(([ic, l, v]) => `<div class="li"><span class="ib">${icon(ic, 18)}</span><div><small>${T(l)}</small>${esc(v)}</div></div>`).join('')}
          ${a.address || a.area ? `<div class="li"><span class="ib">${icon('pin', 18)}</span><div><small>${T('ঠিকানা')}</small>${esc([a.address, areaName(a.area)].filter(Boolean).join(', '))}</div></div>` : ''}
          <div class="li"><span class="ib">${icon('user', 18)}</span><div><small>${T('যোগাযোগ')}</small>${esc(a.contactName || '')} <a href="tel:${esc(a.phone)}">${num(a.phone)}</a></div></div></div>
        ${disclaimer('classified')}
        <button class="reportlink" data-reportad="${esc(id)}">${icon('flag', 14)}${T('ভুয়া বা আপত্তিকর বিজ্ঞাপন? রিপোর্ট করুন')}</button>
        <div style="height:24px"></div></div></div>
      <div class="actionbar"><a class="sq" href="https://wa.me/88${esc(wa)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('msg', 21)}</a>
        <a class="btn block dark" href="tel:${esc(a.phone)}">${icon('phone', 19)}${T('কল করুন')}</a></div>`;
  };

  /* ---------------- account ---------------- */
  pages.login = (_, p) => {
    if (ME) { go('#' + (p.get('next') || '/account')); return ''; }
    const mode = p.get('mode') || 'login';
    return `${topbar(T(mode === 'login' ? 'লগইন' : 'অ্যাকাউন্ট খুলুন'))}
      <div class="authcard"><span class="brandmark">${LOGO}</span><h2>${T(mode === 'login' ? 'আবার স্বাগতম!' : 'নতুন অ্যাকাউন্ট')}</h2>
        <p class="muted">${T('রিভিউ দিতে, ব্যবসা যুক্ত করতে ও বিজ্ঞাপন দিতে অ্যাকাউন্ট লাগবে।')}</p></div>
      <div class="seg" style="margin:18px 0">${[['login', 'লগইন'], ['register', 'অ্যাকাউন্ট খুলুন']].map(([k, v]) =>
        `<button class="${mode === k ? 'on' : ''}" data-authmode="${k}" style="flex:1">${T(v)}</button>`).join('')}</div>
      <form class="form" data-auth="${mode}">
        ${mode === 'register' ? `<label class="field"><span>${T('আপনার নাম')}</span><input name="name" required maxlength="60" autocomplete="name"></label>` : ''}
        <label class="field"><span>${T('মোবাইল নম্বর')}</span><input name="phone" required inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXXX"></label>
        <label class="field"><span>${T('পাসওয়ার্ড')}</span><input name="password" type="password" required minlength="6" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">
          ${mode === 'register' ? `<em class="muted" style="font-size:12px;font-style:normal">${T('কমপক্ষে ৬ অক্ষর')}</em>` : ''}</label>
        ${mode === 'register' ? `<label class="check"><input type="checkbox" name="terms" required><span>${T('আমি Jashore360-এর {t} পড়েছি ও সম্মত', { t: `<a href="#/terms" style="color:var(--brand);font-weight:700">${T('শর্তাবলি')}</a>` })}</span></label>` : ''}
        <button class="btn block" type="submit">${T(mode === 'login' ? 'লগইন' : 'অ্যাকাউন্ট খুলুন')}</button>
        ${mode === 'login' ? `<p class="muted" style="font-size:13px;text-align:center;margin:0">${T('পাসওয়ার্ড ভুলে গেলে আমাদের সাথে যোগাযোগ করুন')}${D.site?.contactPhone ? ` — <a href="tel:${esc(D.site.contactPhone)}">${num(D.site.contactPhone)}</a>` : ''}</p>` : ''}
      </form>`;
  };

  const STATE = { pending: ['যাচাইয়ের অপেক্ষায়', 'warn'], approved: ['প্রকাশিত', 'ok'], rejected: ['বাতিল', 'bad'], unpaid: ['পেমেন্ট বাকি', 'bad'],
    payment_review: ['পেমেন্ট যাচাই চলছে', 'warn'], payment_rejected: ['পেমেন্ট বাতিল — আবার দিন', 'bad'], expired: ['মেয়াদ শেষ', 'bad'] };
  pages.account = (_, p) => {
    if (!ME) { go('#/login?next=/account'); return ''; }
    const tab = p.get('tab') || 'biz', my = cache.my;
    if (!my || pages.account.stale) { pages.account.stale = false; api('/my').then(r => { cache.my = r; if (location.hash.startsWith('#/account')) render(); }).catch(e => toast(e.message)); }
    const soon = l => l.paidUntil && (new Date(l.paidUntil) - Date.now()) / 864e5 < 30;
    let body = '<div class="boot" style="min-height:160px"><div class="spinner"></div></div>';
    if (my && tab === 'biz') body = my.listings.length ? `<div class="rows">${my.listings.map(l => { const [t, k] = STATE[l.state] || STATE.pending;
      return `<div class="row" style="align-items:flex-start">${media(l)}<div class="body"><b>${esc(l.name)}</b><div class="sub">${esc(subLabel(l))}${l.paidUntil ? ' · ' + T('মেয়াদ {d} পর্যন্ত', { d: fmtDate(l.paidUntil) }) : ''}</div>
        <div class="meta"><span class="tag ${k}">${T(t)}</span>${l.state === 'approved' ? `<span class="muted">${T('{v} ভিউ · {c} কল', { v: num(l.views), c: num(l.calls) })}</span>` : ''}</div>
        ${l.payment?.status === 'rejected' && l.payment.note ? `<div class="muted" style="font-size:12px;margin-top:4px">${esc(l.payment.note)}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          ${['unpaid', 'payment_rejected', 'expired'].includes(l.state) || (l.state === 'approved' && soon(l)) ? `<a class="btn sm" href="#/pay/${l.id}">${icon('wallet', 16)}${T(l.state === 'unpaid' || l.state === 'payment_rejected' ? 'পেমেন্ট করুন' : 'নবায়ন করুন')}</a>` : ''}
          ${l.state === 'approved' ? `<a class="btn sm ghost" href="#/p/${l.id}">${T('দেখুন')}</a>` : ''}
          <a class="btn sm ghost" href="#/edit/listing/${l.id}">${icon('edit', 16)}${T('সম্পাদনা')}</a>
          ${['unpaid', 'pending', 'rejected', 'payment_rejected'].includes(l.state) ? `<button class="btn sm ghost" data-dellisting="${l.id}">${T('মুছুন')}</button>` : ''}</div></div></div>`; }).join('')}</div>`
      : empty(T('এখনো কোনো ব্যবসা যুক্ত করেননি'), '', `<a class="btn sm" href="#/add">${T('ব্যবসা যুক্ত করুন')}</a>`, 'store');
    if (my && tab === 'ads') body = my.classifieds.length ? `<div class="rows">${my.classifieds.map(a => { const k = KINDS[a.kind]; const live = a.review === 'approved' && a.expires * 1000 > Date.now();
      const [t, cl] = a.review === 'approved' ? (live ? ['প্রকাশিত', 'ok'] : ['মেয়াদ শেষ', 'bad']) : STATE[a.review] || STATE.pending;
      return `<div class="row">${media(a, '', k.color, k.icon)}<div class="body"><b>${esc(a.title)}</b><div class="sub">${T(k.bn)}${live ? ' · ' + T('{d} পর্যন্ত', { d: fmtDate(a.expires) }) : ''}</div>
        <div class="meta"><span class="tag ${cl}">${T(t)}</span>${live ? `<span class="muted">${T('{v} ভিউ', { v: num(a.views) })}</span>` : ''}</div></div>
        <a class="act" href="#/edit/ad/${a.id}" aria-label="${T('সম্পাদনা')}">${icon('edit', 18)}</a>
        <button class="act" style="border:0" data-delad="${a.id}" aria-label="${T('মুছুন')}">${icon('trash', 18)}</button></div>`; }).join('')}</div>
      <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${T('প্রকাশিত বিজ্ঞাপন সম্পাদনা করলে অ্যাডমিন আবার যাচাই করে প্রকাশ করবেন।')}</p>`
      : empty(T('এখনো কোনো বিজ্ঞাপন দেননি'), '', `<a class="btn sm" href="#/add">${T('বিজ্ঞাপন দিন')}</a>`, 'megaphone');
    if (my && tab === 'settings') body = `<form class="form" data-profile>
      <label class="field"><span>${T('আপনার নাম')}</span><input name="name" value="${esc(ME.name)}" required maxlength="60"></label>
      <label class="field"><span>${T('মোবাইল নম্বর')}</span><input value="${esc(num(ME.phone))}" disabled></label>
      <h4 style="margin:6px 0 0">${T('পাসওয়ার্ড পরিবর্তন (ঐচ্ছিক)')}</h4>
      <label class="field"><span>${T('বর্তমান পাসওয়ার্ড')}</span><input name="password" type="password" autocomplete="current-password"></label>
      <label class="field"><span>${T('নতুন পাসওয়ার্ড')}</span><input name="newPassword" type="password" minlength="6" autocomplete="new-password"></label>
      <button class="btn block" type="submit">${T('সংরক্ষণ করুন')}</button></form>
      <button class="btn block ghost" style="margin-top:12px;color:var(--danger)" data-logout>${icon('logout', 18)}${T('লগআউট')}</button>`;
    return `${topbar(T('আমার অ্যাকাউন্ট'))}
      <div class="profilehead"><span class="avatar">${esc(ME.name[0])}</span><div><b>${esc(ME.name)}</b><span class="muted" style="font-size:13px">${esc(num(ME.phone))}</span></div></div>
      ${my ? `<div class="stat3"><div><b>${num(my.listings.length)}</b><small>${T('ব্যবসা')}</small></div><div><b>${num(my.classifieds.length)}</b><small>${T('বিজ্ঞাপন')}</small></div><div><b>${num(my.reviews)}</b><small>${T('রিভিউ')}</small></div></div>` : ''}
      <div class="seg" style="margin:18px 0">${[['biz', 'আমার ব্যবসা'], ['ads', 'আমার বিজ্ঞাপন'], ['settings', 'সেটিংস']].map(([k, v]) =>
        `<a class="${tab === k ? 'on' : ''}" href="#/account?tab=${k}" style="flex:1;text-align:center">${T(v)}</a>`).join('')}</div>${body}
      <a class="bizcta" href="#/add"><span>${icon('plus', 22)}</span><div><b>${T('নতুন যোগ করুন')}</b><small>${T('ব্যবসা, ফ্রি তথ্য, চাকরি বা ভাড়ার বিজ্ঞাপন')}</small></div>${icon('chevR', 18)}</a>`;
  };

  /* ---------------- add / post ---------------- */
  pages.add = () => {
    const opts = [['listing?mode=paid', 'store', '#0e9f6e', 'ব্যবসা যুক্ত করুন', 'প্রাইভেট হাসপাতাল, ক্লিনিক, রেস্টুরেন্ট, দোকান, হোটেল, সার্ভিস, কোচিং', 'পেইড প্যাকেজ'],
      ['listing?mode=free', 'landmark', '#7c5cff', 'ফ্রি তথ্য যোগ করুন', 'সরকারি হাসপাতাল, দর্শনীয় স্থান, জরুরি নম্বর, স্কুল-কলেজ, স্বেচ্ছাসেবী সংগঠন', 'ফ্রি'],
      ['job', 'briefcase', '#f2711c', 'চাকরির বিজ্ঞাপন', 'আপনার প্রতিষ্ঠানে লোক নিন', 'ফ্রি'],
      ['rent', 'home', '#4f6bed', 'বাসা / ফ্ল্যাট / দোকান ভাড়া', 'টু-লেট বিজ্ঞাপন দিন', 'ফ্রি'],
      ['mess', 'bed', '#0f9fa8', 'মেস / সিট ভাড়া', 'খালি সিটের খবর দিন', 'ফ্রি']];
    return `${topbar(T('কী যোগ করতে চান?'))}
      ${ME ? '' : `<div class="note">${icon('user', 18)}<span>${T('যোগ করতে অ্যাকাউন্ট লাগবে।')} <a href="#/login?next=/add" style="font-weight:700;color:var(--brand)">${T('লগইন / অ্যাকাউন্ট খুলুন')}</a></span></div>`}
      <div class="rows">${opts.map(([to, ic, c, t, d, b]) => `<a class="row choose" href="#/post/${to}"><span class="media" style="--c:${c};width:60px;height:60px"><span class="gen"><span class="ring" style="width:72%">${icon(ic, 26)}</span></span></span>
        <span class="body"><b>${T(t)}</b><span class="sub" style="white-space:normal">${T(d)}</span><span class="meta"><span class="tag ${b === 'ফ্রি' ? 'ok' : 'ad'}">${T(b)}</span><span class="muted">${T('অ্যাডমিন যাচাইয়ের পর প্রকাশ')}</span></span></span>${icon('chevR', 18)}</a>`).join('')}</div>`;
  };

  const planName = pl => LANG() === 'en' ? pl.en || pl.bn : pl.bn;
  const planCards = sel => `<div class="plans">${(D.plans || []).map(pl => `<label class="plan ${sel === pl.id ? 'on' : ''}"><input type="radio" name="plan" value="${esc(pl.id)}" ${sel === pl.id ? 'checked' : ''}>
    <div class="ph"><b>${esc(planName(pl))}</b>${pl.featured ? `<span class="tag ad">${T('জনপ্রিয়')}</span>` : ''}</div>
    <div class="pp"><b>${money(pl.price)}</b><small>/ ${T('{n} দিন', { n: num(pl.days) })}</small></div>
    <ul>${(LANG() === 'en' && pl.perksEn ? pl.perksEn : pl.perks || []).map(x => `<li>${icon('check', 14)}${esc(x)}</li>`).join('')}</ul></label>`).join('')}</div>`;

  function listingCats(mode) {
    return D.categories.map(c => {
      const subs = Object.keys(c.subs || {}).filter(s => (mode === 'paid') === (!!c.paid && !(c.freeSubs || []).includes(s)));
      return subs.length ? { c, subs } : null;
    }).filter(Boolean);
  }

  pages.edit = ([type, id]) => {
    if (!ME) { go('#/login?next=' + encodeURIComponent('/edit/' + type + '/' + id)); return ''; }
    const key = type + ':' + id;
    if (cache.edit?.key !== key) {
      (type === 'listing' ? api('/my/listings/' + id) : api('/my').then(r => { cache.my = r; const a = r.classifieds.find(x => x.id === id); if (!a) throw new Error(T('পাওয়া যায়নি')); return a; }))
        .then(doc => { cache.edit = { key, doc }; render(); }).catch(e => { toast(e.message); go('#/account'); });
      return `${topbar(T('সম্পাদনা'))}<div class="boot"><div class="spinner"></div></div>`;
    }
    const doc = cache.edit.doc;
    if (pages.edit.filled !== key) { MEDIA.images = (doc.images || []).map(url => ({ url })); MEDIA.videos = (doc.videos || []).map(url => ({ url })); pages.edit.filled = key; }
    return pages.post([type === 'listing' ? 'listing' : doc.kind], new URLSearchParams(), doc);
  };

  pages.post = ([what], p, edit) => {
    if (!ME) { go('#/login?next=' + encodeURIComponent('/post/' + what + (p.toString() ? '?' + p : ''))); return ''; }
    if (pages.post.done) { const d = pages.post.done; pages.post.done = null;
      return `${topbar(T('জমা হয়েছে'))}${empty(T('জমা হয়েছে!'), T(d), `<a class="btn sm" href="#/account${what === 'listing' ? '' : '?tab=ads'}">${T('আমার অ্যাকাউন্ট')}</a>`, 'check')}`; }
    const areaSel = `<select name="area">${(D.areas || []).map(a => `<option value="${esc(a)}">${esc(areaName(a))}</option>`).join('')}</select>`;
    const editNote = edit ? `<div class="note warn">${icon('edit', 18)}<span>${T(edit.review === 'approved' || edit.review === 'rejected' ? 'পরিবর্তন জমা দিলে অ্যাডমিন আবার যাচাই করবেন, ততক্ষণ এটি অ্যাপে দেখাবে না।' : 'পরিবর্তন জমা দিন — অ্যাডমিন যাচাই করে প্রকাশ করবেন।')}</span></div>` : '';
    const editAttr = edit ? ` data-edit="${esc(edit.id)}"` : '';
    if (what === 'listing') {
      const mode = edit ? (needsPay(edit) ? 'paid' : 'free') : p.get('mode') === 'paid' ? 'paid' : 'free', groups = listingCats(mode);
      return `${topbar(T(edit ? 'তথ্য সম্পাদনা' : mode === 'paid' ? 'ব্যবসা যুক্ত করুন' : 'ফ্রি তথ্য যোগ করুন'))}
      ${editNote || `<div class="note">${icon(mode === 'paid' ? 'store' : 'landmark', 18)}<span>${T(mode === 'paid' ? 'তথ্য দিন, প্যাকেজ বাছুন, তারপর বিকাশ/নগদে পেমেন্ট করুন। যাচাইয়ের পর প্রকাশিত হবে।' : 'সরকারি, জনসেবামূলক বা দর্শনীয় স্থানের তথ্য ফ্রিতে যোগ করুন। অ্যাডমিন যাচাই করে প্রকাশ করবেন।')}</span></div>`}
      <form class="form" data-addlisting="${mode}"${editAttr}>
        <label class="field"><span>${T('প্রতিষ্ঠান/স্থানের নাম')} *</span><input name="name" required maxlength="120"></label>
        ${edit ? `<label class="field"><span>${T('ধরন')}</span><input value="${esc(subLabel(edit))}" disabled></label>`
          : `<label class="field"><span>${T('ধরন')} *</span><select name="catsub" required>${groups.map(g => `<optgroup label="${esc(catName(g.c))}">${g.subs.map(s => `<option value="${g.c.id}|${s}">${esc(subName(g.c, s))}</option>`).join('')}</optgroup>`).join('')}</select></label>`}
        <div class="two"><label class="field"><span>${T('এলাকা')} *</span>${areaSel}</label>
          <label class="field"><span>${T('ফোন')}</span><input name="phone" inputmode="tel" placeholder="01XXXXXXXXX" value="${mode === 'paid' ? esc(ME.phone) : ''}"></label></div>
        <label class="field"><span>${T('ঠিকানা')}</span><input name="address" maxlength="200" placeholder="${T('রাস্তা, ল্যান্ডমার্ক')}"></label>
        <div class="two"><label class="field"><span>${T('খোলে')}</span><input name="open" type="time"></label><label class="field"><span>${T('বন্ধ হয়')}</span><input name="close" type="time"></label></div>
        <label class="switch"><span>${T('২৪ ঘণ্টা খোলা')}</span><input type="checkbox" name="h24"></label>
        <div class="two"><label class="field"><span>${T('আনুমানিক খরচ (৳)')}</span><input name="price" inputmode="numeric"></label>
          <label class="field"><span>${T('ফেসবুক/ওয়েবসাইট')}</span><input name="web" type="url" placeholder="https://"></label></div>
        <label class="field"><span>${T('বিবরণ')}</span><textarea name="about" maxlength="1500" placeholder="${T('সেবা, বিশেষত্ব, সুবিধা…')}"></textarea></label>
        ${mediaField()}
        ${mode === 'paid' && !edit ? `<div class="field"><span>${T('প্যাকেজ বাছুন')} *</span>${planCards(D.plans?.[0]?.id)}</div>` : ''}
        <label class="check"><input type="checkbox" required><span>${T('আমি নিশ্চিত করছি তথ্যগুলো সঠিক এবং প্রকাশের অনুমতি আছে।')}</span></label>
        <button class="btn block" type="submit">${T(edit ? 'পরিবর্তন জমা দিন' : mode === 'paid' ? 'পরবর্তী: পেমেন্ট' : 'জমা দিন')}</button></form>`;
    }
    const k = KINDS[what]; if (!k) return pages.notfound();
    const sel = (name, key) => `<select name="${name}"><option value="">—</option>${OPTS[key].map(([v, l]) => `<option value="${v}">${T(l)}</option>`).join('')}</select>`;
    const extra = what === 'job' ? `
        <div class="two"><label class="field"><span>${T('প্রতিষ্ঠানের নাম')}</span><input name="company" maxlength="120"></label><label class="field"><span>${T('চাকরির ধরন')}</span>${sel('jobType', 'jobType')}</label></div>
        <div class="two"><label class="field"><span>${T('বেতন (৳/মাস)')}</span><input name="price" inputmode="numeric"></label><label class="field"><span>${T('পদ সংখ্যা')}</span><input name="vacancies" inputmode="numeric"></label></div>
        <label class="field"><span>${T('যোগ্যতা')}</span><input name="qualification" maxlength="400"></label>
        <div class="two"><label class="field"><span>${T('অভিজ্ঞতা')}</span><input name="experience" maxlength="60"></label><label class="field"><span>${T('আবেদনের শেষ তারিখ')}</span><input name="deadline" type="date"></label></div>
        <label class="field"><span>${T('আবেদনের নিয়ম')}</span><textarea name="howToApply" maxlength="500" placeholder="${T('সিভি পাঠানোর ঠিকানা, ইমেইল বা সরাসরি যোগাযোগ')}"></textarea></label>`
      : what === 'rent' ? `
        <div class="two"><label class="field"><span>${T('ধরন')}</span>${sel('propertyType', 'propertyType')}</label><label class="field"><span>${T('ভাড়া (৳/মাস)')} *</span><input name="price" inputmode="numeric" required></label></div>
        <div class="two"><label class="field"><span>${T('রুম')}</span><input name="rooms" inputmode="numeric"></label><label class="field"><span>${T('বাথরুম')}</span><input name="baths" inputmode="numeric"></label></div>
        <div class="two"><label class="field"><span>${T('আয়তন (বর্গফুট)')}</span><input name="size" inputmode="numeric"></label><label class="field"><span>${T('তলা')}</span><input name="floor" maxlength="20"></label></div>
        <label class="field"><span>${T('কবে থেকে')}</span><input name="availableFrom" type="date"></label>
        <label class="field"><span>${T('সুবিধা')}</span><input name="facilities" maxlength="400" placeholder="${T('গ্যাস, লিফট, পার্কিং, জেনারেটর…')}"></label>`
      : `
        <div class="two"><label class="field"><span>${T('সিটের ধরন')}</span>${sel('seatType', 'seatType')}</label><label class="field"><span>${T('কাদের জন্য')}</span>${sel('gender', 'gender')}</label></div>
        <div class="two"><label class="field"><span>${T('ভাড়া (৳/মাস)')} *</span><input name="price" inputmode="numeric" required></label><label class="field"><span>${T('খালি সিট')}</span><input name="seats" inputmode="numeric"></label></div>
        <label class="field"><span>${T('কবে থেকে')}</span><input name="availableFrom" type="date"></label>
        <label class="field"><span>${T('সুবিধা')}</span><input name="facilities" maxlength="400" placeholder="${T('খাবার, ওয়াই-ফাই, বিদ্যুৎ বিল সহ…')}"></label>`;
    return `${topbar(T(k.bn) + ' — ' + T(edit ? 'সম্পাদনা' : 'বিজ্ঞাপন'))}
      ${editNote || `<div class="note">${icon('megaphone', 18)}<span>${T('বিজ্ঞাপন সম্পূর্ণ ফ্রি। অ্যাডমিন যাচাইয়ের পর {n} দিন দেখাবে।', { n: num(30) })}</span></div>`}
      <form class="form" data-addclassified="${what}"${editAttr}>
        <label class="field"><span>${T('শিরোনাম')} *</span><input name="title" required maxlength="120" placeholder="${T(what === 'job' ? 'যেমন: সেলসম্যান নিয়োগ' : what === 'rent' ? 'যেমন: ২ রুমের ফ্যামিলি বাসা ভাড়া' : 'যেমন: ছাত্রদের মেসে সিট খালি')}"></label>
        ${extra}
        <label class="field"><span>${T('বিস্তারিত')}</span><textarea name="description" maxlength="3000"></textarea></label>
        <div class="two"><label class="field"><span>${T('এলাকা')}</span>${areaSel}</label><label class="field"><span>${T('ঠিকানা')}</span><input name="address" maxlength="200"></label></div>
        <div class="two"><label class="field"><span>${T('যোগাযোগের নাম')}</span><input name="contactName" maxlength="60" value="${esc(ME.name)}"></label>
          <label class="field"><span>${T('মোবাইল')} *</span><input name="phone" required inputmode="tel" value="${esc(ME.phone)}"></label></div>
        <label class="field"><span>WhatsApp</span><input name="whatsapp" inputmode="tel" placeholder="${T('ঐচ্ছিক')}"></label>
        ${mediaField()}
        <label class="check"><input type="checkbox" required><span>${T('আমি নিশ্চিত করছি বিজ্ঞাপনের তথ্য সঠিক।')}</span></label>
        <button class="btn block" type="submit">${T(edit ? 'পরিবর্তন জমা দিন' : 'বিজ্ঞাপন জমা দিন')}</button></form>`;
  };
  const needsPay = l => { const c = CAT[l.cat]; return !!c?.paid && !(c.freeSubs || []).includes(l.sub); };

  /* photos & videos: uploaded one by one as soon as they are picked */
  const MEDIA = { images: [], videos: [] }, MAXM = { images: 10, videos: 2 };
  const mediaField = () => `<div class="field"><span>${T('ছবি (সর্বোচ্চ {n}টি)', { n: num(MAXM.images) })}</span><div class="photos" data-media="images"></div></div>
    <div class="field"><span>${T('ভিডিও (সর্বোচ্চ {n}টি, প্রতিটি {m} MB পর্যন্ত)', { n: num(MAXM.videos), m: num(60) })}</span><div class="photos" data-media="videos"></div></div>`;
  function drawMedia() {
    ['images', 'videos'].forEach(k => {
      const box = app.querySelector(`[data-media="${k}"]`); if (!box) return;
      // The add tile is created once and kept, so a file picker that is open while other uploads finish is never orphaned.
      let add = box.querySelector('label');
      if (!add) {
        box.insertAdjacentHTML('beforeend', `<label>${icon(k === 'images' ? 'camera' : 'video', 22)}<input type="file" accept="${k === 'images' ? 'image/*' : 'video/*'}" ${k === 'images' ? 'multiple' : ''} data-addmedia="${k}"></label>`);
        add = box.querySelector('label');
        add.querySelector('input').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; addMedia(k, files); });
      }
      box.querySelectorAll('.ph').forEach(x => x.remove());
      add.insertAdjacentHTML('beforebegin', MEDIA[k].map((m, i) => `<div class="ph">${k === 'images' ? `<img src="${esc(m.preview || m.url)}" alt="">`
          : `<video src="${esc(m.preview || m.url)}#t=0.5" muted playsinline preload="metadata"></video><span class="vtag">${icon('video', 14)}</span>`}
        ${m.url ? '' : `<span class="prog"><i style="width:${m.progress || 0}%"></i></span>`}
        <button type="button" data-rmmedia="${k}|${i}" aria-label="${T('মুছুন')}">${icon('x', 14)}</button></div>`).join(''));
      add.hidden = MEDIA[k].length >= MAXM[k];
    });
  }
  async function addMedia(kind, files) {
    const room = MAXM[kind] - MEDIA[kind].length;
    if (files.length > room) toast(T('সর্বোচ্চ {n}টি', { n: num(MAXM[kind]) }));
    const list = files.slice(0, room).filter(f => kind === 'images' || f.size <= 60 * 1048576 || (toast(T('ভিডিও সর্বোচ্চ ৬০ MB')), false))
      .map(f => ({ file: f, preview: URL.createObjectURL(f), progress: 0 }));
    MEDIA[kind].push(...list); drawMedia();
    for (const m of list) {
      try {
        const blob = kind === 'images' ? await compress(m.file) : m.file;
        const r = await upload(blob, kind === 'images' ? 'image/jpeg' : (m.file.type || 'video/mp4'), pct => {
          m.progress = pct; const i = MEDIA[kind].indexOf(m);
          const bar = i >= 0 && app.querySelectorAll(`[data-media="${kind}"] .ph`)[i]?.querySelector('.prog i'); if (bar) bar.style.width = pct + '%';
        });
        m.url = r.url;
      } catch (er) { toast(er.message); const i = MEDIA[kind].indexOf(m); if (i >= 0) MEDIA[kind].splice(i, 1); }
      drawMedia();
    }
  }
  const mediaBody = () => ({ images: MEDIA.images.filter(m => m.url).map(m => m.url), videos: MEDIA.videos.filter(m => m.url).map(m => m.url) });
  function fillForm(f, d) {
    const v = { ...d, web: d.web || d.facebook, open: /^\d/.test(d.hours || '') ? d.hours.split('-')[0] : '', close: /^\d/.test(d.hours || '') ? d.hours.split('-')[1] : '' };
    [...f.elements].forEach(el => { if (el.name && !['checkbox', 'radio', 'file'].includes(el.type) && v[el.name] != null) el.value = String(v[el.name]); });
    if (f.h24) f.h24.checked = d.hours === '24h';
  }

  pages.pay = ([lid]) => {
    if (!ME) { go('#/login?next=/pay/' + lid); return ''; }
    const my = cache.my;
    if (!my) { api('/my').then(r => { cache.my = r; render(); }).catch(e => toast(e.message)); return `${topbar(T('পেমেন্ট'))}<div class="boot"><div class="spinner"></div></div>`; }
    const l = my.listings.find(x => x.id === lid);
    if (!l) return `${topbar(T('পেমেন্ট'))}${empty(T('পাওয়া যায়নি'), '')}`;
    if (l.state === 'payment_review') return `${topbar(T('পেমেন্ট'))}${empty(T('পেমেন্ট যাচাই চলছে'), T('আপনার পেমেন্ট পেয়েছি। যাচাই শেষে প্রকাশিত হবে।'), `<a class="btn sm" href="#/account">${T('আমার অ্যাকাউন্ট')}</a>`, 'clock')}`;
    const pay = D.payment || {}, sel = pages.pay.plan || l.plan || D.plans?.[0]?.id, plan = (D.plans || []).find(x => x.id === sel);
    const methods = [['bkash', 'বিকাশ'], ['nagad', 'নগদ'], ['rocket', 'রকেট']].filter(m => pay[m[0]]);
    const method = pages.pay.method && pay[pages.pay.method] ? pages.pay.method : methods[0]?.[0];
    return `${topbar(T('পেমেন্ট'))}
      <div class="paysum"><small>${T('তালিকা')}</small><b>${esc(l.name)}</b></div>
      <h4>${T('প্যাকেজ')}</h4><form data-planpick>${planCards(sel)}</form>
      ${methods.length ? `<h4>${T('পেমেন্ট মাধ্যম')}</h4><div class="seg">${methods.map(([k, v]) => `<button class="${k === method ? 'on' : ''}" data-paymethod="${k}" style="flex:1">${T(v)}</button>`).join('')}</div>
      <div class="payhow"><div class="amt">${plan ? money(plan.price) : ''}</div>
        <ol><li>${T('{m} অ্যাপ থেকে "Send Money" করুন', { m: T(methods.find(m => m[0] === method)[1]) })}</li>
        <li>${T('নম্বর:')} <b class="copy" data-copy="${esc(pay[method])}">${esc(num(pay[method]))} ${icon('layers', 14)}</b> <span class="muted">(${esc(pay.type || 'Personal')})</span></li>
        <li>${T('পরিমাণ:')} <b>${plan ? money(plan.price) : ''}</b></li><li>${T('টাকা পাঠানোর পর নিচে Transaction ID দিন')}</li></ol>
        ${loc(pay, 'note') ? `<p class="muted" style="font-size:13px;margin:8px 0 0">${esc(loc(pay, 'note'))}</p>` : ''}</div>
      <form class="form" data-pay="${esc(lid)}" style="margin-top:14px">
        <label class="field"><span>Transaction ID (TrxID) *</span><input name="trx" required maxlength="30" autocapitalize="characters" placeholder="8N7A6B5C4D"></label>
        <label class="field"><span>${T('যে নম্বর থেকে পাঠিয়েছেন')} *</span><input name="sender" required inputmode="tel" value="${esc(ME.phone)}"></label>
        <button class="btn block" type="submit">${T('পেমেন্ট জমা দিন')}</button></form>`
      : `<div class="note warn">${icon('info', 16)}<span>${T('অনলাইন পেমেন্ট নম্বর এখনো যোগ করা হয়নি। অ্যাডমিনের সাথে যোগাযোগ করুন।')}</span></div>`}`;
  };

  pages.explore = () => {
    const counts = {}; items().forEach(i => counts[i.cat] = (counts[i.cat] || 0) + 1);
    return `${topbar(T('এক্সপ্লোর'))}
      <div class="grid2">${D.categories.map(c => `<a class="gcard" href="${c.id === 'emergency' ? '#/emergency' : '#/c/' + c.id}" style="padding:18px;gap:14px">
        <span class="catt" style="width:auto;align-items:flex-start"><span style="--c:${esc(c.color)};width:54px;height:54px;border-radius:17px">${icon(c.icon, 24)}</span></span>
        <div><b style="display:block;font-size:15px">${esc(catName(c))}</b><small class="muted">${T('{n}টি তথ্য', { n: num(counts[c.id] || 0) })}</small></div></a>`).join('')}</div>
      <section class="sec"><div class="sechead"><h2>${T('ভাড়া ও চাকরি')}</h2></div><div class="ktiles">${Object.entries(KINDS).map(([k, v]) =>
        `<a href="#/ads/${k}" style="--c:${v.color}"><span>${icon(v.icon, 22)}</span><b>${T(v.bn)}</b><small>${T('{n}টি বিজ্ঞাপন', { n: num(D.classifiedCounts?.[k] || 0) })}</small></a>`).join('')}</div></section>
      <section class="sec"><div class="sechead"><h2>${T('শীঘ্রই আসছে')}</h2></div><div class="pills wrap">${[['droplet', 'রক্তদাতা নেটওয়ার্ক'], ['nav', 'যাতায়াত'], ['calendar', 'ইভেন্ট'], ['tag', 'অফার ও কুপন']]
        .map(([i, t]) => `<span class="pill sm">${icon(i, 15)}${T(t)}</span>`).join('')}</div></section>`;
  };

  pages.saved = () => {
    const list = saved().map(getItem).filter(Boolean);
    return `${topbar(T('সেভ করা'))}${list.length ? `<div class="grid2">${list.map(gcard).join('')}</div>`
      : empty(T('এখনো কিছু সেভ করেননি'), T('পছন্দের জায়গার হার্ট চিহ্নে চাপুন, এখানে জমা থাকবে।'), `<a class="btn sm" href="#/explore">${T('এক্সপ্লোর করুন')}</a>`, 'heart')}`;
  };

  pages.profile = () => {
    const t = ls.get('theme', 'auto'), site = D.site || {};
    const android = /Android/i.test(navigator.userAgent) && !APP_UA && D.app?.file;
    return `${topbar(T('প্রোফাইল'))}
    ${ME ? `<a class="profilehead" href="#/account"><span class="avatar">${esc(ME.name[0])}</span><div style="flex:1"><b>${esc(ME.name)}</b><span class="muted" style="font-size:13px">${T('আমার ব্যবসা, বিজ্ঞাপন ও সেটিংস')}</span></div>${icon('chevR', 18)}</a>`
      : `<div class="authpromo"><span class="brandmark">${LOGO}</span><div><b>${T('অ্যাকাউন্ট খুলুন')}</b><small>${T('রিভিউ দিন, ব্যবসা যুক্ত করুন, ফ্রি বিজ্ঞাপন দিন')}</small></div>
        <a class="btn sm" href="#/login?next=/account">${T('লগইন')}</a></div>`}
    <div class="stat3"><div><b>${num(saved().length)}</b><small>${T('সেভ করা')}</small></div><div><b>${num(ls.get('recent', []).length)}</b><small>${T('দেখেছেন')}</small></div><div><b>${num(D.listings.length)}</b><small>${T('মোট তথ্য')}</small></div></div>
    <div class="panel">
      <div class="li"><span class="ib">${icon('globe', 18)}</span><div>${T('ভাষা')}</div><div class="seg" style="flex:none">${[['bn', 'বাংলা'], ['en', 'English']].map(([k, v]) => `<button class="${LANG() === k ? 'on' : ''}" data-setlang="${k}">${v}</button>`).join('')}</div></div>
      <div class="li"><span class="ib">${icon('moon', 18)}</span><div>${T('থিম')}</div><div class="seg" style="flex:none">${[['auto', 'অটো'], ['light', 'লাইট'], ['dark', 'ডার্ক']].map(([k, v]) => `<button class="${t === k ? 'on' : ''}" data-theme-set="${k}">${T(v)}</button>`).join('')}</div></div>
      <button class="li" data-areasheet><span class="ib">${icon('pin', 18)}</span><div>${T('আমার এলাকা')}<small>${esc(areaName(ls.get('area', '')) || T('পুরো যশোর'))}</small></div>${icon('chevR', 18)}</button>
      <div class="li"><span class="ib">${icon('nav', 18)}</span><div>${T('লোকেশন')}<small>${T(here ? 'চালু — দূরত্ব দেখানো হচ্ছে' : 'বন্ধ')}</small></div>${here ? `<button class="btn sm ghost" data-forgetloc>${T('বন্ধ করুন')}</button>` : `<button class="btn sm" data-locate>${T('চালু করুন')}</button>`}</div>
    </div>
    <div class="panel">
      ${android ? `<a class="li" href="/download/jashore360.apk"><span class="ib">${icon('download', 18)}</span><div>${T('অ্যান্ড্রয়েড অ্যাপ ডাউনলোড')}<small>v${esc(D.app.versionName)}</small></div>${icon('chevR', 18)}</a>` : ''}
      <a class="li" href="#/add"><span class="ib">${icon('store', 18)}</span><div>${T('ব্যবসা যুক্ত করুন')}<small>${T('অ্যাকাউন্ট খুলে প্যাকেজ বেছে নিন')}</small></div>${icon('chevR', 18)}</a>
      ${site.contactPhone ? `<a class="li" href="tel:${esc(site.contactPhone)}"><span class="ib">${icon('phone', 18)}</span><div>${T('যোগাযোগ')}<small>${num(site.contactPhone)}</small></div>${icon('chevR', 18)}</a>` : ''}
      ${site.facebook ? `<a class="li" href="${esc(site.facebook)}" target="_blank" rel="noopener"><span class="ib">${icon('facebook', 18)}</span><div>${T('ফেসবুক পেজ')}</div>${icon('external', 16)}</a>` : ''}
      <button class="li" data-notices><span class="ib">${icon('bell', 18)}</span><div>${T('ঘোষণা ও আপডেট')}</div>${icon('chevR', 18)}</button>
      <a class="li" href="#/terms"><span class="ib">${icon('doc', 18)}</span><div>${T('শর্তাবলি')}</div>${icon('chevR', 18)}</a>
      <a class="li" href="/"><span class="ib">${icon('info', 18)}</span><div>${T('Jashore360 সম্পর্কে')}<small>${esc(loc(site, 'about'))}</small></div>${icon('chevR', 18)}</a>
    </div>
    <p class="foot">${esc(loc(site, 'disclaimer'))}<br>${T('পেইড বিজ্ঞাপন সবসময় "Sponsored" চিহ্নিত থাকে এবং রেটিংকে প্রভাবিত করে না।')}</p>`;
  };

  const termsText = () => (LANG() === 'en' && D.terms?.en) || D.terms?.bn || '';
  const termsHtml = () => termsText().split(/\n\s*\n/).map(x => `<p>${esc(x.trim()).replace(/\n/g, '<br>')}</p>`).join('');
  pages.terms = () => `${topbar(T('শর্তাবলি'))}
    <div class="prose terms">${termsHtml() || `<p>${T('শর্তাবলি এখনো যোগ করা হয়নি।')}</p>`}</div>
    ${D.terms?.updated ? `<p class="muted" style="font-size:13px">${T('সর্বশেষ আপডেট')}: ${esc(fmtDate(D.terms.updated))}</p>` : ''}`;

  pages.notfound = () => `${topbar('')}${empty(T('পাওয়া যায়নি'), '', `<a class="btn sm" href="#/">${T('হোমে ফিরুন')}</a>`)}`;

  /* ---------------- welcome ---------------- */
  function welcome() {
    const tv = D.terms?.version || 0, again = ls.get('welcomed', false);
    if ((again && ls.get('termsV', 0) >= tv) || document.querySelector('.welcome') || location.hash.startsWith('#/terms')) return;
    const w = document.createElement('div');
    w.className = 'welcome';
    const chips = [['hospital', '#0b8fd6', 'top:12%;left:14%'], ['utensils', '#f2711c', 'top:22%;right:12%'], ['siren', '#e5484d', 'bottom:16%;left:12%'], ['home', '#7c5cff', 'bottom:10%;right:18%']];
    const draw = () => {
      w.innerHTML = `<div class="art"><div class="blob"><div class="core">${LOGO.replace('<svg', '<svg width="64" height="64"')}</div></div>
        ${chips.map(([i, c, pos]) => `<span class="chip" style="background:${c};${pos}">${icon(i, 22)}</span>`).join('')}</div>
        <div class="card"><div class="seg wlang">${[['bn', 'বাংলা'], ['en', 'English']].map(([k, v]) =>
          `<button class="${LANG() === k ? 'on' : ''}" data-wlang="${k}">${v}</button>`).join('')}</div>
        <h1>${again ? T('শর্তাবলি আপডেট হয়েছে') : esc(loc(D.site, 'tagline') || T('যশোরের সবকিছু, এক অ্যাপে'))}</h1><p>${T(again ? 'চালিয়ে যেতে নতুন শর্তাবলি পড়ে সম্মতি দিন।' : 'হাসপাতাল, জরুরি নম্বর, রেস্টুরেন্ট, দোকান, বাসা ভাড়া আর চাকরি — যাচাইকৃত তথ্য, এক জায়গায়।')}</p>
        ${tv ? `<label class="wterms"><input type="checkbox" data-agree><span>${T('আমি Jashore360-এর {t} পড়েছি ও সম্মত', { t: `<button type="button" data-readterms>${T('শর্তাবলি')}</button>` })}</span></label>
        <div class="wtext" hidden>${termsHtml()}</div>` : ''}
        <button class="btn block" data-start ${tv ? 'disabled' : ''}>${T(again ? 'সম্মত, চালিয়ে যান' : 'শুরু করুন')}</button></div>`;
    };
    draw();
    document.body.appendChild(w);
    w.addEventListener('click', e => {
      const l = e.target.closest('[data-wlang]');
      if (l) { e.stopPropagation(); ls.set('lang', l.dataset.wlang); applyTheme(); draw(); render(); }
      if (e.target.closest('[data-readterms]')) { const t = w.querySelector('.wtext'); t.hidden = !t.hidden; }
      if (e.target.closest('[data-start]')) {
        ls.set('welcomed', true); ls.set('termsV', tv); w.remove();
        if (ME) api('/my/terms', {}).catch(() => {});
      }
    });
    w.addEventListener('change', e => { if (e.target.matches('[data-agree]')) w.querySelector('[data-start]').disabled = !e.target.checked; });
  }

  /* ---------------- router ---------------- */
  const routes = [[/^$/, 'home'], [/^emergency$/, 'emergency'], [/^c\/([\w-]+)$/, 'browse'], [/^search$/, 'browse'], [/^p\/([\w-]+)$/, 'item'],
    [/^explore$/, 'explore'], [/^saved$/, 'saved'], [/^add$/, 'add'], [/^profile$/, 'profile'], [/^login$/, 'login'], [/^account$/, 'account'],
    [/^post\/(\w+)$/, 'post'], [/^pay\/([\w-]+)$/, 'pay'], [/^ads\/(\w+)$/, 'ads'], [/^ad\/(\w+)$/, 'ad'], [/^edit\/(listing|ad)\/([\w-]+)$/, 'edit'], [/^terms$/, 'terms']];
  const navKey = { home: 'home', browse: 'explore', explore: 'explore', emergency: 'home', saved: 'saved', add: 'add', post: 'add', pay: 'add', edit: 'profile', terms: 'profile',
    profile: 'profile', account: 'profile', login: 'profile', ads: 'explore' };
  let lastPath = null;
  const go = h => { location.hash = h; };

  function render() {
    if (!D) return;
    const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
    const p = new URLSearchParams(query);
    let name = 'notfound', params = [];
    const m = routes.find(([re]) => re.test(path));
    if (m) { name = m[1]; params = path.match(m[0]).slice(1); }
    if (name === 'browse' && params[0]) { if (params[0] === 'emergency') name = 'emergency'; else p.set('cat', params[0]); }
    if (path !== lastPath && (name === 'post' || name === 'edit')) { MEDIA.images = []; MEDIA.videos = []; pages.edit.filled = null; if (name === 'post') cache.edit = null; }
    const html = ['browse', 'emergency'].includes(name) ? pages[name](p) : pages[name](params, p);
    if (html === '') return;               // page redirected
    app.innerHTML = html;
    nav.hidden = name === 'item' || name === 'ad';
    nav.querySelectorAll('a').forEach(a => { a.classList.toggle('on', a.dataset.nav === navKey[name]); a.setAttribute('aria-label', T(a.dataset.label)); });
    if (path !== lastPath) window.scrollTo(0, 0);
    lastPath = path;
    drawMedia();
    const ef = app.querySelector('form[data-edit]'); if (ef && cache.edit) fillForm(ef, cache.edit.doc);
    const h1 = app.querySelector('h1')?.textContent;
    document.title = name === 'home' ? `Jashore360 — ${loc(D.site, 'tagline')}` : `${h1 || ''} · Jashore360`;
    carousel(); adImpressions();
    const af = app.querySelector('[autofocus]'); if (af && !matchMedia('(pointer:coarse)').matches) af.focus();
  }
  window.addEventListener('hashchange', () => { closeSheet(true); render(); });

  function carousel() {
    const c = app.querySelector('[data-carousel], [data-slides]'), dots = app.querySelector('[data-dots]');
    if (!c || !dots) return;
    c.onscroll = () => { const i = Math.round(c.scrollLeft / c.clientWidth); dots.querySelectorAll('i').forEach((d, n) => d.classList.toggle('on', n === i)); };
  }

  async function doLocate(then) {
    toast(T('লোকেশন খোঁজা হচ্ছে…'));
    try { await locate(); toast(T('লোকেশন পাওয়া গেছে')); then ? go(then) : render(); }
    catch { toast(T('লোকেশন পাওয়া যায়নি — ব্রাউজারে অনুমতি দিন')); }
  }


  /* ---------------- events ---------------- */
  document.addEventListener('click', async e => {
    const adEl = e.target.closest('[data-ad]');
    if (adEl) beacon('/adtrack', { id: adEl.dataset.ad, type: 'click' });
    const el = e.target.closest('button, [data-call], [data-call-track], [data-map], [data-copy]');
    if (!el || el.closest('.welcome')) return;
    const ds = el.dataset;
    if (ds.call) { e.preventDefault(); track(ds.id, 'call'); location.href = 'tel:' + ds.call; return; }
    if (ds.callTrack) return track(ds.callTrack, 'call');
    if (ds.map) return track(ds.map, 'map');
    if (ds.copy) { try { await navigator.clipboard.writeText(ds.copy); toast(T('নম্বর কপি হয়েছে')); } catch {} return; }
    if ('close' in ds) return closeSheet();
    if ('back' in ds) return history.length > 1 ? history.back() : go('#/');
    if ('filter' in ds) { const [, q = ''] = location.hash.split('?'); const p = new URLSearchParams(q); const m = location.hash.match(/#\/c\/([\w-]+)/); if (m) p.set('cat', m[1]); return filterSheet(p); }
    if ('notices' in ds) return noticesSheet();
    if ('areasheet' in ds) return areaSheet();
    if ('locate' in ds) return doLocate();
    if ('forgetloc' in ds) { here = null; ls.set('loc', null); return render(); }
    if ('pop' in ds) { pages.home.pop = ds.pop; return render(); }
    if (ds.themeSet) { ls.set('theme', ds.themeSet); applyTheme(); return render(); }
    if ('lang' in ds || ds.setlang) { ls.set('lang', ds.setlang || (LANG() === 'bn' ? 'en' : 'bn')); applyTheme(); return render(); }
    if ('clear' in ds) return go('#/search');
    if ('clearhist' in ds) { ls.set('hist', []); return render(); }
    if (ds.tab) { pages.item.tab = ds.tab; return render(); }
    if (ds.authmode) { const n = new URLSearchParams(location.hash.split('?')[1] || ''); n.set('mode', ds.authmode); return go('#/login?' + n); }
    if (ds.paymethod) { pages.pay.method = ds.paymethod; return render(); }
    if (ds.save) {
      e.preventDefault();
      const s = saved(), i = s.indexOf(ds.save);
      i >= 0 ? s.splice(i, 1) : s.unshift(ds.save); ls.set('saved', s);
      document.querySelectorAll(`[data-save="${CSS.escape(ds.save)}"]`).forEach(b => b.classList.toggle('on', i < 0));
      toast(T(i >= 0 ? 'সেভ থেকে সরানো হয়েছে' : 'সেভ করা হয়েছে')); return;
    }
    if (ds.share || ds.sharead) {
      const it = ds.share ? getItem(ds.share) : cache.ad?.id === ds.sharead ? cache.ad : Object.values(cache.ads).flat().find(x => x.id === ds.sharead);
      if (!it) return;
      const url = location.origin + '/app/#/' + (ds.share ? 'p/' : 'ad/') + it.id, title = ds.share ? nameOf(it) : it.title;
      try { if (navigator.share) await navigator.share({ title, url }); else { await navigator.clipboard.writeText(title + '\n' + url); toast(T('লিংক কপি হয়েছে')); } } catch {}
      return;
    }
    if (ds.report) return reportSheet({ listing: ds.report });
    if (ds.reportrv) return reportSheet({ listing: location.hash.split('/')[2], review: ds.reportrv });
    if (ds.reportad) return reportSheet({ classified: ds.reportad });
    if ('writereview' in ds) return reviewSheet(getItem(location.hash.split('/')[2]));
    if (ds.vote) {
      const [rid, up] = ds.vote.split('|');
      try { await api(`/reviews/${rid}/vote`, { up: up === '1' }); toast(T('ধন্যবাদ!')); loadReviews(getItem(location.hash.split('/')[2])); } catch (er) { toast(er.message); }
      return;
    }
    if (ds.rmmedia) { const [k, i] = ds.rmmedia.split('|'); MEDIA[k].splice(+i, 1); return drawMedia(); }
    if ('logout' in ds) { await api('/auth/logout', {}); ME = null; cache.my = null; toast(T('লগআউট হয়েছে')); return go('#/profile'); }
    if (ds.delad || ds.dellisting) {
      if (!confirm(T('মুছে ফেলবেন?'))) return;
      try { await api(ds.delad ? '/my/classifieds/' + ds.delad : '/my/listings/' + ds.dellisting, undefined, 'DELETE'); pages.account.stale = true; toast(T('মুছে ফেলা হয়েছে')); render(); } catch (er) { toast(er.message); }
    }
  });

  document.addEventListener('change', async e => {
    const el = e.target;
    if (el.matches('[data-sort]')) {
      const [h, q = ''] = location.hash.split('?'), p = new URLSearchParams(q);
      el.value ? p.set('sort', el.value) : p.delete('sort');
      if (el.value === 'near' && !here) return doLocate(h + '?' + p);
      return go(h + (p.toString() ? '?' + p : ''));
    }
    if (el.matches('[data-adarea], [data-adsort]')) {
      const [h, q = ''] = location.hash.split('?'), p = new URLSearchParams(q), k = el.matches('[data-adarea]') ? 'area' : 'sort';
      el.value ? p.set(k, el.value) : p.delete(k); return go(h + (p.toString() ? '?' + p : ''));
    }
    if (el.name === 'plan') {
      el.closest('.plans').querySelectorAll('.plan').forEach(x => x.classList.toggle('on', x.contains(el)));
      if (el.closest('[data-planpick]')) { pages.pay.plan = el.value; render(); }
      return;
    }
  });

  document.addEventListener('submit', async e => {
    const f = e.target; e.preventDefault();
    const btn = f.querySelector('[type=submit]');
    const busy = v => { if (btn) btn.disabled = v; };
    if ('search' in f.dataset) {
      const v = f.q.value.trim(); f.q.blur();
      const m = location.hash.match(/#\/c\/([\w-]+)/);
      return go('#/search?' + new URLSearchParams(Object.assign(v ? { q: v } : {}, m ? { cat: m[1] } : {})));
    }
    if ((f.dataset.addlisting || f.dataset.addclassified) && [...MEDIA.images, ...MEDIA.videos].some(m => !m.url)) return toast(T('ছবি/ভিডিও আপলোড শেষ হওয়া পর্যন্ত অপেক্ষা করুন'));
    busy(true);
    try {
      if (f.dataset.auth) {
        const v = Object.fromEntries(new FormData(f));
        ME = await api('/auth/' + (f.dataset.auth === 'login' ? 'login' : 'register'), { name: v.name, phone: toLatin(v.phone), password: v.password, terms: !!v.terms });
        cache.my = null;
        if (f.dataset.auth === 'login' && ls.get('termsV', 0) >= (D.terms?.version || 0)) api('/my/terms', {}).catch(() => {});
        toast(T('স্বাগতম, {name}!', { name: ME.name }));
        return go('#' + (new URLSearchParams(location.hash.split('?')[1] || '').get('next') || '/account'));
      }
      if (f.dataset.profile != null) {
        const v = Object.fromEntries(new FormData(f));
        await api('/my/profile', v, 'PUT'); ME.name = v.name; toast(T('সংরক্ষণ হয়েছে')); return render();
      }
      if (f.dataset.addlisting) {
        const v = Object.fromEntries(new FormData(f)), [cat, sub] = (v.catsub || '|').split('|');
        const body = { name: v.name, cat, sub, area: v.area, address: v.address, phone: toLatin(v.phone || ''),
          hours: v.h24 ? '24h' : v.open && v.close ? `${v.open}-${v.close}` : null, price: toLatin(v.price || '').replace(/\D/g, ''),
          web: /facebook\.com/.test(v.web) ? null : v.web, facebook: /facebook\.com/.test(v.web) ? v.web : null, about: v.about, plan: v.plan, ...mediaBody() };
        if (f.dataset.edit) {
          await api('/my/listings/' + f.dataset.edit, body, 'PUT');
          cache.my = null; cache.edit = null; toast(T('পরিবর্তন জমা হয়েছে — যাচাইয়ের পর প্রকাশিত হবে')); return go('#/account');
        }
        const r = await api('/my/listings', body);
        cache.my = null;
        if (r.needsPayment) { pages.pay.plan = v.plan; return go('#/pay/' + r.id); }
        pages.post.done = 'আমাদের টিম যাচাই করে শীঘ্রই প্রকাশ করবে। ধন্যবাদ।'; return render();
      }
      if (f.dataset.addclassified) {
        const v = Object.fromEntries(new FormData(f));
        ['price', 'rooms', 'baths', 'size', 'vacancies', 'seats', 'phone', 'whatsapp'].forEach(k => v[k] && (v[k] = toLatin(v[k])));
        if (f.dataset.edit) {
          await api('/my/classifieds/' + f.dataset.edit, { ...v, ...mediaBody() }, 'PUT');
          cache.my = null; cache.edit = null; cache.ads = {}; toast(T('পরিবর্তন জমা হয়েছে — যাচাইয়ের পর প্রকাশিত হবে')); return go('#/account?tab=ads');
        }
        await api('/my/classifieds', { ...v, kind: f.dataset.addclassified, ...mediaBody() });
        cache.my = null;
        pages.post.done = 'অ্যাডমিন যাচাইয়ের পর বিজ্ঞাপনটি প্রকাশিত হবে।'; return render();
      }
      if (f.dataset.pay) {
        const v = Object.fromEntries(new FormData(f));
        const methods = ['bkash', 'nagad', 'rocket'].filter(m => D.payment?.[m]);
        await api('/my/payments', { listing: f.dataset.pay, plan: pages.pay.plan || undefined, method: methods.includes(pages.pay.method) ? pages.pay.method : methods[0],
          trx: v.trx, sender: toLatin(v.sender) });
        cache.my = null; toast(T('পেমেন্ট জমা হয়েছে — যাচাই চলছে')); return go('#/account');
      }
    } catch (er) { toast(er.message); } finally { busy(false); }
  });

  /* ---------------- boot ---------------- */
  function setData(d) { D = d; CAT = Object.fromEntries(d.categories.map(c => [c.id, c])); buildKeys(); }
  async function refresh() {
    const d = await api('/bootstrap');
    const changed = !D || d.v !== D.v;
    setData(d);
    try { localStorage.setItem('j360.boot', JSON.stringify(d)); } catch {}
    return changed;
  }
  (async () => {
    const cached = ls.get('boot', null);
    if (cached?.categories && cached.plans) { setData(cached); render(); welcome(); }
    try {
      const [changed, me] = await Promise.all([refresh(), api('/auth/me').catch(() => null)]);
      ME = me;
      if (changed || me) render();
      if (!cached?.plans) welcome();
    } catch { if (!D) app.innerHTML = empty(T('সংযোগ নেই'), T('ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।'), `<button class="btn sm" onclick="location.reload()">${T('আবার চেষ্টা')}</button>`, 'globe'); }
  })();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
