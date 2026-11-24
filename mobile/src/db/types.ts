import type { Rec } from '@/domain/types';

export interface StoredRow {
  collection: string;
  data: Rec;
}

export interface Storage {
  loadAll(): StoredRow[];
  /** Upsert; `dirty` = needs to be pushed to the server. Older versions never overwrite newer ones. */
  put(collection: string, rec: Rec, dirty: boolean): void;
  dirty(limit: number): StoredRow[];
  markClean(items: { collection: string; id: string; updatedAt: number }[]): void;
  markAllDirty(): void;
  kvGet(key: string): string | null;
  kvSet(key: string, value: string): void;
  wipe(): void;
}
