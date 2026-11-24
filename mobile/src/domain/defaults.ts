import type { Amal, PrayerName, ReminderRule, Settings } from './types';

export const noReminder = (): ReminderRule => ({
  mode: 'none',
  times: [],
  intervalMinutes: 60,
  windowStart: '08:00',
  windowEnd: '22:00',
  alarm: false,
  stopWhenDone: true,
});

export const DEFAULT_SETTINGS: Settings = {
  language: 'bn',
  theme: 'system',
  name: '',
  waterGoalMl: 2500,
  glassMl: 250,
  waterReminder: { ...noReminder(), mode: 'interval', intervalMinutes: 120, windowStart: '08:00', windowEnd: '22:00' },
  calcMethod: 'Karachi',
  madhab: 'hanafi',
  appLock: false,
  haptics: true,
  onboarded: false,
  zikrSound: false,
};

const PRAYER_META: Record<PrayerName, { title: string; arabic: string; icon: string }> = {
  fajr: { title: 'ফজর', arabic: 'الفجر', icon: 'partly-sunny-outline' },
  dhuhr: { title: 'যোহর', arabic: 'الظهر', icon: 'sunny-outline' },
  asr: { title: 'আসর', arabic: 'العصر', icon: 'cloudy-outline' },
  maghrib: { title: 'মাগরিব', arabic: 'المغرب', icon: 'moon-outline' },
  isha: { title: 'ইশা', arabic: 'العشاء', icon: 'star-outline' },
};

/**
 * Starter amal. Ids are fixed so two devices that both seed on first launch
 * converge to the same records instead of duplicating after sync.
 */
export function seedAmals(now = Date.now()): Amal[] {
  const salah: Amal[] = (Object.keys(PRAYER_META) as PrayerName[]).map((p, i) => ({
    id: `seed-salah-${p}`,
    updatedAt: now,
    kind: 'salah',
    title: PRAYER_META[p].title,
    arabic: PRAYER_META[p].arabic,
    target: 1,
    recurrence: { type: 'daily' },
    reminder: { ...noReminder(), mode: 'times' },
    prayer: p,
    prayerOffset: 0,
    points: 10,
    color: '#0F6B4F',
    icon: PRAYER_META[p].icon,
    order: i,
  }));

  const zikr: Amal[] = [
    {
      id: 'seed-zikr-istighfar',
      updatedAt: now,
      kind: 'zikr',
      title: 'আস্তাগফিরুল্লাহ',
      arabic: 'أَسْتَغْفِرُ ٱللَّٰهَ',
      meaning: 'আমি আল্লাহর কাছে ক্ষমা চাই',
      target: 100,
      unit: 'বার',
      recurrence: { type: 'daily' },
      reminder: { ...noReminder(), mode: 'interval', intervalMinutes: 180, windowStart: '09:00', windowEnd: '21:00' },
      points: 10,
      color: '#2E7D9A',
      icon: 'leaf-outline',
      order: 10,
    },
    {
      id: 'seed-zikr-tasbih',
      updatedAt: now,
      kind: 'zikr',
      title: 'সুবহানাল্লাহি ওয়া বিহামদিহি',
      arabic: 'سُبْحَانَ ٱللَّٰهِ وَبِحَمْدِهِ',
      meaning: 'আল্লাহ পবিত্র এবং সকল প্রশংসা তাঁর',
      target: 100,
      unit: 'বার',
      recurrence: { type: 'daily' },
      reminder: noReminder(),
      points: 10,
      color: '#8B5CF6',
      icon: 'sparkles-outline',
      order: 11,
    },
    {
      id: 'seed-zikr-durood',
      updatedAt: now,
      kind: 'zikr',
      title: 'দরূদ শরীফ',
      arabic: 'اللَّهُمَّ صَلِّ عَلَىٰ مُحَمَّدٍ',
      target: 33,
      unit: 'বার',
      recurrence: { type: 'daily' },
      reminder: noReminder(),
      points: 5,
      color: '#C9A227',
      icon: 'heart-outline',
      order: 12,
    },
    {
      id: 'seed-quran',
      updatedAt: now,
      kind: 'quran',
      title: 'কুরআন তিলাওয়াত',
      arabic: 'تِلَاوَةُ ٱلْقُرْآنِ',
      target: 2,
      unit: 'পৃষ্ঠা',
      recurrence: { type: 'daily' },
      reminder: { ...noReminder(), mode: 'times', times: ['21:00'] },
      points: 10,
      color: '#B45309',
      icon: 'book-outline',
      order: 20,
    },
  ];
  return [...salah, ...zikr];
}

export const PALETTE = ['#0F6B4F', '#2E7D9A', '#8B5CF6', '#C9A227', '#B45309', '#C2547A', '#D64545', '#3B82F6', '#14B8A6', '#64748B'];

export const AMAL_ICONS = [
  'leaf-outline',
  'sparkles-outline',
  'heart-outline',
  'book-outline',
  'moon-outline',
  'sunny-outline',
  'star-outline',
  'hand-left-outline',
  'water-outline',
  'gift-outline',
  'people-outline',
  'flower-outline',
] as const;
