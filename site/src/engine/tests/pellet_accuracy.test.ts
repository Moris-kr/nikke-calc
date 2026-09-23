/**
 * 파이썬: calculator/test_pellet_accuracy.py
 *
 * 옮김 메모
 * - `patch('calculator.buff_manager.char_effects', return_value=…)`: 파이썬 엔진은 모듈 함수 `char_effects`를
 *   `BuffManager.char_effects` 메서드 한 곳에서만 부른다(TS도 같다). ESM에서는 같은 모듈 안의 호출을 가로챌 수
 *   없어서, 그 메서드(`BuffManager.prototype.char_effects`)를 잠시 바꿔 같은 목록을 돌려주게 했다.
 * - `patch.object(CharState, '_pellet_probabilities', …)`: `CharState.prototype`의 메서드를 잠시 바꿔 끼운다.
 * - `patch.dict(_NIKKE['test_B3'], …)`: 엔진 데이터 사전(`data().parsed_nikke`)을 직접 고치고 되돌린다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineData, withinDelta } from './helpers';
import { BuffManager } from '../buff_manager';
import { CharState, _NIKKE, normal_hit_coeff, simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { aim_at, at_least, contains, integrate, type Shape } from '../pellet_accuracy';
import type { SimResult } from '../sim_result';

beforeAll(loadEngineData);

/** `patch.object(cls, key, replacement)` — fn 동안만 프로토타입 메서드를 바꿔 끼운다. */
function patchProto<T>(proto: any, key: string, replacement: (...args: any[]) => any, fn: () => T): T {
  const original = proto[key];
  proto[key] = replacement;
  try {
    return fn();
  } finally {
    proto[key] = original;
  }
}

/** `patch.dict(d, values)` — fn 동안만 사전 값을 덮고, 끝나면 원래대로(새 키는 지운다). */
function patchDict<T>(d: Record<string, any>, values: Record<string, any>, fn: () => T): T {
  const saved = { ...d };
  Object.assign(d, values);
  try {
    return fn();
  } finally {
    for (const k of Object.keys(d)) if (!(k in saved)) delete d[k];
    Object.assign(d, saved);
  }
}

function run_case(probability = 1, geometry: Record<string, any> | null = null, mode = 'expected',
  effects: any[] = []): SimResult {
  const squad = build_squad(['드레이크']);
  const list = [...effects];
  return patchProto(BuffManager.prototype, 'char_effects', () => list, () => simulate(squad, build_config(squad, {
    duration: 8, first_burst_time: 100, rng_mode: mode,
  }), {
    core_px: 0, shotgun_hit_rate: probability,
    ...(geometry !== null ? { shotgun_geometry: geometry } : {}),
  }, false, 42));
}

