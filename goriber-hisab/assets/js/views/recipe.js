/**
 * Recipes: a product made from other products when it is sold
 * (honey nuts from cashew, almond, walnut…). Selling it takes the
 * ingredients out of stock at their real cost, so the profit is right.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can } from '../core/state.js';
import { t } from '../core/i18n.js';
import { money, qty } from '../core/format.js';
import { card, modal, select, toast, showError, combobox, simpleTable, field, money_input, checkbox } from '../core/ui.js';
import { icon } from '../core/icons.js';

const num = (v) => Number(v) || 0;
const sizeName = (pr, vid) => (vid ? (pr.variants || []).find((v) => v.id === Number(vid))?.name || `#${vid}` : t('All sizes'));
const priceFor = (pr, vid) => num(vid ? (pr.variants || []).find((v) => v.id === Number(vid))?.selling_price : pr.selling_price);

/** "300g" / "300 গ্রাম" → 0.3 when the ingredient is counted in kg (same for ml → L). */
export function smallUnit(text, unit) {
  const m = String(text).trim().match(/^([\d.]+)\s*(g|gm|gram|grams|গ্রাম|ml|মিলি)$/i);
  if (!m) return text;
  const big = /^(kg|কেজি|l|লিটার|ltr)$/i.test(String(unit || '').trim());
  return big ? String(Number(m[1]) / 1000) : m[1];
}

/** "500 g" / "1 kg" / "250gm" / "1 L" → how much loose stock one of this size takes (in kg / L). */
export function sizeAmount(v) {
  const text = `${v.attributes?.size || ''} ${v.attributes?.weight || ''} ${v.name || ''}`;
  const m = text.match(/([\d.]+)\s*(kg|কেজি|g|gm|gram|গ্রাম|l|ltr|লিটার|ml|মিলি)\b/i) || text.match(/([\d.]+)\s*(কেজি|গ্রাম|লিটার|মিলি)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!n) return null;
  return /^(g|gm|gram|গ্রাম|ml|মিলি)$/i.test(m[2]) ? n / 1000 : n;
}

/** Sizes filled from the product's own loose stock: set every size's recipe in one go. */
function looseSetup(pr, reload) {
  const plan = (pr.variants || []).map((v) => ({ v, amount: sizeAmount(v) }));
  const ok = plan.filter((x) => x.amount);
  if (!ok.length) return null;
  const unit = pr.unit_name || t('unit');
  return h('div', { class: 'loose-setup' },
    h('strong', {}, t('Are the sizes filled from this product\'s loose stock?')),
    h('p', { class: 'muted small' }, t('e.g. honey bought in 5 / 20 kg jars and filled into bottles. The stock without a size is the loose stock.')),
    h('ul', {}, plan.map(({ v, amount }) => h('li', {}, amount ? t('{s} bottle ← {q} {u} loose', { s: v.name, q: String(amount), u: unit }) : t('{s}: set by hand', { s: v.name })))),
    can('products.edit') ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async (e) => {
      e.currentTarget.disabled = true;
      try {
        for (const { v, amount } of ok) await api.put(`products/${pr.id}/recipe`, { variant_id: v.id, mode: 'pack', items: [{ product_id: pr.id, variant_id: 0, qty: String(amount) }] });
        toast(t('Done. Use "Pack now" when you fill bottles.'));
        reload();
      } catch (err) { showError(err); e.currentTarget.disabled = false; }
    } }, icon('check', 14), t('Yes, set it up')) : null);
}

