/**
 * calculator/test_customization.py를 옮긴 것. 테스트 메서드 하나 = `it` 하나.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadEngineData, readJson } from './helpers';
import { PyError } from '../py';
import { BuffManager } from '../buff_manager';
import {
  OPTIMAL_RANGE_WEAPONS, OVERLOAD_FIELDS, WEAPON_TYPES, normalize_character_overrides,
  normalize_element_windows, normalize_immune_windows, normalize_optimal_range,
} from '../customization';
import { charge_end, simulate } from '../timeline';
import { build_config, build_squad, is_preview, _nikke as parsed_nikke } from '../spec';
import { _is_normal } from '../sim_result';
import { calc_damage, default_hit_type } from '../damage';
import { _equip_stat } from '../base_stat';

// 파이썬 `mock.patch.object(timeline, "calc_damage", spy)` 대신 — timeline은 `./damage`에서
// calc_damage를 가져오므로 모듈 단위 모킹으로 같은 호출을 가로챌 수 있다. 평소에는 원본 그대로 부르고,
// `spyState.seen`이 배열일 때만 hit_type(네 번째 위치 인자)을 모은다.
const spyState = vi.hoisted(() => ({ seen: null as Array<Record<string, any>> | null }));
vi.mock('../damage', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../damage')>();
  const orig = mod.calc_damage;
  return {
    ...mod,
    calc_damage: (...args: Parameters<typeof orig>) => {
      if (spyState.seen) spyState.seen.push(args[3] as Record<string, any>);
      return orig(...args);
    },
  };
});

beforeAll(loadEngineData);

/** 파이썬 `assertRaises(ValueError)` (+ `assertRaisesRegex`). */
function expectValueError(fn: () => unknown, pattern?: RegExp | string): void {
  let err: unknown = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err, 'ValueError가 나야 한다').toBeInstanceOf(PyError);
  expect((err as PyError).pyType).toBe('ValueError');
  if (pattern !== undefined) expect((err as PyError).message).toMatch(pattern);
}

const T = 60_000;

