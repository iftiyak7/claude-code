/**
 * Online orders (Facebook / WhatsApp / website…) and courier delivery.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can, state } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, qty as fmtQty, date, datetime, dec, str, places } from '../core/format.js';
import { page, card, stat, dataTable, badge, select, input, textarea, field, combobox, money_input, modal, toast, showError, showFieldErrors, values, confirmDialog, simpleTable, spinner, empty } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';

const STATUS = {
  pending: ['info', 'New'], confirmed: ['held', 'Confirmed'], packed: ['held', 'Packed'], shipped: ['partial', 'With courier'],
  delivered: ['paid', 'Delivered'], returned: ['due', 'Returned'], cancelled: ['void', 'Cancelled'],
};
const SOURCES = { facebook: 'Facebook', whatsapp: 'WhatsApp', instagram: 'Instagram', website: 'Website', phone: 'Phone call', daraz: 'Daraz', other: 'Other' };
const statusBadge = (o) => badge(STATUS[o.status]?.[0] || 'info', t(STATUS[o.status]?.[1] || o.status));

let courierCfg = null;
async function courier() {
  if (!courierCfg) courierCfg = await api.get('orders/courier');
  return courierCfg;
}

export default async function orders(el, params, query) {
  if (!can('orders.view')) { mount(el, empty(t('You do not have access to this page.'))); return; }
  if (params.id === 'new' || location.hash.startsWith('#/orders/new')) return form(el);
  if (params.id) return detail(el, Number(params.id));
  return list(el, query);
}

/* ------------------------------------------------------------------ List */

async function list(el, query) {
  const cfg = await courier();
  const tab = query.status || 'active';
  const p = page(t('Online orders'), {
    subtitle: t('Facebook, WhatsApp and phone orders — from order to courier to cash.'),
    actions: [
      can('settings.manage') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => courierSettings(() => orders(el, {}, query)) }, icon('settings', 16), t('Courier settings')) : null,
      can('orders.manage') ? h('a', { class: 'btn btn-primary btn-sm', href: '#/orders/new' }, icon('plus', 16), t('New order')) : null,
    ],
  });
  const tabsEl = h('div', { class: 'status-pills' });
  const codBox = h('div', { class: 'stats' });
  p.body.append(codBox, tabsEl);

  const paintSummary = (s) => {
    const c = s.counts;
    const active = c.pending + c.confirmed + c.packed + c.shipped;
    mount(tabsEl, [['active', t('In progress'), active], ['pending', t('New'), c.pending], ['confirmed', t('Confirmed'), c.confirmed], ['packed', t('Packed'), c.packed], ['shipped', t('With courier'), c.shipped], ['delivered', t('Delivered'), c.delivered], ['returned', t('Returned'), c.returned], ['cancelled', t('Cancelled'), c.cancelled], ['all', t('All'), null]]
      .map(([k, label, n]) => h('a', { class: `pill ${k === tab ? 'on' : ''}`, href: `#/orders?status=${k}` }, label, n !== null ? h('span', {}, String(n)) : null)));
    mount(codBox,
      stat(t('New orders'), String(c.pending), { tone: c.pending ? 'warn' : '', onclick: () => navigate('/orders?status=pending') }),
      stat(t('Ready to ship'), String(c.confirmed + c.packed), { onclick: () => navigate('/orders?status=confirmed') }),
      stat(t('With courier'), String(c.shipped), { onclick: () => navigate('/orders?status=shipped') }),
      stat(t('COD to collect'), money(s.cod_pending.amount), { tone: Number(s.cod_pending.amount) ? 'ok' : '', hint: t('{n} orders', { n: s.cod_pending.orders }), onclick: can('orders.manage') && s.cod_pending.orders ? () => collectCod(() => orders(el, {}, query)) : null }));
  };

  const table = dataTable({
    query: { ...query, status: tab },
    searchPlaceholder: t('Order no., name, phone or tracking'),
    filters: [
      { control: select('source', [['', t('All sources')], ...Object.entries(SOURCES).map(([k, v]) => [k, t(v)])], '', { 'aria-label': t('Source') }) },
      { control: select('courier', [['', t('All couriers')], ...Object.entries(cfg.couriers).map(([k, v]) => [k, t(v)])], '', { 'aria-label': t('Courier') }) },
      { control: input('from', '', { type: 'date', 'aria-label': t('From') }) },
      { control: input('to', '', { type: 'date', 'aria-label': t('To') }) },
    ],
    fetch: async (q) => { const r = await api.get('orders', { ...q, status: tab }); paintSummary(r.summary); return r; },
    rowHref: (o) => `/orders/${o.id}`,
    emptyText: t('No orders here yet.'),
    columns: [
      { label: t('Order'), render: (o) => h('span', { class: 'cell-stack' }, h('strong', {}, o.number), h('small', { class: 'muted' }, `${date(o.order_date)} · ${t(SOURCES[o.source] || o.source)}`)) },
      { label: t('Customer'), render: (o) => h('span', { class: 'cell-stack' }, h('span', {}, o.customer_name), h('small', { class: 'muted' }, [o.phone, o.area].filter(Boolean).join(' · '))) },
      { label: t('COD'), align: 'right', render: (o) => h('span', { class: 'cell-stack' }, h('strong', {}, money(o.cod_amount)), Number(o.advance) ? h('small', { class: 'muted' }, `${t('Advance')} ${money(o.advance)}`) : null) },
      { label: t('Courier'), hide: 'sm', render: (o) => (o.courier ? h('span', { class: 'cell-stack' }, t(o.courier_name), o.tracking_url ? h('a', { href: o.tracking_url, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, o.tracking_code || o.consignment_id) : h('small', { class: 'muted' }, o.consignment_id || '')) : '—') },
      { label: t('Status'), render: (o) => h('span', { class: 'cell-stack' }, statusBadge(o), o.cod_collected ? h('small', { class: 'ok-text' }, t('COD collected')) : null) },
      { label: '', render: (o) => nextButton(o, () => table.reload()) },
    ],
  });
  p.body.append(table.el);
  mount(el, p.el);
}

