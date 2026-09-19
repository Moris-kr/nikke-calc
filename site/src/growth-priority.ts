import type { SimulationRequest, SimulationResult } from './types';

export interface GrowthPriority {
  name: string;
  gain: number;
  standaloneGain: number;
  total: number;
  previousTotal: number;
}

/** Greedy marginal team damage, re-evaluated after each chosen upgrade. No invented weights. */
export async function recommendGrowth(
  before: SimulationRequest, target: SimulationRequest,
  baseline: SimulationResult, full: SimulationResult, names: string[],
  simulate: (request: SimulationRequest) => Promise<SimulationResult>,
  progress: (name: string) => void = () => {},
): Promise<GrowthPriority[]> {
  const candidates = [...new Set(names)];
  const cache = new Map<string, SimulationResult>([['', baseline], [candidates.slice().sort().join('\0'), full]]);
  const selected: string[] = [];
  const standalone = new Map<string, number>();
  const rows: GrowthPriority[] = [];
  let previous = baseline.squadTotal;
  while (selected.length < candidates.length) {
    let best: {name: string; total: number} | undefined;
    for (const name of candidates.filter(name => !selected.includes(name))) {
      progress(name);
      const upgraded = [...selected, name];
      const key = upgraded.slice().sort().join('\0');
      let result = cache.get(key);
      if (!result) {
        const request = structuredClone(before);
        request.characters ??= {};
        for (const chosen of upgraded) request.characters[chosen] = structuredClone(target.characters?.[chosen] ?? {});
        result = await simulate(request);
        cache.set(key, result);
      }
      if (!Number.isFinite(result.squadTotal)) throw new Error('육성 우선순위 계산 결과가 올바르지 않습니다.');
      if (!selected.length) standalone.set(name, result.squadTotal - baseline.squadTotal);
      // Equal gains retain squad order; personal damage does not penalize buffers.
      if (!best || result.squadTotal > best.total) best = {name, total: result.squadTotal};
    }
    if (!best) break;
    rows.push({name:best.name, gain:best.total-previous, standaloneGain:standalone.get(best.name) ?? 0, previousTotal:previous, total:best.total});
    selected.push(best.name); previous = best.total;
  }
  return rows;
}
