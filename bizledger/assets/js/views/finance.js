/**
 * Expenses and other income (shared screen, kind = expense | income).
 */
import { h, mount, uuid } from '../core/dom.js';
import { api } from '../core/api.js';
import { can, state } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, date, today, datetime } from '../core/format.js';
import { page, dataTable, select, input, textarea, card, field, money_input, bindForm, modal, toast, showError, confirmDialog, badge, downloadText, empty, showFieldErrors, values } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';

export default async function finance(el, params, query) {
  const kind = params.kind;
  const perm = kind === 'expense' ? 'expenses' : 'income';
  const base = kind === 'expense' ? 'expenses' : 'income';
  const api_base = kind === 'expense' ? 'expenses' : 'incomes';
  if (!can(`${perm}.view`)) { mount(el, empty(t('You do not have access to this page.'))); return; }
  const categories = (await api.get('accounts', { type: kind })).filter((a) => !['cogs', 'inventory_adjustment', 'sales', 'sales_returns', 'shipping_income'].includes(a.system_key));
  const path = location.hash.split('?')[0];

  if (path.endsWith('/new')) return editor(el, kind, categories);
  if (params.id) return detail(el, kind, Number(params.id), categories);

  const title = kind === 'expense' ? t('Expenses') : t('Income');
  const p = page(title, {
    actions: [
      can('data.export') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const r = await api.get(`export/${api_base}`, query); downloadText(r.filename, r.csv); } }, icon('download', 16), t('Export')) : null,
      can(`${perm}.create`) ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => newCategory(kind) }, t('New category')) : null,
      can(`${perm}.create`) ? h('a', { class: 'btn btn-primary btn-sm', href: `#/${base}/new` }, icon('plus', 16), kind === 'expense' ? t('Add expense') : t('Add income')) : null,
    ],
  });
  const table = dataTable({
    query,
    searchPlaceholder: t('Number, description or reference'),
    filters: [
      { control: select('account_id', [['', t('All categories')], ...categories.map((c) => [c.id, c.name])], '') },
      { control: select('payment_account_id', [['', t('All accounts')], ...state.me.payment_accounts.map((a) => [a.id, a.name])], '') },
      { control: input('from', '', { type: 'date', 'aria-label': t('From') }) },
      { control: input('to', '', { type: 'date', 'aria-label': t('To') }) },
    ],
    fetch: (q) => api.get(api_base, q),
    rowHref: (r) => `/${base}/${r.id}`,
    columns: [
      { label: t('Number'), render: (r) => h('strong', {}, r.number) },
      { label: t('Date'), render: (r) => date(r.date) },
      { label: t('Category'), key: 'category_name' },
      { label: t('Description'), hide: 'sm', render: (r) => (r.description || '').slice(0, 60) },
      { label: t('Paid from'), hide: 'sm', key: 'payment_account_name' },
      { label: t('Amount'), align: 'right', render: (r) => money(r.amount) },
    ],
    footer: (res) => h('div', { class: 'sums' }, h('span', {}, t('Total'), ' ', h('strong', {}, money(res.sum)))),
  });
  p.body.append(table.el);
  mount(el, p.el);
}

function newCategory(kind) {
  const name = input('name', '', { required: true });
  const m = modal({
    title: t('New category'), size: 'sm', body: field(t('Name'), name, { required: true }),
    actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      try { await api.post('accounts', { name: name.value, type: kind }); m.close(); toast(t('Category added')); location.reload(); } catch (err) { showError(err); }
    } }, t('Add'))],
  });
}

