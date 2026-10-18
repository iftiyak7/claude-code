/**
 * Settings. Each tab edits a group of keys from /settings, plus business
 * profile, tax rates, product lists, printer pairing and data tools.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can, state, emit } from '../core/state.js';
import { t, currentLang } from '../core/i18n.js';
import { page, card, field, input, select, textarea, checkbox, values, toast, showError, showFieldErrors, simpleTable, modal, confirmDialog, downloadText, empty, spinner, tabs } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';
import { connectPrinter, printTest, transport } from '../core/printer.js';
import { refreshSnapshot } from '../core/offline.js';

const TABS = [
  ['business', 'Business', ['business.manage']],
  ['invoice', 'Invoice', ['settings.manage']],
  ['sales', 'Sales & POS', ['settings.manage']],
  ['tax', 'Tax / VAT', ['settings.manage']],
  ['printer', 'Printer', ['settings.manage']],
  ['inventory', 'Products & stock', ['settings.manage']],
  ['numbering', 'Numbering', ['settings.manage']],
  ['general', 'General', ['settings.manage']],
  ['notifications', 'Notifications', ['settings.manage']],
  ['data', 'Import / export / backup', ['data.import', 'data.export', 'backup.manage']],
];

export default async function settings(el, params) {
  const allowed = TABS.filter(([, , perms]) => perms.some(can));
  if (!allowed.length) { mount(el, empty(t('You do not have access to settings.'))); return; }
  const tab = allowed.some(([k]) => k === params.tab) ? params.tab : allowed[0][0];
  const p = page(t('Settings'));
  const body = h('div', {}, spinner());
  p.body.append(tabs(allowed.map(([k, l]) => [k, t(l)]), tab, (k) => navigate(`/settings/${k}`)), body);
  mount(el, p.el);
  const S = await api.get('settings');
  mount(body, await (RENDER[tab] || (() => empty('')))(S));
}

/* -------------------------------------------------------------- helpers */

function settingsForm(S, rows, { after } = {}) {
  const controls = rows.map(([key, label, type, opts = {}]) => {
    const v = S[key];
    let ctl;
    if (type === 'bool') return h('div', { class: 'field', dataset: { field: key } }, checkbox(key, !!v, label), opts.hint ? h('small', { class: 'hint' }, opts.hint) : null, h('small', { class: 'error' }));
    if (type === 'select') ctl = select(key, opts.options, v);
    else if (type === 'textarea') ctl = textarea(key, v, { rows: 3 });
    else if (type === 'color') ctl = input(key, v, { type: 'color' });
    else if (type === 'number') ctl = input(key, v, { type: 'number', min: 0 });
    else if (type === 'date') ctl = input(key, v, { type: 'date' });
    else ctl = input(key, v);
    return field(label, ctl, { hint: opts.hint, wide: type === 'textarea' });
  });
  const f = h('form', { class: 'form' }, card(null, h('div', { class: 'form-grid' }, controls)), after || null,
    h('div', { class: 'form-actions sticky' }, h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, t('Save settings'))));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = values(f);
    const out = {};
    rows.forEach(([key, , type]) => { out[key] = type === 'number' ? Number(v[key]) : v[key]; });
    try {
      await api.put('settings', { settings: out });
      toast(t('Settings saved'));
      emit('session:reload', {});
    } catch (err) { showFieldErrors(f, err.errors || {}); showError(err); }
  });
  return f;
}

/* -------------------------------------------------------------- tabs */

