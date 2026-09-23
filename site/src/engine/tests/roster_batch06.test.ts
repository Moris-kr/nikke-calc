// py: calculator/test_roster_batch06.py
import { beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { almostEqual, loadEngineData, readJson } from './helpers';

const BATCH = ['엑시아', '노벨', '라푼젤', '스노우 화이트 : 이노센트 데이즈', '라푼젤 : 퓨어 그레이스',
  '하란', '노아', '도로시', '루마니', '에피넬'];

function _skills(): Record<string, any[]> { return readJson('data/parsed_skills.json'); }
function _find(name: string, { stat = null, effect_name = null, favorite = null }:
  { stat?: string | null; effect_name?: string | null; favorite?: number | null } = {}): any[] {
  return (_skills()[name] as any[]).filter((e) =>
    (stat == null || e.stat === stat)
    && (effect_name == null || e.name === effect_name)
    && (favorite == null || e.favorite === favorite));
}

beforeAll(loadEngineData);

describe('RosterBatch06Test', () => {
  it('test_all_ten_are_registered', () => {
    const skills = _skills();
    expect(BATCH.every((name) => name in skills)).toBe(true);
    expect(Object.keys(skills).filter((name) => !name.startsWith('test_')).length).toBeGreaterThanOrEqual(146);
  });

  it('test_hidden_active_cooldowns_are_explicit', () => {
    const expected: Array<[string, string, string]> = [
      ['노벨', '수상한 것입니다!', 'every:10s'],
      ['라푼젤', '디바인 블레스', 'every:15s'],
      ['도로시', '세례', 'every:20s'],
    ];
    for (const [name, effect_name, timing] of expected) {
      expect(_find(name, { effect_name })[0].trigger.timing).toEqual([timing]);
    }
  });

  it('test_exia_favorite_contracts', () => {
    expect(_find('엑시아', { effect_name: '해킹 코드 수집', favorite: 1 })[0].max_stack).toBe(5);
    expect(_find('엑시아', { stat: 'received_dmg_pct', favorite: 2 }).length > 0).toBe(true);
    const fixed = _find('엑시아', { stat: 'reload_time_fixed', favorite: 3 })[0];
    expect(almostEqual(0.1, fixed.fixed_value)).toBe(true);
  });

  it('test_innocent_days_burst_reduces_skill2_threshold_and_enables_infinite_ammo', () => {
    const reduce = _find('스노우 화이트 : 이노센트 데이즈', { stat: 'trigger_count_reduce' })[0];
    expect(reduce.target_effect).toBe('세븐스 드워프 IV');
    expect(reduce.fixed_value).toBe(20);
    expect(_find('스노우 화이트 : 이노센트 데이즈', { stat: 'max_ammo_infinite' }).length > 0).toBe(true);

    const squad = build_squad(['리틀 머메이드', '크라운', '스노우 화이트 : 이노센트 데이즈']);
    const result = simulate(squad, build_config(squad, { first_burst_time: 1, duration: 8 }), null, true, 1);
    const cast_t = result.log!.burst_log.find((e) => e.caster === '스노우 화이트 : 이노센트 데이즈')!.t;
    const reloads = result.log!.reload_log.filter(
      (e) => e.caster === '스노우 화이트 : 이노센트 데이즈' && cast_t <= e.t && e.t <= cast_t + 5);
    expect(reloads).toEqual([]);
  }, 60_000);

  it('test_pure_grace_shield_and_dorothy_brand_are_preserved', () => {
    expect(_find('라푼젤 : 퓨어 그레이스', { stat: 'shared_shield_from_max_hp_pct' }).length).toBe(2);
    expect(_find('라푼젤 : 퓨어 그레이스', { stat: 'shield_heal_from_caster_max_hp_pct' }).length > 0).toBe(true);
    const brand = _find('도로시', { stat: 'damage_accumulate' })[0];
    expect(brand.values['10']).toBe(8900.83);
    expect(brand.duration).toBe(10.0);
  });

  it('test_dorothy_brand_releases_accumulated_damage_at_expiry', () => {
    const squad = build_squad(['도로시', '크라운', 'test_B3']);
    const result = simulate(squad, build_config(squad, { first_burst_time: 1, duration: 14 }), null, false, 1);
    const releases = result.hits.filter((h) => h.caster === '도로시' && h.skill_name === '낙인');
    expect(releases.length).toBe(1);
    expect(releases[0]!.damage).toBeGreaterThan(0);
    expect(releases[0]!.t).toBeGreaterThanOrEqual(11);
  }, 60_000);

  it('test_all_ten_simulate_in_valid_squads', () => {
    const cases: Array<[string, string[]]> = [
      ['엑시아', ['엑시아', '크라운', 'test_B3']],
      ['노벨', ['리틀 머메이드', '노벨', 'test_B3']],
      ['라푼젤', ['라푼젤', '크라운', 'test_B3']],
      ['스노우 화이트 : 이노센트 데이즈', ['리틀 머메이드', '크라운', '스노우 화이트 : 이노센트 데이즈']],
      ['라푼젤 : 퓨어 그레이스', ['라푼젤 : 퓨어 그레이스', '크라운', 'test_B3']],
      ['하란', ['리틀 머메이드', '크라운', '하란']],
      ['노아', ['리틀 머메이드', '노아', 'test_B3']],
      ['도로시', ['도로시', '크라운', 'test_B3']],
      ['루마니', ['루마니', '크라운', 'test_B3']],
      ['에피넬', ['리틀 머메이드', '크라운', '에피넬']],
    ];
    for (const [name, members] of cases) {
      // subTest(name=name)
      const squad = build_squad(members);
      const result = simulate(squad, build_config(squad, { first_burst_time: 1, duration: 8 }), null, false, 1);
      expect(result.hits.some((hit) => hit.caster === name), name).toBe(true);
    }
  }, 60_000);
});
