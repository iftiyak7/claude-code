import { useColorScheme } from 'react-native';
import { useData } from '@/store/data';

const light = {
  dark: false,
  bg: '#F6F3EC',
  surface: '#FFFFFF',
  surface2: '#F0ECE2',
  text: '#13201B',
  muted: '#66766F',
  faint: '#A3AFA9',
  border: '#E6E0D3',
  primary: '#0F6B4F',
  primaryDeep: '#0A4A37',
  primarySoft: '#DCEFE6',
  onPrimary: '#FFFFFF',
  gold: '#C9A227',
  goldSoft: '#F7EDCB',
  danger: '#D64545',
  dangerSoft: '#FBE3E3',
  water: '#2E8BC0',
  waterSoft: '#DDEFF8',
  medicine: '#C2547A',
  medicineSoft: '#F8E1EA',
  success: '#1F9D6B',
  shadow: 'rgba(16, 40, 30, 0.08)',
  heroA: '#0F6B4F',
  heroB: '#0A3F30',
};

export type Theme = typeof light;

const dark: Theme = {
  dark: true,
  bg: '#0A1411',
  surface: '#111E1A',
  surface2: '#182823',
  text: '#E9F1ED',
  muted: '#93A69D',
  faint: '#5C6F66',
  border: '#1F302A',
  primary: '#34B98C',
  primaryDeep: '#1E8C68',
  primarySoft: '#16352B',
  onPrimary: '#04130D',
  gold: '#E3C25B',
  goldSoft: '#3A321A',
  danger: '#F06A6A',
  dangerSoft: '#3A1D1D',
  water: '#5AB4E6',
  waterSoft: '#152C3A',
  medicine: '#E57AA0',
  medicineSoft: '#3A1E29',
  success: '#3CCB91',
  shadow: 'rgba(0, 0, 0, 0.35)',
  heroA: '#0F5A43',
  heroB: '#08261D',
};

export function useTheme(): Theme {
  const pref = useData((s) => s.settings.theme);
  const sys = useColorScheme();
  const isDark = pref === 'system' ? sys === 'dark' : pref === 'dark';
  return isDark ? dark : light;
}

export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 };
export const space = (n: number) => n * 4;

export const font = {
  h1: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.4 },
  h2: { fontSize: 22, fontWeight: '800' as const, letterSpacing: -0.2 },
  h3: { fontSize: 17, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '500' as const },
  small: { fontSize: 13, fontWeight: '500' as const },
  tiny: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.3 },
  arabic: { fontSize: 26, fontWeight: '500' as const, writingDirection: 'rtl' as const },
};
