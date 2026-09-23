// py: calculator/test_tap_burst_charge.py
/*
 * 버충 톡톡이 — `tap_fire.policy = "burst_charge"`.
 *
 * 풀버스트 **밖**(버스트 게이지를 채우는 구간)에서만 톡톡이하고, 풀버스트 동안은 평소처럼
 * 풀차지를 든다. 실제 조작은 «풀버스트가 끝나면 재장전 → 다음 풀버스트까지 톡톡이 →
 * 풀버스트에는 풀차지»가 한 세트다(피드백 2026-09-22). 정본: context/CONTROL.md §톡톡이.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { _normalize_control } from '../customization';
import { PyError } from '../py';
import { loadEngineData } from './helpers';

const SQUAD = ['미란다', '에이다', '아인', '타키나', '홍련'];
const TAP_ALWAYS: Record<string, any> = { tap_fire: { rate: 3.6, release: 0.03 } };
const TAP_BURST: Record<string, any> = { tap_fire: { rate: 3.6, release: 0.03, policy: 'burst_charge' } };

function _run(control: Record<string, any>, duration = 45): any {
  const squad = build_squad(SQUAD, { '아인': { control } }, null, new Set(['아인']));
  const cfg = build_config(squad, { duration, rng_mode: 'expected' });
  return simulate(squad, cfg, { code: '', core_px: 0 }, true);
}

/** 풀버스트 [시작, 끝) 구간들 — 버스트 로그의 시작/종료 짝. */
function _fb_windows(result: any): Array<[number, number]> {
  const windows: Array<[number, number]> = [];
  let start: number | null = null;
  for (const e of result.log.burst_log) {
    if (e.event === 'full_burst 시작') {
      start = e.t;
    } else if (e.event === 'full_burst 종료' && start !== null) {
      windows.push([start, e.t]);
      start = null;
    }
  }
  if (start !== null) {
    windows.push([start, Infinity]);
  }
  return windows;
}

function _basic_shots(result: any): any[] {
  return result.hits.filter((h: any) => h.caster === '아인' && h.skill_name === '기본 공격');
}

/** 아인의 평타 발수를 풀버스트 안/밖으로 갈라 센다. */
function _shots(result: any, inside_fb: boolean): number {
  const windows = _fb_windows(result);
  const in_fb = (t: number) => windows.some(([a, b]) => a <= t && t < b);
  return _basic_shots(result).filter((h) => in_fb(h.t) === inside_fb).length;
}

