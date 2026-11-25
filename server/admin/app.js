// Tadbeer Daily — admin panel (vanilla JS, same-origin with the API).
'use strict';

const $ = (s) => document.querySelector(s);
const BN = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const bn = (v) => String(v).replace(/\d/g, (d) => BN[Number(d)]);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ── session (sessionStorage: cleared when the tab closes) ─────────────────
const store = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* ignore */ } },
};
let access = store.get('adm.access');
let refresh = store.get('adm.refresh');
const setTokens = (a, r) => { access = a; refresh = r; store.set('adm.access', a); store.set('adm.refresh', r); };

async function call(path, opts = {}, retry = true) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(access ? { authorization: `Bearer ${access}` } : {}), ...(opts.headers || {}) },
  });
  if (res.status === 401 && retry && refresh) {
    const r = await fetch('/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: refresh }) });
    if (r.ok) {
      const t = await r.json();
      setTokens(t.accessToken, t.refreshToken);
      return call(path, opts, false);
    }
    setTokens(null, null);
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(body?.error || 'http_error'), { status: res.status, code: body?.error });
  return body;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

// ── login ─────────────────────────────────────────────────────────────────
const ERR = {
  invalid_credentials: 'ইমেইল বা পাসওয়ার্ড ভুল',
  not_admin: 'এই অ্যাকাউন্টের অ্যাডমিন অনুমতি নেই',
  account_disabled: 'অ্যাকাউন্টটি বন্ধ করা আছে',
  email_taken: 'এই ইমেইলে আগেই অ্যাকাউন্ট আছে, লগইন করুন',
  rate_limited: 'অনেকবার চেষ্টা হয়েছে, এক মিনিট পরে আবার চেষ্টা করুন',
  validation_error: 'তথ্য সঠিক নয় (পাসওয়ার্ড কমপক্ষে ৮ অক্ষর)',
};
let registering = false;

function showLogin(msg) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-error').textContent = msg || '';
}

$('#toggle-register').addEventListener('click', () => {
  registering = !registering;
  $('#name-row').hidden = !registering;
  $('#login-btn').textContent = registering ? 'অ্যাকাউন্ট খুলুন' : 'লগইন';
  $('#toggle-register').textContent = registering ? 'অ্যাকাউন্ট আছে? লগইন করুন' : 'অ্যাকাউন্ট নেই? নতুন অ্যাকাউন্ট খুলুন';
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = $('#login-btn');
  btn.disabled = true;
  $('#login-error').textContent = '';
  try {
    const path = registering ? '/v1/auth/register' : '/v1/auth/login';
    const body = { email: f.get('email'), password: f.get('password'), ...(registering ? { name: f.get('name') || '' } : {}) };
    const r = await call(path, { method: 'POST', body: JSON.stringify(body) }, false);
    setTokens(r.accessToken, r.refreshToken);
    store.set('adm.email', r.user.email);
    await start();
  } catch (err) {
    $('#login-error').textContent = ERR[err.code] || 'সংযোগে সমস্যা, আবার চেষ্টা করুন';
  } finally {
    btn.disabled = false;
  }
});

$('#logout').addEventListener('click', async () => {
  if (refresh) await call('/v1/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: refresh }) }, false).catch(() => null);
  setTokens(null, null);
  showLogin();
});

// ── dashboard ─────────────────────────────────────────────────────────────
const fmtDate = (s) => (s ? bn(new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })) : '—');
function ago(s) {
  if (!s) return 'কখনো না';
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return 'এইমাত্র';
  if (m < 60) return `${bn(m)} মিনিট আগে`;
  const h = Math.round(m / 60);
  if (h < 24) return `${bn(h)} ঘণ্টা আগে`;
  return `${bn(Math.round(h / 24))} দিন আগে`;
}
const bytes = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);
const LABELS = { amals: 'আমল', tasks: 'কাজ', reminders: 'রিমাইন্ডার', medicines: 'ওষুধ', routines: 'রুটিন', logs: 'দৈনিক লগ' };

