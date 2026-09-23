/**
 * calculator/test_burst_gauge.py 이식.
 *
 * 버스트 게이지 실누적(`burst_gauge_mode = "accumulate"`) — 원본 저장소 이식(2026-09-22).
 *
 * 정본: 원본 저장소 docs/mechanics/버스트 게이지.md. 규칙:
 * - 게이지는 스쿼드 공용 1개. 히트당 `burst_energy`(대상 기준, CDN /10000)를 쌓아 100%에
 *   1단계 진입하며 그때 0으로 소모된다. 초과분은 버려진다.
 * - 풀버스트가 끝나기 전(1단계 진입 ~ 풀버스트 종료)에는 안 찬다.
 * - 차지 무기의 풀차지 샷은 **카메라가 그 니케를 보고 있을 때만** `full_charge_mult`가 붙는다.
 * - 스킬 대미지 히트도 같은 히트당 값으로 채운다(풀차지 배율 없음).
 * - `burst_charge_pct`(즉시 N%)는 값 그대로 1회, `burst_charge_speed_pct`는 시전자 기준
 *   히트당 가산(발당→명중 뒤 대상 기준).
 * - 엔진 기본은 종전 "fixed"라 골든이 안 움직인다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { BuffManager } from '../buff_manager';
import { PyError, round, tupleKey } from '../py';
import type { SimResult } from '../sim_result';
import { build_config, build_squad } from '../spec';
import { simulate } from '../timeline';
import { loadEngineData, withinDelta } from './helpers';

beforeAll(loadEngineData);

function expectValueError(fn: () => unknown): void {
  let err: unknown = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).not.toBeNull();
  const isValueError = (err instanceof PyError && err.pyType === 'ValueError')
    || (err instanceof Error && err.message.startsWith('ValueError'));
  expect(isValueError, String(err)).toBe(true);
}

function _run(names: string[], opts: {
  mode?: string; chars?: Record<string, any> | null; config?: Record<string, any> | null;
  duration?: number; enemy?: Record<string, any> | null;
} = {}): SimResult {
  const { mode = 'accumulate', chars = null, config = null, duration = 60, enemy = null } = opts;
  const squad = build_squad(names, chars, null, new Set(names));
  const cfg = build_config(squad, {
    duration, rng_mode: 'expected',
    burst_gauge_mode: mode, ...(config ?? {}),
  });
  return simulate(squad, cfg, { code: '', core_px: 0, ...(enemy ?? {}) }, true);
}

function _first_fb(result: SimResult): number | null {
  return result.log!.burst_log.find((e) => e.event === 'full_burst 시작')?.t ?? null;
}

function _shots_before(result: SimResult, name: string, t_end: number): number {
  return result.hits.filter((h) => h.caster === name && h.skill_name === '기본 공격' && h.t < t_end).length;
}

describe('AccumulateModeTest', () => {
  it('test_gauge_fills_consumes_and_logs', () => {
    const res = _run(['크라운', '루주', '치사토']);
    const log = res.log!.gauge_log;
    expect(log.length, '게이지 로그가 비었다').toBeGreaterThan(0);
    expect(log.every((e) => e.gauge >= 0.0 && e.gauge <= 100.0 + 1e-9)).toBe(true);
    // 만충 → 1단계 진입(소모) 줄이 버스트 로그에 남고, 그 뒤 게이지는 0에서 다시 오른다.
    const fills = res.log!.burst_log.filter((e) => e.event.startsWith('게이지 만충'));
    expect(fills.length).toBeGreaterThanOrEqual(2);
    const after = log.find((e) => e.t > fills[0]!.t + 10.0);   // 풀버스트 10초가 끝난 뒤
    expect(after).toBeDefined();
    expect(after!.gauge).toBeLessThan(50.0);
    // 카메라 초점 로그 — 버충 담당이 없고 컨트롤도 없으니 3번 자리(치사토).
    const cam = res.log!.burst_log.find((e) => e.event.startsWith('카메라 초점'));
    expect(cam).toBeDefined();
    expect(cam!.event).toContain('치사토');
  });

  it('test_not_charging_between_stage1_and_full_burst_end', () => {
    const res = _run(['크라운', '루주', '치사토']);
    const fb_start = _first_fb(res)!;
    const fill = res.log!.burst_log.find((e) => e.event.startsWith('게이지 만충'))!.t;
    // 1단계 진입 ~ 풀버스트 종료 사이에는 가산이 하나도 없다.
    const blocked = res.log!.gauge_log.filter((e) => fill < e.t && e.t < fb_start + 10.0 - 1e-6);
    expect(blocked).toEqual([]);
  });

  it('test_fixed_default_ignores_gauge', () => {
    const fixed = _run(['크라운', '루주', '치사토'], { mode: 'fixed', config: { first_burst_time: 3.0 } });
    // 고정 모드는 게이지와 무관하게 first_burst_time에 1단계다 — 로그는 남되 판정엔 안 쓴다.
    expect(fixed.log!.gauge_log.length).toBeGreaterThan(0);
    expect(fixed.log!.burst_log.filter((e) => e.event.startsWith('게이지 만충'))).toEqual([]);
    expect(withinDelta(_first_fb(fixed)!, 3.0 + 0.05 * 3 + 0.1 * 2 + 0.05, 0.2)).toBe(true);
  });

  it('test_bad_mode_rejected', () => {
    expectValueError(() => _run(['크라운'], { mode: 'nope' }));
  });
});

describe('CameraFullChargeTest', () => {
  // 루주 1인 실측: 카메라 有 7발 / 無 18발에 만충 (5.8 × 2.5 = 14.5 vs 5.8).

  it('test_camera_multiplies_full_charge_gauge', () => {
    const with_cam = _run(['루주'], { config: { camera: '루주' } });
    const no_cam = _run(['루주'], { config: { camera: '' } });
    // 1인 스쿼드는 2·3단계가 없어 풀버스트까지는 못 간다 — 만충 시각으로 잰다.
    const full = (r: SimResult): number => r.log!.gauge_log.find((e) => e.gauge >= 100.0 - 1e-9)!.t;
    const t_with = full(with_cam);
    const t_no = full(no_cam);
    expect(_shots_before(with_cam, '루주', t_with + 1e-9)).toBe(7);
    expect(_shots_before(no_cam, '루주', t_no + 1e-9)).toBe(18);
    const srcs = new Set(with_cam.log!.gauge_log.map((e) => e.source));
    expect(srcs.has('weapon:full_charge')).toBe(true);
  });

  it('test_burst_charge_carrier_owns_camera', () => {
    // 버충 톡톡이 담당이 있으면 카메라는 무조건 그 사람. 두 명이면 실패한다.
    const tap = { tap_fire: { rate: 3.6, release: 0.03, policy: 'burst_charge' } };
    const res = _run(['크라운', '루주', '앨리스'], { chars: { 앨리스: { control: tap } } });
    const cam = res.log!.burst_log.find((e) => e.event.startsWith('카메라 초점'));
    expect(cam).toBeDefined();
    expect(cam!.event).toContain('앨리스');
    expectValueError(() => _run(['루주', '앨리스'], { chars: { 루주: { control: tap }, 앨리스: { control: tap } } }));
  });
});

describe('SkillGaugeTest', () => {
  it('test_burst_charge_pct_adds_once_per_trigger', () => {
    // 헬름 `진두지휘 3`: 풀차지 명중마다 14.31%를 **1회** (all_allies여도 공용 게이지 1개).
    const res = _run(['헬름', '크라운', '치사토']);
    const adds = res.log!.gauge_log.filter((e) => e.source === 'charge_pct:진두지휘 3');
    expect(adds.length).toBeGreaterThan(0);
    expect(adds.some((e) => Math.abs(e.amount - 14.31) < 1e-6)).toBe(true);
    // 같은 시각에 두 번 들어가지 않는다.
    const ts = adds.map((e) => e.t);
    expect(ts.length).toBe(new Set(ts).size);
  });

  it('test_charge_speed_is_flat_per_hit_from_caster_reference', () => {
    // 수동 스탯으로 크라운에게 버충속 +50% — 크라운(MG, 0.1)의 히트마다 0.05가 더 붙는다.
    const res = _run(['크라운', '루주', '치사토'], { chars: { 크라운: { manual_stats: { burst_charge_speed_pct: 50.0 } } } });
    const crown = res.log!.gauge_log.filter((e) => e.caster === '크라운' && e.source === 'weapon');
    const plain = _run(['크라운', '루주', '치사토']);
    const crown0 = plain.log!.gauge_log.filter((e) => e.caster === '크라운' && e.source === 'weapon');
    expect(crown.length > 0 && crown0.length > 0).toBe(true);
    expect(crown[0]!.amount / crown0[0]!.amount).toBeCloseTo(1.5, 6);
  });

  it('test_skill_damage_hits_charge_gauge_without_full_charge_mult', () => {
    // 앨리스 `원더랜드 바니`류 대신 헬름 스킬 대미지가 없으니 라피 : 레드 후드 예외표를 본다.
    const res = _run(['라피 : 레드 후드', '크라운', '치사토']);
    const skill = res.log!.gauge_log.filter(
      (e) => e.caster === '라피 : 레드 후드' && e.source.startsWith('skill:부착형 유탄 4'));
    expect(skill.length, '부착형 유탄 4 게이지가 없다').toBeGreaterThan(0);
    // 예외표: 히트당 1.9
    expect(skill.filter((e) => e.gauge < 100 - 1e-9)
      .every((e) => Math.abs(e.amount - 1.9 * round(e.amount / 1.9)) < 1e-6)).toBe(true);
  });
});

describe('FirstCyclePredictionTest', () => {
  // B — 첫 사이클에도 `next_fb_start_pred`가 있다(쿨타임 사슬). 장전컨 `into_fb`가 첫 사이클부터 건다.

  it('test_into_fb_reload_fires_in_first_cycle', () => {
    const ctrl = { reload: { policy: 'into_fb', margin: 0.43 } };
    const res = _run(['리타', '그레이브', '레이', '앨리스', '모더니아'], {
      mode: 'fixed',
      chars: { 앨리스: { control: ctrl } }, config: { first_burst_time: 3.0 }, duration: 60,
    });
    const fbs = res.log!.burst_log.filter((e) => e.event === 'full_burst 시작').map((e) => e.t);
    expect(fbs.length).toBeGreaterThanOrEqual(2);
    const reloads = res.log!.reload_log.filter((e) => e.caster === '앨리스' && e.event.includes('장전컨'));
    // 두 번째 풀버스트 **전에** 걸린 장전컨이 있다 — 종전에는 관측치가 없어 세 번째부터였다.
    expect(reloads.some((e) => fbs[0]! < e.t && e.t < fbs[1]!),
      JSON.stringify(reloads.map((e) => [e.t, e.event]).slice(0, 5))).toBe(true);
  });
});

describe('CondFinitePassiveTest', () => {
  it('test_chisato_finite_passive_reactivates_each_time_condition_holds', () => {
    const res = _run(['치사토', '목단', '타키나'], { mode: 'fixed', duration: 90 });
    const acts = res.log!.buff_events.filter((e) => e.name === '사격 간파' && e.kind === 'activate');
    expect(acts.length).toBeGreaterThan(1);
    // 조건(게이지 100)이 깨진 뒤에는 2초 안에 만료한다.
    expect(acts.every((e) => (e.expires_at as number) - e.t <= 2.0 + 1e-6)).toBe(true);
  });
});

function _bm(names: string[], state_extra: Record<string, any> | null = null): BuffManager {
  const squad = build_squad(names, null, null, new Set(names));
  const state: Record<string, any> = {
    enemy: {},
    hp: Object.fromEntries(squad.map((c) => [c['name'], 1000.0])),
    hp_pct: Object.fromEntries(squad.map((c) => [c['name'], 100.0])),
    base_stats: Object.fromEntries(squad.map((c) => [c['name'], { hp: 1000.0, atk: 100.0, def: 10.0 }])),
    burst_gauge: 0.0, burst_gauge_charging: true, normal_attack_landed: new Set<string>(),
    ...(state_extra ?? {}),
  };
  const bm = new BuffManager(squad, state);
  return bm;
}

describe('BuffManagerUnitTest', () => {
  it('test_on_attack_count_counts_shots', () => {
    const bm = _bm(['크라운', '루주']);
    const eff = {
      type: 'buff', name: '발사 카운터', trigger: { timing: ['on_attack_count:3'], condition: [] },
      target: 'self', stat: 'atk_pct', polarity: 'beneficial', fixed_value: 10.0, duration: 5,
    };
    bm._effects.push([eff, '크라운']);
    bm._build_notify_index();
    for (let i = 1; i < 7; i++) {
      bm.notify('on_attack', 0.1 * i, '크라운');
    }
    const acts = bm._active.filter((ab) => ab.effect === eff);
    expect(acts.length).toBe(1);   // 3발·6발 — 같은 버프는 갱신된다
    expect(bm._event_counts.get('크라운')!.get('on_attack')).toBe(6);
  });

  it('test_optimal_range_condition_reads_enemy_weapons', () => {
    const bm = _bm(['크라운', '루주'], { enemy: { optimal_range_weapons: ['SR'] } });
    const eff = { trigger: { timing: ['passive'], condition: ['optimal_range'] } };
    expect(bm._condition_ok(['optimal_range'], '루주', 0.0, eff)).toBe(true);
    expect(bm._condition_ok(['optimal_range'], '크라운', 0.0, eff)).toBe(false);
    bm.state['enemy']['optimal_range_weapons'] = [];
    expect(bm._condition_ok(['optimal_range'], '루주', 0.0, eff)).toBe(false);
  });

  it('test_add_burst_gauge_caps_and_respects_window', () => {
    const bm = _bm(['크라운']);
    expect(bm.add_burst_gauge(60.0, 0.0, '크라운', 'weapon')).toBeCloseTo(60.0, 7);
    expect(bm.add_burst_gauge(60.0, 0.1, '크라운', 'weapon')).toBeCloseTo(40.0, 7);   // 초과분 폐기
    expect(bm.state['burst_gauge']).toBeCloseTo(100.0, 7);
    bm.state['burst_gauge'] = 0.0;
    bm.state['burst_gauge_charging'] = false;
    expect(bm.add_burst_gauge(10.0, 0.2, '크라운', 'weapon')).toBe(0.0);
  });

  it('test_charge_speed_reference_switches_after_first_landing', () => {
    const bm = _bm(['크라운']);
    const eff = {
      type: 'buff', name: '버충', trigger: { timing: ['passive'], condition: [] },
      target: 'self', stat: 'burst_charge_speed_pct', polarity: 'beneficial',
      fixed_value: 100.0, duration: -1,
    };
    bm._effects.push([eff, '크라운']);
    bm._build_notify_index();
    bm.battle_start();
    // 명중 전: 발당(0.05) 기준 → 0.05. 명중 뒤: 대상(0.1) 기준 → 0.1
    expect(bm.get_buffs('크라운', '__enemy__', 0.0)['burst_charge_speed_flat']).toBeCloseTo(0.05, 7);
    bm.mark_normal_attack_landed('크라운');
    expect(bm.get_buffs('크라운', '__enemy__', 0.1)['burst_charge_speed_flat']).toBeCloseTo(0.1, 7);
  });

  it('test_pellet_in_shot_thresholds', () => {
    const bm = _bm(['크라운']);
    const eff = {
      type: 'buff', name: '펠릿', trigger: { timing: ['pellet_hit_in_shot:7'], condition: [] },
      target: 'self', stat: 'atk_pct', polarity: 'beneficial', fixed_value: 1.0, duration: 1,
    };
    bm._effects.push([eff, '크라운']);
    bm._build_notify_index();
    expect(bm.pellet_in_shot_thresholds('크라운')).toEqual([[7, '7']]);
    expect(bm.pellet_in_shot_thresholds('없는사람')).toEqual([]);
  });

  it('test_debuff_immune_count_consumes_charges', () => {
    const bm = _bm(['크라운', '루주']);
    const immune = {
      type: 'buff', name: '면역 2회', trigger: { timing: ['passive'], condition: [] },
      target: 'self', stat: 'debuff_immune_count', polarity: 'beneficial',
      fixed_value: 2.0, duration: -1,
    };
    const harm = {
      type: 'buff', name: '약화', trigger: { timing: ['battle_start'], condition: [] },
      target: 'all_allies', stat: 'atk_pct', polarity: 'harmful', fixed_value: -10.0, duration: 30,
    };
    bm._effects.push([immune, '크라운']);
    bm._build_notify_index();
    bm.battle_start();
    for (let i = 0; i < 3; i++) {
      bm._activate(harm, '루주', 0.1 * (i + 1));
    }
    const harmed = bm._active.filter((ab) => ab.effect === harm);
    // 3번 걸었다: 크라운은 2번 막고 3번째에 맞는다(그때 대상 묶음이 달라져 항목이 하나 더 생긴다).
    expect(harmed.filter((ab) => ab.target_chars!.includes('크라운')).length).toBe(1);
    expect(harmed.every((ab) => ab.target_chars!.includes('루주'))).toBe(true);
    // 파이썬 튜플 키 ("크라운", "면역 2회") → TS는 tupleKey 문자열 키
    expect(bm._immune_used.get(tupleKey('크라운', '면역 2회'))).toBe(2.0);
  });

  it('test_max_hp_from_max_hp_pct_snapshots_caster_hp', () => {
    const bm = _bm(['크라운', '루주']);
    const eff = {
      type: 'buff', name: '체력 나눔', trigger: { timing: ['battle_start'], condition: [] },
      target: 'all_allies', stat: 'max_hp_from_max_hp_pct', polarity: 'beneficial',
      fixed_value: 20.0, duration: 10,
    };
    bm._effects.push([eff, '크라운']);
    bm._build_notify_index();
    const before = bm.effective_max_hp('루주');
    bm.battle_start();
    const crown_hp = bm.state['base_stats']['크라운']['hp'];
    expect(bm.effective_max_hp('루주') - before).toBeCloseTo(crown_hp * 0.2, 3);
    // 시전자 자신이 대상이어도 재귀 없이 같은 가산이다.
    expect(bm.effective_max_hp('크라운')).toBeCloseTo(crown_hp * 1.2, 3);
  });
});
