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

const CAM_KEY = 'gh.scan.camera';

/**
 * The phone's main back camera. Phones with several back lenses often give the
 * wide-angle one by default, which cannot focus close up — that is the blurry
 * picture. The main lens is usually the lowest-numbered back camera.
 */
async function backCameras() {
  try {
    const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const back = all.filter((d) => /back|rear|environment|পিছন/i.test(d.label));
    const list = back.length ? back : all;
    const num = (d) => { const m = d.label.match(/(\d+)/); return m ? Number(m[1]) : 99; };
    return list.slice().sort((a, b) => num(a) - num(b));
  } catch { return []; }
}

async function openStream(deviceId) {
  const video = {
    width: { ideal: 1920 }, height: { ideal: 1080 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
    advanced: [{ focusMode: 'continuous' }],
  };
  try { return await navigator.mediaDevices.getUserMedia({ video, audio: false }); } catch (err) {
    if (deviceId) return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    throw err;
  }
}

/** Keep focusing (and a little zoom so the phone can be held further away, where it focuses). */
async function tune(track, zoomInput) {
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  const adv = {};
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) adv.focusMode = 'continuous';
  if (caps.zoom && caps.zoom.max > 1) {
    const z = Math.min(caps.zoom.max, Math.max(caps.zoom.min || 1, 1.6));
    adv.zoom = z;
    zoomInput.min = String(caps.zoom.min || 1); zoomInput.max = String(caps.zoom.max); zoomInput.step = String(caps.zoom.step || 0.1); zoomInput.value = String(z);
    zoomInput.hidden = false;
  }
  if (Object.keys(adv).length) { try { await track.applyConstraints({ advanced: [adv] }); } catch { /* not supported */ } }
  return caps;
}

/** Open the camera and resolve with the first code read (or null). */
export async function scanWithCamera() {
  if (!cameraSupported()) {
    toast(t('Camera scanning is not supported in this browser. Use Chrome on Android, or a USB/Bluetooth scanner.'), 'error', 6000);
    return null;
  }
  const video = h('video', { class: 'scan-video', playsinline: true, muted: true, autoplay: true });
  const zoom = h('input', { type: 'range', class: 'scan-zoom', hidden: true, 'aria-label': t('Zoom') });
  const torchBtn = h('button', { type: 'button', class: 'btn btn-sm', hidden: true }, t('Light'));
  const switchBtn = h('button', { type: 'button', class: 'btn btn-sm', hidden: true }, t('Switch camera'));
  const hint = h('p', { class: 'muted small' }, t('Hold the barcode 15–25 cm away, flat and well lit. Tap the picture to focus.'));
  let stream;
  let reader;
  let done = false;
  let cams = [];
  let camIndex = 0;
  let torch = false;
  const track = () => stream?.getVideoTracks()[0];
  const stopStream = () => { reader?.reset?.(); reader = null; stream?.getTracks().forEach((tr) => tr.stop()); stream = null; };
  const stop = () => { done = true; stopStream(); };

  return new Promise((resolve) => {
    const m = modal({
      title: t('Scan barcode'),
      body: [h('div', { class: 'scan-frame' }, video, h('span', { class: 'scan-box' }), h('span', { class: 'scan-line' })),
        h('div', { class: 'scan-tools' }, zoom, torchBtn, switchBtn), hint],
      onClose: () => { stop(); resolve(null); },
    });
    const found = (code) => {
      if (done || !code) return;
      stop();
      navigator.vibrate?.(80);
      resolve(code);
      m.dialog.close(); m.dialog.remove();
    };

    const start = async () => {
      stopStream();
      stream = await openStream(cams[camIndex]?.deviceId);
      video.srcObject = stream;
      await video.play().catch(() => {});
      const caps = await tune(track(), zoom);
      torchBtn.hidden = !caps.torch;
      if (!cams.length) {
        cams = await backCameras();
        const saved = localStorage.getItem(CAM_KEY);
        const current = track()?.getSettings?.().deviceId;
        const pick = cams.findIndex((c) => c.deviceId === saved);
        const main = pick >= 0 ? pick : 0;
        switchBtn.hidden = cams.length < 2;
        // Restart on the main back lens if the browser gave us another one.
        if (cams[main] && cams[main].deviceId && cams[main].deviceId !== current) { camIndex = main; return start(); }
        camIndex = Math.max(0, cams.findIndex((c) => c.deviceId === current));
      }
      if (native()) {
        const detector = new window.BarcodeDetector({ formats: ['code_128', 'ean_13', 'ean_8', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'itf'] });
        const tick = async () => {
          if (done || !stream) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length) { found(codes[0].rawValue); return; }
          } catch { /* frame not ready */ }
          setTimeout(tick, 120);
        };
        tick();
      } else {
        const Z = await loadZxing();
        if (done) return;
        reader = new Z.BrowserMultiFormatReader(undefined, 120);
        reader.decodeFromStream(stream, video, (result) => { if (result) found(result.getText()); }).catch(() => {});
      }
    };

    zoom.addEventListener('input', () => { track()?.applyConstraints({ advanced: [{ zoom: Number(zoom.value) }] }).catch(() => {}); });
    torchBtn.addEventListener('click', () => { torch = !torch; track()?.applyConstraints({ advanced: [{ torch }] }).catch(() => {}); torchBtn.classList.toggle('btn-primary', torch); });
    switchBtn.addEventListener('click', () => {
      camIndex = (camIndex + 1) % cams.length;
      try { localStorage.setItem(CAM_KEY, cams[camIndex].deviceId); } catch { /* ignore */ }
      start().catch(() => {});
    });
    // Tap to focus: briefly ask for a single focus pass, then continuous again.
    video.addEventListener('click', async () => {
      const tr = track();
      if (!tr) return;
      try {
        await tr.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] });
        setTimeout(() => tr.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}), 800);
      } catch { /* not supported */ }
    });

    start().catch((err) => {
      toast(t('Could not open the camera: {e}', { e: err.message }), 'error');
      m.close();
    });
  });
}
