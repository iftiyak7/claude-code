/* Adding and editing listings and ads, photos and videos, payments, explore, saved, profile, offers. */
import { S } from './state.js';
import { adStrip } from './ads.js';
import { empty, gcard, saved, ticket, topbar } from './components.js';
import { KINDS, OPTS, catName, getItem, isTown, items, subLabel, subName } from './data.js';
import { cache } from './page_classifieds.js';
import { pages } from './pages.js';
import { go, render } from './router.js';
import { APP_UA, LANG, LOGO, T, api, app, areaName, compress, esc, fmtDate, loc, ls, money, num, toLatin, toast, upload } from './util.js';

const planName = pl => LANG() === 'en' ? pl.en || pl.bn : pl.bn;
const planCards = sel => `<div class="plans">${(S.D.plans || []).map(pl => `<label class="plan ${sel === pl.id ? 'on' : ''}"><input type="radio" name="plan" value="${esc(pl.id)}" ${sel === pl.id ? 'checked' : ''}>
  <div class="ph"><b>${esc(planName(pl))}</b>${pl.featured ? `<span class="tag ad">${T('জনপ্রিয়')}</span>` : ''}</div>
  <div class="pp"><b>${money(pl.price)}</b><small>/ ${T('{n} দিন', { n: num(pl.days) })}</small></div>
  <ul>${(LANG() === 'en' && pl.perksEn ? pl.perksEn : pl.perks || []).map(x => `<li>${icon('check', 14)}${esc(x)}</li>`).join('')}</ul></label>`).join('')}</div>`;
function listingCats(mode) {
  return S.D.categories.map(c => {
    const subs = Object.keys(c.subs || {}).filter(s => (mode === 'paid') === (!!c.paid && !(c.freeSubs || []).includes(s)));
    return subs.length ? { c, subs } : null;
  }).filter(Boolean);
}
const WDAYS = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'];
const CROLES = ['ম্যানেজার', 'রিসেপশন', 'অফিস', 'জরুরি বিভাগ', 'অ্যাম্বুলেন্স', 'হোয়াটসঅ্যাপ', 'ওসি (অফিসার ইনচার্জ)', 'ডিউটি অফিসার'];
export const contactRow = (c = {}) => `<div class="cedit"><input placeholder="${T('পদবি')}" list="croles" maxlength="60" value="${esc(c.role || '')}" data-cf="role">
  <input placeholder="${T('নাম (ঐচ্ছিক)')}" maxlength="60" value="${esc(c.name || '')}" data-cf="name">
  <input placeholder="01XXXXXXXXX" inputmode="tel" maxlength="20" value="${esc(c.phone || '')}" data-cf="phone">
  <button type="button" class="iconbtn" data-rmcrow aria-label="${T('সরান')}">${icon('x', 16)}</button></div>`;
export const readCrows = f => [...f.querySelectorAll('.cedit')].map(r => Object.fromEntries([...r.querySelectorAll('[data-cf]')].map(i => [i.dataset.cf, i.dataset.cf === 'phone' ? toLatin(i.value.trim()) : i.value.trim()])))
  .filter(c => c.phone);
const locField = () => `<div class="field"><span>${T('ম্যাপে লোকেশন (ঐচ্ছিক)')}</span>
    <div class="locpick"><input name="mapUrl" type="url" inputmode="url" placeholder="${T('Google Maps লিংক পেস্ট করুন')}" data-maplink>
      <button type="button" class="btn sm ghost" data-gpsfill>${icon('nav', 16)}${T('আমি এখানেই আছি')}</button></div>
    <input type="hidden" name="lat"><input type="hidden" name="lng">
    <em class="locstatus" data-locstatus>${T('লোকেশন দিলে মানুষ দূরত্ব দেখতে ও সহজে পথ খুঁজে পাবে।')}</em></div>`;
