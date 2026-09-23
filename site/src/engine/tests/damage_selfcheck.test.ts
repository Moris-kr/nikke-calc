/**
 * 대미지 공식 검산 — 파이썬 `calculator/damage.py` 하단 `__main__` 블록(CI가 `python calculator/damage.py`로
 * 돌리던 수작업 검산)을 옮긴 것. 허용 오차도 원본 그대로(|차| < 1, 검산 4-B는 < 0.01).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENEMY_DEF, _factor4, calc_damage_avg, default_hit_type } from '../damage';

// 버프 없는 기본 상태 (buff_manager._BUFFS_ZERO 모방)
const zero_buffs: Record<string, any> = {
  atk_pct: 0.0, atk_flat: 0.0, def_ignore_pct: 0.0,
  crit_rate: 0.15, crit_dmg: 0.0, core_dmg_pct: 0.0,
  atk_dmg_pct: 0.0, burst_dmg_pct: 0.0, pierce_dmg_pct: 0.0,
  dot_dmg_pct: 0.0, armor_break_dmg_pct: 0.0,
  projectile_explosion_dmg: 0.0, projectile_attachment_dmg: 0.0,
  sequential_dmg_pct: 0.0,
  charge_dmg_pct: 0.0, charge_dmg_mag_pct: 0.0,
  received_dmg: 0.0, split_dmg_pct: 0.0,
  element_bonus_pct: 0.0, is_element_match: false,
  def_pct: 0.0, charge_speed_pct: 0.0, max_ammo_pct: 0.0,
  accuracy_pct: 0.0, normal_atk_dmg_pct: 0.0, reload_speed_pct: 0.0,
  part_dmg_pct: 0.0, burst_dmg_aoe_pct: 0.0,
};

// 라피 AR 기본 스펙 (parsed_nikke.json 값 대신 임시값)
const weapon_ar = { weapon_type: 'AR', damage_coeff: 13.65, core_dmg_mult: 200.0 };
const weapon_sr = { weapon_type: 'SR', damage_coeff: 50.0, core_dmg_mult: 200.0, full_charge_mult: 250.0 };
const base_atk = 50000; // 임의 공격력
const near = (a: number, b: number, tol = 1.0) => expect(Math.abs(a - b), `불일치: ${a} vs ${b}`).toBeLessThan(tol);

describe('대미지 공식 검산 (damage.py __main__)', () => {
  it('검산 1 — 버프 없음, 평균', () => {
    // 수작업: (13.65/100) × (50000 - 31784) × (1 + 0.15×0.5)
    near(calc_damage_avg(base_atk, zero_buffs, weapon_ar, null, DEFAULT_ENEMY_DEF),
      (13.65 / 100) * (50000 - 31784) * (1 + 0.15 * 0.5));
  });

  it('검산 2 — atk +100%', () => {
    const b = { ...zero_buffs, atk_pct: 100.0 };
    near(calc_damage_avg(base_atk, b, weapon_ar, null, DEFAULT_ENEMY_DEF),
      (13.65 / 100) * (50000 * 2.0 - 31784) * (1 + 0.15 * 0.5));
  });

  it('검산 3 — 코어 히트, 크리 없음', () => {
    const b = { ...zero_buffs, crit_rate: 0.0 };
    // f3 = 1.0 + 1.0(core 200% → +100% 추가분) + 0(crit) = 2.0
    near(calc_damage_avg(base_atk, b, weapon_ar, default_hit_type({ is_core: true }), DEFAULT_ENEMY_DEF),
      (13.65 / 100) * (50000 - 31784) * 2.0);
  });

  it('검산 4 — SR 풀 차지 250%', () => {
    const b = { ...zero_buffs, crit_rate: 0.0 };
    near(calc_damage_avg(base_atk, b, weapon_sr, default_hit_type({ is_full_charge: true }), DEFAULT_ENEMY_DEF),
      (50.0 / 100) * (50000 - 31784) * 1.0 * 2.5);
  });

  it('검산 4-B — 차지 대미지 배율 층, 헬름 인게임 표기 재현 (2026-08-28 유저 확인)', () => {
    // 기본 250% · 오버로드 평문 11.11% · 소장품 SR15 배율 9.47% · 버스트 배율 158.4%
    const ht4 = default_hit_type({ is_full_charge: true });
    for (const [mag, ingame] of [[9.47, 284.785], [9.47 + 158.4, 680.785]] as const) {
      const b = { ...zero_buffs, charge_dmg_pct: 11.11, charge_dmg_mag_pct: mag };
      near(_factor4(weapon_sr, b, ht4) * 100, ingame, 0.01);
    }
  });

  it('검산 5 — 풀버스트 + 우월코드', () => {
    const b = { ...zero_buffs, crit_rate: 0.0, is_element_match: true, element_bonus_pct: 10.0 };
    // f3=1.5, f7=1.2(10%+10%)
    near(calc_damage_avg(base_atk, b, weapon_ar, default_hit_type({ is_full_burst: true }), DEFAULT_ENEMY_DEF),
      (13.65 / 100) * (50000 - 31784) * 1.5 * 1.0 * 1.0 * 1.2);
  });

  it('검산 6 — core_damage 스킬은 일반 공격이 아니어도 코어 배율, 표식이 없으면 미적용', () => {
    const b = { ...zero_buffs, crit_rate: 0.0, core_dmg_pct: 26.0 };
    const ht6 = default_hit_type({ is_normal_atk: false, is_core: true, is_core_damage: true, coeff: 833.79 });
    // f3 = 1.0 + (200-100)/100 + 26/100 = 2.26
    near(calc_damage_avg(base_atk, b, weapon_ar, ht6, DEFAULT_ENEMY_DEF), (833.79 / 100) * (50000 - 31784) * 2.26);
    const ht6b = default_hit_type({ is_normal_atk: false, is_core: true, coeff: 833.79 });
    near(calc_damage_avg(base_atk, b, weapon_ar, ht6b, DEFAULT_ENEMY_DEF), (833.79 / 100) * (50000 - 31784) * 1.0);
  });

  it('검산 7 — part_dmg_pct는 is_part 히트에만 ⑤로 가산', () => {
    const b = { ...zero_buffs, crit_rate: 0.0, part_dmg_pct: 26.21 };
    near(calc_damage_avg(base_atk, b, weapon_ar, default_hit_type({ is_normal_atk: false, is_part: true, coeff: 1189.66 }), DEFAULT_ENEMY_DEF),
      (1189.66 / 100) * (50000 - 31784) * (1.0 + 26.21 / 100));
    near(calc_damage_avg(base_atk, b, weapon_ar, default_hit_type({ is_normal_atk: false, coeff: 1189.66 }), DEFAULT_ENEMY_DEF),
      (1189.66 / 100) * (50000 - 31784));
  });

  it('검산 8 — burst_dmg_aoe_pct는 «적 전체» 버스트에만 (트리나 뻗은 뿌리)', () => {
    const b = { ...zero_buffs, crit_rate: 0.0, burst_dmg_pct: 50.0, burst_dmg_aoe_pct: 435.6 };
    const base8 = (13.65 / 100) * (50000 - 31784);
    near(calc_damage_avg(base_atk, b, weapon_ar, default_hit_type({ is_normal_atk: false, is_burst_damage: true, is_aoe_burst: true }), DEFAULT_ENEMY_DEF),
      base8 * (1 + 0.5 + 4.356));
    // 단일 대상 버스트 — aoe 미적용
    near(calc_damage_avg(base_atk, b, weapon_ar, default_hit_type({ is_normal_atk: false, is_burst_damage: true }), DEFAULT_ENEMY_DEF),
      base8 * 1.5);
    // bonus_damage 취급(is_burst_damage 아님) — 둘 다 미적용
    near(calc_damage_avg(base_atk, b, weapon_ar, default_hit_type({ is_normal_atk: false, is_aoe_burst: true }), DEFAULT_ENEMY_DEF),
      base8);
  });
});
