/* Router: from the address (#/…) to a page, plus carousels and impressions. */
import { S } from './state.js';
import { adImpressions } from './ads.js';
import { locate } from './data.js';
import { cache } from './page_classifieds.js';
import { MEDIA, drawMedia, fillForm } from './page_post.js';
import { pages } from './pages.js';
import { closeSheet } from './sheets.js';
import { T, app, beacon, loc, nav, toast } from './util.js';

/* ---------------- router ---------------- */
const routes = [[/^$/, 'home'], [/^emergency$/, 'emergency'], [/^c\/([\w-]+)$/, 'browse'], [/^search$/, 'browse'], [/^p\/([\w-]+)$/, 'item'],
  [/^explore$/, 'explore'], [/^saved$/, 'saved'], [/^add$/, 'add'], [/^profile$/, 'profile'], [/^login$/, 'login'], [/^account$/, 'account'],
  [/^post\/(\w+)$/, 'post'], [/^pay\/([\w-]+)$/, 'pay'], [/^ads\/(\w+)$/, 'ads'], [/^ad\/(\w+)$/, 'ad'], [/^edit\/(listing|ad)\/([\w-]+)$/, 'edit'], [/^terms$/, 'terms'], [/^offers$/, 'offers']];
const navKey = { home: 'home', browse: 'explore', explore: 'explore', emergency: 'home', saved: 'saved', add: 'add', post: 'add', pay: 'add', edit: 'profile', terms: 'profile', offers: 'explore',
  profile: 'profile', account: 'profile', login: 'profile', ads: 'explore' };
let lastPath = null;
export const go = h => { location.hash = h; };
export function render() {
  if (!S.D) return;
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const p = new URLSearchParams(query);
  let name = 'notfound', params = [];
  const m = routes.find(([re]) => re.test(path));
  if (m) { name = m[1]; params = path.match(m[0]).slice(1); }
  if (name === 'browse' && params[0]) { if (params[0] === 'emergency') name = 'emergency'; else p.set('cat', params[0]); }
  if (path !== lastPath && (name === 'post' || name === 'edit')) { MEDIA.images = []; MEDIA.videos = []; pages.edit.filled = null; if (name === 'post') cache.edit = null; }
  const html = ['browse', 'emergency'].includes(name) ? pages[name](p) : pages[name](params, p);
  if (html === '') return;               // page redirected
  // a row of choices that scrolls sideways keeps its place when the page is redrawn, and the chosen one stays in view
  const rowScroll = path === lastPath ? [...app.querySelectorAll('.pills')].map(p => p.scrollLeft) : [];
  app.innerHTML = html;
  app.querySelectorAll('.pills').forEach((p, i) => {
    if (p.scrollWidth <= p.clientWidth) return;
    if (rowScroll[i] != null) p.scrollLeft = rowScroll[i];
    const on = p.querySelector('.on');
    if (!on) return;
    const pr = p.getBoundingClientRect(), er = on.getBoundingClientRect();
    if (er.left < pr.left + 8 || er.right > pr.right - 8) p.scrollLeft += (er.left - pr.left) - (pr.width - er.width) / 2;
  });
  nav.hidden = name === 'item' || name === 'ad';
  nav.querySelectorAll('a').forEach(a => { a.classList.toggle('on', a.dataset.nav === navKey[name]); a.setAttribute('aria-label', T(a.dataset.label)); });
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
  drawMedia();
  const ef = app.querySelector('form[data-edit]'); if (ef && cache.edit) fillForm(ef, cache.edit.doc);
  const h1 = app.querySelector('h1')?.textContent;
  document.title = name === 'home' ? `Jashore360 — ${loc(S.D.site, 'tagline')}` : `${h1 || ''} · Jashore360`;
  carousel(); adImpressions(); listingImpressions();
  const af = app.querySelector('[autofocus]'); if (af && !matchMedia('(pointer:coarse)').matches) af.focus();
}
const impSent = new Set(), impQueue = [];
let impObs, impFlush;
function listingImpressions() {
  if (!('IntersectionObserver' in window)) return;
  impObs?.disconnect();
  impObs = new IntersectionObserver(es => es.forEach(e => {
    const id = e.target.dataset.imp;
    if (!e.isIntersecting || impSent.has(id)) return;
    impSent.add(id); impQueue.push(id);
    clearTimeout(impFlush); impFlush = setTimeout(() => beacon('/impressions', { ids: impQueue.splice(0) }), 1500);
  }), { threshold: .6 });
  app.querySelectorAll('[data-imp]').forEach(el => impObs.observe(el));
}
let slideTimer;
function carousel() {
  clearInterval(slideTimer);
  const c = app.querySelector('[data-carousel], [data-slides]'), dots = app.querySelector('[data-dots]');
  if (!c || !dots) return;
  const kids = [...c.children], at = k => k.offsetLeft - kids[0].offsetLeft;
  const idx = () => kids.reduce((best, k, n) => Math.abs(at(k) - c.scrollLeft) < Math.abs(at(kids[best]) - c.scrollLeft) ? n : best, 0);
  c.onscroll = () => { const i = idx(); dots.querySelectorAll('i').forEach((d, n) => d.classList.toggle('on', n === i)); };
  // Home banners slide on their own (admin can turn it off); a touch or hover pauses them for a while.
  const site = S.D.site || {};
  if (!c.matches('[data-carousel]') || site.bannerAuto === false || kids.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let pausedUntil = 0;
  const pause = () => { pausedUntil = Date.now() + 7000; };
  ['pointerdown', 'touchstart', 'wheel', 'focusin'].forEach(ev => c.addEventListener(ev, pause, { passive: true }));
  c.addEventListener('mouseenter', () => { pausedUntil = Infinity; });
  c.addEventListener('mouseleave', () => { pausedUntil = 0; });
  slideTimer = setInterval(() => {
    if (!c.isConnected) return clearInterval(slideTimer);
    if (document.hidden || Date.now() < pausedUntil || document.querySelector('.sheet, .popup-bg, .welcome')) return;
    c.scrollTo({ left: at(kids[(idx() + 1) % kids.length]), behavior: 'smooth' });
  }, Math.max(3, +site.bannerSeconds || 5) * 1000);
}
export async function doLocate(then) {
  toast(T('লোকেশন খোঁজা হচ্ছে…'));
  try { await locate(); toast(T('লোকেশন পাওয়া গেছে')); then ? go(then) : render(); }
  catch { toast(T('লোকেশন পাওয়া যায়নি — ব্রাউজারে অনুমতি দিন')); }
}

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  // shared and search-engine links (/p/<listing>, /c/<category>) open the same page inside the app
  const deep = location.pathname.match(/^\/(p|c)\/([\w-]+)\/?$/);
  if (deep && !location.hash) history.replaceState(null, '', '/app/#/' + deep[1] + '/' + deep[2]);
  window.addEventListener('hashchange', () => { closeSheet(true); render(); });
}
