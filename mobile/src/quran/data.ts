/**
 * Offline Qur'an data. Every edition is bundled inside the app as a plain
 * text asset (one line per ayah) and read from disk the first time it is
 * needed — no downloads, no network.
 *
 * Sources: King Fahd Glorious Qur'an Printing Complex (Hafs, Warsh, Qaloon,
 * IndoPak Nastaleeq text, Zakaria translation), Quran.com (tajweed), Tanzil
 * (Muhiuddin Khan translation). See scripts/build-quran-data.py.
 */
import { Asset } from 'expo-asset';
import * as Font from 'expo-font';
import { Platform } from 'react-native';
import type { MushafId, TranslationId } from '@/domain/types';
import META from './meta.json';
import LEGEND from './tajweed-legend.json';

export interface SurahMeta {
  n: number;
  ar: string;
  en: string;
  bn: string;
  mean: string;
  type: 'm' | 'd';
  ayahs: number;
  page: number;
}
export const SURAHS = META.surahs as SurahMeta[];
/** juz → [surah, ayah, page] where it starts (Hafs / Madani) */
export const JUZ = META.juz as [number, number, number][];
export const PAGES = META.pages;
export const TAJWEED_RULES = LEGEND as string[];

// Bundled assets must be required statically so Metro packs them.
/* eslint-disable @typescript-eslint/no-require-imports */
const FILES = {
  hafs: require('../../assets/quran/hafs.qtxt'),
  indopak: require('../../assets/quran/indopak.qtxt'),
  tajweed: require('../../assets/quran/tajweed.qtxt'),
  warsh: require('../../assets/quran/warsh.qtxt'),
  qaloon: require('../../assets/quran/qaloon.qtxt'),
  zakaria: require('../../assets/quran/bn-zakaria.qtxt'),
  muhiuddin: require('../../assets/quran/bn-muhiuddin.qtxt'),
} as const;
type FileId = keyof typeof FILES;

export interface MushafInfo {
  id: MushafId;
  font: string;
  /** different riwayah → its own ayah numbering & pages */
  riwayah: 'hafs' | 'warsh' | 'qaloon';
  title: { bn: string; en: string };
  desc: { bn: string; en: string };
}

export const MUSHAFS: MushafInfo[] = [
  {
    id: 'hafs',
    font: 'QuranHafs',
    riwayah: 'hafs',
    title: { bn: 'মাদানী মুসহাফ', en: 'Madani Mushaf' },
    desc: {
      bn: 'মদিনার বাদশাহ ফাহাদ কুরআন মুদ্রণ কমপ্লেক্সের উসমানী লিপি — সৌদি আরব ও সারা বিশ্বে সবচেয়ে প্রচলিত মুসহাফ (হাফস রেওয়ায়েত, ৬০৪ পৃষ্ঠা)।',
      en: 'Uthmani script of the King Fahd Complex, Madinah — the most widely used mushaf worldwide (Hafs, 604 pages).',
    },
  },
  {
    id: 'indopak',
    font: 'QuranIndoPak',
    riwayah: 'hafs',
    title: { bn: 'নাসতালিক (ইন্দোপাক) মুসহাফ', en: 'IndoPak (Nastaleeq) Mushaf' },
    desc: {
      bn: 'বাংলাদেশ, ভারত ও পাকিস্তানে প্রচলিত ইন্দোপাক/নাসতালিক লিপি — হাফেজি কুরআনের মতো অক্ষর ও হরকত। পাঠ্য: কিং ফাহাদ কমপ্লেক্স।',
      en: 'The IndoPak / Nastaleeq script used in Bangladesh, India and Pakistan. Text: King Fahd Complex.',
    },
  },
  {
    id: 'tajweed',
    font: 'QuranTajweed',
    riwayah: 'hafs',
    title: { bn: 'কালার কোডেড তাজবীদ', en: 'Colour-coded Tajweed' },
    desc: {
      bn: 'তাজবীদের নিয়ম রঙ দিয়ে চিহ্নিত — গুন্নাহ, ইখফা, ইদগাম, মাদ্দ, কলকলা ইত্যাদি সহজে চেনা যায়। ডেটা: Quran.com।',
      en: 'Tajweed rules highlighted in colour — ghunnah, ikhfa, idgham, madd, qalqalah and more. Data: Quran.com.',
    },
  },
  {
    id: 'warsh',
    font: 'QuranWarsh',
    riwayah: 'warsh',
    title: { bn: 'ওয়ারশ মুসহাফ', en: 'Warsh Mushaf' },
    desc: {
      bn: 'ইমাম নাফে (রহ.)-এর কিরাআত, ইমাম ওয়ারশ (রহ.)-এর রেওয়ায়েত — উত্তর ও পশ্চিম আফ্রিকায় প্রচলিত। কিং ফাহাদ কমপ্লেক্স প্রকাশিত।',
      en: "Imam Nafi' via Warsh — read across North and West Africa. Published by the King Fahd Complex.",
    },
  },
  {
    id: 'qaloon',
    font: 'QuranQaloon',
    riwayah: 'qaloon',
    title: { bn: 'কালুন মুসহাফ', en: 'Qaloon Mushaf' },
    desc: {
      bn: 'ইমাম নাফে (রহ.)-এর কিরাআত, ইমাম কালুন (রহ.)-এর রেওয়ায়েত — লিবিয়া ও তিউনিসিয়ায় প্রচলিত। কিং ফাহাদ কমপ্লেক্স প্রকাশিত।',
      en: "Imam Nafi' via Qaloon — read in Libya and Tunisia. Published by the King Fahd Complex.",
    },
  },
];
export const mushafInfo = (id: MushafId) => MUSHAFS.find((m) => m.id === id) ?? MUSHAFS[0];