/** The one obvious next step for an order, right in the list. */
function nextButton(o, done) {
  if (!can('orders.manage')) return '';
  const btn = (label, fn, primary = false) => h('button', { class: `btn btn-sm ${primary ? 'btn-primary' : ''}`, type: 'button', onclick: async (e) => {
    e.stopPropagation();
    const b = e.currentTarget; b.disabled = true;
    try { await fn(); done(); } catch (err) { showError(err); } finally { b.disabled = false; }
  } }, label);
  if (o.status === 'pending') return btn(t('Confirm'), () => api.post(`orders/${o.id}/confirm`), true);
  if (o.status === 'confirmed' || o.status === 'packed') return btn(t('Send to courier'), () => ship(o));
  if (o.status === 'shipped') return btn(t('Delivered'), () => api.post(`orders/${o.id}/status`, { status: 'delivered' }));
  return '';
}

/* ------------------------------------------------------------------ Form */

async function form(el) {
  const cfg = await courier();
  const accounts = state.me.payment_accounts;
  const lines = [];
  const p = page(t('New online order'), { back: '/orders' });

  const phone = input('phone', '', { type: 'tel', inputmode: 'tel', required: true, placeholder: '01XXXXXXXXX' });
  const name = input('customer_name', '', { required: true });
  const address = textarea('address', '', { rows: 2, placeholder: t('House, road, area, thana') });
  const area = select('zone', [['inside', t('Inside Dhaka')], ['outside', t('Outside Dhaka')]], 'inside');
  const areaName = input('area', '', { placeholder: t('District / city') });
  const delivery = money_input('delivery_charge', cfg.charge_inside);
  const discount = money_input('discount', '');
  const advance = money_input('advance', '');
  const advAcc = select('advance_account_id', accounts.map((a) => [a.id, a.name]), accounts.find((a) => a.system_key === 'mobile')?.id || '');
  const source = select('source', Object.entries(SOURCES).map(([k, v]) => [k, t(v)]), 'facebook');
  const note = textarea('note', '', { rows: 2, placeholder: t('Size, colour, delivery time…') });
  let customerId = 0;
  const known = h('div', { class: 'muted small' });

  area.addEventListener('change', () => { delivery.value = area.value === 'inside' ? cfg.charge_inside : cfg.charge_outside; paint(); });
  let lookupSeq = 0;
  phone.addEventListener('input', async () => {
    const q = phone.value.replace(/[^0-9]/g, '');
    customerId = 0; mount(known);
    if (q.length < 11) return;
    const mine = ++lookupSeq;
    try {
      const r = await api.get('customers', { search: q, per_page: 1 });
      if (mine !== lookupSeq || !r.items.length) return;
      const c = r.items[0];
      customerId = c.id;
      if (!name.value) name.value = c.name;
      if (!address.value && c.address) address.value = c.address;
      mount(known, icon('check', 14), ` ${t('Existing customer')}: ${c.name}`, dec(c.balance) > 0 ? h('span', { class: 'warn-text' }, ` · ${t('Previous due')} ${money(c.balance)}`) : null);
    } catch { /* ignore */ }
  });

  const linesEl = h('div', { class: 'order-lines' });
  const totalsEl = h('div', { class: 'doc-totals' });
  const picker = combobox({
    placeholder: t('Add product — search or scan'),
    search: async (q) => (await api.get('products', { search: q, per_page: 12 })).items,
    label: (x) => x.name,
    sub: (x) => `${money(x.selling_price)}${x.track_stock ? ' · ' + t('Stock') + ' ' + fmtQty(x.stock_qty) : ''}`,
    onPick: (x) => { addLine(x); picker.clear(); },
  });
  async function addLine(x) {
    if (x.has_variants) {
      const full = await api.get(`products/${x.id}`);
      if (full.variants.length) {
        const m = modal({ title: x.name, size: 'sm', body: h('div', { class: 'variant-list' }, full.variants.map((v) => h('button', { class: 'tile', type: 'button', onclick: () => { m.close(); push(full, v); } }, h('span', { class: 'tile-name' }, v.name), h('span', { class: 'tile-price' }, money(v.selling_price))))) });
        return;
      }
    }
    push(x, null);
  }
  function push(x, v) {
    lines.push({ product_id: x.id, variant_id: v?.id || 0, name: x.name + (v ? ` - ${v.name}` : ''), qty: '1', unit_price: str(dec((v || x).selling_price ?? 0), places()) });
    paint();
  }
  function paint() {
    mount(linesEl, lines.length ? lines.map((l, i) => {
      const q = input(`qty${i}`, l.qty, { inputmode: 'decimal', 'aria-label': t('Qty') });
      const pr = money_input(`price${i}`, l.unit_price, { 'aria-label': t('Price') });
      q.addEventListener('input', () => { l.qty = q.value; paintTotals(); });
      pr.addEventListener('input', () => { l.unit_price = pr.value; paintTotals(); });
      return h('div', { class: 'order-line' }, h('span', { class: 'ol-name' }, l.name), q, pr,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Remove'), onclick: () => { lines.splice(i, 1); paint(); } }, icon('trash', 16)));
    }) : h('p', { class: 'muted' }, t('No items yet — search above or scan a barcode.')));
    paintTotals();
  }
  function paintTotals() {
    const sub = lines.reduce((s, l) => s + Math.round(dec(l.qty) * dec(l.unit_price) / 10000), 0);
    const total = sub - dec(discount.value) + dec(delivery.value);
    const cod = total - dec(advance.value);
    mount(totalsEl,
      h('div', { class: 'tl' }, h('span', {}, t('Subtotal')), h('span', {}, money(str(sub)))),
      dec(discount.value) ? h('div', { class: 'tl' }, h('span', {}, t('Discount')), h('span', {}, `− ${money(str(dec(discount.value)))}`)) : null,
      h('div', { class: 'tl' }, h('span', {}, t('Delivery charge')), h('span', {}, money(str(dec(delivery.value))))),
      h('div', { class: 'tl grand' }, h('span', {}, t('Total')), h('strong', {}, money(str(total)))),
      dec(advance.value) ? h('div', { class: 'tl' }, h('span', {}, t('Advance paid')), h('span', {}, `− ${money(str(dec(advance.value)))}`)) : null,
      h('div', { class: 'tl grand ok-text' }, h('span', {}, t('Collect on delivery (COD)')), h('strong', {}, money(str(cod)))));
  }
  [discount, delivery, advance].forEach((x) => x.addEventListener('input', paintTotals));
  paint();

  const f = h('form', { class: 'form order-form' },
    card(t('Customer'), h('div', { class: 'form-grid' },
      field(t('Phone'), phone, { required: true }),
      field(t('Name'), name, { required: true }),
      field(t('Address'), address, { wide: true }),
      field(t('Delivery area'), area),
      field(t('District / city'), areaName),
      field(t('Order from'), source)), known),
    card(t('Products'), picker.el, linesEl),
    card(t('Payment'), h('div', { class: 'form-grid' },
      field(t('Delivery charge'), delivery),
      field(t('Discount'), discount),
      field(t('Advance paid'), advance, { hint: t('bKash/Nagad advance, if any') }),
      field(t('Advance received in'), advAcc)), totalsEl),
    card(t('Note'), note),
    h('div', { class: 'form-actions sticky-actions' },
      h('button', { class: 'btn', type: 'submit', value: 'save' }, t('Save as new')),
      h('button', { class: 'btn btn-primary', type: 'submit', value: 'confirm' }, icon('check', 16), t('Save & confirm'))));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const confirmIt = e.submitter?.value === 'confirm';
    const v = values(f);
    const body = { customer_id: customerId, customer_name: v.customer_name, phone: v.phone, address: v.address, area: [v.area, area.value === 'inside' ? t('Inside Dhaka') : ''].filter(Boolean).join(', '), source: v.source, note: v.note,
      delivery_charge: v.delivery_charge, discount: v.discount, advance: v.advance, advance_account_id: v.advance_account_id, items: lines, confirm: confirmIt };
    f.querySelectorAll('[type=submit]').forEach((b) => { b.disabled = true; });
    try {
      const o = await api.post('orders', body);
      toast(confirmIt ? t('Order {n} confirmed', { n: o.number }) : t('Order {n} saved', { n: o.number }));
      navigate(`/orders/${o.id}`);
    } catch (err) { showFieldErrors(f, err.errors); showError(err); } finally { f.querySelectorAll('[type=submit]').forEach((b) => { b.disabled = false; }); }
  });
  p.body.append(f);
  mount(el, p.el);
  phone.focus();
}

