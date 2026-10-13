/**
 * Reports hub and renderers. Every report supports a date range (where it
 * makes sense), branch scope, CSV export of exactly what's on screen, and
 * print / save-as-PDF via the browser.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can, state } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, qty, date, today } from '../core/format.js';
import { page, card, simpleTable, dateRange, select, input, spinner, empty, downloadText, stat } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { lineChart } from '../core/chart.js';
import { zip } from '../core/zip.js';

const REPORTS = [
  ['Sales', [
    ['sales-daily', 'Daily sales', 'reports.view'],
    ['sales-monthly', 'Monthly sales', 'reports.view'],
    ['sales-product', 'Product-wise sales & profit', 'reports.view'],
    ['sales-customer', 'Customer-wise sales', 'reports.view'],
    ['sales-category', 'Category-wise sales', 'reports.view'],
    ['sales-user', 'Sales by staff', 'reports.view'],
    ['sales-branch', 'Branch-wise sales', 'reports.view'],
    ['invoice-profit', 'Invoice-wise profit', 'reports.profit'],
  ]],
  ['Purchases', [
    ['purchases-supplier', 'Supplier-wise purchases', 'reports.view'],
    ['purchases-product', 'Product-wise purchases', 'reports.view'],
    ['purchases-month', 'Monthly purchases', 'reports.view'],
  ]],
  ['Inventory', [
    ['stock', 'Stock valuation', 'inventory.view'],
    ['low-stock', 'Low stock', 'inventory.view'],
    ['slow-movers', 'Slow-moving products', 'reports.view'],
  ]],
  ['Accounting', [
    ['profit-loss', 'Profit & loss', 'reports.profit'],
    ['balance-sheet', 'Balance sheet', 'accounting.view'],
    ['trial-balance', 'Trial balance', 'accounting.view'],
    ['cash-flow', 'Cash flow', 'accounting.view'],
    ['cash-book', 'Cash book', 'accounting.view'],
    ['bank-book', 'Bank book', 'accounting.view'],
    ['expenses', 'Expense report', 'reports.view'],
    ['income', 'Income report', 'reports.view'],
    ['tax', 'Tax / VAT report', 'reports.view'],
  ]],
  ['Dues', [
    ['dues', 'Customer due (aging)', 'reports.view'],
    ['dues-supplier', 'Supplier due (aging)', 'reports.view'],
  ]],
];

export default async function reports(el, params, query) {
  if (!params.name) return hub(el);
  return run(el, params.name, query);
}

function hub(el) {
  const p = page(t('Reports'));
  p.body.append(exportAll());
  p.body.append(...REPORTS.map(([group, items]) => {
    const visible = items.filter(([, , perm]) => can(perm));
    return visible.length ? card(t(group), h('div', { class: 'report-links' }, visible.map(([key, label]) => h('a', { class: 'report-link', href: `#/reports/${key}` }, icon('reports', 18), h('span', {}, t(label)))))) : null;
  }));
  mount(el, p.el);
}

/** One-click archive: every report the user may see, as CSV files in a ZIP. */
function exportAll() {
  let range = { range: 'this_month' };
  const branches = state.ctx.branches || [];
  const branch = branches.length > 1 ? select('branch_id', [['', t('All branches')], ...branches.map((x) => [x.id, x.name])], '') : null;
  const status = h('span', { class: 'muted small' });
  const btn = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
    const list = REPORTS.flatMap(([group, items]) => items.filter(([, , perm]) => can(perm)).map(([key, label]) => ({ key, label, group })));
    const files = [];
    const failed = [];
    btn.disabled = true;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      status.textContent = t('Preparing {n} of {total}…', { n: i + 1, total: list.length });
      try {
        const out = await renderReport(r.key, { ...range, branch_id: branch ? branch.value : '' });
        if (out.csv) files.push({ name: `${String(i + 1).padStart(2, '0')}-${r.key}.csv`, data: out.csv });
      } catch { failed.push(t(r.label)); }
    }
    const period = range.range || `${range.from}_${range.to}`;
    const biz = (state.ctx.business?.name || 'business').replace(/[^\p{L}\p{N}]+/gu, '-');
    const blob = zip(files);
    const a = h('a', { href: URL.createObjectURL(blob), download: `${biz}-reports-${period}-${today()}.zip` });
    document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    btn.disabled = false;
    status.textContent = t('{n} reports downloaded.', { n: files.length }) + (failed.length ? ` ${t('Skipped')}: ${failed.join(', ')}` : '');
  } }, icon('download', 16), t('Download all reports (ZIP)'));
  return card(t('Save all reports'), h('div', { class: 'export-all' },
    h('p', { class: 'muted small' }, t('Downloads every report for the chosen period as spreadsheet (CSV) files in one ZIP — opens in Excel or Google Sheets. Keep it as your monthly record.')),
    h('div', { class: 'row wrap' }, dateRange((r) => { range = r; }, 'this_month'), branch, btn),
    status));
}

