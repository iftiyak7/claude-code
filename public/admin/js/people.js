/* Users, reviews and reports. */
import { pages } from './dashboard.js';
import { empty, load } from './data.js';
import { shell } from './shell.js';
import { S, T, api, date, esc, num } from './util.js';

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  /* ---------------- users ---------------- */
  pages.users = async (_, p) => {
    const all = await api('/admin/users'), q = (p.get('q') || '').toLowerCase();
    const list = all.filter(u => !q || (u.name + ' ' + (u.phone || '') + ' ' + (u.email || '')).toLowerCase().includes(q));
    shell('users', T('ব্যবহারকারী'), '', `<form class="toolbar" data-userq><label class="search">${icon('search', 18)}<input name="q" value="${esc(p.get('q') || '')}" placeholder="${T('নাম বা মোবাইল দিয়ে খুঁজুন')}"></label></form>
      <div class="card tablewrap">${list.length ? `<table class="t"><thead><tr><th>${T('নাম')}</th><th>${T('মোবাইল')}</th><th>${T('যোগ দিয়েছেন')}</th><th>${T('ব্যবসা / বিজ্ঞাপন / রিভিউ')}</th><th></th></tr></thead><tbody>
        ${list.map(u => `<tr><td><span class="name"><span class="thumb" style="--c:#0e9f6e">${esc(u.name[0])}</span><span><b>${esc(u.name)}</b>${u.banned ? ` <span class="tag bad">${T('বন্ধ')}</span>` : ''}${u.google ? ' <span class="tag">Google</span>' : ''}${u.email ? `<small class="muted" style="display:block">${esc(u.email)}</small>` : ''}</span></span></td>
          <td data-l="${T('মোবাইল')}">${u.phone ? `<a href="tel:${esc(u.phone)}">${esc(u.phone)}</a>` : '—'}</td><td data-l="${T('যোগ দিয়েছেন')}">${date(u.created_at)}</td>
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
}
