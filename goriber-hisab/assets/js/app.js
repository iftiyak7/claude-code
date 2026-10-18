/**
 * Goriber Hisab app entry: bootstraps the session, renders the shell and routes
 * to lazily loaded screens.
 */
import { h, mount, $, debounce } from './core/dom.js';
import { icon } from './core/icons.js';
import { api, clearSavedReads } from './core/api.js';
import { state, can, canAny, setBusiness, on, emit } from './core/state.js';
import { route, start, navigate, current } from './core/router.js';
import { loadLanguage, t, currentLang } from './core/i18n.js';
import { spinner, empty, modal, toast } from './core/ui.js';
import { sync, queued, refreshSnapshot } from './core/offline.js';
import { pullToRefresh, reloadApp } from './core/pull.js';
import { startAlerts } from './core/alerts.js';

const NAV = [
  ['/', 'dashboard', 'Dashboard', ['dashboard.view']],
  ['/pos', 'pos', 'POS', ['pos.use']],
  ['/sales', 'sales', 'Sales', ['sales.view']],
  ['/orders', 'truck', 'Online orders', ['orders.view']],
  ['/purchases', 'purchases', 'Purchases', ['purchases.view']],
  ['/products', 'products', 'Products', ['products.view']],
  ['/inventory', 'inventory', 'Inventory', ['inventory.view']],
  ['/stock-status', 'alert', 'Stock status', ['inventory.view', 'products.view']],
  ['/customers', 'customers', 'Customers', ['customers.view']],
  ['/suppliers', 'suppliers', 'Suppliers', ['suppliers.view']],
  ['/payments', 'payments', 'Payments', ['payments.view']],
  ['/cash', 'cash', 'Cash & bank', ['cash.manage']],
  ['/accounting', 'accounting', 'Accounting', ['accounting.view']],
  ['/expenses', 'expenses', 'Expenses', ['expenses.view']],
  ['/income', 'income', 'Income', ['income.view']],
  ['/reports', 'reports', 'Reports', ['reports.view']],
  ['/users', 'users', 'Users', ['users.manage']],
  ['/branches', 'branches', 'Branches', ['branches.manage']],
  ['/settings', 'settings', 'Settings', ['settings.manage', 'business.manage', 'data.export', 'backup.manage']],
];

const v = (name) => () => import(`./views/${name}.js?v=${window.BZL.version}`);

route('/', v('dashboard'));
route('/setup', v('setup'), { bare: true });
route('/pos', v('pos'), { full: true });
route('/sales', v('sales'));
route('/sales/new', v('document-form'), { doc: 'sale' });
route('/sales/:id', v('sales'));
route('/sales/:id/edit', v('document-form'), { doc: 'sale' });
route('/sales/:id/return', v('returns'), { doc: 'sale' });
route('/stock-status', v('stock-status'));
route('/orders', v('orders'));
route('/orders/new', v('orders'));
route('/orders/:id', v('orders'));
route('/purchases', v('purchases'));
route('/purchases/new', v('document-form'), { doc: 'purchase' });
route('/purchases/:id', v('purchases'));
route('/purchases/:id/edit', v('document-form'), { doc: 'purchase' });
route('/purchases/:id/return', v('returns'), { doc: 'purchase' });
route('/returns/:id', v('returns'));
route('/products', v('products'));
route('/products/new', v('products'));
route('/products/labels', v('labels'));
route('/products/:id', v('products'));
route('/products/:id/edit', v('products'));
route('/inventory', v('inventory'));
route('/inventory/movements', v('inventory'));
route('/customers', v('contacts'), { contact: 'customer' });
route('/customers/new', v('contacts'), { contact: 'customer' });
route('/customers/:id', v('contacts'), { contact: 'customer' });
route('/customers/:id/edit', v('contacts'), { contact: 'customer' });
route('/suppliers', v('contacts'), { contact: 'supplier' });
route('/suppliers/new', v('contacts'), { contact: 'supplier' });
route('/suppliers/:id', v('contacts'), { contact: 'supplier' });
route('/suppliers/:id/edit', v('contacts'), { contact: 'supplier' });
route('/payments', v('payments'));
route('/payments/receive', v('payments'));
route('/payments/pay', v('payments'));
route('/payments/:id', v('payments'));
route('/expenses', v('finance'), { kind: 'expense' });
route('/expenses/new', v('finance'), { kind: 'expense' });
route('/expenses/:id', v('finance'), { kind: 'expense' });
route('/income', v('finance'), { kind: 'income' });
route('/income/new', v('finance'), { kind: 'income' });
route('/income/:id', v('finance'), { kind: 'income' });
route('/cash', v('cash'));
route('/accounting', v('accounting'));
route('/accounting/journal', v('accounting'));
route('/accounting/journal/new', v('accounting'));
route('/accounting/journal/:id', v('accounting'));
route('/accounting/ledger/:id', v('accounting'));
route('/reports', v('reports'));
route('/reports/:name', v('reports'));
route('/users', v('users'));
route('/branches', v('users'));
route('/settings', v('settings'));
route('/settings/:tab', v('settings'));
route('/notifications', v('notifications'));
route('/audit', v('notifications'));
route('/sync', v('notifications'));
route('/platform', v('platform'));
route('/subscription', v('subscription'));

