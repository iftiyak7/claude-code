import { useMemo } from 'react';
import type { CollectionName, Collections } from '@/domain/types';
import { live, useData } from './data';

/** Stable, memoised list of non-deleted records — safe to use in render. */
export function useLive<K extends CollectionName>(c: K): Collections[K][] {
  const map = useData((s) => s[c]) as Record<string, Collections[K]>;
  return useMemo(() => live(map), [map]);
}

export function useSettings() {
  return useData((s) => s.settings);
}
