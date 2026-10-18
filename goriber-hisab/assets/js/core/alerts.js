/**
 * Alerts that need attention now (low stock): a popup with sound in the app, and
 * a phone/desktop notification. The Android app also checks in the background
 * when closed (NativeBridge.setAlertFeed); the web checks while a tab is open.
 * Choices are per device, so the owner's phone can ring while the counter's does not.
 */
import { h } from './dom.js';
import { api } from './api.js';
import { state, emit } from './state.js';
import { t, currentLang } from './i18n.js';
import { icon } from './icons.js';
import { navigate } from './router.js';
import { card } from './ui.js';

const KEY = 'gh.alerts';
const EVERY = 60000;
const native = () => window.GoriberHisabNative;

export function alertPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* defaults */ }
  return { popup: p.popup !== false, sound: p.sound !== false, push: p.push ?? !!native() };
}

export async function setAlertPrefs(next) {
  const p = { ...alertPrefs(), ...next };
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ }
  if (next.push) await askPermission();
  await linkPhone();
  return alertPrefs();
}

/** Can this device show notifications right now? */
export function pushAllowed() {
  const n = native();
  if (n?.notificationsAllowed) return !!n.notificationsAllowed();
  return 'Notification' in window && Notification.permission === 'granted';
}

async function askPermission() {
  const n = native();
  if (n?.askNotificationPermission) { n.askNotificationPermission(); return; }
  if ('Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* old browsers */ }
  }
}

const lastKey = () => `gh.alerts.last.${state.business?.id || 0}`;
function lastId() { try { return Number(localStorage.getItem(lastKey()) || 0); } catch { return 0; } }
function saveLast(id) {
  try { localStorage.setItem(lastKey(), String(id)); } catch { /* ignore */ }
  native()?.alertSeen?.(String(id)); // the background check starts after what the app already showed
}

/** Give the Android app its private background-check link (or switch it off). */
async function linkPhone() {
  const n = native();
  if (!n?.setAlertFeed) return;
  if (!alertPrefs().push) { n.setAlertFeed(''); return; }
  try {
    const r = await api.post('notifications/device', { lang: currentLang() });
    n.setAlertFeed(r.url);
    if (!lastId()) saveLast(r.last_id); else n.alertSeen?.(String(lastId()));
  } catch { /* try again next start */ }
}

let timer = 0;
let running = false;

export function startAlerts() {
  if (!state.ctx || running) return;
  running = true;
  const tick = async () => {
    clearTimeout(timer);
    if (navigator.onLine) {
      try {
        const r = await api.get('notifications/alerts', { after: lastId(), lang: currentLang() });
        if (r.items.length) {
          state.me.unread = (state.me.unread || 0) + r.items.length;
          emit('unread', state.me.unread);
          raise(r.items);
        }
        saveLast(r.last_id);
      } catch { /* next round */ }
    }
    timer = setTimeout(tick, document.hidden ? EVERY * 5 : EVERY);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  tick();
  linkPhone();
}

/** Show alerts the way this device is set up. */
export function raise(items) {
  const p = alertPrefs();
  if (p.sound) beep();
  navigator.vibrate?.([180, 90, 180]);
  if (p.push && (document.hidden || !p.popup)) items.forEach(systemNotice);
  if (p.popup) popup(items);
}

function systemNotice(a) {
  const n = native();
  if (n?.notify) { n.notify(a.title, a.body || '', a.link || ''); return; }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const x = new Notification(a.title, { body: a.body || '', icon: `${window.BZL.assetsUrl}img/icon.svg`, tag: `gh-${a.id}` });
    x.onclick = () => { window.focus(); if (a.link) navigate(a.link); x.close(); };
  } catch { /* some mobile browsers only allow it from a service worker */ }
}

function popup(items) {
  document.querySelector('.alert-pop')?.remove();
  const a = items[items.length - 1];
  const more = items.length - 1;
  const close = () => { box.classList.remove('in'); setTimeout(() => box.remove(), 200); };
  const box = h('div', { class: 'alert-pop', role: 'alertdialog', 'aria-live': 'assertive' },
    h('span', { class: 'alert-pop-icon' }, icon('alert', 22)),
    h('div', { class: 'grow' },
      h('strong', {}, a.title),
      a.body ? h('p', {}, a.body) : null,
      more > 0 ? h('small', { class: 'muted' }, t('+{n} more alerts', { n: more })) : null,
      h('div', { class: 'alert-pop-acts' },
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => { close(); navigate(more > 0 ? '/notifications' : a.link || '/notifications'); } }, t('View')),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: close }, t('OK')))));
  document.body.append(box);
  requestAnimationFrame(() => box.classList.add('in'));
  setTimeout(() => { if (box.isConnected) close(); }, 20000);
}

let audio;
export function beep() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const at = audio.currentTime;
    [880, 660, 880].forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.35, at + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.18 + 0.16);
      o.connect(g).connect(audio.destination);
      o.start(at + i * 0.18); o.stop(at + i * 0.18 + 0.17);
    });
  } catch { /* no audio */ }
}

/** Settings → Notifications: how alerts reach this device. */
export function alertSettingsCard() {
  const p = alertPrefs();
  const status = h('p', { class: 'muted small' });
  const paint = () => {
    const on = alertPrefs().push;
    status.textContent = !on ? '' : pushAllowed() ? t('Notifications are allowed on this device.') : t('Notifications are blocked — allow them for this app/site in the phone or browser settings.');
  };
  const toggle = (key, label, hint) => {
    const cb = h('input', { type: 'checkbox', checked: p[key] });
    cb.addEventListener('change', async () => { await setAlertPrefs({ [key]: cb.checked }); setTimeout(paint, 800); });
    return h('label', { class: 'check alert-opt' }, cb, h('span', {}, h('strong', {}, label), h('small', { class: 'muted' }, hint)));
  };
  paint();
  return card(t('Low stock alerts on this device'),
    h('div', { class: 'alert-opts' },
      toggle('popup', t('Show a popup'), t('A box appears on screen as soon as a product runs low.')),
      toggle('sound', t('Play a sound'), t('A short ring, and the phone vibrates.')),
      toggle('push', t('Phone notification'), native() ? t('Comes in the notification bar even when the app is closed (checked about every 15 minutes).') : t('Shows a notification from this browser while the site is open in a tab.')),
      status,
      h('div', {}, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => {
        raise([{ id: 0, title: t('Low stock: {name}', { name: t('Test product') }), body: t('Only {n} left (minimum {m}).', { n: 2, m: 5 }), link: '/inventory?low=1' }]);
        if (alertPrefs().push) systemNotice({ id: 0, title: t('Low stock: {name}', { name: t('Test product') }), body: t('Only {n} left (minimum {m}).', { n: 2, m: 5 }), link: '/inventory?low=1' });
      } }, icon('bell', 16), t('Test alert')))));
}
