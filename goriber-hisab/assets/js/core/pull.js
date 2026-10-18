/**
 * Pull down from the top of a page to refresh — in the Android app (WebView has
 * none of its own), in a home-screen install and in every browser alike.
 * Skipped where a reload would lose work: POS, open dialogs and forms being filled.
 */
const LIMIT = 80; // px to pull before letting go refreshes

export function reloadApp() {
  document.body.classList.add('reloading');
  location.reload();
}

function blocked(target) {
  if (document.body.classList.contains('full-screen') || document.body.classList.contains('nav-open') || document.body.classList.contains('kb-open')) return true;
  if (document.querySelector('dialog[open]') || document.querySelector('#app .boot')) return true;
  if (target.closest?.('.no-pull, .combo-list, .search-results')) return true;
  if (document.querySelector('main .form-actions.sticky')) return true; // a form is on screen
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    if (el.scrollTop > 0) return true; // inside a list that is scrolled down
  }
  return window.scrollY > 0;
}

export function pullToRefresh() {
  if (!('ontouchstart' in window)) return;
  document.documentElement.classList.add('own-pull'); // turn off the browser's own, so it does not fire twice
  const ring = document.createElement('div');
  ring.className = 'pull-ring';
  ring.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-2.6-6.4L21 8M21 3v5h-5"/></svg>';
  document.body.append(ring);
  let startY = null;
  let startX = 0;
  let dy = 0;
  const paint = () => {
    const d = Math.min(dy, LIMIT * 1.5);
    ring.style.transform = `translate(-50%, ${d * 0.8 - 50}px) rotate(${d * 4}deg)`;
    ring.style.opacity = String(Math.min(1, d / LIMIT));
    ring.classList.toggle('ready', dy >= LIMIT);
  };
  const reset = () => {
    startY = null; dy = 0;
    ring.classList.add('back'); paint();
    setTimeout(() => ring.classList.remove('back'), 250);
  };
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || blocked(e.target)) { startY = null; return; }
    startY = e.touches[0].clientY; startX = e.touches[0].clientX; dy = 0;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const y = e.touches[0].clientY - startY;
    if (window.scrollY > 0 || Math.abs(e.touches[0].clientX - startX) > Math.abs(y) + 10) { reset(); return; }
    dy = Math.max(0, y * 0.6);
    paint();
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (startY === null) return;
    if (dy >= LIMIT) {
      ring.classList.add('spin');
      reloadApp();
      return;
    }
    reset();
  }, { passive: true });
  document.addEventListener('touchcancel', () => { if (startY !== null) reset(); }, { passive: true });
}
