/* Sign-in screen and the panel's frame (menu, header, language and theme switches). */
import { boot } from './boot.js';
import { counts } from './data.js';
import { LANG, LOGO, S, T, api, esc, ls, num, owner, root, toast } from './util.js';

/* ---------------- login ---------------- */
export function renderLogin() {
  root.innerHTML = `<div class="login"><div class="art"><div class="logo"><i>${LOGO}</i>Jashore360</div>
    <div><h2>${T('যশোরের সব তথ্য এক জায়গা থেকে পরিচালনা করুন')}</h2><p>${T('তালিকা, পেমেন্ট, বিজ্ঞাপন, রিভিউ ও সেটিংস — সবকিছুর নিয়ন্ত্রণ এখানে।')}</p></div><span></span></div>
    <form data-login><div class="logo" style="color:var(--ink)"><i>${LOGO}</i>${T('অ্যাডমিন')}</div><h1>${T('লগইন করুন')}</h1>
      <label class="field"><span>${T('ইউজারনেম')}</span><input name="username" autocomplete="username" required autofocus></label>
      <label class="field"><span>${T('পাসওয়ার্ড')}</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn block">${T('লগইন')}</button>
      <div class="loginprefs">${langToggle()}${themeToggle()}</div></form></div>`;
  root.querySelector('[data-login]').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, b = f.querySelector('button'); b.disabled = true;
    try { S.me = await api('/admin/login', { username: f.username.value, password: f.password.value, code: f.code?.value }); await boot(); }
    catch (er) {
      toast(er.message, true); b.disabled = false;
      if (er.data?.need2fa && !f.code) {     // two-step login: ask for the authenticator code
        b.insertAdjacentHTML('beforebegin', `<label class="field"><span>${T('অথেনটিকেটর অ্যাপের কোড')}</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required></label>`);
        f.code.focus();
      } else if (f.code) { f.code.value = ''; f.code.focus(); }
    }
  };
}
const langToggle = () => `<div class="seg mini">${[['bn', 'বাং'], ['en', 'EN']].map(([k, v]) => `<button type="button" class="${LANG() === k ? 'on' : ''}" data-setlang="${k}">${v}</button>`).join('')}</div>`;
const themeToggle = () => { const t = ls.get('theme', 'auto'); return `<div class="seg mini">${[['light', 'sun'], ['dark', 'moon'], ['auto', 'layers']].map(([k, ic]) =>
  `<button type="button" class="${t === k ? 'on' : ''}" data-settheme="${k}" title="${T({ light: 'লাইট', dark: 'ডার্ক', auto: 'অটো' }[k])}">${icon(ic, 16)}</button>`).join('')}</div>`; };
/* ---------------- shell ---------------- */
export const NAV = [
  ['', [['dashboard', 'chart', 'ড্যাশবোর্ড']]],
  ['কনটেন্ট', [['listings', 'list', 'সব তালিকা'], ['submissions', 'inbox', 'নতুন জমা', 'subs'], ['classifieds', 'megaphone', 'চাকরি ও ভাড়া', 'cls'],
    ['reviews', 'msg', 'রিভিউ'], ['reports', 'flag', 'রিপোর্ট', 'reports']]],
  ['ব্যবসা ও আয়', [['payments', 'wallet', 'পেমেন্ট', 'pays'], ['coupons', 'tag', 'কুপন ও অফার'], ['users', 'users', 'ব্যবহারকারী'], ['plans', 'tag', 'প্যাকেজ ও পেমেন্ট সেটিংস', null, true],
    ['ads', 'image', 'বিজ্ঞাপন (Ads)', null, true]]],
  ['অ্যাপ সাজানো', [['categories', 'grid', 'ক্যাটাগরি', null, true], ['notices', 'bell', 'ঘোষণা'], ['popup', 'sparkle', 'পপআপ', null, true]]],
  ['সিস্টেম', [['app', 'download', 'অ্যাপ রিলিজ (APK)', null, true], ['settings', 'cog', 'সাধারণ সেটিংস', null, true], ['terms', 'doc', 'শর্তাবলি', null, true], ['admins', 'shield', 'অ্যাডমিন ও নিরাপত্তা']]]
];
export const TITLES = Object.fromEntries(NAV.flatMap(g => g[1]).map(x => [x[0], x[2]]));
export function shell(page, title, actions, body) {
  const c = counts();
  root.innerHTML = `<div class="shell"><aside class="side"><div class="logo"><i>${LOGO}</i>Jashore360</div>
    ${NAV.map(([g, list]) => { const items = list.filter(x => !x[4] || owner()); return items.length ? `${g ? `<small>${T(g)}</small>` : ''}${items.map(([k, ic, t, b]) =>
      `<a href="#/${k}" class="${page === k ? 'on' : ''}">${icon(ic, 19)}<span>${T(t)}</span>${b && c[b] ? `<span class="badge">${num(c[b])}</span>` : ''}</a>`).join('')}` : ''; }).join('')}
    <span class="grow"></span><a href="/app/" target="_blank">${icon('external', 19)}<span>${T('অ্যাপ দেখুন')}</span></a>
    <div class="me"><span class="thumb" style="--c:#0e9f6e;width:34px;height:34px">${icon('user', 18)}</span><div><b>${esc(S.me?.username)}</b><span style="font-size:12px">${T(owner() ? 'মূল অ্যাডমিন' : 'মডারেটর')}</span></div>
      <button data-logout title="${T('লগআউট')}">${icon('logout', 18)}</button></div></aside>
    <div class="main"><header class="top"><button class="iconbtn menu" data-menu>${icon('menu', 22)}</button><h1>${esc(title)}</h1>${actions || ''}
      <div class="prefs">${langToggle()}${themeToggle()}</div></header>
    <div class="content">${body}</div></div></div>`;
}
