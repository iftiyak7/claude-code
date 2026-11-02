/* Jobs, rents, mess and tuition ads. */
import { pages } from './dashboard.js';
import { empty } from './data.js';
import { shell } from './shell.js';
import { KINDS, S, T, api, date, esc, money, num } from './util.js';

const CLOPT = { family: 'ফ্যামিলি বাসা', bachelor: 'ব্যাচেলর বাসা', flat: 'ফ্ল্যাট', room: 'রুম', shop: 'দোকান', office: 'অফিস', single: 'সিঙ্গেল রুম', double: 'ডাবল রুম',
  shared: 'শেয়ারড সিট', male: 'ছেলে', female: 'মেয়ে', full: 'ফুলটাইম', part: 'পার্টটাইম', intern: 'ইন্টার্নশিপ', remote: 'রিমোট',
  need: 'শিক্ষক চাই', offer: 'পড়াতে চাই', bangla: 'বাংলা মাধ্যম', english: 'ইংলিশ ভার্সন', emedium: 'ইংলিশ মিডিয়াম', madrasa: 'মাদ্রাসা', any: 'যেকোনো' };
const CLFIELDS = {
  job: [['company', 'প্রতিষ্ঠান'], ['jobType', 'চাকরির ধরন'], ['vacancies', 'পদ সংখ্যা'], ['qualification', 'যোগ্যতা'], ['experience', 'অভিজ্ঞতা'], ['deadline', 'আবেদনের শেষ তারিখ'], ['howToApply', 'আবেদনের নিয়ম']],
  rent: [['propertyType', 'ধরন'], ['rooms', 'রুম'], ['baths', 'বাথরুম'], ['size', 'আয়তন (বর্গফুট)'], ['floor', 'তলা'], ['availableFrom', 'কবে থেকে'], ['facilities', 'সুবিধা']],
  mess: [['seatType', 'সিটের ধরন'], ['gender', 'কাদের জন্য'], ['seats', 'খালি সিট'], ['availableFrom', 'কবে থেকে'], ['facilities', 'সুবিধা']],
  tuition: [['tuitionType', 'ধরন'], ['subject', 'বিষয়'], ['classLevel', 'শ্রেণি'], ['medium', 'মাধ্যম'], ['students', 'শিক্ষার্থী'], ['daysPerWeek', 'সপ্তাহে কত দিন'],
    ['tutorGender', 'শিক্ষক'], ['qualification', 'যোগ্যতা']]
};
const mediaHtml = x => `${x.images?.length ? `<div class="vgallery">${x.images.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" loading="lazy"></a>`).join('')}</div>` : ''}
  ${x.videos?.length ? `<div class="vvideos">${x.videos.map(u => `<video src="${esc(u)}" controls playsinline preload="metadata"></video>`).join('')}</div>` : ''}`;
function viewModal(title, body, foot) {
  document.querySelector('.modal-bg')?.remove();
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal wide"><div class="mhead"><h3>${title}</h3><button type="button" class="iconbtn" data-x>${icon('x', 20)}</button></div>
    <div class="mbody">${body}</div>${foot ? `<div class="mfoot">${foot}</div>` : ''}</div>`;
  document.body.appendChild(bg);
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-x]')) bg.remove(); });
}
export function viewClassified(c) {
  const [kn, , col] = KINDS[c.kind], now = Date.now() / 1000;
  const rows = [['মূল্য', c.price ? money(c.price) + (c.kind === 'job' ? ' / ' + T('মাস (বেতন)') : ' / ' + T('মাস')) : ''],
    ...CLFIELDS[c.kind].map(([k, l]) => [l, k === 'deadline' || k === 'availableFrom' ? (c[k] ? date(c[k]) : '') : CLOPT[c[k]] ? T(CLOPT[c[k]]) : c[k] != null ? String(c[k]) : '']),
    ['এলাকা', c.area], ['ঠিকানা', c.address], ['ম্যাপ', c.lat != null ? `${c.lat}, ${c.lng}` : c.mapUrl], ['যোগাযোগের নাম', c.contactName], ['মোবাইল', c.phone], ['WhatsApp', c.whatsapp]].filter(r => r[1]);
  const state = c.review === 'approved' ? (c.expires > now ? ['চলমান', 'ok'] : ['মেয়াদ শেষ', 'bad']) : c.review === 'rejected' ? ['বাতিল', 'bad'] : ['অপেক্ষমাণ', 'warn'];
  viewModal(esc(c.title), `
    <div class="tags" style="margin-bottom:12px"><span class="tag" style="background:color-mix(in srgb, ${col} 14%, transparent);color:${col}">${T(kn)}</span><span class="tag ${state[1]}">${T(state[0])}</span>
      ${c.editedAt ? `<span class="tag warn">${T('সম্পাদিত')}: ${date(c.editedAt)}</span>` : ''}</div>
    ${mediaHtml(c)}
    ${c.description ? `<p class="vdesc">${esc(c.description)}</p>` : ''}
    <dl class="vlist">${rows.map(([l, v]) => `<dt>${T(l)}</dt><dd>${l === 'মোবাইল' || l === 'WhatsApp' ? `<a href="tel:${esc(v)}">${esc(v)}</a>` : l === 'ম্যাপ' ? `<a href="${esc(c.mapUrl || 'https://www.google.com/maps/search/?api=1&query=' + v)}" target="_blank" rel="noopener">${T('ম্যাপে দেখুন')}</a>` : esc(v)}</dd>`).join('')}
      <dt>${T('জমাদাতা')}</dt><dd>${esc(c.userName)} · ${esc(c.userPhone)}</dd><dt>${T('জমার সময়')}</dt><dd>${date(c.t)}</dd>
      ${c.review === 'approved' ? `<dt>${T('মেয়াদ')}</dt><dd>${date(c.expires)} · ${T('{v} ভিউ', { v: num(c.views) })}</dd>` : ''}</dl>`,
    `${c.review !== 'approved' || c.expires <= now ? `<select data-cldays="${c.id}">${[7, 15, 30, 60].map(d => `<option value="${d}" ${d === 30 ? 'selected' : ''}>${T('{n} দিন', { n: num(d) })}</option>`).join('')}</select>
      <button class="btn" data-clreview="${c.id}|approved">${icon('check', 16)}${T('অনুমোদন')}</button>` : ''}
     ${c.review !== 'rejected' ? `<button class="btn red" data-clreview="${c.id}|rejected">${T('বাতিল')}</button>` : ''}
     <button class="btn ghost" data-x>${T('বন্ধ করুন')}</button>`);
}

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  /* ---------------- classifieds ---------------- */
  pages.classifieds = async (_, p) => {
    const all = await api('/admin/classifieds'), tab = p.get('tab') || 'pending', now = Date.now() / 1000;
    S.cls = all;
    const state = c => c.review === 'approved' ? (c.expires > now ? 'live' : 'expired') : c.review;
    const list = all.filter(c => state(c) === tab);
    S.counts = { ...(S.counts || {}), classifiedsPending: all.filter(c => c.review === 'pending').length };
    shell('classifieds', T('চাকরি ও ভাড়া'), '', `<p class="muted" style="margin-top:0">${T('ব্যবহারকারীদের দেওয়া ফ্রি বিজ্ঞাপন। অনুমোদন দিলে নির্দিষ্ট দিন পর্যন্ত অ্যাপে দেখাবে।')}</p>
      <div class="tabs">${[['pending', 'অপেক্ষমাণ'], ['live', 'চলমান'], ['expired', 'মেয়াদ শেষ'], ['rejected', 'বাতিল']].map(([k, t]) =>
        `<a class="${tab === k ? 'on' : ''}" href="#/classifieds?tab=${k}">${T(t)} (${num(all.filter(c => state(c) === k).length)})</a>`).join('')}</div>
      <div class="card">${list.map(c => { const [kn, ic, col] = KINDS[c.kind];
        return `<div class="item" style="align-items:flex-start"><span class="thumb" style="--c:${col}">${c.images?.[0] ? `<img src="${esc(c.images[0])}" alt="">` : icon(ic, 20)}</span>
        <div class="body"><b>${esc(c.title)}</b>${c.editedAt && c.review === 'pending' ? ` <span class="tag warn">${T('সম্পাদিত — আবার দেখুন')}</span>` : ''}
        <small>${T(kn)} · ${c.price ? money(c.price) + ' · ' : ''}${esc(c.area || '')} · ${esc(c.userName)} (${esc(c.phone)}) · ${date(c.t)}</small>
        ${c.description ? `<p>${esc(c.description.slice(0, 300))}</p>` : ''}${tab === 'live' ? `<small>${T('মেয়াদ')}: ${date(c.expires)} · ${T('{v} ভিউ', { v: num(c.views) })}</small>` : ''}
        ${c.images?.length || c.videos?.length ? `<small>${icon('image', 13)} ${num(c.images?.length || 0)} · ${icon('video', 13)} ${num(c.videos?.length || 0)}</small>` : ''}</div>
        <div class="acts">${tab !== 'live' ? `<select data-cldays="${c.id}" title="${T('কত দিন দেখাবে')}">${[7, 15, 30, 60].map(d => `<option value="${d}" ${d === 30 ? 'selected' : ''}>${T('{n} দিন', { n: num(d) })}</option>`).join('')}</select>
          <button class="btn sm" data-clreview="${c.id}|approved">${icon('check', 16)}${T('অনুমোদন')}</button>` : ''}
          ${tab === 'pending' || tab === 'live' ? `<button class="btn sm red" data-clreview="${c.id}|rejected">${T('বাতিল')}</button>` : ''}
          <button class="btn sm ghost" data-clview="${c.id}">${icon('eye', 16)}${T('দেখুন')}</button>
          ${tab === 'live' ? `<a class="iconbtn" href="/app/#/ad/${c.id}" target="_blank" title="${T('অ্যাপে দেখুন')}">${icon('external', 17)}</a>` : ''}
          <button class="iconbtn red" data-cldel="${c.id}" title="${T('মুছুন')}">${icon('trash', 18)}</button></div></div>`; }).join('') || empty(T('কিছু নেই'), '', 'megaphone')}</div>`);
  };
}