const app = document.getElementById('app');
let main;

// Phones: while typing, hide the bottom menu and keep the field in view above the Save bar.
const typing = (el) => el && el.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable]');
let kbTimer;
document.addEventListener('focusin', (e) => {
  if (!typing(e.target) || window.innerWidth >= 1024) return;
  clearTimeout(kbTimer);
  document.body.classList.add('kb-open');
  setTimeout(() => { if (document.activeElement === e.target) e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 350);
});
document.addEventListener('focusout', () => {
  clearTimeout(kbTimer);
  kbTimer = setTimeout(() => { if (!typing(document.activeElement)) document.body.classList.remove('kb-open'); }, 150);
});

// Logging out forgets the data saved on this device for offline use.
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href]');
  if (a && window.BZL.logoutUrl && a.href === new URL(window.BZL.logoutUrl, location.href).href) clearSavedReads();
}, true);

// Offline (or server down): tell the person they are looking at saved data.
let savedNoticeAt = 0;
document.addEventListener('gh:saved-data', (e) => {
  if (Date.now() - savedNoticeAt < 60000) return;
  savedNoticeAt = Date.now();
  const d = new Date(e.detail).toLocaleString(currentLang() === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  toast(t('No internet — showing data saved on this phone ({d}).', { d }), 'info', 5000);
});

async function boot() {
  try {
    const cookieLang = (document.cookie.match(/(?:^|; )gh_lang=(bn|en)/) || [])[1];
    await loadLanguage(cookieLang || localStorage.getItem('bzl.lang') || window.BZL.lang, window.BZL.assetsUrl, window.BZL.version);
  } catch { /* English fallback */ }
  await loadSession();
  if (state.me.blocked) {
    // Subscription ran out: only the renewal screen is available.
    setBusiness(state.me.blocked.business_id, 0);
    const { blockedScreen } = await import(`./views/subscription.js?v=${window.BZL.version}`);
    blockedScreen(app, state.me.blocked);
    return;
  }
  registerServiceWorker();
  pullToRefresh();
  start(render);
  // Load every screen's code in the background so moving around is instant.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => ['dashboard', 'pos', 'sales', 'products', 'contacts', 'orders', 'purchases', 'payments', 'finance', 'cash', 'reports', 'inventory', 'document-form', 'settings', 'labels', 'stock-status']
    .forEach((n, i) => setTimeout(() => import(`./views/${n}.js?v=${window.BZL.version}`).catch(() => {}), i * 120)));
  if (state.ctx) {
    sync();
    refreshSnapshot();
    startAlerts();
  }
}

async function loadSession() {
  try {
    state.me = await api.get('me', { business: state.businessId, branch: state.branchId });
  } catch (err) {
    if (err.status === 401 && window.BZL.loginUrl) { location.replace(window.BZL.loginUrl); throw err; }
    mount(app, h('div', { class: 'boot-error' }, icon('alert', 40), h('h1', {}, t('Could not load Goriber Hisab')), h('p', {}, err.message),
      h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, t('Try again'))));
    throw err;
  }
  if (state.ctx) {
    setBusiness(state.ctx.business.id, state.ctx.branch_id);
    applyTheme();
  }
  emit('session', state.me);
}

