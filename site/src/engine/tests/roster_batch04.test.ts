// py: calculator/test_roster_batch04.py
import { describe, expect, it } from 'vitest';
import { BuffManager } from '../buff_manager';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { get, item, truthy } from '../py';
import { loadEngineData, readJson } from './helpers';

loadEngineData();

const BATCH = ['라피', '네온', '아니스', '델타', '벨로타', '미카', 'N102', '프림', '유니', '미하라'];

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
    (e) =>
      (stat === undefined || get(e, 'stat') === stat) &&
      (effect_name === undefined || get(e, 'name') === effect_name) &&
      (favorite === undefined || get(e, 'favorite') === favorite),
  );
}

describe('RosterBatch04Test', () => {
  it('test_all_ten_are_registered', () => {
    const skills = _skills();
    expect(BATCH.every((name) => name in skills)).toBe(true);
    expect(Object.keys(skills).filter((name) => !name.startsWith('test_')).length).toBeGreaterThanOrEqual(126);
  });

  describe('test_hidden_active_cooldowns_are_explicit', () => {
    const expected: Array<[[string, string], string]> = [
      [['라피', '미사일'], 'every:20s'],
      [['아니스', '포메이션 C.H'], 'every:10s'],
      [['미카', '용감한 별님'], 'every:20s'],
      [['N102', '부상하는 기억'], 'every:10s'],
    ];
    for (const [[name, effect_name], timing] of expected) {
      it(name, () => {
        expect(_find(name, { effect_name })[0].trigger.timing).toEqual([timing]);
      });
    }
  });

  it('test_core_data_contracts', () => {
    expect(_find('네온', { stat: 'crit_rate', effect_name: '화력 만세!' })[0].duration_bullets).toBe(2);
    expect(_find('아니스', { stat: 'received_dmg_split' }).length).toBeGreaterThan(0);
    expect(_find('델타', { stat: 'decoy' }).length).toBeGreaterThan(0);
    expect(_find('벨로타', { stat: 'explosion_range' }).length).toBeGreaterThan(0);
    expect(_find('유니', { stat: 'enemy_movement_disable' }).length).toBeGreaterThan(0);
    expect(_find('미하라', { stat: 'fullburst_duration' }).length).toBeGreaterThan(0);
  });

  it('test_frima_favorite_wakes_after_six_full_charge_hits', () => {
    const manager = new BuffManager(build_squad(['프림'], { '프림': { favorite_stage: 3 } }), { enemy: {} });
    manager.battle_start();
    for (let index = 0; index < 6; index++) {
      manager.notify('full_charge_hit', 1.0 + index, '프림');
    }
    expect(manager._has_self_state('프림', '일어남')).toBe(true);
    expect(truthy(item(manager.get_buffs('프림', '__enemy__', 6.0), 'armor_break_enabled'))).toBe(true);

    const interrupted = new BuffManager(build_squad(['프림'], { '프림': { favorite_stage: 3 } }), { enemy: {} });
    interrupted.battle_start();
    for (let index = 0; index < 3; index++) {
      interrupted.notify('full_charge_hit', 1.0 + index, '프림');
    }
    interrupted._active = interrupted._active.filter((ab: any) => get(ab.effect, 'name') !== '잠 옴');
    interrupted._invalidate_buffs_cache();
    for (let index = 3; index < 6; index++) {
      interrupted.notify('full_charge_hit', 1.0 + index, '프림');
    }
    expect(interrupted._has_self_state('프림', '일어남')).toBe(false);
  });

  it('test_mihara_first_and_second_burst_layers_stack', () => {
    const manager = new BuffManager(build_squad(['미하라']), { enemy: {} });
    manager.notify('burst_cast', 1.0, '미하라');
    expect(manager._has_self_state('미하라', '페인 로드 1')).toBe(true);
    expect(manager._has_self_state('미하라', '페인 로드 2')).toBe(false);
    expect(item(manager.get_buffs('미하라', '__enemy__', 1.0), 'fullburst_duration')).toBe(-5.0);
    manager.notify('burst_cast', 2.0, '미하라');
    expect(manager._has_self_state('미하라', '페인 로드 1')).toBe(true);
    expect(manager._has_self_state('미하라', '페인 로드 2')).toBe(true);
  });

  describe('test_all_ten_run_in_valid_squads', () => {
    const cases: Array<[string, string[]]> = [
      ['라피', ['리틀 머메이드', '크라운', '라피']],
      ['네온', ['네온', '크라운', 'test_B3']],
      ['아니스', ['리틀 머메이드', '아니스', 'test_B3']],
      ['델타', ['리틀 머메이드', '델타', 'test_B3']],
      ['벨로타', ['리틀 머메이드', '벨로타', 'test_B3']],
      ['미카', ['미카', '크라운', 'test_B3']],
      ['N102', ['N102', '크라운', 'test_B3']],
      ['프림', ['프림', '크라운', 'test_B3']],
      ['유니', ['리틀 머메이드', '유니', 'test_B3']],
      ['미하라', ['리틀 머메이드', '크라운', '미하라']],
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
