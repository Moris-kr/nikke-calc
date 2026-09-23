/**
 * py: calculator/test_weapon_change_repeat.py
 *
 * 차지형 무기 변경은 **들어올 때마다** 그 모드의 탄창을 받는다.
 *
 * 나유타 `기억 연소`는 버스트마다 10초짜리 RL 모드로 바꾸고 그 모드는 무한 장탄이다
 * (`max_ammo: -1` → 센티널 999999). 그런데 탄창을 싣는 조건이 «차지가 ready인가»뿐이라
 * **첫 버스트에만** 실렸다 — 모드가 duration으로 끝날 때 `_charge_phase`가 "ready"로
 * 되돌지 않아(그 초기화는 `duration_bullets` 종료 경로에만 있다) 두 번째 진입부터는
 * 전부 «차지 중»으로 읽혔기 때문이다.
 *
 * 증상은 화면에서 먼저 보였다: 보스 메이커의 탄창 표시가 첫 버스트에만 ∞였다.
 */
import { describe, expect, it } from 'vitest';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { loadEngineData } from './helpers';

loadEngineData();

// 1·2·3버가 다 있어야 사이클이 돌고 나유타가 여러 번 버스트한다.
const SQUAD = ['리틀 머메이드', '나유타', '마스트 : 로망틱 메이드', '홍련 : 흑영', '리버렐리오'];
// 무한 장탄 모드의 센티널(999999) 언저리. 진짜 탄창은 이만큼 클 수 없다.
const SENTINEL = 99_999;

function _ammo_log(): [Array<{ t: number; ammo: number }>, number[]] {
  const squad = build_squad(SQUAD);
  const cfg = build_config(squad, { duration: 180, rng_mode: 'expected' });
  const result = simulate(squad, cfg, { code: '', core_px: 0 }, true);
  const log = result.log!.ammo_log.filter((entry) => entry.caster === '나유타');
  const bursts = result.log!.burst_log
    .filter((event) => event.caster === '나유타' && event.event.includes('사용'))
    .map((event) => event.t);
  return [log, bursts];
}

describe('WeaponChangeRepeatTest', () => {
  it('test_every_burst_enters_the_mode_with_its_own_magazine', () => {
    const [log, bursts] = _ammo_log();
    expect(bursts.length, '버스트가 여러 번 나와야 시험이 성립한다').toBeGreaterThan(3);

    // 센티널이 찍힌 시각들을 버스트별로 묶는다 — 버스트마다 한 덩어리여야 한다.
    const infinite = log.filter((entry) => entry.ammo >= SENTINEL).map((entry) => entry.t);
    expect(infinite.length).toBeGreaterThan(0);
    const covered = new Set<number | null>();
    for (const t of infinite) {
      const prior = bursts.filter((at) => at <= t);
      covered.add(prior.length > 0 ? Math.max(...prior) : null);
    }
    covered.delete(null);
    // 첫 버스트에만 걸리던 것이 이 시험이 잡는 회귀다.
    expect(covered.size).toBe(bursts.length);
  }, 120_000);

  /**
   * 모드 안에서는 원래 무기의 탄창이 줄지 않는다.
   *
   * 탄창을 못 받으면 RL 모드가 SMG 탄을 대신 깎는다 — 모드가 끝난 뒤 탄이 모자라
   * 엉뚱한 자리에서 재장전이 걸린다.
   */
  it('test_the_mode_does_not_eat_the_normal_magazine', () => {
    const [log, bursts] = _ammo_log();
    const second = bursts[1]!;
    // 두 번째 버스트 뒤 10초(모드 지속) 안에서 찍힌 값은 전부 센티널이어야 한다.
    const during = log
      .filter((entry) => second + 2 <= entry.t && entry.t <= second + 9)
      .map((entry) => entry.ammo);
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((ammo) => ammo >= SENTINEL), JSON.stringify(during.slice(0, 5))).toBe(true);
  }, 120_000);
});
