/**
 * Printing.
 *
 *  - Browser print: opens the server-rendered print view (A4/A5/80/58mm).
 *  - Thermal (ESC/POS) through pluggable transports:
 *      BluetoothTransport  Web Bluetooth (Chrome desktop/Android, HTTPS)
 *      NativeTransport     window.BizLedgerNative.print(base64) — implement
 *                          this in an Android WebView/Capacitor wrapper to
 *                          reach any paired Bluetooth/USB printer.
 *  Add more with registerTransport().
 */
import { EscPos } from './escpos.js';
import { state } from './state.js';
import { money, qty, date } from './format.js';
import { t } from './i18n.js';

const transports = new Map();
export function registerTransport(name, impl) { transports.set(name, impl); }

/* -------------------------------------------------------------- Browser */

export function printUrl(type, id, { paper, autoprint = true, extra = {} } = {}) {
  const q = new URLSearchParams({
    _wpnonce: window.BZL.nonce,
    b: String(state.businessId || state.business?.id || ''),
    br: String(state.branchId || state.ctx?.branch_id || ''),
    ...(paper ? { paper } : {}),
    ...(autoprint ? { autoprint: '1' } : {}),
    ...extra,
  });
  // Inside wp-admin the app routes through admin.php?page=bizledger&bzl_path=…
  if (window.BZL.mode === 'admin') return `${window.BZL.appUrl}&bzl_path=${encodeURIComponent(`print/${type}/${id}`)}&${q}`;
  return `${window.BZL.appUrl}print/${type}/${id}?${q}`;
}

export function openPrint(type, id, opts) {
  // Not using the 'noopener' feature: it makes window.open() return null,
  // which is indistinguishable from a blocked popup.
  const url = printUrl(type, id, opts);
  const w = window.open(url, '_blank');
  if (w) w.opener = null;
  else location.href = url; // popup blocked: print in this tab

}

/* -------------------------------------------------------------- Bluetooth */

// Common BLE printer GATT services (generic serial + popular vendors).
const SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ff00-0000-1000-8000-00805f9b34fb'];

class BluetoothTransport {
  constructor() { this.device = null; this.char = null; }

  get supported() { return !!navigator.bluetooth; }

  async connect(forcePick = false) {
    if (!this.supported) throw new Error(t('This browser cannot use Bluetooth. Use Chrome on Android/desktop, or the BizLedger Android app.'));
    if (this.char && this.device?.gatt?.connected && !forcePick) return;
    if (!this.device || forcePick) {
      this.device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
    }
    const server = await this.device.gatt.connect();
    for (const uuid of SERVICES) {
      try {
        const service = await server.getPrimaryService(uuid);
        const chars = await service.getCharacteristics();
        this.char = chars.find((c) => c.properties.writeWithoutResponse || c.properties.write);
        if (this.char) break;
      } catch { /* try next */ }
    }
    if (!this.char) throw new Error(t('Connected, but this printer has no writable channel we recognise.'));
  }

  get name() { return this.device?.name || ''; }

  async send(bytes) {
    await this.connect();
    const chunk = 180; // BLE MTU-safe
    for (let i = 0; i < bytes.length; i += chunk) {
      const part = bytes.slice(i, i + chunk);
      if (this.char.properties.writeWithoutResponse) await this.char.writeValueWithoutResponse(part);
      else await this.char.writeValue(part);
    }
  }
}

class NativeTransport {
  get supported() { return typeof window.BizLedgerNative?.print === 'function'; }
  async connect() {
    if (typeof window.BizLedgerNative?.selectPrinter === 'function') await window.BizLedgerNative.selectPrinter();
  }
  get name() { return window.BizLedgerNative?.printerName?.() || 'Native printer'; }
  async send(bytes) {
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    await window.BizLedgerNative.print(btoa(bin));
  }
}

registerTransport('bluetooth', new BluetoothTransport());
registerTransport('native', new NativeTransport());