export function setLoc(f, lat, lng, msg) {
  f.lat.value = lat ?? ''; f.lng.value = lng ?? '';
  const st = f.querySelector('[data-locstatus]');
  if (st) { st.classList.toggle('ok', lat != null && lat !== ''); st.innerHTML = lat != null && lat !== '' ? `${icon('check', 14)} ${T('লোকেশন যোগ হয়েছে')} (${num(Number(lat).toFixed(4))}, ${num(Number(lng).toFixed(4))})${msg ? ' · ' + msg : ''}` : esc(msg || ''); }
}
const needsPay = l => { const c = S.CAT[l.cat]; return !!c?.paid && !(c.freeSubs || []).includes(l.sub); };
/* photos & videos: uploaded one by one as soon as they are picked */
export const MEDIA = { images: [], videos: [] }, MAXM = { images: 10, videos: 2 };
const mediaField = () => `<div class="field"><span>${T('ছবি (সর্বোচ্চ {n}টি)', { n: num(MAXM.images) })}</span><div class="photos" data-media="images"></div></div>
  <div class="field"><span>${T('ভিডিও (সর্বোচ্চ {n}টি, প্রতিটি {m} MB পর্যন্ত)', { n: num(MAXM.videos), m: num(60) })}</span><div class="photos" data-media="videos"></div></div>`;