/** Product page card: what it is made of, cost and profit per unit, how many can be made. */
export function recipeCard(pr, reload, { open = false } = {}) {
  if (pr.type === 'service') return null;
  const box = h('div', {}, h('p', { class: 'muted' }, t('Loading…')));
  const c = card(t('Recipe (made from)'), box);
  c.classList.add('recipe-card');
  const edit = (data) => recipeEditor(pr, data, () => reload());
  api.get(`products/${pr.id}/recipe`).then((data) => {
    if (!data.recipes.length) {
      mount(box,
        (pr.variants || []).length ? looseSetup(pr, reload) : null,
        h('p', { class: 'muted' }, t('Made in the shop from other products (e.g. honey nuts from cashew, almond, walnut)? Write once how much of each goes into 1 unit. Every sale then takes those ingredients out of stock at their real cost, so the profit is always right.')),
        can('products.edit') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => edit(data) }, icon('plus', 14), t('Set recipe')) : null);
      if (open && can('products.edit')) edit(data);
      return;
    }
    const packAhead = data.mode === 'pack';
    mount(box,
      h('p', { class: 'recipe-mode' }, packAhead
        ? t('Packed ahead: packed units sell first; when they run out, the rest is packed from the bulk automatically.')
        : t('Made when sold: it keeps no stock of its own.')),
      packAhead && can('inventory.adjust') ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => packDialog(pr, data, reload) }, icon('inventory', 14), t('Pack now')) : null,
      data.make_qty !== null ? h('div', { class: 'recipe-make' }, icon('check', 16), t('Ingredients in stock are enough to make {n} {u}', { n: qty(data.make_qty), u: pr.unit_name || '' })) : null,
      ...data.recipes.map((r) => {
        const sell = priceFor(pr, r.variant_id);
        const cost = r.cost === null ? null : num(r.cost);
        return h('div', { class: 'recipe-block' },
          (pr.variants || []).length ? h('h4', {}, sizeName(pr, r.variant_id)) : null,
          h('p', { class: 'muted small' }, t('For 1 {u}:', { u: pr.unit_name || t('unit') })),
          simpleTable([
            { label: t('Ingredient'), render: (i) => (i.product_id === pr.id ? `${i.name} (${t('loose')})` : i.name) },
            { label: t('Qty'), align: 'right', render: (i) => `${qty(i.qty)} ${i.unit}` },
            { label: t('In stock'), align: 'right', hide: 'sm', render: (i) => h('span', { class: num(i.stock_qty) < num(i.qty) ? 'bad-text' : '' }, `${qty(i.stock_qty)} ${i.unit}`) },
            cost === null ? null : { label: t('Cost'), align: 'right', render: (i) => money(i.cost) },
          ].filter(Boolean), r.items),
          cost === null ? null : h('div', { class: 'recipe-sum' },
            h('span', {}, t('Cost {c}', { c: money(String(cost)) })),
            h('span', {}, t('Selling price {p}', { p: money(String(sell)) })),
            h('strong', { class: sell - cost < 0 ? 'bad-text' : 'ok-text' }, sell - cost < 0 ? t('Loss {x}', { x: money(String(cost - sell)) }) : t('Profit {x}', { x: money(String(sell - cost)) }))));
      }),
      can('products.edit') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => edit(data) }, icon('edit', 14), t('Edit recipe')) : null);
  }).catch((err) => mount(box, h('p', { class: 'bad-text' }, err.message)));
  return c;
}

