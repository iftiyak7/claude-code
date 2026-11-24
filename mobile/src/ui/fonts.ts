/**
 * Bundled fonts (offline). Bangla UI uses Anek Bangla, English uses
 * Plus Jakarta Sans, Arabic du'a/zikr text uses Amiri.
 * Only the weights we use are imported so the bundle stays small.
 */
import { Amiri_400Regular } from '@expo-google-fonts/amiri/400Regular';
import { Amiri_700Bold } from '@expo-google-fonts/amiri/700Bold';
import { AnekBangla_400Regular } from '@expo-google-fonts/anek-bangla/400Regular';
import { AnekBangla_500Medium } from '@expo-google-fonts/anek-bangla/500Medium';
import { AnekBangla_600SemiBold } from '@expo-google-fonts/anek-bangla/600SemiBold';
import { AnekBangla_700Bold } from '@expo-google-fonts/anek-bangla/700Bold';
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';

export const FONT_ASSETS = {
  AnekBangla_400Regular,
  AnekBangla_500Medium,
  AnekBangla_600SemiBold,
  AnekBangla_700Bold,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  Amiri_400Regular,
  Amiri_700Bold,
};

type Weight = string | number | undefined;

function bucket(w: Weight): 400 | 500 | 600 | 700 {
  const n = w === 'bold' ? 700 : w === 'normal' || w == null ? 400 : Number(w);
  if (n >= 700) return 700;
  if (n >= 600) return 600;
  if (n >= 500) return 500;
  return 400;
}

const SUFFIX = { 400: '400Regular', 500: '500Medium', 600: '600SemiBold', 700: '700Bold' } as const;

/** Resolve a (language, weight, family-token) to a real loaded font family. */
export function fontFamilyFor(lang: 'bn' | 'en', weight: Weight, token?: string): string | undefined {
  if (token && token !== 'arabic') return token; // explicit real family
  const b = bucket(weight);
  if (token === 'arabic') return b >= 600 ? 'Amiri_700Bold' : 'Amiri_400Regular';
  return `${lang === 'bn' ? 'AnekBangla' : 'PlusJakartaSans'}_${SUFFIX[b]}`;
}
