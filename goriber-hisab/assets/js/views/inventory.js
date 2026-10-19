/**
 * Inventory: stock levels (with low-stock filter), adjustments, movement
 * history.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can, state } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, qty, date, datetime } from '../core/format.js';
import { page, dataTable, select, input, field, money_input, modal, toast, showError, showFieldErrors, values, tabs, checkbox, downloadText, empty } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';

const TYPES = { opening: 'Opening', purchase: 'Purchase', sale: 'Sale', sale_return: 'Sales return', purchase_return: 'Purchase return', adjustment: 'Adjustment', sale_void: 'Sale void', purchase_void: 'Purchase void', sale_return_void: 'Return void', purchase_return_void: 'Return void' };

export default async function inventory(el, params, query) {
  if (!can('inventory.view')) { mount(el, empty(t('You do not have access to inventory.'))); return; }
  const movements = location.hash.startsWith('#/inventory/movements');
  const p = page(t('Inventory'), {
    actions: [
      can('data.export') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const r = await api.get('export/stock', query); downloadText(r.filename, r.csv); } }, icon('download', 16), t('Export')) : null,
      can('purchases.create') ? h('a', { class: 'btn btn-primary btn-sm', href: '#/purchases/new' }, icon('plus', 16), t('Stock in (purchase)')) : null,
    ],
  });
  p.body.append(tabs([['levels', t('Stock levels')], ['movements', t('Movement history')]], movements ? 'movements' : 'levels', (k) => navigate(k === 'levels' ? '/inventory' : '/inventory/movements')));

  if (!movements) {
    const branches = state.ctx.branches || [];
    const table = dataTable({
      query,
      searchPlaceholder: t('Product, SKU or barcode'),
      filters: [
        { control: checkbox('low', query.low === '1', '').querySelector('input'), label: t('Low stock only') },
        { control: select('category_id', [['', t('All categories')], ...(state.me.categories || []).map((c) => [c.id, c.name])], '') },
        branches.length > 1 ? { control: select('branch_id', [['', t('This branch')], ['all', t('All branches')], ...branches.map((b) => [b.id, b.name])], '') } : null,
      ].filter(Boolean),
      fetch: (q) => api.get('stock', q),
      rowHref: (r) => `/products/${r.product_id}`,
      columns: [
        { label: t('Product'), render: (r) => h('span', {}, h('strong', {}, r.name), h('small', { class: 'muted' }, ` ${r.sku || ''}`)) },
        { label: t('In stock'), align: 'right', render: (r) => h('strong', { class: r.is_low ? 'bad-text' : '' }, qty(r.qty)) },
        { label: t('Minimum'), align: 'right', hide: 'sm', render: (r) => qty(r.min_stock) },
        { label: t('Avg cost'), align: 'right', hide: 'sm', render: (r) => (r.avg_cost === null ? '—' : money(r.avg_cost)) },
        { label: t('Value'), align: 'right', render: (r) => (r.value === null ? '—' : money(r.value)) },
        can('inventory.adjust') ? { label: '', render: (r) => h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => { e.stopPropagation(); stockAdjust({ id: r.product_id, name: r.name }, null, () => table.reload()); } }, t('Adjust')) } : null,
      ].filter(Boolean),
    });
    p.body.append(table.el);
  } else {
    const table = dataTable({
      query,
      searchPlaceholder: t('Filter by product id via link'),
      filters: [
        { control: select('type', [['', t('All movements')], ...Object.entries(TYPES).map(([k, v]) => [k, t(v)])], '') },
        { control: input('from', '', { type: 'date', 'aria-label': t('From') }) },
        { control: input('to', '', { type: 'date', 'aria-label': t('To') }) },
      ],
      fetch: (q) => api.get('stock/movements', { ...q, product_id: query.product_id }),
      columns: [
        { label: t('Date'), render: (m) => h('span', { title: datetime(m.created_at) }, date(m.movement_date)) },
        { label: t('Product'), render: (m) => h('a', { href: `#/products/${m.product_id}` }, m.product_name) },
        { label: t('Type'), render: (m) => t(TYPES[m.movement_type] || m.movement_type) },
        { label: t('Qty'), align: 'right', render: (m) => h('strong', { class: Number(m.qty) < 0 ? 'bad-text' : 'ok-text' }, (Number(m.qty) > 0 ? '+' : '') + qty(m.qty)) },
        { label: t('Before → after'), align: 'right', hide: 'sm', render: (m) => `${qty(m.qty_before)} → ${qty(m.qty_after)}` },
        { label: t('Unit cost'), align: 'right', hide: 'sm', render: (m) => (m.unit_cost === null ? '—' : money(m.unit_cost)) },
        { label: t('Reference'), render: (m) => refLink(m) },
      ],
    });
    p.body.append(table.el);
  }
  mount(el, p.el);
}

function refLink(m) {
  const map = { sale: 'sales', purchase: 'purchases', return: 'returns', product: 'products', adjustment: 'accounting/journal', adjustment_void: 'accounting/journal' };
  const base = map[m.reference_type];
  const label = m.reference_no || m.note || '—';
  return base && Number(m.reference_id) ? h('a', { href: `#/${base}/${m.reference_id}` }, label) : h('span', { class: 'muted' }, label);
}

/** Adjustment dialog (count correction, damage, found stock). */
export function stockAdjust(product, variant, onDone) {
  const mode = select('mode', [
    ['opening', t('Add stock I already have (not profit)')],
    ['remove', t('Remove (damage, loss, own use)')],
    ['add', t('Add found / gift stock (counts as profit)')],
    ['set', t('Set counted quantity')],
  ], 'opening');
  const hint = h('p', { class: 'callout small' }, t('Bought new stock from a supplier? Enter it as a Purchase instead, so the cost, supplier and payment are recorded.'));
  const f = h('form', { class: 'form' }, hint, h('div', { class: 'form-grid' },
    field(t('What happened?'), mode),
    field(t('Quantity'), money_input('qty', '', { required: true, autofocus: true }), { required: true }),
    can('products.cost') ? field(t('Unit cost (for additions)'), money_input('unit_cost', ''), { hint: t('Defaults to the current average cost') }) : null,
    field(t('Reason'), input('reason', '', { placeholder: t('e.g. Damaged in transit') }), { wide: true })));
  const sync = () => { hint.hidden = !['opening', 'add'].includes(mode.value); };
  mode.addEventListener('change', sync); sync();
  const m = modal({
    title: t('Adjust stock: {p}', { p: product.name + (variant ? ` - ${variant.name}` : '') }),
    body: f,
    actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      try {
        const res = await api.post('stock/adjust', { ...values(f), product_id: product.id, variant_id: variant?.id || 0 });
        m.close();
        toast(t('Stock is now {n}', { n: qty(res.qty) }));
        onDone?.();
      } catch (err) { showFieldErrors(f, err.errors || {}); showError(err); }
    } }, t('Save adjustment'))],
  });
}
