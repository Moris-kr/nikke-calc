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
    expect(manifest.files).toHaveLength(22);
    expect(manifest.files).toContain('context/growth.py');
    for (const file of manifest.files) {
      expect(readFileSync(join(publicDir, 'runtime', file)).byteLength).toBeGreaterThan(0);
    }
  });

  it('exports canonical character defaults and all supported cube levels', () => {
    const settings = JSON.parse(
      readFileSync(join(publicDir, 'settings.json'), 'utf8'),
    ) as {
      characters: Record<string, {
        overload: Record<string, number>;
        cube: { name: string; level: number };
        skillLevels: { '1': number; '2': number; '3': number };
        skillLevelsLocked: boolean;
        growthStage: number;
        rarity: string;
        maxGrowthStage: number;
        growthOptions: Array<{ value: number; label: string; affinity: number }>;
      }>;
      cubes: Record<string, {
        label: string;
        levels: Record<string, {
          atk: number;
          def: number;
          hp: number;
          effect: number;
          commonElement: number;
        }>;
      }>;
      overloadFields: Record<string, { label: string; unit: string }>;
      manualStats: Record<string, { label: string; unit: string }>;
    };

    expect(Object.keys(settings.cubes)).toEqual(['재장', '탄충', '체력', '차속', '파츠']);
    expect(settings.cubes['재장']!.levels['1']).toMatchObject({
      atk: 390,
      def: 78,
      hp: 11_800,
      effect: 14.84,
      commonElement: 0,
    });
    expect(settings.cubes['탄충']!.levels['15']).toMatchObject({
      atk: 2_780,
      def: 552,
      hp: 83_400,
      effect: 3,
      commonElement: 19.09,
    });
    expect(settings.characters['미하라 : 본딩 체인']!.overload.atk_pct).toBe(23.22);
    expect(settings.characters['미하라 : 본딩 체인']!.cube).toEqual({ name: '재장', level: 15 });
    expect(settings.characters['리타']).toMatchObject({
      skillLevels: { '1': 10, '2': 10, '3': 10 },
      skillLevelsLocked: false,
      growthStage: 3,
      rarity: 'SSR',
      maxGrowthStage: 10,
    });
    expect(settings.characters['리타']!.growthOptions).toHaveLength(11);
    expect(settings.characters['리타']!.growthOptions[0]).toEqual({
      value: 0,
      label: '명함',
      affinity: 10,
    });
    expect(settings.characters['리타']!.growthOptions[3]).toEqual({
      value: 3,
      label: '3돌',
      affinity: 30,
    });
    expect(settings.characters['리타']!.growthOptions[10]).toEqual({
      value: 10,
      label: '코강 7',
      affinity: 30,
    });
    expect(settings.characters['크라운']!.growthOptions[3]!.affinity).toBe(40);
    for (const name of ['라피 : 레드 후드', '아니스 : 스타', '네온 : 비전 아이']) {
      expect(settings.characters[name]!.growthOptions[3]!.affinity).toBe(40);
    }
    expect(settings.characters['니지마 마코토']).toMatchObject({
      skillLevels: { '1': 10, '2': 10, '3': 10 },
      skillLevelsLocked: true,
    });
    expect(settings.characters['아마기 유키코']).toMatchObject({
      skillLevels: { '1': 10, '2': 10, '3': 10 },
      skillLevelsLocked: true,
    });
    expect(settings.overloadFields.element_bonus).toMatchObject({
      label: '우월 코드 대미지',
      unit: '%',
    });
    expect(settings.manualStats.split_dmg_pct).toMatchObject({
      label: '분배 대미지',
      unit: '%',
    });
    expect(settings.manualStats.attack_speed_pct).toBeDefined();
    expect(settings.manualStats.ammo_charge_flat).toBeDefined();
  });
});
