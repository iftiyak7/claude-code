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
const methodLabel = (m) => (m === 'trial' ? t('Free trial') : METHODS.find(([k]) => k === m)?.[1] || m);
const SUB_TONE = { active: 'active', trial: 'held', grace: 'partial', expired: 'due', suspended: 'suspended', unlimited: 'completed', pending: 'partial' };
const SUB_LABEL = { active: 'Active', trial: 'Trial', grace: 'Grace period', expired: 'Expired', suspended: 'Suspended', unlimited: 'No limit', pending: 'New sign-up' };

let cfg = null;
let loginUrl = '';
let homeUrl = '';
let signupUrl = '';
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
  homeUrl = o.home_url;
  signupUrl = o.signup_url;
  const tab = query.tab || 'shops';
  const s = o.stats;
  const go = (k) => { location.hash = `#/platform?tab=${k}`; };

  const p = page(t('Shops & subscriptions'), {
    subtitle: t('Open shops for clients and collect monthly / yearly payments.'),
    actions: [
      state.me.can_setup ? h('a', { class: 'btn', href: '#/setup' }, icon('plus', 16), t('New shop for myself')) : null,
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openShop(o.types, () => platform(el, params, { tab: 'shops' })) }, icon('plus', 16), t('Open new shop')),
    ],
  });
  p.body.append(
    h('div', { class: 'stats' },
      stat(t('Shops'), String(s.shops), { onclick: () => go('shops') }),
      stat(t('Active'), String(s.active), { tone: 'ok' }),
      stat(t('Trial'), String(s.trial)),
      stat(t('Ending in 7 days'), String(s.expiring), { tone: s.expiring ? 'warn' : '' }),
      stat(t('Expired'), String(s.expired), { tone: s.expired ? 'bad' : '' }),
      stat(t('New sign-ups'), String(s.signups || 0), { tone: s.signups ? 'warn' : '', onclick: () => { location.hash = '#/platform?tab=shops&status=pending'; } }),
      stat(t('Payment requests'), String(s.pending), { tone: s.pending ? 'warn' : '', onclick: () => go('payments') }),
      stat(t('Collected this month'), tk(s.collected_month), { tone: 'ok' }),
      stat(t('Collected total'), tk(s.collected_total))),
    tabs([['shops', t('Shops')], ['payments', `${t('Payments')}${s.pending ? ` (${s.pending})` : ''}`], ...(o.owner ? [['settings', t('Prices & settings')], ['home', t('Home page')], ['team', t('Team')]] : [])], tab, go));
  const body = h('div', { class: 'tab-body' });
  p.body.append(body);
  mount(el, p.el);
  const reload = () => platform(el, params, query);

  if (tab === 'shops') {
    const status = select('status', [['all', t('All shops')], ['active', t('Active')], ['expiring', t('Ending in 7 days')], ['expired', t('Expired')], ['trial', t('Trial')], ['suspended', t('Suspended')], ['pending', t('New sign-ups')], ['archived', t('Archived')]], query.status || 'all', { 'aria-label': t('Status') });
    const table = dataTable({
      query,
      searchPlaceholder: t('Search shop, phone, email…'),
      filters: [{ control: status }],
      fetch: (prm) => api.get('platform/shops', prm),
      emptyText: t('No shops yet. Click "Open new shop" to create the first one.'),
      columns: [
        { label: t('Shop'), render: (x) => h('span', { class: 'cell-stack' }, h('strong', {}, x.name, x.owner_id === state.me.user.id ? [' ', badge('active', t('Your shop'))] : null), h('small', { class: 'muted' }, x.owner ? `${x.owner.name} · ${x.owner.email}` : '')) },
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
        { label: t('Plan'), render: (x) => (x.cycle === 'trial' ? t('Free trial') : `${t(x.cycle === 'yearly' ? 'Yearly' : 'Monthly')} · ${t('{n} months', { n: x.months })}`) },
        { label: t('Amount'), align: 'right', render: (x) => tk(x.amount) },
        { label: t('Method'), render: (x) => (methodLabel(x.method)) },
        { label: t('TrxID'), render: (x) => h('span', { class: 'cell-stack' }, h('code', {}, x.reference || '—'), x.payer_phone ? h('small', { class: 'muted' }, x.payer_phone) : null) },
        { label: t('Status'), render: (x) => h('span', { class: 'cell-stack' }, badge({ pending: 'partial', approved: 'paid', rejected: 'void' }[x.status], t(x.status === 'pending' ? 'Waiting' : x.status === 'approved' ? 'Approved' : 'Rejected')), x.period_to ? h('small', { class: 'muted' }, `${date(x.period_from)} – ${date(x.period_to)}`) : null) },
        { label: '', render: (x) => (x.status === 'pending' ? h('span', { class: 'row' },
          h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: async () => {
            const q = x.cycle === 'trial' ? t('Start the {n}-day free trial for {shop}?', { n: cfg.trial_days, shop: x.shop_name }) : t('Did you receive {amount} from {shop}? Approving extends the shop by {n} months.', { amount: tk(x.amount), shop: x.shop_name, n: x.months });
            if (!(await confirmDialog(q, { confirmText: t('Approve') }))) return;
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
  } else if (tab === 'home' && o.owner) {
    homeEditor(body);
  } else if (tab === 'team' && o.owner) {
    teamTab(body);
  } else if (o.owner) {
    body.append(settingsForm(reload));
  }
}

/* ------------------------------------------------------------ Team */

async function teamTab(root) {
  mount(root, spinner());
  const team = await api.get('platform/team');
  const again = () => teamTab(root);
  const f = h('form', { class: 'form' },
    h('div', { class: 'form-grid' },
      field(t('Email'), input('email', '', { type: 'email', required: true }), { required: true }),
      field(t('Name'), input('name', '')),
      field(t('Password'), input('password', '', { type: 'text', autocomplete: 'new-password', minlength: 8 }), { hint: t('For a new login. Existing users keep their password.') })),
    h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus', 16), t('Add to team'))));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api.post('platform/team', values(f)); toast(t('Added')); again(); } catch (err) { showFieldErrors(f, err.errors || {}); showError(err); }
  });
  const pw = (m) => {
    const inp = input('password', '', { type: 'text', minlength: 8, autocomplete: 'new-password' });
    const dlg = modal({ title: t('New password for {n}', { n: m.name }), size: 'sm', body: h('div', { class: 'form' }, field(t('New password'), inp)),
      actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        try { await api.post(`platform/team/${m.id}/password`, { password: inp.value }); dlg.close(); toast(t('Password changed')); } catch (err) { showError(err); }
      } }, t('Save'))] });
  };
  mount(root,
    card(t('Your team'),
      h('p', { class: 'muted small' }, t('Team members log in at the same login page and can open shops, approve payments and manage clients. They cannot change prices, payment numbers, API keys or the home page, and have no WordPress access.')),
      team.length ? simpleTable([
        { label: t('Name'), render: (m) => h('span', {}, h('strong', {}, m.name), h('small', { class: 'muted' }, ` ${m.email}`)) },
        { label: '', render: (m) => h('div', { class: 'row' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => pw(m) }, t('Change password')),
          h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', onclick: async () => {
            if (!(await confirmDialog(t('Remove {n} from the team?', { n: m.name }), { danger: true, confirmText: t('Remove') }))) return;
            try { await api.del(`platform/team/${m.id}`); again(); } catch (err) { showError(err); }
          } }, t('Remove'))) },
      ], team) : empty(t('No team members yet.'))),
    card(t('Add a team member'), f));
}

