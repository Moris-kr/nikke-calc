import { overloadLinesOf, overloadTotals } from './character-settings';
import type { EquipPart, OverloadLine, OverloadLines, SimulationRequest } from './types';
export const GROWTH_PARTS: EquipPart[] = ['머리', '몸통', '팔', '다리'];
export type GrowthTargets = Record<string, OverloadLines>;
export const growthPercent = (before: number, after: number): number | null => before > 0 ? (after / before - 1) * 100 : null;
export function verifiedLines(totals: Record<string, number>, lines: OverloadLines | undefined, steps: Record<string, number[]>): OverloadLines | undefined {
  if (!lines) return undefined;
  const actual = overloadTotals(overloadLinesOf(lines), steps);
  return [...new Set([...Object.keys(totals), ...Object.keys(actual)])].every(key => Math.abs((totals[key] ?? 0) - (actual[key] ?? 0)) < 0.011) ? structuredClone(lines) : undefined;
}
export function maximumRequest(request: SimulationRequest, targets: GrowthTargets, steps: Record<string, number[]>): SimulationRequest {
  const next = structuredClone(request);
  next.characters ??= {};
  for (const name of request.squad.filter(Boolean)) {
    const source = targets[name];
    if (!source) throw new Error(`${name}: 목표 옵션을 설정해 주세요.`);
    const lines = overloadLinesOf(source);
    for (const part of GROWTH_PARTS) {
      const seen = new Set<string>();
      for (const row of lines[part]) {
        if (!row.option) continue;
        if (!Number.isFinite(steps[row.option]?.[14])) throw new Error(`${name}: 지원하지 않는 옵션입니다.`);
        if (seen.has(row.option)) throw new Error(`${name} · ${part}: 같은 효과는 부위 내에 중복할 수 없습니다.`);
        seen.add(row.option);
        row.level = 15;
      }
    }
    next.characters[name] = { ...next.characters[name], overload: overloadTotals(lines, steps) };
    delete next.characters[name]!.overloadLines;
  }
  return next;
}
export function optionGap(current: OverloadLine | undefined, target: string, steps: Record<string, number[]>): string {
  if (!current) return target ? '부위 정보 없음 · 효과/수치 확인 필요' : '부위 정보 없음';
  if (current.option !== target) return target ? '효과변경 필요 · 변경 후 Lv.15 목표' : '효과 제거 필요';
  if (!target) return '빈 옵션 유지';
  const delta = (steps[target]?.[14] ?? 0) - (steps[target]?.[current.level - 1] ?? 0);
  return delta > 0.0001 ? `수치변경 ${Number(delta.toFixed(2))}%p 상승 필요` : '최대수치 달성';
}
