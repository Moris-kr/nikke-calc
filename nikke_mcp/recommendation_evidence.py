"""Dated, public ENIKK observations. Never fetched live or treated as ratings."""
import json
from pathlib import Path


def evidence(mode='all'):
    root = Path(__file__).resolve().parents[1] / 'docs/research'
    result = {'accessedDate': '2026-09-18', 'live': False,
              'usage': 'Candidate seeds only. Confirm current mode/boss, growth, burst order and policy before simulation.',
              'algorithm': {'candidateLimit': 20, 'squadCount': '1..5', 'scenarioLimit': 3,
                  'formula': 'minimize max_s(1 - sum(D(team,s))/best_feasible_total(s)); tie: highest base total',
                  'constraints': ['effective team CDR in every squad (narrow Soda shotgun exception)',
                                  'five distinct characters; actual saved growth; no overlap across selected squads',
                                  'include in selected union; exclude from all squads; every scenario must succeed'],
                  'scope': 'Exact only within submitted candidates/scenarios. Not a global optimum or clear probability.'}}
    for key, filename in [('campaign', 'enikk-campaign-2026-09-18.json'), ('soloraid', 'enikk-raid-2026-09-18.json')]:
        if mode in ('all', key):
            result[key] = json.loads((root / filename).read_text(encoding='utf-8'))
    result['mechanismAnalysis'] = (root / 'recommendation-method.md').read_text(encoding='utf-8')
    return result
