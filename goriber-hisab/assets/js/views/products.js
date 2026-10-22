/**
 * Products: list, detail (stock per branch, variants, barcode), form.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can, state } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, qty } from '../core/format.js';
import { page, dataTable, select, card, field, input, textarea, money_input, checkbox, bindForm, values, toast, showError, showFieldErrors, badge, confirmDialog, modal, simpleTable, downloadText, empty } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';
import { barcodeSvg } from '../core/barcode.js';
import { stockAdjust } from './inventory.js';
import { recipeCard, packDialog } from './recipe.js';

export default async function products(el, params, query) {
  const path = location.hash.split('?')[0];
  if (path.endsWith('/catalog')) return catalogue(el);
  if (path.endsWith('/new')) return form(el);
  if (path.endsWith('/edit')) return form(el, Number(params.id));
  if (params.id) return detail(el, Number(params.id), query);

  const cats = state.me.categories || [];
  const p = page(t('Products'), {
    actions: [
      can('data.import') ? h('a', { class: 'btn btn-sm', href: '#/settings/data' }, icon('upload', 16), t('Import')) : null,
      can('data.export') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const r = await api.get('export/products', query); downloadText(r.filename, r.csv); } }, icon('download', 16), t('Export')) : null,
      h('a', { class: 'btn btn-sm', href: '#/products/catalog' }, icon('products', 16), t('Categories & brands')),
      h('a', { class: 'btn btn-sm', href: '#/products/labels' }, icon('barcode', 16), t('Barcode labels')),
      can('products.create') ? h('a', { class: 'btn btn-primary btn-sm', href: '#/products/new' }, icon('plus', 16), t('New product')) : null,
    ],
  });
  const table = dataTable({
    query,
    searchPlaceholder: t('Name, SKU or barcode'),
    filters: [
      { control: select('category_id', [['', t('All categories')], ...cats.map((c) => [c.id, c.name])], '') },
      { control: select('status', [['active', t('Active')], ['inactive', t('Inactive')], ['any', t('All')]], 'active') },
      { control: select('type', [['', t('All types')], ['standard', t('Stock items')], ['service', t('Services')]], '') },
    ],
    fetch: (q) => api.get('products', q),
    rowHref: (r) => `/products/${r.id}`,
    columns: [
      { label: t('Product'), render: (r) => h('div', { class: 'cell-product' }, r.image_url ? h('img', { src: r.image_url, alt: '', width: 36, height: 36, loading: 'lazy' }) : null, h('span', {}, h('strong', {}, r.name), h('small', { class: 'muted' }, ` ${r.sku || ''}`))) },
      { label: t('Category'), hide: 'sm', key: 'category_name' },
      { label: t('Price'), align: 'right', render: (r) => money(r.selling_price) },
      { label: t('Cost'), align: 'right', hide: 'sm', render: (r) => (r.purchase_price === null ? '—' : money(r.purchase_price)) },
      { label: t('Stock'), align: 'right', render: (r) => (r.has_recipe ? h('span', { class: 'muted', title: t('Made from a recipe') }, r.make_qty !== null ? t('Can make {n}', { n: qty(r.make_qty) }) : t('Recipe')) : r.track_stock ? h('span', { class: r.is_low ? 'bad-text' : '' }, `${qty(r.stock_qty)} ${r.unit_name || ''}`) : t('Service')) },
      { label: t('Status'), hide: 'sm', render: (r) => badge(r.status) },
    ],
  });
  p.body.append(table.el);
  mount(el, p.el);
}

async function detail(el, id, query = {}) {
  const pr = await api.get(`products/${id}`);
  const reload = () => detail(el, id);
  const p = page(pr.name, {
    back: '/products',
    subtitle: [pr.sku, pr.barcode].filter(Boolean).join(' · '),
    actions: [
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => navigate(`/products/labels?ids=${pr.id}`) }, icon('barcode', 16), t('Print barcode')),
      pr.has_recipe && pr.track_stock && can('inventory.adjust') ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => { try { packDialog(pr, await api.get(`products/${pr.id}/recipe`), reload); } catch (err) { showError(err); } } }, icon('inventory', 16), t('Pack now')) : null,
      pr.track_stock && can('inventory.adjust') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => stockAdjust(pr, null, reload) }, t('Adjust stock')) : null,
      can('inventory.view') ? h('a', { class: 'btn btn-sm', href: `#/inventory/movements?product_id=${id}` }, t('Stock history')) : null,
      can('products.edit') ? h('a', { class: 'btn btn-primary btn-sm', href: `#/products/${id}/edit` }, icon('edit', 16), t('Edit')) : null,
    ],
  });
  const branches = Object.fromEntries((state.ctx.branches || []).map((b) => [Number(b.id), b.name]));
  p.body.append(
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Selling price')), h('strong', { class: 'stat-value' }, money(pr.selling_price))),
      pr.purchase_price !== null ? h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Purchase price')), h('strong', { class: 'stat-value' }, money(pr.purchase_price))) : null,
      Number(pr.wholesale_price) ? h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Wholesale')), h('strong', { class: 'stat-value' }, money(pr.wholesale_price))) : null,
      pr.has_recipe && pr.make_qty !== null ? h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, t('Can be made now')), h('strong', { class: 'stat-value' }, qty(pr.make_qty)), h('span', { class: 'stat-hint' }, t('from the ingredients in stock'))) : null,
      pr.track_stock ? h('div', { class: `stat ${pr.is_low ? 'bad' : ''}` }, h('span', { class: 'stat-label' }, t('In stock (this branch)')), h('strong', { class: 'stat-value' }, qty(pr.stock_qty)), h('span', { class: 'stat-hint' }, t('Minimum {n}', { n: qty(pr.min_stock) }))) : null),
    h('div', { class: 'grid-2' },
      pr.track_stock ? card(t('Stock by branch'), pr.stock.length ? simpleTable([
        { label: t('Branch'), render: (s) => branches[Number(s.branch_id)] || s.branch_name },
        { label: t('Variant'), render: (s) => (Number(s.variant_id) ? (pr.variants.find((v) => v.id === Number(s.variant_id))?.name || '#' + s.variant_id) : '—') },
        { label: t('Qty'), align: 'right', render: (s) => qty(s.qty) },
        { label: t('Avg cost'), align: 'right', render: (s) => (s.avg_cost === null ? '—' : money(s.avg_cost)) },
        { label: t('Value'), align: 'right', render: (s) => (s.value === null ? '—' : money(s.value)) },
      ], pr.stock) : h('p', { class: 'muted' }, t('No stock yet.'))) : null,
      card(t('Barcode'), pr.barcode || pr.sku ? h('div', { class: 'barcode-box' }, barcodeSvg(pr.barcode || pr.sku), h('code', {}, pr.barcode || pr.sku)) : h('p', { class: 'muted' }, t('No barcode. Edit the product to add one, or let Goriber Hisab generate it.')), !pr.barcode && can('products.edit') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await api.post('products/barcodes', { ids: String(pr.id) }); toast(t('Barcode created')); reload(); } catch (err) { showError(err); } } }, icon('barcode', 16), t('Create barcode')) : null)),
    variantsCard(pr, reload),
    recipeCard(pr, reload, { open: query.recipe === '1' }),
    pr.description ? card(t('Description'), h('p', { class: 'pre' }, pr.description)) : null,
    can('products.delete') ? h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: async () => {
      if (!(await confirmDialog(t('Delete {n}? Past sales keep their records.', { n: pr.name }), { danger: true, confirmText: t('Delete') }))) return;
      try { await api.del(`products/${id}`); toast(t('Deleted')); navigate('/products'); } catch (err) { showError(err); }
    } }, icon('trash', 16), t('Delete product')) : null);
  mount(el, p.el);
}

function variantsCard(pr, reload) {
  if (!state.settings['features.variants'] && !pr.variants.length) return null;
  const add = can('products.create') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => variantForm(pr, null, reload) }, icon('plus', 14), t('Add variant')) : null;
  return card(t('Variants (size, colour…)'), pr.variants.length ? simpleTable([
    { label: t('Variant'), key: 'name' },
    { label: t('SKU / barcode'), render: (v) => [v.sku, v.barcode].filter(Boolean).join(' · ') },
    { label: t('Price'), align: 'right', render: (v) => money(v.selling_price) },
    { label: t('Stock'), align: 'right', render: (v) => qty(v.stock_qty) },
    { label: '', render: (v) => h('span', { class: 'row end' },
      can('products.edit') ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Edit'), onclick: () => variantForm(pr, v, reload) }, icon('edit', 16)) : null,
      can('inventory.adjust') ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Adjust stock'), onclick: () => stockAdjust(pr, v, reload) }, icon('inventory', 16)) : null,
      can('products.delete') ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Delete'), onclick: async () => {
        if (!(await confirmDialog(t('Delete variant {n}?', { n: v.name }), { danger: true }))) return;
        try { await api.del(`products/${pr.id}/variants/${v.id}`); reload(); } catch (err) { showError(err); }
      } }, icon('trash', 16)) : null) },
  ], pr.variants) : h('p', { class: 'muted' }, t('This product has no variants.')), add);
}

function variantForm(pr, v, reload) {
  const a = v?.attributes || {};
  const f = h('form', { class: 'form' }, h('div', { class: 'form-grid' },
    field(t('Size'), input('size', a.size)),
    field(t('Colour'), input('color', a.color)),
    field(t('Weight'), input('weight', a.weight)),
    field(t('Name'), input('name', v?.name, { placeholder: t('Auto from attributes') })),
    field(t('SKU'), input('sku', v?.sku)),
    field(t('Barcode'), input('barcode', v?.barcode)),
    field(t('Selling price'), money_input('selling_price', v?.selling_price ?? pr.selling_price)),
    can('products.cost') ? field(t('Purchase price'), money_input('purchase_price', v?.purchase_price ?? pr.purchase_price)) : null,
    !v && pr.track_stock ? field(t('Opening stock'), money_input('opening_qty', '')) : null));
  const m = modal({
    title: v ? t('Edit variant') : t('New variant'),
    body: f,
    actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      const val = values(f);
      const body = { ...val, attributes: { size: val.size, color: val.color, weight: val.weight } };
      try {
        if (v) await api.put(`products/${pr.id}/variants/${v.id}`, body); else await api.post(`products/${pr.id}/variants`, body);
        m.close(); toast(t('Saved')); reload();
      } catch (err) { showFieldErrors(f, err.errors || {}); showError(err); }
    } }, t('Save'))],
  });
}

const SIZE_PICKS = ['1 kg', '500 g', '250 g', '100 g', '2 L', '1 L', '500 ml', 'S', 'M', 'L', 'XL'];

/**
 * "This product comes in sizes": a row per size with its own selling price,
 * purchase price and stock. Saved as product variants (the POS asks which size).
 */
