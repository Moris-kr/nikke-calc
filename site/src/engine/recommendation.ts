/**
 * site/pybridge/recommendation.py — 외부에서 준 후보 풀 안에서 겹치지 않는 편성 묶음을 정확히 고른다.
 *
 * 점수는 결정론적 시뮬레이션이지 클리어 확률·신뢰도가 아니다.
 * 저장된 프로필을 읽거나 제출한 계정 육성을 바꾸지 않는다.
 */
import * as char_spec from './spec';
import { run_request } from './bridge';
import { inspect_squad_policy } from './squad_policy';
import { _py_is_dict, _py_repr, _py_str, _py_strip } from './customization';
import { PyError, ValueError, deepcopy, get, has, isfinite, maxBy, setdefault, sorted, sum, truthy } from './py';

export const SCENARIO_FIELDS: ReadonlySet<string> = new Set(['enemyDef', 'corePx', 'coreWindows', 'hasParts',
  'defenseRateWindows', 'elementWindows', 'immuneWindows', 'firstBurstTime', 'burstRegenTime',
  'optimalRangeWeapons', 'optimalRangeWindows']);
export const GROWTH_FIELDS: ReadonlySet<string> = new Set(['growthStage', 'skillLevels', 'overload', 'cube',
  'collection', 'manualStats', 'equipLevels', 'overloadLines']);

// py: site/pybridge/recommendation.py:31
export function _names(value: any, label: string): string[] {
  if (!Array.isArray(value) || value.some((n) => typeof n !== 'string' || !_py_strip(n))) {
    throw ValueError(`${label}: 이름 배열이 필요합니다.`);
  }
  return value.map((n: string) => _py_strip(n));
}

/** 파이썬 `float(x)` — JSON에서 온 수·문자열. */
function _float(x: any): number {
  if (typeof x === 'number') return x;
  if (typeof x === 'boolean') return Number(x);
  if (typeof x === 'string') {
    const s = x.trim().toLowerCase();
    if (/^[+-]?(inf|infinity)$/.test(s)) return s.startsWith('-') ? -Infinity : Infinity;
    if (/^[+-]?nan$/.test(s)) return NaN;
    if (/^[+-]?(\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(e[+-]?\d+)?$/.test(s)) return Number(s.replace(/_/g, ''));
    throw ValueError(`could not convert string to float: ${_py_repr(x)}`);
  }
  throw new PyError('TypeError', `float() argument must be a string or a real number, not '${x === null ? 'NoneType' : Array.isArray(x) ? 'list' : 'dict'}'`);
}

// py: site/pybridge/recommendation.py:37
export function _diagnostics(result: Record<string, any>): Record<string, any> {
  // Older cached results contain completed spans only; new bridge results
  // include the final interval clipped to the battle duration.
  const spans: any[] = get(get(result, 'timeline', {}), 'fullBurst', []);
  const duration = _float(result['duration']);
  if (!isfinite(duration) || duration <= 0) {
    throw ValueError('유효하지 않은 전투 시간입니다.');
  }
  const valid: Array<[number, number]> = [];
  for (const [start0, end0] of spans) {
    const start = _float(start0);
    const end = _float(end0);
    if (![start, end].every((x) => isfinite(x)) || end < start) {
      throw ValueError('유효하지 않은 풀버스트 기록입니다.');
    }
    valid.push([Math.max(0., start), Math.min(duration, end)]);
  }
  valid.splice(0, valid.length, ...sorted(valid));
  const gaps: number[] = [];
  for (let i = 0; i + 1 < valid.length; i += 1) {
    gaps.push(Math.max(0., valid[i + 1]![0] - valid[i]![1]));
  }
  return {
    fullBurstCount: valid.length,
    gaps: gaps,
    uptime: sum(valid.map(([start, end]) => Math.max(0., end - start))) / duration,
    completedSpansOnly: !has(get(result, 'timeline', {}), 'fullBurstSummary'),
  };
}

/** 파이썬 `str(exc)`. */
function _str_exc(exc: unknown): string {
  if (exc instanceof PyError) return exc.message;
  if (exc instanceof Error) {
    // py.ts의 `item`·`pop`은 `KeyError: 키`를 메시지로 던진다 — 파이썬 str(KeyError)는 `'키'`.
    const m = /^KeyError: (.*)$/s.exec(exc.message);
    if (m) return _py_repr(m[1]);
    return exc.message;
  }
  return String(exc);
}

/** 파이썬 `json.dumps(..., allow_nan=False)` — 유한하지 않은 실수가 있으면 ValueError. */
function _check_finite(v: any): void {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw ValueError(`Out of range float values are not JSON compliant: ${Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf'}`);
    }
    return;
  }
  if (Array.isArray(v)) {
    v.forEach(_check_finite);
  } else if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) _check_finite(v[k]);
  }
}

