/**
 * Read a bundled plain-text asset (Qur'an, hadith, tafsir). The files ship
 * inside the app, so this never needs a network. Recently used files stay in
 * a small in-memory cache so going back and forth is instant.
 */
import { Asset } from 'expo-asset';
import { Platform } from 'react-native';

const MAX = 12;
const cache = new Map<number, Promise<string>>();

async function read(mod: number): Promise<string> {
  const asset = Asset.fromModule(mod);
  if (Platform.OS === 'web') return (await fetch(asset.uri)).text();
  await asset.downloadAsync();
  const { File } = await import('expo-file-system');
  return new File(asset.localUri ?? asset.uri).text();
}

export function readTextAsset(mod: number): Promise<string> {
  const hit = cache.get(mod);
  if (hit) {
    cache.delete(mod); // refresh LRU position
    cache.set(mod, hit);
    return hit;
  }
  const p = read(mod).catch((e) => {
    cache.delete(mod);
    throw e;
  });
  cache.set(mod, p);
  while (cache.size > MAX) cache.delete(cache.keys().next().value as number);
  return p;
}
