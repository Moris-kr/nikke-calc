/**
 * 전투력 · 육성 비교 · 편성 정책 · 추천 — 고속 엔진 진입점 회귀 시험.
 *
 * 기대값은 파이썬 3.12 엔진(calculator/combat_power.py, site/pybridge/bridge.py·growth_comparison.py·
 * recommendation.py, nikke_mcp/squad_policy.py)의 출력을 그대로 옮겨 적은 것이다 — 파이썬 없이도
 * CI가 두 엔진이 같은 답을 내는지 지킨다. 전체 대조는 `scripts/parity/extra_ref.py` +
 * `scripts/parity/extra.parity.test.ts`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setEngineData } from './data';
import { run_combat_power } from './bridge';
import { collection_coeff, cube_coeff, stage_sum, _cube_skill_levels } from './combat_power';
import { run_growth_comparison } from './growth_comparison';
import { inspect_squad_policy, query_squad_roles } from './squad_policy';
import { combinations, run_recommendation } from './recommendation';

const ROOT = resolve(__dirname, '..', '..', '..');

beforeAll(() => {
  const files: Record<string, unknown> = {};
  const rel = [
    'data/parsed_nikke.json', 'data/parsed_skills.json', 'data/char_defaults.json', 'data/weapon_delays.json',
    'data/weapon_mechanics.json', 'data/burst_gauge.json',
    ...['affinity', 'collection', 'console', 'cube', 'equipment_skills', 'equipment_stats', 'level_beyond', 'level_stats']
      .map((n) => `data/base_stat_tables/${n}.json`),
  ];
  for (const r of rel) files[r] = JSON.parse(readFileSync(join(ROOT, r), 'utf-8'));
  setEngineData(files);
});

const S1 = ['리틀 머메이드', '크라운', '라피 : 레드 후드', '미하라 : 본딩 체인', '헬름'];
const S2 = ['리틀 머메이드', '벨벳', '나유타', '네온 : 비전 아이', '리버렐리오'];
const SODA = ['토브', '나유타', '소다 : 트윙클링 바니', '도로시 : 세렌디피티', '드레이크'];
const NO_CDR = ['리타', '그레이브', '레이', '앨리스', '모더니아'];

describe('전투력', () => {
  it('기본 스펙 · 모르는 이름은 빠진다', () => {
    expect(JSON.parse(run_combat_power({ names: ['크라운', '토브', '라피 : 레드 후드', '없는 니케'] })))
      .toEqual({ '크라운': 159049.29, '토브': 164582.52, '라피 : 레드 후드': 161947.67 });
  });
  it('육성 · 싱크로 · 콘솔', () => {
    const cp = run_combat_power({
      names: ['크라운'],
      characters: {
        '크라운': {
          skillLevels: { 1: 4, 2: 7, 3: 10 }, overload: { element_bonus: 30.5, atk_pct: 20.0 },
          cube: { name: '렐릭 어설트 큐브', level: 9 }, collection: { stage: 'R7', favorite: 0 },
        },
      },
      synchroLevel: 700, console: { common_level: 100, class_level: 50, company_level: 80 },
    });
    expect(JSON.parse(cp)).toEqual({ '크라운': 335181.23 });
  });
  it('보조 계수', () => {
    expect([stage_sum('element_bonus', 38.7), stage_sum('element_bonus', 19.08), stage_sum('atk_pct', 19.4),
      stage_sum('element_bonus', 30.5), stage_sum('atk_pct', 0)]).toEqual([16, 2, 16, 0, 0]);
    expect([_cube_skill_levels(3), _cube_skill_levels(9), _cube_skill_levels(15)]).toEqual([[2, 0], [3, 2], [3, 6]]);
    expect([cube_coeff({ level: 3 }), cube_coeff({ level: 15 }), cube_coeff(null)]).toEqual([3, 13, 0]);
    expect([collection_coeff('SR15'), collection_coeff('R3'), collection_coeff('없음')]).toEqual([40.66, 9.33, 0]);
  });
  it('잘못된 설정은 요청 전체가 실패한다', () => {
    expect(() => run_combat_power({ names: ['크라운'], characters: { '크라운': { overloadLines: {} } } }))
      .toThrow("지원하지 않는 캐릭터 설정: ['overloadLines']");
  });
});

describe('육성 비교', () => {
  it('변경안별 전투력과 차이', () => {
    const r = JSON.parse(run_growth_comparison({
      name: '크라운', baseline: { skillLevels: { 1: 4, 2: 4, 3: 4 } },
      scenarios: [{ label: 'a', changes: { skillLevels: { 1: 10 } } },
        { label: 'b', changes: { cube: { name: '렐릭 어설트 큐브', level: 15 } } }],
    }));
    expect(r.baseline.combatPower).toBe(144949.98);
    expect(r.scenarios.map((s: any) => [s.label, s.combatPower, s.delta, s.percent]))
      .toEqual([['a', 148474.8, 3524.82, 2.431749214453151], ['b', 144949.98, 0, 0]]);
    expect(r.baselineMissingFields).toEqual(['growthStage', 'equipLevels', 'collection', 'cube', 'overload']);
    expect(r.baseline.deviations).toBe('⚠ 기본 스펙(1층) 이탈 1명 —\n  [크라운] affinity: 30 → 40  (레이어)\n'
      + '  [크라운] skill_levels.1: 10 → 4  (지정)\n  [크라운] skill_levels.2: 10 → 4  (지정)\n'
      + '  [크라운] skill_levels.3: 10 → 4  (지정)');
  });
  it('오류 메시지', () => {
    const base = { name: '크라운', baseline: { skillLevels: { 1: 4 } }, scenarios: [{ label: 'a', changes: { skillLevels: { 1: 10 } } }] };
    expect(() => run_growth_comparison({ ...base, baseline: {} }))
      .toThrow('현재 육성 정보가 없습니다. 브라우저에서 육성을 입력하거나 불러오세요.');
    expect(() => run_growth_comparison({ ...base, scenarios: [] })).toThrow('육성 비교는 1~12개 변경안이 필요합니다.');
    expect(() => run_growth_comparison({ ...base, scenarios: [{ label: 'a', changes: {} }] }))
      .toThrow('각 변경안에 변경할 육성을 지정하세요.');
    const { name: _name, ...nameless } = base;
    expect(() => run_growth_comparison(nameless)).toThrow('None: 캐릭터 메타데이터를 찾을 수 없다');
  });
});

describe('편성 정책', () => {
  it('inspect_squad_policy', () => {
    const s1 = inspect_squad_policy(S1);
    expect([s1.status, s1.providers, s1.exception, s1.constraints, s1.burstStageCoverage]).toEqual(
      ['eligible', ['리틀 머메이드'], null, [], { 1: ['리틀 머메이드'], 2: ['크라운'], 3: ['라피 : 레드 후드', '미하라 : 본딩 체인', '헬름'] }]);
    const soda = inspect_squad_policy(SODA);
    expect([soda.status, soda.providers, soda.exception]).toEqual(['eligible', [], 'soda_shotgun_fullburst_extension']);
    const four = inspect_squad_policy(['크라운', '토브']);
    expect([four.status, four.constraints]).toEqual(['invalid', ['five_distinct_characters_required']]);
    const fixed = inspect_squad_policy(NO_CDR, null, 'user_fixed', true);
    expect([fixed.status, fixed.allowed]).toEqual(['eligible', true]);
    expect(() => inspect_squad_policy(S1, null, 'x')).toThrow('purpose는 recommendation 또는 user_fixed입니다.');
  });
  it('query_squad_roles', () => {
    const q = query_squad_roles(['크라운', '리틀 머메이드']);
    expect(q.characters.map((c: any) => [c.name, c.teamCdrCandidate, c.cdrEffects.map((e: any) => e.seconds)]))
      .toEqual([['크라운', false, []], ['리틀 머메이드', true, [7.48]]]);
  });
});

describe('추천', () => {
  it('itertools.combinations 순서', () => {
    expect([...combinations([0, 1, 2, 3], 2)]).toEqual([[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]);
    expect([...combinations([0, 1], 3)]).toEqual([]);
  });
  it('후보 풀 안에서 최소 최대 후회', () => {
    const roster = Object.fromEntries([...S1, ...S2].map((n) => [n, { skillLevels: { 1: 10, 2: 10, 3: 10 } }]));
    const r = JSON.parse(run_recommendation({
      candidates: [{ label: 'A', squad: S1 }, { label: 'B', squad: S2 }], roster,
      battle: { duration: 20, enemyDef: 0, enemyCode: '', corePx: 0, hasParts: false },
      scenarios: [{ label: '방어', battle: { enemyDef: 3000 } }],
    }));
    expect(r.scope.scenarioBestTotals).toEqual([389718256.0, 385225216.0]);
    expect(r.solutions).toEqual([
      { candidateIds: [1], scenarioTotals: [389718256.0, 385225216.0], baseTotal: 389718256.0, maxRegret: 0 },
      { candidateIds: [0], scenarioTotals: [356706598.0, 351919254.0], baseTotal: 356706598.0, maxRegret: 0.08645841605550557 },
    ]);
    expect(r.selected.map((c: any) => c.label)).toEqual(['B']);
    expect(r.candidates[0].scenarios.map((s: any) => s.diagnostics)).toEqual([
      { fullBurstCount: 2, gaps: [2.5299999999999994], uptime: 0.6625, completedSpansOnly: false },
      { fullBurstCount: 2, gaps: [2.5299999999999994], uptime: 0.6625, completedSpansOnly: false },
    ]);
    expect(r.candidates[1].scenarios[0].diagnostics.uptime).toBe(0.7150000000000001);
  }, 60_000);
  it('오류 메시지', () => {
    const ok = { candidates: [{ label: 'A', squad: S1 }], roster: {}, battle: {} };
    expect(() => run_recommendation({ ...ok, candidates: [] })).toThrow('후보는 1~20개여야 합니다.');
    expect(() => run_recommendation({ ...ok, squadCount: true })).toThrow('스쿼드 수는 1~5여야 합니다.');
    expect(() => run_recommendation({ ...ok, include: ['크라운'], exclude: ['크라운'] })).toThrow('포함·제외 조건이 충돌합니다.');
    expect(() => run_recommendation({ ...ok, scenarios: [{ battle: { seed: 3, duration: 10, enemyDef: 1 } }] }))
      .toThrow("시나리오에서 변경할 수 없는 조건: ['duration', 'seed']");
  });
});
