/**
 * 딜량 보고서 러너 (파이썬 `report.py`의 TS 이식 — 같은 입력이면 같은 캐시·HTML).
 *
 * JSON 케이스 스펙을 읽어 케이스마다 시뮬을 N회 돌리고, 결과를 자체완결 HTML로 낸다.
 *
 *   cd site && npx tsx ../.agent/skills/report-squad/scripts/report.ts ../.report-work/<이름>/spec.json
 *   cd site && npx tsx ../.agent/skills/report-squad/scripts/report.ts <스펙> --jobs 4 --open
 *   cd site && npx tsx ../.agent/skills/report-squad/scripts/report.ts <스펙> --sampled --runs 5
 *
 * 스펙 형식은 `.agent/skills/report-squad/references/format.md` 참조.
 * 출력: `reports/<스펙파일명>.html` (이미지·CSS·JS 전부 인라인, 외부 의존 없음)
 *
 * 난수 정책
 *   **기본은 기대값 모드**(`rng_mode: "expected"`)다 — 크리·코어히트를 확률 판정 대신 기대값으로 태워
 *   케이스당 1회로 끝낸다. `--sampled`는 인게임과 같은 확률 판정으로 돌린다 — 이때는 고정 시드셋
 *   [1..runs]을 모든 케이스에 동일하게 적용하고, `--random`을 주면 seed=None으로 돌린다.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, extname, resolve } from 'node:path';
import * as char_spec from '../../../../site/src/engine/spec';
import { _NIKKE } from '../../../../site/src/engine/timeline';
import { _deepcopy_marked, _is_float, _mark_float, _py_eq, _py_is_dict, _py_repr } from '../../../../site/src/engine/customization';
import { get, sorted, truthy } from '../../../../site/src/engine/py';
import { ROOT, calculation_paths, loadEngine, posixRel, run_jobs } from './engine_env';
import type { RunOut, SimCase } from './engine_env';
import { load_profile } from './profile';
import { render_html } from './report_html';
import type { GrowthProfile } from './profile';
import {
  SystemExit, dumps, floats, fmean, fmt, loadJson, openInBrowser, print, runMain, stdev, writeText,
} from './pycompat';
import {
  data_path, output_path, prepare, preserve_spec, slug_from_spec, write_index, write_manifest,
} from './report_workspace';

// ── 기본 육성 스펙 ─────────────────────────────────────────────────────────
// 정본은 엔진 `spec.ts`(= 파이썬 `context/spec.py`)의 DEFAULT_CHAR다.

export const REPORT_DEFAULT_CONFIG: Record<string, any> = floats({
  duration: 180.0,
  first_burst_time: 3.0,
  burst_switch_delay: 0.1,
  max_burst_count: 14,
  // 보고서 기본은 기대값 모드 — 케이스당 1회로 결정론적 기대딜이 나온다.
  rng_mode: 'expected',
}, 'duration', 'first_burst_time', 'burst_switch_delay');

export const DEFAULT_RUNS = 10;
export const CACHE_SCHEMA_VERSION = 3; // 3: rng_mode 도입 (기대값 모드가 기본)

/** 계산 결과를 바꿀 수 있는 코드·데이터의 지문. 표시만 바뀐 것은 캐시를 깨지 않는다. */
export function _calculation_fingerprint(): string {
  const digest = createHash('sha256');
  for (const path of calculation_paths()) {
    digest.update(Buffer.from(posixRel(path), 'utf-8'));
    digest.update(Buffer.from([0]));
    digest.update(readFileSync(path));
    digest.update(Buffer.from([0]));
  }
  return digest.digest('hex');
}

let _META: Record<string, any> | null = null;

export function _cache_meta(): Record<string, any> {
  if (_META === null) {
    _META = { schema: CACHE_SCHEMA_VERSION, calculation_fingerprint: _calculation_fingerprint() };
  }
  return { ..._META };
}

