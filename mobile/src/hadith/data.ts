/** Offline hadith library: books → chapters → hadith (Arabic + Bangla). */
import { readTextAsset } from '@/content/textAsset';
import BOOKS_JSON from './books.json';
import { CHAPTER_FILES } from './files';

export interface Chapter {
  n: number;
  bn: string;
  en: string;
  count: number;
  first: string;
  last: string;
}
export interface Book {
  id: string;
  bn: string;
  en: string;
  ar: string;
  author: string;
  count: number;
  chapters: Chapter[];
}
/** S sahih · HS hasan sahih · H hasan · D da'if · M mawdu' · '' not graded in the source */
export type Grade = 'S' | 'HS' | 'H' | 'D' | 'M' | '';
export interface Hadith {
  num: string;
  grade: Grade;
  ar: string;
  bn: string;
}

export const BOOKS = BOOKS_JSON as Book[];
export const bookById = (id: string) => BOOKS.find((b) => b.id === id);
export const TOTAL_HADITH = BOOKS.reduce((s, b) => s + b.count, 0);

export async function loadChapter(book: string, chapter: number): Promise<Hadith[]> {
  const mod = CHAPTER_FILES[`${book}-${chapter}`];
  if (mod === undefined) return [];
  const text = await readTextAsset(mod);
  return text.split('\n').map((line) => {
    const [num, grade, ar, bn] = line.split('\x1f');
    return { num, grade: (grade ?? '') as Grade, ar: ar ?? '', bn: bn ?? '' };
  });
}

/** Which chapter of a book holds hadith number `num` (standard numbering). */
export function chapterOf(book: Book, num: number): Chapter | undefined {
  return book.chapters.find((c) => Number(c.first) <= num && num <= Math.floor(Number(c.last)) + 0.999);
}

/** Display form of a hadith number: Muslim's "592.01" → "592 (1)". */
export function formatNum(num: string): string {
  const [base, sub] = num.split('.');
  return sub ? `${base} (${Number(sub)})` : base;
}

export const GRADE_INFO: Record<Exclude<Grade, ''>, { bn: string; en: string; tone: 'success' | 'gold' | 'danger' }> = {
  S: { bn: 'সহীহ', en: 'Sahih', tone: 'success' },
  HS: { bn: 'হাসান সহীহ', en: 'Hasan Sahih', tone: 'success' },
  H: { bn: 'হাসান', en: 'Hasan', tone: 'gold' },
  D: { bn: 'দুর্বল (যঈফ)', en: "Da'if", tone: 'danger' },
  M: { bn: 'জাল (মাওযূ)', en: "Mawdu'", tone: 'danger' },
};
