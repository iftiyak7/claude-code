/* Welcome and terms, the old-address update screen, the admin popup. */
import { S } from './state.js';
import { termsHtml } from './page_post.js';
import { go, render } from './router.js';
import { APP_UA, LANG, LOGO, T, api, applyTheme, esc, loc, ls } from './util.js';

/* ---------------- welcome ---------------- */
/* ---------------- old address: the installed app still opens a domain the site has moved away from ---------------- */
function movedApp() {
  const host = location.hostname.replace(/^www\./, '');
  return APP_UA && S.D.home && S.D.app?.file && host !== S.D.home && !/^[\d.]+$|^localhost$/.test(host) && S.D.app.versionCode > +APP_UA[1];
}
function moved() {
  if (!movedApp() || document.querySelector('.welcome') || sessionStorage.getItem('j360.movedLater')) return !!movedApp();
  const w = document.createElement('div');
  w.className = 'welcome moved';
  const base = 'https://' + S.D.home;
  w.innerHTML = `<div class="art"><div class="blob"><div class="core">${LOGO.replace('<svg', '<svg width="64" height="64"')}</div></div></div>
    <div class="card"><h1>${T('Jashore360 এখন নতুন ঠিকানায়')}</h1>
      <p>${T('আপনার অ্যাপটি পুরনো ঠিকানা থেকে চলছে, যা শীঘ্রই বন্ধ হয়ে যাবে। নতুন ভার্সনটি নামিয়ে ইনস্টল করুন — এটি এই অ্যাপের উপরেই আপডেট হবে।')}</p>
      <p class="newaddr">${esc(S.D.home)}</p>
      <a class="btn block" href="${base}/download/jashore360.apk">${icon('download', 20)}${T('নতুন অ্যাপ নামান')} (v${esc(S.D.app.versionName)})</a>
      <p class="hint">${T('আপডেটের পর একবার লগইন করে নিন। সমস্যা হলে Play Protect-এ "Install anyway" চাপুন।')}</p>
      <button class="linkbtn" data-later>${T('পরে করব')}</button></div>`;
  document.body.appendChild(w);
  w.querySelector('[data-later]').addEventListener('click', () => { try { sessionStorage.setItem('j360.movedLater', '1'); } catch {} w.remove(); });
  return true;
}
export function welcome() {
  if (moved()) return;
  const tv = S.D.terms?.version || 0, again = ls.get('welcomed', false);
  if ((again && ls.get('termsV', 0) >= tv) || document.querySelector('.welcome') || /^#\/(terms|privacy)/.test(location.hash)) return;
  const w = document.createElement('div');
  w.className = 'welcome';
  const chips = [['hospital', '#0b8fd6', 'top:12%;left:14%'], ['utensils', '#f2711c', 'top:22%;right:12%'], ['siren', '#e5484d', 'bottom:16%;left:12%'], ['home', '#7c5cff', 'bottom:10%;right:18%']];
  const draw = () => {
    w.innerHTML = `<div class="art"><div class="blob"><div class="core">${LOGO.replace('<svg', '<svg width="64" height="64"')}</div></div>
      ${chips.map(([i, c, pos]) => `<span class="chip" style="background:${c};${pos}">${icon(i, 22)}</span>`).join('')}</div>
      <div class="card"><div class="seg wlang">${[['bn', 'বাংলা'], ['en', 'English']].map(([k, v]) =>
        `<button class="${LANG() === k ? 'on' : ''}" data-wlang="${k}">${v}</button>`).join('')}</div>
      <h1>${again ? T('শর্তাবলি আপডেট হয়েছে') : esc(loc(S.D.site, 'tagline') || T('যশোরের সবকিছু, এক অ্যাপে'))}</h1><p>${T(again ? 'চালিয়ে যেতে নতুন শর্তাবলি পড়ে সম্মতি দিন।' : 'হাসপাতাল, জরুরি নম্বর, রেস্টুরেন্ট, দোকান, বাসা ভাড়া আর চাকরি — যাচাইকৃত তথ্য, এক জায়গায়।')}</p>
      ${tv ? `<label class="wterms"><input type="checkbox" data-agree><span>${T('আমি Jashore360-এর {t} পড়েছি ও সম্মত', { t: `<button type="button" data-readterms>${T('শর্তাবলি')}</button>` })}</span></label>
      <div class="wtext" hidden>${termsHtml()}</div>` : ''}
      <button class="btn block" data-start ${tv ? 'disabled' : ''}>${T(again ? 'সম্মত, চালিয়ে যান' : 'শুরু করুন')}</button></div>`;
  };
  draw();
  document.body.appendChild(w);
  w.addEventListener('click', e => {
    const l = e.target.closest('[data-wlang]');
    if (l) { e.stopPropagation(); ls.set('lang', l.dataset.wlang); applyTheme(); draw(); render(); }
    if (e.target.closest('[data-readterms]')) { const t = w.querySelector('.wtext'); t.hidden = !t.hidden; }
    if (e.target.closest('[data-start]')) {
      ls.set('welcomed', true); ls.set('termsV', tv); w.remove();
      if (S.ME) api('/my/terms', {}).catch(() => {});
      setTimeout(maybePopup, 600);
    }
  });
  w.addEventListener('change', e => { if (e.target.matches('[data-agree]')) w.querySelector('[data-start]').disabled = !e.target.checked; });
}
/* ---------------- admin popup ---------------- */
export function maybePopup() {
  const pp = S.D.popup;
  if (!pp || document.querySelector('.welcome, .popup-bg')) return;
  const seen = ls.get('popupSeen', {}), today = new Date().toISOString().slice(0, 10);
  const due = pp.show === 'every' ? !sessionStorage.getItem('j360.pp' + pp.rev) : pp.show === 'daily' ? seen.rev !== pp.rev || seen.day !== today : seen.rev !== pp.rev;
  if (!due) return;
  ls.set('popupSeen', { rev: pp.rev, day: today }); try { sessionStorage.setItem('j360.pp' + pp.rev, '1'); } catch {}
  const bg = document.createElement('div');
  bg.className = 'popup-bg';
  bg.innerHTML = `<div class="popup" role="dialog" aria-modal="true">${pp.image ? `<img src="${esc(pp.image)}" alt="">` : ''}
    <button class="roundbtn pclose" data-ppclose aria-label="${T('বন্ধ করুন')}">${icon('x', 18)}</button>
    <div class="pbody">${pp.title ? `<h2>${esc(loc(pp, 'title'))}</h2>` : ''}${pp.body ? `<p>${esc(loc(pp, 'body'))}</p>` : ''}
    <div class="pacts">${pp.cta && pp.link ? `<button class="btn block" data-ppgo>${esc(loc(pp, 'cta'))}</button><button class="btn block ghost" data-ppclose>${T('পরে')}</button>`
      : `<button class="btn block" data-ppclose>${T('ঠিক আছে')}</button>`}</div></div></div>`;
  document.body.appendChild(bg);
  requestAnimationFrame(() => bg.classList.add('show'));
  const close = () => { bg.classList.remove('show'); setTimeout(() => bg.remove(), 200); };
  bg.addEventListener('click', e => {
    if (e.target === bg || e.target.closest('[data-ppclose]')) return close();
    if (e.target.closest('[data-ppgo]')) {
      close();
      const l = pp.link;
      if (l.startsWith('#')) go(l); else if (/^(tel|mailto):/.test(l)) location.href = l; else window.open(l, '_blank', 'noopener');
    }
  });
}
