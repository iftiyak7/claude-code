/**
 * Customers & suppliers: list, profile (history, statement), form.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can } from '../core/state.js';
import { t, cityName } from '../core/i18n.js';
import { money, date } from '../core/format.js';
import { page, dataTable, card, field, input, textarea, money_input, bindForm, toast, showError, badge, confirmDialog, tabs, simpleTable, checkbox, downloadText, empty, spinner } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { whatsappUrl, reminderText, sendReminderSms } from '../core/remind.js';
import { navigate } from '../core/router.js';
import { openPrint } from '../core/printer.js';
import { collectPayment, payPurchase } from './payments.js';

export default async function contacts(el, params, query) {
  const type = params.contact;
  const plural = `${type}s`;
  const isCustomer = type === 'customer';
  const path = location.hash.split('?')[0];
  if (path.endsWith('/new')) return form(el, type);
  if (path.endsWith('/edit')) return form(el, type, Number(params.id));
  if (params.id) return profile(el, type, Number(params.id), query);

  const p = page(isCustomer ? t('Customers') : t('Suppliers'), {
    actions: [
      can('data.export') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const r = await api.get(`export/${plural}`, query); downloadText(r.filename, r.csv); } }, icon('download', 16), t('Export')) : null,
      can(`${plural}.create`) ? h('a', { class: 'btn btn-primary btn-sm', href: `#/${plural}/new` }, icon('plus', 16), isCustomer ? t('New customer') : t('New supplier')) : null,
    ],
  });
  const zoneSel = h('select', { class: 'input', name: 'zone', 'aria-label': t('Area') }, [['', t('Any area')], ['inside', t('Inside the city')], ['outside', t('Outside the city')]].map(([v, l]) => h('option', { value: v }, l)));
  if (isCustomer && can('orders.view')) {
    api.get('orders/courier').then((cfg) => {
      const city = cityName(cfg.city);
      if (!city) return;
      zoneSel.options[1].textContent = t('Inside {city}', { city });
      zoneSel.options[2].textContent = t('Outside {city}', { city });
    }).catch(() => {});
  }
  const table = dataTable({
    query,
    searchPlaceholder: t('Name, phone, ID or email'),
    filters: [
      { control: checkbox('due_only', query.due_only === '1', isCustomer ? t('Only with due') : t('Only with payable')).querySelector('input'), label: isCustomer ? t('With due') : t('With payable') },
      { control: h('select', { class: 'input', name: 'orderby', 'aria-label': t('Sort') }, [['name', t('Name')], ['bought', isCustomer ? t('Most bought') : t('Most purchased')], ['visits', t('Most visits')], ['balance', t('Balance')], ['recent', t('Recent activity')], ['newest', t('Newest')]].map(([v, l]) => h('option', { value: v }, l))) },
      { control: h('input', { class: 'input input-sm amt-filter', name: 'min_bought', type: 'number', min: 0, inputmode: 'decimal', placeholder: isCustomer ? t('Bought from ৳') : t('Purchased from ৳'), 'aria-label': t('Minimum amount') }) },
      { control: h('input', { class: 'input input-sm amt-filter', name: 'max_bought', type: 'number', min: 0, inputmode: 'decimal', placeholder: t('up to ৳'), 'aria-label': t('Maximum amount') }) },
      { control: h('input', { class: 'input input-sm', name: 'location', type: 'search', placeholder: t('Location (area, district)'), 'aria-label': t('Location') }) },
      ...(isCustomer ? [
        { control: zoneSel },
        { control: h('select', { class: 'input', name: 'channel', 'aria-label': t('Where they buy') }, [['', t('Shop & online')], ['shop', t('Buys in the shop')], ['online', t('Buys online')]].map(([v, l]) => h('option', { value: v }, l))) },
        { control: h('select', { class: 'input', name: 'inactive_days', 'aria-label': t('Not bought for') }, [['', t('Any time')], ['30', t('Not bought for 30 days')], ['60', t('Not bought for 60 days')], ['90', t('Not bought for 90 days')]].map(([v, l]) => h('option', { value: v }, l))) },
      ] : []),
    ],
    fetch: (q) => api.get(plural, q),
    rowHref: (r) => `/${plural}/${r.id}`,
    columns: [
      { label: t('Name'), render: (r) => h('span', { class: 'name-cell' }, avatar(r, 32), h('span', {}, h('strong', {}, r.name), r.company ? h('small', { class: 'muted' }, ` ${r.company}`) : null)) },
      { label: t('ID'), hide: 'sm', key: 'code' },
      { label: t('Phone'), render: (r) => (r.phone ? h('span', { class: 'phone-cell' }, r.phone,
        h('a', { class: 'wa-mini', href: whatsappUrl(r.phone, ''), target: '_blank', rel: 'noopener', title: 'WhatsApp', 'aria-label': 'WhatsApp', onclick: (e) => e.stopPropagation() }, waIcon())) : '—') },
      { label: isCustomer ? t('Total bought') : t('Total purchased'), align: 'right', render: (r) => h('span', { class: 'cell-stack' }, h('strong', {}, money(r.bought)), h('small', { class: 'muted' }, t('{n} times', { n: r.invoices }))) },
      { label: t('Last'), hide: 'sm', render: (r) => (r.last_buy ? date(r.last_buy) : '—') },
      { label: isCustomer ? t('Due') : t('Payable'), align: 'right', render: (r) => (Number(r.balance) > 0 ? h('strong', { class: 'warn-text' }, money(r.balance)) : Number(r.balance) < 0 ? h('span', { class: 'ok-text' }, t('Advance {x}', { x: money(String(-Number(r.balance))) })) : '—') },
    ],
    footer: (res) => h('div', { class: 'sums' },
      h('span', {}, t('{n} found', { n: res.total })),
      h('span', {}, isCustomer ? t('Total bought') : t('Total purchased'), ' ', h('strong', {}, money(res.total_bought))),
      h('span', {}, isCustomer ? t('Total receivable') : t('Total payable'), ' ', h('strong', {}, money(res.total_balance)))),
  });
  p.body.append(table.el);
  mount(el, p.el);
}

async function profile(el, type, id, query) {
  const plural = `${type}s`;
  const isCustomer = type === 'customer';
  const c = await api.get(`${plural}/${id}`);
  const reload = () => profile(el, type, id, query);
  let tab = query.tab || (isCustomer && can('sales.view') ? 'all' : 'history');
  const tabBody = h('div');

  const p = page(c.name, {
    back: `/${plural}`,
    subtitle: [c.code, c.phone, c.email].filter(Boolean).join(' · '),
    actions: [
      isCustomer && can('payments.receive') ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => collectPayment(c, { onDone: reload }) }, icon('cash', 16), t('Receive payment')) : null,
      !isCustomer && can('payments.pay') ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => payPurchase(c, { onDone: reload }) }, icon('cash', 16), t('Pay')) : null,
      isCustomer && c.phone && Number(c.balance) > 0 ? h('a', { class: 'btn btn-sm wa-btn', href: whatsappUrl(c.phone, reminderText(c.name, c.balance)), target: '_blank', rel: 'noopener' }, t('Remind on WhatsApp')) : null,
      isCustomer && c.phone && Number(c.balance) > 0 ? h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => { e.currentTarget.disabled = true; sendReminderSms(c.phone, c.name, c.balance, c.id); } }, t('SMS reminder')) : null,
      isCustomer && can('pos.use') ? h('a', { class: 'btn btn-sm', href: '#/pos' }, icon('pos', 16), t('New sale')) : null,
      !isCustomer && can('purchases.create') ? h('a', { class: 'btn btn-sm', href: '#/purchases/new' }, icon('plus', 16), t('New purchase')) : null,
      can('invoices.print') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openPrint('statement', id, { paper: 'a4', autoprint: false, extra: { kind: type } }) }, icon('printer', 16), t('Statement')) : null,
      can(`${plural}.edit`) ? h('a', { class: 'btn btn-sm', href: `#/${plural}/${id}/edit` }, icon('edit', 16), t('Edit')) : null,
    ],
  });

  const sm = c.summary;
  const canEdit = can(`${plural}.edit`);
  const photoInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    try {
      const up = await api.upload(await shrinkImage(file), 'contact');
      await api.put(`${plural}/${id}`, { image_id: up.id });
      toast(t('Photo saved')); reload();
    } catch (err) { showError(err); }
  });
  p.body.append(h('div', { class: 'profile-head' },
    h('button', { class: 'avatar-btn', type: 'button', title: canEdit ? t('Change photo') : '', disabled: !canEdit, onclick: () => photoInput.click() },
      avatar(c, 72, true), canEdit ? h('span', { class: 'avatar-cam' }, icon('camera', 14)) : null),
    h('div', {}, h('strong', { class: 'profile-name' }, c.name),
      canEdit ? h('div', { class: 'row wrap' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => photoInput.click() }, icon('camera', 14), c.image_id ? t('Change photo') : t('Add photo')),
        c.image_id ? h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', onclick: async () => { try { await api.put(`${plural}/${id}`, { image_id: 0 }); reload(); } catch (err) { showError(err); } } }, t('Remove photo')) : null) : null),
    photoInput));
  if (c.phone) {
    p.body.append(h('div', { class: 'contact-strip' },
      h('span', { class: 'muted' }, c.phone),
      h('a', { class: 'btn btn-sm wa-btn', href: whatsappUrl(c.phone, ''), target: '_blank', rel: 'noopener' }, waIcon(), ' WhatsApp'),
      h('a', { class: 'btn btn-sm', href: `tel:${c.phone}` }, t('Call')),
      c.address ? h('span', { class: 'muted small' }, c.address) : null));
  }
  p.body.append(
    h('div', { class: 'stats' },
      h('div', { class: `stat ${Number(c.balance) > 0 ? 'warn' : ''}` }, h('span', { class: 'stat-label' }, isCustomer ? t('Current due') : t('Current payable')), h('strong', { class: 'stat-value' }, money(c.balance))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, isCustomer ? t('Total purchases') : t('Total purchased')), h('strong', { class: 'stat-value' }, money(sm.total_amount)), h('span', { class: 'stat-hint' }, t('{n} invoices', { n: sm.documents }))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Total paid')), h('strong', { class: 'stat-value' }, money(sm.total_paid))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Returns')), h('strong', { class: 'stat-value' }, money(sm.total_returned))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Last activity')), h('strong', {}, sm.last_date ? date(sm.last_date) : '—'))),
    tabs([...(isCustomer && can('sales.view') ? [['all', t('Full history')]] : []), ['history', isCustomer ? t('Sales') : t('Purchases')], ['payments', t('Payments')], ['returns', t('Returns')], ['statement', t('Statement')], ['info', t('Details')]], tab, (k) => { tab = k; paint(); }),
    tabBody);
  mount(el, p.el);

  function paint() {
    const keys = [...(isCustomer && can('sales.view') ? ['all'] : []), 'history', 'payments', 'returns', 'statement', 'info'];
    p.body.querySelectorAll('.tab').forEach((b, i) => b.classList.toggle('active', keys[i] === tab));
    if (tab === 'all') {
      fullHistory(tabBody, id);
    } else if (tab === 'history') {
      const docs = isCustomer ? 'sales' : 'purchases';
      mount(tabBody, dataTable({
        fetch: (q) => api.get(docs, { ...q, [isCustomer ? 'customer_id' : 'supplier_id']: id, status: 'any' }),
        rowHref: (r) => `/${docs}/${r.id}`,
        columns: [
          { label: t('Number'), render: (r) => h('strong', {}, r.number) },
          { label: t('Date'), render: (r) => date(r.sale_date || r.purchase_date) },
          { label: t('Total'), align: 'right', render: (r) => money(r.total) },
          { label: t('Due'), align: 'right', render: (r) => money(r.due_amount) },
          { label: t('Status'), render: (r) => badge(r.status === 'completed' ? r.payment_status : r.status) },
        ],
      }).el);
    } else if (tab === 'payments') {
      mount(tabBody, dataTable({
        fetch: (q) => api.get('payments', { ...q, contact_id: id }),
        rowHref: (r) => `/payments/${r.id}`,
        columns: [
          { label: t('Number'), key: 'number' },
          { label: t('Date'), render: (r) => date(r.payment_date) },
          { label: t('Account'), key: 'account_name' },
          { label: t('Amount'), align: 'right', render: (r) => (r.direction === 'in' ? '+' : '−') + money(r.amount) },
        ],
      }).el);
    } else if (tab === 'returns') {
      mount(tabBody, dataTable({
        fetch: (q) => api.get('returns', { ...q, contact_id: id, type: isCustomer ? 'sale' : 'purchase' }),
        rowHref: (r) => `/returns/${r.id}`,
        columns: [
          { label: t('Number'), key: 'number' },
          { label: t('Date'), render: (r) => date(r.return_date) },
          { label: t('Against'), key: 'document_number' },
          { label: t('Value'), align: 'right', render: (r) => money(r.total) },
          { label: t('Refunded'), align: 'right', render: (r) => money(r.refund_amount) },
        ],
      }).el);
    } else if (tab === 'statement') {
      statement();
    } else {
      mount(tabBody, card(null, h('dl', { class: 'details' },
        [[t('Company'), c.company], [t('Address'), c.address], [t('Tax ID'), c.tax_number], [t('Opening balance'), money(c.opening_balance)], [t('Credit limit'), Number(c.credit_limit) ? money(c.credit_limit) : t('No limit')], [t('Notes'), c.notes]]
          .filter(([, v]) => v).map(([k, v]) => [h('dt', {}, k), h('dd', { class: 'pre' }, v)]))),
      can(`${plural}.delete`) ? h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: async () => {
        if (!(await confirmDialog(t('Delete {n}? History is kept.', { n: c.name }), { danger: true, confirmText: t('Delete') }))) return;
        try { await api.del(`${plural}/${id}`); toast(t('Deleted')); navigate(`/${plural}`); } catch (err) { showError(err); }
      } }, icon('trash', 16), t('Delete')) : null);
    }
  }

  async function statement() {
    const from = input('from', '', { type: 'date', 'aria-label': t('From') });
    const to = input('to', '', { type: 'date', 'aria-label': t('To') });
    const out = h('div', {}, spinner());
    const load = async () => {
      const s = await api.get(`${plural}/${id}/statement`, { from: from.value, to: to.value });
      mount(out, simpleTable([
        { label: t('Date'), render: (l) => date(l.date) },
        { label: t('Reference'), key: 'reference_no' },
        { label: t('Description'), key: 'description' },
        { label: t('Debit'), align: 'right', render: (l) => (Number(l.debit) ? money(l.debit) : '') },
        { label: t('Credit'), align: 'right', render: (l) => (Number(l.credit) ? money(l.credit) : '') },
        { label: t('Balance'), align: 'right', render: (l) => money(l.balance) },
      ], [{ date: s.from, reference_no: '', description: t('Opening balance'), debit: 0, credit: 0, balance: s.opening_balance }, ...s.lines]),
      h('div', { class: 'doc-totals right' }, h('div', { class: 'tl grand' }, h('span', {}, t('Closing balance')), h('strong', {}, money(s.closing_balance)))));
    };
    from.addEventListener('change', load);
    to.addEventListener('change', load);
    mount(tabBody, card(null, h('div', { class: 'toolbar' }, from, to,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openPrint('statement', id, { paper: 'a4', autoprint: false, extra: { kind: type, from: from.value, to: to.value } }) }, icon('printer', 16), t('Print / PDF'))), out));
    load();
  }
  paint();
}

async function form(el, type, id = 0) {
  const plural = `${type}s`;
  const isCustomer = type === 'customer';
  if (!can(`${plural}.${id ? 'edit' : 'create'}`)) { mount(el, empty(t('You do not have permission for this.'))); return; }
  const c = id ? await api.get(`${plural}/${id}`) : {};
  const f = h('form', { class: 'form' },
    card(null, h('div', { class: 'form-grid' },
      field(t('Name'), input('name', c.name, { required: true, autofocus: true }), { required: true }),
      field(t('Phone'), input('phone', c.phone, { type: 'tel', inputmode: 'tel' })),
      field(t('Email'), input('email', c.email, { type: 'email' })),
      field(t('Company'), input('company', c.company)),
      field(isCustomer ? t('Customer ID') : t('Supplier ID'), input('code', c.code, { placeholder: t('Auto') })),
      field(t('Tax / VAT ID'), input('tax_number', c.tax_number)),
      field(t('Address'), textarea('address', c.address, { rows: 2 }), { wide: true }),
      field(isCustomer ? t('Opening due') : t('Opening payable'), money_input('opening_balance', c.opening_balance && Number(c.opening_balance) ? c.opening_balance : ''), { hint: isCustomer ? t('Amount the customer already owed before using Goriber Hisab') : t('Amount you already owed this supplier') }),
      isCustomer ? field(t('Credit limit'), money_input('credit_limit', c.credit_limit && Number(c.credit_limit) ? c.credit_limit : ''), { hint: t('0 = no limit') }) : null,
      field(t('Notes'), textarea('notes', c.notes, { rows: 2 }), { wide: true }))),
    h('div', { class: 'form-actions sticky' }, h('a', { class: 'btn', href: `#/${plural}${id ? '/' + id : ''}` }, t('Cancel')), h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, t('Save'))));
  bindForm(f, async (v) => {
    const saved = id ? await api.put(`${plural}/${id}`, v) : await api.post(plural, v);
    navigate(`/${plural}/${saved.id}`);
  });
  const p = page(id ? t('Edit {n}', { n: c.name }) : isCustomer ? t('New customer') : t('New supplier'), { back: `/${plural}` });
  p.body.append(f);
  mount(el, p.el);
}

function waIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 3 3 0 00-.9 2.2 5.2 5.2 0 001.1 2.7 11.8 11.8 0 004.6 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2s.2-1.1.2-1.2-.2-.2-.4-.3z');
  svg.append(path);
  return svg;
}

const SOURCE_LABEL = { facebook: 'Facebook', whatsapp: 'WhatsApp', instagram: 'Instagram', website: 'Website', phone: 'Phone call', daraz: 'Daraz', other: 'Other' };

/** Everything this customer bought: when, where (shop / online, inside / outside the city), what, discounts. */
async function fullHistory(root, id) {
  mount(root, spinner());
  let city = '';
  try { city = cityName((await api.get('orders/courier')).city); } catch { /* no orders access */ }
  const inside = city ? t('Inside {city}', { city }) : t('Inside the city');
  const outside = city ? t('Outside {city}', { city }) : t('Outside the city');
  const H = await api.get(`customers/${id}/history`);
  const S = H.summary;
  const search = h('input', { class: 'input', type: 'search', placeholder: t('Search a product or invoice…') });
  const filter = h('select', { class: 'input', 'aria-label': t('Show') }, [['', t('All purchases')], ['shop', t('In the shop')], ['online', t('Online')], ['inside', inside], ['outside', outside], ['discount', t('With discount')], ['due', t('With due')]].map(([v, l]) => h('option', { value: v }, l)));
  const list = h('div', { class: 'hist-list' });
  const timeOf = (utc) => { if (!utc) return ''; const d = new Date(`${utc.replace(' ', 'T')}Z`); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

  const paintList = () => {
    const q = search.value.trim().toLowerCase();
    const f = filter.value;
    const rows = H.sales.filter((x) => {
      if (f === 'shop' && x.online) return false;
      if (f === 'online' && !x.online) return false;
      if ((f === 'inside' || f === 'outside') && x.zone !== f) return false;
      if (f === 'discount' && !Number(x.discount)) return false;
      if (f === 'due' && !Number(x.due)) return false;
      return !q || x.number.toLowerCase().includes(q) || x.items.some((it) => it.name.toLowerCase().includes(q));
    });
    mount(list, rows.length ? rows.map((x) => h('article', { class: `hist-card ${x.status === 'void' ? 'void' : ''}` },
      h('header', {},
        h('div', {}, h('strong', {}, date(x.date)), ' ', h('span', { class: 'muted small' }, timeOf(x.created_at)), h('br'),
          h('a', { href: `#/sales/${x.id}` }, x.number), x.order_number ? h('a', { class: 'muted small', href: `#/orders/${x.order_id}` }, ` · ${x.order_number}`) : null),
        h('div', { class: 'hist-tags' },
          h('span', { class: `badge ${x.online ? 'badge-info' : 'badge-ok'}` }, x.online ? `${t('Online')}${x.source ? ' · ' + t(SOURCE_LABEL[x.source] || x.source) : ''}` : t('In the shop')),
          x.zone ? h('span', { class: `badge ${x.zone === 'inside' ? 'badge-ok' : 'badge-warn'}` }, x.zone === 'inside' ? inside : outside) : null,
          x.status === 'void' ? badge('void') : null)),
      x.area ? h('p', { class: 'muted small' }, `📍 ${x.area}`) : null,
      h('table', { class: 'hist-items' }, h('tbody', {}, x.items.map((it) => h('tr', {},
        h('td', {}, it.name, Number(it.returned) ? h('small', { class: 'bad-text' }, ` (${t('returned')} ${it.returned.replace(/\.?0+$/, '')})`) : null),
        h('td', { class: 'num muted' }, `${it.qty.replace(/\.?0+$/, '')} × ${money(it.unit_price)}`),
        h('td', { class: 'num' }, Number(it.discount) ? h('small', { class: 'ok-text' }, `-${money(it.discount)} `) : null, money(it.total)))))),
      h('footer', {},
        h('span', {}, t('Total'), ' ', h('strong', {}, money(x.total))),
        Number(x.discount) ? h('span', { class: 'ok-text' }, t('Discount'), ' ', money(x.discount)) : null,
        Number(x.delivery) ? h('span', { class: 'muted' }, t('Delivery'), ' ', money(x.delivery)) : null,
        Number(x.due) ? h('span', { class: 'warn-text' }, t('Due'), ' ', money(x.due)) : h('span', { class: 'ok-text' }, t('Paid'))))) : empty(t('Nothing matches.')));
  };
  search.addEventListener('input', paintList);
  filter.addEventListener('change', paintList);

  mount(root,
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Total bought')), h('strong', { class: 'stat-value' }, money(S.spent)), h('span', { class: 'stat-hint' }, t('{n} times', { n: S.visits }))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Average bill')), h('strong', { class: 'stat-value' }, money(S.average))),
      h('div', { class: 'stat ok' }, h('span', { class: 'stat-label' }, t('Total discount given')), h('strong', { class: 'stat-value' }, money(S.discount))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('In the shop / online')), h('strong', { class: 'stat-value' }, `${S.shop} / ${S.online}`), S.online ? h('span', { class: 'stat-hint' }, `${inside}: ${S.inside} · ${outside}: ${S.outside}`) : null),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('First / last purchase')), h('strong', {}, S.first ? `${date(S.first)} – ${date(S.last)}` : '—'), h('span', { class: 'stat-hint' }, t('Customer since {d}', { d: date(H.customer.since) })))),
    H.favourites.length ? card(t('Buys most often'), h('div', { class: 'fav-chips' }, H.favourites.map((f) => h('a', { class: 'fav-chip', href: `#/products/${f.product_id}` }, h('strong', {}, f.name), h('small', {}, `${f.qty.replace(/\.?0+$/, '')} · ${money(f.amount)} · ${t('{n} times', { n: f.times })}`))))) : null,
    H.orders.length ? card(t('Online orders not yet sold'), simpleTable([
      { label: t('Order'), render: (o) => h('a', { href: `#/orders/${o.id}` }, o.number) },
      { label: t('Date'), render: (o) => date(o.date) },
      { label: t('Status'), render: (o) => badge(o.status) },
      { label: t('Area'), render: (o) => [o.zone === 'inside' ? inside : o.zone === 'outside' ? outside : '', o.area].filter(Boolean).join(' · ') || '—' },
      { label: t('Total'), align: 'right', render: (o) => money(o.total) },
    ], H.orders)) : null,
    card(t('Every purchase'), h('div', { class: 'row wrap hist-tools' }, search, filter), list));
  paintList();
}

/** Photo, or the initials on a colour picked from the name. */
function avatar(c, size = 36, large = false) {
  const url = large ? (c.photo_url || c.image_url) : c.image_url;
  if (url) return h('img', { class: 'avatar', src: url, alt: '', width: size, height: size, loading: 'lazy', style: `width:${size}px;height:${size}px` });
  const initials = String(c.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] || '').join('').toUpperCase();
  let hue = 0;
  for (const ch of String(c.name || '')) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return h('span', { class: 'avatar', style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background:hsl(${hue} 55% 92%);color:hsl(${hue} 55% 30%)` }, initials);
}

/** Phone photos are big: resize to at most 800px before uploading. */
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}
