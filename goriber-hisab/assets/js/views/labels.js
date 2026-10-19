/**
 * Barcode labels: pick products (or all of them), choose a label size —
 * thermal roll or A4 sticker sheet — and print. Works in the browser and in
 * the Android app (native print service).
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can, state } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, date as fmtDate } from '../core/format.js';
import { page, card, field, input, select, combobox, toast, showError, empty, modal } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { barcodeSvg } from '../core/barcode.js';
import { printHere } from '../core/printer.js';

/** w/h in mm. Sheets: A4 with a cols × rows grid starting at (left, top). */
export const LABEL_SIZES = {
  roll_38x25: { w: 38, h: 25, label: 'Roll 38 × 25 mm' },
  roll_40x30: { w: 40, h: 30, label: 'Roll 40 × 30 mm' },
  roll_50x25: { w: 50, h: 25, label: 'Roll 50 × 25 mm' },
  roll_50x30: { w: 50, h: 30, label: 'Roll 50 × 30 mm' },
  roll_58x40: { w: 58, h: 40, label: 'Roll 58 × 40 mm' },
  a4_3x8: { w: 70, h: 37, cols: 3, rows: 8, left: 0, top: 0.5, label: 'A4 sheet 3 × 8 (70 × 37 mm, 24 labels)' },
  a4_4x10: { w: 48.5, h: 25.4, cols: 4, rows: 10, left: 8, top: 21.5, label: 'A4 sheet 4 × 10 (48.5 × 25.4 mm, 40 labels)' },
  a4_5x13: { w: 38.1, h: 21.2, cols: 5, rows: 13, left: 9.75, top: 10.7, label: 'A4 sheet 5 × 13 (38.1 × 21.2 mm, 65 labels)' },
  custom: { w: 50, h: 30, label: 'Custom size' },
};

/** Extra lines a label can carry. Each can be on/off, with one value for all labels or a value per product. */
export const EXTRAS = [
  ['mrp', 'MRP', 'number'],
  ['mfg', 'MFG date', 'date'],
  ['exp', 'EXP date', 'date'],
  ['pkg', 'PKG date', 'date'],
  ['batch', 'Batch no.', 'text'],
  ['net', 'Net weight', 'text'],
  ['note', 'Your own text', 'text'],
];

const KEY = 'gh.labels';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const save = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* private mode */ } };