/** Editor: pick ingredients and how much of each goes into 1 unit (per size if needed). */
export function recipeEditor(pr, data, onSaved) {
  const variants = pr.variants || [];
  const scopes = [0, ...variants.map((v) => v.id)];
  const rows = {};
  scopes.forEach((vid) => {
    const r = data.recipes.find((x) => Number(x.variant_id) === vid);
    rows[vid] = r ? r.items.map((i) => ({ ...i, unit_cost: i.unit_cost === null ? null : num(i.unit_cost), options: null })) : [];
  });
  let scope = 0;
  let mode = data.recipes.length ? data.mode : (variants.length || Number(pr.stock_qty) > 0 ? 'pack' : 'sale');
  const modeBox = h('div', { class: 'recipe-modes', role: 'radiogroup' });
  const paintMode = () => mount(modeBox, [
    ['pack', t('I pack some ahead'), t('e.g. honey bottles: a few are kept packed. Packed ones sell first; if they run out, the rest is packed from the bulk when sold.')],
    ['sale', t('Made when sold'), t('e.g. honey nuts mixed to order. No stock of its own.')],
  ].map(([m, title, sub]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(mode === m), class: `recipe-mode-opt ${mode === m ? 'on' : ''}`, onclick: () => { mode = m; paintMode(); } }, h('strong', {}, title), h('small', {}, sub))));
  paintMode();
  const list = h('div', { class: 'recipe-rows' });
  // A size can be filled from this product's own loose stock (honey jars → bottles).
  const looseBtn = h('button', { class: 'btn btn-sm', type: 'button', hidden: true, onclick: () => {
    const v = variants.find((x) => x.id === scope);
    const amount = v ? sizeAmount(v) : null;
    rows[scope].push({ product_id: pr.id, variant_id: 0, name: pr.name, unit: pr.unit_name || '', qty: amount ? String(amount) : '', unit_cost: pr.purchase_price === null ? null : num(pr.purchase_price), options: null });
    mode = 'pack'; paintMode(); paint();
  } }, icon('plus', 14), t('From this product\'s loose stock'));
  const sum = h('div', { class: 'recipe-sum' });
  const scopeSel = variants.length ? select('scope', scopes.map((vid) => [String(vid), vid ? sizeName(pr, vid) : t('All sizes (unless a size has its own)')]), '0') : null;
  scopeSel?.addEventListener('change', () => { scope = Number(scopeSel.value); paint(); });

  const picker = combobox({
    placeholder: t('Add ingredient — search product'),
    search: async (q) => (await api.get('products', { search: q, per_page: 12, type: 'standard' })).items.filter((p) => p.id !== pr.id && !(p.has_recipe && !p.track_stock)),
    label: (p) => p.name,
    sub: (p) => `${t('Stock')} ${qty(p.stock_qty)} ${p.unit_name || ''}${p.purchase_price !== null ? ' · ' + money(p.purchase_price) : ''}`,
    onPick: async (p) => {
      const row = { product_id: p.id, variant_id: 0, name: p.name, unit: p.unit_name || '', qty: '', unit_cost: p.purchase_price === null ? null : num(p.purchase_price), options: null };
      if (p.has_variants) {
        try { row.options = (await api.get(`products/${p.id}`)).variants; } catch (err) { showError(err); return; }
        if (row.options.length) { row.variant_id = row.options[0].id; row.unit_cost = row.options[0].purchase_price === null ? row.unit_cost : num(row.options[0].purchase_price); }
      }
      rows[scope].push(row);
      picker.clear();
      paint();
      list.querySelectorAll('input[data-qty]')[rows[scope].length - 1]?.focus();
    },
  });

  function paintSum() {
    const items = rows[scope];
    const known = items.every((i) => i.unit_cost !== null);
    if (!items.length || !known) { mount(sum); return; }
    const cost = items.reduce((s, i) => s + num(i.qty) * i.unit_cost, 0);
    const sell = priceFor(pr, scope);
    mount(sum,
      h('span', {}, t('Cost of 1 {u}: {c}', { u: pr.unit_name || t('unit'), c: money(String(cost.toFixed(2))) })),
      sell ? h('strong', { class: sell - cost < 0 ? 'bad-text' : 'ok-text' }, sell - cost < 0 ? t('Loss {x}', { x: money(String((cost - sell).toFixed(2))) }) : t('Profit {x}', { x: money(String((sell - cost).toFixed(2))) })) : null);
  }

  function paint() {
    const items = rows[scope];
    looseBtn.hidden = !scope || items.some((i) => i.product_id === pr.id);
    mount(list, items.length ? items.map((i, n) => {
      const q = h('input', { class: 'input', inputmode: 'decimal', value: i.qty, placeholder: '0', 'data-qty': '1', 'aria-label': t('Qty') });
      q.addEventListener('input', () => { i.qty = q.value; paintSum(); });
      q.addEventListener('blur', () => { const v = smallUnit(q.value, i.unit); if (v !== q.value) { q.value = v; i.qty = v; paintSum(); } });
      const vsel = i.options && i.options.length ? select('v', i.options.map((o) => [String(o.id), o.name]), String(i.variant_id)) : null;
      vsel?.addEventListener('change', () => { i.variant_id = Number(vsel.value); const o = i.options.find((x) => x.id === i.variant_id); if (o && o.purchase_price !== null) i.unit_cost = num(o.purchase_price); paintSum(); });
      return h('div', { class: 'recipe-row' },
        h('div', { class: 'recipe-name' }, h('strong', {}, i.product_id === pr.id ? `${i.name} (${t('loose')})` : i.name), vsel),
        h('div', { class: 'recipe-qty' }, q, h('span', { class: 'muted' }, i.unit || '')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Remove'), onclick: () => { items.splice(n, 1); paint(); } }, icon('trash', 16)));
    }) : h('p', { class: 'muted' }, scope ? t('No own recipe — this size uses the general one.') : t('No ingredients yet. Search and add them below.')));
    paintSum();
  }
  paint();

  const body = h('div', { class: 'recipe-editor' },
    h('p', { class: 'muted' }, t('How much of each ingredient goes into 1 {u} of {n}? You can type 300g for 0.3 kg.', { u: pr.unit_name || t('unit'), n: pr.name })),
    modeBox,
    scopeSel ? h('div', { class: 'field' }, h('label', {}, t('Size')), scopeSel) : null,
    list,
    looseBtn,
    picker.el,
    sum);

  const m = modal({
    title: t('Recipe — {n}', { n: pr.name }),
    body,
    size: 'lg',
    actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        for (const vid of scopes) {
          const had = data.recipes.some((x) => Number(x.variant_id) === vid);
          if (!had && !rows[vid].length) continue;
          await api.put(`products/${pr.id}/recipe`, { variant_id: vid, mode, items: rows[vid].map((i) => ({ product_id: i.product_id, variant_id: i.variant_id, qty: String(i.qty).trim() })) });
        }
        m.close();
        toast(t('Recipe saved'));
        onSaved();
      } catch (err) { showError(err); } finally { btn.disabled = false; }
    } }, icon('check', 16), t('Save recipe'))],
  });
}

