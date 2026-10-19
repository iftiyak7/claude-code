/**
 * Scan the barcode on an invoice / receipt (or type its number) and open it:
 * a shop sale opens the sale, an online order — local delivery or courier —
 * opens the order with its delivery. Courier consignment IDs and product
 * barcodes work too.
 */
import { h } from './dom.js';
import { api } from './api.js';
import { t } from './i18n.js';
import { modal, toast } from './ui.js';
import { icon } from './icons.js';
import { navigate } from './router.js';
import { scanWithCamera, cameraSupported } from './scanner.js';

/** Look a code up and go there. Resolves true when something opened. */
export async function openCode(code) {
  const c = String(code || '').trim();
  if (!c) return false;
  try {
    const r = await api.get('lookup', { code: c });
    navigate(r.path);
    toast(t('Opened {x}', { x: r.title }), 'success', 2500);
    return true;
  } catch (err) {
    toast(err.status === 404 ? t('Nothing found for {c}.', { c }) : err.message, 'error', 4000);
    return false;
  }
}

/** Dialog: camera scan, USB/Bluetooth scanner, or type the number. */
export function scanDialog() {
  const inp = h('input', { class: 'input input-lg', type: 'search', inputmode: 'text', autocomplete: 'off', placeholder: t('e.g. INV-000123 or ORD-000045'), 'aria-label': t('Invoice or order number') });
  const go = async () => { if (await openCode(inp.value)) m.close(); else inp.select(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  const m = modal({
    title: t('Scan invoice / order'), size: 'sm',
    body: h('div', { class: 'form scan-lookup' },
      cameraSupported() ? h('button', { class: 'btn btn-primary btn-lg scan-big', type: 'button', onclick: async () => {
        const code = await scanWithCamera();
        if (code && await openCode(code)) m.close();
      } }, icon('camera', 22), t('Scan with camera')) : null,
      h('p', { class: 'muted small' }, t('Or scan with a USB/Bluetooth scanner, or type the number:')),
      h('div', { class: 'row' }, inp, h('button', { class: 'btn', type: 'button', onclick: go }, t('Open'))),
      h('p', { class: 'muted small' }, t('Works with the barcode printed on every invoice and receipt — shop sales, online orders, local delivery and courier parcels.'))),
  });
  setTimeout(() => inp.focus(), 50);
}

/** Always-visible scan box (dashboard): scanner or typing + Enter, or the camera. */
export function scanBar() {
  const inp = h('input', { class: 'input', type: 'search', autocomplete: 'off', placeholder: t('Scan invoice / receipt barcode or type its number'), 'aria-label': t('Invoice or order number') });
  const go = async () => { if (inp.value.trim() && await openCode(inp.value)) inp.value = ''; else inp.select(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  return h('div', { class: 'scan-bar' },
    h('span', { class: 'scan-bar-icon' }, icon('barcode', 22)),
    h('div', { class: 'scan-bar-main' },
      h('strong', {}, t('Scan invoice / order')),
      h('div', { class: 'row' }, inp,
        h('button', { class: 'btn btn-primary', type: 'button', onclick: go }, t('Open')),
        cameraSupported() ? h('button', { class: 'btn', type: 'button', title: t('Scan with camera'), 'aria-label': t('Scan with camera'), onclick: async () => {
          const code = await scanWithCamera();
          if (code) openCode(code);
        } }, icon('camera', 18), h('span', { class: 'hide-sm' }, t('Camera'))) : null)));
}