const FONT_FILES: Record<string, number> = {
  QuranHafs: require('../../assets/fonts/KFGQPC-Hafs.ttf'),
  QuranIndoPak: require('../../assets/fonts/Noorehira-IndoPak.ttf'),
  QuranTajweed: require('../../assets/fonts/ScheherazadeNew-Regular.ttf'),
  QuranWarsh: require('../../assets/fonts/KFGQPC-Warsh.ttf'),
  QuranQaloon: require('../../assets/fonts/KFGQPC-Qaloon.ttf'),
};

/** Load a mushaf's font on demand (keeps app start fast). */
export async function ensureFont(id: MushafId): Promise<string> {
  const family = mushafInfo(id).font;
  if (!Font.isLoaded(family)) await Font.loadAsync({ [family]: FONT_FILES[family] });
  return family;
}

// ── reading the text assets ──────────────────────────────────────────────
const cache = new Map<FileId, Promise<string[]>>();

async function readLines(id: FileId): Promise<string[]> {
  const asset = Asset.fromModule(FILES[id]);
  if (Platform.OS === 'web') {
    const res = await fetch(asset.uri);
    return (await res.text()).split('\n');
  }
  await asset.downloadAsync();
  const { File } = await import('expo-file-system');
  const text = await new File(asset.localUri ?? asset.uri).text();
  return text.split('\n');
}

function lines(id: FileId) {
  let p = cache.get(id);
  if (!p) {
    p = readLines(id).catch((e) => {
      cache.delete(id);
      throw e;
    });
    cache.set(id, p);
  }
  return p;
}

// ── addressing (Hafs / Kufan numbering) ─────────────────────────────────
const STARTS: number[] = [];
{
  let acc = 0;
  for (const s of SURAHS) {
    STARTS.push(acc);
    acc += s.ayahs;
  }
}
export const globalIndex = (surah: number, ayah: number) => STARTS[surah - 1] + ayah - 1;

export interface Ayah {
  surah: number;
  ayah: number;
  page: number;
  text: string;
  /** tajweed mode only: [segment text, rule ids] */
  tajweed?: [string, number[]][];
}

interface HafsRow {
  page: number;
  text: string;
}
let hafsRows: Promise<HafsRow[]> | null = null;
function hafs(): Promise<HafsRow[]> {
  hafsRows ??= lines('hafs').then((ls) =>
    ls.map((l) => {
      const [page, , , ...rest] = l.split('|');
      return { page: Number(page), text: rest.join('|') };
    }),
  );
  return hafsRows;
}

interface RiwayahRow {
  surah: number;
  ayah: number;
  page: number;
  text: string;
}
const riwayahRows = new Map<string, Promise<RiwayahRow[]>>();
function riwayah(id: 'warsh' | 'qaloon'): Promise<RiwayahRow[]> {
  let p = riwayahRows.get(id);
  if (!p) {
    p = lines(id).then((ls) =>
      ls.map((l) => {
        const [s, a, page, ...rest] = l.split('|');
        return { surah: Number(s), ayah: Number(a), page: Number(page), text: rest.join('|') };
      }),
    );
    riwayahRows.set(id, p);
  }
  return p;
}

function parseTajweed(line: string): [string, number[]][] {
  return line.split('\x1e').map((seg) => {
    const [text, rules] = seg.split('\x1f');
    return [text, rules ? rules.split(',').map(Number) : []];
  });
}

/** All ayat of a surah in the chosen mushaf. */
export async function loadSurah(surah: number, mushaf: MushafId): Promise<Ayah[]> {
  const info = mushafInfo(mushaf);
  if (info.riwayah !== 'hafs') {
    return (await riwayah(info.riwayah)).filter((r) => r.surah === surah);
  }
  const rows = await hafs();
  const start = STARTS[surah - 1];
  const count = SURAHS[surah - 1].ayahs;
  const out: Ayah[] = [];
  const alt = mushaf === 'indopak' ? await lines('indopak') : mushaf === 'tajweed' ? await lines('tajweed') : null;
  for (let i = 0; i < count; i++) {
    const g = start + i;
    const a: Ayah = { surah, ayah: i + 1, page: rows[g].page, text: rows[g].text };
    if (mushaf === 'indopak' && alt) a.text = alt[g];
    if (mushaf === 'tajweed' && alt) a.tajweed = parseTajweed(alt[g]);
    out.push(a);
  }
  return out;
}

