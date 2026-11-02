/* Main pages: home, emergency, browse/search results, listing details. */
import { S } from './state.js';
import { adCard, adStrip, adsFor, withListAd } from './ads.js';
import { contactLines, ecard, empty, gcard, halalTag, isSaved, loadCoupons, media, nameT, nearList, openTag, promote, rateTag, rot, row, starsHtml, statusTag, topbar, walkText, wcard } from './components.js';
import { KINDS, PRICE_UNIT, STATUS, catName, catOf, dirUrl, fromWhere, getItem, hoursText, inArea, isOpen, isTown, items, km, kmText, mapUrl, origin, subIcon, subLabel, subName } from './data.js';
import { search } from './search.js';
import { ctxbar } from './sheets.js';
import { APP_UA, LANG, LOGO, T, api, areaName, esc, fmtDate, loc, ls, money, num, track } from './util.js';

/* ---------------- pages ---------------- */
export const pages = {};
function tabBody(it, tab, infoRows, related) {
  if (tab === 'info') return `<div class="info">${infoRows.map(([ic, l, v]) => `<div class="li"><span class="ib">${icon(ic, 18)}</span><div><small>${l}</small>${v}</div></div>`).join('')}</div>`;
  if (tab === 'reviews') {
    setTimeout(() => loadReviews(it), 0);
    return `<div data-rv><div class="boot" style="min-height:120px"><div class="spinner"></div></div></div>`;
  }
  const about = loc(it, 'about') || it.note;
  return `${it.contacts?.length ? `<div class="cbox"><h3>${icon('phone', 16)}${T('নম্বরসমূহ')}</h3>${contactLines(it)}</div>` : ''}
    ${about ? `<p class="prose">${esc(about)}</p>` : ''}
    ${videoBlock(it.videos)}
    ${it.features?.length ? `<div class="feat">${it.features.map(f => `<span>${icon('check', 15)}${esc(f)}</span>`).join('')}</div>` : ''}
    <div class="info" style="margin-top:16px">${infoRows.slice(0, 3).map(([ic, l, v]) => `<div class="li"><span class="ib">${icon(ic, 18)}</span><div><small>${l}</small>${v}</div></div>`).join('')}</div>
    ${adStrip('detail', it.cat)}
    ${related.length ? `<div class="sechead" style="margin-top:24px"><h2 style="font-size:16px">${T(it.cat === 'place' ? 'কাছাকাছি খাবার ও থাকা' : 'আরও দেখুন')}</h2></div>
      <div class="related">${related.map(x => `<a href="#/p/${esc(x.id)}">${media(x)}<small>${nameT(x, 13)}</small></a>`).join('')}</div>` : ''}`;
}
export async function loadReviews(it) {
  const box = document.querySelector('[data-rv]'); if (!box) return;
  let data;
  try { data = await api(`/listings/${it.id}/reviews`); } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  const rv = data.reviews, n = rv.length, avg = n ? rv.reduce((a, r) => a + r.stars, 0) / n : 0;
  const dist = [5, 4, 3, 2, 1].map(s => [s, rv.filter(r => r.stars === s).length]);
  const canReview = it.cat !== 'emergency' && !data.mine;
  box.innerHTML = `${n ? `<div class="rsum"><div class="big"><b>${num(avg.toFixed(1))}</b>${starsHtml(avg, 13)}<div class="muted" style="font-size:12px">${T('{n}টি রিভিউ', { n: num(n) })}</div></div>
    <div class="bars">${dist.map(([s, c]) => `<div class="bar">${num(s)}<i><u style="width:${n ? c / n * 100 : 0}%"></u></i></div>`).join('')}</div></div>` : ''}
    ${canReview ? `<button class="btn block ghost" style="margin-top:14px" data-writereview>${icon('edit', 18)}${S.ME ? T('রিভিউ লিখুন') : T('রিভিউ দিতে লগইন করুন')}</button>` : data.mine ? `<p class="muted" style="font-size:13px;margin:14px 0 0">${icon('check', 14)} ${T('আপনি রিভিউ দিয়েছেন')}</p>` : ''}
    <div style="margin-top:8px">${rv.map(r => `<div class="rv"><div class="who"><span class="av">${esc((r.name || '?')[0])}</span><div><b>${esc(r.name || T('ব্যবহারকারী'))}</b><small>${esc(fmtDate(r.t))}</small></div>${starsHtml(r.stars, 13)}</div>
      ${r.crit ? `<div class="crit">${Object.entries(r.crit).map(([k, v]) => `<span class="tag">${esc(T(k))} ${num(v)}/${num(5)}</span>`).join('')}</div>` : ''}
      ${r.text ? `<p>${esc(r.text)}</p>` : ''}${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy">` : ''}
      ${r.reply ? `<div class="reply"><b>${T('Jashore360 টিম / প্রতিষ্ঠানের উত্তর')}</b>${esc(r.reply)}</div>` : ''}
      <div class="acts"><button data-vote="${r.id}|1">${icon('thumb', 13)}${T('উপকারী')} ${r.up ? num(r.up) : ''}</button><button data-vote="${r.id}|0">${T('অনুপকারী')} ${r.down ? num(r.down) : ''}</button>
      <button data-reportrv="${r.id}">${icon('flag', 13)}${T('রিপোর্ট')}</button></div></div>`).join('') || (it.cat !== 'emergency' ? empty(T('এখনো রিভিউ নেই'), T('প্রথম রিভিউটি আপনিই দিন!'), '', 'msg') : '')}</div>`;
}
export const videoBlock = v => v?.length ? `<div class="videos">${v.map(u => `<video src="${esc(u)}" controls playsinline preload="metadata"></video>`).join('')}</div>` : '';
const DISC = {
  classified: ['classifiedDisclaimer', 'নিজ দায়িত্বে যাচাই করে চাকরি বা বাসা ভাড়া নিন। বিজ্ঞাপনদাতা বা বাড়ির মালিকের সাথে Jashore360-এর কোনো সম্পর্ক নেই। কোনো প্রতারণা বা ক্ষতি হলে Jashore360 দায়ী থাকবে না।'],
  listing: ['listingDisclaimer', 'তথ্য যাচাই করে নিজ দায়িত্বে সেবা নিন। প্রতিষ্ঠানের সেবা, দাম বা লেনদেনের জন্য Jashore360 দায়ী নয়।']
};
export const disclaimer = k => `<div class="note warn disc">${icon('shield', 16)}<span>${esc(loc(S.D.site, DISC[k][0]) || T(DISC[k][1]))}</span></div>`;

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  pages.home = () => {
    const site = S.D.site || {}, area = ls.get('area', '');
    const unseen = (S.D.notices || []).some(n => !ls.get('seenNotices', []).includes(n.id));
    const pop = pages.home.pop || '';
    const pool = items().filter(i => i.cat !== 'emergency' && (!pop || i.cat === pop));
    const ranked = promote(pool.slice().sort((a, b) => (!!b.featured - !!a.featured) || ((b.rating || 0) - (a.rating || 0)) || ((a.area === area) ? -1 : 0) || (!!a.demo - !!b.demo)), 2).slice(0, 6);
    const spons = promote(items().filter(i => i.sponsored && i.cat !== 'emergency'), 12);
    const o = origin();
    const near = o ? items().filter(i => i.lat != null && i.cat !== 'emergency').sort((a, b) => km(a) - km(b)).slice(0, 4) : [];
    const nearChips = [S.CAT.religious && ['religious', 'mosque', 'mosque', 'মসজিদ'], ['hospital', 'pharmacy', 'pill', 'ফার্মেসি'], ['hospital', '', 'hospital', 'হাসপাতাল'],
      ['restaurant', '', 'utensils', 'খাবার'], ['shop', '', 'bag', 'দোকান']].filter(Boolean);
    const places = items().filter(i => i.cat === 'place');
    const recent = ls.get('recent', []).map(getItem).filter(Boolean).slice(0, 3);
    const cats = S.D.categories.filter(c => c.id !== 'emergency');
    const short = c => LANG() === 'en' ? c.en : c.bn.split(' ')[0];
    const quick = [['ambulance', 'ambulance', 'অ্যাম্বুলেন্স'], ['hospital', 'hospital', 'হাসপাতাল'], ['police', 'shield', 'পুলিশ'], ['fire', 'flame', 'ফায়ার'], ['', 'phone', 'সব নম্বর']];
    const headline = esc(loc(site, 'headline') || T('যশোরের সবকিছু খুঁজুন এক জায়গায়')).replace(/(যশোর\S*|Jashore)/, '<span>$1</span>');
    const banners = adsFor('home');
    const counts = S.D.classifiedCounts || {};
    const update = APP_UA && S.D.app?.versionCode > +APP_UA[1];
    return `
    <header class="homebar"><a class="brandmark" href="#/" aria-label="Jashore360">${LOGO}</a>
      <button class="loc" data-areasheet><small>${T('আপনার এলাকা')}</small><b>${esc(area ? areaName(area) : T('পুরো যশোর'))}${icon('chevD', 16)}</b></button>
      <button class="roundbtn lang" data-lang aria-label="Language">${LANG() === 'bn' ? 'EN' : 'বাং'}</button>
      <button class="roundbtn" data-notices aria-label="${T('ঘোষণা ও আপডেট')}">${icon('bell', 20)}${unseen ? '<i class="dot"></i>' : ''}</button></header>
    ${update ? `<a class="note" href="/download/jashore360.apk" style="margin-top:12px">${icon('download', 18)}<span><b>${T('নতুন ভার্সন এসেছে')}</b> — ${T('আপডেট করতে চাপুন')} (v${esc(S.D.app.versionName)})</span></a>` : ''}
    <h1 class="headline">${headline}</h1>
    <div class="searchrow"><a class="search" href="#/search">${icon('search', 20)}<span>${T('খুঁজুন: হাসপাতাল, কাচ্চি, বাসা ভাড়া…')}</span></a>
      <button class="filterbtn" data-filter aria-label="${T('ফিল্টার')}">${icon('sliders', 20)}</button></div>

    ${banners.length ? `<div class="banners" data-carousel>${banners.map(b => adCard(b)).join('')}</div>
      ${banners.length > 1 ? `<div class="dots" data-dots>${banners.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}` : ''}

    <section class="emg">
      <div class="emg-top"><span class="ib">${icon('siren', 22)}</span><div><b>${T('জরুরি সহায়তা')}</b><small>${esc(loc(site, 'hotlineNote'))}</small></div>
        <a class="callpill" href="tel:${esc(site.hotline || '999')}">${icon('phone', 18)}${num(site.hotline || '999')}</a></div>
      <div class="emg-grid">${quick.map(([s, i, t]) => `<a href="${s === 'hospital' ? '#/c/hospital?sub=govt' : '#/emergency' + (s ? '?sub=' + s : '')}"><span>${icon(i, 22)}</span>${T(t)}</a>`).join('')}</div>
    </section>

    <section class="sec"><div class="sechead"><h2>${T('ক্যাটাগরি')}</h2><a href="#/explore">${T('সব দেখুন')}${icon('chevR', 14)}</a></div>
      <div class="cats">${cats.map(c => `<a class="catt" href="#/c/${c.id}"><span style="--c:${esc(c.color)}">${icon(c.icon, 26)}</span>${esc(short(c))}</a>`).join('')}</div></section>

    <section class="sec"><div class="sechead"><h2>${T('ভাড়া ও চাকরি')}</h2></div>
      <div class="ktiles">${Object.entries(KINDS).map(([k, v]) => `<a href="#/ads/${k}" style="--c:${v.color}"><span>${icon(v.icon, 22)}</span><b>${T(v.bn)}</b><small>${T('{n}টি বিজ্ঞাপন', { n: num(counts[k] || 0) })}</small></a>`).join('')}</div></section>

    ${S.ME?.coupons ? `<a class="note offerbar" href="#/account?tab=coupons" style="margin-top:14px">${icon('tag', 18)}<span><b>${T('আপনার জন্য {n}টি কুপন আছে', { n: num(S.ME.coupons) })}</b> — ${T('দেখুন')}</span></a>` : ''}
    ${Object.keys(S.D.offers || {}).length ? `<a class="bizcta offercta" href="#/offers"><span>${icon('tag', 22)}</span><div><b>${T('অফার ও কুপন')}</b><small>${T('{n}টি প্রতিষ্ঠানে অফার চলছে — কুপন নিয়ে ছাড় পান', { n: num(Object.keys(S.D.offers).length) })}</small></div>${icon('chevR', 18)}</a>` : ''}
    ${spons.length ? `<section class="sec"><div class="sechead"><h2>${T('প্রচারিত')}</h2><span class="tag ad">Sponsored</span></div>
      <div class="wcards">${spons.map(it => wcard(it, true)).join('')}</div></section>` : ''}

    <section class="sec"><div class="sechead"><h2>${T('জনপ্রিয়')}</h2><a href="#/${pop ? 'c/' + pop : 'search'}">${T('সব দেখুন')}${icon('chevR', 14)}</a></div>
      <div class="pills">${[{ id: '' }, ...cats].map(c => `<button class="pill ${pop === c.id ? 'on' : ''}" data-pop="${c.id}">${esc(c.id ? short(c) : T('সব'))}</button>`).join('')}</div>
      <div class="grid2">${ranked.map(gcard).join('') || `<p class="muted">${T('এই ক্যাটাগরিতে এখনো তথ্য নেই।')}</p>`}</div></section>

    ${adStrip('inline')}

    <section class="sec"><div class="sechead"><h2>${o && !o.gps ? T('{a}-এর কাছাকাছি', { a: esc(areaName(o.area)) }) : T('আপনার কাছাকাছি')}</h2>${S.here ? `<button class="linkbtn" data-locate>${icon('refresh', 14)} ${T('রিফ্রেশ')}</button>` : ''}</div>
      <div class="nearchips">${nearChips.map(([c, sub, ic, t]) => `<a href="#/c/${c}?${sub ? 'sub=' + sub + '&' : ''}sort=near"><span>${icon(ic, 20)}</span>${T(t)}</a>`).join('')}</div>
      ${o ? `<div class="rows">${near.map(row).join('')}</div>` :
        `<div class="locask"><button class="row" style="border:0;text-align:left" data-locate><span class="media" style="--c:#0e9f6e;width:52px;height:52px"><span class="gen"><span class="ring" style="width:70%">${icon('nav', 24)}</span></span></span>
        <span class="body"><b>${T('লোকেশন চালু করুন')}</b><span class="sub" style="white-space:normal">${T('কাছের মসজিদ, হাসপাতাল, ফার্মেসি দূরত্বসহ দেখুন')}</span></span></button>
        <button class="row" style="border:0;text-align:left" data-areasheet><span class="media" style="--c:#4f6bed;width:52px;height:52px"><span class="gen"><span class="ring" style="width:70%">${icon('pin', 24)}</span></span></span>
        <span class="body"><b>${T('অথবা এলাকা বাছুন')}</b><span class="sub" style="white-space:normal">${T('যেমন নিউমার্কেট — শুধু সেই এলাকার তথ্য দেখাবে')}</span></span></button></div>`}</section>

    ${places.length ? `<section class="sec"><div class="sechead"><h2>${T('যশোর ঘুরে দেখুন')}</h2><a href="#/c/place">${T('সব দেখুন')}${icon('chevR', 14)}</a></div>
      <div class="wcards">${places.map(wcard).join('')}</div></section>` : ''}

    ${recent.length ? `<section class="sec"><div class="sechead"><h2>${T('সম্প্রতি দেখেছেন')}</h2></div><div class="rows">${recent.map(row).join('')}</div></section>` : ''}

    <a class="bizcta" href="#/add"><span>${icon('store', 24)}</span><div><b>${T('আপনার ব্যবসা যুক্ত করুন')}</b><small>${T('হাজারো মানুষের কাছে পৌঁছান — অ্যাকাউন্ট খুলে শুরু করুন')}</small></div>${icon('chevR', 18)}</a>
    <p class="foot">${esc(loc(site, 'disclaimer'))}</p>`;
  };
  pages.emergency = p => {
    const c = S.CAT.emergency || { subs: {}, subIcons: {} }, sub = p.get('sub') || '', site = S.D.site || {};
    let list = items().filter(i => i.cat === 'emergency' && (!sub || i.sub === sub || (i.pin && ['ambulance', 'police', 'fire'].includes(sub))));
    if (sub === 'blood') list = items().filter(i => i.sub === 'bloodbank' || (i.cat === 'emergency' && i.sub === 'blood'));
    list.sort((a, b) => (!!b.pin - !!a.pin) || (!!b.phone - !!a.phone));
    return `<div class="redhead"><div class="bar"><button class="roundbtn" data-back aria-label="${T('ফিরে যান')}">${icon('back', 20)}</button><h1>${T('জরুরি সেবা')}</h1><span class="spacer" style="width:44px"></span></div>
      <a class="call" href="tel:${esc(site.hotline || '999')}"><span class="ib">${icon('phone', 24)}</span><div><b>${T('{n} এ কল করুন', { n: num(site.hotline || '999') })}</b><small>${esc(loc(site, 'hotlineNote'))}</small></div></a></div>
    <div class="pills" style="margin-top:18px">${[['', 'সব', 'grid'], ...Object.keys(c.subs || {}).map(k => [k, null, c.subIcons?.[k]])].map(([k, v, ic]) =>
      `<a class="pill sm ${k === sub ? 'on' : ''}" href="#/emergency${k ? '?sub=' + k : ''}">${ic ? icon(ic, 15) : ''}${esc(v ? T(v) : subName(c, k))}</a>`).join('')}</div>
    ${loc(site, 'snakeTip') && (!sub || sub === 'hotline') ? `<div class="note warn">${icon('alert', 16)}<span><b>${T('সাপে কামড়ালে:')}</b> ${esc(loc(site, 'snakeTip'))} <a href="#/search?q=snake" style="color:var(--brand);font-weight:600">${T('হাসপাতাল দেখুন')}</a></span></div>` : ''}
    ${sub === 'blood' ? `<div class="note">${icon('droplet', 16)}<span>${T('রক্তদাতা নেটওয়ার্ক শীঘ্রই আসছে। এখন প্রয়োজনে নিকটস্থ সরকারি হাসপাতালের ব্লাড ব্যাংকে যোগাযোগ করুন।')}</span></div>` : ''}
    ${sub === 'police' ? `<div class="note">${icon('shield', 16)}<span>${T('প্রতিটি থানার ওসি ও অন্যান্য কর্মকর্তার নম্বর — সরাসরি কল করুন। জরুরি হলে আগে ৯৯৯।')}</span></div>` : ''}
    <div class="rows">${list.map(i => i.contacts?.length ? ecard(i) : row(i)).join('') || empty(T('এখনো তথ্য যুক্ত হয়নি'), T('যাচাই করে শীঘ্রই যুক্ত করা হবে।'))}</div>
    <p class="foot">${esc(loc(site, 'disclaimer'))}</p>`;
  };
  pages.browse = p => {
    const qtext = p.get('q') || '', cat = p.get('cat') || '', sub = p.get('sub') || '', open = !!p.get('open'), budget = +p.get('budget') || 0, sort = p.get('sort') || '';
    const c = S.CAT[cat];
    let list, intent = null;
    if (qtext) ({ list, intent } = search(qtext)); else list = items().filter(i => cat ? i.cat === cat : i.cat !== 'emergency');
    if (cat && qtext) list = list.filter(i => i.cat === cat);
    if (sub) list = list.filter(i => i.sub === sub);
    if (open || intent?.open) list = list.filter(i => isOpen(i) === true);
    const bud = budget || intent?.budget;
    if (bud) list = list.filter(i => !i.price || i.price <= bud);
    const halal = !!p.get('halal') || intent?.halal;
    if (halal) list = list.filter(i => i.halal);
    const area = ls.get('area', ''), total = list.length;
    // For "nearby" categories (mosques, hospitals) the chosen area is where distances start, not a filter.
    // Nearby views (mosques, hospitals, or any "near me" search): the area/location is where distances start, not a filter.
    const nearMode = !!(origin() && (sort === 'near' || (intent?.near && !sort) || (c?.near && !qtext && !sort)));
    const beforeArea = list;
    if (area && !nearMode) list = list.filter(i => inArea(i, area));
    // Paid promotion is not limited by the chosen area: up to two sponsored matches from elsewhere still lead the list.
    const extraSpons = area && !nearMode ? beforeArea.filter(i => i.sponsored && !list.includes(i)).sort((a, b) => rot(a.id) - rot(b.id)).slice(0, 2) : [];
    const nearSort = sort === 'near' || intent?.near || nearMode;
    if (sort === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else if (nearSort) list.sort((a, b) => (km(a) ?? 1e9) - (km(b) ?? 1e9));
    else if (!qtext) list.sort((a, b) => (!!b.sponsored - !!a.sponsored) || (!!b.featured - !!a.featured) || ((b.area === area) - (a.area === area)) ||
      ((a.status === 'closed') - (b.status === 'closed')) || (!!a.demo - !!b.demo) || (b.rating || 0) - (a.rating || 0));
    if (cat !== 'emergency') list = promote([...extraSpons, ...list]);
    // A small town locality may have little listed yet: the rest of Jashore town follows, so the page is never a dead end.
    const moreTown = area && !nearMode && isTown(area) && list.length < 8
      ? beforeArea.filter(i => !list.includes(i) && inArea(i, 'যশোর সদর')).sort((a, b) => (!!b.featured - !!a.featured) || (b.rating || 0) - (a.rating || 0)).slice(0, 30) : [];
    const active = !!(open || budget || sort || halal || cat && qtext);
    const link = o => { const np = new URLSearchParams(p); Object.entries(o).forEach(([k, v]) => v ? np.set(k, v) : np.delete(k)); return (c && !qtext ? `#/c/${cat}` : '#/search') + (np.toString() ? '?' + np : ''); };
    const title = qtext ? T('খুঁজুন') : c ? catName(c) : T('সব তথ্য');
    const hist = ls.get('hist', []);
    if (qtext && !hist.includes(qtext)) ls.set('hist', [qtext, ...hist].slice(0, 8));
    const kindHit = intent?.kind || null;
    return `${topbar(title, `<button class="roundbtn" data-filter aria-label="${T('ফিল্টার')}">${icon('sliders', 20)}</button>`)}
      <div class="searchrow" style="margin-bottom:14px"><form class="search" data-search>${icon('search', 20)}<input name="q" type="search" value="${esc(qtext)}" placeholder="${c ? T('{c}-এ খুঁজুন', { c: esc(catName(c)) }) : T('যশোরে কী খুঁজছেন?')}" enterkeyhint="search" autocomplete="off" ${!qtext && !c ? 'autofocus' : ''}>
        ${qtext ? `<button type="button" class="clear" data-clear aria-label="${T('মুছুন')}">${icon('x', 16)}</button>` : ''}</form>
        <button class="filterbtn" data-filter aria-label="${T('ফিল্টার')}">${icon('sliders', 20)}${active ? '<i class="dot"></i>' : ''}</button></div>
      ${c ? adStrip('category', cat) : ''}
      ${c && Object.keys(c.subs || {}).length ? `<div class="pills"><a class="pill sm ${!sub ? 'on' : ''}" href="${link({ sub: '' })}">${T('সব')}</a>${Object.keys(c.subs).map(k =>
        `<a class="pill sm ${k === sub ? 'on' : ''}" href="${link({ sub: k })}">${esc(subName(c, k))}</a>`).join('')}</div>` : ''}
      ${kindHit ? `<a class="row" href="#/ads/${kindHit}" style="margin-bottom:12px"><span class="media" style="--c:${KINDS[kindHit].color};width:56px;height:56px"><span class="gen"><span class="ring" style="width:70%">${icon(KINDS[kindHit].icon, 24)}</span></span></span>
        <span class="body"><b>${T(KINDS[kindHit].bn)}</b><span class="sub">${T('{n}টি বিজ্ঞাপন', { n: num(S.D.classifiedCounts?.[kindHit] || 0) })}</span></span><span class="act">${icon('chevR', 18)}</span></a>` : ''}
      ${intent && (intent.cats.size || intent.open || intent.budget || intent.near || intent.halal) ? `<div class="pills">${[...intent.cats].map(id => S.CAT[id] ?
        `<a class="pill sm on" href="#/c/${id}${intent.sub && S.CAT[id].subs?.[intent.sub] ? '?sub=' + intent.sub : ''}">${icon(S.CAT[id].icon, 15)}${esc(catName(S.CAT[id]))}</a>` : '').join('')}
        ${intent.open ? `<span class="pill sm">${T('এখন খোলা')}</span>` : ''}${intent.halal ? `<span class="pill sm">${icon('halal', 14)}${T('হালাল')}</span>` : ''}${intent.budget ? `<span class="pill sm">${T('{n} পর্যন্ত', { n: money(intent.budget) })}</span>` : ''}
        ${intent.near ? (S.here ? `<span class="pill sm">${T('কাছাকাছি')}</span>` : `<button class="pill sm" data-locate>${icon('nav', 14)}${T('লোকেশন দিন')}</button>`) : ''}</div>` : ''}
      ${!qtext && !c ? (hist.length ? `<div class="sechead"><h2 style="font-size:15px">${T('সাম্প্রতিক সার্চ')}</h2><button class="linkbtn" data-clearhist>${T('মুছুন')}</button></div>
        <div class="pills wrap">${hist.map(h => `<a class="pill sm" href="#/search?q=${encodeURIComponent(h)}">${icon('clock', 14)}${esc(h)}</a>`).join('')}</div>` : '')
        + `<div class="sechead" style="margin-top:8px"><h2 style="font-size:15px">${T('জনপ্রিয় সার্চ')}</h2></div><div class="pills wrap">${['কাছাকাছি হাসপাতাল', 'আজ খোলা ফার্মেসি', '২০০ টাকার মধ্যে রেস্টুরেন্ট', 'কাচ্চি', 'বাসা ভাড়া', 'মোবাইল সার্ভিসিং', 'হোটেল']
          .map(s => `<a class="pill sm" href="#/search?q=${encodeURIComponent(T(s))}">${esc(T(s))}</a>`).join('')}</div>` : ''}
      ${qtext || c || active ? `${ctxbar(list.length, total, nearMode)}
      ${nearSort && !origin() ? `<div class="note">${icon('nav', 18)}<span>${T('দূরত্ব দেখতে লোকেশন চালু করুন বা এলাকা বাছুন।')} <button class="linkbtn" data-locate>${T('লোকেশন দিন')}</button> · <button class="linkbtn" data-areasheet>${T('এলাকা বাছুন')}</button></span></div>` : ''}
      ${['restaurant', 'shop'].includes(cat) && !halal ? `<a class="pill sm" style="margin:0 0 10px" href="${link({ halal: '1' })}">${icon('halal', 14)}${T('শুধু হালাল দেখুন')}</a>` : ''}
      ${halal ? `<a class="pill sm on" style="margin:0 0 10px" href="${link({ halal: '' })}">${icon('halal', 14)}${T('শুধু হালাল')} ${icon('x', 12)}</a>` : ''}
      <div class="count"><span>${T('{n}টি ফলাফল', { n: num(list.length) })}</span><select data-sort aria-label="${T('সাজানো')}">${[['', 'প্রাসঙ্গিক'], ['rating', 'সেরা রেটিং'], ['near', 'কাছাকাছি']]
        .map(([k, v]) => `<option value="${k}" ${sort === k ? 'selected' : ''}>${T(v)}</option>`).join('')}</select></div>
      ${nearMode ? nearList(list) : `<div class="rows">${withListAd(list.map(row), cat) || (kindHit || moreTown.length ? '' : empty(T('কিছু পাওয়া যায়নি'), T('অন্য শব্দে খুঁজুন বা ফিল্টার বদলান।'), `<a class="btn sm" href="#/add">${T('নতুন তথ্য যোগ করুন')}</a>`))}</div>
        ${moreTown.length ? `<div class="sechead" style="margin-top:18px"><h2 style="font-size:15px">${T(list.length ? 'যশোর শহরের আরও' : '{a}-তে এখনো যোগ হয়নি — যশোর শহরের অন্যগুলো', { a: areaName(area) })}</h2></div>
          <div class="rows">${moreTown.map(row).join('')}</div>` : ''}`}` : ''}`;
  };
  pages.item = ([id]) => {
    const it = getItem(id);
    if (it && it.id !== id) { location.replace('#/p/' + it.id); return ''; }
    if (!it) return `${topbar('')}${empty(T('পাওয়া যায়নি'), T('তথ্যটি সরানো হয়েছে বা লিংক ভুল।'), `<a class="btn sm" href="#/">${T('হোমে ফিরুন')}</a>`)}`;
    if (pages.item.last !== id) { track(id, 'view'); pages.item.last = id; pages.item.tab = 'about'; }
    if (S.D.offers?.[it.id] || S.ME) setTimeout(() => loadCoupons(it.id), 0);
    const c = catOf(it), d = km(it), tab = pages.item.tab || 'about', imgs = it.images || [];
    const rec = ls.get('recent', []).filter(x => x !== id); ls.set('recent', [id, ...rec].slice(0, 12));
    const related = items().filter(x => x.id !== id && (it.cat === 'place' ? ['restaurant', 'hotel'].includes(x.cat) && x.lat != null && it.lat != null : x.cat === it.cat))
      .map(x => ({ x, d: it.lat != null && x.lat != null ? Math.hypot(x.lat - it.lat, x.lng - it.lng) : 9 })).sort((a, b) => a.d - b.d).slice(0, 8).map(o => o.x);
    const infoRows = [
      (it.address || it.area) && ['pin', T('ঠিকানা'), esc([it.address, areaName(it.area), T('যশোর')].filter(Boolean).join(', ')) + (d != null ? ` <span class="muted">· ${kmText(d)} ${esc(fromWhere())}</span>` : '')],
      ['clock', T('সময়সূচি'), hoursText(it)],
      it.phone && ['phone', T('ফোন'), `<a href="tel:${esc(it.phone)}" data-call-track="${esc(id)}">${num(it.phone)}</a>${it.phone2 ? ` · <a href="tel:${esc(it.phone2)}">${num(it.phone2)}</a>` : ''}`],
      it.web && ['globe', T('ওয়েবসাইট'), `<a href="${esc(it.web)}" target="_blank" rel="noopener nofollow">${esc(it.web.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))}</a>`],
      it.facebook && ['facebook', T('ফেসবুক'), `<a href="${esc(it.facebook)}" target="_blank" rel="noopener nofollow">${T('পেজ দেখুন')}</a>`],
      ['shield', T('তথ্যের অবস্থা'), `${T(STATUS[it.status]?.[0] || '')}${it.verifiedAt ? ` · ${T('সর্বশেষ যাচাই')} ${esc(fmtDate(it.verifiedAt))}` : ''}`]
    ].filter(Boolean);
    return `<div class="detail">
      <div class="hero" style="--c:${esc(c.color)}">${imgs.length ? `<div class="media"><div class="slides" data-slides>${imgs.map(u => `<img src="${esc(u)}" alt="">`).join('')}</div></div>` : media(it)}
        <div class="hbar"><button class="roundbtn" data-back aria-label="${T('ফিরে যান')}">${icon('back', 20)}</button><button class="roundbtn" data-share="${esc(id)}" aria-label="${T('শেয়ার')}">${icon('share', 19)}</button></div>
        ${imgs.length > 1 ? `<div class="dots" data-dots>${imgs.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}</div>
      <div class="sheet-body">
        <div class="dtitle"><h1>${nameT(it, 24)}</h1>${it.price ? `<div class="price"><b>${money(it.price)}</b><small>${T(PRICE_UNIT[it.cat] || 'আনুমানিক')}</small></div>` : ''}</div>
        <div class="dsub">${icon(subIcon(it), 15)}${esc(subLabel(it))}${it.area ? ` · ${esc(areaName(it.area))}` : ''}${it.rating ? ` · ${rateTag(it)}` : ''}</div>
        <div data-coupons></div>
        <div class="dtags">${d != null ? `<a class="tag dist" href="${esc(dirUrl(it))}" target="_blank" rel="noopener" data-map="${esc(id)}">${icon('nav', 12)}${kmText(d)} ${T('দূরে')} · ${walkText(d)}</a>` : ''}${statusTag(it)}${openTag(it)}${halalTag(it)}${it.sponsored ? '<span class="tag ad">Sponsored</span>' : ''}${it.demo ? `<span class="tag">${T('নমুনা তথ্য')}</span>` : ''}</div>
        ${it.demo ? `<div class="note warn">${icon('info', 16)}<span>${T('এটি নমুনা তথ্য, বাস্তব প্রতিষ্ঠান নয়।')}</span></div>` : ''}
        ${!it.phone && it.cat === 'emergency' ? `<div class="note red">${icon('alert', 16)}<span>${T('স্থানীয় নম্বর যাচাই চলছে। জরুরি প্রয়োজনে ৯৯৯ এ কল করুন।')}</span></div>` : ''}
        <div class="tabs">${[['about', T('বিবরণ')], ['info', T('তথ্য')], ['reviews', T('রিভিউ') + (it.reviews ? ` (${num(it.reviews)})` : '')]].map(([k, v]) =>
          `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${v}</button>`).join('')}</div>
        <div data-tabbody>${tabBody(it, tab, infoRows, related)}</div>
        ${disclaimer('listing')}
        <button class="reportlink" data-report="${esc(id)}">${icon('flag', 14)}${T('তথ্য ভুল বা পুরনো? জানান')}</button>
        <div style="height:24px"></div>
      </div></div>
      <div class="actionbar"><button class="sq ${isSaved(id) ? 'on' : ''}" data-save="${esc(id)}" aria-label="${T('সেভ')}">${icon('heart', 22)}</button>
        <a class="sq" href="${dirUrl(it)}" target="_blank" rel="noopener" data-map="${esc(id)}" aria-label="${T('দিকনির্দেশ')}">${icon('nav', 21)}</a>
        ${it.phone ? `<a class="btn block ${it.cat === 'emergency' ? 'red' : 'dark'}" href="tel:${esc(it.phone)}" data-call-track="${esc(id)}">${icon('phone', 19)}${T('কল করুন')}</a>`
          : `<a class="btn block dark" href="${mapUrl(it)}" target="_blank" rel="noopener" data-map="${esc(id)}">${icon('map', 19)}${T('ম্যাপে দেখুন')}</a>`}</div>`;
  };
}
