/**
 * Notifications inbox, audit log and the offline sync queue.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can, emit } from '../core/state.js';
import { t } from '../core/i18n.js';
import { datetime, money } from '../core/format.js';
import { page, card, dataTable, input, select, empty, toast, showError, confirmDialog, tabs } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';
import { queued, sync, discard } from '../core/offline.js';

export default async function notifications(el, params, query) {
  const path = location.hash.split('?')[0];
  if (path === '#/audit') return audit(el, query);
  if (path === '#/sync') return syncQueue(el);

  const p = page(t('Notifications'), {
    actions: [
      can('audit.view') ? h('a', { class: 'btn btn-sm', href: '#/audit' }, icon('audit', 16), t('Audit log')) : null,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { await api.post('notifications/read', {}); emit('unread', 0); notifications(el, params, query); } }, icon('check', 16), t('Mark all read')),
    ],
  });
  const res = await api.get('notifications', { per_page: 100 });
  const link = (n) => {
    const d = n.data || {};
    if (d.product_id) return `/products/${d.product_id}`;
    if (d.sale_id) return `/sales/${d.sale_id}`;
    if (d.purchase_id) return `/purchases/${d.purchase_id}`;
    if (d.payment_id) return `/payments/${d.payment_id}`;
    if (n.type === 'customer_due') return '/reports/dues';
    if (n.type === 'supplier_due') return '/reports/dues-supplier';
    if (n.type === 'backup_reminder') return '/settings/data';
    return null;
  };
  p.body.append(card(null, res.items.length ? h('ul', { class: 'list notifications' }, res.items.map((n) => {
    const href = link(n);
    return h('li', { class: n.read_at ? '' : 'unread' }, h(href ? 'a' : 'div', { href: href ? `#${href}` : null, onclick: async () => { if (!n.read_at) { await api.post('notifications/read', { ids: [n.id] }); } } },
      h('span', { class: `sev sev-${n.severity}` }, icon(n.severity === 'warning' ? 'alert' : n.severity === 'success' ? 'check' : 'bell', 18)),
      h('span', { class: 'grow' }, h('strong', {}, n.title), h('small', { class: 'muted' }, ` ${n.body || ''}`)),
      h('small', { class: 'muted' }, datetime(n.created_at))));
  })) : empty(t('You are all caught up.'))));
  mount(el, p.el);
  if (res.unread) { await api.post('notifications/read', {}); emit('unread', 0); }
}

function audit(el, query) {
  if (!can('audit.view')) { mount(el, empty(t('You do not have access to the audit log.'))); return; }
  const p = page(t('Audit log'), { back: '/notifications', subtitle: t('Who did what, and when. Entries cannot be edited or deleted.') });
  p.body.append(dataTable({
    query,
    filters: [
      { control: select('object_type', [['', t('Everything')], ['sale', t('Sales')], ['purchase', t('Purchases')], ['payment', t('Payments')], ['product', t('Products')], ['customer', t('Customers')], ['supplier', t('Suppliers')], ['expense', t('Expenses')], ['stock', t('Stock')], ['settings', t('Settings')], ['member', t('Users')], ['journal', t('Journal')]], '') },
      { control: select('action', [['', t('All actions')], ['create', t('Created')], ['update', t('Edited')], ['void', t('Voided')], ['delete', t('Deleted')], ['adjust', t('Adjusted')], ['export', t('Exported')], ['backup', t('Backup')]], '') },
      { control: input('from', '', { type: 'date', 'aria-label': t('From') }) },
      { control: input('to', '', { type: 'date', 'aria-label': t('To') }) },
    ],
    fetch: (q) => api.get('audit', q),
    columns: [
      { label: t('When'), render: (r) => datetime(r.created_at) },
      { label: t('User'), render: (r) => r.user_name || `#${r.user_id}` },
      { label: t('Action'), render: (r) => t(r.action) },
      { label: t('What'), render: (r) => r.summary },
      { label: t('Changes'), hide: 'sm', render: (r) => (r.changes && Object.keys(r.changes).length ? h('details', {}, h('summary', {}, t('{n} fields', { n: Object.keys(r.changes).length })),
        h('ul', { class: 'small' }, Object.entries(r.changes).map(([k, v]) => h('li', {}, `${k}: `, Array.isArray(v) ? `${v[0]} → ${v[1]}` : JSON.stringify(v))))) : '') },
      { label: t('IP'), hide: 'sm', key: 'ip_address' },
    ],
  }).el);
  mount(el, p.el);
}

async function syncQueue(el) {
  const p = page(t('Offline sales'), {
    subtitle: navigator.onLine ? t('Online — queued sales sync automatically.') : t('You are offline. Sales are saved on this device.'),
    actions: [h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !navigator.onLine, onclick: async () => { await sync(); syncQueue(el); } }, t('Sync now'))],
  });
  const items = await queued();
  p.body.append(card(null, items.length ? h('ul', { class: 'list' }, items.map((q) => h('li', {},
    h('div', { class: 'grow' },
      h('strong', {}, new Date(q.created).toLocaleString()),
      h('small', { class: 'muted' }, ` · ${q.payload.items.length} ${t('items')} · ${money(q.payload.payments.reduce((a, x) => a + Number(x.amount), 0).toString())}`),
      q.error ? h('p', { class: 'bad-text' }, q.error) : null),
    h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', onclick: async () => {
      if (!(await confirmDialog(t('Discard this offline sale? It will not be recorded.'), { danger: true, confirmText: t('Discard') }))) return;
      await discard(q.uuid); toast(t('Discarded')); syncQueue(el);
    } }, t('Discard'))))) : empty(t('Nothing waiting to sync.'))));
  mount(el, p.el);
  void navigate; void showError; void tabs;
}
