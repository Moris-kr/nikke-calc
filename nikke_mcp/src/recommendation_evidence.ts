/** Dated, public ENIKK observations. Never fetched live or treated as ratings. (py: nikke_mcp/recommendation_evidence.py) */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './engine.ts';

export type EvidenceMode = 'all' | 'campaign' | 'soloraid';

export function evidence(mode: EvidenceMode = 'all'): Record<string, unknown> {
  const root = join(ROOT, 'docs/research');
  const result: Record<string, unknown> = {
    accessedDate: '2026-09-18', live: false,
    usage: 'Candidate seeds only. Confirm current mode/boss, growth, burst order and policy before simulation.',
    algorithm: {
      candidateLimit: 20, squadCount: '1..5', scenarioLimit: 3,
      formula: 'minimize max_s(1 - sum(D(team,s))/best_feasible_total(s)); tie: highest base total',
      constraints: ['effective team CDR in every squad (narrow Soda shotgun exception)',
        'five distinct characters; actual saved growth; no overlap across selected squads',
        'include in selected union; exclude from all squads; every scenario must succeed'],
      scope: 'Exact only within submitted candidates/scenarios. Not a global optimum or clear probability.',
    },
  };
  for (const [key, filename] of [['campaign', 'enikk-campaign-2026-09-18.json'], ['soloraid', 'enikk-raid-2026-09-18.json']] as const) {
    if (mode === 'all' || mode === key) result[key] = JSON.parse(readFileSync(join(root, filename), 'utf8'));
  }
  // Python read_text() uses universal newlines: CRLF checkouts still yield LF.
  result['mechanismAnalysis'] = readFileSync(join(root, 'recommendation-method.md'), 'utf8').replace(/\r\n?/g, '\n');
  return result;
}
