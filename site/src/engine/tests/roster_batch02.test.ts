// py: calculator/test_roster_batch02.py
import { describe, expect, it } from 'vitest';
import { BuffManager } from '../buff_manager';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { get, item } from '../py';
import { loadEngineData, readJson } from './helpers';

loadEngineData();

const BATCH = [
  '키리', 'D', 'K', '미카 : 스노우 버디', '브리드',
  '솔린', '디젤', '엠마', '베스티', '은화',
];

// 파이썬은 부를 때마다 파일을 새로 읽는다 — 테스트가 고치지 않으므로 한 번만 읽어 둔다.
let _skills_cache: Record<string, any[]> | null = null;
function _skills(): Record<string, any[]> {
  if (!_skills_cache) _skills_cache = readJson('data/parsed_skills.json');
  return _skills_cache!;
}

function _find(
  name: string,
  { stat, effect_name, favorite }: { stat?: string; effect_name?: string; favorite?: number } = {},
): any[] {
  const effects = item(_skills(), name) as any[];
  return effects.filter(
    (effect) =>
      (stat === undefined || get(effect, 'stat') === stat) &&
      (effect_name === undefined || get(effect, 'name') === effect_name) &&
      (favorite === undefined || get(effect, 'favorite') === favorite),
  );
}

function test_batch02_all_ten_are_registered(): void {
  const skills = _skills();
  expect(BATCH.every((name) => name in skills)).toBe(true);
  expect(Object.keys(skills).filter((name) => !name.startsWith('test_')).length).toBeGreaterThanOrEqual(106);
}

function test_kiri_full_charge_and_defender_support_are_preserved(): void {
  expect(_find('키리', { stat: 'atk_caster_based_pct', effect_name: '곁눈질' }).length).toBeGreaterThan(0);
  expect(_find('키리', { stat: 'max_hp_pct', effect_name: '훑어보기' })[0].target).toBe('allies_class:방어');
  expect(_find('키리', { stat: 'heal_hp_pct', effect_name: '꿰뚫어보기' })[0].tick_interval).toBe(1.0);
}

function test_d_target_spawn_and_fullburst_extension_are_preserved(): void {
  const gauge = _find('D', { stat: 'burst_' + 'charge_pct', effect_name: '기습' })[0];
  expect(gauge.trigger.timing).toEqual(['event:target_spawn']);
  const extension = _find('D', { stat: 'fullburst_duration', effect_name: '처단 3' })[0];
  expect(extension.fixed_value).toBe(5.04);
  expect(extension.trigger.condition).toContain('self_state:기절 면역');
}

function test_target_spawn_is_emitted_once_at_battle_start(): void {
  const manager = new BuffManager(build_squad(['D']), { enemy: {} });
  manager.battle_start();

  expect(manager._has_self_state('D', '기절 면역')).toBe(true);
  expect(manager._event_counts.get('D')!.get('event:target_spawn')).toBe(1);
}

function test_k_weapon_change_and_scale_cleanup_are_preserved(): void {
  const weapon = _skills()['K']!.filter((e: any) => get(e, 'type') === 'weapon_change')[0];
  expect(weapon.pellets).toBe(10);
  expect(weapon.damage_coeff['10']).toBe(92.5);
  expect(_find('K', { stat: 'remove_named_buff', effect_name: '기울어지는 천칭 제거' }).length).toBeGreaterThan(0);
}

function test_mica_stack_extension_and_dispel_are_preserved(): void {
  expect(_find('미카 : 스노우 버디', { stat: 'buff_' + 'max_stack_add', effect_name: '응원의 축포' }).length).toBeGreaterThan(0);
  expect(_find('미카 : 스노우 버디', { stat: 'debuff_cleanse', effect_name: '설온제' }).length).toBeGreaterThan(0);
}

function test_brid_hidden_cooldown_and_full_hp_bonus_are_preserved(): void {
  const leak = _find('브리드', { stat: 'damage', effect_name: '리크' })[0];
  expect(leak.trigger.timing).toEqual(['every:10s']);
  expect(_find('브리드', { stat: 'bonus_damage', effect_name: 'AZX 2' })[0].trigger.condition).toContain('self_hp_max');
}

function test_soline_full_hp_passive_and_burst_bonus_are_preserved(): void {
  expect(_find('솔린', { stat: 'crit_rate', effect_name: '어른스럽게!' })[0].duration).toBe(-1);
  expect(_find('솔린', { stat: 'bonus_damage', effect_name: '나도 한다면 해! 2' })[0].trigger.condition).toContain('self_hp_max');
}