/* ---------------------------------------------------------------- Detail */

async function detail(el, id) {
  mount(el, spinner());
  const o = await api.get(`orders/${id}`);
  const reload = () => detail(el, id);
  const run = (fn, msg) => async (e) => {
    const b = e?.currentTarget; if (b) b.disabled = true;
    try { await fn(); if (msg) toast(msg); reload(); } catch (err) { showError(err); if (b) b.disabled = false; }
  };
  const m = can('orders.manage');
  const open = ['pending', 'confirmed', 'packed'].includes(o.status);
  const actions = [];
  if (m && o.status === 'pending') actions.push(h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: run(() => api.post(`orders/${id}/confirm`), t('Confirmed — stock and accounts updated')) }, icon('check', 16), t('Confirm order')));
  if (m && o.status === 'confirmed') actions.push(h('button', { class: 'btn btn-sm', type: 'button', onclick: run(() => api.post(`orders/${id}/status`, { status: 'packed' }), t('Marked packed')) }, t('Mark packed')));
  if (m && open) actions.push(h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => { try { await ship(o); reload(); } catch (err) { showError(err); } } }, icon('purchases', 16), t('Send to courier')));
  if (o.status === 'shipped' && o.courier === 'steadfast' && o.consignment_id) actions.push(h('button', { class: 'btn btn-sm', type: 'button', onclick: run(() => api.post(`orders/${id}/track`), t('Tracking updated')) }, t('Check delivery status')));
  if (m && o.status === 'shipped') actions.push(h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: run(() => api.post(`orders/${id}/status`, { status: 'delivered' }), t('Marked delivered')) }, t('Delivered')));
  if (m && ['shipped', 'delivered'].includes(o.status) && !o.cod_collected && Number(o.cod_amount)) actions.push(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => collectCod(reload, [o.id]) }, icon('cash', 16), t('COD received')));
  if (m && (open || (o.status === 'shipped' && !o.cod_collected))) {
    const returning = o.status === 'shipped';
    actions.push(h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', onclick: () => closeOrder(o, returning ? 'returned' : 'cancelled', reload) }, returning ? t('Returned') : t('Cancel order')));
  }
  if (o.sale_id && can('sales.view')) actions.push(h('a', { class: 'btn btn-sm', href: `#/sales/${o.sale_id}` }, icon('printer', 16), t('Invoice')));

  const steps = ['pending', 'confirmed', 'packed', 'shipped', 'delivered'];
  const at = steps.indexOf(o.status);
  const timeline = ['returned', 'cancelled'].includes(o.status)
    ? h('div', { class: 'order-steps closed' }, statusBadge(o))
    : h('ol', { class: 'order-steps' }, steps.map((s, i) => h('li', { class: i < at ? 'done' : i === at ? 'now' : '' }, h('span', {}, String(i + 1)), t(STATUS[s][1]))));

  const parcel = [o.customer_name, o.phone, [o.address, o.area].filter(Boolean).join(', '), `${t('COD')}: ${dec(o.cod_amount) / 10000}`, o.note].filter(Boolean).join('\n');
  const p = page(o.number, { back: '/orders', subtitle: `${date(o.order_date)} · ${t(SOURCES[o.source] || o.source)}`, actions });
  p.body.append(...[
    timeline,
    h('div', { class: 'grid-2' },
      card(t('Customer'),
        h('p', {}, h('strong', {}, o.customer_name), h('br'), h('a', { href: `tel:${o.phone}` }, o.phone), h('br'), [o.address, o.area].filter(Boolean).join(', ')),
        o.customer_id && can('customers.view') ? h('a', { href: `#/customers/${o.customer_id}` }, t('Customer history')) : null,
        h('div', { class: 'row wrap' },
          h('a', { class: 'btn btn-sm', href: `https://wa.me/${o.phone.replace(/[^0-9]/g, '').replace(/^0/, '880')}`, target: '_blank', rel: 'noopener' }, 'WhatsApp'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(parcel); toast(t('Copied')); } catch { /* ignore */ } } }, t('Copy parcel details')))),
      card(t('Delivery'),
        h('dl', { class: 'kv' },
          h('dt', {}, t('Courier')), h('dd', {}, o.courier ? t(o.courier_name) : '—'),
          h('dt', {}, t('Consignment')), h('dd', {}, o.consignment_id || '—'),
          h('dt', {}, t('Tracking')), h('dd', {}, o.tracking_url ? h('a', { href: o.tracking_url, target: '_blank', rel: 'noopener' }, o.tracking_code || o.consignment_id) : (o.tracking_code || '—')),
          o.courier_status ? [h('dt', {}, t('Courier status')), h('dd', {}, o.courier_status.replace(/_/g, ' '))] : null,
          h('dt', {}, t('COD')), h('dd', {}, h('strong', {}, money(o.cod_amount)), o.cod_collected ? h('span', { class: 'ok-text' }, ` · ${t('COD collected')}`) : null),
          Number(o.courier_fee) ? [h('dt', {}, t('Courier charge')), h('dd', {}, money(o.courier_fee))] : null,
          o.shipped_at ? [h('dt', {}, t('Sent')), h('dd', {}, datetime(o.shipped_at))] : null,
          o.delivered_at ? [h('dt', {}, t('Delivered')), h('dd', {}, datetime(o.delivered_at))] : null))),
    card(t('Products'), simpleTable([
      { label: t('Product'), key: 'name' },
      { label: t('Qty'), align: 'right', render: (l) => fmtQty(l.qty) },
      { label: t('Price'), align: 'right', render: (l) => money(l.unit_price) },
      { label: t('Total'), align: 'right', render: (l) => money(l.total) },
    ], o.items),
    h('div', { class: 'doc-totals' },
      h('div', { class: 'tl' }, h('span', {}, t('Subtotal')), h('span', {}, money(o.subtotal))),
      Number(o.discount) ? h('div', { class: 'tl' }, h('span', {}, t('Discount')), h('span', {}, `− ${money(o.discount)}`)) : null,
      h('div', { class: 'tl' }, h('span', {}, t('Delivery charge')), h('span', {}, money(o.delivery_charge))),
      h('div', { class: 'tl grand' }, h('span', {}, t('Total')), h('strong', {}, money(o.total))),
      Number(o.advance) ? h('div', { class: 'tl' }, h('span', {}, t('Advance paid')), h('span', {}, `− ${money(o.advance)}`)) : null)),
    o.note ? card(t('Note'), h('p', { class: 'pre' }, o.note)) : null,
    o.sale ? card(t('Invoice'), h('p', {}, h('a', { href: `#/sales/${o.sale.id}` }, o.sale.number), ` · ${t('Due')} ${money(o.sale.due_amount)}`, o.sale.status === 'void' ? h('span', { class: 'bad-text' }, ` · ${t('Voided')}`) : null)) : null,
  ].filter(Boolean));
  if (o.status === 'pending') p.body.append(h('p', { class: 'muted small' }, t('A new order does not change stock or accounts. Confirming it creates the sale.')));
  mount(el, p.el);
}

