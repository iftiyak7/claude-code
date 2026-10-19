/**
 * Barcode input:
 *  - Keyboard-wedge USB/Bluetooth scanners: fast keystrokes ending in Enter
 *    are captured globally and delivered to the active handler.
 *  - Camera scanning with the BarcodeDetector API (Chrome/Android).
 */
import { h } from './dom.js';
import { modal, toast } from './ui.js';
import { t } from './i18n.js';

let handler = null;
let fallback = null;
let buffer = '';
let last = 0;

/** What a scan does on screens without their own handler (open the invoice/order). */
export function setDefaultScan(fn) {
  fallback = fn;
}

/** Route wedge-scanner input to fn(code) while a screen is active. */
export function onScan(fn) {
  handler = fn;
  return () => { if (handler === fn) handler = null; };
}

document.addEventListener('keydown', (e) => {
  const fn = handler || fallback;
  if (!fn) return;
  const now = performance.now();
  const typingInField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  if (now - last > 60) buffer = '';
  last = now;
  if (e.key === 'Enter') {
    // Scanners type ≥4 chars in rapid succession; humans don't.
    if (buffer.length >= 4 && !typingInField) {
      e.preventDefault();
      fn(buffer);
    }
    buffer = '';
    return;
  }
  if (e.key.length === 1) buffer += e.key;
}, true);

const native = () => 'BarcodeDetector' in window;
export const cameraSupported = () => !!navigator.mediaDevices?.getUserMedia;

// Browsers without BarcodeDetector (Windows/Linux Chrome, Firefox, some
// Android WebViews) read codes with ZXing (Apache-2.0, shipped in
// assets/vendor so it also works offline), loaded only when first needed.
let zxing = null;
function loadZxing() {
  zxing = zxing || new Promise((resolve, reject) => {
    if (window.ZXing) { resolve(window.ZXing); return; }
    const s = document.createElement('script');
    s.src = `${window.BZL.assetsUrl}vendor/zxing.min.js?v=${window.BZL.version}`;
    s.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error('Scanner failed to load')));
    s.onerror = () => { zxing = null; reject(new Error('Scanner failed to load')); };
    document.head.append(s);
  });
  return zxing;
}

/** Open the camera and resolve with the first code read (or null). */
export async function scanWithCamera() {
  if (!cameraSupported()) {
    toast(t('Camera scanning is not supported in this browser. Use Chrome on Android, or a USB/Bluetooth scanner.'), 'error', 6000);
    return null;
  }
  const video = h('video', { class: 'scan-video', playsinline: true, muted: true });
  let stream;
  let controls;
  let done = false;
  const stop = () => { done = true; controls?.stop(); stream?.getTracks().forEach((tr) => tr.stop()); };
  return new Promise(async (resolve) => {
    const m = modal({
      title: t('Scan barcode'),
      body: [h('div', { class: 'scan-frame' }, video, h('span', { class: 'scan-line' })), h('p', { class: 'muted' }, t('Point the camera at a barcode or QR code.'))],
      onClose: () => { stop(); resolve(null); },
    });
    const found = (code) => {
      if (done) return;
      stop();
      navigator.vibrate?.(80);
      resolve(code);
      m.dialog.close(); m.dialog.remove();
    };
    try {
      if (native()) {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        await video.play();
        const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'itf'] });
        const tick = async () => {
          if (done) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length) { found(codes[0].rawValue); return; }
          } catch { /* frame not ready */ }
          requestAnimationFrame(tick);
        };
        tick();
      } else {
        const { BrowserMultiFormatReader } = await loadZxing();
        if (done) return;
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (result) => { if (result) found(result.getText()); });
        if (done) controls.stop();
      }
    } catch (err) {
      toast(t('Could not open the camera: {e}', { e: err.message }), 'error');
      m.close();
    }
  });
}
