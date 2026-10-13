/**
 * First-run setup wizard (also used to add another business):
 * 1 Business · 2 Currency · 3 Type · 4 Team · 5 Invoice · 6 Tax · 7 Printer · 8 Finish
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { state, setBusiness, emit } from '../core/state.js';
import { t } from '../core/i18n.js';
import { field, input, select, textarea, checkbox, values, toast, showError, showFieldErrors } from '../core/ui.js';
import { icon } from '../core/icons.js';

const CURRENCIES = [['BDT', '৳', 2], ['INR', '₹', 2], ['PKR', 'Rs', 2], ['USD', '$', 2], ['EUR', '€', 2], ['GBP', '£', 2], ['AED', 'AED', 2], ['SAR', 'SAR', 2], ['MYR', 'RM', 2], ['NPR', 'Rs', 2], ['LKR', 'Rs', 2]];

export default async function setup(el) {
  if (!state.me.can_setup) {
    mount(el, h('div', { class: 'wizard' }, h('h1', {}, t('Almost there')), h('p', {}, t('Ask the business owner to add you as a user. Once added, reload this page.')),
      h('a', { class: 'btn', href: window.BZL.logoutUrl }, t('Log out'))));
    return;
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const guess = tz === 'Asia/Dhaka' ? 'BDT' : tz.startsWith('Asia/Kolkata') ? 'INR' : 'USD';
  const data = {};
  let step = 0;

  const steps = [
    [t('Business'), () => [
      field(t('Business name'), input('name', data.name, { required: true, autofocus: true }), { required: true }),
      field(t('Phone'), input('phone', data.phone, { type: 'tel' })),
      field(t('Email'), input('email', data.email, { type: 'email' })),
      field(t('Address'), textarea('address', data.address, { rows: 2 }), { wide: true }),
      field(t('Tax / VAT / BIN number'), input('tax_number', data.tax_number)),
    ]],
    [t('Currency'), () => {
      const cur = select('currency_code', CURRENCIES.map(([c, s]) => [c, `${c} (${s})`]), data.currency_code || guess);
      const sym = input('currency_symbol', data.currency_symbol || CURRENCIES.find((c) => c[0] === (data.currency_code || guess))[1]);
      cur.addEventListener('change', () => { sym.value = CURRENCIES.find((c) => c[0] === cur.value)?.[1] || cur.value; });
      return [
        field(t('Currency'), cur), field(t('Symbol'), sym),
        field(t('Decimal places'), select('decimals', [[0, '0 (৳100)'], [2, '2 (৳100.00)']], data.decimals ?? 2)),
        field(t('Timezone'), input('timezone', data.timezone || tz)),
        field(t('Fiscal year starts (MM-DD)'), input('fiscal_year_start', data.fiscal_year_start || (guess === 'BDT' ? '07-01' : '01-01'))),
      ];
    }],
    [t('Business type'), () => [h('div', { class: 'type-grid wide' }, Object.entries(state.me.types).map(([k, label]) => h('label', { class: 'type-card' },
      h('input', { type: 'radio', name: 'business_type', value: k, checked: (data.business_type || 'retail') === k }), h('span', {}, t(label))))),
    h('p', { class: 'muted wide' }, t('This switches on the features your kind of business needs (e.g. expiry dates for pharmacies). You can change everything later.'))]],
    [t('Team'), () => [
      h('p', { class: 'wide' }, t('You ({n}) will be the owner with full access.', { n: state.me.user.name })),
      field(t('Invite a staff member (optional) — email'), input('staff_email', data.staff_email, { type: 'email' })),
      field(t('Their name'), input('staff_name', data.staff_name)),
      field(t('Role'), select('staff_role', [['sales', t('Sales Staff')], ['manager', t('Admin / Manager')], ['accountant', t('Accountant')], ['purchase', t('Purchase Manager')]], data.staff_role || 'sales')),
    ]],
    [t('Invoice'), () => [
      field(t('Invoice number format'), input('inv_format', data.inv_format || 'INV-{SEQ:6}'), { hint: t('e.g. INV-{YYYY}-{SEQ:5}') }),
      field(t('Brand colour'), input('inv_color', data.inv_color || '#2563eb', { type: 'color' })),
      field(t('Default paper'), select('inv_paper', [['a4', 'A4'], ['a5', 'A5'], ['80mm', '80mm'], ['58mm', '58mm']], data.inv_paper || 'a4')),
      field(t('Footer message'), input('inv_footer', data.inv_footer ?? t('Thank you for your business!')), { wide: true }),
    ]],
    [t('Tax'), () => [
      h('div', { class: 'field wide' }, checkbox('tax_enabled', !!data.tax_enabled, t('I charge VAT / tax on sales'))),
      field(t('Tax name'), input('tax_name', data.tax_name || 'VAT')),
      field(t('Rate %'), input('tax_rate', data.tax_rate || '', { inputmode: 'decimal', placeholder: '15' })),
      h('div', { class: 'field' }, checkbox('tax_inclusive', !!data.tax_inclusive, t('My prices already include tax'))),
    ]],
    [t('Printer'), () => [
      field(t('How do you print receipts?'), select('printer_type', [['browser', t('Normal / browser printing')], ['bluetooth', t('Bluetooth thermal printer')], ['native', t('BizLedger Android app')]], data.printer_type || 'browser')),
      field(t('Receipt width'), select('printer_width', [['80', '80mm'], ['58', '58mm']], data.printer_width || '80')),
      h('div', { class: 'field wide' }, checkbox('auto_print', !!data.auto_print, t('Print automatically after each POS sale'))),
    ]],
    [t('Finish'), () => [
      h('div', { class: 'wide summary' },
        h('p', {}, h('strong', {}, data.name), ` · ${data.currency_code} · ${t(state.me.types[data.business_type] || '')}`),
        h('p', { class: 'muted' }, t('We will create your chart of accounts, a main branch, units of measure and your settings.'))),
      h('div', { class: 'field wide' }, checkbox('demo', !!data.demo, t('Add sample products, customers and transactions so I can explore'))),
    ]],
  ];

  const body = h('div', { class: 'form-grid' });
  const progress = h('ol', { class: 'steps' });
  const back = h('button', { class: 'btn', type: 'button', onclick: () => { collect(); step -= 1; paint(); } }, t('Back'));
  const next = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' });
  const form = h('form', { class: 'form wizard-form', novalidate: true }, body, h('div', { class: 'form-actions' }, back, next));

  const collect = () => Object.assign(data, values(body));
  const paint = () => {
    mount(progress, steps.map(([label], i) => h('li', { class: i === step ? 'current' : i < step ? 'done' : '' }, h('span', {}, String(i + 1)), h('small', {}, label))));
    mount(body, steps[step][1]());
    back.hidden = step === 0;
    mount(next, step === steps.length - 1 ? [icon('check'), t('Create my business')] : t('Continue'));
    body.querySelector('input,select')?.focus();
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    collect();
    if (step === 0 && !String(data.name || '').trim()) { showFieldErrors(form, { name: t('Business name is required.') }); return; }
    if (step < steps.length - 1) { step += 1; paint(); return; }
    next.disabled = true;
    try {
      const res = await api.post('setup', {
        name: data.name, phone: data.phone, email: data.email, address: data.address, tax_number: data.tax_number,
        currency_code: data.currency_code, currency_symbol: data.currency_symbol, decimals: Number(data.decimals), timezone: data.timezone,
        fiscal_year_start: data.fiscal_year_start, business_type: data.business_type || 'retail', demo: data.demo ? 1 : 0,
        tax: data.tax_enabled && data.tax_rate ? { name: data.tax_name, rate: data.tax_rate, is_inclusive: data.tax_inclusive } : null,
        settings: {
          'numbering.sale': data.inv_format || 'INV-{SEQ:6}',
          'invoice.color': data.inv_color || '#2563eb',
          'invoice.paper': data.inv_paper || 'a4',
          'invoice.footer': data.inv_footer || '',
          'tax.enabled': !!data.tax_enabled,
          'tax.label': data.tax_name || 'VAT',
          'printer.type': data.printer_type || 'browser',
          'printer.width': Number(data.printer_width || 80),
          'pos.paper': `${data.printer_width || 80}mm`,
          'pos.auto_print': !!data.auto_print,
        },
      });
      setBusiness(res.business_id, 0);
      if (data.staff_email) {
        try { await api.post('members', { email: data.staff_email, name: data.staff_name, role: data.staff_role }); } catch (err) { toast(t('Business created, but the invitation failed: {e}', { e: err.message }), 'error', 8000); }
      }
      toast(t('Welcome to BizLedger!'));
      emit('session:reload', { business: res.business_id, go: '/' });
    } catch (err) {
      showError(err);
      // Jump back to the step that holds the first invalid field.
      const firstKey = Object.keys(err.errors || {})[0];
      if (firstKey) { step = ['name', 'phone', 'email', 'address', 'tax_number'].includes(firstKey) ? 0 : 1; paint(); showFieldErrors(form, err.errors); }
    } finally {
      next.disabled = false;
    }
  });

  mount(el, h('div', { class: 'wizard' },
    h('div', { class: 'wizard-head' }, h('img', { src: `${window.BZL.assetsUrl}img/icon.svg`, alt: '', width: 40, height: 40 }), h('div', {}, h('h1', {}, t('Set up your business')), h('p', { class: 'muted' }, t('Takes about two minutes. Everything can be changed later.')))),
    progress, form));
  paint();
}
