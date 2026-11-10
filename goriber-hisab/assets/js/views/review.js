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

/** Brand colour and light tints of it (plain hex: the PDF renderer cannot mix colours). */
function brand() {
  const c = /^#[0-9a-f]{6}$/i.test(state.settings?.['invoice.color'] || '') ? state.settings['invoice.color'] : '#047857';
  const rgb = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const tint = (k) => `#${rgb.map((v) => Math.round(255 - (255 - v) * k).toString(16).padStart(2, '0')).join('')}`;
  const on = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) > 165 ? '#0f172a' : '#ffffff';
  return { c, on, soft: tint(0.08), mid: tint(0.22) };
}

function paint(sheet, r) {
  const C = r.current;
  const b = state.business || {};
  const B = brand();
  const period = r.from === r.to ? date(r.from) : `${date(r.from)} – ${date(r.to)}`;
  sheet.style.setProperty('--rv-c', B.c);
  sheet.style.setProperty('--rv-on', B.on);
  sheet.style.setProperty('--rv-soft', B.soft);
  sheet.style.setProperty('--rv-mid', B.mid);

  // One plain sentence first: how did it go?
  const net = Number(C.net);
  const story = [
    t('{n} sales brought in {s}.', { n: C.count, s: money(C.sales) }),
    r.profit_ok ? (net >= 0 ? t('After product cost and all expenses you kept {p}.', { p: money(C.net) }) : t('After product cost and all expenses you lost {p}.', { p: money(String(Math.abs(net))) })) : '',
    r.has_prev && r.changes.sales !== null ? t('Sales are {c} compared with the period before.', { c: pct(r.changes.sales, true) }) : t('There are no earlier sales to compare with yet.'),
  ].filter(Boolean).join(' ');

  const kpi = (ic, label, value, sub, tone, change, upGood = true) => h('div', { class: `rv-kpi ${tone}` },
    h('span', { class: 'rv-kpi-label' }, icon(ic, 15), label),
    h('strong', {}, value),
    h('span', { class: 'rv-kpi-sub' }, sub || '', r.has_prev ? chip(change, upGood) : null));

  const sig = (s) => {
    const [label, cls] = STATUS[s.status];
    const before = (v) => (r.has_prev ? ` (${t('before')}: ${pct(v)})` : '');
    const text = {
      profit: () => t('Net profit {x}, margin {m}', { x: money(s.net), m: pct(s.value) }) + before(s.prev),
      growth: () => (r.has_prev
        ? t('Sales {a} vs the period before', { a: pct(s.prev, true) }) + (r.has_year && s.year !== null ? `, ${t('{b} vs the same days last year', { b: pct(s.year, true) })}` : '')
        : t('No earlier sales to compare with yet.')),
      cash: () => t('{p} of sales money is in hand ({x}); {d} still due', { p: pct(s.value), x: money(s.collected), d: money(s.due) }),
      retention: () => t('{p} of orders from returning customers, {n} new customers', { p: pct(s.value), n: s.new }) + before(s.prev),
      returns: () => t('Return rate {p}', { p: pct(s.value) }) + before(s.prev),
    }[s.key]();
    const meta = { profit: ['income', t('Profit')], growth: ['reports', t('Growth')], cash: ['cash', t('Cash')], retention: ['users', t('Keeping customers')], returns: ['return', t('Returns')] }[s.key];
    // No earlier data: growth is not "keep an eye", it is simply unknown.
    const shown = s.key === 'growth' && !r.has_prev ? ['—', 'none'] : [t(label), cls];
    return h('div', { class: `rv-sig ${shown[1]}` },
      h('div', { class: 'rv-sig-top' }, h('span', { class: 'rv-sig-ic' }, icon(meta[0], 16)), h('strong', {}, meta[1]), h('span', { class: `rv-badge ${shown[1]}` }, shown[0])),
      h('p', {}, text));
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

  // Ranked product list with a bar for each.
  const ranked = (rows, by, unit) => {
    const max = Math.max(...rows.map((x) => Math.abs(Number(x[by])) || 0), 1);
    return h('ol', { class: 'rv-rank' }, rows.map((x, i) => h('li', {},
      h('span', { class: `rv-pos p${i + 1}` }, String(i + 1)),
      h('div', { class: 'rv-rank-main' },
        h('div', { class: 'rv-rank-top' },
          h('strong', {}, x.name),
          h('span', { class: 'rv-rank-val' }, unit(x))),
        h('div', { class: 'rv-bar' }, h('span', { style: `width:${Math.max(4, Math.round(Math.abs(Number(x[by])) / max * 100))}%` })),
        h('small', {}, [
          by !== 'qty' ? `${qty(x.qty)} ${t('sold')}` : null,
          by !== 'sales' ? money(x.sales) : null,
          x.orders ? t('on {n} bills', { n: x.orders }) : null,
          x.share !== null && x.share !== undefined ? t('{p} of sales', { p: pct(x.share) }) : null,
          r.profit_ok && by !== 'profit' && x.profit !== null ? `${t('Profit')} ${money(x.profit)}` : null,
        ].filter(Boolean).join(' · '))))));
  };

  const chart = r.points?.length > 1 ? lineChart(r.points, [{ key: 'sales', label: t('Sales') }, ...(r.profit_ok && r.points[0]?.profit !== undefined && r.points[0]?.profit !== null ? [{ key: 'profit', label: t('Profit') }] : [])], { height: 170 }) : null;
  const best = r.best || [];
  const maxCost = Math.max(...(r.costs || []).map((x) => Number(x.amount)), 1);

  mount(sheet,
    h('header', { class: 'rv-head' },
      h('div', { class: 'rv-brand' },
        b.logo_url ? h('img', { src: b.logo_url, alt: '' }) : null,
        h('div', {}, h('strong', {}, b.name || ''), h('small', {}, [b.address, b.phone].filter(Boolean).join(' · ')))),
      h('div', { class: 'rv-title' }, h('strong', {}, t('Business review')), h('span', {}, period),
        r.has_prev ? h('small', {}, t('Compared with {a}', { a: `${date(r.prev.from)} – ${date(r.prev.to)}` })) : null)),
    h('p', { class: 'rv-story' }, story),
    h('div', { class: 'rv-kpis' },
      kpi('sales', t('Sales'), money(C.sales), t('{n} orders', { n: C.count }), 'blue', r.changes.sales),
      r.profit_ok ? kpi('reports', t('Gross profit'), money(C.gross), t('after product cost'), 'green', r.changes.gross) : null,
      r.profit_ok ? kpi('expenses', t('Expenses (all)'), money(C.expenses), t('rent, salary, bills…'), 'amber', r.changes.expenses, false) : null,
      r.profit_ok ? kpi('income', t('Net profit'), money(C.net), t('margin {m}', { m: pct(C.margin) }), net < 0 ? 'red' : 'green', r.changes.net) : null,
      !r.profit_ok ? kpi('cash', t('Average order'), money(C.aov), '', 'green', null) : null),
    h('section', { class: 'rv-sec' },
      h('h3', { class: 'rv-h' }, '🏆 ', t('Top 5 best-selling products')),
      best.length ? ranked(best, 'qty', (x) => `${qty(x.qty)} ${t('sold')}`) : h('p', { class: 'muted' }, t('No sales in this period.'))),
    chart ? h('section', { class: 'rv-sec rv-chart' }, h('h3', { class: 'rv-h' }, t('Day by day')), chart) : null,
    h('section', { class: 'rv-sec' },
      h('h3', { class: 'rv-h' }, t('5 signs of your business')),
      h('div', { class: 'rv-sigs' }, r.signals.map(sig))),
    h('div', { class: 'rv-two' },
      h('div', { class: 'rv-box good' }, h('h4', {}, '✓ ', t('What went well')), r.good.length ? h('ul', {}, r.good.map(line)) : h('p', { class: 'muted' }, r.has_prev ? t('Nothing stood out.') : t('Shown once there is an earlier period to compare with.'))),
      h('div', { class: 'rv-box bad' }, h('h4', {}, '! ', t('What needs attention')), r.bad.length ? h('ul', {}, r.bad.map(line)) : h('p', { class: 'muted' }, r.has_prev ? t('No problems found.') : t('Shown once there is an earlier period to compare with.')))),
    r.profit_ok ? h('section', { class: 'rv-sec' },
      h('h3', { class: 'rv-h' }, '💰 ', t('5 most profitable products')),
      r.products.length ? ranked(r.products, 'profit', (x) => h('span', { class: Number(x.profit) < 0 ? 'bad-text' : 'ok-text' }, money(x.profit))) : h('p', { class: 'muted' }, t('No sales in this period.'))) : null,
    r.profit_ok ? h('section', { class: 'rv-sec' },
      h('h3', { class: 'rv-h' }, t('5 biggest costs')),
      r.costs.length ? h('div', { class: 'rv-costs' }, r.costs.map((x) => h('div', { class: 'rv-cost' },
        h('div', { class: 'rv-rank-top' }, h('strong', {}, t(x.name)), h('span', { class: 'rv-rank-val' }, money(x.amount))),
        h('div', { class: 'rv-bar cost' }, h('span', { style: `width:${Math.max(4, Math.round(Number(x.amount) / maxCost * 100))}%` })),
        h('small', {}, [x.pct_of_sales !== null ? t('{p} of sales', { p: pct(x.pct_of_sales) }) : null, r.has_prev && x.per_order_chg !== null ? t('per order {c} vs before', { c: pct(x.per_order_chg, true) }) : null].filter(Boolean).join(' · ')))))
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
