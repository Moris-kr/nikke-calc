/**
 * 솔로레이드 N스쿼드 보고서 (파이썬 `optimize_solo_raid.py`의 이식).
 *
 * 두 가지 모드가 있다.
 *
 * - **최적화**: 기존 딜량 보고서 캐시의 후보 중 캐릭터가 겹치지 않는 정확히 N개
 *   스쿼드를 고르는 weighted set packing을 분기 한정법으로 정확히 푼다. 새 시뮬은 없다.
 * - **지정 편성**(`pinned_squads`): 사용자가 N×5명을 직접 지정한다. 후보 캐시에 같은
 *   편성이 있으면 그 결과를 쓰고, 없으면 그 스쿼드만 새로 시뮬한다.
 *
 * 두 모드는 한 스펙 안에서 탭으로 섞을 수 있다 — 지정 편성 탭은 같은 보고서의
 * 최적해 대비 차이를 함께 보여준다.
 *
 *   cd site && npx tsx ../.agent/skills/report-squad/scripts/optimize_solo_raid.ts ../.report-work/<슬러그>/spec.json
 *   cd site && npx tsx ../.agent/skills/report-squad/scripts/optimize_solo_raid.ts <스펙> --jobs 8
 */

import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { _deepcopy_marked, _py_eq, _py_repr } from '../../../../site/src/engine/customization';
import { get, sorted, sum, truthy } from '../../../../site/src/engine/py';
import { ROOT } from './engine_env';
import { _kor, render_html } from './optimize_html';
import {
  dumps, floats, fmt, isoSeconds, loadJson, merged, openInBrowser, print, runMain, writeText,
} from './pycompat';
import * as report from './report';
import {
  WORK_DIR, bundle_dir, data_path as work_data_path, output_path, preserve_spec, samePath, slug_from_spec,
  stem, write_index, write_manifest,
} from './report_workspace';

function _canonical(value: unknown): string {
  return dumps(value, { sortKeys: true, separators: [',', ':'] });
}

function _matches(actual: Record<string, any>, required: Record<string, any>): boolean {
  return Object.entries(required).every(([k, v]) => _py_eq(get(actual, k), v));
}

const _stats = (values: number[]): Record<string, any> => report._stats(values, true);

const ValueError = (msg: string): Error => new Error(`ValueError: ${msg}`);

/** `str(path.relative_to(ROOT))` — 저장소 밖이면 파이썬처럼 실패한다. */
function relToRoot(p: string): string {
  const rel = relative(ROOT, p);
  if (rel.startsWith('..') || isAbsolute(rel)) throw ValueError(`'${p}' is not in the subpath of '${ROOT}'`);
  return rel;
}

class Candidate {
  id!: string;
  name!: string;
  squad!: string[];
  damage!: number;
  total!: Record<string, any>;
  burst_count!: number;
  config!: Record<string, any>;
  enemy!: Record<string, any>;
  runs!: Map<number, number>;
  source!: string;
  source_index!: number;
  signature!: string;
  mask: bigint = 0n;
  simulated = false;
  provenance: Array<Record<string, any>> = [];

  constructor(kw: Partial<Candidate>) { Object.assign(this, kw); }
}

function _resolveSource(value: string, spec_path: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(dirname(spec_path), value);
}

