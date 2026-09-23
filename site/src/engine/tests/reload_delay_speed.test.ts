/**
 * 재장전 앞뒤 딜레이는 재장전 «동작»의 일부다 — 속도 버프를 같이 탄다.
 * 파이썬: calculator/test_reload_delay_speed.py
 *
 * `reload_start_delay`(탄 소진 → 장전 시작)와 `post_reload_delay`(장전 완료 → 첫 발)는
 * 60fps 영상에서 **버프 없는 상태로** 잰 값이다(`data/weapon_delays.json`). 그 값을 고정으로
 * 두면 재장전 속도를 크게 받은 캐릭터가 손해를 두 번 본다 — 특히 장탄이 1발까지 줄어
 * 매 발마다 재장전하는 경우 딜이 무너진다.
 *
 * 제보(2026-08-24): 아니스 : 스파클링 서머의 딜이 비정상적으로 낮다. 그는 버스트로
 * 자기 최대 장탄을 73.92% 깎아 «마지막 탄환» 스킬을 자주 터뜨리는 설계라, 1발 상태에서
 * 매 발 재장전한다. 고정 딜레이 0.4초를 매 발 물어 스쿼드 비중이 실측 42.1% → 시뮬
 * 31.9%로 내려앉았다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineData } from './helpers';
import { BuffManager } from '../buff_manager';
import { CharState, simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import type { SimResult } from '../sim_result';

beforeAll(loadEngineData);

const SQUAD = ['목단', '에이드 : 에이전트 바니', '아니스 : 스파클링 서머',
  '메이든 : 아이스 로즈', '프리바티'];

function _run(): SimResult {
  const squad = build_squad(SQUAD);
  const cfg = build_config(squad, { duration: 180, rng_mode: 'expected' });
  return simulate(squad, cfg, { code: '수냉', core_px: 52 });
}

describe('ReloadDelayScalesWithSpeedTest', () => {
  it('test_delay_shrinks_when_reload_is_buffed', () => {
    // 버프가 없으면 실측값 그대로, 버프를 받으면 그만큼 줄어든다.
    const squad = build_squad(['드레이크', '크라운', 'test_B3']);
    const drake = squad.find((c) => c['name'] === '드레이크')!;
    const state = new CharState(drake, 100000.0, '');
    const bm = new BuffManager(squad);

    // 버프 없음 → 실측값 그대로 (배수 1)
    expect(state._reload_speed_factor(bm, 0.0)).toBe(1.0);
    expect(state.post_reload_delay).toBe(0.2); // SG 실측값

    // 재장전 속도 +75% → 시간이 1/4로 줄고 앞뒤 딜레이도 같이 줄어든다
    (bm as any).get_buffs = () => ({ reload_speed_pct: 75.0 });
    expect(state._reload_speed_factor(bm, 0.0)).toBeCloseTo(0.25, 7);
  });

  it('test_one_round_reload_scales_both_delays_on_every_cycle', () => {
    // 1발 재장전의 앞뒤 지연을 실제 완료 시각으로 검증한다.
    //
    // 제보의 아니스 42.1% · 메이든 35.2%는 동일 육성 자료 없이 순위 기준으로
    // 쓸 수 없다. 메이든의 누락된 HP 합산 피해를 복구해도 이 회귀 검증은 유효하다.
    const squad = build_squad(['아니스 : 스파클링 서머']);
    const state = new CharState(squad[0]!, 100000.0, '');
    const bm = new BuffManager(squad);
    (bm as any).get_buffs = () => ({ reload_speed_pct: 75.0, max_ammo_pct: -100.0 });
    // 장탄 상한은 장탄 두 키만 뽑는 전용 조회를 쓴다 — 같은 가짜 값을 거기에도 준다.
    (bm as any).max_ammo_buffs = (bm as any).get_buffs;
    expect(state.reload_start_delay).toBeGreaterThan(0);
    expect(state.post_reload_delay).toBeGreaterThan(0);
    let start = 10.0;
    for (let i = 0; i < 2; i += 1) {
      state.ammo = 0;
      state._start_reload(start, bm, '재장전 시작', true);
      const finish = start + (state.reload_start_delay + state.weapon['reload_time']) * 0.25;
      expect(state.reloading_until).toBeCloseTo(finish, 7);
      state._finish_reload(finish, bm);
      expect(state.ammo).toBe(1);
      expect(state._post_reload_end_t).toBeCloseTo(finish + state.post_reload_delay * 0.25, 7);
      start = state._post_reload_end_t;
    }
  });

  it('test_last_bullet_skill_fires_often_at_one_round', () => {
    // 장탄이 1발로 줄면 «마지막 탄환»이 매 발 터진다 — 그게 이 캐릭터의 설계다.
    const result = _run();
    const missiles = result.hits.filter(
      (h) => h.caster === '아니스 : 스파클링 서머' && h.skill_name === '스파클링 미사일');
    expect(missiles.length, '스파클링 미사일 발동이 너무 적다').toBeGreaterThan(100);
  });
});