const RENDER = {
  async business() {
    const b = await api.get('business');
    const logoId = input('logo_id', b.logo_id || '', { type: 'hidden' });
    const preview = h('div', { class: 'img-preview' }, b.logo_url ? h('img', { src: b.logo_url, alt: '' }) : null);
    const file = h('input', { type: 'file', accept: 'image/*', class: 'input' });
    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      try { const r = await api.upload(file.files[0], 'logo'); logoId.value = r.id; mount(preview, h('img', { src: r.url, alt: '' })); } catch (err) { showError(err); }
    });
    const types = Object.entries(state.me.types).map(([k, v]) => [k, t(v)]);
    const f = h('form', { class: 'form' },
      card(t('Profile'), h('div', { class: 'form-grid' },
        field(t('Business name'), input('name', b.name, { required: true }), { required: true }),
        field(t('Legal name'), input('legal_name', b.legal_name)),
        field(t('Business type'), select('business_type', types, b.business_type)),
        field(t('Phone'), input('phone', b.phone)),
        field(t('Email'), input('email', b.email, { type: 'email' })),
        field(t('Website'), input('website', b.website)),
        field(t('Tax / VAT / BIN number'), input('tax_number', b.tax_number)),
        field(t('Address'), textarea('address', b.address, { rows: 2 }), { wide: true }),
        h('div', { class: 'field' }, h('label', {}, t('Logo')), preview, file, logoId))),
      card(t('Money & time'), h('div', { class: 'form-grid' },
        field(t('Currency code'), input('currency_code', b.currency_code, { maxlength: 3 }), { hint: 'BDT, USD, INR…' }),
        field(t('Currency symbol'), input('currency_symbol', b.currency_symbol)),
        field(t('Symbol position'), select('currency_position', [['before', '৳100'], ['before_space', '৳ 100'], ['after', '100৳'], ['after_space', '100 ৳']], b.currency_position)),
        field(t('Decimal places'), select('decimals', [0, 1, 2, 3, 4].map((n) => [n, String(n)]), b.decimals)),
        field(t('Timezone'), input('timezone', b.timezone), { hint: 'Asia/Dhaka' }),
        field(t('Fiscal year starts (MM-DD)'), input('fiscal_year_start', b.fiscal_year_start), { hint: '07-01' }))),
      h('div', { class: 'form-actions sticky' }, h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, t('Save'))));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api.put('business', values(f)); toast(t('Saved')); emit('session:reload', {}); } catch (err) { showFieldErrors(f, err.errors || {}); showError(err); }
    });
    return f;
  },

  invoice(S) {
    return settingsForm(S, [
      ['invoice.template', t('Template'), 'select', { options: [['classic', t('Classic')], ['modern', t('Modern')], ['compact', t('Compact')]] }],
      ['invoice.paper', t('Default paper'), 'select', { options: [['a4', 'A4'], ['a5', 'A5'], ['80mm', '80mm'], ['58mm', '58mm']] }],
      ['invoice.color', t('Brand colour'), 'color'],
      ['invoice.font', t('Font'), 'select', { options: [['system', t('System (supports Bangla)')], ['serif', t('Serif')], ['mono', t('Monospace')]] }],
      ['invoice.show_logo', t('Show logo'), 'bool'],
      ['invoice.show_due', t('Show due amount'), 'bool'],
      ['invoice.show_signature', t('Show signature line'), 'bool'],
      ['invoice.signature_label', t('Signature label'), 'text'],
      ['invoice.footer', t('Footer message'), 'textarea'],
      ['invoice.terms', t('Terms & conditions'), 'textarea'],
    ]);
  },

  async sales(S) {
    const usage = await api.get('sms/usage').catch(() => null);
    const testPhone = input('test_phone', '', { type: 'tel', placeholder: '01XXXXXXXXX' });
    const smsCard = card(t('SMS to customers'),
      usage?.available
        ? h('p', { class: 'muted small' }, t('{n} SMS sent this month', { n: usage.month }), usage.failed ? h('span', { class: 'bad-text' }, ` · ${t('{n} failed', { n: usage.failed })}`) : null)
        : h('p', { class: 'callout small' }, t('SMS is not set up yet. The site owner adds an SMS gateway (BulkSMSBD, Alpha SMS, GreenWeb…) in Shops (clients) → Settings.')),
      h('p', { class: 'muted small' }, t('Message words you can use: {shop} {customer} {invoice} {total} {paid} {due} {total_due}. Leave empty for the standard message.')),
      usage?.available ? h('div', { class: 'row wrap' }, testPhone, h('button', { class: 'btn btn-sm', type: 'button', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try { await api.post('sms/send', { phone: testPhone.value, message: `${state.business.name}: ${t('Test SMS from Goriber Hisab')}`, ref_type: 'test' }); toast(t('SMS sent')); } catch (err) { showError(err); } finally { b.disabled = false; }
      } }, t('Send test SMS'))) : null);
    return settingsForm(S, [
      ['sms.after_sale', t('Send an SMS to the customer after every sale (needs the customer\'s phone)'), 'bool'],
      ['sms.sale_template', t('SMS message (optional)'), 'textarea'],
      ['sales.default_payment_account', t('Default payment method'), 'select', { options: [['0', t('Cash')], ...state.me.payment_accounts.map((a) => [a.id, a.name])] }],
      ['sales.allow_credit_walkin', t('Allow due sales without a customer'), 'bool'],
      ['sales.enforce_credit_limit', t('Enforce customer credit limits'), 'bool'],
      ['sales.allow_below_min_price', t('Allow selling below minimum price'), 'bool'],
      ['pos.auto_print', t('Print receipt automatically after each sale'), 'bool'],
      ['pos.paper', t('Receipt paper'), 'select', { options: [['80mm', '80mm'], ['58mm', '58mm'], ['a5', 'A5'], ['a4', 'A4']] }],
      ['pos.show_images', t('Show product images in POS'), 'bool'],
    ], { after: smsCard });
  },

  async tax(S) {
    const rates = await api.get('tax-rates');
    const reload = () => navigate('/settings/tax', true);
    const rateCard = card(t('Tax rates'),
      rates.length ? simpleTable([
        { label: t('Name'), key: 'name' },
        { label: t('Rate %'), align: 'right', render: (r) => String(Number(r.rate)) },
        { label: t('Price includes tax'), render: (r) => (r.is_inclusive ? t('Yes') : t('No')) },
        { label: t('Default'), render: (r) => (r.is_default ? '✓' : '') },
        { label: '', render: (r) => h('button', { class: 'btn btn-sm', type: 'button', onclick: () => rateForm(r, reload) }, t('Edit')) },
      ], rates) : h('p', { class: 'muted' }, t('No tax rates yet.')),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => rateForm(null, reload) }, icon('plus', 14), t('Add rate')));
    return settingsForm(S, [
      ['tax.enabled', t('Charge tax / VAT'), 'bool'],
      ['tax.label', t('Tax label on invoices'), 'text', { hint: 'VAT, GST, Tax…' }],
      ['tax.mode', t('How tax is applied'), 'select', { options: [['line', t('Per product (each product can have its own rate)')], ['invoice', t('Per invoice (one rate for the whole invoice)')]] }],
      ['tax.purchase_recoverable', t('Purchase tax can be claimed back (input tax)'), 'bool', { hint: t('If off, tax paid on purchases is added to product cost.') }],
    ], { after: rateCard });
  },

  printer(S) {
    const status = h('span', { class: 'muted' }, transport()?.name || '');
    const tools = card(t('Thermal printer'),
      h('p', { class: 'muted small' }, t('Bluetooth printing works in Chrome on Android and desktop over HTTPS. In the Goriber Hisab Android app, any paired printer works through the native bridge. Otherwise receipts print through the browser dialog.')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { status.textContent = await connectPrinter(); toast(t('Printer connected')); } catch (err) { toast(err.message, 'error', 6000); } } }, icon('bluetooth', 16), t('Choose printer')),
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { await printTest(); toast(t('Test page sent')); } catch (err) { toast(err.message, 'error', 6000); } } }, icon('printer', 16), t('Test print')),
        status));
    return settingsForm(S, [
      ['printer.type', t('Receipt printing'), 'select', { options: [['browser', t('Browser print dialog')], ['bluetooth', t('Bluetooth thermal printer')], ['native', t('Android app (native bridge)')]] }],
      ['printer.width', t('Paper width'), 'select', { options: [['80', '80mm'], ['58', '58mm']] }],
      ['printer.copies', t('Copies'), 'number'],
      ['printer.auto_cut', t('Cut paper after printing'), 'bool'],
      ['printer.open_drawer', t('Open cash drawer'), 'bool'],
    ], { after: tools });
  },

  async inventory(S) {
    const lists = h('div', { class: 'grid-3' });
    const paint = async () => {
      const [cats, brands, units] = await Promise.all([api.get('taxonomies/categories'), api.get('taxonomies/brands'), api.get('taxonomies/units')]);
      mount(lists, ...[['categories', t('Categories'), cats], ['brands', t('Brands'), brands], ['units', t('Units'), units]].map(([kind, label, items]) => card(label,
        h('ul', { class: 'list' }, items.map((x) => h('li', {}, h('span', {}, x.name, kind === 'units' ? h('small', { class: 'muted' }, ` (${x.short_name})`) : null, h('small', { class: 'muted' }, ` · ${x.product_count}`)),
          h('span', { class: 'row' },
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Edit'), onclick: () => termForm(kind, x, paint) }, icon('edit', 14)),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Delete'), onclick: async () => {
              if (!(await confirmDialog(t('Delete {n}?', { n: x.name }), { danger: true }))) return;
              try { await api.del(`taxonomies/${kind}/${x.id}`); paint(); } catch (err) { showError(err); }
            } }, icon('trash', 14)))))),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => termForm(kind, null, paint) }, icon('plus', 14), t('Add')))));
    };
    paint();
    return settingsForm(S, [
      ['inventory.allow_negative', t('Allow selling more than in stock'), 'bool', { hint: t('Off is safer: sales stop when stock runs out.') }],
      ['inventory.low_stock_alerts', t('Low stock alerts'), 'bool'],
      ['features.variants', t('Use product variants (size, colour)'), 'bool'],
      ['features.wholesale', t('Use wholesale prices'), 'bool'],
      ['features.batches', t('Track batches (coming soon)'), 'bool'],
      ['features.expiry', t('Track expiry dates (coming soon)'), 'bool'],
    ], { after: lists });
  },

  numbering(S) {
    const hint = t('Use {SEQ:6} for the running number, plus {YYYY} {YY} {MM} {DD} {BRANCH}.');
    return settingsForm(S, [
      ['numbering.sale', t('Invoices'), 'text', { hint }],
      ['numbering.purchase', t('Purchases'), 'text'],
      ['numbering.payment_in', t('Money receipts'), 'text'],
      ['numbering.payment_out', t('Payment vouchers'), 'text'],
      ['numbering.expense', t('Expenses'), 'text'],
      ['numbering.income', t('Income'), 'text'],
      ['numbering.sale_return', t('Sales returns'), 'text'],
      ['numbering.purchase_return', t('Purchase returns'), 'text'],
      ['numbering.customer', t('Customer IDs'), 'text'],
      ['numbering.supplier', t('Supplier IDs'), 'text'],
      ['numbering.reset', t('Restart numbering'), 'select', { options: [['never', t('Never')], ['yearly', t('Every year')], ['monthly', t('Every month')]] }],
    ]);
  },

  general(S) {
    const lang = select('lang', [['en', 'English'], ['bn', 'বাংলা']], currentLang());
    lang.addEventListener('change', () => { try { localStorage.setItem('bzl.lang', lang.value); } catch { /* ignore */ } document.cookie = `gh_lang=${lang.value}; path=/; max-age=31536000; SameSite=Lax`; location.reload(); });
    return settingsForm(S, [
      ['general.date_format', t('Date format'), 'select', { options: [['d/m/Y', '31/12/2026'], ['m/d/Y', '12/31/2026'], ['Y-m-d', '2026-12-31'], ['d M Y', '31 Dec 2026']] }],
      ['general.thousand_sep', t('Thousands separator'), 'select', { options: [[',', '1,000'], ['.', '1.000'], [' ', '1 000'], ['', '1000']] }],
      ['general.decimal_sep', t('Decimal separator'), 'select', { options: [['.', '0.50'], [',', '0,50']] }],
      ['accounting.lock_date', t('Lock books up to'), 'date', { hint: t('No transaction can be added or changed on or before this date.') }],
      ['audit.log_ip', t('Record IP address in the audit log'), 'bool'],
    ], { after: card(t('Language on this device'), field(t('Language'), lang)) });
  },

  notifications(S) {
    return settingsForm(S, [
      ['notifications.low_stock', t('Low stock'), 'bool'],
      ['notifications.sales', t('Every sale'), 'bool'],
      ['notifications.purchases', t('Purchases added'), 'bool'],
      ['notifications.payments', t('Payments received'), 'bool'],
      ['notifications.backup_reminder_days', t('Remind me to back up every (days, 0 = never)'), 'number'],
    ]);
  },

  async data() {
    const out = [];
    if (can('data.import')) out.push(importCard());
    if (can('data.export')) {
      out.push(card(t('Export'), h('p', { class: 'muted' }, t('Download as CSV (opens in Excel / Google Sheets).')),
        h('div', { class: 'row wrap' }, [['products', t('Products')], ['customers', t('Customers')], ['suppliers', t('Suppliers')], ['sales', t('Sales')], ['purchases', t('Purchases')], ['expenses', t('Expenses')], ['incomes', t('Income')], ['payments', t('Payments')], ['stock', t('Stock')]].map(([k, l]) =>
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { const r = await api.get(`export/${k}`, { status: 'any' }); downloadText(r.filename, r.csv); } catch (err) { showError(err); } } }, icon('download', 14), l)))));
    }
    if (can('backup.manage')) {
      out.push(card(t('Backup'), h('p', { class: 'muted' }, t('A complete copy of this business (all records and settings) as a JSON file. Keep it somewhere safe.')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
          e.target.disabled = true;
          try { const b = await api.get('backup'); downloadText(`goriber-hisab-backup-${state.business.id}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b), 'application/json'); toast(t('Backup downloaded')); }
          catch (err) { showError(err); } finally { e.target.disabled = false; }
        } }, icon('download', 16), t('Download backup')),
        h('p', { class: 'muted small' }, t('Restore from backup is coming in the next release. Your hosting provider\'s database backups also cover Goriber Hisab.'))));
    }
    return h('div', {}, out);
  },
};

function rateForm(r, onDone) {
  const f = h('form', { class: 'form' }, h('div', { class: 'form-grid' },
    field(t('Name'), input('name', r?.name || 'VAT', { required: true }), { required: true }),
    field(t('Rate %'), input('rate', r ? Number(r.rate) : '', { inputmode: 'decimal', required: true }), { required: true }),
    h('div', { class: 'field' }, checkbox('is_inclusive', !!r?.is_inclusive, t('Prices already include this tax'))),
    h('div', { class: 'field' }, checkbox('is_default', !!r?.is_default, t('Default rate')))));
  const m = modal({
    title: r ? t('Edit tax rate') : t('Add tax rate'), size: 'sm', body: f,
    actions: [
      r ? h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: async () => { try { await api.del(`tax-rates/${r.id}`); m.close(); onDone(); } catch (err) { showError(err); } } }, t('Delete')) : null,
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        try { if (r) await api.put(`tax-rates/${r.id}`, values(f)); else await api.post('tax-rates', values(f)); m.close(); emit('session:reload', { go: '/settings/tax' }); onDone(); }
        catch (err) { showFieldErrors(f, err.errors || {}); showError(err); }
      } }, t('Save')),
    ],
  });
}

function termForm(kind, x, onDone) {
  const f = h('form', { class: 'form' }, field(t('Name'), input('name', x?.name, { required: true, autofocus: true }), { required: true }),
    kind === 'units' ? field(t('Short name'), input('short_name', x?.short_name)) : null,
    kind === 'units' ? checkbox('allow_decimal', !!Number(x?.allow_decimal), t('Allow fractions (e.g. 1.5 kg)')) : null);
  const m = modal({
    title: x ? t('Edit') : t('Add'), size: 'sm', body: f,
    actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      try { if (x) await api.put(`taxonomies/${kind}/${x.id}`, values(f)); else await api.post(`taxonomies/${kind}`, values(f)); m.close(); onDone(); refreshSnapshot(); }
      catch (err) { showFieldErrors(f, err.errors || {}); showError(err); }
    } }, t('Save'))],
  });
}

/** CSV import with header mapping preview, dry run, then import. */
function importCard() {
  const type = select('type', [['products', t('Products')], ['customers', t('Customers')], ['suppliers', t('Suppliers')]], 'products');
  const file = h('input', { type: 'file', accept: '.csv,text/csv', class: 'input' });
  const result = h('div');
  let rows = [];

  file.addEventListener('change', async () => {
    const text = await file.files[0]?.text();
    if (!text) return;
    rows = parseCsv(text);
    mount(result, h('p', {}, t('{n} rows read. Check them first with a dry run.', { n: rows.length })));
  });
  const run = async (dry) => {
    if (!rows.length) { toast(t('Choose a CSV file first.'), 'error'); return; }
    try {
      const r = await api.post(`import/${type.value}`, { rows, dry_run: dry ? 1 : 0 });
      mount(result,
        h('p', { class: r.errors.length ? 'warn-text' : 'ok-text' }, dry ? t('Dry run: {n} rows OK, {e} with problems. Nothing was saved.', { n: r.created, e: r.errors.length }) : t('Imported {n} rows; {e} skipped.', { n: r.created, e: r.errors.length })),
        r.errors.length ? simpleTable([{ label: t('Row'), key: 'row' }, { label: t('Name'), key: 'name' }, { label: t('Problem'), key: 'message' }], r.errors) : null);
      if (!dry) emit('session:reload', { go: '/settings/data' });
    } catch (err) { showError(err); }
  };
  const template = async () => {
    const tpl = await api.get('import/templates');
    downloadText(`${type.value}-template.csv`, '﻿' + tpl[type.value].join(',') + '\n');
  };
  return card(t('Import from CSV / Excel'),
    h('p', { class: 'muted' }, t('Save your Excel sheet as CSV. The first row must contain column names — download a template to see them.')),
    h('div', { class: 'row wrap' }, type, file, h('button', { class: 'btn btn-sm', type: 'button', onclick: template }, t('Template'))),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => run(true) }, t('Dry run')), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => run(false) }, t('Import'))),
    result);
}

/** RFC 4180 CSV → array of objects keyed by header. */
export function parseCsv(text) {
  const out = [];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...data] = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (!head) return out;
  for (const r of data) out.push(Object.fromEntries(head.map((k, i) => [k.trim(), (r[i] ?? '').trim()])));
  return out;
}
