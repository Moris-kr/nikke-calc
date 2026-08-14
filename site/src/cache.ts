import type { SimulationResult } from './types';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type StorageSource = StorageLike | (() => StorageLike) | null;

interface CacheEntry {
  key: string;
  result: SimulationResult;
}

interface CacheEnvelope {
  version: string;
  entries: CacheEntry[];
}

export class ResultCache {
  private readonly storage: StorageLike | null;
  private readonly storageKey = 'nikke-calc-results';
  private memoryEntries: CacheEntry[] = [];
  private storageEnabled = true;

  constructor(
    storage: StorageSource,
    private readonly version: string,
    private readonly capacity = 12,
  ) {
    try {
      this.storage = typeof storage === 'function' ? storage() : storage;
    } catch {
      this.storage = null;
    }
  }

  get(key: string): SimulationResult | null {
    return this.load().find((entry) => entry.key === key)?.result ?? null;
  }

  set(key: string, result: SimulationResult): void {
    const entries = this.load().filter((entry) => entry.key !== key);
    entries.push({ key, result });
    this.memoryEntries = entries.slice(-Math.max(1, this.capacity));
    if (!this.storage || !this.storageEnabled) return;
    try {
      const envelope: CacheEnvelope = { version: this.version, entries: this.memoryEntries };
      this.storage.setItem(this.storageKey, JSON.stringify(envelope));
    } catch {
      this.storageEnabled = false;
    }
  }

  clear(): void {
    this.memoryEntries = [];
    if (!this.storage || !this.storageEnabled) return;
    try {
      this.storage.removeItem(this.storageKey);
    } catch {
      this.storageEnabled = false;
    }
  }

  private load(): CacheEntry[] {
    if (!this.storage || !this.storageEnabled) return this.memoryEntries;
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.storageKey);
    } catch {
      this.storageEnabled = false;
      return this.memoryEntries;
    }
    if (!raw) return this.memoryEntries;
    try {
      const value: unknown = JSON.parse(raw);
      const envelope = value as Partial<CacheEnvelope> | null;
      this.memoryEntries = envelope
        && envelope.version === this.version
        && Array.isArray(envelope.entries)
        ? envelope.entries
        : [];
      return this.memoryEntries;
    } catch {
      this.memoryEntries = [];
      try {
        this.storage.removeItem(this.storageKey);
      } catch {
        this.storageEnabled = false;
      }
      return [];
    }
  }
}
