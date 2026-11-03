// The Android app without internet: every request is answered only from the files bundled into the APK
// (the same rule as MainActivity.localPath). The app must open with its data, with no script errors.
//   node tests/offline_app.js WWW_DIR [SCREENSHOT.png]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [www, shot] = process.argv.slice(2);     // optional: a screenshot of the home page

function localPath(p) {     // keep in step with MainActivity.localPath
  if (p.includes('..')) return null;
  if (p === '/' || p === '/app' || p.startsWith('/app/')) return 'app.html';
  if (p === '/api/bootstrap') return 'api/bootstrap.json';
  const f = p.slice(1);
  if (['app.css', 'i18n.js', 'icons.js', 'icon.svg', 'manifest.webmanifest'].includes(f)) return f;
  if (/^js\/[^/]+\.js$/.test(f)) return f;
  return null;
}
const TYPES = { html: 'text/html', css: 'text/css', js: 'application/javascript', svg: 'image/svg+xml', json: 'application/json', webmanifest: 'application/manifest+json' };

(async () => {
  const exe = process.env.PW_CHROMIUM || undefined;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, userAgent: 'Mozilla/5.0 (Linux; Android 13; wv) Jashore360App/4' });
  const errors = [];
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    const p = u.hostname === 'jashore360.test' ? localPath(u.pathname) : null;
    const file = p && path.join(www, p);
    if (!file || !fs.existsSync(file)) return route.abort('internetdisconnected');
    route.fulfill({ status: 200, contentType: TYPES[p.split('.').pop()] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  await page.goto('https://jashore360.test/app/');
  await page.waitForTimeout(1200);
  if (await page.locator('[data-agree]').count()) { await page.check('[data-agree]'); await page.click('[data-start]'); }
  const checks = [];
  checks.push(['offline bar', await page.locator('.offbar').count() === 1]);
  if (shot) await page.screenshot({ path: shot });
  await page.goto('https://jashore360.test/app/#/emergency'); await page.waitForTimeout(500);
  checks.push(['emergency numbers', await page.locator('a[href^="tel:"], [data-call]').count() > 0]);
  await page.goto('https://jashore360.test/app/#/c/hospital'); await page.waitForTimeout(500);
  checks.push(['hospital list', await page.locator('.rows .row').count() > 0]);
  await page.goto('https://jashore360.test/app/#/p/h-general'); await page.waitForTimeout(500);
  checks.push(['listing page', (await page.locator('h1').first().innerText()).length > 0]);
  await b.close();
  const bad = checks.filter(c => !c[1]).map(c => c[0]);
  if (errors.length || bad.length) { console.error('failed:', bad.join(', '), errors.join('\n')); process.exit(1); }
  console.log('ok: offline app opens from the bundled copy (' + checks.map(c => c[0]).join(', ') + ')');
})().catch(e => { console.error(e); process.exit(1); });
