/* Coupons and offers. */
import { modal, readFields } from './collections.js';
import { pages } from './dashboard.js';
import { empty, load } from './data.js';
import { route } from './router.js';
import { shell } from './shell.js';
import { S, T, api, date, day, esc, num, root, toast } from './util.js';

/* ---------------- coupons ---------------- */
const CPS = { active: ['চালু', 'ok'], pending: ['অনুমোদনের অপেক্ষায়', 'warn'], paused: ['বন্ধ রাখা', 'bad'], rejected: ['বাতিল', 'bad'] };
export async function acheck(code, redeem) {
  const box = root.querySelector('[data-acres]');
  try {
    const r = await api('/admin/coupons/check', { code, redeem: !!redeem });
    box.innerHTML = `<div class="acres ${r.state}"><b>${T({ ok: 'বৈধ কুপন ✓', used: 'আগেই ব্যবহৃত', expired: 'মেয়াদ শেষ' }[r.state])}</b>
      ${esc(r.title)} · ${esc(r.listingName || '')} · ${esc(r.code)} · ${T('গ্রাহক')}: ${esc(r.customer)} (${esc(r.phone)})${r.usedAt ? ' · ' + T('ব্যবহার') + ': ' + date(r.usedAt) : ''}
      ${r.state === 'ok' ? `<button type="button" class="btn sm" data-acredeem="${esc(r.code)}">${T('ব্যবহৃত হিসেবে চিহ্নিত করুন')}</button>` : ''}</div>`;
    if (redeem) toast(T('কুপন ব্যবহৃত হিসেবে চিহ্নিত হয়েছে'));
  } catch (er) { box.innerHTML = `<div class="acres expired"><b>${esc(er.message)}</b></div>`; }
}
export async function couponModal(c, assignOnly) {
  if (!S.users) S.users = await api('/admin/users');
  const L = S.listings.filter(l => l._review === 'approved').sort((a, b) => a.name.localeCompare(b.name));
  const users = S.users.filter(u => !u.banned);
  const picker = `<div class="field upick" data-upick ${!c && !assignOnly ? 'hidden' : c?.audience === 'private' || assignOnly ? '' : 'hidden'}><span>${T('কারা পাবেন')} <em data-ucount>(${num(0)})</em></span>
    <input placeholder="${T('নাম বা ফোন দিয়ে খুঁজুন')}" data-uq>
    <div class="ulist">${users.map(u => `<label class="check" data-uk="${esc((u.name + ' ' + u.phone).toLowerCase())}"><input type="checkbox" value="${u.id}" data-uid>
      <span>${esc(u.name)} <small>${esc(u.phone)}</small></span></label>`).join('') || `<p class="muted">${T('এখনো কোনো ব্যবহারকারী নেই')}</p>`}</div>
    <button type="button" class="btn sm ghost" data-uall>${T('দেখানো সবাইকে বাছুন')}</button>
    ${assignOnly ? `<em>${T('বাছাই করা মানুষদের অ্যাকাউন্টে কুপনটি সাথে সাথে চলে যাবে। আগে পাওয়া কেউ আবার পাবেন না।')}</em>` : ''}</div>`;
  const body = assignOnly ? picker : `
    ${c ? `<div class="field"><span>${T('প্রতিষ্ঠান')}</span><input value="${esc(c.listingName || c.listing)}" disabled></div>`
      : `<label class="field"><span>${T('প্রতিষ্ঠান')} *</span><input name="listing" list="cp-l" required placeholder="${T('নাম লিখে বেছে নিন')}">
        <datalist id="cp-l">${L.map(l => `<option value="${esc(l.name)} — ${esc(l.id)}">`).join('')}</datalist></label>`}
    <label class="field"><span>${T('অফার')} *</span><input name="title" required maxlength="120" value="${esc(c?.title || '')}" placeholder="${T('যেমন: ২০% ছাড়')}"></label>
    <label class="field"><span>${T('বিস্তারিত / শর্ত')}</span><textarea name="details" rows="2" maxlength="600">${esc(c?.details || '')}</textarea></label>
    <div class="two"><label class="field"><span>${T('শুরুর তারিখ')}</span><input type="date" name="starts" value="${esc(c?.starts || '')}"></label>
      <label class="field"><span>${T('শেষ তারিখ')}</span><input type="date" name="ends" value="${esc(c?.ends || '')}"></label></div>
    <div class="two"><label class="field"><span>${T('কতজন নিতে পারবে')}</span><input name="maxClaims" inputmode="numeric" value="${esc(c?.maxClaims || '')}" placeholder="${T('খালি = সীমা নেই')}"></label>
      <label class="field"><span>${T('কারা দেখবে')}</span><select name="audience" data-aud>${[['public', 'সবার জন্য — প্রতিষ্ঠানের পেজে দেখাবে'], ['private', 'শুধু বেছে নেওয়া মানুষ']].map(([k, v]) =>
        `<option value="${k}" ${(c?.audience || 'public') === k ? 'selected' : ''}>${T(v)}</option>`).join('')}</select></label></div>
    ${picker}`;
  const bg = modal(T(assignOnly ? 'কুপন দিন — মানুষ বাছুন' : c ? 'কুপন সম্পাদনা' : 'নতুন কুপন'), body, async f => {
    const picked = [...f.querySelectorAll('[data-uid]:checked')].map(x => +x.value);
    if (assignOnly) {
      if (!picked.length) throw new Error(T('অন্তত একজনকে বাছুন'));
      const r = await api('/admin/coupons/' + c.id, { title: c.title, details: c.details, starts: c.starts, ends: c.ends, maxClaims: c.maxClaims, audience: c.audience, users: picked }, 'PUT');
      toast(T('{n} জনকে কুপন দেওয়া হয়েছে', { n: num(r.assigned) })); return route();
    }
    const v = readFields(f, [['title'], ['details'], ['starts'], ['ends'], ['maxClaims', 'number'], ['audience']]);
    if (v.audience === 'private' && !c && !picked.length) throw new Error(T('অন্তত একজনকে বাছুন'));
    if (c) await api('/admin/coupons/' + c.id, { ...v, users: picked }, 'PUT');
    else {
      const lid = (f.listing.value.split(' — ').pop() || '').trim();
      if (!S.listings.some(l => l.id === lid)) throw new Error(T('তালিকা থেকে প্রতিষ্ঠান বেছে নিন'));
      await api('/admin/coupons', { ...v, listing: lid, users: picked });
    }
    toast(T('সংরক্ষণ হয়েছে')); route();
  }, assignOnly ? 'কুপন দিন' : 'সংরক্ষণ করুন');
  const f = bg.querySelector('form'), up = f.querySelector('[data-upick]');
  const count = () => { f.querySelector('[data-ucount]').textContent = `(${num(f.querySelectorAll('[data-uid]:checked').length)})`; };
  f.addEventListener('change', e => { if (e.target.matches('[data-aud]')) up.hidden = e.target.value !== 'private'; if (e.target.matches('[data-uid]')) count(); });
  f.querySelector('[data-uq]')?.addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); f.querySelectorAll('[data-uk]').forEach(x => x.hidden = !!q && !x.dataset.uk.includes(q)); });
  f.querySelector('[data-uall]')?.addEventListener('click', () => { f.querySelectorAll('[data-uk]:not([hidden]) [data-uid]').forEach(x => x.checked = true); count(); });
}

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  pages.coupons = async (_, p) => {
    await load();
    const all = await api('/admin/coupons'); S.coupons = all;
    const st = c => c.status === 'pending' ? 'pending' : c.status === 'active' && c.live ? 'live' : 'off';
    const tab = p.get('tab') || (all.some(c => st(c) === 'pending') ? 'pending' : 'live');
    const list = all.filter(c => st(c) === tab);
    shell('coupons', T('কুপন ও অফার'), `<button class="btn" data-cpnew>${icon('plus', 18)}<span class="hide-sm">${T('নতুন কুপন')}</span></button>`, `
      <p class="muted" style="margin-top:0">${T('যেকোনো প্রতিষ্ঠানের জন্য কুপন দিন — সবার জন্য (প্রতিষ্ঠানের পেজে দেখাবে) অথবা শুধু বেছে নেওয়া কিছু মানুষের জন্য (তাদের অ্যাকাউন্টে চলে যাবে)। প্রতিষ্ঠানের মালিকদের দেওয়া অফার অনুমোদনের পর দেখায়। প্রত্যেক গ্রাহক আলাদা কোড পান; দোকানে কোড যাচাই করে "ব্যবহৃত" করা হয়।')}</p>
      <form class="card" data-acheck><div class="cbody acheck"><b>${icon('check', 18)} ${T('কোড যাচাই')}</b><input name="code" placeholder="J360-XXXXXX" autocomplete="off" required>
        <button class="btn sm">${T('যাচাই')}</button><div data-acres></div></div></form>
      <div class="tabs">${[['pending', 'অনুমোদনের অপেক্ষায়'], ['live', 'চলমান'], ['off', 'বন্ধ / মেয়াদ শেষ']].map(([k, t]) =>
        `<a class="${tab === k ? 'on' : ''}" href="#/coupons?tab=${k}">${T(t)} (${num(all.filter(c => st(c) === k).length)})</a>`).join('')}</div>
      <div class="card">${list.map(c => { const [t, k] = CPS[c.status] || CPS.pending;
        return `<div class="item" style="align-items:flex-start"><span class="thumb" style="--c:#f59e0b">${icon('tag', 20)}</span>
          <div class="body"><b>${esc(c.title)}</b> <span class="tag ${k}">${T(t)}</span>
            <span class="tag ${c.audience === 'private' ? 'ad' : 'ok'}">${T(c.audience === 'private' ? 'নির্দিষ্ট মানুষ' : 'সবার জন্য')}</span>${c.createdBy === 'owner' ? ` <span class="tag">${T('প্রতিষ্ঠানের দেওয়া')}</span>` : ''}
            <small>${esc(c.listingName || c.listing)} · ${c.starts ? day(c.starts) + ' – ' : ''}${c.ends ? day(c.ends) : T('মেয়াদ নেই')}</small>
            ${c.details ? `<p>${esc(c.details)}</p>` : ''}
            <small>${T('{c} জন নিয়েছেন', { c: num(c.claims) })}${c.maxClaims ? ' / ' + num(c.maxClaims) : ''} · ${T('{u} জন ব্যবহার করেছেন', { u: num(c.used) })}</small></div>
          <div class="acts">${c.status === 'pending' ? `<button class="btn sm" data-cpst="${c.id}|active">${icon('check', 16)}${T('অনুমোদন')}</button><button class="btn sm red" data-cpst="${c.id}|rejected">${T('বাতিল')}</button>` : ''}
            ${c.status === 'active' ? `<button class="btn sm ghost" data-cpst="${c.id}|paused">${T('বন্ধ রাখুন')}</button>` : ''}
            ${c.status === 'paused' || c.status === 'rejected' ? `<button class="btn sm ghost" data-cpst="${c.id}|active">${T('চালু করুন')}</button>` : ''}
            ${c.audience === 'private' ? `<button class="btn sm ghost" data-cpassign="${c.id}">${icon('users', 16)}${T('মানুষ যোগ')}</button>` : ''}
            <button class="iconbtn" data-cpedit="${c.id}" title="${T('সম্পাদনা')}">${icon('edit', 18)}</button>
            <button class="iconbtn red" data-cpdel="${c.id}" title="${T('মুছুন')}">${icon('trash', 18)}</button></div></div>`; }).join('') || empty(T('কিছু নেই'), '', 'tag')}</div>`);
    root.querySelector('[data-acheck]').onsubmit = async e => { e.preventDefault(); acheck(e.target.code.value); };
  };
}
