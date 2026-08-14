import type { SimulationResult } from './types';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface CacheEntry {
  key: string;
  result: SimulationResult;
}

export class ResultCache {
  private readonly storageKey: string;

  constructor(
    private readonly storage: StorageLike,
    version: string,
    private readonly capacity = 12,
  ) {
    this.storageKey = `nikke-calc-results:${version}`;
  }

  get(key: string): SimulationResult | null {
    return this.load().find((entry) => entry.key === key)?.result ?? null;
  }

  set(key: string, result: SimulationResult): void {
    const entries = this.load().filter((entry) => entry.key !== key);
    entries.push({ key, result });
    this.storage.setItem(
      this.storageKey,
      JSON.stringify(entries.slice(-Math.max(1, this.capacity))),
    );
  }

  clear(): void {
    this.storage.removeItem(this.storageKey);
  }

  private load(): CacheEntry[] {
    const raw = this.storage.getItem(this.storageKey);
    if (!raw) return [];
    try {
      const value: unknown = JSON.parse(raw);
      return Array.isArray(value) ? value as CacheEntry[] : [];
    } catch {
      this.storage.removeItem(this.storageKey);
      return [];
    }
  }
}
