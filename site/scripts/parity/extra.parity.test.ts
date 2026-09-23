/**
 * 전투력·육성 비교·추천·편성 정책 — 고속 엔진 ↔ 파이썬 3.12 대조.
 *
 *   uv run --python 3.12 --no-project python site/scripts/parity/extra_ref.py   # ref/extra/extra.json
 *   cd site && PARITY=1 npx vitest run scripts/parity/extra.parity.test.ts
 *
 * 케이스는 ref/extra/extra.json에 기록된 순서대로 돈다(커스텀 니케 주입이 엔진 전역에 남는다).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');
const REF = join(ROOT, 'site', 'scripts', 'parity', 'ref', 'extra', 'extra.json');
const enabled = process.env.PARITY === '1' && existsSync(REF);

function loadEngineFiles(): Record<string, unknown> {
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

function diffJson(a: unknown, b: unknown, path = '$', out: string[] = [], limit = 12): string[] {
  if (out.length >= limit) return out;
  if (typeof a === 'number' && typeof b === 'number') {
    if (!(a === b || (Number.isNaN(a) && Number.isNaN(b)))) out.push(`${path}: py=${a} ts=${b} (Δ=${b - a})`);
    return out;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) out.push(`${path}: py=${JSON.stringify(a)?.slice(0, 120)} ts=${JSON.stringify(b)?.slice(0, 120)}`);
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

describe.runIf(enabled)('전투력·육성 비교·추천·편성 정책 대조', () => {
  it('모든 케이스가 파이썬과 같다', async () => {
    const { setEngineData } = await import('../../src/engine/data');
    const bridge = await import('../../src/engine/bridge');
    const growth = await import('../../src/engine/growth_comparison');
    const rec = await import('../../src/engine/recommendation');
    const policy = await import('../../src/engine/squad_policy');
    setEngineData(loadEngineFiles());
    const refs: any[] = JSON.parse(readFileSync(REF, 'utf-8'));
    const only = process.env.PARITY_ONLY?.split(',').filter(Boolean) ?? [];
    const report: string[] = [];
    const counts: Record<string, [number, number]> = {};
    for (const ref of refs) {
      if (only.length && !only.some((p) => ref.id.startsWith(p))) continue;
      let response: unknown; let error: string | undefined;
      try {
        if (ref.kind === 'combatPower') response = JSON.parse(bridge.run_combat_power(JSON.stringify(ref.payload)));
        else if (ref.kind === 'compareGrowth') response = JSON.parse(growth.run_growth_comparison(JSON.stringify(ref.payload)));
        else if (ref.kind === 'recommend') response = JSON.parse(rec.run_recommendation(JSON.stringify(ref.payload)));
        else if (ref.fn === 'inspect') {
          const a = ref.args;
          response = JSON.parse(JSON.stringify(policy.inspect_squad_policy(a.squad, a.characters ?? null,
            a.purpose ?? 'recommendation', a.allow_no_cdr ?? false)));
        } else {
          response = JSON.parse(JSON.stringify(policy.query_squad_roles(ref.args.names ?? null, ref.args.characters ?? null)));
        }
      } catch (e) { error = `${(e as Error).name}: ${(e as Error).message}`; }
      const diffs: string[] = [];
      if (ref.error || error) {
        if (ref.error !== error) diffs.push(`오류 py=${ref.error} ts=${error}`);
      } else {
        diffJson(ref.response, response, '$', diffs, 12);
      }
      const c = (counts[ref.kind] ??= [0, 0]);
      c[1] += 1;
      if (diffs.length === 0) c[0] += 1;
      else report.push(`✗ ${ref.id}\n   ${diffs.join('\n   ')}`);
    }
    const summary = Object.entries(counts).map(([k, [p, t]]) => `${k} ${p}/${t}`).join(' · ');
    if (process.env.PARITY_OUT) writeFileSync(process.env.PARITY_OUT, summary + '\n' + report.join('\n') + '\n');
    console.log(summary + '\n' + report.join('\n'));
    expect(report, summary).toEqual([]);
  }, 600_000);
});
