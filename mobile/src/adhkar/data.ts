/**
 * Verified adhkar (built by scripts/build-adhkar.py, which checks every
 * Arabic text against the original hadith). Daily progress is kept on the
 * device per date and category.
 */
import { create } from 'zustand';
import { storage } from '@/db/storage';
import { today } from '@/domain/dates';
import DATA from './adhkar.json';

export type AdhkarCat = 'salah' | 'morning' | 'evening';

export interface Dhikr {
  id: string;
  cats: AdhkarCat[];
  title?: string;
  ar?: string;
  arEvening?: string;
  pron: string;
  pronEvening?: string;
  bn: string;
  bnEvening?: string;
  count: number;
  note?: string;
  virtue?: string;
  quran?: { surah?: number; from?: number; to?: number; surahs?: number[] };
  ref: string;
  grade: string | null;
  verified: boolean;
}

export const CATEGORIES = DATA.categories as Record<AdhkarCat, { bn: string; en: string; icon: string }>;
export const CAT_ORDER: AdhkarCat[] = ['salah', 'morning', 'evening'];
export const ADHKAR = DATA.items as Dhikr[];
export const adhkarFor = (cat: AdhkarCat) => ADHKAR.filter((d) => d.cats.includes(cat));

/** The text for a category — evening items use their evening wording. */
export function textFor(d: Dhikr, cat: AdhkarCat) {
  const eve = cat === 'evening';
  return {
    ar: (eve && d.arEvening) || d.ar,
    pron: (eve && d.pronEvening) || d.pron,
    bn: (eve && d.bnEvening) || d.bn,
  };
}

const key = (date: string) => `adhkar.${date}`;
type Progress = Record<string, number>; // `${cat}:${id}` → count

interface AdhkarState {
  date: string;
  progress: Progress;
  load(date?: string): void;
  set(cat: AdhkarCat, id: string, count: number): void;
  reset(cat: AdhkarCat): void;
}

const read = (date: string): Progress => {
  try {
    return JSON.parse(storage.kvGet(key(date)) ?? '{}') as Progress;
  } catch {
    return {};
  }
};

export const useAdhkar = create<AdhkarState>()((set, get) => ({
  date: '',
  progress: {},
  load(date = today()) {
    if (get().date === date) return;
    set({ date, progress: read(date) });
  },
  set(cat, id, count) {
    const { date } = get();
    const progress = { ...get().progress, [`${cat}:${id}`]: count };
    storage.kvSet(key(date), JSON.stringify(progress));
    set({ progress });
  },
  reset(cat) {
    const { date } = get();
    const progress = Object.fromEntries(Object.entries(get().progress).filter(([k]) => !k.startsWith(`${cat}:`)));
    storage.kvSet(key(date), JSON.stringify(progress));
    set({ progress });
  },
}));

export function catProgress(progress: Progress, cat: AdhkarCat) {
  const items = adhkarFor(cat);
  const done = items.filter((d) => (progress[`${cat}:${d.id}`] ?? 0) >= d.count).length;
  return { done, total: items.length };
}
