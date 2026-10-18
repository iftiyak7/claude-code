/**
 * Translation: t('English text') looks the string up in the active
 * dictionary (assets/i18n/{lang}.json). Missing keys fall back to English.
 * Placeholders: t('Hello {name}', { name }).
 */
let dict = {};
let lang = 'en';

export async function loadLanguage(code, assetsUrl, version) {
  lang = code || 'en';
  if (lang === 'en') { dict = {}; return; }
  try {
    const res = await fetch(`${assetsUrl}i18n/${lang}.json?v=${version}`, { credentials: 'same-origin' });
    dict = res.ok ? await res.json() : {};
  } catch { dict = {}; }
  document.documentElement.lang = lang;
}

export function t(text, vars) {
  let out = dict[text] || text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

export const currentLang = () => lang;

/** Bangla digits when the language is Bangla (display only). */
export function digits(str) {
  if (lang !== 'bn') return str;
  return String(str).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
}

/** "Jashore, যশোর" → the name that suits the current language. */
export function cityName(raw) {
  const names = String(raw || '').split(/[,/|]/).map((x) => x.trim()).filter(Boolean);
  if (!names.length) return '';
  const bangla = names.find((x) => /[\u0980-\u09FF]/.test(x));
  const latin = names.find((x) => !/[\u0980-\u09FF]/.test(x));
  return (lang === 'bn' ? bangla || latin : latin || bangla) || names[0];
}