function sizesBlock(pr, editing) {
  const rows = []; // { id?, name, sell, buy, qty, stock, el }
  const removed = [];
  const list = h('div', { class: 'size-rows' });
  const toggle = h('input', { type: 'checkbox', checked: !!(pr.variants && pr.variants.length) });
  const body = h('div', { class: 'size-body' });
  const listeners = [];
  const n = (v) => (Number(v) ? String(Number(v)) : '');

  const addRow = (v = {}) => {
    const name = h('input', { class: 'input', placeholder: t('e.g. 500 g'), value: v.name || '' });
    const sell = h('input', { class: 'input', type: 'number', inputmode: 'decimal', step: 'any', min: 0, placeholder: t('Price'), value: n(v.selling_price) });
    const buy = can('products.cost') ? h('input', { class: 'input', type: 'number', inputmode: 'decimal', step: 'any', min: 0, placeholder: t('Cost'), value: n(v.purchase_price) }) : null;
    const qty = v.id ? null : h('input', { class: 'input', type: 'number', inputmode: 'decimal', step: 'any', min: 0, placeholder: t('Stock') });
    const row = { id: v.id || 0, name, sell, buy, qty, orig: v };
    row.el = h('div', { class: 'size-row' },
      h('div', { class: 'size-cell grow' }, h('small', {}, t('Size')), name),
      h('div', { class: 'size-cell' }, h('small', {}, t('Selling price')), sell),
      buy ? h('div', { class: 'size-cell' }, h('small', {}, t('Purchase price')), buy) : null,
      h('div', { class: 'size-cell' }, h('small', {}, t('Stock')), qty || h('span', { class: 'size-stock' }, qty === null ? String(Number(v.stock_qty) || 0) : '')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Remove'), onclick: () => {
        rows.splice(rows.indexOf(row), 1); row.el.remove(); if (row.id) removed.push(row);
      } }, icon('trash', 16)));
    rows.push(row);
    list.append(row.el);
    return row;
  };
  (pr.variants || []).forEach((v) => addRow(v));

  const picks = h('div', { class: 'chip-pick' }, SIZE_PICKS.map((label) => h('button', { type: 'button', class: 'chip', onclick: () => {
    const empty = rows.find((r) => !r.name.value);
    const r = empty || addRow();
    r.name.value = label;
    r.sell.focus();
  } }, label)));

  mount(body,
    h('p', { class: 'muted small' }, t('Tap a size to add it, then type its price. In the POS you pick the size when selling.')),
    picks, list,
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => addRow().name.focus() }, icon('plus', 14), t('Add another size')),
    editing ? h('p', { class: 'muted small' }, t('Stock of an existing size changes through purchases, sales or Stock → adjust.')) : null);
  const paint = () => { body.hidden = !toggle.checked; if (toggle.checked && !rows.length) { addRow(); addRow(); } listeners.forEach((fn) => fn()); };
  toggle.addEventListener('change', paint);
  const el = card(null,
    h('label', { class: 'check size-toggle' }, toggle, h('span', {}, h('strong', {}, t('This product comes in sizes')), h('small', { class: 'muted' }, ` — ${t('e.g. honey 1 kg / 500 g / 250 g, each with its own price')}`))),
    body);
  body.hidden = !toggle.checked;

  return {
    el,
    on: () => toggle.checked && rows.some((r) => r.name.value.trim()),
    onToggle: (fn) => listeners.push(fn),
    check() {
      for (const r of rows) {
        if (!r.name.value.trim() && !r.sell.value) continue;
        if (!r.name.value.trim()) return t('Write the size for every row (e.g. 500 g).');
        if (!(Number(r.sell.value) > 0)) return t('Give a selling price for {n}.', { n: r.name.value.trim() });
      }
      return '';
    },
    async save(productId, v) {
      if (!toggle.checked) return;
      let created = 0;
      for (const r of rows) {
        const name = r.name.value.trim();
        if (!name) continue;
        const body = { name, attributes: { size: name }, selling_price: r.sell.value || v.selling_price, ...(r.buy ? { purchase_price: r.buy.value || v.purchase_price || '' } : {}) };
        if (r.id) {
          const o = r.orig;
          if (name !== o.name || Number(body.selling_price) !== Number(o.selling_price) || (r.buy && Number(body.purchase_price) !== Number(o.purchase_price))) await api.put(`products/${productId}/variants/${r.id}`, body);
        } else {
          const saved = await api.post(`products/${productId}/variants`, { ...body, opening_qty: r.qty?.value || '' });
          r.id = saved.id; r.orig = saved; created++;
        }
      }
      for (const r of removed) {
        try { await api.del(`products/${productId}/variants/${r.id}`); } catch (err) { showError(err); }
      }
      if (created) await api.post('products/barcodes', { ids: String(productId) }).catch(() => {});
    },
  };
}

