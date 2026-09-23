// py: calculator/test_roster_batch01.py
import { describe, expect, it } from 'vitest';
import { BuffManager } from '../buff_manager';
import { calc_base_stats } from '../base_stat';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { get, item } from '../py';
import { almostEqual, loadEngineData } from './helpers';

loadEngineData();

describe('RosterBatch01MechanicsTest', () => {
  it('test_aid_attack_buff_starts_only_after_crossing_below_ninety_percent_hp', () => {
    const squad = build_squad(['에이드']);
    const base: any = calc_base_stats(squad[0]!);
    const state: any = {
      enemy: {},
      base_stats: { '에이드': base },
      hp: { '에이드': Number(base.hp) },
      hp_pct: { '에이드': 100.0 },
      stacks: { '에이드': {} },
      gauges: { '에이드': {} },
    };
    const manager = new BuffManager(squad, state);
    manager.notify('battle_start', 0.0, '에이드');
    expect(item(manager.get_buffs('에이드', '__enemy__', 0.0), 'atk_flat')).toBe(0.0);

    state.hp['에이드'] = base.hp * 0.89;
    manager.sync_hp('에이드');

    expect(item(manager.get_buffs('에이드', '__enemy__', 0.0), 'atk_flat')).toBeGreaterThan(0.0);
  });

  it('test_each_squad_burst_cast_notifies_winter_rupee', () => {
    const members = ['루피 : 윈터 쇼퍼', '리틀 머메이드', '크라운', 'test_B3', '스노우 화이트 : 헤비암즈'];
    const squad = build_squad(members);
    const config = build_config(squad, { first_burst_time: 1.0, duration: 12.0 });

    const result = simulate(squad, config, null, true, 1);

    const shopping = result.log!.buff_events.filter(
      (event: any) => event.kind === 'activate' && event.name === '쇼핑',
    );
    const vip = result.log!.buff_events.filter(
      (event: any) => event.kind === 'activate' && event.name === 'VIP 기프트',
    );
    expect(shopping.length).toBeGreaterThanOrEqual(4);
    expect(vip.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('test_mary_uses_separate_full_burst_and_personal_cast_counters', () => {
    const squad = build_squad(['메어리 : 베이 갓데스']);
    const manager = new BuffManager(squad, { enemy: {} });
    for (const t of [1.0, 2.0, 3.0]) {
      manager.notify('burst_cast', t, '메어리 : 베이 갓데스');
    }

    const buffs = manager.get_buffs('메어리 : 베이 갓데스', '__enemy__', 3.0);
    expect(almostEqual(item(buffs, 'element_bonus_pct'), 43.09, 2)).toBe(true);
    const names = new Set(manager._active.map((ab: any) => get(ab.effect, 'name')));
    expect(names.has('해변의 햇살')).toBe(false);
  });

  it('test_vesti_burst_and_full_charge_damage_activate_without_partner_states', () => {
    const members = ['리틀 머메이드', '크라운', '베스티 : 택티컬 업', 'test_B3'];
    const squad = build_squad(members);
    const config = build_config(squad, { first_burst_time: 1.0, duration: 8.0 });
    const result = simulate(squad, config, null, true, 1);

    const skill_names = new Set(
      result.hits.filter((hit: any) => hit.caster === '베스티 : 택티컬 업').map((hit: any) => hit.skill_name),
    );
    const buff_names = new Set(
      result.log!.buff_events
        .filter((event: any) => event.kind === 'activate' && event.caster === '베스티 : 택티컬 업')
        .map((event: any) => event.name),
    );
    expect(skill_names.has('몬스터 스테이지')).toBe(true);
    expect(skill_names.has('미사일 컨테이너 온라인 3')).toBe(true);
    expect(buff_names.has('몬스터 스테이지 2')).toBe(false);
    expect(buff_names.has('몬스터 스테이지 3')).toBe(false);
  }, 60_000);

  it('test_crust_hold_sequence_reaches_blanching_mode', () => {
    const members = ['리틀 머메이드', '크러스트', 'test_B3', '스노우 화이트 : 헤비암즈'];
    const control = {
      sequence: [
        { t: 0.0, action: 'hold', until: 2.2 },
        { t: 2.3, action: 'hold', until: 4.9 },
        { t: 5.0, action: 'hold', until: 7.6 },
      ],
    };
    const squad = build_squad(members, { '크러스트': { control } });
    const config = build_config(squad, { duration: 9.0 });
    const result = simulate(squad, config, null, true, 1);

    const names = new Set(
      result.log!.buff_events
        .filter((event: any) => event.kind === 'activate' && event.caster === '크러스트')
        .map((event: any) => event.name),
    );
    expect(names.has('블렌칭')).toBe(true);
    expect(names.has('든든한 요리')).toBe(true);
  }, 60_000);

  it('test_multi_hit_threshold_matches_a_single_attack_with_enough_hits', () => {
    const squad = build_squad(['프리바티 : 언카인드 메이드']);
    const manager = new BuffManager(squad, { enemy: {} });

    manager.notify('multi_hit:10', 1.0, '프리바티 : 언카인드 메이드');

    const buffs = manager.get_buffs('프리바티 : 언카인드 메이드', '__enemy__', 1.0);
    expect(almostEqual(item(buffs, 'reload_speed_pct'), 20.88)).toBe(true);
  });

  it('test_shotgun_timeline_emits_multi_hit_for_each_attack', () => {
    const squad = build_squad(['프리바티 : 언카인드 메이드']);
    const config = build_config(squad, { duration: 2.0 });

    const result = simulate(squad, config, null, true, 1);

    const activations = result.log!.buff_events.filter(
      (event: any) => event.kind === 'activate' && event.name === '사랑 가득 메이드',
    );
    expect(activations.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('test_non_full_charge_counter_activates_crust_mode_and_missing_buff_target', () => {
    const squad = build_squad(['크러스트', '리타']);
    const manager = new BuffManager(squad, { enemy: {} });

    for (const t of [1.0, 2.0, 3.0]) {
      manager.notify('non_full_charge_hit', t, '크러스트');
    }

    const liter = manager.get_buffs('리타', '__enemy__', 3.0);
    expect(manager._has_self_state('크러스트', '마이야르')).toBe(true);
    expect(item(liter, 'def_caster_based_pct')).toBeGreaterThan(0.0);
  });

  it('test_charge_hold_counter_exposes_threshold_and_activates_blanching', () => {
    const squad = build_squad(['크러스트']);
    const manager = new BuffManager(squad, { enemy: {} });
    expect(manager.charge_hold_thresholds('크러스트')).toEqual([[1.0, '1']]);

    for (const t of [1.0, 2.0, 3.0]) {
      manager.notify('charge_hold:1', t, '크러스트');
    }

    expect(manager._has_self_state('크러스트', '블렌칭')).toBe(true);
  });

  it('test_tia_cover_heal_dispatches_cover_healed_event', () => {
    const members = ['티아', '리틀 머메이드', '크라운', 'test_B3', '스노우 화이트 : 헤비암즈'];
    const squad = build_squad(members);
    const config = build_config(squad, { first_burst_time: 1.0, duration: 4.0 });

    const result = simulate(squad, config, null, true, 1);

    const names = new Set(
      result.log!.buff_events
        .filter((event: any) => event.kind === 'activate' && event.caster === '티아')
        .map((event: any) => event.name),
    );
    expect(names.has('파충류 애호가')).toBe(true);
    expect(names.has('파충류 애호가 2')).toBe(true);
  }, 60_000);

  it('test_neon_bonus_damage_is_limited_to_fire_code_enemy', () => {
    const members = ['리틀 머메이드', '크라운', '네온 : 블루 오션', 'test_B3'];
    const counts: number[] = [];
    for (const code of ['작열', '수냉']) {
      const squad = build_squad(members);
      const config = build_config(squad, { first_burst_time: 1.0, duration: 8.0 });
      const result = simulate(squad, config, { code }, false, 1);
      counts.push(
        result.hits.filter(
          (hit: any) => hit.caster === '네온 : 블루 오션' && hit.skill_name === '풀 하이드로 샷 2',
        ).length,
      );
    }
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBe(0);
  }, 60_000);

  it('test_signal_burst_damage_and_following_defense_debuff_both_activate', () => {
    const members = ['리틀 머메이드', '시그널', 'test_B3', '스노우 화이트 : 헤비암즈'];
    const squad = build_squad(members);
    const config = build_config(squad, { first_burst_time: 1.0, duration: 5.0 });
    const result = simulate(squad, config, null, true, 1);

    expect(
      result.hits.some((hit: any) => hit.caster === '시그널' && hit.skill_name === '이머전시 시그널'),
    ).toBe(true);
    expect(
      result.log!.buff_events.some(
        (event: any) => event.kind === 'activate' && event.name === '이머전시 시그널 2',
      ),
    ).toBe(true);
  }, 60_000);

  it('test_poli_favorite_chain_consumes_badge_and_starts_heal', () => {
    const members = ['리틀 머메이드', '폴리', '크라운', 'test_B3', '스노우 화이트 : 헤비암즈'];
    const squad = build_squad(members, { '폴리': { favorite_stage: 3 } });
    const config = build_config(squad, { first_burst_time: 1.0, duration: 22.0 });
    const result = simulate(squad, config, null, true, 1);

    const buff_names = new Set(
      result.log!.buff_events
        .filter((event: any) => event.kind === 'activate' && event.caster === '폴리')
        .map((event: any) => event.name),
    );
    const instant_names = new Set(
      result.log!.instant_events
        .filter((event: any) => event.caster === '폴리')
        .map((event: any) => event.name),
    );
    expect(buff_names.has('폴리스 뱃지')).toBe(true);
    expect(buff_names.has('폴리스 라인 폴리스 뱃지 불굴')).toBe(true);
    expect(buff_names.has('도그 테라피')).toBe(true);
    expect(instant_names.has('폴리스 뱃지 제거')).toBe(true);
    expect(instant_names.has('도그 테라피 3')).toBe(true);
  }, 60_000);
});