/** 지문이 없던 옛 캐시 — 의존 파일이 전부 그보다 오래됐으면 채택한다. */
export function _legacy_cache_compatible(cache_path: string): boolean {
  try {
    const stamp = statSync(cache_path, { bigint: true }).mtimeNs;
    return calculation_paths().every((p) => statSync(p, { bigint: true }).mtimeNs <= stamp);
  } catch {
    return false;
  }
}

export function _write_cache(path: string, payload: Record<string, any>): void {
  const tmp = path + '.tmp';
  writeText(tmp, dumps(payload));
  renameSync(tmp, path);
}

/** 시뮬 결과 하나를 좌우하는 입력의 정체. */
export function _case_key(c: Record<string, any>): string {
  return dumps({ squad: c['squad'], config: c['config'], enemy: c['enemy'] },
    { sortKeys: true, separators: [',', ':'] });
}

/** 수치는 그대로 쓰고 표시 메타데이터만 현재 스펙으로 바꾼다. */
function _refresh_case_metadata(result: Record<string, any>, c: Record<string, any>): Record<string, any> {
  const out = _deepcopy_marked(result);
  out['name'] = c['name'];
  out['group'] = get(c, 'group', '');
  out['variant'] = get(c, 'variant', '');
  out['note'] = get(c, 'note', '');
  out['squad'] = c['squad'].map((x: any) => x['name']);
  out['config'] = _deepcopy_marked(c['config']);
  out['enemy'] = _deepcopy_marked(c['enemy']);
  return out;
}

function _incremental_plan(spec: Record<string, any>, cached: Record<string, any>)
  : [Array<Record<string, any> | null>, Array<Record<string, any>>] {
  const old_spec_cases = (get(get(cached, 'spec', {}) || {}, 'cases') || []) as any[];
  const old_results = (get(cached, 'cases') || []) as any[];
  if (old_spec_cases.length !== old_results.length) {
    return [spec['cases'].map(() => null), [...spec['cases']]];
  }
  const buckets = new Map<string, any[]>();
  old_spec_cases.forEach((old_case, i) => {
    const k = _case_key(old_case);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(old_results[i]);
  });
  const slots: Array<Record<string, any> | null> = [];
  const pending: Array<Record<string, any>> = [];
  for (const c of spec['cases']) {
    const matches = buckets.get(_case_key(c)) || [];
    if (matches.length) slots.push(_refresh_case_metadata(matches.shift(), c));
    else { slots.push(null); pending.push(c); }
  }
  return [slots, pending];
}

function _combine_results(slots: Array<Record<string, any> | null>, calculated: Array<Record<string, any>>) {
  let i = 0;
  return slots.map((item) => (item === null ? calculated[i++]! : item));
}

// ── 스펙 로드·정규화 ───────────────────────────────────────────────────────

/** dict를 재귀 병합한다 (over 우선). 리스트는 통째로 교체. */
export function _deep_merge(base: Record<string, any>, over: Record<string, any> | null | undefined)
  : Record<string, any> {
  const out = _deepcopy_marked(base);
  const src = (truthy(over) ? over : {}) as Record<string, any>;
  for (const [k, v] of Object.entries(src)) {
    if (_py_is_dict(v) && _py_is_dict(out[k])) {
      out[k] = _deep_merge(out[k], v);
      _mark_float(out, k, false);
    } else {
      out[k] = _deepcopy_marked(v);
      _mark_float(out, k, _is_float(src, k));
    }
  }
  return out;
}

/** `burst_sequence_cycle` 패턴을 풀버스트 횟수만큼 늘려 burst_sequence로 바꾼다. */
function _expand_burst_sequence(cfg: Record<string, any>, max_count: any): void {
  const pattern = cfg['burst_sequence_cycle'];
  delete cfg['burst_sequence_cycle'];
  if (!truthy(pattern) || truthy(cfg['burst_sequence'])) return;
  const n = truthy(max_count) ? max_count : 20;
  cfg['burst_sequence'] = Array.from({ length: n }, (_, i) => _deepcopy_marked(pattern[i % pattern.length]));
}

/** 스펙 JSON을 읽어 케이스별 squad/config/enemy를 완전히 전개한다. */
export function load_spec(path: string): Record<string, any> {
  const spec = loadJson(path);
  const b = basename(path);
  return build_spec(spec, b.slice(0, b.length - extname(b).length));
}