async function run(el, name, query) {
  const label = REPORTS.flatMap(([, items]) => items).find(([k]) => k === name)?.[1] || name;
  let args = { range: query.range || (name.startsWith('sales-monthly') || name === 'purchases-month' ? 'this_year' : 'this_month'), from: query.from, to: query.to, branch_id: query.branch_id || '' };
  const out = h('div', { class: 'report' }, spinner());
  let lastCsv = null;

  const branches = state.ctx.branches || [];
  const controls = [];
  const asOf = ['balance-sheet', 'trial-balance', 'dues', 'dues-supplier'].includes(name);
  const noDates = ['stock', 'low-stock'].includes(name);
  if (asOf) {
    const d = input('as_of', today(), { type: 'date', 'aria-label': t('As of') });
    d.addEventListener('change', () => { args.as_of = d.value; load(); });
    controls.push(h('label', { class: 'filter' }, h('span', {}, t('As of')), d));
  } else if (!noDates) {
    controls.push(dateRange((r) => { args = { ...args, from: undefined, to: undefined, range: undefined, ...r }; load(); }, args.range));
  }
  if (branches.length > 1 && !name.startsWith('dues')) {
    const b = select('branch_id', [['', t('All branches')], ...branches.map((x) => [x.id, x.name])], args.branch_id);
    b.addEventListener('change', () => { args.branch_id = b.value; load(); });
    controls.push(b);
  }
  const p = page(t(label), {
    back: '/reports',
    actions: [
      ...controls,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => lastCsv && downloadText(`${name}-${today()}.csv`, lastCsv) }, icon('download', 16), 'CSV'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => window.print() }, icon('printer', 16), t('Print / PDF')),
    ],
  });
  p.body.append(out);
  mount(el, p.el);

  async function load() {
    mount(out, spinner());
    try { const r = await renderReport(name, args, query); lastCsv = r.csv; mount(out, r.node); } catch (err) { mount(out, empty(err.message)); }
  }
  load();
}

