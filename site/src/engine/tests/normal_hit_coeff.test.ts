/**
 * 무기군 평타 계수의 계약.
 * 파이썬: calculator/test_normal_hit_coeff.py
 *
 * 사용자가 지정한 무기군 계수는 **평타에만** 붙고 스킬·버스트에는 붙지 않는다.
 * 샷건 기본 계수는 1이며, 펠릿 빗나감은 별도 명중 판정으로 처리한다.
 *
 * 기본값 근거는 `data/weapon_mechanics.json` `normal_hit_coeff._source`
 * (2026-09-20 기본 계수 1 적용).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineData, readJson } from './helpers';
import { normal_hit_coeff, simulate } from '../timeline';
import { build_config, build_squad } from '../spec';

beforeAll(loadEngineData);

function _totals(squad_names: string[], cfg_extra: Record<string, any> | null = null): Record<string, number> {
  const squad = build_squad(squad_names);
  const cfg = build_config(squad, { duration: 30, rng_mode: 'expected', ...(cfg_extra ?? {}) });
  const result = simulate(squad, cfg, { code: '', core_px: 0 });
  return result.char_total;
}

describe('NormalHitCoeffTest', () => {
  it('test_default_comes_from_the_mechanics_table', () => {
    const table = readJson('data/weapon_mechanics.json')['normal_hit_coeff'];
    expect(table['SG']).toBe(1.0);
    expect(normal_hit_coeff({}, 'SG')).toBe(1.0);
    // 표에 없는 무기군은 보정 없음.
    expect(normal_hit_coeff({}, 'AR')).toBe(1.0);
  });

  it('test_config_overrides_the_default', () => {
    expect(normal_hit_coeff({ normal_hit_coeff: { SG: 0.5 } }, 'SG')).toBe(0.5);
    // 덮지 않은 무기군은 표 기본값 그대로다.
    expect(normal_hit_coeff({ normal_hit_coeff: { SG: 0.5 } }, 'AR')).toBe(1.0);
  });

  it('test_coefficient_scales_shotgun_normal_attacks', () => {
    // SG 평타는 계수만큼 줄어든다. 1.0으로 되돌리면 원래 값이다.
    const name = '드레이크';
    const squad = [name, '크라운', 'test_B3'];
    const base = _totals(squad, { normal_hit_coeff: { SG: 1.0 } })[name]!;
    const halved = _totals(squad, { normal_hit_coeff: { SG: 0.5 } })[name]!;
    expect(halved).toBeLessThan(base);
    // 드레이크는 평타 비중이 100%가 아니므로 정확히 절반은 아니다 —
    // 줄어든 폭이 평타 몫 안에 들어 있는지만 본다.
    expect(halved / base).toBeGreaterThan(0.5);
    expect(halved / base).toBeLessThan(1.0);
  });

  it('test_non_shotgun_is_untouched_by_a_shotgun_coefficient', () => {
    const name = '리타'; // SMG — SG 계수와 무관해야 한다
    const squad = [name, '크라운', 'test_B3'];
    const a = _totals(squad, { normal_hit_coeff: { SG: 1.0 } })[name];
    const b = _totals(squad, { normal_hit_coeff: { SG: 0.2 } })[name];
    expect(a).toBe(b);
  });
});
