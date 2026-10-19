/* Jashore360 admin panel. Strings are written in Bangla and wrapped in T(); English lives in /i18n.js. */
(() => {
  'use strict';
  const root = document.getElementById('root');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BN = '০১২৩৪৫৬৭৮৯';
  const ls = {
    get(k, d) { try { const v = localStorage.getItem('j360a.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('j360a.' + k, JSON.stringify(v)); } catch {} }
  };
  const LANG = () => ls.get('lang', 'bn');
  const EN_ADMIN = { 'রিপোর্ট': 'Reports', 'পেমেন্ট': 'Payments', 'ব্যবহারকারী': 'Users' };   // plural where the app's wording is singular
  const T = (s, v) => { let r = LANG() === 'en' ? (EN_ADMIN[s] ?? window.I18N_EN?.[s] ?? s) : s; return v ? r.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '') : r; };
  const num = n => LANG() === 'bn' ? String(n ?? 0).replace(/\d/g, d => BN[d]) : String(n ?? 0);
  const compact = n => n >= 1e6 ? num((n / 1e6).toFixed(1)) + 'M' : n >= 1e4 ? num(Math.round(n / 1e3)) + 'K' : num(Number(n || 0).toLocaleString('en-IN'));
  const money = n => '৳' + num(Number(n || 0).toLocaleString('en-IN'));
  const locale = () => LANG() === 'bn' ? 'bn-BD' : 'en-GB';
  const date = t => t ? new Date(t * 1000).toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const day = d => d ? new Date(d).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const LOGO = '<svg viewBox="0 0 24 24"><path d="M12 21.5s-7.2-6.3-7.2-11.8a7.2 7.2 0 0 1 14.4 0c0 5.5-7.2 11.8-7.2 11.8z" fill="#fff"/><circle cx="12" cy="9.6" r="2.8" fill="#0f1b2d"/></svg>';
  const STATUS = { verified: ['যাচাইকৃত', 'ok'], pending: ['যাচাই চলছে', 'warn'], needs_update: ['আপডেট প্রয়োজন', 'warn'], temp_closed: ['সাময়িক বন্ধ', 'bad'], closed: ['স্থায়ীভাবে বন্ধ', 'bad'] };
  const KINDS = { rent: ['বাসা ভাড়া', 'home', '#4f6bed'], mess: ['মেস / সিট ভাড়া', 'bed', '#0f9fa8'], job: ['চাকরি', 'briefcase', '#f2711c'] };
  const DAYS = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'];
  const S = { me: null, listings: null, settings: {}, reviews: null, reports: null };
  const owner = () => S.me?.role === 'owner';

  function applyTheme() {
    const t = ls.get('theme', 'auto');
    t === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t);
    document.documentElement.lang = LANG();
  }
  applyTheme();

  let toastT;
  function toast(msg, err) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
    clearTimeout(toastT); toastT = setTimeout(() => t.className = '', 2800);
  }
  async function api(path, body, method) {
    const r = await fetch('/api' + path, { method: method || (body !== undefined ? 'POST' : 'GET'), credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && !path.endsWith('/login')) { S.me = null; renderLogin(); throw new Error(T('লগইন করুন')); }
    if (!r.ok) throw new Error(T(data.error || 'সমস্যা হয়েছে'));
    return data;
  }
  const run = async (fn, okMsg) => { try { const r = await fn(); okMsg && toast(T(okMsg)); return r; } catch (e) { toast(e.message, true); throw e; } };

  function compress(file, max = 1400, q = .8) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url); res(cv.toDataURL('image/jpeg', q));
      };
      img.onerror = () => rej(new Error(T('ছবিটি পড়া যায়নি'))); img.src = url;
    });
  }
  const upload = async file => (await api('/admin/upload', { data: await compress(file) })).url;

  /* ---------------- data ---------------- */
  const SETTINGS = ['site', 'areas', 'categories', 'notices', 'ads', 'plans', 'payment', 'app'];
  const cats = () => S.settings.categories || [];
  const catOf = id => cats().find(c => c.id === id) || { bn: id, en: id, icon: 'info', color: '#8b95a7', subs: {} };
  const catName = c => LANG() === 'en' ? c.en || c.bn : c.bn;
  const subName = (c, s) => (LANG() === 'en' && c.subsEn?.[s]) || c.subs?.[s] || '';
  async function load(force) {
    const need = SETTINGS.filter(k => force || !S.settings[k]);
    const [lst, rv, rp, ...st] = await Promise.all([force || !S.listings ? api('/admin/listings') : S.listings,
      force || !S.reviews ? api('/admin/reviews') : S.reviews, force || !S.reports ? api('/admin/reports') : S.reports,
      ...need.map(k => api('/admin/settings/' + k))]);
    S.listings = lst; S.reviews = rv; S.reports = rp;
    need.forEach((k, i) => S.settings[k] = st[i]);
  }
  const counts = () => ({ subs: S.listings?.filter(l => l._review === 'pending').length || 0, reports: S.reports?.filter(r => !r.done).length || 0,
    pays: S.counts?.payments || 0, cls: S.counts?.classifiedsPending || 0 });

  const thumb = (l, c = catOf(l.cat)) => `<span class="thumb" style="--c:${esc(c.color)}">${l.images?.[0] ? `<img src="${esc(l.images[0])}" alt="" loading="lazy">` : icon(c.icon, 20)}</span>`;
  const statusTag = s => { const [t, k] = STATUS[s] || STATUS.pending; return `<span class="tag ${k}">${T(t)}</span>`; };
  const empty = (t, m = '', ic = 'inbox') => `<div class="empty"><div class="eic">${icon(ic, 28)}</div><b>${t}</b>${m}</div>`;

  /* ---------------- login ---------------- */
  function renderLogin() {
    root.innerHTML = `<div class="login"><div class="art"><div class="logo"><i>${LOGO}</i>Jashore360</div>
      <div><h2>${T('যশোরের সব তথ্য এক জায়গা থেকে পরিচালনা করুন')}</h2><p>${T('তালিকা, পেমেন্ট, বিজ্ঞাপন, রিভিউ ও সেটিংস — সবকিছুর নিয়ন্ত্রণ এখানে।')}</p></div><span></span></div>
      <form data-login><div class="logo" style="color:var(--ink)"><i>${LOGO}</i>${T('অ্যাডমিন')}</div><h1>${T('লগইন করুন')}</h1>
        <label class="field"><span>${T('ইউজারনেম')}</span><input name="username" autocomplete="username" required autofocus></label>
        <label class="field"><span>${T('পাসওয়ার্ড')}</span><input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn block">${T('লগইন')}</button>
        <div class="loginprefs">${langToggle()}${themeToggle()}</div></form></div>`;
    root.querySelector('[data-login]').onsubmit = async e => {
      e.preventDefault();
      const f = e.target, b = f.querySelector('button'); b.disabled = true;
      try { S.me = await api('/admin/login', { username: f.username.value, password: f.password.value }); await boot(); }
      catch (er) { toast(er.message, true); b.disabled = false; }
    };
  }
  const langToggle = () => `<div class="seg mini">${[['bn', 'বাং'], ['en', 'EN']].map(([k, v]) => `<button type="button" class="${LANG() === k ? 'on' : ''}" data-setlang="${k}">${v}</button>`).join('')}</div>`;
  const themeToggle = () => { const t = ls.get('theme', 'auto'); return `<div class="seg mini">${[['light', 'sun'], ['dark', 'moon'], ['auto', 'layers']].map(([k, ic]) =>
    `<button type="button" class="${t === k ? 'on' : ''}" data-settheme="${k}" title="${T({ light: 'লাইট', dark: 'ডার্ক', auto: 'অটো' }[k])}">${icon(ic, 16)}</button>`).join('')}</div>`; };

  /* ---------------- shell ---------------- */
  const NAV = [
    ['', [['dashboard', 'chart', 'ড্যাশবোর্ড']]],
    ['কনটেন্ট', [['listings', 'list', 'সব তালিকা'], ['submissions', 'inbox', 'নতুন জমা', 'subs'], ['classifieds', 'megaphone', 'চাকরি ও ভাড়া', 'cls'],
      ['reviews', 'msg', 'রিভিউ'], ['reports', 'flag', 'রিপোর্ট', 'reports']]],
    ['ব্যবসা ও আয়', [['payments', 'wallet', 'পেমেন্ট', 'pays'], ['users', 'users', 'ব্যবহারকারী'], ['plans', 'tag', 'প্যাকেজ ও পেমেন্ট সেটিংস', null, true],
      ['ads', 'image', 'বিজ্ঞাপন (Ads)', null, true]]],
    ['অ্যাপ সাজানো', [['categories', 'grid', 'ক্যাটাগরি', null, true], ['notices', 'bell', 'ঘোষণা']]],
    ['সিস্টেম', [['app', 'download', 'অ্যাপ রিলিজ (APK)', null, true], ['settings', 'cog', 'সাধারণ সেটিংস', null, true], ['admins', 'shield', 'অ্যাডমিন ও নিরাপত্তা']]]
  ];
  const TITLES = Object.fromEntries(NAV.flatMap(g => g[1]).map(x => [x[0], x[2]]));

  function shell(page, title, actions, body) {
    const c = counts();
    root.innerHTML = `<div class="shell"><aside class="side"><div class="logo"><i>${LOGO}</i>Jashore360</div>
      ${NAV.map(([g, list]) => { const items = list.filter(x => !x[4] || owner()); return items.length ? `${g ? `<small>${T(g)}</small>` : ''}${items.map(([k, ic, t, b]) =>
        `<a href="#/${k}" class="${page === k ? 'on' : ''}">${icon(ic, 19)}<span>${T(t)}</span>${b && c[b] ? `<span class="badge">${num(c[b])}</span>` : ''}</a>`).join('')}` : ''; }).join('')}
      <span class="grow"></span><a href="/app/" target="_blank">${icon('external', 19)}<span>${T('অ্যাপ দেখুন')}</span></a>
      <div class="me"><span class="thumb" style="--c:#0e9f6e;width:34px;height:34px">${icon('user', 18)}</span><div><b>${esc(S.me?.username)}</b><span style="font-size:12px">${T(owner() ? 'মূল অ্যাডমিন' : 'মডারেটর')}</span></div>
        <button data-logout title="${T('লগআউট')}">${icon('logout', 18)}</button></div></aside>
      <div class="main"><header class="top"><button class="iconbtn menu" data-menu>${icon('menu', 22)}</button><h1>${esc(title)}</h1>${actions || ''}
        <div class="prefs">${langToggle()}${themeToggle()}</div></header>
      <div class="content">${body}</div></div></div>`;
  }

  /* ---------------- dashboard ---------------- */
  const pages = {};
  const METRICS = [['views', 'প্রোফাইল ভিউ'], ['calls', 'কল বাটনে চাপ'], ['signups', 'নতুন অ্যাকাউন্ট'], ['reviews', 'নতুন রিভিউ'], ['submissions', 'নতুন জমা'], ['downloads', 'অ্যাপ ডাউনলোড']];

  pages.dashboard = async () => {
    const s = await api('/admin/summary');
    S.counts = s; await load();
    const metric = pages.dashboard.metric || 'views';
    const hr = new Date().getHours();
    const greet = T(hr < 12 ? 'শুভ সকাল' : hr < 17 ? 'শুভ দুপুর' : 'শুভ সন্ধ্যা');
    const todo = [['submissions', 'inbox', '#f2711c', s.pending, 'নতুন জমা অনুমোদনের অপেক্ষায়'], ['payments', 'wallet', '#7c5cff', s.payments, 'পেমেন্ট যাচাইয়ের অপেক্ষায়'],
      ['classifieds', 'megaphone', '#0f9fa8', s.classifiedsPending, 'চাকরি/ভাড়ার বিজ্ঞাপন অপেক্ষায়'], ['reports', 'flag', '#e5484d', s.reports, 'খোলা রিপোর্ট']];
    const tiles = [['list', s.listings, 'প্রকাশিত তালিকা', T('{n}টি যাচাইকৃত', { n: num(s.verified) })], ['users', s.users, 'ব্যবহারকারী', ''],
      ['msg', s.reviews, 'মোট রিভিউ', T('এই সপ্তাহে {n}টি', { n: num(s.reviewsWeek) })], ['megaphone', s.classifiedsLive, 'চলমান বিজ্ঞাপন', ''],
      ['eye', s.views, 'মোট ভিউ', ''], ['phone', s.calls, 'মোট কল', '']];
    shell('dashboard', T('ড্যাশবোর্ড'), `<a class="btn" href="#/listings/new">${icon('plus', 18)}<span class="hide-sm">${T('নতুন তালিকা')}</span></a>`, `
      <section class="hello"><div><small>${esc(new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }))}</small>
        <h2>${greet}, ${esc(S.me.username)}</h2><p>${T('আজ আপনার জন্য যা অপেক্ষা করছে')}</p></div>
        <div class="revenue"><small>${T('এই মাসের আয়')}</small><b>${money(s.revenueMonth)}</b><span>${T('মোট আয়')}: ${money(s.revenueTotal)}</span></div></section>
      <div class="todo">${todo.map(([to, ic, c, n, t]) => `<a href="#/${to}" class="card ${n ? 'hot' : ''}" style="--c:${c}"><span class="ib">${icon(ic, 22)}</span>
        <div><b>${num(n)}</b><small>${T(t)}</small></div>${icon('chevR', 18)}</a>`).join('')}</div>
      ${s.demo ? `<div class="note">${icon('alert', 20)}<div><b>${T('{n}টি নমুনা তথ্য প্রকাশিত আছে।', { n: num(s.demo) })}</b> ${T('লঞ্চের আগে আসল তথ্য যোগ করে নমুনাগুলো মুছে ফেলুন।')}</div><a class="btn sm dark" href="#/listings?flag=demo">${T('দেখুন')}</a></div>` : ''}
      <div class="kpis">${tiles.map(([ic, v, t, sub]) => `<div class="card kpi"><span class="ib">${icon(ic, 20)}</span><div><b>${compact(v)}</b><small>${T(t)}</small>${sub ? `<em>${sub}</em>` : ''}</div></div>`).join('')}</div>
      <div class="card chartcard"><div class="chead"><div><b>${T(METRICS.find(m => m[0] === metric)[1])}</b><small class="muted"> · ${T('গত ৩০ দিন')}</small></div>
        <div class="tabs" style="margin:0">${METRICS.map(([k, t]) => `<button class="${k === metric ? 'on' : ''}" data-metric="${k}">${T(t)}</button>`).join('')}</div></div>
        <div class="cbody"><div class="chart" data-chart></div>
        <details class="tableview"><summary>${T('টেবিল হিসেবে দেখুন')}</summary><div class="tablewrap"><table class="t"><thead><tr><th>${T('তারিখ')}</th><th>${T('সংখ্যা')}</th></tr></thead><tbody>
          ${s.days.map((d, i) => `<tr><td>${esc(day(d))}</td><td>${num(s.series[metric][i])}</td></tr>`).reverse().join('')}</tbody></table></div></details></div></div>
      <div class="two" style="margin-top:16px">
        <div class="card"><h3>${T('সবচেয়ে বেশি দেখা তালিকা')}</h3>${s.top.some(t => t.views) ? `<table class="t"><thead><tr><th>${T('নাম')}</th><th>${T('ভিউ')}</th><th>${T('কল')}</th><th>${T('ম্যাপ')}</th></tr></thead><tbody>
          ${s.top.filter(t => t.views).map(t => `<tr><td><a href="#/listings/${t.id}"><b>${esc(t.name)}</b></a></td><td>${num(t.views)}</td><td>${num(t.calls)}</td><td>${num(t.maps)}</td></tr>`).join('')}</tbody></table>` : empty(T('এখনো কোনো ভিউ নেই'))}</div>
        <div class="card"><h3>${T('সাম্প্রতিক কার্যক্রম')}</h3>${s.audit.length ? s.audit.map(a => `<div class="item"><span class="dotmark"></span><div class="body"><b>${esc(T(AUDIT[a.action] || a.action))}</b><small>${esc(a.admin)}${a.target ? ' · ' + esc(a.target) : ''} · ${date(a.at)}</small></div></div>`).join('') : empty(T('কোনো কার্যক্রম নেই'))}</div>
      </div>`);
    drawChart(root.querySelector('[data-chart]'), s.days, s.series[metric]);
  };

  /* Column chart: one series, 30 days. Thin columns with a 2px gap, rounded data-end, hairline grid, hover/focus tooltip. */
  function drawChart(box, days, vals) {
    const W = Math.max(280, box.clientWidth), H = 240, L = 40, R = 8, Tp = 22, B = 28;
    const pw = W - L - R, ph = H - Tp - B, band = pw / vals.length, bw = Math.min(24, band - 2);
    const max = Math.max(...vals, 0);
    const step = (() => { const raw = Math.max(1, max) / 4, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p; return Math.max(1, (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p); })();   // counts: whole-number ticks
    const top = step * 4, y = v => Tp + ph - v / top * ph;
    const peak = vals.indexOf(max);
    let svg = `<svg width="${W}" height="${H}" role="img" aria-label="${esc(T('গত ৩০ দিনের পরিসংখ্যান'))}">`;
    for (let i = 0; i <= 4; i++) { const v = step * i, yy = Math.round(y(v)) + .5;
      svg += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="grid"/><text x="${L - 8}" y="${yy + 4}" class="tick" text-anchor="end">${compact(v)}</text>`; }
    vals.forEach((v, i) => {
      const x = L + i * band + (band - bw) / 2, h = Math.max(0, y(0) - y(v)), r = Math.min(4, h, bw / 2), y0 = y(0);
      if (h > 0) svg += `<path class="bar" d="M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + bw - r} Q${x + bw},${y0 - h} ${x + bw},${y0 - h + r} V${y0} Z"/>`;
      svg += `<rect class="hit" x="${L + i * band}" y="${Tp}" width="${band}" height="${ph}" tabindex="0" data-i="${i}"/>`;
      if (i % 5 === 4 || i === vals.length - 1) svg += `<text x="${L + i * band + band / 2}" y="${H - 8}" class="tick" text-anchor="middle">${esc(new Date(days[i]).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }))}</text>`;
    });
    if (max > 0) svg += `<text x="${L + peak * band + band / 2}" y="${y(max) - 6}" class="peak" text-anchor="middle">${compact(max)}</text>`;
    svg += '</svg><div class="tip" hidden><b></b><span></span></div>';
    box.innerHTML = svg;
    const tip = box.querySelector('.tip');
    const show = el => {
      const i = +el.dataset.i;
      box.querySelectorAll('.hit').forEach(h => h.classList.toggle('on', h === el));
      tip.querySelector('b').textContent = num(vals[i]);
      tip.querySelector('span').textContent = new Date(days[i]).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
      tip.hidden = false;
      const x = L + i * band + band / 2;
      tip.style.left = Math.min(W - tip.offsetWidth - 4, Math.max(4, x - tip.offsetWidth / 2)) + 'px';
      tip.style.top = Math.max(0, y(vals[i]) - tip.offsetHeight - 10) + 'px';
    };
    box.querySelectorAll('.hit').forEach(h => { h.addEventListener('pointerenter', () => show(h)); h.addEventListener('focus', () => show(h)); });
    box.addEventListener('pointerleave', () => { tip.hidden = true; box.querySelectorAll('.hit.on').forEach(h => h.classList.remove('on')); });
  }

  /* ---------------- listings ---------------- */
  pages.listings = async (_, p) => {
    await load();
    const q = (p.get('q') || '').toLowerCase(), cat = p.get('cat') || '', st = p.get('status') || '', flag = p.get('flag') || '';
    let list = S.listings.filter(l => l._review === 'approved');
    if (q) list = list.filter(l => [l.name, l.nameEn, l.area, l.phone].join(' ').toLowerCase().includes(q));
    if (cat) list = list.filter(l => l.cat === cat);
    if (st) list = list.filter(l => l.status === st);
    if (flag === 'paid') list = list.filter(l => l._plan); else if (flag) list = list.filter(l => l[flag]);
    const demo = S.listings.filter(l => l.demo).length;
    const today = new Date().toISOString().slice(0, 10);
    shell('listings', T('সব তালিকা'), `${flag === 'demo' && demo ? `<button class="btn red" data-deldemo>${icon('trash', 18)}${T('সব নমুনা মুছুন')}</button>` : ''}<a class="btn" href="#/listings/new">${icon('plus', 18)}<span class="hide-sm">${T('নতুন তালিকা')}</span></a>`, `
      <form class="toolbar" data-filter><label class="search">${icon('search', 18)}<input name="q" value="${esc(p.get('q') || '')}" placeholder="${T('নাম, এলাকা বা ফোন দিয়ে খুঁজুন')}"></label>
        <select name="cat"><option value="">${T('সব ক্যাটাগরি')}</option>${cats().map(c => `<option value="${c.id}" ${c.id === cat ? 'selected' : ''}>${esc(catName(c))}</option>`).join('')}</select>
        <select name="status"><option value="">${T('সব অবস্থা')}</option>${Object.entries(STATUS).map(([k, [v]]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${T(v)}</option>`).join('')}</select>
        <select name="flag"><option value="">${T('সব ধরন')}</option>${[['paid', 'পেইড ব্যবসা'], ['featured', 'হোমে জনপ্রিয়'], ['sponsored', 'Sponsored'], ['demo', 'নমুনা'], ['hidden', 'লুকানো']].map(([k, v]) => `<option value="${k}" ${k === flag ? 'selected' : ''}>${T(v)}</option>`).join('')}</select></form>
      <div class="card tablewrap">${list.length ? `<table class="t"><thead><tr><th>${T('নাম')}</th><th>${T('ক্যাটাগরি')}</th><th>${T('অবস্থা')}</th><th>${T('রেটিং')}</th><th>${T('ভিউ / কল')}</th><th></th></tr></thead><tbody>
        ${list.map(l => `<tr><td><a class="name" href="#/listings/${l.id}">${thumb(l)}<span><b>${esc(l.name)}</b><small>${esc(l.area || '')}${l.phone ? ' · ' + esc(l.phone) : ''}</small></span></a></td>
          <td data-l="${T('ক্যাটাগরি')}">${esc(catName(catOf(l.cat)))}<br><small class="muted">${esc(subName(catOf(l.cat), l.sub))}</small></td>
          <td data-l="${T('অবস্থা')}"><div class="tags">${statusTag(l.status)}${l._paidUntil ? `<span class="tag ${l._paidUntil < today ? 'bad' : 'ad'}">${T('পেইড · {d}', { d: day(l._paidUntil) })}</span>` : ''}${l.featured ? `<span class="tag ok">${T('জনপ্রিয়')}</span>` : ''}${l.sponsored ? '<span class="tag ad">Sponsored</span>' : ''}${l.demo ? `<span class="tag">${T('নমুনা')}</span>` : ''}${l.hidden ? `<span class="tag bad">${T('লুকানো')}</span>` : ''}</div></td>
          <td data-l="${T('রেটিং')}">${l.rating ? `<span class="stars">★</span> ${num(l.rating)} <small class="muted">(${num(l.reviews)})</small>` : '<span class="muted">—</span>'}</td>
          <td data-l="${T('ভিউ / কল')}">${num(l._views)} / ${num(l._calls)}</td>
          <td><div class="acts"><a class="iconbtn" href="#/listings/${l.id}" title="${T('সম্পাদনা')}">${icon('edit', 18)}</a>
            <button class="iconbtn" data-togglehide="${l.id}" title="${T(l.hidden ? 'দেখান' : 'লুকান')}">${icon(l.hidden ? 'eye' : 'eyeOff', 18)}</button>
            <a class="iconbtn" href="/app/#/p/${l.id}" target="_blank" title="${T('অ্যাপে দেখুন')}">${icon('external', 17)}</a>
            <button class="iconbtn red" data-dellisting="${l.id}" title="${T('মুছুন')}">${icon('trash', 18)}</button></div></td></tr>`).join('')}</tbody></table>`
        : empty(T('কোনো তালিকা পাওয়া যায়নি'), `<div style="margin-top:12px"><a class="btn" href="#/listings/new">${T('নতুন তালিকা যোগ করুন')}</a></div>`)}</div>
      <p class="muted" style="font-size:13px">${T('{n}টি দেখানো হচ্ছে', { n: num(list.length) })}</p>`);
  };

  pages.edit = async ([id]) => {
    await load();
    const isNew = id === 'new', l = isNew ? { status: 'pending', cat: cats().find(c => c.id !== 'emergency')?.id, images: [] } : S.listings.find(x => x.id === id);
    if (!l) return shell('listings', T('পাওয়া যায়নি'), '', empty(T('তালিকাটি পাওয়া যায়নি')));
    const [o, c] = l.hours && l.hours !== '24h' ? l.hours.split('-') : ['', ''];
    const back = l._review === 'pending' || l._review === 'unpaid' ? 'submissions' : 'listings';
    const f = (name, label, attrs = '', hint = '') => `<label class="field"><span>${T(label)}</span><input name="${name}" value="${esc(l[name] ?? '')}" ${attrs}>${hint ? `<em>${T(hint)}</em>` : ''}</label>`;
    shell(back, isNew ? T('নতুন তালিকা') : l.name, `<a class="btn ghost" href="#/${back}">${T('বাতিল')}</a>`, `
      <form class="split" data-edit="${isNew ? '' : esc(id)}">
      <div class="grid">
        ${l._owner ? `<div class="note info">${icon('user', 20)}<div><b>${T('মালিক')}:</b> ${esc(l._owner.name)} · ${esc(l._owner.phone)}${l._plan ? ` · ${T('প্যাকেজ')}: ${esc(l._plan)}` : ''}${l._payment ? ` · ${T('পেমেন্ট')}: ${esc(T(PAYSTATE[l._payment.status]?.[0] || l._payment.status))}` : ''}</div></div>` : ''}
        <div class="card"><h3>${T('মৌলিক তথ্য')}</h3><div class="cbody form">
          <div class="two">${f('name', 'নাম (বাংলা) *', 'required maxlength="120"')}${f('nameEn', 'নাম (English)', 'maxlength="120"', 'ইংরেজি ভাষার অ্যাপে ও ম্যাপে খোঁজায় দেখায়')}</div>
          <div class="two"><label class="field"><span>${T('ক্যাটাগরি *')}</span><select name="cat" data-catsel>${cats().map(x => `<option value="${x.id}" ${x.id === l.cat ? 'selected' : ''}>${esc(catName(x))}</option>`).join('')}</select></label>
            <label class="field"><span>${T('ধরন')}</span><select name="sub" data-subsel data-val="${esc(l.sub || '')}"></select></label></div>
          <label class="field"><span>${T('বিবরণ')}</span><textarea name="about" rows="5" maxlength="3000">${esc(l.about || '')}</textarea></label>
          <label class="field"><span>${T('ছোট নোট')}</span><input name="note" value="${esc(l.note || '')}" maxlength="400"><em>${T('তালিকা ও জরুরি পেজে নামের নিচে দেখায়')}</em></label>
          <div class="two">${f('features', 'সুবিধা', '', 'কমা দিয়ে আলাদা করুন: পার্কিং, হোম ডেলিভারি')}${f('tags', 'সার্চ কীওয়ার্ড', '', 'কমা দিয়ে: kacchi, তেহারি, biryani')}</div>
        </div></div>
        <div class="card"><h3>${T('যোগাযোগ ও অবস্থান')}</h3><div class="cbody form">
          <div class="two">${f('phone', 'ফোন', 'inputmode="tel"')}${f('phone2', 'বিকল্প ফোন', 'inputmode="tel"')}</div>
          <div class="two">${f('web', 'ওয়েবসাইট', 'type="url" placeholder="https://"')}${f('facebook', 'ফেসবুক পেজ', 'type="url" placeholder="https://facebook.com/…"')}</div>
          <div class="two"><label class="field"><span>${T('এলাকা')}</span><input name="area" list="areas" value="${esc(l.area || '')}"><datalist id="areas">${(S.settings.areas || []).map(a => `<option value="${esc(a)}">`).join('')}</datalist></label>${f('address', 'ঠিকানা')}</div>
          <div class="two">${f('lat', 'Latitude', 'inputmode="decimal" data-latlng', 'Google Maps-এ জায়গায় রাইট-ক্লিক করে সংখ্যা কপি করে এখানে পেস্ট করুন')}${f('lng', 'Longitude', 'inputmode="decimal"')}</div>
        </div></div>
        <div class="card"><h3>${T('সময় ও দাম')}</h3><div class="cbody form">
          <label class="check"><input type="checkbox" name="h24" ${l.hours === '24h' ? 'checked' : ''}><span>${T('২৪ ঘণ্টা খোলা')}</span></label>
          <div class="two"><label class="field"><span>${T('খোলে')}</span><input type="time" name="open" value="${esc(o)}"></label><label class="field"><span>${T('বন্ধ হয়')}</span><input type="time" name="close" value="${esc(c)}"></label></div>
          <div class="field"><span>${T('সাপ্তাহিক বন্ধ')}</span><div class="days">${DAYS.map((d, i) => `<label><input type="checkbox" name="off" value="${i}" ${l.off?.includes(i) ? 'checked' : ''}>${T(d)}</label>`).join('')}</div></div>
          ${f('price', 'আনুমানিক খরচ (৳)', 'inputmode="numeric"', 'রেস্টুরেন্টে জনপ্রতি, হোটেলে প্রতি রাত, সার্ভিসে শুরুর দাম')}
        </div></div>
      </div>
      <div class="grid">
        <div class="card"><h3>${T('প্রকাশ ও অবস্থা')}</h3><div class="cbody form">
          <label class="field"><span>${T('তথ্যের অবস্থা')}</span><select name="status">${Object.entries(STATUS).map(([k, [v]]) => `<option value="${k}" ${k === l.status ? 'selected' : ''}>${T(v)}</option>`).join('')}</select></label>
          ${f('verifiedAt', 'সর্বশেষ যাচাইয়ের তারিখ', 'type="date"', '"যাচাইকৃত" বাছলে খালি থাকলে আজকের তারিখ বসবে')}
          ${owner() && l._plan ? f('_paidUntil', 'পেইড মেয়াদ শেষ', 'type="date"', 'এই তারিখের পর তালিকাটি অ্যাপে দেখাবে না') : ''}
          ${[['featured', 'হোমপেজে "জনপ্রিয়" অংশে দেখান'], ['sponsored', 'Sponsored (পেইড প্রচার)', 'তালিকার উপরে, "Sponsored" লেবেলসহ'], ['pin', 'জরুরি তালিকায় সবার উপরে'],
            ['demo', 'নমুনা তথ্য', 'অ্যাপে "নমুনা" লেবেল দেখাবে'], ['hidden', 'লুকিয়ে রাখুন', 'অ্যাপে দেখাবে না']].map(([k, t, s]) =>
            `<label class="check"><input type="checkbox" name="${k}" ${l[k] ? 'checked' : ''}><span>${T(t)}${s ? `<small>${T(s)}</small>` : ''}</span></label>`).join('')}
        </div></div>
        <div class="card"><h3>${T('ছবি')} <small class="muted" style="font-weight:400">${T('প্রথম ছবিটি কভার')}</small></h3><div class="cbody"><div class="imgs" data-imgs></div></div></div>
        ${!isNew ? `<div class="card"><h3>${T('পরিসংখ্যান')}</h3><div class="cbody stat3">
          <div><b>${num(l._views)}</b><small>${T('ভিউ')}</small></div><div><b>${num(l._calls)}</b><small>${T('কল')}</small></div><div><b>${num(l._maps)}</b><small>${T('ম্যাপ')}</small></div></div></div>` : ''}
      </div>
      <div class="savebar" style="grid-column:1/-1">${!isNew ? `<button type="button" class="btn red" data-dellisting="${esc(id)}" style="margin-right:auto">${icon('trash', 18)}${T('মুছুন')}</button>` : ''}
        ${l._review === 'pending' ? `<button type="submit" class="btn" name="approve" value="1">${icon('check', 18)}${T('সংরক্ষণ ও প্রকাশ')}</button>` : `<button type="submit" class="btn">${icon('check', 18)}${T('সংরক্ষণ করুন')}</button>`}</div>
      </form>`);
    const form = root.querySelector('[data-edit]');
    form._images = [...(l.images || [])];
    fillSubs(form); drawImgs(form);
  };

  function fillSubs(form) {
    const cs = form.querySelector('[data-catsel]'), ss = form.querySelector('[data-subsel]'), c = catOf(cs.value);
    ss.innerHTML = '<option value="">—</option>' + Object.keys(c.subs || {}).map(k => `<option value="${k}" ${k === ss.dataset.val ? 'selected' : ''}>${esc(subName(c, k))}</option>`).join('');
  }
  function drawImgs(form) {
    const box = form.querySelector('[data-imgs]');
    box.innerHTML = form._images.map((u, i) => `<div class="im"><img src="${esc(u)}" alt="">${i === 0 ? `<span class="tag ok cover">${T('কভার')}</span>` : ''}
      <div class="ops"><button type="button" data-imgfirst="${i}" title="${T('কভার করুন')}">${icon('star', 14)}</button><button type="button" data-imgdel="${i}" title="${T('সরান')}">${icon('x', 14)}</button></div></div>`).join('')
      + (form._images.length < 8 ? `<label class="up">${icon('upload', 20)}<span>${T('ছবি যোগ')}</span><input type="file" accept="image/*" multiple data-imgup></label>` : '');
  }
  function readListing(form) {
    const fd = new FormData(form), v = Object.fromEntries(fd);
    const out = { name: v.name, nameEn: v.nameEn, cat: v.cat, sub: v.sub, about: v.about, note: v.note, features: v.features, tags: v.tags, phone: v.phone, phone2: v.phone2,
      web: v.web, facebook: v.facebook, area: v.area, address: v.address, lat: v.lat, lng: v.lng, price: (v.price || '').replace(/[^\d]/g, ''),
      hours: v.h24 ? '24h' : v.open && v.close ? `${v.open}-${v.close}` : null, off: fd.getAll('off').map(Number), status: v.status, verifiedAt: v.verifiedAt, images: form._images };
    if ('_paidUntil' in v) out._paidUntil = v._paidUntil;
    ['featured', 'sponsored', 'pin', 'demo', 'hidden'].forEach(k => out[k] = !!v[k]);
    return out;
  }

  /* ---------------- submissions & payments ---------------- */
  const PAYSTATE = { submitted: ['যাচাইয়ের অপেক্ষায়', 'warn'], verified: ['যাচাইকৃত', 'ok'], rejected: ['বাতিল', 'bad'] };
  pages.submissions = async (_, p) => {
    await load();
    const tab = p.get('tab') || 'pending';
    const pend = S.listings.filter(l => l._review === 'pending'), unpaid = S.listings.filter(l => l._review === 'unpaid'), rej = S.listings.filter(l => l._review === 'rejected');
    const list = { pending: pend, unpaid, rejected: rej }[tab].sort((a, b) => b._created - a._created);
    shell('submissions', T('নতুন জমা'), '', `<p class="muted" style="margin-top:0">${T('ব্যবহারকারী ও ব্যবসায়ীরা অ্যাপ থেকে যে তথ্য পাঠিয়েছেন। যাচাই করে প্রকাশ করুন। পেইড ব্যবসা পেমেন্ট যাচাইয়ের পর এখানে আসে।')}</p>
      <div class="tabs">${[['pending', 'অনুমোদনের অপেক্ষায়', pend.length], ['unpaid', 'পেমেন্ট বাকি', unpaid.length], ['rejected', 'বাতিল', rej.length]].map(([k, t, n]) =>
        `<a class="${tab === k ? 'on' : ''}" href="#/submissions?tab=${k}">${T(t)} (${num(n)})</a>`).join('')}</div>
      <div class="card">${list.map(l => `<div class="item" style="align-items:flex-start">${thumb(l)}<div class="body"><b>${esc(l.name)}</b>
        <small>${esc(catName(catOf(l.cat)))} › ${esc(subName(catOf(l.cat), l.sub))} · ${esc(l.area || '')} · ${esc(l.phone || T('ফোন নেই'))}</small>
        ${l.about ? `<p>${esc(l.about)}</p>` : ''}<small>${T('জমাদাতা')}: ${esc(l._owner ? `${l._owner.name} (${l._owner.phone})` : l._contact || '—')} · ${date(l._created)}</small>
        <div class="tags" style="margin-top:6px">${l._plan ? `<span class="tag ad">${T('প্যাকেজ')}: ${esc(l._plan)}</span>` : `<span class="tag ok">${T('ফ্রি')}</span>`}
          ${l._payment ? `<span class="tag ${PAYSTATE[l._payment.status]?.[1]}">${T('পেমেন্ট')}: ${T(PAYSTATE[l._payment.status]?.[0])} · ${money(l._payment.amount)}</span>` : ''}</div>
        ${l.images?.length ? `<div style="display:flex;gap:6px;margin-top:8px">${l.images.map(u => `<img class="rvphoto" src="${esc(u)}" alt="">`).join('')}</div>` : ''}</div>
        <div class="acts">${tab === 'pending' ? `<button class="btn sm" data-approve="${l.id}" data-verified="1">${icon('check', 16)}${T('যাচাইকৃত হিসেবে প্রকাশ')}</button>
          <button class="btn sm ghost" data-approve="${l.id}">${T('প্রকাশ (যাচাই চলছে)')}</button>` : ''}
          ${tab === 'unpaid' && l._payment?.status === 'submitted' ? `<a class="btn sm" href="#/payments">${icon('wallet', 16)}${T('পেমেন্ট যাচাই করুন')}</a>` : ''}
          <a class="btn sm ghost" href="#/listings/${l.id}">${icon('edit', 16)}${T('সম্পাদনা')}</a>
          ${tab !== 'rejected' ? `<button class="btn sm red" data-reject="${l.id}">${T('বাতিল')}</button>` : `<button class="iconbtn red" data-dellisting="${l.id}">${icon('trash', 18)}</button>`}</div></div>`).join('')
        || empty(T('কিছু নেই'), `<div>${T('নতুন জমা এলে এখানে দেখাবে।')}</div>`, 'check')}</div>`);
  };

  pages.payments = async (_, p) => {
    await load();
    const all = await api('/admin/payments'), tab = p.get('tab') || 'submitted';
    const list = all.filter(x => tab === 'all' || x.status === tab);
    const M = { bkash: 'বিকাশ', nagad: 'নগদ', rocket: 'রকেট' };
    shell('payments', T('পেমেন্ট'), '', `<p class="muted" style="margin-top:0">${T('ব্যবসায়ীরা বিকাশ/নগদে টাকা পাঠিয়ে Transaction ID দিয়েছেন। আপনার অ্যাপে লেনদেন মিলিয়ে যাচাই করুন।')}</p>
      ${!owner() ? `<div class="note">${icon('lock', 20)}<div>${T('পেমেন্ট যাচাই শুধু মূল অ্যাডমিন করতে পারেন।')}</div></div>` : ''}
      <div class="tabs">${[['submitted', 'যাচাইয়ের অপেক্ষায়'], ['verified', 'যাচাইকৃত'], ['rejected', 'বাতিল'], ['all', 'সব']].map(([k, t]) =>
        `<a class="${tab === k ? 'on' : ''}" href="#/payments?tab=${k}">${T(t)} (${num(all.filter(x => k === 'all' || x.status === k).length)})</a>`).join('')}</div>
      <div class="card tablewrap">${list.length ? `<table class="t"><thead><tr><th>${T('তালিকা')}</th><th>${T('পরিমাণ')}</th><th>${T('মাধ্যম ও TrxID')}</th><th>${T('যে নম্বর থেকে')}</th><th>${T('অবস্থা')}</th><th></th></tr></thead><tbody>
        ${list.map(x => `<tr><td><a href="#/listings/${esc(x.listing_id)}"><b>${esc(x.listingName)}</b></a><br><small class="muted">${esc(x.userName)} · ${esc(x.userPhone)} · ${date(x.created_at)}</small></td>
          <td data-l="${T('পরিমাণ')}"><b>${money(x.amount)}</b><br><small class="muted">${esc(x.plan_id)}</small></td>
          <td data-l="${T('মাধ্যম ও TrxID')}">${T(M[x.method] || x.method)}<br><code>${esc(x.trx)}</code></td><td data-l="${T('যে নম্বর থেকে')}">${esc(x.sender)}</td>
          <td data-l="${T('অবস্থা')}"><span class="tag ${PAYSTATE[x.status][1]}">${T(PAYSTATE[x.status][0])}</span>${x.note ? `<br><small class="muted">${esc(x.note)}</small>` : ''}</td>
          <td><div class="acts">${x.status === 'submitted' && owner() ? `<button class="btn sm" data-paydecide="${x.id}|verify|1">${icon('check', 16)}${T('যাচাই ও প্রকাশ')}</button>
            <button class="btn sm ghost" data-paydecide="${x.id}|verify|0">${T('শুধু যাচাই')}</button><button class="btn sm red" data-paydecide="${x.id}|reject|0">${T('বাতিল')}</button>` : ''}</div></td></tr>`).join('')}</tbody></table>`
        : empty(T('কোনো পেমেন্ট নেই'), '', 'wallet')}</div>`);
  };

  /* ---------------- classifieds ---------------- */
  pages.classifieds = async (_, p) => {
    const all = await api('/admin/classifieds'), tab = p.get('tab') || 'pending', now = Date.now() / 1000;
    const state = c => c.review === 'approved' ? (c.expires > now ? 'live' : 'expired') : c.review;
    const list = all.filter(c => state(c) === tab);
    S.counts = { ...(S.counts || {}), classifiedsPending: all.filter(c => c.review === 'pending').length };
    shell('classifieds', T('চাকরি ও ভাড়া'), '', `<p class="muted" style="margin-top:0">${T('ব্যবহারকারীদের দেওয়া ফ্রি বিজ্ঞাপন। অনুমোদন দিলে নির্দিষ্ট দিন পর্যন্ত অ্যাপে দেখাবে।')}</p>
      <div class="tabs">${[['pending', 'অপেক্ষমাণ'], ['live', 'চলমান'], ['expired', 'মেয়াদ শেষ'], ['rejected', 'বাতিল']].map(([k, t]) =>
        `<a class="${tab === k ? 'on' : ''}" href="#/classifieds?tab=${k}">${T(t)} (${num(all.filter(c => state(c) === k).length)})</a>`).join('')}</div>
      <div class="card">${list.map(c => { const [kn, ic, col] = KINDS[c.kind];
        return `<div class="item" style="align-items:flex-start"><span class="thumb" style="--c:${col}">${c.images?.[0] ? `<img src="${esc(c.images[0])}" alt="">` : icon(ic, 20)}</span>
        <div class="body"><b>${esc(c.title)}</b><small>${T(kn)} · ${c.price ? money(c.price) + ' · ' : ''}${esc(c.area || '')} · ${esc(c.userName)} (${esc(c.phone)}) · ${date(c.t)}</small>
        ${c.description ? `<p>${esc(c.description.slice(0, 300))}</p>` : ''}${tab === 'live' ? `<small>${T('মেয়াদ')}: ${date(c.expires)} · ${T('{v} ভিউ', { v: num(c.views) })}</small>` : ''}</div>
        <div class="acts">${tab !== 'live' ? `<select data-cldays="${c.id}" title="${T('কত দিন দেখাবে')}">${[7, 15, 30, 60].map(d => `<option value="${d}" ${d === 30 ? 'selected' : ''}>${T('{n} দিন', { n: num(d) })}</option>`).join('')}</select>
          <button class="btn sm" data-clreview="${c.id}|approved">${icon('check', 16)}${T('অনুমোদন')}</button>` : ''}
          ${tab === 'pending' || tab === 'live' ? `<button class="btn sm red" data-clreview="${c.id}|rejected">${T('বাতিল')}</button>` : ''}
          <a class="iconbtn" href="/app/#/ad/${c.id}" target="_blank" title="${T('অ্যাপে দেখুন')}">${icon('external', 17)}</a>
          <button class="iconbtn red" data-cldel="${c.id}" title="${T('মুছুন')}">${icon('trash', 18)}</button></div></div>`; }).join('') || empty(T('কিছু নেই'), '', 'megaphone')}</div>`);
  };

  /* ---------------- users ---------------- */
  pages.users = async (_, p) => {
    const all = await api('/admin/users'), q = (p.get('q') || '').toLowerCase();
    const list = all.filter(u => !q || (u.name + ' ' + u.phone).toLowerCase().includes(q));
    shell('users', T('ব্যবহারকারী'), '', `<form class="toolbar" data-userq><label class="search">${icon('search', 18)}<input name="q" value="${esc(p.get('q') || '')}" placeholder="${T('নাম বা মোবাইল দিয়ে খুঁজুন')}"></label></form>
      <div class="card tablewrap">${list.length ? `<table class="t"><thead><tr><th>${T('নাম')}</th><th>${T('মোবাইল')}</th><th>${T('যোগ দিয়েছেন')}</th><th>${T('ব্যবসা / বিজ্ঞাপন / রিভিউ')}</th><th></th></tr></thead><tbody>
        ${list.map(u => `<tr><td><span class="name"><span class="thumb" style="--c:#0e9f6e">${esc(u.name[0])}</span><span><b>${esc(u.name)}</b>${u.banned ? ` <span class="tag bad">${T('বন্ধ')}</span>` : ''}</span></span></td>
          <td data-l="${T('মোবাইল')}"><a href="tel:${esc(u.phone)}">${esc(u.phone)}</a></td><td data-l="${T('যোগ দিয়েছেন')}">${date(u.created_at)}</td>
          <td data-l="${T('ব্যবসা / বিজ্ঞাপন / রিভিউ')}">${num(u.listings || 0)} / ${num(u.classifieds || 0)} / ${num(u.reviews || 0)}</td>
          <td><div class="acts"><button class="btn sm ghost" data-resetuser="${u.id}">${icon('lock', 15)}${T('পাসওয়ার্ড রিসেট')}</button>
            <button class="btn sm ${u.banned ? '' : 'red'}" data-banuser="${u.id}|${u.banned ? 0 : 1}">${T(u.banned ? 'চালু করুন' : 'বন্ধ করুন')}</button></div></td></tr>`).join('')}</tbody></table>`
        : empty(T('কোনো ব্যবহারকারী নেই'), '', 'users')}</div><p class="muted" style="font-size:13px">${T('মোট {n} জন', { n: num(all.length) })}</p>`);
  };

  /* ---------------- reviews & reports ---------------- */
  pages.reviews = async (_, p) => {
    await load();
    const tab = p.get('tab') || 'all';
    let list = S.reviews;
    if (tab === 'reported') list = list.filter(r => r.reported);
    if (tab === 'hidden') list = list.filter(r => r.hidden);
    shell('reviews', T('রিভিউ'), '', `<div class="tabs">${[['all', 'সব', S.reviews.length], ['reported', 'রিপোর্টেড', S.reviews.filter(r => r.reported).length], ['hidden', 'লুকানো', S.reviews.filter(r => r.hidden).length]]
      .map(([k, t, n]) => `<a class="${tab === k ? 'on' : ''}" href="#/reviews?tab=${k}">${T(t)} (${num(n)})</a>`).join('')}</div>
      <div class="card">${list.map(r => `<div class="item" style="align-items:flex-start">${r.photo ? `<img class="rvphoto" src="${esc(r.photo)}" alt="">` : ''}<div class="body">
        <b><span class="stars">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</span> · <a href="#/listings/${r.listing}">${esc(r.listingName)}</a></b>
        <small>${esc(r.name || '—')} · ${date(r.t)} · ${T('উপকারী')} ${num(r.up)} · ${T('অনুপকারী')} ${num(r.down)} ${r.reported ? `<span class="tag bad">${T('রিপোর্টেড')}</span>` : ''}${r.hidden ? `<span class="tag">${T('লুকানো')}</span>` : ''}</small>
        ${r.crit ? `<div class="tags" style="margin-top:6px">${Object.entries(r.crit).map(([k, v]) => `<span class="tag">${esc(T(k))} ${num(v)}/${num(5)}</span>`).join('')}</div>` : ''}
        ${r.text ? `<p>${esc(r.text)}</p>` : ''}${r.reply ? `<p class="reply"><b>${T('উত্তর')}:</b> ${esc(r.reply)}</p>` : ''}</div>
        <div class="acts"><button class="btn sm ghost" data-reply="${r.id}">${icon('msg', 16)}${T(r.reply ? 'উত্তর বদলান' : 'উত্তর দিন')}</button>
          <button class="btn sm ghost" data-hiderv="${r.id}" data-h="${r.hidden ? 0 : 1}">${icon(r.hidden ? 'eye' : 'eyeOff', 16)}${T(r.hidden ? 'দেখান' : 'লুকান')}</button>
          <button class="iconbtn red" data-delrv="${r.id}" title="${T('মুছুন')}">${icon('trash', 18)}</button></div></div>`).join('') || empty(T('কোনো রিভিউ নেই'), '', 'msg')}</div>`);
  };

  pages.reports = async () => {
    await load();
    const K = { review: ['রিভিউ রিপোর্ট', 'msg', '#7c5cff'], info: ['তথ্য সংশোধন', 'alert', '#e5484d'], classified: ['বিজ্ঞাপন রিপোর্ট', 'megaphone', '#0f9fa8'] };
    shell('reports', T('রিপোর্ট'), '', `<p class="muted" style="margin-top:0">${T('ব্যবহারকারীরা ভুল তথ্য, অনুপযুক্ত রিভিউ বা ভুয়া বিজ্ঞাপন সম্পর্কে যা জানিয়েছেন।')}</p>
      <div class="card">${S.reports.map(r => { const [t, ic, c] = K[r.kind] || K.info;
        return `<div class="item" style="align-items:flex-start;${r.done ? 'opacity:.55' : ''}"><span class="thumb" style="--c:${c}">${icon(ic, 20)}</span>
        <div class="body"><b>${T(t)} · ${r.kind === 'classified' ? `<a href="/app/#/ad/${esc(r.listing_id)}" target="_blank">${esc(r.listingName)}</a>` : `<a href="#/listings/${esc(r.listing_id)}">${esc(r.listingName)}</a>`}</b>
        <small>${date(r.created_at)}${r.done ? ' · ' + T('সমাধান হয়েছে') : ''}</small><p>${esc(r.reason)}</p>${r.reviewText ? `<p class="muted">${T('রিভিউ')}: "${esc(r.reviewText)}"</p>` : ''}</div>
        <div class="acts">${r.kind === 'review' && r.review_id && !r.done ? `<button class="btn sm red" data-hiderv="${esc(r.review_id)}" data-h="1">${T('রিভিউ লুকান')}</button>` : ''}
          ${r.kind === 'info' ? `<a class="btn sm ghost" href="#/listings/${esc(r.listing_id)}">${icon('edit', 16)}${T('তথ্য ঠিক করুন')}</a>` : ''}
          ${r.kind === 'classified' && !r.done ? `<button class="btn sm red" data-cldel="${esc(r.listing_id)}">${T('বিজ্ঞাপন মুছুন')}</button>` : ''}
          <button class="btn sm ${r.done ? 'ghost' : ''}" data-resolve="${r.id}" data-d="${r.done ? 0 : 1}">${r.done ? T('আবার খুলুন') : icon('check', 16) + T('সমাধান হয়েছে')}</button></div></div>`; }).join('') || empty(T('কোনো রিপোর্ট নেই'), '', 'flag')}</div>`);
  };

  /* ---------------- settings-backed collections ---------------- */
  const collection = (key, title, page, opts) => async () => {
    await load();
    const arr = S.settings[key] || [], stats = opts.stats ? await opts.stats() : null;
    shell(page, T(title), `<button class="btn" data-colnew="${key}">${icon('plus', 18)}<span class="hide-sm">${T(opts.addLabel)}</span></button>`, `${opts.intro ? `<p class="muted" style="margin-top:0">${T(opts.intro)}</p>` : ''}
      ${opts.before ? opts.before() : ''}
      <div class="card">${arr.map((x, i) => `<div class="item">${opts.preview(x)}<div class="body"><b>${esc(opts.title(x))}</b><small>${opts.sub(x, stats)}</small></div>
        <div class="acts"><button class="iconbtn" data-colmove="${key}|${i}|-1" title="${T('উপরে')}" ${i ? '' : 'disabled'}>${icon('chevD', 18).replace('<svg', '<svg style="transform:rotate(180deg)"')}</button>
          <button class="iconbtn" data-colmove="${key}|${i}|1" title="${T('নিচে')}" ${i < arr.length - 1 ? '' : 'disabled'}>${icon('chevD', 18)}</button>
          ${opts.noToggle ? '' : `<button class="iconbtn" data-coltoggle="${key}|${i}" title="${T(x.active === false ? 'চালু করুন' : 'বন্ধ করুন')}">${icon(x.active === false ? 'eyeOff' : 'eye', 18)}</button>`}
          <button class="iconbtn" data-coledit="${key}|${i}" title="${T('সম্পাদনা')}">${icon('edit', 18)}</button>
          <button class="iconbtn red" data-coldel="${key}|${i}" title="${T('মুছুন')}">${icon('trash', 18)}</button></div></div>`).join('') || empty(T('কিছু নেই'))}</div>
      ${opts.after ? opts.after() : ''}`);
    opts.mounted && opts.mounted();
  };

  const PLACEMENTS = [['home', 'হোমপেজ স্লাইডার'], ['inline', 'হোমপেজের মাঝে'], ['category', 'ক্যাটাগরি পেজের উপরে'], ['classifieds', 'চাকরি/ভাড়া পেজের উপরে']];
  const COLS = {
    ads: {
      addLabel: 'নতুন বিজ্ঞাপন', intro: 'অ্যাপের বিজ্ঞাপনের জায়গাগুলো শুধু মূল অ্যাডমিন নিয়ন্ত্রণ করেন। বিজ্ঞাপনদাতার নাম, মেয়াদ ও কোথায় দেখাবে ঠিক করুন — ভিউ ও ক্লিক নিজে থেকেই গোনা হয়। পেইড প্রচারে উপরের ছোট লেখায় "Sponsored" দিন।',
      preview: b => `<span class="bprev ${esc(b.theme || 'dark')}" style="${b.image ? `background-image:linear-gradient(90deg,rgba(15,27,45,.85),rgba(15,27,45,.2)),url('${esc(b.image)}')` : ''}">${esc(b.title)}</span>`,
      title: b => b.title, sub: (b, st) => {
        const s = st?.[b.id] || { imps: 0, clicks: 0 }, ctr = s.imps ? (s.clicks / s.imps * 100).toFixed(1) : 0, t = new Date().toISOString().slice(0, 10);
        const expired = b.end && b.end < t, notyet = b.start && b.start > t;
        return `${T((PLACEMENTS.find(p => p[0] === (b.placement || 'home')) || [])[1] || '')}${b.category ? ' · ' + esc(catName(catOf(b.category))) : ''} · ${esc(b.advertiser || '—')}
          · ${b.start || b.end ? esc([day(b.start), day(b.end)].filter(Boolean).join(' → ')) : T('মেয়াদ নেই')}
          <br><span class="tag">${T('{n} ভিউ', { n: compact(s.imps) })}</span> <span class="tag">${T('{n} ক্লিক', { n: compact(s.clicks) })}</span> <span class="tag">CTR ${num(ctr)}%</span>
          ${b.active === false ? ` <span class="tag">${T('বন্ধ')}</span>` : expired ? ` <span class="tag bad">${T('মেয়াদ শেষ')}</span>` : notyet ? ` <span class="tag warn">${T('শুরু হয়নি')}</span>` : ` <span class="tag ok">${T('চলছে')}</span>`}`;
      },
      stats: () => api('/admin/adstats'),
      fields: () => [['placement', 'select', 'কোথায় দেখাবে', '', PLACEMENTS], ['category', 'select', 'ক্যাটাগরি (শুধু ক্যাটাগরি পেজের জন্য)', '', [['', '— সব —'], ...cats().map(c => [c.id, catName(c)])]],
        ['advertiser', 'text', 'বিজ্ঞাপনদাতা', 'প্রতিষ্ঠানের নাম ও ফোন — শুধু আপনার রেকর্ডের জন্য'], ['kicker', 'text', 'উপরের ছোট লেখা', 'যেমন: Sponsored, সীমিত অফার'],
        ['title', 'text', 'শিরোনাম *'], ['titleEn', 'text', 'শিরোনাম (English)'], ['subtitle', 'text', 'বিবরণ'], ['subtitleEn', 'text', 'বিবরণ (English)'],
        ['cta', 'text', 'বাটনের লেখা', 'যেমন: দেখুন'], ['ctaEn', 'text', 'বাটনের লেখা (English)'],
        ['link', 'text', 'লিংক', '#/p/আইডি, #/c/restaurant, tel:01XXXXXXXXX বা https://…'], ['theme', 'select', 'রং', '', [['dark', 'গাঢ় নীল'], ['brand', 'সবুজ'], ['accent', 'কমলা'], ['danger', 'লাল']]],
        ['start', 'date0', 'শুরুর তারিখ'], ['end', 'date0', 'শেষের তারিখ', 'খালি রাখলে মেয়াদ নেই'], ['image', 'image', 'ছবি (ঐচ্ছিক)', 'ডান পাশে দেখাবে']]
    },
    notices: {
      addLabel: 'নতুন ঘোষণা', intro: 'অ্যাপের বেল আইকনে দেখায়। ট্রাফিক, বিদ্যুৎ বিভ্রাট, ক্যাম্প বা জরুরি সতর্কতা জানাতে ব্যবহার করুন — শুধু যাচাইকৃত তথ্য দিন।',
      preview: n => `<span class="thumb" style="--c:${n.type === 'alert' ? '#e5484d' : '#0e9f6e'}">${icon(n.type === 'alert' ? 'alert' : 'megaphone', 20)}</span>`,
      title: n => n.title, sub: n => `${esc(day(n.date))} · ${esc((n.body || '').slice(0, 90))}${n.active === false ? ` · <span class="tag">${T('বন্ধ')}</span>` : ''}`,
      fields: () => [['title', 'text', 'শিরোনাম *'], ['titleEn', 'text', 'শিরোনাম (English)'], ['body', 'textarea', 'বিস্তারিত'], ['bodyEn', 'textarea', 'বিস্তারিত (English)'],
        ['date', 'date', 'তারিখ'], ['type', 'select', 'ধরন', '', [['info', 'সাধারণ তথ্য'], ['alert', 'সতর্কতা']]]]
    },
    categories: {
      addLabel: 'নতুন ক্যাটাগরি', intro: 'ক্যাটাগরি, ধরন, আইকন, রং, সার্চ কীওয়ার্ড ও রেটিংয়ের মানদণ্ড এখান থেকে নিয়ন্ত্রণ করুন। "পেইড" ক্যাটাগরিতে ব্যবসা যুক্ত করতে প্যাকেজ কিনতে হয় — যে ধরনগুলো ফ্রি রাখতে চান (যেমন সরকারি হাসপাতাল) সেগুলো "ফ্রি ধরন"-এ লিখুন।',
      preview: c => `<span class="thumb" style="--c:${esc(c.color)}">${icon(c.icon, 22)}</span>`,
      title: c => `${c.bn} · ${c.en || ''}`, sub: c => `${T('আইডি')}: ${esc(c.id)} · ${T('{n}টি ধরন', { n: num(Object.keys(c.subs || {}).length) })} · ${T('{n}টি তালিকা', { n: num(S.listings.filter(l => l.cat === c.id).length) })}
        · ${c.paid ? `<span class="tag ad">${T('পেইড')}</span>${c.freeSubs?.length ? ` <span class="tag ok">${T('ফ্রি')}: ${esc(c.freeSubs.join(', '))}</span>` : ''}` : `<span class="tag ok">${T('ফ্রি')}</span>`}${c.active === false ? ` <span class="tag">${T('বন্ধ')}</span>` : ''}`,
      fields: () => [['id', 'text', 'আইডি *', 'ইংরেজি ছোট হাতের, যেমন: gym (পরে বদলানো যাবে না)'], ['bn', 'text', 'নাম (বাংলা) *'], ['en', 'text', 'নাম (English)'],
        ['icon', 'icon', 'আইকন'], ['color', 'color', 'রং'], ['subs', 'kv', 'ধরন (প্রতি লাইনে: আইডি = নাম)', 'যেমন:\ngovt = সরকারি হাসপাতাল\nclinic = ক্লিনিক'],
        ['subsEn', 'kv', 'ধরনের ইংরেজি নাম (আইডি = English name)'], ['paid', 'check', 'পেইড ক্যাটাগরি — ব্যবসা যুক্ত করতে প্যাকেজ লাগবে'],
        ['freeSubs', 'list', 'ফ্রি ধরন (আইডি, কমা দিয়ে)', 'যেমন: govt, bloodbank'],
        ['keys', 'list', 'সার্চ কীওয়ার্ড', 'কমা দিয়ে: hospital, হাসপাতাল, hashpatal'], ['criteria', 'list', 'রেটিংয়ের মানদণ্ড', 'কমা দিয়ে: খাবারের মান, পরিচ্ছন্নতা, সার্ভিস']]
    },
    plans: {
      addLabel: 'নতুন প্যাকেজ', noToggle: true, intro: 'পেইড ক্যাটাগরিতে ব্যবসা যুক্ত করতে ব্যবসায়ীরা এই প্যাকেজগুলো থেকে বেছে নেন। "জনপ্রিয়" প্যাকেজের তালিকা হোমপেজে আগে দেখায়।',
      preview: p => `<span class="thumb" style="--c:${p.featured ? '#7c5cff' : '#0e9f6e'}">${icon('tag', 20)}</span>`,
      title: p => `${p.bn} · ${money(p.price)}`, sub: p => `${T('{n} দিন', { n: num(p.days) })} · ${esc((p.perks || []).join(', '))}${p.featured ? ` · <span class="tag ad">${T('হোমে জনপ্রিয়')}</span>` : ''}`,
      fields: () => [['id', 'text', 'আইডি *', 'ইংরেজি ছোট হাতের, যেমন: basic'], ['bn', 'text', 'নাম (বাংলা) *'], ['en', 'text', 'নাম (English)'],
        ['price', 'number', 'দাম (৳) *'], ['days', 'number', 'মেয়াদ (দিন)', 'যেমন ৩৬৫ = এক বছর'], ['featured', 'check', 'এই প্যাকেজের তালিকা হোমপেজে "জনপ্রিয়" অংশে দেখাবে'],
        ['perks', 'list', 'সুবিধাগুলো (কমা দিয়ে)'], ['perksEn', 'list', 'সুবিধাগুলো (English)']],
      after: () => paymentForm()
    }
  };
  pages.ads = collection('ads', 'বিজ্ঞাপন (Ads)', 'ads', COLS.ads);
  pages.notices = collection('notices', 'ঘোষণা', 'notices', COLS.notices);
  pages.categories = collection('categories', 'ক্যাটাগরি', 'categories', COLS.categories);
  pages.plans = collection('plans', 'প্যাকেজ ও পেমেন্ট সেটিংস', 'plans', COLS.plans);

  function paymentForm() {
    const p = S.settings.payment || {};
    return `<form class="card" data-paysettings style="margin-top:16px"><h3>${T('পেমেন্ট নম্বর')}</h3><div class="cbody form">
      <p class="muted" style="margin:0">${T('ব্যবসায়ীরা এই নম্বরে টাকা পাঠাবেন। যে মাধ্যম ব্যবহার করবেন না সেটি খালি রাখুন।')}</p>
      <div class="two">${fieldHtml(['bkash', 'text', 'বিকাশ নম্বর'], p.bkash)}${fieldHtml(['nagad', 'text', 'নগদ নম্বর'], p.nagad)}</div>
      <div class="two">${fieldHtml(['rocket', 'text', 'রকেট নম্বর'], p.rocket)}${fieldHtml(['type', 'select', 'অ্যাকাউন্টের ধরন', '', [['Personal', 'Personal'], ['Agent', 'Agent'], ['Merchant', 'Merchant']]], p.type)}</div>
      ${fieldHtml(['note', 'textarea', 'নির্দেশনা'], p.note)}${fieldHtml(['noteEn', 'textarea', 'নির্দেশনা (English)'], p.noteEn)}
      <div><button class="btn">${icon('check', 18)}${T('সংরক্ষণ করুন')}</button></div></div></form>`;
  }

  function fieldHtml([k, type, label, hint, opts], v, isNew) {
    const hintH = hint ? `<em>${esc(T(hint)).replace(/\n/g, '<br>')}</em>` : '';
    const L = T(label);
    if (type === 'textarea') return `<label class="field"><span>${L}</span><textarea name="${k}" rows="3">${esc(v || '')}</textarea>${hintH}</label>`;
    if (type === 'select') return `<label class="field"><span>${L}</span><select name="${k}">${opts.map(([a, b]) => `<option value="${esc(a)}" ${a === (v || '') ? 'selected' : ''}>${esc(T(b))}</option>`).join('')}</select>${hintH}</label>`;
    if (type === 'color') return `<label class="field"><span>${L}</span><input type="color" name="${k}" value="${esc(v || '#0e9f6e')}"></label>`;
    if (type === 'date') return `<label class="field"><span>${L}</span><input type="date" name="${k}" value="${esc(v || new Date().toISOString().slice(0, 10))}"></label>`;
    if (type === 'date0') return `<label class="field"><span>${L}</span><input type="date" name="${k}" value="${esc(v || '')}">${hintH}</label>`;
    if (type === 'number') return `<label class="field"><span>${L}</span><input name="${k}" inputmode="numeric" value="${esc(v ?? '')}">${hintH}</label>`;
    if (type === 'check') return `<label class="check"><input type="checkbox" name="${k}" ${v ? 'checked' : ''}><span>${L}</span></label>`;
    if (type === 'kv') return `<label class="field"><span>${L}</span><textarea name="${k}" rows="5">${esc(Object.entries(v || {}).map(([a, b]) => `${a} = ${b}`).join('\n'))}</textarea>${hintH}</label>`;
    if (type === 'list') return `<label class="field"><span>${L}</span><textarea name="${k}" rows="2">${esc((v || []).join(', '))}</textarea>${hintH}</label>`;
    if (type === 'icon') return `<div class="field"><span>${L}</span><input type="hidden" name="${k}" value="${esc(v || 'info')}"><div class="iconpick">${ICON_NAMES.map(n => `<button type="button" data-pickicon="${n}" class="${n === (v || 'info') ? 'on' : ''}" title="${n}">${icon(n, 20)}</button>`).join('')}</div></div>`;
    if (type === 'image') return `<div class="field"><span>${L}</span><div class="imgupload"><span class="pv" style="${v ? `background-image:url('${esc(v)}')` : ''}"></span><input type="hidden" name="${k}" value="${esc(v || '')}">
      <label class="btn sm ghost">${icon('upload', 16)}${T('আপলোড')}<input type="file" accept="image/*" data-single></label><button type="button" class="btn sm ghost" data-clearimg>${T('সরান')}</button></div>${hintH}</div>`;
    return `<label class="field"><span>${L}</span><input name="${k}" value="${esc(v ?? '')}" ${k === 'id' && !isNew ? 'readonly' : ''}>${hintH}</label>`;
  }
  function readFields(form, fields) {
    const v = {};
    fields.forEach(([k, type]) => {
      const el = form.elements[k];
      const raw = el?.value ?? '';
      if (type === 'check') v[k] = !!el?.checked;
      else if (type === 'kv') v[k] = Object.fromEntries(raw.split('\n').map(l => l.split('=')).filter(p => p.length >= 2 && p[0].trim()).map(([a, ...b]) => [a.trim().toLowerCase().replace(/\s+/g, '-'), b.join('=').trim()]));
      else if (type === 'list') v[k] = raw.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      else if (type === 'number') v[k] = raw.replace(/[^\d]/g, '') ? +raw.replace(/[^\d]/g, '') : null;
      else v[k] = raw.trim() || null;
    });
    return v;
  }

  function modal(title, body, onSave, saveLabel = 'সংরক্ষণ করুন') {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<form class="modal"><div class="mhead"><h3>${title}</h3><button type="button" class="iconbtn" data-x>${icon('x', 20)}</button></div>
      <div class="mbody form">${body}</div><div class="mfoot"><button type="button" class="btn ghost" data-x>${T('বাতিল')}</button><button class="btn">${T(saveLabel)}</button></div></form>`;
    document.body.appendChild(bg);
    const close = () => bg.remove();
    bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-x]')) close(); });
    bg.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const b = e.submitter || bg.querySelector('.mfoot .btn:last-child'); b.disabled = true;
      try { if (await onSave(e.target) !== false) close(); } catch (er) { toast(er.message, true); } finally { b.disabled = false; }
    };
    return bg;
  }

  async function saveSetting(key, val, msg = 'সংরক্ষণ হয়েছে') {
    await run(() => api('/admin/settings/' + key, val, 'PUT'), msg);
    S.settings[key] = val;
  }

  function editCollection(key, i) {
    const conf = COLS[key], arr = S.settings[key] || [], isNew = i == null, item = isNew ? {} : arr[i], fields = conf.fields();
    modal(T(isNew ? conf.addLabel : 'সম্পাদনা'), fields.map(f => fieldHtml(f, item[f[0]], isNew)).join(''), async form => {
      const v = readFields(form, fields);
      if (!v.title && !v.bn) throw new Error(T('শিরোনাম/নাম দিন'));
      const merged = { ...item, ...v, id: v.id || item.id || key[0] + Date.now().toString(36) };
      if (!conf.noToggle) merged.active = item.active !== false;
      if (['categories', 'plans'].includes(key)) {
        if (!/^[a-z0-9-]{2,30}$/.test(merged.id)) throw new Error(T('আইডি: ইংরেজি ছোট হাতের অক্ষর, সংখ্যা বা -'));
        if (isNew && arr.some(c => c.id === merged.id)) throw new Error(T('এই আইডি আগেই আছে'));
      }
      const next = arr.slice();
      isNew ? next.push(merged) : next.splice(i, 1, merged);
      await saveSetting(key, next); route();
    });
  }

  /* ---------------- app release ---------------- */
  pages.app = async () => {
    await load(true);
    const a = S.settings.app || {};
    shell('app', T('অ্যাপ রিলিজ (APK)'), '', `<div class="split"><div class="grid">
      <div class="card"><h3>${T('বর্তমান ভার্সন')}</h3><div class="cbody">${a.file ? `<div class="apkcur"><span class="thumb" style="--c:#0e9f6e;width:56px;height:56px">${icon('download', 26)}</span>
          <div><b style="font-size:20px">v${esc(a.versionName)}</b> <small class="muted">(${T('কোড')} ${num(a.versionCode)})</small><br><small class="muted">${esc(day(a.updated))} · ${a.size < 1048576 ? num(Math.max(1, Math.round(a.size / 1024))) + ' KB' : num((a.size / 1048576).toFixed(1)) + ' MB'}</small>
          ${a.notes ? `<p style="margin:8px 0 0">${esc(a.notes)}</p>` : ''}</div></div>
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><a class="btn dark" href="/download/jashore360.apk">${icon('download', 18)}${T('ডাউনলোড')}</a><a class="btn ghost" href="/" target="_blank">${T('ল্যান্ডিং পেজ দেখুন')}</a></div>`
        : empty(T('এখনো কোনো APK যোগ করা হয়নি'), '', 'download')}</div></div>
      <form class="card" data-apk><h3>${T('নতুন ভার্সন আপলোড')}</h3><div class="cbody form">
        <label class="field"><span>${T('APK ফাইল')}</span><input type="file" name="file" accept=".apk,application/vnd.android.package-archive" required></label>
        <div class="two"><label class="field"><span>${T('ভার্সন নাম')}</span><input name="versionName" required placeholder="1.1.0"></label>
          <label class="field"><span>${T('ভার্সন কোড')}</span><input name="versionCode" required inputmode="numeric" value="${(a.versionCode || 0) + 1}"><em>${T('প্রতিবার আগের চেয়ে বড় সংখ্যা দিন')}</em></label></div>
        <label class="field"><span>${T('কী নতুন')}</span><textarea name="notes" rows="3"></textarea></label>
        <div class="progress" hidden><i></i></div>
        <div><button class="btn">${icon('upload', 18)}${T('আপলোড ও প্রকাশ')}</button></div></div></form></div>
      <div class="card"><h3>${T('কীভাবে কাজ করে')}</h3><div class="cbody"><ol class="howto">
        <li>${T('নতুন APK আপলোড করলে ওয়েবসাইটের ডাউনলোড বাটন সাথে সাথে নতুন ফাইল দেয়।')}</li>
        <li>${T('যাদের ফোনে পুরনো অ্যাপ আছে, তারা অ্যাপের হোমপেজে "নতুন ভার্সন এসেছে" দেখবেন।')}</li>
        <li>${T('অ্যাপের ভেতরের তথ্য ও ডিজাইন ওয়েবসাইট থেকে আসে — সেগুলো বদলাতে নতুন APK লাগে না।')}</li>
        <li>${T('একই সাইনিং কী দিয়ে তৈরি APK দিতে হবে, নইলে ব্যবহারকারীরা আপডেট করতে পারবেন না।')}</li></ol></div></div></div>`);
  };

  /* ---------------- settings & admins ---------------- */
  pages.settings = async () => {
    await load();
    const s = S.settings.site || {};
    const F = [['name', 'text', 'অ্যাপের নাম'], ['tagline', 'text', 'ট্যাগলাইন'], ['taglineEn', 'text', 'ট্যাগলাইন (English)'], ['headline', 'text', 'হোমপেজের শিরোনাম'],
      ['headlineEn', 'text', 'হোমপেজের শিরোনাম (English)'], ['hotline', 'text', 'প্রধান জরুরি নম্বর', 'হোম ও জরুরি পেজের বড় কল বাটন'], ['hotlineNote', 'text', 'জরুরি নম্বরের বিবরণ'],
      ['hotlineNoteEn', 'text', 'জরুরি নম্বরের বিবরণ (English)'], ['contactPhone', 'text', 'যোগাযোগের ফোন'], ['contactEmail', 'text', 'যোগাযোগের ইমেইল'], ['facebook', 'text', 'ফেসবুক পেজ লিংক'],
      ['about', 'textarea', 'আমাদের সম্পর্কে'], ['aboutEn', 'textarea', 'আমাদের সম্পর্কে (English)'], ['disclaimer', 'textarea', 'দাবিত্যাগ (ফুটারে দেখায়)'],
      ['disclaimerEn', 'textarea', 'দাবিত্যাগ (English)'], ['snakeTip', 'textarea', 'সাপে কামড়ের নির্দেশনা (জরুরি পেজ)'], ['snakeTipEn', 'textarea', 'সাপে কামড়ের নির্দেশনা (English)']];
    const pair = (a, b) => `<div class="two">${fieldHtml(F[a], s[F[a][0]])}${fieldHtml(F[b], s[F[b][0]])}</div>`;
    shell('settings', T('সাধারণ সেটিংস'), '', `<div class="split"><form class="card" data-site><h3>${T('অ্যাপের তথ্য')}</h3><div class="cbody form">
        ${fieldHtml(F[0], s.name)}${pair(1, 2)}${pair(3, 4)}${fieldHtml(F[5], s.hotline)}${pair(6, 7)}${pair(8, 9)}${fieldHtml(F[10], s.facebook)}
        ${pair(11, 12)}${pair(13, 14)}${pair(15, 16)}<div><button class="btn">${icon('check', 18)}${T('সংরক্ষণ করুন')}</button></div></div></form>
      <div class="grid"><form class="card" data-areas><h3>${T('এলাকার তালিকা')}</h3><div class="cbody form"><label class="field"><span>${T('প্রতি লাইনে একটি এলাকা')}</span>
        <textarea name="areas" rows="14">${esc((S.settings.areas || []).join('\n'))}</textarea></label><div><button class="btn">${icon('check', 18)}${T('সংরক্ষণ')}</button></div></div></form>
        <div class="card"><h3>${T('ব্যাকআপ')}</h3><div class="cbody"><p class="muted" style="margin-top:0">${T('সব তালিকা, রিভিউ, পেমেন্ট, ব্যবহারকারী ও সেটিংস একটি ফাইলে ডাউনলোড করুন। নিয়মিত ব্যাকআপ রাখুন।')}</p>
          <a class="btn dark" href="/api/admin/export">${icon('download', 18)}${T('ব্যাকআপ ডাউনলোড')}</a></div></div></div></div>`);
    root.querySelector('[data-site]').onsubmit = async e => { e.preventDefault(); await saveSetting('site', { ...s, ...readFields(e.target, F) }); };
    root.querySelector('[data-areas]').onsubmit = async e => { e.preventDefault(); await saveSetting('areas', e.target.areas.value.split('\n').map(x => x.trim()).filter(Boolean)); };
  };

  pages.admins = async () => {
    const admins = owner() ? await api('/admin/admins') : [];
    shell('admins', T('অ্যাডমিন ও নিরাপত্তা'), owner() ? `<button class="btn" data-addadmin>${icon('plus', 18)}<span class="hide-sm">${T('নতুন অ্যাডমিন')}</span></button>` : '', `<div class="split">
      ${owner() ? `<div class="card"><h3>${T('অ্যাডমিন অ্যাকাউন্ট')}</h3>${admins.map(a => `<div class="item"><span class="thumb" style="--c:${a.role === 'owner' ? '#7c5cff' : '#0e9f6e'}">${icon(a.role === 'owner' ? 'shield' : 'user', 20)}</span>
        <div class="body"><b>${esc(a.username)}${a.username === S.me.username ? ` <span class="tag ok">${T('আপনি')}</span>` : ''}</b><small>${T(a.role === 'owner' ? 'মূল অ্যাডমিন' : 'মডারেটর')} · ${T('যোগ হয়েছে')} ${date(a.created_at)}</small></div>
        ${a.username !== S.me.username ? `<button class="iconbtn red" data-deladmin="${a.id}" title="${T('মুছুন')}">${icon('trash', 18)}</button>` : ''}</div>`).join('')}
        <div class="cbody muted" style="font-size:13px">${T('মডারেটর তালিকা, জমা, বিজ্ঞাপন অনুমোদন, রিভিউ ও রিপোর্ট দেখতে পারেন। পেমেন্ট যাচাই, বিজ্ঞাপন (Ads), প্যাকেজ, ক্যাটাগরি, অ্যাপ রিলিজ ও সেটিংস শুধু মূল অ্যাডমিনের।')}</div></div>` : '<div></div>'}
      <form class="card" data-pw><h3>${T('পাসওয়ার্ড পরিবর্তন')}</h3><div class="cbody form">
        <label class="field"><span>${T('বর্তমান পাসওয়ার্ড')}</span><input type="password" name="current" required autocomplete="current-password"></label>
        <label class="field"><span>${T('নতুন পাসওয়ার্ড')}</span><input type="password" name="new" required minlength="8" autocomplete="new-password"><em>${T('কমপক্ষে ৮ অক্ষর')}</em></label>
        <div><button class="btn">${icon('lock', 18)}${T('পরিবর্তন করুন')}</button></div></div></form></div>`);
    root.querySelector('[data-pw]').onsubmit = async e => { e.preventDefault(); await run(() => api('/admin/password', { current: e.target.current.value, new: e.target.new.value }), 'পাসওয়ার্ড পরিবর্তন হয়েছে'); e.target.reset(); };
  };

  const AUDIT = { login: 'লগইন', 'listing.create': 'নতুন তালিকা যোগ', 'listing.update': 'তালিকা সম্পাদনা', 'listing.delete': 'তালিকা মুছে ফেলা',
    'listing.approved': 'জমা অনুমোদন', 'listing.rejected': 'জমা বাতিল', 'listing.pending': 'অপেক্ষমাণ করা হয়েছে', 'review.update': 'রিভিউ আপডেট', 'review.delete': 'রিভিউ মুছে ফেলা',
    'settings.site': 'সেটিংস পরিবর্তন', 'settings.areas': 'এলাকা পরিবর্তন', 'settings.categories': 'ক্যাটাগরি পরিবর্তন', 'settings.ads': 'বিজ্ঞাপন পরিবর্তন',
    'settings.notices': 'ঘোষণা পরিবর্তন', 'settings.plans': 'প্যাকেজ পরিবর্তন', 'settings.payment': 'পেমেন্ট নম্বর পরিবর্তন', 'admin.add': 'নতুন অ্যাডমিন',
    'admin.delete': 'অ্যাডমিন মুছে ফেলা', 'admin.password': 'পাসওয়ার্ড পরিবর্তন', 'payment.verify': 'পেমেন্ট যাচাই', 'payment.reject': 'পেমেন্ট বাতিল',
    'classified.approved': 'বিজ্ঞাপন অনুমোদন', 'classified.rejected': 'বিজ্ঞাপন বাতিল', 'classified.delete': 'বিজ্ঞাপন মুছে ফেলা', 'user.ban': 'ব্যবহারকারী বন্ধ',
    'user.unban': 'ব্যবহারকারী চালু', 'user.reset': 'ব্যবহারকারীর পাসওয়ার্ড রিসেট', 'app.release': 'নতুন অ্যাপ ভার্সন' };

  /* ---------------- router ---------------- */
  async function route() {
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
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', () => { clearTimeout(pages.rz); pages.rz = setTimeout(() => location.hash.replace(/^#\/?/, '').split('?')[0] in { '': 1, dashboard: 1 } && route(), 250); });
  const refreshList = async () => { S.listings = await api('/admin/listings'); };

  /* ---------------- events ---------------- */
  document.addEventListener('click', async e => {
    const b = e.target.closest('button, [data-menu]'); if (!b) return;
    const d = b.dataset;
    if (d.setlang) { ls.set('lang', d.setlang); applyTheme(); return S.me ? route() : renderLogin(); }
    if (d.settheme) { ls.set('theme', d.settheme); applyTheme(); document.querySelectorAll('[data-settheme]').forEach(x => x.classList.toggle('on', x.dataset.settheme === d.settheme)); return; }
    if ('menu' in d) return root.querySelector('.shell').classList.toggle('open');
    if (d.metric) { pages.dashboard.metric = d.metric; return route(); }
    if ('logout' in d) { await api('/admin/logout', {}); S.me = null; return renderLogin(); }
    if (d.togglehide) {
      const l = S.listings.find(x => x.id === d.togglehide);
      await run(() => api('/admin/listings/' + l.id, { ...l, hidden: !l.hidden }, 'PUT'), l.hidden ? 'অ্যাপে দেখানো হচ্ছে' : 'লুকানো হয়েছে');
      await refreshList(); return route();
    }
    if (d.dellisting) {
      const l = S.listings.find(x => x.id === d.dellisting);
      if (!confirm(T('"{n}" এবং এর সব রিভিউ মুছে যাবে। নিশ্চিত?', { n: l?.name }))) return;
      await run(() => api('/admin/listings/' + d.dellisting, undefined, 'DELETE'), 'মুছে ফেলা হয়েছে');
      await refreshList(); if (location.hash.startsWith('#/listings/')) location.hash = '#/listings'; else route(); return;
    }
    if ('deldemo' in d) {
      const demo = S.listings.filter(l => l.demo);
      if (!confirm(T('{n}টি নমুনা তথ্য মুছে যাবে। নিশ্চিত?', { n: num(demo.length) }))) return;
      for (const l of demo) await api('/admin/listings/' + l.id, undefined, 'DELETE');
      toast(T('সব নমুনা তথ্য মুছে ফেলা হয়েছে')); await refreshList(); location.hash = '#/listings'; return;
    }
    if (d.approve || d.reject) {
      await run(() => api(`/admin/listings/${d.approve || d.reject}/review`, { review: d.approve ? 'approved' : 'rejected', verified: !!d.verified }), d.approve ? 'প্রকাশিত হয়েছে' : 'বাতিল করা হয়েছে');
      await refreshList(); return route();
    }
    if (d.paydecide) {
      const [id, decision, publish] = d.paydecide.split('|');
      if (decision === 'reject') {
        return modal(T('পেমেন্ট বাতিল'), `<label class="field"><span>${T('কারণ (ব্যবসায়ী দেখতে পাবেন)')}</span><textarea name="note" rows="3" placeholder="${T('যেমন: এই TrxID পাওয়া যায়নি')}"></textarea></label>`, async f => {
          await run(() => api('/admin/payments/' + id, { decision, note: f.note.value }), 'বাতিল করা হয়েছে'); await refreshList(); route();
        }, 'বাতিল করুন');
      }
      await run(() => api('/admin/payments/' + id, { decision, publish: publish === '1' }), publish === '1' ? 'যাচাই ও প্রকাশ হয়েছে' : 'যাচাই হয়েছে');
      await refreshList(); return route();
    }
    if (d.clreview) {
      const [id, review] = d.clreview.split('|'), days = root.querySelector(`[data-cldays="${id}"]`)?.value || 30;
      await run(() => api(`/admin/classifieds/${id}/review`, { review, days }), review === 'approved' ? 'অনুমোদন হয়েছে' : 'বাতিল করা হয়েছে'); return route();
    }
    if (d.cldel) { if (!confirm(T('মুছে ফেলবেন?'))) return; await run(() => api('/admin/classifieds/' + d.cldel, undefined, 'DELETE'), 'মুছে ফেলা হয়েছে'); return route(); }
    if (d.banuser) { const [id, v] = d.banuser.split('|'); if (v === '1' && !confirm(T('এই ব্যবহারকারী আর লগইন করতে পারবেন না। নিশ্চিত?'))) return;
      await run(() => api('/admin/users/' + id, { banned: v === '1' }, 'PUT'), 'আপডেট হয়েছে'); return route(); }
    if (d.resetuser) {
      if (!confirm(T('নতুন অস্থায়ী পাসওয়ার্ড তৈরি হবে। নিশ্চিত?'))) return;
      const r = await run(() => api(`/admin/users/${d.resetuser}/reset`, {}));
      return modal(T('নতুন পাসওয়ার্ড'), `<p>${T('ব্যবহারকারীকে এই পাসওয়ার্ড জানান। লগইনের পর তিনি সেটিংস থেকে বদলে নিতে পারবেন।')}</p><p class="bigpw">${esc(r.password)}</p>`, () => true, 'ঠিক আছে');
    }
    if (d.hiderv) {
      await run(() => api('/admin/reviews/' + d.hiderv, { hidden: d.h === '1' }, 'PUT'), d.h === '1' ? 'রিভিউ লুকানো হয়েছে' : 'রিভিউ দেখানো হচ্ছে');
      [S.reviews, S.reports] = await Promise.all([api('/admin/reviews'), api('/admin/reports')]); return route();
    }
    if (d.delrv) {
      if (!confirm(T('রিভিউটি স্থায়ীভাবে মুছে যাবে। নিশ্চিত?'))) return;
      await run(() => api('/admin/reviews/' + d.delrv, undefined, 'DELETE'), 'মুছে ফেলা হয়েছে');
      S.reviews = await api('/admin/reviews'); return route();
    }
    if (d.reply) {
      const r = S.reviews.find(x => x.id === d.reply);
      return modal(T('রিভিউয়ের উত্তর'), `<p class="muted" style="margin:0">"${esc(r.text || '')}"</p><label class="field"><span>${T('উত্তর')}</span><textarea name="reply" rows="4">${esc(r.reply || '')}</textarea><em>${T('অ্যাপে "Jashore360 টিম / প্রতিষ্ঠানের উত্তর" হিসেবে দেখাবে। খালি রাখলে উত্তর সরে যাবে।')}</em></label>`, async f => {
        await run(() => api('/admin/reviews/' + r.id, { reply: f.reply.value }, 'PUT'), 'উত্তর সংরক্ষণ হয়েছে'); S.reviews = await api('/admin/reviews'); route();
      });
    }
    if (d.resolve) { await run(() => api('/admin/reports/' + d.resolve, { done: d.d === '1' }, 'PUT')); S.reports = await api('/admin/reports'); return route(); }
    if (d.colnew) return editCollection(d.colnew);
    if (d.coledit) { const [k, i] = d.coledit.split('|'); return editCollection(k, +i); }
    if (d.coltoggle) { const [k, i] = d.coltoggle.split('|'); const next = S.settings[k].map((x, n) => n === +i ? { ...x, active: x.active === false } : x); await saveSetting(k, next); return route(); }
    if (d.coldel) {
      const [k, i] = d.coldel.split('|');
      if (!confirm(T('মুছে ফেলবেন?'))) return;
      try { await saveSetting(k, S.settings[k].filter((_, n) => n !== +i), 'মুছে ফেলা হয়েছে'); } catch { return; }
      return route();
    }
    if (d.colmove) {
      const [k, i, dir] = d.colmove.split('|'), arr = S.settings[k].slice(), j = +i + +dir;
      [arr[i], arr[j]] = [arr[j], arr[i]]; await saveSetting(k, arr, 'ক্রম বদলানো হয়েছে'); return route();
    }
    if (d.pickicon) { const box = b.closest('.field'); box.querySelector('input').value = d.pickicon; box.querySelectorAll('[data-pickicon]').forEach(x => x.classList.toggle('on', x === b)); return; }
    if ('clearimg' in d) { const box = b.closest('.imgupload'); box.querySelector('input[type=hidden]').value = ''; box.querySelector('.pv').style.backgroundImage = ''; return; }
    if (d.imgdel != null) { const f = b.closest('form'); f._images.splice(+d.imgdel, 1); return drawImgs(f); }
    if (d.imgfirst != null) { const f = b.closest('form'); f._images.unshift(...f._images.splice(+d.imgfirst, 1)); return drawImgs(f); }
    if ('addadmin' in d) {
      return modal(T('নতুন অ্যাডমিন'), `<label class="field"><span>${T('ইউজারনেম')}</span><input name="username" required pattern="[a-z0-9_.\\-]{3,30}"><em>${T('ইংরেজি ছোট হাতের অক্ষর/সংখ্যা')}</em></label>
        <label class="field"><span>${T('পাসওয়ার্ড')}</span><input name="password" type="password" required minlength="8"></label>
        <label class="field"><span>${T('ভূমিকা')}</span><select name="role"><option value="moderator">${T('মডারেটর')}</option><option value="owner">${T('মূল অ্যাডমিন')}</option></select></label>`, async f => {
        await run(() => api('/admin/admins', { username: f.username.value, password: f.password.value, role: f.role.value }), 'অ্যাডমিন যোগ হয়েছে'); route();
      }, 'যোগ করুন');
    }
    if (d.deladmin) { if (!confirm(T('এই অ্যাডমিন মুছে যাবে। নিশ্চিত?'))) return; await run(() => api('/admin/admins/' + d.deladmin, undefined, 'DELETE'), 'মুছে ফেলা হয়েছে'); return route(); }
  });

  document.addEventListener('change', async e => {
    const el = e.target;
    if (el.closest('[data-filter]')) {
      const f = el.closest('form'), p = new URLSearchParams();
      ['q', 'cat', 'status', 'flag'].forEach(k => f.elements[k].value && p.set(k, f.elements[k].value));
      location.hash = '#/listings' + (p.toString() ? '?' + p : ''); return;
    }
    if (el.matches('[data-catsel]')) return fillSubs(el.form);
    if (el.matches('[data-imgup]')) {
      const f = el.closest('form');
      for (const file of [...el.files].slice(0, 8 - f._images.length)) {
        try { toast(T('ছবি আপলোড হচ্ছে…')); f._images.push(await upload(file)); drawImgs(f); } catch (er) { toast(er.message, true); }
      }
      toast(T('ছবি যোগ হয়েছে')); return;
    }
    if (el.matches('[data-single]')) {
      const box = el.closest('.imgupload');
      try { toast(T('ছবি আপলোড হচ্ছে…')); const url = await upload(el.files[0]); box.querySelector('input[type=hidden]').value = url; box.querySelector('.pv').style.backgroundImage = `url('${url}')`; toast(T('আপলোড হয়েছে')); }
      catch (er) { toast(er.message, true); }
    }
  });

  document.addEventListener('paste', e => {
    const el = e.target;
    if (!el.matches?.('[data-latlng]')) return;
    const m = (e.clipboardData.getData('text') || '').match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (m) { e.preventDefault(); el.value = m[1]; el.form.elements.lng.value = m[2]; toast(T('অবস্থান বসানো হয়েছে')); }
  });

  document.addEventListener('submit', async e => {
    const f = e.target;
    if (f.matches('[data-filter]')) { e.preventDefault(); f.querySelector('select').dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (f.matches('[data-userq]')) { e.preventDefault(); location.hash = '#/users?q=' + encodeURIComponent(f.q.value.trim()); return; }
    if (f.matches('[data-paysettings]')) {
      e.preventDefault();
      const F = [['bkash', 'text'], ['nagad', 'text'], ['rocket', 'text'], ['type', 'select'], ['note', 'textarea'], ['noteEn', 'textarea']];
      const v = readFields(f, F); ['bkash', 'nagad', 'rocket'].forEach(k => v[k] = (v[k] || '').replace(/[^\d]/g, ''));
      return saveSetting('payment', { ...S.settings.payment, ...v });
    }
    if (f.matches('[data-apk]')) {
      e.preventDefault();
      const file = f.file.files[0], btn = f.querySelector('button'), bar = f.querySelector('.progress');
      if (!file) return;
      btn.disabled = true; bar.hidden = false;
      const qs = new URLSearchParams({ versionName: f.versionName.value, versionCode: f.versionCode.value, notes: f.notes.value });
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin/apk?' + qs);
      xhr.setRequestHeader('Content-Type', 'application/vnd.android.package-archive');
      xhr.upload.onprogress = ev => { bar.firstElementChild.style.width = (ev.loaded / ev.total * 100) + '%'; };
      xhr.onload = () => { btn.disabled = false; bar.hidden = true;
        const r = JSON.parse(xhr.responseText || '{}'); if (xhr.status === 200) { toast(T('নতুন ভার্সন প্রকাশিত হয়েছে')); S.settings.app = r; route(); } else toast(T(r.error || 'সমস্যা হয়েছে'), true); };
      xhr.onerror = () => { btn.disabled = false; bar.hidden = true; toast(T('আপলোড ব্যর্থ হয়েছে'), true); };
      xhr.send(file);
      return;
    }
    if (!f.matches('[data-edit]')) return;
    e.preventDefault();
    const id = f.dataset.edit, body = readListing(f), btn = e.submitter;
    if (btn?.name === 'approve') body._review = 'approved';
    if (btn) btn.disabled = true;
    try {
      if (id) await api('/admin/listings/' + id, body, 'PUT'); else await api('/admin/listings', body);
      toast(T('সংরক্ষণ হয়েছে')); await refreshList(); location.hash = '#/listings';
    } catch (er) { toast(er.message, true); if (btn) btn.disabled = false; }
  });

  /* ---------------- boot ---------------- */
  async function boot() {
    try { S.me = await api('/admin/me'); } catch { return; }
    try { S.counts = await api('/admin/summary'); } catch {}
    await load(true);
    route();
  }
  boot();
})();
