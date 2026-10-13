/**
 * Create a return against a sale/purchase, and view a return.
 */
import { h, mount, uuid } from '../core/dom.js';
import { api } from '../core/api.js';
import { can, state } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, qty, date, dec, str, places, today } from '../core/format.js';
import { page, card, field, input, select, textarea, money_input, toast, showError, showFieldErrors, simpleTable, badge, confirmDialog, empty } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';
import { openPrint } from '../core/printer.js';

export default async function returns(el, params) {
  if (params.doc) return create(el, params.doc, Number(params.id));
  return view(el, Number(params.id));
}

async function create(el, type, docId) {
  const isSale = type === 'sale';
  if (!can(isSale ? 'sales.return' : 'purchases.return')) { mount(el, empty(t('You do not have permission for this.'))); return; }
  const doc = await api.get(`${isSale ? 'sales' : 'purchases'}/${docId}`);
  const party = isSale ? doc.customer : doc.supplier;
  const rows = doc.items.map((i) => ({ item: i, left: dec(i.qty) - dec(i.returned_qty), qty: '' }));
  const totalEl = h('strong', {}, money('0'));

  const unitValue = (i) => (dec(i.net_amount) + dec(i.tax_amount)) / dec(i.qty);
  const estimate = () => rows.reduce((a, r) => a + Math.round(dec(r.qty) * unitValue(r.item)), 0);

  const refund = money_input('refund_amount', '', { placeholder: '0' });
  const accounts = state.me.payment_accounts;
  const refundAcc = select('refund_account_id', accounts.map((a) => [a.id, a.name]), accounts[0]?.id);
  const reason = textarea('reason', '', { rows: 2 });
  const dateInput = input('return_date', today(), { type: 'date' });

  const recalc = () => {
    const est = estimate();
    totalEl.textContent = money(str(est));
    if (!party) refund.value = str(est, places()); // walk-in: full refund
  };

  const form = h('form', { class: 'form' },
    card(t('Items to return'), simpleTable([
      { label: t('Item'), render: (r) => r.item.name },
      { label: t('Sold'), align: 'right', render: (r) => qty(r.item.qty) },
      { label: t('Already returned'), align: 'right', render: (r) => qty(r.item.returned_qty) },
      { label: t('Return qty'), align: 'right', render: (r) => {
        const inp = input('qty', '', { inputmode: 'decimal', class: 'input input-sm', placeholder: '0', disabled: r.left <= 0, 'aria-label': t('Return qty') });
        inp.addEventListener('input', () => {
          r.qty = inp.value;
          if (dec(inp.value) > r.left) { inp.value = str(r.left).replace(/\.?0+$/, ''); r.qty = inp.value; }
          recalc();
        });
        return h('div', { class: 'row end' }, inp, h('button', { class: 'btn btn-sm', type: 'button', disabled: r.left <= 0, onclick: () => { inp.value = str(r.left).replace(/\.?0+$/, ''); r.qty = inp.value; recalc(); } }, t('All')));
      } },
    ], rows), h('div', { class: 'doc-totals right' }, h('div', { class: 'tl grand' }, h('span', {}, t('Return value')), totalEl)),
    h('div', { class: 'field', dataset: { field: 'items' } }, h('small', { class: 'error', role: 'alert' }))),
    card(t('Settlement'), h('div', { class: 'form-grid' },
      field(t('Date'), dateInput),
      field(isSale ? t('Refund to customer now') : t('Refund received from supplier'), refund, { hint: party ? (isSale ? t('Anything not refunded is credited to the customer\'s account.') : t('Anything not refunded reduces what you owe the supplier.')) : t('Walk-in returns are refunded in full.') }),
      field(t('Refund via'), refundAcc),
      field(t('Reason'), reason, { wide: true }))),
    h('div', { class: 'form-actions sticky' },
      h('a', { class: 'btn', href: `#/${isSale ? 'sales' : 'purchases'}/${docId}` }, t('Cancel')),
      h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, icon('return'), t('Save return'))));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const items = rows.filter((r) => dec(r.qty) > 0).map((r) => ({ item_id: Number(r.item.id), qty: r.qty }));
    if (!items.length) { showFieldErrors(form, { items: t('Enter a quantity for at least one item.') }); return; }
    if (!(await confirmDialog(t('Return items worth about {x}? Stock and accounts update immediately.', { x: totalEl.textContent })))) return;
    try {
      const ret = await api.post('returns', {
        type, document_id: docId, uuid: uuid(), items, return_date: dateInput.value,
        refund_amount: refund.value || '0', refund_account_id: refundAcc.value, reason: reason.value,
      });
      toast(t('Return {n} saved', { n: ret.number }));
      navigate(`/returns/${ret.id}`);
    } catch (err) { showFieldErrors(form, err.errors || {}); showError(err); }
  });

  const p = page(t('Return against {n}', { n: doc.number }), { back: `/${isSale ? 'sales' : 'purchases'}/${docId}`, subtitle: party?.name || (isSale ? t('Walk-in customer') : '') });
  p.body.append(form);
  mount(el, p.el);
  recalc();
}

async function view(el, id) {
  const r = await api.get(`returns/${id}`);
  const isSale = r.return_type === 'sale';
  const p = page(r.number, {
    back: `/${isSale ? 'sales' : 'purchases'}/${r.document_id}`,
    subtitle: `${isSale ? t('Sales return') : t('Purchase return')} · ${date(r.return_date)} · ${t('Against')} ${r.document?.number || ''}`,
    actions: [
      can('invoices.print') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openPrint('return', id, { paper: 'a4' }) }, icon('printer', 16), t('Print')) : null,
      r.status === 'completed' && can(isSale ? 'sales.return' : 'purchases.return') ? h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', onclick: async () => {
        const ok = await confirmDialog(t('Void this return? Stock and balances go back to how they were.'), { danger: true, confirmText: t('Void return'), reason: true });
        if (!ok) return;
        try { await api.post(`returns/${id}/void`, { reason: ok.reason }); toast(t('Return voided')); view(el, id); } catch (err) { showError(err); }
      } }, t('Void')) : null,
    ],
  });
  p.body.append(
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Status')), h('strong', {}, badge(r.status))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Value')), h('strong', { class: 'stat-value' }, money(r.total))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Refunded')), h('strong', { class: 'stat-value' }, money(r.refund_amount)))),
    card(t('Items'), simpleTable([
      { label: t('Item'), key: 'name' },
      { label: t('Qty'), align: 'right', render: (i) => qty(i.qty) },
      { label: t('Net'), align: 'right', render: (i) => money(i.net_amount) },
      { label: state.settings['tax.label'], align: 'right', render: (i) => money(i.tax_amount) },
      { label: t('Total'), align: 'right', render: (i) => money(i.total) },
    ], r.items)),
    r.reason ? card(t('Reason'), h('p', { class: 'pre' }, r.reason)) : null);
  mount(el, p.el);
}