function formFields(kind, categories, row = {}) {
  const receipt = input('attachment_id', row.attachment_id || '', { type: 'hidden' });
  const file = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'input' });
  const info = h('small', { class: 'muted' }, row.attachment_url ? h('a', { href: row.attachment_url, target: '_blank', rel: 'noopener' }, t('View receipt')) : '');
  file.addEventListener('change', async () => {
    if (!file.files[0]) return;
    try { const r = await api.upload(file.files[0], 'receipt'); receipt.value = r.id; mount(info, h('a', { href: r.url, target: '_blank', rel: 'noopener' }, t('Uploaded — view'))); } catch (err) { showError(err); }
  });
  return h('div', { class: 'form-grid' },
    field(t('Category'), h('select', { class: 'input', name: 'account_id', required: true }, [h('option', { value: '' }, t('Choose…')), ...categories.map((c) => h('option', { value: c.id, selected: Number(row.account_id) === c.id }, c.name))]), { required: true }),
    field(t('Amount'), money_input('amount', row.amount ? Number(row.amount) : '', { required: true, autofocus: true }), { required: true }),
    field(t('Date'), input('date', row.date || today(), { type: 'date' })),
    field(kind === 'expense' ? t('Paid from') : t('Received in'), h('select', { class: 'input', name: 'payment_account_id' }, state.me.payment_accounts.map((a) => h('option', { value: a.id, selected: Number(row.payment_account_id) === a.id }, a.name)))),
    field(t('Reference'), input('reference', row.reference)),
    h('div', { class: 'field' }, h('label', {}, t('Receipt / attachment')), file, receipt, info),
    field(t('Description'), textarea('description', row.description, { rows: 2 }), { wide: true }));
}

function editor(el, kind, categories) {
  const base = kind === 'expense' ? 'expenses' : 'income';
  const api_base = kind === 'expense' ? 'expenses' : 'incomes';
  const f = h('form', { class: 'form' }, card(null, formFields(kind, categories)),
    h('div', { class: 'form-actions sticky' }, h('a', { class: 'btn', href: `#/${base}` }, t('Cancel')), h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, t('Save'))));
  bindForm(f, async (v) => { const saved = await api.post(api_base, { ...v, uuid: uuid() }); navigate(`/${base}/${saved.id}`); });
  const p = page(kind === 'expense' ? t('Add expense') : t('Add income'), { back: `/${base}` });
  p.body.append(f);
  mount(el, p.el);
}

async function detail(el, kind, id, categories) {
  const base = kind === 'expense' ? 'expenses' : 'income';
  const api_base = kind === 'expense' ? 'expenses' : 'incomes';
  const perm = kind === 'expense' ? 'expenses' : 'income';
  const row = await api.get(`${api_base}/${id}`);
  const p = page(row.number, {
    back: `/${base}`,
    subtitle: `${date(row.date)} · ${row.category?.name || ''}`,
    actions: [
      row.status === 'completed' && can(`${perm}.edit`) ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => {
        const f = h('form', { class: 'form' }, formFields(kind, categories, row));
        const m = modal({ title: t('Edit {n}', { n: row.number }), body: f, actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
          try { await api.put(`${api_base}/${id}`, values(f)); m.close(); toast(t('Saved')); detail(el, kind, id, categories); } catch (err) { showFieldErrors(f, err.errors || {}); showError(err); }
        } }, t('Save'))] });
      } }, icon('edit', 16), t('Edit')) : null,
      row.status === 'completed' && can(`${perm}.delete`) ? h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', onclick: async () => {
        const ok = await confirmDialog(t('Void {n}?', { n: row.number }), { danger: true, confirmText: t('Void'), reason: true });
        if (!ok) return;
        try { await api.post(`${api_base}/${id}/void`, { reason: ok.reason }); toast(t('Voided')); detail(el, kind, id, categories); } catch (err) { showError(err); }
      } }, t('Void')) : null,
    ],
  });
  p.body.append(
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Amount')), h('strong', { class: 'stat-value' }, money(row.amount))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, kind === 'expense' ? t('Paid from') : t('Received in')), h('strong', {}, row.payment_account?.name || '')),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Status')), h('strong', {}, badge(row.status)))),
    card(t('Details'), h('dl', { class: 'details' },
      [[t('Reference'), row.reference], [t('Description'), row.description], [t('Recorded'), datetime(row.created_at)]].filter(([, v]) => v).map(([k, v]) => [h('dt', {}, k), h('dd', { class: 'pre' }, v)])),
    row.attachment_url ? h('a', { class: 'btn btn-sm', href: row.attachment_url, target: '_blank', rel: 'noopener' }, t('View receipt')) : null));
  mount(el, p.el);
}
