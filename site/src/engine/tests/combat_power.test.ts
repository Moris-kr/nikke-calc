/**
 * calculator/test_combat_power.py 이식.
 *
 * 전투력 공식 회귀. 정본은 유저가 준 공식과 그 예시다(2026-08-26 확인).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { collection_coeff, combat_power, cube_coeff, stage_sum } from '../combat_power';
import { build_squad } from '../spec';
import { loadEngineData } from './helpers';

beforeAll(loadEngineData);

describe('CombatPowerTest', () => {
  it('test_matches_the_reference_example', () => {
    // 유저가 준 예시를 소수점까지 재현한다.
    //
    // 체력 1,693,423 · 공격 54,353 · 방어 11,035 · 스킬 10/7 · 버스트 7 ·
    // 우코 단계합 22 · 비우코 단계합 66 · 큐브 Lv5 · 소장품 R4
    // → ④ 2.383237, 전투력 71,725.34 (인게임 실측 71,727)
    const base = 0.7 * 1_693_423 + 19.35 * 54_353 + 70 * 11_035;
    expect(base).toBeCloseTo(3_009_576.65, 2);

    const mult = (1.3 + 0.01 * 10 + 0.01 * 7 + 0.02 * 7
      + 0.00828 * 22 + 0.0069 * 66
      + 0.0092 * cube_coeff({ level: 5 })
      + 0.0069 * collection_coeff('R4'));
    expect(mult).toBeCloseTo(2.383237, 6);
    expect(base * mult / 100).toBeCloseTo(71_725.3442662, 4);

    // 인게임 실측과 0.01% 안쪽이어야 한다.
    expect(Math.abs(base * mult / 100 - 71_727) / 71_727).toBeLessThan(0.0001);
  });

  it('test_cube_coefficient_follows_the_level_steps', () => {
    // 큐브 계수는 `cube.json`의 값 계단(= 스킬 레벨)에서 나온다.
    // 4레벨 이하는 고유 스킬만 센다 (1스킬 + 1).
    expect(cube_coeff({ level: 1 })).toBe(2);   // 1스킬 1
    expect(cube_coeff({ level: 3 })).toBe(3);   // 1스킬 2
    // 5레벨부터 공통 스킬이 붙는다 (1스킬 + 2스킬 + 4).
    expect(cube_coeff({ level: 5 })).toBe(7);   // 2 + 1 + 4 — 예시와 같은 값
    expect(cube_coeff({ level: 15 })).toBe(13);  // 3 + 6 + 4
    // 안 끼면 0이다.
    expect(cube_coeff(null)).toBe(0.0);
    expect(cube_coeff({ level: 0 })).toBe(0.0);
  });

  it('test_collection_coefficient_by_grade', () => {
    // 소장품 계수 — R은 1스킬 + 6.33, SR은 1스킬 + 2스킬 + 10.66.
    expect(collection_coeff('R4')).toBeCloseTo(10.33, 2);
    expect(collection_coeff('SR15')).toBeCloseTo(40.66, 2);
    expect(collection_coeff('없음')).toBe(0.0);
    expect(collection_coeff(null)).toBe(0.0);
  });

  it('test_stage_sum_inverts_the_percentage', () => {
    // 합계 퍼센트 → 단계 합.
    //
    // 우리는 옵션별 퍼센트만 들고 있는데, 단계표가 등차라 합을 되돌릴 수 있다.
    // 전투력에 필요한 것도 개별 단계가 아니라 합이다.
    // 기본 스펙 값들 — 후보가 하나씩만 나온다.
    expect(stage_sum('element_bonus', 88.6)).toBe(40);
    expect(stage_sum('atk_pct', 22.22)).toBe(20);
    expect(stage_sum('max_ammo_pct', 129.64)).toBe(20);
    // 안 붙은 옵션은 0.
    expect(stage_sum('crit_rate', 0)).toBe(0);
    // 단계 조합으로 만들 수 없는 수는 조용히 0으로 둔다(손입력 방어).
    expect(stage_sum('atk_pct', 0.01)).toBe(0);
  });

  it('test_investment_raises_combat_power', () => {
    // 더 굴린 캐릭터가 더 높은 전투력을 낸다 — 정렬이 뒤집히면 안 된다.
    const plain = build_squad(['라피'], {
      라피: {
        level: 200, skill_levels: { 1: 1, 2: 1, 3: 1 },
        cube: { name: '렐릭 베어 큐브', level: 1 },
        collection_stage: '없음', favorite_stage: 0,
      },
    })[0]!;
    const invested = build_squad(['라피'])[0]!;   // 기본 스펙(만렙·풀강)
    expect(combat_power(invested)).toBeGreaterThan(combat_power(plain));
    expect(combat_power(plain)).toBeGreaterThan(0);
  });
});
