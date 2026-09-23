/**
 * 고속 엔진 ↔ 파이썬 엔진 결과 대조.
 *
 *   uv run --python 3.12 --no-project python site/scripts/parity/ref.py   # 기준 답(ref/) 만들기
 *   PARITY=1 npx vitest run src/engine/parity.test.ts                     # 대조
 *   PARITY=1 PARITY_ONLY=golden: npx vitest run src/engine/parity.test.ts # 일부만
 *
 * 요청마다 run_request 응답 JSON 전체와 히트 목록(시각·시전자·대미지·스킬·태그·크리)을 비교한다.
 * 평소 테스트(`npm test`)에서는 건너뛴다 — 기준 답이 커서 저장소에 넣지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');
const PARITY_DIR = join(ROOT, 'site', 'scripts', 'parity');
const enabled = process.env.PARITY === '1' && existsSync(join(PARITY_DIR, 'ref'));

export function loadEngineFiles(): Record<string, unknown> {
  // 워커가 받는 것과 같은 파일을 저장소에서 바로 읽는다.
  const files: Record<string, unknown> = {};
  const rel = [
    'data/parsed_nikke.json', 'data/parsed_skills.json', 'data/char_defaults.json', 'data/weapon_delays.json',
    'data/weapon_mechanics.json', 'data/burst_gauge.json',
    ...['affinity', 'collection', 'console', 'cube', 'equipment_skills', 'equipment_stats', 'level_beyond', 'level_stats']
      .map((n) => `data/base_stat_tables/${n}.json`),
  ];
  for (const r of rel) files[r] = JSON.parse(readFileSync(join(ROOT, r), 'utf-8'));
  return files;
}

/** 두 JSON 값의 차이를 경로와 함께 모은다(최대 limit개). */
export function diffJson(a: unknown, b: unknown, path = '$', out: string[] = [], limit = 12): string[] {
  if (out.length >= limit) return out;
  if (typeof a === 'number' && typeof b === 'number') {
    if (!(a === b || (Number.isNaN(a) && Number.isNaN(b)))) out.push(`${path}: py=${a} ts=${b} (Δ=${b - a})`);
    return out;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) out.push(`${path}: py=${JSON.stringify(a)?.slice(0, 80)} ts=${JSON.stringify(b)?.slice(0, 80)}`);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${path}: 배열/객체 불일치`); return out; }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: 길이 py=${a.length} ts=${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length) && out.length < limit; i += 1) diffJson(a[i], b[i], `${path}[${i}]`, out, limit);
    return out;
  }
  const ka = Object.keys(a as object); const kb = Object.keys(b as object);
  for (const k of ka) if (!(k in (b as object))) out.push(`${path}.${k}: ts에 없음`);
  for (const k of kb) if (!(k in (a as object))) out.push(`${path}.${k}: py에 없음`);
  for (const k of ka) if (k in (b as object) && out.length < limit) diffJson((a as any)[k], (b as any)[k], `${path}.${k}`, out, limit);
  return out;
}

describe.runIf(enabled)('고속 엔진 대조', () => {
  const only = process.env.PARITY_ONLY?.split(',').filter(Boolean) ?? [];
  const refs = enabled ? readdirSync(join(PARITY_DIR, 'ref')).filter((f) => f.endsWith('.json')) : [];
  const corpus: Array<{ id: string; request: unknown }> = enabled
    ? JSON.parse(readFileSync(join(PARITY_DIR, 'corpus.json'), 'utf-8')) : [];
  const byId = new Map(corpus.map((c) => [c.id, c]));

  it('모든 요청이 파이썬과 같다', async () => {
    const { setEngineData } = await import('./data');
    const bridge = await import('./bridge');
    setEngineData(loadEngineFiles());
    const report: string[] = [];
    let pass = 0; let total = 0; let pyMs = 0; let tsMs = 0;
    for (const file of refs) {
      const ref = JSON.parse(readFileSync(join(PARITY_DIR, 'ref', file), 'utf-8'));
      if (!ref || Array.isArray(ref) || typeof ref.id !== 'string') continue;  // 다른 도구의 비교 파일
      if (only.length && !only.some((p) => ref.id.startsWith(p))) continue;
      const req = byId.get(ref.id)?.request;
      total += 1;
      const t0 = performance.now();
      let response: unknown; let error: string | undefined; let hits: any[] | undefined;
      try {
        response = JSON.parse(bridge.run_request(JSON.stringify(req)));
        hits = (bridge as any).__lastHits?.();
      } catch (e) { error = `${(e as Error).name}: ${(e as Error).message}`; }
      const ms = performance.now() - t0;
      tsMs += ms; pyMs += ref.ms ?? 0;
      const diffs: string[] = [];
      if (ref.error || error) {
        if (ref.error !== error) diffs.push(`오류 py=${ref.error} ts=${error}`);
      } else {
        diffJson(ref.hits ?? [], hits ?? [], 'hits', diffs, 6);
        diffJson(ref.response, response, '$', diffs, 12);
      }
      if (diffs.length === 0) pass += 1;
      else report.push(`✗ ${ref.id} (${ms.toFixed(0)}ms)\n   ${diffs.join('\n   ')}`);
    }
    const summary = `${pass}/${total} 일치 · 파이썬 ${(pyMs / 1000).toFixed(1)}s · TS ${(tsMs / 1000).toFixed(1)}s (×${(pyMs / Math.max(1, tsMs)).toFixed(1)})`;
    console.log(summary + '\n' + report.join('\n'));
    expect(report, summary).toEqual([]);
  }, 600_000);
});
