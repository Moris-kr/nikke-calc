// py: calculator/test_roster_batch05.py
import { beforeAll, describe, expect, it } from 'vitest';
import { BuffManager } from '../buff_manager';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { loadEngineData, readJson } from './helpers';

const BATCH = ['율하', '애드미', '길로틴', '메이든', '길로틴 : 윈터 슬레이어',
  '루드밀라', '네베', '앨리스 : 원더랜드 바니', '루피', '얀'];

function _skills(): Record<string, any[]> { return readJson('data/parsed_skills.json'); }
function _find(name: string, stat: string | null = null, effect_name: string | null = null): any[] {
  return (_skills()[name] as any[]).filter((e) =>
    (stat == null || e.stat === stat) && (effect_name == null || e.name === effect_name));
}

beforeAll(loadEngineData);

describe('RosterBatch05Test', () => {
  it('test_all_ten_registered', () => {
    const skills = _skills();
    expect(BATCH.every((n) => n in skills)).toBe(true);
    expect(Object.keys(skills).filter((n) => !n.startsWith('test_')).length).toBeGreaterThanOrEqual(136);
  });

  it('test_hidden_cooldowns', () => {
    const expected: Array<[string, string, string]> = [
      ['율하', '위크 메이커', 'every:30s'], ['애드미', '고양이 숨결', 'every:20s'],
      ['메이든', '언령 : 필중의 언', 'every:30s'], ['네베', '북극곰의 힘', 'every:10s'],
    ];
    for (const [n, e, t] of expected) expect(_find(n, null, e)[0].trigger.timing).toEqual([t]);
  });

  it('test_winter_guillotine_levels_from_xp_and_spends_reward', () => {
    const manager = new BuffManager(build_squad(['길로틴 : 윈터 슬레이어']), { enemy: {} });
    manager.battle_start();
    for (let i = 0; i < 60; i++) manager.notify('hit_count', i / 100, '길로틴 : 윈터 슬레이어', { core_frac: 0.0 });
    const level = manager._active.find((ab: any) => ab.effect.name === '용사 레벨')!;
    expect(level.stack).toBe(2);
    expect(manager._has_self_state('길로틴 : 윈터 슬레이어', '용사의 자질 3')).toBe(true);
  });

  it('test_guillotine_low_hp_and_maiden_revenge_contracts', () => {
    expect(_find('길로틴', 'atk_pct', '흑화 2')[0].scaling).toBe('lost_hp_pct');
    expect(_find('메이든', null, '언령 : 기교의 언')[0].trigger.timing).toEqual(['received_hit_count:20']);
  });

  it('test_bunny_alice_reentry_and_party_stack_are_preserved', () => {
    expect(_find('앨리스 : 원더랜드 바니', 'burst_reentry').length > 0).toBe(true);
    const party = _find('앨리스 : 원더랜드 바니', null, '당근 파티')[0];
    expect(party.max_stack).toBe(5);
    expect(party.trigger.timing).toEqual(['hit_count:60']);
  });

  it('test_all_ten_simulate', () => {
    const cases: Array<[string, string[]]> = [
      ['율하', ['리틀 머메이드', '크라운', '율하']], ['애드미', ['리틀 머메이드', '애드미', 'test_B3']],
      ['길로틴', ['리틀 머메이드', '크라운', '길로틴']], ['메이든', ['리틀 머메이드', '크라운', '메이든']],
      ['길로틴 : 윈터 슬레이어', ['리틀 머메이드', '크라운', '길로틴 : 윈터 슬레이어']],
      ['루드밀라', ['루드밀라', '크라운', 'test_B3']], ['네베', ['리틀 머메이드', '크라운', '네베']],
      ['앨리스 : 원더랜드 바니', ['앨리스 : 원더랜드 바니', '크라운', 'test_B3']],
      ['루피', ['리틀 머메이드', '루피', 'test_B3']], ['얀', ['얀', '크라운', 'test_B3']]];
    for (const [n, m] of cases) {
      // subTest(name=n)
      const squad = build_squad(m);
      const res = simulate(squad, build_config(squad, { first_burst_time: 1, duration: 8 }), null, false, 1);
      expect(res.hits.some((h) => h.caster === n), n).toBe(true);
    }
  }, 60_000);
});
