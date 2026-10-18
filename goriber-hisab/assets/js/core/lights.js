/**
 * Stock lights: red (order now), yellow (getting low), green (fine).
 */
import { h } from './dom.js';
import { t } from './i18n.js';
import { qty } from './format.js';

export const LEVELS = [['red', 'Red'], ['yellow', 'Yellow'], ['green', 'Green']];
const HINT = { red: 'Order now', yellow: 'Getting low', green: 'Enough stock' };

/** The light itself (red ones glow). */
export function light(level, label = '') {
  return h('span', { class: `light light-${level}`, role: 'img', 'aria-label': label || t(HINT[level]) });
}

/** Three counters; each opens the list of that colour. */
export function lightCounts(d, href = (level) => `#/stock-status?level=${level}`) {
  return h('div', { class: 'light-counts' }, LEVELS.map(([lv, name]) => h('a', { class: `light-count lc-${lv}`, href: href(lv) },
    light(lv), h('b', {}, String(d.counts[lv])), h('span', {}, t(name)), h('small', {}, t(HINT[lv])))));
}

/** One product row. */
export function lightRow(p) {
  return h('li', {}, h('a', { href: `#/products/${p.id}`, class: 'light-row' },
    light(p.level),
    h('span', { class: 'grow' }, h('strong', {}, p.name), p.sku ? h('small', { class: 'muted' }, ` · ${p.sku}`) : null),
    h('span', { class: `lq lq-${p.level}` }, `${qty(p.qty)}${p.unit ? ` ${p.unit}` : ''}`)));
}
