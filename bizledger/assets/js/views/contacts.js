/**
 * Customers & suppliers: list, profile (history, statement), form.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, date } from '../core/format.js';
import { page, dataTable, card, field, input, textarea, money_input, bindForm, toast, showError, badge, confirmDialog, tabs, simpleTable, checkbox, downloadText, empty, spinner } from '../core/ui.js';
import { icon } from '../core/icons.js';
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
  const table = dataTable({
    query,
    searchPlaceholder: t('Name, phone, ID or email'),
    filters: [
      { control: checkbox('due_only', query.due_only === '1', isCustomer ? t('Only with due') : t('Only with payable')).querySelector('input'), label: isCustomer ? t('With due') : t('With payable') },
      { control: h('select', { class: 'input', name: 'orderby', 'aria-label': t('Sort') }, [['name', t('Name')], ['balance', t('Balance')], ['recent', t('Recent activity')], ['newest', t('Newest')]].map(([v, l]) => h('option', { value: v }, l))) },
    ],
    fetch: (q) => api.get(plural, q),
    rowHref: (r) => `/${plural}/${r.id}`,
    columns: [
      { label: t('Name'), render: (r) => h('span', {}, h('strong', {}, r.name), r.company ? h('small', { class: 'muted' }, ` ${r.company}`) : null) },
      { label: t('ID'), hide: 'sm', key: 'code' },
      { label: t('Phone'), key: 'phone' },
      { label: isCustomer ? t('Due') : t('Payable'), align: 'right', render: (r) => (Number(r.balance) > 0 ? h('strong', { class: 'warn-text' }, money(r.balance)) : Number(r.balance) < 0 ? h('span', { class: 'ok-text' }, t('Advance {x}', { x: money(String(-Number(r.balance))) })) : '—') },
    ],
    footer: (res) => h('div', { class: 'sums' }, h('span', {}, isCustomer ? t('Total receivable') : t('Total payable'), ' ', h('strong', {}, money(res.total_balance)))),
  });
  p.body.append(table.el);
  mount(el, p.el);
}

async function profile(el, type, id, query) {
  const plural = `${type}s`;
  const isCustomer = type === 'customer';
  const c = await api.get(`${plural}/${id}`);
  const reload = () => profile(el, type, id, query);
  let tab = query.tab || 'history';
  const tabBody = h('div');

  const p = page(c.name, {
    back: `/${plural}`,
    subtitle: [c.code, c.phone, c.email].filter(Boolean).join(' · '),
    actions: [
      isCustomer && can('payments.receive') ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => collectPayment(c, { onDone: reload }) }, icon('cash', 16), t('Receive payment')) : null,
      !isCustomer && can('payments.pay') ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => payPurchase(c, { onDone: reload }) }, icon('cash', 16), t('Pay')) : null,
      isCustomer && can('pos.use') ? h('a', { class: 'btn btn-sm', href: '#/pos' }, icon('pos', 16), t('New sale')) : null,
      !isCustomer && can('purchases.create') ? h('a', { class: 'btn btn-sm', href: '#/purchases/new' }, icon('plus', 16), t('New purchase')) : null,
      can('invoices.print') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openPrint('statement', id, { paper: 'a4', autoprint: false, extra: { kind: type } }) }, icon('printer', 16), t('Statement')) : null,
      can(`${plural}.edit`) ? h('a', { class: 'btn btn-sm', href: `#/${plural}/${id}/edit` }, icon('edit', 16), t('Edit')) : null,
    ],
  });

  const sm = c.summary;
  p.body.append(
    h('div', { class: 'stats' },
      h('div', { class: `stat ${Number(c.balance) > 0 ? 'warn' : ''}` }, h('span', { class: 'stat-label' }, isCustomer ? t('Current due') : t('Current payable')), h('strong', { class: 'stat-value' }, money(c.balance))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, isCustomer ? t('Total purchases') : t('Total purchased')), h('strong', { class: 'stat-value' }, money(sm.total_amount)), h('span', { class: 'stat-hint' }, t('{n} invoices', { n: sm.documents }))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Total paid')), h('strong', { class: 'stat-value' }, money(sm.total_paid))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Returns')), h('strong', { class: 'stat-value' }, money(sm.total_returned))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Last activity')), h('strong', {}, sm.last_date ? date(sm.last_date) : '—'))),
    tabs([['history', isCustomer ? t('Sales') : t('Purchases')], ['payments', t('Payments')], ['returns', t('Returns')], ['statement', t('Statement')], ['info', t('Details')]], tab, (k) => { tab = k; paint(); }),
    tabBody);
  mount(el, p.el);

  function paint() {
    p.body.querySelectorAll('.tab').forEach((b, i) => b.classList.toggle('active', ['history', 'payments', 'returns', 'statement', 'info'][i] === tab));
    if (tab === 'history') {
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
      field(isCustomer ? t('Opening due') : t('Opening payable'), money_input('opening_balance', c.opening_balance && Number(c.opening_balance) ? c.opening_balance : ''), { hint: isCustomer ? t('Amount the customer already owed before using BizLedger') : t('Amount you already owed this supplier') }),
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
