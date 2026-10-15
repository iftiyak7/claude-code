/**
 * Point of sale.
 *
 * Flow: search/scan → cart → Pay → (print) → next customer.
 * Keyboard: F2 search, F4 pay, F8 hold, Esc clears the search.
 * Works offline: products come from the IndexedDB snapshot and the sale is
 * queued with its UUID until the connection returns.
 */
import { h, mount, debounce, uuid } from '../core/dom.js';
import { api } from '../core/api.js';
import { state, can } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, qty as fmtQty, dec, str, mul, places } from '../core/format.js';
import { combobox, modal, toast, showError, input, field, confirmDialog, empty, spinner, money_input } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { whatsappUrl } from '../core/remind.js';
import { onScan, scanWithCamera, cameraSupported } from '../core/scanner.js';
import { printSale, openPrint } from '../core/printer.js';
import { cacheGet, queueSale, refreshSnapshot } from '../core/offline.js';
import { navigate } from '../core/router.js';

export default async function pos(el) {
  if (!can('pos.use')) { mount(el, empty(t('You do not have access to the POS.'))); return; }

  const S = state.settings;
  const cart = {
    lines: [], // {product_id, variant_id, name, qty(int), price(int), discount(int), track, stock}
    customer: null,
    discount: 0,
    shipping: 0,
    heldId: null,
    note: '',
  };
  let catalogue = [];
  let category = 0;
  let quote = null;

  /* ---------------------------------------------------------- Catalogue */

  async function loadCatalogue() {
    try {
      const res = await api.get('products', { per_page: 500, orderby: 'name' });
      catalogue = res.items;
    } catch (err) {
      catalogue = (await cacheGet('products')) || [];
      if (!catalogue.length) toast(t('Offline and no product data cached yet.'), 'error');
    }
    paintGrid();
  }

  const grid = h('div', { class: 'pos-grid' }, spinner());
  const chips = h('div', { class: 'chips', role: 'tablist' });

  function paintChips() {
    const cats = state.me.categories || [];
    mount(chips,
      h('button', { class: `chip ${category === 0 ? 'active' : ''}`, type: 'button', onclick: () => { category = 0; paintChips(); paintGrid(); } }, t('All')),
      cats.filter((c) => Number(c.product_count) > 0).map((c) => h('button', {
        class: `chip ${category === Number(c.id) ? 'active' : ''}`, type: 'button', onclick: () => { category = Number(c.id); paintChips(); paintGrid(); },
      }, c.name)));
  }

  function paintGrid() {
    const list = catalogue.filter((p) => p.status === 'active' && (!category || p.category_id === category)).slice(0, 120);
    mount(grid, list.length ? list.map((p) => h('button', {
      class: `tile ${p.track_stock && dec(p.stock_qty) <= 0 ? 'out' : ''} ${isLoose(p) ? 'loose' : ''}`, type: 'button', onclick: () => pick(p),
      title: t('Long-press to change quantity or price'),
      oncontextmenu: (e) => { e.preventDefault(); pickAndEdit(p); },
    },
    isLoose(p) ? h('span', { class: 'tile-weigh' }, `⚖ ${t('By weight')}`) : null,
    S['pos.show_images'] && p.image_url ? h('img', { src: p.image_url, alt: '', loading: 'lazy' }) : h('span', { class: 'tile-initial', 'aria-hidden': 'true' }, p.name.slice(0, 2)),
    h('span', { class: 'tile-name' }, p.name),
    h('span', { class: 'tile-price' }, money(p.selling_price), isLoose(p) && p.unit_name ? h('small', {}, ` /${p.unit_name}`) : null),
    p.track_stock ? h('small', { class: 'tile-stock' }, fmtQty(p.stock_qty)) : null)) : empty(t('No products. Add products first.'), can('products.create') ? h('a', { class: 'btn', href: '#/products/new' }, t('Add product')) : null));
  }

  const search = combobox({
    placeholder: t('Search product or scan barcode (F2)'),
    autofocus: true,
    search: async (q) => {
      const term = q.toLowerCase();
      if (!term) return catalogue.slice(0, 10);
      return catalogue.filter((p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase() === term || p.barcode === q).slice(0, 12);
    },
    label: (p) => p.name,
    sub: (p) => `${money(p.selling_price)}${p.track_stock ? ' · ' + t('Stock') + ' ' + fmtQty(p.stock_qty) : ''}${p.sku ? ' · ' + p.sku : ''}`,
    onPick: (p) => { pick(p); search.clear(); },
    onEnter: (code) => { if (!code) return false; byCode(code); return true; },
  });

  async function byCode(code) {
    const local = catalogue.find((p) => p.barcode === code || p.sku === code);
    if (local && !local.has_variants) { pick(local); return; }
    try {
      const res = await api.get('products/lookup', { code });
      add(res.product, res.variant);
    } catch (err) {
      toast(err.offline ? t('Offline: code not in cached products.') : t('No product with code {c}', { c: code }), 'error');
    }
  }

  async function pick(p) {
    if (p.has_variants) {
      try {
        const full = await api.get(`products/${p.id}`);
        if (full.variants.length) {
          const m = modal({
            title: p.name,
            body: h('div', { class: 'variant-list' }, full.variants.map((v) => h('button', {
              class: 'tile', type: 'button', onclick: () => { m.close(); add(full, v); },
            }, h('span', { class: 'tile-name' }, v.name), h('span', { class: 'tile-price' }, money(v.selling_price)), h('small', {}, fmtQty(v.stock_qty))))),
          });
          return;
        }
      } catch (err) { showError(err); return; }
    }
    add(p, null);
  }

  /** Long-press: add with the quantity/price editor open, for any product. */
  function pickAndEdit(p) {
    if (p.has_variants) { pick(p); return; }
    const key = `${p.id}:0`;
    const existing = cart.lines.find((l) => `${l.product_id}:${l.variant_id}` === key);
    if (existing) { editLine(existing, false); return; }
    const price = dec(p.selling_price);
    editLine({ product_id: p.id, variant_id: 0, name: p.name, qty: 10000, price, base: price, discount: 0, track: !!p.track_stock, stock: dec(p.stock_qty), unit: p.unit_name || '', loose: isLoose(p) }, true);
  }

  function isLoose(p) {
    return !!p.unit_decimal || ['kg', 'g', 'gm', 'l', 'ltr', 'ml', 'm'].includes(String(p.unit_name || '').toLowerCase());
  }

  function add(p, v) {
    const key = `${p.id}:${v?.id || 0}`;
    const existing = cart.lines.find((l) => `${l.product_id}:${l.variant_id}` === key);
    const stock = v ? dec(v.stock_qty) : dec(p.stock_qty);
    const price = v ? dec(v.selling_price) : dec(p.selling_price);
    const line = existing || { product_id: p.id, variant_id: v?.id || 0, name: p.name + (v ? ` - ${v.name}` : ''), qty: 10000, price, base: price, discount: 0, track: !!p.track_stock, stock, unit: p.unit_name || '', loose: isLoose(p) };
    if (line.loose) {
      // Weighed/loose goods (e.g. nuts by the gram): ask how much first.
      editLine(line, !existing);
      return;
    }
    if (existing) existing.qty += 10000; else cart.lines.push(line);
    if (line.track && line.qty > line.stock && !S['inventory.allow_negative']) toast(t('Only {n} in stock for {p}', { n: fmtQty(line.stock), p: line.name }), 'error');
    navigator.vibrate?.(30);
    bump();
    paintCart();
  }

  /* ---------------------------------------------------------- Cart */

  const cartBody = h('div', { class: 'cart-lines' });
  const totalsEl = h('div', { class: 'cart-totals' });
  const customerBox = h('div', { class: 'cart-customer' });

  const makeCustomerPicker = (onPick) => combobox({
    placeholder: t('Walk-in customer — search name/phone'),
    search: async (q) => {
      try { return (await api.get('customers', { search: q, per_page: 8, orderby: 'recent' })).items; }
      catch { const all = (await cacheGet('customers')) || []; return all.filter((c) => (c.name + c.phone).toLowerCase().includes(q.toLowerCase())).slice(0, 8); }
    },
    label: (c) => c.name,
    sub: (c) => `${c.phone || ''}${dec(c.balance) > 0 ? ' · ' + t('Due') + ' ' + money(c.balance) : ''}`,
    onPick,
  });
  const customerPicker = makeCustomerPicker((c) => { cart.customer = c; paintCustomer(); requestQuote(); });

  function paintCustomer() {
    if (cart.customer) {
      mount(customerBox, h('div', { class: 'picked' },
        icon('customers', 18),
        h('div', {}, h('strong', {}, cart.customer.name), h('small', { class: 'muted' }, ` ${cart.customer.phone || ''}`),
          dec(cart.customer.balance) > 0 ? h('small', { class: 'warn-text' }, ` · ${t('Previous due')} ${money(cart.customer.balance)}`) : null),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Remove customer'), onclick: () => { cart.customer = null; paintCustomer(); } }, icon('x', 16))));
    } else {
      mount(customerBox, h('div', { class: 'row' }, customerPicker.el,
        can('customers.create') ? h('button', { class: 'icon-btn', type: 'button', title: t('New customer'), 'aria-label': t('New customer'), onclick: () => quickCustomer() }, icon('plus')) : null));
    }
  }

  function quickCustomer(after) {
    const name = input('name', '', { required: true });
    const phone = input('phone', '', { type: 'tel', inputmode: 'tel' });
    const m = modal({
      title: t('New customer'),
      size: 'sm',
      body: h('form', { class: 'form', id: 'qc' }, field(t('Name'), name, { required: true }), field(t('Phone'), phone)),
      actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        try {
          cart.customer = await api.post('customers', { name: name.value, phone: phone.value, quick: 1 });
          m.close(); paintCustomer();
          if (typeof after === 'function') after(cart.customer);
        } catch (err) { showError(err); }
      } }, t('Add'))],
    });
  }

  function lineTotal(l) {
    return mul(l.qty, l.price) - l.discount;
  }

  function paintCart() {
    if (!cart.lines.length) {
      mount(cartBody, h('div', { class: 'cart-empty' }, icon('pos', 40), h('p', {}, t('Scan or tap a product to start.'))));
    } else {
      mount(cartBody, cart.lines.map((l, i) => {
        const remove = () => { cart.lines.splice(i, 1); paintCart(); };
        return h('div', { class: 'cart-line' },
          h('button', { class: 'cl-main', type: 'button', title: t('Tap to change quantity or price'), onclick: () => editLine(l, false) },
            h('strong', {}, l.name),
            h('small', { class: 'muted' }, `${fmtQty(l.qty)}${l.unit ? ' ' + l.unit : ''} × ${money(str(l.price))}${l.discount ? ' − ' + money(str(l.discount)) : ''}`, ' ', icon('edit', 12))),
          l.loose
            ? h('button', { class: 'btn btn-sm qty-chip', type: 'button', onclick: () => editLine(l, false) }, `${fmtQty(l.qty)} ${l.unit}`)
            : h('div', { class: 'stepper' },
              h('button', { type: 'button', 'aria-label': t('Decrease'), onclick: () => { l.qty -= 10000; if (l.qty <= 0) cart.lines.splice(i, 1); paintCart(); } }, icon('minus', 16)),
              h('button', { type: 'button', class: 'qty-input', 'aria-label': t('Quantity'), onclick: () => editLine(l, false) }, fmtQty(l.qty)),
              h('button', { type: 'button', 'aria-label': t('Increase'), onclick: () => { l.qty += 10000; paintCart(); } }, icon('plus', 16))),
          h('strong', { class: 'cl-total' }, money(str(lineTotal(l)))),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Remove'), onclick: remove }, icon('trash', 16)));
      }));
    }
    quote = null;
    paintTotals();
    requestQuote();
  }

  /**
   * Quantity / weight / price editor for a cart line. For loose goods it
   * accepts grams, kilograms or a taka amount ("৳50 worth").
   */
  function editLine(l, isNew) {
    const unit = (l.unit || '').toLowerCase();
    const isKg = unit === 'kg';
    const isLitre = unit === 'l' || unit === 'ltr';
    const canPrice = can('sales.price');
    const canDisc = can('sales.discount');
    const work = { qty: isNew && l.loose ? 0 : l.qty, price: l.price, discount: l.discount };

    const qtyIn = money_input('qty', work.qty ? fmtQty(work.qty) : '', { autofocus: !isKg, 'aria-label': t('Quantity') });
    const gramIn = isKg || isLitre ? money_input('grams', work.qty ? String(Math.round(work.qty / 10)) : '', { autofocus: true, 'aria-label': isKg ? t('Grams') : t('ml') }) : null;
    const amountIn = money_input('amount', '', { placeholder: t('e.g. 50'), 'aria-label': t('Amount') });
    const priceIn = money_input('price', str(work.price, places()), { disabled: !canPrice });
    const discIn = money_input('discount', work.discount ? str(work.discount, places()) : '', { disabled: !canDisc, placeholder: '0' });
    const totalOut = h('strong', { class: 'big' });

    const total = () => mul(work.qty, work.price) - work.discount;
    const paint = (from) => {
      if (from !== 'qty') qtyIn.value = work.qty ? fmtQty(work.qty) : '';
      if (gramIn && from !== 'grams') gramIn.value = work.qty ? String(Math.round(work.qty / 10)) : '';
      if (from !== 'amount') amountIn.value = '';
      totalOut.textContent = money(str(Math.max(0, total())));
    };
    qtyIn.addEventListener('input', () => { work.qty = dec(qtyIn.value); paint('qty'); });
    gramIn?.addEventListener('input', () => { work.qty = Math.round(Number(gramIn.value || 0) * 10); paint('grams'); });
    priceIn.addEventListener('input', () => { work.price = dec(priceIn.value); paint('price'); });
    discIn.addEventListener('input', () => { work.discount = dec(discIn.value); paint('disc'); });
    amountIn.addEventListener('input', () => {
      const amount = dec(amountIn.value);
      if (!amount || !work.price) return;
      // qty = amount / price, to 0.1 g; round up and absorb the few paisa as discount when allowed.
      work.qty = Math.ceil((amount * 10000) / work.price);
      work.discount = canDisc ? Math.max(0, mul(work.qty, work.price) - amount) : 0;
      discIn.value = work.discount ? str(work.discount, places()) : '';
      paint('amount');
    });

    const chips = (isKg ? [[100, '100g'], [250, '250g'], [500, '500g'], [1000, '1kg'], [2000, '2kg']]
      : isLitre ? [[250, '250ml'], [500, '500ml'], [1000, '1L'], [2000, '2L']]
        : l.loose ? [[250, '0.25'], [500, '0.5'], [1000, '1'], [2000, '2']]
          : [[1000, '1'], [2000, '2'], [3000, '3'], [5000, '5'], [10000, '10']])
      .map(([n, label]) => h('button', { class: 'chip', type: 'button', onclick: () => { work.qty = n * 10; paint(); } }, label));

    const apply = () => {
      if (work.qty <= 0) { toast(t('Enter a quantity.'), 'error'); return; }
      l.qty = work.qty; l.price = work.price; l.discount = Math.min(work.discount, mul(work.qty, work.price));
      if (isNew && !cart.lines.includes(l)) cart.lines.push(l);
      if (l.track && l.qty > l.stock && !S['inventory.allow_negative']) toast(t('Only {n} in stock for {p}', { n: fmtQty(l.stock), p: l.name }), 'error');
      m.close();
      bump();
      paintCart();
    };

    const body = h('form', { class: 'form line-editor', onsubmit: (e) => { e.preventDefault(); apply(); } },
      h('p', { class: 'muted' }, `${money(str(l.base))} / ${l.unit || t('unit')}`),
      gramIn ? field(isKg ? t('Weight in grams') : t('Volume in ml'), gramIn) : null,
      field(l.unit ? t('Quantity ({u})', { u: l.unit }) : t('Quantity'), qtyIn),
      h('div', { class: 'chips wrap' }, chips),
      l.loose ? field(t('Or sell by amount (৳)'), amountIn, { hint: t('Type the money the customer wants to spend; the weight is calculated.') }) : null,
      h('div', { class: 'grid-2 tight' },
        field(t('Unit price'), priceIn, { hint: canPrice ? '' : t('You cannot change prices') }),
        field(t('Discount'), discIn)),
      h('div', { class: 'tl grand' }, h('span', {}, t('Line total')), totalOut),
      h('button', { type: 'submit', hidden: true }));
    const m = modal({
      title: l.name,
      size: 'sm',
      body,
      actions: [
        !isNew ? h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: () => { cart.lines.splice(cart.lines.indexOf(l), 1); m.close(); paintCart(); } }, icon('trash', 16), t('Remove')) : null,
        h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: apply }, icon('check'), isNew ? t('Add to cart') : t('Update')),
      ],
    });
    paint();
    (gramIn || qtyIn).focus();
  }

  function payload() {
    return {
      customer_id: cart.customer?.id || 0,
      channel: 'pos',
      items: cart.lines.map((l) => ({
        product_id: l.product_id,
        variant_id: l.variant_id,
        qty: str(l.qty),
        ...(l.price !== l.base ? { unit_price: str(l.price) } : {}),
        discount_type: 'fixed',
        discount_value: str(l.discount),
      })),
      discount_type: 'fixed',
      discount_value: str(cart.discount),
      shipping_amount: str(cart.shipping),
      notes: cart.note,
    };
  }

  const requestQuote = debounce(async () => {
    if (!cart.lines.length || !navigator.onLine) return;
    try {
      quote = await api.post('sales/quote', payload());
      paintTotals();
    } catch (err) {
      if (err.errors && Object.keys(err.errors).length) toast(Object.values(err.errors)[0], 'error');
    }
  }, 300);

  function estimate() {
    const sub = cart.lines.reduce((a, l) => a + lineTotal(l), 0);
    return { subtotal: sub, discount: cart.discount, tax: 0, shipping: cart.shipping, total: sub - cart.discount + cart.shipping };
  }

  function totals() {
    if (quote) return { subtotal: dec(quote.subtotal), discount: dec(quote.discount_amount), tax: dec(quote.tax_amount), shipping: dec(quote.shipping_amount), total: dec(quote.total), exact: true };
    return { ...estimate(), exact: false };
  }

  function paintTotals() {
    const tt = totals();
    mount(totalsEl,
      h('div', { class: 'tl' }, h('span', {}, t('Subtotal')), h('span', {}, money(str(tt.subtotal)))),
      h('div', { class: 'tl' },
        h('button', { class: 'link', type: 'button', disabled: !can('sales.discount'), onclick: docDiscount }, t('Discount'), ' ', icon('edit', 12)),
        h('span', {}, tt.discount ? '−' + money(str(tt.discount)) : '—')),
      tt.tax ? h('div', { class: 'tl' }, h('span', {}, S['tax.label']), h('span', {}, money(str(tt.tax)))) : null,
      h('div', { class: 'tl' },
        h('button', { class: 'link', type: 'button', onclick: shipping }, t('Shipping'), ' ', icon('edit', 12)),
        h('span', {}, tt.shipping ? money(str(tt.shipping)) : '—')),
      h('div', { class: 'tl grand' }, h('span', {}, t('Total')), h('strong', {}, money(str(tt.total)), tt.exact || !cart.lines.length ? null : h('small', { class: 'muted', title: t('Estimate until the server confirms tax') }, ' ≈'))));
    payBtn.disabled = !cart.lines.length;
    holdBtn.disabled = !cart.lines.length;
    payBtn.lastChild.textContent = cart.lines.length ? `${t('Pay')} ${money(str(tt.total))}` : t('Pay');
    paintBar(tt.total);
  }

  function docDiscount() {
    const tt = estimate();
    const amount = money_input('amount', str(cart.discount, places()));
    const pct = money_input('pct', '');
    pct.addEventListener('input', () => { amount.value = str(Math.round((tt.subtotal * dec(pct.value)) / 1000000), places()); });
    const m = modal({
      title: t('Invoice discount'), size: 'sm',
      body: h('div', { class: 'form' }, field(t('Percent'), pct, { hint: t('Fills the amount for you') }), field(t('Amount'), amount)),
      actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { cart.discount = dec(amount.value); m.close(); paintCart(); } }, t('Apply'))],
    });
  }

  function shipping() {
    const amount = money_input('amount', str(cart.shipping, places()));
    const m = modal({
      title: t('Shipping charge'), size: 'sm', body: field(t('Amount'), amount),
      actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { cart.shipping = dec(amount.value); m.close(); paintCart(); } }, t('Apply'))],
    });
  }

  /* ---------------------------------------------------------- Hold / resume */

  async function hold() {
    if (!cart.lines.length) return;
    try {
      const body = { ...payload(), status: 'held' };
      if (cart.heldId) await api.put(`sales/${cart.heldId}`, body);
      else await api.post('sales', body);
      toast(t('Sale held'));
      reset();
    } catch (err) { showError(err); }
  }

  async function showHeld() {
    try {
      const res = await api.get('sales', { status: 'held', per_page: 50 });
      const m = modal({
        title: t('Held sales'),
        body: res.items.length ? h('ul', { class: 'list' }, res.items.map((s) => h('li', {},
          h('button', { class: 'row-btn', type: 'button', onclick: async () => { m.close(); await resume(s.id); } },
            h('span', {}, h('strong', {}, s.customer_name || t('Walk-in')), h('small', { class: 'muted' }, ` ${s.number}`)),
            h('span', {}, money(s.total)))))) : empty(t('No held sales.')),
      });
    } catch (err) { showError(err); }
  }

  async function resume(id) {
    const s = await api.get(`sales/${id}`);
    reset(false);
    cart.heldId = s.id;
    cart.customer = s.customer;
    cart.discount = dec(s.discount_amount);
    cart.shipping = dec(s.shipping_amount);
    cart.lines = s.items.map((i) => {
      const p = catalogue.find((c) => c.id === Number(i.product_id));
      const price = dec(i.unit_price);
      return { product_id: Number(i.product_id), variant_id: Number(i.variant_id), name: i.name, qty: dec(i.qty), price, base: p ? dec(p.selling_price) : price, discount: dec(i.discount_amount), track: p ? p.track_stock : true, stock: p ? dec(p.stock_qty) : Infinity };
    });
    paintCustomer();
    paintCart();
  }

  /* ---------------------------------------------------------- Payment */

  async function pay() {
    if (!cart.lines.length) return;
    if (!quote && navigator.onLine) {
      try { quote = await api.post('sales/quote', payload()); } catch (err) { showError(err); return; }
    }
    const total = totals().total;
    const accounts = state.me.payment_accounts;
    const defaultAcc = Number(S['sales.default_payment_account']) || accounts.find((a) => a.system_key === 'cash')?.id;
    const tenders = [{ account_id: defaultAcc, amount: total, reference: '' }];
    let given = 0;

    const linesEl = h('div', { class: 'tenders' });
    const summary = h('div', { class: 'pay-summary' });
    const givenInput = money_input('given', '', { placeholder: t('Cash given (for change)') });
    givenInput.addEventListener('input', () => { given = dec(givenInput.value); paintSummary(); });

    const paintTenders = () => mount(linesEl, tenders.map((tr, i) => {
      const acc = h('select', { class: 'input', 'aria-label': t('Method') }, accounts.map((a) => h('option', { value: a.id, selected: a.id === tr.account_id }, a.name)));
      acc.addEventListener('change', () => { tr.account_id = Number(acc.value); });
      const amt = money_input('amount', str(tr.amount, places()), { 'aria-label': t('Amount') });
      amt.addEventListener('input', () => { tr.amount = dec(amt.value); paintSummary(); });
      const ref = input('ref', tr.reference, { placeholder: t('Ref / TrxID'), 'aria-label': t('Reference') });
      ref.addEventListener('input', () => { tr.reference = ref.value; });
      return h('div', { class: 'tender' }, acc, amt, ref,
        tenders.length > 1 ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Remove'), onclick: () => { tenders.splice(i, 1); paintTenders(); paintSummary(); } }, icon('x', 16)) : null);
    }));

    const quick = h('div', { class: 'quick-cash' });
    const paintQuick = () => mount(quick,
      [['exact', t('Exact')], ...[50, 100, 500, 1000].map((n) => [n, money(String(n))])].map(([n, label]) => h('button', {
        class: 'chip', type: 'button', onclick: () => {
          if (n === 'exact') { tenders.splice(0, tenders.length, { account_id: defaultAcc, amount: total, reference: '' }); given = 0; givenInput.value = ''; }
          else { given = Math.ceil(total / (n * 10000)) * n * 10000; givenInput.value = str(given, places()); }
          paintTenders(); paintSummary();
        },
      }, label)),
      h('button', { class: 'chip', type: 'button', onclick: () => { tenders.push({ account_id: accounts.find((a) => a.subtype !== 'cash')?.id || defaultAcc, amount: Math.max(0, total - tenders.reduce((a, x) => a + x.amount, 0)), reference: '' }); paintTenders(); paintSummary(); } }, icon('plus', 14), t('Split payment')),
      cart.customer ? h('button', { class: 'chip', type: 'button', onclick: () => { tenders.splice(0, tenders.length, { account_id: defaultAcc, amount: 0, reference: '' }); paintTenders(); paintSummary(); } }, t('Full due')) : null);

    // Customer can be chosen right here — needed for selling on due.
    const payCustomer = h('div', { class: 'pay-customer' });
    const setPayCustomer = (c) => { cart.customer = c; paintCustomer(); paintPayCustomer(); paintQuick(); paintSummary(); };
    const paintPayCustomer = () => {
      if (cart.customer) {
        mount(payCustomer, h('div', { class: 'picked' }, icon('customers', 18),
          h('div', {}, h('strong', {}, cart.customer.name), h('small', { class: 'muted' }, ` ${cart.customer.phone || ''}`),
            dec(cart.customer.balance) > 0 ? h('small', { class: 'warn-text' }, ` · ${t('Previous due')} ${money(cart.customer.balance)}`) : null),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Remove customer'), onclick: () => setPayCustomer(null) }, icon('x', 16))));
      } else {
        const picker = makeCustomerPicker(setPayCustomer);
        mount(payCustomer, h('div', { class: 'row' }, picker.el,
          can('customers.create') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => quickCustomer(setPayCustomer) }, icon('plus', 14), t('New customer')) : null));
      }
    };

    const paintSummary = () => {
      const paid = tenders.reduce((a, x) => a + x.amount, 0);
      const due = total - paid;
      const change = given > paid ? given - paid : 0;
      mount(summary,
        h('div', { class: 'tl grand' }, h('span', {}, t('Total')), h('strong', {}, money(str(total)))),
        h('div', { class: 'tl' }, h('span', {}, t('Paying')), h('span', {}, money(str(paid)))),
        due > 0 ? h('div', { class: `tl ${cart.customer ? 'warn-text' : 'bad-text'}` }, h('span', {}, t('Due')), h('strong', {}, money(str(due)))) : null,
        due < 0 ? h('div', { class: 'tl bad-text' }, h('span', {}, t('Over by')), h('strong', {}, money(str(-due)))) : null,
        change ? h('div', { class: 'tl ok-text' }, h('span', {}, t('Change to return')), h('strong', { class: 'big' }, money(str(change)))) : null,
        due > 0 && !cart.customer ? h('p', { class: 'bad-text' }, t('Select a customer above to sell on due.')) : null);
      confirmBtn.disabled = due < 0 || (due > 0 && !cart.customer);
    };

    const printToggle = h('input', { type: 'checkbox', checked: !!S['pos.auto_print'] });
    const confirmBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => complete(tenders, given, printToggle.checked, m) }, icon('check'), t('Complete sale'));
    const m = modal({
      title: t('Payment'),
      body: h('div', { class: 'pay' }, summary, h('div', { class: 'field' }, h('label', {}, t('Customer')), payCustomer), linesEl, quick, field(t('Cash received'), givenInput, { hint: t('Optional — shows the change to give back') }),
        h('label', { class: 'check' }, printToggle, h('span', {}, t('Print receipt')))),
      actions: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, t('Back')), confirmBtn],
    });
    paintPayCustomer();
    paintQuick();
    paintTenders();
    paintSummary();
  }

  async function complete(tenders, given, print, m) {
    const body = {
      ...payload(),
      uuid: uuid(),
      payments: tenders.filter((x) => x.amount > 0).map((x) => ({ account_id: x.account_id, amount: str(x.amount), reference: x.reference })),
      meta: given ? { tendered: str(given) } : {},
    };
    m.dialog.querySelector('.btn-primary').disabled = true;
    try {
      const sale = cart.heldId ? await api.post(`sales/${cart.heldId}/complete`, body) : await api.post('sales', body);
      m.close();
      done(sale, print);
    } catch (err) {
      m.dialog.querySelector('.btn-primary').disabled = false;
      if (err.offline && !cart.heldId) {
        await queueSale(body);
        m.close();
        toast(t('Offline: sale saved on this device and will sync automatically.'), 'success', 6000);
        reset();
      } else {
        showError(err);
      }
    }
  }

  function done(sale, print) {
    if (print) printSale(sale).catch(() => {});
    reset();
    refreshSnapshot();
    loadCatalogue();
    const m = modal({
      title: t('Sale complete'),
      size: 'sm',
      body: h('div', { class: 'done' },
        icon('check', 48, 'ok-text'),
        h('h3', {}, sale.number),
        h('p', {}, money(sale.total), Number(sale.due_amount) > 0 ? h('span', { class: 'warn-text' }, ` · ${t('Due')} ${money(sale.due_amount)}`) : null),
        sale.meta?.tendered ? h('p', { class: 'ok-text big' }, t('Change'), ': ', money(String(Math.max(0, Number(sale.meta.tendered) - Number(sale.paid_amount))))) : null),
      actions: [
        h('button', { class: 'btn', type: 'button', onclick: () => printSale(sale) }, icon('printer', 16), t('Receipt')),
        h('button', { class: 'btn', type: 'button', onclick: () => openPrint('sale', sale.id, { paper: 'a4' }) }, t('A4 invoice')),
        sale.customer?.phone ? h('a', { class: 'btn wa-btn', href: whatsappUrl(sale.customer.phone, billText(sale)), target: '_blank', rel: 'noopener' }, t('Send bill on WhatsApp')) : null,
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => m.close() }, t('New sale')),
      ],
    });
  }

  /** Short bill for WhatsApp: items, total, paid and due. */
  function billText(sale) {
    const shop = state.business?.name || '';
    const lines = (sale.items || []).map((i) => `• ${i.name} × ${fmtQty(i.qty)} = ${money(i.total ?? i.net_amount ?? 0)}`);
    return [
      `${shop} — ${t('Invoice')} ${sale.number}`,
      ...lines,
      `${t('Total')}: ${money(sale.total)}`,
      `${t('Paid')}: ${money(sale.paid_amount)}`,
      Number(sale.due_amount) > 0 ? `${t('Due')}: ${money(sale.due_amount)}` : null,
      t('Thank you for shopping with us!'),
    ].filter(Boolean).join('\n');
  }

  function reset(clearHeld = true) {
    cart.lines = [];
    cart.customer = null;
    cart.discount = 0;
    cart.shipping = 0;
    cart.note = '';
    if (clearHeld) cart.heldId = null;
    openCart(false);
    quote = null;
    paintCustomer();
    paintCart();
    if (matchMedia('(min-width: 900px)').matches) search.input.focus(); // don't pop the phone keyboard
  }

  /* ---------------------------------------------------------- Layout */

  const payBtn = h('button', { class: 'btn btn-primary btn-lg pay-btn', type: 'button', onclick: pay }, icon('cash'), h('span', {}, t('Pay')));
  const holdBtn = h('button', { class: 'btn', type: 'button', onclick: hold, title: 'F8' }, icon('pause', 16), t('Hold'));

  // Phones: a sticky cart bar; tapping it opens the cart as a full-screen sheet.
  const barCount = h('span', { class: 'cart-count' }, '0');
  const barTotal = h('strong', {}, money('0'));
  const cartBar = h('div', { class: 'cart-bar' },
    h('button', { class: 'cart-bar-open', type: 'button', onclick: () => openCart(true) }, icon('pos', 20), barCount, h('span', {}, t('View cart')), barTotal),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: pay }, t('Pay')));
  function paintBar(total) {
    const n = cart.lines.length;
    barCount.textContent = String(n);
    barTotal.textContent = money(str(total));
    cartBar.classList.toggle('empty', !n);
  }
  function bump() {
    cartBar.classList.remove('bump');
    void cartBar.offsetWidth; // restart the animation
    cartBar.classList.add('bump');
  }
  function openCart(open) {
    layout.classList.toggle('cart-open', open);
  }

  const layout = h('div', { class: 'pos' },
    h('section', { class: 'pos-left', 'aria-label': t('Products') },
      h('div', { class: 'pos-search' },
        h('a', { class: 'icon-btn', href: '#/', 'aria-label': t('Exit POS') }, icon('back')),
        search.el,
        cameraSupported() ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Scan with camera'), onclick: async () => { const c = await scanWithCamera(); if (c) byCode(c); } }, icon('camera')) : null),
      chips,
      grid),
    cartBar,
    h('aside', { class: 'pos-right', 'aria-label': t('Cart') },
      h('div', { class: 'cart-sheet-head' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Back to products'), onclick: () => openCart(false) }, icon('back')),
        h('strong', {}, t('Cart')),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openCart(false) }, icon('plus', 14), t('Add more'))),
      customerBox,
      cartBody,
      totalsEl,
      h('div', { class: 'pos-actions' },
        holdBtn,
        h('button', { class: 'btn', type: 'button', onclick: showHeld }, t('Held')),
        h('button', { class: 'btn', type: 'button', onclick: async () => { if (!cart.lines.length || await confirmDialog(t('Clear the cart?'), { danger: true, confirmText: t('Clear') })) reset(); } }, t('Clear')),
        payBtn)));

  mount(el, layout);
  paintChips();
  paintCustomer();
  paintCart();
  await loadCatalogue();

  const offScan = onScan((code) => byCode(code));
  const keys = (e) => {
    if (!document.body.contains(layout)) { document.removeEventListener('keydown', keys); offScan(); return; }
    if (e.key === 'F2') { e.preventDefault(); search.input.focus(); }
    if (e.key === 'F4') { e.preventDefault(); pay(); }
    if (e.key === 'F8') { e.preventDefault(); hold(); }
  };
  document.addEventListener('keydown', keys);
  window.addEventListener('hashchange', () => { offScan(); document.removeEventListener('keydown', keys); }, { once: true });
  void navigate; // reserved for deep links (e.g. #/pos?customer=)
}
