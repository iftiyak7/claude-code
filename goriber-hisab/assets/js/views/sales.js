/**
 * Sales list and sale detail.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can, state } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, qty, date, datetime } from '../core/format.js';
import { page, dataTable, badge, select, input, card, confirmDialog, toast, showError, simpleTable, downloadText } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';
import { openPrint, printSale } from '../core/printer.js';
import { collectPayment } from './payments.js';

export default async function sales(el, params, query) {
  if (params.id) return detail(el, Number(params.id));

  const p = page(t('Sales'), {
    actions: [
      can('data.export') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const r = await api.get('export/sales', query); downloadText(r.filename, r.csv); } }, icon('download', 16), t('Export')) : null,
      can('sales.create') ? h('a', { class: 'btn btn-sm', href: '#/sales/new' }, icon('plus', 16), t('Invoice')) : null,
      can('pos.use') ? h('a', { class: 'btn btn-primary btn-sm', href: '#/pos' }, icon('pos', 16), t('POS')) : null,
    ],
  });
  const sellerFilter = select('salesperson_id', [['', t('All staff')]], query.salesperson_id || '', { 'aria-label': t('Sold by') });
  api.get('staff').then((staff) => {
    if (!Array.isArray(staff) || staff.length < 2) { sellerFilter.hidden = true; return; }
    staff.forEach((u) => sellerFilter.append(h('option', { value: u.id }, u.name)));
    if (query.salesperson_id) sellerFilter.value = String(query.salesperson_id);
  }).catch(() => { sellerFilter.hidden = true; });
  const table = dataTable({
    query,
    searchPlaceholder: t('Invoice no., customer or phone'),
    filters: [
      { control: select('status', [['completed', t('Completed')], ['held', t('Held')], ['void', t('Void')], ['any', t('All')]], 'completed') },
      { control: select('payment_status', [['', t('Any payment')], ['paid', t('Paid')], ['partial', t('Partial')], ['due', t('Due')]], '') },
      { control: sellerFilter },
      { control: input('from', '', { type: 'date', 'aria-label': t('From') }) },
      { control: input('to', '', { type: 'date', 'aria-label': t('To') }) },
    ],
    fetch: (q) => api.get('sales', q),
    rowHref: (r) => `/sales/${r.id}`,
    columns: [
      { label: t('Invoice'), render: (r) => h('strong', {}, r.number) },
      { label: t('Date'), render: (r) => date(r.sale_date) },
      { label: t('Customer'), render: (r) => r.customer_name || t('Walk-in') },
      { label: t('Sold by'), hide: 'sm', render: (r) => r.salesperson_name || '—' },
      { label: t('Total'), align: 'right', render: (r) => money(r.total) },
      { label: t('Paid'), align: 'right', hide: 'sm', render: (r) => money(r.paid_amount) },
      { label: t('Due'), align: 'right', render: (r) => (Number(r.due_amount) ? h('span', { class: 'warn-text' }, money(r.due_amount)) : '—') },
      { label: t('Status'), render: (r) => badge(r.status === 'completed' ? r.payment_status : r.status) },
    ],
    footer: (res) => res.summary ? h('div', { class: 'sums' },
      h('span', {}, t('Total'), ' ', h('strong', {}, money(res.summary.total))),
      h('span', {}, t('Paid'), ' ', h('strong', {}, money(res.summary.paid))),
      h('span', {}, t('Due'), ' ', h('strong', {}, money(res.summary.due)))) : null,
  });
  p.body.append(table.el);
  mount(el, p.el);
}

/** Voided by mistake: bring the sale (and its online order) back. */
export async function restoreSale(s, onDone) {
  const msg = t('Bring {n} back? Stock and accounts are posted again with the same number. Payments taken before the void stay cancelled, so it comes back as due — receive the payment again if it was paid.', { n: s.number });
  if (!(await confirmDialog(msg, { confirmText: t('Restore') }))) return;
  try { await api.post(`sales/${s.id}/restore`); toast(t('Restored')); onDone?.(); } catch (err) { showError(err); }
}

