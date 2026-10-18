/**
 * Back-office entry form shared by sales and purchases (create + edit).
 * Totals preview locally; the server recalculates on save.
 */
import { h, mount, uuid } from '../core/dom.js';
import { api } from '../core/api.js';
import { state, can } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, qty as fmtQty, dec, str, mul, places, today } from '../core/format.js';
import { page, field, input, select, textarea, combobox, money_input, toast, showError, showFieldErrors, spinner, card, empty } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';
import { onScan } from '../core/scanner.js';

export default async function documentForm(el, params) {
  const isSale = params.doc === 'sale';
  const editing = params.id ? Number(params.id) : 0;
  const base = isSale ? 'sales' : 'purchases';
  const S = state.settings;
  const lineTax = S['tax.enabled'] && S['tax.mode'] === 'line';
  const invoiceTax = S['tax.enabled'] && S['tax.mode'] === 'invoice';
  const taxRates = state.me.tax_rates || [];

  if (!can(isSale ? (editing ? 'sales.edit' : 'sales.create') : (editing ? 'purchases.edit' : 'purchases.create'))) {
    mount(el, empty(t('You do not have permission for this.')));
    return;
  }
  mount(el, spinner());

  const doc = {
    party: null,
    lines: [],
    discount_type: 'fixed',
    discount_value: '',
    shipping: '',
    other: '',
    payments: [],
  };
  let existing = null;
  if (editing) {
    existing = await api.get(`${base}/${editing}`);
    doc.party = isSale ? existing.customer : existing.supplier;
    doc.discount_type = existing.discount_type;
    doc.discount_value = existing.discount_value === '0.0000' ? '' : str(dec(existing.discount_value), places());
    doc.shipping = str(dec(existing.shipping_amount), places());
    doc.other = str(dec(existing.other_cost || 0), places());
    doc.lines = existing.items.map((i) => ({
      product_id: Number(i.product_id), variant_id: Number(i.variant_id), name: i.name,
      qty: str(dec(i.qty)).replace(/\.?0+$/, ''), price: str(dec(i.unit_price), places()),
      discount_type: i.discount_type, discount_value: dec(i.discount_value) ? str(dec(i.discount_value), places()) : '', tax_rate_id: '',
    }));
  }

  const form = h('form', { class: 'form doc-form', novalidate: true });

  /* Party */
  const partyBox = h('div', { class: 'field', dataset: { field: isSale ? 'customer_id' : 'supplier_id' } });
  const partyPicker = combobox({
    placeholder: isSale ? t('Walk-in customer — search…') : t('Search supplier…'),
    search: async (q) => (await api.get(isSale ? 'customers' : 'suppliers', { search: q, per_page: 10 })).items,
    label: (c) => c.name,
    sub: (c) => `${c.phone || ''} ${dec(c.balance) ? '· ' + t('Balance') + ' ' + money(c.balance) : ''}`,
    onPick: (c) => { doc.party = c; paintParty(); },
  });
  function paintParty() {
    mount(partyBox,
      h('label', {}, isSale ? t('Customer') : t('Supplier')),
      doc.party
        ? h('div', { class: 'picked' }, h('strong', {}, doc.party.name), h('small', { class: 'muted' }, ` ${doc.party.phone || ''}`),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Change'), onclick: () => { doc.party = null; paintParty(); } }, icon('x', 16)))
        : partyPicker.el,
      h('small', { class: 'error', role: 'alert' }));
  }
  paintParty();

  const dateInput = input(isSale ? 'sale_date' : 'purchase_date', existing ? (existing.sale_date || existing.purchase_date) : today(), { type: 'date' });
  const dueInput = input('due_date', existing?.due_date || '', { type: 'date' });
  const supplierInv = isSale ? null : input('supplier_invoice', existing?.supplier_invoice || '');
  const notes = textarea('notes', existing?.notes || '', { rows: 2 });
  const docTax = invoiceTax ? select('tax_rate_id', [['', t('No tax')], ...taxRates.map((r) => [r.id, `${r.name} (${Number(r.rate)}%)`])], taxRates.find((r) => r.is_default)?.id || '') : null;

  /* Lines */
  const linesBody = h('tbody');
  const totalsEl = h('div', { class: 'doc-totals' });
  const productPicker = combobox({
    placeholder: t('Add product — search or scan'),
    search: async (q) => (await api.get('products', { search: q, per_page: 12 })).items,
    label: (p) => p.name,
    sub: (p) => `${money(isSale ? p.selling_price : (p.purchase_price ?? p.selling_price))}${p.track_stock ? ' · ' + t('Stock') + ' ' + fmtQty(p.stock_qty) : ''}`,
    onPick: (p) => { addProduct(p); productPicker.clear(); productPicker.input.focus(); },
    onEnter: (code) => { if (!code) return false; lookup(code); return true; },
  });

  async function lookup(code) {
    try { const r = await api.get('products/lookup', { code }); addProduct(r.product, r.variant); } catch { toast(t('No product with code {c}', { c: code }), 'error'); }
  }

  async function addProduct(p, variant = null) {
    if (p.has_variants && !variant) {
      const full = await api.get(`products/${p.id}`);
      if (full.variants.length) {
        full.variants.forEach((v) => addProduct(full, v));
        toast(t('All variants added — remove the ones you don\'t need.'), 'info');
        return;
      }
    }
    const price = variant ? (isSale ? variant.selling_price : variant.purchase_price) : (isSale ? p.selling_price : p.purchase_price);
    doc.lines.push({ product_id: p.id, variant_id: variant?.id || 0, name: p.name + (variant ? ` - ${variant.name}` : ''), qty: '1', price: str(dec(price ?? 0), places()), discount_type: 'fixed', discount_value: '', tax_rate_id: p.tax_rate_id || '' });
    paintLines();
  }

  function lineAmount(l) {
    const gross = mul(dec(l.qty), dec(l.price));
    const d = l.discount_type === 'percent' ? Math.round((gross * dec(l.discount_value)) / 1000000) : dec(l.discount_value);
    return gross - d;
  }

  function paintLines() {
    mount(linesBody, doc.lines.length ? doc.lines.map((l, i) => {
      const bind = (key, elx) => { elx.addEventListener('input', () => { l[key] = elx.value; paintTotals(); amountCell.textContent = money(str(lineAmount(l))); }); return elx; };
      const amountCell = h('td', { class: 'num', 'data-label': t('Amount') }, money(str(lineAmount(l))));
      return h('tr', { dataset: { field: `items.${i}` } },
        h('td', { 'data-label': t('Item') }, h('strong', {}, l.name), h('small', { class: 'error', role: 'alert' })),
        h('td', { 'data-label': t('Qty') }, bind('qty', input(`items.${i}.qty`, l.qty, { inputmode: 'decimal', class: 'input input-sm', 'aria-label': t('Quantity') }))),
        h('td', { 'data-label': isSale ? t('Price') : t('Cost') }, bind('price', money_input(`items.${i}.unit_price`, l.price, { class: 'input input-sm', 'aria-label': t('Price'), disabled: isSale && !can('sales.price') }))),
        h('td', { 'data-label': t('Discount') }, h('div', { class: 'row' },
          bind('discount_value', money_input(`items.${i}.discount_value`, l.discount_value, { class: 'input input-sm', placeholder: '0', 'aria-label': t('Discount'), disabled: isSale && !can('sales.discount') })),
          bind('discount_type', select(`items.${i}.discount_type`, [['fixed', state.business.currency_symbol || '#'], ['percent', '%']], l.discount_type, { class: 'input input-sm', 'aria-label': t('Discount type') })))),
        lineTax ? h('td', { 'data-label': S['tax.label'] }, bind('tax_rate_id', select(`items.${i}.tax_rate_id`, [['', t('Default')], ...taxRates.map((r) => [r.id, `${Number(r.rate)}%`])], l.tax_rate_id, { class: 'input input-sm' }))) : null,
        amountCell,
        h('td', {}, h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Remove'), onclick: () => { doc.lines.splice(i, 1); paintLines(); } }, icon('trash', 16))));
    }) : h('tr', {}, h('td', { colspan: 7, class: 'muted center' }, t('No items yet — search above or scan a barcode.'))));
    paintTotals();
  }

  /* Totals + payments */
  const discValue = money_input('discount_value', doc.discount_value, { placeholder: '0' });
  const discType = select('discount_type', [['fixed', t('Amount')], ['percent', '%']], doc.discount_type);
  const shipping = money_input('shipping_amount', doc.shipping, { placeholder: '0' });
  const other = isSale ? null : money_input('other_cost', doc.other, { placeholder: '0' });
  [discValue, discType, shipping, other].filter(Boolean).forEach((x) => x.addEventListener('input', paintTotals));

  function subtotal() { return doc.lines.reduce((a, l) => a + lineAmount(l), 0); }
  function estimate() {
    const sub = subtotal();
    const d = discType.value === 'percent' ? Math.round((sub * dec(discValue.value)) / 1000000) : dec(discValue.value);
    return sub - d + dec(shipping.value) + (other ? dec(other.value) : 0);
  }
  function paintTotals() {
    const tot = estimate();
    const paid = doc.payments.reduce((a, p) => a + dec(p.amount), 0);
    mount(totalsEl,
      h('div', { class: 'tl' }, h('span', {}, t('Subtotal')), h('span', {}, money(str(subtotal())))),
      h('div', { class: 'tl grand' }, h('span', {}, t('Total')), h('strong', {}, money(str(tot)), S['tax.enabled'] ? h('small', { class: 'muted' }, ` + ${S['tax.label']}`) : null)),
      h('div', { class: 'tl' }, h('span', {}, t('Paying now')), h('span', {}, money(str(paid)))));
  }

  const paymentsEl = h('div', { class: 'tenders' });
  const accounts = state.me.payment_accounts;
  function paintPayments() {
    mount(paymentsEl,
      doc.payments.map((p, i) => {
        const acc = select(`payments.${i}.account_id`, accounts.map((a) => [a.id, a.name]), p.account_id);
        acc.addEventListener('change', () => { p.account_id = Number(acc.value); });
        const amt = money_input(`payments.${i}.amount`, p.amount, { placeholder: '0' });
        amt.addEventListener('input', () => { p.amount = amt.value; paintTotals(); });
        const ref = input(`payments.${i}.reference`, p.reference, { placeholder: t('Reference') });
        ref.addEventListener('input', () => { p.reference = ref.value; });
        return h('div', { class: 'tender' }, acc, amt, ref, h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Remove'), onclick: () => { doc.payments.splice(i, 1); paintPayments(); paintTotals(); } }, icon('x', 16)));
      }),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { doc.payments.push({ account_id: accounts[0]?.id, amount: str(estimate() - doc.payments.reduce((a, p) => a + dec(p.amount), 0), places()), reference: '' }); paintPayments(); paintTotals(); } }, icon('plus', 14), t('Add payment')),
        editing ? h('small', { class: 'muted' }, t('Leave empty to keep the payments already recorded.')) : null));
  }

  const draftAllowed = !editing || existing?.status === 'draft' || existing?.status === 'held';
  const submitBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, icon('check'), editing ? t('Save changes') : isSale ? t('Save sale') : t('Save purchase'));
  const draftBtn = draftAllowed && !isSale ? h('button', { class: 'btn', type: 'button', onclick: () => save('draft') }, t('Save as draft')) : null;

  // Sales: who sold it.
  const sellerSel = isSale ? h('select', { class: 'input', name: 'salesperson_id' }, h('option', { value: '' }, state.me.user.name)) : null;
  if (sellerSel) {
    api.get('staff').then((staff) => {
      if (!Array.isArray(staff) || !staff.length) return;
      mount(sellerSel, staff.map((u) => h('option', { value: u.id }, u.name)));
      sellerSel.value = String(existing?.salesperson_id || state.me.user.id);
    }).catch(() => {});
  }

  mount(form,
    card(null, h('div', { class: 'form-grid' },
      partyBox,
      sellerSel ? field(t('Sold by'), sellerSel) : null,
      field(t('Date'), dateInput),
      field(t('Due date'), dueInput),
      supplierInv ? field(t('Supplier invoice no.'), supplierInv) : null,
      docTax ? field(S['tax.label'], docTax) : null)),
    card(t('Items'),
      h('div', { class: 'row' }, productPicker.el),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table lines-table' },
        h('thead', {}, h('tr', {}, h('th', {}, t('Item')), h('th', {}, t('Qty')), h('th', {}, isSale ? t('Price') : t('Cost')), h('th', {}, t('Discount')), lineTax ? h('th', {}, S['tax.label']) : null, h('th', { class: 'num' }, t('Amount')), h('th', {}))),
        linesBody)),
      h('div', { class: 'field', dataset: { field: 'items' } }, h('small', { class: 'error', role: 'alert' }))),
    h('div', { class: 'grid-2' },
      card(t('Adjustments'), h('div', { class: 'form-grid' },
        field(t('Invoice discount'), h('div', { class: 'row' }, discValue, discType)),
        field(t('Shipping'), shipping),
        other ? field(t('Other costs'), other, { hint: t('Added to product cost (landed cost)') }) : null,
        field(t('Notes'), notes, { wide: true }))),
      card(t('Payment'), totalsEl, paymentsEl, h('div', { class: 'field', dataset: { field: 'payments' } }, h('small', { class: 'error', role: 'alert' })))),
    h('div', { class: 'form-actions sticky' }, h('a', { class: 'btn', href: `#/${base}${editing ? '/' + editing : ''}` }, t('Cancel')), draftBtn, submitBtn));

  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });

  async function save(status) {
    const body = {
      [isSale ? 'customer_id' : 'supplier_id']: doc.party?.id || 0,
      [isSale ? 'sale_date' : 'purchase_date']: dateInput.value,
      ...(sellerSel && sellerSel.value ? { salesperson_id: Number(sellerSel.value) } : {}),
      due_date: dueInput.value,
      notes: notes.value,
      discount_type: discType.value,
      discount_value: discValue.value || '0',
      shipping_amount: shipping.value || '0',
      items: doc.lines.map((l) => ({
        product_id: l.product_id, variant_id: l.variant_id, qty: l.qty, unit_price: l.price,
        discount_type: l.discount_type, discount_value: l.discount_value || '0',
        ...(lineTax && l.tax_rate_id ? { tax_rate_id: l.tax_rate_id } : {}),
      })),
    };
    if (!isSale) { body.supplier_invoice = supplierInv.value; body.other_cost = other.value || '0'; }
    if (docTax) body.tax_rate_id = docTax.value;
    if (!editing || doc.payments.length) body.payments = doc.payments.filter((p) => dec(p.amount) > 0).map((p) => ({ account_id: p.account_id, amount: p.amount, reference: p.reference }));
    if (status) body.status = status;
    else if (editing && existing.status === 'draft') body.status = 'completed';
    if (!editing) body.uuid = uuid();

    submitBtn.disabled = true;
    showFieldErrors(form, {});
    try {
      const saved = editing ? await api.put(`${base}/${editing}`, body) : await api.post(base, body);
      toast(t('Saved {n}', { n: saved.number }));
      navigate(`/${base}/${saved.id}`);
    } catch (err) {
      showFieldErrors(form, err.errors || {});
      showError(err);
    } finally {
      submitBtn.disabled = false;
    }
  }

  const title = editing ? t('Edit {n}', { n: existing.number }) : isSale ? t('New sale') : t('New purchase');
  const p = page(title, { back: `/${base}`, subtitle: editing && existing.status === 'completed' ? t('Saving re-posts stock and accounts for this document.') : '' });
  p.body.append(form);
  mount(el, p.el);
  paintLines();
  paintPayments();
  const off = onScan((code) => lookup(code));
  window.addEventListener('hashchange', off, { once: true });
}
