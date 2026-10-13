/**
 * Tiny DOM helpers. All text goes through textContent (never innerHTML), so
 * user data can't inject markup.
 */

/**
 * Create an element.
 *   h('button', { class: 'btn', onclick: fn }, 'Save')
 * Props: class, style (object|string), dataset, on* handlers, boolean
 * attributes, and anything else as attributes. Children: nodes, strings,
 * numbers, arrays, null/false (skipped).
 */
export function h(tag, props = {}, ...children) {
  const el = tag === 'svg' || tag === 'path' || tag === 'polyline' || tag === 'line' || tag === 'rect' || tag === 'circle' || tag === 'g' || tag === 'text'
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' && 'value' in el) el.value = value;
    else if (key === 'checked' || key === 'selected' || key === 'disabled') el[key] = !!value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Replace all children of el. */
export function mount(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Debounce a function. */
export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** UUID v4 for idempotent offline-safe writes. */
export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
