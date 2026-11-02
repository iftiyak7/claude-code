/* Settings kept as lists: ads, announcements, categories, plans, popup; forms and modals. */
import { pages } from './dashboard.js';
import { catName, catOf, cats, empty, load } from './data.js';
import { route } from './router.js';
import { shell } from './shell.js';
import { S, T, api, compact, day, esc, money, num, root, run, toast } from './util.js';

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
const PLACEMENTS = [['home', 'হোমপেজ স্লাইডার'], ['inline', 'হোমপেজের মাঝে'], ['category', 'ক্যাটাগরি পেজের উপরে'], ['list', 'তালিকা ও সার্চের ফলাফলের মাঝে'],
  ['detail', 'প্রতিষ্ঠানের পেজে (বিবরণের নিচে)'], ['offers', 'অফার ও কুপন পেজের উপরে'], ['classifieds', 'চাকরি/ভাড়া পেজের উপরে']];
const COLS = {
  ads: {
    addLabel: 'নতুন বিজ্ঞাপন', intro: 'অ্যাপের বিজ্ঞাপনের জায়গাগুলো শুধু মূল অ্যাডমিন নিয়ন্ত্রণ করেন। বিজ্ঞাপনদাতার নাম, মেয়াদ ও কোথায় দেখাবে ঠিক করুন — ভিউ ও ক্লিক নিজে থেকেই গোনা হয়। পেইড প্রচারে উপরের ছোট লেখায় "Sponsored" দিন।',
    preview: b => b.image && b.layout === 'full' ? `<span class="bprev full" style="background-image:url('${esc(b.image)}')"></span>`
      : `<span class="bprev ${esc(b.theme || 'dark')}" style="${b.image ? `background-image:linear-gradient(90deg,rgba(15,27,45,.85),rgba(15,27,45,.2)),url('${esc(b.image)}')` : ''}">${esc(b.title)}</span>`,
    title: b => b.title, sub: (b, st) => {
      const s = st?.[b.id] || { imps: 0, clicks: 0 }, ctr = s.imps ? (s.clicks / s.imps * 100).toFixed(1) : 0, t = new Date().toISOString().slice(0, 10);
      const expired = b.end && b.end < t, notyet = b.start && b.start > t;
      return `${T((PLACEMENTS.find(p => p[0] === (b.placement || 'home')) || [])[1] || '')}${b.category ? ' · ' + esc(catName(catOf(b.category))) : ''}${b.areas?.length ? ' · ' + icon('pin', 12) + ' ' + esc(b.areas.join(', ')) : ''} · ${esc(b.advertiser || '—')}
        · ${b.start || b.end ? esc([day(b.start), day(b.end)].filter(Boolean).join(' → ')) : T('মেয়াদ নেই')}
        <br><span class="tag">${T('{n} ভিউ', { n: compact(s.imps) })}</span> <span class="tag">${T('{n} ক্লিক', { n: compact(s.clicks) })}</span> <span class="tag">CTR ${num(ctr)}%</span>
        ${b.active === false ? ` <span class="tag">${T('বন্ধ')}</span>` : expired ? ` <span class="tag bad">${T('মেয়াদ শেষ')}</span>` : notyet ? ` <span class="tag warn">${T('শুরু হয়নি')}</span>` : ` <span class="tag ok">${T('চলছে')}</span>`}`;
    },
    stats: () => api('/admin/adstats'),
    before: () => { const s = S.settings.site || {}; return `<form class="card" data-slidecfg><div class="cbody slidecfg"><span class="thumb" style="--c:#0e9f6e">${icon('layers', 20)}</span>
      <div><b>${T('হোমপেজ স্লাইডার')}</b><small class="muted">${T('একাধিক ব্যানার থাকলে নিজে থেকে পরেরটায় যাবে। কেউ হাত দিয়ে সরালে কিছুক্ষণ থেমে থাকবে।')}</small></div>
      <label class="check"><input type="checkbox" name="bannerAuto" ${s.bannerAuto !== false ? 'checked' : ''}><span>${T('অটো স্লাইড')}</span></label>
      <select name="bannerSeconds">${[3, 4, 5, 6, 8, 10].map(n => `<option value="${n}" ${(+s.bannerSeconds || 5) === n ? 'selected' : ''}>${T('প্রতি {n} সেকেন্ডে', { n: num(n) })}</option>`).join('')}</select></div></form>`; },
    mounted: () => {
      const f = root.querySelector('[data-slidecfg]');
      f.onsubmit = e => e.preventDefault();
      f.onchange = () => saveSetting('site', { ...S.settings.site, bannerAuto: f.bannerAuto.checked, bannerSeconds: +f.bannerSeconds.value });
    },
    fields: () => [['placement', 'select', 'কোথায় দেখাবে', '', PLACEMENTS], ['category', 'select', 'ক্যাটাগরি', 'ক্যাটাগরি পেজ, তালিকার মাঝে ও প্রতিষ্ঠানের পেজে — শুধু এই ক্যাটাগরিতে দেখাবে', [['', '— সব —'], ...cats().map(c => [c.id, catName(c)])]],
      ['areas', 'multi', 'কোন এলাকার মানুষ দেখবে', 'কিছু না বাছলে সবাই দেখবে। বাছলে শুধু যারা অ্যাপে সেই এলাকা বেছেছেন (বা লোকেশন কাছাকাছি) তারা দেখবেন — এলাকার দোকানের বিজ্ঞাপনের জন্য ভালো। "যশোর সদর" বাছলে শহরের সব এলাকা।', (S.settings.areas || []).map(a => [a, a])],
      ['advertiser', 'text', 'বিজ্ঞাপনদাতা', 'প্রতিষ্ঠানের নাম ও ফোন — শুধু আপনার রেকর্ডের জন্য'], ['kicker', 'text', 'উপরের ছোট লেখা', 'যেমন: Sponsored, সীমিত অফার'],
      ['title', 'text', 'শিরোনাম *'], ['titleEn', 'text', 'শিরোনাম (English)'], ['subtitle', 'text', 'বিবরণ'], ['subtitleEn', 'text', 'বিবরণ (English)'],
      ['cta', 'text', 'বাটনের লেখা', 'যেমন: দেখুন'], ['ctaEn', 'text', 'বাটনের লেখা (English)'],
      ['link', 'text', 'লিংক', '#/p/আইডি, #/c/restaurant, tel:01XXXXXXXXX বা https://…'],
      ['layout', 'select', 'ধরন', '', [['card', 'রং + লেখা (ছবি থাকলে ডান পাশে)'], ['full', 'পুরো ব্যানার জুড়ে শুধু ছবি'], ['fulltext', 'পুরো ব্যানার জুড়ে ছবি, উপরে লেখা']]],
      ['image', 'image', 'ছবি', 'পুরো ব্যানারের জন্য চওড়া ছবি দিন — ১২০০×৫০০ পিক্সেল (১২:৫) সবচেয়ে ভালো দেখায়। লেখা ছবিতেই থাকলে "শুধু ছবি" বাছুন।'],
      ['theme', 'select', 'রং (ছবি ছাড়া ব্যানারে)', '', [['dark', 'গাঢ় নীল'], ['brand', 'সবুজ'], ['accent', 'কমলা'], ['danger', 'লাল']]],
      ['start', 'date0', 'শুরুর তারিখ'], ['end', 'date0', 'শেষের তারিখ', 'খালি রাখলে মেয়াদ নেই']]
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
      ['freeSubs', 'list', 'ফ্রি ধরন (আইডি, কমা দিয়ে)', 'যেমন: govt, bloodbank'], ['near', 'check', 'লোকেশন থাকলে কাছেরগুলো আগে দেখান (যেমন মসজিদ, হাসপাতাল)'],
      ['keys', 'list', 'সার্চ কীওয়ার্ড', 'কমা দিয়ে: hospital, হাসপাতাল, hashpatal'], ['criteria', 'list', 'রেটিংয়ের মানদণ্ড', 'কমা দিয়ে: খাবারের মান, পরিচ্ছন্নতা, সার্ভিস']]
  },
  plans: {
    addLabel: 'নতুন প্যাকেজ', noToggle: true, intro: 'পেইড ক্যাটাগরিতে ব্যবসা যুক্ত করতে ব্যবসায়ীরা এই প্যাকেজগুলো থেকে বেছে নেন। "জনপ্রিয়" প্যাকেজের তালিকা হোমপেজে আগে দেখায়।',
    preview: p => `<span class="thumb" style="--c:${p.featured ? '#7c5cff' : '#0e9f6e'}">${icon('tag', 20)}</span>`,
    title: p => `${p.bn} · ${money(p.price)}`, sub: p => `${T('{n} দিন', { n: num(p.days) })} · ${esc((p.perks || []).join(', '))}${p.featured ? ` · <span class="tag ad">${T('হোমে জনপ্রিয়')}</span>` : ''}`,
    fields: () => [['id', 'text', 'আইডি *', 'ইংরেজি ছোট হাতের, যেমন: basic'], ['bn', 'text', 'নাম (বাংলা) *'], ['en', 'text', 'নাম (English)'],
      ['price', 'number', 'দাম (৳) *'], ['days', 'number', 'মেয়াদ (দিন)', 'যেমন ৩৬৫ = এক বছর'], ['featured', 'check', 'এই প্যাকেজের তালিকা হোমপেজে "জনপ্রিয়" অংশে দেখাবে'],
      ['sponsored', 'check', 'Sponsored — প্যাকেজের মেয়াদ পর্যন্ত সব তালিকা ও সার্চের সবার উপরে, হোমপেজের "প্রচারিত" অংশে'],
      ['perks', 'list', 'সুবিধাগুলো (কমা দিয়ে)'], ['perksEn', 'list', 'সুবিধাগুলো (English)']],
    after: () => paymentForm()
  }
};
function paymentForm() {
  const p = S.settings.payment || {};
  return `<form class="card" data-paysettings style="margin-top:16px"><h3>${T('পেমেন্ট নম্বর')}</h3><div class="cbody form">
    <p class="muted" style="margin:0">${T('ব্যবসায়ীরা এই নম্বরে টাকা পাঠাবেন। যে মাধ্যম ব্যবহার করবেন না সেটি খালি রাখুন।')}</p>
    <div class="two">${fieldHtml(['bkash', 'text', 'বিকাশ নম্বর'], p.bkash)}${fieldHtml(['nagad', 'text', 'নগদ নম্বর'], p.nagad)}</div>
    <div class="two">${fieldHtml(['rocket', 'text', 'রকেট নম্বর'], p.rocket)}${fieldHtml(['type', 'select', 'অ্যাকাউন্টের ধরন', '', [['Personal', 'Personal'], ['Agent', 'Agent'], ['Merchant', 'Merchant']]], p.type)}</div>
    ${fieldHtml(['note', 'textarea', 'নির্দেশনা'], p.note)}${fieldHtml(['noteEn', 'textarea', 'নির্দেশনা (English)'], p.noteEn)}
    <div><button class="btn">${icon('check', 18)}${T('সংরক্ষণ করুন')}</button></div></div></form>`;
}
export function fieldHtml([k, type, label, hint, opts], v, isNew) {
  const hintH = hint ? `<em>${esc(T(hint)).replace(/\n/g, '<br>')}</em>` : '';
  const L = T(label);
  if (type === 'textarea') return `<label class="field"><span>${L}</span><textarea name="${k}" rows="3">${esc(v || '')}</textarea>${hintH}</label>`;
  if (type === 'select') return `<label class="field"><span>${L}</span><select name="${k}">${opts.map(([a, b]) => `<option value="${esc(a)}" ${a === (v || '') ? 'selected' : ''}>${esc(T(b))}</option>`).join('')}</select>${hintH}</label>`;
  if (type === 'color') return `<label class="field"><span>${L}</span><input type="color" name="${k}" value="${esc(v || '#0e9f6e')}"></label>`;
  if (type === 'date') return `<label class="field"><span>${L}</span><input type="date" name="${k}" value="${esc(v || new Date().toISOString().slice(0, 10))}"></label>`;
  if (type === 'date0') return `<label class="field"><span>${L}</span><input type="date" name="${k}" value="${esc(v || '')}">${hintH}</label>`;
  if (type === 'number') return `<label class="field"><span>${L}</span><input name="${k}" inputmode="numeric" value="${esc(v ?? '')}">${hintH}</label>`;
  if (type === 'multi') return `<div class="field"><span>${L}</span><div class="days multi">${opts.map(([a, b]) => `<label><input type="checkbox" name="${k}" value="${esc(a)}" ${(v || []).includes(a) ? 'checked' : ''}>${esc(T(b))}</label>`).join('')}</div>${hintH}</div>`;
  if (type === 'check') return `<label class="check"><input type="checkbox" name="${k}" ${v ? 'checked' : ''}><span>${L}</span></label>`;
  if (type === 'kv') return `<label class="field"><span>${L}</span><textarea name="${k}" rows="5">${esc(Object.entries(v || {}).map(([a, b]) => `${a} = ${b}`).join('\n'))}</textarea>${hintH}</label>`;
  if (type === 'list') return `<label class="field"><span>${L}</span><textarea name="${k}" rows="2">${esc((v || []).join(', '))}</textarea>${hintH}</label>`;
  if (type === 'icon') return `<div class="field"><span>${L}</span><input type="hidden" name="${k}" value="${esc(v || 'info')}"><div class="iconpick">${ICON_NAMES.map(n => `<button type="button" data-pickicon="${n}" class="${n === (v || 'info') ? 'on' : ''}" title="${n}">${icon(n, 20)}</button>`).join('')}</div></div>`;
  if (type === 'image') return `<div class="field"><span>${L}</span><div class="imgupload"><span class="pv" style="${v ? `background-image:url('${esc(v)}')` : ''}"></span><input type="hidden" name="${k}" value="${esc(v || '')}">
    <label class="btn sm ghost">${icon('upload', 16)}${T('আপলোড')}<input type="file" accept="image/*" data-single></label><button type="button" class="btn sm ghost" data-clearimg>${T('সরান')}</button></div>${hintH}</div>`;
  return `<label class="field"><span>${L}</span><input name="${k}" value="${esc(v ?? '')}" ${k === 'id' && !isNew ? 'readonly' : ''}>${hintH}</label>`;
}
export function readFields(form, fields) {
  const v = {};
  fields.forEach(([k, type]) => {
    const el = form.elements[k];
    const raw = el?.value ?? '';
    if (type === 'check') v[k] = !!el?.checked;
    else if (type === 'multi') v[k] = [...form.querySelectorAll(`[name="${k}"]:checked`)].map(x => x.value);
    else if (type === 'kv') v[k] = Object.fromEntries(raw.split('\n').map(l => l.split('=')).filter(p => p.length >= 2 && p[0].trim()).map(([a, ...b]) => [a.trim().toLowerCase().replace(/\s+/g, '-'), b.join('=').trim()]));
    else if (type === 'list') v[k] = raw.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    else if (type === 'number') v[k] = raw.replace(/[^\d]/g, '') ? +raw.replace(/[^\d]/g, '') : null;
    else v[k] = raw.trim() || null;
  });
  return v;
}
export function modal(title, body, onSave, saveLabel = 'সংরক্ষণ করুন') {
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
export async function saveSetting(key, val, msg = 'সংরক্ষণ হয়েছে') {
  await run(() => api('/admin/settings/' + key, val, 'PUT'), msg);
  S.settings[key] = val;
}
export function editCollection(key, i) {
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

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  pages.ads = collection('ads', 'বিজ্ঞাপন (Ads)', 'ads', COLS.ads);
  pages.notices = collection('notices', 'ঘোষণা', 'notices', COLS.notices);
  pages.categories = collection('categories', 'ক্যাটাগরি', 'categories', COLS.categories);
  pages.plans = collection('plans', 'প্যাকেজ ও পেমেন্ট সেটিংস', 'plans', COLS.plans);
}