async function loadStats() {
  const s = await call('/v1/admin/stats');
  const u = s.users;
  const cards = [
    ['মোট ব্যবহারকারী', u.total, '👥', 'hero'],
    ['আজ নতুন', u.new_1d, '✨', '', 'var(--primary-soft)'],
    ['৭ দিনে নতুন', u.new_7d, '📈', '', 'var(--lav-soft)'],
    ['৩০ দিনে নতুন', u.new_30d, '🗓️', '', 'var(--gold-soft)'],
    ['২৪ ঘণ্টায় সক্রিয়', u.active_1d, '⚡', '', 'var(--success-soft)'],
    ['৭ দিনে সক্রিয়', u.active_7d, '🔥', '', 'var(--primary-soft)'],
    ['বন্ধ অ্যাকাউন্ট', u.disabled, '⛔', '', 'var(--danger-soft)'],
  ];
  $('#stats').innerHTML = cards
    .map(([l, v, ic, cls, bg]) => `<div class="stat ${cls}"><div class="ic" style="background:${bg || 'rgba(255,255,255,.12)'}">${ic}</div><div class="v">${bn(v)}</div><div class="l">${l}</div></div>`)
    .join('');

  const max = Math.max(1, ...s.signups.map((d) => d.n));
  const today = s.signups[s.signups.length - 1]?.day;
  $('#chart').innerHTML = s.signups
    .map((d) => `<div class="bar ${d.day === today ? 'today' : ''}" data-tip="${bn(d.day.slice(5))}: ${bn(d.n)}"><i style="height:${(d.n / max) * 100}%"></i></div>`)
    .join('');

  const up = s.server.uptimeSec;
  $('#server').innerHTML = [
    ['ডেটাবেসের আকার', bytes(s.server.dbBytes)],
    ['সার্ভার চালু আছে', up >= 86400 ? `${bn(Math.floor(up / 86400))} দিন` : up >= 3600 ? `${bn(Math.floor(up / 3600))} ঘণ্টা` : `${bn(Math.max(1, Math.floor(up / 60)))} মিনিট`],
    ['মেমরি', `${bn(s.server.memoryMb)} MB`],
    ['Node', s.server.node],
  ].map(([k, v]) => `<li><span class="muted">${k}</span><b>${esc(v)}</b></li>`).join('');

  const rec = Object.entries(LABELS).map(([k, l]) => `<li><span class="muted">${l}</span><b>${bn(s.records[k] || 0)}</b></li>`);
  $('#records').innerHTML = rec.join('');
  $('#health').className = 'pill ok';
  $('#health').textContent = '● চালু';
}

