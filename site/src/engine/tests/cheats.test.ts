/**
 * calculator/test_cheats.py 이식.
 *
 * 핵(`calculator/cheats.py`)이 켠 만큼만 바꾸는지.
 *
 * 핵은 계산기의 약속을 일부러 깨뜨리는 물건이라, **끄면 흔적이 없어야** 한다는 것이
 * 가장 중요한 성질이다. 켰을 때 얼마나 세지는지보다 그쪽을 먼저 지킨다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DMG_MULT_MAX, from_config } from '../cheats';
import { PyError, truthy } from '../py';
import type { SimResult } from '../sim_result';
import { build_config, build_squad } from '../spec';
import { simulate } from '../timeline';
import { loadEngineData } from './helpers';

beforeAll(loadEngineData);

/** 파이썬 `assertRaises(ValueError)`. py.ts의 변환 오류(`ValueError: ...` 메시지의 Error)도 받는다. */
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

// 리틀 머메이드가 있어야 「아군 탄 소비 N발마다」가 걸린다 — 무한 장탄이 그 카운터를
// 멈추지 않는지 보려면 이 사람이 필요하다.
const SQUAD = ['리틀 머메이드', '나유타', '마스트 : 로망틱 메이드', '홍련 : 흑영', '리버렐리오'];

function _run(cheats: Record<string, any> | null = null, duration = 60.0): SimResult {
  const squad = build_squad(SQUAD);
  const extra = truthy(cheats) ? { cheats } : {};
  const cfg = build_config(squad, { duration, rng_mode: 'expected', ...extra });
  return simulate(squad, cfg, { code: '', core_px: 0 }, true);
}

describe('CheatsOffTest', () => {
  it('test_nothing_changes_when_nothing_is_on', () => {
    const plain = _run().squad_total;
    for (const empty of [{}, { damage_mult: 1.0 }, { always_crit: false }]) {
      expect(_run(empty).squad_total, JSON.stringify(empty)).toBe(plain);
    }
  });
});

describe('CheatsOnTest', () => {
  it('test_damage_mult_multiplies', () => {
    const plain = _run().squad_total;
    // 배수는 히트마다 곱해지고 히트마다 정수로 떨어지므로, 합계는 «거의» 열 배다
    // (마지막 자리의 반올림 차이까지 같기를 요구하면 시험이 거짓말이 된다).
    expect(_run({ damage_mult: 10.0 }).squad_total / plain).toBeCloseTo(10.0, 4);
  });

  it('test_always_crit_raises_damage', () => {
    const plain = _run().squad_total;
    expect(_run({ always_crit: true }).squad_total).toBeGreaterThan(plain * 1.1);
  });

  it('test_infinite_ammo_removes_reloads_but_keeps_consumption', () => {
    const plain = _run();
    const hacked = _run({ infinite_ammo: true });
    expect(plain.log!.reload_log.length).toBeGreaterThan(0);
    expect(hacked.log!.reload_log.length).toBe(0);
    // 탄창이 안 비는 것이지 «탄을 안 쓰는» 것이 아니다. 「아군 탄 소비 500발마다」로
    // 사는 리틀 머메이드의 `거품 난사`가 멈추면 그 구분이 무너진 것이다.
    const bubbles = (result: SimResult): number =>
      result.hits.filter((h) => h.skill_name === '거품 난사').length;
    expect(bubbles(plain)).toBeGreaterThan(0);
    expect(bubbles(hacked)).toBeGreaterThanOrEqual(bubbles(plain));
    // 아무도 손해 보지 않는다 — 「핵인데 딜이 줄었다」는 화면에서 고장으로 읽힌다.
    for (const [name, before] of Object.entries(plain.char_total)) {
      expect(hacked.char_total[name], name).toBeGreaterThanOrEqual(before);
    }
  });

  it('test_burst_charge_fires_more_full_bursts', () => {
    // 게이지도 쿨도 0 — 풀버스트 사이클 자체가 늘어난다.
    //
    // 게이지만 0으로 두면 사이클 수는 그대로이고 전체가 몇 초 당겨질 뿐이다.
    // 그건 핵이라 부를 만한 것이 아니라서 쿨타임까지 함께 없앤다.
    const cycles = (result: SimResult): number =>
      result.log!.burst_log.filter((e) => e.event.includes('full_burst 종료')).length;
    const plain = _run(null, 180.0);
    const hacked = _run({ burst_charge: true }, 180.0);
    expect(cycles(hacked)).toBeGreaterThan(cycles(plain));
    expect(hacked.squad_total).toBeGreaterThan(plain.squad_total * 1.2);
  });

  it('test_first_burst_comes_at_once', () => {
    // 충전 시간 0이면 첫 버스트도 기다리지 않는다.
    const first = (result: SimResult): number =>
      Math.min(...result.log!.burst_log.filter((e) => e.event.includes('사용')).map((e) => e.t));
    expect(first(_run({ burst_charge: true }))).toBeLessThan(first(_run()));
  });
});

describe('CheatsConfigTest', () => {
  it('test_reads_config', () => {
    const cheats = from_config({ cheats: { always_crit: true, damage_mult: 2.5 } });
    expect(cheats.on).toBe(true);
    expect(cheats.always_crit).toBe(true);
    expect(cheats.damage_mult).toBe(2.5);
    expect(cheats.burst_charge).toBe(false);
  });

  it('test_no_config_is_no_cheats', () => {
    for (const empty of [null, {}, { cheats: null }, { cheats: {} }]) {
      expect(from_config(empty).on, JSON.stringify(empty)).toBe(false);
    }
  });

  it('test_bad_multiplier_is_refused', () => {
    for (const bad of [0.0, -1.0, DMG_MULT_MAX + 1, Infinity]) {
      expectValueError(() => from_config({ cheats: { damage_mult: bad } }));
    }
  });
});