/* ---------------------------------------------------------------- Dialogs */

/** Book with Steadfast, or enter another courier's tracking by hand. */
function ship(o) {
  return new Promise((resolve, reject) => {
    courier().then((cfg) => {
      const sel = select('courier', Object.entries(cfg.couriers).map(([k, v]) => [k, t(v)]), o.courier || cfg.default_courier);
      const cons = input('consignment_id', o.consignment_id || '', { placeholder: t('Consignment / parcel ID') });
      const track = input('tracking_code', o.tracking_code || '', { placeholder: t('Tracking code (optional)') });
      const auto = h('div', { class: 'ship-auto' });
      const manual = h('div', { class: 'form-grid' }, field(t('Consignment ID'), cons), field(t('Tracking code'), track));
      const paint = () => {
        const sf = sel.value === 'steadfast' && cfg.steadfast_connected;
        manual.hidden = sf;
        mount(auto, sf ? h('p', { class: 'ok-text' }, icon('check', 16), ' ', t('The parcel will be booked on your Steadfast account automatically (COD {x}).', { x: money(o.cod_amount) }))
          : sel.value === 'steadfast' ? h('p', { class: 'muted small' }, t('Tip: add your Steadfast API key in Courier settings to book parcels in one click.')) : null);
      };
      sel.addEventListener('change', paint);
      paint();
      let settled = false;
      const m = modal({
        title: t('Send to courier'), size: 'sm',
        body: h('div', { class: 'form' }, field(t('Courier'), sel), auto, manual),
        onClose: () => { if (!settled) resolve(null); },
        actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try {
            const r = sel.value === 'steadfast' && cfg.steadfast_connected
              ? await api.post(`orders/${o.id}/steadfast`)
              : await api.post(`orders/${o.id}/status`, { status: 'shipped', courier: sel.value, consignment_id: cons.value, tracking_code: track.value });
            settled = true; m.close();
            toast(r.booked ? t('Booked with Steadfast · {c}', { c: r.consignment_id }) : t('Marked as sent to courier'));
            resolve(r);
          } catch (err) { b.disabled = false; showError(err); }
        } }, t('Send'))],
      });
    }, reject);
  });
}