function _load_candidates(spec: Record<string, any>, spec_path: string, allow_empty = false)
  : [Candidate[], Record<string, any>, Array<Record<string, any>>] {
  const target = spec['target'];
  const required_enemy = target['enemy'];
  const required_config = get(target, 'config', {});
  const excluded_members = new Set<string>(get(spec, 'exclude_members', []));
  const sources: Array<Record<string, any>> = [];
  const candidates: Candidate[] = [];
  let reference_defaults: Record<string, any> | null = null;

  for (const source_value of (get(spec, 'sources') || []) as string[]) {
    const source_path = _resolveSource(source_value, spec_path);
    const data = loadJson(source_path);
    const report_spec = data['spec'];
    const cases = (get(data, 'cases', []) || []) as any[];
    const resolved_cases = (get(report_spec, 'cases', []) || []) as any[];
    if (cases.length !== resolved_cases.length) {
      throw ValueError(`${basename(source_path)}: 결과 ${cases.length}개와 전개 케이스 `
        + `${resolved_cases.length}개가 다릅니다.`);
    }

    const defaults = get(report_spec, 'defaults', {});
    if (reference_defaults === null) reference_defaults = defaults;
    else if (get(spec, 'require_same_defaults', true) && !_py_eq(defaults, reference_defaults)) {
      throw ValueError(`${basename(source_path)}: 첫 소스와 기본 육성 스펙이 다릅니다.`);
    }

    let accepted = 0;
    cases.forEach((result, index) => {
      const resolvedCase = resolved_cases[index];
      const enemy = get(result, 'enemy') || {};
      const config = get(result, 'config') || {};
      if (!_matches(enemy, required_enemy) || !_matches(config, required_config)) return;
      const squad: string[] = [...result['squad']];
      if (squad.some((m) => excluded_members.has(m))) return;
      const member_patterns = get(target, 'member_burst_patterns', {}) as Record<string, any>;
      const burst_patterns = (get(config, 'burst_pattern') || {}) as Record<string, any>;
      if (Object.entries(member_patterns).some(([member, pattern]) =>
        squad.includes(member) && !_py_eq(get(burst_patterns, member), pattern))) return;
      if (squad.length !== 5 || new Set(squad).size !== 5) return;
      const mean = Number(get(get(result, 'total', {}), 'mean', 0));
      if (!Number.isFinite(mean) || mean <= 0) return;

      // 이름·설명·출처는 빼고 실제 스펙과 운용만으로 중복을 판정한다.
      const signature = _canonical({ squad: get(resolvedCase, 'squad', []), config, enemy });
      const run_map = new Map<number, number>();
      for (const run of (get(result, 'runs', []) || []) as any[]) {
        if (get(run, 'seed') != null) run_map.set(Math.trunc(run['seed']), Number(run['squad_total']));
      }
      const rel = relToRoot(source_path);
      candidates.push(new Candidate({
        id: `${stem(source_path)}:${index}`,
        name: truthy(get(result, 'name')) ? result['name'] : squad.join(' / '),
        squad,
        damage: mean,
        total: get(result, 'total', {}),
        burst_count: Number(get(result, 'burst_count', 0)),
        config,
        enemy,
        runs: run_map,
        source: rel,
        source_index: index,
        signature,
        provenance: [{ source: rel, index }],
      }));
      accepted += 1;
    });

    sources.push({
      path: relToRoot(source_path),
      title: get(report_spec, 'title', stem(source_path)),
      loaded: cases.length,
      accepted,
      runs: get(report_spec, 'runs'),
      seeds: get(data, 'seeds', []),
    });
  }

  if (!candidates.length && !allow_empty) throw ValueError('지정한 조건에 맞는 5인 스쿼드 결과가 없습니다.');
  return [candidates, truthy(reference_defaults) ? reference_defaults! : {}, sources];
}

function _deduplicate(candidates: Candidate[]): [Candidate[], number] {
  const by_signature = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const previous = by_signature.get(candidate.signature);
    if (previous === undefined) {
      by_signature.set(candidate.signature, candidate);
      continue;
    }
    const provenance = [...previous.provenance, ...candidate.provenance];
    if (candidate.damage > previous.damage) {
      candidate.provenance = provenance;
      by_signature.set(candidate.signature, candidate);
    } else {
      previous.provenance = provenance;
    }
  }
  const unique = sorted([...by_signature.values()], (item) => [-item.damage, item.id]);
  return [unique, candidates.length - unique.length];
}

function _assign_masks(candidates: Candidate[]): Map<string, bigint> {
  const names = sorted(new Set(candidates.flatMap((c) => c.squad)));
  const bits = new Map<string, bigint>(names.map((name, index) => [name, 1n << BigInt(index)]));
  for (const c of candidates) c.mask = c.squad.reduce((acc, name) => acc + bits.get(name)!, 0n);
  return bits;
}

let _explored = 0;

