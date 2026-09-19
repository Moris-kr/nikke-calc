import type { SimulationRequest, SimulationResult } from './types';

export interface GrowthPriority {
  name: string;
  gain: number;
  standaloneGain: number;
  total: number;
  previousTotal: number;
}

export interface GlobalGrowthPriority { deckId: number; name: string; gain: number; before: number; after: number }
export const rankGlobalGrowth = (rows: GlobalGrowthPriority[]): GlobalGrowthPriority[] =>
  rows.slice().sort((a,b)=>b.gain-a.gain || a.deckId-b.deckId || a.name.localeCompare(b.name));

export async function standaloneGrowth(before: SimulationRequest, target: SimulationRequest, names: string[], full: SimulationResult,
  simulate: (request: SimulationRequest, name: string) => Promise<SimulationResult>): Promise<Map<string, SimulationResult>> {
  const results = new Map<string, SimulationResult>();
  for (const name of names) {
    const request = structuredClone(before); request.characters ??= {};
    request.characters[name] = structuredClone(target.characters?.[name] ?? {});
    const result = names.length === 1 ? full : await simulate(request, name);
    if (!Number.isFinite(result.squadTotal)) throw new Error('단독 육성 계산 결과가 올바르지 않습니다.');
    results.set(name, result);
  }
  return results;
}

/** Greedy marginal team damage, re-evaluated after each chosen upgrade. No invented weights. */
export async function recommendGrowth(
  before: SimulationRequest, target: SimulationRequest,
  baseline: SimulationResult, full: SimulationResult, names: string[],
  simulate: (request: SimulationRequest) => Promise<SimulationResult>,
  progress: (name: string) => void = () => {},
  singles: Map<string, SimulationResult> = new Map(),
): Promise<GrowthPriority[]> {
  const candidates = [...new Set(names)];
  const cache = new Map<string, SimulationResult>([['', baseline], [candidates.slice().sort().join('\0'), full]]);
  for (const [name,result] of singles) if(candidates.includes(name)) cache.set(name,result);
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