/** A select with a "+" button that creates a new category / brand / unit in place. */
function withAdd(sel, kind, title) {
  if (!can('products.create')) return sel;
  return h('div', { class: 'row' }, sel, h('button', { class: 'btn btn-sm', type: 'button', title, 'aria-label': title, onclick: () => termForm(kind, null, (saved) => {
    state.me[kind] = [...(state.me[kind] || []), saved].sort((a, b) => a.name.localeCompare(b.name));
    sel.append(h('option', { value: saved.id }, saved.name));
    sel.value = saved.id;
    sel.dispatchEvent(new Event('change'));
  }, title) }, icon('plus', 14), t('New')));
}

function termForm(kind, x, onDone, title) {
  const name = input('name', x?.name || '', { required: true, autofocus: true });
  const f = h('form', { class: 'form' }, field(t('Name'), name, { required: true }),
    kind === 'units' ? field(t('Short name'), input('short_name', x?.short_name || ''), { hint: t('e.g. kg, pcs, ltr') }) : null,
    kind === 'units' ? checkbox('allow_decimal', !!Number(x?.allow_decimal), t('Allow fractions (e.g. 1.5 kg)')) : null);
  const save = async () => {
    try {
      const saved = x ? await api.put(`taxonomies/${kind}/${x.id}`, values(f)) : await api.post(`taxonomies/${kind}`, values(f));
      m.close(); toast(t('Saved')); onDone(saved);
    } catch (err) { showFieldErrors(f, err.errors || {}); showError(err); }
  };
  f.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  const m = modal({ title: title || (x ? t('Edit') : t('Add')), size: 'sm', body: f, actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, t('Save'))] });
}

