"""Exact disjoint selection over a bounded, externally supplied candidate pool.

Scores are deterministic simulations, not clear probabilities or confidence.
This module never reads a saved profile or changes submitted account growth.
"""
from __future__ import annotations

from copy import deepcopy
from itertools import combinations
import json
import math

from context import spec as char_spec
try:
    from bridge import run_request
except ImportError:
    from .bridge import run_request
try:
    from squad_policy import inspect_squad_policy
except ImportError:
    from nikke_mcp.squad_policy import inspect_squad_policy


SCENARIO_FIELDS = frozenset({'enemyDef', 'corePx', 'coreWindows', 'hasParts',
    'defenseRateWindows', 'elementWindows', 'immuneWindows', 'firstBurstTime', 'burstRegenTime',
    'optimalRangeWeapons', 'optimalRangeWindows'})
GROWTH_FIELDS = frozenset({'growthStage', 'skillLevels', 'overload', 'cube',
    'collection', 'manualStats', 'equipLevels', 'overloadLines'})


def _names(value, label):
    if not isinstance(value, list) or any(not isinstance(n, str) or not n.strip() for n in value):
        raise ValueError(f'{label}: 이름 배열이 필요합니다.')
    return [n.strip() for n in value]


def _diagnostics(result):
    # Older cached results contain completed spans only; new bridge results
    # include the final interval clipped to the battle duration.
    spans = result.get('timeline', {}).get('fullBurst', [])
    duration = float(result['duration'])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('유효하지 않은 전투 시간입니다.')
    valid = []
    for start, end in spans:
        start, end = float(start), float(end)
        if not all(math.isfinite(x) for x in (start, end)) or end < start:
            raise ValueError('유효하지 않은 풀버스트 기록입니다.')
        valid.append((max(0., start), min(duration, end)))
    valid.sort()
    return {'fullBurstCount': len(valid),
            'gaps': [max(0., b[0] - a[1]) for a, b in zip(valid, valid[1:])],
            'uptime': sum(max(0., end - start) for start, end in valid) / duration,
            'completedSpansOnly': 'fullBurstSummary' not in result.get('timeline', {})}


