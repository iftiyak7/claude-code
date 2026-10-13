/**
 * Purchases list and detail.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can, state } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, qty, date, datetime } from '../core/format.js';
import { page, dataTable, badge, select, input, card, confirmDialog, toast, showError, simpleTable, downloadText } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { openPrint } from '../core/printer.js';
import { payPurchase } from './payments.js';

export default async function purchases(el, params, query) {
  if (params.id) return detail(el, Number(params.id));
  const p = page(t('Purchases'), {
    actions: [
      can('data.export') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const r = await api.get('export/purchases', query); downloadText(r.filename, r.csv); } }, icon('download', 16), t('Export')) : null,
      can('purchases.create') ? h('a', { class: 'btn btn-primary btn-sm', href: '#/purchases/new' }, icon('plus', 16), t('New purchase')) : null,
    ],
  });
  const table = dataTable({
    query,
    searchPlaceholder: t('Purchase no., supplier invoice or supplier'),
    filters: [
      { control: select('status', [['completed', t('Completed')], ['draft', t('Draft')], ['void', t('Void')], ['any', t('All')]], 'completed') },
      { control: select('payment_status', [['', t('Any payment')], ['paid', t('Paid')], ['partial', t('Partial')], ['due', t('Due')]], '') },
      { control: input('from', '', { type: 'date', 'aria-label': t('From') }) },
      { control: input('to', '', { type: 'date', 'aria-label': t('To') }) },
    ],
    fetch: (q) => api.get('purchases', q),
    rowHref: (r) => `/purchases/${r.id}`,
    columns: [
      { label: t('Number'), render: (r) => h('strong', {}, r.number) },
      { label: t('Date'), render: (r) => date(r.purchase_date) },
      { label: t('Supplier'), render: (r) => r.supplier_name || t('Cash purchase') },
      { label: t('Supplier inv.'), hide: 'sm', key: 'supplier_invoice' },
      { label: t('Total'), align: 'right', render: (r) => money(r.total) },
      { label: t('Due'), align: 'right', render: (r) => (Number(r.due_amount) ? h('span', { class: 'warn-text' }, money(r.due_amount)) : '—') },
      { label: t('Status'), render: (r) => badge(r.status === 'completed' ? r.payment_status : r.status) },
    ],
    footer: (res) => res.summary ? h('div', { class: 'sums' },
      h('span', {}, t('Total'), ' ', h('strong', {}, money(res.summary.total))),
      h('span', {}, t('Due'), ' ', h('strong', {}, money(res.summary.due)))) : null,
  });
  p.body.append(table.el);
  mount(el, p.el);
}

async function detail(el, id) {
  const d = await api.get(`purchases/${id}`);
  const done = d.status === 'completed';
  const reload = () => detail(el, id);
  const p = page(d.number, {
    back: '/purchases',
    subtitle: `${date(d.purchase_date)} · ${d.supplier?.name || t('Cash purchase')}${d.supplier_invoice ? ' · ' + d.supplier_invoice : ''}`,
    actions: [
      can('invoices.print') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openPrint('purchase', id, { paper: 'a4' }) }, icon('printer', 16), t('Print')) : null,
      done && Number(d.due_amount) > 0 && can('payments.pay') && d.supplier ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => payPurchase(d.supplier, { purchase: d, onDone: reload }) }, icon('cash', 16), t('Pay supplier')) : null,
      done && can('purchases.return') ? h('a', { class: 'btn btn-sm', href: `#/purchases/${id}/return` }, icon('return', 16), t('Return')) : null,
      d.status !== 'void' && can('purchases.edit') && !Number(d.return_amount) ? h('a', { class: 'btn btn-sm', href: `#/purchases/${id}/edit` }, icon('edit', 16), d.status === 'draft' ? t('Edit / complete') : t('Edit')) : null,
      d.status !== 'void' && can('purchases.delete') ? h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', onclick: async () => {
        const ok = await confirmDialog(t('Void {n}? Stock and accounts will be reversed.', { n: d.number }), { danger: true, confirmText: t('Void purchase'), reason: true });
        if (!ok) return;
        try { await api.post(`purchases/${id}/void`, { reason: ok.reason }); toast(t('Purchase voided')); reload(); } catch (err) { showError(err); }
      } }, icon('trash', 16), t('Void')) : null,
    ],
  });
  const showCost = d.items.some((i) => i.landed_cost !== undefined);
  p.body.append(
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Status')), h('strong', {}, badge(done ? d.payment_status : d.status))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Total')), h('strong', { class: 'stat-value' }, money(d.total))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Paid')), h('strong', { class: 'stat-value' }, money(d.paid_amount))),
      h('div', { class: `stat ${Number(d.due_amount) ? 'warn' : ''}` }, h('span', { class: 'stat-label' }, t('Due')), h('strong', { class: 'stat-value' }, money(d.due_amount)))),
    card(t('Items'), simpleTable([
      { label: t('Item'), render: (i) => h('span', {}, i.name, Number(i.returned_qty) ? h('small', { class: 'warn-text' }, ` (${t('returned')} ${qty(i.returned_qty)})`) : null) },
      { label: t('Qty'), align: 'right', render: (i) => qty(i.qty) },
      { label: t('Cost'), align: 'right', render: (i) => money(i.unit_price) },
      { label: state.settings['tax.label'], align: 'right', render: (i) => (Number(i.tax_amount) ? money(i.tax_amount) : '—') },
      { label: t('Amount'), align: 'right', render: (i) => money(i.total) },
      showCost ? { label: t('Landed unit cost'), align: 'right', render: (i) => money(i.unit_cost) } : null,
    ].filter(Boolean), d.items),
    h('div', { class: 'doc-totals right' },
      h('div', { class: 'tl' }, h('span', {}, t('Subtotal')), h('span', {}, money(d.subtotal))),
      Number(d.discount_amount) ? h('div', { class: 'tl' }, h('span', {}, t('Discount')), h('span', {}, '−' + money(d.discount_amount))) : null,
      Number(d.tax_amount) ? h('div', { class: 'tl' }, h('span', {}, state.settings['tax.label']), h('span', {}, money(d.tax_amount))) : null,
      Number(d.shipping_amount) ? h('div', { class: 'tl' }, h('span', {}, t('Shipping')), h('span', {}, money(d.shipping_amount))) : null,
      Number(d.other_cost) ? h('div', { class: 'tl' }, h('span', {}, t('Other costs')), h('span', {}, money(d.other_cost))) : null,
      h('div', { class: 'tl grand' }, h('span', {}, t('Total')), h('strong', {}, money(d.total))))),
    h('div', { class: 'grid-2' },
      card(t('Payments'), d.payments.length ? h('ul', { class: 'list' }, d.payments.map((pay) => h('li', {}, h('a', { href: `#/payments/${pay.id}` },
        h('span', {}, h('strong', {}, pay.number), h('small', { class: 'muted' }, ` ${date(pay.payment_date)} · ${pay.account_name}`)), h('span', {}, money(pay.amount)))))) : h('p', { class: 'muted' }, t('No payments yet.'))),
      card(t('Returns'), d.returns.length ? h('ul', { class: 'list' }, d.returns.map((r) => h('li', {}, h('a', { href: `#/returns/${r.id}` },
        h('span', {}, h('strong', {}, r.number), h('small', { class: 'muted' }, ` ${date(r.return_date)}`)), h('span', {}, money(r.total), ' ', badge(r.status)))))) : h('p', { class: 'muted' }, t('No returns.')))),
    d.notes ? card(t('Notes'), h('p', { class: 'pre' }, d.notes)) : null,
    h('p', { class: 'muted small' }, t('Created {d}', { d: datetime(d.created_at) })));
  mount(el, p.el);
}
