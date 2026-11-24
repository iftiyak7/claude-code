import { useColorScheme } from 'react-native';
import { useData } from '@/store/data';

/**
 * Tadbeer design tokens — warm, calm, modern.
 * Warm sand surfaces, a single confident coral accent, ink-black for
 * primary actions, soft lavender as the secondary/ambient colour.
 */
const light = {
  dark: false,
  bg: '#FBF1EB',
  bgDeep: '#F6E4DA',
  surface: '#FFFFFF',
  surface2: '#F7EAE3',
  text: '#16151A',
  muted: '#7D746F',
  faint: '#B8ADA7',
  border: '#EFE1D9',
  ink: '#16151A',
  onInk: '#FFFFFF',
  primary: '#F2703F',
  primaryDeep: '#D95A2B',
  primarySoft: '#FFE4D7',
  onPrimary: '#FFFFFF',
  lavender: '#C9B9FF',
  lavenderSoft: '#EEE8FF',
  lavenderInk: '#5B47C9',
  gold: '#E9A93A',
  goldSoft: '#FFF0D4',
  success: '#26B07A',
  successSoft: '#DAF4E8',
  danger: '#E2483D',
  dangerSoft: '#FDE3E0',
  water: '#3E86F5',
  waterSoft: '#E1ECFF',
  medicine: '#E0578A',
  medicineSoft: '#FCE2EC',
  shadow: '#C07A55',
};

export type Theme = typeof light;

const dark: Theme = {
  dark: true,
  bg: '#111014',
  bgDeep: '#0B0A0D',
  surface: '#1B1A20',
  surface2: '#25232B',
  text: '#F5F0ED',
  muted: '#A39B97',
  faint: '#5F5960',
  border: '#2A2830',
  ink: '#F5F0ED',
  onInk: '#16151A',
  primary: '#FF8352',
  primaryDeep: '#F2703F',
  primarySoft: '#3A2219',
  onPrimary: '#FFFFFF',
  lavender: '#8E79F0',
  lavenderSoft: '#26213D',
  lavenderInk: '#C9B9FF',
  gold: '#F2BC57',
  goldSoft: '#382C14',
  success: '#3CCB91',
  successSoft: '#163327',
  danger: '#FF6B5F',
  dangerSoft: '#3A1B19',
  water: '#6EA6FF',
  waterSoft: '#16243C',
  medicine: '#FF7FAE',
  medicineSoft: '#3A1C28',
  shadow: '#000000',
};

export function useTheme(): Theme {
  const pref = useData((s) => s.settings.theme);
  const sys = useColorScheme();
  const isDark = pref === 'system' ? sys === 'dark' : pref === 'dark';
  return isDark ? dark : light;
}

export const radius = { sm: 12, md: 18, lg: 26, xl: 32, pill: 999 };
export const space = (n: number) => n * 4;

/** Type scale. Weights are mapped to real font files by `ui/Text`. */
export const font = {
  display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.8 },
  h1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.6 },
  h2: { fontSize: 22, fontWeight: '600' as const, letterSpacing: -0.3 },
  h3: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.1 },
  body: { fontSize: 15, fontWeight: '500' as const },
  small: { fontSize: 13, fontWeight: '500' as const },
  tiny: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.2 },
  arabic: { fontFamily: 'arabic', fontSize: 26, fontWeight: '400' as const, writingDirection: 'rtl' as const },
};
