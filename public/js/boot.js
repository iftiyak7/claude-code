/* Pull to refresh and start-up: cached data first, then fresh data. */
import { S } from './state.js';
import { empty } from './components.js';
import { maybePopup, welcome } from './gates.js';
import { cache } from './page_classifieds.js';
import { render } from './router.js';
import { buildKeys } from './search.js';
import { APP_UA, T, api, app, ls, toast } from './util.js';

/* ---------------- refresh: pull down at the top of any page, or Profile → Refresh ---------------- */
const ptr = document.createElement('div');
const setPtr = d => { ptr.style.transform = `translate(-50%, ${Math.min(d, 90) - 64}px) rotate(${d * 4}deg)`; ptr.style.opacity = Math.min(1, d / 60); ptr.classList.toggle('ready', d > 64); };
let refreshing = false;
export async function hardRefresh() {
  if (refreshing) return;
  refreshing = true; ptr.classList.add('spin'); setPtr(80);
  try {
    await refresh();
    S.ME = await api('/auth/me').catch(() => null);
    cache.ads = {}; cache.my = null; cache.ad = null; S.originCache = null;
    render(); toast(T('আপডেট হয়েছে'));
    navigator.serviceWorker?.getRegistration().then(r => r?.update()).catch(() => {});
  } catch { toast(T('সংযোগ নেই — একটু পরে আবার চেষ্টা করুন')); }
  finally { refreshing = false; ptr.classList.remove('spin'); setPtr(0); }
}
let y0 = null, dy = 0;
// Without internet (or when the site cannot be reached) the app shows the data it saved last time. A small note says so for
// a few seconds, and the app keeps trying in the background (sooner when the phone comes back online or the app is reopened);
// as soon as fresh data arrives the page updates by itself.
let barTimer = 0, retryTimer = 0, retryWait = 5000;
function offlineBar(on) {
  let bar = document.querySelector('.offbar');
  clearTimeout(barTimer);
  if (!on) return bar?.remove();
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'offbar';
    bar.setAttribute('role', 'status');
    document.body.appendChild(bar);
  }
  bar.textContent = T(navigator.onLine === false ? 'ইন্টারনেট নেই — আগে সংরক্ষিত তথ্য দেখানো হচ্ছে' : 'সংযোগ পাওয়া যাচ্ছে না — আগে সংরক্ষিত তথ্য দেখানো হচ্ছে');
  barTimer = setTimeout(() => bar.remove(), 5000);
}
function retryLater(now) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(async () => {
    if (document.hidden) return;                          // tried again when the app is opened
    try {
      const changed = await refresh();
      retryWait = 5000;
      offlineBar(false);
      if (changed) render();
    } catch {
      retryWait = Math.min(retryWait * 2, 60000);
      retryLater();
    }
  }, now ? 300 : retryWait);
}
let failing = false;
function couldNotLoad() { failing = true; offlineBar(true); retryLater(); }
function loaded() { failing = false; clearTimeout(retryTimer); retryWait = 5000; }
/* ---------------- boot ---------------- */
function setData(d) { S.D = d; S.CAT = Object.fromEntries(d.categories.map(c => [c.id, c])); buildKeys(); }
export async function refresh() {
  const d = await api('/bootstrap');
  const changed = !S.D || d.v !== S.D.v;
  setData(d);
  try { localStorage.setItem('j360.boot', JSON.stringify(d)); } catch {}
  return changed;
}

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  ptr.className = 'ptr';
  ptr.innerHTML = icon('refresh', 20);
  document.body.appendChild(ptr);
  document.addEventListener('touchstart', e => {
    y0 = window.scrollY <= 0 && e.touches.length === 1 && !document.querySelector('.sheet, .popup-bg, .welcome') ? e.touches[0].clientY : null; dy = 0;
  }, { passive: true });
  document.addEventListener('touchmove', e => { if (y0 == null) return; dy = (e.touches[0].clientY - y0) * .5; if (dy > 0) setPtr(dy); else { y0 = null; setPtr(0); } }, { passive: true });
  document.addEventListener('touchend', () => { if (y0 == null) return; y0 = null; if (dy > 64) hardRefresh(); else setPtr(0); }, { passive: true });
  (async () => {
    const cached = ls.get('boot', null);
    if (cached?.categories && cached.plans) { setData(cached); render(); welcome(); }
    try {
      const [changed, me] = await Promise.all([refresh(), api('/auth/me').catch(() => null)]);
      S.ME = me;
      if (changed || me) render();
      welcome();
      loaded();
      if (navigator.onLine === false) offlineBar(true);     // the app answered from its own copy
      else setTimeout(maybePopup, 900);
    } catch {
      if (S.D) { couldNotLoad(); welcome(); return; }
      app.innerHTML = empty(T('সংযোগ নেই'), T('ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।'), `<button class="btn sm" data-reload>${T('আবার চেষ্টা')}</button>`, 'globe');
    }
  })();
  window.addEventListener('offline', () => offlineBar(true));
  window.addEventListener('online', () => { offlineBar(false); refresh().then(changed => { loaded(); if (changed) render(); }).catch(couldNotLoad); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && failing) retryLater(true); });
  if (APP_UA) {     // the Android app keeps its own offline copy; an older browser cache would only get in its way
    navigator.serviceWorker?.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
    return;
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    // After a site update the new helper takes over; if that happens while the page has just opened, reload once so
    // the new app files are used straight away (later on, the next visit picks them up).
    const had = !!navigator.serviceWorker.controller;
    let done = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !done && performance.now() < 15000) { done = true; location.reload(); } });
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
  }
}