/** Categories, brands and units in one place. */
async function catalogue(el) {
  const p = page(t('Categories, brands & units'), { back: '/products', subtitle: t('Group your products. The number shows how many products use each one.') });
  const grid = h('div', { class: 'grid-3' });
  p.body.append(grid);
  mount(el, p.el);
  const kinds = [['categories', t('Categories'), t('New category')], ['brands', t('Brands'), t('New brand')], ['units', t('Units'), t('New unit')]];
  const paint = async () => {
    const lists = await Promise.all(kinds.map(([k]) => api.get(`taxonomies/${k}`)));
    lists.forEach((items, i) => { state.me[kinds[i][0]] = items; });
    mount(grid, kinds.map(([kind, label, add], i) => card(label,
      lists[i].length ? h('ul', { class: 'list' }, lists[i].map((x) => h('li', {},
        h('span', {}, h('strong', {}, x.name), kind === 'units' ? h('small', { class: 'muted' }, ` (${x.short_name}${Number(x.allow_decimal) ? ' · ' + t('fractions') : ''})`) : null),
        h('span', { class: 'row' },
          h('a', { class: 'badge badge-info', href: kind === 'categories' ? `#/products?category_id=${x.id}` : '#/products' }, String(x.product_count)),
          can('products.edit') ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Edit'), onclick: () => termForm(kind, x, paint, t('Edit')) }, icon('edit', 14)) : null,
          can('products.delete') ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Delete'), onclick: async () => {
            if (!(await confirmDialog(t('Delete {n}?', { n: x.name }), { danger: true }))) return;
            try { await api.del(`taxonomies/${kind}/${x.id}`); paint(); } catch (err) { showError(err); }
          } }, icon('trash', 14)) : null)))) : h('p', { class: 'muted' }, t('Nothing here yet.')),
      can('products.create') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => termForm(kind, null, paint, add) }, icon('plus', 14), add) : null)));
  };
  paint();
}

