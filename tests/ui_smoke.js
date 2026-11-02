// Opens every page of the app and the admin panel in a real browser and fails on any script error.
//   node tests/ui_smoke.js http://127.0.0.1:PORT ADMIN_PASSWORD
// Needs Playwright (tests/test_ui.py runs it when it is installed).
const { chromium } = require('playwright');
const [base, password] = process.argv.slice(2);

const APP = ['#/', '#/emergency', '#/c/hospital', '#/c/restaurant?sort=near', '#/search?q=কাচ্চি', '#/p/h-general', '#/explore', '#/saved',
  '#/profile', '#/offers', '#/ads/rent', '#/ads/job', '#/add', '#/terms', '#/login', '#/nope'];
const APP_SIGNED_IN = ['#/account', '#/account?tab=ads', '#/account?tab=coupons', '#/post/listing?mode=free', '#/post/listing?mode=paid', '#/post/rent',
  '#/post/job', '#/post/mess', '#/post/tuition'];
const ADMIN = ['dashboard', 'listings', 'listings/h-general', 'listings/new', 'submissions', 'payments', 'coupons', 'users', 'classifieds', 'reviews',
  'reports', 'ads', 'notices', 'popup', 'categories', 'plans', 'settings', 'app', 'terms', 'admins'];

(async () => {
  const exe = process.env.PW_CHROMIUM || undefined;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];
  const watch = (p, where) => {
    p.on('pageerror', e => errors.push(`${where()}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' && !/status of 40[134]/.test(m.text())) errors.push(`${where()}: console: ${m.text()}`); });
  };
  const visit = async (p, url, sel) => {
    await p.goto(url);
    await p.waitForTimeout(350);
    if (sel && !(await p.locator(sel).count())) errors.push(`${url}: nothing rendered (${sel})`);
  };

  // app, as a visitor, then signed in
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  const p = await ctx.newPage();
  let at = 'app'; watch(p, () => at);
  await p.goto(base + '/app/'); await p.waitForTimeout(800);
  if (await p.locator('[data-agree]').count()) await p.locator('[data-agree]').check();
  if (await p.locator('[data-start]').count()) await p.click('[data-start]');
  for (const r of APP) { at = r; await visit(p, base + '/app/' + r, '#app > *'); }
  at = 'register';
  const st = await p.evaluate(async () => (await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'UI টেস্ট', phone: '0171' + String(Date.now()).slice(-7), password: 'Jsr#2026ui', terms: true }) })).status);
  if (st !== 200) errors.push('register failed: ' + st);
  await p.reload(); await p.waitForTimeout(500);
  for (const r of APP_SIGNED_IN) { at = r; await visit(p, base + '/app/' + r, '#app form, #app .tabs, #app .rows, #app > *'); }
  at = 'english'; await p.evaluate(() => localStorage.setItem('j360.lang', '"en"')); await visit(p, base + '/app/#/', '#app > *');

  // admin
  const a = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  watch(a, () => at);
  at = 'admin login';
  await a.goto(base + '/admin/');
  await a.fill('[data-login] [name=username]', 'admin'); await a.fill('[data-login] [name=password]', password);
  await a.press('[data-login] [name=password]', 'Enter'); await a.waitForTimeout(1000);
  for (const r of ADMIN) { at = 'admin ' + r; await visit(a, base + '/admin/#/' + r, '.content > *'); }

  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log(`ok: ${APP.length + APP_SIGNED_IN.length + 1} app pages, ${ADMIN.length} admin pages`);
})().catch(e => { console.error(e); process.exit(1); });
