/**
 * Dashboard: today's numbers, period overview, charts, top products.
 * Widgets the user hides are remembered per device.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can, prefs, state } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, qty, date } from '../core/format.js';
import { page, stat, card, dateRange, spinner, badge, empty, checkbox, modal } from '../core/ui.js';
import { lineChart } from '../core/chart.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';
import { whatsappUrl, reminderText, sendReminderSms } from '../core/remind.js';
import { lightCounts, lightRow } from '../core/lights.js';

const WIDGETS = [['sales', 'Sales'], ['purchases', 'Purchases'], ['expenses', 'Expenses'], ['profit', 'Profit'], ['collection', 'Collection'], ['due', 'Due'], ['stock', 'Stock'], ['cash', 'Cash & bank']];

export default async function dashboard(el) {
  if (!can('dashboard.view')) { mount(el, empty(t('You do not have access to the dashboard.'))); return; }
  let range = { range: prefs.get('dash.range', '7d') };
  const hidden = new Set(prefs.get('dash.hidden', []));
  const content = h('div', {}, spinner());

  const customise = h('button', { class: 'btn btn-sm', type: 'button', onclick: openCustomise }, icon('settings', 16), t('Customise'));
  const p = page(t('Dashboard'), {
    subtitle: state.business.name,
    actions: [dateRange((r) => { range = r; if (r.range) prefs.set('dash.range', r.range); load(); }, range.range), customise],
  });
  // Big, thumb-friendly shortcuts for the most common daily jobs.
  const quick = [
    ['pos.use', '#/pos', 'pos', t('New sale')],
    ['orders.manage', '#/orders/new', 'truck', t('Online order')],
    ['payments.receive', '#/payments/receive', 'cash', t('Receive due')],
    ['expenses.create', '#/expenses/new', 'expenses', t('Add expense')],
    ['purchases.create', '#/purchases/new', 'purchases', t('New purchase')],
    ['products.create', '#/products/new', 'products', t('Add product')],
    ['customers.create', '#/customers/new', 'customers', t('Add customer')],
  ].filter(([perm]) => can(perm));
  if (quick.length) {
    p.body.append(h('nav', { class: 'quick-actions', 'aria-label': t('Quick actions') },
      quick.map(([, href, ic, label, onclick]) => h(href ? 'a' : 'button', { class: 'quick', href, type: href ? null : 'button', onclick }, h('span', { class: 'quick-icon' }, icon(ic, 22)), h('span', {}, label)))));
  }
  p.body.append(content);
  mount(el, p.el);

  function openCustomise() {
    const boxes = WIDGETS.map(([k, label]) => checkbox(k, !hidden.has(k), t(label)));
    const m = modal({
      title: t('Dashboard widgets'),
      body: h('div', { class: 'stack' }, boxes),
      actions: [h('button', { class: 'btn btn-primary', onclick: () => {
        hidden.clear();
        boxes.forEach((b) => { const i = b.querySelector('input'); if (!i.checked) hidden.add(i.name); });
        prefs.set('dash.hidden', [...hidden]);
        m.close();
        load();
      } }, t('Save'))],
    });
  }

  async function load() {
    mount(content, spinner());
    const d = await api.get('reports/dashboard', range);
    const show = (k) => !hidden.has(k);
    const T = d.today;
    const O = d.overview;

    const P = d.previous || {};
    const Y = d.yesterday || {};
    // "▲ 12%" against the period before (or yesterday for today's cards). Lower is better for costs.
    const change = (cur, prev, lowerIsBetter = false, vs = '') => {
      const a = Number(cur); const b = Number(prev);
      if (!b || !Number.isFinite(a) || !Number.isFinite(b)) return null;
      const pct = Math.round(((a - b) / Math.abs(b)) * 100);
      if (!pct) return null;
      return { text: `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% ${vs}`, good: lowerIsBetter ? pct < 0 : pct > 0 };
    };
    const vsY = t('vs yesterday');
    const vsP = t('vs previous');
    const todayR = { range: 'today' };
    const drill = (metric, title, r = range) => () => drillDown(metric, title, r);

    // One tile: icon, what it is in plain words, the number, and what it means.
    const tile = (ic, tone, label, value, { caption = '', change: ch = null, onclick } = {}) => h(onclick ? 'button' : 'div', { class: `kpi kpi-${tone}`, type: onclick ? 'button' : null, onclick },
      h('span', { class: 'kpi-ico' }, icon(ic, 20)),
      h('span', { class: 'kpi-body' },
        h('span', { class: 'kpi-label' }, label),
        h('strong', { class: 'kpi-value' }, value ?? '—'),
        caption || ch ? h('span', { class: 'kpi-cap' }, ch ? h('span', { class: `stat-change ${ch.good ? 'up' : 'down'}` }, ch.text) : null, ch && caption ? ' · ' : '', caption) : null),
      onclick ? h('span', { class: 'kpi-go', 'aria-hidden': 'true' }, '›') : null);

    // Today at a glance: the sales figure big, the rest underneath.
    const todayBox = h('section', { class: 'today-hero' },
      h('div', { class: 'hero-main', role: show('sales') ? 'button' : null, tabindex: show('sales') ? 0 : null, onclick: show('sales') ? drill('sales', t("Today's sales"), todayR) : null },
        h('span', { class: 'hero-label' }, t("Today's sales")),
        h('strong', { class: 'hero-value' }, money(T.sales)),
        h('span', { class: 'hero-sub' }, t('{n} invoices', { n: T.sales_count }), (() => { const c = change(T.sales, Y.sales, false, vsY); return c ? h('span', { class: `hero-chg ${c.good ? 'up' : 'down'}` }, c.text) : null; })())),
      h('div', { class: 'hero-grid' },
        show('profit') && T.profit !== null && tile('reports', Number(T.profit) < 0 ? 'bad' : 'ok', t('Profit'), money(T.profit), { caption: t('after product cost & expenses'), onclick: drill('profit', t("Today's profit"), todayR) }),
        show('collection') && tile('cash', 'ok', t('Cash received'), money(T.collection), { caption: t('sales + old dues collected'), onclick: drill('collection', t("Today's collection"), todayR) }),
        show('due') && tile('alert', Number(T.sales_due) > 0 ? 'warn' : 'muted', t('Sold on credit'), money(T.sales_due), { caption: t('not paid yet'), onclick: drill('due', t("Today's due"), todayR) }),
        show('expenses') && tile('expenses', 'bad', t('Expenses'), money(T.expenses), { onclick: drill('expenses', t("Today's expenses"), todayR) }),
        show('purchases') && tile('purchases', 'info', t('Purchases'), money(T.purchases), { onclick: drill('purchases', t("Today's purchases"), todayR) })));

    // The chosen period, in three plain groups.
    const group = (title, ...tiles) => {
      const list = tiles.filter(Boolean);
      return list.length ? h('section', { class: 'kpi-group' }, h('h3', { class: 'kpi-group-title' }, title), h('div', { class: 'kpi-grid' }, list)) : null;
    };
    const salesGroup = group(t('Sales & profit'),
      show('sales') && tile('sales', 'brand', t('Sales'), money(O.sales), { caption: Number(O.returns) ? t('Returns {x}', { x: money(O.returns) }) : '', change: change(O.sales, P.sales, false, vsP), onclick: drill('sales', t('Sales')) }),
      show('profit') && O.profit !== null && tile('reports', Number(O.profit) < 0 ? 'bad' : 'ok', t('Profit'), money(O.profit), { caption: t('after product cost & expenses'), change: change(O.profit, P.profit, false, vsP), onclick: drill('profit', t('Profit & loss')) }),
      show('expenses') && tile('expenses', 'bad', t('Expenses'), money(O.expenses), { caption: t('rent, salary, bills…'), change: change(O.expenses, P.expenses, true, vsP), onclick: drill('expenses', t('Expenses')) }),
      show('purchases') && tile('purchases', 'info', t('Purchases'), money(O.purchases), { caption: t('products bought'), onclick: drill('purchases', t('Purchases')) }));
    const moneyGroup = group(t('Money'),
      show('collection') && tile('cash', 'ok', t('Cash received'), money(O.collection), { caption: t('in this period'), change: change(O.collection, P.collection, false, vsP), onclick: drill('collection', t('Collection')) }),
      show('cash') && O.cash_balance !== null && tile('cash', 'brand', t('Cash in hand'), money(O.cash_balance), { caption: t('now'), onclick: drill('cash', t('Cash & bank')) }),
      show('cash') && O.bank_balance !== null && tile('payments', 'info', t('Bank & mobile'), money(O.bank_balance), { caption: t('bKash, Nagad, bank'), onclick: drill('cash', t('Cash & bank')) }));
    const owedGroup = group(t('Dues & stock'),
      show('due') && tile('customers', 'warn', t('Customers owe you'), money(O.customer_due), { caption: t('to collect'), onclick: drill('customer_due', t('Customer due')) }),
      show('due') && tile('suppliers', 'muted', t('You owe suppliers'), money(O.supplier_due), { caption: t('to pay'), onclick: drill('supplier_due', t('Supplier due')) }),
      show('stock') && O.stock_value !== null && tile('inventory', d.low_stock ? 'warn' : 'muted', t('Stock value'), money(O.stock_value), { caption: d.low_stock ? t('{n} low on stock', { n: d.low_stock }) : t('at cost price'), onclick: drill('stock', t('Stock')) }));

    const pts = d.charts.points;
    const series = [{ key: 'sales', label: t('Sales') }, { key: 'purchases', label: t('Purchases') }, { key: 'expenses', label: t('Expenses') }];
    if (pts[0]?.profit !== null && pts[0]?.profit !== undefined) series.push({ key: 'profit', label: t('Profit') });

    const charts = h('div', { class: 'grid-2' },
      card(t('Sales, purchases & expenses'), lineChart(pts, series.filter((s) => s.key !== 'profit'))),
      card(t('Profit & due'), lineChart(pts, [series.find((s) => s.key === 'profit'), { key: 'due', label: t('Due') }].filter(Boolean), { type: 'bar' })));

    const top = card(t('Top products'), d.top_products.length
      ? h('ol', { class: 'rank' }, d.top_products.map((p) => h('li', {}, h('a', { href: `#/products/${p.product_id}` }, p.name), h('span', { class: 'muted' }, `${qty(p.qty)} · ${money(p.amount)}`))))
      : empty(t('No sales in this period.')));
    const recent = card(t('Recent sales'), d.recent_sales.length
      ? h('ul', { class: 'list' }, d.recent_sales.map((s) => h('li', {}, h('a', { href: `#/sales/${s.id}` },
        h('span', {}, h('strong', {}, s.number), h('small', { class: 'muted' }, ` ${s.customer_name || t('Walk-in')} · ${date(s.sale_date)}`)),
        h('span', {}, money(s.total), ' ', badge(s.payment_status))))))
      : empty(t('No sales yet.'), can('pos.use') ? h('a', { class: 'btn btn-primary', href: '#/pos' }, t('Make your first sale')) : null));

    const dues = (d.top_dues || []).length ? card(t('Who owes you the most'), h('ul', { class: 'mini-list' }, d.top_dues.map((c) => h('li', {},
      h('a', { href: `#/customers/${c.id}` }, h('strong', {}, c.name), h('br'), h('small', { class: 'muted' }, c.phone || '')),
      h('span', { class: 'row' }, h('strong', { class: 'warn-text' }, money(c.balance)),
        c.phone ? h('a', { class: 'btn btn-sm wa-btn', href: whatsappUrl(c.phone, reminderText(c.name, c.balance)), target: '_blank', rel: 'noopener', title: t('Remind on WhatsApp') }, t('Remind')) : null)))),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: drill('customer_due', t('Customer due')) }, t('See all'))) : null;
    const lows = (d.low_items || []).length ? card(t('Running out'), h('ul', { class: 'mini-list' }, d.low_items.map((p) => h('li', {},
      h('a', { href: `#/products/${p.id}` }, p.name),
      h('span', { class: 'bad-text' }, t('{q} left (min {m})', { q: qty(p.qty), m: qty(p.min_stock) }))))),
      can('purchases.create') ? h('a', { class: 'btn btn-sm', href: '#/purchases/new' }, t('Buy stock')) : null) : null;

    // Stock lights: red = order now, yellow = getting low, green = fine.
    const lightsBox = show('stock') && (can('inventory.view') || can('products.view')) ? h('div', { class: 'card lights-card' }) : null;
    if (lightsBox) {
      api.get('stock/lights', { limit: 8 }).then((L) => {
        const warn = L.items.filter((p) => p.level !== 'green').slice(0, 3);
        mount(lightsBox, h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, t('Stock status')), h('a', { class: 'btn btn-sm', href: '#/stock-status' }, t('See all'))),
          lightCounts(L),
          warn.length ? h('ul', { class: 'list light-list' }, warn.map(lightRow)) : h('p', { class: 'ok-text small' }, t('All products have enough stock.')));
      }).catch(() => lightsBox.remove());
    }

    mount(content,
      h('h2', { class: 'section-title' }, t('Today')), todayBox,
      h('h2', { class: 'section-title' }, t('{from} – {to}', { from: date(d.from), to: date(d.to) })),
      h('div', { class: 'kpi-groups' }, salesGroup, moneyGroup, owedGroup),
      lightsBox,
      charts,
      dues || lows ? h('div', { class: 'grid-2' }, dues, lows) : null,
      h('div', { class: 'grid-2' }, top, recent));
  }
  await load();
}

/** What lies behind a number: summary + documents, each one opens. */
async function drillDown(metric, title, range) {
  const body = h('div', {}, spinner());
  const m = modal({ title, size: 'lg', body });
  try {
    const r = await api.get('reports/drilldown', { metric, ...range });
    const go = (path) => { m.close(); navigate(path); };
    const isDue = metric === 'customer_due';
    mount(body,
      h('p', { class: 'muted small' }, ['customer_due', 'supplier_due', 'stock', 'cash'].includes(metric) ? t('As of today') : (r.from === r.to ? date(r.from) : `${date(r.from)} – ${date(r.to)}`)),
      r.summary.length ? h('div', { class: 'drill-summary' }, r.summary.map((x) => h('div', {},
        h('small', {}, x.raw ? x.label : t(x.label)),
        h('strong', { class: x.tone || '' }, x.count ? x.value : money(x.value))))) : null,
      r.items.length ? h('ul', { class: 'drill-list' }, r.items.map((it) => h('li', {},
        h('a', { href: `#${it.link}`, onclick: (e) => { e.preventDefault(); go(it.link); } },
          h('strong', {}, it.title || '—'),
          h('small', {}, [it.sub, it.date ? date(it.date) : '', it.qty !== undefined ? t('{q} in stock', { q: qty(it.qty) }) : ''].filter(Boolean).join(' · '))),
        h('span', { class: 'amt' },
          it.amount !== null && it.amount !== undefined ? h('strong', { class: it.low ? 'low' : '' }, money(it.amount)) : (it.low ? h('strong', { class: 'low' }, t('Low')) : null),
          Number(it.due) > 0 && metric !== 'due' ? h('small', { class: 'warn-text' }, t('Due {x}', { x: money(it.due) })) : null,
          metric === 'due' && Number(it.due) > 0 ? h('small', { class: 'warn-text' }, t('Due {x}', { x: money(it.due) })) : null,
          it.note ? h('small', { class: 'muted' }, it.note) : null),
        (isDue || metric === 'due') && it.phone ? h('a', { class: 'btn btn-sm wa-btn', href: whatsappUrl(it.phone, reminderText(it.sub && !isDue ? it.sub : it.title, isDue ? it.amount : it.due)), target: '_blank', rel: 'noopener', title: t('Remind on WhatsApp') }, 'WhatsApp') : null,
        isDue && it.phone ? h('button', { class: 'btn btn-sm', type: 'button', title: t('Send SMS'), onclick: (e) => { e.currentTarget.disabled = true; sendReminderSms(it.phone, it.title, it.amount, it.id); } }, 'SMS') : null))) : empty(t('Nothing here for this period.')),
      r.link ? h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn', type: 'button', onclick: () => go(r.link) }, t('See all'), ' ›')) : null);
  } catch (err) {
    mount(body, empty(err.message));
  }
}
