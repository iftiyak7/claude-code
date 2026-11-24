/**
 * Drop-in replacements for RN Text/TextInput that map `fontWeight` to the
 * matching bundled font file (Android ignores fontWeight for custom fonts,
 * iOS would fake-bold them). Use these everywhere instead of react-native's.
 */
import React from 'react';
import { Text as RNText, TextInput as RNTextInput, StyleSheet, type TextProps } from 'react-native';
import { useData } from '@/store/data';
import { fontFamilyFor } from './fonts';

function useFontStyle(style: TextProps['style']) {
  const lang = useData((s) => s.settings.language);
  const flat = StyleSheet.flatten(style) ?? {};
  return { fontFamily: fontFamilyFor(lang, flat.fontWeight, flat.fontFamily), fontWeight: 'normal' as const };
}

export function Text(props: TextProps) {
  const f = useFontStyle(props.style);
  return <RNText {...props} style={[props.style, f]} />;
}

// React 19: `ref` is a regular prop and flows through the spread.
export function TextInput(props: React.ComponentProps<typeof RNTextInput>) {
  const f = useFontStyle(props.style);
  return <RNTextInput {...props} style={[props.style, f]} />;
}
