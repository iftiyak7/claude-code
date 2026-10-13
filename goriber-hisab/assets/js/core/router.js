/**
 * Hash router: #/sales/12 → { name, params }. Views are lazy-loaded
 * modules exporting `default async function(el, params, query)`.
 */
const routes = [];
let handler = null;

export function route(pattern, load, meta = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ pattern, re, keys, load, meta });
}

export function current() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params, query: Object.fromEntries(new URLSearchParams(qs)), path };
    }
  }
  return { route: null, params: {}, query: {}, path };
}

export function navigate(path, replace = false) {
  const target = '#' + path;
  if (replace) history.replaceState(null, '', target);
  else if (location.hash !== target) location.hash = target;
  else if (handler) handler(current());
  if (replace && handler) handler(current());
}

export function start(onRoute) {
  handler = onRoute;
  window.addEventListener('hashchange', () => onRoute(current()));
  onRoute(current());
}

/** Update the query string without navigation side effects. */
export function setQuery(query) {
  const { path } = current();
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString();
  history.replaceState(null, '', `#${path}${qs ? '?' + qs : ''}`);
}
