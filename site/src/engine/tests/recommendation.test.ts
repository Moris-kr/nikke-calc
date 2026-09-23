/**
 * site/scripts/test-recommendation.py 이식.
 * Bounded search tests; mock expensive simulation, not ranking behavior.
 *
 * 파이썬은 unittest.mock.patch.object로 pybridge.recommendation 모듈의 run_request·inspect_squad_policy와
 * char_spec._nikke를 바꿔 끼운다. ES 모듈의 export는 spyOn으로 못 바꾸므로 vitest `vi.mock`으로
 * recommendation.ts가 import하는 모듈(../bridge, ../squad_policy, ../spec)의 해당 export만 바꿔 끼운다
 * (엔진 로직은 그대로). 테스트마다 달라지는 가짜 구현은 `state`에 넣는다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ValueError } from '../py';
import { run_recommendation } from '../recommendation';
import { ROOT } from './helpers';

const state = vi.hoisted(() => ({
  simulate: null as null | ((raw: string, include_effective?: boolean) => string),
  roster: null as any,
}));

vi.mock('../bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../bridge')>()),
  run_request: (raw: string, include_effective: boolean = false) => state.simulate!(raw, include_effective),
}));
vi.mock('../squad_policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../squad_policy')>()),
  // 파이썬: side_effect=lambda names, **kw: {'recommendedEligible': 'bad' not in names}
  inspect_squad_policy: (names: string[]) => ({ recommendedEligible: !names.includes('bad') }),
}));
vi.mock('../spec', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../spec')>()),
  // 파이썬: patch.object(char_spec, '_nikke', return_value=roster) — run_case 안의 기본 roster.
  _nikke: () => state.roster,
}));

describe('RecommendationTest', () => {
  // setUp: 추천 엔진 파일이 있어야 한다.
  beforeEach(() => {
    expect(existsSync(join(ROOT, 'site/src/engine/recommendation.ts')), 'recommendation engine must exist').toBe(true);
  });

  let requests: any[] = [];

  function run_case(teams: string[][], scores: any[][], extra: Record<string, any> = {}): any {
    const candidates = teams.map((team, i) => ({ label: String(i), squad: team }));
    const roster: Record<string, any> = {};
    for (const team of teams) for (const name of team) roster[name] = { growthStage: 0, skillLevels: { '1': 3 } };
    const payload = {
      candidates: candidates, roster: roster,
      battle: {
        duration: 30, enemyDef: 100, seed: 42,
        synchroLevel: 321, console: { common_level: 4 },
      },
      ...extra,
    };
    requests = [];
    state.simulate = (raw: string, include_effective: boolean = false): string => {
      const req = JSON.parse(raw);
      requests.push(req);
      expect(include_effective).toBe(true);
      // 파이썬 teams.index(req['squad']) — 리스트 같음 비교.
      const index = teams.findIndex((t) => JSON.stringify(t) === JSON.stringify(req['squad']));
      const score = scores[index]![req['enemyDef'] === 100 ? 0 : 1];
      if (score instanceof Error) {
        throw score;
      }
      // 주의: 파이썬 json.dumps(inf)는 'Infinity'를 쓰고 json.loads가 inf로 되읽는다.
      // JS JSON.stringify(Infinity)는 null이 되어 엔진에서 float(None) 오류로 걸러진다 — 어느 쪽이든 후보는 거부된다.
      return JSON.stringify({
        result: {
          squadTotal: score, duration: 30,
          timeline: { fullBurst: [[2, 12], [16, 26]] }, deviations: 'actual',
        },
        effectiveCharacters: req['characters'],
      });
    };
    state.roster = roster;
    try {
      return JSON.parse(run_recommendation(JSON.stringify(payload)));
    } finally {
      state.simulate = null;
      state.roster = null;
    }
  }

  it('test_exact_five_decks_avoids_greedy_trap', () => {
    const teams = Array.from({ length: 5 }, (_, i) => Array.from({ length: 5 }, (_, j) => `${i}-${j}`));
    const trap = teams.map((team) => team[0]!);
    const result = run_case([trap, ...teams], [[150], ...Array.from({ length: 5 }, () => [50])], { squadCount: 5 });
    expect(result['selected'].map((c: any) => c['id'])).toEqual([1, 2, 3, 4, 5]);
    expect(result['solutions'][0]['baseTotal']).toBe(250);
  });

  it('test_regret_changes_ranking_and_preserves_growth', () => {
    const teams = [[...'abcde'], [...'fghij']];
    const result = run_case(teams, [[100, 10], [80, 80]], { scenarios: [{ label: 'hard', battle: { enemyDef: 200 } }] });
    expect(result['selected'][0]['id']).toBe(1);
    expect(result['solutions'][0]['maxRegret']).toBe(.2);
    for (const req of requests) {
      expect(req['synchroLevel']).toBe(321);
      expect(req['console']).toEqual({ common_level: 4 });
      expect(req['rngMode']).toBe('expected');
      expect(req['characters'][req['squad'][0]]).toEqual({ growthStage: 0, skillLevels: { '1': 3 } });
    }
    expect(result['selected'][0]['scenarios'][0]['diagnostics']['gaps']).toEqual([4]);
  });

  it('test_missing_growth_no_cdr_and_nonfinite_are_skipped', () => {
    const teams = [[...'abcde'], ['bad', 'f', 'g', 'h', 'i'], [...'jklmn']];
    const roster: Record<string, any> = {};
    for (const t of teams) for (const n of t) roster[n] = { growthStage: 0 };
    roster['a'] = {};
    const result = run_case(teams, [[10], [20], [Infinity]], { roster: roster });
    expect(result['selected']).toEqual([]);
    expect(result['candidates'].every((c: any) => c['status'] === 'rejected')).toBe(true);
  });

  it('test_failed_scenario_does_not_receive_zero_score', () => {
    const result = run_case([[...'abcde']], [[10, ValueError('broken')]], { scenarios: [{ label: 'hard', battle: { enemyDef: 200 } }] });
    expect(result['selected']).toEqual([]);
    expect(result['candidates'][0]['reason']).toContain('broken');
  });

  it('test_no_feasible_disjoint_group_and_union_include', () => {
    let result = run_case([[...'abcde'], [...'afghi']], [[20], [10]], { squadCount: 2 });
    expect(result['solutions']).toEqual([]);
    result = run_case([[...'abcde'], [...'fghij']], [[20], [10]], { squadCount: 2, include: ['a', 'j'] });
    expect(result['selected'].length).toBe(2);
  });

  it('test_scenario_cannot_change_account_or_duration', () => {
    for (const key of ['synchroLevel', 'console', 'characters', 'duration']) {
      // 파이썬 assertRaises(ValueError)
      let caught: any = null;
      try {
        run_case([[...'abcde']], [[10]], { scenarios: [{ label: 'bad', battle: { [key]: 1 } }] });
      } catch (exc) {
        caught = exc;
      }
      expect(caught, key).not.toBeNull();
      expect(caught.name, key).toBe('ValueError');
    }
  });

  it('test_single_scenario_tie_has_stable_input_order', () => {
    const result = run_case([[...'abcde'], [...'fghij']], [[10], [10]]);
    expect(result['selected'][0]['id']).toBe(0);
  });

  it('test_exclusion_and_unknown_canonical_names_fail_closed', () => {
    let result = run_case([[...'abcde'], [...'fghij']], [[100], [10]], { exclude: ['a'] });
    expect(result['selected'][0]['id']).toBe(1);
    result = run_case([[...'abcde']], [[100]], { roster: { a: { growthStage: 0 } } });
    expect(result['selected']).toEqual([]);
  });

  it('test_controls_alone_do_not_count_as_actual_growth', () => {
    const roster: Record<string, any> = {};
    for (const name of 'abcde') roster[name] = { control: { mode: 'auto' } };
    const result = run_case([[...'abcde']], [[100]], { roster: roster });
    expect(result['selected']).toEqual([]);
    expect(result['candidates'][0]['reason']).toContain('육성 누락');
  });

  it('test_zero_scores_have_finite_regret', () => {
    const result = run_case([[...'abcde']], [[0]]);
    expect(result['solutions'][0]['maxRegret']).toBe(0);
  });
});
