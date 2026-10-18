/**
 * Cash & bank: balances of every money account, and the everyday cash jobs —
 * move money between cash / bKash / bank, owner puts money in or takes it
 * out, other money in or out, and the end-of-day cash count.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, date } from '../core/format.js';
import { page, card, stat, dataTable, select, input, money_input, field, modal, toast, showError, showFieldErrors, values, badge, confirmDialog, empty, spinner } from '../core/ui.js';
import { icon } from '../core/icons.js';

const KINDS = {
  transfer: ['Move money', 'Cash → bKash, bank → cash…', 'refresh'],
  owner_in: ['Owner puts money in', 'Capital from the owner', 'plus'],
  owner_out: ['Owner takes money', 'For personal / family use', 'minus'],
  cash_in: ['Other money in', 'Loan, misc. receipt', 'download'],
  cash_out: ['Other money out', 'Tips, small costs without a bill', 'upload'],
  count: ['Cash count', 'Count the drawer and fix the difference', 'check'],
};

export default async function cash(el) {
  if (!can('cash.manage')) { mount(el, empty(t('You do not have access to this page.'))); return; }
  const reload = () => cash(el);
  const p = page(t('Cash & bank'), { subtitle: t('Hand cash, bKash/Nagad and bank — move money, owner in/out and daily cash count.') });
  p.body.append(spinner());
  mount(el, p.el);
  const o = await api.get('cash');
  const accounts = o.accounts;

  const actions = h('div', { class: 'cash-actions' }, Object.entries(KINDS).map(([k, [label, hint, ic]]) => h('button', { class: `cash-action k-${k}`, type: 'button', onclick: () => moveForm(k, accounts, reload) },
    h('span', { class: 'quick-icon' }, icon(ic, 20)), h('span', {}, h('strong', {}, t(label)), h('small', {}, t(hint))))));

  const balances = h('div', { class: 'stats' },
    stat(t('Total money'), money(o.total), { tone: 'ok', hint: t('In {n} accounts', { n: accounts.length }) }),
    stat(t("Today's money in"), money(o.today_in), { tone: 'ok' }),
    stat(t("Today's money out"), money(o.today_out), { tone: Number(o.today_out) ? 'warn' : '' }),
    ...accounts.map((a) => stat(a.name, money(a.balance), { tone: Number(a.balance) < 0 ? 'bad' : '', onclick: can('accounting.view') ? () => { location.hash = `#/accounting/ledger/${a.id}`; } : null })));

  const table = dataTable({
    query: {},
    filters: [{ control: select('kind', [['', t('All entries')], ...Object.entries(KINDS).map(([k, [label]]) => [k, t(label)])], '') }],
    fetch: (q) => api.get('cash/moves', q),
    emptyText: t('No cash entries yet.'),
    columns: [
      { label: t('Date'), render: (m) => h('span', { class: 'cell-stack' }, h('strong', {}, date(m.date)), h('small', { class: 'muted' }, m.number)) },
      { label: t('Entry'), render: (m) => h('span', { class: 'cell-stack' }, t(KINDS[m.kind]?.[0] || m.kind_label), h('small', { class: 'muted' }, [m.from_name, m.to_name].filter(Boolean).join(' → '))) },
      { label: t('Note'), hide: 'sm', render: (m) => m.note || '—' },
      { label: t('Amount'), align: 'right', render: (m) => h('strong', { class: m.to_account_id && !m.from_account_id ? 'ok-text' : m.from_account_id && !m.to_account_id ? 'bad-text' : '' }, money(m.amount)) },
      { label: '', render: (m) => (m.status === 'void' ? badge('void') : h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', onclick: async () => {
        if (!(await confirmDialog(t('Void this entry? The money goes back as it was.'), { danger: true, confirmText: t('Void') }))) return;
        try { await api.post(`cash/moves/${m.id}/void`); toast(t('Voided')); reload(); } catch (err) { showError(err); }
      } }, t('Void'))) },
    ],
  });

  mount(p.body, balances, h('h2', { class: 'section-title' }, t('What do you want to do?')), actions, card(t('History'), table.el));
}

function moveForm(kind, accounts, done) {
  const opts = accounts.map((a) => [a.id, `${a.name} (${money(a.balance)})`]);
  const cashId = accounts.find((a) => a.subtype === 'cash')?.id || accounts[0]?.id || '';
  const other = accounts.find((a) => a.id !== cashId)?.id || '';
  const f = h('form', { class: 'form' });
  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  if (kind === 'count') {
    const acc = select('account_id', opts, cashId);
    const bal = h('p', { class: 'muted small' });
    const counted = money_input('counted', '', { required: true, autofocus: true });
    const diff = h('p', { class: 'small' });
    const paint = () => {
      const a = accounts.find((x) => String(x.id) === acc.value);
      bal.textContent = t('Books say: {x}', { x: money(a?.balance || 0) });
      const d = Number(counted.value || 0) - Number(a?.balance || 0);
      diff.className = `small ${d < 0 ? 'bad-text' : d > 0 ? 'ok-text' : ''}`;
      diff.textContent = counted.value === '' ? '' : d === 0 ? t('Matches the books.') : d < 0 ? t('Short by {x}', { x: money(Math.abs(d)) }) : t('Extra {x}', { x: money(d) });
    };
    acc.addEventListener('change', paint); counted.addEventListener('input', paint); paint();
    rows.push(field(t('Account'), acc), bal, field(t('Money you counted'), counted, { required: true }), diff);
  } else {
    if (['transfer', 'owner_out', 'cash_out'].includes(kind)) rows.push(field(kind === 'transfer' ? t('From') : t('Take from'), select('from_account_id', opts, cashId)));
    if (['transfer', 'owner_in', 'cash_in'].includes(kind)) rows.push(field(kind === 'transfer' ? t('To') : t('Put into'), select('to_account_id', opts, kind === 'transfer' ? other : cashId)));
    rows.push(field(t('Amount'), money_input('amount', '', { required: true, autofocus: true }), { required: true }));
  }
  rows.push(field(t('Date'), input('date', today, { type: 'date' })), field(t('Note'), input('note', '', { placeholder: t('Optional') })));
  mount(f, h('p', { class: 'muted small' }, t(KINDS[kind][1])), ...rows);
  const m = modal({
    title: t(KINDS[kind][0]), size: 'sm', body: f,
    actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await api.post('cash/moves', { ...values(f), kind }); m.close(); toast(t('Saved')); done(); } catch (err) { b.disabled = false; showFieldErrors(f, err.errors || {}); showError(err); }
    } }, t('Save'))],
  });
}
