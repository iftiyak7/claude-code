/**
 * Payments: list, detail, and the reusable "receive from customer" /
 * "pay supplier" dialogs used across the app.
 */
import { h, mount, uuid } from '../core/dom.js';
import { api } from '../core/api.js';
import { can, state } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, date, dec, str, places, today } from '../core/format.js';
import { page, dataTable, select, input, card, field, money_input, modal, toast, showError, showFieldErrors, values, badge, confirmDialog, combobox, empty, simpleTable } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';
import { openPrint } from '../core/printer.js';

export default async function payments(el, params, query) {
  const path = location.hash.split('?')[0];
  if (path.endsWith('/receive') || path.endsWith('/pay')) return standalone(el, path.endsWith('/receive') ? 'customer' : 'supplier', query);
  if (params.id) return detail(el, Number(params.id));

  const p = page(t('Payments'), {
    actions: [
      can('payments.receive') ? h('a', { class: 'btn btn-primary btn-sm', href: '#/payments/receive' }, icon('income', 16), t('Receive')) : null,
      can('payments.pay') ? h('a', { class: 'btn btn-sm', href: '#/payments/pay' }, icon('expenses', 16), t('Pay supplier')) : null,
    ],
  });
  const table = dataTable({
    query,
    searchPlaceholder: t('Number, reference or name'),
    filters: [
      { control: select('direction', [['', t('In & out')], ['in', t('Received')], ['out', t('Paid')]], '') },
      { control: select('account_id', [['', t('All accounts')], ...state.me.payment_accounts.map((a) => [a.id, a.name])], '') },
      { control: input('from', '', { type: 'date', 'aria-label': t('From') }) },
      { control: input('to', '', { type: 'date', 'aria-label': t('To') }) },
    ],
    fetch: (q) => api.get('payments', q),
    rowHref: (r) => `/payments/${r.id}`,
    columns: [
      { label: t('Number'), render: (r) => h('strong', {}, r.number) },
      { label: t('Date'), render: (r) => date(r.payment_date) },
      { label: t('Party'), render: (r) => r.contact_name || '—' },
      { label: t('Account'), hide: 'sm', key: 'account_name' },
      { label: t('Reference'), hide: 'sm', key: 'reference' },
      { label: t('Amount'), align: 'right', render: (r) => h('span', { class: r.direction === 'in' ? 'ok-text' : 'bad-text' }, (r.direction === 'in' ? '+' : '−') + money(r.amount)) },
    ],
    footer: (res) => h('div', { class: 'sums' }, h('span', {}, t('Sum'), ' ', h('strong', {}, money(res.sum)))),
  });
  p.body.append(table.el);
  mount(el, p.el);
}

async function detail(el, id) {
  const pay = await api.get(`payments/${id}`);
  const p = page(pay.number, {
    back: '/payments',
    subtitle: `${date(pay.payment_date)} · ${pay.contact?.name || ''}`,
    actions: [
      can('invoices.print') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openPrint('payment', id, { paper: state.settings['pos.paper'] }) }, icon('printer', 16), t('Receipt')) : null,
      pay.status === 'completed' && can('payments.delete') && ['collection', 'supplier_payment', 'manual'].includes(pay.source) ? h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', onclick: async () => {
        const ok = await confirmDialog(t('Void this payment? The amount goes back onto the balance due.'), { danger: true, confirmText: t('Void payment'), reason: true });
        if (!ok) return;
        try { await api.post(`payments/${id}/void`, { reason: ok.reason }); toast(t('Payment voided')); detail(el, id); } catch (err) { showError(err); }
      } }, t('Void')) : null,
    ],
  });
  p.body.append(
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, pay.direction === 'in' ? t('Received') : t('Paid')), h('strong', { class: 'stat-value' }, money(pay.amount))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Account')), h('strong', {}, pay.account?.name || '')),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Status')), h('strong', {}, badge(pay.status)))),
    card(t('Applied to'), pay.allocations.length ? simpleTable([
      { label: t('Document'), render: (a) => h('a', { href: `#/${a.document_type === 'sale' ? 'sales' : 'purchases'}/${a.document_id}` }, a.number) },
      { label: t('Amount'), align: 'right', render: (a) => money(a.amount) },
    ], pay.allocations) : h('p', { class: 'muted' }, t('Not applied to any invoice (advance / refund).'))),
    pay.reference || pay.note ? card(t('Details'), h('p', {}, pay.reference), h('p', { class: 'pre' }, pay.note || '')) : null);
  mount(el, p.el);
}