/** 평균 총딜 기준 상위 K개 exact set-packing 해를 반환한다. */
export function solve_exact(candidates: Candidate[], squad_count: number, top_k: number): Array<[number, number[]]> {
  if (squad_count <= 0 || top_k <= 0) throw ValueError('squad_count와 top_k는 양수여야 합니다.');

  // 최소 힙 (total, serial, chosen) — 파이썬 heapq와 같은 순서(총딜, 일련번호).
  const heap: Array<[number, number, number[]]> = [];
  const less = (a: [number, number, number[]], b: [number, number, number[]]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const up = (i: number): void => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const down = (i: number): void => {
    for (;;) {
      const l = 2 * i + 1; const r = l + 1;
      let m = i;
      if (l < heap.length && less(heap[l]!, heap[m]!)) m = l;
      if (r < heap.length && less(heap[r]!, heap[m]!)) m = r;
      if (m === i) break;
      [heap[i], heap[m]] = [heap[m]!, heap[i]!];
      i = m;
    }
  };
  let serial = 0;
  let explored = 0;
  const damage = candidates.map((c) => c.damage);
  const mask = candidates.map((c) => c.mask);

  const submit = (total: number, chosen: number[]): void => {
    serial += 1;
    const itemv: [number, number, number[]] = [total, serial, chosen];
    if (heap.length < top_k) { heap.push(itemv); up(heap.length - 1); }
    else if (total > heap[0]![0]) { heap[0] = itemv; down(0); }
  };

  const visit = (pool: number[], chosen: number[], used: bigint, total: number): void => {
    explored += 1;
    const need = squad_count - chosen.length;
    if (need === 0) { submit(total, chosen); return; }
    if (pool.length < need) return;
    const optimistic = total + sum(pool.slice(0, need).map((i) => damage[i]!));
    if (heap.length === top_k && optimistic <= heap[0]![0]) return;

    const last_start = pool.length - need;
    for (let position = 0; position <= last_start; position += 1) {
      const index = pool[position]!;
      const cmask = mask[index]!;
      if ((cmask & used) !== 0n) continue;
      const block = used | cmask;
      const tail: number[] = [];
      for (let k = position + 1; k < pool.length; k += 1) {
        const other = pool[k]!;
        if ((mask[other]! & block) === 0n) tail.push(other);
      }
      if (tail.length < need - 1) continue;
      let branch_upper = total + damage[index]!;
      if (need > 1) branch_upper += sum(tail.slice(0, need - 1).map((i) => damage[i]!));
      if (heap.length === top_k && branch_upper <= heap[0]![0]) continue;
      visit(tail, [...chosen, index], block, total + damage[index]!);
    }
  };

  visit(candidates.map((_, i) => i), [], 0n, 0.0);
  _explored = explored;
  return sorted(heap, (h) => [h[0], h[1]], true).map((h) => [h[0], h[2]]);
}

function _candidate_json(c: Candidate): Record<string, any> {
  return floats({
    id: c.id,
    name: c.name,
    squad: [...c.squad],
    total: c.total,
    burst_count: c.burst_count,
    config: c.config,
    source: c.source,
    source_index: c.source_index,
    simulated: c.simulated,
    provenance: c.provenance,
  }, 'burst_count');
}

function _solution_json(rank: number, chosen: number[], candidates: Candidate[], sort = true): Record<string, any> {
  let squads = chosen.map((i) => candidates[i]!);
  if (sort) squads = sorted(squads, (item) => item.damage, true);
  let common: number[] = [];
  if (squads.length) {
    common = [...squads[0]!.runs.keys()].filter((s) => squads.every((c) => c.runs.has(s)));
  }
  const common_seeds = [...common].sort((a, b) => a - b);
  const run_totals = common_seeds.map((seed) => sum(squads.map((c) => c.runs.get(seed)!)));
  const total = run_totals.length ? _stats(run_totals) : _stats([sum(squads.map((c) => c.damage))]);
  // 목적함수는 각 후보의 저장된 평균 합이다. 공통 시드 합산 평균과 부동소수점 오차만 난다.
  total['objective'] = sum(squads.map((c) => c.damage));
  floats(total, 'objective');
  return {
    rank,
    total,
    common_seeds,
    squads: squads.map((c) => _candidate_json(c)),
  };
}

// ── 지정 편성 ──────────────────────────────────────────────────────────────

interface SimContext {
  runs: number;
  seeds: Array<number | null>;
  random: boolean;
  defaults: Record<string, any>;
  config: Record<string, any>;
  enemy: Record<string, any>;
}

/** 첫 후보 원본의 시드·반복·전역 조건을 물려받는다. */
function _sim_context(spec: Record<string, any>, spec_path: string): SimContext {
  let runs = Math.trunc(get(spec, 'runs', 10));
  let seeds: Array<number | null> = Array.from({ length: runs }, (_, i) => i + 1);
  let random = false;
  let defaults: Record<string, any> = _deepcopy_marked(get(spec, 'defaults', {}));
  let config: Record<string, any> = _deepcopy_marked(get(spec, 'config', {}));
  let enemy: Record<string, any> = _deepcopy_marked(get(spec, 'enemy', {}));

  const sources = (get(spec, 'sources') || []) as string[];
  if (sources.length) {
    const source_path = _resolveSource(sources[0]!, spec_path);
    const data = loadJson(source_path);
    seeds = [...(truthy(get(data, 'seeds')) ? data['seeds'] : seeds)];
    runs = seeds.length || runs;
    random = truthy(get(data, 'random'));
    // 후보를 만든 보고서의 난수 모드를 그대로 물려받는다.
    const src_mode = get(get(get(data, 'spec') || {}, 'config') || {}, 'rng_mode');
    if (truthy(src_mode)) config['rng_mode'] = src_mode;
    // 원본의 **가공 전** defaults를 쓴다.
    const origin_spec = join(dirname(source_path), 'spec.json');
    if (existsSync(origin_spec)) {
      const raw = loadJson(origin_spec);
      defaults = merged(_deepcopy_marked(get(raw, 'defaults', {})), defaults);
      config = merged(_deepcopy_marked(get(raw, 'config', {})), config);
      enemy = merged(_deepcopy_marked(get(raw, 'enemy', {})), enemy);
    }
  }

  const target: Record<string, any> = get(spec, 'target', {});
  config = merged(config, _deepcopy_marked(get(target, 'config', {})));
  enemy = merged(enemy, _deepcopy_marked(get(target, 'enemy', {})));
  return { runs, seeds, random, defaults, config, enemy };
}

interface Pinned { index: number; name: string; members: string[]; overrides: Record<string, any> }

/** `pinned_squads` 항목을 이름·멤버·오버라이드로 편다. 배열 순서가 버스트 우선순위다. */
function _normalize_pinned(entries: any[]): Pinned[] {
  const squads: Pinned[] = [];
  const counts = new Map<string, number>();
  entries.forEach((e, i) => {
    const index = i + 1;
    const entry = Array.isArray(e) ? { members: e } : e;
    const members: string[] = [...(get(entry, 'members') || get(entry, 'squad') || [])];
    if (!(members.length >= 1 && members.length <= 5) || new Set(members).size !== members.length) {
      throw ValueError(`${index}번째 지정 스쿼드는 서로 다른 1~5명이어야 합니다: ${_py_repr(members)}`);
    }
    for (const m of members) counts.set(m, (counts.get(m) ?? 0) + 1);
    const overrides: Record<string, any> = {};
    for (const key of ['config', 'chars', 'defaults', 'no_layer']) {
      if (key in entry) overrides[key] = _deepcopy_marked(entry[key]);
    }
    squads.push({
      index,
      name: truthy(get(entry, 'name')) ? entry['name'] : members.join(' / '),
      members,
      overrides,
    });
  });
  const repeated = sorted([...counts].filter(([, c]) => c > 1).map(([n]) => n));
  if (repeated.length) throw ValueError(`지정 편성에 캐릭터가 겹칩니다: ${repeated.join(' · ')}`);
  return squads;
}

/** 후보 캐시에 없는 지정 스쿼드만 새로 시뮬한다. */
async function _simulate_pinned(squads: Pinned[], context: SimContext, slug: string, jobs: number): Promise<Candidate[]> {
  const built = report.build_spec({
    title: `${slug} 지정 편성`,
    runs: context.runs,
    defaults: context.defaults,
    config: context.config,
    enemy: context.enemy,
    cases: squads.map((s) => ({ name: s.name, squad: s.members, ...s.overrides })),
  }, slug);

  const meta = report._cache_meta();
  const cache_path = join(bundle_dir(slug), 'pinned.data.json');
  let cache: Record<string, any> = {};
  if (existsSync(cache_path)) {
    try {
      const stored = loadJson(cache_path);
      if (_py_eq(get(stored, 'cache_meta'), meta) && _py_eq(get(stored, 'seeds'), context.seeds)) {
        cache = get(stored, 'cases', {});
      }
    } catch { cache = {}; }
  }

  const keys = (built['cases'] as any[]).map((c) => report._case_key(c));
  const pending = (built['cases'] as any[]).filter((_, i) => !(keys[i]! in cache));
  if (pending.length) {
    const workers = jobs || report.autoJobs(context.runs * pending.length);
    print(`[지정 편성] 새 시뮬 ${pending.length}스쿼드 × ${context.runs}회 (병렬 ${workers})`);
    const results = await report.run_report({ ...built, cases: pending }, context.runs, context.seeds, workers);
    pending.forEach((c, i) => { cache[report._case_key(c)] = results[i]; });
    mkdirSync(dirname(cache_path), { recursive: true });
    writeText(cache_path, dumps({ cache_meta: meta, seeds: context.seeds, cases: cache }));
  }

  return squads.map((squad, i) => {
    const c = built['cases'][i];
    const result = cache[keys[i]!];
    const run_map = new Map<number, number>();
    for (const run of (get(result, 'runs', []) || []) as any[]) {
      if (get(run, 'seed') != null) run_map.set(Math.trunc(run['seed']), Number(run['squad_total']));
    }
    return new Candidate({
      id: `pinned:${squad.index}`,
      name: squad.name,
      squad: [...result['squad']],
      damage: Number(result['total']['mean']),
      total: result['total'],
      burst_count: Number(get(result, 'burst_count', 0)),
      config: result['config'],
      enemy: get(result, 'enemy') || {},
      runs: run_map,
      source: `.report-work/${slug}/pinned.data.json`,
      source_index: squad.index,
      signature: _canonical({ squad: c['squad'], config: result['config'], enemy: get(result, 'enemy') }),
      simulated: true,
    });
  });
}

/** 지정한 편성의 총딜을 낸다. 캐시에 같은 편성이 있으면 재사용하고 없으면 시뮬한다. */
async function _evaluate_pinned(spec: Record<string, any>, spec_path: string, slug: string, jobs: number)
  : Promise<Record<string, any>> {
  const pinned = _normalize_pinned(spec['pinned_squads']);
  // 지정 편성은 사용자가 직접 고른 것이므로 후보 필터(제외 조건)를 적용하지 않는다.
  const [pool, defaults, sources] = _load_candidates({ ...spec, exclude_members: [] }, spec_path, true);

  const setKey = (xs: string[]): string => [...new Set(xs)].sort().join('\u0000');
  const best_by_members = new Map<string, Candidate>();
  for (const c of pool) {
    const key = setKey(c.squad);
    const previous = best_by_members.get(key);
    if (previous === undefined || c.damage > previous.damage) best_by_members.set(key, c);
  }

  let resolved: Array<Candidate | null> = [];
  const missing: Pinned[] = [];
  for (const squad of pinned) {
    let cached = truthy(squad.overrides) ? null : (best_by_members.get(setKey(squad.members)) ?? null);
    // 스쿼드 순서가 버스트 우선순위다. 지정 순서와 다른 후보는 다른 운용이므로 다시 돈다.
    if (cached !== null && !_py_eq(cached.squad, squad.members)) cached = null;
    resolved.push(cached);
    if (cached === null) missing.push(squad);
  }

  if (missing.length) {
    const fresh = (await _simulate_pinned(missing, _sim_context(spec, spec_path), slug, jobs))[Symbol.iterator]();
    resolved = resolved.map((item) => (item !== null ? item : fresh.next().value as Candidate));
  }

  const squads = resolved.filter((x): x is Candidate => x !== null);
  const solution = _solution_json(1, squads.map((_, i) => i), squads, false);
  return {
    pinned: true,
    target: spec['target'],
    exclude_members: [],
    defaults,
    sources,
    candidate_counts: {
      loaded: pool.length,
      duplicates_removed: 0,
      unique: best_by_members.size,
      characters: new Set(pinned.flatMap((s) => s.members)).size,
    },
    search: { method: 'pinned squads', squad_count: pinned.length, top_k: 1, explored_nodes: 0 },
    pinned_meta: { reused: pinned.length - missing.length, simulated: missing.length },
    solutions: [solution],
  };
}

function _optimize(spec: Record<string, any>, spec_path: string, top_k_override: number | null): Record<string, any> {
  let [candidates, defaults, sources] = _load_candidates(spec, spec_path);
  const loaded_count = candidates.length;
  let duplicate_count: number;
  [candidates, duplicate_count] = _deduplicate(candidates);
  const char_bits = _assign_masks(candidates);
  const top_k = top_k_override || Math.trunc(get(spec, 'top_k', 10));
  const squad_count = Math.trunc(get(spec, 'squad_count', 5));
  _explored = 0;
  const solutions_raw = solve_exact(candidates, squad_count, top_k);
  if (!solutions_raw.length) throw ValueError(`캐릭터가 겹치지 않는 ${squad_count}개 스쿼드를 만들 수 없습니다.`);
  const solutions = solutions_raw.map(([, chosen], i) => _solution_json(i + 1, chosen, candidates));
  return {
    target: spec['target'],
    exclude_members: get(spec, 'exclude_members', []),
    defaults,
    sources,
    candidate_counts: {
      loaded: loaded_count,
      duplicates_removed: duplicate_count,
      unique: candidates.length,
      characters: char_bits.size,
    },
    search: {
      method: 'exact branch-and-bound weighted set packing',
      squad_count,
      top_k,
      explored_nodes: _explored,
    },
    solutions,
  };
}

export async function run(spec_path: string, top_k_override: number | null = null, jobs = 0)
  : Promise<[string, string, Record<string, any>]> {
  const slug = slug_from_spec(spec_path);
  preserve_spec(spec_path, slug);
  const spec = loadJson(spec_path);
  const default_variant = truthy(get(spec, 'pinned_squads')) ? { name: '지정 편성' } : { name: '전체' };
  const variant_specs: any[] = truthy(get(spec, 'variants')) ? spec['variants'] : [default_variant];
  const variants: Array<Record<string, any>> = [];
  for (const variant of variant_specs) {
    const m: Record<string, any> = merged(spec, Object.fromEntries(Object.entries(variant).filter(([k]) => k !== 'name')));
    const result = truthy(get(m, 'pinned_squads'))
      ? await _evaluate_pinned(m, spec_path, slug, jobs)
      : _optimize(m, spec_path, top_k_override);
    result['name'] = get(variant, 'name', default_variant.name);
    variants.push(result);
  }

  const v0 = variants[0]!;
  const output: Record<string, any> = {
    title: get(spec, 'title', stem(spec_path)),
    note: get(spec, 'note', ''),
    generated_at: isoSeconds(),
    target: spec['target'],
    defaults: v0['defaults'],
    variants,
    // 첫 탭을 기존 데이터 소비자의 호환 뷰로 유지한다.
    sources: v0['sources'],
    candidate_counts: v0['candidate_counts'],
    search: v0['search'],
    solutions: v0['solutions'],
  };

  const dpath = work_data_path(slug);
  const html_path = output_path(slug);
  mkdirSync(dirname(html_path), { recursive: true });
  writeText(dpath, dumps(output, { indent: 2 }));
  writeText(html_path, render_html(output));
  const dependencies: string[] = [];
  for (const value of (get(spec, 'sources', []) || []) as string[]) {
    const source = resolve(dirname(spec_path), value);
    if (basename(source) === 'result.data.json' && samePath(dirname(dirname(source)), WORK_DIR)) {
      dependencies.push(basename(dirname(source)));
    }
  }
  write_manifest(slug, 'optimize', output['title'], dependencies);
  write_index();
  return [dpath, html_path, output];
}

async function main(): Promise<void> {
  const args = report.parseArgs({
    prog: 'optimize_solo_raid.ts', description: '솔로레이드 N스쿼드 보고서 (최적화·지정 편성)',
    positional: ['spec'], options: { top: 'int', jobs: 'int', open: 'bool' },
    help: 'options:\n  --top TOP    출력할 상위 해 개수\n  --jobs JOBS  지정 편성 신규 시뮬의 병렬 워커 수 (0=자동)\n'
      + '  --open       완료 후 HTML 열기',
  });
  const spec_path = resolve(args.spec);
  const [dpath, html_path, output] = await run(spec_path, args.top, args.jobs ?? 0);
  for (const variant of output['variants'] as any[]) {
    const best = variant['solutions'][0];
    if (truthy(get(variant, 'pinned'))) {
      const meta = variant['pinned_meta'];
      print(`[${variant['name']}] 지정 ${variant['search']['squad_count']}스쿼드 `
        + `/ 재사용 ${meta['reused']}개 · 신규 시뮬 ${meta['simulated']}개`);
      print(`  총딜 합: ${_kor(Number(best['total']['objective']))}`);
    } else {
      print(`[${variant['name']}] 후보 ${variant['candidate_counts']['unique']}개 `
        + `/ 탐색 ${fmt(variant['search']['explored_nodes'], ',')}상태`);
      print(`  최적 총딜: ${_kor(Number(best['total']['objective']))}`);
    }
    (best['squads'] as any[]).forEach((squad, i) => {
      print(`    ${i + 1}. ${_kor(Number(squad['total']['mean']))}  ${squad['squad'].join(' / ')}`);
    });
  }
  print(dpath);
  print(html_path);
  if (args.open) openInBrowser(html_path);
}

if (require.main === module) runMain(main);
