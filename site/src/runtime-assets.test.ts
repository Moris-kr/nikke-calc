import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CharacterMeta, RuntimeManifest } from './types';

const publicDir = join(import.meta.dirname, '..', 'public');

describe('generated browser runtime', () => {
  it('contains exactly the supported real-character catalog', () => {
    const catalog = JSON.parse(
      readFileSync(join(publicDir, 'catalog.json'), 'utf8'),
    ) as CharacterMeta[];

    expect(catalog).toHaveLength(77);
    expect(catalog.every((char) => !char.name.startsWith('test_'))).toBe(true);
    expect(catalog.filter((char) => char.preview).map((char) => char.name)).toEqual([
      '니지마 마코토',
      '아마기 유키코',
    ]);
  });

  it('lists only runtime files that exist and have content', () => {
    const manifest = JSON.parse(
      readFileSync(join(publicDir, 'runtime', 'manifest.json'), 'utf8'),
    ) as RuntimeManifest;

    expect(manifest.version).toMatch(/^[a-f0-9]{16}$/);
    expect(manifest.files).toHaveLength(20);
    for (const file of manifest.files) {
      expect(readFileSync(join(publicDir, 'runtime', file)).byteLength).toBeGreaterThan(0);
    }
  });
});
