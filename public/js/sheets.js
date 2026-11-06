/* Bottom sheets: filters, areas, announcements, sharing. */
import { S } from './state.js';
import { refresh } from './boot.js';
import { empty } from './components.js';
import { catName, catOf, isTown, nameOf } from './data.js';
import { doLocate, go, render } from './router.js';
import { norm } from './search.js';
import { T, api, areaName, compress, esc, fmtDate, loc, ls, money, num, toast } from './util.js';

/* ---------------- sheets ---------------- */
function openSheet(html, mount) {
  closeSheet(true);
  const scrim = document.createElement('div'), sh = document.createElement('div');
  scrim.className = 'scrim'; sh.className = 'sheet'; sh.setAttribute('role', 'dialog');
  sh.innerHTML = `<div class="grab"></div>${html}`;
  document.body.append(scrim, sh);
  requestAnimationFrame(() => { scrim.classList.add('show'); sh.classList.add('show'); });
  scrim.onclick = () => closeSheet();
  mount && mount(sh);
  return sh;
}
export function closeSheet(now) {
  document.querySelectorAll('.scrim, .sheet').forEach(el => { el.classList.remove('show'); now ? el.remove() : setTimeout(() => el.remove(), 300); });
}
const sheetHead = t => `<div class="shead"><h3>${t}</h3><button class="roundbtn" data-close aria-label="${T('বন্ধ')}">${icon('x', 18)}</button></div>`;
export function filterSheet(p) {
  const cats = S.D.categories.filter(c => c.id !== 'emergency');
  const budget = +p.get('budget') || 0;
  openSheet(`${sheetHead(T('ফিল্টার'))}
    <h4>${T('ক্যাটাগরি')}</h4><div class="pills wrap">${[{ id: '' }, ...cats].map(c =>
      `<button class="pill sm ${(p.get('cat') || '') === c.id ? 'on' : ''}" data-fcat="${c.id}">${c.icon ? icon(c.icon, 15) : ''}${esc(c.id ? catName(c) : T('সব'))}</button>`).join('')}</div>
    <h4>${T('বাজেট (জনপ্রতি)')}</h4><input class="range" type="range" min="0" max="2000" step="50" value="${budget || 2000}" data-fbudget>
    <div class="rangeval"><span>${money(0)}</span><b data-fbval>${budget ? T('{n} পর্যন্ত', { n: money(budget) }) : T('যেকোনো')}</b><span>${money(2000)}+</span></div>
    <h4>${T('সাজানো')}</h4><div class="seg">${[['', 'প্রাসঙ্গিক'], ['rating', 'রেটিং'], ['near', 'কাছাকাছি']].map(([k, v]) =>
      `<button class="${(p.get('sort') || '') === k ? 'on' : ''}" data-fsort="${k}">${T(v)}</button>`).join('')}</div>
    <label class="switch" style="margin-top:16px"><span>${T('শুধু এখন খোলা')}</span><input type="checkbox" data-fopen ${p.get('open') ? 'checked' : ''}></label>
    <label class="switch" style="margin-top:10px"><span>${icon('halal', 16)} ${T('শুধু হালাল')}</span><input type="checkbox" data-fhalal ${p.get('halal') ? 'checked' : ''}></label>
    <div class="two" style="margin-top:20px"><button class="btn ghost" data-freset>${T('রিসেট')}</button><button class="btn" data-fapply>${T('ফলাফল দেখুন')}</button></div>`, sh => {
    const st = { cat: p.get('cat') || '', sort: p.get('sort') || '', budget, open: !!p.get('open') };
    sh.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if ('fcat' in b.dataset) { st.cat = b.dataset.fcat; sh.querySelectorAll('[data-fcat]').forEach(x => x.classList.toggle('on', x === b)); }
      if ('fsort' in b.dataset) { st.sort = b.dataset.fsort; sh.querySelectorAll('[data-fsort]').forEach(x => x.classList.toggle('on', x === b)); }
      if ('freset' in b.dataset) { closeSheet(); go('#/search'); }
      if ('fapply' in b.dataset) {
        st.open = sh.querySelector('[data-fopen]').checked; st.halal = sh.querySelector('[data-fhalal]').checked;
        const np = new URLSearchParams();
        if (p.get('q')) np.set('q', p.get('q'));
        if (st.cat) np.set('cat', st.cat); if (st.sort) np.set('sort', st.sort);
        if (st.budget && st.budget < 2000) np.set('budget', st.budget); if (st.open) np.set('open', '1'); if (st.halal) np.set('halal', '1');
        closeSheet();
        if (st.sort === 'near' && !S.here) return doLocate('#/search?' + np);
        go('#/search?' + np);
      }
    });
    const r = sh.querySelector('[data-fbudget]');
    r.oninput = () => { st.budget = +r.value; sh.querySelector('[data-fbval]').textContent = +r.value >= 2000 ? T('যেকোনো') : T('{n} পর্যন্ত', { n: money(r.value) }); };
  });
}
export function noticesSheet() {
  const list = S.D.notices || [];
  ls.set('seenNotices', list.map(n => n.id));
  openSheet(`${sheetHead(T('ঘোষণা ও আপডেট'))}${list.map(n => `<div class="notice"><small>${esc(fmtDate(n.date))}</small>
    <b style="display:block">${n.type === 'alert' ? '⚠ ' : ''}${esc(loc(n, 'title'))}</b><p>${esc(loc(n, 'body'))}</p></div>`).join('') || empty(T('কোনো ঘোষণা নেই'), '', '', 'bell')}`);
  document.querySelector('.homebar .dot')?.remove();
}
export function areaSheet() {
  const cur = ls.get('area', ''), all = S.D.areas || [];
  const town = all.filter(isTown), upa = all.filter(a => !isTown(a));
  const pill = a => `<button class="pill sm ${a === cur ? 'on' : ''}" data-area="${esc(a)}" data-k="${esc(norm(a + ' ' + areaName(a)))}">${esc(a ? areaName(a) : T('পুরো যশোর'))}</button>`;
  openSheet(`${sheetHead(T('এলাকা ও লোকেশন'))}
    <button class="gpsrow" data-areagps><span class="ib">${icon('nav', 20)}</span><span><b>${T(S.here ? 'লোকেশন চালু আছে' : 'আমার বর্তমান লোকেশন')}</b>
      <small>${T(S.here ? 'দূরত্ব আপনার লোকেশন থেকে দেখানো হচ্ছে — বন্ধ করতে চাপুন' : 'কাছের মসজিদ, হাসপাতাল, দোকান দূরত্বসহ দেখুন')}</small></span></button>
    <p class="muted" style="margin:14px 0 10px;font-size:13px">${T('এলাকা বাছলে শুধু সেই এলাকার তথ্য ও বিজ্ঞাপন দেখাবে, আর দূরত্ব সেখান থেকে মাপা হবে।')}</p>
    <div class="search" style="margin-bottom:12px">${icon('search', 18)}<input type="search" placeholder="${T('এলাকা খুঁজুন')}" data-areaq></div>
    <div class="pills wrap">${pill('')}</div>
    ${town.length ? `<h4>${T('যশোর শহর')}</h4><div class="pills wrap">${town.map(pill).join('')}</div>` : ''}
    <h4>${T('উপজেলা')}</h4><div class="pills wrap">${upa.map(pill).join('')}</div>`, sh => {
    sh.addEventListener('click', async e => {
      const b = e.target.closest('[data-area]');
      if (b) { ls.set('area', b.dataset.area); S.originCache = null; closeSheet(); return render(); }
      if (e.target.closest('[data-areagps]')) {
        closeSheet();
        if (S.here) { S.here = null; ls.set('loc', null); return render(); }
        return doLocate();
      }
    });
    sh.querySelector('[data-areaq]').addEventListener('input', e => {
      const q = norm(e.target.value);
      sh.querySelectorAll('[data-area]').forEach(x => x.hidden = !!q && !x.dataset.k.includes(q));
    });
  });
}
export const ctxbar = (shown, total, nearMode) => {
  const a = ls.get('area', '');
  return `<div class="ctxbar"><span class="ib">${icon(S.here ? 'nav' : 'pin', 17)}</span><div><b>${esc(S.here && nearMode ? T('আপনার লোকেশন') : a ? areaName(a) : T('পুরো যশোর'))}</b>
    <small>${nearMode ? (S.here ? T('আপনার লোকেশন থেকে দূরত্ব — কাছেরগুলো আগে') : T('{a} থেকে দূরত্ব — কাছেরগুলো আগে', { a: esc(areaName(a)) })) : a ? T('এই এলাকার {n}টি আগে, তারপর বাকি সব', { n: num(shown) }) : S.here ? T('দূরত্ব আপনার লোকেশন থেকে') : T('এলাকা বা লোকেশন দিলে কাছেরগুলো আগে দেখাবে')}</small></div>
    ${a ? `<button class="linkbtn" data-clrarea>${T('সব এলাকা')}</button>` : ''}<button class="chipbtn" data-areasheet>${T(a ? 'বদলান' : 'এলাকা বাছুন')}</button></div>`;
};
export function reportSheet(target) {
  const review = target.review;
  openSheet(`${sheetHead(review ? T('রিভিউ রিপোর্ট করুন') : T('ভুল তথ্য জানান'))}
    <div class="form"><label class="field"><span>${review ? T('কেন অনুপযুক্ত?') : T('কী ভুল আছে?')}</span>
    <textarea maxlength="600" placeholder="${review ? T('ভুয়া, অপমানজনক, ব্যক্তিগত তথ্য…') : T('ফোন নম্বর বদলেছে, ঠিকানা ভুল, বন্ধ হয়ে গেছে, ভুয়া বিজ্ঞাপন…')}"></textarea></label>
    <button class="btn block" data-send>${T('পাঠান')}</button></div>`, sh => {
    sh.querySelector('[data-send]').onclick = async () => {
      const reason = sh.querySelector('textarea').value.trim();
      if (!reason) return toast(T('কারণ লিখুন'));
      try { await api('/reports', { ...target, reason }); closeSheet(); toast(T('ধন্যবাদ! আমরা দ্রুত পর্যালোচনা করব।')); } catch (e) { toast(e.message); }
    };
  });
}
export function reviewSheet(it) {
  if (!requireLogin()) return;
  const crit = catOf(it).criteria || [];
  const pick = (f, sm = '') => `<div class="starpick ${sm}" data-field="${f}">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-v="${i}" aria-label="${num(i)}">${icon('star', 24)}</button>`).join('')}</div>`;
  openSheet(`${sheetHead(T('রিভিউ লিখুন'))}<div class="form">
    <div style="text-align:center"><div class="muted" style="font-size:13px;margin-bottom:8px">${esc(nameOf(it))}</div>${pick('stars')}</div>
    ${crit.map((x, n) => `<div class="critrow"><span>${esc(T(x))}</span>${pick('c' + n, 'sm')}</div>`).join('')}
    <label class="field"><span>${T('অভিজ্ঞতা')}</span><textarea maxlength="1500" data-text placeholder="${T('কেমন লাগল? অন্যদের জন্য উপকারী তথ্য লিখুন')}"></textarea></label>
    <div class="photos" data-photos><label>${icon('camera', 22)}<input type="file" accept="image/*"></label></div>
    ${it.cat === 'hospital' ? `<div class="note warn">${icon('info', 16)}<span>${T('রোগীর ব্যক্তিগত তথ্য লিখবেন না। চিকিৎসক সম্পর্কে অভিযোগ বিশেষ মডারেশনে যায়।')}</span></div>` : ''}
    <p class="muted" style="font-size:12.5px;margin:0">${T('রিভিউতে আপনার নাম দেখাবে: {name}', { name: esc(S.ME.name) })}</p>
    <button class="btn block" data-submit>${T('রিভিউ জমা দিন')}</button></div>`, sh => {
    let photo = null;
    sh.addEventListener('click', e => {
      const b = e.target.closest('.starpick button');
      if (b) { const p = b.parentElement; p.dataset.val = b.dataset.v; p.querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.v <= +b.dataset.v)); }
      if (e.target.closest('[data-rmphoto]')) { photo = null; sh.querySelector('.ph')?.remove(); }
    });
    sh.querySelector('input[type=file]').onchange = async e => {
      try { photo = await compress(e.target.files[0], 1080, .78);
        sh.querySelector('.ph')?.remove();
        sh.querySelector('[data-photos]').insertAdjacentHTML('afterbegin', `<div class="ph"><img src="${photo}" alt=""><button data-rmphoto>${icon('x', 14)}</button></div>`);
      } catch (er) { toast(er.message); }
    };
    sh.querySelector('[data-submit]').onclick = async ev => {
      const stars = +sh.querySelector('[data-field=stars]').dataset.val || 0;
      if (!stars) return toast(T('স্টার রেটিং দিন'));
      const cr = {}; crit.forEach((k, n) => { const v = +sh.querySelector(`[data-field=c${n}]`).dataset.val; if (v) cr[k] = v; });
      ev.target.disabled = true;
      try {
        await api('/reviews', { listing: it.id, stars, crit: cr, text: sh.querySelector('[data-text]').value, photo });
        closeSheet(); toast(T('রিভিউয়ের জন্য ধন্যবাদ!')); await refresh(); render();
      } catch (er) { toast(er.message); ev.target.disabled = false; }
    };
  });
}
export function requireLogin() {
  if (S.ME) return true;
  toast(T('এর জন্য অ্যাকাউন্টে লগইন করুন'));
  go('#/login?next=' + encodeURIComponent(location.hash.slice(1) || '/'));
  return false;
}