function applyTheme() {
  const color = state.settings['invoice.color'];
  if (color && /^#[0-9a-f]{6}$/i.test(color)) document.documentElement.style.setProperty('--brand', color);
}

let shellBuilt = false;

async function render(match) {
  const platformPage = match.path.startsWith('/platform') && state.me?.platform?.admin;
  if (state.me?.needs_setup && match.path !== '/setup' && !platformPage) {
    if (!state.me.can_setup && state.me.platform?.admin) { navigate('/platform', true); return; } // platform team member
    if (!state.me.can_setup) {
      mount(app, h('div', { class: 'boot-error' }, icon('alert', 40), h('h1', {}, t('No shop is linked to your account yet.')),
        h('p', {}, state.me.platform?.support_phone ? t('Please contact support: {p}', { p: state.me.platform.support_phone }) : t('Please contact the person who gave you this login.')),
        h('a', { class: 'btn', href: window.BZL.logoutUrl }, t('Log out'))));
      return;
    }
    navigate('/setup', true);
    return;
  }
  const meta = { ...(match.route?.meta || {}) };
  if (platformPage && !state.ctx) meta.bare = true;
  if (meta.bare) {
    shellBuilt = false;
    main = h('main', { class: 'bare' });
    mount(app, main);
  } else if (!shellBuilt) {
    buildShell();
  }
  document.body.classList.toggle('full-screen', !!meta.full);
  highlightNav(match.path);

  if (!match.route) {
    mount(main, empty(t('Page not found.'), h('a', { class: 'btn', href: '#/' }, t('Go to dashboard'))));
    return;
  }
  mount(main, spinner());
  try {
    const mod = await match.route.load();
    if (current().path !== match.path) return; // navigated away while loading
    const el = h('div', { class: 'view' });
    mount(main, el);
    await mod.default(el, { ...match.params, ...meta }, match.query);
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    mount(main, empty(err.status === 403 ? t('You do not have access to this page.') : t(err.message || '') || t('Something went wrong.')));
  }
}

function navItems() {
  const items = NAV.filter(([, , , perms]) => canAny(...perms));
  const sub = state.me.subscription;
  if (sub?.managed && (state.ctx.role === 'owner' || can('business.manage'))) items.push(['/subscription', 'calendar', 'Subscription', []]);
  if (state.me.platform?.admin) items.push(['/platform', 'branches', 'Shops (clients)', []]);
  return items;
}

/** Reminder bar when a hosted shop is about to run out. */
function subscriptionBanner() {
  const sub = state.me.subscription;
  if (!sub?.managed || sub.days_left === null || sub.days_left > 7) return null;
  const owner = state.ctx.role === 'owner' || can('business.manage');
  const text = sub.status === 'trial' && sub.days_left > 0 ? t('Free trial: {n} days left.', { n: sub.days_left })
    : sub.days_left > 0 ? t('Your subscription ends in {n} days.', { n: sub.days_left })
    : sub.days_left === 0 ? t('Your subscription ends today.')
      : t('Your subscription has expired. The shop will be locked in {n} days.', { n: Math.max(0, sub.grace_left ?? 0) });
  return h('div', { class: `sub-banner ${sub.days_left < 0 ? 'bad' : ''}`, role: 'status' }, icon('alert', 18), h('span', {}, text),
    owner ? h('a', { class: 'btn btn-sm', href: '#/subscription' }, sub.status === 'trial' ? t('Pay now') : t('Renew now')) : null);
}

function buildShell() {
  shellBuilt = true;
  const ctx = state.ctx;
  main = h('main', { id: 'main', tabindex: -1 });

  const businessSwitch = state.me.businesses.length > 1
    ? h('select', { class: 'switch', 'aria-label': t('Business'), onchange: (e) => switchBusiness(Number(e.target.value), 0) },
      state.me.businesses.map((b) => h('option', { value: b.id, selected: b.id === ctx.business.id }, b.name)))
    : h('strong', { class: 'biz-name' }, ctx.business.name);
  const branchSwitch = ctx.branches.length > 1
    ? h('select', { class: 'switch', 'aria-label': t('Branch'), onchange: (e) => switchBusiness(ctx.business.id, Number(e.target.value)) },
      ctx.branches.map((b) => h('option', { value: b.id, selected: Number(b.id) === ctx.branch_id }, b.name)))
    : null;

  const sidebar = h('nav', { class: 'sidebar', 'aria-label': t('Main') },
    h('div', { class: 'brand' }, h('img', { src: `${window.BZL.assetsUrl}img/icon.svg`, alt: '', width: 28, height: 28 }), h('span', {}, t('Goriber Hisab'))),
    h('div', { class: 'switches' }, businessSwitch, branchSwitch),
    h('ul', {}, navItems().map(([path, ic, label]) => h('li', {}, h('a', { href: `#${path}`, dataset: { path } }, icon(ic), h('span', {}, t(label)))))),
    h('div', { class: 'sidebar-foot' },
      window.BZL.appOnly ? null : h('a', { href: window.BZL.adminUrl }, icon('back', 16), t('WordPress admin')),
      h('a', { href: window.BZL.logoutUrl }, icon('logout', 16), t('Log out')),
      h('span', { class: 'side-credit' }, h('img', { src: `${window.BZL.assetsUrl}img/nooriyah.jpg`, alt: '', width: 20, height: 20 }), t('A product of'), ' ', h('b', {}, 'NOORIYAH Group'))));

  const bell = h('a', { class: 'icon-btn bell', href: '#/notifications', 'aria-label': t('Notifications') }, icon('bell'), h('span', { class: 'dot', hidden: !state.me.unread }, String(state.me.unread || '')));
  const offline = h('a', { class: 'offline-pill', href: '#/sync', hidden: navigator.onLine }, icon('wifi_off', 16), h('span', {}, t('Offline')));
  const queueBadge = h('a', { class: 'queue-pill', href: '#/sync', hidden: true });

  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': t('Menu'), onclick: () => document.body.classList.toggle('nav-open') }, icon('menu')),
    globalSearch(),
    offline, queueBadge,
    can('pos.use') ? h('a', { class: 'btn btn-primary btn-sm hide-sm', href: '#/pos' }, icon('plus', 16), t('New sale')) : null,
    h('button', { class: 'icon-btn refresh-btn', type: 'button', title: t('Refresh'), 'aria-label': t('Refresh'), onclick: (e) => { e.currentTarget.classList.add('spin'); reloadApp(); } }, icon('refresh', 20)),
    themeToggle(),
    langToggle(),
    bell,
    h('span', { class: 'avatar', title: state.me.user.name }, h('img', { src: state.me.user.avatar, alt: '', width: 32, height: 32, onerror: (e) => { e.target.replaceWith(icon('users')); } })));

  // Phone bottom bar: POS sits in the middle as the main action.
  const items = navItems();
  const pick = (p) => items.find(([path]) => path === p);
  const slots = ['/', '/sales', '/pos', '/customers'].map(pick).filter(Boolean);
  const bottom = h('nav', { class: 'bottom-nav', 'aria-label': t('Quick') },
    slots.map(([path, ic, label]) => h('a', { href: `#${path}`, dataset: { path }, class: path === '/pos' ? 'center' : '' }, path === '/pos' ? h('span', { class: 'center-btn' }, icon(ic, 24)) : icon(ic), h('span', {}, t(label)))),
    h('button', { type: 'button', onclick: () => document.body.classList.toggle('nav-open') }, icon('more'), h('span', {}, t('More'))));

  mount(app,
    h('a', { class: 'skip', href: '#main', onclick: (e) => { e.preventDefault(); main.focus(); } }, t('Skip to content')),
    sidebar,
    h('div', { class: 'scrim', onclick: () => document.body.classList.remove('nav-open') }),
    h('div', { class: 'shell' }, topbar, subscriptionBanner(), main),
    bottom);

  on('online', (isOnline) => { offline.hidden = isOnline; });
  on('queue', (q) => {
    queueBadge.hidden = !q.length;
    queueBadge.textContent = t('{n} to sync', { n: q.length });
  });
  on('unread', (n) => { const d = $('.dot', bell); d.hidden = !n; d.textContent = String(n); });
  queued().then((q) => emit('queue', q));
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) document.body.classList.remove('nav-open'); });
}