function closeOrder(o, status, done) {
  const accounts = state.me.payment_accounts;
  const reason = input('reason', '', { placeholder: status === 'returned' ? t('e.g. Customer did not receive') : t('e.g. Customer cancelled') });
  const charge = money_input('return_charge', '');
  const acc = select('account_id', accounts.map((a) => [a.id, a.name]), accounts.find((a) => a.system_key === 'cash')?.id || '');
  const m = modal({
    title: status === 'returned' ? t('Parcel returned') : t('Cancel order'), size: 'sm',
    body: h('div', { class: 'form' },
      h('p', {}, o.sale_id ? t('The sale will be voided and the products go back into stock.') : t('Nothing was sold yet, so stock and accounts do not change.')),
      field(t('Reason'), reason),
      status === 'returned' ? field(t('Return charge paid to courier'), charge, { hint: t('Recorded as a delivery expense') }) : null,
      status === 'returned' ? field(t('Paid from'), acc) : null),
    actions: [h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
      try { await api.post(`orders/${o.id}/close`, { status, reason: reason.value, return_charge: charge.value, account_id: acc.value }); m.close(); toast(status === 'returned' ? t('Marked returned — stock is back') : t('Order cancelled')); done(); } catch (err) { showError(err); }
    } }, status === 'returned' ? t('Mark returned') : t('Cancel order'))],
  });
}

