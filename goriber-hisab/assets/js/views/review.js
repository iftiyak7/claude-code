/**
 * Business review: one page that tells the owner how the period went —
 * headline numbers, five health signals, what went well / badly against the
 * period before and last year, best products and biggest costs. Print or PDF.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { t, currentLang } from '../core/i18n.js';
import { money, qty, date } from '../core/format.js';
import { page, dateRange, spinner, empty, toast } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';
import { lineChart } from '../core/chart.js';
import { printHere } from '../core/printer.js';

const STATUS = { good: ['Good', 'good'], watch: ['Keep an eye', 'watch'], bad: ['Problem', 'bad'] };

export default async function review(el, params, query) {
  const initial = query.from && query.to ? 'custom' : (query.range || 'this_month');
  let range = query.from && query.to ? { range: 'custom', from: query.from, to: query.to } : { range: initial };
  const sheet = h('div', { class: 'review-sheet' }, spinner());
  const dl = h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => download(sheet, e.currentTarget) }, icon('download', 16), t('Download PDF'));
  const pr = h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => { document.body.classList.add('printing-review'); setTimeout(printHere, 50); } }, icon('printer', 16), t('Print'));
  window.addEventListener('afterprint', () => document.body.classList.remove('printing-review'));
  const rangeCtl = dateRange((r) => {
    range = r;
    const q = r.range === 'custom' ? `from=${r.from}&to=${r.to}` : `range=${r.range}`;
    history.replaceState(null, '', `#/review?${q}`);
    load();
  }, initial);
  const p = page(t('Business review'), { back: '/', actions: [rangeCtl, dl, pr] });
  p.body.append(sheet);
  mount(el, p.el);

  async function load() {
    mount(sheet, spinner());
    try {
      const r = await api.get('reports/review', range);
      paint(sheet, r);
    } catch (err) { mount(sheet, empty(err.message)); }
  }
  // dateRange may hold custom dates in its own inputs.
  if (range.range === 'custom') {
    const [f, to] = rangeCtl.querySelectorAll('input[type=date]');
    if (f) f.value = range.from;
    if (to) to.value = range.to;
  }
  load();
  void navigate;
}

const pct = (v, sign = false) => (v === null || v === undefined ? '—' : `${sign && v > 0 ? '+' : ''}${Number(v).toLocaleString(currentLang() === 'bn' ? 'bn-BD' : 'en-US', { maximumFractionDigits: 1 })}%`);
const chip = (v, upGood = true) => {
  if (v === null || v === undefined) return null;
  const good = upGood ? v >= 0 : v <= 0;
  return h('span', { class: `rv-chg ${good ? 'up' : 'down'}` }, `${v > 0 ? '▲' : v < 0 ? '▼' : '•'} ${pct(Math.abs(v))}`);
};

function paint(sheet, r) {
  const C = r.current;
  const P = r.previous;
  const b = state.business || {};
  const period = r.from === r.to ? date(r.from) : `${date(r.from)} – ${date(r.to)}`;

  const kpi = (label, value, sub, tone, change, upGood = true) => h('div', { class: `rv-kpi ${tone}` },
    h('span', { class: 'rv-kpi-label' }, label),
    h('strong', {}, value),
    h('span', { class: 'rv-kpi-sub' }, sub || '', ' ', chip(change, upGood)));

  const sig = (s) => {
    const [label, cls] = STATUS[s.status];
    const text = {
      profit: () => t('Net profit {x}, margin {m} (before: {p})', { x: money(s.net), m: pct(s.value), p: pct(s.prev) }),
      growth: () => t('Sales {a} vs the period before, {b} vs the same days last year', { a: pct(s.prev, true), b: pct(s.year, true) }),
      cash: () => t('{p} of sales money is in hand ({x}); {d} still due', { p: pct(s.value), x: money(s.collected), d: money(s.due) }),
      retention: () => t('{p} of orders from returning customers (before: {q}), {n} new customers', { p: pct(s.value), q: pct(s.prev), n: s.new }),
      returns: () => t('Return rate {p} (before: {q})', { p: pct(s.value), q: pct(s.prev) }),
    }[s.key]();
    const name = { profit: t('Profit'), growth: t('Growth'), cash: t('Cash'), retention: t('Keeping customers'), returns: t('Returns') }[s.key];
    return h('tr', {}, h('th', {}, name), h('td', {}, h('span', { class: `rv-badge ${cls}` }, t(label))), h('td', {}, text));
  };

  const line = (x) => {
    const dir = x.dir === 'up' ? t('up') : t('down');
    const what = {
      sales: t('Sales'), net: t('Net profit'), expenses: t('Expenses'), orders: t('Number of orders'), aov: t('Average order value'),
      new_customers: t('New customers'), collection: t('Share of sales paid'), returns: t('Return rate'),
      cost_per_order: t('{n} per order', { n: x.name }),
    }[x.key];
    return h('li', {}, t('{what} {dir} {p}', { what, dir, p: pct(x.pct) }));
  };

  const chart = r.points?.length > 1 ? lineChart(r.points, [{ key: 'sales', label: t('Sales') }, ...(r.profit_ok && r.points[0]?.profit !== undefined && r.points[0]?.profit !== null ? [{ key: 'profit', label: t('Profit') }] : [])], { height: 170 }) : null;

  mount(sheet,
    h('header', { class: 'rv-head' },
      h('div', { class: 'rv-brand' },
        b.logo_url ? h('img', { src: b.logo_url, alt: '' }) : null,
        h('div', {}, h('strong', {}, b.name || ''), h('small', {}, [b.address, b.phone].filter(Boolean).join(' · ')))),
      h('div', { class: 'rv-title' }, h('strong', {}, t('Business review')), h('span', {}, period),
        h('small', {}, t('Compared with {a} and {b}', { a: `${date(r.prev.from)} – ${date(r.prev.to)}`, b: t('the same days last year') })))),
    h('div', { class: 'rv-kpis' },
      kpi(t('Sales'), money(C.sales), t('{n} orders', { n: C.count }), 'blue', r.changes.sales),
      r.profit_ok ? kpi(t('Gross profit'), money(C.gross), t('after product cost'), 'green', r.changes.gross) : null,
      r.profit_ok ? kpi(t('Expenses (all)'), money(C.expenses), t('rent, salary, bills…'), 'amber', r.changes.expenses, false) : null,
      r.profit_ok ? kpi(t('Net profit'), money(C.net), t('margin {m}', { m: pct(C.margin) }), Number(C.net) < 0 ? 'red' : 'green', r.changes.net) : null,
      !r.profit_ok ? kpi(t('Average order'), money(C.aov), '', 'green', null) : null),
    h('h3', { class: 'rv-h' }, t('5 signs of your business')),
    h('table', { class: 'rv-signals' }, h('tbody', {}, r.signals.map(sig))),
    h('div', { class: 'rv-two' },
      h('div', { class: 'rv-box good' }, h('h4', {}, '✓ ', t('What went well')), r.good.length ? h('ul', {}, r.good.map(line)) : h('p', { class: 'muted' }, t('Nothing stood out.'))),
      h('div', { class: 'rv-box bad' }, h('h4', {}, '! ', t('What needs attention')), r.bad.length ? h('ul', {}, r.bad.map(line)) : h('p', { class: 'muted' }, t('No problems found.')))),
    chart ? h('div', { class: 'rv-chart' }, h('h3', { class: 'rv-h' }, t('Day by day')), chart) : null,
    h('h3', { class: 'rv-h' }, r.profit_ok ? t('5 most profitable products') : t('5 best-selling products')),
    r.products.length ? h('table', { class: 'rv-table' },
      h('thead', {}, h('tr', {}, h('th', {}, t('Product')), h('th', { class: 'num' }, t('Quantity')), h('th', { class: 'num' }, t('Sales')), r.profit_ok ? h('th', { class: 'num' }, t('Profit')) : null)),
      h('tbody', {}, r.products.map((x) => h('tr', {}, h('td', {}, x.name), h('td', { class: 'num' }, qty(x.qty)), h('td', { class: 'num' }, money(x.sales)), r.profit_ok ? h('td', { class: 'num' }, h('strong', { class: Number(x.profit) < 0 ? 'bad-text' : 'ok-text' }, money(x.profit))) : null))))
      : h('p', { class: 'muted' }, t('No sales in this period.')),
    r.profit_ok ? h('h3', { class: 'rv-h' }, t('5 biggest costs')) : null,
    r.profit_ok ? (r.costs.length ? h('table', { class: 'rv-table' },
      h('thead', {}, h('tr', {}, h('th', {}, t('Cost')), h('th', { class: 'num' }, t('Amount')), h('th', { class: 'num' }, t('% of sales')), h('th', { class: 'num' }, t('Per order vs before')))),
      h('tbody', {}, r.costs.map((x) => h('tr', {}, h('td', {}, t(x.name)), h('td', { class: 'num' }, money(x.amount)), h('td', { class: 'num' }, pct(x.pct_of_sales)), h('td', { class: 'num' }, chip(x.per_order_chg, false) || '—')))))
      : h('p', { class: 'muted' }, t('No expenses in this period.'))) : null,
    h('p', { class: 'rv-foot' }, t('Same rules as the Profit & loss report. Made on {d}.', { d: new Date().toLocaleString(currentLang() === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) })));
}

/** The sheet as an A4-wide PDF (pages cut at A4 height). */
async function download(sheet, btn) {
  const load = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = `${window.BZL.assetsUrl}${src}?v=${window.BZL.version}`; s.onload = res; s.onerror = rej; document.head.append(s); });
  try {
    if (typeof window.html2canvas !== 'function') await load('vendor/html2canvas.min.js');
    if (typeof window.ghPdfFrom !== 'function') await load('js/sticker-pdf.js');
  } catch { toast(t('Could not prepare the PDF.'), 'error'); return; }
  // Render on a fixed A4 width so the PDF looks the same on a phone.
  const stage = h('div', { class: 'review-pdf-stage' });
  const copy = sheet.cloneNode(true);
  copy.classList.add('review-sheet-print');
  // Charts are SVG; html2canvas draws them fine. Split into A4-height slices.
  stage.append(copy);
  document.body.append(stage);
  try {
    await new Promise((r) => setTimeout(r, 60));
    const pxPerMm = 96 / 25.4;
    const pageH = Math.round(297 * pxPerMm);
    const total = copy.scrollHeight;
    const slices = [];
    for (let y = 0; y < total; y += pageH) {
      const win = h('div', { class: 'review-slice', style: `height:${Math.min(pageH, total - y)}px` });
      const inner = copy.cloneNode(true);
      inner.style.marginTop = `-${y}px`;
      win.append(inner);
      stage.append(win);
      slices.push(win);
    }
    copy.remove();
    const name = `business-review-${new Date().toISOString().slice(0, 10)}.pdf`;
    await window.ghPdfFrom(slices, name, btn, 2);
    toast(t('PDF downloaded'));
  } finally { stage.remove(); }
}
