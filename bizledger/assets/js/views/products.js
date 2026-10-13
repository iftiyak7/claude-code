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

export default async function products(el, params, query) {
  const path = location.hash.split('?')[0];
  if (path.endsWith('/new')) return form(el);
  if (path.endsWith('/edit')) return form(el, Number(params.id));
  if (params.id) return detail(el, Number(params.id));

  const cats = state.me.categories || [];
  const p = page(t('Products'), {
    actions: [
      can('data.import') ? h('a', { class: 'btn btn-sm', href: '#/settings/data' }, icon('upload', 16), t('Import')) : null,
      can('data.export') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const r = await api.get('export/products', query); downloadText(r.filename, r.csv); } }, icon('download', 16), t('Export')) : null,
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
      { label: t('Stock'), align: 'right', render: (r) => (r.track_stock ? h('span', { class: r.is_low ? 'bad-text' : '' }, `${qty(r.stock_qty)} ${r.unit_name || ''}`) : t('Service')) },
      { label: t('Status'), hide: 'sm', render: (r) => badge(r.status) },
    ],
  });
  p.body.append(table.el);
  mount(el, p.el);
}

async function detail(el, id) {
  const pr = await api.get(`products/${id}`);
  const reload = () => detail(el, id);
  const p = page(pr.name, {
    back: '/products',
    subtitle: [pr.sku, pr.barcode].filter(Boolean).join(' · '),
    actions: [
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => labels(pr) }, icon('barcode', 16), t('Labels')),
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
      pr.track_stock ? h('div', { class: `stat ${pr.is_low ? 'bad' : ''}` }, h('span', { class: 'stat-label' }, t('In stock (this branch)')), h('strong', { class: 'stat-value' }, qty(pr.stock_qty)), h('span', { class: 'stat-hint' }, t('Minimum {n}', { n: qty(pr.min_stock) }))) : null),
    h('div', { class: 'grid-2' },
      pr.track_stock ? card(t('Stock by branch'), pr.stock.length ? simpleTable([
        { label: t('Branch'), render: (s) => branches[Number(s.branch_id)] || s.branch_name },
        { label: t('Variant'), render: (s) => (Number(s.variant_id) ? (pr.variants.find((v) => v.id === Number(s.variant_id))?.name || '#' + s.variant_id) : '—') },
        { label: t('Qty'), align: 'right', render: (s) => qty(s.qty) },
        { label: t('Avg cost'), align: 'right', render: (s) => (s.avg_cost === null ? '—' : money(s.avg_cost)) },
        { label: t('Value'), align: 'right', render: (s) => (s.value === null ? '—' : money(s.value)) },
      ], pr.stock) : h('p', { class: 'muted' }, t('No stock yet.'))) : null,
      card(t('Barcode'), pr.barcode || pr.sku ? h('div', { class: 'barcode-box' }, barcodeSvg(pr.barcode || pr.sku), h('code', {}, pr.barcode || pr.sku)) : h('p', { class: 'muted' }, t('No barcode. Edit the product to add one, or let BizLedger generate it.')))),
    variantsCard(pr, reload),
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

/** Print barcode labels (browser print, label sheet or thermal). */
function labels(pr) {
  const count = input('count', '12', { type: 'number', min: 1, max: 200 });
  const showPrice = h('input', { type: 'checkbox', checked: true });
  const m = modal({
    title: t('Print labels'), size: 'sm',
    body: h('div', { class: 'form' }, field(t('How many labels'), count), h('label', { class: 'check' }, showPrice, h('span', {}, t('Show price')))),
    actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
      const code = pr.barcode || pr.sku || String(pr.id);
      const n = Math.max(1, Math.min(200, Number(count.value) || 1));
      const w = window.open('', '_blank');
      if (!w) return;
      const doc = w.document;
      doc.title = `${pr.name} labels`;
      const style = doc.createElement('style');
      style.textContent = '@page{margin:6mm}body{font:11px system-ui;margin:0}.sheet{display:grid;grid-template-columns:repeat(auto-fill,minmax(48mm,1fr));gap:3mm}.lbl{border:1px dashed #ccc;padding:2mm;text-align:center;break-inside:avoid}.lbl svg{width:100%;height:12mm}.n{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media print{.lbl{border:0}}';
      doc.head.append(style);
      const sheet = doc.createElement('div');
      sheet.className = 'sheet';
      for (let i = 0; i < n; i++) {
        const l = doc.createElement('div');
        l.className = 'lbl';
        const name = doc.createElement('div'); name.className = 'n'; name.textContent = pr.name;
        l.append(name, doc.importNode(barcodeSvg(code), true));
        const c = doc.createElement('div'); c.textContent = code + (showPrice.checked ? ` · ${money(pr.selling_price)}` : '');
        l.append(c);
        sheet.append(l);
      }
      doc.body.append(sheet);
      setTimeout(() => w.print(), 300);
      m.close();
    } }, icon('printer', 16), t('Print'))],
  });
}

