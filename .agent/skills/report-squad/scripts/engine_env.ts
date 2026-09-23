/**
 * 보고서 스크립트가 계산 엔진(`site/src/engine/`)을 저장소 파일로 돌리게 하는 준비.
 *
 *  - `ROOT` — 저장소 뿌리.
 *  - `loadEngine()` — 저장소 `data/`를 읽어 `setEngineData`로 넣는다. 파이썬 `json.load`처럼 float였던 값에
 *    표시를 남겨(캐릭터별 기본 레이어의 `7.0` 등) 보고서 JSON·이탈 표기가 파이썬 시절과 같게 나온다.
 *  - `calculation_paths()` — 계산 결과를 바꿀 수 있는 코드·데이터(캐시 지문용).
 *  - `run_one` / `run_jobs` — 시뮬 1회 + 집계. `jobs > 1`이면 worker_threads로 나눠 돈다
 *    (파이썬의 ProcessPoolExecutor 자리). 결과 순서는 작업 순서 그대로다.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import { ENGINE_DATA_FILES, hasEngineData, setEngineData } from '../../../../site/src/engine/data';
import { simulate } from '../../../../site/src/engine/timeline';
import { analyze_damage } from '../../../../site/src/engine/sim_result';
import { deepcopy } from '../../../../site/src/engine/py';
import { SystemExit, loadJson } from './pycompat';

/** 저장소 뿌리 (`.agent/skills/report-squad/scripts`에서 네 칸 위). */
export const ROOT = resolve(__dirname, '..', '..', '..', '..');

/** 엔진 데이터를 한 번 넣는다(float 표시 포함). */
export function loadEngine(): void {
  if (hasEngineData()) return;
  const files: Record<string, unknown> = {};
  for (const rel of Object.keys(ENGINE_DATA_FILES)) files[rel] = loadJson(join(ROOT, rel));
  setEngineData(files);
}

// ── 캐시 지문 대상 ─────────────────────────────────────────────────────────

function walk(dir: string, accept: (p: string) => boolean, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, accept, out);
    else if (st.isFile() && accept(p)) out.push(p);
  }
}

/** 계산 결과를 바꿀 수 있는 파일 — 엔진 TS 소스(테스트 제외)와 `data/**\/*.json`. 상대 경로 정렬. */
export function calculation_paths(): string[] {
  const out: string[] = [];
  walk(join(ROOT, 'site', 'src', 'engine'), (p) => p.endsWith('.ts') && !p.endsWith('.test.ts')
    && !p.split(sep).includes('tests'), out);
  walk(join(ROOT, 'data'), (p) => p.endsWith('.json'), out);
  const key = (p: string): string => relative(ROOT, p).split(sep).join('/');
  return out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

export function posixRel(p: string): string {
  return relative(ROOT, p).split(sep).join('/');
}

// ── 단일 시뮬 (워커) ───────────────────────────────────────────────────────

export interface RunOut {
  seed: number | null;
  squad_total: number;
  duration: number;
  burst_count: number;
  /** 캐릭터 → 집계. `skills`는 [이름, 딜, 히트] 목록(삽입 순서). */
  chars: Record<string, {
    total: number; normal: number; skill: number; fb_self: number; fb_other: number; non_fb: number;
    skills: Array<[string, number, number]>;
  }>;
}

export interface SimCase {
  name: string;
  squad: Array<Record<string, any>>;
  config: Record<string, any>;
  enemy: Record<string, any> | null;
}

/** 파이썬 `report.run_one` — 시뮬 1회 후 집계만 돌려준다. */
export function run_one(c: SimCase, seed: number | null): RunOut {
  loadEngine();
  const result = simulate(deepcopy(c.squad), deepcopy(c.config), deepcopy(c.enemy), true, seed);
  const chars: RunOut['chars'] = {};
  for (const name of c.squad.map((x) => x['name'] as string)) {
    const bd = analyze_damage(result, name);
    const skills: Array<[string, number, number]> = bd.normal_atk.hits
      ? [['일반공격', bd.normal_atk.damage, bd.normal_atk.hits]] : [];
    for (const [sname, stat] of Object.entries(bd._skill_detail)) {
      const at = skills.findIndex((s) => s[0] === sname);
      if (at >= 0) skills[at] = [sname, stat.damage, stat.hits];   // 파이썬 dict 덮어쓰기
      else skills.push([sname, stat.damage, stat.hits]);
    }
    chars[name] = {
      total: bd.total,
      normal: bd.normal_atk.damage,
      skill: bd.skill.damage,
      fb_self: bd.fb_self.damage,
      fb_other: bd.fb_other.damage,
      non_fb: bd.non_fb.damage,
      skills,
    };
  }
  let burst_count = 0;
  if (result.log) burst_count = result.log.burst_log.filter((e) => e.event === 'full_burst 시작').length;
  return { seed, squad_total: result.squad_total, duration: result.duration, burst_count, chars };
}

/**
 * 작업 목록을 돌린다. `jobs > 1`이면 워커 스레드 `jobs`개로 나눈다(각 워커가 엔진 데이터를 한 번 읽는다).
 * `onDone(i)`는 **작업 순서대로** 불린다(파이썬 `ex.map`처럼).
 */
export async function run_jobs(list: Array<[SimCase, number | null]>, jobs: number,
  onDone: (i: number) => void): Promise<RunOut[]> {
  const out: RunOut[] = new Array(list.length);
  if (jobs <= 1 || list.length <= 1) {
    list.forEach(([c, seed], i) => { out[i] = run_one(c, seed); onDone(i); });
    return out;
  }
  const tsx = require.resolve('tsx/cjs', { paths: [join(ROOT, 'site')] });
  const workerFile = join(__dirname, 'sim_worker.ts');
  const n = Math.min(jobs, list.length);
  let next = 0; let reported = 0;
  const done = new Array<boolean>(list.length).fill(false);
  const flush = (): void => {
    while (reported < list.length && done[reported]) { onDone(reported); reported += 1; }
  };
  await new Promise<void>((resolveAll, rejectAll) => {
    let alive = n; let failed = false;
    const workers: Worker[] = [];
    // 하나라도 실패하면 나머지 워커도 끝낸다(살아 있는 워커가 프로세스를 붙잡지 않게).
    const fail = (e: Error): void => {
      if (failed) return;
      failed = true;
      for (const w of workers) void w.terminate();
      rejectAll(e);
    };
    for (let w = 0; w < n; w += 1) {
      const worker = new Worker(
        `require(${JSON.stringify(tsx)}); require(${JSON.stringify(workerFile)});`, { eval: true });
      workers.push(worker);
      const feed = (): void => {
        if (failed) return;
        if (next >= list.length) { void worker.terminate(); return; }
        const i = next; next += 1;
        const [c, seed] = list[i]!;
        worker.postMessage({ i, c: { name: c.name, squad: c.squad, config: c.config, enemy: c.enemy }, seed });
      };
      worker.on('message', (m: { i: number; out?: RunOut; error?: string; systemExit?: boolean }) => {
        if (m.error !== undefined) {
          fail(m.systemExit ? SystemExit(m.error) : new Error(m.error));
          return;
        }
        out[m.i] = m.out!;
        done[m.i] = true;
        flush();
        feed();
      });
      worker.on('error', (e) => fail(e as Error));
      worker.on('exit', () => {
        alive -= 1;
        if (alive === 0 && !failed) resolveAll();
      });
      feed();
    }
  });
  flush();
  return out;
}
