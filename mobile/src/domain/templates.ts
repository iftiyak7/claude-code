/**
 * Ready-made items a new user can add with one tap. Every template has a
 * fixed id, so adding it twice (or on two devices) never creates duplicates.
 */
import { noReminder } from './defaults';
import type { Amal, Reminder, RoutineBlock, Settings } from './types';

export type TemplateKind = 'amal' | 'reminder' | 'routine' | 'water';

export interface Template {
  id: string;
  kind: TemplateKind;
  icon: string;
  color: string;
  title: { bn: string; en: string };
  sub: { bn: string; en: string };
  /** Shown pre-selected in the welcome wizard. */
  suggested?: boolean;
  amal?: Omit<Amal, 'id' | 'updatedAt'>;
  reminder?: Omit<Reminder, 'id' | 'updatedAt'>;
  routine?: Omit<RoutineBlock, 'id' | 'updatedAt'>;
  water?: Pick<Settings, 'waterGoalMl' | 'glassMl' | 'waterReminder'>;
}

const amal = (a: Partial<Amal> & Pick<Amal, 'title' | 'kind' | 'color' | 'icon'>): Omit<Amal, 'id' | 'updatedAt'> => ({
  target: 1,
  recurrence: { type: 'daily' },
  reminder: noReminder(),
  points: 10,
  order: 40,
  ...a,
});

