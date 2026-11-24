import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { useData } from '@/store/data';

const on = () => Platform.OS !== 'web' && useData.getState().settings.haptics;

export const haptic = {
  tap: () => on() && void Haptics.selectionAsync().catch(() => undefined),
  light: () => on() && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
  medium: () => on() && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined),
  success: () => on() && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  warn: () => on() && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
};
