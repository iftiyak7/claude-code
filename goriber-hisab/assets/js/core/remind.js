/**
 * Due reminders: a ready-made WhatsApp (or SMS) message to a customer.
 */
import { state } from './state.js';
import { t, currentLang } from './i18n.js';
import { money } from './format.js';

/** "01712345678" → "8801712345678" (wa.me needs the country code). */
export function waNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (/^01\d{9}$/.test(d)) return `88${d}`;
  if (/^8801\d{9}$/.test(d)) return d;
  return d;
}

export function reminderText(name, amount) {
  const shop = state.business?.name || '';
  return currentLang() === 'bn'
    ? `আসসালামু আলাইকুম ${name}, ${shop}-এ আপনার বাকি ${money(amount)}। সুবিধামতো সময়ে পরিশোধ করার অনুরোধ রইলো। ধন্যবাদ।`
    : `Hello ${name}, this is a friendly reminder from ${shop}: your due is ${money(amount)}. Please pay at your convenience. Thank you.`;
}

export function whatsappUrl(phone, text) {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
}

export function smsUrl(phone, text) {
  return `sms:${String(phone || '').replace(/[^0-9+]/g, '')}?body=${encodeURIComponent(text)}`;
}

export const remindLabel = () => t('Remind on WhatsApp');
