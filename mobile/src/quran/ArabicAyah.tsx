/** Renders one ayah in the chosen mushaf style (incl. tajweed colouring). */
import React from 'react';
// Plain RN Text on purpose: our app-wide <Text> forces the UI font, which
// would override the Quran font on nested tajweed spans.
import { Text, type TextStyle } from 'react-native';
import type { MushafId } from '@/domain/types';
import { ARABIC_DIGITS, mushafInfo, tajweedColor, type Ayah } from './data';

/** KFGQPC fonts draw the ornate ayah-end circle around Arabic digits. */
export function ayahEnd(mushaf: MushafId, n: number) {
  const kfgqpc = mushaf === 'hafs' || mushaf === 'warsh' || mushaf === 'qaloon';
  return kfgqpc ? ` ${ARABIC_DIGITS(n)}` : ` ﴿${ARABIC_DIGITS(n)}﴾`;
}

export function ayahSpans(a: Ayah, mushaf: MushafId, color: string, size: number, highlight?: string) {
  const end = <Text style={{ color: highlight ?? color, fontFamily: mushafInfo(mushaf).font }}>{ayahEnd(mushaf, a.ayah)}</Text>;
  if (mushaf === 'tajweed' && a.tajweed) {
    return (
      <>
        {a.tajweed.map(([seg, rules], i) => {
          const c = tajweedColor(rules);
          return (
            <Text key={i} style={c ? { color: c } : undefined}>
              {seg}
            </Text>
          );
        })}
        {end}
      </>
    );
  }
  return (
    <>
      {a.text}
      {end}
    </>
  );
}

export function arabicStyle(mushaf: MushafId, size: number, color: string): TextStyle {
  const indopak = mushaf === 'indopak';
  return {
    fontFamily: mushafInfo(mushaf).font,
    fontSize: indopak ? size * 1.05 : size,
    lineHeight: size * (indopak ? 2.25 : mushaf === 'tajweed' ? 2.1 : 1.95),
    color,
    writingDirection: 'rtl',
    textAlign: 'right',
  };
}

export function ArabicAyah({ a, mushaf, size, color }: { a: Ayah; mushaf: MushafId; size: number; color: string }) {
  return <Text style={arabicStyle(mushaf, size, color)}>{ayahSpans(a, mushaf, color, size)}</Text>;
}
