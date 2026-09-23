// py: calculator/test_ein_feather_timing.py
import { beforeAll, describe, expect, it } from 'vitest';
import { BuffManager } from '../buff_manager';
import { simulate } from '../timeline';
import { build_squad } from '../spec';
import { sorted } from '../py';
import { loadEngineData, withinDelta } from './helpers';

beforeAll(loadEngineData);

describe('EinFeatherTimingTest', () => {
  it('test_four_feathers_first_attack_after_4_16_seconds', () => {
    const bm = new BuffManager(build_squad(['아인']), { enemy: {} });
    bm.battle_start();
    const st = bm.state['feathers']['아인']['니어 페더'];
    expect(st['next_t']).toBeCloseTo(4.16, 7);
  });

  it('test_six_feathers_attack_36_times_in_first_burst_window', () => {
    const r = simulate(build_squad(['리틀 머메이드', '크라운', '아인', 'test_B3']),
      { duration: 13.3, first_burst_time: 3, rng_mode: 'expected' },
      { code: '수냉', core_px: 52 });
    const hits = r.hits.filter((h) => h.caster === '아인' && h.skill_name === '니어 페더 공격');
    expect(hits.length).toBe(36);
    const times = sorted(new Set(hits.map((h) => h.t)));
    expect(times.length).toBe(6);
    for (let i = 0; i + 1 < times.length; i++) {
      const a = times[i]!;
      const b = times[i + 1]!;
      // assertAlmostEqual(b-a, 1.6, delta=1/60+.001)
      expect(withinDelta(b - a, 1.6, 1 / 60 + 0.001), `${b - a}`).toBe(true);
    }
  });
});
