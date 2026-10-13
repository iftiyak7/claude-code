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
    ['payments.receive', '#/payments/receive', 'cash', t('Receive due')],
    ['expenses.create', '#/expenses/new', 'expenses', t('Add expense')],
    ['purchases.create', '#/purchases/new', 'purchases', t('New purchase')],
    ['products.create', '#/products/new', 'products', t('Add product')],
    ['customers.create', '#/customers/new', 'customers', t('Add customer')],
  ].filter(([perm]) => can(perm));
  if (quick.length) {
    p.body.append(h('nav', { class: 'quick-actions', 'aria-label': t('Quick actions') },
      quick.map(([, href, ic, label]) => h('a', { class: 'quick', href }, h('span', { class: 'quick-icon' }, icon(ic, 22)), h('span', {}, label)))));
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

    const today = h('div', { class: 'stats' },
      show('sales') && stat(t("Today's sales"), money(T.sales), { hint: t('{n} invoices', { n: T.sales_count }), onclick: () => navigate('/sales') }),
      show('purchases') && stat(t("Today's purchases"), money(T.purchases)),
      show('expenses') && stat(t("Today's expenses"), money(T.expenses)),
      show('profit') && T.profit !== null && stat(t("Today's profit"), money(T.profit), { tone: Number(T.profit) < 0 ? 'bad' : 'ok' }),
      show('collection') && stat(t("Today's collection"), money(T.collection), { tone: 'ok' }),
      show('due') && stat(t("Today's due"), money(T.sales_due), { tone: Number(T.sales_due) > 0 ? 'warn' : '' }));

    const overview = h('div', { class: 'stats' },
      show('sales') && stat(t('Total sales'), money(O.sales), { hint: Number(O.returns) ? t('Returns {x}', { x: money(O.returns) }) : '' }),
      show('purchases') && stat(t('Total purchases'), money(O.purchases)),
      O.revenue !== null && stat(t('Revenue'), money(O.revenue)),
      show('expenses') && stat(t('Expenses'), money(O.expenses)),
      show('profit') && O.profit !== null && stat(t('Net profit'), money(O.profit), { tone: Number(O.profit) < 0 ? 'bad' : 'ok', hint: O.gross_profit !== null ? t('Gross {x}', { x: money(O.gross_profit) }) : '' }),
      show('due') && stat(t('Customer due'), money(O.customer_due), { tone: 'warn', onclick: () => navigate('/reports/dues') }),
      show('due') && stat(t('Supplier due'), money(O.supplier_due), { onclick: () => navigate('/reports/dues?type=supplier') }),
      show('stock') && O.stock_value !== null && stat(t('Stock value'), money(O.stock_value), { hint: d.low_stock ? t('{n} low on stock', { n: d.low_stock }) : '', tone: d.low_stock ? 'warn' : '', onclick: () => navigate('/inventory?low=1') }),
      show('cash') && O.cash_balance !== null && stat(t('Cash balance'), money(O.cash_balance)),
      show('cash') && O.bank_balance !== null && stat(t('Bank & mobile'), money(O.bank_balance)));

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

    mount(content,
      h('h2', { class: 'section-title' }, t('Today')), today,
      h('h2', { class: 'section-title' }, t('{from} – {to}', { from: date(d.from), to: date(d.to) })), overview,
      charts,
      h('div', { class: 'grid-2' }, top, recent));
  }
  await load();
}
