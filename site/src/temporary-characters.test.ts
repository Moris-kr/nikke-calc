import { describe, expect, it } from 'vitest';
import { installTemporaryCharacters } from './temporary-characters';
import type { CharacterMeta, SettingsCatalog } from './types';

describe('bundled temporary characters', () => {
  it('has no fictional bundles after both published previews are registered', () => {
    const catalog: CharacterMeta[] = [];
    const settings = { characters: {} } as SettingsCatalog;
    expect(installTemporaryCharacters(catalog, settings)).toEqual({});
    expect(catalog).toEqual([]);
    expect(settings.characters).toEqual({});
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