/** Builds one report: returns its DOM and the matching CSV text. */
export async function renderReport(name, args, query = {}) {
  let lastCsv = null;
  const csv = (cols, rows) => {
    const esc = (v) => {
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return '﻿' + [cols.map((c) => esc(c.label)).join(','), ...rows.map((r) => cols.map((c) => esc(c.csv ? c.csv(r) : r[c.key])).join(','))].join('\n');
  };
  const table = (cols, rows, totals) => {
    lastCsv = csv(cols, rows);
    return rows.length ? simpleTable(cols, rows, { totals }) : empty(t('No data for this period.'));
  };
  const m = (k) => ({ key: k, align: 'right', money: true, render: (r) => (r[k] === null || r[k] === undefined ? '—' : money(r[k])), csv: (r) => r[k] });

  const node = await render();
  return { node, csv: lastCsv };

  async function render() {
    const [kind, group] = name.split('-');
    if (kind === 'sales' && group) {
      const map = { daily: 'day', monthly: 'month', product: 'product', customer: 'customer', category: 'category', user: 'user', branch: 'branch' };
      const r = await api.get('reports/sales', { ...args, group_by: map[group] });
      const profit = r.totals.profit !== null;
      const cols = [
        { label: { day: t('Date'), month: t('Month') }[r.group_by] || t('Name'), key: 'label', render: (x) => (r.group_by === 'day' ? date(x.label) : x.label) },
        { label: t('Invoices'), key: 'invoices', align: 'right' },
        { label: t('Qty'), key: 'qty', align: 'right', render: (x) => qty(x.qty) },
        { label: t('Net sales'), ...m('net') },
        { label: state.settings['tax.label'], ...m('tax') },
        { label: t('Total'), ...m('total') },
        profit ? { label: t('Cost'), ...m('cost') } : null,
        profit ? { label: t('Profit'), ...m('profit') } : null,
        profit ? { label: t('Margin %'), key: 'margin', align: 'right' } : null,
      ].filter(Boolean);
      const chart = ['day', 'month'].includes(r.group_by) && r.rows.length > 1
        ? card(null, lineChart(r.rows.map((x) => ({ label: x.label, net: x.net, profit: x.profit })), [{ key: 'net', label: t('Net sales') }, ...(profit ? [{ key: 'profit', label: t('Profit') }] : [])], { type: r.group_by === 'month' ? 'bar' : 'line' }))
        : null;
      return h('div', {}, chart, card(null, table(cols, r.rows, r.totals)), h('p', { class: 'muted small' }, t('Figures are before returns; see the returns list for credits.')));
    }
    if (kind === 'purchases') {
      const r = await api.get('reports/purchases', { ...args, group_by: { supplier: 'supplier', product: 'product', month: 'month' }[group] });
      return card(null, table([
        { label: t('Name'), key: 'label' },
        { label: t('Documents'), key: 'documents', align: 'right' },
        { label: t('Qty'), key: 'qty', align: 'right', render: (x) => qty(x.qty) },
        { label: t('Net'), ...m('net') },
        { label: state.settings['tax.label'], ...m('tax') },
        { label: t('Landed cost'), ...m('landed') },
      ], r.rows, r.totals));
    }
    if (name === 'invoice-profit') {
      const r = await api.get('reports/invoice-profit', { ...args, per_page: 200 });
      return card(null, table([
        { label: t('Invoice'), key: 'number', render: (x) => h('a', { href: `#/sales/${x.id}` }, x.number) },
        { label: t('Date'), key: 'sale_date', render: (x) => date(x.sale_date) },
        { label: t('Customer'), key: 'customer_name' },
        { label: t('Net'), ...m('net') },
        { label: t('Cost'), ...m('cost_amount') },
        { label: t('Profit'), ...m('profit') },
        { label: t('Margin %'), key: 'margin', align: 'right' },
      ], r.items));
    }
    if (name === 'stock' || name === 'low-stock') {
      const r = await api.get('stock', { branch_id: args.branch_id || 'all', per_page: 200, low: name === 'low-stock' ? 1 : '' });
      const total = r.items.reduce((s, x) => s + Number(x.value || 0), 0);
      return h('div', {},
        name === 'stock' && r.items[0]?.value !== null ? h('div', { class: 'stats' }, stat(t('Stock value'), money(String(total))), stat(t('Products'), String(r.total))) : null,
        card(null, table([
          { label: t('Product'), key: 'name' },
          { label: t('SKU'), key: 'sku' },
          { label: t('Qty'), key: 'qty', align: 'right', render: (x) => qty(x.qty) },
          { label: t('Minimum'), key: 'min_stock', align: 'right', render: (x) => qty(x.min_stock) },
          { label: t('Avg cost'), ...m('avg_cost') },
          { label: t('Value'), ...m('value') },
        ], r.items)),
        r.total > r.items.length ? h('p', { class: 'muted' }, t('Showing first {n}. Export from Inventory for the full list.', { n: r.items.length })) : null);
    }
    if (name === 'slow-movers') {
      const r = await api.get('reports/slow-movers', { ...args, limit: 50 });
      return card(t('Products with stock but few sales'), table([
        { label: t('Product'), key: 'name', render: (x) => h('a', { href: `#/products/${x.product_id}` }, x.name) },
        { label: t('SKU'), key: 'sku' },
        { label: t('In stock'), key: 'stock', align: 'right', render: (x) => qty(x.stock) },
        { label: t('Sold in period'), key: 'sold', align: 'right', render: (x) => qty(x.sold) },
      ], r));
    }
    if (name === 'profit-loss') {
      const r = await api.get('reports/profit-loss', args);
      const section = (title, lines, total) => [
        h('tr', { class: 'section' }, h('th', { colspan: 2 }, title)),
        ...lines.map((l) => h('tr', {}, h('td', {}, h('a', { href: `#/accounting/ledger/${l.account_id}` }, l.name)), h('td', { class: 'num' }, money(l.amount)))),
        h('tr', { class: 'subtotal' }, h('td', {}, t('Total {x}', { x: title.toLowerCase() })), h('td', { class: 'num' }, money(total))),
      ];
      lastCsv = csv([{ label: t('Line'), key: 'name' }, { label: t('Amount'), key: 'amount' }], [
        ...r.revenue, { name: t('Total revenue'), amount: r.total_revenue }, ...r.cogs, { name: t('Gross profit'), amount: r.gross_profit },
        ...r.other_income, ...r.expenses, { name: t('Net profit'), amount: r.net_profit }]);
      return h('div', {},
        h('div', { class: 'stats' },
          stat(t('Revenue'), money(r.total_revenue)),
          stat(t('Gross profit'), money(r.gross_profit), { hint: `${r.gross_margin}%` }),
          stat(t('Expenses'), money(r.total_expenses)),
          stat(t('Net profit'), money(r.net_profit), { tone: Number(r.net_profit) < 0 ? 'bad' : 'ok', hint: `${r.net_margin}%` })),
        card(`${date(r.from)} – ${date(r.to)}`, h('table', { class: 'table statement' }, h('tbody', {},
          section(t('Revenue'), r.revenue, r.total_revenue),
          section(t('Cost of goods sold'), r.cogs, r.total_cogs),
          h('tr', { class: 'grand' }, h('td', {}, t('Gross profit')), h('td', { class: 'num' }, money(r.gross_profit))),
          section(t('Other income'), r.other_income, r.total_other_income),
          section(t('Expenses'), r.expenses, r.total_expenses),
          h('tr', { class: 'grand' }, h('td', {}, t('Net profit')), h('td', { class: 'num' }, money(r.net_profit)))))));
    }
    if (name === 'balance-sheet') {
      const r = await api.get('reports/balance-sheet', args);
      const rows = (lines) => lines.map((l) => h('tr', {}, h('td', {}, l.account_id ? h('a', { href: `#/accounting/ledger/${l.account_id}` }, l.name) : l.name), h('td', { class: 'num' }, money(l.amount))));
      lastCsv = csv([{ label: t('Account'), key: 'name' }, { label: t('Amount'), key: 'amount' }], [...r.assets, ...r.liabilities, ...r.equity]);
      return h('div', { class: 'grid-2' },
        card(t('Assets'), h('table', { class: 'table statement' }, h('tbody', {}, rows(r.assets), h('tr', { class: 'grand' }, h('td', {}, t('Total assets')), h('td', { class: 'num' }, money(r.total_assets)))))),
        card(t('Liabilities & equity'), h('table', { class: 'table statement' }, h('tbody', {},
          h('tr', { class: 'section' }, h('th', { colspan: 2 }, t('Liabilities'))), rows(r.liabilities),
          h('tr', { class: 'subtotal' }, h('td', {}, t('Total liabilities')), h('td', { class: 'num' }, money(r.total_liabilities))),
          h('tr', { class: 'section' }, h('th', { colspan: 2 }, t('Equity'))), rows(r.equity),
          h('tr', { class: 'subtotal' }, h('td', {}, t('Total equity')), h('td', { class: 'num' }, money(r.total_equity))),
          h('tr', { class: 'grand' }, h('td', {}, t('Total liabilities & equity')), h('td', { class: 'num' }, money(r.total_liabilities_and_equity)))))),
        r.balanced ? null : h('p', { class: 'bad-text' }, t('The balance sheet does not balance. Please contact support.')));
    }
    if (name === 'trial-balance') {
      const r = await api.get('reports/trial-balance', args);
      return card(r.balanced ? t('Balanced ✓') : t('NOT balanced'), table([
        { label: t('Code'), key: 'code' },
        { label: t('Account'), key: 'name', render: (x) => h('a', { href: `#/accounting/ledger/${x.account_id}` }, x.name) },
        { label: t('Debit'), ...m('debit') },
        { label: t('Credit'), ...m('credit') },
      ], r.lines, { debit: r.total_debit, credit: r.total_credit }));
    }
    if (name === 'cash-flow') {
      const r = await api.get('reports/cash-flow', args);
      return h('div', {},
        h('div', { class: 'stats' }, stat(t('Opening'), money(r.opening_balance)), stat(t('Money in'), money(r.total_inflow), { tone: 'ok' }), stat(t('Money out'), money(r.total_outflow), { tone: 'bad' }), stat(t('Closing'), money(r.closing_balance))),
        card(t('By activity'), table([
          { label: t('Activity'), key: 'source', render: (x) => t(x.source) },
          { label: t('In'), ...m('inflow') },
          { label: t('Out'), ...m('outflow') },
          { label: t('Net'), ...m('net') },
        ], r.by_source, { inflow: r.total_inflow, outflow: r.total_outflow, net: r.net_change })));
    }
    if (name === 'cash-book' || name === 'bank-book') {
      const accounts = (await api.get('accounts', { payment: 1 })).filter((a) => (name === 'cash-book' ? a.subtype === 'cash' : a.subtype !== 'cash'));
      const parts = await Promise.all(accounts.map((a) => api.get('reports/ledger', { ...args, account_id: a.id })));
      lastCsv = csv([{ label: t('Account'), key: 'acc' }, { label: t('Date'), key: 'entry_date' }, { label: t('Reference'), key: 'reference_no' }, { label: t('Description'), key: 'memo' }, { label: t('In'), key: 'debit' }, { label: t('Out'), key: 'credit' }, { label: t('Balance'), key: 'balance' }],
        parts.flatMap((L) => L.lines.map((x) => ({ ...x, acc: L.account.name }))));
      return h('div', {}, parts.map((L) => card(`${L.account.name} · ${t('Opening')} ${money(L.opening_balance)} → ${t('Closing')} ${money(L.closing_balance)}`,
        L.lines.length ? simpleTable([
          { label: t('Date'), render: (x) => date(x.entry_date) },
          { label: t('Reference'), key: 'reference_no' },
          { label: t('Description'), render: (x) => [x.memo, x.contact_name].filter(Boolean).join(' · ') },
          { label: t('In'), align: 'right', render: (x) => (Number(x.debit) ? money(x.debit) : '') },
          { label: t('Out'), align: 'right', render: (x) => (Number(x.credit) ? money(x.credit) : '') },
          { label: t('Balance'), align: 'right', render: (x) => money(x.balance) },
        ], L.lines) : h('p', { class: 'muted' }, t('No transactions.')))));
    }
    if (name === 'expenses' || name === 'income') {
      const r = await api.get(`reports/${name}`, args);
      return card(`${t('Total')}: ${money(r.total)}`, table([
        { label: t('Category'), key: 'category' },
        { label: t('Entries'), key: 'entries', align: 'right' },
        { label: t('Amount'), ...m('amount') },
        { label: t('Share %'), key: 'share', align: 'right' },
      ], r.rows, { amount: r.total }));
    }
    if (name === 'tax') {
      const r = await api.get('reports/tax', args);
      return h('div', {},
        h('div', { class: 'stats' }, stat(t('Output tax (collected)'), money(r.output_tax)), stat(t('Input tax (paid)'), money(r.input_tax)), stat(t('Net payable'), money(r.net_payable), { tone: 'warn' })),
        card(t('Sales by rate'), table([
          { label: t('Rate %'), key: 'tax_rate', align: 'right' },
          { label: t('Taxable amount'), ...m('taxable') },
          { label: t('Tax'), ...m('tax') },
        ], r.sales_by_rate)));
    }
    if (name.startsWith('dues')) {
      const type = name === 'dues-supplier' || query.type === 'supplier' ? 'supplier' : 'customer';
      const r = await api.get('reports/dues', { ...args, type });
      return card(`${type === 'customer' ? t('Total receivable') : t('Total payable')}: ${money(r.totals.balance)}`, table([
        { label: t('Name'), key: 'name', render: (x) => h('a', { href: `#/${type}s/${x.id}` }, x.name) },
        { label: t('Phone'), key: 'phone' },
        { label: t('Balance'), ...m('balance') },
        { label: '0–30', ...m('d0_30') },
        { label: '31–60', ...m('d31_60') },
        { label: '61–90', ...m('d61_90') },
        { label: '90+', ...m('d90_plus') },
      ], r.rows, r.totals));
    }
    return empty(t('Unknown report.'));
  }
}
