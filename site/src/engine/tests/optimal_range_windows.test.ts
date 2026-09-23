/**
 * 파이썬: calculator/test_optimal_range_windows.py
 *
 * 파이썬의 `patch.object(BuffManager, "tick", observe)`는 `BuffManager.prototype.tick`을 잠시 바꿔 끼우는
 * 것으로 옮겼다(호출이 `bm.tick(…)`으로 가므로 그대로 가로챈다).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineData, raisesPy } from './helpers';
import { BuffManager } from '../buff_manager';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { normalize_optimal_range_windows } from '../customization';
import { round } from '../py';
import type { SimResult } from '../sim_result';

beforeAll(loadEngineData);

function run_sim(windows: any[] | null = null): SimResult {
  const squad = build_squad(['test_B3']);
  const enemy: Record<string, any> = { optimal_range_weapons: ['AR'] };
  if (windows !== null) {
    enemy['optimal_range_windows'] = windows;
  }
  return simulate(squad, build_config(squad, {
    duration: 4, rng_mode: 'expected', first_burst_time: 100,
  }), enemy);
}

describe('OptimalRangeWindowsTest', () => {
  it('test_legacy_and_empty_windows_match', () => {
    expect(run_sim().hits).toEqual(run_sim([]).hits);
  });

  it('test_frame_boundaries_overlap_and_empty_override', () => {
    const states = new Map<number, Set<string>>();
    const proto = BuffManager.prototype;
    const tick = proto.tick;
    proto.tick = function (this: BuffManager, t: number): void {
      states.set(round(t, 9), new Set(this.state['enemy']['optimal_range_weapons']));
      return tick.call(this, t);
    };
    try {
      run_sim([
        { from: 1, to: 2, weapons: ['SMG', 'RL'] },
        { from: 1.5, to: 2.5, weapons: ['SR'] },
        { from: 3, to: 3.5, weapons: [] },
      ]);
    } finally {
      proto.tick = tick;
    }
    const cases: Array<[number, string[]]> = [[0, ['AR']], [1, ['SMG']], [1.5, ['SMG', 'SR']],
      [2, ['SR']], [2.5, ['AR']], [3, []], [3.5, ['AR']]];
    for (const [t, expected] of cases) {
      expect(states.get(t), String(t)).toEqual(new Set(expected));
    }
  });

  it('test_validation', () => {
    expect(normalize_optimal_range_windows(null)).toEqual([]);
    const good = { from: 1, to: 2, weapons: ['SR', 'RL', 'AR', 'SR'] };
    expect(normalize_optimal_range_windows([good])).toEqual([
      { from: 1.0, to: 2.0, weapons: ['AR', 'SR'] }]);
    for (const bad of [null, 'AR', {}, ['invalid'], [null]]) {
      expect(raisesPy(() => normalize_optimal_range_windows([{ ...good, weapons: bad }])), JSON.stringify(bad)).toBe(true);
    }
    for (const bad of [true, NaN, Infinity, -1, 2, 181]) {
      expect(raisesPy(() => normalize_optimal_range_windows([{ ...good, from: bad }])), String(bad)).toBe(true);
    }
    expect(raisesPy(() => run_sim([{ from: 2, to: 1, weapons: [] }]))).toBe(true);
  });

  it('test_normal_attack_damage_changes_only_inside_override', () => {
    const baseline = run_sim();
    const changed = run_sim([{ from: 1, to: 2, weapons: [] }]);
    expect(baseline.hits.length).toBe(changed.hits.length);
    let affected = 0;
    baseline.hits.forEach((before, i) => {
      const after = changed.hits[i]!;
      expect(before.t).toBe(after.t);
      if (1 <= round(after.t, 9) && round(after.t, 9) < 2) {
        expect(after.damage).toBeLessThan(before.damage);
        affected += 1;
      } else {
        expect(after.damage).toBe(before.damage);
      }
    });
    expect(affected).toBeGreaterThan(0);
  });
});