/** Pack ahead: fill a few bottles from the bulk (or unpack ones packed by mistake). */
export function packDialog(pr, data, onDone, variantId = null) {
  const variants = pr.variants || [];
  const own = new Set(data.recipes.map((r) => Number(r.variant_id)));
  const general = own.has(0);
  const sizes = variants.length ? variants.filter((v) => own.has(v.id) || general) : [];
  if (variants.length && !sizes.length) { toast(t('Set the recipe first: what goes into 1 unit.'), 'error'); return; }
  const sizeSel = sizes.length ? select('variant_id', sizes.map((v) => [String(v.id), `${v.name} — ${t('packed')} ${qty(v.stock_qty)}`]), String(variantId || sizes[0].id)) : null;
  const qtyIn = money_input('qty', '', { placeholder: '0', autofocus: true, inputmode: 'numeric' });
  const undo = checkbox('unpack', false, t('Unpack (packed by mistake / opened again)'));
  const preview = h('div', { class: 'pack-preview' });
  const recipeFor = () => {
    const vid = sizeSel ? Number(sizeSel.value) : 0;
    return data.recipes.find((r) => Number(r.variant_id) === vid) || data.recipes.find((r) => Number(r.variant_id) === 0);
  };
  const paint = () => {
    const n = num(qtyIn.value);
    const r = recipeFor();
    if (!r || !n) { mount(preview, h('p', { class: 'muted' }, t('Type how many you packed.'))); return; }
    const back = undo.querySelector('input').checked;
    mount(preview,
      h('p', { class: 'muted small' }, back ? t('Goes back:') : t('Taken from stock:')),
      h('ul', { class: 'pack-list' }, r.items.map((i) => {
        const need = num(i.qty) * n;
        const short = !back && need > num(i.stock_qty);
        return h('li', { class: short ? 'bad-text' : '' }, `${i.name}: ${qty(String(+need.toFixed(4)))} ${i.unit}`, short ? ` (${t('only {n} in stock', { n: qty(i.stock_qty) })})` : '');
      })),
      r.cost !== null ? h('p', {}, t('Cost of each: {c}', { c: money(String((num(r.cost)).toFixed(2))) })) : null);
  };
  qtyIn.addEventListener('input', paint);
  sizeSel?.addEventListener('change', paint);
  undo.querySelector('input').addEventListener('change', paint);
  paint();
  const m = modal({
    title: t('Pack — {n}', { n: pr.name }),
    body: h('div', { class: 'form' }, h('div', { class: 'form-grid' },
      sizeSel ? field(t('Size'), sizeSel) : null,
      field(t('How many did you pack?'), qtyIn)), preview, undo),
    actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const back = undo.querySelector('input').checked;
        const res = await api.post('stock/pack', { product_id: pr.id, variant_id: sizeSel ? Number(sizeSel.value) : 0, qty: qtyIn.value, unpack: back });
        m.close();
        toast(back ? t('Unpacked. Packed now: {n}', { n: qty(res.stock) }) : t('Packed. Packed now: {n}', { n: qty(res.stock) }));
        onDone?.();
      } catch (err) { showError(err); } finally { btn.disabled = false; }
    } }, icon('check', 16), t('Save'))],
  });
}