/** 파이썬 `itertools.combinations(pool, r)` — 같은 순서(사전식 인덱스). */
export function* combinations<T>(pool: T[], r: number): Generator<T[]> {
  const n = pool.length;
  if (r > n) return;
  const indices = Array.from({ length: r }, (_, i) => i);
  yield indices.map((i) => pool[i]!);
  for (;;) {
    let i = r - 1;
    while (i >= 0 && indices[i] === i + n - r) i -= 1;
    if (i < 0) return;
    indices[i]! += 1;
    for (let j = i + 1; j < r; j += 1) indices[j] = indices[j - 1]! + 1;
    yield indices.map((k) => pool[k]!);
  }
}

// py: site/pybridge/recommendation.py:60
/**
 * Evaluate <=20 candidates against base + <=2 battle-only variations.
 *
 * Include constraints apply to the union of selected squads. Slot order is
 * preserved. Any failed scenario disqualifies its entire candidate.
 */
export function run_recommendation(raw: string | Record<string, any>): string {
  const payload: any = typeof raw === 'string' ? JSON.parse(raw) : deepcopy(raw);
  if (!_py_is_dict(payload)) {
    const t = Array.isArray(payload) ? 'list' : payload === null ? 'NoneType' : typeof payload === 'string' ? 'str'
      : typeof payload === 'boolean' ? 'bool' : Number.isInteger(payload) ? 'int' : 'float';
    throw new PyError('AttributeError', `'${t}' object has no attribute 'get'`);
  }
  const candidates = get<any>(payload, 'candidates', null);
  if (!Array.isArray(candidates) || !(1 <= candidates.length && candidates.length <= 20)) {
    throw ValueError('후보는 1~20개여야 합니다.');
  }
  const count = get<any>(payload, 'squadCount', 1);
  // 파이썬 `isinstance(count, int)` — JSON 정수만(워커는 JS 객체를 JSON으로 싸므로 1.0이 1로 온다).
  if (typeof count !== 'number' || !Number.isInteger(count) || !(1 <= count && count <= 5)) {
    throw ValueError('스쿼드 수는 1~5여야 합니다.');
  }
  const roster = get<any>(payload, 'roster', null);
  const battle = get<any>(payload, 'battle', null);
  if (!_py_is_dict(roster) || !_py_is_dict(battle)) {
    throw ValueError('보유 육성과 전투 조건이 필요합니다.');
  }
  if (['characters', 'squad', 'customCharacters'].some((k) => has(battle, k))) {
    throw ValueError('전투 조건에 편성·육성을 넣을 수 없습니다.');
  }
  const include = new Set(_names(get(payload, 'include', []), 'include'));
  const exclude = new Set(_names(get(payload, 'exclude', []), 'exclude'));
  if ([...include].some((n) => exclude.has(n))) {
    throw ValueError('포함·제외 조건이 충돌합니다.');
  }
  const base = deepcopy(battle) as Record<string, any>;
  base['rngMode'] = 'expected';
  setdefault(base, 'seed', 42);
  const scenarios: Array<Record<string, any>> = [{ label: '기본', battle: base }];
  const extras = get<any>(payload, 'scenarios', []);
  if (!Array.isArray(extras) || extras.length > 2) {
    throw ValueError('추가 시나리오는 최대 2개입니다 (기본 포함 3개).');
  }
  for (const scenario of extras) {
    if (!_py_is_dict(scenario) || !_py_is_dict(get(scenario, 'battle', null))) {
      throw ValueError('시나리오 전투 조건이 필요합니다.');
    }
    const forbidden = Object.keys(scenario['battle']).filter((k) => !SCENARIO_FIELDS.has(k));
    if (forbidden.length) {
      throw ValueError(`시나리오에서 변경할 수 없는 조건: ${_py_repr(sorted(forbidden))}`);
    }
    const label = get(scenario, 'label', null);
    scenarios.push({
      label: _py_str(truthy(label) ? label : `조건 ${scenarios.length}`),
      battle: { ...deepcopy(base), ...deepcopy(scenario['battle']) },
    });
  }
  const canonical = char_spec._nikke();
  const rows: Array<Record<string, any>> = [];
  let evaluation_count = 0;
  candidates.forEach((candidate: any, index: number) => {
    const row: Record<string, any> = {
      id: index, label: _py_is_dict(candidate) ? _py_str(get(candidate, 'label', index)) : _py_str(index),
      status: 'rejected', scenarios: [],
    };
    rows.push(row);
    try {
      if (!_py_is_dict(candidate)) {
        throw ValueError('후보 객체가 필요합니다.');
      }
      const names = _names(get(candidate, 'squad', null), 'squad');
      row['squad'] = names;
      row['sourceUrl'] = get(candidate, 'sourceUrl', null);
      row['sourceReason'] = get(candidate, 'reason', null);
      if (names.length !== 5 || new Set(names).size !== 5) {
        throw ValueError('서로 다른 정식 캐릭터 5명이 필요합니다.');
      }
      const unknown = [...new Set(names)].filter((n) => !has(canonical, n));
      if (unknown.length) {
        throw ValueError('정본에 없는 캐릭터: ' + sorted(unknown).join(', '));
      }
      if (names.some((n) => exclude.has(n))) {
        throw ValueError('제외 캐릭터가 포함된 후보입니다.');
      }
      const missing = names.filter((n) => !_py_is_dict(get(roster, n, null)) || !Object.entries(roster[n]).some(
        ([k, v]) => GROWTH_FIELDS.has(k) && v != null && !_empty_dict(v) && !(Array.isArray(v) && v.length === 0)));
      if (missing.length) {
        throw ValueError('실제 육성 누락: ' + missing.join(', '));
      }
      const growth: Record<string, any> = {};
      for (const n of names) growth[n] = deepcopy(roster[n]);
      const policy = inspect_squad_policy(names, deepcopy(growth), 'recommendation');
      row['policy'] = policy;
      if (!truthy(get(policy, 'recommendedEligible', null))) {
        const reason = [get(policy, 'confirmationReason', null), get(policy, 'status', null)].find((x) => truthy(x));
        throw ValueError('추천 편성 정책 미충족 또는 쿨타임 감소 조건 미검증: ' + _py_str(reason ?? 'CDR 확인 필요'));
      }
      for (const scenario of scenarios) {
        const request = { ...deepcopy(scenario['battle']), squad: [...names], characters: deepcopy(growth) };
        evaluation_count += 1;
        const envelope = JSON.parse(run_request(JSON.stringify(request), true));
        const result = envelope['result'];
        const total = _float(result['squadTotal']);
        if (!isfinite(total) || total < 0) {
          throw ValueError('유효하지 않은 시뮬레이션 점수입니다.');
        }
        row['scenarios'].push({
          label: scenario['label'], total: total,
          diagnostics: _diagnostics(result),
          effectiveCharacters: envelope['effectiveCharacters'],
          deviations: get(result, 'deviations', ''),
          previewNote: get(result, 'previewNote', ''),
        });
      }
      row['status'] = 'evaluated';
    } catch (exc) {
      row['reason'] = _str_exc(exc);
    }
  });
  const feasible: Array<Record<string, any>> = [];
  const eligible = rows.filter((r) => r['status'] === 'evaluated');
  for (const group of combinations(eligible, count)) {
    const members = group.flatMap((row) => row['squad'] as string[]);
    const memberSet = new Set(members);
    if (memberSet.size !== 5 * count || ![...include].every((n) => memberSet.has(n))) {
      continue;
    }
    const totals = scenarios.map((_, s) => sum(group.map((r) => r['scenarios'][s]['total'] as number)));
    if (!totals.every((t) => isfinite(t))) {
      continue;
    }
    feasible.push({
      candidateIds: group.map((r) => r['id']), scenarioTotals: totals,
      baseTotal: totals[0],
    });
  }
  let best: number[];
  if (feasible.length) {
    best = scenarios.map((_, s) => maxBy(feasible.map((g) => g['scenarioTotals'][s] as number)));
    for (const group of feasible) {
      group['maxRegret'] = maxBy((group['scenarioTotals'] as number[]).map((t, i) => {
        const b = best[i]!;
        return truthy(b) ? (b - t) / b : 0.;
      }));
    }
    feasible.splice(0, feasible.length,
      ...sorted(feasible, (g) => [g['maxRegret'], -g['baseTotal'], g['candidateIds']]));
  } else {
    best = [];
  }
  const top = feasible.slice(0, 5);
  const result: Record<string, any> = {
    selected: top.length ? (top[0]!['candidateIds'] as number[]).map((i) => rows[i]) : [],
    solutions: top, candidates: rows, scenarios: scenarios,
    scope: {
      candidateCount: candidates.length, evaluatedCandidates: eligible.length,
      evaluationCount: evaluation_count, feasibleGroups: feasible.length,
      scenarioBestTotals: best, squadCount: count,
      optimality: 'supplied_candidate_pool_only', objective: 'minimax_relative_regret',
    },
    warnings: ['입력 후보 안에서만 비교했습니다. 전체 조합의 최적해가 아닙니다.',
      '출처는 제공된 후보 근거이며 이 실행에서 실시간 검증하지 않았습니다.',
      '결정론적 예상 피해량이며 통계적 신뢰도·캠페인 클리어 보장이 아닙니다.',
      '풀버스트 진단은 타임라인에 기록된 완료 구간 기준입니다.'],
  };
  if (!top.length) {
    result['warnings'].push('조건에 맞는 중복 없는 편성 묶음이 없습니다.');
  }
  _check_finite(result);
  return JSON.stringify(result);
}

/** 파이썬 `v != {}`의 반대 — 빈 사전인가. */
function _empty_dict(v: unknown): boolean {
  return _py_is_dict(v) && Object.keys(v).length === 0;
}