/** All ayat printed on a mushaf page (Madani pages for Hafs-based styles). */
export async function loadPage(page: number, mushaf: MushafId): Promise<Ayah[]> {
  const info = mushafInfo(mushaf);
  if (info.riwayah !== 'hafs') {
    return (await riwayah(info.riwayah)).filter((r) => r.page === page);
  }
  const rows = await hafs();
  const alt = mushaf === 'indopak' ? await lines('indopak') : mushaf === 'tajweed' ? await lines('tajweed') : null;
  const out: Ayah[] = [];
  let surah = 1;
  for (let g = 0; g < rows.length; g++) {
    while (surah < 114 && g >= STARTS[surah]) surah++;
    if (rows[g].page !== page) {
      if (rows[g].page > page) break;
      continue;
    }
    const a: Ayah = { surah, ayah: g - STARTS[surah - 1] + 1, page, text: rows[g].text };
    if (mushaf === 'indopak' && alt) a.text = alt[g];
    if (mushaf === 'tajweed' && alt) a.tajweed = parseTajweed(alt[g]);
    out.push(a);
  }
  return out;
}

/** First page of a surah in the given mushaf. */
export async function surahPage(surah: number, mushaf: MushafId): Promise<number> {
  const info = mushafInfo(mushaf);
  if (info.riwayah === 'hafs') return SURAHS[surah - 1].page;
  return (await riwayah(info.riwayah)).find((r) => r.surah === surah)?.page ?? 1;
}

export async function loadTranslation(id: TranslationId, surah: number): Promise<string[]> {
  if (id === 'none') return [];
  const all = await lines(id);
  const start = STARTS[surah - 1];
  return all.slice(start, start + SURAHS[surah - 1].ayahs);
}

export const ARABIC_DIGITS = (n: number) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

export const BISMILLAH = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';

export const TAJWEED_COLORS: Record<string, string | null> = {
  ham_wasl: '#AAAAAA',
  laam_shamsiyah: '#AAAAAA',
  slnt: '#AAAAAA',
  madda_normal: '#D68A00',
  madda_permissible: '#F57C00',
  madda_obligatory: '#E64A19',
  madda_necessary: '#C62828',
  qalaqah: '#00A5A8',
  ghunnah: '#2E9E4F',
  ikhafa: '#43A047',
  ikhafa_shafawi: '#66BB6A',
  idgham_ghunnah: '#2E9E4F',
  idgham_wo_ghunnah: '#8D8D8D',
  idgham_shafawi: '#388E3C',
  iqlab: '#00897B',
  idgham_mutajanisayn: '#7E57C2',
  idgham_mutaqaribayn: '#5C6BC0',
  tafkhim: '#1E6FE0',
  tarqiq: null,
};
const PRIORITY = [
  'madda_necessary',
  'madda_obligatory',
  'madda_permissible',
  'madda_normal',
  'qalaqah',
  'tafkhim',
  'iqlab',
  'idgham_ghunnah',
  'idgham_shafawi',
  'idgham_wo_ghunnah',
  'idgham_mutajanisayn',
  'idgham_mutaqaribayn',
  'ikhafa',
  'ikhafa_shafawi',
  'ghunnah',
  'ham_wasl',
  'laam_shamsiyah',
  'slnt',
];
/** Colour for a tajweed segment (highest-priority rule wins). */
export function tajweedColor(rules: number[]): string | null {
  if (rules.length === 0) return null;
  const names = rules.map((r) => TAJWEED_RULES[r]);
  for (const p of PRIORITY) if (names.includes(p)) return TAJWEED_COLORS[p];
  return null;
}

export const TAJWEED_LEGEND: { key: string; bn: string; en: string }[] = [
  { key: 'ghunnah', bn: 'গুন্নাহ / ইদগাম', en: 'Ghunnah / Idgham' },
  { key: 'ikhafa', bn: 'ইখফা', en: 'Ikhfa' },
  { key: 'iqlab', bn: 'ইকলাব', en: 'Iqlab' },
  { key: 'qalaqah', bn: 'কলকলা', en: 'Qalqalah' },
  { key: 'madda_normal', bn: 'মাদ্দ (২)', en: 'Madd (2)' },
  { key: 'madda_permissible', bn: 'মাদ্দ (২/৪/৬)', en: 'Madd (2/4/6)' },
  { key: 'madda_obligatory', bn: 'মাদ্দ ওয়াজিব (৪/৫)', en: 'Madd wajib (4/5)' },
  { key: 'madda_necessary', bn: 'মাদ্দ লাযিম (৬)', en: 'Madd lazim (6)' },
  { key: 'tafkhim', bn: 'পুর (তাফখীম)', en: 'Heavy (tafkhim)' },
  { key: 'ham_wasl', bn: 'উচ্চারণ হয় না', en: 'Silent' },
];