/** বাংলা ⇄ English. Also remembered for the login and home pages. */
/* Light / dark / follow the phone. Remembered on this device (and by the Android app via the cookie). */
const THEMES = ['auto', 'light', 'dark'];
export function applyThemeMode(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode; else delete root.dataset.theme;
  const dark = mode === 'dark' || (mode !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0f1218' : '#0b1a2e');
}
function themeMode() { try { return localStorage.getItem('gh.theme') || 'auto'; } catch { return 'auto'; } }
function themeToggle() {
  const icons = { auto: '◐', light: '☀', dark: '☾' };
  const labels = { auto: t('Theme: automatic'), light: t('Theme: light'), dark: t('Theme: dark') };
  const btn = h('button', { class: 'lang-btn theme-btn', type: 'button' });
  const paint = () => { const m = themeMode(); btn.textContent = icons[m]; btn.title = labels[m]; btn.setAttribute('aria-label', labels[m]); };
  btn.addEventListener('click', () => {
    const next = THEMES[(THEMES.indexOf(themeMode()) + 1) % THEMES.length];
    try { localStorage.setItem('gh.theme', next); } catch { /* ignore */ }
    document.cookie = `gh_theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
    applyThemeMode(next); paint();
  });
  paint();
  return btn;
}
applyThemeMode(themeMode());

function langToggle() {
  const next = currentLang() === 'bn' ? 'en' : 'bn';
  return h('button', { class: 'lang-btn', type: 'button', title: next === 'bn' ? 'বাংলায় দেখুন' : 'Switch to English', onclick: () => {
    try { localStorage.setItem('bzl.lang', next); } catch { /* ignore */ }
    document.cookie = `gh_lang=${next}; path=/; max-age=31536000; SameSite=Lax`;
    location.reload();
  } }, next === 'bn' ? 'বাংলা' : 'EN');
}

function highlightNav(path) {
  const top = '/' + (path.split('/')[1] || '');
  document.querySelectorAll('[data-path]').forEach((a) => {
    const on = a.dataset.path === top;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

async function switchBusiness(businessId, branchId) {
  setBusiness(businessId, branchId);
  shellBuilt = false;
  mount(app, spinner());
  await loadSession();
  render(current());
  refreshSnapshot();
}

function globalSearch() {
  const results = h('div', { class: 'search-results', hidden: true, role: 'listbox' });
  const input = h('input', { class: 'input', type: 'search', placeholder: t('Search invoices, customers, products…'), 'aria-label': t('Search') });
  const paths = { sales: '/sales/', purchases: '/purchases/', products: '/products/', customers: '/customers/', suppliers: '/suppliers/' };
  const labels = { sales: t('Sales'), purchases: t('Purchases'), products: t('Products'), customers: t('Customers'), suppliers: t('Suppliers') };
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { results.hidden = true; return; }
    try {
      const res = await api.get('search', { q });
      const groups = Object.entries(res).filter(([, items]) => items.length);
      mount(results, groups.length ? groups.map(([group, items]) => h('div', { class: 'search-group' },
        h('h4', {}, labels[group] || group),
        items.map((it) => h('a', { href: `#${paths[group]}${it.id}`, onclick: () => { results.hidden = true; input.value = ''; } }, h('strong', {}, it.title), h('small', {}, it.subtitle))))) : h('p', { class: 'muted pad' }, t('No matches')));
      results.hidden = false;
    } catch { /* offline */ }
  }, 250);
  input.addEventListener('input', run);
  input.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 200));
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); input.focus(); }
  });
  return h('div', { class: 'global-search' }, icon('search', 18), input, results);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // The Android app carries the whole app inside it, and the website is online-only:
  // no service worker anywhere (remove ones registered by older versions).
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
}

// Screens ask for a fresh session (after setup, settings, business changes).
on('session:reload', async (opts = {}) => {
  if (opts.business) setBusiness(opts.business, 0);
  shellBuilt = false;
  await loadSession();
  if (opts.go) navigate(opts.go, true); else render(current());
});

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.code === 'session') {
    modal({ title: t('Session expired'), body: h('p', {}, e.reason.message), actions: [h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, t('Reload'))] });
  }
});

boot();
