import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CharacterMeta, RuntimeManifest } from './types';

const publicDir = join(import.meta.dirname, '..', 'public');

describe('generated browser runtime', () => {
  it('contains exactly the supported real-character catalog', () => {
    const catalog = JSON.parse(
      readFileSync(join(publicDir, 'catalog.json'), 'utf8'),
    ) as CharacterMeta[];

    expect(catalog).toHaveLength(200);
    expect(catalog.every((char) => !char.name.startsWith('test_'))).toBe(true);
    // 프리뷰(출시 전) 항목은 출시되면 정식 등록되며 사라진다. 지금은 하나 —
    // 스킬을 창작해 (임시)로 넣은 캐릭터다 (PARSING-CHARS §프리뷰).
    expect(catalog.filter((char) => char.preview).map((char) => char.name))
      .toEqual(['드레이크 : 그레이트 빌런']);
  });

  it('lists only runtime files that exist and have content', () => {
    const manifest = JSON.parse(
      readFileSync(join(publicDir, 'runtime', 'manifest.json'), 'utf8'),
    ) as RuntimeManifest;

    expect(manifest.version).toMatch(/^[a-f0-9]{16}$/);
    expect(manifest.files).toHaveLength(24);
    expect(manifest.files).toContain('context/growth.py');
    // 브리지가 import하는 모듈이 목록에서 빠지면 엔진 초기화가 통째로 실패한다.
    expect(manifest.files).toContain('calculator/combat_power.py');

    // 스탯표를 새로 넣고 매니페스트에 안 실으면 **엔진 임포트부터** 죽는다
    // (`level_beyond.json`을 그렇게 빠뜨려 계산이 전부 실패했다, 2026-08-27).
    // 개수를 세는 것만으로는 못 잡는다 — 실제로 있는 표를 다 싣는지 본다.
    const tableDir = join(publicDir, '..', '..', 'data', 'base_stat_tables');
    for (const table of readdirSync(tableDir).filter((name) => name.endsWith('.json'))) {
      expect(manifest.files).toContain(`data/base_stat_tables/${table}`);
    }
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

    // 큐브 종류는 게임 업데이트로 늘어난다. 목록을 여기 박아두면 데이터가 앞설 때마다
    // 테스트가 깨지므로, 정본(cube.json)과 어긋나지 않는지만 본다.
    const cubeTable = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', 'data', 'base_stat_tables', 'cube.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const canonicalCubes = Object.keys(cubeTable)
      .filter((name) => !name.startsWith('_') && name !== '공통');

    expect(Object.keys(settings.cubes)).toEqual(canonicalCubes);
    expect(settings.cubes['렐릭 베어 큐브']!.levels['1']).toMatchObject({
      atk: 390,
      def: 78,
      hp: 11_800,
      effect: 14.84,
      // 큐브 레벨 1~4에는 공통(우월 코드) 스킬 레벨이 없다 — cube.json `_level_note`
      commonElement: 0,
    });
    expect(settings.cubes['택티컬 베어 큐브']!.levels['15']).toMatchObject({
      atk: 2_780,
      def: 552,
      hp: 83_400,
      effect: 3,
      commonElement: 19.09,
    });
    expect(settings.characters['미하라 : 본딩 체인']!.overload.atk_pct).toBe(23.22);
    expect(settings.characters['미하라 : 본딩 체인']!.cube).toEqual({ name: '렐릭 베어 큐브', level: 15 });
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
    // `skillLevelsLocked`는 프리뷰(출시 전) 캐릭터 전용이다 — 레벨 10 계수만
    // 존재하기 때문이다. 지금 잠긴 것은 (임시) 창작 등록 하나뿐이다.
    // 프리뷰였던 `니지마 마코토`·`아마기 유키코`는 정식 명칭으로 등록되며 잠금이 풀렸다.
    expect(Object.entries(settings.characters)
      .filter(([, meta]) => meta.skillLevelsLocked)
      .map(([name]) => name)).toEqual(['드레이크 : 그레이트 빌런']);
    for (const name of ['퀸(마코토)', '유키코']) {
      expect(settings.characters[name]).toMatchObject({ skillLevelsLocked: false });
    }
    expect(settings.overloadFields.element_bonus).toMatchObject({
      label: '우월 코드 대미지',
      unit: '%',
    });
    // 입력 칸 순서는 인게임 오버로드 표기 순서를 따른다 — 게임 화면을 보고 그대로
    // 옮겨 적을 수 있어야 한다. 순서가 뜻을 가지므로 테스트로 고정한다.
    expect(Object.keys(settings.overloadFields)).toEqual([
      'element_bonus',    // 우코
      'atk_pct',          // 공증
      'max_ammo_pct',     // 장탄
      'charge_speed_pct', // 차속
      'charge_dmg_pct',   // 차댐
      'accuracy_pct',     // 명중
      'crit_rate',        // 크확
      'crit_dmg',         // 크댐
      'def_pct',          // 방어
    ]);
    expect(settings.manualStats.split_dmg_pct).toMatchObject({
      label: '분배 대미지',
      unit: '%',
    });
    expect(settings.manualStats.attack_speed_pct).toBeDefined();
    expect(settings.manualStats.ammo_charge_flat).toBeDefined();
  });
});
