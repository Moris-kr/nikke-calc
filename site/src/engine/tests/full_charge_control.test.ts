/**
 * 풀차징컨(`control.full_charge`) — 직접 조작으로 풀차지를 쏘고 다음 차지를 누르기까지의 딜레이를 사람이 정한다.
 * 그리고 무기 변경 모드의 첫 차지 지연(`weapon_delays._weapon_change[…].start_delay`).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineData, raisesPy } from './helpers';
import { CharState, _resolve_cameras, simulate } from '../timeline';
import { build_squad } from '../spec';
import { FULL_CHARGE_DELAY_DEFAULT, _normalize_control as normalize_control } from '../customization';

beforeAll(loadEngineData);

const withControl = (name: string, control: Record<string, unknown>) => {
  const squad = build_squad([name]);
  squad[0]!['control'] = control;
  return squad;
};

describe('풀차징컨', () => {
  it('차지 무기의 사격 후 딜레이를 정한 값으로 바꾸고, 기본은 0.1초다', () => {
    const auto = new CharState(build_squad(['헬름'])[0]!, 100000, '');
    expect(auto.post_fire_delay).toBe(0.38);
    const manual = new CharState(withControl('헬름', { full_charge: { delay: 0.1 } })[0]!, 100000, '');
    expect(manual.post_fire_delay).toBe(0.1);
    expect(normalize_control({ full_charge: {} })).toEqual({ full_charge: { delay: FULL_CHARGE_DELAY_DEFAULT } });
    expect(FULL_CHARGE_DELAY_DEFAULT).toBe(0.1);
  });

  it('딜레이가 짧으면 같은 시간에 더 많이 쏜다', () => {
    const shots = (control: Record<string, unknown> | null) => {
      const squad = control ? withControl('헬름', control) : build_squad(['헬름']);
      return simulate(squad, { duration: 30, rng_mode: 'expected' }, { def: 0, code: '' }).hits
        .filter((h) => h.core_frac != null).length;
    };
    expect(shots({ full_charge: { delay: 0.1 } })).toBeGreaterThan(shots(null));
    expect(shots({ full_charge: { delay: 0.38 } })).toBe(shots(null));
  });

  it('검증 — delay만, 0~3초, 톡톡이와 함께 켤 수 없다', () => {
    expect(raisesPy(() => normalize_control({ full_charge: { delay: 5 } }))).toBe(true);
    expect(raisesPy(() => normalize_control({ full_charge: { rate: 1 } }))).toBe(true);
    expect(raisesPy(() => normalize_control({ full_charge: { delay: 0.1 }, tap_fire: { rate: 4.4 } }))).toBe(true);
  });

  it('직접 조작이라 메인(카메라)이 되고, 덱에 둘은 켤 수 없다', () => {
    const squad = build_squad(['크라운', '라피 : 레드 후드', '길티 : 마이티 바니', '신 : 스위프트 바니', '헬름']);
    const byName = (n: string) => squad.find((c) => c['name'] === n)!;
    byName('헬름')['control'] = { full_charge: { delay: 0.1 } };
    const slot = squad.map((c) => c['name']);
    expect(_resolve_cameras(squad, { _slot_order: slot })).toEqual(new Set(['헬름']));
    byName('신 : 스위프트 바니')['control'] = { full_charge: { delay: 0.2 } };
    expect(raisesPy(() => _resolve_cameras(squad, { _slot_order: slot }))).toBe(true);
  });
});

describe('무기 변경 첫 차지 지연', () => {
  it('신 : 스위프트 바니의 스위프트 피어싱은 5초에 9발이다(영상 실측)', () => {
    // 버스트는 1·2단계가 있어야 돈다 — 시험용 B1·B2를 앞에 세운다.
    const squad = build_squad(['test_B1', 'test_B2', '신 : 스위프트 바니']);
    const result = simulate(squad, { duration: 60, rng_mode: 'expected', first_burst_time: 3, burst_gauge_mode: 'fixed', burst_regen_time: 2 },
      { def: 0, code: '' }, true);
    const casts = (result.log?.burst_log ?? []).filter((b) => b.caster === '신 : 스위프트 바니' && b.event.startsWith('stage'));
    expect(casts.length).toBeGreaterThan(0);
    const t0 = casts[0]!.t;
    const mode = result.hits.filter((h) => h.caster === '신 : 스위프트 바니' && h.core_frac != null
      && h.t > t0 && h.t <= t0 + 5.05);
    expect(mode.length).toBe(9);
    expect(mode[0]!.t - t0).toBeCloseTo(0.8, 1);
  });
});
