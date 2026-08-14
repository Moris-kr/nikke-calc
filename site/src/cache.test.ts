import { describe, expect, it } from 'vitest';

import { ResultCache, type StorageLike } from './cache';
import type { SimulationResult } from './types';

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const result = (value: number): SimulationResult => ({
  squadTotal: value,
  duration: 10,
  hitCount: 1,
  charTotals: { 리타: value },
  previewNote: '',
  deviations: '',
});

describe('ResultCache', () => {
  it('evicts the oldest result after the configured capacity', () => {
    const cache = new ResultCache(new MemoryStorage(), 'v1', 12);
    for (let index = 0; index < 13; index += 1) {
      cache.set(`k${index}`, result(index));
    }

    expect(cache.get('k0')).toBeNull();
    expect(cache.get('k12')).toEqual(result(12));
  });

  it('isolates entries by runtime version', () => {
    const storage = new MemoryStorage();
    new ResultCache(storage, 'v1').set('same', result(1));

    expect(new ResultCache(storage, 'v2').get('same')).toBeNull();
  });

  it('ignores malformed stored JSON and accepts new writes', () => {
    const storage = new MemoryStorage();
    storage.setItem('nikke-calc-results:v1', '{bad');
    const cache = new ResultCache(storage, 'v1');

    expect(cache.get('x')).toBeNull();
    cache.set('x', result(7));
    expect(cache.get('x')).toEqual(result(7));
  });

  it('clears all entries for the current version', () => {
    const cache = new ResultCache(new MemoryStorage(), 'v1');
    cache.set('x', result(7));
    cache.clear();
    expect(cache.get('x')).toBeNull();
  });
});
