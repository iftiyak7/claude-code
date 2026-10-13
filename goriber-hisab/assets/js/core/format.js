/**
 * Number, money and date formatting from business settings.
 *
 * Amounts arrive from the API as decimal strings. Client-side arithmetic
 * (cart previews) uses integers scaled by 10^4; the server recalculates
 * everything authoritatively.
 */
import { state } from './state.js';
import { digits } from './i18n.js';

export const SCALE = 10000;

/** Decimal string → scaled integer. */
export function dec(value) {
  if (value === null || value === undefined || value === '') return 0;
  const s = String(value).replace(/[, ]/g, '');
  if (!/^-?\d*\.?\d*$/.test(s) || s === '-' || s === '.') return 0;
  const neg = s.startsWith('-');
  const [i = '0', f = ''] = s.replace('-', '').split('.');
  let n = Number(i || 0) * SCALE + Number((f + '0000').slice(0, 4));
  if (f.length > 4 && Number(f[4]) >= 5) n += 1;
  return neg ? -n : n;
}

/** Scaled integer → decimal string with `places`. */
export function str(n, places = 4) {
  const p = 10 ** (4 - places);
  const r = Math.round(Math.abs(n) / p) * p;
  const i = Math.floor(r / SCALE);
  const f = String(r % SCALE).padStart(4, '0').slice(0, places);
  return `${n < 0 && r ? '-' : ''}${i}${places ? '.' + f : ''}`;
}

export const mul = (a, b) => Math.round((a * b) / SCALE);
export const places = () => Number(state.business?.decimals ?? 2);

function group(intPart) {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, state.settings['general.thousand_sep'] ?? ',');
}

/** Plain number "1,234.50". */
export function number(value, p = places()) {
  const s = str(typeof value === 'number' ? value : dec(value), p);
  const neg = s.startsWith('-');
  const [i, f] = s.replace('-', '').split('.');
  return digits(`${neg ? '-' : ''}${group(i)}${f !== undefined ? (state.settings['general.decimal_sep'] ?? '.') + f : ''}`);
}

/** Money with symbol and position. */
export function money(value) {
  const b = state.business || {};
  const n = number(value);
  const neg = n.startsWith('-');
  const abs = neg ? n.slice(1) : n;
  const sym = b.currency_symbol || b.currency_code || '';
  const out = {
    after: abs + sym,
    after_space: `${abs} ${sym}`,
    before_space: `${sym} ${abs}`,
  }[b.currency_position] || sym + abs;
  return (neg ? '-' : '') + out;
}

/** Quantity without trailing zeros. */
export function qty(value) {
  const s = str(typeof value === 'number' ? value : dec(value), 4).replace(/\.?0+$/, '');
  return digits(s || '0');
}

/** Y-m-d → localised display per business date format. */
export function date(ymd) {
  if (!ymd) return '';
  const [y, m, d] = String(ymd).slice(0, 10).split('-');
  const fmt = state.settings['general.date_format'] || 'd/m/Y';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return digits(fmt.replace('d', d).replace('m', m).replace('Y', y).replace('y', y.slice(2)).replace('M', months[Number(m) - 1] || m));
}

export function datetime(utc) {
  if (!utc) return '';
  const d = new Date(String(utc).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return utc;
  return d.toLocaleString(undefined, { timeZone: state.business?.timezone || undefined, dateStyle: 'medium', timeStyle: 'short' });
}

/** Today's date in the business timezone as Y-m-d. */
export function today() {
  const tz = state.business?.timezone || undefined;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts;
}
