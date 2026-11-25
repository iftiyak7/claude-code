/**
 * Banners published from the admin panel. Fetched whenever the app opens with
 * internet (no account needed), cached on the device so they keep showing
 * offline. Failures are silent — the built-in banners always remain.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { storage } from '@/db/storage';
import { Image } from 'expo-image';
import { API_URL } from '@/sync/api';

export interface RemoteBanner {
  id: string;
  tag: string;
  body: string;
  imageUrl?: string;
  arabic: string;
  source: string;
  theme: string;
  ctaLabel: string;
  ctaUrl: string;
}

const KEY = 'banners.cache';
const MIN_INTERVAL_MS = 10 * 60_000;
let lastFetch = 0;

function readCache(): RemoteBanner[] {
  try {
    const v = JSON.parse(storage.kvGet(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function fetchBanners(): Promise<RemoteBanner[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${API_URL}/v1/banners`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { banners?: RemoteBanner[] };
    const list = Array.isArray(body.banners) ? body.banners.filter((b) => b && (b.imageUrl || (typeof b.body === 'string' && b.body.trim()))) : [];
    // download pictures to the disk cache so they show offline too
    const urls = list.filter((b) => b.imageUrl).map((b) => imageSrc(b.imageUrl!));
    if (urls.length) await Image.prefetch(urls, 'disk').catch(() => false);
    storage.kvSet(KEY, JSON.stringify(list));
    return list;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function useRemoteBanners(): RemoteBanner[] {
  const [list, setList] = useState<RemoteBanner[]>(readCache);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (Date.now() - lastFetch < MIN_INTERVAL_MS) return;
      lastFetch = Date.now();
      void fetchBanners().then((b) => alive && b && setList(b));
    };
    refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return list;
}

export const imageSrc = (path: string) => (/^https:\/\//.test(path) ? path : `${API_URL}${path}`);

export const BANNER_THEMES: Record<string, [string, string]> = {
  coral: ['#F2703F', '#E0578A'],
  violet: ['#6D5AE6', '#A855F7'],
  mint: ['#26B07A', '#14B8A6'],
  ocean: ['#3E86F5', '#6D5AE6'],
  gold: ['#E9A93A', '#F2703F'],
  night: ['#16151A', '#3A3346'],
};