describe('PelletAccuracyTest', () => {
  it('test_default_coefficient_is_unscaled', () => {
    expect(normal_hit_coeff({}, 'SG')).toBe(1);
  });

  it('test_probability_changes_damage_and_zero_disables_hit_triggers', () => {
    const full = run_case().squad_total;
    expect(withinDelta(run_case(0.8).squad_total / full, 0.8, 0.0001)).toBe(true);
    const effect = {
      name: 'pellet probe', type: 'damage', stat: 'damage',
      target: 'target', fixed_value: 100,
      trigger: { timing: ['pellet_hit_count:1'], condition: [] },
    };
    expect(run_case(0, null, 'expected', [effect]).squad_total).toBe(0);
    const a = run_case(1, null, 'expected', [effect]);
    const b = run_case(0.8, null, 'expected', [effect]);
    expect(b.hits.filter((h) => h.skill_name === 'pellet probe').length)
      .toBeLessThan(a.hits.filter((h) => h.skill_name === 'pellet probe').length);
  });

  it('test_geometry_overrides_preset_and_respects_visibility_and_aim', () => {
    const box = { kind: 'rect', x: 0, y: 0, w: 1000, h: 1000, rotation: 0 };
    const geometry = { shapes: [box], parts: [], center: { x: 0, y: 0 } };
    expect(run_case(0, geometry).squad_total).toBe(run_case().squad_total);
    expect(run_case(1, { ...geometry, shapes: [] }).squad_total).toBe(0);
    const limited = { ...geometry, shapes: [{ ...box, windows: [[0, 2]] }] };
    expect(run_case(1, limited).hits.every((h) => h.t < 2)).toBe(true);
    const away = { ...geometry, center: { x: 2000, y: 0 } };
    expect(run_case(1, away).squad_total).toBe(0);
  });

  it('test_multi_hit_threshold_uses_binomial_probability', () => {
    const effect = {
      name: 'multi probe', type: 'damage', stat: 'damage',
      target: 'target', fixed_value: 100,
      trigger: { timing: ['multi_hit:10'], condition: [] },
    };
    const full = run_case(1, null, 'expected', [effect]);
    const partial = run_case(0.8, null, 'expected', [effect]);
    const count = (result: SimResult) => result.hits.filter((h) => h.skill_name === 'multi probe').length;
    expect(count(full)).toBeGreaterThan(0);
    expect(count(partial)).toBe(Math.trunc(count(full) * 0.8 ** 10));
  });

  it('test_shapes_overlap_and_rotation_and_distribution', () => {
    expect(contains(['rect', 0, 0, 40, 4, 90], 0, 15)).toBe(true);
    expect(contains(['rect', 0, 0, 40, 4, 90], 15, 0)).toBe(false);
    expect(contains(['triangle', 0, 0, 40, 40, 0], 0, -19)).toBe(true);
    expect(contains(['triangle', 0, 0, 40, 40, 0], 15, -19)).toBe(false);
    const circle: Shape = ['circle', 0, 0, 100, 100, 0];
    const [hit, core] = integrate([circle], [0, 0], 100, [0, 0, 25], 2.55);
    expect(withinDelta(hit, 0.5 ** 2.55, 0.002)).toBe(true);
    expect(withinDelta(hit * core, 0.25 ** 2.55, 0.002)).toBe(true);
    expect(integrate([circle, circle], [0, 0], 100, null, 2.55)[0]).toBe(hit);
    expect(aim_at({ aimKeys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 20 }] }, 5)).toEqual({ x: 50, y: 10 });
    expect(at_least(10, 0.8, 10)).toBeCloseTo(0.8 ** 10, 7);
  });

  it('test_non_shotgun_unaffected', () => {
    const squad = build_squad(['test_B3']);
    const config = build_config(squad, { duration: 4, first_burst_time: 100, rng_mode: 'expected' });
    expect(simulate(squad, config, { shotgun_hit_rate: 0 }).hits)
      .toEqual(simulate(squad, config, { shotgun_hit_rate: 1 }).hits);
  });

  it('test_weapon_change_uses_shotgun_accuracy_and_all_miss_charge_is_safe', () => {
    const squad = build_squad(['드레이크']);
    const state = new CharState(squad[0]!, 10000, '');
    state.weapon_type = 'RL';
    state.accuracy_weapon = 'SG';
    expect(state._pellet_probabilities(0, { state: {} } as any,
      { shotgun_hit_rate: 0 }, {}, 0.3)).toEqual([0, 0.3]);
    const config = build_config(squad, { duration: 4, first_burst_time: 100, rng_mode: 'random' });
    patchProto(CharState.prototype, '_pellet_probabilities', () => [0, 0], () => {
      patchDict(_NIKKE()['test_B3'], { weapon_type: 'SR', charge_time: 1, charge_mult: 2.5 }, () => {
        const charged = build_squad(['test_B3']);
        expect(simulate(charged, config).squad_total).toBe(0);
      });
    });
  });

  it('test_random_reproducibility_and_partial_misses', () => {
    const a = run_case(0.8, null, 'random');
    expect(a.hits).toEqual(run_case(0.8, null, 'random').hits);
    expect(a.hits.length).toBeLessThan(run_case(1, null, 'random').hits.length);
  });
});
