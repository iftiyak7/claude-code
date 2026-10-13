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
  mount(root, h('main', { class: 'bare blocked' }, h('div', { class: 'blocked-card' },
    h('div', { class: 'brand' }, h('img', { src: `${window.BZL.assetsUrl}img/icon.svg`, alt: '', width: 48, height: 48 }), h('h1', {}, blocked.business_name)),
    h('div', { class: 'blocked-msg' }, icon('alert', 28),
      h('div', {},
        h('strong', {}, suspended ? t('This shop has been suspended.') : t('Your subscription has expired.')),
        h('p', {}, suspended ? t('Please contact support to continue.') : t('Your data is safe. Renew to continue using the software.')))),
    data && !suspended ? content(data, () => location.reload(), { compact: true }) : null,
    blocked_help(data),
    h('p', { class: 'center' }, h('a', { class: 'btn', href: window.BZL.logoutUrl }, icon('logout', 16), t('Log out'))))));
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

  if (pending.length) {
    out.push(card(null, h('div', { class: 'blocked-msg ok' }, icon('check', 22), h('div', {},
      h('strong', {}, t('Payment received — waiting for approval')),
      h('p', { class: 'muted' }, t('TrxID {r}. Your shop will be extended as soon as it is checked.', { r: pending[0].reference }))))));
  }

  if (data.is_owner) {
    let cycle = sub.cycle || 'monthly';
    const plans = h('div', { class: 'plan-pick' });
    const paint = () => mount(plans, [['monthly', t('Monthly'), cfg.monthly_price, t('1 month')], ['yearly', t('Yearly'), cfg.yearly_price, t('12 months')]].map(([k, label, price, len]) =>
      h('button', { type: 'button', class: `plan ${cycle === k ? 'on' : ''}`, 'aria-pressed': String(cycle === k), onclick: () => { cycle = k; paint(); } },
        h('span', {}, label), h('strong', {}, tk(price)), h('small', { class: 'muted' }, len))));
    paint();
    const f = h('form', { class: 'form' },
      h('p', {}, h('strong', {}, t('1. Choose a plan'))),
      plans,
      h('p', {}, h('strong', {}, t('2. Send the money'))),
      cfg.payment_instructions ? h('pre', { class: 'pay-instructions' }, cfg.payment_instructions) : h('p', { class: 'muted' }, t('Contact support for payment details.')),
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
