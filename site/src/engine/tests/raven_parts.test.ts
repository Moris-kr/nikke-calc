/**
 * 레이븐의 버스트는 파츠에도 맞는다.
 * 파이썬: calculator/test_raven_parts.py
 *
 * 「템페스트」 원문은 `■ 적 전체에게(파츠 포함)`이다. 대상에 파츠를 명시한 damage 효과는
 * `hits_parts: true`를 달고, 그 히트만 파츠 판정을 받아 `part_dmg_pct`가 실린다
 * (`context/PARSING.md` §hits_parts). 레이븐만 이 표시가 빠져 있어, 파츠를 켠 보스에서도
 * 자기 「급소 공략」(파츠 대미지 ▲)을 자기 버스트가 못 받고 있었다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineData } from './helpers';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { _PARSED_SKILLS } from '../buff_manager';
import { get, truthy } from '../py';

beforeAll(loadEngineData);

const SQUAD = ['레이븐', '크라운', '리타', '노아'];

function _total(has_parts: boolean): number {
  const squad = build_squad(SQUAD);
  const cfg = build_config(squad, { duration: 180, rng_mode: 'expected' });
  const result = simulate(squad, cfg, { code: '', core_px: 0, has_parts });
  return result.char_total['레이븐']!;
}

describe('RavenPartsTest', () => {
  it('test_burst_takes_part_damage_on_a_parts_boss', () => {
    // 파츠가 있는 보스에서만 오른다 — 없으면 파츠 판정 자체가 성립하지 않는다.
    expect(_total(true)).toBeGreaterThan(_total(false));
  });

  it('test_the_burst_effect_is_marked', () => {
    const tempest = (_PARSED_SKILLS()['레이븐'] as any[]).filter(
      (eff) => get(eff, 'name') === '템페스트' && get(eff, 'stat') === 'burst_damage',
    );
    expect(tempest.length).toBe(1);
    expect(truthy(get(tempest[0], 'hits_parts'))).toBe(true);
  });
});