export default async function labels(el, params, query) {
  const saved = { size: 'roll_38x25', w: 50, h: 30, shop: true, name: true, price: true, code: true, extra: {}, ...load() };
  saved.extra = saved.extra || {};
  let items = []; // {product_id, variant_id, name, code, price, copies}

  const sizeSel = select('size', Object.entries(LABEL_SIZES).map(([k, v]) => [k, t(v.label)]), saved.size);
  const cw = input('w', String(saved.w), { type: 'number', min: 15, max: 120, step: '0.5' });
  const ch = input('h', String(saved.h), { type: 'number', min: 10, max: 120, step: '0.5' });
  const custom = h('div', { class: 'row' }, field(t('Width (mm)'), cw), field(t('Height (mm)'), ch));
  const opt = (k, label) => { const c = h('input', { type: 'checkbox', checked: !!saved[k] }); c.addEventListener('change', changed); return [k, c, h('label', { class: 'check' }, c, h('span', {}, label))]; };
  const opts = [opt('shop', t('Shop name')), opt('name', t('Product name')), opt('price', t('Price')), opt('code', t('Code number'))];
  // MRP, MFG / EXP / PKG dates, batch, weight, own text: tick to show; the value here is for every label
  // (set a different one per product with ✎ in the list).
  const extras = EXTRAS.map(([k, label, type]) => {
    const on = h('input', { type: 'checkbox', checked: !!saved.extra[k]?.on });
    const val = h('input', { class: 'input input-sm', type: type === 'number' ? 'number' : type, value: saved.extra[k]?.v || '', placeholder: type === 'number' ? t('product price') : type === 'text' ? t('e.g. {x}', { x: k === 'net' ? '500 g' : k === 'batch' ? 'B-1024' : t('Made in Bangladesh') }) : '' });
    on.addEventListener('change', changed);
    val.addEventListener('input', () => { if (val.value && !on.checked) on.checked = true; changed(); });
    return [k, on, val, h('div', { class: 'extra-row' }, h('label', { class: 'check' }, on, h('span', {}, t(label))), val)];
  });
  const preset = (which) => {
    const set = { barcode: [], price: ['price', 'code'], full: ['shop', 'name', 'price', 'code'] }[which];
    for (const [k, c] of opts) c.checked = set.includes(k);
    for (const [k, on] of extras) on.checked = which === 'full' ? on.checked || ['mfg', 'exp'].includes(k) : false;
    if (which === 'price') for (const [k, c] of opts) if (k === 'name') c.checked = true;
    changed();
  };
  const allCopies = input('all', '', { type: 'number', min: 1, max: 500, placeholder: t('e.g. 10') });
  const listBox = h('div');
  const preview = h('div', { class: 'label-preview' });
  const summary = h('p', { class: 'muted small' });

  function settings() {
    const o = { size: sizeSel.value, w: Number(cw.value) || 50, h: Number(ch.value) || 30 };
    for (const [k, c] of opts) o[k] = c.checked;
    o.extra = {};
    for (const [k, on, val] of extras) o.extra[k] = { on: on.checked, v: val.value };
    return o;
  }
  function changed() {
    const o = settings();
    save(o);
    custom.hidden = o.size !== 'custom';
    paintPreview();
  }
  sizeSel.addEventListener('change', changed);
  cw.addEventListener('input', changed);
  ch.addEventListener('input', changed);

  async function addIds(ids) {
    if (!ids.length) return;
    try {
      const got = await api.get('products/labels', { ids: ids.join(',') });
      const have = new Set(items.map((i) => `${i.product_id}:${i.variant_id}`));
      for (const it of got) if (!have.has(`${it.product_id}:${it.variant_id}`)) items.push({ ...it, copies: 1 });
      paint();
    } catch (err) { showError(err); }
  }

  async function addAll() {
    try {
      const ids = [];
      for (let pg = 1; pg <= 10; pg++) {
        const r = await api.get('products', { per_page: 300, page: pg, type: 'standard' });
        ids.push(...r.items.map((p) => p.id));
        if (pg >= (r.pages || 1)) break;
      }
      await addIds(ids);
    } catch (err) { showError(err); }
  }

  async function generate() {
    const ids = [...new Set(items.filter((i) => !i.code).map((i) => i.product_id))];
    try {
      const r = await api.post('products/barcodes', ids.length ? { ids: ids.join(',') } : {});
      const n = r.products + r.variants;
      toast(n ? t('{n} barcodes created', { n }) : t('Every product already has a barcode.'));
      if (items.length) {
        const all = [...new Set(items.map((i) => i.product_id))];
        const copies = new Map(items.map((i) => [`${i.product_id}:${i.variant_id}`, i.copies]));
        items = [];
        await addIds(all);
        items.forEach((i) => { i.copies = copies.get(`${i.product_id}:${i.variant_id}`) || 1; });
        paint();
      }
    } catch (err) { showError(err); }
  }

  const search = combobox({
    placeholder: t('Search a product to add…'),
    search: async (q) => (await api.get('products', { search: q, per_page: 12 })).items,
    label: (p) => p.name,
    sub: (p) => [p.barcode || p.sku, money(p.selling_price)].filter(Boolean).join(' · '),
    onPick: (p) => { search.clear(); addIds([p.id]); },
  });

  function paint() {
    const missing = items.filter((i) => !i.code).length;
    if (!items.length) {
      mount(listBox, empty(t('Add products to print their labels.')));
    } else {
      mount(listBox,
        missing ? h('div', { class: 'callout row' }, t('{n} items have no barcode yet.', { n: missing }), ' ',
          can('products.edit') ? h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: generate }, icon('barcode', 16), t('Create barcodes')) : null) : null,
        h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', {}, t('Product')), h('th', {}, t('Barcode')), h('th', { class: 'num' }, t('Price')), h('th', { class: 'num' }, t('Copies')), h('th', {}))),
          h('tbody', {}, items.map((it, i) => {
            const n = h('input', { class: 'input input-sm', type: 'number', min: 0, max: 500, value: it.copies, style: 'width:80px' });
            n.addEventListener('input', () => { it.copies = Math.max(0, Math.min(500, Number(n.value) || 0)); paintPreview(); });
            return h('tr', {},
              h('td', {}, it.name),
              h('td', {}, it.code ? h('code', {}, it.code) : h('span', { class: 'badge badge-warn' }, t('No barcode'))),
              h('td', { class: 'num' }, money(it.price)),
              h('td', { class: 'num' }, n),
              h('td', { class: 'row', style: 'flex-wrap:nowrap' },
                h('button', { class: `btn btn-sm ${it.extra && Object.values(it.extra).some(Boolean) ? 'btn-primary' : ''}`, type: 'button', title: t('Dates & details for this product'), 'aria-label': t('Dates & details for this product'), onclick: () => editItem(it) }, icon('edit', 14)),
                h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', 'aria-label': t('Remove'), onclick: () => { items.splice(i, 1); paint(); } }, icon('x', 16))));
          })))));
    }
    paintPreview();
  }

  function paintPreview() {
    const o = settings();
    const ready = items.filter((i) => i.code && i.copies > 0);
    const total = ready.reduce((s, i) => s + i.copies, 0);
    const size = sizeOf(o);
    summary.textContent = total ? t('{n} labels', { n: total }) + (size.cols ? ' · ' + t('{n} A4 pages', { n: Math.ceil(total / (size.cols * size.rows)) }) : '') : '';
    const sample = ready[0] || { name: t('Sample product'), code: '2000000000015', price: '120' };
    mount(preview, h('div', { class: 'label-preview-box' }, labelEl(sample, o, size)), h('small', { class: 'muted' }, `${size.w} × ${size.h} mm`));
  }

  // Different MFG / EXP / MRP… for one product (empty = use the value for all).
  function editItem(it) {
    it.extra = it.extra || {};
    const ins = EXTRAS.map(([k, label, type]) => [k, field(t(label), input(k, it.extra[k] || '', { type: type === 'number' ? 'number' : type, placeholder: t('same as all labels') }))]);
    const m = modal({
      title: it.name, size: 'sm',
      body: h('div', { class: 'form' }, h('p', { class: 'muted small' }, t('Only for this product. Leave empty to use the value set for all labels.')), h('div', { class: 'form-grid' }, ins.map(([, f]) => f))),
      actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
        for (const [k, f] of ins) { it.extra[k] = f.querySelector('input').value; }
        // Turn the line on when a product gets its own value.
        for (const [k, on] of extras) if (it.extra[k] && !on.checked) on.checked = true;
        m.close(); changed(); paint();
      } }, t('Save'))],
    });
  }

  const ready = () => items.filter((i) => i.code && i.copies > 0);
  const downloadBtn = h('button', { class: 'btn', type: 'button', onclick: async (e) => {
    if (!ready().length) { toast(t('Add products with a barcode first.'), 'error'); return; }
    await downloadLabels(ready(), settings(), e.currentTarget);
  } }, icon('download', 16), t('Download PDF'));

  const printBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
    const o = settings();
    const ready = items.filter((i) => i.code && i.copies > 0);
    if (!ready.length) { toast(t('Add products with a barcode first.'), 'error'); return; }
    printLabels(ready, o);
  } }, icon('printer', 16), t('Print labels'));

  const p = page(t('Barcode labels'), {
    back: '/products',
    actions: [
      h('button', { class: 'btn btn-sm', type: 'button', onclick: addAll }, icon('products', 16), t('Add all products')),
      can('products.edit') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: generate, title: t('Give every product without a barcode its own code') }, icon('barcode', 16), t('Create missing barcodes')) : null,
    ],
  });
  p.body.append(h('div', { class: 'grid-2 labels-layout' },
    card(t('Products'), search.el,
      h('div', { class: 'row', style: 'margin:10px 0' }, h('span', { class: 'muted small' }, t('Same copies for all')), allCopies,
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { const n = Math.max(1, Math.min(500, Number(allCopies.value) || 1)); items.forEach((i) => { i.copies = n; }); paint(); } }, t('Apply'))),
      listBox),
    card(t('Label size & content'),
      h('div', { class: 'form' }, field(t('Label size'), sizeSel), custom,
        h('div', { class: 'row wrap' }, h('span', { class: 'muted small' }, t('Quick:')),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => preset('barcode') }, t('Barcode only')),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => preset('price') }, t('Name + price')),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => preset('full') }, t('Everything'))),
        h('div', { class: 'label-opts' }, opts.map(([, , l]) => l)),
        h('h4', { class: 'extras-title' }, t('More on the sticker')),
        h('div', { class: 'extras' }, extras.map((x) => x[3]))),
      h('h4', {}, t('Preview')), preview, summary,
      h('div', { class: 'row', style: 'margin-top:12px' }, printBtn, downloadBtn),
      h('p', { class: 'muted small' }, t('Thermal label printer: choose the same paper size in the print dialog and set margins to none. Sticker sheets: print on A4 at 100% scale (not "fit to page").')))));
  mount(el, p.el);
  custom.hidden = saved.size !== 'custom';
  paint();
  if (query.ids) addIds(String(query.ids).split(',').map(Number).filter(Boolean));
}

