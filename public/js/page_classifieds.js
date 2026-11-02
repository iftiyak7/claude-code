/* Jobs, rents, mess and tuition ads. */
import { adStrip } from './ads.js';
import { crow, empty, media, topbar } from './components.js';
import { KINDS, dirUrl, fromWhere, inArea, km, kmText, optLabel } from './data.js';
import { disclaimer, pages, videoBlock } from './pages.js';
import { render } from './router.js';
import { ctxbar } from './sheets.js';
import { T, api, areaName, esc, fmtDate, ls, money, num, toast } from './util.js';

/* ---------------- classifieds ---------------- */
export const cache = { ads: {} };
async function loadKind(kind) {
  cache.ads[kind] = await api('/classifieds?kind=' + kind);
  if (location.hash.startsWith('#/ads/' + kind)) render();
}

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  pages.ads = ([kind], p) => {
    const k = KINDS[kind]; if (!k) return pages.notfound();
    const list = cache.ads[kind];
    if (!list) loadKind(kind).catch(e => toast(e.message));
    const area = ls.get('area', ''), sort = p.get('sort') || '';
    const rows = (list || []).filter(a => inArea(a, area));
    if (sort === 'low') rows.sort((a, b) => (a.price || 1e12) - (b.price || 1e12));
    if (sort === 'high') rows.sort((a, b) => (b.price || 0) - (a.price || 0));
    if (sort === 'near') rows.sort((a, b) => (km(a) ?? 1e9) - (km(b) ?? 1e9));
    return `${topbar(T(k.bn), `<a class="roundbtn" href="#/post/${kind}" aria-label="${T('বিজ্ঞাপন দিন')}">${icon('plus', 20)}</a>`)}
      <div class="pills">${Object.entries(KINDS).map(([x, v]) => `<a class="pill sm ${x === kind ? 'on' : ''}" href="#/ads/${x}">${icon(v.icon, 15)}${T(v.bn)}</a>`).join('')}</div>
      ${adStrip('classifieds')}
      ${list ? ctxbar(rows.length, list.length) : ''}
      <div class="count"><span>${T('{n}টি বিজ্ঞাপন', { n: num(rows.length) })}</span>
        <select data-adsort aria-label="${T('সাজানো')}">${[['', 'নতুন আগে'], ['low', 'কম দাম আগে'], ['high', 'বেশি দাম আগে'], ['near', 'কাছাকাছি']].map(([x, v]) => `<option value="${x}" ${x === sort ? 'selected' : ''}>${T(v)}</option>`).join('')}</select></div>
      ${!list ? '<div class="boot" style="min-height:160px"><div class="spinner"></div></div>' : `<div class="rows">${rows.map(crow).join('') ||
        (area && list.length ? empty(T('{a}-এ এখনো কোনো বিজ্ঞাপন নেই', { a: esc(areaName(area)) }), T('অন্য এলাকা বা পুরো যশোর দেখুন।'), `<button class="btn sm" data-clrarea>${T('পুরো যশোর দেখুন')}</button>`, k.icon)
        : empty(T('এখনো কোনো বিজ্ঞাপন নেই'), T('প্রথম বিজ্ঞাপনটি আপনিই দিন — সম্পূর্ণ ফ্রি।'), `<a class="btn sm" href="#/post/${kind}">${T('বিজ্ঞাপন দিন')}</a>`, k.icon))}</div>`}
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
      : a.kind === 'tuition' ? [['info', 'ধরন', a.tuitionType && optLabel('tuitionType', a.tuitionType)], ['cap', 'বিষয়', a.subject], ['layers', 'শ্রেণি', a.classLevel],
        ['globe', 'মাধ্যম', a.medium && optLabel('medium', a.medium)], ['users', 'শিক্ষার্থী', a.students && num(a.students)], ['calendar', 'সপ্তাহে', a.daysPerWeek && T('{n} দিন', { n: num(a.daysPerWeek) })],
        ['user', 'শিক্ষক', a.tutorGender && optLabel('tutorGender', a.tutorGender)], ['star', 'যোগ্যতা', a.qualification]]
      : [['bed', 'সিটের ধরন', optLabel('seatType', a.seatType)], ['users', 'কাদের জন্য', a.gender && optLabel('gender', a.gender)], ['grid', 'খালি সিট', a.seats && num(a.seats)],
        ['calendar', 'কবে থেকে', a.availableFrom && fmtDate(a.availableFrom)], ['check', 'সুবিধা', a.facilities]]).filter(f => f[2]);
    const dist = km(a), hasMap = a.lat != null || a.mapUrl;
    const wa = a.whatsapp || a.phone;
    return `<div class="detail">
      <div class="hero" style="--c:${k.color}">${imgs.length ? `<div class="media"><div class="slides" data-slides>${imgs.map(u => `<img src="${esc(u)}" alt="">`).join('')}</div></div>` : media(a, '', k.color, k.icon)}
        <div class="hbar"><button class="roundbtn" data-back aria-label="${T('ফিরে যান')}">${icon('back', 20)}</button><button class="roundbtn" data-sharead="${esc(id)}" aria-label="${T('শেয়ার')}">${icon('share', 19)}</button></div>
        ${imgs.length > 1 ? `<div class="dots" data-dots>${imgs.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}</div>
      <div class="sheet-body">
        <div class="dtitle"><h1>${esc(a.title)}</h1>${a.price ? `<div class="price"><b>${money(a.price)}</b><small>${T(a.kind === 'job' ? 'বেতন' : a.kind === 'tuition' ? 'সম্মানী / মাস' : 'প্রতি মাসে')}</small></div>` : ''}</div>
        <div class="dsub">${icon(k.icon, 15)}${T(k.bn)}${a.area ? ` · ${esc(areaName(a.area))}` : ''}${dist != null ? ` · ${kmText(dist)} ${esc(fromWhere())}` : ''} · ${esc(fmtDate(a.t))}</div>
        ${a.description ? `<p class="prose" style="margin-top:16px">${esc(a.description)}</p>` : ''}
        ${videoBlock(a.videos)}
        <div class="info" style="margin-top:12px">${facts.map(([ic, l, v]) => `<div class="li"><span class="ib">${icon(ic, 18)}</span><div><small>${T(l)}</small>${esc(v)}</div></div>`).join('')}
          ${a.address || a.area ? `<div class="li"><span class="ib">${icon('pin', 18)}</span><div><small>${T('ঠিকানা')}</small>${esc([a.address, areaName(a.area)].filter(Boolean).join(', '))}</div></div>` : ''}
          <div class="li"><span class="ib">${icon('user', 18)}</span><div><small>${T('যোগাযোগ')}</small>${esc(a.contactName || '')} <a href="tel:${esc(a.phone)}">${num(a.phone)}</a></div></div></div>
        ${disclaimer('classified')}
        <button class="reportlink" data-reportad="${esc(id)}">${icon('flag', 14)}${T('ভুয়া বা আপত্তিকর বিজ্ঞাপন? রিপোর্ট করুন')}</button>
        <div style="height:24px"></div></div></div>
      <div class="actionbar"><a class="sq" href="https://wa.me/88${esc(wa)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('msg', 21)}</a>
        ${hasMap ? `<a class="sq" href="${esc(a.lat != null ? dirUrl(a) : a.mapUrl)}" target="_blank" rel="noopener" aria-label="${T('দিকনির্দেশ')}">${icon('nav', 21)}</a>` : ''}
        <a class="btn block dark" href="tel:${esc(a.phone)}">${icon('phone', 19)}${T('কল করুন')}</a></div>`;
  };
}