/** Standalone receive/pay page with party picker. */
function standalone(el, type, query) {
  const isCustomer = type === 'customer';
  if (!can(isCustomer ? 'payments.receive' : 'payments.pay')) { mount(el, empty(t('You do not have permission for this.'))); return; }
  const p = page(isCustomer ? t('Receive payment') : t('Pay supplier'), { back: '/payments' });
  const holder = h('div');
  const picker = combobox({
    placeholder: isCustomer ? t('Search customer…') : t('Search supplier…'),
    autofocus: true,
    search: async (q) => (await api.get(isCustomer ? 'customers' : 'suppliers', { search: q, per_page: 10, due_only: q ? '' : 1, orderby: 'balance' })).items,
    label: (c) => c.name,
    sub: (c) => `${c.phone || ''} · ${isCustomer ? t('Due') : t('Payable')} ${money(c.balance)}`,
    onPick: (c) => mount(holder, paymentForm(c, isCustomer, { onDone: (pay) => navigate(`/payments/${pay.id}`) })),
  });
  p.body.append(card(isCustomer ? t('Customer') : t('Supplier'), picker.el), holder);
  mount(el, p.el);
  if (query.contact) api.get(`${isCustomer ? 'customers' : 'suppliers'}/${query.contact}`).then((c) => mount(holder, paymentForm(c, isCustomer, { onDone: (pay) => navigate(`/payments/${pay.id}`) }))).catch(() => {});
}

function paymentForm(contact, isCustomer, { doc = null, onDone } = {}) {
  const suggested = doc ? doc.due_amount : (dec(contact.balance) > 0 ? contact.balance : '');
  const accounts = state.me.payment_accounts;
  const form = h('form', { class: 'form' },
    h('div', { class: 'callout' },
      h('strong', {}, contact.name),
      h('span', {}, `${isCustomer ? t('Current due') : t('Current payable')}: `, h('strong', { class: dec(contact.balance) > 0 ? 'warn-text' : '' }, money(contact.balance))),
      doc ? h('span', {}, `${doc.number}: ${t('due')} ${money(doc.due_amount)}`) : h('small', { class: 'muted' }, t('Applied to the oldest unpaid invoices first.'))),
    h('div', { class: 'form-grid' },
      field(t('Amount'), money_input('amount', suggested ? str(dec(suggested), places()) : '', { required: true, autofocus: true }), { required: true }),
      field(t('Method'), select('account_id', accounts.map((a) => [a.id, a.name]), accounts[0]?.id)),
      field(t('Date'), input('date', today(), { type: 'date' })),
      field(t('Reference / TrxID'), input('reference', '')),
      field(t('Note'), input('note', ''), { wide: true })),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, icon('check'), isCustomer ? t('Receive') : t('Pay'))));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = values(form);
    showFieldErrors(form, {});
    try {
      const body = { ...v, contact_id: contact.id, uuid: uuid() };
      if (doc) body[isCustomer ? 'sale_id' : 'purchase_id'] = doc.id;
      const pay = await api.post(isCustomer ? 'payments/receive' : 'payments/pay', body);
      toast(t('{x} recorded', { x: money(pay.amount) }));
      onDone?.(pay);
    } catch (err) { showFieldErrors(form, err.errors || {}); showError(err); }
  });
  return form;
}

/** Dialog: receive from a customer (optionally against one sale). */
export function collectPayment(customer, { sale = null, onDone } = {}) {
  const m = modal({ title: t('Receive payment'), body: paymentForm(customer, true, { doc: sale, onDone: (pay) => { m.close(); onDone?.(pay); } }) });
}

/** Dialog: pay a supplier (optionally against one purchase). */
export function payPurchase(supplier, { purchase = null, onDone } = {}) {
  const m = modal({ title: t('Pay supplier'), body: paymentForm(supplier, false, { doc: purchase, onDone: (pay) => { m.close(); onDone?.(pay); } }) });
}