function sizeOf(o) {
  const base = LABEL_SIZES[o.size] || LABEL_SIZES.roll_38x25;
  return o.size === 'custom' ? { ...base, w: Math.max(15, Math.min(120, o.w)), h: Math.max(10, Math.min(120, o.h)) } : base;
}

/** The extra lines for one label: the product's own value, else the value for all. */
function extraLines(it, o) {
  const val = (k) => (it.extra?.[k] || o.extra?.[k]?.v || '');
  const on = (k) => !!o.extra?.[k]?.on;
  const d = (v) => (v ? fmtDate(v) : '');
  const dates = [['mfg', 'MFG'], ['pkg', 'PKG'], ['exp', 'EXP']].filter(([k]) => on(k) && val(k)).map(([k, l]) => `${l}: ${d(val(k))}`);
  const info = [on('batch') && val('batch') ? `${t('Batch')}: ${val('batch')}` : '', on('net') && val('net') ? `${t('Net')}: ${val('net')}` : ''].filter(Boolean);
  return {
    dates,
    info,
    note: on('note') ? val('note') : '',
    mrp: on('mrp') ? (val('mrp') || it.price) : '',
  };
}

/** One label, sized in real millimetres. */
function labelEl(it, o, size) {
  const x = extraLines(it, o);
  const lines = (o.shop ? 1 : 0) + (o.name ? 1 : 0) + (x.dates.length ? Math.ceil(x.dates.length / 2) : 0) + (x.info.length ? 1 : 0) + (x.note ? 1 : 0) + (o.code || o.price || x.mrp ? 1 : 0);
  const pt = Math.max(4.5, Math.min(11, (size.h * 0.27) / Math.max(1, 1 + (lines - 3) * 0.22)));
  const shop = state.business?.name || '';
  const priceText = x.mrp ? `MRP ${money(x.mrp)}` : o.price ? money(it.price) : '';
  return h('div', { class: 'gh-label', style: `width:${size.w}mm;height:${size.h}mm;font-size:${pt}pt` },
    o.shop && shop ? h('div', { class: 'gh-l-shop' }, shop) : null,
    o.name ? h('div', { class: 'gh-l-name' }, it.name) : null,
    h('div', { class: 'gh-l-bar' }, barcodeSvg(it.code, 50)),
    o.code || priceText ? h('div', { class: 'gh-l-foot' }, o.code ? h('span', {}, it.code) : null, priceText ? h('strong', {}, priceText) : null) : null,
    x.dates.length ? h('div', { class: 'gh-l-dates' }, x.dates.map((dt) => h('span', {}, dt))) : null,
    x.info.length ? h('div', { class: 'gh-l-info' }, x.info.join(' · ')) : null,
    x.note ? h('div', { class: 'gh-l-note' }, x.note) : null);
}