async function form(el, id = 0) {
  if (!can(id ? 'products.edit' : 'products.create')) { mount(el, empty(t('You do not have permission for this.'))); return; }
  const pr = id ? await api.get(`products/${id}`) : { track_stock: true, type: 'standard', status: 'active' };
  const opt = (list, empty_label) => [['', empty_label], ...(list || []).map((x) => [x.id, x.name])];
  const num = (v) => (Number(v) ? String(Number(v)) : '');
  const taxes = state.me.tax_rates || [];
  const typeSel = select('type', [['standard', t('Stock item')], ['service', t('Service (no stock)')]], pr.type);
  const stockFields = h('div', { class: 'form-grid' },
    field(t('Minimum stock (alert level)'), money_input('min_stock', Number(pr.min_stock) ? pr.min_stock : '')),
    !id ? field(t('Opening stock'), money_input('opening_qty', ''), { hint: t('Quantity on hand right now') }) : null,
    !id && can('products.cost') ? field(t('Opening unit cost'), money_input('opening_cost', ''), { hint: t('Defaults to purchase price') }) : null);
  typeSel.addEventListener('change', () => { stockFields.hidden = typeSel.value === 'service'; });
  stockFields.hidden = pr.type === 'service';

  const catSel = select('category_id', opt(state.me.categories, t('None')), pr.category_id || '');
  const brandSel = select('brand_id', opt(state.me.brands, t('None')), pr.brand_id || '');
  const unitSel = select('unit_id', opt(state.me.units, t('None')), pr.unit_id || '');
  const isDecimalUnit = (uid) => !!Number((state.me.units || []).find((u) => String(u.id) === String(uid))?.allow_decimal);
  const looseBox = h('input', { type: 'checkbox', checked: isDecimalUnit(pr.unit_id) });
  looseBox.addEventListener('change', async () => {
    if (!looseBox.checked) { if (isDecimalUnit(unitSel.value)) unitSel.value = (state.me.units || []).find((u) => !Number(u.allow_decimal))?.id || ''; return; }
    let kg = (state.me.units || []).find((u) => Number(u.allow_decimal) && /^(kg|কেজি)$/i.test(u.short_name || u.name)) || (state.me.units || []).find((u) => Number(u.allow_decimal));
    if (!kg) {
      try { kg = await api.post('taxonomies/units', { name: 'Kilogram', short_name: 'kg', allow_decimal: true }); state.me.units = [...(state.me.units || []), kg]; unitSel.append(h('option', { value: kg.id }, kg.name)); } catch (err) { showError(err); looseBox.checked = false; return; }
    }
    unitSel.value = kg.id;
  });
  unitSel.addEventListener('change', () => { looseBox.checked = isDecimalUnit(unitSel.value); });

  const imageId = input('image_id', pr.image_id || '', { type: 'hidden' });
  const imgPreview = h('div', { class: 'img-preview' }, pr.image_url ? h('img', { src: pr.image_url, alt: '' }) : null);
  const upload = h('input', { type: 'file', accept: 'image/*', class: 'input' });
  upload.addEventListener('change', async () => {
    if (!upload.files[0]) return;
    try { const r = await api.upload(upload.files[0], 'product'); imageId.value = r.id; mount(imgPreview, h('img', { src: r.url, alt: '' })); }
    catch (err) { showError(err); }
  });

  // Units as one-tap chips (the select stays as the value holder, hidden).
  const unitChips = h('div', { class: 'chip-pick', role: 'radiogroup', 'aria-label': t('Unit') });
  const paintUnits = () => mount(unitChips,
    [['', t('Piece / none')], ...(state.me.units || []).map((u) => [String(u.id), u.short_name || u.name])].map(([v, label]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(String(unitSel.value) === v), class: `chip ${String(unitSel.value) === v ? 'on' : ''}`, onclick: () => { unitSel.value = v; unitSel.dispatchEvent(new Event('change')); paintUnits(); } }, label)),
    can('products.create') ? h('button', { type: 'button', class: 'chip chip-add', onclick: () => termForm('units', null, (saved) => {
      state.me.units = [...(state.me.units || []), saved];
      unitSel.append(h('option', { value: saved.id }, saved.name));
      unitSel.value = saved.id; unitSel.dispatchEvent(new Event('change')); paintUnits();
    }, t('New unit')) }, '+ ', t('New')) : null);
  unitSel.addEventListener('change', paintUnits);
  looseBox.addEventListener('change', () => setTimeout(paintUnits, 50));
  unitSel.hidden = true;
  paintUnits();

  // Live profit: selling − purchase.
  const sell = money_input('selling_price', num(pr.selling_price), { required: true, placeholder: '0' });
  const buy = can('products.cost') ? money_input('purchase_price', num(pr.purchase_price), { placeholder: '0' }) : null;
  const profit = h('div', { class: 'profit-line' });
  const paintProfit = () => {
    const sp = Number(sell.value); const bp = Number(buy?.value);
    if (!buy || !sp || !bp) { profit.textContent = ''; return; }
    const pf = sp - bp;
    profit.className = `profit-line ${pf < 0 ? 'bad' : 'ok'}`;
    profit.textContent = pf < 0 ? t('Loss of {x} on each one', { x: money(String(-pf)) }) : t('Profit {x} on each one ({p}%)', { x: money(String(pf)), p: Math.round((pf / bp) * 100) });
  };
  sell.addEventListener('input', paintProfit); buy?.addEventListener('input', paintProfit);
  paintProfit();

  // Photo: a big tap area.
  const photo = h('label', { class: 'photo-drop' }, imgPreview, h('span', { class: 'photo-hint' }, icon('camera', 22), h('small', {}, t('Add photo'))), upload);
  upload.classList.remove('input');

  const barcodeIn = input('barcode', pr.barcode, { placeholder: t('Scan it in, or leave empty') });
  const scanBtn = h('button', { class: 'btn', type: 'button', title: t('Scan with camera'), 'aria-label': t('Scan with camera'), onclick: async () => {
    const { scanWithCamera } = await import('../core/scanner.js');
    const code = await scanWithCamera();
    if (code) barcodeIn.value = code;
  } }, icon('camera', 18));

  const more = h('details', { class: 'more-options' },
    h('summary', {}, t('More options'), h('small', { class: 'muted' }, ` — ${t('brand, barcode, wholesale price, stock alert…')}`)),
    h('div', { class: 'form-grid' },
      field(t('Type'), typeSel),
      field(t('Brand'), withAdd(brandSel, 'brands', t('New brand'))),
      h('div', { class: 'field wide loose-toggle' }, h('label', { class: 'check' }, looseBox, h('span', {}, h('strong', {}, t('Sold loose by weight (gram / kg)')), h('small', { class: 'muted' }, ` — ${t('e.g. badam, rice, sugar. In POS you type the grams or the taka amount.')}`)))),
      field(t('Barcode'), h('div', { class: 'row' }, barcodeIn, scanBtn)),
      !id ? h('div', { class: 'field' }, checkbox('auto_barcode', true, t('Generate a barcode if empty'))) : null,
      field(t('SKU'), input('sku', pr.sku)),
      field(t('Wholesale price'), money_input('wholesale_price', num(pr.wholesale_price))),
      field(t('Minimum selling price'), money_input('min_selling_price', num(pr.min_selling_price)), { hint: t('Staff cannot sell below this') }),
      state.settings['tax.enabled'] ? field(state.settings['tax.label'], select('tax_rate_id', [['', t('Business default')], ...taxes.map((r) => [r.id, `${r.name} (${Number(r.rate)}%)`])], pr.tax_rate_id || '')) : null,
      field(t('Status'), select('status', [['active', t('Active')], ['inactive', t('Inactive')]], pr.status)),
      field(t('Description'), textarea('description', pr.description), { wide: true })),
    stockFields);

  // Sizes / packs (e.g. honey 1 kg, 500 g, 250 g), each with its own price and stock.
  const sizes = sizesBlock(pr, !!id);

  // Editing: the count can be corrected right here (a stock adjustment, so the history stays right).
  const editStock = !!id && pr.type !== 'service' && !sizes.on() && pr.track_stock !== false && Number(pr.track_stock) !== 0 && can('inventory.adjust');
  // More than before: was it already in the shop (forgot the opening stock — not profit) or really extra?
  const whySel = select('stock_why', [['opening', t('It was already in the shop (I forgot to enter it) — not profit')], ['gain', t('Found extra when counting — count as a gain')]], 'opening');
  const stockWhy = h('div', { class: 'field wide', hidden: true }, h('label', {}, t('Where did the extra stock come from?')), whySel);
  // Less than before: entered too much by mistake (not a loss) or really lost/damaged?
  const lessSel = select('stock_less', [['mistake', t('I entered too much by mistake — not a loss')], ['loss', t('Damaged / lost / used — count as a loss')]], 'mistake');
  const stockLess = h('div', { class: 'field wide', hidden: true }, h('label', {}, t('Why is the stock less?')), lessSel);
  // Made in the shop from other products: the recipe is set right after saving.
  const madeBox = h('input', { type: 'checkbox', name: 'made_from_recipe' });
  const madeRow = !id ? h('div', { class: 'field wide loose-toggle' }, h('label', { class: 'check' }, madeBox, h('span', {}, h('strong', {}, t('Made from other products (recipe)')), h('small', { class: 'muted' }, ` — ${t('e.g. honey nuts from cashew, almond, walnut. Selling it takes the ingredients out of stock.')}`)))) : null;
  let again = false;
  const saveBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'submit', onclick: () => { again = false; } }, icon('check', 18), t('Save product'));
  const againBtn = !id ? h('button', { class: 'btn btn-lg', type: 'submit', onclick: () => { again = true; } }, icon('plus', 18), t('Save & add another')) : null;
  const f = h('form', { class: 'form product-form' },
    card(null,
      h('div', { class: 'quick-product' },
        photo,
        h('div', { class: 'quick-main' },
          field(t('Product name'), input('name', pr.name, { required: true, autofocus: true, placeholder: t('e.g. Lux soap 100g') }), { required: true }),
          h('div', { class: 'price-row' },
            field(t('Selling price'), sell, { required: true }),
            buy ? field(t('Purchase price'), buy) : null),
          profit)),
      h('div', { class: 'form-grid' },
        h('div', { class: 'field wide' }, h('label', {}, t('Unit')), unitChips, unitSel),
        field(t('Category'), withAdd(catSel, 'categories', t('New category'))),
        !id ? field(t('Stock now'), money_input('opening_qty', '', { placeholder: '0' }), { hint: t('How many you have in the shop right now') }) : null,
        editStock ? field(t('Stock now'), money_input('stock_now', String(Number(pr.stock_qty) || 0)), { hint: t('Change it to correct the count — saved as a stock adjustment') }) : null,
        editStock ? stockWhy : null,
        editStock ? stockLess : null,
        madeRow,
        field(t('Alert when stock falls to'), money_input('min_stock', num(pr.min_stock), { placeholder: t('optional') }), { hint: t('Low stock alert + red light') }))),
    sizes.el,
    more,
    imageId,
    h('div', { class: 'form-actions sticky' }, h('a', { class: 'btn', href: id ? `#/products/${id}` : '#/products' }, t('Cancel')), againBtn, saveBtn));
  // Opening stock and alert level now live up top; keep their old copies out of the form.
  stockFields.querySelectorAll('[name=opening_qty], [name=min_stock]').forEach((x) => x.closest('.field')?.remove());
  const wholeStock = () => f.querySelectorAll('[name=opening_qty], [name=stock_now]').forEach((x) => { x.closest('.field').hidden = sizes.on() || madeBox.checked; });
  madeBox.addEventListener('change', wholeStock);
  sizes.onToggle(wholeStock);
  wholeStock();
  const stockIn = f.querySelector('[name=stock_now]');
  stockIn?.addEventListener('input', () => {
    stockWhy.hidden = !(Number(stockIn.value) > Number(pr.stock_qty || 0));
    stockLess.hidden = !(stockIn.value !== '' && Number(stockIn.value) < Number(pr.stock_qty || 0));
  });
  typeSel.addEventListener('change', () => { f.querySelectorAll('[name=opening_qty], [name=min_stock]').forEach((x) => { x.closest('.field').hidden = typeSel.value === 'service'; }); });

  bindForm(f, async (v) => {
    try {
      const stockNow = v.stock_now;
      const why = v.stock_why;
      const less = v.stock_less;
      delete v.stock_now; delete v.stock_why; delete v.stock_less;
      const made = !!v.made_from_recipe;
      delete v.made_from_recipe;
      if (made) delete v.opening_qty;
      if (sizes.on()) { const bad = sizes.check(); if (bad) throw new Error(bad); }
      const saved = id ? await api.put(`products/${id}`, v) : await api.post('products', v);
      await sizes.save(saved.id, v);
      if (editStock && stockNow !== '' && stockNow !== undefined && Number(stockNow) !== Number(pr.stock_qty || 0)) {
        const extra = Number(stockNow) - Number(pr.stock_qty || 0);
        await api.post('stock/adjust', extra > 0 && why === 'opening'
          ? { product_id: id, mode: 'opening', qty: String(extra), reason: t('Stock already in hand (entered later)') }
          : extra < 0 && less === 'mistake'
            ? { product_id: id, mode: 'mistake', qty: String(-extra), reason: t('Entered too much by mistake') }
            : { product_id: id, mode: 'set', qty: String(stockNow), reason: t('Count corrected on the product page') });
      }
      if (made) { toast(t('Saved — now set what goes into it')); navigate(`/products/${saved.id}?recipe=1`); return; }
      if (again) { toast(t('{n} added — add the next one', { n: saved.name })); form(el); return; }
      toast(t('Saved'));
      navigate(`/products/${saved.id}`);
    } catch (err) {
      if (err.errors && Object.keys(err.errors).some((k) => more.querySelector(`[name="${k}"]`))) more.open = true;
      throw err;
    }
  }, { success: '' });
  const p = page(id ? t('Edit {n}', { n: pr.name }) : t('New product'), { back: id ? `/products/${id}` : '/products' });
  p.body.append(f);
  mount(el, p.el);
}