export function transport() {
  const type = state.settings['printer.type'];
  if (transports.get('native')?.supported) return transports.get('native');
  return transports.get(type) || null;
}

export async function connectPrinter() {
  const tr = transport() || transports.get('bluetooth');
  await tr.connect(true);
  return tr.name;
}

/* -------------------------------------------------------------- Receipts */

export function receiptBytes(sale) {
  const s = state.settings;
  const b = state.business;
  const p = new EscPos(Number(s['printer.width']) === 58 ? 58 : 80);
  p.align('center').bold().size(1, 2).line(b.name).size(1, 1).bold(false);
  if (b.address) p.line(b.address.split('\n')[0]);
  if (b.phone) p.line(b.phone);
  if (b.tax_number) p.line(`${s['tax.label']}: ${b.tax_number}`);
  p.rule().align('left');
  p.pair(sale.number, date(sale.sale_date));
  if (sale.customer) p.line(`${sale.customer.name}${sale.customer.phone ? ' ' + sale.customer.phone : ''}`);
  p.rule();
  for (const it of sale.items) {
    p.line(it.name);
    p.pair(`  ${qty(it.qty)} x ${money(it.unit_price)}`, money(it.total));
  }
  p.rule();
  p.pair(t('Subtotal'), money(sale.subtotal));
  if (Number(sale.discount_amount)) p.pair(t('Discount'), '-' + money(sale.discount_amount));
  if (Number(sale.tax_amount)) p.pair(s['tax.label'], money(sale.tax_amount));
  if (Number(sale.shipping_amount)) p.pair(t('Shipping'), money(sale.shipping_amount));
  p.bold().pair(t('TOTAL'), money(sale.total)).bold(false);
  for (const pay of sale.payments || []) p.pair(pay.account_name, money(pay.amount));
  if (sale.meta?.tendered && Number(sale.meta.tendered) > Number(sale.paid_amount)) {
    p.pair(t('Cash given'), money(sale.meta.tendered));
    p.pair(t('Change'), money(String(Number(sale.meta.tendered) - Number(sale.paid_amount))));
  }
  if (Number(sale.due_amount) > 0) p.bold().pair(t('DUE'), money(sale.due_amount)).bold(false);
  p.rule().align('center').barcode(sale.number);
  if (s['invoice.footer']) p.line(s['invoice.footer']);
  p.feed(3);
  if (s['printer.auto_cut']) p.cut();
  if (s['printer.open_drawer']) p.drawer();
  return p.encode();
}

export function testPageBytes() {
  const p = new EscPos(Number(state.settings['printer.width']) === 58 ? 58 : 80);
  p.align('center').bold().size(2, 2).line('BizLedger').size(1, 1).bold(false)
    .line(t('Printer test')).rule().align('left')
    .pair('Left', 'Right').line('1234567890'.repeat(5).slice(0, p.cols))
    .line('বাংলা লেখা পরীক্ষা').align('center').barcode('TEST-123').feed(3).cut();
  return p.encode();
}

/**
 * Print a sale: thermal when a transport is configured, else browser.
 * Falls back to browser printing if the thermal printer fails.
 */
export async function printSale(sale, { forceBrowser = false } = {}) {
  const tr = forceBrowser ? null : transport();
  const paper = state.settings['pos.paper'];
  if (tr && tr.supported) {
    try {
      const copies = Math.max(1, Number(state.settings['printer.copies']) || 1);
      const bytes = receiptBytes(sale);
      for (let i = 0; i < copies; i++) await tr.send(bytes);
      return 'thermal';
    } catch (err) {
      console.warn('Thermal print failed, using browser print', err);
    }
  }
  openPrint('sale', sale.id, { paper });
  return 'browser';
}

export async function printTest() {
  const tr = transport();
  if (!tr) throw new Error(t('Choose Bluetooth or Native printer in settings first.'));
  await tr.send(testPageBytes());
}
