/**
 * UI kit: toasts, dialogs, forms, tables, comboboxes. Accessible by
 * default (labels, roles, focus management, keyboard support).
 */
import { h, mount, debounce } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { navigate, setQuery } from './router.js';
import { money, date } from './format.js';

/* ------------------------------------------------------------------ Toasts */

let toastHost;
export function toast(message, type = 'success', ms = 3500) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast toast-${type}` }, icon(type === 'error' ? 'alert' : 'check', 18), h('span', {}, message));
  toastHost.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

/** Show an API/validation error in a toast with a plain-language message. */
export function showError(err) {
  const fields = err?.errors && Object.keys(err.errors).length;
  toast(fields ? t('Please fix the highlighted fields.') + ' ' + Object.values(err.errors)[0] : (err?.message || t('Something went wrong.')), 'error', 6000);
}

/* ------------------------------------------------------------------ Dialogs */

export function modal({ title, body, actions = [], size = 'md', onClose } = {}) {
  const dialog = h('dialog', { class: `modal modal-${size}`, 'aria-label': title });
  const close = (value) => {
    if (!dialog.open) return;
    dialog.close();
    dialog.remove();
    onClose?.(value);
  };
  mount(dialog,
    h('header', { class: 'modal-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Close'), onclick: () => close() }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('footer', { class: 'modal-foot' }, actions) : null);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
  const first = dialog.querySelector('input:not([type=hidden]),select,textarea,button.btn-primary');
  first?.focus();
  return { dialog, close };
}

export function confirmDialog(message, { title = t('Please confirm'), confirmText = t('Confirm'), danger = false, reason = false } = {}) {
  return new Promise((resolve) => {
    const input = reason ? h('textarea', { class: 'input', rows: 2, placeholder: t('Reason (optional)') }) : null;
    const m = modal({
      title,
      size: 'sm',
      body: [h('p', {}, message), input],
      actions: [
        h('button', { class: 'btn', type: 'button', onclick: () => m.close(false) }, t('Cancel')),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => m.close(reason ? { reason: input.value } : true) }, confirmText),
      ],
      onClose: (v) => resolve(v || false),
    });
  });
}

/* ------------------------------------------------------------------ Layout */

export function page(title, { actions = [], back = null, subtitle = '' } = {}) {
  const body = h('div', { class: 'page-body' });
  const el = h('section', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', { class: 'page-title' },
        back ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Back'), onclick: () => (typeof back === 'function' ? back() : navigate(back)) }, icon('back')) : null,
        h('div', {}, h('h1', {}, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null)),
      h('div', { class: 'page-actions' }, actions)),
    body);
  document.title = `${title} · Goriber Hisab`;
  return { el, body };
}

export function card(title, ...children) {
  return h('div', { class: 'card' }, title ? h('h3', { class: 'card-title' }, title) : null, children);
}

export function stat(label, value, { tone = '', hint = '', onclick } = {}) {
  return h(onclick ? 'button' : 'div', { class: `stat ${tone}`, type: onclick ? 'button' : null, onclick },
    h('span', { class: 'stat-label' }, label),
    h('strong', { class: 'stat-value' }, value ?? '—'),
    hint ? h('span', { class: 'stat-hint' }, hint) : null);
}

export function empty(message, action) {
  return h('div', { class: 'empty' }, icon('search', 32), h('p', {}, message), action || null);
}

export function spinner() {
  return h('div', { class: 'loading' }, h('div', { class: 'spinner', role: 'status', 'aria-label': t('Loading') }));
}

const STATUS_TONE = { paid: 'ok', completed: 'ok', active: 'ok', partial: 'warn', due: 'bad', void: 'muted', held: 'info', draft: 'info', suspended: 'bad', inactive: 'muted' };
export function badge(status, label) {
  return h('span', { class: `badge badge-${STATUS_TONE[status] || 'info'}` }, label || t(status ? status.charAt(0).toUpperCase() + status.slice(1) : ''));
}

export function tabs(items, active, onSelect) {
  return h('div', { class: 'tabs', role: 'tablist' },
    items.map(([key, label]) => h('button', {
      class: `tab ${key === active ? 'active' : ''}`, role: 'tab', type: 'button', 'aria-selected': String(key === active), onclick: () => onSelect(key),
    }, label)));
}

/* ------------------------------------------------------------------ Forms */

let fieldSeq = 0;

/**
 * Labelled control. `control` is an input/select/textarea element whose
 * `name` maps to API error keys.
 */
export function field(label, control, { hint = '', required = false, wide = false } = {}) {
  const id = control.id || `f${++fieldSeq}`;
  control.id = id;
  if (required) control.required = true;
  return h('div', { class: `field ${wide ? 'wide' : ''}`, dataset: { field: control.name || '' } },
    h('label', { for: id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
    control,
    hint ? h('small', { class: 'hint' }, hint) : null,
    h('small', { class: 'error', role: 'alert' }));
}

export function input(name, value = '', props = {}) {
  return h('input', { class: 'input', name, value: value ?? '', autocomplete: 'off', ...props });
}

export function money_input(name, value = '', props = {}) {
  return input(name, value, { inputmode: 'decimal', pattern: '[0-9]*[.,]?[0-9]*', ...props });
}

export function textarea(name, value = '', props = {}) {
  const el = h('textarea', { class: 'input', name, rows: 3, ...props });
  el.value = value ?? '';
  return el;
}

export function select(name, options, value = '', props = {}) {
  const el = h('select', { class: 'input', name, ...props },
    options.map((o) => {
      const [v, label] = Array.isArray(o) ? o : [o.id ?? o.value, o.name ?? o.label];
      return h('option', { value: v, selected: String(v) === String(value) }, label);
    }));
  return el;
}

export function checkbox(name, checked = false, label = '') {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', name, checked }), h('span', {}, label));
}

/** Read named controls inside a container into an object. */
export function values(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  });
  return out;
}

/** Show API field errors next to fields; focus the first. */
export function showFieldErrors(root, errors = {}) {
  root.querySelectorAll('.field.has-error').forEach((f) => {
    f.classList.remove('has-error');
    const e = f.querySelector('.error');
    if (e) e.textContent = '';
  });
  let first = null;
  for (const [key, message] of Object.entries(errors)) {
    const f = root.querySelector(`.field[data-field="${CSS.escape(key)}"]`) || root.querySelector(`.field[data-field="${CSS.escape(key.split('.')[0])}"]`);
    if (!f) continue;
    f.classList.add('has-error');
    f.querySelector('.error').textContent = message;
    first = first || f.querySelector('input,select,textarea');
  }
  first?.focus();
}

/**
 * Wire a submit handler with busy state, error display and toasts.
 * `submit` receives values and returns a promise.
 */
export function bindForm(form, submit, { success = t('Saved') } = {}) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    if (btn?.disabled) return;
    if (btn) { btn.disabled = true; btn.classList.add('busy'); }
    showFieldErrors(form, {});
    try {
      const res = await submit(values(form));
      if (success) toast(success);
      return res;
    } catch (err) {
      showFieldErrors(form, err.errors || {});
      showError(err);
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('busy'); }
    }
  });
  return form;
}

/* ------------------------------------------------------------------ Tables */

/**
 * Server-paginated list.
 * columns: [{ key, label, render(row), align: 'right', hide: 'sm' }]
 * fetch(params) => Promise<{items,total,page,pages,summary?}>
 */
export function dataTable({ columns, fetch, filters = [], rowHref, query = {}, searchPlaceholder = t('Search…'), footer, emptyText = t('Nothing here yet.'), perPage = 25 }) {
  const state = { page: Number(query.page || 1), search: query.search || '', filters: { ...query } };
  delete state.filters.page; delete state.filters.search;
  const body = h('div', { class: 'table-wrap' });
  const pager = h('div', { class: 'pager' });
  const foot = h('div', { class: 'table-foot' });

  const searchInput = h('input', { class: 'input search', type: 'search', placeholder: searchPlaceholder, value: state.search, 'aria-label': searchPlaceholder });
  const filterEls = filters.map((f) => {
    const el = f.control;
    if (state.filters[el.name] !== undefined) el.value = state.filters[el.name];
    el.addEventListener('change', () => { state.filters[el.name] = el.type === 'checkbox' ? (el.checked ? 1 : '') : el.value; state.page = 1; load(); });
    return f.label ? h('label', { class: 'filter' }, h('span', {}, f.label), el) : el;
  });
  searchInput.addEventListener('input', debounce(() => { state.search = searchInput.value; state.page = 1; load(); }, 300));

  let seq = 0;
  async function load() {
    const mine = ++seq;
    body.classList.add('is-loading');
    const params = { ...state.filters, search: state.search, page: state.page, per_page: perPage };
    setQuery({ ...state.filters, search: state.search, page: state.page > 1 ? state.page : '' });
    try {
      const res = await fetch(params);
      if (mine !== seq) return;
      render(res);
    } catch (err) {
      if (mine !== seq) return;
      mount(body, empty(err.message));
    } finally {
      body.classList.remove('is-loading');
    }
  }

  function render(res) {
    const items = res.items || [];
    if (!items.length) {
      mount(body, empty(state.search ? t('No results for "{q}".', { q: state.search }) : emptyText));
    } else {
      mount(body, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: [c.align === 'right' ? 'num' : '', c.hide ? `hide-${c.hide}` : ''], scope: 'col' }, c.label)))),
        h('tbody', {}, items.map((row) => {
          const href = rowHref ? rowHref(row) : null;
          return h('tr', {
            class: href ? 'clickable' : '',
            tabindex: href ? 0 : null,
            onclick: href ? () => navigate(href) : null,
            onkeydown: href ? (e) => { if (e.key === 'Enter') navigate(href); } : null,
          }, columns.map((c) => h('td', { class: [c.align === 'right' ? 'num' : '', c.hide ? `hide-${c.hide}` : ''], 'data-label': c.label }, c.render ? c.render(row) : row[c.key] ?? '')));
        }))));
    }
    mount(pager,
      h('span', { class: 'muted' }, t('{n} records', { n: res.total ?? items.length })),
      h('div', { class: 'pager-btns' },
        h('button', { class: 'btn btn-sm', type: 'button', disabled: state.page <= 1, onclick: () => { state.page -= 1; load(); } }, t('Previous')),
        h('span', {}, `${state.page} / ${Math.max(1, res.pages || 1)}`),
        h('button', { class: 'btn btn-sm', type: 'button', disabled: state.page >= (res.pages || 1), onclick: () => { state.page += 1; load(); } }, t('Next'))));
    mount(foot, footer ? footer(res) : null);
  }

  // On phones the filters fold away behind one button so the list is visible.
  const filterBox = h('div', { class: 'filters' }, filterEls);
  const filterBtn = filterEls.length ? h('button', { class: 'btn filter-toggle', type: 'button', 'aria-expanded': 'false', onclick: () => {
    const open = !filterBox.classList.contains('open');
    filterBox.classList.toggle('open', open);
    filterBtn.setAttribute('aria-expanded', String(open));
  } }, icon('menu', 16), t('Filters')) : null;
  const el = h('div', { class: 'data-table' },
    h('div', { class: 'toolbar' }, searchInput, filterBtn, filterBox),
    body, foot, pager);
  load();
  return { el, reload: load };
}

/** Static (non-paginated) table for reports. */
export function simpleTable(columns, rows, { totals } = {}) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.align === 'right' ? 'num' : '', scope: 'col' }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, columns.map((c) => h('td', { class: c.align === 'right' ? 'num' : '', 'data-label': c.label }, c.render ? c.render(r) : r[c.key] ?? ''))))),
    totals ? h('tfoot', {}, h('tr', {}, columns.map((c, i) => h('th', { class: c.align === 'right' ? 'num' : '' }, i === 0 ? t('Total') : (totals[c.key] !== undefined ? (c.money ? money(totals[c.key]) : totals[c.key]) : ''))))) : null));
}

/* ------------------------------------------------------------------ Combobox */

/**
 * Async searchable picker.
 * search(q) => Promise<items>; label(item); sub(item); onPick(item).
 */
export function combobox({ placeholder, search, label, sub, onPick, value = '', autofocus = false, name = '', onEnter }) {
  const listId = `cb${++fieldSeq}`;
  const inputEl = h('input', { class: 'input', type: 'search', placeholder, value, autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': listId, autofocus, name });
  const list = h('ul', { class: 'combo-list', id: listId, role: 'listbox', hidden: true });
  let items = [];
  let active = -1;
  let seq = 0;

  const close = () => { list.hidden = true; inputEl.setAttribute('aria-expanded', 'false'); active = -1; };
  const pick = (item) => { close(); onPick(item); };
  const paint = () => {
    mount(list, items.length ? items.map((it, i) => h('li', {
      role: 'option', class: i === active ? 'active' : '', 'aria-selected': String(i === active),
      onmousedown: (e) => { e.preventDefault(); pick(it); },
    }, h('span', {}, label(it)), sub ? h('small', {}, sub(it)) : null)) : h('li', { class: 'muted' }, t('No matches')));
    list.hidden = false;
    inputEl.setAttribute('aria-expanded', 'true');
  };
  const run = debounce(async () => {
    const q = inputEl.value.trim();
    const mine = ++seq;
    try {
      const res = await search(q);
      if (mine !== seq) return;
      items = res; active = items.length ? 0 : -1; paint();
    } catch { /* ignore network errors while typing */ }
  }, 200);

  inputEl.addEventListener('input', run);
  inputEl.addEventListener('focus', () => { if (!inputEl.value) run(); });
  inputEl.addEventListener('blur', () => setTimeout(close, 150));
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (onEnter && onEnter(inputEl.value.trim())) { inputEl.value = ''; close(); return; }
      if (!list.hidden && items[active]) pick(items[active]);
    } else if (e.key === 'Escape') close();
  });
  return { el: h('div', { class: 'combo' }, inputEl, list), input: inputEl, clear: () => { inputEl.value = ''; close(); } };
}

/* ------------------------------------------------------------------ Misc */

export function dateRange(onChange, initial = 'this_month') {
  const presets = [['today', t('Today')], ['yesterday', t('Yesterday')], ['7d', t('Last 7 days')], ['this_month', t('This month')], ['last_month', t('Last month')], ['this_year', t('This year')], ['custom', t('Custom range')]];
  const sel = select('range', presets, initial, { 'aria-label': t('Period') });
  const from = input('from', '', { type: 'date', 'aria-label': t('From') });
  const to = input('to', '', { type: 'date', 'aria-label': t('To') });
  const custom = h('span', { class: 'custom-range', hidden: initial !== 'custom' }, from, to);
  const emit = () => onChange(sel.value === 'custom' ? { from: from.value, to: to.value } : { range: sel.value });
  sel.addEventListener('change', () => { custom.hidden = sel.value !== 'custom'; if (sel.value !== 'custom') emit(); });
  from.addEventListener('change', () => { if (from.value && to.value) emit(); });
  to.addEventListener('change', () => { if (from.value && to.value) emit(); });
  return h('div', { class: 'date-range' }, sel, custom);
}

export function downloadText(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export { money, date };