const _sget = (d: any, k: string, dflt: any = {}): any => get(d, k, dflt);

/**
 * 스펙 dict → 케이스별 squad/config/enemy를 완전히 전개한 형태. 파일에서 읽은 스펙만이 아니라
 * 다른 도구가 메모리에서 만든 스펙도 같은 경로로 전개한다(육성 효율 보고서·지정 편성).
 */
export function build_spec(spec: Record<string, any>, title_fallback = 'report'): Record<string, any> {
  loadEngine();
  const known = new Set(Object.keys(_NIKKE()));

  const g_over = _deepcopy_marked(_sget(spec, 'defaults'));
  const g_config = _deep_merge(REPORT_DEFAULT_CONFIG, _sget(spec, 'config'));
  const g_enemy = _deepcopy_marked(_sget(spec, 'enemy'));

  // 육성 프로필(2.5층): 보고서 단위 스위치.
  const profile_name = get(spec, 'profile');
  const profile: GrowthProfile | null = truthy(profile_name)
    ? load_profile(profile_name, truthy(get(spec, 'allow_unowned')), get(spec, 'profile_level', 'fixed'))
    : null;

  const variants: any[] = truthy(get(spec, 'variants')) ? spec['variants']
    : [{ name: '', defaults: {}, config: {}, enemy: {} }];

  const cases: Array<Record<string, any>> = [];
  for (const v of variants) {
    for (const raw of spec['cases']) {
      const names: string[] = raw['squad'];
      const unknown = names.filter((n) => !known.has(n));
      if (unknown.length) {
        throw SystemExit(
          `[${get(raw, 'name', '?')}] parsed_nikke.json에 없는 이름: ${_py_repr(unknown)}\n`
          + '별칭이 아니라 정식 명칭을 써야 한다 (context/ALIASES.md).');
      }
      if (!(names.length >= 1 && names.length <= 5)) {
        throw SystemExit(`[${get(raw, 'name', '?')}] 스쿼드는 1~5명이어야 한다 (${names.length}명)`);
      }

      // 기본 스펙 → 캐릭터별 기본 레이어 → 스펙 defaults → variant.defaults → case.defaults → case.chars[이름].
      const overlay = _deep_merge(_deep_merge(g_over, _sget(v, 'defaults')), _sget(raw, 'defaults'));

      // `no_layer`: 그 캐릭터는 레이어를 건너뛴다 (`true`면 전원).
      const skip = new Set<string>();
      for (const src of [spec, v, raw]) {
        const nl = get(src, 'no_layer');
        if (nl === true) names.forEach((n) => skip.add(n));
        else if (truthy(nl)) (nl as string[]).forEach((x) => skip.add(x.trim()));
      }
      const outside = [...skip].filter((n) => !names.includes(n));
      if (outside.length && get(raw, 'no_layer') != null) {
        throw SystemExit(`[${get(raw, 'name', '?')}] no_layer 대상이 스쿼드에 없다: ${_py_repr(sorted(outside))}`);
      }

      const per_char: Record<string, any> = {};
      for (const n of names) per_char[n] = _deep_merge(overlay, get(_sget(raw, 'chars'), n, {}));
      // `members=names`를 반드시 넘긴다 — 조합 조건부 컨트롤은 스쿼드 전원을 봐야 판정된다.
      const squad = char_spec.resolve_patterns(
        names.map((n) => char_spec.build_char(n, per_char[n], null, skip.has(n), names, profile)),
        new Set(Object.entries(per_char).filter(([, x]) => 'burst_pattern' in x).map(([n]) => n)));

      let config = _deep_merge(_deep_merge(g_config, _sget(v, 'config')), _sget(raw, 'config'));

      // 풀버스트 상한: 스펙이 명시하지 않았으면 스쿼드가 잘리지 않을 만큼 올린다.
      const explicit = [spec, v, raw].some((s) => 'max_burst_count' in (get(s, 'config') || {}));
      const floor = char_spec.max_burst_floor(names);
      if (!explicit && truthy(floor)) {
        const cur = truthy(get(config, 'max_burst_count')) ? config['max_burst_count'] : 0;
        if (floor! > cur) {
          config['max_burst_count'] = floor;
          _mark_float(config, 'max_burst_count', false);
        }
      }

      _expand_burst_sequence(config, get(config, 'max_burst_count'));
      config = char_spec.build_config(squad, config);

      const enemy = _deep_merge(_deep_merge(g_enemy, _sget(v, 'enemy')), _sget(raw, 'enemy'));

      cases.push({
        name: truthy(get(raw, 'name')) ? raw['name'] : names.join(' / '),
        group: get(raw, 'group', ''),
        variant: get(v, 'name', ''),
        note: get(raw, 'note', ''),
        squad,
        config,
        enemy: truthy(enemy) ? enemy : null,
      });
    }
  }

  const all_chars = cases.flatMap((c) => c['squad']);
  const all_names = sorted(new Set(all_chars.map((c: any) => c['name'] as string)));
  const runs = get(spec, 'runs', DEFAULT_RUNS);
  return {
    title: truthy(get(spec, 'title')) ? spec['title'] : title_fallback,
    note: get(spec, 'note', ''),
    runs: typeof runs === 'string' ? parseInt(runs, 10) : Math.trunc(runs),
    profile: profile_name ?? null,
    profile_header: profile ? profile.header() : '',
    profile_notes: profile ? [...profile.notes(all_names), ...profile.cube_notes(all_chars)] : [],
    defaults: _deep_merge(char_spec._DEFAULT_CHAR(), g_over),
    config: g_config,
    enemy: g_enemy,
    cases,
  };
}