export function drawMedia() {
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
export const mediaBody = () => ({ images: MEDIA.images.filter(m => m.url).map(m => m.url), videos: MEDIA.videos.filter(m => m.url).map(m => m.url) });
export function fillForm(f, d) {
  const v = { ...d, features: (d.features || []).join(', '), tags: (d.tags || []).join(', '), open: /^\d/.test(d.hours || '') ? d.hours.split('-')[0] : '', close: /^\d/.test(d.hours || '') ? d.hours.split('-')[1] : '' };
  [...f.elements].forEach(el => { if (el.name && !['checkbox', 'radio', 'file'].includes(el.type) && v[el.name] != null) el.value = String(v[el.name]); });
  if (f.h24) f.h24.checked = d.hours === '24h';
  if (f.halal) f.halal.checked = !!d.halal;
  f.querySelectorAll('[name=off]').forEach(el => { el.checked = (d.off || []).includes(+el.value); });
  if (f.lat && d.lat != null) setLoc(f, d.lat, d.lng);
}
const termsText = () => (LANG() === 'en' && S.D.terms?.en) || S.D.terms?.bn || '';
export const termsHtml = () => termsText().split(/\n\s*\n/).map(x => `<p>${esc(x.trim()).replace(/\n/g, '<br>')}</p>`).join('');

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  /* ---------------- add / post ---------------- */
  pages.add = () => {
    const opts = [['listing?mode=paid', 'store', '#0e9f6e', 'ব্যবসা যুক্ত করুন', 'প্রাইভেট হাসপাতাল, ক্লিনিক, ডাক্তার ও হোমিও চেম্বার, রেস্টুরেন্ট, দোকান, হোটেল, কোচিং', 'পেইড প্যাকেজ'],
      ['listing?mode=free', 'landmark', '#7c5cff', 'ফ্রি তথ্য যোগ করুন', 'সরকারি হাসপাতাল, দর্শনীয় স্থান, জরুরি নম্বর, স্কুল-কলেজ, স্বেচ্ছাসেবী সংগঠন', 'ফ্রি'],
      ['job', 'briefcase', '#f2711c', 'চাকরির বিজ্ঞাপন', 'আপনার প্রতিষ্ঠানে লোক নিন', 'ফ্রি'],
      ['rent', 'home', '#4f6bed', 'বাসা / ফ্ল্যাট / দোকান ভাড়া', 'টু-লেট বিজ্ঞাপন দিন', 'ফ্রি'],
      ['mess', 'bed', '#0f9fa8', 'মেস / সিট ভাড়া', 'খালি সিটের খবর দিন', 'ফ্রি'],
      ['tuition', 'cap', '#7c5cff', 'টিউশন', 'গৃহশিক্ষক খুঁজুন বা টিউশনি দিন', 'ফ্রি']];
    return `${topbar(T('কী যোগ করতে চান?'))}
      ${S.ME ? '' : `<div class="note">${icon('user', 18)}<span>${T('যোগ করতে অ্যাকাউন্ট লাগবে।')} <a href="#/login?next=/add" style="font-weight:700;color:var(--brand)">${T('লগইন / অ্যাকাউন্ট খুলুন')}</a></span></div>`}
      <div class="rows">${opts.map(([to, ic, c, t, d, b]) => `<a class="row choose" href="#/post/${to}"><span class="media" style="--c:${c};width:60px;height:60px"><span class="gen"><span class="ring" style="width:72%">${icon(ic, 26)}</span></span></span>
        <span class="body"><b>${T(t)}</b><span class="sub" style="white-space:normal">${T(d)}</span><span class="meta"><span class="tag ${b === 'ফ্রি' ? 'ok' : 'ad'}">${T(b)}</span><span class="muted">${T('অ্যাডমিন যাচাইয়ের পর প্রকাশ')}</span></span></span>${icon('chevR', 18)}</a>`).join('')}</div>`;
  };
  pages.edit = ([type, id]) => {
    if (!S.ME) { go('#/login?next=' + encodeURIComponent('/edit/' + type + '/' + id)); return ''; }
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
    if (!S.ME) { go('#/login?next=' + encodeURIComponent('/post/' + what + (p.toString() ? '?' + p : ''))); return ''; }
    if (pages.post.done) { const d = pages.post.done; pages.post.done = null;
      return `${topbar(T('জমা হয়েছে'))}${empty(T('জমা হয়েছে!'), T(d), `<a class="btn sm" href="#/account${what === 'listing' ? '' : '?tab=ads'}">${T('আমার অ্যাকাউন্ট')}</a>`, 'check')}`; }
    const myArea = ls.get('area', ''), opt = a => `<option value="${esc(a)}" ${a === myArea ? 'selected' : ''}>${esc(areaName(a))}</option>`;
    const areaSel = `<select name="area"><optgroup label="${T('যশোর শহর')}">${(S.D.areas || []).filter(isTown).map(opt).join('')}</optgroup>
      <optgroup label="${T('উপজেলা')}">${(S.D.areas || []).filter(a => !isTown(a)).map(opt).join('')}</optgroup></select>`;
    const editNote = edit ? `<div class="note warn">${icon('edit', 18)}<span>${T(edit.review === 'approved' || edit.review === 'rejected' ? 'পরিবর্তন জমা দিলে অ্যাডমিন আবার যাচাই করবেন, ততক্ষণ এটি অ্যাপে দেখাবে না।' : 'পরিবর্তন জমা দিন — অ্যাডমিন যাচাই করে প্রকাশ করবেন।')}</span></div>` : '';
    const editAttr = edit ? ` data-edit="${esc(edit.id)}"` : '';
    if (what === 'listing') {
      const mode = edit ? (needsPay(edit) ? 'paid' : 'free') : p.get('mode') === 'paid' ? 'paid' : 'free', groups = listingCats(mode);
      return `${topbar(T(edit ? 'তথ্য সম্পাদনা' : mode === 'paid' ? 'ব্যবসা যুক্ত করুন' : 'ফ্রি তথ্য যোগ করুন'))}
      ${editNote || `<div class="note">${icon(mode === 'paid' ? 'store' : 'landmark', 18)}<span>${T(mode === 'paid' ? 'তথ্য দিন, প্যাকেজ বাছুন, তারপর বিকাশ/নগদে পেমেন্ট করুন। যাচাইয়ের পর প্রকাশিত হবে।' : 'সরকারি, জনসেবামূলক বা দর্শনীয় স্থানের তথ্য ফ্রিতে যোগ করুন। অ্যাডমিন যাচাই করে প্রকাশ করবেন।')}</span></div>`}
      <form class="form" data-addlisting="${mode}"${editAttr}>
        <h3 class="fsec">${T('মৌলিক তথ্য')}</h3>
        <label class="field"><span>${T('নাম (বাংলা)')} *</span><input name="name" required maxlength="120" placeholder="${T('যেমন: যশোর কাচ্চি ঘর')}"></label>
        <label class="field"><span>${T('নাম (English)')}</span><input name="nameEn" maxlength="120" placeholder="e.g. Jashore Kacchi Ghor" autocapitalize="words"><em>${T('ইংরেজি ভাষার অ্যাপে ও খোঁজায় দেখায়')}</em></label>
        ${edit ? `<label class="field"><span>${T('ধরন')}</span><input value="${esc(subLabel(edit))}" disabled></label>`
          : `<label class="field"><span>${T('ধরন')} *</span><select name="catsub" required>${groups.map(g => `<optgroup label="${esc(catName(g.c))}">${g.subs.map(s => `<option value="${g.c.id}|${s}">${esc(subName(g.c, s))}</option>`).join('')}</optgroup>`).join('')}</select></label>`}
        <div class="two"><label class="field"><span>${T('এলাকা')} *</span>${areaSel}</label>
          <label class="field"><span>${T('ফোন')}</span><input name="phone" inputmode="tel" placeholder="01XXXXXXXXX" value="${mode === 'paid' ? esc(S.ME.phone) : ''}"></label></div>
        <label class="field"><span>${T('বিবরণ')}</span><textarea name="about" maxlength="3000" placeholder="${T('সেবা, বিশেষত্ব, সুবিধা…')}"></textarea></label>
        <label class="field"><span>${T('বিবরণ (English)')}</span><textarea name="aboutEn" maxlength="3000" placeholder="${T('ঐচ্ছিক')}"></textarea></label>
        <label class="field"><span>${T('ছোট নোট')}</span><input name="note" maxlength="400" placeholder="${T('যেমন: শুক্রবার জুমার পর খোলে')}"><em>${T('তালিকায় নামের নিচে দেখায়')}</em></label>
        <div class="two"><label class="field"><span>${T('সুবিধা')}</span><input name="features" maxlength="400" placeholder="${T('পার্কিং, হোম ডেলিভারি')}"><em>${T('কমা দিয়ে আলাদা করুন')}</em></label>
          <label class="field"><span>${T('সার্চ কীওয়ার্ড')}</span><input name="tags" maxlength="400" placeholder="kacchi, তেহারি, biryani"><em>${T('মানুষ যে শব্দে খুঁজবে')}</em></label></div>
        <label class="switch"><span>${icon('halal', 16)} ${T('হালাল খাবার')}<small>${T('রেস্টুরেন্ট বা খাবারের দোকান হলে')}</small></span><input type="checkbox" name="halal"></label>

        <h3 class="fsec">${T('যোগাযোগ ও অবস্থান')}</h3>
        <label class="field"><span>${T('বিকল্প ফোন')}</span><input name="phone2" inputmode="tel" placeholder="01XXXXXXXXX"></label>
        <div class="field"><span>${T('আরও নম্বর (পদবিসহ)')}</span><div class="crows" data-crows>${(edit?.contacts || []).map(c => contactRow(c)).join('')}</div>
          <datalist id="croles">${CROLES.map(r => `<option value="${esc(T(r))}">`).join('')}</datalist>
          <button type="button" class="btn sm ghost" data-addcrow style="align-self:flex-start">${icon('plus', 16)}${T('নম্বর যোগ করুন')}</button>
          <em>${T('যেমন ম্যানেজার, রিসেপশন, জরুরি বিভাগ, হোয়াটসঅ্যাপ')}</em></div>
        <div class="two"><label class="field"><span>${T('ওয়েবসাইট')}</span><input name="web" type="url" placeholder="https://"></label>
          <label class="field"><span>${T('ফেসবুক পেজ')}</span><input name="facebook" type="url" placeholder="https://facebook.com/…"></label></div>
        <label class="field"><span>${T('ঠিকানা')}</span><input name="address" maxlength="200" placeholder="${T('রাস্তা, ল্যান্ডমার্ক')}"></label>
        ${locField()}

        <h3 class="fsec">${T('সময় ও দাম')}</h3>
        <label class="switch"><span>${T('২৪ ঘণ্টা খোলা')}</span><input type="checkbox" name="h24"></label>
        <div class="two"><label class="field"><span>${T('খোলে')}</span><input name="open" type="time"></label><label class="field"><span>${T('বন্ধ হয়')}</span><input name="close" type="time"></label></div>
        <div class="field"><span>${T('সাপ্তাহিক বন্ধ')}</span><div class="days">${WDAYS.map((d, i) => `<label><input type="checkbox" name="off" value="${i}"><span>${T(d)}</span></label>`).join('')}</div></div>
        <label class="field"><span>${T('আনুমানিক খরচ (৳)')}</span><input name="price" inputmode="numeric"><em>${T('রেস্টুরেন্টে জনপ্রতি, হোটেলে প্রতি রাত, সার্ভিসে শুরুর দাম')}</em></label>

        <h3 class="fsec">${T('ছবি ও ভিডিও')}</h3>
        ${mediaField()}
        ${mode === 'paid' && !edit ? `<div class="field"><span>${T('প্যাকেজ বাছুন')} *</span>${planCards(S.D.plans?.[0]?.id)}</div>` : ''}
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
      : what === 'tuition' ? `
        <div class="two"><label class="field"><span>${T('আপনি কী চান')} *</span><select name="tuitionType" required>${OPTS.tuitionType.map(([v, l]) => `<option value="${v}">${T(l)}</option>`).join('')}</select></label>
          <label class="field"><span>${T('সম্মানী (৳/মাস)')}</span><input name="price" inputmode="numeric"></label></div>
        <label class="field"><span>${T('বিষয়')}</span><input name="subject" maxlength="200" placeholder="${T('যেমন: গণিত, ইংরেজি, সব বিষয়')}"></label>
        <div class="two"><label class="field"><span>${T('শ্রেণি')}</span><input name="classLevel" maxlength="60" placeholder="${T('যেমন: ৮ম শ্রেণি, এসএসসি')}"></label><label class="field"><span>${T('মাধ্যম')}</span>${sel('medium', 'medium')}</label></div>
        <div class="two"><label class="field"><span>${T('সপ্তাহে কত দিন')}</span><input name="daysPerWeek" inputmode="numeric"></label><label class="field"><span>${T('শিক্ষার্থী সংখ্যা')}</span><input name="students" inputmode="numeric"></label></div>
        <div class="two"><label class="field"><span>${T('শিক্ষক')}</span>${sel('tutorGender', 'tutorGender')}</label><label class="field"><span>${T('যোগ্যতা')}</span><input name="qualification" maxlength="400" placeholder="${T('যেমন: বিশ্ববিদ্যালয়ের ছাত্র/ছাত্রী')}"></label></div>`
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
        <label class="field"><span>${T('শিরোনাম')} *</span><input name="title" required maxlength="120" placeholder="${T(what === 'job' ? 'যেমন: সেলসম্যান নিয়োগ' : what === 'rent' ? 'যেমন: ২ রুমের ফ্যামিলি বাসা ভাড়া' : what === 'tuition' ? 'যেমন: ৮ম শ্রেণির গণিতের জন্য শিক্ষক চাই' : 'যেমন: ছাত্রদের মেসে সিট খালি')}"></label>
        ${extra}
        <label class="field"><span>${T('বিস্তারিত')}</span><textarea name="description" maxlength="3000"></textarea></label>
        <div class="two"><label class="field"><span>${T('এলাকা')}</span>${areaSel}</label><label class="field"><span>${T('ঠিকানা')}</span><input name="address" maxlength="200"></label></div>
        ${what === 'job' ? '' : locField()}
        <div class="two"><label class="field"><span>${T('যোগাযোগের নাম')}</span><input name="contactName" maxlength="60" value="${esc(S.ME.name)}"></label>
          <label class="field"><span>${T('মোবাইল')} *</span><input name="phone" required inputmode="tel" value="${esc(S.ME.phone)}"></label></div>
        <label class="field"><span>WhatsApp</span><input name="whatsapp" inputmode="tel" placeholder="${T('ঐচ্ছিক')}"></label>
        ${mediaField()}
        <label class="check"><input type="checkbox" required><span>${T('আমি নিশ্চিত করছি বিজ্ঞাপনের তথ্য সঠিক।')}</span></label>
        <button class="btn block" type="submit">${T(edit ? 'পরিবর্তন জমা দিন' : 'বিজ্ঞাপন জমা দিন')}</button></form>`;
  };
  pages.pay = ([lid]) => {
    if (!S.ME) { go('#/login?next=/pay/' + lid); return ''; }
    const my = cache.my;
    if (!my) { api('/my').then(r => { cache.my = r; render(); }).catch(e => toast(e.message)); return `${topbar(T('পেমেন্ট'))}<div class="boot"><div class="spinner"></div></div>`; }
    const l = my.listings.find(x => x.id === lid);
    if (!l) return `${topbar(T('পেমেন্ট'))}${empty(T('পাওয়া যায়নি'), '')}`;
    if (l.state === 'payment_review') return `${topbar(T('পেমেন্ট'))}${empty(T('পেমেন্ট যাচাই চলছে'), T('আপনার পেমেন্ট পেয়েছি। যাচাই শেষে প্রকাশিত হবে।'), `<a class="btn sm" href="#/account">${T('আমার অ্যাকাউন্ট')}</a>`, 'clock')}`;
    const pay = S.D.payment || {}, sel = pages.pay.plan || l.plan || S.D.plans?.[0]?.id, plan = (S.D.plans || []).find(x => x.id === sel);
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
        <label class="field"><span>${T('যে নম্বর থেকে পাঠিয়েছেন')} *</span><input name="sender" required inputmode="tel" value="${esc(S.ME.phone)}"></label>
        <button class="btn block" type="submit">${T('পেমেন্ট জমা দিন')}</button></form>`
      : `<div class="note warn">${icon('info', 16)}<span>${T('অনলাইন পেমেন্ট নম্বর এখনো যোগ করা হয়নি। অ্যাডমিনের সাথে যোগাযোগ করুন।')}</span></div>`}`;
  };
  pages.explore = () => {
    const counts = {}; items().forEach(i => counts[i.cat] = (counts[i.cat] || 0) + 1);
    return `${topbar(T('এক্সপ্লোর'))}
      <div class="grid2">${S.D.categories.map(c => `<a class="gcard" href="${c.id === 'emergency' ? '#/emergency' : '#/c/' + c.id}" style="padding:18px;gap:14px">
        <span class="catt" style="width:auto;align-items:flex-start"><span style="--c:${esc(c.color)};width:54px;height:54px;border-radius:17px">${icon(c.icon, 24)}</span></span>
        <div><b style="display:block;font-size:15px">${esc(catName(c))}</b><small class="muted">${T('{n}টি তথ্য', { n: num(counts[c.id] || 0) })}</small></div></a>`).join('')}</div>
      <section class="sec"><div class="sechead"><h2>${T('ভাড়া ও চাকরি')}</h2></div><div class="ktiles">${Object.entries(KINDS).map(([k, v]) =>
        `<a href="#/ads/${k}" style="--c:${v.color}"><span>${icon(v.icon, 22)}</span><b>${T(v.bn)}</b><small>${T('{n}টি বিজ্ঞাপন', { n: num(S.D.classifiedCounts?.[k] || 0) })}</small></a>`).join('')}</div></section>
      <a class="bizcta" href="#/offers" style="margin-top:18px"><span>${icon('tag', 22)}</span><div><b>${T('অফার ও কুপন')}</b><small>${T('{n}টি প্রতিষ্ঠানে অফার চলছে', { n: num(Object.keys(S.D.offers || {}).length) })}</small></div>${icon('chevR', 18)}</a>
      <section class="sec"><div class="sechead"><h2>${T('শীঘ্রই আসছে')}</h2></div><div class="pills wrap">${[['droplet', 'রক্তদাতা নেটওয়ার্ক'], ['nav', 'যাতায়াত'], ['calendar', 'ইভেন্ট']]
        .map(([i, t]) => `<span class="pill sm">${icon(i, 15)}${T(t)}</span>`).join('')}</div></section>`;
  };
  pages.saved = () => {
    const list = saved().map(getItem).filter(Boolean);
    return `${topbar(T('সেভ করা'))}${list.length ? `<div class="grid2">${list.map(gcard).join('')}</div>`
      : empty(T('এখনো কিছু সেভ করেননি'), T('পছন্দের জায়গার হার্ট চিহ্নে চাপুন, এখানে জমা থাকবে।'), `<a class="btn sm" href="#/explore">${T('এক্সপ্লোর করুন')}</a>`, 'heart')}`;
  };
  pages.profile = () => {
    const t = ls.get('theme', 'auto'), site = S.D.site || {};
    const android = /Android/i.test(navigator.userAgent) && !APP_UA && S.D.app?.file;
    return `${topbar(T('প্রোফাইল'))}
    ${S.ME ? `<a class="profilehead" href="#/account"><span class="avatar">${esc(S.ME.name[0])}</span><div style="flex:1"><b>${esc(S.ME.name)}</b><span class="muted" style="font-size:13px">${T('আমার ব্যবসা, বিজ্ঞাপন ও সেটিংস')}</span></div>${icon('chevR', 18)}</a>`
      : `<div class="authpromo"><span class="brandmark">${LOGO}</span><div><b>${T('অ্যাকাউন্ট খুলুন')}</b><small>${T('রিভিউ দিন, ব্যবসা যুক্ত করুন, ফ্রি বিজ্ঞাপন দিন')}</small></div>
        <a class="btn sm" href="#/login?next=/account">${T('লগইন')}</a></div>`}
    <div class="stat3"><div><b>${num(saved().length)}</b><small>${T('সেভ করা')}</small></div><div><b>${num(ls.get('recent', []).length)}</b><small>${T('দেখেছেন')}</small></div><div><b>${num(S.D.listings.length)}</b><small>${T('মোট তথ্য')}</small></div></div>
    <div class="panel">
      <div class="li"><span class="ib">${icon('globe', 18)}</span><div>${T('ভাষা')}</div><div class="seg" style="flex:none">${[['bn', 'বাংলা'], ['en', 'English']].map(([k, v]) => `<button class="${LANG() === k ? 'on' : ''}" data-setlang="${k}">${v}</button>`).join('')}</div></div>
      <div class="li"><span class="ib">${icon('moon', 18)}</span><div>${T('থিম')}</div><div class="seg" style="flex:none">${[['auto', 'অটো'], ['light', 'লাইট'], ['dark', 'ডার্ক']].map(([k, v]) => `<button class="${t === k ? 'on' : ''}" data-theme-set="${k}">${T(v)}</button>`).join('')}</div></div>
      <button class="li" data-areasheet><span class="ib">${icon('pin', 18)}</span><div>${T('আমার এলাকা')}<small>${esc(areaName(ls.get('area', '')) || T('পুরো যশোর'))}</small></div>${icon('chevR', 18)}</button>
      <div class="li"><span class="ib">${icon('nav', 18)}</span><div>${T('লোকেশন')}<small>${T(S.here ? 'চালু — দূরত্ব দেখানো হচ্ছে' : 'বন্ধ')}</small></div>${S.here ? `<button class="btn sm ghost" data-forgetloc>${T('বন্ধ করুন')}</button>` : `<button class="btn sm" data-locate>${T('চালু করুন')}</button>`}</div>
    </div>
    <div class="panel">
      ${android ? `<a class="li" href="/download/jashore360.apk"><span class="ib">${icon('download', 18)}</span><div>${T('অ্যান্ড্রয়েড অ্যাপ ডাউনলোড')}<small>v${esc(S.D.app.versionName)}</small></div>${icon('chevR', 18)}</a>` : ''}
      <a class="li" href="#/add"><span class="ib">${icon('store', 18)}</span><div>${T('ব্যবসা যুক্ত করুন')}<small>${T('অ্যাকাউন্ট খুলে প্যাকেজ বেছে নিন')}</small></div>${icon('chevR', 18)}</a>
      ${site.contactPhone ? `<a class="li" href="tel:${esc(site.contactPhone)}"><span class="ib">${icon('phone', 18)}</span><div>${T('যোগাযোগ')}<small>${num(site.contactPhone)}</small></div>${icon('chevR', 18)}</a>` : ''}
      ${site.facebook ? `<a class="li" href="${esc(site.facebook)}" target="_blank" rel="noopener"><span class="ib">${icon('facebook', 18)}</span><div>${T('ফেসবুক পেজ')}</div>${icon('external', 16)}</a>` : ''}
      <button class="li" data-notices><span class="ib">${icon('bell', 18)}</span><div>${T('ঘোষণা ও আপডেট')}</div>${icon('chevR', 18)}</button>
      ${S.ME ? `<a class="li" href="#/account?tab=coupons"><span class="ib">${icon('tag', 18)}</span><div>${T('আমার কুপন')}${S.ME.coupons ? `<small>${T('{n}টি ব্যবহার করা বাকি', { n: num(S.ME.coupons) })}</small>` : ''}</div>${icon('chevR', 18)}</a>` : ''}
      <a class="li" href="#/offers"><span class="ib">${icon('tag', 18)}</span><div>${T('অফার ও কুপন')}</div>${icon('chevR', 18)}</a>
      <button class="li" data-hardrefresh><span class="ib">${icon('refresh', 18)}</span><div>${T('রিফ্রেশ করুন')}<small>${T('নতুন তথ্য আনুন — যেকোনো পেজের উপরে টেনে নামালেও হয়')}</small></div>${icon('chevR', 18)}</button>
      <a class="li" href="#/terms"><span class="ib">${icon('doc', 18)}</span><div>${T('শর্তাবলি')}</div>${icon('chevR', 18)}</a>
      <a class="li" href="/"><span class="ib">${icon('info', 18)}</span><div>${T('Jashore360 সম্পর্কে')}<small>${esc(loc(site, 'about'))}</small></div>${icon('chevR', 18)}</a>
    </div>
    <p class="foot">${esc(loc(site, 'disclaimer'))}<br>${T('পেইড বিজ্ঞাপন সবসময় "Sponsored" চিহ্নিত থাকে এবং রেটিংকে প্রভাবিত করে না।')}</p>`;
  };
  pages.terms = () => `${topbar(T('শর্তাবলি'))}
    <div class="prose terms">${termsHtml() || `<p>${T('শর্তাবলি এখনো যোগ করা হয়নি।')}</p>`}</div>
    ${S.D.terms?.updated ? `<p class="muted" style="font-size:13px">${T('সর্বশেষ আপডেট')}: ${esc(fmtDate(S.D.terms.updated))}</p>` : ''}`;
  pages.offers = () => {
    if (!cache.offers) api('/coupons').then(r => { cache.offers = r; if (location.hash.startsWith('#/offers')) render(); }).catch(e => toast(e.message));
    const list = cache.offers;
    return `${topbar(T('অফার ও কুপন'))}
      <div class="note">${icon('tag', 18)}<span>${T('কুপন নিন, দোকানে কোডটি দেখান — ছাড় পাবেন। নেওয়া কুপন "আমার অ্যাকাউন্ট → কুপন"-এ থাকে।')}</span></div>
      ${adStrip('offers', '', 'margin:0 0 16px')}
      ${!list ? '<div class="boot" style="min-height:160px"><div class="spinner"></div></div>'
        : list.length ? `<div class="tklist">${list.map(c => ticket(c, { listingLink: true })).join('')}</div>`
        : empty(T('এখন কোনো অফার নেই'), T('নতুন অফার এলে এখানে দেখাবে।'), '', 'tag')}`;
  };
  pages.notfound = () => `${topbar('')}${empty(T('পাওয়া যায়নি'), '', `<a class="btn sm" href="#/">${T('হোমে ফিরুন')}</a>`)}`;
}
