/**
 * Accounting: chart of accounts with balances, journal, manual entries,
 * account ledgers (cash book / bank book).
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, date, dec, str, today } from '../core/format.js';
import { page, card, tabs, simpleTable, dataTable, field, input, select, money_input, modal, toast, showError, showFieldErrors, values, badge, confirmDialog, dateRange, spinner, empty } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';

const TYPES = [['asset', 'Assets'], ['liability', 'Liabilities'], ['equity', 'Equity'], ['income', 'Income'], ['expense', 'Expenses']];

export default async function accounting(el, params, query) {
  if (!can('accounting.view')) { mount(el, empty(t('You do not have access to accounting.'))); return; }
  const path = location.hash.split('?')[0];
  if (path.startsWith('#/accounting/ledger/')) return ledger(el, Number(params.id), query);
  if (path === '#/accounting/journal/new') return manualEntry(el);
  if (path.startsWith('#/accounting/journal/')) return entry(el, Number(params.id));
  const journal = path === '#/accounting/journal';

  const p = page(t('Accounting'), {
    actions: [
      can('accounting.manage') ? h('a', { class: 'btn btn-sm', href: '#/accounting/journal/new' }, icon('plus', 16), t('Journal entry')) : null,
      can('accounting.manage') ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => accountForm(null, () => accounting(el, params, query)) }, icon('plus', 16), t('New account')) : null,
    ],
  });
  p.body.append(tabs([['coa', t('Chart of accounts')], ['journal', t('Journal')]], journal ? 'journal' : 'coa', (k) => navigate(k === 'coa' ? '/accounting' : '/accounting/journal')));
  mount(el, p.el);

  if (journal) {
    p.body.append(dataTable({
      query,
      filters: [
        { control: select('source', [['', t('All sources')], ['sale', t('Sales')], ['purchase', t('Purchases')], ['payment', t('Payments')], ['expense', t('Expenses')], ['income', t('Income')], ['return', t('Returns')], ['stock_adjustment', t('Stock adjustments')], ['manual', t('Manual')]], '') },
        { control: input('from', '', { type: 'date', 'aria-label': t('From') }) },
        { control: input('to', '', { type: 'date', 'aria-label': t('To') }) },
      ],
      fetch: (q) => api.get('journal', q),
      rowHref: (r) => `/accounting/journal/${r.id}`,
      columns: [
        { label: '#', key: 'id' },
        { label: t('Date'), render: (r) => date(r.entry_date) },
        { label: t('Source'), render: (r) => r.source },
        { label: t('Reference'), key: 'reference_no' },
        { label: t('Memo'), hide: 'sm', key: 'memo' },
        { label: t('Amount'), align: 'right', render: (r) => money(r.total) },
        { label: '', render: (r) => (Number(r.is_reversal) ? badge('void', t('Reversal')) : Number(r.is_reversed) ? badge('void', t('Reversed')) : '') },
      ],
    }).el);
    return;
  }

  const holder = h('div', {}, spinner());
  p.body.append(holder);
  const accounts = await api.get('accounts', { with_balance: 1, include_inactive: 1 });
  mount(holder, TYPES.map(([type, label]) => {
    const rows = accounts.filter((a) => a.type === type);
    const total = rows.reduce((s, a) => s + dec(a.balance) * (a.is_contra ? -1 : 1), 0);
    return card(`${t(label)} · ${money(str(total))}`, simpleTable([
      { label: t('Code'), key: 'code' },
      { label: t('Account'), render: (a) => h('a', { href: `#/accounting/ledger/${a.id}` }, a.name, a.is_payment ? h('small', { class: 'muted' }, ` · ${t(a.subtype)}`) : null, a.status !== 'active' ? h('small', { class: 'muted' }, ` (${t('inactive')})`) : null) },
      { label: t('Balance'), align: 'right', render: (a) => money(a.balance) },
      { label: '', render: (a) => (can('accounting.manage') ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Edit'), onclick: () => accountForm(a, () => accounting(el, params, query)) }, icon('edit', 16)) : '') },
    ], rows));
  }));
}

function accountForm(acc, onDone) {
  const f = h('form', { class: 'form' }, h('div', { class: 'form-grid' },
    field(t('Name'), input('name', acc?.name, { required: true }), { required: true }),
    field(t('Code'), input('code', acc?.code, { placeholder: t('Auto') })),
    !acc ? field(t('Type'), select('type', TYPES.map(([v, l]) => [v, t(l)]), 'asset')) : null,
    !acc ? h('div', { class: 'field' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'is_payment' }), h('span', {}, t('Cash/bank account (can receive and pay money)')))) : null,
    !acc ? field(t('Kind'), select('subtype', [['bank', t('Bank')], ['cash', t('Cash')], ['mobile', t('Mobile banking')], ['other', t('Other')]], 'bank')) : null,
    acc && !acc.is_system ? field(t('Status'), select('status', [['active', t('Active')], ['inactive', t('Inactive')]], acc.status)) : null));
  const m = modal({
    title: acc ? t('Edit account') : t('New account'), body: f,
    actions: [
      acc && !acc.is_system ? h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: async () => {
        if (!(await confirmDialog(t('Delete {n}?', { n: acc.name }), { danger: true }))) return;
        try { await api.del(`accounts/${acc.id}`); m.close(); onDone(); } catch (err) { showError(err); }
      } }, t('Delete')) : null,
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        try { if (acc) await api.put(`accounts/${acc.id}`, values(f)); else await api.post('accounts', values(f)); m.close(); toast(t('Saved')); onDone(); }
        catch (err) { showFieldErrors(f, err.errors || {}); showError(err); }
      } }, t('Save')),
    ],
  });
}

async function ledger(el, id, query) {
  let range = query.from ? { from: query.from, to: query.to } : { range: 'this_month' };
  const out = h('div', {}, spinner());
  const p = page(t('Ledger'), { back: '/accounting', actions: [dateRange((r) => { range = r; load(); })] });
  p.body.append(out);
  mount(el, p.el);
  async function load() {
    const L = await api.get('reports/ledger', { account_id: id, ...range });
    p.el.querySelector('h1').textContent = `${L.account.code} · ${L.account.name}`;
    mount(out,
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Opening')), h('strong', { class: 'stat-value' }, money(L.opening_balance))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Debit')), h('strong', { class: 'stat-value' }, money(L.total_debit))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Credit')), h('strong', { class: 'stat-value' }, money(L.total_credit))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Closing')), h('strong', { class: 'stat-value' }, money(L.closing_balance)))),
      card(null, L.lines.length ? simpleTable([
        { label: t('Date'), render: (r) => date(r.entry_date) },
        { label: t('Reference'), render: (r) => h('a', { href: `#/accounting/journal/${r.entry_id}` }, r.reference_no || `#${r.entry_id}`) },
        { label: t('Description'), render: (r) => [r.memo, r.contact_name].filter(Boolean).join(' · ') },
        { label: t('Debit'), align: 'right', render: (r) => (Number(r.debit) ? money(r.debit) : '') },
        { label: t('Credit'), align: 'right', render: (r) => (Number(r.credit) ? money(r.credit) : '') },
        { label: t('Balance'), align: 'right', render: (r) => money(r.balance) },
      ], L.lines) : empty(t('No transactions in this period.'))));
  }
  load();
}

async function entry(el, id) {
  const e = await api.get(`journal/${id}`);
  const p = page(t('Journal entry #{n}', { n: id }), {
    back: '/accounting/journal',
    subtitle: `${date(e.entry_date)} · ${e.source} · ${e.reference_no || ''}`,
    actions: [e.source === 'manual' && !Number(e.is_reversal) && !Number(e.is_reversed) && can('accounting.manage') ? h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', onclick: async () => {
      if (!(await confirmDialog(t('Void this journal entry?'), { danger: true }))) return;
      try { await api.post(`journal/${id}/void`); toast(t('Voided')); entry(el, id); } catch (err) { showError(err); }
    } }, t('Void')) : null],
  });
  p.body.append(card(e.memo, simpleTable([
    { label: t('Account'), render: (l) => h('a', { href: `#/accounting/ledger/${l.account_id}` }, `${l.account_code} · ${l.account_name}`) },
    { label: t('Memo'), key: 'memo' },
    { label: t('Debit'), align: 'right', render: (l) => (Number(l.debit) ? money(l.debit) : '') },
    { label: t('Credit'), align: 'right', render: (l) => (Number(l.credit) ? money(l.credit) : '') },
  ], e.lines, { totals: { debit: money(e.total), credit: money(e.total) } })));
  if (e.source === 'stock_adjustment' && !Number(e.is_reversal)) p.body.append(await adjustmentCard(id, () => entry(el, id)));
  mount(el, p.el);
}

/** Stock adjustment: profit or stock already in hand, or cancel it. */
async function adjustmentCard(id, reload) {
  let a;
  try { a = await api.get(`stock/adjustments/${id}`); } catch { return h('div'); }
  const label = { gain: t('Counted as a stock gain (adds to profit)'), opening: t('Stock already in hand (not profit)'), loss: t('Stock loss (reduces profit)') }[a.kind];
  const m = can('inventory.adjust') && !a.voided;
  return card(t('Stock adjustment'),
    h('p', {}, h('strong', {}, label), a.qty !== null ? h('span', { class: 'muted' }, ` · ${t('Quantity')}: ${Number(a.qty)}`) : null, ' · ', money(a.amount)),
    a.voided ? h('p', { class: 'bad-text' }, t('This adjustment was cancelled.')) : null,
    m ? h('div', { class: 'row wrap' },
      a.kind === 'gain' ? h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        if (!(await confirmDialog(t('This stock was already in the shop (you forgot to enter it)? It will be removed from profit and booked as opening stock.'), { confirmText: t('Yes, not profit') }))) return;
        try { await api.post(`stock/adjustments/${id}/kind`, { kind: 'opening' }); toast(t('Removed from profit')); reload(); } catch (err) { showError(err); }
      } }, t('It was already in the shop — not profit')) : null,
      a.kind === 'opening' ? h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!(await confirmDialog(t('Count this extra stock as a gain? It will add to profit.'), { confirmText: t('Count as gain') }))) return;
        try { await api.post(`stock/adjustments/${id}/kind`, { kind: 'gain' }); toast(t('Saved')); reload(); } catch (err) { showError(err); }
      } }, t('Count as a gain (profit)')) : null,
      h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: async () => {
        if (!(await confirmDialog(t('Cancel this stock adjustment? The stock goes back to what it was before and the entry is reversed.'), { danger: true, confirmText: t('Yes, continue') }))) return;
        if (!(await confirmDialog(t('Are you sure? This cannot be undone.'), { danger: true, title: t('Last warning'), confirmText: t('Cancel adjustment') }))) return;
        try { await api.post(`stock/adjustments/${id}/void`); toast(t('Adjustment cancelled')); reload(); } catch (err) { showError(err); }
      } }, icon('trash', 16), t('Cancel adjustment'))) : null);
}