// ── 난수 모드 ──────────────────────────────────────────────────────────────

/** 전 케이스가 기대값 모드면 True. */
export function spec_is_expected(spec: Record<string, any>): boolean {
  const cases = (get(spec, 'cases') || []) as any[];
  return cases.length > 0 && cases.every((c) => (get(c['config'], 'rng_mode') || 'expected') === 'expected');
}

/** 스펙 전체를 확률 판정 모드로 되돌린다 (CLI `--sampled`/`--random`). */
export function force_sampled_mode(spec: Record<string, any>): void {
  if (!('config' in spec)) spec['config'] = {};
  spec['config']['rng_mode'] = 'random';
  for (const c of (get(spec, 'cases') || []) as any[]) c['config']['rng_mode'] = 'random';
}

/** (기대값 모드인가, 반복 횟수, 시드 목록). */
export function sampling_plan(spec: Record<string, any>, runs: number | null, random_seeds: boolean)
  : [boolean, number, Array<number | null>] {
  if (spec_is_expected(spec)) return [true, 1, [null]];
  const n = runs || Math.trunc(get(spec, 'runs', DEFAULT_RUNS));
  return [false, n, random_seeds ? Array(n).fill(null) : Array.from({ length: n }, (_, i) => i + 1)];
}

// ── 케이스 집계 ────────────────────────────────────────────────────────────

/** `_stats` — 평균·표준편차(float), 최소·최대(값 그대로), 개수. */
export function _stats(values: number[], valuesAreFloat = false): Record<string, any> {
  const mean = values.length ? fmean(values) : 0.0;
  const sd = values.length > 1 ? stdev(values) : 0.0;
  const out: Record<string, any> = {
    mean,
    std: sd,
    cv: mean ? sd / mean * 100 : 0.0,
    min: values.length ? Math.min(...values) : 0.0,
    max: values.length ? Math.max(...values) : 0.0,
    n: values.length,
  };
  floats(out, 'mean', 'std', 'cv');
  if (!values.length || valuesAreFloat) floats(out, 'min', 'max');
  return out;
}