/** Same pages as printing, drawn into a PDF (one page per roll label, or per A4 sheet). */
async function downloadLabels(items, o, btn) {
  const size = sizeOf(o);
  const all = [];
  for (const it of items) for (let i = 0; i < it.copies; i++) all.push(labelEl(it, o, size));
  if (all.length > 600) { toast(t('Too many labels for one PDF. Download at most 600 at a time.'), 'error'); return; }
  const load = (src) => new Promise((res, rej) => { const el = document.createElement('script'); el.src = `${window.BZL.assetsUrl}${src}?v=${window.BZL.version}`; el.onload = res; el.onerror = rej; document.head.append(el); });
  try {
    if (typeof window.html2canvas !== 'function') await load('vendor/html2canvas.min.js');
    if (typeof window.ghPdfFrom !== 'function') await load('js/sticker-pdf.js');
  } catch { toast(t('Could not prepare the PDF.'), 'error'); return; }
  const box = h('div', { class: 'label-pdf-stage' });
  let pages;
  if (size.cols) {
    const per = size.cols * size.rows;
    pages = [];
    for (let i = 0; i < all.length; i += per) {
      pages.push(h('div', { class: 'gh-sheet-pdf', style: `padding:${size.top}mm 0 0 ${size.left}mm;grid-template-columns:repeat(${size.cols},${size.w}mm);grid-auto-rows:${size.h}mm` }, all.slice(i, i + per)));
    }
  } else {
    pages = all;
  }
  box.append(...pages);
  document.body.append(box);
  try {
    const name = `barcode-labels-${new Date().toISOString().slice(0, 10)}.pdf`;
    await window.ghPdfFrom(pages, name, btn, size.cols ? 2 : 4);
    toast(t('PDF downloaded'));
  } finally { box.remove(); }
}

