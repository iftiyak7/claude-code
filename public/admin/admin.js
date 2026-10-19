/* Jashore360 admin panel. */
(() => {
  'use strict';
  const root = document.getElementById('root');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BN = '০১২৩৪৫৬৭৮৯';
  const bn = n => String(n ?? 0).replace(/\d/g, d => BN[d]);
  const LOGO = '<svg viewBox="0 0 24 24"><path d="M12 21.5s-7.2-6.3-7.2-11.8a7.2 7.2 0 0 1 14.4 0c0 5.5-7.2 11.8-7.2 11.8z" fill="#fff"/><circle cx="12" cy="9.6" r="2.8" fill="#0f1b2d"/></svg>';
  const date = t => t ? new Date(t * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const STATUS = { verified: ['যাচাইকৃত', 'ok'], pending: ['যাচাই চলছে', 'warn'], needs_update: ['আপডেট প্রয়োজন', 'warn'], temp_closed: ['সাময়িক বন্ধ', 'bad'], closed: ['স্থায়ীভাবে বন্ধ', 'bad'] };
  const DAYS = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'];
  const S = { me: null, listings: null, settings: {}, reviews: null, reports: null, summary: null };

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
    if (r.status === 401 && !path.endsWith('/login')) { S.me = null; renderLogin(); throw new Error('লগইন করুন'); }
    if (!r.ok) throw new Error(data.error || 'সমস্যা হয়েছে');
    return data;
  }
  const run = async (fn, okMsg) => { try { const r = await fn(); okMsg && toast(okMsg); return r; } catch (e) { toast(e.message, true); throw e; } };

  function compress(file, max = 1600, q = .85) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url); res(cv.toDataURL('image/jpeg', q));
      };
      img.onerror = () => rej(new Error('ছবিটি পড়া যায়নি')); img.src = url;
    });
  }
  const upload = async file => (await api('/admin/upload', { data: await compress(file, 1400, .8) })).url;

  /* ---------------- data ---------------- */
  const cats = () => S.settings.categories || [];
  const catOf = id => cats().find(c => c.id === id) || { bn: id, icon: 'info', color: '#8b95a7', subs: {} };
  async function load(force) {
    const need = ['site', 'areas', 'categories', 'banners', 'notices'].filter(k => force || !S.settings[k]);
    const [lst, rv, rp, ...st] = await Promise.all([force || !S.listings ? api('/admin/listings') : S.listings,
      force || !S.reviews ? api('/admin/reviews') : S.reviews, force || !S.reports ? api('/admin/reports') : S.reports,
      ...need.map(k => api('/admin/settings/' + k))]);
    S.listings = lst; S.reviews = rv; S.reports = rp;
    need.forEach((k, i) => S.settings[k] = st[i]);
  }
  const counts = () => ({ subs: S.listings?.filter(l => l._review === 'pending').length || 0, reports: S.reports?.filter(r => !r.done).length || 0 });

  const thumb = l => { const c = catOf(l.cat); return `<span class="thumb" style="--c:${esc(c.color)}">${l.images?.[0] ? `<img src="${esc(l.images[0])}" alt="" loading="lazy">` : icon(c.icon, 20)}</span>`; };
  const statusTag = s => { const [t, k] = STATUS[s] || STATUS.pending; return `<span class="tag ${k}">${t}</span>`; };
  const empty = (t, m = '', ic = 'inbox') => `<div class="empty"><div class="eic">${icon(ic, 28)}</div><b>${t}</b>${m}</div>`;

  /* ---------------- login ---------------- */
  function renderLogin() {
    root.innerHTML = `<div class="login"><div class="art"><div class="logo"><i>${LOGO}</i>Jashore360</div>
      <div><h2>যশোরের সব তথ্য এক জায়গা থেকে পরিচালনা করুন</h2><p>তালিকা, রিভিউ, ব্যানার, ঘোষণা ও সেটিংস — সবকিছুর নিয়ন্ত্রণ এখানে।</p></div><span></span></div>
      <form data-login><div class="logo" style="color:var(--ink)"><i>${LOGO}</i>অ্যাডমিন</div><h1>লগইন করুন</h1>
        <label class="field"><span>ইউজারনেম</span><input name="username" autocomplete="username" required autofocus></label>
        <label class="field"><span>পাসওয়ার্ড</span><input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn block">লগইন</button><p class="muted" style="font-size:13px">পাসওয়ার্ড ভুলে গেলে সার্ভারে <code>reset-password</code> কমান্ড চালান।</p></form></div>`;
    root.querySelector('[data-login]').onsubmit = async e => {
      e.preventDefault();
      const f = e.target, b = f.querySelector('button'); b.disabled = true;
      try { const r = await api('/admin/login', { username: f.username.value, password: f.password.value }); S.me = r; await boot(); }
      catch (er) { toast(er.message, true); b.disabled = false; }
    };
  }

  /* ---------------- shell ---------------- */
  const NAV = [
    ['', [['dashboard', 'chart', 'ড্যাশবোর্ড']]],
    ['কনটেন্ট', [['listings', 'list', 'সব তালিকা'], ['submissions', 'inbox', 'নতুন জমা', 'subs'], ['reviews', 'msg', 'রিভিউ'], ['reports', 'flag', 'রিপোর্ট', 'reports']]],
    ['অ্যাপ সাজানো', [['categories', 'grid', 'ক্যাটাগরি'], ['banners', 'image', 'ব্যানার ও অফার'], ['notices', 'megaphone', 'ঘোষণা']]],
    ['সিস্টেম', [['settings', 'cog', 'সাধারণ সেটিংস'], ['admins', 'users', 'অ্যাডমিন ও নিরাপত্তা']]]
  ];
  const AUDIT = { login: 'লগইন', 'listing.create': 'নতুন তালিকা যোগ', 'listing.update': 'তালিকা সম্পাদনা', 'listing.delete': 'তালিকা মুছে ফেলা',
    'listing.approved': 'জমা অনুমোদন', 'listing.rejected': 'জমা বাতিল', 'review.update': 'রিভিউ আপডেট', 'review.delete': 'রিভিউ মুছে ফেলা',
    'settings.site': 'সেটিংস পরিবর্তন', 'settings.areas': 'এলাকা পরিবর্তন', 'settings.categories': 'ক্যাটাগরি পরিবর্তন', 'settings.banners': 'ব্যানার পরিবর্তন',
    'settings.notices': 'ঘোষণা পরিবর্তন', 'admin.add': 'নতুন অ্যাডমিন', 'admin.delete': 'অ্যাডমিন মুছে ফেলা', 'admin.password': 'পাসওয়ার্ড পরিবর্তন' };
  const TITLES = Object.fromEntries(NAV.flatMap(g => g[1]).map(x => [x[0], x[2]]));

  function shell(page, title, actions, body) {
    const c = counts();
    root.innerHTML = `<div class="shell"><aside class="side"><div class="logo"><i>${LOGO}</i>Jashore360</div>
      ${NAV.map(([g, list]) => `${g ? `<small>${g}</small>` : ''}${list.map(([k, ic, t, b]) => `<a href="#/${k}" class="${page === k ? 'on' : ''}">${icon(ic, 19)}${t}${b && c[b] ? `<span class="badge">${bn(c[b])}</span>` : ''}</a>`).join('')}`).join('')}
      <span class="grow"></span><a href="/" target="_blank">${icon('external', 19)}অ্যাপ দেখুন</a>
      <div class="me"><span class="thumb" style="--c:#0e9f6e;width:34px;height:34px">${icon('user', 18)}</span><div><b>${esc(S.me?.username)}</b><span style="font-size:12px">অ্যাডমিন</span></div>
        <button data-logout title="লগআউট">${icon('logout', 18)}</button></div></aside>
      <div class="main"><header class="top"><button class="iconbtn menu" data-menu>${icon('menu', 22)}</button><h1>${esc(title)}</h1>${actions || ''}</header>
      <div class="content">${body}</div></div></div>`;
  }

  /* ---------------- pages ---------------- */
  const pages = {};

  pages.dashboard = async () => {
    const s = await api('/admin/summary');
    const kp = [['list', '#0e9f6e', s.listings, 'মোট তালিকা'], ['check', '#0b8fd6', s.verified, 'যাচাইকৃত'], ['inbox', '#f2711c', s.pending, 'অপেক্ষমাণ জমা'],
      ['flag', '#e5484d', s.reports, 'খোলা রিপোর্ট'], ['msg', '#7c5cff', s.reviews, `রিভিউ (৭ দিনে ${bn(s.reviewsWeek)})`], ['eye', '#0f9fa8', s.views, 'প্রোফাইল ভিউ'],
      ['phone', '#0e9f6e', s.calls, 'কল বাটনে চাপ'], ['nav', '#4f6bed', s.maps, 'ম্যাপ খোলা']];
    shell('dashboard', 'ড্যাশবোর্ড', `<a class="btn" href="#/listings/new">${icon('plus', 18)}নতুন তালিকা</a>`, `
      ${s.demo ? `<div class="note">${icon('alert', 20)}<div><b>${bn(s.demo)}টি নমুনা তথ্য প্রকাশিত আছে।</b> লঞ্চের আগে আসল তথ্য যোগ করে নমুনাগুলো মুছে ফেলুন।</div><a class="btn sm dark" href="#/listings?flag=demo">দেখুন</a></div>` : ''}
      ${s.pending ? `<div class="note info">${icon('inbox', 20)}<div><b>${bn(s.pending)}টি নতুন জমা</b> অনুমোদনের অপেক্ষায়।</div><a class="btn sm" href="#/submissions">পর্যালোচনা করুন</a></div>` : ''}
      <div class="kpis">${kp.map(([ic, c, v, t]) => `<div class="card kpi"><span class="ib" style="--c:${c}">${icon(ic, 22)}</span><div><b>${bn(v)}</b><small>${t}</small></div></div>`).join('')}</div>
      <div class="two" style="margin-top:16px">
        <div class="card"><h3>সবচেয়ে বেশি দেখা তালিকা</h3>${s.top.length ? `<table class="t"><thead><tr><th>নাম</th><th>ভিউ</th><th>কল</th><th>ম্যাপ</th></tr></thead><tbody>
          ${s.top.map(t => `<tr><td><a href="#/listings/${t.id}"><b>${esc(t.name)}</b></a></td><td>${bn(t.views)}</td><td>${bn(t.calls)}</td><td>${bn(t.maps)}</td></tr>`).join('')}</tbody></table>` : empty('এখনো কোনো ভিউ নেই')}</div>
        <div class="card"><h3>সাম্প্রতিক কার্যক্রম</h3>${s.audit.length ? s.audit.map(a => `<div class="item"><div class="body"><b>${esc(AUDIT[a.action] || a.action)}</b><small>${esc(a.admin)}${a.target ? ' · ' + esc(a.target) : ''} · ${date(a.at)}</small></div></div>`).join('') : empty('কোনো কার্যক্রম নেই')}</div>
      </div>`);
  };

  pages.listings = async (_, p) => {
    await load();
    const q = (p.get('q') || '').toLowerCase(), cat = p.get('cat') || '', st = p.get('status') || '', flag = p.get('flag') || '';
    let list = S.listings.filter(l => l._review !== 'pending' && l._review !== 'rejected');
    if (q) list = list.filter(l => [l.name, l.nameEn, l.area, l.phone].join(' ').toLowerCase().includes(q));
    if (cat) list = list.filter(l => l.cat === cat);
    if (st) list = list.filter(l => l.status === st);
    if (flag) list = list.filter(l => l[flag]);
    const demo = S.listings.filter(l => l.demo).length;
    shell('listings', 'সব তালিকা', `${flag === 'demo' && demo ? `<button class="btn red" data-deldemo>${icon('trash', 18)}সব নমুনা মুছুন</button>` : ''}<a class="btn" href="#/listings/new">${icon('plus', 18)}নতুন তালিকা</a>`, `
      <form class="toolbar" data-filter><label class="search">${icon('search', 18)}<input name="q" value="${esc(p.get('q') || '')}" placeholder="নাম, এলাকা বা ফোন দিয়ে খুঁজুন"></label>
        <select name="cat"><option value="">সব ক্যাটাগরি</option>${cats().map(c => `<option value="${c.id}" ${c.id === cat ? 'selected' : ''}>${esc(c.bn)}</option>`).join('')}</select>
        <select name="status"><option value="">সব অবস্থা</option>${Object.entries(STATUS).map(([k, [v]]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select name="flag"><option value="">সব ধরন</option>${[['featured', 'হোমে জনপ্রিয়'], ['sponsored', 'Sponsored'], ['demo', 'নমুনা'], ['hidden', 'লুকানো']].map(([k, v]) => `<option value="${k}" ${k === flag ? 'selected' : ''}>${v}</option>`).join('')}</select></form>
      <div class="card tablewrap">${list.length ? `<table class="t"><thead><tr><th>নাম</th><th>ক্যাটাগরি</th><th>অবস্থা</th><th>রেটিং</th><th>ভিউ / কল</th><th></th></tr></thead><tbody>
        ${list.map(l => `<tr><td><a class="name" href="#/listings/${l.id}">${thumb(l)}<span><b>${esc(l.name)}</b><small>${esc(l.area || '')}${l.phone ? ' · ' + esc(l.phone) : ''}</small></span></a></td>
          <td data-l="ক্যাটাগরি">${esc(catOf(l.cat).bn)}<br><small class="muted">${esc(catOf(l.cat).subs?.[l.sub] || '')}</small></td>
          <td data-l="অবস্থা"><div class="tags">${statusTag(l.status)}${l.featured ? '<span class="tag ok">জনপ্রিয়</span>' : ''}${l.sponsored ? '<span class="tag ad">Sponsored</span>' : ''}${l.demo ? '<span class="tag">নমুনা</span>' : ''}${l.hidden ? '<span class="tag bad">লুকানো</span>' : ''}</div></td>
          <td data-l="রেটিং">${l.rating ? `<span class="stars">★</span> ${bn(l.rating)} <small class="muted">(${bn(l.reviews)})</small>` : '<span class="muted">—</span>'}</td>
          <td data-l="ভিউ / কল">${bn(l._views)} / ${bn(l._calls)}</td>
          <td><div class="acts"><a class="iconbtn" href="#/listings/${l.id}" title="সম্পাদনা">${icon('edit', 18)}</a>
            <button class="iconbtn" data-togglehide="${l.id}" title="${l.hidden ? 'দেখান' : 'লুকান'}">${icon(l.hidden ? 'eye' : 'eyeOff', 18)}</button>
            <a class="iconbtn" href="/#/p/${l.id}" target="_blank" title="অ্যাপে দেখুন">${icon('external', 17)}</a>
            <button class="iconbtn red" data-dellisting="${l.id}" title="মুছুন">${icon('trash', 18)}</button></div></td></tr>`).join('')}</tbody></table>`
        : empty('কোনো তালিকা পাওয়া যায়নি', '<div style="margin-top:12px"><a class="btn" href="#/listings/new">নতুন তালিকা যোগ করুন</a></div>')}</div>
      <p class="muted" style="font-size:13px">${bn(list.length)}টি দেখানো হচ্ছে</p>`);
  };

  pages.edit = async ([id]) => {
    await load();
    const isNew = id === 'new', l = isNew ? { status: 'pending', cat: cats().find(c => c.id !== 'emergency')?.id, images: [] } : S.listings.find(x => x.id === id);
    if (!l) return shell('listings', 'পাওয়া যায়নি', '', empty('তালিকাটি পাওয়া যায়নি'));
    const [o, c] = l.hours && l.hours !== '24h' ? l.hours.split('-') : ['', ''];
    const areas = S.settings.areas || [];
    const f = (name, label, attrs = '', hint = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(l[name] ?? '')}" ${attrs}>${hint ? `<em>${hint}</em>` : ''}</label>`;
    shell(l._review === 'pending' ? 'submissions' : 'listings', isNew ? 'নতুন তালিকা' : l.name, `<a class="btn ghost" href="#/${l._review === 'pending' ? 'submissions' : 'listings'}">বাতিল</a>`, `
      <form class="split" data-edit="${isNew ? '' : esc(id)}">
      <div class="grid">
        ${l._review === 'pending' ? `<div class="note info">${icon('inbox', 20)}<div><b>ব্যবহারকারীর জমা দেওয়া তথ্য</b> · জমাদাতা: ${esc(l._contact || 'যোগাযোগ দেননি')} · ${date(l._created)}</div></div>` : ''}
        <div class="card"><h3>মৌলিক তথ্য</h3><div class="cbody form">
          <div class="two">${f('name', 'নাম (বাংলা) *', 'required maxlength="120"')}${f('nameEn', 'নাম (English)', 'maxlength="120"', 'ম্যাপে খোঁজার জন্য কাজে লাগে')}</div>
          <div class="two"><label class="field"><span>ক্যাটাগরি *</span><select name="cat" data-catsel>${cats().map(x => `<option value="${x.id}" ${x.id === l.cat ? 'selected' : ''}>${esc(x.bn)}</option>`).join('')}</select></label>
            <label class="field"><span>ধরন</span><select name="sub" data-subsel data-val="${esc(l.sub || '')}"></select></label></div>
          <label class="field"><span>বিবরণ</span><textarea name="about" rows="5" maxlength="3000" placeholder="সেবা, বিশেষত্ব, ইতিহাস…">${esc(l.about || '')}</textarea></label>
          <label class="field"><span>ছোট নোট</span><input name="note" value="${esc(l.note || '')}" maxlength="400"><em>তালিকা ও জরুরি পেজে নামের নিচে দেখায়</em></label>
          <div class="two">${f('features', 'সুবিধা', '', 'কমা দিয়ে আলাদা করুন: পার্কিং, হোম ডেলিভারি')}${f('tags', 'সার্চ কীওয়ার্ড', '', 'কমা দিয়ে: kacchi, তেহারি, biryani')}</div>
        </div></div>
        <div class="card"><h3>যোগাযোগ ও অবস্থান</h3><div class="cbody form">
          <div class="two">${f('phone', 'ফোন', 'inputmode="tel"')}${f('phone2', 'বিকল্প ফোন', 'inputmode="tel"')}</div>
          <div class="two">${f('web', 'ওয়েবসাইট', 'type="url" placeholder="https://"')}${f('facebook', 'ফেসবুক পেজ', 'type="url" placeholder="https://facebook.com/…"')}</div>
          <div class="two"><label class="field"><span>এলাকা</span><input name="area" list="areas" value="${esc(l.area || '')}"><datalist id="areas">${areas.map(a => `<option value="${esc(a)}">`).join('')}</datalist></label>${f('address', 'ঠিকানা')}</div>
          <div class="two">${f('lat', 'Latitude', 'inputmode="decimal" data-latlng', 'Google Maps-এ জায়গায় রাইট-ক্লিক করে সংখ্যা কপি করে এখানে পেস্ট করুন')}${f('lng', 'Longitude', 'inputmode="decimal"')}</div>
        </div></div>
        <div class="card"><h3>সময় ও দাম</h3><div class="cbody form">
          <label class="check"><input type="checkbox" name="h24" ${l.hours === '24h' ? 'checked' : ''}><span>২৪ ঘণ্টা খোলা</span></label>
          <div class="two"><label class="field"><span>খোলে</span><input type="time" name="open" value="${esc(o)}"></label><label class="field"><span>বন্ধ হয়</span><input type="time" name="close" value="${esc(c)}"></label></div>
          <div class="field"><span>সাপ্তাহিক বন্ধ</span><div class="days">${DAYS.map((d, i) => `<label><input type="checkbox" name="off" value="${i}" ${l.off?.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div></div>
          ${f('price', 'আনুমানিক খরচ (৳)', 'inputmode="numeric"', 'রেস্টুরেন্টে জনপ্রতি, হোটেলে প্রতি রাত, সার্ভিসে শুরুর দাম')}
        </div></div>
      </div>
      <div class="grid">
        <div class="card"><h3>প্রকাশ ও অবস্থা</h3><div class="cbody form">
          <label class="field"><span>তথ্যের অবস্থা</span><select name="status">${Object.entries(STATUS).map(([k, [v]]) => `<option value="${k}" ${k === l.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          ${f('verifiedAt', 'সর্বশেষ যাচাইয়ের তারিখ', 'type="date"', '"যাচাইকৃত" বাছলে খালি থাকলে আজকের তারিখ বসবে')}
          ${[['featured', 'হোমপেজে "জনপ্রিয়" অংশে দেখান'], ['sponsored', 'Sponsored (পেইড প্রচার)', 'তালিকার উপরে, "Sponsored" লেবেলসহ'], ['pin', 'জরুরি তালিকায় সবার উপরে'],
            ['demo', 'নমুনা তথ্য', 'অ্যাপে "নমুনা" লেবেল দেখাবে'], ['hidden', 'লুকিয়ে রাখুন', 'অ্যাপে দেখাবে না']].map(([k, t, s]) =>
            `<label class="check"><input type="checkbox" name="${k}" ${l[k] ? 'checked' : ''}><span>${t}${s ? `<small>${s}</small>` : ''}</span></label>`).join('')}
        </div></div>
        <div class="card"><h3>ছবি <small class="muted" style="font-weight:400">প্রথম ছবিটি কভার</small></h3><div class="cbody"><div class="imgs" data-imgs></div></div></div>
        ${!isNew ? `<div class="card"><h3>পরিসংখ্যান</h3><div class="cbody" style="display:grid;grid-template-columns:repeat(3,1fr);text-align:center">
          <div><b style="font-size:20px">${bn(l._views)}</b><br><small class="muted">ভিউ</small></div><div><b style="font-size:20px">${bn(l._calls)}</b><br><small class="muted">কল</small></div><div><b style="font-size:20px">${bn(l._maps)}</b><br><small class="muted">ম্যাপ</small></div></div></div>` : ''}
      </div>
      <div class="savebar" style="grid-column:1/-1">${!isNew ? `<button type="button" class="btn red" data-dellisting="${esc(id)}" style="margin-right:auto">${icon('trash', 18)}মুছুন</button>` : ''}
        ${l._review === 'pending' ? `<button type="submit" class="btn" name="approve" value="1">${icon('check', 18)}সংরক্ষণ ও প্রকাশ</button>` : `<button type="submit" class="btn">${icon('check', 18)}সংরক্ষণ করুন</button>`}</div>
      </form>`);
    const form = root.querySelector('[data-edit]');
    form._images = [...(l.images || [])];
    fillSubs(form); drawImgs(form);
  };

  function fillSubs(form) {
    const cs = form.querySelector('[data-catsel]'), ss = form.querySelector('[data-subsel]');
    const subs = catOf(cs.value).subs || {};
    ss.innerHTML = '<option value="">—</option>' + Object.entries(subs).map(([k, v]) => `<option value="${k}" ${k === ss.dataset.val ? 'selected' : ''}>${esc(v)}</option>`).join('');
  }
  function drawImgs(form) {
    const box = form.querySelector('[data-imgs]');
    box.innerHTML = form._images.map((u, i) => `<div class="im"><img src="${esc(u)}" alt="">${i === 0 ? '<span class="tag ok cover">কভার</span>' : ''}
      <div class="ops"><button type="button" data-imgfirst="${i}" title="কভার করুন">${icon('star', 14)}</button><button type="button" data-imgdel="${i}" title="সরান">${icon('x', 14)}</button></div></div>`).join('')
      + (form._images.length < 8 ? `<label class="up">${icon('upload', 20)}<span>ছবি যোগ</span><input type="file" accept="image/*" multiple data-imgup></label>` : '');
  }

  function readListing(form) {
    const fd = new FormData(form), v = Object.fromEntries(fd);
    const out = { name: v.name, nameEn: v.nameEn, cat: v.cat, sub: v.sub, about: v.about, note: v.note, features: v.features, tags: v.tags, phone: v.phone, phone2: v.phone2,
      web: v.web, facebook: v.facebook, area: v.area, address: v.address, lat: v.lat, lng: v.lng, price: (v.price || '').replace(/[^\d]/g, ''),
      hours: v.h24 ? '24h' : v.open && v.close ? `${v.open}-${v.close}` : null, off: fd.getAll('off').map(Number),
      status: v.status, verifiedAt: v.verifiedAt, images: form._images };
    ['featured', 'sponsored', 'pin', 'demo', 'hidden'].forEach(k => out[k] = !!v[k]);
    return out;
  }

  pages.submissions = async () => {
    await load();
    const list = S.listings.filter(l => l._review === 'pending').sort((a, b) => b._created - a._created);
    shell('submissions', 'নতুন জমা', '', `<p class="muted" style="margin-top:0">ব্যবহারকারী ও ব্যবসায়ীরা অ্যাপ থেকে যে তথ্য পাঠিয়েছেন। যাচাই করে প্রকাশ করুন।</p>
      <div class="card">${list.map(l => `<div class="item">${thumb(l)}<div class="body"><b>${esc(l.name)}</b>
        <small>${esc(catOf(l.cat).bn)} › ${esc(catOf(l.cat).subs?.[l.sub] || '')} · ${esc(l.area || '')} · ${esc(l.phone || 'ফোন নেই')}</small>
        ${l.about ? `<p>${esc(l.about)}</p>` : ''}<small>জমাদাতা: ${esc(l._contact || '—')} · ${date(l._created)}</small>
        ${l.images?.length ? `<div style="display:flex;gap:6px;margin-top:8px">${l.images.map(u => `<img class="rvphoto" src="${esc(u)}" alt="">`).join('')}</div>` : ''}</div>
        <div class="acts"><button class="btn sm" data-approve="${l.id}" data-verified="1">${icon('check', 16)}যাচাইকৃত হিসেবে প্রকাশ</button>
          <button class="btn sm ghost" data-approve="${l.id}">প্রকাশ (যাচাই চলছে)</button><a class="btn sm ghost" href="#/listings/${l.id}">${icon('edit', 16)}সম্পাদনা</a>
          <button class="btn sm red" data-reject="${l.id}">বাতিল</button></div></div>`).join('') || empty('কোনো অপেক্ষমাণ জমা নেই', '<div>নতুন জমা এলে এখানে দেখাবে।</div>', 'check')}</div>`);
  };

  pages.reviews = async (_, p) => {
    await load();
    const tab = p.get('tab') || 'all';
    let list = S.reviews;
    if (tab === 'reported') list = list.filter(r => r.reported);
    if (tab === 'hidden') list = list.filter(r => r.hidden);
    shell('reviews', 'রিভিউ', '', `<div class="tabs">${[['all', 'সব', S.reviews.length], ['reported', 'রিপোর্টেড', S.reviews.filter(r => r.reported).length], ['hidden', 'লুকানো', S.reviews.filter(r => r.hidden).length]]
      .map(([k, t, n]) => `<a class="${tab === k ? 'on' : ''}" href="#/reviews?tab=${k}">${t} (${bn(n)})</a>`).join('')}</div>
      <div class="card">${list.map(r => `<div class="item" style="align-items:flex-start">${r.photo ? `<img class="rvphoto" src="${esc(r.photo)}" alt="">` : ''}<div class="body">
        <b><span class="stars">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</span> · <a href="#/listings/${r.listing}">${esc(r.listingName)}</a></b>
        <small>${esc(r.name || 'নাম দেননি')} · ${date(r.t)} · 👍 ${bn(r.up)} 👎 ${bn(r.down)} ${r.reported ? '<span class="tag bad">রিপোর্টেড</span>' : ''}${r.hidden ? '<span class="tag">লুকানো</span>' : ''}</small>
        ${r.crit ? `<div class="tags" style="margin-top:6px">${Object.entries(r.crit).map(([k, v]) => `<span class="tag">${esc(k)} ${bn(v)}/৫</span>`).join('')}</div>` : ''}
        ${r.text ? `<p>${esc(r.text)}</p>` : ''}${r.reply ? `<p style="background:var(--surface-2);padding:8px 12px;border-radius:10px"><b style="font-size:12px;color:var(--brand)">উত্তর:</b> ${esc(r.reply)}</p>` : ''}</div>
        <div class="acts"><button class="btn sm ghost" data-reply="${r.id}">${icon('msg', 16)}${r.reply ? 'উত্তর বদলান' : 'উত্তর দিন'}</button>
          <button class="btn sm ghost" data-hiderv="${r.id}" data-h="${r.hidden ? 0 : 1}">${icon(r.hidden ? 'eye' : 'eyeOff', 16)}${r.hidden ? 'দেখান' : 'লুকান'}</button>
          <button class="iconbtn red" data-delrv="${r.id}" title="মুছুন">${icon('trash', 18)}</button></div></div>`).join('') || empty('কোনো রিভিউ নেই', '', 'msg')}</div>`);
  };

  pages.reports = async () => {
    await load();
    shell('reports', 'রিপোর্ট', '', `<p class="muted" style="margin-top:0">ব্যবহারকারীরা ভুল তথ্য বা অনুপযুক্ত রিভিউ সম্পর্কে যা জানিয়েছেন।</p>
      <div class="card">${S.reports.map(r => `<div class="item" style="align-items:flex-start;${r.done ? 'opacity:.55' : ''}"><span class="thumb" style="--c:${r.kind === 'review' ? '#7c5cff' : '#e5484d'}">${icon(r.kind === 'review' ? 'msg' : 'alert', 20)}</span>
        <div class="body"><b>${r.kind === 'review' ? 'রিভিউ রিপোর্ট' : 'তথ্য সংশোধন'} · <a href="#/listings/${esc(r.listing_id)}">${esc(r.listingName)}</a></b><small>${date(r.created_at)}${r.done ? ' · সমাধান হয়েছে' : ''}</small>
        <p>${esc(r.reason)}</p>${r.reviewText ? `<p class="muted">রিভিউ: "${esc(r.reviewText)}"</p>` : ''}</div>
        <div class="acts">${r.kind === 'review' && r.review_id && !r.done ? `<button class="btn sm red" data-hiderv="${esc(r.review_id)}" data-h="1">রিভিউ লুকান</button>` : ''}
          ${r.kind !== 'review' ? `<a class="btn sm ghost" href="#/listings/${esc(r.listing_id)}">${icon('edit', 16)}তথ্য ঠিক করুন</a>` : ''}
          <button class="btn sm ${r.done ? 'ghost' : ''}" data-resolve="${r.id}" data-d="${r.done ? 0 : 1}">${r.done ? 'আবার খুলুন' : icon('check', 16) + 'সমাধান হয়েছে'}</button></div></div>`).join('') || empty('কোনো রিপোর্ট নেই', '', 'flag')}</div>`);
  };

  /* --- settings-backed collections --- */
  const collection = (key, title, page, opts) => async () => {
    await load();
    const arr = S.settings[key];
    shell(page, title, `<button class="btn" data-colnew="${key}">${icon('plus', 18)}${opts.addLabel}</button>`, `${opts.intro ? `<p class="muted" style="margin-top:0">${opts.intro}</p>` : ''}
      <div class="card">${arr.map((x, i) => `<div class="item">${opts.preview(x)}<div class="body"><b>${esc(opts.title(x))}</b><small>${opts.sub(x)}</small></div>
        <div class="acts"><button class="iconbtn" data-colmove="${key}|${i}|-1" title="উপরে" ${i ? '' : 'disabled'}>${icon('chevL', 18, '').replace('<svg', '<svg style="transform:rotate(90deg)"')}</button>
          <button class="iconbtn" data-colmove="${key}|${i}|1" title="নিচে" ${i < arr.length - 1 ? '' : 'disabled'}>${icon('chevR', 18).replace('<svg', '<svg style="transform:rotate(90deg)"')}</button>
          <button class="iconbtn" data-coltoggle="${key}|${i}" title="${x.active === false ? 'চালু করুন' : 'বন্ধ করুন'}">${icon(x.active === false ? 'eyeOff' : 'eye', 18)}</button>
          <button class="iconbtn" data-coledit="${key}|${i}" title="সম্পাদনা">${icon('edit', 18)}</button>
          <button class="iconbtn red" data-coldel="${key}|${i}" title="মুছুন">${icon('trash', 18)}</button></div></div>`).join('') || empty('কিছু নেই')}</div>`);
  };

  const COLS = {
    banners: {
      addLabel: 'নতুন ব্যানার', intro: 'হোমপেজের উপরের স্লাইডার। অফার, নতুন ব্যবসা বা ইভেন্ট প্রচারে ব্যবহার করুন। পেইড প্রচার হলে শিরোনামের উপরে "Sponsored" লিখুন।',
      preview: b => `<span class="bprev ${esc(b.theme || 'dark')}" style="${b.image ? `background-image:linear-gradient(90deg,rgba(15,27,45,.85),rgba(15,27,45,.2)),url('${esc(b.image)}')` : ''}">${esc(b.title)}</span>`,
      title: b => b.title, sub: b => `${esc(b.subtitle || '')} · লিংক: ${esc(b.link || '—')}${b.active === false ? ' · <span class="tag">বন্ধ</span>' : ''}`,
      fields: [['kicker', 'text', 'উপরের ছোট লেখা', 'যেমন: Sponsored, সীমিত অফার'], ['title', 'text', 'শিরোনাম *'], ['subtitle', 'text', 'বিবরণ'], ['cta', 'text', 'বাটনের লেখা', 'যেমন: দেখুন'],
        ['link', 'text', 'লিংক', '#/p/আইডি, #/c/restaurant, tel:999 বা https://…'], ['theme', 'select', 'রং', '', [['dark', 'গাঢ় নীল'], ['brand', 'সবুজ'], ['accent', 'কমলা'], ['danger', 'লাল']]],
        ['image', 'image', 'ছবি (ঐচ্ছিক)', 'ডান পাশে দেখাবে']]
    },
    notices: {
      addLabel: 'নতুন ঘোষণা', intro: 'অ্যাপের বেল আইকনে দেখায়। ট্রাফিক, বিদ্যুৎ বিভ্রাট, ক্যাম্প বা জরুরি সতর্কতা জানাতে ব্যবহার করুন — শুধু যাচাইকৃত তথ্য দিন।',
      preview: n => `<span class="thumb" style="--c:${n.type === 'alert' ? '#e5484d' : '#0e9f6e'}">${icon(n.type === 'alert' ? 'alert' : 'megaphone', 20)}</span>`,
      title: n => n.title, sub: n => `${esc(n.date || '')} · ${esc((n.body || '').slice(0, 90))}${n.active === false ? ' · <span class="tag">বন্ধ</span>' : ''}`,
      fields: [['title', 'text', 'শিরোনাম *'], ['body', 'textarea', 'বিস্তারিত'], ['date', 'date', 'তারিখ'], ['type', 'select', 'ধরন', '', [['info', 'সাধারণ তথ্য'], ['alert', 'সতর্কতা']]]]
    },
    categories: {
      addLabel: 'নতুন ক্যাটাগরি', intro: 'অ্যাপের ক্যাটাগরি, তাদের ধরন (সাব-ক্যাটাগরি), আইকন, রং, সার্চ কীওয়ার্ড ও রেটিংয়ের মানদণ্ড এখান থেকে নিয়ন্ত্রণ করুন। "emergency" আইডির ক্যাটাগরিটি জরুরি পেজে দেখায়।',
      preview: c => `<span class="thumb" style="--c:${esc(c.color)}">${icon(c.icon, 22)}</span>`,
      title: c => `${c.bn} · ${c.en || ''}`, sub: c => `আইডি: ${esc(c.id)} · ${bn(Object.keys(c.subs || {}).length)}টি ধরন · ${bn(S.listings.filter(l => l.cat === c.id).length)}টি তালিকা${c.active === false ? ' · <span class="tag">বন্ধ</span>' : ''}`,
      fields: [['id', 'text', 'আইডি *', 'ইংরেজি ছোট হাতের, যেমন: gym (পরে বদলানো যাবে না)'], ['bn', 'text', 'নাম (বাংলা) *'], ['en', 'text', 'নাম (English)'],
        ['icon', 'icon', 'আইকন'], ['color', 'color', 'রং'], ['subs', 'kv', 'ধরন (প্রতি লাইনে: আইডি = নাম)', 'যেমন:\ngovt = সরকারি হাসপাতাল\nclinic = ক্লিনিক'],
        ['keys', 'list', 'সার্চ কীওয়ার্ড', 'কমা দিয়ে: hospital, হাসপাতাল, hashpatal'], ['criteria', 'list', 'রেটিংয়ের মানদণ্ড', 'কমা দিয়ে: খাবারের মান, পরিচ্ছন্নতা, সার্ভিস']]
    }
  };
  pages.banners = collection('banners', 'ব্যানার ও অফার', 'banners', COLS.banners);
  pages.notices = collection('notices', 'ঘোষণা', 'notices', COLS.notices);
  pages.categories = collection('categories', 'ক্যাটাগরি', 'categories', COLS.categories);

  function fieldHtml([k, type, label, hint, opts], v, isNew) {
    const hintH = hint ? `<em>${esc(hint).replace(/\n/g, '<br>')}</em>` : '';
    if (type === 'textarea') return `<label class="field"><span>${label}</span><textarea name="${k}" rows="4">${esc(v || '')}</textarea>${hintH}</label>`;
    if (type === 'select') return `<label class="field"><span>${label}</span><select name="${k}">${opts.map(([a, b]) => `<option value="${a}" ${a === v ? 'selected' : ''}>${b}</option>`).join('')}</select></label>`;
    if (type === 'color') return `<label class="field"><span>${label}</span><input type="color" name="${k}" value="${esc(v || '#0e9f6e')}"></label>`;
    if (type === 'date') return `<label class="field"><span>${label}</span><input type="date" name="${k}" value="${esc(v || new Date().toISOString().slice(0, 10))}"></label>`;
    if (type === 'kv') return `<label class="field"><span>${label}</span><textarea name="${k}" rows="5">${esc(Object.entries(v || {}).map(([a, b]) => `${a} = ${b}`).join('\n'))}</textarea>${hintH}</label>`;
    if (type === 'list') return `<label class="field"><span>${label}</span><textarea name="${k}" rows="2">${esc((v || []).join(', '))}</textarea>${hintH}</label>`;
    if (type === 'icon') return `<div class="field"><span>${label}</span><input type="hidden" name="${k}" value="${esc(v || 'info')}"><div class="iconpick">${ICON_NAMES.map(n => `<button type="button" data-pickicon="${n}" class="${n === (v || 'info') ? 'on' : ''}" title="${n}">${icon(n, 20)}</button>`).join('')}</div></div>`;
    if (type === 'image') return `<div class="field"><span>${label}</span><div class="imgupload"><span class="pv" style="${v ? `background-image:url('${esc(v)}')` : ''}"></span><input type="hidden" name="${k}" value="${esc(v || '')}">
      <label class="btn sm ghost">${icon('upload', 16)}আপলোড<input type="file" accept="image/*" data-single></label><button type="button" class="btn sm ghost" data-clearimg>সরান</button></div>${hintH}</div>`;
    return `<label class="field"><span>${label}</span><input name="${k}" value="${esc(v ?? '')}" ${k === 'id' && !isNew ? 'readonly' : ''}>${hintH}</label>`;
  }
  function readFields(form, fields) {
    const v = {};
    fields.forEach(([k, type]) => {
      const raw = form.elements[k]?.value ?? '';
      if (type === 'kv') v[k] = Object.fromEntries(raw.split('\n').map(l => l.split('=')).filter(p => p.length >= 2 && p[0].trim()).map(([a, ...b]) => [a.trim().toLowerCase().replace(/\s+/g, '-'), b.join('=').trim()]));
      else if (type === 'list') v[k] = raw.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      else v[k] = raw.trim() || null;
    });
    return v;
  }

  function modal(title, body, onSave, saveLabel = 'সংরক্ষণ করুন') {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<form class="modal"><div class="mhead"><h3>${title}</h3><button type="button" class="iconbtn" data-x>${icon('x', 20)}</button></div>
      <div class="mbody form">${body}</div><div class="mfoot"><button type="button" class="btn ghost" data-x>বাতিল</button><button class="btn">${saveLabel}</button></div></form>`;
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
    const conf = COLS[key], arr = S.settings[key], isNew = i == null, item = isNew ? {} : arr[i];
    modal(isNew ? conf.addLabel : 'সম্পাদনা', conf.fields.map(f => fieldHtml(f, item[f[0]], isNew)).join(''), async form => {
      const v = readFields(form, conf.fields);
      if (!v.title && !v.bn) throw new Error('শিরোনাম/নাম দিন');
      const next = arr.slice();
      const merged = { ...item, ...v, id: v.id || item.id || key[0] + Date.now().toString(36), active: item.active !== false };
      if (key === 'categories') { if (!/^[a-z0-9-]{2,30}$/.test(merged.id)) throw new Error('আইডি: ইংরেজি ছোট হাতের অক্ষর, সংখ্যা বা -'); if (isNew && arr.some(c => c.id === merged.id)) throw new Error('এই আইডি আগেই আছে'); }
      isNew ? next.push(merged) : next.splice(i, 1, merged);
      await saveSetting(key, next); route();
    });
  }

  pages.settings = async () => {
    await load();
    const s = S.settings.site || {};
    const F = [['name', 'text', 'অ্যাপের নাম'], ['tagline', 'text', 'ট্যাগলাইন'], ['headline', 'text', 'হোমপেজের শিরোনাম'],
      ['hotline', 'text', 'প্রধান জরুরি নম্বর', 'হোম ও জরুরি পেজের বড় কল বাটন'], ['hotlineNote', 'text', 'জরুরি নম্বরের বিবরণ'],
      ['contactPhone', 'text', 'যোগাযোগের ফোন'], ['contactEmail', 'text', 'যোগাযোগের ইমেইল'], ['facebook', 'text', 'ফেসবুক পেজ লিংক'],
      ['about', 'textarea', 'আমাদের সম্পর্কে'], ['disclaimer', 'textarea', 'দাবিত্যাগ (ফুটারে দেখায়)'], ['snakeTip', 'textarea', 'সাপে কামড়ের নির্দেশনা (জরুরি পেজ)']];
    shell('settings', 'সাধারণ সেটিংস', '', `<div class="split"><form class="card" data-site><h3>অ্যাপের তথ্য</h3><div class="cbody form">
        <div class="two">${F.slice(0, 2).map(f => fieldHtml(f, s[f[0]])).join('')}</div>${fieldHtml(F[2], s.headline)}
        <div class="two">${F.slice(3, 5).map(f => fieldHtml(f, s[f[0]])).join('')}</div><div class="two">${F.slice(5, 7).map(f => fieldHtml(f, s[f[0]])).join('')}</div>
        ${F.slice(7).map(f => fieldHtml(f, s[f[0]])).join('')}<div><button class="btn">${icon('check', 18)}সংরক্ষণ করুন</button></div></div></form>
      <div class="grid"><form class="card" data-areas><h3>এলাকার তালিকা</h3><div class="cbody form"><label class="field"><span>প্রতি লাইনে একটি এলাকা</span>
        <textarea name="areas" rows="14">${esc((S.settings.areas || []).join('\n'))}</textarea></label><div><button class="btn">${icon('check', 18)}সংরক্ষণ</button></div></div></form>
        <div class="card"><h3>ব্যাকআপ</h3><div class="cbody"><p class="muted" style="margin-top:0">সব তালিকা, রিভিউ, রিপোর্ট ও সেটিংস একটি ফাইলে ডাউনলোড করুন। নিয়মিত ব্যাকআপ রাখুন।</p>
          <a class="btn dark" href="/api/admin/export">${icon('download', 18)}ব্যাকআপ ডাউনলোড</a></div></div></div></div>`);
    root.querySelector('[data-site]').onsubmit = async e => { e.preventDefault(); await saveSetting('site', { ...s, ...readFields(e.target, F) }); };
    root.querySelector('[data-areas]').onsubmit = async e => { e.preventDefault(); await saveSetting('areas', e.target.areas.value.split('\n').map(x => x.trim()).filter(Boolean)); };
  };

  pages.admins = async () => {
    const admins = await api('/admin/admins');
    shell('admins', 'অ্যাডমিন ও নিরাপত্তা', `<button class="btn" data-addadmin>${icon('plus', 18)}নতুন অ্যাডমিন</button>`, `<div class="split">
      <div class="card"><h3>অ্যাডমিন অ্যাকাউন্ট</h3>${admins.map(a => `<div class="item"><span class="thumb" style="--c:#0e9f6e">${icon('user', 20)}</span><div class="body"><b>${esc(a.username)}${a.username === S.me.username ? ' <span class="tag ok">আপনি</span>' : ''}</b><small>যোগ হয়েছে ${date(a.created_at)}</small></div>
        ${a.username !== S.me.username ? `<button class="iconbtn red" data-deladmin="${a.id}" title="মুছুন">${icon('trash', 18)}</button>` : ''}</div>`).join('')}</div>
      <form class="card" data-pw><h3>পাসওয়ার্ড পরিবর্তন</h3><div class="cbody form">
        <label class="field"><span>বর্তমান পাসওয়ার্ড</span><input type="password" name="current" required autocomplete="current-password"></label>
        <label class="field"><span>নতুন পাসওয়ার্ড</span><input type="password" name="new" required minlength="8" autocomplete="new-password"><em>কমপক্ষে ৮ অক্ষর</em></label>
        <div><button class="btn">${icon('lock', 18)}পরিবর্তন করুন</button></div></div></form></div>`);
    root.querySelector('[data-pw]').onsubmit = async e => { e.preventDefault(); await run(() => api('/admin/password', { current: e.target.current.value, new: e.target.new.value }), 'পাসওয়ার্ড পরিবর্তন হয়েছে'); e.target.reset(); };
  };

  /* ---------------- router ---------------- */
  async function route() {
    if (!S.me) return renderLogin();
    const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
    const parts = path.split('/'), p = new URLSearchParams(query);
    let name = parts[0] || 'dashboard', params = [];
    if (name === 'listings' && parts[1]) { name = 'edit'; params = [parts[1]]; }
    if (!pages[name]) name = 'dashboard';
    try { await pages[name](params, p); } catch (e) { if (S.me) toast(e.message, true); }
    document.title = `${TITLES[name] || 'অ্যাডমিন'} · Jashore360`;
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  const refreshList = async () => { S.listings = await api('/admin/listings'); };

  /* ---------------- events ---------------- */
  document.addEventListener('click', async e => {
    const b = e.target.closest('button, [data-menu]'); if (!b) return;
    const d = b.dataset;
    if ('menu' in d) return root.querySelector('.shell').classList.toggle('open');
    if ('logout' in d) { await api('/admin/logout', {}); S.me = null; return renderLogin(); }
    if (d.togglehide) {
      const l = S.listings.find(x => x.id === d.togglehide);
      await run(() => api('/admin/listings/' + l.id, { ...l, hidden: !l.hidden }, 'PUT'), l.hidden ? 'অ্যাপে দেখানো হচ্ছে' : 'লুকানো হয়েছে');
      await refreshList(); return route();
    }
    if (d.dellisting) {
      const l = S.listings.find(x => x.id === d.dellisting);
      if (!confirm(`"${l?.name}" এবং এর সব রিভিউ মুছে যাবে। নিশ্চিত?`)) return;
      await run(() => api('/admin/listings/' + d.dellisting, undefined, 'DELETE'), 'মুছে ফেলা হয়েছে');
      await refreshList(); if (location.hash.startsWith('#/listings/')) location.hash = '#/listings'; else route(); return;
    }
    if ('deldemo' in d) {
      const demo = S.listings.filter(l => l.demo);
      if (!confirm(`${bn(demo.length)}টি নমুনা তথ্য মুছে যাবে। নিশ্চিত?`)) return;
      for (const l of demo) await api('/admin/listings/' + l.id, undefined, 'DELETE');
      toast('সব নমুনা তথ্য মুছে ফেলা হয়েছে'); await refreshList(); location.hash = '#/listings'; return;
    }
    if (d.approve || d.reject) {
      await run(() => api(`/admin/listings/${d.approve || d.reject}/review`, { review: d.approve ? 'approved' : 'rejected', verified: !!d.verified }), d.approve ? 'প্রকাশিত হয়েছে' : 'বাতিল করা হয়েছে');
      await refreshList(); return route();
    }
    if (d.hiderv) {
      await run(() => api('/admin/reviews/' + d.hiderv, { hidden: d.h === '1' }, 'PUT'), d.h === '1' ? 'রিভিউ লুকানো হয়েছে' : 'রিভিউ দেখানো হচ্ছে');
      [S.reviews, S.reports] = await Promise.all([api('/admin/reviews'), api('/admin/reports')]); return route();
    }
    if (d.delrv) {
      if (!confirm('রিভিউটি স্থায়ীভাবে মুছে যাবে। নিশ্চিত?')) return;
      await run(() => api('/admin/reviews/' + d.delrv, undefined, 'DELETE'), 'মুছে ফেলা হয়েছে');
      S.reviews = await api('/admin/reviews'); return route();
    }
    if (d.reply) {
      const r = S.reviews.find(x => x.id === d.reply);
      return modal('রিভিউয়ের উত্তর', `<p class="muted" style="margin:0">"${esc(r.text || '')}"</p><label class="field"><span>উত্তর</span><textarea name="reply" rows="4">${esc(r.reply || '')}</textarea><em>অ্যাপে "Jashore360 টিম / প্রতিষ্ঠানের উত্তর" হিসেবে দেখাবে। খালি রাখলে উত্তর সরে যাবে।</em></label>`, async f => {
        await run(() => api('/admin/reviews/' + r.id, { reply: f.reply.value }, 'PUT'), 'উত্তর সংরক্ষণ হয়েছে'); S.reviews = await api('/admin/reviews'); route();
      });
    }
    if (d.resolve) { await run(() => api('/admin/reports/' + d.resolve, { done: d.d === '1' }, 'PUT')); S.reports = await api('/admin/reports'); return route(); }
    if (d.colnew) return editCollection(d.colnew);
    if (d.coledit) { const [k, i] = d.coledit.split('|'); return editCollection(k, +i); }
    if (d.coltoggle) { const [k, i] = d.coltoggle.split('|'); const next = S.settings[k].map((x, n) => n === +i ? { ...x, active: x.active === false } : x); await saveSetting(k, next); return route(); }
    if (d.coldel) {
      const [k, i] = d.coldel.split('|');
      if (!confirm('মুছে ফেলবেন?')) return;
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
      return modal('নতুন অ্যাডমিন', `<label class="field"><span>ইউজারনেম</span><input name="username" required pattern="[a-z0-9_.\\-]{3,30}"><em>ইংরেজি ছোট হাতের অক্ষর/সংখ্যা</em></label>
        <label class="field"><span>পাসওয়ার্ড</span><input name="password" type="password" required minlength="8"></label>`, async f => {
        await run(() => api('/admin/admins', { username: f.username.value, password: f.password.value }), 'অ্যাডমিন যোগ হয়েছে'); route();
      }, 'যোগ করুন');
    }
    if (d.deladmin) { if (!confirm('এই অ্যাডমিন মুছে যাবে। নিশ্চিত?')) return; await run(() => api('/admin/admins/' + d.deladmin, undefined, 'DELETE'), 'মুছে ফেলা হয়েছে'); return route(); }
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
        try { toast('ছবি আপলোড হচ্ছে…'); f._images.push(await upload(file)); drawImgs(f); } catch (er) { toast(er.message, true); }
      }
      toast('ছবি যোগ হয়েছে'); return;
    }
    if (el.matches('[data-single]')) {
      const box = el.closest('.imgupload');
      try { toast('ছবি আপলোড হচ্ছে…'); const url = await upload(el.files[0]); box.querySelector('input[type=hidden]').value = url; box.querySelector('.pv').style.backgroundImage = `url('${url}')`; toast('আপলোড হয়েছে'); }
      catch (er) { toast(er.message, true); }
    }
  });

  document.addEventListener('paste', e => {
    const el = e.target;
    if (!el.matches?.('[data-latlng]')) return;
    const m = (e.clipboardData.getData('text') || '').match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (m) { e.preventDefault(); el.value = m[1]; el.form.elements.lng.value = m[2]; toast('অবস্থান বসানো হয়েছে'); }
  });

  document.addEventListener('submit', async e => {
    const f = e.target;
    if (f.matches('[data-filter]')) { e.preventDefault(); f.querySelector('select').dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (!f.matches('[data-edit]')) return;
    e.preventDefault();
    const id = f.dataset.edit, body = readListing(f), btn = e.submitter;
    if (btn?.name === 'approve') body._review = 'approved';
    btn && (btn.disabled = true);
    try {
      if (id) await api('/admin/listings/' + id, body, 'PUT'); else await api('/admin/listings', body);
      toast('সংরক্ষণ হয়েছে'); await refreshList(); location.hash = '#/listings';
    } catch (er) { toast(er.message, true); btn && (btn.disabled = false); }
  });

  /* ---------------- boot ---------------- */
  async function boot() {
    try { S.me = await api('/admin/me'); } catch { return; }
    await load(true);
    route();
  }
  boot();
})();
