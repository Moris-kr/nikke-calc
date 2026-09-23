// py: calculator/test_roster_batch08.py
import { beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { loadEngineData, readJson } from './helpers';

const BATCH = ['솔져 O.W.', '프로덕트 23', 'iDoll 썬', '코코아', '소다',
  '마르차나', '차임', '마스트', '앵커', '킬로'];

function _skills(): Record<string, any[]> { return readJson('data/parsed_skills.json'); }
function _find(name: string, { stat = null, effect_name = null }:
  { stat?: string | null; effect_name?: string | null } = {}): any[] {
  return (_skills()[name] as any[]).filter((e) =>
    (stat == null || e.stat === stat) && (effect_name == null || e.name === effect_name));
}

beforeAll(loadEngineData);

describe('RosterBatch08Test', () => {
  it('test_all_ten_are_registered', () => {
    const skills = _skills();
    expect(BATCH.every((name) => name in skills)).toBe(true);
    expect(Object.keys(skills).filter((n) => !n.startsWith('test_')).length).toBeGreaterThanOrEqual(166);
  });

  it('test_hidden_active_cooldowns_are_explicit', () => {
    const expected: Array<[string, string, string]> = [
      ['솔져 O.W.', '오울 윈드', 'every:10s'],
      ['프로덕트 23', '명령 : 응급 조치', 'every:15s'],
      ['코코아', '프로 종이접기', 'every:15s'],
      ['소다', '바닥 청소 메이드', 'every:12s'],
    ];
    for (const [name, effect_name, timing] of expected) {
      expect(_find(name, { effect_name })[0].trigger.timing).toEqual([timing]);
    }
  });

  it('test_chime_buffs_crown_only', () => {
    for (const effect_name of ['일등 신하', '왕의 비서', '왕을 위해 3']) {
      expect(_find('차임', { effect_name })[0].target).toBe('크라운');
    }
  });

  it('test_mast_and_kilo_special_contracts', () => {
    const sea = _find('마스트', { effect_name: '해풍' })[0];
    expect(sea.max_stack).toBe(50);
    const storm = _find('마스트', { effect_name: '비바람을 뚫고! 3' })[0];
    expect(storm.scaling).toBe('stack_count');
    expect(storm.scaling_ref).toBe('해풍');
    const kilo = _find('킬로', { effect_name: '우선 순위 지정' })[0];
    expect(kilo.scaling).toBe('max_hp_conversion');
    expect(kilo.scaling_hp_pct).toBe(5);
    expect(kilo.trigger.condition).toEqual(['self_state:나노 코팅']);
    const stages = _find('킬로', { stat: 'next_shield_hp_pct' });
    expect(stages.length).toBe(3);
    expect(stages.every((e) => Boolean(e.consume_next_shield))).toBe(true);
    expect(stages.map((e) => e.trigger.timing[0])).toEqual(
      [1, 2, 3].map((n) => `conditional_burst_cast_count:킬로_보호막없음:${n}`));
  });

  it('test_all_ten_simulate_in_valid_squads', () => {
    const cases: Array<[string, string[]]> = [
      ['솔져 O.W.', ['솔져 O.W.', '크라운', 'test_B3']],
      ['프로덕트 23', ['리틀 머메이드', '프로덕트 23', 'test_B3']],
      ['iDoll 썬', ['리틀 머메이드', '크라운', 'iDoll 썬']],
      ['코코아', ['코코아', '크라운', 'test_B3']],
      ['소다', ['소다', '크라운', 'test_B3']],
      ['마르차나', ['리틀 머메이드', '마르차나', 'test_B3']],
      ['차임', ['리틀 머메이드', '차임', 'test_B3', '크라운']],
      ['마스트', ['리틀 머메이드', '마스트', 'test_B3']],
      ['앵커', ['앵커', '크라운', 'test_B3']],
      ['킬로', ['리틀 머메이드', '크라운', '킬로']],
    ];
    for (const [name, members] of cases) {
      // subTest(name=name)
      const squad = build_squad(members);
      const result = simulate(squad, build_config(squad, { first_burst_time: 1, duration: 8 }), null, false, 1);
      expect(result.hits.some((hit) => hit.caster === name), name).toBe(true);
    }
  }, 60_000);
});
