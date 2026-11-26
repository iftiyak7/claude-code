/** Tafsir Ibn Kathir (Bangla), bundled; one passage may cover several ayat. */
import { readTextAsset } from '@/content/textAsset';
import { TAFSIR_FILES } from './tafsirFiles';

export interface TafsirPassage {
  from: number;
  to: number;
  paragraphs: string[];
}

export async function loadTafsir(surah: number): Promise<TafsirPassage[]> {
  const mod = TAFSIR_FILES[surah];
  if (mod === undefined) return [];
  const text = await readTextAsset(mod);
  return text.split('\n').map((line) => {
    const [range, body = ''] = line.split('\x1f');
    const [from, to] = range.split('-').map(Number);
    return { from, to, paragraphs: body.split('\x1e') };
  });
}

export async function tafsirFor(surah: number, ayah: number): Promise<TafsirPassage | undefined> {
  return (await loadTafsir(surah)).find((p) => p.from <= ayah && ayah <= p.to);
}