def run_recommendation(raw: str) -> str:
    """Evaluate <=20 candidates against base + <=2 battle-only variations.

    Include constraints apply to the union of selected squads. Slot order is
    preserved. Any failed scenario disqualifies its entire candidate.
    """
    payload = json.loads(raw)
    candidates = payload.get('candidates')
    if not isinstance(candidates, list) or not 1 <= len(candidates) <= 20:
        raise ValueError('후보는 1~20개여야 합니다.')
    count = payload.get('squadCount', 1)
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 5:
        raise ValueError('스쿼드 수는 1~5여야 합니다.')
    roster = payload.get('roster')
    battle = payload.get('battle')
    if not isinstance(roster, dict) or not isinstance(battle, dict):
        raise ValueError('보유 육성과 전투 조건이 필요합니다.')
    if any(k in battle for k in ('characters', 'squad', 'customCharacters')):
        raise ValueError('전투 조건에 편성·육성을 넣을 수 없습니다.')
    include = set(_names(payload.get('include', []), 'include'))
    exclude = set(_names(payload.get('exclude', []), 'exclude'))
    if include & exclude:
        raise ValueError('포함·제외 조건이 충돌합니다.')
    base = deepcopy(battle)
    base['rngMode'] = 'expected'
    base.setdefault('seed', 42)
    scenarios = [{'label': '기본', 'battle': base}]
    extras = payload.get('scenarios', [])
    if not isinstance(extras, list) or len(extras) > 2:
        raise ValueError('추가 시나리오는 최대 2개입니다 (기본 포함 3개).')
    for scenario in extras:
        if not isinstance(scenario, dict) or not isinstance(scenario.get('battle'), dict):
            raise ValueError('시나리오 전투 조건이 필요합니다.')
        forbidden = set(scenario['battle']) - SCENARIO_FIELDS
        if forbidden:
            raise ValueError(f'시나리오에서 변경할 수 없는 조건: {sorted(forbidden)}')
        scenarios.append({'label': str(scenario.get('label') or f'조건 {len(scenarios)}'),
                          'battle': {**deepcopy(base), **deepcopy(scenario['battle'])}})
    canonical = char_spec._nikke()
    rows = []
    evaluation_count = 0
    for index, candidate in enumerate(candidates):
        row = {'id': index, 'label': str(candidate.get('label', index)) if isinstance(candidate, dict) else str(index),
               'status': 'rejected', 'scenarios': []}
        rows.append(row)
        try:
            if not isinstance(candidate, dict):
                raise ValueError('후보 객체가 필요합니다.')
            names = _names(candidate.get('squad'), 'squad')
            row['squad'] = names
            row['sourceUrl'] = candidate.get('sourceUrl')
            row['sourceReason'] = candidate.get('reason')
            if len(names) != 5 or len(set(names)) != 5:
                raise ValueError('서로 다른 정식 캐릭터 5명이 필요합니다.')
            if set(names) - set(canonical):
                raise ValueError('정본에 없는 캐릭터: ' + ', '.join(sorted(set(names) - set(canonical))))
            if set(names) & exclude:
                raise ValueError('제외 캐릭터가 포함된 후보입니다.')
            missing = [n for n in names if not isinstance(roster.get(n), dict) or not any(
                k in GROWTH_FIELDS and v is not None and v != {} and v != [] for k, v in roster[n].items())]
            if missing:
                raise ValueError('실제 육성 누락: ' + ', '.join(missing))
            growth = {n: deepcopy(roster[n]) for n in names}
            policy = inspect_squad_policy(names, characters=deepcopy(growth), purpose='recommendation')
            row['policy'] = policy
            if not policy.get('recommendedEligible'):
                raise ValueError('추천 편성 정책 미충족 또는 쿨타임 감소 조건 미검증: ' + str(policy.get('confirmationReason') or policy.get('status') or 'CDR 확인 필요'))
            for scenario in scenarios:
                request = {**deepcopy(scenario['battle']), 'squad': names[:], 'characters': deepcopy(growth)}
                evaluation_count += 1
                envelope = json.loads(run_request(json.dumps(request, ensure_ascii=False), include_effective=True))
                result = envelope['result']
                total = float(result['squadTotal'])
                if not math.isfinite(total) or total < 0:
                    raise ValueError('유효하지 않은 시뮬레이션 점수입니다.')
                row['scenarios'].append({'label': scenario['label'], 'total': total,
                    'diagnostics': _diagnostics(result),
                    'effectiveCharacters': envelope['effectiveCharacters'],
                    'deviations': result.get('deviations', ''),
                    'previewNote': result.get('previewNote', '')})
            row['status'] = 'evaluated'
        except Exception as exc:
            row['reason'] = str(exc)
    feasible = []
    eligible = [r for r in rows if r['status'] == 'evaluated']
    for group in combinations(eligible, count):
        members = [n for row in group for n in row['squad']]
        if len(set(members)) != 5 * count or not include <= set(members):
            continue
        totals = [sum(r['scenarios'][s]['total'] for r in group) for s in range(len(scenarios))]
        if not all(math.isfinite(t) for t in totals):
            continue
        feasible.append({'candidateIds': [r['id'] for r in group], 'scenarioTotals': totals,
                         'baseTotal': totals[0]})
    if feasible:
        best = [max(g['scenarioTotals'][s] for g in feasible) for s in range(len(scenarios))]
        for group in feasible:
            group['maxRegret'] = max((b - t) / b if b else 0. for t, b in zip(group['scenarioTotals'], best))
        feasible.sort(key=lambda g: (g['maxRegret'], -g['baseTotal'], g['candidateIds']))
    else:
        best = []
    top = feasible[:5]
    result = {'selected': [rows[i] for i in top[0]['candidateIds']] if top else [],
        'solutions': top, 'candidates': rows, 'scenarios': scenarios,
        'scope': {'candidateCount': len(candidates), 'evaluatedCandidates': len(eligible),
                  'evaluationCount': evaluation_count, 'feasibleGroups': len(feasible),
                  'scenarioBestTotals': best, 'squadCount': count,
                  'optimality': 'supplied_candidate_pool_only', 'objective': 'minimax_relative_regret'},
        'warnings': ['입력 후보 안에서만 비교했습니다. 전체 조합의 최적해가 아닙니다.',
                     '출처는 제공된 후보 근거이며 이 실행에서 실시간 검증하지 않았습니다.',
                     '결정론적 예상 피해량이며 통계적 신뢰도·캠페인 클리어 보장이 아닙니다.',
                     '풀버스트 진단은 타임라인에 기록된 완료 구간 기준입니다.']}
    if not top:
        result['warnings'].append('조건에 맞는 중복 없는 편성 묶음이 없습니다.')
    return json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