/** run_one 결과 목록 → 케이스 1건의 보고서용 집계. */
export function aggregate(c: Record<string, any>, runs: RunOut[]): Record<string, any> {
  const n = runs.length;
  const order: string[] = c['squad'].map((x: any) => x['name']);
  const chars: Array<Record<string, any>> = [];
  for (const name of order) {
    const totals = runs.map((r) => r.chars[name]!.total);
    const skills = new Map<string, [number, number]>();
    for (const r of runs) {
      for (const [sname, dmg, hits] of r.chars[name]!.skills) {
        if (!skills.has(sname)) skills.set(sname, [0.0, 0.0]);
        const acc = skills.get(sname)!;
        acc[0] += dmg;
        acc[1] += hits;
      }
    }
    const st = _stats(totals);
    const row: Record<string, any> = { name };
    for (const [k, v] of Object.entries(st)) { row[k] = v; _mark_float(row, k, _is_float(st, k)); }
    row['normal'] = fmean(runs.map((r) => r.chars[name]!.normal));
    row['skill'] = fmean(runs.map((r) => r.chars[name]!.skill));
    row['fb_self'] = fmean(runs.map((r) => r.chars[name]!.fb_self));
    row['fb_other'] = fmean(runs.map((r) => r.chars[name]!.fb_other));
    row['non_fb'] = fmean(runs.map((r) => r.chars[name]!.non_fb));
    floats(row, 'normal', 'skill', 'fb_self', 'fb_other', 'non_fb');
    row['skills'] = sorted(
      [...skills].map(([s, v]) => floats({ name: s, damage: v[0] / n, hits: v[1] / n }, 'damage', 'hits')),
      (x) => -x.damage);
    chars.push(row);
  }

  const total = _stats(runs.map((r) => r.squad_total));
  const duration = runs.length ? runs[0]!.duration : 0.0;
  const out: Record<string, any> = {
    name: c['name'],
    group: get(c, 'group', ''),
    variant: get(c, 'variant', ''),
    note: c['note'],
    squad: order,
    config: c['config'],
    enemy: c['enemy'],
    total,
    dps: duration ? total['mean'] / duration : 0.0,
    duration,
    burst_count: runs.length ? fmean(runs.map((r) => r.burst_count)) : 0,
    // 회차별 원자료 — 육성 효율 보고서의 페어드 델타가 쓴다.
    runs: runs.map((r) => {
      const ch: Record<string, number> = {};
      for (const [nm, v] of Object.entries(r.chars)) ch[nm] = v.total;
      return { seed: r.seed, squad_total: r.squad_total, chars: ch };
    }),
    chars,
  };
  floats(out, 'dps', 'duration');
  if (runs.length) floats(out, 'burst_count');
  return out;
}

// ── 실행 ──────────────────────────────────────────────────────────────────

export async function run_report(spec: Record<string, any>, _runs: number, seeds: Array<number | null>,
  jobs: number): Promise<Array<Record<string, any>>> {
  const jobs_list: Array<[SimCase, number | null]> = [];
  for (const c of spec['cases']) for (const seed of seeds) jobs_list.push([c as SimCase, seed]);

  const t0 = performance.now();
  let done = 0;
  const total_jobs = jobs_list.length;
  const outputs = await run_jobs(jobs_list, jobs, (i) => {
    done += 1;
    const [c, seed] = jobs_list[i]!;
    const el = (performance.now() - t0) / 1000;
    print(`  [${done}/${total_jobs}] ${c.name}  seed=${seed === null ? 'None' : seed}  (${fmt(el, '.1f')}s)`);
  });

  const per_case: Array<Record<string, any>> = [];
  const k = seeds.length;
  spec['cases'].forEach((c: any, i: number) => {
    per_case.push(aggregate(c, outputs.slice(i * k, (i + 1) * k)));
  });
  return per_case;
}

/** 자동 병렬 수 — 파이썬 `min(os.cpu_count() or 1, max(1, n), 8)`. */
export function autoJobs(work: number): number {
  return Math.min(availableParallelism() || 1, Math.max(1, work), 8);
}

// ── CLI 인자 ───────────────────────────────────────────────────────────────

export interface ArgSpec {
  prog: string;
  description: string;
  positional: string[];
  /** 이름 → 'bool' | 'int' | 'str' */
  options: Record<string, 'bool' | 'int' | 'str'>;
  help: string;
}