async function form(el, id = 0) {
  if (!can(id ? 'products.edit' : 'products.create')) { mount(el, empty(t('You do not have permission for this.'))); return; }
  const pr = id ? await api.get(`products/${id}`) : { track_stock: true, type: 'standard', status: 'active' };
  const opt = (list, empty_label) => [['', empty_label], ...(list || []).map((x) => [x.id, x.name])];
  const taxes = state.me.tax_rates || [];
  const typeSel = select('type', [['standard', t('Stock item')], ['service', t('Service (no stock)')]], pr.type);
  const stockFields = h('div', { class: 'form-grid' },
    field(t('Minimum stock (alert level)'), money_input('min_stock', Number(pr.min_stock) ? pr.min_stock : '')),
    !id ? field(t('Opening stock'), money_input('opening_qty', ''), { hint: t('Quantity on hand right now') }) : null,
    !id && can('products.cost') ? field(t('Opening unit cost'), money_input('opening_cost', ''), { hint: t('Defaults to purchase price') }) : null);
  typeSel.addEventListener('change', () => { stockFields.hidden = typeSel.value === 'service'; });
  stockFields.hidden = pr.type === 'service';

  const imageId = input('image_id', pr.image_id || '', { type: 'hidden' });
  const imgPreview = h('div', { class: 'img-preview' }, pr.image_url ? h('img', { src: pr.image_url, alt: '' }) : null);
  const upload = h('input', { type: 'file', accept: 'image/*', class: 'input' });
  upload.addEventListener('change', async () => {
    if (!upload.files[0]) return;
    try { const r = await api.upload(upload.files[0], 'product'); imageId.value = r.id; mount(imgPreview, h('img', { src: r.url, alt: '' })); }
    catch (err) { showError(err); }
  });

  const f = h('form', { class: 'form' },
    card(t('Basics'), h('div', { class: 'form-grid' },
      field(t('Product name'), input('name', pr.name, { required: true, autofocus: true }), { required: true }),
      field(t('Type'), typeSel),
      field(t('Category'), select('category_id', opt(state.me.categories, t('None')), pr.category_id || '')),
      field(t('Brand'), select('brand_id', opt(state.me.brands, t('None')), pr.brand_id || '')),
      field(t('Unit'), select('unit_id', opt(state.me.units, t('None')), pr.unit_id || ''), { hint: t('For loose items (nuts, rice, oil) choose kg or litre — the POS will ask for the weight.') }),
      field(t('SKU'), input('sku', pr.sku)),
      field(t('Barcode'), input('barcode', pr.barcode), { hint: t('Scan it in, or leave empty') }),
      !id ? h('div', { class: 'field' }, checkbox('auto_barcode', true, t('Generate a barcode if empty'))) : null,
      field(t('Status'), select('status', [['active', t('Active')], ['inactive', t('Inactive')]], pr.status)))),
    card(t('Prices'), h('div', { class: 'form-grid' },
      field(t('Selling price'), money_input('selling_price', pr.selling_price && Number(pr.selling_price) ? pr.selling_price : '', { required: true }), { required: true }),
      can('products.cost') ? field(t('Purchase price'), money_input('purchase_price', pr.purchase_price && Number(pr.purchase_price) ? pr.purchase_price : '')) : null,
      field(t('Wholesale price'), money_input('wholesale_price', Number(pr.wholesale_price) ? pr.wholesale_price : '')),
      field(t('Minimum selling price'), money_input('min_selling_price', Number(pr.min_selling_price) ? pr.min_selling_price : ''), { hint: t('Staff cannot sell below this') }),
      state.settings['tax.enabled'] ? field(state.settings['tax.label'], select('tax_rate_id', [['', t('Business default')], ...taxes.map((r) => [r.id, `${r.name} (${Number(r.rate)}%)`])], pr.tax_rate_id || '')) : null)),
    card(t('Stock'), stockFields),
    card(t('Image & description'), h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', {}, t('Image')), imgPreview, upload, imageId),
      field(t('Description'), textarea('description', pr.description), { wide: true }))),
    h('div', { class: 'form-actions sticky' }, h('a', { class: 'btn', href: id ? `#/products/${id}` : '#/products' }, t('Cancel')), h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, t('Save product'))));

  bindForm(f, async (v) => {
    const saved = id ? await api.put(`products/${id}`, v) : await api.post('products', v);
    navigate(`/products/${saved.id}`);
  });
  const p = page(id ? t('Edit {n}', { n: pr.name }) : t('New product'), { back: id ? `/products/${id}` : '/products' });
  p.body.append(f);
  mount(el, p.el);
}
