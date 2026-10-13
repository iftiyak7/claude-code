/**
 * Subscription status and renewal for a hosted shop. Also rendered as a
 * full-screen block when the subscription has run out.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { date, datetime } from '../core/format.js';
import { page, card, stat, field, input, select, toast, showError, showFieldErrors, values, badge, simpleTable, spinner } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { subBadge } from './platform.js';

const METHODS = [['bkash', 'bKash'], ['nagad', 'Nagad'], ['rocket', 'Rocket'], ['bank', 'Bank'], ['cash', 'Cash']];

const WALLETS = [['bkash', 'bKash', '#e2136e'], ['nagad', 'Nagad', '#f6921e'], ['rocket', 'Rocket', '#8c3494']];
const TYPES = { personal: 'Personal', merchant: 'Merchant', agent: 'Agent' };
const HOW = { personal: 'Send Money', merchant: 'Payment', agent: 'Cash Out' };

/** Where to send the money: one card per wallet with a copy button. */
export function payMethods(cfg, amount) {
  const copy = (text) => h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(text); toast(t('Copied')); } catch { /* ignore */ }
  } }, t('Copy'));
  const cards = WALLETS.filter(([k]) => cfg[`pay_${k}`]).map(([k, name, color]) => {
    const type = cfg[`pay_${k}_type`] || 'personal';
    return h('div', { class: 'wallet', style: `--w:${color}` },
      h('span', { class: 'wallet-name' }, name),
      h('div', { class: 'wallet-body' }, h('strong', {}, cfg[`pay_${k}`]), h('small', {}, `${t(TYPES[type])} · ${t(HOW[type])}`)),
      copy(cfg[`pay_${k}`]));
  });
  if (cfg.pay_bank) cards.push(h('div', { class: 'wallet', style: '--w:#0b1a2e' }, h('span', { class: 'wallet-name' }, t('Bank')), h('div', { class: 'wallet-body' }, h('pre', {}, cfg.pay_bank)), copy(cfg.pay_bank)));
  const support = cfg.whatsapp || cfg.support_phone;
  return h('div', { class: 'pay-methods' },
    cards.length ? h('p', { class: 'muted small' }, t('Send {x} to any of these:', { x: amount })) : null,
    cards.length ? cards : h('p', { class: 'muted' }, support ? t('Call {p} for payment details.', { p: support }) : t('Contact support for payment details.')),
    cfg.payment_instructions ? h('pre', { class: 'pay-instructions' }, cfg.payment_instructions) : null);
}

export default async function subscription(el) {
  mount(el, spinner());
  const data = await api.get('subscription');
  const p = page(t('Subscription'));
  p.body.append(...content(data, () => subscription(el)));
  mount(el, p.el);
}

/** Full-screen view shown instead of the app when the shop is blocked. */
export async function blockedScreen(root, blocked) {
  mount(root, h('div', { class: 'boot' }, spinner()));
  let data = null;
  try { data = await api.get('subscription'); } catch { /* suspended shops cannot renew */ }
  const suspended = blocked.status === 'suspended';
  const pending = blocked.status === 'pending';
  const [title, text] = suspended ? [t('This shop has been suspended.'), t('Please contact support to continue.')]
    : pending ? [t('Welcome! Your shop is almost ready.'), t('Pay below and submit the transaction ID. Your shop opens as soon as we approve it — usually within a few hours.')]
      : [t('Your subscription has expired.'), t('Your data is safe. Renew to continue using the software.')];
  mount(root, h('main', { class: 'bare blocked' }, h('div', { class: 'blocked-card' },
    h('div', { class: 'brand' }, h('img', { src: `${window.BZL.assetsUrl}img/icon.svg`, alt: '', width: 48, height: 48 }), h('h1', {}, blocked.business_name)),
    pending ? h('ol', { class: 'signup-steps' }, h('li', { class: 'done' }, h('b', {}, '✓'), t('Account created')), h('li', { class: 'on' }, h('b', {}, '2'), t('Payment')), h('li', {}, h('b', {}, '3'), t('Approval'))) : null,
    h('div', { class: `blocked-msg ${pending ? 'ok' : ''}` }, icon(pending ? 'check' : 'alert', 28),
      h('div', {},
        h('strong', {}, title),
        h('p', {}, text))),
    data && !suspended ? content(data, () => location.reload(), { compact: true }) : null,
    blocked_help(data),
    h('p', { class: 'center' }, h('a', { class: 'btn', href: window.BZL.logoutUrl }, icon('logout', 16), t('Log out'))),
    nooriyah())));
}

/** "A product of NOORIYAH Group" footer. */
export function nooriyah() {
  return h('p', { class: 'nooriyah-credit' }, h('img', { src: `${window.BZL.assetsUrl}img/nooriyah.jpg`, alt: '', width: 22, height: 22 }), t('A product of'), ' ', h('b', {}, 'NOORIYAH Group'));
}

function blocked_help(data) {
  const phone = data?.config?.support_phone || '';
  return phone ? h('p', { class: 'center muted' }, t('Need help? Call'), ' ', h('a', { href: `tel:${phone}` }, phone)) : null;
}