/** argparse 흉내 — `--이름 값`/`--이름=값`/불리언 플래그. 오류면 사용법과 함께 2로 끝난다. */
export function parseArgs(spec: ArgSpec, argv: string[] = process.argv.slice(2)): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, t] of Object.entries(spec.options)) out[k] = t === 'bool' ? false : null;
  const pos: string[] = [];
  const usage = `usage: ${spec.prog} [-h] ${spec.positional.join(' ')}`;
  const fail = (msg: string): never => {
    process.stderr.write(`${usage}\n${spec.prog}: error: ${msg}\n`);
    process.exit(2);
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '-h' || a === '--help') {
      print(`${usage}\n\n${spec.description}\n\n${spec.help}`);
      process.exit(0);
    }
    if (a.startsWith('--')) {
      const [flag, inline] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
      const key = flag.slice(2).replace(/-/g, '_');
      const t = spec.options[key];
      if (!t) fail(`unrecognized arguments: ${a}`);
      if (t === 'bool') { out[key] = true; continue; }
      const val = inline ?? argv[++i];
      if (val === undefined) fail(`argument ${flag}: expected one argument`);
      if (t === 'int') {
        if (!/^[+-]?\d+$/.test(val!.trim())) fail(`argument ${flag}: invalid int value: '${val}'`);
        out[key] = parseInt(val!, 10);
      } else out[key] = val;
      continue;
    }
    pos.push(a);
  }
  if (pos.length < spec.positional.length) {
    fail(`the following arguments are required: ${spec.positional.slice(pos.length).join(', ')}`);
  }
  if (pos.length > spec.positional.length) fail(`unrecognized arguments: ${pos.slice(spec.positional.length).join(' ')}`);
  spec.positional.forEach((p, i) => { out[p] = pos[i]; });
  return out;
}

const HELP = `options:
  --runs RUNS    케이스당 반복 횟수 (--sampled일 때만 의미가 있다. 기본: 스펙의 runs, 없으면 10)
  --sampled      기대값 모드 대신 인게임과 같은 확률 판정으로 N회 돌려 평균낸다 (분산·CV를 보고 싶을 때만)
  --random       확률 판정 + 고정 시드 대신 매번 다른 난수로 실행 (--sampled 포함)
  --jobs JOBS    병렬 워커 수 (0=자동, 1=직렬)
  --out OUT      출력 HTML 경로 (기본 reports/<스펙명>.html)
  --from-cache   시뮬을 다시 돌리지 않고 직전 실행 결과(.data.json)로 HTML만 다시 만든다
  --full         호환되는 기존 케이스도 재사용하지 않고 전부 다시 계산한다
  --open         생성 후 브라우저로 연다`;

