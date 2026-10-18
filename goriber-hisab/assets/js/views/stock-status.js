/**
 * Stock status: every product with its light — red (order now), yellow
 * (getting low), green (fine). The marks are set in Settings → Inventory.
 */
import { h, mount, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { can } from '../core/state.js';
import { t } from '../core/i18n.js';
import { qty } from '../core/format.js';
import { page, card, empty, spinner, modal, field, input, toast, showError } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { light, lightCounts, lightRow, LEVELS } from '../core/lights.js';

export default async function stockStatus(el, params, query) {
  const level = ['red', 'yellow', 'green'].includes(query.level) ? query.level : '';
  const p = page(t('Stock status'), {
    back: '/',
    subtitle: t('Red: order now · Yellow: getting low · Green: enough stock.'),
    actions: [
      can('settings.manage') ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => marks(() => stockStatus(el, params, query)) }, icon('settings', 16), t('Set limits')) : null,
      can('purchases.create') ? h('a', { class: 'btn btn-primary btn-sm', href: '#/purchases/new' }, icon('plus', 16), t('Buy stock')) : null,
    ],
  });
  const head = h('div');
  const search = h('input', { class: 'input', type: 'search', placeholder: t('Search product, SKU or barcode'), value: query.search || '' });
  const listBox = h('div', {}, spinner());
  p.body.append(head, h('div', { class: 'status-pills', style: 'margin:12px 0' }), h('div', { class: 'toolbar' }, search), listBox);
  const pills = p.body.querySelector('.status-pills');
  mount(el, p.el);

  async function load() {
    const d = await api.get('stock/lights', { level, search: search.value, limit: 1000 });
    mount(head, lightCounts(d), h('p', { class: 'muted small' }, t('Red at or below {r} (or the product\'s own minimum) · yellow up to {y} · green above {y}.', { r: qty(d.marks.red), y: qty(d.marks.yellow) })));
    const all = d.counts.red + d.counts.yellow + d.counts.green;
    mount(pills, [['', t('All'), all], ...LEVELS.map(([lv, name]) => [lv, t(name), d.counts[lv]])].map(([lv, label, n]) =>
      h('a', { class: `pill ${lv === level ? 'on' : ''}`, href: `#/stock-status${lv ? `?level=${lv}` : ''}` }, lv ? light(lv) : null, label, h('span', {}, String(n)))));
    mount(listBox, d.items.length ? card(null, h('ul', { class: 'list light-list' }, d.items.map(lightRow)))
      : card(null, empty(level === 'red' ? t('Nothing is about to run out.') : t('No products here.'))));
  }
  search.addEventListener('input', debounce(() => load().catch(showError), 300));
  load().catch((err) => mount(listBox, empty(err.message)));
}

/** Change the red / yellow marks. */
async function marks(done) {
  const s = await api.get('settings');
  const S = s.settings || s;
  const red = input('red', S['inventory.stock_red'] ?? 5, { type: 'number', min: 0 });
  const yellow = input('yellow', S['inventory.stock_yellow'] ?? 10, { type: 'number', min: 0 });
  const m = modal({
    title: t('Stock light limits'), size: 'sm',
    body: h('div', { class: 'form' },
      field([light('red'), ' ', t('Red light at or below')], red, { hint: t('A product\'s own minimum stock also turns it red.') }),
      field([light('yellow'), ' ', t('Yellow light at or below')], yellow),
      h('p', { class: 'muted small' }, light('green'), ' ', t('More than the yellow limit is green.'))),
    actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      if (Number(yellow.value) < Number(red.value)) { toast(t('Yellow must be at least the red limit.'), 'info'); return; }
      try { await api.put('settings', { settings: { 'inventory.stock_red': Number(red.value), 'inventory.stock_yellow': Number(yellow.value) } }); m.close(); toast(t('Saved')); done(); } catch (err) { showError(err); }
    } }, t('Save'))],
  });
}
