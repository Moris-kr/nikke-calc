/**
 * context/test_growth.py 이식 — 돌파 단계 → 한계돌파·코어 강화·호감도 규칙.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { growth_profile, resolve_growth } from '../growth';
import { build_char } from '../spec';
import { loadEngineData, raisesPy, readJson } from './helpers';

beforeAll(loadEngineData);

describe('CharacterGrowthTest', () => {
  it('test_bond_rank_ten_has_canonical_stats_for_each_class', () => {
    const table = readJson('data/base_stat_tables/affinity.json');
    expect(table['화력형']['10']).toEqual({ hp: 9062, atk: 403, def: 60 });
    expect(table['방어형']['10']).toEqual({ hp: 11076, atk: 269, def: 74 });
    expect(table['지원형']['10']).toEqual({ hp: 10069, atk: 336, def: 67 });
  });

  it('test_resolves_rarity_stage_table', () => {
    const cases: Array<[string, number, number, number, number]> = [
      ['R', 0, 0, 0, 1],
      ['SR', 0, 0, 0, 10],
      ['SR', 2, 2, 0, 30],
      ['SSR', 0, 0, 0, 10],
      ['SSR', 3, 3, 0, 30],
      ['SSR', 10, 3, 7, 30],
    ];
    for (const [rarity, stage, breakthrough, core, affinity] of cases) {
      // subTest(rarity=rarity, stage=stage)
      expect(resolve_growth('테스트', { rarity: rarity, manufacturer: '엘리시온' }, stage), `${rarity} ${stage}`).toEqual({
        breakthrough: breakthrough,
        core_enhancement: core,
        affinity: affinity,
      });
    }
  });

  it('test_rejects_invalid_stages_and_unknown_rarity', () => {
    const cases: Array<[Record<string, any>, unknown]> = [
      [{ rarity: 'SSR', manufacturer: '엘리시온' }, true],
      [{ rarity: 'SSR', manufacturer: '엘리시온' }, 1.5],
      [{ rarity: 'SSR', manufacturer: '엘리시온' }, -1],
      [{ rarity: 'SSR', manufacturer: '엘리시온' }, 11],
      [{ rarity: 'SR', manufacturer: '엘리시온' }, 3],
      [{ rarity: 'R', manufacturer: '엘리시온' }, 1],
      [{ rarity: 'UR', manufacturer: '엘리시온' }, 0],
    ];
    for (const [meta, stage] of cases) {
      // subTest(meta=meta, stage=stage) — assertRaises(ValueError)
      expect(raisesPy(() => resolve_growth('테스트', meta, stage)), `${JSON.stringify(meta)} ${String(stage)}`).toBe(true);
    }
  });

  it('test_pilgrim_and_over_spec_unlock_bond_forty', () => {
    const pilgrim = { rarity: 'SSR', manufacturer: '필그림' };
    const ordinary = { rarity: 'SSR', manufacturer: '엘리시온' };
    expect(resolve_growth('크라운', pilgrim, 3)['affinity']).toBe(40);
    expect(resolve_growth('리타', ordinary, 3)['affinity']).toBe(30);
    for (const name of ['라피 : 레드 후드', '아니스 : 스타', '네온 : 비전 아이']) {
      expect(resolve_growth(name, ordinary, 3)['affinity'], name).toBe(40);
    }
  });

  it('test_profile_exposes_maximum_and_default_stage', () => {
    expect(growth_profile('테스트', { rarity: 'SR', manufacturer: '엘리시온' })).toEqual(
      { rarity: 'SR', max_stage: 2, default_stage: 2, bond_40: false },
    );
    expect(growth_profile('크라운', { rarity: 'SSR', manufacturer: '필그림' })).toEqual(
      { rarity: 'SSR', max_stage: 10, default_stage: 3, bond_40: true },
    );
  });

  it('test_build_char_uses_profile_default_but_preserves_direct_overrides', () => {
    expect(build_char('리타')['affinity']).toBe(30);
    expect(build_char('크라운')['affinity']).toBe(40);

    const direct = build_char('크라운', { affinity: 12 });
    expect([direct['breakthrough'], direct['core_enhancement'], direct['affinity']]).toEqual([3, 0, 12]);
  });
});
