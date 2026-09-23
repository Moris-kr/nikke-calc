// py: calculator/test_roster_batch07.py
import { beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { loadEngineData, readJson } from './helpers';

const BATCH = ['폴크방', '니힐리스타', '사쿠라', '에테르', '솔져 E.G.', '솔져 F.A.',
  '프로덕트 08', '프로덕트 12', 'iDoll 플라워', 'iDoll 오션'];

function _skills(): Record<string, any[]> { return readJson('data/parsed_skills.json'); }
function _find(name: string, { stat = null, effect_name = null }:
  { stat?: string | null; effect_name?: string | null } = {}): any[] {
  return (_skills()[name] as any[]).filter((e) =>
    (stat == null || e.stat === stat) && (effect_name == null || e.name === effect_name));
}

beforeAll(loadEngineData);

describe('RosterBatch07Test', () => {
  it('test_all_ten_are_registered', () => {
    const skills = _skills();
    expect(BATCH.every((name) => name in skills)).toBe(true);
    expect(Object.keys(skills).filter((n) => !n.startsWith('test_')).length).toBeGreaterThanOrEqual(156);
  });

  it('test_hidden_active_cooldowns_are_explicit', () => {
    const expected: Array<[string, string, string]> = [
      ['폴크방', '스타팅 휘슬', 'every:30s'], ['폴크방', '페이스 다운', 'every:20s'],
      ['니힐리스타', '메기도 플레임', 'every:10s'], ['에테르', '부식물질 탑재탄환', 'every:15s'],
      ['에테르', '예후 반응 실험', 'every:13s'], ['솔져 E.G.', '이글 택틱', 'every:9s'],
      ['솔져 F.A.', '팔콘 네스트', 'every:15s'], ['프로덕트 08', '전술 : 정밀 사격', 'every:17s'],
      ['프로덕트 12', '행동 : 화력 집중', 'every:10s'], ['iDoll 플라워', '플라워 컬러', 'every:15s'],
      ['iDoll 오션', '오션 클렌징', 'every:15s'],
    ];
    for (const [name, effect_name, timing] of expected) {
      expect(_find(name, { effect_name })[0].trigger.timing).toEqual([timing]);
    }
  });

  it('test_special_contracts', () => {
    expect(_find('폴크방', { stat: 'shield_from_max_hp_pct' }).length > 0).toBe(true);
    expect(_find('폴크방', { stat: 'lifesteal_pct' }).length > 0).toBe(true);
    const burn = _find('니힐리스타', { stat: 'dot_damage' })[0];
    expect(burn.tick_interval).toBe(1);
    expect(burn.duration).toBe(10);
    const tea = _find('사쿠라', { effect_name: '벚꽃차' })[0];
    expect(tea.max_stack).toBe(10);
    expect(tea.trigger.timing).toEqual(['hit_count:3']);
    expect(_find('사쿠라', { stat: 'intercept_dmg_pct' }).length > 0).toBe(true);
  });

  it('test_all_ten_simulate_in_valid_squads', () => {
    const cases: Array<[string, string[]]> = [
      ['폴크방', ['리틀 머메이드', '폴크방', 'test_B3']],
      ['니힐리스타', ['리틀 머메이드', '니힐리스타', 'test_B3']],
      ['사쿠라', ['사쿠라', '크라운', 'test_B3']],
      ['에테르', ['에테르', '크라운', 'test_B3']],
      ['솔져 E.G.', ['리틀 머메이드', '크라운', '솔져 E.G.']],
      ['솔져 F.A.', ['리틀 머메이드', '솔져 F.A.', 'test_B3']],
      ['프로덕트 08', ['프로덕트 08', '크라운', 'test_B3']],
      ['프로덕트 12', ['리틀 머메이드', '크라운', '프로덕트 12']],
      ['iDoll 플라워', ['iDoll 플라워', '크라운', 'test_B3']],
      ['iDoll 오션', ['iDoll 오션', '크라운', 'test_B3']],
    ];
    for (const [name, members] of cases) {
      // subTest(name=name)
      const squad = build_squad(members);
      const result = simulate(squad, build_config(squad, { first_burst_time: 1, duration: 8 }), null, false, 1);
      expect(result.hits.some((hit) => hit.caster === name), name).toBe(true);
    }
  }, 60_000);
});
