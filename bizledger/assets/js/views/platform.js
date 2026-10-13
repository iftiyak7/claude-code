/**
 * Platform panel (site owner only): open shops for clients, collect monthly /
 * yearly payments, approve renewal requests, set prices.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { t } from '../core/i18n.js';
import { date, datetime } from '../core/format.js';
import { page, card, stat, tabs, field, input, select, textarea, modal, toast, showError, showFieldErrors, values, badge, confirmDialog, simpleTable, empty, spinner, dataTable } from '../core/ui.js';
import { icon } from '../core/icons.js';

const METHODS = [['bkash', 'bKash'], ['nagad', 'Nagad'], ['rocket', 'Rocket'], ['bank', 'Bank'], ['cash', 'Cash']];
const SUB_TONE = { active: 'active', trial: 'held', grace: 'partial', expired: 'due', suspended: 'suspended', unlimited: 'completed' };
const SUB_LABEL = { active: 'Active', trial: 'Trial', grace: 'Grace period', expired: 'Expired', suspended: 'Suspended', unlimited: 'No limit' };

let cfg = null;
let loginUrl = '';
const tk = (amount) => `${cfg?.currency || '৳'}${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function subBadge(sub) {
  return badge(SUB_TONE[sub.status] || 'info', t(SUB_LABEL[sub.status] || sub.status));
}

function daysText(sub) {
  if (sub.days_left === null || sub.days_left === undefined) return '';
  if (sub.days_left > 0) return t('{n} days left', { n: sub.days_left });
  if (sub.days_left === 0) return t('Ends today');
  return t('{n} days overdue', { n: -sub.days_left });
}

export default async function platform(el, params, query) {
  if (!state.me.platform?.admin) { mount(el, empty(t('Only the site owner can manage shops.'))); return; }
  mount(el, spinner());
  const o = await api.get('platform');
  cfg = o.config;
  loginUrl = o.login_url;
  const tab = query.tab || 'shops';
  const s = o.stats;
  const go = (k) => { location.hash = `#/platform?tab=${k}`; };

  const p = page(t('Shops & subscriptions'), {
    subtitle: t('Open shops for clients and collect monthly / yearly payments.'),
    actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openShop(o.types, () => platform(el, params, { tab: 'shops' })) }, icon('plus', 16), t('Open new shop'))],
  });
  p.body.append(
    h('div', { class: 'stats' },
      stat(t('Shops'), String(s.shops), { onclick: () => go('shops') }),
      stat(t('Active'), String(s.active), { tone: 'ok' }),
      stat(t('Trial'), String(s.trial)),
      stat(t('Ending in 7 days'), String(s.expiring), { tone: s.expiring ? 'warn' : '' }),
      stat(t('Expired'), String(s.expired), { tone: s.expired ? 'bad' : '' }),
      stat(t('Payment requests'), String(s.pending), { tone: s.pending ? 'warn' : '', onclick: () => go('payments') }),
      stat(t('Collected this month'), tk(s.collected_month), { tone: 'ok' }),
      stat(t('Collected total'), tk(s.collected_total))),
    tabs([['shops', t('Shops')], ['payments', `${t('Payments')}${s.pending ? ` (${s.pending})` : ''}`], ['settings', t('Prices & settings')]], tab, go));
  const body = h('div', { class: 'tab-body' });
  p.body.append(body);
  mount(el, p.el);
  const reload = () => platform(el, params, query);

  if (tab === 'shops') {
    const status = select('status', [['all', t('All shops')], ['active', t('Active')], ['expiring', t('Ending in 7 days')], ['expired', t('Expired')], ['trial', t('Trial')], ['suspended', t('Suspended')]], 'all', { 'aria-label': t('Status') });
    const table = dataTable({
      query,
      searchPlaceholder: t('Search shop, phone, email…'),
      filters: [{ control: status }],
      fetch: (prm) => api.get('platform/shops', prm),
      emptyText: t('No shops yet. Click "Open new shop" to create the first one.'),
      columns: [
        { label: t('Shop'), render: (x) => h('span', { class: 'cell-stack' }, h('strong', {}, x.name), h('small', { class: 'muted' }, x.owner ? `${x.owner.name} · ${x.owner.email}` : '')) },
        { label: t('Phone'), key: 'phone', hide: 'sm' },
        { label: t('Status'), render: (x) => subBadge(x.subscription) },
        { label: t('Paid until'), render: (x) => (x.subscription.paid_until ? h('span', { class: 'cell-stack' }, date(x.subscription.paid_until), h('small', { class: x.subscription.days_left < 0 ? 'bad-text' : 'muted' }, daysText(x.subscription))) : '—') },
        { label: t('Collected'), align: 'right', render: (x) => tk(x.collected), hide: 'sm' },
        { label: t('Last active'), render: (x) => (x.last_seen_at ? datetime(x.last_seen_at) : t('Never')), hide: 'sm' },
        { label: '', render: (x) => h('span', { class: 'row' }, x.pending ? badge('partial', t('{n} request', { n: x.pending })) : null, h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => { e.stopPropagation(); manageShop(x.id, reload); } }, t('Manage'))) },
      ],
    });
    body.append(card(null, table.el));
  } else if (tab === 'payments') {
    const status = select('status', [['pending', t('Waiting for approval')], ['approved', t('Approved')], ['rejected', t('Rejected')], ['all', t('All')]], query.status || 'pending', { 'aria-label': t('Status') });
    const table = dataTable({
      query: { status: 'pending', ...query },
      filters: [{ control: status }],
      fetch: (prm) => api.get('platform/payments', prm),
      emptyText: t('No payments here.'),
      footer: (res) => h('p', { class: 'muted' }, `${t('Approved total')}: ${tk(res.collected)}`),
      columns: [
        { label: t('Date'), render: (x) => datetime(x.created_at) },
        { label: t('Shop'), render: (x) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); manageShop(x.business_id, reload); } }, x.shop_name) },
        { label: t('Plan'), render: (x) => `${t(x.cycle === 'yearly' ? 'Yearly' : 'Monthly')} · ${t('{n} months', { n: x.months })}` },
        { label: t('Amount'), align: 'right', render: (x) => tk(x.amount) },
        { label: t('Method'), render: (x) => (METHODS.find(([k]) => k === x.method)?.[1] || x.method) },
        { label: t('TrxID'), render: (x) => h('span', { class: 'cell-stack' }, h('code', {}, x.reference || '—'), x.payer_phone ? h('small', { class: 'muted' }, x.payer_phone) : null) },
        { label: t('Status'), render: (x) => h('span', { class: 'cell-stack' }, badge({ pending: 'partial', approved: 'paid', rejected: 'void' }[x.status], t(x.status === 'pending' ? 'Waiting' : x.status === 'approved' ? 'Approved' : 'Rejected')), x.period_to ? h('small', { class: 'muted' }, `${date(x.period_from)} – ${date(x.period_to)}`) : null) },
        { label: '', render: (x) => (x.status === 'pending' ? h('span', { class: 'row' },
          h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: async () => {
            if (!(await confirmDialog(t('Did you receive {amount} from {shop}? Approving extends the shop by {n} months.', { amount: tk(x.amount), shop: x.shop_name, n: x.months }), { confirmText: t('Approve') }))) return;
            try { await api.post(`platform/payments/${x.id}/approve`); toast(t('Approved — shop extended')); reload(); } catch (err) { showError(err); }
          } }, icon('check', 14), t('Approve')),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
            const r = await confirmDialog(t('Reject this payment request?'), { danger: true, confirmText: t('Reject'), reason: true });
            if (!r) return;
            try { await api.post(`platform/payments/${x.id}/reject`, { reason: r.reason }); toast(t('Rejected')); reload(); } catch (err) { showError(err); }
          } }, t('Reject'))) : '') },
      ],
    });
    body.append(card(null, table.el));
  } else {
    body.append(settingsForm(reload));
  }
}

function settingsForm(reload) {
  const f = h('form', { class: 'form' },
    h('div', { class: 'form-grid' },
      field(t('Monthly price'), input('monthly_price', cfg.monthly_price, { inputmode: 'decimal' })),
      field(t('Yearly price'), input('yearly_price', cfg.yearly_price, { inputmode: 'decimal' })),
      field(t('Currency symbol'), input('currency', cfg.currency)),
      field(t('Free trial days'), input('trial_days', String(cfg.trial_days), { type: 'number', min: 0 }), { hint: t('For new shops opened without payment') }),
      field(t('Grace days'), input('grace_days', String(cfg.grace_days), { type: 'number', min: 0 }), { hint: t('Shop keeps working this many days after expiry') }),
      field(t('Support phone'), input('support_phone', cfg.support_phone, { type: 'tel' }), { hint: t('Shown on the login page and renewal screen') }),
      field(t('Software name'), input('brand', cfg.brand))),
    field(t('How clients should pay you'), textarea('payment_instructions', cfg.payment_instructions, { rows: 4, placeholder: t('e.g. bKash Send Money to 01XXXXXXXXX (Personal). Then enter the TrxID below.') }), { wide: true, hint: t('Shown to clients when they renew') }),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, t('Save'))));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api.put('platform/config', values(f)); toast(t('Saved')); reload(); } catch (err) { showFieldErrors(f, err.errors); showError(err); }
  });
  return h('div', {},
    card(t('Client login page'), h('p', { class: 'muted small' }, t('Clients log in here with their email and password. They only see their own shop — never WordPress.')), copyBox(loginUrl)),
    card(t('Prices & settings'), f));
}

function copyBox(text, { multiline = false } = {}) {
  const box = multiline ? h('textarea', { class: 'input', rows: Math.min(9, text.split('\n').length + 1), readonly: true }, text) : h('input', { class: 'input', readonly: true, value: text });
  return h('div', { class: 'copy-box' }, box,
    h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(text); } catch { box.select(); document.execCommand('copy'); }
      toast(t('Copied'));
    } }, t('Copy')));
}

function welcomeText(shop, password) {
  return [
    `${cfg.brand} — ${shop.name}`,
    `${t('Login')}: ${loginUrl}`,
    `${t('Email')}: ${shop.owner?.email || shop.email}`,
    password ? `${t('Password')}: ${password}` : null,
    shop.subscription.paid_until ? `${t('Paid until')}: ${shop.subscription.paid_until}` : null,
    cfg.support_phone ? `${t('Help')}: ${cfg.support_phone}` : null,
  ].filter(Boolean).join('\n');
}

function shareRow(text, phone) {
  const num = (phone || '').replace(/[^0-9]/g, '').replace(/^0/, '880');
  return h('div', { class: 'row wrap' },
    h('a', { class: 'btn btn-sm', href: `https://wa.me/${num}?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener' }, t('Send on WhatsApp')),
    phone ? h('a', { class: 'btn btn-sm', href: `sms:${phone}?body=${encodeURIComponent(text)}` }, t('Send SMS')) : null);
}

const genPassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => chars[n % chars.length]).join('');
};

function openShop(types, onDone) {
  const pw = input('password', genPassword(), { autocomplete: 'new-password' });
  const cycle = select('cycle', [['monthly', `${t('Monthly')} — ${tk(cfg.monthly_price)}`], ['yearly', `${t('Yearly')} — ${tk(cfg.yearly_price)}`]], 'monthly');
  const paid = input('paid_amount', '', { inputmode: 'decimal', placeholder: '0' });
  const payBox = h('div', { class: 'form-grid' },
    field(t('Method'), select('method', METHODS, 'bkash')),
    field(t('TrxID / reference'), input('reference', '')));
  const paintPay = () => { payBox.hidden = !Number(paid.value); };
  paid.addEventListener('input', paintPay);
  cycle.addEventListener('change', () => { if (paid.value) paid.value = cycle.value === 'yearly' ? cfg.yearly_price : cfg.monthly_price; });
  const f = h('form', { class: 'form' },
    h('h4', {}, t('Client')),
    h('div', { class: 'form-grid' },
      field(t('Owner name'), input('owner_name', '', { required: true, autofocus: true }), { required: true }),
      field(t('Email (login)'), input('email', '', { type: 'email', required: true, inputmode: 'email' }), { required: true, hint: t('Their Gmail or any email') }),
      field(t('Phone'), input('phone', '', { type: 'tel' })),
      field(t('Password'), h('div', { class: 'row' }, pw, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { pw.value = genPassword(); } }, t('New'))), { hint: t('At least 8 characters. You will send it to the client.') })),
    h('h4', {}, t('Shop')),
    h('div', { class: 'form-grid' },
      field(t('Shop name'), input('shop_name', '', { required: true }), { required: true }),
      field(t('Business type'), select('business_type', Object.entries(types).map(([k, v]) => [k, t(v)]), 'retail')),
      field(t('Plan'), cycle),
      field(t('Paid now'), paid, { hint: t('Leave empty to start a {n}-day free trial', { n: cfg.trial_days }) })),
    payBox);
  paintPay();
  const m = modal({
    title: t('Open new shop'),
    size: 'lg',
    body: f,
    actions: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, t('Cancel')),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const data = values(f);
          const shop = await api.post('platform/shops', data);
          m.close();
          onDone();
          const text = welcomeText(shop, data.password);
          modal({
            title: t('Shop is ready ✓'),
            body: h('div', { class: 'form' },
              h('p', {}, t('Send these login details to the client:')),
              copyBox(text, { multiline: true }),
              shareRow(text, data.phone)),
          });
        } catch (err) { showFieldErrors(f, err.errors); showError(err); } finally { btn.disabled = false; }
      } }, icon('check', 16), t('Open shop'))],
  });
}

async function manageShop(id, onChange) {
  let shop;
  try { shop = await api.get(`platform/shops/${id}`); } catch (err) { showError(err); return; }
  const sub = shop.subscription;
  const body = h('div', { class: 'form' });
  const m = modal({ title: shop.name, size: 'lg', body });
  const refresh = () => { m.close(); onChange(); manageShop(id, onChange); };

  // Record a payment the owner already received.
  const cycle = select('cycle', [['monthly', `${t('Monthly')} (1 ${t('month')})`], ['yearly', `${t('Yearly')} (12 ${t('months')})`]], sub.cycle || 'monthly');
  const amount = input('amount', sub.cycle === 'yearly' ? cfg.yearly_price : cfg.monthly_price, { inputmode: 'decimal' });
  cycle.addEventListener('change', () => { amount.value = cycle.value === 'yearly' ? cfg.yearly_price : cfg.monthly_price; });
  const payForm = h('form', { class: 'form' },
    h('div', { class: 'form-grid' }, field(t('Plan'), cycle), field(t('Amount received'), amount), field(t('Method'), select('method', METHODS, 'bkash')), field(t('TrxID / reference'), input('reference', ''))),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, icon('cash', 16), t('Record payment & extend'))));
  payForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const p = await api.post(`platform/shops/${id}/payments`, values(payForm));
      toast(t('Payment saved. Paid until {d}', { d: date(p.period_to) }));
      refresh();
    } catch (err) { showFieldErrors(payForm, err.errors); showError(err); }
  });

  const until = input('paid_until', sub.paid_until || '', { type: 'date' });
  const note = textarea('note', shop.note, { rows: 2 });
  const pw = input('password', '', { placeholder: t('New password'), autocomplete: 'new-password' });

  mount(body,
    h('div', { class: 'stats' },
      stat(t('Status'), subBadge(sub), { hint: daysText(sub) }),
      stat(t('Paid until'), sub.paid_until ? date(sub.paid_until) : t('No limit')),
      stat(t('Collected'), tk(shop.collected)),
      stat(t('Users'), String(shop.users), { hint: shop.last_seen_at ? `${t('Last active')}: ${datetime(shop.last_seen_at)}` : t('Never logged in') })),
    h('p', {}, h('strong', {}, shop.owner?.name || ''), ' · ', shop.owner?.email || '', shop.phone ? ` · ${shop.phone}` : ''),
    card(t('Receive payment'), payForm),
    card(t('Login details'), copyBox(welcomeText(shop, ''), { multiline: true }), shareRow(welcomeText(shop, ''), shop.phone),
      shop.owner ? h('div', { class: 'row wrap' }, pw, h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
        if (pw.value.length < 8) { toast(t('Password must be at least 8 characters.'), 'error'); return; }
        try {
          await api.post(`platform/shops/${id}/password`, { password: pw.value });
          toast(t('Password changed'));
          const text = welcomeText(shop, pw.value);
          modal({ title: t('New password'), body: h('div', { class: 'form' }, copyBox(text, { multiline: true }), shareRow(text, shop.phone)) });
        } catch (err) { showError(err); }
      } }, t('Change password'))) : null),
    card(t('Adjust'),
      h('div', { class: 'form-grid' },
        field(t('Paid until'), until, { hint: t('Change by hand, e.g. to give free days') }),
        field(t('Private note'), note)),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          try { await api.put(`platform/shops/${id}`, { paid_until: until.value, note: note.value }); toast(t('Saved')); refresh(); } catch (err) { showError(err); }
        } }, t('Save')),
        shop.status === 'suspended'
          ? h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { try { await api.put(`platform/shops/${id}`, { status: 'active' }); toast(t('Shop re-activated')); refresh(); } catch (err) { showError(err); } } }, t('Re-activate shop'))
          : h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: async () => {
            if (!(await confirmDialog(t('Suspend {n}? Their users will not be able to log in to the shop until you re-activate it. No data is deleted.', { n: shop.name }), { danger: true, confirmText: t('Suspend') }))) return;
            try { await api.put(`platform/shops/${id}`, { status: 'suspended' }); toast(t('Shop suspended')); refresh(); } catch (err) { showError(err); }
          } }, t('Suspend shop')))),
    card(t('Payment history'), shop.payments.length ? simpleTable([
      { label: t('Date'), render: (x) => datetime(x.created_at) },
      { label: t('Amount'), align: 'right', render: (x) => tk(x.amount) },
      { label: t('Method'), render: (x) => `${METHODS.find(([k]) => k === x.method)?.[1] || x.method}${x.reference ? ` · ${x.reference}` : ''}` },
      { label: t('Period'), render: (x) => (x.period_to ? `${date(x.period_from)} – ${date(x.period_to)}` : '—') },
      { label: t('Status'), render: (x) => badge({ pending: 'partial', approved: 'paid', rejected: 'void' }[x.status], t(x.status === 'pending' ? 'Waiting' : x.status === 'approved' ? 'Approved' : 'Rejected')) },
    ], shop.payments) : h('p', { class: 'muted' }, t('No payments yet.'))));
}