function content(data, onDone, { compact = false } = {}) {
  const { subscription: sub, config: cfg, payments } = data;
  const tk = (a) => `${cfg.currency}${Number(a || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const pending = payments.filter((x) => x.status === 'pending');
  const out = [];

  if (!compact) {
    out.push(h('div', { class: 'stats' },
      stat(t('Status'), subBadge(sub)),
      stat(t('Paid until'), sub.paid_until ? date(sub.paid_until) : t('No limit'), {
        tone: sub.days_left !== null && sub.days_left <= 7 ? 'warn' : '',
        hint: sub.days_left === null ? '' : sub.days_left >= 0 ? t('{n} days left', { n: sub.days_left }) : t('{n} days overdue', { n: -sub.days_left }),
      }),
      stat(t('Plan'), t(sub.cycle === 'yearly' ? 'Yearly' : 'Monthly'))));
  }

  if (!sub.managed) {
    out.push(card(null, h('p', {}, t('This shop has no subscription limit.'))));
    return out;
  }

  const trialPending = pending.find((x) => x.cycle === 'trial');
  const paidPending = pending.find((x) => x.cycle !== 'trial');
  if (trialPending) {
    out.push(card(null, h('div', { class: 'blocked-msg ok' }, icon('check', 22), h('div', {},
      h('strong', {}, t('Free trial requested — waiting for approval')),
      h('p', { class: 'muted' }, t('Your {n}-day free trial starts as soon as we approve it.', { n: cfg.trial_days }))))));
  }
  if (paidPending) {
    out.push(card(null, h('div', { class: 'blocked-msg ok' }, icon('check', 22), h('div', {},
      h('strong', {}, t('Payment received — waiting for approval')),
      h('p', { class: 'muted' }, t('TrxID {r}. Your shop will be extended as soon as it is checked.', { r: paidPending.reference }))))));
  }

  // A new sign-up can start with the free trial instead of paying.
  if (data.is_owner && sub.status === 'pending' && !data.trial_used && Number(cfg.trial_days) > 0 && cfg.signup_trial !== 'off') {
    const btn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: async () => {
      btn.disabled = true;
      try {
        await api.post('subscription/trial');
        toast(cfg.signup_trial === 'instant' ? t('Your free trial has started!') : t('Free trial requested'));
        if (cfg.signup_trial === 'instant') location.reload(); else onDone();
      } catch (err) { btn.disabled = false; showError(err); }
    } }, t('Start {n}-day free trial', { n: cfg.trial_days }));
    out.push(card(null, h('div', { class: 'trial-card' },
      h('div', {}, h('strong', {}, t('Try it free for {n} days', { n: cfg.trial_days })),
        h('p', { class: 'muted' }, cfg.signup_trial === 'instant' ? t('No payment needed. Your shop opens right now; pay when the trial ends.') : t('No payment needed. Your shop opens as soon as we approve it.'))),
      btn),
      h('p', { class: 'or-line' }, h('span', {}, t('or pay now')))));
  }

  if (data.is_owner) {
    let cycle = sub.cycle || 'monthly';
    const plans = h('div', { class: 'plan-pick' });
    const payBox = h('div');
    const paint = () => mount(payBox, payMethods(cfg, tk(cycle === 'yearly' ? cfg.yearly_price : cfg.monthly_price))) && mount(plans, [['monthly', t('Monthly'), cfg.monthly_price, t('1 month')], ['yearly', t('Yearly'), cfg.yearly_price, t('12 months')]].map(([k, label, price, len]) =>
      h('button', { type: 'button', class: `plan ${cycle === k ? 'on' : ''}`, 'aria-pressed': String(cycle === k), onclick: () => { cycle = k; paint(); } },
        h('span', {}, label), h('strong', {}, tk(price)), h('small', { class: 'muted' }, len))));
    paint();
    const f = h('form', { class: 'form' },
      h('p', {}, h('strong', {}, t('1. Choose a plan'))),
      plans,
      h('p', {}, h('strong', {}, t('2. Send the money'))),
      payBox,
      h('p', {}, h('strong', {}, t('3. Tell us the transaction ID'))),
      h('div', { class: 'form-grid' },
        field(t('Paid with'), select('method', METHODS, 'bkash')),
        field(t('TrxID'), input('reference', '', { required: true, placeholder: '8N7A6B5C4D' }), { required: true }),
        field(t('Your bKash/Nagad number'), input('payer_phone', '', { type: 'tel', inputmode: 'tel' }))),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, icon('check', 18), t('Submit payment'))));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await api.post('subscription/renew', { ...values(f), cycle });
        toast(t('Thank you! We will confirm your payment shortly.'));
        onDone();
      } catch (err) { showFieldErrors(f, err.errors); showError(err); } finally { btn.disabled = false; }
    });
    out.push(card(t('Renew'), f));
  } else {
    out.push(card(null, h('p', {}, t('Ask the shop owner to renew the subscription.'))));
  }

  if (!compact && payments.length) {
    out.push(card(t('Payment history'), simpleTable([
      { label: t('Date'), render: (x) => datetime(x.created_at) },
      { label: t('Amount'), align: 'right', render: (x) => tk(x.amount) },
      { label: t('TrxID'), key: 'reference' },
      { label: t('Period'), render: (x) => (x.period_to ? `${date(x.period_from)} – ${date(x.period_to)}` : '—') },
      { label: t('Status'), render: (x) => badge({ pending: 'partial', approved: 'paid', rejected: 'void' }[x.status], t(x.status === 'pending' ? 'Waiting' : x.status === 'approved' ? 'Approved' : 'Rejected')) },
    ], payments)));
  }
  return out;
}
