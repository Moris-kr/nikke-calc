// py: calculator/test_roster_batch03.py
import { describe, expect, it } from 'vitest';
import { BuffManager } from '../buff_manager';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { get, item } from '../py';
import { loadEngineData, readJson } from './helpers';

loadEngineData();

const BATCH = [
  '엠마 : 택티컬 업', '은화 : 택티컬 업', '크로우', '자칼', '바이퍼',
  'E.H.', '앤 : 미라클 페어리', '메어리', '페퍼', '밀크',
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
  return (item(_skills(), name) as any[]).filter(
    (effect) =>
      (stat === undefined || get(effect, 'stat') === stat) &&
      (effect_name === undefined || get(effect, 'name') === effect_name) &&
      (favorite === undefined || get(effect, 'favorite') === favorite),
  );
}

describe('RosterBatch03Test', () => {
  it('test_all_ten_are_registered', () => {
    const skills = _skills();
    expect(BATCH.every((name) => name in skills)).toBe(true);
    expect(Object.keys(skills).filter((name) => !name.startsWith('test_')).length).toBeGreaterThanOrEqual(116);
  });

  it('test_tactical_formation_and_environment_contracts', () => {
    const same_squad = _find('엠마 : 택티컬 업', { effect_name: '포메이션 LT' })[0];
    expect(same_squad.target).toBe('allies_same_squad');
    const interval = _find('엠마 : 택티컬 업', { stat: 'effect_interval' })[0];
    expect(interval.fixed_value).toBe(-20.0);
    expect(interval.target_effect).toBe('환경 조성');
    expect(_find('은화 : 택티컬 업', { stat: 'armor_break_enabled' }).length).toBeGreaterThan(0);
  });

  it('test_same_squad_target_selects_only_absolute_members', () => {
    const manager = new BuffManager(
      build_squad(['엠마 : 택티컬 업', '은화 : 택티컬 업', '라피']),
      { enemy: {} },
    );
    manager.battle_start();
    expect(item(manager.get_buffs('은화 : 택티컬 업', '__enemy__', 0), 'crit_dmg')).toBeGreaterThan(0);
    expect(item(manager.get_buffs('라피', '__enemy__', 0), 'crit_dmg')).toBe(0);

    const paired = new BuffManager(
      build_squad(['엠마 : 택티컬 업', '은화 : 택티컬 업']), { enemy: {} },
    );
    paired.battle_start();
    paired.tick(0.0);
    const environment_intervals = paired._every_effects
      .filter(([effect, caster]) => caster === '엠마 : 택티컬 업' && item(effect, 'name') === '환경 조성')
      .map(([effect]) => paired._next_fire.get(effect)![1]);
    expect(environment_intervals).toEqual([10.0, 10.0, 10.0]);
  });

  it('test_crow_jackal_and_viper_contracts', () => {
    expect(_find('크로우', { stat: 'atk_pct', effect_name: '킬링타임' }).length).toBeGreaterThan(0);
    expect(_find('자칼', { stat: 'received_dmg_split' }).length).toBeGreaterThan(0);
    expect(_find('바이퍼', { stat: 'burst_reentry', favorite: 3 }).length).toBeGreaterThan(0);
    const dot = _find('바이퍼', { stat: 'dot_damage', favorite: 2 })[0];
    expect(dot.tick_interval).toBe(1.0);
    expect(dot.duration).toBe(10.0);
  });

  it('test_eh_scrap_magazine_and_dynamic_weapon_contracts', () => {
    expect(_find('E.H.', { stat: 'gauge_charge', effect_name: '폐품 수집' }).length).toBeGreaterThan(0);
    expect(_find('E.H.', { stat: 'gauge_consume', effect_name: '사제 탄창 제작 3' }).length).toBeGreaterThan(0);
    const weapon = _skills()['E.H.']!.filter((effect: any) => get(effect, 'type') === 'weapon_change')[0];
    expect(weapon.max_ammo_gauge_ref).toBe('사제 탄창');
    expect(weapon.max_ammo).toBe(4);
  });

  it('test_eh_weapon_uses_current_magazine_count_as_ammo', () => {
    const squad = build_squad(['리틀 머메이드', '크라운', 'E.H.']);
    const result = simulate(
      squad,
      build_config(squad, { first_burst_time: 1.0, duration: 8.0 }),
      null,
      false,
      1,
    );
    const eh_burst_hits = result.hits.filter(
      (hit: any) => hit.caster === 'E.H.' && hit.hit_tag.includes('full_charge') && hit.t >= 1.0 && hit.t <= 8.0,
    );
    expect(eh_burst_hits.length).toBe(1);

    const stocked = simulate(
      squad,
      build_config(squad, {
        first_burst_time: 1.0, duration: 8.0, part_break_interval: 0.1,
      }),
      null,
      false,
      1,
    );
    const stocked_hits = stocked.hits.filter(
      (hit: any) => hit.caster === 'E.H.' && hit.hit_tag.includes('full_charge') && hit.t >= 1.0 && hit.t <= 8.0,
    );
    expect(stocked_hits.length).toBe(4);
  }, 60_000);

  it('test_healers_and_milk_favorite_contracts', () => {
    expect(_find('앤 : 미라클 페어리', { stat: 'revive' }).length).toBeGreaterThan(0);
    expect(_find('메어리', { stat: 'heal_hp_pct', effect_name: '백의의 천사' }).length).toBeGreaterThan(0);
    const pepper = _find('페퍼', { effect_name: '비타민파워' })[0];
    expect(pepper.trigger.timing).toEqual(['every:10s']);
    const milk = _find('밀크', { effect_name: '밀크에겐 맡겨!', favorite: 1 })[0];
    expect(milk.trigger.timing).toEqual(['every:20s']);
    expect(_find('밀크', { stat: 'burst_cooldown', favorite: 1 }).length).toBeGreaterThan(0);

    const manager = new BuffManager(build_squad(['앤 : 미라클 페어리', '크로우', '라피']), { enemy: {} });
    manager.notify('burst_cast', 1.0, '앤 : 미라클 페어리');
    expect(item(manager.get_buffs('라피', '__enemy__', 1.0), 'atk_pct')).toBeGreaterThan(0);
    expect(item(manager.get_buffs('크로우', '__enemy__', 1.0), 'atk_pct')).toBe(0);
  });

  describe('test_all_ten_run_in_valid_squads', () => {
    const cases: Array<[string, string[]]> = [
      ['엠마 : 택티컬 업', ['엠마 : 택티컬 업', '크라운', 'test_B3']],
      ['은화 : 택티컬 업', ['리틀 머메이드', '은화 : 택티컬 업', 'test_B3']],
      ['크로우', ['리틀 머메이드', '크라운', '크로우']],
      ['자칼', ['자칼', '크라운', 'test_B3']],
      ['바이퍼', ['리틀 머메이드', '바이퍼', 'test_B3']],
      ['E.H.', ['리틀 머메이드', '크라운', 'E.H.']],
      ['앤 : 미라클 페어리', ['앤 : 미라클 페어리', '크라운', 'test_B3']],
      ['메어리', ['메어리', '크라운', 'test_B3']],
      ['페퍼', ['페퍼', '크라운', 'test_B3']],
      ['밀크', ['밀크', '크라운', 'test_B3']],
    ];
    for (const [name, members] of cases) {
      it(name, () => {
        const squad = build_squad(members);
        const result = simulate(squad, build_config(squad, { first_burst_time: 1, duration: 8 }), null, false, 1);
        expect(result.hits.some((hit: any) => hit.caster === name)).toBe(true);
      }, 60_000);
    }
  });
});
