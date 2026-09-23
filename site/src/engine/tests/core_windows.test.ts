/**
 * calculator/test_core_windows.py 이식.
 *
 * Core exposure applies before attacks, timed skills, and battle-start skills.
 *
 * 목(mock) 대응:
 * - 파이썬 `patch("calculator.buff_manager.char_effects", return_value=list(effects))` — 모듈 함수
 *   `char_effects`를 부르는 곳은 `BuffManager.char_effects`(메서드) 하나뿐이다(timeline도 이 메서드로 읽는다).
 *   ESM에서는 같은 모듈 안의 호출을 가로챌 수 없으므로 `BuffManager.prototype.char_effects`를 대신 바꾼다
 *   — 이름 하나당 같은 목록을 돌려주는 것까지 파이썬과 같다.
 * - 파이썬 `patch.object(BuffManager, "tick", observe)` — 프로토타입 메서드라 `vi.spyOn`으로 똑같이 감싼다.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BuffManager } from '../buff_manager';
import { round } from '../py';
import type { SimResult } from '../sim_result';
import { build_config, build_squad } from '../spec';
import { simulate } from '../timeline';
import { loadEngineData } from './helpers';

beforeAll(loadEngineData);
afterEach(() => {
  vi.restoreAllMocks();
});

function run_sim(windows: number[][] | null = null, core_px = 1000, effects: Array<Record<string, any>> = []): SimResult {
  const squad = build_squad(['test_B3']);
  const enemy: Record<string, any> = { core_px };
  if (windows != null) {
    enemy['core_windows'] = windows;
  }
  const list = [...effects];
  const spy = vi.spyOn(BuffManager.prototype, 'char_effects').mockReturnValue(list);
  try {
    return simulate(squad, build_config(squad, {
      duration: 4, rng_mode: 'expected', first_burst_time: 100,
    }), enemy);
  } finally {
    spy.mockRestore();
  }
}

const inWindows = (t: number, windows: number[][]): boolean => windows.some(([a, b]) => a! <= t && t < b!);

describe('CoreWindowsTest', () => {
  it('test_empty_and_absent_windows_preserve_always_core', () => {
    expect(run_sim().hits).toEqual(run_sim([]).hits);
  });

  it('test_two_windows_gate_normal_hits_and_preserve_no_core_toggle', () => {
    const windows = [[1, 2], [3, 3.5]];
    const result = run_sim(windows);
    const regions = new Set<number>();
    for (const hit of result.hits) {
      const t = round(hit.t, 9);
      const exposed = inWindows(t, windows);
      expect(hit.core_frac! > 0, JSON.stringify(hit)).toBe(exposed);
      regions.add(t < 1 ? 0 : t < 2 ? 1 : t < 3 ? 2 : t < 3.5 ? 3 : 4);
    }
    expect([...regions].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(run_sim(windows, 0).hits.every((hit) => hit.core_frac === 0)).toBe(true);
  });

  it('test_core_condition_is_set_before_battle_start_and_timed_skills', () => {
    const effect = {
      name: 'exposure probe', type: 'damage', stat: 'core_damage',
      target: 'target', fixed_value: 100,
      trigger: { timing: ['battle_start', 'every:0.5s'], condition: ['core_hit'] },
    };
    const result = run_sim([[1, 2], [3, 3.5]], 1000, [effect]);
    const times = result.hits.filter((h) => h.skill_name === 'exposure probe').map((h) => round(h.t, 9));
    expect(times.length).toBe(3);
    expect(times.every((t) => inWindows(t, [[1, 2], [3, 3.5]]))).toBe(true);
    expect(run_sim([[0, 1]], 1000, [effect]).hits
      .filter((h) => h.skill_name === 'exposure probe')
      .some((h) => h.t === 0)).toBe(true);
  });

  it('test_frame_boundaries_are_start_inclusive_and_end_exclusive', () => {
    const states = new Map<number, number>();
    const tick = BuffManager.prototype.tick;

    vi.spyOn(BuffManager.prototype, 'tick').mockImplementation(function (this: BuffManager, t: number) {
      states.set(round(t, 9), this.state['enemy']['core_px']);
      return tick.call(this, t);
    });
    run_sim([[1, 2], [3, 3.5]]);
    for (const [t, exposed] of [[0, false], [1, true], [2, false], [3, true], [3.5, false]] as Array<[number, boolean]>) {
      expect(states.has(t), String(t)).toBe(true);   // 파이썬 states[t]는 없으면 KeyError
      expect(states.get(t)! > 0, String(t)).toBe(exposed);
    }
  });

  it('test_normal_formula_skills_use_current_exposure', () => {
    const effect = {
      name: 'normal formula probe', type: 'damage', stat: 'damage',
      damage_formula: 'normal_attack', target: 'target', fixed_value: 100,
      trigger: { timing: ['battle_start', 'every:0.5s'], condition: [] },
    };
    const plain = run_sim(null, 0, [effect]);
    const exposed = run_sim([[1, 2], [3, 3.5]], 1000, [effect]);
    const body_damage = new Map<number, number>(
      plain.hits.filter((h) => h.skill_name === effect.name).map((h) => [h.t, h.damage]));
    for (const h of exposed.hits) {
      if (h.skill_name === effect.name) {
        const inside = inWindows(round(h.t, 9), [[1, 2], [3, 3.5]]);
        expect(body_damage.has(h.t), JSON.stringify(h)).toBe(true);   // 파이썬 body_damage[h.t]는 없으면 KeyError
        expect(h.damage > body_damage.get(h.t)!, JSON.stringify(h)).toBe(inside);
      }
    }
  });

  it('test_core_hit_trigger_only_fires_during_exposure', () => {
    const effect = {
      name: 'core hit probe', type: 'damage', stat: 'damage',
      target: 'target', fixed_value: 100,
      trigger: { timing: ['core_hit:1'], condition: [] },
    };
    const result = run_sim([[1, 2], [3, 3.5]], 1000, [effect]);
    const times = result.hits.filter((h) => h.skill_name === effect.name).map((h) => round(h.t, 9));
    expect(times.length).toBeGreaterThan(0);
    expect(times.every((t) => inWindows(t, [[1, 2], [3, 3.5]]))).toBe(true);
  });
});
