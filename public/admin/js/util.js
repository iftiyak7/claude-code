/* Basics: escaping, storage, translation, toasts, API calls, image compression, theme. */
import { renderLogin } from './shell.js';

export const root = document.getElementById('root');
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BN = '০১২৩৪৫৬৭৮৯';
export const ls = {
  get(k, d) { try { const v = localStorage.getItem('j360a.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('j360a.' + k, JSON.stringify(v)); } catch {} }
};
export const LANG = () => ls.get('lang', 'bn');
const EN_ADMIN = { 'রিপোর্ট': 'Reports', 'পেমেন্ট': 'Payments', 'ব্যবহারকারী': 'Users' };
export const T = (s, v) => { let r = LANG() === 'en' ? (EN_ADMIN[s] ?? window.I18N_EN?.[s] ?? s) : s; return v ? r.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '') : r; };
export const num = n => LANG() === 'bn' ? String(n ?? 0).replace(/\d/g, d => BN[d]) : String(n ?? 0);
export const compact = n => n >= 1e6 ? num((n / 1e6).toFixed(1)) + 'M' : n >= 1e4 ? num(Math.round(n / 1e3)) + 'K' : num(Number(n || 0).toLocaleString('en-IN'));
export const money = n => '৳' + num(Number(n || 0).toLocaleString('en-IN'));
export const locale = () => LANG() === 'bn' ? 'bn-BD' : 'en-GB';
export const date = t => !t ? '' : typeof t === 'string'                     // "YYYY-MM-DD" dates vs unix timestamps
  ? new Date(t).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })
  : new Date(t * 1000).toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const day = d => d ? new Date(d).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const LOGO = '<svg viewBox="0 0 24 24"><path d="M12 21.5s-7.2-6.3-7.2-11.8a7.2 7.2 0 0 1 14.4 0c0 5.5-7.2 11.8-7.2 11.8z" fill="#fff"/><circle cx="12" cy="9.6" r="2.8" fill="#0f1b2d"/></svg>';
export const STATUS = { verified: ['যাচাইকৃত', 'ok'], pending: ['যাচাই চলছে', 'warn'], needs_update: ['আপডেট প্রয়োজন', 'warn'], temp_closed: ['সাময়িক বন্ধ', 'bad'], closed: ['স্থায়ীভাবে বন্ধ', 'bad'] };
export const KINDS = { rent: ['বাসা ভাড়া', 'home', '#4f6bed'], mess: ['মেস / সিট ভাড়া', 'bed', '#0f9fa8'], job: ['চাকরি', 'briefcase', '#f2711c'], tuition: ['টিউশন', 'cap', '#7c5cff'] };
export const DAYS = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'];
export const S = { me: null, listings: null, settings: {}, reviews: null, reports: null };
export const owner = () => S.me?.role === 'owner';
export function applyTheme() {
  const t = ls.get('theme', 'auto');
  t === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t);
  document.documentElement.lang = LANG();
}
let toastT;
export function toast(msg, err) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => t.className = '', 2800);
}
export async function api(path, body, method) {
  const r = await fetch('/api' + path, { method: method || (body !== undefined ? 'POST' : 'GET'), credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.endsWith('/login')) { S.me = null; renderLogin(); throw new Error(T('লগইন করুন')); }
  if (!r.ok) throw Object.assign(new Error(T(data.error || 'সমস্যা হয়েছে')), { data });
  return data;
}
export const run = async (fn, okMsg) => { try { const r = await fn(); okMsg && toast(T(okMsg)); return r; } catch (e) { toast(e.message, true); throw e; } };
function compress(file, max = 1400, q = .8) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url); res(cv.toDataURL('image/jpeg', q));
    };
    img.onerror = () => rej(new Error(T('ছবিটি পড়া যায়নি'))); img.src = url;
  });
}
export const upload = async file => (await api('/admin/upload', { data: await compress(file) })).url;

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  applyTheme();
}
