// End-to-end smoke test against a fresh WordPress with BizLedger active and
// an admin user admin/admin123 (no business yet). Walks setup → POS → every
// screen → print → mobile, and lists console/HTTP errors.
//   BASE=http://localhost:8080 OUT=/tmp/shots node tests/e2e/smoke.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '.';
const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => { if (r.url().includes('/wp-json/') && r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });

const step = async (name, fn) => {
  try { await fn(); console.log('✓', name); }
  catch (e) { console.log('✗', name, e.message.split('\n')[0]); await page.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, '_')}.png`, fullPage: true }); }
};

await step('login', async () => {
  await page.goto(`${BASE}/wp-login.php?redirect_to=${encodeURIComponent(BASE + '/bizledger/')}`);
  await page.fill('#user_login', 'admin');
  await page.fill('#user_pass', 'admin123');
  await page.click('#wp-submit');
  await page.waitForURL(/bizledger/);
});

await step('setup wizard', async () => {
  await page.waitForSelector('.wizard', { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/01-setup.png` });
  await page.fill('input[name=name]', 'Dhaka Super Shop');
  await page.fill('input[name=phone]', '01700000000');
  await page.click('button[type=submit]'); // -> currency
  await page.selectOption('select[name=currency_code]', 'BDT');
  await page.click('button[type=submit]'); // -> type
  await page.check('input[value=grocery]');
  await page.click('button[type=submit]'); // -> team
  await page.click('button[type=submit]'); // -> invoice
  await page.click('button[type=submit]'); // -> tax
  await page.check('input[name=tax_enabled]');
  await page.fill('input[name=tax_rate]', '5');
  await page.click('button[type=submit]'); // -> printer
  await page.click('button[type=submit]'); // -> finish
  await page.check('input[name=demo]');
  await page.screenshot({ path: `${OUT}/02-setup-finish.png` });
  await page.click('button[type=submit]');
  await page.waitForSelector('.stats', { timeout: 20000 });
});

await step('dashboard', async () => {
  await page.waitForSelector('.chart');
  await page.screenshot({ path: `${OUT}/03-dashboard.png`, fullPage: true });
});

await step('POS sale', async () => {
  await page.goto(`${BASE}/bizledger/#/pos`);
  await page.waitForSelector('.tile');
  await page.screenshot({ path: `${OUT}/04-pos-empty.png` });
  const tiles = page.locator('.pos-grid .tile');
  await tiles.nth(0).click();
  await tiles.nth(3).click();
  await tiles.nth(3).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/05-pos-cart.png` });
  await page.click('.pay-btn');
  await page.waitForSelector('dialog .pay');
  await page.fill('input[name=given]', '1000');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/06-pos-pay.png` });
  await page.click('dialog .btn-primary.btn-lg');
  await page.waitForSelector('dialog .done', { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/07-pos-done.png` });
  await page.click('dialog .modal-foot .btn-primary');
});

await step('sales list + detail', async () => {
  await page.goto(`${BASE}/bizledger/#/sales`);
  await page.waitForSelector('.table tbody tr');
  await page.screenshot({ path: `${OUT}/08-sales.png` });
  await page.click('.table tbody tr');
  await page.waitForSelector('.doc-totals');
  await page.screenshot({ path: `${OUT}/09-sale-detail.png`, fullPage: true });
});

for (const [name, url, sel] of [
  ['products', '#/products', '.table tbody tr'],
  ['product detail', '#/products/1', '.barcode-box'],
  ['inventory', '#/inventory', '.table tbody tr'],
  ['movements', '#/inventory/movements', '.table tbody tr'],
  ['customers', '#/customers', '.table tbody tr'],
  ['customer profile', '#/customers/1', '.stats'],
  ['purchases', '#/purchases', '.table tbody tr'],
  ['new purchase form', '#/purchases/new', '.doc-form'],
  ['payments', '#/payments', '.table tbody tr'],
  ['expenses', '#/expenses', '.table'],
  ['accounting', '#/accounting', '.card'],
  ['journal', '#/accounting/journal', '.table tbody tr'],
  ['reports hub', '#/reports', '.report-links'],
  ['profit-loss', '#/reports/profit-loss', '.statement'],
  ['balance sheet', '#/reports/balance-sheet', '.statement'],
  ['trial balance', '#/reports/trial-balance', '.table'],
  ['sales by product', '#/reports/sales-product', '.table'],
  ['dues', '#/reports/dues', '.card'],
  ['cash book', '#/reports/cash-book', '.card'],
  ['users', '#/users', '.table'],
  ['branches', '#/branches', '.table'],
  ['settings business', '#/settings/business', 'form'],
  ['settings invoice', '#/settings/invoice', 'form'],
  ['settings data', '#/settings/data', '.card'],
  ['notifications', '#/notifications', '.card'],
  ['audit', '#/audit', '.table'],
]) {
  await step(name, async () => {
    await page.goto(`${BASE}/bizledger/${url}`);
    await page.waitForSelector(sel, { timeout: 10000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/p-${name.replace(/\W+/g, '_')}.png`, fullPage: true });
  });
}

await step('print invoice', async () => {
  const nonce = await page.evaluate(() => window.BZL.nonce);
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/bizledger/print/sale/1?_wpnonce=${nonce}&b=1&paper=a4`);
  await p2.waitForSelector('.page');
  await p2.screenshot({ path: `${OUT}/10-invoice-a4.png`, fullPage: true });
  await p2.goto(`${BASE}/bizledger/print/sale/1?_wpnonce=${nonce}&b=1&paper=80mm`);
  await p2.waitForSelector('.page');
  await p2.setViewportSize({ width: 360, height: 800 });
  await p2.screenshot({ path: `${OUT}/11-receipt-80mm.png`, fullPage: true });
  await p2.close();
});

await step('mobile', async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState(), isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push(`mobile pageerror: ${e.message}`));
  await mp.goto(`${BASE}/bizledger/#/`);
  await mp.waitForSelector('.stats');
  await mp.screenshot({ path: `${OUT}/12-mobile-dashboard.png`, fullPage: true });
  await mp.goto(`${BASE}/bizledger/#/pos`);
  await mp.waitForSelector('.tile');
  await mp.locator('.tile').first().click();
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: `${OUT}/13-mobile-pos.png` });
  await mp.goto(`${BASE}/bizledger/#/sales`);
  await mp.waitForSelector('.table tbody tr');
  await mp.screenshot({ path: `${OUT}/14-mobile-sales.png` });
  await m.close();
});

console.log('\nErrors:', errors.length ? '\n' + [...new Set(errors)].join('\n') : 'none');
await browser.close();
