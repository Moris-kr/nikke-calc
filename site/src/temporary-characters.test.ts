import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { installTemporaryCharacters } from './temporary-characters';
import { unsupportedEffects } from './custom-nikke';
import type { CharacterMeta, SettingsCatalog } from './types';

describe('bundled temporary characters', () => {
  it('registers fictional data separately with locked skills and known metadata', () => {
    const catalog: CharacterMeta[] = [];
    const settings = { characters: {} } as SettingsCatalog;
    const custom = installTemporaryCharacters(catalog, settings);
    expect(catalog.map(c => c.name)).toEqual(['신 : 스위프트 바니']);
    for (const c of catalog) {
      expect(c).toMatchObject({ manufacturer: '미실리스', weaponType: 'SR', elementCode: '수냉', className: '화력형', burstStage: '3', preview: true });
      expect(custom[c.name]?.nikke).toMatchObject({ rarity: 'SSR', preview: true, fabricated: true });
      expect(settings.characters[c.name]?.skillLevelsLocked).toBe(true);
      expect(c.image).toMatch(/^temporary-characters\/.+-portrait\.png$/);
      expect(existsSync(new URL(`../public/${c.image}`, import.meta.url))).toBe(true);
      expect(unsupportedEffects(custom[c.name]!.skills)).toEqual([]);
    }
  });

  it('never replaces an official catalog entry or injects a fictional replacement', () => {
    const official = { name: '신 : 스위프트 바니', preview: false } as CharacterMeta;
    const catalog = [official];
    const original = { weaponType: 'SR' };
    const settings = { characters: { [official.name]: original } } as SettingsCatalog;
    const custom = installTemporaryCharacters(catalog, settings);
    expect(catalog[0]).toBe(official);
    expect(settings.characters[official.name]).toBe(original);
    expect(custom[official.name]).toBeUndefined();
  });
});
