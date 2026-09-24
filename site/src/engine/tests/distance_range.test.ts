/**
 * 신식 적정거리 — 거리 d가 적정거리 무기군·코어/보스 크기·탄착군 표를 정한다
 * (`weapon_mechanics.json`의 `distance`·`accuracy_distance`). 구식(legacy)은 예전 계산과 같아야 한다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineData, raisesPy } from './helpers';
import { BuffManager } from '../buff_manager';
import { _core_hit_prob, _spread_diameter, distance_scale, distance_weapons, simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { normalize_distance, normalize_distance_windows, normalize_range_model } from '../customization';
import { run_request } from '../bridge';
import { round } from '../py';

beforeAll(loadEngineData);

const DISTANCE = { range_model: 'distance' };

describe('신식 적정거리', () => {
  it('거리 → 적정거리 무기군(양 끝 포함) — 스크린샷 세 거리와 맞고 런처는 없다', () => {
    expect(distance_weapons(22)).toEqual(['SG', 'SMG']);
    expect(distance_weapons(30)).toEqual(['SMG', 'AR']);
    expect(distance_weapons(52)).toEqual(['MG', 'SR']);
    expect(distance_weapons(25)).toEqual(['SG', 'SMG', 'AR']);
    expect(distance_weapons(100)).toEqual(['SR']);
    for (const d of [5, 22, 30, 40, 52, 80]) expect(distance_weapons(d)).not.toContain('RL');
  });

  it('보이는 크기는 기준 거리(30) ÷ 거리', () => {
    expect(distance_scale(30)).toBe(1);
    expect(distance_scale(60)).toBe(0.5);
    expect(distance_scale(15)).toBe(2);
  });

  it('탄착군 — 구식은 예전 표 그대로, 신식은 새 표·MG 예열·핀포인트', () => {
    // 구식: 예전과 같다(MG 10px, SMG 110 − 명중%).
    expect(_spread_diameter('MG', 0)).toBe(10);
    expect(_spread_diameter('SMG', 20)).toBe(90);
    expect(_spread_diameter('AR', 23.62)).toBeCloseTo(76 - 0.69 * 23.62, 9);
    // 신식: SMG는 명중률과 무관, MG는 예열 전 253 → 예열 후 95.
    expect(_spread_diameter('SMG', 20, DISTANCE)).toBe(97);
    expect(_spread_diameter('MG', 0, DISTANCE, 0)).toBe(253);
    expect(_spread_diameter('MG', 0, DISTANCE, 1)).toBe(95);
    expect(_spread_diameter('MG', 0, DISTANCE, 0.5)).toBe(174);
    expect(_spread_diameter('AR', 23.62, DISTANCE)).toBe(_spread_diameter('AR', 23.62));
    // 무기 변경 모드의 «명중률 100% = 핀포인트» 선언은 기울기 0인 무기군에서도 살아 있다.
    expect(_spread_diameter('SMG', 100, DISTANCE)).toBe(10);
    // 코어 확률도 같은 표를 탄다.
    expect(_core_hit_prob('MG', 0, 52)).toBe(1);
    expect(_core_hit_prob('MG', 0, 52, DISTANCE)).toBeLessThan(0.3);
  });

  it('구간을 따라 프레임마다 적정 무기군과 코어 크기가 바뀐다', () => {
    const states = new Map<number, [number, string[], number]>();
    const proto = BuffManager.prototype;
    const tick = proto.tick;
    proto.tick = function (this: BuffManager, t: number): void {
      const enemy = this.state['enemy'];
      states.set(round(t, 9), [enemy['distance_now'], [...enemy['optimal_range_weapons']], enemy['core_px']]);
      return tick.call(this, t);
    };
    try {
      const squad = build_squad(['test_B3']);
      simulate(squad, build_config(squad, { duration: 4, rng_mode: 'expected', first_burst_time: 100 }), {
        range_model: 'distance', distance: 30, core_px: 60,
        // 겹치면 먼저 시작한 구간이 이긴다.
        distance_windows: [{ from: 1, to: 2, distance: 52 }, { from: 1.5, to: 3, distance: 22 }],
      });
    } finally {
      proto.tick = tick;
    }
    expect(states.get(0)).toEqual([30, ['SMG', 'AR'], 60]);
    expect(states.get(1)![0]).toBe(52);
    expect(states.get(1)![1]).toEqual(['MG', 'SR']);
    expect(states.get(1)![2]).toBeCloseTo(60 * 30 / 52, 9);
    expect(states.get(1.5)![0]).toBe(52);
    expect(states.get(2)![0]).toBe(22);
    expect(states.get(2)![1]).toEqual(['SG', 'SMG']);
    expect(states.get(3)).toEqual([30, ['SMG', 'AR'], 60]);
  });

  it('신식이면 구식 적정거리 값은 쓰지 않는다', () => {
    const squad = build_squad(['test_B3']);
    const config = build_config(squad, { duration: 4, rng_mode: 'expected', first_burst_time: 100 });
    const a = simulate(squad, config, { range_model: 'distance', distance: 30, optimal_range_weapons: ['SR'] });
    const b = simulate(build_squad(['test_B3']), build_config(build_squad(['test_B3']), {
      duration: 4, rng_mode: 'expected', first_burst_time: 100 }), { range_model: 'distance', distance: 30 });
    expect(a.squad_total).toBe(b.squad_total);
  });

  it('MG 코어 확률은 예열될수록 오른다(신식)', () => {
    const squad = build_squad(['크라운']);
    const result = simulate(squad, { duration: 5, rng_mode: 'expected' },
      { def: 0, code: '', core_px: 60, range_model: 'distance', distance: 30 });
    const shots = result.hits.filter((h) => h.core_frac != null).map((h) => h.core_frac as number);
    expect(shots.length).toBeGreaterThan(10);
    // 첫 발은 예열 전(253) 탄착군, 예열이 끝나면 예열 후(95) 탄착군의 확률에 닿는다.
    expect(shots[0]!).toBeCloseTo(_core_hit_prob('MG', 0, 60, DISTANCE, 0), 2);
    expect(shots[0]!).toBeLessThan(Math.max(...shots) / 5);
    expect(Math.max(...shots)).toBeCloseTo(_core_hit_prob('MG', 0, 60, DISTANCE, 1), 9);
  });

  it('브리지 — 방식을 안 주면 구식이고, 신식은 거리·구간을 검증해 싣는다', () => {
    const base = {
      squad: ['크라운'], duration: 10, enemyDef: 0, enemyCode: '', corePx: 52, hasParts: false,
      seed: 1, rngMode: 'expected', synchroLevel: 400,
    };
    const total = (extra: Record<string, unknown>) => {
      const res = JSON.parse(run_request({ ...base, ...extra }));
      expect(res.error, JSON.stringify(res.error)).toBeUndefined();
      return (res.result ?? res).squadTotal as number;
    };
    const legacy = total({});
    expect(total({ rangeModel: 'legacy' })).toBe(legacy);
    expect(total({ rangeModel: 'distance', distance: 30 })).toBeLessThan(legacy);
    expect(() => run_request({ ...base, rangeModel: 'distance', distance: 3 })).toThrow('거리는');
  });

  it('검증', () => {
    expect(normalize_range_model(null)).toBe('legacy');
    expect(normalize_range_model('distance')).toBe('distance');
    expect(raisesPy(() => normalize_range_model('far'))).toBe(true);
    expect(normalize_distance(null)).toBe(30);
    expect(normalize_distance(52)).toBe(52);
    expect(raisesPy(() => normalize_distance(4))).toBe(true);
    expect(raisesPy(() => normalize_distance('30'))).toBe(true);
    expect(normalize_distance_windows([{ from: 0, to: 10, distance: 22 }])).toEqual([{ from: 0, to: 10, distance: 22 }]);
    expect(raisesPy(() => normalize_distance_windows([{ from: 0, to: 10, weapons: [] }]))).toBe(true);
    expect(raisesPy(() => normalize_distance_windows([{ from: 5, to: 1, distance: 30 }]))).toBe(true);
    expect(raisesPy(() => normalize_distance_windows([{ from: 0, to: 10, distance: 200 }]))).toBe(true);
  });
});
