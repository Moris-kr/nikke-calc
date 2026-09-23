/**
 * calculator/test_defense_rate_windows.py 이식.
 *
 * Independent timed veil reduction and explicit armor-break bypass.
 *
 * 목(mock) 대응:
 * - 파이썬 `patch("calculator.buff_manager.char_effects", return_value=list(effects))` — 모듈 함수
 *   `char_effects`를 부르는 곳은 `BuffManager.char_effects`(메서드) 하나뿐이다. ESM에서는 같은 모듈 안의
 *   호출을 가로챌 수 없으므로 `BuffManager.prototype.char_effects`를 대신 바꾼다.
 * - 파이썬 `patch.dict(_NIKKE["test_B3"], {...})` — `data().parsed_nikke["test_B3"]`를 try/finally로 고치고
 *   되돌린다. 차이 하나: 파이썬은 모듈마다 parsed_nikke를 따로 읽어 timeline의 사본만 바뀌지만, TS는
 *   사본이 하나라 spec·buff_manager·base_stat도 바뀐 값을 본다.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BuffManager } from '../buff_manager';
import { normalize_defense_rate_windows as normalize } from '../customization';
import { calc_damage, calc_damage_avg, default_hit_type } from '../damage';
import { data } from '../data';
import { PyError, round } from '../py';
import type { SimResult } from '../sim_result';
import { build_config, build_squad } from '../spec';
import { simulate } from '../timeline';
import { loadEngineData, withinDelta } from './helpers';

beforeAll(loadEngineData);
afterEach(() => {
  vi.restoreAllMocks();
});

/** 파이썬 `assertRaises(ValueError)`. py.ts의 변환 오류(`ValueError: ...` 메시지의 Error)도 받는다. */
function expectValueError(fn: () => unknown, msg?: string): void {
  let err: unknown = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err, msg).not.toBeNull();
  const isValueError = (err instanceof PyError && err.pyType === 'ValueError')
    || (err instanceof Error && err.message.startsWith('ValueError'));
  expect(isValueError, `${msg ?? ''} ${String(err)}`).toBe(true);
}

function effect(stat: string, opts: { name?: string; kind?: string; [k: string]: any } = {}): Record<string, any> {
  const { name = null, kind = 'damage', ...extra } = opts;
  return {
    name: name ?? stat, type: kind, stat,
    target: kind === 'buff' ? 'self' : 'target', fixed_value: 100,
    duration: 99, trigger: { timing: ['battle_start'], condition: [] }, ...extra,
  };
}

/** 파이썬 `calc_damage(**args)` — 키워드 인자 사전을 위치 인자로. */
interface DmgArgs {
  base_atk: number; buffs: Record<string, any>; weapon: Record<string, any>;
  hit_type?: Record<string, any> | null; enemy_def?: number;
}
const cd = (a: DmgArgs) => calc_damage(a.base_atk, a.buffs, a.weapon, a.hit_type ?? null, a.enemy_def);
const cda = (a: DmgArgs) => calc_damage_avg(a.base_atk, a.buffs, a.weapon, a.hit_type ?? null, a.enemy_def);