/** Courier paid out the COD: tick the orders, enter each courier charge. */
async function collectCod(done, only = null) {
  const res = await api.get('orders', { cod: 1, per_page: 200, status: 'all' });
  const items = only ? res.items.filter((o) => only.includes(o.id)) : res.items;
  if (!items.length) { toast(t('Nothing to collect.'), 'info'); return; }
  const accounts = state.me.payment_accounts;
  const acc = select('account_id', accounts.map((a) => [a.id, a.name]), accounts.find((a) => a.system_key === 'bank')?.id || accounts[0]?.id);
  const ref = input('reference', '', { placeholder: t('Payment / invoice ID from courier') });
  const picked = new Map(items.map((o) => [o.id, { on: true, fee: '' }]));
  const sum = h('div', { class: 'doc-totals' });
  const paint = () => {
    let cod = 0; let fees = 0;
    picked.forEach((v, k) => { if (v.on) { cod += dec(items.find((o) => o.id === k).cod_amount); fees += dec(v.fee); } });
    mount(sum, h('div', { class: 'tl' }, h('span', {}, t('COD total')), h('span', {}, money(str(cod)))),
      h('div', { class: 'tl' }, h('span', {}, t('Courier charges')), h('span', {}, `− ${money(str(fees))}`)),
      h('div', { class: 'tl grand' }, h('span', {}, t('You receive')), h('strong', {}, money(str(cod - fees)))));
  };
  const rows = items.map((o) => {
    const box = h('input', { type: 'checkbox', checked: true });
    const fee = money_input(`fee${o.id}`, '', { placeholder: t('Charge'), 'aria-label': t('Courier charge') });
    box.addEventListener('change', () => { picked.get(o.id).on = box.checked; paint(); });
    fee.addEventListener('input', () => { picked.get(o.id).fee = fee.value; paint(); });
    return h('div', { class: 'cod-row' }, h('label', { class: 'check' }, box, h('span', { class: 'cell-stack' }, h('strong', {}, `${o.number} · ${money(o.cod_amount)}`), h('small', { class: 'muted' }, `${o.customer_name} · ${o.consignment_id || o.tracking_code || ''}`))), fee);
  });
  paint();
  const m = modal({
    title: t('COD received from courier'), size: 'lg',
    body: h('div', { class: 'form' }, h('div', { class: 'cod-list' }, rows), h('div', { class: 'form-grid' }, field(t('Received in'), acc), field(t('Reference'), ref)), sum),
    actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
      const ids = []; const fees = {};
      picked.forEach((v, k) => { if (v.on) { ids.push(k); if (v.fee) fees[k] = v.fee; } });
      if (!ids.length) return;
      e.currentTarget.disabled = true;
      try {
        const r = await api.post('orders/cod', { ids, fees, account_id: acc.value, reference: ref.value });
        m.close(); toast(t('{n} orders paid · {x} received', { n: r.orders, x: money(r.amount) })); done();
      } catch (err) { e.currentTarget.disabled = false; showError(err); }
    } }, icon('check', 16), t('Save'))],
  });
}