function test_diesel_all_favorite_replacements_are_preserved(): void {
  expect(_find('디젤', { stat: 'pierce_dmg_pct', effect_name: '딸기 사탕의 힘 3', favorite: 1 }).length).toBeGreaterThan(0);
  expect(_find('디젤', { stat: 'max_hp_only_pct', effect_name: '스트로베리 쇼크 2', favorite: 2 }).length).toBeGreaterThan(0);
  expect(_find('디젤', { stat: 'buff_' + 'max_stack_add', effect_name: '딸기향 이끌림 3', favorite: 3 }).length).toBeGreaterThan(0);
}

function test_emma_received_hit_probability_and_heals_are_preserved(): void {
  const cheer = _find('엠마', { stat: 'heal_hp_pct', effect_name: '치어리딩' })[0];
  expect(cheer.trigger.timing).toEqual(['received_hit_count:1']);
  expect(cheer.trigger.condition).toEqual(['prob:5']);
  expect(_find('엠마', { stat: 'lifesteal_pct', effect_name: '알트루이즘 2' }).length).toBeGreaterThan(0);
}

function test_vesti_three_burst_layers_and_container_are_preserved(): void {
  const effects = _skills()['베스티']!;
  const timings = new Set(effects.filter((e: any) => e.name.startsWith('생존본능')).map((e: any) => e.trigger.timing[0]));
  for (const need of ['burst_cast_count:1', 'burst_cast_count:2', 'burst_cast_count:3']) {
    expect(timings.has(need)).toBe(true);
  }
  const container = _find('베스티', { stat: 'auto_damage', effect_name: '미사일 컨테이너' })[0];
  expect(container.tick_interval === 1.0 && container.duration === 18.0).toBe(true);
}

function test_eunhwa_last_bullet_round_limited_buffs_are_preserved(): void {
  const stance = _find('은화', { stat: 'charge_dmg_pct', effect_name: '준비 태세' })[0];
  expect(stance.trigger.timing).toEqual(['last_bullet_fire']);
  expect(stance.duration_bullets).toBe(2);
  expect(_find('은화', { stat: 'def_pct', effect_name: '약점 간파' })[0].polarity).toBe('harmful');
}

function _check_character_runs_in_a_valid_squad(name: string, members: string[]): void {
  const squad = build_squad(members);
  const result = simulate(squad, build_config(squad, { first_burst_time: 1.0, duration: 8.0 }), null, false, 1);

  expect(result.hits.some((hit: any) => hit.caster === name)).toBe(true);
}