describe('CharacterCustomizationTest', () => {
  it('test_weapon_mode_swap_delay_is_normalized_and_validated', () => {
    expect(
      normalize_character_overrides(
        { weaponModeSwapAt: 6 },
        { character_name: '신데렐라 : 크리스탈 웨이브' },
      ),
    ).toEqual({ weapon_mode_swap: true, weapon_mode_swap_at: 6.0 });
    for (const bad of [-0.1, 180.1, true, '6']) {
      expectValueError(() => normalize_character_overrides({ weaponModeSwapAt: bad }));
    }
    expectValueError(() => normalize_character_overrides(
      { weaponModeSwapAt: 6 }, { character_name: '리타' },
    ));
  });

  it('test_legacy_weapon_mode_swap_keeps_zero_second_eligibility', () => {
    const name = '신데렐라 : 크리스탈 웨이브';

    function first_swap(overrides: Record<string, any>): number {
      const squad = build_squad([name], { [name]: overrides });
      const result = simulate(squad, build_config(squad, { duration: 25.0 }), null, true, 1);
      const ev = result.log!.buff_events.find(
        (event) => event.kind === 'activate' && event.caster === name && event.name === '디스트로이',
      );
      // 파이썬 next(...)는 없으면 StopIteration — 여기서는 있어야 한다.
      expect(ev).toBeDefined();
      return ev!.t;
    }

    expect(first_swap({ weapon_mode_swap: true })).toBe(
      first_swap({ weapon_mode_swap: true, weapon_mode_swap_at: 0.0 }),
    );
  }, T);

  it('test_weapon_mode_swap_waits_until_requested_battle_time', () => {
    const name = '신데렐라 : 크리스탈 웨이브';
    const squad = build_squad([name], {
      [name]: { weapon_mode_swap: true, weapon_mode_swap_at: 20.0 },
    });
    const result = simulate(squad, build_config(squad, { duration: 30.0 }), null, true, 1);
    const swaps = result.log!.buff_events.filter(
      (event) => event.kind === 'activate' && event.caster === name && event.name === '디스트로이',
    );
    expect(swaps.length).toBeGreaterThan(0);
    expect(swaps[0]!.t).toBeGreaterThanOrEqual(20.0);
  }, T);

  it('test_all_nine_overload_options_are_browser_safe', () => {
    expect(new Set(Object.keys(OVERLOAD_FIELDS))).toEqual(new Set([
      'atk_pct', 'def_pct', 'element_bonus', 'max_ammo_pct',
      'crit_rate', 'crit_dmg', 'charge_speed_pct',
      'charge_dmg_pct', 'accuracy_pct',
    ]));
    const normalized = normalize_character_overrides({
      overload: Object.fromEntries(Object.keys(OVERLOAD_FIELDS).map((key) => [key, 1])),
    });
    expect(new Set(Object.keys(normalized['equip_skills']))).toEqual(new Set(Object.keys(OVERLOAD_FIELDS)));
  });

  it('test_supported_controls_are_normalized_and_unknown_policies_rejected', () => {
    const raw = {
      control: {
        tap_fire: { rate: 3.6, release: 0.03 },
        reload: { policy: 'before_fb_end', lead: 0.3 },
        hold: { policy: 'own_full_burst', lead: 0.5 },
        cover: { policy: 'own_full_burst' },
      },
    };
    expect(normalize_character_overrides(raw)['_control_override']).toEqual(raw.control);
    expectValueError(() => normalize_character_overrides({
      control: { reload: { policy: 'impossible' } },
    }));
  });

  it('test_every_raw_extra_advantage_has_structured_target_code', () => {
    const raw = readJson<Record<string, any>>('scraper/nikke_scraped.json');
    const parsed = readJson<Record<string, any[]>>('data/parsed_skills.json');
    const expected: Record<string, string> = {};
    for (const [name, character] of Object.entries(raw)) {
      const skills = character['스킬'] || {};
      let sources: any[] = Object.values(skills);
      sources = sources.concat(((character['애장품'] || {})['단계별']) || []);
      for (const source of sources) {
        const template: string = source['template'] ?? '';
        for (const code of ['작열', '수냉', '풍압', '전격', '철갑']) {
          if (template.includes(`${code} 코드 적에게 우월 코드 대미지 적용`)) {
            expected[name] = code;
          }
        }
      }
    }
    const actual: Record<string, string> = {};
    for (const [name, effects] of Object.entries(parsed)) {
      for (const effect of effects) {
        if (effect['stat'] === 'element_code_override') actual[name] = effect['target_code'];
      }
    }
    expect(actual).toEqual(expected);
  });

  it('test_sugar_uses_favorite_item_stage_three_effects', () => {
    const sugar = build_squad(['슈가'], {
      슈가: {
        equip_skills: {
          atk_pct: 0,
          element_bonus: 0,
          max_ammo_pct: 0,
        },
      },
    })[0]!;
    const manager = new BuffManager([sugar], { enemy: { code: '작열' } });
    manager.notify('battle_start', 0, '슈가');
    const start = manager.get_buffs('슈가', '__enemy__', 0);
    // 우월 코드 추가 부여는 버프 집계(get_buffs)가 아니라 전용 경로로 판정한다
    // — `BuffManager.element_override_match` → `CharState.element_match`.
    expect(manager.element_override_match('슈가', '작열')).toBe(true);
    expect(manager.element_override_match('슈가', '수냉')).toBe(false);
    expect(start['atk_dmg_pct']).toBe(19.98);

    manager.notify('full_burst_start', 1, '슈가');
    const full_burst = manager.get_buffs('슈가', '__enemy__', 1);
    expect(full_burst['atk_pct']).toBe(25.01);
    expect(full_burst['max_ammo_pct']).toBe(83.8);
    expect(full_burst['element_bonus_pct']).toBe(59.11);

    manager.notify('burst_cast', 2, '슈가');
    const burst = manager.get_buffs('슈가', '__enemy__', 2);
    expect(burst['attack_speed_pct']).toBe(66);
    expect(burst['atk_pct']).toBeCloseTo(45.01, 7);
    expect(burst['element_bonus_pct']).toBeCloseTo(119.12, 7);
  });

  it('test_extra_element_advantage_is_structured_and_enemy_specific', () => {
    const rapi = build_squad(['라피 : 레드 후드'])[0]!;

    const electric = new BuffManager([rapi], { enemy: { code: '전격' } });
    electric.notify('battle_start', 0, '라피 : 레드 후드');
    expect(electric.element_override_match('라피 : 레드 후드', '전격')).toBe(true);

    const water = new BuffManager([rapi], { enemy: { code: '수냉' } });
    water.notify('battle_start', 0, '라피 : 레드 후드');
    expect(water.element_override_match('라피 : 레드 후드', '수냉')).toBe(false);
  });

  it('test_growth_stage_is_normalized_for_the_engine', () => {
    expect(
      normalize_character_overrides({ growthStage: 6 }, { character_name: '리타' }),
    ).toEqual({ breakthrough: 3, core_enhancement: 3, affinity: 30 });
    expect(
      normalize_character_overrides({ growthStage: 3 }, { character_name: '크라운' })['affinity'],
    ).toBe(40);
  });

  it('test_growth_stage_requires_character_context_and_legal_rarity_range', () => {
    const invalid: Array<[string | null, any]> = [
      [null, 3],
      ['리타', null],
      ['리타', true],
      ['리타', 1.5],
      ['리타', -1],
      ['리타', 11],
      ['라피', 3],
      ['iDoll 플라워', 1],
    ];
    for (const [name, stage] of invalid) {
      expectValueError(() => normalize_character_overrides(
        { growthStage: stage }, { character_name: name },
      ));
    }
  });

  it('test_skill_levels_are_normalized_for_the_engine', () => {
    expect(normalize_character_overrides({
      skillLevels: { 1: 1, 2: 5, 3: 10 },
    })).toEqual({ skill_levels: { 1: 1, 2: 5, 3: 10 } });
  });

  it('test_skill_levels_reject_unknown_keys_and_invalid_values', () => {
    const invalid = [
      { 4: 10 },
      { 1: true },
      { 1: 1.5 },
      { 1: 0 },
      { 1: 11 },
    ];
    for (const skill_levels of invalid) {
      expectValueError(() => normalize_character_overrides({ skillLevels: skill_levels }));
    }
  });

  it('test_released_skill_level_selects_the_parsed_effect_value', () => {
    const values: number[] = [];
    for (const level of [1, 10]) {
      const squad = build_squad(['리타'], {
        리타: { skill_levels: { 1: level, 2: 10, 3: 10 } },
      });
      const manager = new BuffManager(squad, { enemy: {} });
      manager.notify('burst_cast', 0, '리타');
      values.push(manager.get_buffs('리타', '__enemy__', 0)['max_ammo_pct']);
    }

    expect(values).toEqual([7.05, 45.17]);
  });

  it('test_preview_skill_levels_are_fixed_at_ten', (ctx) => {
    // 프리뷰(출시 전 카드) 캐릭터는 레벨 10 계수만 존재한다. 명단은 출시될 때마다
    // 비므로 이름을 박지 않고 현재 등록된 프리뷰에서 고른다 — 비어 있으면 검사할
    // 대상 자체가 없는 정상 상태다.
    const previews = Object.keys(parsed_nikke()).filter((name) => is_preview(name));
    if (!previews.length) {
      ctx.skip('등록된 프리뷰 캐릭터가 없다 (전원 정식 출시)');
      return;
    }
    const preview = previews[0]!;

    const allowed = build_squad([preview], {
      [preview]: { skill_levels: { 1: 10, 2: 10, 3: 10 } },
    })[0]!;
    expect(allowed['skill_levels']).toEqual({ 1: 10, 2: 10, 3: 10 });

    expectValueError(() => build_squad([preview], {
      [preview]: { skill_levels: { 1: 9, 2: 10, 3: 10 } },
    }), '프리뷰 캐릭터는 스킬 레벨 10');
  });

  it('test_overload_values_replace_resolved_defaults', () => {
    const over = normalize_character_overrides({
      overload: {
        element_bonus: 10,
        atk_pct: 3,
        max_ammo_pct: 4,
        crit_rate: 5,
        crit_dmg: 6,
      },
    });

    const char = build_squad(['미하라 : 본딩 체인'], {
      '미하라 : 본딩 체인': over,
    })[0]!;

    expect(char['equip_skills']['element_bonus']).toBe(10);
    expect(char['equip_skills']['atk_pct']).toBe(3);
    expect(char['equip_skills']['max_ammo_pct']).toBe(4);
    expect(char['equip_skills']['crit_rate']).toBe(5);
    expect(char['equip_skills']['crit_dmg']).toBe(6);
  });

  it('test_stacked_max_ammo_reductions_never_drop_magazine_below_one', () => {
    // 프리바티 `EX 매거진 3`은 풀버스트마다 전원 최대 장탄 -50.66%를,
    // 아니스 : 스파클링 서머 `스파클링 웨이브`는 자기 버스트 사이클에 자신
    // 최대 장탄 -73.92%를 건다. 둘이 겹치는 아니스의 버스트 사이클에는 합이
    // -124.58%가 되어 실효 최대 장탄이 `round(5 × -0.2458) = -1`로 음수가 됐고,
    // 재장전이 채우는 장탄이 음수라 `_tick_auto`가 발사 없이 재장전만 반복해
    // 아니스가 자기 버스트 내내 한 발도 못 쐈다. 게임에선 최대 장탄이 최소 1발로
    // 유지되므로, 어떤 캐릭터의 실효 장탄도 음수가 되면 안 된다.
    const members = ['아니스 : 스파클링 서머', '프리바티', '네온 : 비전 아이', '목단', '민트'];
    const squad = build_squad(members);
    const config = build_config(squad, { first_burst_time: 3.0 });
    const result = simulate(squad, config, null, true, 1);

    const ammo = result.log!.ammo_log.map((entry) => entry.ammo);
    expect(ammo.length).toBeGreaterThan(0); // 파이썬 min()은 비면 ValueError
    const min_ammo = Math.min(...ammo);
    expect(min_ammo, '실효 최대 장탄이 음수로 내려갔다 (스톨)').toBeGreaterThanOrEqual(0);
  }, T);

  it('test_split_cube_is_accepted_and_applies_split_damage', () => {
    expect(
      normalize_character_overrides({ cube: { name: '렐릭 디바이드 큐브', level: 15 } }),
    ).toEqual({ cube: { name: '렐릭 디바이드 큐브', level: 15 } });
    const squad = build_squad(['브래디'], { 브래디: { cube: { name: '렐릭 디바이드 큐브', level: 15 } } });
    const manager = new BuffManager(squad, { enemy: {} });
    manager.notify('battle_start', 0, '브래디');
    const buffs = manager.get_buffs('브래디', '__enemy__', 0);
    expect(buffs['split_dmg_pct']).toBeCloseTo(17.69, 2);
  });

  it('test_equip_levels_map_to_per_part_equipment', () => {
    expect(normalize_character_overrides({
      equipLevels: { 머리: 5, 몸통: 3, 팔: 0, 다리: 5 },
    })).toEqual({
      equipment: {
        머리: { level: 5 }, 몸통: { level: 3 },
        팔: { level: 0 }, 다리: { level: 5 },
      },
    });
    for (const bad of [{ 머리: 6 }, { 머리: -1 }, { 머리: 1.5 }, { 머리: true }, { 등: 5 }]) {
      expectValueError(() => normalize_character_overrides({ equipLevels: bad }));
    }
  });

  it('test_burst_assignment_is_normalized_and_validated', () => {
    expect(
      normalize_character_overrides({ burst: { mode: 'priority', every: 3 } }),
    ).toEqual({ _burst_assignment: { mode: 'priority', every: 3 } });
    // every 기본값은 1
    expect(
      normalize_character_overrides({ burst: { mode: 'priority' } }),
    ).toEqual({ _burst_assignment: { mode: 'priority', every: 1 } });
    expect(
      normalize_character_overrides({ burst: { mode: 'skip' } }),
    ).toEqual({ _burst_assignment: { mode: 'skip' } });
    for (const bad of [
      { mode: 'always' },
      { mode: 'priority', every: 0 },
      { mode: 'priority', every: 1.5 },
      { mode: 'priority', every: true },
    ]) {
      expectValueError(() => normalize_character_overrides({ burst: bad }));
    }
  });

  it('test_manual_damage_stat_applies_only_to_its_character', () => {
    const squad = build_squad(['리타', '라피'], {
      리타: { manual_stats: { split_dmg_pct: 20 } },
    });
    const manager = new BuffManager(squad, { enemy: {} });
    manager.notify('battle_start', 0, '리타');
    manager.notify('battle_start', 0, '라피');

    expect(manager.get_buffs('리타', '__enemy__', 0)['split_dmg_pct']).toBe(20);
    expect(manager.get_buffs('라피', '__enemy__', 0)['split_dmg_pct']).toBe(0);
  });

  it('test_personal_enemy_modifiers_do_not_leak_to_teammates', () => {
    const squad = build_squad(['리타', '라피'], {
      리타: {
        manual_stats: {
          received_dmg_pct: 12,
          enemy_def_down_pct: 7,
        },
      },
    });
    const manager = new BuffManager(squad, { enemy: {} });
    manager.notify('battle_start', 0, '리타');
    manager.notify('battle_start', 0, '라피');

    const rita = manager.get_buffs('리타', '__enemy__', 0);
    const rapi = manager.get_buffs('라피', '__enemy__', 0);
    expect(rita['received_dmg']).toBe(12);
    expect(rita['enemy_def_down_pct']).toBe(-7);
    expect(rapi['received_dmg']).toBe(0);
    expect(rapi['enemy_def_down_pct']).toBe(0);
  });

  it('test_part_cube_routes_its_value_to_part_damage', () => {
    const squad = build_squad(['리타'], {
      리타: { cube: { name: '렐릭 디스트로이 큐브', level: 15 } },
    });
    const manager = new BuffManager(squad, { enemy: {} });
    manager.notify('battle_start', 0, '리타');

    expect(manager.get_buffs('리타', '__enemy__', 0)['part_dmg_pct']).toBe(31.9);
  });

  it('test_ammo_cube_triggers_every_tenth_hit_not_at_battle_start', () => {
    const squad = build_squad(['리타'], {
      리타: { cube: { name: '택티컬 베어 큐브', level: 15 } },
    });
    const manager = new BuffManager(squad, { enemy: {} });
    const events: Array<[string, number]> = [];
    manager.register_instant_handler(
      'ammo_charge_flat',
      (_eff: any, caster: string, _t: number, value: number) => { events.push([caster, value]); },
    );

    manager.notify('battle_start', 0, '리타');
    expect(events).toEqual([]);
    for (let hit = 1; hit < 10; hit++) {
      manager.notify('hit_count', hit / 10, '리타');
    }
    expect(events).toEqual([]);
    manager.notify('hit_count', 1, '리타');
    expect(events).toEqual([['리타', 3.0]]);
  });

  it('test_manual_ammo_recovery_uses_the_same_tenth_hit_semantics', () => {
    const squad = build_squad(['리타'], {
      리타: { manual_stats: { ammo_charge_flat: 8 } },
    });
    const manager = new BuffManager(squad, { enemy: {} });
    const events: number[] = [];
    manager.register_instant_handler(
      'ammo_charge_flat',
      (_eff: any, _caster: string, _t: number, value: number) => { events.push(value); },
    );

    manager.notify('battle_start', 0, '리타');
    for (let hit = 0; hit < 10; hit++) {
      manager.notify('hit_count', hit / 10, '리타');
    }
    expect(events).toEqual([8.0]);
  });

  it('test_nayuta_burst_mode_shots_do_not_eat_bullet_buffs', () => {
    // 나유타 `기억 연소` 사격은 스킬 대미지라 발수 소모 버프를 먹지 않는다.
    //
    // 미란다 `웨이크업! 4`는 `duration_bullets: 1`이라 한 발만 쏘면 사라진다.
    // 변신 사격이 일반 공격으로 잡히던 때는 변신 첫 발이 이걸 먹어 버렸다
    // (유저 인게임 확인 — GAMEPLAY.md §무기 메카닉).
    const deck = ['아니스 : 스타', '나유타', '미란다', '홍련 : 흑영', '리버렐리오'];
    // 미란다 버프는 자신 제외 공격력 1위에게 간다 — 나유타가 받도록 올린다.
    const squad = build_squad(deck, { 나유타: { equip_skills: { atk_pct: 300.0 } } });
    const result = simulate(
      squad, build_config(squad, { duration: 60, first_burst_time: 3.0 }),
      { def: 31_784, code: '', core_px: 52, has_parts: false },
      true, 42,
    );
    const events = result.log!.buff_events.filter((e) => e.name.startsWith('웨이크업! 4'));
    const grants = events.filter((e) => e.kind === 'activate' && e.target === '나유타');
    const expiries = events.filter((e) => e.kind === 'expire');
    expect(grants.length, '나유타가 `웨이크업! 4`를 받아야 한다').toBeGreaterThan(0);

    const first = grants[0]!;
    const after = expiries.filter((e) => e.t >= first.t);
    expect(after.length, '만료 이벤트가 있어야 한다').toBeGreaterThan(0);
    // 변신은 10초다. 첫 발에 먹혔다면 1초 안에 사라진다.
    expect(
      after[0]!.t - first.t,
      '변신 사격이 발수 버프를 먹었다 — 스킬 대미지 예외가 풀렸다',
    ).toBeGreaterThan(5.0);

    // 변신 사격은 `기본 공격`이 아니라 모드 이름으로 잡힌다.
    const modes = new Set(result.hits.filter((h) => h.caster === '나유타').map((h) => h.skill_name));
    expect(modes.has('기억 연소')).toBe(true);

    // 발사 태그(`full_charge_hit`)를 그대로 달고 있어도 평타로 새면 안 된다 —
    // 집계는 이름을 우선해야 한다.
    const mode_hits = result.hits.filter((h) => h.caster === '나유타' && h.skill_name === '기억 연소');
    expect(mode_hits.length).toBeGreaterThan(0);
    expect(mode_hits.some((h) => _is_normal(h))).toBe(false);
  }, T);

  it('test_weapon_mode_skill_drops_normal_atk_bonus_but_keeps_core_and_charge', () => {
    // 모드 스킬 사격의 항목별 처리 (유저 실측 대조 — GAMEPLAY.md §무기 메카닉).
    //
    // ① 「일반 공격 대미지 ▲」만 빠지고, ③ 코어와 ④ 차지 대미지는 그대로 붙는다.
    const weapon = { damage_coeff: 275.18, core_dmg_mult: 200.0, full_charge_mult: 250.0 };
    const buffs = { normal_atk_dmg_pct: 9.46, charge_dmg_pct: 87.05, core_dmg_pct: 0.0 };
    const common = { is_core: true, is_full_charge: true };

    function dmg(ht: Record<string, any>): number {
      // expected=True로 고정 — 치명타 판정이 난수라 그대로 두면 비교가 흔들린다.
      return calc_damage(100_000, buffs, weapon, default_hit_type(ht), 0, true).damage;
    }

    const as_normal = dmg({ is_normal_atk: true, ...common });
    const as_mode = dmg({ is_normal_atk: false, is_weapon_mode_skill: true, ...common });

    // 차이는 ① 일반 공격 대미지 9.46%뿐 — ④ 차지는 양쪽 다 받는다.
    expect(as_normal / as_mode).toBeCloseTo(1.0946, 4);

    // ③ 코어는 남아 있어야 한다 — 같은 모드 사격에서 코어만 끄면 줄어든다.
    const body_hit = dmg({
      is_normal_atk: false, is_weapon_mode_skill: true,
      is_core: false, is_full_charge: true,
    });
    expect(as_mode).toBeGreaterThan(body_hit);
  });

  it('test_charge_multiplier_is_additive', () => {
    // ④는 풀차지 배율 + 차지 대미지 버프 — 곱이 아니다 (인게임 335% 확인).
    //
    // 곱연산이면 차지 무기 전체가 부푼다: 250 × 1.8705 = 468%.
    const weapon = { damage_coeff: 100.0, core_dmg_mult: 200.0, full_charge_mult: 250.0 };
    // expected=True로 고정한다 — 치명타 판정이 난수라 그대로 두면 ①이 흔들린다.
    const hit_type = default_hit_type({ is_full_charge: true });

    const plain = calc_damage(100_000, {}, weapon, hit_type, 0, true).damage;
    const buffed = calc_damage(100_000, { charge_dmg_pct: 87.05 }, weapon, hit_type, 0, true).damage;

    // 2.50 → 3.3705 (가산). 곱연산이면 4.68이 된다.
    expect(buffed / plain).toBeCloseTo(3.3705 / 2.50, 4);
  });

  it('test_projectile_explosion_follows_base_weapon', () => {
    // 「투사체 폭발 대미지 ▲」는 모드 무기가 아니라 기본 무기로 판정한다 (유저 확인).
    //
    // 나유타는 기본 SMG라 RL 모드로 변신해도 못 받는다. 같은 스쿼드의 아니스 : 스타는
    // 기본이 RL이라 받는다 — 이 대비가 곧 규칙이다 (GAMEPLAY.md §무기 메카닉).
    expect(readJson<Record<string, any>>('data/parsed_nikke.json')['나유타']['weapon_type']).toBe('SMG');

    // 파이썬 `mock.patch.object(tl, "calc_damage", spy)` → 맨 위 vi.mock의 spyState (같은 hit_type을 모은다).
    const seen: Array<Record<string, any>> = [];
    const squad = build_squad(['아니스 : 스타', '나유타', '벨벳', '홍련 : 흑영', '리버렐리오']);
    spyState.seen = seen;
    try {
      simulate(
        squad, build_config(squad, { duration: 60, first_burst_time: 3.0 }),
        { def: 31_784, code: '', core_px: 52, has_parts: false },
        false, 42,
      );
    } finally {
      spyState.seen = null;
    }

    const mode_shots = seen.filter((h) => h['is_weapon_mode_skill']);
    expect(mode_shots.length, '나유타 모드 사격이 있어야 한다').toBeGreaterThan(0);
    expect(
      mode_shots.some((h) => h['is_projectile_explosion']),
      '기본 무기가 SMG인데 RL 모드라고 투사체 폭발이 붙었다',
    ).toBe(false);
    // 대조: 기본이 RL인 사격은 그대로 받는다.
    expect(seen.some((h) => h['is_projectile_explosion'])).toBe(true);
  }, T);

  it('test_other_weapon_change_modes_stay_normal_attacks', () => {
    // 예외는 나유타뿐이다 — 표시 없는 모드는 종전대로 일반 공격으로 잡힌다.
    const squad = build_squad(['라플라스']);
    const result = simulate(
      squad, build_config(squad, { duration: 60, first_burst_time: 3.0 }),
      { def: 31_784, code: '', core_px: 52, has_parts: false },
      false, 42,
    );
    const modes = new Set(result.hits.filter((h) => h.caster === '라플라스').map((h) => h.skill_name));
    expect(modes.has('기본 공격')).toBe(true);
    expect(modes.has('라플라스 버스터')).toBe(false);
  }, T);

  it('test_optimal_range_is_normalized_and_validated', () => {
    // 적정거리 무기군 — 정본 순서로 세우고, 모르는 무기군은 막는다.

    // 정본은 data/weapon_mechanics.json이고 순서가 곧 인게임 표기 순서다.
    expect([...WEAPON_TYPES]).toEqual(['AR', 'SMG', 'SG', 'MG', 'SR', 'RL']);

    expect(normalize_optimal_range(null)).toEqual([]);
    expect(normalize_optimal_range([])).toEqual([]);
    // 고른 순서가 달라도 같은 설정이라 정본 순서로 세운다 (캐시 키가 갈리지 않게).
    expect(normalize_optimal_range(['SR', 'AR', 'SG'])).toEqual(['AR', 'SG', 'SR']);
    expect(normalize_optimal_range(['SMG', 'SMG'])).toEqual(['SMG']);

    expectValueError(() => normalize_optimal_range(['활']));
    expectValueError(() => normalize_optimal_range('SMG'));
  });

  it('test_launchers_have_no_optimal_range', () => {
    // 런처는 인게임에 적정 사거리가 없다 (유저 확인, 2026-08-31).
    //
    // 정본은 `data/weapon_mechanics.json`의 `optimal_range`다 — 화면의 체크박스
    // 목록도 같은 값에서 나온다. 오래된 공유 코드에 RL이 들어 있을 수 있으므로
    // **오류로 막지 않고 조용히 뺀다**: 막으면 옛 설정을 아예 열지 못한다.
    const table = readJson<Record<string, any>>('data/weapon_mechanics.json')['weapon_type_defaults'];
    expect(table['RL']['optimal_range']).toBe(false);
    expect([...OPTIMAL_RANGE_WEAPONS]).toEqual(['AR', 'SMG', 'SG', 'MG', 'SR']);

    expect(normalize_optimal_range(['RL'])).toEqual([]);
    expect(normalize_optimal_range(['RL', 'SMG'])).toEqual(['SMG']);
  });

  it('test_optimal_range_lifts_only_that_weapon_and_only_normal_attacks', () => {
    // 적정거리는 ③에 +30% **가산**이고 일반 공격에만 붙는다.
    //
    // 곱연산이 아니라 가산이라, 크리·풀버스트가 이미 들어간 합에서는 실제
    // 상승폭이 30%보다 작다 — 그 성질까지 함께 잠근다.
    const weapon = { damage_coeff: 100.0, core_dmg_mult: 200.0 };
    const dmg = (hit_type: Record<string, any>) => calc_damage(100_000, {}, weapon, hit_type, 0, true).damage;

    const off = dmg(default_hit_type());
    const on = dmg(default_hit_type({ is_optimal_range: true }));
    // 크리 기대값이 섞인 ③ 합에 0.3이 더해진다 — 곱이면 정확히 1.30이었을 것이다.
    expect(on).toBeGreaterThan(off);
    expect(on / off).toBeLessThan(1.30);

    // 스킬 대미지(is_normal_atk=False)에는 안 붙는다.
    const skill_off = dmg(default_hit_type({ is_normal_atk: false }));
    const skill_on = dmg(default_hit_type({ is_normal_atk: false, is_optimal_range: true }));
    expect(skill_on).toBe(skill_off);
  });

  it('test_equip_accepts_tier_as_well_as_enhancement_level', () => {
    // 장비 세 갈래 — 미장착 · 일반 T1~T9 · 기업 강화 0~5.
    //
    // 미장착을 «강화 0»으로 적으면 안 낀 부위가 플랫 스탯을 얻어 딜이 부푼다
    // (4부위 전부 미장착일 때 실측 +11.5%). 프로필 동기화가 이 셋을 구분해 보낸다.
    const got = normalize_character_overrides(
      { equipLevels: { 머리: 5, 몸통: 'T9', 팔: '없음', 다리: 0 } },
      { character_name: '라피' },
    )['equipment'];
    expect(got).toEqual({
      머리: { level: 5 }, 몸통: { tier: 'T9' },
      팔: { tier: '없음' }, 다리: { level: 0 },
    });

    for (const bad of ['T0', 'T10', 'T99', '기업', '']) {
      expectValueError(() => normalize_character_overrides(
        { equipLevels: { 머리: bad } }, { character_name: '라피' }));
    }
  });

  it('test_unequipped_is_not_the_same_as_enhancement_zero', () => {
    // 미장착(0)과 기업 강화0(플랫 스탯 있음)은 다른 값이어야 한다.
    const empty = _equip_stat('화력형', '머리', { tier: '없음' });
    const zero = _equip_stat('화력형', '머리', { level: 0 });
    expect(empty['atk']).toBe(0.0);
    expect(zero['atk']).toBeGreaterThan(0.0);
  });

  it('test_phase_windows_are_validated', () => {
    // 족자·속저 구간 검증. 뒤집힌 구간을 조용히 바로잡지 않는다.
    expect(normalize_immune_windows(null)).toEqual([]);
    expect(normalize_immune_windows([{ from: 10, to: 30 }])).toEqual([[10.0, 30.0]]);
    expect(
      normalize_element_windows([{ from: 100, to: 102, code: '풍압' }]),
    ).toEqual([{ from: 100.0, to: 102.0, code: '풍압' }]);

    for (const bad of [[{ from: 30, to: 10 }], [{ from: 0, to: 200 }], [{ from: 5 }]]) {
      expectValueError(() => normalize_immune_windows(bad));
    }
    expectValueError(() => normalize_element_windows([{ from: 1, to: 2, code: '불' }]));
  });

  it('test_immune_window_makes_only_normal_attacks_miss_and_element_window_gates_it', () => {
    // 족자는 평타만 빗나가고, 속저는 우월 코드만 통과시킨다.
    const deck = ['라피', '나유타', '리타', '크라운', '앨리스']; // 라피·앨리스가 작열
    const squad = build_squad(deck);
    const cfg = build_config(squad, { duration: 60, first_burst_time: 3.0 });
    const enemy = { def: 31_784, code: '', core_px: 0, has_parts: false };

    const plain = simulate(squad, cfg, enemy, false, 42);
    const immune = simulate(squad, cfg, { ...enemy, immune_windows: [[10, 30]] }, false, 42);
    const gated = simulate(squad, cfg, {
      ...enemy, element_windows: [{ from: 10, to: 30, code: '풍압' }],
    }, false, 42);

    // 족자 구간에는 평타만 빠지고 스킬 대미지는 남아야 한다.
    const immune_hits = immune.hits.filter((h) => h.t >= 10 && h.t < 30);
    expect(immune_hits.length).toBeGreaterThan(0);
    expect(immune_hits.some((h) => _is_normal(h))).toBe(false);
    expect(immune.squad_total).toBeLessThan(plain.squad_total);

    // 속저 구간에는 풍압에 우월한 작열만 남는다.
    const casters = new Set(gated.hits.filter((h) => h.t >= 10 && h.t < 30).map((h) => h.caster));
    expect(casters).toEqual(new Set(['라피', '앨리스']));
  }, T);

  it('test_immune_window_keeps_existing_damage_over_time', () => {
    // 족자가 시작돼도 이미 걸린 레이븐 `쇼크웨이브`의 틱은 계속 들어간다.
    const squad = build_squad(['레이븐', '크라운', 'test_B3']);
    const result = simulate(
      squad,
      build_config(squad, {
        first_burst_time: 1, duration: 20, rng_mode: 'expected',
      }),
      {
        def: 31_784, code: '', core_px: 0, has_parts: false,
        immune_windows: [[5, 15]],
      },
      false, 1,
    );

    const ticks = result.hits.filter(
      (h) => h.t >= 5 && h.t < 15 && h.caster === '레이븐' && h.skill_name === '쇼크웨이브',
    );
    expect(ticks.length, '족자 구간에서 지속 대미지가 사라졌다').toBeGreaterThan(0);
  }, T);

  it('test_immune_window_keeps_attacks_triggered_by_a_normal_attack', () => {
    // 평타는 빗나가도 헤비암즈의 `오토 파이어` 후속 공격은 적중한다.
    const name = '스노우 화이트 : 헤비암즈';
    const squad = build_squad(['리틀 머메이드', '크라운', name]);
    const result = simulate(
      squad,
      build_config(squad, {
        duration: 30, first_burst_time: 3.0, rng_mode: 'expected',
      }),
      {
        def: 31_784, code: '', core_px: 0, has_parts: false,
        immune_windows: [[5, 20]],
      },
      false, 42,
    );

    const hits = result.hits.filter((h) => h.t >= 5 && h.t < 20 && h.caster === name);
    expect(hits.some((h) => _is_normal(h))).toBe(false);
    const skill_names = new Set(hits.map((h) => h.skill_name));
    expect(skill_names.has('오토 파이어 1')).toBe(true);
    expect(skill_names.has('오토 파이어 2')).toBe(true);
  }, T);

  it('test_element_window_also_honors_override_buffs', () => {
    // 속저는 인게임처럼 **우월 코드 버프까지 인정한다** (유저 확인).
    //
    // 라피 : 레드 후드는 로스터가 작열이라 전격에는 우월하지 않지만,
    // `부착형 유탄`이 전격 적에게도 우월을 붙여 준다 — 그 버프로 통과해야 한다.
    const deck = ['라피 : 레드 후드', '나유타', '리타', '크라운', '앨리스'];
    const squad = build_squad(deck);
    const result = simulate(
      squad, build_config(squad, { duration: 60, first_burst_time: 3.0 }),
      {
        def: 31_784, code: '전격', core_px: 0, has_parts: false,
        element_windows: [{ from: 10, to: 40, code: '전격' }],
      },
      false, 42);

    const casters = new Set(result.hits.filter((h) => h.t >= 10 && h.t < 40).map((h) => h.caster));
    // 철갑(리타·크라운)은 로스터 상성으로 통과한다.
    expect(casters.has('리타')).toBe(true);
    expect(casters.has('크라운')).toBe(true);
    // 작열인데도 버프 덕에 통과한다 — 로스터 코드만 봤다면 빠졌을 캐릭터다.
    expect(casters.has('라피 : 레드 후드')).toBe(true);
    // 풍압·작열은 전격에 우월하지 않고 버프도 없다.
    expect(casters.has('나유타')).toBe(false);
    expect(casters.has('앨리스')).toBe(false);
  }, T);

  it('test_immune_window_can_also_stop_burst_charging', () => {
    // 족자 중에는 평타가 빗나가니 게이지도 안 찬다 — 옵션이다.

    // 충전이 족자에 걸리면 그 구간만큼 밀린다.
    expect(charge_end(0.0, 2.0, [])).toBe(2.0);
    expect(charge_end(0.0, 2.0, [[10, 30]])).toBe(2.0); // 구간 전에 완충
    expect(charge_end(9.0, 2.0, [[10, 30]])).toBe(31.0); // 1초 채우고 멈춤
    expect(charge_end(15.0, 2.0, [[10, 30]])).toBe(32.0); // 구간 안에서 시작

    const deck = ['라피', '나유타', '리타', '크라운', '앨리스'];
    const squad = build_squad(deck);
    const enemy = {
      def: 31_784, code: '', core_px: 0, has_parts: false,
      immune_windows: [[10, 40]],
    };
    // 기본은 **켜짐**(인게임 기준) — 끄면 족자 중에도 충전이 이어진다.
    const keep = simulate(squad, build_config(
      squad, { duration: 120, immune_blocks_burst: false }), enemy, false, 42);
    const stop = simulate(squad, build_config(squad, { duration: 120 }), enemy, false, 42);
    // 충전이 멈추면 버스트가 밀려 딜이 더 줄어든다.
    expect(stop.squad_total).toBeLessThan(keep.squad_total);

    // 족자가 없으면 이 옵션은 결과를 바꾸지 않는다 — 종전 스냅샷이 안 흔들리는 이유다.
    const plain = { def: 31_784, code: '', core_px: 0, has_parts: false };
    const on = simulate(squad, build_config(squad, { duration: 60 }), plain, false, 42);
    const off = simulate(squad, build_config(
      squad, { duration: 60, immune_blocks_burst: false }), plain, false, 42);
    expect(on.squad_total).toBe(off.squad_total);
  }, T);
});
