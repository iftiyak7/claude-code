/* Basics: escaping, Bangla digits, local storage, translation, toasts, API calls, theme. */
import { S } from './state.js';

export const app = document.getElementById('app');
export const nav = document.getElementById('fnav');
/* ---------------- utils & i18n ---------------- */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BN = '০১২৩৪৫৬৭৮৯';
export const toLatin = s => String(s ?? '').replace(/[০-৯]/g, d => BN.indexOf(d));
export const ls = {
  get(k, d) { try { const v = localStorage.getItem('j360.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('j360.' + k, JSON.stringify(v)); } catch {} }
};
export const LANG = () => ls.get('lang', 'bn');
export const T = (s, v) => { let r = LANG() === 'en' ? (window.I18N_EN?.[s] ?? s) : s; return v ? r.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '') : r; };
export const num = n => LANG() === 'bn' ? String(n).replace(/\d/g, d => BN[d]) : String(n);
export const money = n => '৳' + num(Number(n).toLocaleString('en-IN'));
export const loc = (o, f) => (LANG() === 'en' && o?.[f + 'En']) || o?.[f] || '';
export const areaName = a => (LANG() === 'en' && window.AREA_EN?.[a]) || a || '';
export const fmtDate = (t, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => t ? new Date(typeof t === 'number' ? t * 1000 : t).toLocaleDateString(LANG() === 'bn' ? 'bn-BD' : 'en-GB', opts) : '';
export const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.5s-7.2-6.3-7.2-11.8a7.2 7.2 0 0 1 14.4 0c0 5.5-7.2 11.8-7.2 11.8z" fill="#fff"/><circle cx="12" cy="9.6" r="2.8" fill="#0e9f6e"/></svg>';
export const APP_UA = navigator.userAgent.match(/Jashore360App\/(\d+)/);
let toastT;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800);
}
export async function api(path, body, method) {
  const r = await fetch('/api' + path, {
    method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined
  });
  const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (r.status === 401 && S.ME) { S.ME = null; }
  if (!r.ok) throw new Error(T(data.error || 'সংযোগে সমস্যা হয়েছে, আবার চেষ্টা করুন'));
  return data;
}
export const beacon = (path, data) => { try { navigator.sendBeacon('/api' + path, new Blob([JSON.stringify(data)], { type: 'application/json' })); } catch {} };
export const track = (id, type) => beacon('/track', { id, type });
export function compress(file, max = 1600, q = .82) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      cv.toBlob(b => b ? res(b) : rej(new Error(T('ছবিটি পড়া যায়নি'))), 'image/jpeg', q);
    };
    img.onerror = () => rej(new Error(T('ছবিটি পড়া যায়নি')));
    img.src = url;
  });
}
export function upload(blob, type, onprogress) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/my/media');
    x.setRequestHeader('Content-Type', type);
    x.upload.onprogress = e => e.lengthComputable && onprogress(Math.round(e.loaded / e.total * 100));
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} x.status < 300 ? res(d) : rej(new Error(T(d.error || 'আপলোড হয়নি, আবার চেষ্টা করুন'))); };
    x.onerror = () => rej(new Error(T('আপলোড হয়নি — ইন্টারনেট সংযোগ পরীক্ষা করুন')));
    x.send(blob);
  });
}
/* ---------------- theme ---------------- */
export function applyTheme() {
  const t = ls.get('theme', 'auto');
  t === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t);
  document.documentElement.lang = LANG();
}

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  S.D = null; S.CAT = {}; S.ME = null;
  applyTheme();
}