describe('RosterBatch02Test', () => {
  // 파이썬: 한 메서드 안의 subTest 반복 → 검사마다 it 하나.
  describe('test_all_data_contracts', () => {
    const checks: Array<[string, () => void]> = [
      ['test_batch02_all_ten_are_registered', test_batch02_all_ten_are_registered],
      ['test_kiri_full_charge_and_defender_support_are_preserved', test_kiri_full_charge_and_defender_support_are_preserved],
      ['test_d_target_spawn_and_fullburst_extension_are_preserved', test_d_target_spawn_and_fullburst_extension_are_preserved],
      ['test_target_spawn_is_emitted_once_at_battle_start', test_target_spawn_is_emitted_once_at_battle_start],
      ['test_k_weapon_change_and_scale_cleanup_are_preserved', test_k_weapon_change_and_scale_cleanup_are_preserved],
      ['test_mica_stack_extension_and_dispel_are_preserved', test_mica_stack_extension_and_dispel_are_preserved],
      ['test_brid_hidden_cooldown_and_full_hp_bonus_are_preserved', test_brid_hidden_cooldown_and_full_hp_bonus_are_preserved],
      ['test_soline_full_hp_passive_and_burst_bonus_are_preserved', test_soline_full_hp_passive_and_burst_bonus_are_preserved],
      ['test_diesel_all_favorite_replacements_are_preserved', test_diesel_all_favorite_replacements_are_preserved],
      ['test_emma_received_hit_probability_and_heals_are_preserved', test_emma_received_hit_probability_and_heals_are_preserved],
      ['test_vesti_three_burst_layers_and_container_are_preserved', test_vesti_three_burst_layers_and_container_are_preserved],
      ['test_eunhwa_last_bullet_round_limited_buffs_are_preserved', test_eunhwa_last_bullet_round_limited_buffs_are_preserved],
    ];
    for (const [checkName, check] of checks) {
      it(checkName, check);
    }
  });

  describe('test_all_ten_run_in_valid_squads', () => {
    const cases: Array<[string, string[]]> = [
      ['키리', ['리틀 머메이드', '크라운', '키리', 'test_B3']],
      ['D', ['리틀 머메이드', '크라운', 'D', 'test_B3']],
      ['K', ['리틀 머메이드', '크라운', 'K', 'test_B3']],
      ['미카 : 스노우 버디', ['미카 : 스노우 버디', '크라운', 'test_B3']],
      ['브리드', ['리틀 머메이드', '크라운', '브리드', 'test_B3']],
      ['솔린', ['리틀 머메이드', '크라운', '솔린', 'test_B3']],
      ['디젤', ['리틀 머메이드', '디젤', 'test_B3']],
      ['엠마', ['엠마', '크라운', 'test_B3']],
      ['베스티', ['리틀 머메이드', '크라운', '베스티', 'test_B3']],
      ['은화', ['리틀 머메이드', '은화', 'test_B3']],
    ];
    for (const [name, members] of cases) {
      it(name, () => {
        _check_character_runs_in_a_valid_squad(name, members);
      }, 60_000);
    }
  });

  it('test_k_last_bullet_adds_thirty_scales_then_fullburst_clears_them', () => {
    const manager = new BuffManager(build_squad(['K']), { enemy: {} });
    manager.notify('last_bullet_fire', 1.0, 'K');

    const scale = manager._active.find((ab: any) => get(ab.effect, 'name') === '기울어지는 천칭');
    if (scale === undefined) throw new Error('StopIteration');
    expect(scale.stack).toBe(30);
    expect(item(manager.get_buffs('K', '__enemy__', 1.0), 'atk_dmg_pct')).toBeGreaterThan(0.0);

    manager.notify('full_burst_end', 2.0, 'K');
    expect(manager._has_self_state('K', '기울어지는 천칭')).toBe(false);
    expect(item(manager.get_buffs('K', '__enemy__', 2.0), 'atk_dmg_pct')).toBe(0.0);
  });

  it('test_brid_hidden_ten_second_skill_and_vesti_container_deal_damage', () => {
    const brid_squad = build_squad(['리틀 머메이드', '크라운', '브리드', 'test_B3']);
    const brid_result = simulate(brid_squad, build_config(brid_squad, { duration: 12.0 }), null, false, 1);
    expect(brid_result.hits.some((hit: any) => hit.caster === '브리드' && hit.skill_name === '리크')).toBe(true);

    const vesti_squad = build_squad(['리틀 머메이드', '크라운', '베스티', 'test_B3']);
    const vesti_result = simulate(
      vesti_squad,
      build_config(vesti_squad, { first_burst_time: 1.0, duration: 8.0 }),
      null,
      false,
      1,
    );
    expect(
      vesti_result.hits.some((hit: any) => hit.caster === '베스티' && hit.skill_name === '미사일 컨테이너'),
    ).toBe(true);
  }, 60_000);

  it('test_diesel_favorite_attention_opens_the_stack_extension', () => {
    const squad = build_squad(['디젤'], { '디젤': { favorite_stage: 3 } });
    const manager = new BuffManager(squad, { enemy: {} });
    manager.notify('burst_cast', 1.0, '디젤');
    for (let index = 0; index < 150; index++) {
      manager.notify('hit_count', 2.0 + index / 1000, '디젤');
    }

    expect(manager._has_self_state('디젤', '주목')).toBe(true);
    expect(manager._has_self_state('디젤', '딸기향 이끌림 3')).toBe(true);
  });

  it('test_mica_increases_a_stackable_allied_buffs_runtime_cap', () => {
    const manager = new BuffManager(build_squad(['미카 : 스노우 버디', 'K']), { enemy: {} });
    for (let index = 0; index < 150; index++) {
      manager.notify('hit_count', index / 1000, '미카 : 스노우 버디');
    }
    for (let index = 0; index < 4; index++) {
      manager.notify('last_bullet_fire', 1.0 + index, 'K');
    }

    const scale = manager._active.find((ab: any) => get(ab.effect, 'name') === '기울어지는 천칭');
    if (scale === undefined) throw new Error('StopIteration');
    expect(scale.stack).toBe(101);
  });
});
