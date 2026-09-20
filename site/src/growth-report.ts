import { calculatePlan, MATERIAL_NAMES, type PlanRow } from './skill-planner';
import type { SimulationRequest, SettingsCatalog } from './types';

export function growthSkillPlan(before: SimulationRequest, after: SimulationRequest, excluded: string[], settings: SettingsCatalog): PlanRow[] {
  return before.squad.filter(name => name && !excluded.includes(name)).map(name => {
    const current = (['1','2','3'] as const).map(key => before.characters?.[name]?.skillLevels?.[key] ?? settings.characters[name]?.skillLevels?.[key] ?? 10);
    return {name, current, target: current.map((lv,i) => Math.max(lv, after.characters?.[name]?.skillLevels?.[(['1','2','3'] as const)[i]!] ?? lv))};
  });
}

export function skillMaterialLines(rows: PlanRow[]): string[] {
  return rows.map(row => {
    if (row.current.every((lv,i) => lv === row.target[i])) return `${row.name} · 추가 스킬 재료 없음`;
    try {
      const cost = calculatePlan([row], {}).required;
      return `${row.name} · ${row.current.join('/')} → ${row.target.join('/')} · ${Object.entries(cost).map(([key,n]) => `${MATERIAL_NAMES[key] ?? key} ${n.toLocaleString('ko-KR')}개`).join(' · ')}`;
    } catch { return `${row.name} · 스킬 재료 데이터 미확인`; }
  });
}

export function mergeSkillPlans(rows: PlanRow[]): PlanRow[] {
  const unique = new Map<string, PlanRow>();
  for (const row of rows) {
    const old = unique.get(row.name);
    if (!old) unique.set(row.name, structuredClone(row));
    else {
      old.current = old.current.map((lv,i) => Math.min(lv,row.current[i]!));
      old.target = old.target.map((lv,i) => Math.max(lv,row.target[i]!));
    }
  }
  return [...unique.values()];
}

export function skillTotalLines(rows: PlanRow[]): string[] {
  const totals: Record<string,number> = {}; const missing: string[] = [];
  for (const row of mergeSkillPlans(rows)) {
    if (row.current.every((lv,i) => lv === row.target[i])) continue;
    try { for (const [key,n] of Object.entries(calculatePlan([row],{}).required)) totals[key] = (totals[key] ?? 0) + n; }
    catch { missing.push(row.name); }
  }
  return [...Object.entries(totals).map(([key,n]) => `${MATERIAL_NAMES[key] ?? key} ${n.toLocaleString('ko-KR')}개`),
    ...(missing.length ? [`재료 미확인 · 합계 제외: ${missing.join(', ')}`] : []),
    ...(!Object.keys(totals).length && !missing.length ? ['추가 스킬 재료 없음'] : [])];
}

export function rankModuleResults(rows: Record<string,unknown>[]): Record<string,unknown>[] {
  const score = (r:Record<string,unknown>) => !r.error && Number(r.total)>0 && Number.isFinite(Number(r.damagePerModule)) ? Number(r.damagePerModule) : -Infinity;
  return [...rows].sort((a,b) => score(b)-score(a) || Number(a.deckId)-Number(b.deckId) || String(a.name).localeCompare(String(b.name)));
}

/** Export the rendered result, including collapsed details, without runtime scripts or controls. */
export function growthReportHtml(output: HTMLElement, css: string): string {
  const copy = output.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('button,input,select,script,iframe').forEach(el=>el.remove());
  copy.querySelectorAll('details').forEach(el=>el.open=true);
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>니케 육성효율 보고서</title><style>${css}</style><style>body{background:#080e19;color:#e4edf9;font-family:system-ui,sans-serif;margin:0;padding:24px}main{max-width:1200px;margin:auto}table{width:100%;border-collapse:collapse}td,th{padding:10px;text-align:left;border-bottom:1px solid #354156}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#b4baff}details{margin:16px 0}p,li{overflow-wrap:anywhere}h1{color:#c4b5fd}</style><body><main><h1>니케 육성효율 보고서</h1><p>저장 시각: ${new Date().toLocaleString('ko-KR')} · 계산 완료된 결과 및 상세 설명</p>${copy.outerHTML}</main></body></html>`;
}
