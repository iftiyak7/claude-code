/* Sign-in, account, the user's listings, ads and coupons. */
import { S } from './state.js';
import { empty, media, ticket, topbar } from './components.js';
import { KINDS, subLabel } from './data.js';
import { cache } from './page_classifieds.js';
import { pages } from './pages.js';
import { go, render } from './router.js';
import { LOGO, T, api, esc, fmtDate, num, toast } from './util.js';

const STATE = { pending: ['যাচাইয়ের অপেক্ষায়', 'warn'], approved: ['প্রকাশিত', 'ok'], rejected: ['বাতিল', 'bad'], unpaid: ['পেমেন্ট বাকি', 'bad'],
  payment_review: ['পেমেন্ট যাচাই চলছে', 'warn'], payment_rejected: ['পেমেন্ট বাতিল — আবার দিন', 'bad'], expired: ['মেয়াদ শেষ', 'bad'] };
const CPST = { active: ['চালু', 'ok'], pending: ['অনুমোদনের অপেক্ষায়', 'warn'], paused: ['বন্ধ রাখা', 'bad'], rejected: ['বাতিল', 'bad'] };
function couponsTab() {
  const c = cache.mycp;
  if (!c || pages.account.cpStale) { pages.account.cpStale = false; api('/my/coupons').then(r => { cache.mycp = r; if (location.hash.includes('tab=coupons')) render(); }).catch(e => toast(e.message)); }
  if (!c) return '<div class="boot" style="min-height:160px"><div class="spinner"></div></div>';
  const mine = c.mine.slice().sort((a, b) => (a.used - b.used) || (b.live - a.live));
  let html = `<h4 style="margin:0 0 10px">${T('আমার কুপন')}</h4>` + (mine.length ? `<div class="tklist">${mine.map(m =>
    ticket({ id: m.coupon, title: m.title, details: m.details, ends: m.ends, listing: m.listing, listingName: m.listingName }, { claimed: m, listingLink: true })
      .replace('class="ticket', `class="ticket${!m.live && !m.used ? ' used' : ''}`)).join('')}</div>`
    : empty(T('এখনো কোনো কুপন নেননি'), '', `<a class="btn sm" href="#/offers">${T('অফার দেখুন')}</a>`, 'tag'));
  if (c.listings.length) {
    const cp = pages.account.check;
    html += `<h4 style="margin:26px 0 10px">${T('কুপন যাচাই (আপনার দোকানে)')}</h4>
      <form class="form verify" data-cpcheck><div class="locpick"><input name="code" placeholder="J360-XXXXXX" autocapitalize="characters" autocomplete="off" required>
        <button class="btn sm" type="submit">${T('যাচাই')}</button></div></form>
      ${cp ? `<div class="cpresult ${cp.state}"><b>${T({ ok: 'বৈধ কুপন ✓', used: 'আগেই ব্যবহৃত', expired: 'মেয়াদ শেষ' }[cp.state])}</b>
        <div>${esc(cp.title)} · ${esc(cp.code)}</div><small>${T('গ্রাহক')}: ${esc(cp.customer)} (${esc(num(cp.phone))})</small>
        ${cp.state === 'ok' ? `<button class="btn block" data-cpredeem="${esc(cp.code)}" style="margin-top:10px">${icon('check', 16)}${T('ব্যবহৃত হিসেবে চিহ্নিত করুন')}</button>` : ''}</div>` : ''}
      <h4 style="margin:26px 0 10px">${T('আমার ব্যবসার অফার')}</h4>
      ${c.business.map(b => { const [t, k] = CPST[b.status] || CPST.pending;
        return `<div class="row" style="align-items:flex-start"><span class="media" style="--c:#f59e0b;width:52px;height:52px"><span class="gen"><span class="ring" style="width:70%">${icon('tag', 22)}</span></span></span>
          <div class="body"><b>${esc(b.title)}</b><div class="sub">${esc(b.listingName || '')}${b.ends ? ' · ' + T('{d} পর্যন্ত', { d: fmtDate(b.ends) }) : ''}</div>
          <div class="meta"><span class="tag ${k}">${T(t)}</span>${b.audience === 'private' ? `<span class="tag">${T('নির্দিষ্ট গ্রাহক')}</span>` : ''}
            <span class="muted">${T('{c} জন নিয়েছেন · {u} জন ব্যবহার করেছেন', { c: num(b.claims), u: num(b.used) })}</span></div>
          ${b.createdBy === 'owner' ? `<div style="display:flex;gap:8px;margin-top:8px">${b.status === 'active' ? `<button class="btn sm ghost" data-cpstatus="${b.id}|paused">${T('বন্ধ রাখুন')}</button>`
            : b.status === 'paused' ? `<button class="btn sm ghost" data-cpstatus="${b.id}|active">${T('চালু করুন')}</button>` : ''}
            <button class="btn sm ghost" data-cpstatus="${b.id}|deleted">${T('মুছুন')}</button></div>` : ''}</div></div>`; }).join('') || `<p class="muted">${T('এখনো কোনো অফার দেননি।')}</p>`}
      <form class="form cpnew" data-cpnew><h4 style="margin:6px 0 0">${T('নতুন অফার দিন')}</h4>
        <label class="field"><span>${T('প্রতিষ্ঠান')}</span><select name="listing">${c.listings.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</select></label>
        <label class="field"><span>${T('অফার')} *</span><input name="title" required maxlength="120" placeholder="${T('যেমন: সব খাবারে ২০% ছাড়')}"></label>
        <label class="field"><span>${T('বিস্তারিত / শর্ত')}</span><input name="details" maxlength="600" placeholder="${T('যেমন: ৫০০ টাকার বেশি অর্ডারে')}"></label>
        <div class="two"><label class="field"><span>${T('শেষ তারিখ')}</span><input name="ends" type="date"></label>
          <label class="field"><span>${T('কতজন নিতে পারবে')}</span><input name="maxClaims" inputmode="numeric" placeholder="${T('খালি = সীমা নেই')}"></label></div>
        <button class="btn block" type="submit">${T('অফার জমা দিন')}</button>
        <p class="muted" style="font-size:12.5px;margin:0">${T('অ্যাডমিন অনুমোদনের পর আপনার প্রতিষ্ঠানের পেজে দেখাবে।')}</p></form>`;
  }
  return html;
}

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  /* ---------------- account ---------------- */
  pages.login = (_, p) => {
    if (S.ME) { go('#' + (p.get('next') || '/account')); return ''; }
    const mode = p.get('mode') || 'login';
    return `${topbar(T(mode === 'login' ? 'লগইন' : 'অ্যাকাউন্ট খুলুন'))}
      <div class="authcard"><span class="brandmark">${LOGO}</span><h2>${T(mode === 'login' ? 'আবার স্বাগতম!' : 'নতুন অ্যাকাউন্ট')}</h2>
        <p class="muted">${T('রিভিউ দিতে, ব্যবসা যুক্ত করতে ও বিজ্ঞাপন দিতে অ্যাকাউন্ট লাগবে।')}</p></div>
      <div class="seg" style="margin:18px 0">${[['login', 'লগইন'], ['register', 'অ্যাকাউন্ট খুলুন']].map(([k, v]) =>
        `<button class="${mode === k ? 'on' : ''}" data-authmode="${k}" style="flex:1">${T(v)}</button>`).join('')}</div>
      <form class="form" data-auth="${mode}">
        ${mode === 'register' ? `<label class="field"><span>${T('আপনার নাম')}</span><input name="name" required maxlength="60" autocomplete="name"></label>` : ''}
        <label class="field"><span>${T('মোবাইল নম্বর')}</span><input name="phone" required inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXXX"></label>
        <label class="field"><span>${T('পাসওয়ার্ড')}</span><input name="password" type="password" required minlength="${mode === 'login' ? 6 : 8}" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">
          ${mode === 'register' ? `<em class="muted" style="font-size:12px;font-style:normal">${T('কমপক্ষে ৮ অক্ষর')}</em>` : ''}</label>
        ${mode === 'register' ? `<label class="check"><input type="checkbox" name="terms" required><span>${T('আমি Jashore360-এর {t} পড়েছি ও সম্মত', { t: `<a href="#/terms" style="color:var(--brand);font-weight:700">${T('শর্তাবলি')}</a>` })}</span></label>` : ''}
        <button class="btn block" type="submit">${T(mode === 'login' ? 'লগইন' : 'অ্যাকাউন্ট খুলুন')}</button>
        ${mode === 'login' ? `<p class="muted" style="font-size:13px;text-align:center;margin:0">${T('পাসওয়ার্ড ভুলে গেলে আমাদের সাথে যোগাযোগ করুন')}${S.D.site?.contactPhone ? ` — <a href="tel:${esc(S.D.site.contactPhone)}">${num(S.D.site.contactPhone)}</a>` : ''}</p>` : ''}
      </form>`;
  };
  pages.account = (_, p) => {
    if (!S.ME) { go('#/login?next=/account'); return ''; }
    const tab = p.get('tab') || 'biz', my = cache.my;
    if (!my || pages.account.stale) { pages.account.stale = false; api('/my').then(r => { cache.my = r; if (location.hash.startsWith('#/account')) render(); }).catch(e => toast(e.message)); }
    const soon = l => l.paidUntil && (new Date(l.paidUntil) - Date.now()) / 864e5 < 30;
    let body = '<div class="boot" style="min-height:160px"><div class="spinner"></div></div>';
    if (my && tab === 'biz') body = my.listings.length ? `<div class="rows">${my.listings.map(l => { const [t, k] = STATE[l.state] || STATE.pending;
      return `<div class="row" style="align-items:flex-start">${media(l)}<div class="body"><b>${esc(l.name)}</b><div class="sub">${esc(subLabel(l))}${l.paidUntil ? ' · ' + T('মেয়াদ {d} পর্যন্ত', { d: fmtDate(l.paidUntil) }) : ''}</div>
        <div class="meta"><span class="tag ${k}">${T(t)}</span>${l.state === 'approved' ? `<span class="muted">${T('{v} ভিউ · {c} কল', { v: num(l.views), c: num(l.calls) })}</span>` : ''}</div>
        ${l.sponsored && l.state === 'approved' ? `<div class="sponsbox">${icon('sparkle', 15)}<span>${T('Sponsored — {n} বার মানুষের সামনে দেখানো হয়েছে', { n: num(l.imps || 0) })}${l.sponsoredUntil ? ' · ' + T('{d} পর্যন্ত', { d: fmtDate(l.sponsoredUntil) }) : ''}</span></div>` : ''}
        ${l.payment?.status === 'rejected' && l.payment.note ? `<div class="muted" style="font-size:12px;margin-top:4px">${esc(l.payment.note)}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          ${['unpaid', 'payment_rejected', 'expired'].includes(l.state) || (l.state === 'approved' && soon(l)) ? `<a class="btn sm" href="#/pay/${l.id}">${icon('wallet', 16)}${T(l.state === 'unpaid' || l.state === 'payment_rejected' ? 'পেমেন্ট করুন' : 'নবায়ন করুন')}</a>` : ''}
          ${l.state === 'approved' ? `<a class="btn sm ghost" href="#/p/${l.id}">${T('দেখুন')}</a>` : ''}
          <a class="btn sm ghost" href="#/edit/listing/${l.id}">${icon('edit', 16)}${T('সম্পাদনা')}</a>
          ${['unpaid', 'pending', 'rejected', 'payment_rejected'].includes(l.state) ? `<button class="btn sm ghost" data-dellisting="${l.id}">${T('মুছুন')}</button>` : ''}</div></div></div>`; }).join('')}</div>`
      : empty(T('এখনো কোনো ব্যবসা যুক্ত করেননি'), '', `<a class="btn sm" href="#/add">${T('ব্যবসা যুক্ত করুন')}</a>`, 'store');
    if (my && tab === 'ads') body = my.classifieds.length ? `<div class="rows">${my.classifieds.map(a => { const k = KINDS[a.kind]; const live = a.review === 'approved' && a.expires * 1000 > Date.now();
      const [t, cl] = a.review === 'approved' ? (live ? ['প্রকাশিত', 'ok'] : ['মেয়াদ শেষ', 'bad']) : STATE[a.review] || STATE.pending;
      return `<div class="row">${media(a, '', k.color, k.icon)}<div class="body"><b>${esc(a.title)}</b><div class="sub">${T(k.bn)}${live ? ' · ' + T('{d} পর্যন্ত', { d: fmtDate(a.expires) }) : ''}</div>
        <div class="meta"><span class="tag ${cl}">${T(t)}</span>${live ? `<span class="muted">${T('{v} ভিউ', { v: num(a.views) })}</span>` : ''}</div></div>
        <a class="act" href="#/edit/ad/${a.id}" aria-label="${T('সম্পাদনা')}">${icon('edit', 18)}</a>
        <button class="act" style="border:0" data-delad="${a.id}" aria-label="${T('মুছুন')}">${icon('trash', 18)}</button></div>`; }).join('')}</div>
      <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${T('প্রকাশিত বিজ্ঞাপন সম্পাদনা করলে অ্যাডমিন আবার যাচাই করে প্রকাশ করবেন।')}</p>`
      : empty(T('এখনো কোনো বিজ্ঞাপন দেননি'), '', `<a class="btn sm" href="#/add">${T('বিজ্ঞাপন দিন')}</a>`, 'megaphone');
    if (tab === 'coupons') body = couponsTab();
    if (my && tab === 'settings') body = `<form class="form" data-profile>
      <label class="field"><span>${T('আপনার নাম')}</span><input name="name" value="${esc(S.ME.name)}" required maxlength="60"></label>
      <label class="field"><span>${T('মোবাইল নম্বর')}</span><input value="${esc(num(S.ME.phone))}" disabled></label>
      <h4 style="margin:6px 0 0">${T('পাসওয়ার্ড পরিবর্তন (ঐচ্ছিক)')}</h4>
      <label class="field"><span>${T('বর্তমান পাসওয়ার্ড')}</span><input name="password" type="password" autocomplete="current-password"></label>
      <label class="field"><span>${T('নতুন পাসওয়ার্ড')}</span><input name="newPassword" type="password" minlength="8" autocomplete="new-password"></label>
      <button class="btn block" type="submit">${T('সংরক্ষণ করুন')}</button></form>
      <button class="btn block ghost" style="margin-top:12px;color:var(--danger)" data-logout>${icon('logout', 18)}${T('লগআউট')}</button>`;
    return `${topbar(T('আমার অ্যাকাউন্ট'))}
      <div class="profilehead"><span class="avatar">${esc(S.ME.name[0])}</span><div><b>${esc(S.ME.name)}</b><span class="muted" style="font-size:13px">${esc(num(S.ME.phone))}</span></div></div>
      ${my ? `<div class="stat3"><div><b>${num(my.listings.length)}</b><small>${T('ব্যবসা')}</small></div><div><b>${num(my.classifieds.length)}</b><small>${T('বিজ্ঞাপন')}</small></div><div><b>${num(my.reviews)}</b><small>${T('রিভিউ')}</small></div></div>` : ''}
      <div class="seg" style="margin:18px 0">${[['biz', 'ব্যবসা'], ['ads', 'বিজ্ঞাপন'], ['coupons', 'কুপন'], ['settings', 'সেটিংস']].map(([k, v]) =>
        `<a class="${tab === k ? 'on' : ''}" href="#/account?tab=${k}" style="flex:1;text-align:center">${T(v)}</a>`).join('')}</div>${body}
      <a class="bizcta" href="#/add"><span>${icon('plus', 22)}</span><div><b>${T('নতুন যোগ করুন')}</b><small>${T('ব্যবসা, ফ্রি তথ্য, চাকরি বা ভাড়ার বিজ্ঞাপন')}</small></div>${icon('chevR', 18)}</a>`;
  };
}