function sim(windows: number[][] | null = null, effects: Array<Record<string, any>> = []): SimResult {
  const squad = build_squad(['test_B3']);
  const enemy: Record<string, any> = { core_px: 0, def: 0 };
  if (windows != null) {
    enemy['defense_rate_windows'] = windows;
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

/** 파이썬 `zip(a, b)` — 짧은 쪽에서 멈춘다. */
function zip<A, B>(a: A[], b: B[]): Array<[A, B]> {
  return Array.from({ length: Math.min(a.length, b.length) }, (_, i) => [a[i]!, b[i]!]);
}

describe('DefenseRateTest', () => {
  it('test_formula_independence_and_explicit_type', () => {
    for (const received of [0, 50, 100]) {
      for (const extra of [{}, { armor_break_dmg_pct: 100 }, { def_ignore_pct: 100 },
        { enemy_def_down_pct: -50 }]) {
        const buffs = { crit_rate: 0, received_dmg: received, ...extra };
        let args!: DmgArgs;
        for (const ht of [default_hit_type(), default_hit_type({ is_normal_atk: false, is_dot: true })]) {
          args = { base_atk: 10000, buffs, weapon: { damage_coeff: 100 }, hit_type: ht, enemy_def: 1000 };
          const base = cd(args).damage;
          args.buffs = { ...buffs, enemy_defense_rate_pct: 60 };
          expect(cd(args).damage).toBe(round(base * .4));
          expect(cda(args)).toBeCloseTo(base * .4, 7);
        }
        const ht = default_hit_type({ is_armor_break_damage: true });
        args.hit_type = ht;
        expect(cd(args).damage).toBe(cd({ ...args, buffs }).damage);
      }
    }
  });

  it('test_reported_sixty_percent_samples', () => {
    for (const [before, after] of [[381769, 152708], [560845, 224338], [35049, 14020], [24290, 9716]] as const) {
      expect(cd({
        base_atk: before, buffs: { crit_rate: 0, enemy_defense_rate_pct: 60 },
        weapon: { damage_coeff: 100 }, enemy_def: 0,
      }).damage).toBe(after);
    }
  });

  it('test_dot_ticks_use_current_window_not_application_time', () => {
    const dot = effect('dot_damage', { duration: 3, tick_interval: .5 });
    const plain = sim(null, [dot]).hits.filter((h) => h.hit_tag === 'dot_damage');
    const reduced = sim([[1, 2, 60]], [dot]).hits.filter((h) => h.hit_tag === 'dot_damage');
    expect(plain.length).toBeGreaterThan(2);
    expect(plain.length).toBe(reduced.length);
    for (const [a, b] of zip(plain, reduced)) {
      const t = round(b.t, 9);
      const factor = 1 <= t && t < 2 ? .4 : 1;
      expect(withinDelta(b.damage, a.damage * factor, 1), `${b.damage} vs ${a.damage * factor}`).toBe(true);
    }
  });

  it('test_timed_overlap_boundaries_and_empty_baseline', () => {
    expect(sim().hits).toEqual(sim([]).hits);
    const probe = effect('damage', { trigger: { timing: ['battle_start', 'every:0.5s'], condition: [] } });
    const plain = sim(null, [probe]);
    const windows = [[0, 1, 60], [1, 2, 20], [1.5, 3, 60]];
    const reduced = sim(windows, [probe]);
    expect(plain.hits.length).toBe(reduced.hits.length);
    for (const [a, b] of zip(plain.hits, reduced.hits)) {
      const t = round(b.t, 9);
      const rates = windows.filter(([lo, hi]) => lo! <= t && t < hi!).map(([, , r]) => r!);
      const rate = rates.length ? Math.max(...rates) : 0;
      expect(withinDelta(b.damage, a.damage * (1 - rate / 100), 1),
        `${b.damage} vs ${a.damage * (1 - rate / 100)}`).toBe(true);
    }
  });

  it('test_normal_conversion_and_skill_bypass', () => {
    for (const buffs of [[], [effect('armor_break_enabled', { kind: 'buff' })]]) {
      const effects = [...buffs, effect('armor_break_damage')];
      const plain = sim(null, effects);
      const reduced = sim([[0, 4, 60]], effects);
      for (const [a, b] of zip(plain.hits, reduced.hits)) {
        const bypass = buffs.length > 0 || a.skill_name === 'armor_break_damage';
        expect(withinDelta(b.damage, a.damage * (bypass ? 1 : .4), 1),
          `${b.damage} vs ${a.damage * (bypass ? 1 : .4)}`).toBe(true);
      }
    }
  });

  it('test_copied_dealt_damage_not_reduced_twice', () => {
    const copy = effect('fixed_damage_from_dealt_pct', { trigger: { timing: ['hit_count:1'], condition: [] } });
    // 파이썬 patch.dict(_NIKKE["test_B3"], {...}) — 고친 키를 되돌린다(없던 키는 지운다).
    const row: Record<string, any> = data().parsed_nikke['test_B3'];
    const patch: Record<string, any> = { weapon_type: 'SR', charge_time: 1.0 };
    const saved = new Map(Object.keys(patch).map((k) => [k, [k in row, row[k]] as [boolean, any]]));
    let plain: SimResult;
    let reduced: SimResult;
    Object.assign(row, patch);
    try {
      plain = sim(null, [copy]);
      reduced = sim([[0, 4, 60]], [copy]);
    } finally {
      for (const [k, [had, v]] of saved) {
        if (had) row[k] = v;
        else delete row[k];
      }
    }
    let copied = 0;
    for (const [a, b] of zip(plain.hits, reduced.hits)) {
      expect(withinDelta(b.damage, a.damage * .4, 1), `${b.damage} vs ${a.damage * .4}`).toBe(true);
      copied += a.hit_tag === 'fixed_damage_from_dealt_pct' ? 1 : 0;
    }
    expect(copied).toBeGreaterThan(0);
  });

  it('test_full_veil_blocks_ordinary_but_not_armor_break', () => {
    for (const attack of [0, 10000]) {
      for (const armor of [false, true]) {
        const args: DmgArgs = {
          base_atk: attack, buffs: { enemy_defense_rate_pct: 100 },
          weapon: { damage_coeff: 100 }, enemy_def: 0,
          hit_type: default_hit_type({ is_armor_break_damage: armor }),
        };
        expect(cd(args).damage > 0).toBe(armor);
        expect(cda(args) > 0).toBe(armor);
      }
    }
  });

  it('test_accumulated_damage_not_reduced_twice', () => {
    const acc = effect('damage_accumulate', { kind: 'buff', duration: 2, fixed_value: 100000 });
    const plain = sim(null, [acc]);
    const reduced = sim([[0, 4, 60]], [acc]);
    const released = zip(plain.hits, reduced.hits).filter(([a]) => a.skill_name === acc['name']);
    expect(released.length).toBeGreaterThan(0);
    for (const [a, b] of released) {
      expect(withinDelta(b.damage, a.damage * .4, 10), `${b.damage} vs ${a.damage * .4}`).toBe(true);
    }
  });
});

describe('DefenseRateValidationTest', () => {
  it('test_defaults_and_bounds', () => {
    expect(normalize(null)).toEqual([]);
    expect(normalize([{ from: 0, to: 180 }])).toEqual([[0., 180., 60.]]);
    expect(normalize([[0, 1, 0], [1, 180, 100]])).toEqual([[0., 1., 0.], [1., 180., 100.]]);
    for (const raw of [{}, [null], [{ from: 1, to: 1 }], [{ from: -1, to: 1 }],
      [{ from: 0, to: 181 }], [{ from: true, to: 1 }],
      [{ from: NaN, to: 1 }], [{ from: 0, to: Infinity }]]) {
      // subTest(raw=raw)
      expectValueError(() => normalize(raw), `raw=${JSON.stringify(raw)}`);
    }
    for (const r of [-1, 101, NaN, Infinity, true, null]) {
      // subTest(rate=r)
      expectValueError(() => normalize([{ from: 0, to: 1, rate: r }]), `rate=${String(r)}`);
    }
    expectValueError(() => normalize(Array.from({ length: 101 }, () => ({ from: 0, to: 1 }))));
  });
});
