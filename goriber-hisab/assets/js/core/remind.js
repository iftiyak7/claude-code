/**
 * Due reminders: a ready-made WhatsApp (or SMS) message to a customer.
 */
import { state } from './state.js';
import { t, currentLang } from './i18n.js';
import { money } from './format.js';
import { api } from './api.js';
import { toast, showError } from './ui.js';

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

/** Send a due reminder SMS through the shop's SMS gateway; without one, open the phone's SMS app. */
export async function sendReminderSms(phone, name, amount, customerId = 0) {
  const text = reminderText(name, amount);
  try {
    await api.post('sms/send', { phone, message: text, ref_type: 'due', customer_id: customerId });
    toast(t('SMS sent'));
  } catch (err) {
    if (/not set up/i.test(err.message || '')) location.href = smsUrl(phone, text);
    else showError(err);
  }
}
