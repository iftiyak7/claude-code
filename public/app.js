/* Jashore360 — public app. Vanilla JS, data from /api/bootstrap. */
(() => {
  'use strict';

  const app = document.getElementById('app');
  const nav = document.getElementById('fnav');
  let D = null, CAT = {};

  /* ---------------- utils ---------------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BN = '০১২৩৪৫৬৭৮৯';
  const bn = n => String(n).replace(/\d/g, d => BN[d]);
  const toLatin = s => String(s).replace(/[০-৯]/g, d => BN.indexOf(d));
  const ls = {
    get(k, d) { try { const v = localStorage.getItem('j360.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('j360.' + k, JSON.stringify(v)); } catch {} }
  };
  const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.5s-7.2-6.3-7.2-11.8a7.2 7.2 0 0 1 14.4 0c0 5.5-7.2 11.8-7.2 11.8z" fill="#fff"/><circle cx="12" cy="9.6" r="2.8" fill="#0e9f6e"/></svg>';

  let toastT;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function api(path, body, method) {
    const r = await fetch('/api' + path, {
      method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined
    });
    const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'সংযোগে সমস্যা হয়েছে, আবার চেষ্টা করুন');
    return data;
  }
  const track = (id, type) => { try { navigator.sendBeacon('/api/track', new Blob([JSON.stringify({ id, type })], { type: 'application/json' })); } catch {} };

  function compress(file, max = 1280, q = .8) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        res(cv.toDataURL('image/jpeg', q));
      };
      img.onerror = () => rej(new Error('ছবিটি পড়া যায়নি'));
      img.src = url;
    });
  }

  /* ---------------- theme ---------------- */
  function applyTheme() {
    const t = ls.get('theme', 'auto');
    t === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t);
  }
  applyTheme();

  /* ---------------- data helpers ---------------- */
  const items = () => D.listings;
  const getItem = id => D.listings.find(i => i.id === id);
  const catOf = it => CAT[it.cat] || { bn: '', icon: 'info', color: '#0e9f6e', subs: {} };
  const subLabel = it => catOf(it).subs?.[it.sub] || catOf(it).bn;
  const subIcon = it => catOf(it).subIcons?.[it.sub] || catOf(it).icon;
  const PRICE_UNIT = { restaurant: 'জনপ্রতি', hotel: 'প্রতি রাত', service: 'থেকে শুরু' };

  const STATUS = { verified: ['যাচাইকৃত', 'ok'], pending: ['যাচাই চলছে', 'warn'], needs_update: ['আপডেট প্রয়োজন', 'warn'],
    temp_closed: ['সাময়িক বন্ধ', 'bad'], closed: ['স্থায়ীভাবে বন্ধ', 'bad'] };

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
    if (!it.hours) return 'সময়সূচি জানা নেই';
    if (it.hours === '24h') return '২৪ ঘণ্টা খোলা';
    const f = t => { let [h, m] = t.split(':').map(Number); const p = h < 5 ? 'রাত' : h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : h < 18 ? 'বিকাল' : 'রাত';
      h = h % 12 || 12; return `${p} ${bn(h)}${m ? ':' + bn(String(m).padStart(2, '0')) : ''}টা`; };
    const days = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'];
    const [a, b] = it.hours.split('-');
    return `${f(a)} – ${f(b)}${it.off?.length ? ` · ${it.off.map(x => days[x]).join(', ')}বার বন্ধ` : ''}`;
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
  const kmText = k => k == null ? '' : k < 1 ? `${bn(Math.round(k * 20) * 50)} মি.` : `${bn(k.toFixed(k < 10 ? 1 : 0))} কিমি`;
  const q = it => encodeURIComponent([it.nameEn || it.name, it.address, it.area, 'Jashore', 'Bangladesh'].filter(Boolean).join(', '));
  const mapUrl = it => `https://www.google.com/maps/search/?api=1&query=${q(it)}`;
  const dirUrl = it => `https://www.google.com/maps/dir/?api=1&destination=${q(it)}`;

  /* ---------------- components ---------------- */
  const media = (it, cls = '') => {
    const img = it.images?.[0];
    return `<div class="media ${cls}" style="--c:${esc(catOf(it).color)}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async">`
      : `<div class="gen"><div class="ring">${icon(subIcon(it), 40)}</div></div>`}</div>`;
  };
  const starsHtml = (v, size = 14) => `<span class="stars">${[1, 2, 3, 4, 5].map(i => icon('star', size, v >= i - .3 ? 'on' : '')).join('')}</span>`;
  const rateTag = it => it.rating ? `<span class="rate">${icon('star', 13)}${bn(it.rating.toFixed(1))}<span class="muted" style="font-weight:400">(${bn(it.reviews)})</span></span>` : '';
  const statusTag = it => { const [t, k] = STATUS[it.status] || STATUS.pending; return `<span class="tag ${k}">${k === 'ok' ? icon('check', 12) : ''}${t}</span>`; };
  function openTag(it) {
    const o = isOpen(it);
    if (o && it.hours === '24h') return '<span class="tag ok">২৪ ঘণ্টা</span>';
    return o === true ? '<span class="tag ok">খোলা</span>' : o === false ? '<span class="tag bad">বন্ধ</span>' : '';
  }
  const saved = () => ls.get('saved', []);
  const isSaved = id => saved().includes(id);
  const heart = it => `<button class="heartbtn ${isSaved(it.id) ? 'on' : ''}" data-save="${esc(it.id)}" aria-label="সেভ">${icon('heart', 17)}</button>`;

  function gcard(it) {
    return `<a class="gcard" href="#/p/${esc(it.id)}">${media(it)}${heart(it)}
      ${it.sponsored ? '<span class="flag tag glass">Sponsored</span>' : it.demo ? '<span class="flag tag dark">নমুনা</span>' : ''}
      <div class="cap"><small>${esc(subLabel(it))}${it.area ? ' · ' + esc(it.area) : ''}</small><b>${esc(it.name)}</b>
        <div class="meta"><span>${it.price ? '৳' + bn(it.price) : isOpen(it) === true ? 'এখন খোলা' : ''}</span>${it.rating ? `<span class="rate">${icon('star', 12)}${bn(it.rating.toFixed(1))}</span>` : ''}</div></div></a>`;
  }
  function row(it, action = 'call') {
    const d = km(it);
    const act = it.phone && action === 'call' ? `<span class="act ${it.cat === 'emergency' ? 'red' : ''}" data-call="${esc(it.phone)}" data-id="${esc(it.id)}" role="button" aria-label="কল">${icon('phone', 18)}</span>`
      : `<span class="act">${icon('chevR', 18)}</span>`;
    return `<a class="row" href="#/p/${esc(it.id)}">${media(it)}<div class="body"><b>${esc(it.name)}</b>
      <div class="sub">${esc(subLabel(it))}${it.area ? ' · ' + esc(it.area) : ''}${d != null ? ' · ' + kmText(d) : ''}</div>
      <div class="meta">${rateTag(it)}${openTag(it)}${it.price ? `<span class="tag">৳${bn(it.price)}</span>` : ''}${it.sponsored ? '<span class="tag ad">Sponsored</span>' : ''}${it.demo ? '<span class="tag">নমুনা</span>' : ''}</div></div>${act}</a>`;
  }
  const wcard = it => `<a class="wcard" href="#/p/${esc(it.id)}">${media(it)}<div class="t"><b>${esc(it.name)}</b><small>${icon('pin', 13)}${esc(it.area || 'যশোর')}${km(it) != null ? ' · ' + kmText(km(it)) : ''}</small></div></a>`;
  const empty = (title, msg, extra = '', ic = 'search') => `<div class="empty"><div class="eic">${icon(ic, 30)}</div><b>${title}</b>${msg ? `<div>${msg}</div>` : ''}${extra}</div>`;
  const topbar = (title, right = '<span class="spacer"></span>') => `<header class="topbar"><button class="roundbtn" data-back aria-label="ফিরে যান">${icon('back', 20)}</button><h1>${esc(title)}</h1>${right}</header>`;

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
    });
  };
  const SUBKEYS = { kacchi: 'biryani', kachchi: 'biryani', 'কাচ্চি': 'biryani', biryani: 'biryani', biriyani: 'biryani', 'বিরিয়ানি': 'biryani', pizza: 'fastfood',
    burger: 'fastfood', 'পিজা': 'fastfood', 'বার্গার': 'fastfood', coffee: 'cafe', cafe: 'cafe', 'কফি': 'cafe', 'চা': 'cafe', pharmacy: 'pharmacy',
    'ফার্মেসি': 'pharmacy', 'ফার্মেসী': 'pharmacy', 'ওষুধ': 'pharmacy', farmesi: 'pharmacy', dentist: 'dental', 'ডেন্টিস্ট': 'dental', 'দাঁত': 'dental',
    'চক্ষু': 'eye', 'চোখ': 'eye', police: 'police', 'পুলিশ': 'police', 'থানা': 'police', thana: 'police', fire: 'fire', 'ফায়ার': 'fire',
    ambulance: 'ambulance', 'অ্যাম্বুলেন্স': 'ambulance', 'এম্বুলেন্স': 'ambulance' };
  const STOP = new Set(['যশোরে', 'যশোর', 'jashore', 'jessore', 'ভালো', 'valo', 'bhalo', 'best', 'good', 'আমার', 'খুঁজছি', 'চাই', 'কোথায়', 'in', 'the', 'a',
    'মধ্যে', 'টাকার', 'taka', 'tk', 'জন্য', 'সঙ্গে', 'নিয়ে', 'কম', 'বাজেটে', 'জায়গা', 'kothay', 'ki', 'কী', 'of', 'for']);
  const NEAR = new Set(['কাছাকাছি', 'কাছে', 'near', 'nearby', 'nearest', 'kache', 'kachakachi', 'me']);
  const OPEN = new Set(['খোলা', 'open', 'আজ', 'now', 'এখন', 'khola', '24', 'ঘণ্টা']);

  function search(text) {
    const tokens = norm(text).split(' ').filter(Boolean);
    const intent = { near: false, open: false, budget: null, cats: new Set(), sub: null }, words = [];
    tokens.forEach(t => {
      if (NEAR.has(t)) return void (intent.near = true);
      if (OPEN.has(t)) return void (intent.open = true);
      if (/^\d{2,5}$/.test(t) && +t >= 50 && t !== '999') return void (intent.budget = +t);
      if (STOP.has(t) || /^(a|b|ab|o)[+-]$/.test(t)) return;
      if (SUBKEYS[t]) intent.sub = SUBKEYS[t];
      let hit = KEYS.find(x => x.k === t) || KEYS.find(x => t.length >= 3 && x.k.length >= 3 && (x.k.startsWith(t) || t.startsWith(x.k)));
      if (!hit && /^[a-z]{4,}$/.test(t)) hit = KEYS.find(x => /^[a-z]/.test(x.k) && lev(t, x.k) <= (t.length > 6 ? 2 : 1));
      if (hit) { intent.cats.add(hit.cat); if (hit.sub && !intent.sub) intent.sub = hit.sub; }
      words.push(t);
    });
    const scored = [];
    for (const it of items()) {
      const hay = norm([it.name, it.nameEn, it.area, it.address, (it.tags || []).join(' '), subLabel(it), it.note].join(' '));
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
  const sheetHead = t => `<div class="shead"><h3>${t}</h3><button class="roundbtn" data-close aria-label="বন্ধ">${icon('x', 18)}</button></div>`;

  function filterSheet(p) {
    const cats = D.categories.filter(c => c.id !== 'emergency');
    const budget = +p.get('budget') || 0;
    openSheet(`${sheetHead('ফিল্টার')}
      <h4>ক্যাটাগরি</h4><div class="pills" style="flex-wrap:wrap;margin:0">${[{ id: '', bn: 'সব' }, ...cats].map(c =>
        `<button class="pill sm ${(p.get('cat') || '') === c.id ? 'on' : ''}" data-fcat="${c.id}">${c.icon ? icon(c.icon, 15) : ''}${esc(c.bn)}</button>`).join('')}</div>
      <h4>বাজেট (জনপ্রতি)</h4><input class="range" type="range" min="0" max="2000" step="50" value="${budget || 2000}" data-fbudget>
      <div class="rangeval"><span>৳০</span><b data-fbval>${budget ? '৳' + bn(budget) + ' পর্যন্ত' : 'যেকোনো'}</b><span>৳২০০০+</span></div>
      <h4>সাজানো</h4><div class="seg">${[['', 'প্রাসঙ্গিক'], ['rating', 'রেটিং'], ['near', 'কাছাকাছি']].map(([k, v]) =>
        `<button class="${(p.get('sort') || '') === k ? 'on' : ''}" data-fsort="${k}">${v}</button>`).join('')}</div>
      <label class="switch" style="margin-top:16px"><span>শুধু এখন খোলা</span><input type="checkbox" data-fopen ${p.get('open') ? 'checked' : ''}></label>
      <div class="two" style="margin-top:20px"><button class="btn ghost" data-freset>রিসেট</button><button class="btn" data-fapply>ফলাফল দেখুন</button></div>`, sh => {
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
      r.oninput = () => { st.budget = +r.value; sh.querySelector('[data-fbval]').textContent = +r.value >= 2000 ? 'যেকোনো' : '৳' + bn(r.value) + ' পর্যন্ত'; };
    });
  }

  function noticesSheet() {
    const list = D.notices || [];
    ls.set('seenNotices', list.map(n => n.id));
    openSheet(`${sheetHead('ঘোষণা ও আপডেট')}${list.map(n => `<div class="notice"><small>${esc(n.date ? bn(n.date) : '')}</small>
      <b style="display:block">${n.type === 'alert' ? '⚠ ' : ''}${esc(n.title)}</b><p>${esc(n.body)}</p></div>`).join('') || empty('কোনো ঘোষণা নেই', '', '', 'bell')}`);
    const d = document.querySelector('.homebar .dot'); d && d.remove();
  }

  function areaSheet() {
    const cur = ls.get('area', '');
    openSheet(`${sheetHead('আপনার এলাকা')}<p class="muted" style="margin:-6px 0 14px;font-size:13px">এলাকা বাছলে সেই এলাকার তথ্য আগে দেখাবে।</p>
      <div class="pills" style="flex-wrap:wrap;margin:0">${['', ...(D.areas || [])].map(a => `<button class="pill sm ${a === cur ? 'on' : ''}" data-area="${esc(a)}">${esc(a || 'পুরো যশোর')}</button>`).join('')}</div>`, sh => {
      sh.addEventListener('click', e => { const b = e.target.closest('[data-area]'); if (b) { ls.set('area', b.dataset.area); closeSheet(); render(); } });
    });
  }

  function reportSheet(listing, review) {
    openSheet(`${sheetHead(review ? 'রিভিউ রিপোর্ট করুন' : 'ভুল তথ্য জানান')}
      <div class="form"><label class="field"><span>${review ? 'কেন অনুপযুক্ত?' : 'কী ভুল আছে?'}</span>
      <textarea maxlength="600" placeholder="${review ? 'ভুয়া, অপমানজনক, ব্যক্তিগত তথ্য…' : 'ফোন নম্বর বদলেছে, ঠিকানা ভুল, বন্ধ হয়ে গেছে…'}"></textarea></label>
      <button class="btn block" data-send>পাঠান</button></div>`, sh => {
      sh.querySelector('[data-send]').onclick = async () => {
        const reason = sh.querySelector('textarea').value.trim();
        if (!reason) return toast('কারণ লিখুন');
        try { await api('/reports', { listing, review, reason }); closeSheet(); toast('ধন্যবাদ! আমরা দ্রুত পর্যালোচনা করব।'); } catch (e) { toast(e.message); }
      };
    });
  }

  function reviewSheet(it) {
    const crit = catOf(it).criteria || [];
    const pick = (f, sm = '') => `<div class="starpick ${sm}" data-field="${f}">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-v="${i}" aria-label="${bn(i)} স্টার">${icon('star', 24)}</button>`).join('')}</div>`;
    openSheet(`${sheetHead('রিভিউ লিখুন')}<div class="form">
      <div style="text-align:center"><div class="muted" style="font-size:13px;margin-bottom:8px">${esc(it.name)}</div>${pick('stars')}</div>
      ${crit.map((c, n) => `<div class="critrow"><span>${esc(c)}</span>${pick('c' + n, 'sm')}</div>`).join('')}
      <label class="field"><span>আপনার নাম (ঐচ্ছিক)</span><input maxlength="40" data-name placeholder="নাম"></label>
      <label class="field"><span>অভিজ্ঞতা</span><textarea maxlength="1500" data-text placeholder="কেমন লাগল? অন্যদের জন্য উপকারী তথ্য লিখুন"></textarea></label>
      <div class="photos" data-photos><label>${icon('camera', 22)}<input type="file" accept="image/*"></label></div>
      ${it.cat === 'hospital' ? '<div class="note warn">' + icon('info', 16) + '<span>রোগীর ব্যক্তিগত তথ্য লিখবেন না। চিকিৎসক সম্পর্কে অভিযোগ বিশেষ মডারেশনে যায়।</span></div>' : ''}
      <button class="btn block" data-submit>রিভিউ জমা দিন</button></div>`, sh => {
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
        if (!stars) return toast('স্টার রেটিং দিন');
        const c = {}; crit.forEach((k, n) => { const v = +sh.querySelector(`[data-field=c${n}]`).dataset.val; if (v) c[k] = v; });
        ev.target.disabled = true;
        try {
          await api('/reviews', { listing: it.id, stars, crit: c, name: sh.querySelector('[data-name]').value, text: sh.querySelector('[data-text]').value, photo });
          ls.set('myReviews', (ls.get('myReviews', 0) || 0) + 1);
          closeSheet(); toast('রিভিউয়ের জন্য ধন্যবাদ!'); await refresh(); render();
        } catch (er) { toast(er.message); ev.target.disabled = false; }
      };
    });
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
    const recent = ls.get('recent', []).map(getItem).filter(Boolean).slice(0, 6);
    const cats = D.categories.filter(c => c.id !== 'emergency');
    const quick = [['ambulance', 'ambulance', 'অ্যাম্বুলেন্স'], ['hospital', 'hospital', 'হাসপাতাল'], ['police', 'shield', 'পুলিশ'], ['fire', 'flame', 'ফায়ার'], ['', 'phone', 'সব নম্বর']];
    const head = esc(site.headline || 'যশোরের সবকিছু খুঁজুন এক জায়গায়').replace(/(যশোর\S*)/, '<span>$1</span>');
    return `
    <header class="homebar"><a class="brandmark" href="#/" aria-label="Jashore360">${LOGO}</a>
      <button class="loc" data-areasheet><small>আপনার এলাকা</small><b>${esc(area || 'পুরো যশোর')}${icon('chevD', 16)}</b></button>
      <button class="roundbtn" data-notices aria-label="ঘোষণা">${icon('bell', 20)}${unseen ? '<i class="dot"></i>' : ''}</button></header>
    <h1 class="headline">${head}</h1>
    <div class="searchrow"><a class="search" href="#/search">${icon('search', 20)}<span>খুঁজুন: হাসপাতাল, কাচ্চি, ফার্মেসি…</span></a>
      <button class="filterbtn" data-filter aria-label="ফিল্টার">${icon('sliders', 20)}</button></div>

    ${(D.banners || []).length ? `<div class="banners" data-carousel>${D.banners.map(b => `<a class="banner ${esc(b.theme || 'dark')}" href="${esc(b.link || '#/')}" ${/^https?:/.test(b.link || '') ? 'target="_blank" rel="noopener"' : ''}>
      ${b.image ? `<img class="bimg" src="${esc(b.image)}" alt="" loading="lazy">` : `<span class="deco">${icon(b.link?.startsWith('tel:') ? 'phone' : b.link === '#/add' ? 'store' : 'sparkle', 150)}</span>`}
      <div class="btext">${b.kicker ? `<small>${esc(b.kicker)}</small>` : ''}<h3>${esc(b.title)}</h3>${b.subtitle ? `<p>${esc(b.subtitle)}</p>` : ''}</div>
      ${b.cta ? `<span class="bcta">${esc(b.cta)}</span>` : ''}</a>`).join('')}</div>
      ${D.banners.length > 1 ? `<div class="dots" data-dots>${D.banners.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}` : ''}

    <section class="emg">
      <div class="emg-top"><span class="ib">${icon('siren', 22)}</span><div><b>জরুরি সহায়তা</b><small>${esc(site.hotlineNote || 'পুলিশ · ফায়ার · অ্যাম্বুলেন্স')}</small></div>
        <a class="callpill" href="tel:${esc(site.hotline || '999')}">${icon('phone', 18)}${bn(site.hotline || '999')}</a></div>
      <div class="emg-grid">${quick.map(([s, i, t]) => `<a href="${s === 'hospital' ? '#/c/hospital?sub=govt' : '#/emergency' + (s ? '?sub=' + s : '')}"><span>${icon(i, 22)}</span>${t}</a>`).join('')}</div>
    </section>

    <section class="sec"><div class="sechead"><h2>ক্যাটাগরি</h2><a href="#/explore">সব দেখুন${icon('chevR', 14)}</a></div>
      <div class="cats">${cats.map(c => `<a class="catt" href="#/c/${c.id}"><span style="--c:${esc(c.color)}">${icon(c.icon, 26)}</span>${esc(c.bn.split(' ')[0])}</a>`).join('')}</div></section>

    <section class="sec"><div class="sechead"><h2>জনপ্রিয়</h2><a href="#/${pop ? 'c/' + pop : 'search'}">সব দেখুন${icon('chevR', 14)}</a></div>
      <div class="pills">${[{ id: '', bn: 'সব' }, ...cats].map(c => `<button class="pill ${pop === c.id ? 'on' : ''}" data-pop="${c.id}">${esc(c.bn.split(' ')[0])}</button>`).join('')}</div>
      <div class="grid2">${ranked.map(gcard).join('') || '<p class="muted">এই ক্যাটাগরিতে এখনো তথ্য নেই।</p>'}</div></section>

    <section class="sec"><div class="sechead"><h2>আপনার কাছাকাছি</h2>${here ? `<button class="linkbtn" data-locate>${icon('refresh', 14)} রিফ্রেশ</button>` : ''}</div>
      ${here ? `<div class="rows">${near.map(i => row(i)).join('')}</div>` :
        `<button class="row" style="width:100%;border:0;text-align:left" data-locate><span class="media" style="--c:#0e9f6e;width:56px;height:56px"><span class="gen"><span class="ring" style="width:70%">${icon('nav', 26)}</span></span></span>
        <span class="body"><b>লোকেশন চালু করুন</b><span class="sub" style="white-space:normal">কাছাকাছি হাসপাতাল, ফার্মেসি ও দোকান দূরত্বসহ দেখুন</span></span><span class="act">${icon('chevR', 18)}</span></button>`}</section>

    ${places.length ? `<section class="sec"><div class="sechead"><h2>যশোর ঘুরে দেখুন</h2><a href="#/c/place">সব দেখুন${icon('chevR', 14)}</a></div>
      <div class="wcards">${places.map(wcard).join('')}</div></section>` : ''}

    ${recent.length ? `<section class="sec"><div class="sechead"><h2>সম্প্রতি দেখেছেন</h2></div><div class="rows">${recent.slice(0, 3).map(i => row(i)).join('')}</div></section>` : ''}
    <p class="foot">${esc(site.disclaimer || '')}</p>`;
  };

  pages.emergency = p => {
    const c = CAT.emergency || { subs: {}, subIcons: {} }, sub = p.get('sub') || '', site = D.site || {};
    let list = items().filter(i => i.cat === 'emergency' && (!sub || i.sub === sub || (i.pin && ['ambulance', 'police', 'fire'].includes(sub))));
    if (sub === 'blood') list = items().filter(i => i.sub === 'bloodbank' || (i.cat === 'emergency' && i.sub === 'blood'));
    list.sort((a, b) => (!!b.pin - !!a.pin) || (!!b.phone - !!a.phone));
    return `<div class="redhead"><div class="bar"><button class="roundbtn" data-back aria-label="ফিরে যান">${icon('back', 20)}</button><h1>জরুরি সেবা</h1><span class="spacer" style="width:44px"></span></div>
      <a class="call" href="tel:${esc(site.hotline || '999')}"><span class="ib">${icon('phone', 24)}</span><div><b>${bn(site.hotline || '999')} এ কল করুন</b><small>${esc(site.hotlineNote || '')}</small></div></a></div>
    <div class="pills" style="margin-top:18px">${[['', 'সব', 'grid'], ...Object.entries(c.subs).map(([k, v]) => [k, v, c.subIcons?.[k]])].map(([k, v, ic]) =>
      `<a class="pill sm ${k === sub ? 'on' : ''}" href="#/emergency${k ? '?sub=' + k : ''}">${ic ? icon(ic, 15) : ''}${esc(v)}</a>`).join('')}</div>
    ${site.snakeTip && (!sub || sub === 'hotline') ? `<div class="note warn">${icon('alert', 16)}<span><b>সাপে কামড়ালে:</b> ${esc(site.snakeTip)} <a href="#/search?q=snake" style="color:var(--brand);font-weight:600">হাসপাতাল দেখুন</a></span></div>` : ''}
    ${sub === 'blood' ? `<div class="note">${icon('droplet', 16)}<span>রক্তদাতা নেটওয়ার্ক শীঘ্রই আসছে। এখন প্রয়োজনে নিকটস্থ সরকারি হাসপাতালের ব্লাড ব্যাংকে যোগাযোগ করুন।</span></div>` : ''}
    <div class="rows">${list.map(i => row(i)).join('') || empty('এখনো তথ্য যুক্ত হয়নি', 'যাচাই করে শীঘ্রই যুক্ত করা হবে।')}</div>
    <p class="foot">${esc(site.disclaimer || '')} স্থানীয় নম্বর যাচাই না হলে ${bn(site.hotline || '999')} ব্যবহার করুন।</p>`;
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
    const title = qtext ? 'খুঁজুন' : c ? c.bn : 'সব তথ্য';
    const hist = ls.get('hist', []);
    if (qtext && !hist.includes(qtext)) ls.set('hist', [qtext, ...hist].slice(0, 8));
    return `${topbar(title, `<button class="roundbtn" data-filter aria-label="ফিল্টার">${icon('sliders', 20)}</button>`)}
      <div class="searchrow" style="margin-bottom:14px"><form class="search" data-search>${icon('search', 20)}<input name="q" type="search" value="${esc(qtext)}" placeholder="${c ? esc(c.bn) + '-এ খুঁজুন' : 'যশোরে কী খুঁজছেন?'}" enterkeyhint="search" autocomplete="off" ${!qtext && !c ? 'autofocus' : ''}>
        ${qtext ? `<button type="button" class="clear" data-clear aria-label="মুছুন">${icon('x', 16)}</button>` : ''}</form>
        <button class="filterbtn" data-filter aria-label="ফিল্টার">${icon('sliders', 20)}${active ? '<i class="dot"></i>' : ''}</button></div>
      ${c && Object.keys(c.subs || {}).length ? `<div class="pills"><a class="pill sm ${!sub ? 'on' : ''}" href="${link({ sub: '' })}">সব</a>${Object.entries(c.subs).map(([k, v]) =>
        `<a class="pill sm ${k === sub ? 'on' : ''}" href="${link({ sub: k })}">${esc(v)}</a>`).join('')}</div>` : ''}
      ${intent && (intent.cats.size || intent.open || intent.budget || intent.near) ? `<div class="pills">${[...intent.cats].map(id => CAT[id] ?
        `<a class="pill sm on" href="#/c/${id}${intent.sub && CAT[id].subs?.[intent.sub] ? '?sub=' + intent.sub : ''}">${icon(CAT[id].icon, 15)}${esc(CAT[id].bn)}</a>` : '').join('')}
        ${intent.open ? '<span class="pill sm">এখন খোলা</span>' : ''}${intent.budget ? `<span class="pill sm">৳${bn(intent.budget)} পর্যন্ত</span>` : ''}
        ${intent.near ? (here ? '<span class="pill sm">কাছাকাছি</span>' : `<button class="pill sm" data-locate>${icon('nav', 14)}লোকেশন দিন</button>`) : ''}</div>` : ''}
      ${!qtext && !c ? (hist.length ? `<div class="sechead"><h2 style="font-size:15px">সাম্প্রতিক সার্চ</h2><button class="linkbtn" data-clearhist>মুছুন</button></div>
        <div class="pills" style="flex-wrap:wrap">${hist.map(h => `<a class="pill sm" href="#/search?q=${encodeURIComponent(h)}">${icon('clock', 14)}${esc(h)}</a>`).join('')}</div>` : '')
        + `<div class="sechead" style="margin-top:8px"><h2 style="font-size:15px">জনপ্রিয় সার্চ</h2></div><div class="pills" style="flex-wrap:wrap">${['কাছাকাছি হাসপাতাল', 'আজ খোলা ফার্মেসি', '২০০ টাকার মধ্যে রেস্টুরেন্ট', 'কাচ্চি', 'মোবাইল সার্ভিসিং', 'পরিবার নিয়ে ঘোরার জায়গা', 'হোটেল']
          .map(s => `<a class="pill sm" href="#/search?q=${encodeURIComponent(s)}">${esc(s)}</a>`).join('')}</div>` : ''}
      ${qtext || c || active ? `<div class="count"><span>${bn(list.length)}টি ফলাফল</span><select data-sort aria-label="সাজানো">${[['', 'প্রাসঙ্গিক'], ['rating', 'সেরা রেটিং'], ['near', 'কাছাকাছি']]
        .map(([k, v]) => `<option value="${k}" ${sort === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="rows">${list.map(i => row(i)).join('') || empty('কিছু পাওয়া যায়নি', 'অন্য শব্দে খুঁজুন বা ফিল্টার বদলান।', '<a class="btn sm" href="#/add">নতুন তথ্য যোগ করুন</a>')}</div>` : ''}`;
  };

  pages.item = ([id]) => {
    const it = getItem(id);
    if (!it) return `${topbar('')}${empty('পাওয়া যায়নি', 'তথ্যটি সরানো হয়েছে বা লিংক ভুল।', '<a class="btn sm" href="#/">হোমে ফিরুন</a>')}`;
    if (pages.item.last !== id) { track(id, 'view'); pages.item.last = id; pages.item.tab = 'about'; }
    const c = catOf(it), d = km(it), tab = pages.item.tab || 'about', imgs = it.images || [];
    const rec = ls.get('recent', []).filter(x => x !== id); ls.set('recent', [id, ...rec].slice(0, 12));
    const related = items().filter(x => x.id !== id && (it.cat === 'place' ? ['restaurant', 'hotel'].includes(x.cat) && x.lat != null && it.lat != null : x.cat === it.cat))
      .map(x => ({ x, d: it.lat != null && x.lat != null ? Math.hypot(x.lat - it.lat, x.lng - it.lng) : 9 })).sort((a, b) => a.d - b.d).slice(0, 8).map(o => o.x);
    const infoRows = [
      (it.address || it.area) && ['pin', 'ঠিকানা', esc([it.address, it.area, 'যশোর'].filter(Boolean).join(', ')) + (d != null ? ` <span class="muted">· ${kmText(d)}</span>` : '')],
      ['clock', 'সময়সূচি', hoursText(it)],
      it.phone && ['phone', 'ফোন', `<a href="tel:${esc(it.phone)}" data-call-track="${esc(id)}">${bn(it.phone)}</a>${it.phone2 ? ` · <a href="tel:${esc(it.phone2)}">${bn(it.phone2)}</a>` : ''}`],
      it.web && ['globe', 'ওয়েবসাইট', `<a href="${esc(it.web)}" target="_blank" rel="noopener nofollow">${esc(it.web.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))}</a>`],
      it.facebook && ['facebook', 'ফেসবুক', `<a href="${esc(it.facebook)}" target="_blank" rel="noopener nofollow">পেজ দেখুন</a>`],
      ['shield', 'তথ্যের অবস্থা', `${STATUS[it.status]?.[0] || ''}${it.verifiedAt ? ` · সর্বশেষ যাচাই ${bn(it.verifiedAt)}` : ''}`]
    ].filter(Boolean);
    return `<div class="detail">
      <div class="hero" style="--c:${esc(c.color)}">${imgs.length ? `<div class="media"><div class="slides" data-slides>${imgs.map(u => `<img src="${esc(u)}" alt="">`).join('')}</div></div>` : media(it)}
        <div class="hbar"><button class="roundbtn" data-back aria-label="ফিরে যান">${icon('back', 20)}</button><button class="roundbtn" data-share="${esc(id)}" aria-label="শেয়ার">${icon('share', 19)}</button></div>
        ${imgs.length > 1 ? `<div class="dots" data-dots>${imgs.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}</div>
      <div class="sheet-body">
        <div class="dtitle"><h1>${esc(it.name)}</h1>${it.price ? `<div class="price"><b>৳${bn(it.price)}</b><small>${PRICE_UNIT[it.cat] || 'আনুমানিক'}</small></div>` : ''}</div>
        <div class="dsub">${icon(subIcon(it), 15)}${esc(subLabel(it))}${it.area ? ` · ${esc(it.area)}` : ''}${it.rating ? ` · ${rateTag(it)}` : ''}</div>
        <div class="dtags">${statusTag(it)}${openTag(it)}${it.sponsored ? '<span class="tag ad">Sponsored</span>' : ''}${it.demo ? '<span class="tag">নমুনা তথ্য</span>' : ''}</div>
        ${it.demo ? `<div class="note warn">${icon('info', 16)}<span>এটি নমুনা তথ্য, বাস্তব প্রতিষ্ঠান নয়।</span></div>` : ''}
        ${!it.phone && it.cat === 'emergency' ? `<div class="note red">${icon('alert', 16)}<span>স্থানীয় নম্বর যাচাই চলছে। জরুরি প্রয়োজনে <a href="tel:999"><b>৯৯৯</b></a> এ কল করুন।</span></div>` : ''}
        <div class="tabs">${[['about', 'বিবরণ'], ['info', 'তথ্য'], ['reviews', `রিভিউ${it.reviews ? ' (' + bn(it.reviews) + ')' : ''}`]].map(([k, v]) =>
          `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${v}</button>`).join('')}</div>
        <div data-tabbody>${tabBody(it, tab, infoRows, related)}</div>
        <button class="reportlink" data-report="${esc(id)}">${icon('flag', 14)}তথ্য ভুল বা পুরনো? জানান</button>
        <div style="height:24px"></div>
      </div></div>
      <div class="actionbar"><button class="sq ${isSaved(id) ? 'on' : ''}" data-save="${esc(id)}" aria-label="সেভ">${icon('heart', 22)}</button>
        <a class="sq" href="${dirUrl(it)}" target="_blank" rel="noopener" data-map="${esc(id)}" aria-label="দিকনির্দেশ">${icon('nav', 21)}</a>
        ${it.phone ? `<a class="btn block ${it.cat === 'emergency' ? 'red' : 'dark'}" href="tel:${esc(it.phone)}" data-call-track="${esc(id)}">${icon('phone', 19)}কল করুন</a>`
          : `<a class="btn block dark" href="${mapUrl(it)}" target="_blank" rel="noopener" data-map="${esc(id)}">${icon('map', 19)}ম্যাপে দেখুন</a>`}</div>`;
  };

  function tabBody(it, tab, infoRows, related) {
    if (tab === 'info') return `<div class="info">${infoRows.map(([ic, l, v]) => `<div class="li"><span class="ib">${icon(ic, 18)}</span><div><small>${l}</small>${v}</div></div>`).join('')}</div>`;
    if (tab === 'reviews') {
      setTimeout(() => loadReviews(it), 0);
      return `<div data-rv><div class="boot" style="min-height:120px"><div class="spinner"></div></div></div>`;
    }
    const about = it.about || it.note;
    return `${about ? `<p class="prose">${esc(about)}</p>` : ''}
      ${it.features?.length ? `<div class="feat">${it.features.map(f => `<span>${icon('check', 15)}${esc(f)}</span>`).join('')}</div>` : ''}
      <div class="info" style="margin-top:16px">${infoRows.slice(0, 3).map(([ic, l, v]) => `<div class="li"><span class="ib">${icon(ic, 18)}</span><div><small>${l}</small>${v}</div></div>`).join('')}</div>
      ${related.length ? `<div class="sechead" style="margin-top:24px"><h2 style="font-size:16px">${it.cat === 'place' ? 'কাছাকাছি খাবার ও থাকা' : 'আরও দেখুন'}</h2></div>
        <div class="related">${related.map(x => `<a href="#/p/${esc(x.id)}">${media(x)}<small>${esc(x.name)}</small></a>`).join('')}</div>` : ''}`;
  }

  async function loadReviews(it) {
    const box = document.querySelector('[data-rv]'); if (!box) return;
    let data;
    try { data = await api(`/listings/${it.id}/reviews`); } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    const rv = data.reviews, n = rv.length, avg = n ? rv.reduce((a, r) => a + r.stars, 0) / n : 0;
    const dist = [5, 4, 3, 2, 1].map(s => [s, rv.filter(r => r.stars === s).length]);
    const canReview = it.cat !== 'emergency' && !data.mine;
    box.innerHTML = `${n ? `<div class="rsum"><div class="big"><b>${bn(avg.toFixed(1))}</b>${starsHtml(avg, 13)}<div class="muted" style="font-size:12px">${bn(n)}টি রিভিউ</div></div>
      <div class="bars">${dist.map(([s, c]) => `<div class="bar">${bn(s)}<i><u style="width:${n ? c / n * 100 : 0}%"></u></i></div>`).join('')}</div></div>` : ''}
      ${canReview ? `<button class="btn block ghost" style="margin-top:14px" data-writereview>${icon('edit', 18)}রিভিউ লিখুন</button>` : data.mine ? `<p class="muted" style="font-size:13px;margin:14px 0 0">${icon('check', 14)} আপনি রিভিউ দিয়েছেন</p>` : ''}
      <div style="margin-top:8px">${rv.map(r => `<div class="rv"><div class="who"><span class="av">${esc((r.name || 'ব্য')[0])}</span><div><b>${esc(r.name || 'ব্যবহারকারী')}</b><small>${bn(new Date(r.t * 1000).toLocaleDateString('en-GB'))}</small></div>${starsHtml(r.stars, 13)}</div>
        ${r.crit ? `<div class="crit">${Object.entries(r.crit).map(([k, v]) => `<span class="tag">${esc(k)} ${bn(v)}/৫</span>`).join('')}</div>` : ''}
        ${r.text ? `<p>${esc(r.text)}</p>` : ''}${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy">` : ''}
        ${r.reply ? `<div class="reply"><b>Jashore360 টিম / প্রতিষ্ঠানের উত্তর</b>${esc(r.reply)}</div>` : ''}
        <div class="acts"><button data-vote="${r.id}|1">${icon('thumb', 13)}উপকারী ${r.up ? bn(r.up) : ''}</button><button data-vote="${r.id}|0">অনুপকারী ${r.down ? bn(r.down) : ''}</button>
        <button data-reportrv="${r.id}">${icon('flag', 13)}রিপোর্ট</button></div></div>`).join('') || (it.cat !== 'emergency' ? empty('এখনো রিভিউ নেই', 'প্রথম রিভিউটি আপনিই দিন!', '', 'msg') : '')}</div>`;
  }

  pages.explore = () => {
    const counts = {}; items().forEach(i => counts[i.cat] = (counts[i.cat] || 0) + 1);
    return `${topbar('এক্সপ্লোর')}
      <div class="grid2">${D.categories.map(c => `<a class="gcard" href="${c.id === 'emergency' ? '#/emergency' : '#/c/' + c.id}" style="padding:18px;gap:14px">
        <span class="catt" style="width:auto;align-items:flex-start"><span style="--c:${esc(c.color)};width:54px;height:54px;border-radius:17px">${icon(c.icon, 24)}</span></span>
        <div><b style="display:block;font-size:15px">${esc(c.bn)}</b><small class="muted">${bn(counts[c.id] || 0)}টি তথ্য</small></div></a>`).join('')}</div>
      <section class="sec"><div class="sechead"><h2>শীঘ্রই আসছে</h2></div><div class="pills" style="flex-wrap:wrap">${[['droplet', 'রক্তদাতা নেটওয়ার্ক'], ['briefcase', 'চাকরি'],
        ['home', 'বাসা ভাড়া'], ['nav', 'যাতায়াত'], ['calendar', 'ইভেন্ট'], ['tag', 'অফার ও কুপন']].map(([i, t]) => `<span class="pill sm">${icon(i, 15)}${t}</span>`).join('')}</div></section>`;
  };

  pages.saved = () => {
    const list = saved().map(getItem).filter(Boolean);
    return `${topbar('সেভ করা')}${list.length ? `<div class="grid2">${list.map(gcard).join('')}</div>`
      : empty('এখনো কিছু সেভ করেননি', 'পছন্দের জায়গার হার্ট চিহ্নে চাপুন, এখানে জমা থাকবে।', '<a class="btn sm" href="#/explore">এক্সপ্লোর করুন</a>', 'heart')}`;
  };

  pages.add = p => {
    if (pages.add.done) { pages.add.done = false;
      return `${topbar('তথ্য যোগ করুন')}${empty('জমা হয়েছে!', 'আমাদের টিম যাচাই করে শীঘ্রই প্রকাশ করবে। ধন্যবাদ।', '<a class="btn sm" href="#/">হোমে ফিরুন</a>', 'check')}`; }
    const pre = p.get('cat') || '';
    const cats = D.categories.filter(c => c.id !== 'emergency').concat(CAT.emergency ? [CAT.emergency] : []);
    return `${topbar('তথ্য যোগ করুন')}
    <div class="note">${icon('store', 18)}<span>দোকান, রেস্টুরেন্ট, সার্ভিস বা জরুরি নম্বরের তথ্য দিন। যাচাইয়ের পর বিনামূল্যে প্রকাশিত হবে।</span></div>
    <form class="form" data-add>
      <label class="field"><span>প্রতিষ্ঠানের নাম *</span><input name="name" required maxlength="120" placeholder="যেমন: রহমান ফার্মেসি"></label>
      <div class="two"><label class="field"><span>ক্যাটাগরি *</span><select name="cat" data-catsel>${cats.map(c => `<option value="${c.id}" ${c.id === pre ? 'selected' : ''}>${esc(c.bn)}</option>`).join('')}</select></label>
        <label class="field"><span>ধরন *</span><select name="sub" data-subsel></select></label></div>
      <div class="two"><label class="field"><span>এলাকা *</span><select name="area">${(D.areas || []).map(a => `<option>${esc(a)}</option>`).join('')}</select></label>
        <label class="field"><span>ফোন</span><input name="phone" inputmode="tel" placeholder="01XXXXXXXXX"></label></div>
      <label class="field"><span>ঠিকানা</span><input name="address" maxlength="200" placeholder="রাস্তা, ল্যান্ডমার্ক"></label>
      <div class="two"><label class="field"><span>খোলে</span><input name="open" type="time"></label><label class="field"><span>বন্ধ হয়</span><input name="close" type="time"></label></div>
      <label class="switch"><span>২৪ ঘণ্টা খোলা</span><input type="checkbox" name="h24"></label>
      <div class="two"><label class="field"><span>আনুমানিক খরচ (৳)</span><input name="price" inputmode="numeric" placeholder="২৫০"></label>
        <label class="field"><span>ফেসবুক/ওয়েবসাইট</span><input name="web" type="url" placeholder="https://"></label></div>
      <label class="field"><span>বিবরণ</span><textarea name="about" maxlength="1500" placeholder="সেবা, বিশেষত্ব, সুবিধা…"></textarea></label>
      <div class="field"><span>ছবি (সর্বোচ্চ ৩টি)</span><div class="photos" data-photos><label>${icon('camera', 22)}<input type="file" accept="image/*" multiple></label></div></div>
      <label class="field"><span>আপনার যোগাযোগ (যাচাইয়ের জন্য, প্রকাশ হবে না)</span><input name="contact" maxlength="100" placeholder="ফোন বা ইমেইল"></label>
      <label class="check"><input type="checkbox" name="consent" required><span>আমি নিশ্চিত করছি তথ্যগুলো সঠিক এবং প্রকাশের অনুমতি আছে।</span></label>
      <button class="btn block" type="submit">জমা দিন</button>
    </form>`;
  };
  const addPhotos = [];

  pages.profile = () => {
    const t = ls.get('theme', 'auto'), site = D.site || {};
    return `${topbar('প্রোফাইল')}
    <div class="profilehead"><span class="brandmark">${LOGO}</span><div><b>${esc(site.name || 'Jashore360')}</b><span class="muted" style="font-size:13px">${esc(site.tagline || '')}</span></div></div>
    <div class="stat3"><div><b>${bn(saved().length)}</b><small>সেভ করা</small></div><div><b>${bn(ls.get('myReviews', 0))}</b><small>রিভিউ</small></div><div><b>${bn(ls.get('recent', []).length)}</b><small>দেখেছেন</small></div></div>
    <div class="panel">
      <div class="li"><span class="ib">${icon('moon', 18)}</span><div>থিম</div><div class="seg" style="flex:none">${[['auto', 'অটো'], ['light', 'লাইট'], ['dark', 'ডার্ক']].map(([k, v]) => `<button class="${t === k ? 'on' : ''}" data-theme-set="${k}">${v}</button>`).join('')}</div></div>
      <button class="li" style="width:100%;border:0;background:none;text-align:left;padding:14px 0" data-areasheet><span class="ib">${icon('pin', 18)}</span><div>আমার এলাকা<small>${esc(ls.get('area', '') || 'পুরো যশোর')}</small></div>${icon('chevR', 18)}</button>
      <div class="li"><span class="ib">${icon('nav', 18)}</span><div>লোকেশন<small>${here ? 'চালু — দূরত্ব দেখানো হচ্ছে' : 'বন্ধ'}</small></div>${here ? '<button class="btn sm ghost" data-forgetloc>বন্ধ করুন</button>' : '<button class="btn sm" data-locate>চালু করুন</button>'}</div>
    </div>
    <div class="panel">
      <a class="li" href="#/add"><span class="ib">${icon('store', 18)}</span><div>ব্যবসা যুক্ত করুন<small>বিনামূল্যে, যাচাইয়ের পর প্রকাশ</small></div>${icon('chevR', 18)}</a>
      ${site.contactPhone ? `<a class="li" href="tel:${esc(site.contactPhone)}"><span class="ib">${icon('phone', 18)}</span><div>যোগাযোগ<small>${bn(site.contactPhone)}</small></div>${icon('chevR', 18)}</a>` : ''}
      ${site.facebook ? `<a class="li" href="${esc(site.facebook)}" target="_blank" rel="noopener"><span class="ib">${icon('facebook', 18)}</span><div>ফেসবুক পেজ</div>${icon('external', 16)}</a>` : ''}
      <button class="li" style="width:100%;border:0;background:none;text-align:left;padding:14px 0" data-notices><span class="ib">${icon('bell', 18)}</span><div>ঘোষণা ও আপডেট</div>${icon('chevR', 18)}</button>
    </div>
    <div class="panel"><div class="li"><span class="ib">${icon('info', 18)}</span><div><b style="font-size:14px">${esc(site.name || 'Jashore360')} সম্পর্কে</b><small style="font-size:13px;margin-top:4px">${esc(site.about || '')}</small></div></div></div>
    <button class="btn block ghost" style="margin-top:16px;color:var(--danger)" data-wipe>${icon('trash', 18)}এই ডিভাইসের সেভ ও সেটিংস মুছুন</button>
    <p class="foot">${esc(site.disclaimer || '')}<br>পেইড বিজ্ঞাপন সবসময় "Sponsored" চিহ্নিত থাকে এবং রেটিংকে প্রভাবিত করে না।</p>`;
  };

  /* ---------------- welcome ---------------- */
  function welcome() {
    if (ls.get('welcomed', false)) return;
    const w = document.createElement('div');
    w.className = 'welcome';
    const chips = [['hospital', '#0b8fd6', 'top:12%;left:14%'], ['utensils', '#f2711c', 'top:22%;right:12%'], ['siren', '#e5484d', 'bottom:16%;left:12%'], ['landmark', '#7c5cff', 'bottom:10%;right:18%']];
    w.innerHTML = `<div class="art"><div class="blob"><div class="core">${LOGO.replace('<svg', '<svg width="64" height="64"')}</div></div>
      ${chips.map(([i, c, pos]) => `<span class="chip" style="background:${c};${pos}">${icon(i, 22)}</span>`).join('')}</div>
      <div class="card"><h1>${esc(D.site?.tagline || 'যশোরের সবকিছু, এক অ্যাপে')}</h1><p>হাসপাতাল, জরুরি নম্বর, রেস্টুরেন্ট, দোকান আর দর্শনীয় স্থান — যাচাইকৃত তথ্য, এক জায়গায়।</p>
      <button class="btn block" data-start>শুরু করুন</button></div>`;
    document.body.appendChild(w);
    w.querySelector('[data-start]').onclick = () => { ls.set('welcomed', true); w.remove(); };
  }

  /* ---------------- router ---------------- */
  const routes = [[/^$/, 'home'], [/^emergency$/, 'emergency'], [/^c\/([\w-]+)$/, 'browse'], [/^search$/, 'browse'], [/^p\/([\w-]+)$/, 'item'],
    [/^explore$/, 'explore'], [/^saved$/, 'saved'], [/^add$/, 'add'], [/^profile$/, 'profile']];
  const navKey = { home: 'home', browse: 'explore', explore: 'explore', emergency: 'home', saved: 'saved', add: 'add', profile: 'profile' };
  let lastPath = null;
  const go = h => { location.hash = h; };

  function render() {
    if (!D) return;
    const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
    const p = new URLSearchParams(query);
    let name = 'home', params = [];
    const m = routes.find(([re]) => re.test(path));
    if (m) { name = m[1]; params = path.match(m[0]).slice(1); }
    if (name === 'browse' && params[0]) { if (params[0] === 'emergency') { name = 'emergency'; } else p.set('cat', params[0]); }
    app.innerHTML = name === 'browse' || name === 'emergency' || name === 'add' ? pages[name](p) : pages[name](params, p);
    nav.hidden = name === 'item';
    nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.nav === navKey[name]));
    if (path !== lastPath) window.scrollTo(0, 0);
    lastPath = path;
    if (name === 'add') { addPhotos.length = 0; fillSubs(); }
    const h1 = app.querySelector('h1')?.textContent;
    document.title = name === 'home' ? `${D.site?.name || 'Jashore360'} — ${D.site?.tagline || ''}` : `${h1 || ''} · ${D.site?.name || 'Jashore360'}`;
    carousel();
    const af = app.querySelector('[autofocus]'); if (af && !matchMedia('(pointer:coarse)').matches) af.focus();
  }
  window.addEventListener('hashchange', () => { closeSheet(true); render(); });

  function carousel() {
    const c = app.querySelector('[data-carousel], [data-slides]'), dots = app.querySelector('[data-dots]');
    if (!c || !dots) return;
    c.onscroll = () => { const i = Math.round(c.scrollLeft / c.clientWidth); dots.querySelectorAll('i').forEach((d, n) => d.classList.toggle('on', n === i)); };
  }

  function fillSubs() {
    const cs = app.querySelector('[data-catsel]'), ss = app.querySelector('[data-subsel]');
    if (cs && ss) ss.innerHTML = Object.entries(CAT[cs.value]?.subs || {}).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  }

  async function doLocate(then) {
    toast('লোকেশন খোঁজা হচ্ছে…');
    try { await locate(); toast('লোকেশন পাওয়া গেছে'); then ? go(then) : render(); }
    catch { toast('লোকেশন পাওয়া যায়নি — ব্রাউজারে অনুমতি দিন'); }
  }

  /* ---------------- events ---------------- */
  document.addEventListener('click', async e => {
    const el = e.target.closest('button, [data-call], [data-call-track], [data-map]');
    if (!el) return;
    const ds = el.dataset;
    if (ds.call) { e.preventDefault(); track(ds.id, 'call'); location.href = 'tel:' + ds.call; return; }
    if (ds.callTrack) return track(ds.callTrack, 'call');
    if (ds.map) return track(ds.map, 'map');
    if ('close' in ds) return closeSheet();
    if ('back' in ds) return history.length > 1 ? history.back() : go('#/');
    if ('filter' in ds) { const [, q = ''] = location.hash.split('?'); const p = new URLSearchParams(q); const m = location.hash.match(/#\/c\/([\w-]+)/); if (m) p.set('cat', m[1]); return filterSheet(p); }
    if ('notices' in ds) return noticesSheet();
    if ('areasheet' in ds) return areaSheet();
    if ('locate' in ds) return doLocate();
    if ('forgetloc' in ds) { here = null; ls.set('loc', null); return render(); }
    if ('pop' in ds) { pages.home.pop = ds.pop; return render(); }
    if (ds.themeSet) { ls.set('theme', ds.themeSet); applyTheme(); return render(); }
    if ('clear' in ds) return go('#/search');
    if ('clearhist' in ds) { ls.set('hist', []); return render(); }
    if (ds.tab) { pages.item.tab = ds.tab; return render(); }
    if (ds.save) {
      e.preventDefault();
      const s = saved(), i = s.indexOf(ds.save);
      i >= 0 ? s.splice(i, 1) : s.unshift(ds.save); ls.set('saved', s);
      document.querySelectorAll(`[data-save="${CSS.escape(ds.save)}"]`).forEach(b => b.classList.toggle('on', i < 0));
      toast(i >= 0 ? 'সেভ থেকে সরানো হয়েছে' : 'সেভ করা হয়েছে'); return;
    }
    if (ds.share) {
      const it = getItem(ds.share), url = location.origin + '/#/p/' + it.id, text = `${it.name}${it.phone ? ' — ' + it.phone : ''}`;
      try { if (navigator.share) await navigator.share({ title: it.name, text, url }); else { await navigator.clipboard.writeText(text + '\n' + url); toast('লিংক কপি হয়েছে'); } } catch {}
      return;
    }
    if (ds.report) return reportSheet(ds.report);
    if (ds.reportrv) return reportSheet(getItem(location.hash.split('/')[2])?.id, ds.reportrv);
    if ('writereview' in ds) return reviewSheet(getItem(location.hash.split('/')[2]));
    if (ds.vote) {
      const [rid, up] = ds.vote.split('|');
      try { await api(`/reviews/${rid}/vote`, { up: up === '1' }); toast('ধন্যবাদ!'); loadReviews(getItem(location.hash.split('/')[2])); } catch (er) { toast(er.message); }
      return;
    }
    if (ds.rmadd != null) { addPhotos.splice(+ds.rmadd, 1); return drawAddPhotos(); }
    if ('wipe' in ds) {
      if (!confirm('এই ডিভাইসের সেভ, সাম্প্রতিক ও সেটিংস মুছে যাবে। নিশ্চিত?')) return;
      Object.keys(localStorage).filter(k => k.startsWith('j360.') && k !== 'j360.boot').forEach(k => localStorage.removeItem(k));
      here = null; applyTheme(); toast('মুছে ফেলা হয়েছে'); render();
    }
  });

  function drawAddPhotos() {
    const box = app.querySelector('[data-photos]'); if (!box) return;
    box.querySelectorAll('.ph').forEach(x => x.remove());
    box.insertAdjacentHTML('afterbegin', addPhotos.map((p, i) => `<div class="ph"><img src="${p}" alt=""><button type="button" data-rmadd="${i}">${icon('x', 14)}</button></div>`).join(''));
  }

  document.addEventListener('change', async e => {
    const el = e.target;
    if (el.matches('[data-catsel]')) return fillSubs();
    if (el.matches('[data-sort]')) {
      const [h, q = ''] = location.hash.split('?'), p = new URLSearchParams(q);
      el.value ? p.set('sort', el.value) : p.delete('sort');
      if (el.value === 'near' && !here) return doLocate(h + '?' + p);
      return go(h + (p.toString() ? '?' + p : ''));
    }
    if (el.closest('form[data-add]') && el.type === 'file') {
      for (const f of [...el.files].slice(0, 3 - addPhotos.length)) { try { addPhotos.push(await compress(f)); } catch (er) { toast(er.message); } }
      el.value = ''; drawAddPhotos();
    }
  });

  document.addEventListener('submit', async e => {
    const f = e.target; e.preventDefault();
    if ('search' in f.dataset) {
      const v = f.q.value.trim(); f.q.blur();
      const m = location.hash.match(/#\/c\/([\w-]+)/);
      return go('#/search?' + new URLSearchParams(Object.assign(v ? { q: v } : {}, m ? { cat: m[1] } : {})));
    }
    if ('add' in f.dataset) {
      const v = Object.fromEntries(new FormData(f)), btn = f.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await api('/submissions', { name: v.name, cat: v.cat, sub: v.sub, area: v.area, address: v.address, phone: toLatin(v.phone || ''),
          hours: v.h24 ? '24h' : v.open && v.close ? `${v.open}-${v.close}` : null, price: toLatin(v.price || '').replace(/\D/g, ''),
          web: /facebook\.com/.test(v.web) ? null : v.web, facebook: /facebook\.com/.test(v.web) ? v.web : null, about: v.about, contact: v.contact, photos: addPhotos });
        pages.add.done = true; render(); window.scrollTo(0, 0);
      } catch (er) { toast(er.message); btn.disabled = false; }
    }
  });

  /* ---------------- boot ---------------- */
  function setData(d) {
    D = d; CAT = Object.fromEntries(d.categories.map(c => [c.id, c])); buildKeys();
  }
  async function refresh() {
    const d = await api('/bootstrap');
    const changed = !D || d.v !== D.v;
    setData(d);
    try { localStorage.setItem('j360.boot', JSON.stringify(d)); } catch {}
    return changed;
  }
  (async () => {
    const cached = ls.get('boot', null);
    if (cached?.categories) { setData(cached); render(); welcome(); }
    try { if (await refresh()) { render(); } if (!cached) welcome(); }
    catch { if (!D) app.innerHTML = empty('সংযোগ নেই', 'ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।', '<button class="btn sm" onclick="location.reload()">আবার চেষ্টা</button>', 'globe'); }
  })();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