async function manualEntry(el) {
  if (!can('accounting.manage')) { mount(el, empty(t('You do not have permission for this.'))); return; }
  const accounts = (await api.get('accounts')).filter((a) => !['inventory', 'receivable', 'payable'].includes(a.system_key));
  const lines = [{ account_id: '', debit: '', credit: '' }, { account_id: '', debit: '', credit: '' }];
  const body = h('tbody');
  const totals = h('div', { class: 'doc-totals right' });
  const paint = () => {
    mount(body, lines.map((l, i) => {
      const acc = h('select', { class: 'input', name: `lines.${i}.account_id` }, [h('option', { value: '' }, t('Choose account…')), ...accounts.map((a) => h('option', { value: a.id, selected: String(a.id) === String(l.account_id) }, `${a.code} · ${a.name}`))]);
      acc.addEventListener('change', () => { l.account_id = acc.value; });
      const dr = money_input(`lines.${i}.debit`, l.debit, { placeholder: '0' });
      const cr = money_input(`lines.${i}.credit`, l.credit, { placeholder: '0' });
      dr.addEventListener('input', () => { l.debit = dr.value; if (dr.value) { cr.value = ''; l.credit = ''; } sum(); });
      cr.addEventListener('input', () => { l.credit = cr.value; if (cr.value) { dr.value = ''; l.debit = ''; } sum(); });
      return h('tr', {}, h('td', { 'data-label': t('Account') }, acc), h('td', { 'data-label': t('Debit') }, dr), h('td', { 'data-label': t('Credit') }, cr),
        h('td', {}, lines.length > 2 ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Remove'), onclick: () => { lines.splice(i, 1); paint(); } }, icon('x', 16)) : null));
    }));
    sum();
  };
  const sum = () => {
    const d = lines.reduce((a, l) => a + dec(l.debit), 0);
    const c = lines.reduce((a, l) => a + dec(l.credit), 0);
    mount(totals, h('div', { class: 'tl' }, h('span', {}, t('Debit')), h('strong', {}, money(str(d)))), h('div', { class: 'tl' }, h('span', {}, t('Credit')), h('strong', {}, money(str(c)))),
      d !== c ? h('p', { class: 'bad-text' }, t('Out of balance by {x}', { x: money(str(Math.abs(d - c))) })) : h('p', { class: 'ok-text' }, t('Balanced')));
  };
  const memo = input('memo', '', { placeholder: t('e.g. Owner invested cash') });
  const dateIn = input('date', today(), { type: 'date' });
  const f = h('form', { class: 'form' },
    card(null, h('div', { class: 'form-grid' }, field(t('Date'), dateIn), field(t('Memo'), memo, { wide: true }))),
    card(t('Lines'), h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, t('Account')), h('th', {}, t('Debit')), h('th', {}, t('Credit')), h('th', {}))), body),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { lines.push({ account_id: '', debit: '', credit: '' }); paint(); } }, icon('plus', 14), t('Add line')), totals,
      h('div', { class: 'field', dataset: { field: 'lines' } }, h('small', { class: 'error' })),
      h('p', { class: 'muted small' }, t('Receivable, payable and inventory are changed through sales, purchases, payments and stock screens so customer, supplier and stock records stay in sync.'))),
    h('div', { class: 'form-actions sticky' }, h('a', { class: 'btn', href: '#/accounting/journal' }, t('Cancel')), h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, t('Post entry'))));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('journal', { date: dateIn.value, memo: memo.value, lines: lines.filter((l) => l.account_id) });
      toast(t('Posted')); navigate(`/accounting/journal/${res.id}`);
    } catch (err) { showFieldErrors(f, err.errors || {}); showError(err); }
  });
  const p = page(t('New journal entry'), { back: '/accounting/journal' });
  p.body.append(f);
  mount(el, p.el);
  paint();
}
