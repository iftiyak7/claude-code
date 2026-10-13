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
let buffer = '';
let last = 0;

/** Route wedge-scanner input to fn(code) while a screen is active. */
export function onScan(fn) {
  handler = fn;
  return () => { if (handler === fn) handler = null; };
}

document.addEventListener('keydown', (e) => {
  if (!handler) return;
  const now = performance.now();
  const typingInField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  if (now - last > 60) buffer = '';
  last = now;
  if (e.key === 'Enter') {
    // Scanners type ≥4 chars in rapid succession; humans don't.
    if (buffer.length >= 4 && !typingInField) {
      e.preventDefault();
      handler(buffer);
    }
    buffer = '';
    return;
  }
  if (e.key.length === 1) buffer += e.key;
}, true);

export const cameraSupported = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

/** Open the camera and resolve with the first code read (or null). */
export async function scanWithCamera() {
  if (!cameraSupported()) {
    toast(t('Camera scanning is not supported in this browser. Use Chrome on Android, or a USB/Bluetooth scanner.'), 'error', 6000);
    return null;
  }
  const video = h('video', { class: 'scan-video', playsinline: true, muted: true });
  let stream;
  let done = false;
  return new Promise(async (resolve) => {
    const m = modal({
      title: t('Scan barcode'),
      body: [video, h('p', { class: 'muted' }, t('Point the camera at a barcode or QR code.'))],
      onClose: () => { done = true; stream?.getTracks().forEach((tr) => tr.stop()); resolve(null); },
    });
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      await video.play();
      const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'itf'] });
      const tick = async () => {
        if (done) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            done = true;
            stream.getTracks().forEach((tr) => tr.stop());
            navigator.vibrate?.(80);
            resolve(codes[0].rawValue);
            m.dialog.close(); m.dialog.remove();
            return;
          }
        } catch { /* frame not ready */ }
        requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      toast(t('Could not open the camera: {e}', { e: err.message }), 'error');
      m.close();
    }
  });
}
