/* Pull to refresh and start-up: cached data first, then fresh data. */
import { S } from './state.js';
import { empty } from './components.js';
import { maybePopup, welcome } from './gates.js';
import { cache } from './page_classifieds.js';
import { render } from './router.js';
import { buildKeys } from './search.js';
import { T, api, app, ls, toast } from './util.js';

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
      setTimeout(maybePopup, 900);
    } catch { if (!S.D) app.innerHTML = empty(T('সংযোগ নেই'), T('ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।'), `<button class="btn sm" data-reload>${T('আবার চেষ্টা')}</button>`, 'globe'); }
  })();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
}