async function main(): Promise<void> {
  const args = parseArgs({
    prog: 'report.ts', description: '딜량 보고서 생성 (HTML)', positional: ['spec'], help: HELP,
    options: { runs: 'int', sampled: 'bool', random: 'bool', jobs: 'int', out: 'str', from_cache: 'bool', full: 'bool', open: 'bool' },
  });
  if (args.from_cache && args.full) {
    process.stderr.write('usage: report.ts [-h] spec\nreport.ts: error: --from-cache와 --full은 함께 쓸 수 없다\n');
    process.exit(2);
  }
  args.jobs = args.jobs ?? 0;

  const slug = slug_from_spec(args.spec);
  prepare(slug);
  const out = args.out ? resolve(args.out) : output_path(slug);
  const cache_path = data_path(slug);

  let spec: Record<string, any>;
  let cases: Array<Record<string, any>>;
  let seeds: Array<number | null>;
  let expected: boolean;

  if (args.from_cache) {
    const cached = loadJson(cache_path);
    if (!truthy(get(cached, 'cache_meta')) && _legacy_cache_compatible(cache_path)) {
      cached['cache_meta'] = _cache_meta();
      _write_cache(cache_path, cached);
      print(`[보고서] 기존 캐시에 계산 지문 기록: ${cache_path}`);
    }
    spec = cached['spec']; cases = cached['cases'];
    seeds = cached['seeds'];
    args.random = cached['random'];
    expected = 'expected' in cached ? cached['expected'] : spec_is_expected(spec);
    print(`[보고서] 캐시 재렌더링: ${cache_path}`);
  } else {
    preserve_spec(args.spec, slug);
    spec = load_spec(args.spec);
    if (args.sampled || args.random) force_sampled_mode(spec);
    let runs: number;
    [expected, runs, seeds] = sampling_plan(spec, args.runs, args.random);
    if (expected && args.runs && args.runs > 1) {
      print('  · 기대값 모드라 --runs는 무시한다 (난수가 없어 1회로 확정된다). 분산을 보려면 --sampled');
    }
    const meta = _cache_meta();
    let slots: Array<Record<string, any> | null> = spec['cases'].map(() => null);
    let pending: Array<Record<string, any>> = [...spec['cases']];
    let reuse_reason = '캐시 없음';

    if (existsSync(cache_path) && !args.full) {
      try {
        const cached = loadJson(cache_path);
        const same_engine = _py_eq(get(cached, 'cache_meta'), meta)
          || (!truthy(get(cached, 'cache_meta')) && _legacy_cache_compatible(cache_path));
        const same_sampling = _py_eq(get(cached, 'seeds'), seeds) && !!get(cached, 'random') === !!args.random;
        if (same_engine && same_sampling) {
          [slots, pending] = _incremental_plan(spec, cached);
          reuse_reason = '호환 캐시';
        } else if (!same_engine) reuse_reason = '계산 코드·데이터 변경';
        else reuse_reason = '시드·반복 조건 변경';
      } catch (exc) {
        reuse_reason = `캐시 읽기 실패: ${(exc as Error).message}`;
      }
    } else if (args.full) {
      reuse_reason = '--full 요청';
    }

    const reused = spec['cases'].length - pending.length;
    const jobs = args.jobs || autoJobs(runs * pending.length);
    const mode_txt = expected ? '기대값 모드 — 난수 없음'
      : `확률 판정 · 시드 ${args.random ? '랜덤' : `1~${runs} 고정`}`;
    print(`[보고서] ${spec['title']}  전체 ${spec['cases'].length}개 · 재사용 ${reused}개 · `
      + `계산 ${pending.length}개 × ${runs}회  (${mode_txt}, 병렬 ${jobs})`);
    if (!reused) print(`  전체 계산 사유: ${reuse_reason}`);
    const note = char_spec.preview_note(
      sorted(new Set(spec['cases'].flatMap((c: any) => c['squad'].map((x: any) => get(x, 'name', ''))))) as string[]);
    if (note) print(`⚠ ${note}`);
    if (truthy(get(spec, 'profile_header'))) print(`⚠ ${spec['profile_header']}`);
    for (const line of (get(spec, 'profile_notes') || []) as string[]) print(`⚠ ${line}`);
    const calculated = pending.length ? await run_report({ ...spec, cases: pending }, runs, seeds, jobs) : [];
    cases = _combine_results(slots, calculated);
    _write_cache(cache_path, {
      spec, cases, seeds, random: !!args.random, expected, cache_meta: meta,
    });
  }

  const html = render_html(spec, cases, seeds, !!args.random, expected);
  writeText(out, html);
  write_manifest(slug, 'report-squad', get(spec, 'title', slug));
  write_index();
  print(`\n생성: ${out}  (${fmt(statSync(out).size / 1024, '.0f')} KB)`);

  for (const c of cases) {
    const label = truthy(get(c, 'variant')) ? `${c['name']} — ${c['variant']}` : c['name'];
    const spread = c['total']['n'] <= 1 ? ''
      : `  ±${fmt(c['total']['std'], '>12,.0f')}  (CV ${fmt(c['total']['cv'], '.2f')}%)`;
    print(`  ${fmt(label, '<44')} ${fmt(c['total']['mean'], '>16,.0f')}${spread}`);
  }

  if (args.open) openInBrowser(out);
}

// 직접 실행할 때만 돈다(growth·optimize가 import해 쓴다).
if (require.main === module) runMain(main);

export { ROOT };