async function detail(el, id) {
  const s = await api.get(`sales/${id}`);
  const isDone = s.status === 'completed';
  const reload = () => detail(el, id);

  const actions = [
    can('invoices.print') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => printSale(s) }, icon('printer', 16), t('Receipt')) : null,
    can('invoices.print') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openPrint('sale', id, { paper: state.settings['invoice.paper'] }) }, t('Invoice')) : null,
    isDone && Number(s.due_amount) > 0 && can('payments.receive') && s.customer ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => collectPayment(s.customer, { sale: s, onDone: reload }) }, icon('cash', 16), t('Receive payment')) : null,
    s.status === 'held' && can('pos.use') ? h('a', { class: 'btn btn-primary btn-sm', href: '#/pos' }, t('Resume in POS')) : null,
    isDone && can('sales.return') ? h('a', { class: 'btn btn-sm', href: `#/sales/${id}/return` }, icon('return', 16), t('Return')) : null,
    s.status !== 'void' && can('sales.edit') && !Number(s.return_amount) ? h('a', { class: 'btn btn-sm', href: `#/sales/${id}/edit` }, icon('edit', 16), t('Edit')) : null,
    s.status === 'void' && can('sales.delete') ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => restoreSale(s, reload) }, icon('refresh', 16), t('Restore')) : null,
    s.status !== 'void' && can('sales.delete') ? h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', onclick: async () => {
      const ok = await confirmDialog(t('Void {n}? Stock, payments and accounts will be reversed. This cannot be undone.', { n: s.number }), { danger: true, confirmText: t('Void sale'), reason: true });
      if (!ok) return;
      try { await api.post(`sales/${id}/void`, { reason: ok.reason }); toast(t('Sale voided')); reload(); } catch (err) { showError(err); }
    } }, icon('trash', 16), t('Void')) : null,
  ];

  const p = page(s.number, { back: '/sales', subtitle: [date(s.sale_date), timeOf(s.created_at), s.customer?.name || t('Walk-in customer'), s.salesperson_name ? `${t('Sold by')}: ${s.salesperson_name}` : ''].filter(Boolean).join(' · '), actions });
  const profit = s.gross_profit !== undefined && isDone;
  p.body.append(
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Status')), h('strong', {}, badge(isDone ? s.payment_status : s.status))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Total')), h('strong', { class: 'stat-value' }, money(s.total))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Paid')), h('strong', { class: 'stat-value' }, money(s.paid_amount))),
      h('div', { class: `stat ${Number(s.due_amount) ? 'warn' : ''}` }, h('span', { class: 'stat-label' }, t('Due')), h('strong', { class: 'stat-value' }, money(s.due_amount))),
      profit ? h('div', { class: 'stat ok' }, h('span', { class: 'stat-label' }, t('Gross profit')), h('strong', { class: 'stat-value' }, money(s.gross_profit))) : null),
    card(t('Items'), simpleTable([
      { label: t('Item'), render: (i) => h('span', {}, i.name, Number(i.returned_qty) ? h('small', { class: 'warn-text' }, ` (${t('returned')} ${qty(i.returned_qty)})`) : null,
        (i.components || []).length ? h('small', { class: 'muted recipe-used' }, `${t('Made from')}: ${i.components.map((c) => `${c.name} ${qty(c.qty)}${c.cost !== undefined ? ' (' + money(c.cost) + ')' : ''}`).join(', ')}`) : null) },
      { label: t('Qty'), align: 'right', render: (i) => qty(i.qty) },
      { label: t('Price'), align: 'right', render: (i) => money(i.unit_price) },
      { label: t('Discount'), align: 'right', render: (i) => (Number(i.discount_amount) + Number(i.doc_discount) ? money(String(Number(i.discount_amount) + Number(i.doc_discount))) : '—') },
      { label: state.settings['tax.label'], align: 'right', render: (i) => (Number(i.tax_amount) ? money(i.tax_amount) : '—') },
      { label: t('Amount'), align: 'right', render: (i) => money(i.total) },
    ], s.items),
    h('div', { class: 'doc-totals right' },
      h('div', { class: 'tl' }, h('span', {}, t('Subtotal')), h('span', {}, money(s.subtotal))),
      Number(s.discount_amount) ? h('div', { class: 'tl' }, h('span', {}, t('Discount')), h('span', {}, '−' + money(s.discount_amount))) : null,
      Number(s.tax_amount) ? h('div', { class: 'tl' }, h('span', {}, state.settings['tax.label']), h('span', {}, money(s.tax_amount))) : null,
      Number(s.shipping_amount) ? h('div', { class: 'tl' }, h('span', {}, t('Shipping')), h('span', {}, money(s.shipping_amount))) : null,
      h('div', { class: 'tl grand' }, h('span', {}, t('Total')), h('strong', {}, money(s.total))))),
    h('div', { class: 'grid-2' },
      card(t('Payments'), s.payments.length ? h('ul', { class: 'list' }, s.payments.map((pay) => h('li', {}, h('a', { href: `#/payments/${pay.id}` },
        h('span', {}, h('strong', {}, pay.number), h('small', { class: 'muted' }, ` ${date(pay.payment_date)} · ${pay.account_name}${pay.reference ? ' · ' + pay.reference : ''}`)),
        h('span', {}, money(pay.amount)))))) : h('p', { class: 'muted' }, t('No payments yet.'))),
      card(t('Returns'), s.returns.length ? h('ul', { class: 'list' }, s.returns.map((r) => h('li', {}, h('a', { href: `#/returns/${r.id}` },
        h('span', {}, h('strong', {}, r.number), h('small', { class: 'muted' }, ` ${date(r.return_date)}`)),
        h('span', {}, money(r.total), ' ', badge(r.status)))))) : h('p', { class: 'muted' }, t('No returns.')))),
    s.notes ? card(t('Notes'), h('p', { class: 'pre' }, s.notes)) : null,
    h('p', { class: 'muted small' }, t('Created {d}', { d: datetime(s.created_at) }), s.voided_at ? ` · ${t('Voided {d}', { d: datetime(s.voided_at) })}` : ''));
  mount(el, p.el);
  void navigate;
}

/** Local time ("05:38 PM") of a UTC "Y-m-d H:i:s". */
function timeOf(utc) {
  if (!utc) return '';
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