/* ------------------------------------------------------------ Home page editor */

const SECTION_LABELS = { who: 'Kinds of shops', pain: 'Problem & comparison', features: 'Features', how: 'How to start', price: 'Pricing', faq: 'Questions & answers', band: 'Last call to action' };

async function homeEditor(root) {
  mount(root, spinner());
  const data = await api.get('platform/landing');
  const state = JSON.parse(JSON.stringify(data.content));
  const pairInput = (obj, key, type) => {
    obj[key] = obj[key] || { bn: '', en: '' };
    const mk = (lang) => {
      const el = type === 'textarea' ? h('textarea', { class: 'input', rows: 3 }, obj[key][lang] || '') : h('input', { class: 'input', value: obj[key][lang] || '' });
      el.addEventListener('input', () => { obj[key][lang] = el.value; });
      return h('label', { class: 'pair-field' }, h('span', { class: 'pair-lang' }, lang === 'bn' ? 'বাংলা' : 'English'), el);
    };
    return h('div', { class: 'pair' }, mk('bn'), mk('en'));
  };
  const fieldEl = (obj, f) => {
    if (f.type === 'icon') {
      const sel = select(f.key, data.icons.map((i) => [i, i]), obj[f.key] || 'star');
      sel.addEventListener('change', () => { obj[f.key] = sel.value; });
      return h('div', { class: 'field' }, h('label', {}, t(f.label)), sel);
    }
    if (f.type === 'list') {
      const box = h('div', { class: 'list-editor' });
      const paint = () => mount(box, (obj[f.key] || []).map((item, i, arr) => h('div', { class: 'list-item' },
        h('div', { class: 'list-item-head' }, h('strong', {}, `#${i + 1}`),
          h('span', { class: 'row' },
            h('button', { class: 'icon-btn', type: 'button', disabled: i === 0, 'aria-label': t('Move up'), onclick: () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; paint(); } }, '↑'),
            h('button', { class: 'icon-btn', type: 'button', disabled: i === arr.length - 1, 'aria-label': t('Move down'), onclick: () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; paint(); } }, '↓'),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Remove'), onclick: () => { arr.splice(i, 1); paint(); } }, icon('trash', 16)))),
        f.item.map((sub) => fieldEl(item, sub)))),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => {
        const blank = {}; f.item.forEach((sub) => { blank[sub.key] = sub.type === 'icon' ? 'star' : { bn: '', en: '' }; });
        (obj[f.key] = obj[f.key] || []).push(blank); paint();
      } }, icon('plus', 14), t('Add')));
      paint();
      return h('div', { class: 'field wide' }, h('label', {}, t(f.label)), box);
    }
    return h('div', { class: 'field wide' }, h('label', {}, t(f.label)), pairInput(obj, f.key, f.type));
  };
  const toggles = h('div', { class: 'row wrap' }, Object.keys(state.show).map((k) => {
    const box = h('input', { type: 'checkbox', checked: !!state.show[k] });
    box.addEventListener('change', () => { state.show[k] = box.checked; });
    return h('label', { class: 'check' }, box, h('span', {}, t(SECTION_LABELS[k] || k)));
  }));
  const save = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await api.put('platform/landing', { content: state }); toast(t('Home page saved')); } catch (err) { showError(err); } finally { b.disabled = false; }
  };
  mount(root,
    card(t('Home page'),
      h('p', { class: 'muted small' }, t('Edit every text on your home page in Bangla and English. Prices, free days and phone numbers come from Prices & settings.')),
      h('div', { class: 'row wrap' },
        h('a', { class: 'btn btn-sm', href: `${data.url}?lang=bn`, target: '_blank', rel: 'noopener' }, t('Preview (বাংলা)')),
        h('a', { class: 'btn btn-sm', href: `${data.url}?lang=en`, target: '_blank', rel: 'noopener' }, t('Preview (English)')),
        h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', onclick: async () => {
          if (!(await confirmDialog(t('Put back all the original texts? Your changes will be lost.'), { danger: true, confirmText: t('Reset') }))) return;
          try { await api.post('platform/landing/reset'); toast(t('Reset done')); homeEditor(root); } catch (err) { showError(err); }
        } }, t('Reset to original'))),
      h('h4', {}, t('Sections to show')), toggles),
    data.schema.map((sec) => card(t(sec.title), h('div', { class: 'form-grid' }, sec.fields.map((f) => fieldEl(state, f))))),
    h('div', { class: 'form-actions sticky-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, icon('check', 16), t('Save home page'))));
}

function settingsForm(reload) {
  const typeSel = (k) => select(`pay_${k}_type`, [['personal', t('Personal')], ['merchant', t('Merchant')], ['agent', t('Agent')]], cfg[`pay_${k}_type`] || 'personal');
  const wallet = (k, label) => h('div', { class: 'wallet-row' }, field(t('{w} number', { w: label }), input(`pay_${k}`, cfg[`pay_${k}`] || '', { type: 'tel', inputmode: 'tel', placeholder: '01XXXXXXXXX' })), field(t('Account type'), typeSel(k)));
  const f = h('form', { class: 'form' },
    card(t('Where clients pay you'),
      h('p', { class: 'muted small' }, t('These numbers are shown on the renewal and sign-up screens with a copy button. Leave empty what you do not use.')),
      wallet('bkash', 'bKash'), wallet('nagad', 'Nagad'), wallet('rocket', 'Rocket'),
      field(t('Bank account'), textarea('pay_bank', cfg.pay_bank || '', { rows: 3, placeholder: t('Bank name, account name, account number, branch') }), { wide: true }),
      field(t('Extra instructions'), textarea('payment_instructions', cfg.payment_instructions, { rows: 3, placeholder: t('e.g. Use your shop name as reference.') }), { wide: true })),
    card(t('Prices'), h('div', { class: 'form-grid' },
      field(t('Monthly price'), input('monthly_price', cfg.monthly_price, { inputmode: 'decimal' })),
      field(t('Yearly price'), input('yearly_price', cfg.yearly_price, { inputmode: 'decimal' })),
      field(t('Currency symbol'), input('currency', cfg.currency)),
      field(t('Free trial days'), input('trial_days', String(cfg.trial_days), { type: 'number', min: 0 }), { hint: t('For new shops opened without payment') }),
      field(t('Grace days'), input('grace_days', String(cfg.grace_days), { type: 'number', min: 0 }), { hint: t('Shop keeps working this many days after expiry') }))),
    card(t('Contact'), h('div', { class: 'form-grid' },
      field(t('Support phone'), input('support_phone', cfg.support_phone, { type: 'tel' }), { hint: t('Shown on the login page and renewal screen') }),
      field(t('WhatsApp number'), input('whatsapp', cfg.whatsapp || '', { type: 'tel', placeholder: '017XXXXXXXX' }), { hint: t('Buttons on the home page open a WhatsApp chat with this number') }),
      field(t('Software name'), input('brand', cfg.brand)),
      field(t('Android app download link'), input('apk_url', cfg.apk_url || '', { type: 'url', placeholder: 'https://…/goriber-hisab.apk' }), { hint: t('Optional. The home page and login page always have a "Download Android app" button. Leave this empty to use the app that comes with the plugin.'), wide: true }))),
    card(t('Website'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'landing', checked: cfg.landing !== false }), h('span', {}, t('Show the Goriber Hisab home page (features, pricing, WhatsApp) on the site\'s front page'))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'signup', checked: cfg.signup !== false }), h('span', {}, t('Let new shops sign up themselves (you approve each one)'))),
      field(t('Free trial for new sign-ups'), select('signup_trial', [['instant', t('Starts right away (no approval needed)')], ['approval', t('Starts after I approve it')], ['off', t('No free trial — they must pay')]], cfg.signup_trial || 'instant'), { hint: t('Trial length is set in Free trial days above.') })),
    card(t('AI order reading (optional)'),
      h('p', { class: 'muted small' }, t('Paste-to-fill works without this. With an Anthropic (Claude) API key, messy messages are read even better. You pay Anthropic per use.')),
      field(t('Claude API key'), input('ai_key', cfg.ai_key || '', { autocomplete: 'off', placeholder: 'sk-ant-…' }), { hint: cfg.ai_enabled ? t('Connected') : t('Get a key at console.anthropic.com') })),
    smsCard(cfg),
    card(t('Customer fraud check'),
      h('p', { class: 'muted small' }, t('When an order is entered, the phone number is checked: how many parcels this customer received or returned. Counts from all shops on this site are always available. For history from every courier (Pathao, Steadfast, RedX, Paperfly…), connect a courier-check service such as BD Courier.')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'fraud_network', checked: cfg.fraud_network !== false }), h('span', {}, t('Share delivery counts between shops on this site (numbers only — no names or shop details)'))),
      h('div', { class: 'form-grid' },
        field(t('Courier-check API key'), input('fraud_key', cfg.fraud_key || '', { autocomplete: 'off' }), { hint: t('From your courier-check service account (for example bdcourier.com)') }),
        field(t('Service address (optional)'), input('fraud_url', cfg.fraud_url || '', { type: 'url', placeholder: 'https://api.bdcourier.com/courier-check' }), { hint: t('Leave empty for BD Courier') }))),
    h('div', { class: 'form-actions sticky-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, t('Save'))));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api.put('platform/config', values(f)); toast(t('Saved')); reload(); } catch (err) { showFieldErrors(f, err.errors); showError(err); }
  });
  return h('div', {},
    card(t('Client login page'), h('p', { class: 'muted small' }, t('Clients log in here with their email and password. They only see their own shop — never WordPress.')), copyBox(loginUrl),
      h('p', { class: 'muted small' }, t('Sign-up page:'), ' ', h('a', { href: signupUrl, target: '_blank', rel: 'noopener' }, signupUrl)),
      h('p', { class: 'muted small' }, t('Home page:'), ' ', h('a', { href: homeUrl, target: '_blank', rel: 'noopener' }, homeUrl))),
    f);
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
        shop.status === 'pending'
          ? h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
            if (!(await confirmDialog(t('Approve {n} without a payment? The free trial starts now. (Approving their payment request also opens the shop.)', { n: shop.name }), { confirmText: t('Approve') }))) return;
            try { await api.put(`platform/shops/${id}`, { status: 'active' }); toast(t('Shop approved')); refresh(); } catch (err) { showError(err); }
          } }, icon('check', 16), t('Approve with free trial'))
          : shop.status === 'suspended'
          ? h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { try { await api.put(`platform/shops/${id}`, { status: 'active' }); toast(t('Shop re-activated')); refresh(); } catch (err) { showError(err); } } }, t('Re-activate shop'))
          : h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: async () => {
            if (!(await confirmDialog(t('Suspend {n}? Their users will not be able to log in to the shop until you re-activate it. No data is deleted.', { n: shop.name }), { danger: true, confirmText: t('Suspend') }))) return;
            try { await api.put(`platform/shops/${id}`, { status: 'suspended' }); toast(t('Shop suspended')); refresh(); } catch (err) { showError(err); }
          } }, t('Suspend shop')))),
    card(t('Payment history'), shop.payments.length ? simpleTable([
      { label: t('Date'), render: (x) => datetime(x.created_at) },
      { label: t('Amount'), align: 'right', render: (x) => tk(x.amount) },
      { label: t('Method'), render: (x) => `${methodLabel(x.method)}${x.reference ? ` · ${x.reference}` : ''}` },
      { label: t('Period'), render: (x) => (x.period_to ? `${date(x.period_from)} – ${date(x.period_to)}` : '—') },
      { label: t('Status'), render: (x) => badge({ pending: 'partial', approved: 'paid', rejected: 'void' }[x.status], t(x.status === 'pending' ? 'Waiting' : x.status === 'approved' ? 'Approved' : 'Rejected')) },
    ], shop.payments) : h('p', { class: 'muted' }, t('No payments yet.'))),
    dangerZone(shop, () => { m.close(); if (shop.id === state.business?.id) location.reload(); else onChange(); }, refresh));
}

