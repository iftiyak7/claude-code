/* Jashore360 — vanilla JS, no build step. */
(() => {
  'use strict';

  const D = window.J360_DATA;
  const CAT = Object.fromEntries(D.categories.map(c => [c.id, c]));
  const app = document.getElementById('app');

  /* ---------------- helpers ---------------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BN = '০১২৩৪৫৬৭৮৯';
  const bn = n => String(n).replace(/\d/g, d => BN[d]);
  const toLatinDigits = s => s.replace(/[০-৯]/g, d => BN.indexOf(d));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => new Date().toISOString().slice(0, 10);

  const store = {
    get(k, def) { try { const v = localStorage.getItem('j360.' + k); return v ? JSON.parse(v) : def; } catch { return def; } },
    set(k, v) {
      try { localStorage.setItem('j360.' + k, JSON.stringify(v)); return true; }
      catch { toast('জায়গা শেষ — কিছু ছবি বা ডেটা মুছে আবার চেষ্টা করুন'); return false; }
    }
  };

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------------- theme ---------------- */
  function applyTheme() {
    const t = store.get('theme', 'auto');
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }
  applyTheme();

  /* ---------------- data layer ---------------- */
  function allItems() {
    const ov = store.get('overrides', {});
    const subs = store.get('subs', []).filter(s => s.review === 'approved').map(s => s.item);
    return D.items.concat(subs).map(it => ov[it.id] ? { ...it, ...ov[it.id] } : it);
  }
  const getItem = id => allItems().find(i => i.id === id);

  function reviewsOf(id) { return store.get('reviews', {})[id] || []; }
  function ratingOf(id) {
    const r = reviewsOf(id).filter(x => !x.hidden);
    if (!r.length) return null;
    return { avg: r.reduce((a, b) => a + b.stars, 0) / r.length, n: r.length };
  }

  const STATUS = {
    verified: ['যাচাইকৃত', 'ok'], pending: ['যাচাই চলছে', 'warn'], needs_update: ['আপডেট প্রয়োজন', 'warn'],
    temp_closed: ['সাময়িক বন্ধ', 'bad'], closed: ['স্থায়ীভাবে বন্ধ', 'bad']
  };

  /* open-now: true / false / null (unknown) */
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
    if (!it.hours) return 'সময় জানা নেই';
    if (it.hours === '24h') return '২৪ ঘণ্টা খোলা';
    const fmt = t => { let [h, m] = t.split(':').map(Number); const p = h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : h < 18 ? 'বিকাল' : 'রাত';
      h = h % 12 || 12; return `${p} ${bn(h)}${m ? ':' + bn(String(m).padStart(2, '0')) : ''}টা`; };
    const days = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'];
    const [a, b] = it.hours.split('-');
    return `${fmt(a)} – ${fmt(b)}${it.off ? ` · ${it.off.map(x => days[x]).join(', ')}বার বন্ধ` : ''}`;
  }

  /* ---------------- location ---------------- */
  let here = store.get('loc', null);
  function locate() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('no geo'));
      navigator.geolocation.getCurrentPosition(p => {
        here = { lat: p.coords.latitude, lng: p.coords.longitude, t: Date.now() };
        store.set('loc', here); res(here);
      }, rej, { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
    });
  }
  function distKm(it) {
    if (!here || it.lat == null) return null;
    const R = 6371, r = x => x * Math.PI / 180;
    const dLa = r(it.lat - here.lat), dLo = r(it.lng - here.lng);
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(r(here.lat)) * Math.cos(r(it.lat)) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const distText = km => km == null ? '' : km < 1 ? `~${bn(Math.round(km * 1000 / 50) * 50)} মি.` : `~${bn(km.toFixed(km < 10 ? 1 : 0))} কিমি`;

  const mapUrl = it => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((it.nameEn || it.name) + ', ' + (it.address || it.area || '') + ' Jashore Bangladesh');
  const dirUrl = it => 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent((it.nameEn || it.name) + ', ' + (it.area || '') + ' Jashore Bangladesh');

  /* ---------------- search ---------------- */
  function norm(s) {
    return toLatinDigits(String(s || '').toLowerCase()).replace(/[.,!?।:;"'()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
  }
  const KEYS = [];
  D.categories.forEach(c => {
    c.keys.forEach(k => KEYS.push({ k: norm(k), cat: c.id }));
    Object.entries(c.subs).forEach(([sid, lbl]) => KEYS.push({ k: norm(lbl), cat: c.id, sub: sid }));
  });
  const SUBKEYS = { kacchi: 'biryani', kachchi: 'biryani', 'কাচ্চি': 'biryani', biryani: 'biryani', biriyani: 'biryani', 'বিরিয়ানি': 'biryani',
    pizza: 'fastfood', burger: 'fastfood', 'পিজা': 'fastfood', 'বার্গার': 'fastfood', coffee: 'cafe', cafe: 'cafe', 'কফি': 'cafe', 'চা': 'cafe',
    pharmacy: 'pharmacy', 'ফার্মেসি': 'pharmacy', 'ফার্মেসী': 'pharmacy', 'ওষুধ': 'pharmacy', farmesi: 'pharmacy', dentist: 'dental', 'ডেন্টিস্ট': 'dental',
    'দাঁত': 'dental', 'চক্ষু': 'eye', 'চোখ': 'eye', police: 'police', 'পুলিশ': 'police', 'থানা': 'police', thana: 'police', fire: 'fire', 'ফায়ার': 'fire',
    ambulance: 'ambulance', 'অ্যাম্বুলেন্স': 'ambulance', 'এম্বুলেন্স': 'ambulance', mobile: null };
  const STOP = new Set(['যশোরে', 'যশোর', 'jashore', 'jessore', 'ভালো', 'valo', 'bhalo', 'best', 'good', 'আমার', 'খুঁজছি', 'চাই', 'কোথায়', 'in', 'the', 'a',
    'মধ্যে', 'টাকার', 'taka', 'tk', 'জন্য', 'সঙ্গে', 'নিয়ে', 'কম', 'বাজেটে', 'জায়গা', 'kothay', 'ki', 'কী', 'of', 'for']);
  const NEAR = new Set(['কাছাকাছি', 'কাছে', 'near', 'nearby', 'nearest', 'kache', 'kachakachi', 'me']);
  const OPEN = new Set(['খোলা', 'open', 'আজ', 'now', 'এখন', 'khola', '24', '২৪', 'ঘণ্টা']);

  function search(q) {
    const nq = norm(q);
    const tokens = nq.split(' ').filter(Boolean);
    const intent = { near: false, open: false, budget: null, cats: new Set(), sub: null, blood: null };
    const words = [];
    const bg = nq.match(/\b(a|b|ab|o)\s*(\+|-|positive|negative|pos|neg)/i);
    if (bg) intent.blood = bg[1].toUpperCase() + (bg[2].startsWith('-') || bg[2].startsWith('neg') ? '-' : '+');
    tokens.forEach(t => {
      if (NEAR.has(t)) { intent.near = true; return; }
      if (OPEN.has(t)) { intent.open = true; return; }
      if (/^\d{2,5}$/.test(t) && +t >= 50 && t !== '999') { intent.budget = +t; return; }
      if (STOP.has(t) || /^(a|b|ab|o)[+-]$/.test(t)) return;
      if (t in SUBKEYS && SUBKEYS[t]) intent.sub = SUBKEYS[t];
      let hit = KEYS.find(x => x.k === t) || KEYS.find(x => t.length >= 3 && (x.k.startsWith(t) || t.startsWith(x.k)) && x.k.length >= 3);
      if (!hit && /^[a-z]{4,}$/.test(t)) hit = KEYS.find(x => /^[a-z]/.test(x.k) && lev(t, x.k) <= (t.length > 6 ? 2 : 1));
      if (hit) { intent.cats.add(hit.cat); if (hit.sub) intent.sub = hit.sub; }
      words.push(t);
    });
    if (intent.blood) { intent.cats.add('hospital'); intent.sub = 'bloodbank'; }

    const scored = [];
    for (const it of allItems()) {
      if (it.status === 'closed') continue;
      const hay = norm([it.name, it.nameEn, it.area, it.address, (it.tags || []).join(' '), CAT[it.cat].subs[it.sub], it.note].join(' '));
      let s = 0, nameHit = false;
      if (intent.cats.size && intent.cats.has(it.cat)) s += 4;
      if (intent.sub && intent.sub === it.sub) s += 4;
      for (const w of words) {
        if (norm(it.name).includes(w) || norm(it.nameEn).includes(w)) { s += 6; nameHit = true; }
        else if (hay.includes(w)) s += 3;
        else if (/^[a-z]{4,}$/.test(w) && hay.split(' ').some(h => lev(w, h) <= 1)) s += 2;
      }
      if (!words.length && intent.cats.has(it.cat)) s += 1;
      if (intent.cats.size && !intent.cats.has(it.cat) && s < 6) s = 0;
      if (s <= 0) continue;
      if (intent.open && isOpen(it) !== true) continue;
      if (intent.budget && it.price && it.price > intent.budget) continue;
      const r = ratingOf(it.id);
      scored.push({ it, nameHit, s: s + (r ? r.avg / 5 : 0) });
    }
    // a detected sub-type (কাচ্চি, ফার্মেসি, থানা…) narrows results when anything matches it
    const narrowed = intent.sub ? scored.filter(x => x.it.sub === intent.sub || x.nameHit) : [];
    if (narrowed.some(x => x.it.sub === intent.sub)) scored.splice(0, scored.length, ...narrowed);
    scored.sort((a, b) => b.s - a.s);
    let list = scored.map(x => x.it);
    if (intent.near && here) list = list.sort((a, b) => (distKm(a) ?? 1e9) - (distKm(b) ?? 1e9));
    return { list, intent };
  }

  /* ---------------- components ---------------- */
  const stars = (v, size = '') => `<span class="stars ${size}" aria-label="${bn(v.toFixed(1))} স্টার">${[1, 2, 3, 4, 5].map(i =>
    `<i class="${v >= i - .25 ? 'on' : v >= i - .75 ? 'half' : ''}">★</i>`).join('')}</span>`;

  function badge(it) {
    const [t, k] = STATUS[it.status] || STATUS.pending;
    return `<span class="badge ${k}">${k === 'ok' ? '✓ ' : ''}${t}</span>`;
  }
  function openBadge(it) {
    const o = isOpen(it);
    if (it.hours === '24h' && o) return '<span class="badge ok">২৪ ঘণ্টা</span>';
    return o === true ? '<span class="badge ok">এখন খোলা</span>' : o === false ? '<span class="badge bad">এখন বন্ধ</span>' : '';
  }

  function card(it) {
    const c = CAT[it.cat], r = ratingOf(it.id), d = distKm(it);
    return `<a class="card" href="#/p/${esc(it.id)}">
      <div class="ava" data-cat="${c.id}">${c.icon}</div>
      <div class="cbody">
        <div class="ctitle">${esc(it.name)}</div>
        <div class="cmeta">${esc(c.subs[it.sub] || c.bn)}${it.area ? ' · ' + esc(it.area) : ''}${d != null ? ' · ' + distText(d) : ''}</div>
        <div class="crow">
          ${r ? `${stars(r.avg, 'sm')} <b>${bn(r.avg.toFixed(1))}</b><span class="muted">(${bn(r.n)})</span>` : ''}
          ${openBadge(it)} ${it.price ? `<span class="badge">~৳${bn(it.price)}</span>` : ''}
          ${it.sponsored ? '<span class="badge ad">Sponsored</span>' : ''}${it.demo ? '<span class="badge demo">নমুনা</span>' : ''}
        </div>
      </div>
      ${it.phone ? `<span class="callbtn" data-call="${esc(it.phone)}" role="button" aria-label="কল করুন">📞</span>` : ''}
    </a>`;
  }

  const empty = (msg, extra = '') => `<div class="empty"><div class="big">🔍</div><p>${msg}</p>${extra}</div>`;

  function topbar(title, back = true) {
    return `<header class="top">
      ${back ? '<button class="iconbtn" data-back aria-label="ফিরে যান">←</button>' : '<a class="logo" href="#/"><span>Jashore</span>360</a>'}
      ${title ? `<h1>${esc(title)}</h1>` : '<span class="flex"></span>'}
      <a class="sos" href="#/emergency" aria-label="জরুরি সেবা">SOS</a>
    </header>`;
  }

  /* ---------------- pages ---------------- */
  const pages = {};

  pages.home = () => {
    const quick = [['#/emergency?sub=ambulance', '🚑', 'অ্যাম্বুলেন্স'], ['#/c/hospital?sub=govt', '🏥', 'হাসপাতাল'],
      ['#/emergency?sub=police', '👮', 'পুলিশ'], ['#/emergency?sub=fire', '🚒', 'ফায়ার'], ['#/emergency?sub=blood', '🩸', 'রক্ত']];
    const items = allItems();
    const top = items.map(it => ({ it, r: ratingOf(it.id) })).filter(x => x.r).sort((a, b) => b.r.avg - a.r.avg || b.r.n - a.r.n).slice(0, 5);
    const near = here ? items.filter(i => i.lat != null && i.cat !== 'emergency').sort((a, b) => distKm(a) - distKm(b)).slice(0, 5) : [];
    const recent = store.get('recent', []).map(getItem).filter(Boolean).slice(0, 5);
    const places = items.filter(i => i.cat === 'place');
    const cats = ['restaurant', 'hospital', 'shop', 'hotel', 'service', 'place', 'education'];
    return `${topbar('', false)}
    <section class="hero">
      <form class="searchbar" data-search>
        <span>🔍</span><input name="q" type="search" placeholder="যশোরে কী খুঁজছেন?" autocomplete="off" enterkeyhint="search" aria-label="খুঁজুন">
      </form>
      <div class="chips scroll">${['কাছাকাছি হাসপাতাল', 'আজ খোলা ফার্মেসি', '২০০ টাকার মধ্যে রেস্টুরেন্ট', 'কাচ্চি', 'মোবাইল সার্ভিসিং', 'পরিবার নিয়ে ঘোরার জায়গা']
        .map(s => `<a class="chip" href="#/search?q=${encodeURIComponent(s)}">${s}</a>`).join('')}</div>
    </section>

    <section class="emg">
      <div class="emg-head"><b>🚨 জরুরি সেবা</b><a href="#/emergency">সব দেখুন →</a></div>
      <a class="call999" href="tel:999">📞 ৯৯৯ — জাতীয় জরুরি সেবা <small>পুলিশ · ফায়ার · অ্যাম্বুলেন্স (ফ্রি)</small></a>
      <div class="qgrid">${quick.map(([h, i, t]) => `<a href="${h}" class="q"><span>${i}</span>${t}</a>`).join('')}</div>
    </section>

    <section><h2>ক্যাটাগরি</h2>
      <div class="cgrid">${cats.map(id => `<a class="cat" href="#/c/${id}"><span>${CAT[id].icon}</span>${CAT[id].en}<small>${CAT[id].bn}</small></a>`).join('')}
        <a class="cat soon" href="#/soon/jobs"><span>💼</span>Jobs<small>শীঘ্রই আসছে</small></a></div>
    </section>

    <section><div class="shead"><h2>📍 আপনার কাছাকাছি</h2>${here ? '<button class="link" data-locate>রিফ্রেশ</button>' : ''}</div>
      ${here ? `<div class="list">${near.map(card).join('')}</div>`
        : `<button class="wide" data-locate>📍 লোকেশন দিয়ে কাছাকাছি দেখুন</button><p class="hint">লোকেশন ছাড়াও সব সার্চ ও তালিকা ব্যবহার করা যাবে।</p>`}
    </section>

    ${top.length ? `<section><h2>⭐ সেরা রেটিং</h2><div class="list">${top.map(x => card(x.it)).join('')}</div></section>` : ''}

    <section><div class="shead"><h2>🌿 যশোর ঘুরে দেখুন</h2><a href="#/c/place">সব →</a></div>
      <div class="hscroll">${places.map(p => `<a class="pcard" href="#/p/${p.id}"><div class="pimg">${p.sub === 'nature' ? '🌼' : p.sub === 'heritage' ? '🏛️' : '🛣️'}</div><b>${esc(p.name)}</b><small>${esc(p.area)}</small></a>`).join('')}</div>
    </section>

    ${recent.length ? `<section><h2>🕘 সম্প্রতি দেখেছেন</h2><div class="list">${recent.map(card).join('')}</div></section>` : ''}

    <section class="biz">
      <b>🏪 আপনার ব্যবসা যুক্ত করুন — বিনামূল্যে</b>
      <p>দোকান, রেস্টুরেন্ট বা সার্ভিসের তথ্য দিন। যাচাইয়ের পর প্রকাশিত হবে।</p>
      <a class="btn" href="#/add">ব্যবসা যুক্ত করুন</a>
    </section>
    <p class="disclaimer">Jashore360 একটি স্বতন্ত্র তথ্য প্ল্যাটফর্ম, সরকারি অ্যাপ নয় এবং নিজে কোনো জরুরি সেবা দেয় না। "নমুনা" চিহ্নিত তথ্য শুধু প্রদর্শনের জন্য।</p>`;
  };

  pages.emergency = (_, qs) => {
    const sub = qs.get('sub') || '';
    const c = CAT.emergency;
    let list = allItems().filter(i => i.cat === 'emergency' && (!sub || i.sub === sub || (sub === 'ambulance' && i.id === 'e999') || (sub === 'police' && i.id === 'e999') || (sub === 'fire' && i.id === 'e999')));
    if (sub === 'blood') list = allItems().filter(i => i.sub === 'bloodbank');
    list.sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || (b.phone ? 1 : 0) - (a.phone ? 1 : 0));
    return `${topbar('জরুরি সেবা')}
    <a class="call999 big" href="tel:999">📞 ৯৯৯ এ কল করুন<small>পুলিশ · ফায়ার সার্ভিস · অ্যাম্বুলেন্স — ২৪ ঘণ্টা, ফ্রি</small></a>
    <div class="chips scroll">${[['', 'সব'], ...Object.entries(c.subs), ['blood', 'রক্ত']].filter((v, i, a) => a.findIndex(x => x[0] === v[0]) === i)
      .map(([k, v]) => `<a class="chip ${k === sub ? 'on' : ''}" href="#/emergency${k ? '?sub=' + k : ''}">${v}</a>`).join('')}</div>
    ${sub === 'blood' ? `<div class="note">🩸 রক্তদাতা নেটওয়ার্ক শীঘ্রই আসছে। এখনই প্রয়োজন হলে নিকটস্থ সরকারি হাসপাতালের ব্লাড ব্যাংকে যোগাযোগ করুন বা <a href="#/c/hospital">হাসপাতাল তালিকা</a> দেখুন।</div>` : ''}
    <div class="note warn">🐍 <b>সাপে কামড়ালে:</b> ওঝা নয়, দ্রুত নিকটস্থ সরকারি হাসপাতাল বা উপজেলা স্বাস্থ্য কমপ্লেক্সে যান। আক্রান্ত স্থান নাড়াচাড়া কম করুন। <a href="#/search?q=snake">হাসপাতাল দেখুন →</a></div>
    <div class="list">${list.map(it => emgRow(it)).join('') || empty('এই ধরনের তথ্য এখনো যুক্ত হয়নি।')}</div>
    <p class="disclaimer">এই অ্যাপ নিজে জরুরি সেবা দেয় না। স্থানীয় নম্বরগুলো যাচাই করে যুক্ত করা হচ্ছে — নিশ্চিত না হলে ৯৯৯ ব্যবহার করুন।</p>`;
  };
  function emgRow(it) {
    return `<div class="erow">
      <a class="einfo" href="#/p/${esc(it.id)}"><b>${esc(it.name)}</b>
        <small>${esc(it.note || CAT[it.cat].subs[it.sub] || '')}${it.area ? ' · ' + esc(it.area) : ''}</small>
        <span class="crow">${badge(it)} ${openBadge(it)}</span></a>
      ${it.phone ? `<a class="ecall" href="tel:${esc(it.phone)}">📞<span>${bn(it.phone)}</span></a>`
        : `<a class="emap" href="${mapUrl(it)}" target="_blank" rel="noopener">🗺️<span>ম্যাপ</span></a>`}
    </div>`;
  }

  pages.cat = ([id], qs) => {
    const c = CAT[id]; if (!c) return pages.notfound();
    if (id === 'emergency') return pages.emergency([], qs);
    const sub = qs.get('sub') || '', open = qs.get('open') === '1', budget = +qs.get('budget') || 0, sort = qs.get('sort') || '';
    const link = o => { const p = new URLSearchParams({ sub, open: open ? '1' : '', budget: budget || '', sort, ...o });
      [...p.keys()].forEach(k => !p.get(k) && p.delete(k)); return `#/c/${id}${p.toString() ? '?' + p : ''}`; };
    let list = allItems().filter(i => i.cat === id && (!sub || i.sub === sub) && (!open || isOpen(i) === true) && (!budget || !i.price || i.price <= budget));
    const ads = list.filter(i => i.sponsored && i.status !== 'closed').slice(0, 1);
    list = list.filter(i => !ads.includes(i));
    if (sort === 'rating') list.sort((a, b) => (ratingOf(b.id)?.avg || 0) - (ratingOf(a.id)?.avg || 0));
    else if (sort === 'near') list.sort((a, b) => (distKm(a) ?? 1e9) - (distKm(b) ?? 1e9));
    else list.sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || (a.demo ? 1 : 0) - (b.demo ? 1 : 0));
    const hasPrice = allItems().some(i => i.cat === id && i.price);
    return `${topbar(c.bn)}
    <div class="chips scroll"><a class="chip ${!sub ? 'on' : ''}" href="${link({ sub: '' })}">সব</a>
      ${Object.entries(c.subs).map(([k, v]) => `<a class="chip ${k === sub ? 'on' : ''}" href="${link({ sub: k })}">${v}</a>`).join('')}</div>
    <div class="filters">
      <a class="fchip ${open ? 'on' : ''}" href="${link({ open: open ? '' : '1' })}">🟢 এখন খোলা</a>
      <a class="fchip ${sort === 'rating' ? 'on' : ''}" href="${link({ sort: sort === 'rating' ? '' : 'rating' })}">⭐ রেটিং</a>
      <a class="fchip ${sort === 'near' ? 'on' : ''}" href="${link({ sort: sort === 'near' ? '' : 'near' })}" ${!here ? 'data-needloc' : ''}>📍 কাছাকাছি</a>
      ${hasPrice ? `<select class="fchip" data-budget aria-label="বাজেট">${[0, 100, 200, 300, 500, 1000, 2000].map(b =>
        `<option value="${b}" ${b === budget ? 'selected' : ''}>${b ? '৳' + bn(b) + ' পর্যন্ত' : '💰 বাজেট'}</option>`).join('')}</select>` : ''}
    </div>
    ${ads.length ? `<div class="list adslot">${ads.map(card).join('')}</div>` : ''}
    <p class="count">${bn(list.length + ads.length)}টি ফলাফল</p>
    <div class="list">${list.map(card).join('') || empty('কোনো ফলাফল পাওয়া যায়নি।', `<a class="btn" href="${link({ open: '', budget: '', sub: '' })}">ফিল্টার মুছুন</a>`)}</div>
    <a class="addfab" href="#/add?cat=${id}">＋ তথ্য যোগ করুন</a>`;
  };

  pages.search = (_, qs) => {
    const q = qs.get('q') || '';
    const hist = store.get('hist', []);
    if (!q) return `${topbar('খুঁজুন')}
      <form class="searchbar solo" data-search><span>🔍</span><input name="q" type="search" placeholder="যশোরে কী খুঁজছেন?" autofocus enterkeyhint="search"></form>
      ${hist.length ? `<h2>সাম্প্রতিক সার্চ</h2><div class="chips">${hist.map(h => `<a class="chip" href="#/search?q=${encodeURIComponent(h)}">${esc(h)}</a>`).join('')}</div>` : ''}`;
    const { list, intent } = search(q);
    if (!hist.includes(q)) store.set('hist', [q, ...hist].slice(0, 8));
    const cats = [...intent.cats];
    return `${topbar('খুঁজুন')}
    <form class="searchbar solo" data-search><span>🔍</span><input name="q" type="search" value="${esc(q)}" enterkeyhint="search"></form>
    <div class="chips">${cats.map(c => `<a class="chip on" href="#/c/${c}${intent.sub && CAT[c].subs[intent.sub] ? '?sub=' + intent.sub : ''}">${CAT[c].icon} ${CAT[c].bn}${intent.sub && CAT[c].subs[intent.sub] ? ' › ' + CAT[c].subs[intent.sub] : ''}</a>`).join('')}
      ${intent.open ? '<span class="chip">🟢 এখন খোলা</span>' : ''}${intent.budget ? `<span class="chip">৳${bn(intent.budget)} পর্যন্ত</span>` : ''}
      ${intent.near ? (here ? '<span class="chip">📍 কাছাকাছি</span>' : '<button class="chip" data-locate>📍 লোকেশন দিন</button>') : ''}
      ${intent.blood ? `<span class="chip">🩸 ${esc(intent.blood)}</span>` : ''}</div>
    ${intent.blood ? '<div class="note">🩸 রক্তদাতা নেটওয়ার্ক শীঘ্রই আসছে। আপাতত ব্লাড ব্যাংক ও হাসপাতাল দেখানো হচ্ছে।</div>' : ''}
    <p class="count">${bn(list.length)}টি ফলাফল</p>
    <div class="list">${list.map(card).join('') || empty(`"${esc(q)}" — কিছু পাওয়া যায়নি।`, '<a class="btn" href="#/add">নতুন তথ্য যোগ করুন</a>')}</div>`;
  };

  pages.item = ([id]) => {
    const it = getItem(id); if (!it) return pages.notfound();
    const c = CAT[it.cat], r = ratingOf(id), saved = store.get('saved', []).includes(id), d = distKm(it);
    const rec = store.get('recent', []).filter(x => x !== id); store.set('recent', [id, ...rec].slice(0, 12));
    const reviews = reviewsOf(id).filter(x => !x.hidden).sort((a, b) => b.t - a.t);
    const mine = store.get('mine', {})[id];
    const crit = D.criteria[it.cat] || [];
    const nearby = allItems().filter(x => x.id !== id && x.lat != null && it.lat != null && ['restaurant', 'hotel'].includes(x.cat) && it.cat === 'place')
      .map(x => ({ x, d: Math.hypot(x.lat - it.lat, x.lng - it.lng) })).sort((a, b) => a.d - b.d).slice(0, 3).map(o => o.x);
    return `${topbar(c.bn)}
    <article class="detail">
      <div class="dhead"><div class="ava lg" data-cat="${c.id}">${c.icon}</div>
        <div><h1>${esc(it.name)}</h1>${it.nameEn ? `<div class="muted">${esc(it.nameEn)}</div>` : ''}
          <div class="crow">${badge(it)} ${openBadge(it)} ${it.sponsored ? '<span class="badge ad">Sponsored</span>' : ''} ${it.demo ? '<span class="badge demo">নমুনা তথ্য</span>' : ''}</div>
          ${r ? `<div class="crow">${stars(r.avg)} <b>${bn(r.avg.toFixed(1))}</b> <span class="muted">${bn(r.n)}টি রিভিউ</span></div>` : ''}
        </div></div>
      <div class="actions">
        ${it.phone ? `<a class="act primary" href="tel:${esc(it.phone)}">📞<span>কল</span></a>` : `<span class="act dis">📞<span>নম্বর নেই</span></span>`}
        <a class="act" href="${dirUrl(it)}" target="_blank" rel="noopener">🧭<span>দিকনির্দেশ</span></a>
        <a class="act" href="${mapUrl(it)}" target="_blank" rel="noopener">🗺️<span>ম্যাপ</span></a>
        <button class="act" data-save="${esc(id)}">${saved ? '❤️' : '🤍'}<span>${saved ? 'সেভড' : 'সেভ'}</span></button>
        <button class="act" data-share="${esc(id)}">↗️<span>শেয়ার</span></button>
      </div>
      ${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}
      ${it.demo ? '<div class="note warn">এটি নমুনা তথ্য — বাস্তব প্রতিষ্ঠান নয়। শুধু অ্যাপ কীভাবে কাজ করে তা দেখানোর জন্য।</div>' : ''}
      ${!it.phone && it.cat === 'emergency' ? '<div class="note warn">স্থানীয় নম্বর যাচাই চলছে। জরুরি প্রয়োজনে <a href="tel:999">৯৯৯</a> এ কল করুন।</div>' : ''}
      <dl class="info">
        <div><dt>ক্যাটাগরি</dt><dd>${esc(c.subs[it.sub] || c.bn)}</dd></div>
        ${it.area || it.address ? `<div><dt>ঠিকানা</dt><dd>${esc([it.address, it.area, 'যশোর'].filter(Boolean).join(', '))}${d != null ? ` <span class="muted">(${distText(d)})</span>` : ''}</dd></div>` : ''}
        ${it.phone ? `<div><dt>ফোন</dt><dd><a href="tel:${esc(it.phone)}">${bn(it.phone)}</a></dd></div>` : ''}
        ${it.cat !== 'place' || it.hours ? `<div><dt>সময়সূচি</dt><dd>${hoursText(it)}</dd></div>` : ''}
        ${it.price ? `<div><dt>আনুমানিক খরচ</dt><dd>৳${bn(it.price)}${it.cat === 'hotel' ? ' / রাত থেকে' : it.cat === 'service' ? ' থেকে' : ' জনপ্রতি'}</dd></div>` : ''}
        ${it.features?.length ? `<div><dt>সুবিধা</dt><dd>${it.features.map(f => `<span class="badge">${esc(f)}</span>`).join(' ')}</dd></div>` : ''}
        ${it.web ? `<div><dt>ওয়েব/ফেসবুক</dt><dd><a href="${esc(it.web)}" target="_blank" rel="noopener nofollow">${esc(it.web)}</a></dd></div>` : ''}
        <div><dt>তথ্যের অবস্থা</dt><dd>${STATUS[it.status]?.[0] || ''}${it.verifiedAt ? ` · সর্বশেষ যাচাই ${bn(it.verifiedAt)}` : ''}</dd></div>
      </dl>
      <button class="link" data-report-item="${esc(id)}">⚠️ তথ্য ভুল বা পুরনো? জানান</button>

      ${nearby.length ? `<h2>কাছাকাছি খাবার ও থাকা</h2><div class="list">${nearby.map(card).join('')}</div>` : ''}

      <h2>রিভিউ ও রেটিং</h2>
      ${it.cat === 'hospital' ? '<p class="hint">চিকিৎসার ফলাফল বা নির্দিষ্ট চিকিৎসক সম্পর্কে অভিযোগ বিশেষ মডারেশনের মাধ্যমে যায়। রোগীর ব্যক্তিগত তথ্য লিখবেন না।</p>' : ''}
      ${it.cat === 'emergency' ? '' : mine ? '<p class="hint">✓ আপনি এই প্রতিষ্ঠানে রিভিউ দিয়েছেন।</p>' : `
      <form class="rform" data-review="${esc(id)}">
        <div class="starpick" data-field="stars">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-v="${i}" aria-label="${bn(i)} স্টার">★</button>`).join('')}</div>
        ${crit.map((k, n) => `<label class="crit"><span>${esc(k)}</span><span class="starpick sm" data-field="c${n}">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-v="${i}">★</button>`).join('')}</span></label>`).join('')}
        <textarea name="text" rows="3" maxlength="800" placeholder="আপনার অভিজ্ঞতা লিখুন (ঐচ্ছিক)"></textarea>
        <label class="file">📷 ছবি যোগ করুন<input type="file" name="photo" accept="image/*"></label><img class="preview" hidden alt="">
        <button class="btn" type="submit">রিভিউ দিন</button>
      </form>`}
      <div class="reviews">${reviews.map(rv => `<div class="rv">
        <div class="crow">${stars(rv.stars, 'sm')} <span class="muted">${bn(new Date(rv.t).toLocaleDateString('en-GB'))}</span></div>
        ${rv.crit ? `<div class="muted small">${Object.entries(rv.crit).map(([k, v]) => `${esc(k)}: ${bn(v)}`).join(' · ')}</div>` : ''}
        ${rv.text ? `<p>${esc(rv.text)}</p>` : ''}${rv.photo ? `<img class="rphoto" src="${rv.photo}" alt="রিভিউয়ের ছবি" loading="lazy">` : ''}
        <div class="rvact"><button data-helpful="${esc(id)}|${rv.id}|1">👍 উপকারী ${rv.up ? bn(rv.up) : ''}</button>
          <button data-helpful="${esc(id)}|${rv.id}|0">👎 ${rv.down ? bn(rv.down) : ''}</button>
          <button data-report-review="${esc(id)}|${rv.id}">রিপোর্ট</button></div>
      </div>`).join('') || (it.cat === 'emergency' ? '' : '<p class="muted">এখনো কোনো রিভিউ নেই। প্রথম রিভিউ দিন!</p>')}</div>
    </article>`;
  };

  pages.explore = () => `${topbar('এক্সপ্লোর', false)}
    <form class="searchbar solo" data-search><span>🔍</span><input name="q" type="search" placeholder="যশোরে কী খুঁজছেন?" enterkeyhint="search"></form>
    ${D.categories.map(c => `<section class="xcat"><a class="xhead" href="#/c/${c.id}"><span>${c.icon}</span><b>${c.bn}</b><small>${c.en}</small><i>→</i></a>
      <div class="chips">${Object.entries(c.subs).map(([k, v]) => `<a class="chip" href="#/c/${c.id}?sub=${k}">${v}</a>`).join('')}</div></section>`).join('')}
    <section class="xcat"><h2>শীঘ্রই আসছে</h2><div class="chips">${['🩸 রক্তদাতা নেটওয়ার্ক', '💼 চাকরি', '🏠 বাসা ভাড়া', '🚕 যাতায়াত', '📰 খবর ও ইভেন্ট', '🎟️ অফার ও কুপন']
      .map(s => `<span class="chip">${s}</span>`).join('')}</div></section>`;

  pages.saved = () => {
    const list = store.get('saved', []).map(getItem).filter(Boolean);
    return `${topbar('সেভ করা', false)}<div class="list">${list.map(card).join('') ||
      empty('এখনো কিছু সেভ করেননি। পছন্দের জায়গায় 🤍 চাপুন।')}</div>`;
  };

  pages.add = (_, qs) => {
    const pre = qs.get('cat') || '';
    const cats = D.categories.filter(c => c.id !== 'emergency');
    return `${topbar('তথ্য যোগ করুন')}
    <form class="form" data-add>
      <p class="hint">ব্যবসা, প্রতিষ্ঠান বা জরুরি নম্বরের তথ্য দিন। অ্যাডমিন যাচাই করার পর প্রকাশিত হবে। * চিহ্নিত ঘর আবশ্যক।</p>
      <label>নাম *<input name="name" required maxlength="100" placeholder="প্রতিষ্ঠানের নাম"></label>
      <label>ইংরেজি নাম<input name="nameEn" maxlength="100" placeholder="English name (optional)"></label>
      <label>ক্যাটাগরি *<select name="cat" required data-catsel>${[...cats, CAT.emergency].map(c => `<option value="${c.id}" ${c.id === pre ? 'selected' : ''}>${c.icon} ${c.bn}</option>`).join('')}</select></label>
      <label>ধরন *<select name="sub" required data-subsel></select></label>
      <label>এলাকা *<select name="area" required>${D.areas.map(a => `<option>${a}</option>`).join('')}</select></label>
      <label>ঠিকানা<input name="address" maxlength="160" placeholder="রাস্তা, বাড়ি নং, ল্যান্ডমার্ক"></label>
      <label>ফোন নম্বর<input name="phone" inputmode="tel" pattern="[0-9+\\- ০-৯]{3,16}" placeholder="01XXXXXXXXX"></label>
      <div class="row2"><label>খোলে<input name="open" type="time"></label><label>বন্ধ হয়<input name="close" type="time"></label></div>
      <label class="check"><input type="checkbox" name="h24"> ২৪ ঘণ্টা খোলা</label>
      <label>আনুমানিক খরচ (৳)<input name="price" inputmode="numeric" placeholder="যেমন ২৫০"></label>
      <label>ওয়েবসাইট / ফেসবুক<input name="web" type="url" placeholder="https://"></label>
      <label>সংক্ষিপ্ত বিবরণ<textarea name="note" rows="3" maxlength="400"></textarea></label>
      <label>আপনার যোগাযোগ (যাচাইয়ের জন্য, প্রকাশ হবে না)<input name="contact" maxlength="80" placeholder="ফোন বা ইমেইল"></label>
      <label class="check"><input type="checkbox" name="consent" required> আমি নিশ্চিত করছি তথ্যগুলো সঠিক এবং প্রকাশের অনুমতি আছে *</label>
      <button class="btn" type="submit">জমা দিন</button>
    </form>`;
  };

  pages.profile = () => {
    const t = store.get('theme', 'auto');
    const mineN = Object.keys(store.get('mine', {})).length, subs = store.get('subs', []).filter(s => s.mine);
    return `${topbar('প্রোফাইল', false)}
    <section class="panel"><h2>⚙️ সেটিংস</h2>
      <div class="seg">${[['auto', 'অটো'], ['light', '☀️ লাইট'], ['dark', '🌙 ডার্ক']].map(([k, v]) => `<button data-theme-set="${k}" class="${t === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="kv"><span>লোকেশন</span><span>${here ? 'চালু ✓ <button class="link" data-forgetloc>মুছুন</button>' : 'বন্ধ <button class="link" data-locate>চালু করুন</button>'}</span></div>
    </section>
    <section class="panel"><h2>📋 আমার কার্যক্রম</h2>
      <div class="kv"><span>আমার রিভিউ</span><b>${bn(mineN)}</b></div>
      <div class="kv"><span>সেভ করা</span><b>${bn(store.get('saved', []).length)}</b></div>
      ${subs.map(s => `<div class="kv"><span>${esc(s.item.name)}</span><span class="badge ${s.review === 'approved' ? 'ok' : s.review === 'rejected' ? 'bad' : 'warn'}">${{ approved: 'প্রকাশিত', rejected: 'বাতিল', pending: 'অপেক্ষমাণ' }[s.review]}</span></div>`).join('')}
    </section>
    <section class="panel"><h2>ℹ️ Jashore360 সম্পর্কে</h2>
      <p>যশোরের হাসপাতাল, জরুরি সেবা, রেস্টুরেন্ট, দোকান, সার্ভিস ও দর্শনীয় স্থানের তথ্য এক জায়গায়।</p>
      <p class="hint">এটি সরকারি অ্যাপ নয়। অ্যাপ নিজে জরুরি সেবা দেয় না। পেইড বিজ্ঞাপন সবসময় "Sponsored" চিহ্নিত থাকে এবং বিজ্ঞাপন রেটিংকে প্রভাবিত করে না।</p>
      <p class="hint">আপনার রিভিউ ও সেটিংস এই ডিভাইসেই সংরক্ষিত থাকে।</p>
      <a class="link" href="#/admin">অ্যাডমিন প্যানেল →</a>
    </section>
    <button class="wide danger" data-wipe>🗑️ আমার সব ডেটা মুছুন</button>`;
  };

  pages.admin = (_, qs) => {
    const tab = qs.get('tab') || 'subs';
    const subs = store.get('subs', []), reports = store.get('reports', []);
    const pendingSubs = subs.filter(s => s.review === 'pending'), openReports = reports.filter(r => !r.done);
    const tabs = [['subs', `জমা (${bn(pendingSubs.length)})`], ['reports', `রিপোর্ট (${bn(openReports.length)})`], ['list', 'তালিকা'], ['data', 'ডেটা']];
    let body = '';
    if (tab === 'subs') body = pendingSubs.map(s => `<div class="panel">
        <b>${esc(s.item.name)}</b> <span class="muted">${CAT[s.item.cat].bn} › ${esc(CAT[s.item.cat].subs[s.item.sub] || '')}</span>
        <div class="small">${esc([s.item.address, s.item.area].filter(Boolean).join(', '))} · ${esc(s.item.phone || 'ফোন নেই')} · ${hoursText(s.item)}</div>
        ${s.item.note ? `<p class="small">${esc(s.item.note)}</p>` : ''}<div class="small muted">জমাদাতা: ${esc(s.contact || '—')} · ${bn(new Date(s.t).toLocaleString('en-GB'))}</div>
        <div class="rowbtn"><button class="btn" data-approve="${s.id}">✓ অনুমোদন (যাচাইকৃত)</button><button class="btn ghost" data-approve-pending="${s.id}">প্রকাশ (যাচাই চলছে)</button><button class="btn danger" data-reject="${s.id}">✕ বাতিল</button></div>
      </div>`).join('') || empty('কোনো অপেক্ষমাণ জমা নেই।');
    if (tab === 'reports') body = openReports.map(r => { const it = getItem(r.item);
      return `<div class="panel"><b>${r.kind === 'review' ? '💬 রিভিউ রিপোর্ট' : '⚠️ তথ্য সংশোধন'}</b> — <a href="#/p/${esc(r.item)}">${esc(it?.name || r.item)}</a>
        <p class="small">${esc(r.reason)}</p><div class="rowbtn">
        ${r.kind === 'review' ? `<button class="btn danger" data-hide-review="${r.id}">রিভিউ লুকান</button>` : `<a class="btn ghost" href="#/admin?tab=list&q=${encodeURIComponent(it?.name || '')}">তথ্য সম্পাদনা</a>`}
        <button class="btn ghost" data-resolve="${r.id}">সমাধান হয়েছে</button></div></div>`; }).join('') || empty('কোনো খোলা রিপোর্ট নেই।');
    if (tab === 'list') { const q = norm(qs.get('q') || '');
      const list = allItems().filter(i => !q || norm(i.name + ' ' + i.nameEn).includes(q)).slice(0, 60);
      body = `<form class="searchbar solo" data-adminq><span>🔍</span><input name="q" value="${esc(qs.get('q') || '')}" placeholder="তালিকায় খুঁজুন"></form>
        ${list.map(i => `<div class="panel arow"><div><b>${esc(i.name)}</b><div class="small muted">${CAT[i.cat].bn}${i.demo ? ' · নমুনা' : ''}</div></div>
        <select data-status="${esc(i.id)}">${Object.entries(STATUS).map(([k, [v]]) => `<option value="${k}" ${i.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <label class="check small"><input type="checkbox" data-sponsor="${esc(i.id)}" ${i.sponsored ? 'checked' : ''}> Sponsored</label></div>`).join('')}`; }
    if (tab === 'data') body = `<div class="panel"><p>এই ডিভাইসের সব ব্যবহারকারী-ডেটা (রিভিউ, জমা, রিপোর্ট, অবস্থা পরিবর্তন) JSON হিসেবে ডাউনলোড করুন — পরে সার্ভারে ইমপোর্টের জন্য।</p>
      <button class="btn" data-export>⬇️ JSON এক্সপোর্ট</button></div>
      <div class="panel"><p class="small">মোট তালিকা: ${bn(allItems().length)} · যাচাইকৃত: ${bn(allItems().filter(i => i.status === 'verified').length)} · নমুনা: ${bn(allItems().filter(i => i.demo).length)}</p></div>`;
    return `${topbar('অ্যাডমিন প্যানেল')}
      <div class="note warn">ডেমো অ্যাডমিন — ডেটা শুধু এই ব্রাউজারে থাকে। প্রোডাকশনে সার্ভার-সাইড লগইন ও রোল-ভিত্তিক অ্যাক্সেস লাগবে।</div>
      <div class="seg">${tabs.map(([k, v]) => `<a href="#/admin?tab=${k}" class="${k === tab ? 'on' : ''}">${v}</a>`).join('')}</div>${body}`;
  };

  pages.soon = () => `${topbar('শীঘ্রই আসছে')}${empty('এই ফিচারটি পরবর্তী সংস্করণে আসছে।', '<a class="btn" href="#/">হোমে ফিরুন</a>')}`;
  pages.notfound = () => `${topbar('পাওয়া যায়নি')}${empty('পেজটি পাওয়া যায়নি।', '<a class="btn" href="#/">হোমে ফিরুন</a>')}`;

  /* ---------------- router ---------------- */
  const routes = [
    [/^$/, 'home'], [/^emergency$/, 'emergency'], [/^c\/([\w-]+)$/, 'cat'], [/^p\/([\w-]+)$/, 'item'], [/^search$/, 'search'],
    [/^explore$/, 'explore'], [/^saved$/, 'saved'], [/^add$/, 'add'], [/^profile$/, 'profile'], [/^admin$/, 'admin'], [/^soon\/\w+$/, 'soon']
  ];
  const navMap = { home: 'home', explore: 'explore', cat: 'explore', search: 'explore', add: 'add', saved: 'saved', profile: 'profile' };
  let lastPath = null;
  function render() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, query = ''] = h.split('?');
    const qs = new URLSearchParams(query);
    let name = 'notfound', params = [];
    for (const [re, n] of routes) { const m = path.match(re); if (m) { name = n; params = m.slice(1); break; } }
    app.innerHTML = pages[name](params, qs);
    document.querySelectorAll('.bnav a').forEach(a => a.classList.toggle('on', a.dataset.nav === navMap[name]));
    if (path !== lastPath) window.scrollTo(0, 0);
    lastPath = path;
    if (name === 'add') fillSubs();
    const t = app.querySelector('h1')?.textContent;
    document.title = t && name !== 'home' ? `${t} · Jashore360` : 'Jashore360 — যশোরের সবকিছু এক অ্যাপে';
  }
  window.addEventListener('hashchange', render);

  /* ---------------- interactions ---------------- */
  function fillSubs() {
    const cs = app.querySelector('[data-catsel]'), ss = app.querySelector('[data-subsel]');
    if (!cs || !ss) return;
    ss.innerHTML = Object.entries(CAT[cs.value].subs).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  }

  async function doLocate(then) {
    toast('লোকেশন খোঁজা হচ্ছে…');
    try { await locate(); toast('লোকেশন পাওয়া গেছে ✓'); then ? (location.hash = then) : render(); }
    catch { toast('লোকেশন পাওয়া যায়নি — অনুমতি দিন বা পরে চেষ্টা করুন'); }
  }

  function addReport(kind, item, extra) {
    const reason = prompt(kind === 'review' ? 'রিভিউটি কেন অনুপযুক্ত? (ভুয়া, অপমানজনক, ব্যক্তিগত তথ্য…)' : 'কী ভুল আছে? (ফোন বদলেছে, বন্ধ হয়ে গেছে, ঠিকানা ভুল…)');
    if (!reason || !reason.trim()) return;
    const r = store.get('reports', []);
    r.push({ id: uid(), kind, item, rv: extra, reason: reason.trim().slice(0, 500), t: Date.now() });
    store.set('reports', r); toast('ধন্যবাদ! অ্যাডমিন পর্যালোচনা করবেন।');
  }

  function compressImage(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, 640 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas'); cv.width = img.width * s; cv.height = img.height * s;
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        res(cv.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = rej; img.src = url;
    });
  }

  function updateOverride(id, patch) {
    const ov = store.get('overrides', {});
    ov[id] = { ...(ov[id] || {}), ...patch };
    const subs = store.get('subs', []), s = subs.find(x => x.item.id === id);
    if (s) { Object.assign(s.item, patch); store.set('subs', subs); delete ov[id]; }
    store.set('overrides', ov);
  }

  document.addEventListener('click', async e => {
    const el = e.target.closest('button, [data-call], [data-needloc]');
    if (!el) return;
    const ds = el.dataset;
    if (ds.call) { e.preventDefault(); location.href = 'tel:' + ds.call; return; }
    if ('needloc' in ds) { e.preventDefault(); doLocate(el.getAttribute('href')); return; }
    if ('back' in ds) { history.length > 1 ? history.back() : (location.hash = '#/'); return; }
    if ('locate' in ds) return doLocate();
    if ('forgetloc' in ds) { here = null; store.set('loc', null); return render(); }
    if (ds.themeSet) { store.set('theme', ds.themeSet); applyTheme(); return render(); }
    if (ds.save) {
      const s = store.get('saved', []), i = s.indexOf(ds.save);
      i >= 0 ? s.splice(i, 1) : s.unshift(ds.save); store.set('saved', s);
      toast(i >= 0 ? 'সেভ থেকে সরানো হয়েছে' : 'সেভ হয়েছে ❤️'); return render();
    }
    if (ds.share) {
      const it = getItem(ds.share), url = location.href, text = `${it.name}${it.phone ? ' — ' + it.phone : ''} | Jashore360`;
      try { if (navigator.share) await navigator.share({ title: it.name, text, url }); else { await navigator.clipboard.writeText(text + '\n' + url); toast('লিংক কপি হয়েছে'); } } catch {}
      return;
    }
    if (ds.v && el.closest('.starpick')) {
      const p = el.closest('.starpick'); p.dataset.val = ds.v;
      p.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.v <= +ds.v)); return;
    }
    if (ds.helpful) {
      const [id, rid, up] = ds.helpful.split('|'), voted = store.get('votes', {});
      if (voted[rid]) return toast('আপনি আগেই ভোট দিয়েছেন');
      const all = store.get('reviews', {}), rv = (all[id] || []).find(x => x.id === rid); if (!rv) return;
      up === '1' ? rv.up = (rv.up || 0) + 1 : rv.down = (rv.down || 0) + 1;
      voted[rid] = 1; store.set('votes', voted); store.set('reviews', all); return render();
    }
    if (ds.reportReview) { const [id, rid] = ds.reportReview.split('|'); return addReport('review', id, rid); }
    if (ds.reportItem) return addReport('info', ds.reportItem);
    if (ds.wipe) { if (confirm('এই ডিভাইসে সংরক্ষিত আপনার সব রিভিউ, সেভ ও সেটিংস মুছে যাবে। নিশ্চিত?')) {
      Object.keys(localStorage).filter(k => k.startsWith('j360.')).forEach(k => localStorage.removeItem(k)); here = null; applyTheme(); toast('মুছে ফেলা হয়েছে'); render(); } return; }
    /* admin */
    const subAct = ds.approve || ds.approvePending || ds.reject;
    if (subAct) {
      const subs = store.get('subs', []), s = subs.find(x => x.id === subAct); if (!s) return;
      if (ds.reject) s.review = 'rejected';
      else { s.review = 'approved'; s.item.status = ds.approve ? 'verified' : 'pending'; if (ds.approve) s.item.verifiedAt = today(); }
      store.set('subs', subs); toast('আপডেট হয়েছে'); return render();
    }
    if (ds.resolve || ds.hideReview) {
      const reps = store.get('reports', []), r = reps.find(x => x.id === (ds.resolve || ds.hideReview)); if (!r) return;
      if (ds.hideReview) { const all = store.get('reviews', {}), rv = (all[r.item] || []).find(x => x.id === r.rv); if (rv) rv.hidden = true; store.set('reviews', all); }
      r.done = true; store.set('reports', reps); toast('সমাধান করা হয়েছে'); return render();
    }
    if ('export' in ds) {
      const dump = {}; Object.keys(localStorage).filter(k => k.startsWith('j360.')).forEach(k => dump[k.slice(5)] = store.get(k.slice(5)));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' }));
      a.download = `jashore360-export-${today()}.json`; a.click(); return;
    }
  });

  document.addEventListener('change', async e => {
    const el = e.target;
    if (el.matches('[data-catsel]')) return fillSubs();
    if (el.matches('[data-budget]')) {
      const [p, q = ''] = location.hash.split('?'), qs = new URLSearchParams(q);
      +el.value ? qs.set('budget', el.value) : qs.delete('budget'); location.hash = p + (qs.toString() ? '?' + qs : ''); return;
    }
    if (el.dataset.status) { const patch = { status: el.value }; if (el.value === 'verified') patch.verifiedAt = today(); updateOverride(el.dataset.status, patch); return toast('অবস্থা আপডেট হয়েছে'); }
    if (el.dataset.sponsor) { updateOverride(el.dataset.sponsor, { sponsored: el.checked }); return toast(el.checked ? 'Sponsored চালু' : 'Sponsored বন্ধ'); }
    if (el.name === 'photo' && el.files[0]) {
      try { const data = await compressImage(el.files[0]); const pv = el.closest('form').querySelector('.preview'); pv.src = data; pv.hidden = false; el.closest('form').dataset.photo = data; }
      catch { toast('ছবিটি পড়া যায়নি'); }
    }
  });

  document.addEventListener('submit', e => {
    const f = e.target; e.preventDefault();
    if ('search' in f.dataset) { const q = f.q.value.trim(); if (q) location.hash = '#/search?q=' + encodeURIComponent(q); f.q.blur(); return; }
    if ('adminq' in f.dataset) { location.hash = '#/admin?tab=list&q=' + encodeURIComponent(f.q.value.trim()); return; }
    if (f.dataset.review) {
      const id = f.dataset.review, st = +f.querySelector('[data-field="stars"]').dataset.val || 0;
      if (!st) return toast('অনুগ্রহ করে স্টার রেটিং দিন');
      const mine = store.get('mine', {}); if (mine[id]) return toast('একটি প্রতিষ্ঠানে একবারই রিভিউ দেওয়া যায়');
      const crit = {}; (D.criteria[getItem(id).cat] || []).forEach((k, n) => { const v = +f.querySelector(`[data-field="c${n}"]`)?.dataset.val; if (v) crit[k] = v; });
      const all = store.get('reviews', {});
      (all[id] = all[id] || []).push({ id: uid(), stars: st, crit: Object.keys(crit).length ? crit : null, text: f.text.value.trim(), photo: f.dataset.photo || null, t: Date.now() });
      if (!store.set('reviews', all)) return;
      mine[id] = 1; store.set('mine', mine); toast('রিভিউয়ের জন্য ধন্যবাদ!'); return render();
    }
    if ('add' in f.dataset) {
      const v = Object.fromEntries(new FormData(f));
      const phone = toLatinDigits(v.phone || '').replace(/[^\d+]/g, '');
      const item = { id: 'u-' + uid(), cat: v.cat, sub: v.sub, name: v.name.trim(), nameEn: v.nameEn.trim(), area: v.area, address: v.address.trim(),
        phone: phone || undefined, hours: v.h24 ? '24h' : v.open && v.close ? `${v.open}-${v.close}` : null,
        price: +toLatinDigits(v.price || '') || undefined, web: /^https?:\/\//.test(v.web) ? v.web : undefined, note: v.note.trim() || undefined, status: 'pending' };
      const subs = store.get('subs', []);
      if (subs.some(s => norm(s.item.name) === norm(item.name) && s.item.area === item.area) || allItems().some(i => norm(i.name) === norm(item.name) && i.area === item.area))
        return toast('এই নামে এই এলাকায় তথ্য আগেই আছে');
      subs.push({ id: uid(), item, contact: v.contact, review: 'pending', mine: true, t: Date.now() });
      store.set('subs', subs); toast('জমা হয়েছে! যাচাইয়ের পর প্রকাশিত হবে ✓'); location.hash = '#/profile';
    }
  });

  /* ---------------- boot ---------------- */
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