/** Print through an overlay that is the only thing visible on paper. */
export function printLabels(items, o) {
  const size = sizeOf(o);
  document.getElementById('label-print-root')?.remove();
  document.getElementById('label-print-css')?.remove();
  const all = [];
  for (const it of items) for (let i = 0; i < it.copies; i++) all.push(labelEl(it, o, size));
  if (all.length > 3000) { toast(t('Too many labels at once. Print at most 3000.'), 'error'); return; }

  let root;
  let pageCss;
  if (size.cols) {
    const per = size.cols * size.rows;
    const pages = [];
    for (let i = 0; i < all.length; i += per) {
      pages.push(h('div', { class: 'gh-sheet', style: `padding:${size.top}mm 0 0 ${size.left}mm;grid-template-columns:repeat(${size.cols},${size.w}mm);grid-auto-rows:${size.h}mm` }, all.slice(i, i + per)));
    }
    root = h('div', { id: 'label-print-root' }, pages);
    pageCss = '@page{size:A4 portrait;margin:0}';
  } else {
    root = h('div', { id: 'label-print-root', class: 'gh-roll' }, all);
    pageCss = `@page{size:${size.w}mm ${size.h}mm;margin:0}`;
  }
  const css = h('style', { id: 'label-print-css' }, pageCss);
  document.head.append(css);
  document.body.append(root);
  const cleanup = () => { root.remove(); css.remove(); window.removeEventListener('hashchange', cleanup); };
  // The Android print dialog renders later, so keep the overlay until the user leaves the page.
  window.addEventListener('hashchange', cleanup);
  if (!window.GoriberHisabNative) window.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(printHere, 150);
}
