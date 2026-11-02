/* All listings: list, filters, the edit form, photos, extra numbers. */
import { pages } from './dashboard.js';
import { catName, catOf, cats, empty, load, statusTag, subName, thumb } from './data.js';
import { shell } from './shell.js';
import { PAYSTATE } from './submissions.js';
import { DAYS, S, STATUS, T, day, esc, num, owner, root } from './util.js';

export const slugify = (l, taken) => {
  let base = String(l.nameEn || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');
  if (!base) base = (l.cat || 'place') + '-' + Math.random().toString(36).slice(2, 6);
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
};
export const demoIdFix = () => (S.listings || []).filter(l => /(^|-)demo(-|$)/.test(l.id) && !l.demo);
export function fillSubs(form) {
  const cs = form.querySelector('[data-catsel]'), ss = form.querySelector('[data-subsel]'), c = catOf(cs.value);
  ss.innerHTML = '<option value="">—</option>' + Object.keys(c.subs || {}).map(k => `<option value="${k}" ${k === ss.dataset.val ? 'selected' : ''}>${esc(subName(c, k))}</option>`).join('');
}
export function drawImgs(form) {
  const box = form.querySelector('[data-imgs]');
  box.innerHTML = form._images.map((u, i) => `<div class="im"><img src="${esc(u)}" alt="">${i === 0 ? `<span class="tag ok cover">${T('কভার')}</span>` : ''}
    <div class="ops"><button type="button" data-imgfirst="${i}" title="${T('কভার করুন')}">${icon('star', 14)}</button><button type="button" data-imgdel="${i}" title="${T('সরান')}">${icon('x', 14)}</button></div></div>`).join('')
    + (form._images.length < 10 ? `<label class="up">${icon('upload', 20)}<span>${T('ছবি যোগ')}</span><input type="file" accept="image/*" multiple data-imgup></label>` : '');
}
const CONTACT_ROLES = ['ওসি (অফিসার ইনচার্জ)', 'পরিদর্শক (তদন্ত)', 'ডিউটি অফিসার', 'থানার ল্যান্ডলাইন', 'কন্ট্রোল রুম', 'জরুরি বিভাগ', 'অ্যাম্বুলেন্স',
  'রিসেপশন', 'অফিস', 'ম্যানেজার', 'হোয়াটসঅ্যাপ'];
export function drawContacts(form) {
  const box = form.querySelector('[data-contacts]'); if (!box) return;
  box.innerHTML = form._contacts.map((c, i) => `<div class="crow" data-ci="${i}">
    <input placeholder="${T('পদবি (যেমন ওসি)')}" list="roles" value="${esc(c.role || '')}" data-cf="role">
    <input placeholder="${T('নাম (ঐচ্ছিক)')}" value="${esc(c.name || '')}" data-cf="name">
    <input placeholder="01XXXXXXXXX" inputmode="tel" value="${esc(c.phone || '')}" data-cf="phone">
    <button type="button" class="iconbtn red" data-delcontact="${i}" title="${T('সরান')}">${icon('trash', 16)}</button></div>`).join('')
    || `<p class="muted" style="margin:0">${T('এখনো কোনো অতিরিক্ত নম্বর নেই।')}</p>`;
}
export function drawVids(form) {
  const box = form.querySelector('[data-vids]'); if (!box) return;
  box.innerHTML = form._videos.map((u, i) => `<div class="vid"><video src="${esc(u)}" controls playsinline preload="metadata"></video>
    <button type="button" class="btn sm red" data-viddel="${i}">${icon('trash', 15)}${T('সরান')}</button></div>`).join('') || `<p class="muted">${T('ভিডিও নেই')}</p>`;
}
export function readListing(form) {
  const fd = new FormData(form), v = Object.fromEntries(fd);
  const out = { name: v.name, nameEn: v.nameEn, cat: v.cat, sub: v.sub, about: v.about, aboutEn: v.aboutEn, note: v.note, features: v.features, tags: v.tags, phone: v.phone, phone2: v.phone2,
    web: v.web, facebook: v.facebook, area: v.area, address: v.address, lat: v.lat, lng: v.lng, mapUrl: v.mapUrl, price: (v.price || '').replace(/[^\d]/g, ''),
    hours: v.h24 ? '24h' : v.open && v.close ? `${v.open}-${v.close}` : null, off: fd.getAll('off').map(Number), status: v.status, verifiedAt: v.verifiedAt, sponsoredUntil: v.sponsoredUntil, contacts: (form._contacts || []).filter(c => (c.phone || '').trim()), images: form._images, videos: form._videos || [] };
  if ('_paidUntil' in v) out._paidUntil = v._paidUntil;
  ['featured', 'sponsored', 'pin', 'demo', 'hidden', 'halal', 'blueTick'].forEach(k => out[k] = !!v[k]);
  return out;
}

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
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
      ${demoIdFix().length ? `<div class="note warn" style="align-items:center">${icon('alert', 20)}<div style="flex:1">${T('{n}টি আসল তালিকার লিংকে এখনো "demo" লেখা আছে (যেমন /p/{id}), কারণ সেগুলো নমুনা তথ্য বদলে বানানো।', { n: num(demoIdFix().length), id: esc(demoIdFix()[0].id) })}</div>
        <button class="btn sm" data-fixdemoids>${T('এক ক্লিকে ঠিক করুন')}</button></div>` : ''}
      <form class="toolbar" data-filter><label class="search">${icon('search', 18)}<input name="q" value="${esc(p.get('q') || '')}" placeholder="${T('নাম, এলাকা বা ফোন দিয়ে খুঁজুন')}"></label>
        <select name="cat"><option value="">${T('সব ক্যাটাগরি')}</option>${cats().map(c => `<option value="${c.id}" ${c.id === cat ? 'selected' : ''}>${esc(catName(c))}</option>`).join('')}</select>
        <select name="status"><option value="">${T('সব অবস্থা')}</option>${Object.entries(STATUS).map(([k, [v]]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${T(v)}</option>`).join('')}</select>
        <select name="flag"><option value="">${T('সব ধরন')}</option>${[['paid', 'পেইড ব্যবসা'], ['blueTick', 'ব্লু টিক'], ['featured', 'হোমে জনপ্রিয়'], ['sponsored', 'Sponsored'], ['demo', 'নমুনা'], ['hidden', 'লুকানো']].map(([k, v]) => `<option value="${k}" ${k === flag ? 'selected' : ''}>${T(v)}</option>`).join('')}</select></form>
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
        ${!isNew && /(^|-)demo(-|$)/.test(id) && !l.demo ? `<div class="note warn">${icon('alert', 20)}<div>${T('এই তালিকার লিংকে "demo" লেখা আছে, কারণ এটি নমুনা তথ্য থেকে বানানো। নিচে "লিংক (URL)" বদলে দিন — যেমন ইংরেজি নাম থেকে।')}</div></div>` : ''}
        ${l._owner ? `<div class="note info">${icon('user', 20)}<div><b>${T('মালিক')}:</b> ${esc(l._owner.name)} · ${esc(l._owner.phone)}${l._plan ? ` · ${T('প্যাকেজ')}: ${esc(l._plan)}` : ''}${l._payment ? ` · ${T('পেমেন্ট')}: ${esc(T(PAYSTATE[l._payment.status]?.[0] || l._payment.status))}` : ''}</div></div>` : ''}
        <div class="card"><h3>${T('মৌলিক তথ্য')}</h3><div class="cbody form">
          <div class="two">${f('name', 'নাম (বাংলা) *', 'required maxlength="120"')}${f('nameEn', 'নাম (English)', 'maxlength="120"', 'ইংরেজি ভাষার অ্যাপে ও ম্যাপে খোঁজায় দেখায়')}</div>
          <div class="two"><label class="field"><span>${T('ক্যাটাগরি *')}</span><select name="cat" data-catsel>${cats().map(x => `<option value="${x.id}" ${x.id === l.cat ? 'selected' : ''}>${esc(catName(x))}</option>`).join('')}</select></label>
            <label class="field"><span>${T('ধরন')}</span><select name="sub" data-subsel data-val="${esc(l.sub || '')}"></select></label></div>
          ${!isNew ? `<div class="field"><span>${T('লিংক (URL)')}</span>
            <div class="slugrow"><em>${esc(location.host)}/app/#/p/</em><input name="_slug" value="${esc(id)}" maxlength="60" autocapitalize="off" spellcheck="false" pattern="[a-z0-9][a-z0-9\-]*">
              <button type="button" class="btn sm ghost" data-genslug>${T('ইংরেজি নাম থেকে')}</button></div>
            <em>${T('শুধু ইংরেজি ছোট হাতের অক্ষর, সংখ্যা ও -। বদলালে পুরনো লিংকও নতুনটিতে নিয়ে যাবে।')}</em></div>` : ''}
          <label class="field"><span>${T('বিবরণ')}</span><textarea name="about" rows="5" maxlength="3000">${esc(l.about || '')}</textarea></label>
          <label class="field"><span>${T('বিবরণ (English)')}</span><textarea name="aboutEn" rows="3" maxlength="3000">${esc(l.aboutEn || '')}</textarea></label>
          <label class="field"><span>${T('ছোট নোট')}</span><input name="note" value="${esc(l.note || '')}" maxlength="400"><em>${T('তালিকা ও জরুরি পেজে নামের নিচে দেখায়')}</em></label>
          <div class="two">${f('features', 'সুবিধা', '', 'কমা দিয়ে আলাদা করুন: পার্কিং, হোম ডেলিভারি')}${f('tags', 'সার্চ কীওয়ার্ড', '', 'কমা দিয়ে: kacchi, তেহারি, biryani')}</div>
        </div></div>
        <div class="card"><h3>${T('যোগাযোগ ও অবস্থান')}</h3><div class="cbody form">
          <div class="two">${f('phone', 'ফোন', 'inputmode="tel"')}${f('phone2', 'বিকল্প ফোন', 'inputmode="tel"')}</div>
          <div class="two">${f('web', 'ওয়েবসাইট', 'type="url" placeholder="https://"')}${f('facebook', 'ফেসবুক পেজ', 'type="url" placeholder="https://facebook.com/…"')}</div>
          <div class="two"><label class="field"><span>${T('এলাকা')}</span><input name="area" list="areas" value="${esc(l.area || '')}"><datalist id="areas">${(S.settings.areas || []).map(a => `<option value="${esc(a)}">`).join('')}</datalist></label>${f('address', 'ঠিকানা')}</div>
          <label class="field"><span>${T('Google Maps লিংক')}</span><input name="mapUrl" type="url" value="${esc(l.mapUrl || '')}" placeholder="https://maps.app.goo.gl/…" data-adminmaplink>
            <em data-maphint>${T('Google Maps-এ জায়গাটি খুলে Share → Copy link করে এখানে পেস্ট করুন — Latitude/Longitude নিজে বসে যাবে।')}</em></label>
          <div class="two">${f('lat', 'Latitude', 'inputmode="decimal" data-latlng', 'অথবা Google Maps-এ জায়গায় রাইট-ক্লিক করে সংখ্যা কপি করে এখানে পেস্ট করুন')}${f('lng', 'Longitude', 'inputmode="decimal"')}</div>
          ${l.lat != null ? `<a class="btn sm ghost" style="justify-self:start" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${esc(l.lat)},${esc(l.lng)}">${icon('map', 16)}${T('ম্যাপে মিলিয়ে দেখুন')}</a>` : ''}
        </div></div>
        <div class="card"><h3>${T('আরও নম্বর (পদবিসহ)')} <small class="muted" style="font-weight:400">${T('যেমন থানার ওসি, ডিউটি অফিসার, হাসপাতালের জরুরি বিভাগ')}</small></h3>
          <div class="cbody form"><div class="contacts" data-contacts></div>
            <datalist id="roles">${CONTACT_ROLES.map(r => `<option value="${esc(T(r))}">`).join('')}</datalist>
            <button type="button" class="btn sm ghost" data-addcontact style="justify-self:start">${icon('plus', 16)}${T('নম্বর যোগ করুন')}</button></div></div>
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
          ${f('sponsoredUntil', 'Sponsored কবে পর্যন্ত', 'type="date"', 'এই তারিখের পর নিজে থেকে সাধারণ তালিকা হয়ে যাবে। খালি রাখলে বন্ধ না করা পর্যন্ত চলবে।')}
          ${owner() && l._plan ? f('_paidUntil', 'পেইড মেয়াদ শেষ', 'type="date"', 'এই তারিখের পর তালিকাটি অ্যাপে দেখাবে না') : ''}
          ${[['featured', 'হোমপেজে "জনপ্রিয়" অংশে দেখান'], ['sponsored', 'Sponsored (পেইড প্রচার)', 'সব তালিকা ও সার্চের উপরে, হোমপেজের "প্রচারিত" অংশে, "Sponsored" লেবেলসহ'], ['pin', 'জরুরি তালিকায় সবার উপরে'],
            ['blueTick', 'ব্লু টিক (ভেরিফায়েড প্রতিষ্ঠান)', 'নামের পাশে নীল ভেরিফায়েড চিহ্ন দেখাবে — শুধু যাচাই করা, বিশ্বস্ত বা অফিসিয়াল প্রতিষ্ঠানকে দিন'],
            ['halal', 'হালাল', 'খাবারের দোকান/রেস্টুরেন্টে "হালাল" চিহ্ন ও হালাল ফিল্টারে দেখাবে'], ['demo', 'নমুনা তথ্য', 'অ্যাপে "নমুনা" লেবেল দেখাবে'], ['hidden', 'লুকিয়ে রাখুন', 'অ্যাপে দেখাবে না']].map(([k, t, s]) =>
            `<label class="check"><input type="checkbox" name="${k}" ${l[k] ? 'checked' : ''}><span>${T(t)}${s ? `<small>${T(s)}</small>` : ''}</span></label>`).join('')}
        </div></div>
        <div class="card"><h3>${T('ছবি')} <small class="muted" style="font-weight:400">${T('প্রথম ছবিটি কভার')}</small></h3><div class="cbody"><div class="imgs" data-imgs></div></div></div>
        ${l.videos?.length ? `<div class="card"><h3>${T('ভিডিও')}</h3><div class="cbody"><div class="vvideos" data-vids></div></div></div>` : ''}
        ${!isNew ? `<div class="card"><h3>${T('পরিসংখ্যান')}</h3><div class="cbody stat3">
          <div><b>${num(l._views)}</b><small>${T('ভিউ')}</small></div><div><b>${num(l._calls)}</b><small>${T('কল')}</small></div><div><b>${num(l._maps)}</b><small>${T('ম্যাপ')}</small></div></div>
          ${l.sponsored || l._imps ? `<p class="muted" style="margin:0;padding:0 20px 18px;font-size:13px">${icon('sparkle', 14)} ${T('Sponsored হিসেবে {n} বার স্ক্রিনে দেখানো হয়েছে', { n: num(l._imps || 0) })}</p>` : ''}</div>` : ''}
      </div>
      <div class="savebar" style="grid-column:1/-1">${!isNew ? `<button type="button" class="btn red" data-dellisting="${esc(id)}" style="margin-right:auto">${icon('trash', 18)}${T('মুছুন')}</button>` : ''}
        ${l._review === 'pending' ? `<button type="submit" class="btn" name="approve" value="1">${icon('check', 18)}${T('সংরক্ষণ ও প্রকাশ')}</button>` : `<button type="submit" class="btn">${icon('check', 18)}${T('সংরক্ষণ করুন')}</button>`}</div>
      </form>`);
    const form = root.querySelector('[data-edit]');
    form._images = [...(l.images || [])];
    form._videos = [...(l.videos || [])];
    form._contacts = (l.contacts || []).map(c => ({ ...c }));
    drawContacts(form);
    fillSubs(form); drawImgs(form); drawVids(form);
  };
}
