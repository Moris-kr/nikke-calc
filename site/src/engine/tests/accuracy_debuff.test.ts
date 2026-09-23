/**
 * Negative accuracy must reach both automatic and charged shot core calculations.
 * 파이썬: calculator/test_accuracy_debuff.py
 *
 * 파이썬은 `patch('calculator.timeline._core_hit_prob', wraps=...)`로 코어 확률 모델에 들어간 명중률 인자를
 * 직접 봤다. ESM에서는 같은 모듈 안의 호출을 가로챌 수 없어서, 대신 명중률 자료(`weapon_mechanics.accuracy`)를
 * 잠시 바꿔 `_core_hit_prob`가 명중률에 대해 **일대일**이 되게 한 뒤(기본값은 MG·RL의 acc_slope가 0이라
 * 명중률과 무관하다), 사격 히트의 `core_frac`(= 기대값 모드의 코어 확률)이 `_core_hit_prob(무기, 기대 명중률, 코어)`와
 * 같은지 본다. 일대일이므로 같다는 것은 모델에 들어간 명중률이 기대 명중률이라는 뜻이다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineData } from './helpers';
import { data } from '../data';
import { BuffManager } from '../buff_manager';
import { CharState, _core_hit_prob, simulate } from '../timeline';
import { build_squad } from '../spec';
import { setdefault } from '../py';

beforeAll(loadEngineData);

/** 무기들의 명중률 자료를 명중률에 민감하게(일대일) 바꿔 fn을 돌리고 되돌린다. */
function withSensitiveAccuracy<T>(weapons: string[], fn: () => T): T {
  const acc = data().weapon_mechanics['accuracy'];
  const saved = weapons.map((w) => [w, acc[w]] as const);
  for (const w of weapons) acc[w] = { base_diameter: 500, acc_slope: 1 };
  try {
    return fn();
  } finally {
    for (const [w, v] of saved) acc[w] = v;
  }
}

describe('AccuracyDebuffTest', () => {
  it('test_mast_intoxication_stacks_reach_accuracy_model', () => {
    const name = '마스트 : 로망틱 메이드';
    const squad = build_squad([name]);
    const bm = new BuffManager(squad, { enemy: {} });
    bm.battle_start();
    bm.state['rng_acc'] = {};
    const state = new CharState(squad[0]!, 100000, '');
    const enemy = { def: 0, code: '', core_px: 90 };
    withSensitiveAccuracy([state.weapon_type], () => {
      for (let stacks = 1; stacks < 4; stacks += 1) {
        bm.notify('burst_enter:1', stacks, name);
        const accuracy = bm.get_buffs(name, '__enemy__', stacks)['accuracy_pct'];
        expect(accuracy).toBeLessThan(0);
        const events = state._fire(stacks, bm, enemy, { rng_mode: 'expected' });
        const shots = events.filter((e) => e.core_frac != null);
        expect(shots.length).toBeGreaterThan(0);
        // 모델 인자 = 명중률 (일대일 모델이라 확률이 같으면 인자가 같다)
        expect(_core_hit_prob(state.weapon_type, accuracy, 90)).not.toBe(_core_hit_prob(state.weapon_type, 0, 90));
        expect(shots[shots.length - 1]!.core_frac).toBe(_core_hit_prob(state.weapon_type, accuracy, 90));
      }
    });
  });

  it('test_charged_shots_preserve_negative_accuracy', () => {
    function core_share(accuracy: number): number {
      const squad = build_squad(['메이든 : 아이스 로즈']);
      setdefault(squad[0]!, 'manual_stats', {} as Record<string, any>)['accuracy_pct'] = accuracy;
      const weapon_type = new CharState(squad[0]!, 100000, '').weapon_type;
      return withSensitiveAccuracy([weapon_type], () => {
        const result = simulate(squad, { duration: 3, rng_mode: 'expected' },
          { def: 0, code: '', core_px: 5 });
        // 마지막 사격 히트의 코어 확률 → 그 확률을 내는 명중률(일대일)을 되짚는다.
        const shots = result.hits.filter((h) => h.core_frac != null);
        expect(shots.length).toBeGreaterThan(0);
        const last = shots[shots.length - 1]!.core_frac;
        expect(_core_hit_prob(weapon_type, accuracy, 5)).not.toBe(_core_hit_prob(weapon_type, 0, 5));
        expect(last).toBe(_core_hit_prob(weapon_type, accuracy, 5));
        return accuracy;
      });
    }
    expect(core_share(-60)).toBe(-60);
  });
});