function _expectValueError(fn: () => unknown): void {
  let err: unknown = null;
  try { fn(); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(PyError);
  expect((err as PyError).pyType).toBe('ValueError');
}

beforeAll(loadEngineData);

describe('TapBurstChargeTest', () => {
  it('test_taps_outside_full_burst_but_charges_inside', () => {
    const always = _run({ ...TAP_ALWAYS });
    const burst = _run({ ...TAP_BURST });
    // 풀버스트 밖에서는 둘 다 톡톡이 — 발수가 비슷하다(재장전 타이밍만 다르다).
    // 풀버스트 안에서는 버충 톡톡이가 풀차지를 들므로 «항상 톡톡이»보다 훨씬 덜 쏜다.
    expect(_shots(burst, true)).toBeLessThan(_shots(always, true));
    expect(_shots(burst, false)).toBeGreaterThan(0);
    expect(burst.char_total['아인']).not.toBe(always.char_total['아인']);
  }, 120_000);

  it('test_taps_before_first_full_burst', () => {
    // 첫 풀버스트 **전**도 버충 구간이다 — 전투 시작부터 톡톡이한다(확인 2026-09-22).
    //
    // 고정 게이지(fixed)와 실누적(accumulate) 어느 쪽이든 첫 풀버스트 전 발수가
    // «항상 톡톡이»와 같고, 컨트롤 없음보다 많아야 한다.
    for (const mode of ['fixed', 'accumulate']) {
      // subTest(mode=mode)
      const run = (control: Record<string, any>): any => {
        const squad = build_squad(SQUAD, { '아인': { control } }, null, new Set(['아인']));
        const cfg = build_config(squad, { duration: 45, rng_mode: 'expected', burst_gauge_mode: mode });
        return simulate(squad, cfg, { code: '', core_px: 0 }, true);
      };

      const before_first_fb = (result: any): number => {
        const windows = _fb_windows(result);
        const first = windows.length > 0 ? windows[0]![0] : Infinity;
        return _basic_shots(result).filter((h) => h.t < first).length;
      };

      const plain = run({}), always = run({ ...TAP_ALWAYS }), burst = run({ ...TAP_BURST });
      expect(before_first_fb(burst), mode).toBe(before_first_fb(always));
      expect(before_first_fb(burst), mode).toBeGreaterThan(before_first_fb(plain));
    }
  }, 240_000);

  it('test_first_shot_after_reload_is_full_charge', () => {
    // 풀버스트 끝 → 재장전 → **풀차지 한 발** → 톡톡이 (피드백 2026-09-22, 프리카).
    //
    // 톡톡이는 논차지라 `풀 차지 공격 시` 버프가 풀버스트와 함께 끊긴다. 실제 조작은 재장전한
    // 뒤 한 발을 풀차지로 쏴 버프를 되살리고 톡톡이한다. 기본 켬이고 끌 수 있다.
    const first_shots_after_reload = (result: any): string[] => {
      const reload_done: number[] = result.log.reload_log
        .filter((e: any) => e.caster === '아인' && e.event.includes('완료')).map((e: any) => e.t);
      const shots = _basic_shots(result);
      const tags: string[] = [];
      for (const [, end] of _fb_windows(result)) {
        if (end === Infinity) {
          continue;
        }
        const done = reload_done.find((t) => t >= end);
        if (done === undefined) {
          continue;
        }
        const first = shots.find((h) => h.t >= done);
        if (first !== undefined) {
          tags.push(first.hit_tag);
        }
      }
      return tags;
    };

    const on = first_shots_after_reload(_run({ ...TAP_BURST }));
    expect(on.length > 0).toBe(true);
    expect(on.every((tag) => tag.includes('full_charge_hit')), JSON.stringify(on)).toBe(true);
    const off = first_shots_after_reload(
      _run({ tap_fire: { ...TAP_BURST['tap_fire'], full_charge_after_reload: false } }));
    expect(off.length > 0).toBe(true);
    expect(off.every((tag) => !tag.includes('full_charge_hit')), JSON.stringify(off)).toBe(true);
  }, 120_000);

  it('test_full_charge_after_reload_must_be_bool', () => {
    const good = _normalize_control({ tap_fire: { ...TAP_BURST['tap_fire'], full_charge_after_reload: false } });
    expect(good['tap_fire']['full_charge_after_reload']).toBe(false);
    _expectValueError(() =>
      _normalize_control({ tap_fire: { ...TAP_BURST['tap_fire'], full_charge_after_reload: 'yes' } }));
  });

  it('test_differs_from_no_control_too', () => {
    const plain = _run({});
    const burst = _run({ ...TAP_BURST });
    // 컨트롤이 없으면 내내 풀차지라 발수가 훨씬 적다.
    expect(_basic_shots(burst).length).toBeGreaterThan(_basic_shots(plain).length);
  }, 120_000);

  it('test_reloads_when_full_burst_ends', () => {
    const burst = _run({ ...TAP_BURST });
    const labels = burst.log.reload_log.filter((e: any) => e.caster === '아인').map((e: any) => e.event);
    expect(labels).toContain('엄폐 시작(버충 톡톡이 재장전)');
    // 끄면 그 엄폐는 없다.
    const off = _run({ tap_fire: { ...TAP_BURST['tap_fire'], reload_at_end: false } });
    expect(off.log.reload_log.filter((e: any) => e.caster === '아인').map((e: any) => e.event))
      .not.toContain('엄폐 시작(버충 톡톡이 재장전)');
  }, 120_000);
});
