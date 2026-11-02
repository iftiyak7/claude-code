/* New submissions and payments. */
import { pages } from './dashboard.js';
import { catName, catOf, empty, load, subName, thumb } from './data.js';
import { shell } from './shell.js';
import { S, T, api, date, esc, money, num, owner } from './util.js';

/* ---------------- submissions & payments ---------------- */
export const PAYSTATE = { submitted: ['যাচাইয়ের অপেক্ষায়', 'warn'], verified: ['যাচাইকৃত', 'ok'], rejected: ['বাতিল', 'bad'] };

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  pages.submissions = async (_, p) => {
    await load();
    const tab = p.get('tab') || 'pending';
    const pend = S.listings.filter(l => l._review === 'pending'), unpaid = S.listings.filter(l => l._review === 'unpaid'), rej = S.listings.filter(l => l._review === 'rejected');
    const list = { pending: pend, unpaid, rejected: rej }[tab].sort((a, b) => b._created - a._created);
    shell('submissions', T('নতুন জমা'), '', `<p class="muted" style="margin-top:0">${T('ব্যবহারকারী ও ব্যবসায়ীরা অ্যাপ থেকে যে তথ্য পাঠিয়েছেন। যাচাই করে প্রকাশ করুন। পেইড ব্যবসা পেমেন্ট যাচাইয়ের পর এখানে আসে।')}</p>
      <div class="tabs">${[['pending', 'অনুমোদনের অপেক্ষায়', pend.length], ['unpaid', 'পেমেন্ট বাকি', unpaid.length], ['rejected', 'বাতিল', rej.length]].map(([k, t, n]) =>
        `<a class="${tab === k ? 'on' : ''}" href="#/submissions?tab=${k}">${T(t)} (${num(n)})</a>`).join('')}</div>
      <div class="card">${list.map(l => `<div class="item" style="align-items:flex-start">${thumb(l)}<div class="body"><b>${esc(l.name)}${l.nameEn ? ` <span class="muted" style="font-weight:400">· ${esc(l.nameEn)}</span>` : ''}</b>
        <small>${esc(catName(catOf(l.cat)))} › ${esc(subName(catOf(l.cat), l.sub))} · ${esc(l.area || '')} · ${esc(l.phone || T('ফোন নেই'))}</small>
        ${l.about ? `<p>${esc(l.about)}</p>` : ''}<small>${T('জমাদাতা')}: ${esc(l._owner ? `${l._owner.name} (${l._owner.phone})` : l._contact || '—')} · ${date(l._created)}</small>
        <div class="tags" style="margin-top:6px">${l.editedAt ? `<span class="tag warn">${T('সম্পাদিত — আবার দেখুন')}</span>` : ''}${l.videos?.length ? `<span class="tag">${icon('video', 13)} ${num(l.videos.length)}</span>` : ''}
          ${l._plan ? `<span class="tag ad">${T('প্যাকেজ')}: ${esc(l._plan)}</span>` : `<span class="tag ok">${T('ফ্রি')}</span>`}
          ${l._payment ? `<span class="tag ${PAYSTATE[l._payment.status]?.[1]}">${T('পেমেন্ট')}: ${T(PAYSTATE[l._payment.status]?.[0])} · ${money(l._payment.amount)}</span>` : ''}</div>
        ${l.images?.length ? `<div style="display:flex;gap:6px;margin-top:8px">${l.images.map(u => `<img class="rvphoto" src="${esc(u)}" alt="">`).join('')}</div>` : ''}</div>
        <div class="acts">${tab === 'pending' ? `<button class="btn sm" data-approve="${l.id}" data-verified="1">${icon('check', 16)}${T('যাচাইকৃত হিসেবে প্রকাশ')}</button>
          <button class="btn sm ghost" data-approve="${l.id}">${T('প্রকাশ (যাচাই চলছে)')}</button>` : ''}
          ${tab === 'unpaid' && l._payment?.status === 'submitted' ? `<a class="btn sm" href="#/payments">${icon('wallet', 16)}${T('পেমেন্ট যাচাই করুন')}</a>` : ''}
          <a class="btn sm ghost" href="#/listings/${l.id}">${icon('eye', 16)}${T('দেখুন ও সম্পাদনা')}</a>
          ${tab !== 'rejected' ? `<button class="btn sm red" data-reject="${l.id}">${T('বাতিল')}</button>` : `<button class="iconbtn red" data-dellisting="${l.id}">${icon('trash', 18)}</button>`}</div></div>`).join('')
        || empty(T('কিছু নেই'), `<div>${T('নতুন জমা এলে এখানে দেখাবে।')}</div>`, 'check')}</div>`);
  };
  pages.payments = async (_, p) => {
    await load();
    const all = await api('/admin/payments'), tab = p.get('tab') || 'submitted';
    const list = all.filter(x => tab === 'all' || x.status === tab);
    const M = { bkash: 'বিকাশ', nagad: 'নগদ', rocket: 'রকেট' };
    shell('payments', T('পেমেন্ট'), '', `<p class="muted" style="margin-top:0">${T('ব্যবসায়ীরা বিকাশ/নগদে টাকা পাঠিয়ে Transaction ID দিয়েছেন। আপনার অ্যাপে লেনদেন মিলিয়ে যাচাই করুন।')}</p>
      ${!owner() ? `<div class="note">${icon('lock', 20)}<div>${T('পেমেন্ট যাচাই শুধু মূল অ্যাডমিন করতে পারেন।')}</div></div>` : ''}
      <div class="tabs">${[['submitted', 'যাচাইয়ের অপেক্ষায়'], ['verified', 'যাচাইকৃত'], ['rejected', 'বাতিল'], ['all', 'সব']].map(([k, t]) =>
        `<a class="${tab === k ? 'on' : ''}" href="#/payments?tab=${k}">${T(t)} (${num(all.filter(x => k === 'all' || x.status === k).length)})</a>`).join('')}</div>
      <div class="card tablewrap">${list.length ? `<table class="t"><thead><tr><th>${T('তালিকা')}</th><th>${T('পরিমাণ')}</th><th>${T('মাধ্যম ও TrxID')}</th><th>${T('যে নম্বর থেকে')}</th><th>${T('অবস্থা')}</th><th></th></tr></thead><tbody>
        ${list.map(x => `<tr><td><a href="#/listings/${esc(x.listing_id)}"><b>${esc(x.listingName)}</b></a><br><small class="muted">${esc(x.userName)} · ${esc(x.userPhone)} · ${date(x.created_at)}</small></td>
          <td data-l="${T('পরিমাণ')}"><b>${money(x.amount)}</b><br><small class="muted">${esc(x.plan_id)}</small></td>
          <td data-l="${T('মাধ্যম ও TrxID')}">${T(M[x.method] || x.method)}<br><code>${esc(x.trx)}</code></td><td data-l="${T('যে নম্বর থেকে')}">${esc(x.sender)}</td>
          <td data-l="${T('অবস্থা')}"><span class="tag ${PAYSTATE[x.status][1]}">${T(PAYSTATE[x.status][0])}</span>${x.note ? `<br><small class="muted">${esc(x.note)}</small>` : ''}</td>
          <td><div class="acts">${x.status === 'submitted' && owner() ? `<button class="btn sm" data-paydecide="${x.id}|verify|1">${icon('check', 16)}${T('যাচাই ও প্রকাশ')}</button>
            <button class="btn sm ghost" data-paydecide="${x.id}|verify|0">${T('শুধু যাচাই')}</button><button class="btn sm red" data-paydecide="${x.id}|reject|0">${T('বাতিল')}</button>` : ''}</div></td></tr>`).join('')}</tbody></table>`
        : empty(T('কোনো পেমেন্ট নেই'), '', 'wallet')}</div>`);
  };
}