let page = 1;
let query = '';
async function loadUsers() {
  const r = await call(`/v1/admin/users?page=${page}&q=${encodeURIComponent(query)}`);
  const me = store.get('adm.email');
  $('#users').innerHTML = r.users.length
    ? r.users
        .map((x) => {
          const self = x.email === me;
          const status = x.disabled ? '<span class="tag off">বন্ধ</span>' : '<span class="tag on">সক্রিয়</span>';
          const admin = x.admin ? ' <span class="tag admin">অ্যাডমিন</span>' : '';
          const last = [x.last_sync_at, x.last_login_at].filter(Boolean).sort().pop();
          const acts = self
            ? '<span class="muted">(আপনি)</span>'
            : `${x.disabled
                ? `<button class="btn ghost small" data-act="enable" data-id="${x.id}">চালু করুন</button>`
                : `<button class="btn ghost small" data-act="disable" data-id="${x.id}">বন্ধ করুন</button>`}
               <button class="btn ghost small" data-act="logout" data-id="${x.id}">লগআউট</button>
               <button class="btn danger small" data-act="delete" data-id="${x.id}" data-email="${esc(x.email)}">মুছুন</button>`;
          return `<tr>
            <td><div class="user"><span class="avatar">${esc((x.name || x.email)[0].toUpperCase())}</span><div>${esc(x.name || '—')}<small>${esc(x.email)}</small></div></div></td>
            <td>${fmtDate(x.created_at)}</td>
            <td>${ago(last)}</td>
            <td>${bn(x.records)}</td>
            <td>${status}${admin}</td>
            <td><div class="actions">${acts}</div></td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="6" class="muted" style="text-align:center;padding:30px">কোনো ব্যবহারকারী পাওয়া যায়নি</td></tr>';
  const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
  $('#page').textContent = `পৃষ্ঠা ${bn(page)} / ${bn(pages)} · মোট ${bn(r.total)}`;
  $('#prev').disabled = page <= 1;
  $('#next').disabled = page >= pages;
}

$('#users').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const { act, id, email } = b.dataset;
  const confirmText = {
    disable: 'এই অ্যাকাউন্ট বন্ধ করবেন? ব্যবহারকারী লগইন বা সিঙ্ক করতে পারবেন না (ফোনের অফলাইন ডেটা থাকবে)।',
    logout: 'সব ডিভাইস থেকে লগআউট করাবেন?',
    delete: `"${email}" অ্যাকাউন্ট ও সার্ভারের সব ব্যাকআপ স্থায়ীভাবে মুছে যাবে। নিশ্চিত?`,
  }[act];
  if (confirmText && !confirm(confirmText)) return;
  b.disabled = true;
  try {
    await call(act === 'delete' ? `/v1/admin/users/${id}` : `/v1/admin/users/${id}/${act}`, { method: act === 'delete' ? 'DELETE' : 'POST' });
    toast({ disable: 'অ্যাকাউন্ট বন্ধ করা হয়েছে', enable: 'অ্যাকাউন্ট চালু হয়েছে', logout: 'সব ডিভাইস থেকে লগআউট হয়েছে', delete: 'অ্যাকাউন্ট মুছে ফেলা হয়েছে' }[act]);
    await Promise.all([loadUsers(), loadStats()]);
  } catch (err) {
    toast(err.code === 'cannot_modify_self' ? 'নিজের অ্যাকাউন্টে এটা করা যায় না' : 'ব্যর্থ হয়েছে');
    b.disabled = false;
  }
});

$('#search').addEventListener('submit', (e) => {
  e.preventDefault();
  query = new FormData(e.target).get('q') || '';
  page = 1;
  void loadUsers().catch(onError);
});
$('#prev').addEventListener('click', () => { page--; void loadUsers().catch(onError); });
$('#next').addEventListener('click', () => { page++; void loadUsers().catch(onError); });
$('#refresh').addEventListener('click', () => { void refreshAll(); toast('হালনাগাদ হয়েছে'); });

function onError(err) {
  if (err.status === 401) return showLogin('সেশন শেষ, আবার লগইন করুন');
  if (err.status === 403) return showLogin(ERR[err.code] || ERR.not_admin);
  $('#health').className = 'pill bad';
  $('#health').textContent = '● সংযোগ নেই';
}

// ── banners ───────────────────────────────────────────────────────────────
let banners = [];
let editing = null; // banner id or 'new'
let mode = 'image';
const form = $('#banner-form');

function bannerHtml(b) {
  if (b.imageUrl) return `<div class="bimg ${b.active === false ? 'off' : ''}"><img src="${esc(b.imageUrl)}" alt=""></div>`;
  if (mode === 'image' && !b.body) return '<div class="bimg" style="display:grid;place-items:center;color:var(--muted)">ছবি আপলোড করলে এখানে দেখাবে</div>';
  const cta = b.ctaLabel ? `<span class="bcta">${esc(b.ctaLabel)} →</span>` : '';
  return `<div class="bcard t-${esc(b.theme)} ${b.active === false ? 'off' : ''}">
    ${b.tag ? `<span class="btag">${esc(b.tag)}</span>` : ''}
    ${b.arabic ? `<div class="bar" dir="rtl">${esc(b.arabic)}</div>` : ''}
    <div class="bbody">${esc(b.body || 'আপনার লেখা এখানে দেখাবে')}</div>
    ${b.source ? `<div class="bsrc">— ${esc(b.source)}</div>` : ''}${cta}
  </div>`;
}

async function loadBanners() {
  banners = (await call('/v1/admin/banners')).banners;
  $('#banner-list').innerHTML = banners.length
    ? banners.map((b) => `<div>${bannerHtml(b)}<div class="bmeta">
        <button class="btn ghost small" data-bact="edit" data-id="${b.id}">এডিট</button>
        <button class="btn ghost small" data-bact="toggle" data-id="${b.id}">${b.active ? 'বন্ধ করুন' : 'চালু করুন'}</button>
        <button class="btn danger small" data-bact="delete" data-id="${b.id}">মুছুন</button></div></div>`).join('')
    : '<div class="empty">এখনো কোনো ব্যানার নেই। অ্যাপ নিজের তৈরি আয়াত-হাদিসের ব্যানার দেখাচ্ছে।</div>';
}

const toLocal = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const fromLocal = (v) => (v ? new Date(v).toISOString() : null);

function readForm() {
  const f = new FormData(form);
  const route = f.get('ctaRoute');
  return {
    imageUrl: mode === 'image' ? f.get('imageUrl') || '' : '',
    tag: f.get('tag') || '', arabic: f.get('arabic') || '', body: mode === 'text' ? f.get('body') || '' : '', source: f.get('source') || '',
    theme: f.get('theme'), sort: Number(f.get('sort') || 0), ctaLabel: f.get('ctaLabel') || '',
    ctaUrl: route === 'custom' ? (f.get('ctaUrl') || '') : route || '',
    active: !!f.get('active'), startsAt: fromLocal(f.get('startsAt')), endsAt: fromLocal(f.get('endsAt')),
  };
}
function preview() { $('#banner-preview').innerHTML = bannerHtml(readForm()); $('#cta-url-row').hidden = form.ctaRoute.value !== 'custom'; }

function setMode(m) {
  mode = m;
  document.querySelectorAll('.mode-btn').forEach((x) => x.classList.toggle('on', x.dataset.mode === m));
  $('#image-fields').hidden = m !== 'image';
  $('#text-fields').hidden = m !== 'text';
  $('#theme-row').hidden = m !== 'text';
  $('#cta-label-row').hidden = m !== 'text';
  preview();
}
document.querySelectorAll('.mode-btn').forEach((x) => x.addEventListener('click', () => setMode(x.dataset.mode)));

async function upload(file) {
  const st = $('#upload-status');
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { st.textContent = 'শুধু JPG, PNG বা WebP ছবি দিন'; return; }
  if (file.size > 3 * 1024 * 1024) { st.textContent = 'ছবিটি ৩ MB-এর বেশি — একটু ছোট করে দিন'; return; }
  st.textContent = 'আপলোড হচ্ছে…';
  const fd = new FormData();
  fd.append('file', file);
  const send = () => fetch('/v1/admin/uploads', { method: 'POST', body: fd, headers: access ? { authorization: `Bearer ${access}` } : {} });
  let res = await send();
  if (res.status === 401 && refresh) { await call('/v1/admin/me').catch(() => null); res = await send(); }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { st.textContent = out.error === 'unsupported_image' ? 'এটি সঠিক ছবি ফাইল নয়' : 'আপলোড হয়নি, আবার চেষ্টা করুন'; return; }
  form.imageUrl.value = out.url;
  const img = new Image();
  img.onload = () => {
    const r = img.naturalWidth / img.naturalHeight;
    st.textContent = Math.abs(r - 2) > 0.25
      ? `✓ আপলোড হয়েছে (${img.naturalWidth}×${img.naturalHeight})। মাপ ২:১ না হওয়ায় কিনারা একটু কেটে যেতে পারে।`
      : `✓ আপলোড হয়েছে (${img.naturalWidth}×${img.naturalHeight})`;
  };
  img.src = out.url;
  preview();
}
const drop = $('#drop');
$('#file').addEventListener('change', (e) => e.target.files[0] && upload(e.target.files[0]));
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); });

function openForm(b) {
  editing = b ? b.id : 'new';
  form.reset();
  form.imageUrl.value = b?.imageUrl || '';
  $('#upload-status').textContent = '';
  if (b) {
    for (const k of ['tag', 'arabic', 'body', 'source', 'theme', 'sort', 'ctaLabel']) form[k].value = b[k] ?? '';
    const internal = [...form.ctaRoute.options].some((o) => o.value === b.ctaUrl);
    form.ctaRoute.value = !b.ctaUrl ? '' : internal ? b.ctaUrl : 'custom';
    form.ctaUrl.value = internal ? '' : b.ctaUrl;
    form.active.checked = b.active;
    form.startsAt.value = toLocal(b.startsAt);
    form.endsAt.value = toLocal(b.endsAt);
  }
  $('#banner-error').textContent = '';
  form.hidden = false;
  setMode(b && !b.imageUrl ? 'text' : 'image');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#banner-new').addEventListener('click', () => openForm(null));
$('#banner-cancel').addEventListener('click', () => { form.hidden = true; editing = null; });
form.addEventListener('input', preview);
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = readForm();
  try {
    if (editing === 'new') await call('/v1/admin/banners', { method: 'POST', body: JSON.stringify(body) });
    else await call(`/v1/admin/banners/${editing}`, { method: 'PUT', body: JSON.stringify(body) });
    form.hidden = true; editing = null;
    toast('ব্যানার সংরক্ষণ হয়েছে');
    await loadBanners();
  } catch (err) {
    $('#banner-error').textContent = err.code === 'validation_error' ? (mode === 'image' ? 'আগে একটি ছবি আপলোড করুন (লিংক দিলে https:// দিয়ে শুরু হতে হবে)' : 'মূল লেখা দিন (লিংক দিলে https:// দিয়ে শুরু হতে হবে)') : 'সংরক্ষণ হয়নি';
  }
});
$('#banner-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-bact]');
  if (!btn) return;
  const b = banners.find((x) => x.id === btn.dataset.id);
  if (!b) return;
  if (btn.dataset.bact === 'edit') return openForm(b);
  if (btn.dataset.bact === 'delete') {
    if (!confirm('ব্যানারটি মুছে ফেলবেন?')) return;
    await call(`/v1/admin/banners/${b.id}`, { method: 'DELETE' });
    toast('মুছে ফেলা হয়েছে');
  } else {
    const { id: _i, updatedAt: _u, ...rest } = b;
    await call(`/v1/admin/banners/${b.id}`, { method: 'PUT', body: JSON.stringify({ ...rest, active: !b.active }) });
    toast(b.active ? 'বন্ধ করা হয়েছে' : 'চালু হয়েছে');
  }
  await loadBanners();
});

// ── notifications ─────────────────────────────────────────────────────────
const nform = $('#notify-form');
const npreview = () => {
  $('#pn-title').textContent = nform.title.value || 'শিরোনাম';
  $('#pn-body').textContent = nform.body.value || 'বার্তা';
};
nform.addEventListener('input', npreview);

async function loadAnnouncements() {
  const r = await call('/v1/admin/announcements');
  $('#push-devices').textContent = `পুশ-চালু ডিভাইস: ${bn(r.pushDevices)}`;
  $('#sent-list').innerHTML = r.announcements.length
    ? r.announcements.map((a) => `<li><div><b>${esc(a.title)}</b><small>${esc(a.body)}</small><small>${ago(a.createdAt)}</small></div>
        <button class="btn ghost small" data-aid="${a.id}">মুছুন</button></li>`).join('')
    : '<li class="muted">এখনো কোনো নোটিফিকেশন পাঠানো হয়নি</li>';
}

nform.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(nform);
  const body = { title: f.get('title'), body: f.get('body') || '', url: f.get('url') || '' };
  if (!confirm(`"${body.title}" — সব ব্যবহারকারীকে পাঠাবেন?`)) return;
  $('#notify-send').disabled = true;
  $('#notify-error').textContent = '';
  try {
    await call('/v1/admin/announcements', { method: 'POST', body: JSON.stringify(body) });
    nform.reset(); npreview();
    toast('নোটিফিকেশন পাঠানো হয়েছে');
    await loadAnnouncements();
  } catch (err) {
    $('#notify-error').textContent = 'পাঠানো যায়নি — শিরোনাম দিন';
  } finally {
    $('#notify-send').disabled = false;
  }
});
$('#sent-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-aid]');
  if (!b || !confirm('তালিকা থেকে মুছবেন? (যাদের ফোনে আগেই পৌঁছেছে, তাদের থেকে মুছবে না)')) return;
  await call(`/v1/admin/announcements/${b.dataset.aid}`, { method: 'DELETE' });
  await loadAnnouncements();
});

const refreshAll = () => Promise.all([loadStats(), loadUsers(), loadBanners(), loadAnnouncements()]).catch(onError);

async function start() {
  if (!access && !refresh) return showLogin();
  try {
    await call('/v1/admin/me');
  } catch (err) {
    return onError(err);
  }
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = store.get('adm.email') || '';
  await refreshAll();
}

setInterval(() => { if (!$('#app').hidden) void loadStats().catch(onError); }, 60_000);
void start();