/**
 * Archive (hide, keep everything, can come back), restore, and — owner only,
 * archived shops only — delete for ever after three separate confirmations.
 */
function dangerZone(shop, closed, refresh) {
  const id = shop.id;
  if (!shop.deleted_at) {
    return card(t('Archive'),
      h('p', { class: 'muted small' }, t('Archived shops disappear from the list and nobody can open them. Nothing is deleted — you can bring the shop back any time from "Archived".')),
      h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: async () => {
        if (!(await confirmDialog(t('Archive {n}? Its users cannot log in until you restore it. No data is deleted.', { n: shop.name }), { danger: true, confirmText: t('Archive') }))) return;
        try { await api.post(`platform/shops/${id}/archive`); toast(t('Shop archived')); closed(); } catch (err) { showError(err); }
      } }, icon('trash', 16), t('Archive shop')));
  }
  const del = async () => {
    // 1st: are you sure?
    if (!(await confirmDialog(t('Delete {n} for ever?', { n: shop.name }), { danger: true, confirmText: t('Yes, continue') }))) return;
    // 2nd: say exactly what goes.
    if (!(await confirmDialog(t('Every sale, product, customer, order, payment and setting of {n} will be erased. This cannot be undone and the data cannot be recovered. Delete?', { n: shop.name }), { danger: true, title: t('Last warning'), confirmText: t('Delete everything') }))) return;
    // 3rd: type the shop name.
    const nameIn = input('confirm', '', { autocomplete: 'off', placeholder: shop.name });
    const go = h('button', { class: 'btn btn-danger', type: 'button', disabled: true }, icon('trash', 16), t('Delete for ever'));
    nameIn.addEventListener('input', () => { go.disabled = nameIn.value.trim() !== shop.name.trim(); });
    const m3 = modal({
      title: t('Type the shop name to delete'), size: 'sm',
      body: h('div', { class: 'form' }, h('p', {}, t('To confirm, type: {n}', { n: '' }), h('strong', {}, shop.name)), nameIn),
      actions: [go],
    });
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        await api.post(`platform/shops/${id}/delete`, { confirm: nameIn.value });
        m3.close(); toast(t('{n} was deleted for ever.', { n: shop.name })); closed();
      } catch (err) { go.disabled = false; showError(err); }
    });
  };
  return card(t('Archived shop'),
    h('p', { class: 'warn-text' }, t('This shop is archived — hidden and closed. All its data is still here.')),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        try { await api.post(`platform/shops/${id}/restore`); toast(t('Shop restored')); refresh(); } catch (err) { showError(err); }
      } }, icon('return', 16), t('Restore shop')),
      state.me.platform?.owner ? h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: del }, icon('trash', 16), t('Delete for ever')) : null),
    state.me.platform?.owner ? null : h('p', { class: 'muted small' }, t('Only the site owner can delete a shop for ever.')));
}