export const TEMPLATES: Template[] = [
  {
    id: 'tpl-morning-adhkar',
    kind: 'amal',
    icon: 'sunny-outline',
    color: '#E9A93A',
    title: { bn: 'সকালের আযকার', en: 'Morning adhkar' },
    sub: { bn: 'প্রতিদিন সকাল ৬:৩০-এ মনে করাবে', en: 'Daily reminder at 6:30 AM' },
    suggested: true,
    amal: amal({ kind: 'dua', title: 'সকালের আযকার', arabic: 'أَذْكَارُ الصَّبَاحِ', color: '#E9A93A', icon: 'sunny-outline', reminder: { ...noReminder(), mode: 'times', times: ['06:30'] }, order: 30 }),
  },
  {
    id: 'tpl-evening-adhkar',
    kind: 'amal',
    icon: 'partly-sunny-outline',
    color: '#F2703F',
    title: { bn: 'সন্ধ্যার আযকার', en: 'Evening adhkar' },
    sub: { bn: 'প্রতিদিন বিকাল ৫:৩০-এ মনে করাবে', en: 'Daily reminder at 5:30 PM' },
    suggested: true,
    amal: amal({ kind: 'dua', title: 'সন্ধ্যার আযকার', arabic: 'أَذْكَارُ الْمَسَاءِ', color: '#F2703F', icon: 'partly-sunny-outline', reminder: { ...noReminder(), mode: 'times', times: ['17:30'] }, order: 31 }),
  },
  {
    id: 'tpl-tasbih-after-salah',
    kind: 'amal',
    icon: 'radio-button-on-outline',
    color: '#26B07A',
    title: { bn: 'নামাজের পরের তাসবিহ', en: 'Tasbih after salah' },
    sub: { bn: 'সুবহানাল্লাহ, আলহামদুলিল্লাহ, আল্লাহু আকবার — দিনে ১০০', en: 'SubhanAllah, Alhamdulillah, Allahu Akbar — 100/day' },
    amal: amal({ kind: 'zikr', title: 'নামাজের পরের তাসবিহ', arabic: 'سُبْحَانَ اللهِ • الْحَمْدُ لِلهِ • اللهُ أَكْبَرُ', target: 100, unit: 'বার', color: '#26B07A', icon: 'radio-button-on-outline', order: 32 }),
  },
  {
    id: 'tpl-ayatul-kursi',
    kind: 'amal',
    icon: 'moon-outline',
    color: '#6D5AE6',
    title: { bn: 'ঘুমের আগে আয়াতুল কুরসি', en: 'Ayat al-Kursi before sleep' },
    sub: { bn: 'প্রতি রাতে ১০:৩০-এ মনে করাবে', en: 'Every night at 10:30 PM' },
    suggested: true,
    amal: amal({ kind: 'quran', title: 'ঘুমের আগে আয়াতুল কুরসি', arabic: 'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ', color: '#6D5AE6', icon: 'moon-outline', reminder: { ...noReminder(), mode: 'times', times: ['22:30'] }, order: 33 }),
  },
  {
    id: 'tpl-tahajjud',
    kind: 'amal',
    icon: 'star-outline',
    color: '#3E86F5',
    title: { bn: 'তাহাজ্জুদ', en: 'Tahajjud' },
    sub: { bn: 'রাত ৩:৩০-এ অ্যালার্ম', en: 'Alarm at 3:30 AM' },
    amal: amal({ kind: 'custom', title: 'তাহাজ্জুদ', arabic: 'صَلَاةُ التَّهَجُّدِ', color: '#3E86F5', icon: 'star-outline', reminder: { ...noReminder(), mode: 'times', times: ['03:30'], alarm: true }, points: 15, order: 34 }),
  },
  {
    id: 'tpl-sunnah-fast',
    kind: 'amal',
    icon: 'restaurant-outline',
    color: '#14B8A6',
    title: { bn: 'সোম ও বৃহস্পতিবার রোজা', en: 'Monday & Thursday fast' },
    sub: { bn: 'সেহরির জন্য ভোর ৪টায় অ্যালার্ম', en: 'Suhoor alarm at 4 AM' },
    amal: amal({
      kind: 'fasting',
      title: 'সোম ও বৃহস্পতিবার রোজা',
      color: '#14B8A6',
      icon: 'restaurant-outline',
      recurrence: { type: 'weekly', days: [1, 4] },
      reminder: { ...noReminder(), mode: 'times', times: ['04:00'], alarm: true },
      points: 20,
      order: 35,
    }),
  },
  {
    id: 'tpl-friday-kahf',
    kind: 'amal',
    icon: 'book-outline',
    color: '#E0578A',
    title: { bn: 'শুক্রবার সূরা কাহফ', en: 'Surah al-Kahf on Friday' },
    sub: { bn: 'প্রতি শুক্রবার সকাল ৯টায়', en: 'Every Friday at 9 AM' },
    suggested: true,
    amal: amal({ kind: 'quran', title: 'সূরা কাহফ তিলাওয়াত', arabic: 'سُورَةُ الْكَهْفِ', color: '#E0578A', icon: 'book-outline', recurrence: { type: 'weekly', days: [5] }, reminder: { ...noReminder(), mode: 'times', times: ['09:00'] }, points: 15, order: 36 }),
  },
  {
    id: 'tpl-friday-sadaqah',
    kind: 'amal',
    icon: 'gift-outline',
    color: '#C2547A',
    title: { bn: 'শুক্রবারের সদকা', en: 'Friday sadaqah' },
    sub: { bn: 'প্রতি শুক্রবার সকাল ১০টায়', en: 'Every Friday at 10 AM' },
    amal: amal({ kind: 'sadaqah', title: 'সদকা', color: '#C2547A', icon: 'gift-outline', recurrence: { type: 'weekly', days: [5] }, reminder: { ...noReminder(), mode: 'times', times: ['10:00'] }, order: 37 }),
  },
  {
    id: 'tpl-water-8',
    kind: 'water',
    icon: 'water-outline',
    color: '#3E86F5',
    title: { bn: 'দিনে ৮ গ্লাস পানি', en: '8 glasses of water a day' },
    sub: { bn: 'সকাল ৮টা থেকে রাত ১০টা, প্রতি ২ ঘণ্টায়', en: 'Every 2 hours, 8 AM – 10 PM' },
    suggested: true,
    water: { waterGoalMl: 2000, glassMl: 250, waterReminder: { ...noReminder(), mode: 'interval', intervalMinutes: 120, windowStart: '08:00', windowEnd: '22:00' } },
  },
  {
    id: 'tpl-call-parents',
    kind: 'reminder',
    icon: 'call-outline',
    color: '#26B07A',
    title: { bn: 'মা-বাবাকে ফোন', en: 'Call your parents' },
    sub: { bn: 'প্রতি শুক্রবার রাত ৮টায়', en: 'Every Friday at 8 PM' },
    reminder: { title: 'মা-বাবাকে ফোন করুন', recurrence: { type: 'weekly', days: [5] }, times: ['20:00'], alarm: false, enabled: true, icon: 'call-outline', color: '#26B07A' },
  },
  {
    id: 'tpl-morning-walk',
    kind: 'routine',
    icon: 'walk-outline',
    color: '#F2703F',
    title: { bn: 'সকালের হাঁটা', en: 'Morning walk' },
    sub: { bn: 'প্রতিদিন সকাল ৬:০০ – ৬:৩০', en: 'Daily 6:00 – 6:30 AM' },
    routine: { title: 'সকালের হাঁটা', start: '06:00', end: '06:30', days: [], color: '#F2703F', icon: 'walk-outline', remind: true },
  },
  {
    id: 'tpl-sleep-early',
    kind: 'routine',
    icon: 'bed-outline',
    color: '#6D5AE6',
    title: { bn: 'তাড়াতাড়ি ঘুম', en: 'Sleep early' },
    sub: { bn: 'প্রতিদিন রাত ১০:৪৫-এ মনে করাবে', en: 'Reminder at 10:45 PM' },
    routine: { title: 'ঘুমের প্রস্তুতি', start: '22:45', end: '23:15', days: [], color: '#6D5AE6', icon: 'bed-outline', remind: true },
  },
];
