/** Tiny global toast: `toast('message')` from anywhere, rendered once in the root layout. */
import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { Ionicons, type IconName } from './components';
import { Text } from './Text';
import { font, useTheme } from './theme';

const useToast = create<{ id: number; msg: string | null; icon: IconName }>(() => ({ id: 0, msg: null, icon: 'information-circle' }));

export function toast(msg: string, icon: IconName = 'information-circle') {
  useToast.setState((s) => ({ id: s.id + 1, msg, icon }));
}

export function ToastHost() {
  const { id, msg, icon } = useToast();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => useToast.setState({ msg: null }), 2800);
    return () => clearTimeout(t);
  }, [id, msg]);
  if (!msg) return null;
  return (
    <Animated.View key={id} entering={FadeInDown.springify().damping(16)} exiting={FadeOutDown} style={[styles.toast, { bottom: insets.bottom + 100, backgroundColor: t.ink }]} pointerEvents="none">
      <Ionicons name={icon} size={18} color={t.primary} />
      <Text style={[font.small, { color: t.onInk, flexShrink: 1, fontWeight: '600' }]}>{msg}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '88%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
});