/** SMS gateway for every shop on this site (thank-you SMS after a sale, due reminders). */
function smsCard(cfg) {
  const presets = cfg.sms_presets || {};
  const url = input('sms_url', cfg.sms_url || '', { placeholder: 'https://…{api_key}…{phone}…{message}' });
  const pick = select('sms_preset', [['', t('Choose your SMS company…')], ['bulksmsbd', 'BulkSMSBD'], ['alpha', 'Alpha SMS (sms.net.bd)'], ['greenweb', 'GreenWeb'], ['custom', t('Other (paste the address)')]], Object.entries(presets).find(([, v]) => v === cfg.sms_url)?.[0] || (cfg.sms_url ? 'custom' : ''));
  pick.removeAttribute('name');
  pick.addEventListener('change', () => { if (presets[pick.value]) url.value = presets[pick.value]; });
  return card(t('SMS gateway'),
    h('p', { class: 'muted small' }, t('Shops can send customers an SMS after each sale and due reminders. Buy SMS from a Bangladeshi SMS company and put its API key here. You pay the SMS company per message.')),
    h('div', { class: 'form-grid' },
      field(t('SMS company'), pick),
      field(t('API key'), input('sms_key', cfg.sms_key || '', { autocomplete: 'off' })),
      field(t('Sender ID (optional)'), input('sms_sender', cfg.sms_sender || '', { placeholder: '8809XXXXXXXX' }), { hint: t('Masking name or number given by the SMS company') }),
      field(t('Send address'), url, { wide: true, hint: t('Filled in when you choose the company. Words: {api_key} {sender} {phone} {phone_local} {message}') })));
}