async function courierSettings(done) {
  const cfg = await api.get('orders/courier');
  const f = h('form', { class: 'form' },
    h('h4', {}, 'Steadfast Courier'),
    h('p', { class: 'muted small' }, t('Find the API key and secret in your Steadfast merchant panel → API. With them, parcels are booked in one click and delivery status updates automatically.')),
    h('div', { class: 'form-grid' },
      field(t('API key'), input('steadfast_key', cfg.steadfast_key, { autocomplete: 'off' })),
      field(t('Secret key'), input('steadfast_secret', cfg.steadfast_connected ? '••••••••' : '', { type: 'password', autocomplete: 'new-password' }))),
    cfg.steadfast_connected ? h('p', { class: 'ok-text' }, icon('check', 14), ' ', t('Connected')) : null,
    h('h4', {}, t('Delivery charges')),
    h('div', { class: 'form-grid' },
      field(t('Inside Dhaka'), money_input('charge_inside', cfg.charge_inside)),
      field(t('Outside Dhaka'), money_input('charge_outside', cfg.charge_outside)),
      field(t('Default courier'), select('default_courier', Object.entries(cfg.couriers).map(([k, v]) => [k, t(v)]), cfg.default_courier))));
  const save = (test) => async () => {
    try {
      const r = await api.put('orders/courier', { ...values(f), test });
      courierCfg = null;
      toast(test && r.steadfast_balance !== undefined ? t('Connected · Steadfast balance {x}', { x: r.steadfast_balance }) : t('Saved'));
      m.close(); done();
    } catch (err) { showFieldErrors(f, err.errors); showError(err); }
  };
  const m = modal({ title: t('Courier settings'), body: f, actions: [h('button', { class: 'btn', type: 'button', onclick: save(true) }, t('Save & test')), h('button', { class: 'btn btn-primary', type: 'button', onclick: save(false) }, t('Save'))] });
}
