/**
 * 육성 효율 보고서 러너 (파이썬 `growth.py`의 TS 이식 — 같은 입력이면 같은 캐시·HTML).
 *
 * 한 캐릭터의 육성 변수(스킬 레벨·장비 옵션·소장품 …)를 **기준점에서 한 축씩** 움직여
 * 덱 총딜과 그 캐릭터 자신의 딜이 각각 얼마나 오르는지 잰다.
 *
 *   cd site && npx tsx ../.agent/skills/report-growth/scripts/growth.ts ../.report-work/<이름>/spec.json
 *   cd site && npx tsx ../.agent/skills/report-growth/scripts/growth.ts <스펙> --jobs 8 --open
 *   cd site && npx tsx ../.agent/skills/report-growth/scripts/growth.ts <스펙> --sampled --runs 12
 *   cd site && npx tsx ../.agent/skills/report-growth/scripts/growth.ts <스펙> --from-cache
 *
 * 스펙 형식은 `.agent/skills/report-growth/references/format.md` 참조.
 *
 * 딜량 보고서(`report`)와 다른 점은 셋이다.
 *
 * 1. **케이스를 손으로 쓰지 않는다.** 덱 × 축 × 단계로 전개하며, 기준 단계는 덱당 한 번만
 *    돌려 전 축이 공유한다.
 * 2. **작은 차이를 잰다.** 기본인 기대값 모드는 난수 자체가 없어 Δ가 그대로 실제 차이다.
 *    `--sampled`로 확률 판정을 쓸 때는 페어드 델타로 잰다.
 * 3. **두 지표를 나눠 본다.** 덱 총딜 Δ와 대상 캐릭터 자신의 딜 Δ.
 */

import { existsSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import * as char_spec from '../../../../site/src/engine/spec';
import { _NIKKE } from '../../../../site/src/engine/timeline';
import { _deepcopy_marked, _mark_float, _py_eq, _py_repr, _py_str } from '../../../../site/src/engine/customization';
import { get, sorted, sum, truthy } from '../../../../site/src/engine/py';
import * as report_tool from '../../report-squad/scripts/report';
import { loadEngine } from '../../report-squad/scripts/engine_env';
import {
  SystemExit, dumps, floats, fmean, fmt, isSystemExit, loadJson, openInBrowser, print, runMain, stdev, writeText,
} from '../../report-squad/scripts/pycompat';
import {
  data_path, output_path, prepare, preserve_spec, slug_from_spec, spec_path, write_index, write_manifest,
} from '../../report-squad/scripts/report_workspace';
import { render_html } from './growth_html';

// ── 모드 ───────────────────────────────────────────────────────────────────
// 스킬과 옵션을 한 보고서에 섞지 않는다.

export const SKILL_STEPS = [7, 8, 9, 10];        // 기준 7 + 8·9·10
export const OPTION_LINES = [0, 1, 2, 3, 4];     // 오버로드 줄 수. 전부 레벨 10

// ── 스킬 메뉴얼 비용 ───────────────────────────────────────────────────────
// 그 레벨에 **도달하는 데** 드는 메뉴얼 수. 7레벨까지는 사실상 무제한 수급이라 0으로 본다.
export const MANUAL_COST: Record<string, number> = { 8: 90, 9: 105, 10: 120 };
// 1·2스킬은 스킬 메뉴얼, 버스트(3)는 버스트 메뉴얼만 먹는다 — 서로 대체되지 않는다.
export const MANUAL_KIND: Record<string, string> = { 1: '스킬 메뉴얼', 2: '스킬 메뉴얼', 3: '버스트 메뉴얼' };

// 옵션 모드 기본 축. 라벨은 보고서에 그대로 나온다.
const OPTION_AXES: Array<[string, string]> = [['공격력 옵션', 'atk_pct'], ['최대장탄 옵션', 'max_ammo_pct'],
  ['크리티컬 확률 옵션', 'crit_rate'], ['크리티컬 대미지 옵션', 'crit_dmg']];
// 차지형(RL·SR)에만 붙는 축.
const CHARGE_AXES: Array<[string, string]> = [['차지속도 옵션', 'charge_speed_pct'], ['차지대미지 옵션', 'charge_dmg_pct']];
const CHARGE_WEAPONS = new Set(['RL', 'SR']);
// 우월코드는 **기준이 4줄**이다.
const ELEMENT_AXIS: [string, string] = ['우월코드 옵션', 'element_bonus'];
const ELEMENT_BASE_LINES = 4;

// 랩쳐 코드 → 그 코드에 강한(=우월코드가 붙는) 속성.
const CODE_WEAK: Record<string, string> = { 전격: '철갑', 수냉: '전격', 작열: '수냉', 풍압: '작열', 철갑: '풍압' };

// 케이스 이름 구분자. 케이스 이름은 `덱 ∥ 축 ∥ 단계`로 유일해야 한다.
export const SEP = ' ∥ ';

// ── 스펙 전개 ──────────────────────────────────────────────────────────────

function _step_key(axis_name: string, label: string): string {
  return `${axis_name}:${label}`;
}

function _meta(name: string): Record<string, any> {
  loadEngine();
  return get(_NIKKE(), name, {});
}

const _g = (x: number): string => fmt(x, 'g');

function _line_label(lines: number, value: number): string {
  return lines === 0 ? '없음' : `${lines}줄 (${_g(value)}%)`;
}

/** 메뉴얼 비용 모델. `"cost": {"enabled": false}`로 끌 수 있다. */
function _cost_cfg(spec: Record<string, any>): Record<string, any> {
  const c = (get(spec, 'cost') || {}) as Record<string, any>;
  if (get(c, 'enabled') === false) return {};
  const src = (truthy(get(c, 'level_cost')) ? c['level_cost'] : MANUAL_COST) as Record<string, any>;
  const level_cost: Record<string, number> = {};
  for (const [k, v] of Object.entries(src)) {
    const key = String(parseInt(k, 10));
    level_cost[key] = Number(v);
    _mark_float(level_cost, key);
  }
  return { level_cost, kind: { ...MANUAL_KIND, ...(get(c, 'kind') || {}) } };
}

/** `mode`에 따라 기준 육성과 축을 만든다 → (baseline, axes, 알림 목록). */
function _auto_axes(spec: Record<string, any>, subject: string): [Record<string, any>, any[], string[]] {
  const mode = get(spec, 'mode');
  if (!truthy(mode)) return [{}, [], []];
  if (mode !== 'skill' && mode !== 'option') {
    throw SystemExit(`\`mode\`는 "skill" 또는 "option"이어야 한다 (${_py_repr(mode)}).`);
  }

  const notes: string[] = [];
  const lines_list: number[] = truthy(get(spec, 'option_lines')) ? spec['option_lines'] : OPTION_LINES;

  if (mode === 'skill') {
    const steps_lv: number[] = truthy(get(spec, 'skill_steps')) ? spec['skill_steps'] : SKILL_STEPS;
    const base_lv = steps_lv[0]!;
    const baseline = { skill_levels: { 1: base_lv, 2: base_lv, 3: base_lv } };
    const axes = ([['1', '1스킬 레벨'], ['2', '2스킬 레벨'], ['3', '버스트 레벨']] as const).map(([k, nm]) => ({
      name: nm,
      skill_key: k,
      steps: steps_lv.map((lv) => ({
        label: _py_str(lv), level: lv,
        ...(_py_eq(lv, base_lv) ? { base: true } : { over: { skill_levels: { [k]: lv } } }),
      })),
    }));
    notes.push(`스킬 조사 — 장비 옵션은 기본 스펙 그대로, 기준 스킬 레벨 ${_py_str(base_lv)}`);
    if (truthy(_cost_cfg(spec))) notes.push(`재화 효율은 메뉴얼 장수 그대로 — ${_py_str(base_lv)}레벨까지는 무료로 본다`);
    return [baseline, axes, notes];
  }

  // mode == "option": 스킬은 만렙 고정, 옵션은 우월코드 4줄만 깔고 나머지를 0에서 올린다.
  const keys = [...OPTION_AXES];
  const weapon = get(_meta(subject), 'weapon_type', '');
  if (CHARGE_WEAPONS.has(weapon) || truthy(get(spec, 'charge_axes'))) {
    keys.push(...CHARGE_AXES);
    if (CHARGE_WEAPONS.has(weapon)) notes.push(`${subject}는 ${weapon} — 차지속도·차지대미지 축을 자동으로 넣었다`);
  }

  const zero: Record<string, any> = {};
  for (const [, opt] of keys) zero[opt] = 0;
  zero['element_bonus'] = char_spec.overload('element_bonus', ELEMENT_BASE_LINES);
  _mark_float(zero, 'element_bonus');
  const baseline = { skill_levels: { 1: 10, 2: 10, 3: 10 }, equip_skills: zero };

  const axes: any[] = [];
  for (const [nm, opt] of keys) {
    const steps: any[] = [];
    for (const n of lines_list) {
      const v = char_spec.overload(opt, n);
      steps.push({
        label: _line_label(n, v),
        ...(n === 0 ? { base: true } : { over: { equip_skills: floats({ [opt]: v }, opt) } }),
      });
    }
    axes.push({ name: nm, steps });
  }

  if (truthy(get(spec, 'include_element_bonus'))) {
    const [nm, opt] = ELEMENT_AXIS;
    const steps = lines_list.map((n) => ({
      label: _line_label(n, char_spec.overload(opt, n)),
      ...(n === ELEMENT_BASE_LINES ? { base: true }
        : { over: { equip_skills: floats({ [opt]: char_spec.overload(opt, n) }, opt) } }),
    }));
    if (!steps.some((s: any) => s.base)) {
      throw SystemExit(`우월코드 축의 기준은 ${ELEMENT_BASE_LINES}줄인데 `
        + `\`option_lines\`에 ${ELEMENT_BASE_LINES}이 없다.`);
    }
    axes.push({ name: nm, note: `기준이 ${ELEMENT_BASE_LINES}줄이라 그 아래는 음수로 나온다`, steps });

    const code = get(get(spec, 'enemy') || {}, 'code');
    if (truthy(code) && get(_meta(subject), 'element_code') !== CODE_WEAK[code]) {
      notes.push(`⚠ ${subject}는 ${code} 랩쳐의 약점 속성이 아니다 — 우월코드 축은 전부 0으로 나온다`);
    }
  }

  notes.push(`옵션 조사 — 스킬 10/10/10 고정, 우월코드 ${ELEMENT_BASE_LINES}줄 외 옵션 없음에서 시작`
    + ` (전부 레벨 ${char_spec.OVERLOAD_LV})`);
  return [baseline, axes, notes];
}

/** 육성 효율 스펙 → (report 형식 스펙, 메타). */
export function expand(spec: Record<string, any>): [Record<string, any>, Record<string, any>] {
  const subject = get(spec, 'subject');
  if (!truthy(subject)) throw SystemExit('스펙에 `subject`(조사 대상 캐릭터)가 없다.');

  const decks = (get(spec, 'decks') || []) as any[];
  if (!decks.length) throw SystemExit('스펙에 `decks`가 없다. 덱을 1개 이상 적는다.');

  const [auto_base, auto_axes, mode_notes] = _auto_axes(spec, subject);
  const baseline = report_tool._deep_merge(auto_base, get(spec, 'baseline') || {});
  const axes = [...auto_axes, ...((get(spec, 'axes') || []) as any[])];
  if (!axes.length) throw SystemExit('스펙에 `axes`가 없다. `mode`를 주거나 축을 직접 적는다.');

  const norm_axes: any[] = [];
  for (const ax of axes) {
    const name = get(ax, 'name') || '?';
    const target = get(ax, 'target') || subject;
    const steps = (get(ax, 'steps') || []) as any[];
    const bases = steps.filter((s) => truthy(get(s, 'base')));
    if (bases.length !== 1) {
      throw SystemExit(`[${name}] 축에는 \`base: true\` 단계가 정확히 하나 있어야 한다 (현재 ${bases.length}개).`);
    }
    if (steps.length < 2) throw SystemExit(`[${name}] 축에 비교할 단계가 없다 (기준 하나뿐).`);
    for (const s of steps) {
      if (truthy(get(s, 'base')) && truthy(get(s, 'over'))) {
        throw SystemExit(`[${name}] 기준 단계에는 \`over\`를 적지 않는다 — 기준 육성은 스펙의 \`baseline\`이 정본이다.`);
      }
    }
    norm_axes.push({
      name, target, note: get(ax, 'note', ''),
      skill_key: get(ax, 'skill_key') || '',
      steps: steps.map((s) => ({
        label: get(s, 'label') || '?',
        base: truthy(get(s, 'base')),
        level: get(s, 'level', null),
        over: get(s, 'over') || {},
      })),
    });
  }

  const by_key = new Map<string, [any, any]>();
  for (const a of norm_axes) for (const s of a.steps) by_key.set(_step_key(a.name, s.label), [a, s]);

  const combos: any[] = [];
  for (const cb of (get(spec, 'combos') || []) as any[]) {
    const refs = (get(cb, 'of') || []) as string[];
    const missing = refs.filter((r) => !by_key.has(r));
    if (missing.length) {
      throw SystemExit(`[조합 ${get(cb, 'label', '?')}] 없는 단계를 가리킨다: ${_py_repr(missing)}\n`
        + `형식은 \`축이름:단계라벨\`. 있는 단계: ${_py_repr(sorted(by_key.keys()))}`);
    }
    if (refs.length < 2) throw SystemExit(`[조합 ${get(cb, 'label', '?')}] \`of\`에 단계를 2개 이상 적는다.`);
    if (new Set(refs.map((r) => by_key.get(r)![0].name)).size !== refs.length) {
      throw SystemExit(`[조합 ${get(cb, 'label', '?')}] 같은 축의 단계 둘을 겹칠 수 없다.`);
    }
    combos.push({ label: get(cb, 'label') || refs.join(' + '), of: refs });
  }

  const cases: Array<Record<string, any>> = [];
  const meta_cases: Record<string, any> = {};
  const deck_meta: any[] = [];
  const lookup: Record<string, string> = {};

  for (const deck of decks) {
    const dname = get(deck, 'name') || (deck['squad'] as string[]).join(' / ');
    const squad: string[] = get(deck, 'squad') || [];
    const targets = new Set<string>(norm_axes.map((a) => a.target));
    const outside = sorted([...targets].filter((t) => !squad.includes(t)));
    if (outside.length) throw SystemExit(`[${dname}] 축의 대상이 스쿼드에 없다: ${_py_repr(outside)}`);
    if (!squad.includes(subject)) throw SystemExit(`[${dname}] 대상 캐릭터 \`${subject}\`가 스쿼드에 없다.`);

    const _case = (name: string, chars_over: Record<string, any>): Record<string, any> => {
      const c: Record<string, any> = { name, group: dname, squad: [...squad], chars: chars_over };
      for (const k of ['defaults', 'config', 'enemy', 'no_layer']) {
        if (get(deck, k) != null) c[k] = _deepcopy_marked(deck[k]);
      }
      return c;
    };

    /** 기준 육성 + 축 오버라이드. 기준은 대상 캐릭터에게만 얹는다. */
    const _chars = (extra: Map<string, Record<string, any>>): Record<string, any> => {
      const out: Record<string, any> = truthy(baseline) ? { [subject]: _deepcopy_marked(baseline) } : {};
      for (const [nm, over] of extra) out[nm] = report_tool._deep_merge(get(out, nm, {}), over);
      return out;
    };
    const sig = (x: unknown): string => dumps(x, { sortKeys: true });

    const base_name = `${dname}${SEP}기준`;
    cases.push(_case(base_name, _chars(new Map())));
    meta_cases[base_name] = { deck: dname, kind: 'base' };

    // 같은 육성으로 두 번 돌리지 않는다 (축이 달라도 결과 dict가 같으면 한 케이스).
    const seen = new Map<string, string>([[sig(_chars(new Map())), base_name]]);

    for (const ax of norm_axes) {
      for (const st of ax.steps) {
        const key = _step_key(ax.name, st.label);
        if (st.base) {
          lookup[`${dname}${SEP}${key}`] = base_name;
          continue;
        }
        const chars = _chars(new Map([[ax.target, st.over]]));
        const s = sig(chars);
        let cname = seen.get(s);
        if (cname === undefined) {
          cname = `${dname}${SEP}${ax.name}${SEP}${st.label}`;
          cases.push(_case(cname, chars));
          meta_cases[cname] = { deck: dname, kind: 'step', step_key: key };
          seen.set(s, cname);
        }
        lookup[`${dname}${SEP}${key}`] = cname;
      }
    }

    for (const cb of combos) {
      const chars_extra = new Map<string, Record<string, any>>();
      for (const r of cb.of) {
        const [ax, st] = by_key.get(r)!;
        chars_extra.set(ax.target, report_tool._deep_merge(chars_extra.get(ax.target) ?? {}, st.over));
      }
      const chars = _chars(chars_extra);
      const cname = `${dname}${SEP}조합${SEP}${cb.label}`;
      cases.push(_case(cname, chars));
      meta_cases[cname] = { deck: dname, kind: 'combo', combo: cb.label };
    }

    deck_meta.push({ name: dname, squad: [...squad], note: get(deck, 'note', ''), base_case: base_name });
  }

  const report_spec: Record<string, any> = {};
  for (const [k, v] of Object.entries(spec)) {
    if (['title', 'note', 'runs', 'defaults', 'config', 'enemy', 'no_layer', 'profile', 'profile_level',
      'allow_unowned'].includes(k)) report_spec[k] = v;
  }
  report_spec['cases'] = cases;

  const meta = {
    subject,
    mode: get(spec, 'mode', ''),
    mode_notes,
    baseline,
    cost: _cost_cfg(spec),
    axes: norm_axes,
    combos,
    decks: deck_meta,
    cases: meta_cases,
    lookup,
  };
  return [report_spec, meta];
}

// ── 페어드 델타 ────────────────────────────────────────────────────────────

/** 시드별 차이를 먼저 구하고 그 평균·표준편차를 낸다. */
function _paired(base_runs: any[], case_runs: any[], pick: (r: any) => number, base_mean: number,
  exact = false): Record<string, any> {
  const by_seed = new Map<unknown, any>(base_runs.map((r) => [r['seed'], r]));
  const diffs = case_runs.filter((r) => by_seed.has(r['seed'])).map((r) => pick(r) - pick(by_seed.get(r['seed'])));
  const n = diffs.length;
  const mean = diffs.length ? fmean(diffs) : 0.0;
  const sd = n > 1 ? stdev(diffs) : 0.0;
  const se = n > 1 ? sd / Math.sqrt(n) : 0.0;
  return {
    mean, std: sd, se, n, exact,
    pct: base_mean ? mean / base_mean * 100 : 0.0,
    se_pct: base_mean ? se / base_mean * 100 : 0.0,
    sig: exact ? !!mean : (!!se && Math.abs(mean) > 2 * se),
  };
}

// ── 재화 비용 ──────────────────────────────────────────────────────────────

function _axis_cost(ax: Record<string, any>, cost: Record<string, any>): Record<string, any> | null {
  const key = get(ax, 'skill_key');
  if (!truthy(cost) || !truthy(key)) return null;
  const baseStep = (ax['steps'] as any[]).find((s) => s['base']);
  const base = baseStep ? get(baseStep, 'level') : null;
  const kind = get(cost['kind'], key);
  if (base == null || kind == null) return null;
  const lc = cost['level_cost'] as Record<string, number>;
  const step: Record<string, number> = {}; const cum: Record<string, number> = {};
  let prev_cum = 0.0;
  const levels = sorted((ax['steps'] as any[]).filter((s) => get(s, 'level') != null && s['level'] > base)
    .map((s) => s['level'] as number));
  const range = (a: number, b: number): number[] => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
  for (const lv of levels) {
    if (range(base + 1, lv + 1).some((x) => !(String(x) in lc))) return null;
    cum[lv] = sum(range(base + 1, lv + 1).map((x) => lc[String(x)]!));
    step[lv] = cum[lv]! - prev_cum;
    prev_cum = cum[lv]!;
  }
  if (!truthy(cum)) return null;
  return { kind, base_level: base, step, cum };
}

/** 직전 단계 대비 증분 Δ%. 페어드 값이 있으면 그것을 쓴다. */
function _step_pct(row: Record<string, any>, metric: string): number {
  const sd = get(row, 'step_delta');
  if (truthy(sd)) return sd[metric]['pct'];
  return (metric === 'deck' ? row['step_deck_pct'] : row['step_self_pct']) || 0.0;
}

/** 한 단계(직전 단계 → 이 레벨)의 메뉴얼 장수와 장당 효율(100장당 Δ%). */
function _step_cost(levels: Record<string, any>, lv: number, row: Record<string, any>): Record<string, any> {
  const step_raw = levels['step'][lv];
  const _per100 = (pct: number): number => (step_raw ? pct / step_raw * 100 : 0.0);
  return {
    kind: levels['kind'],
    cost: step_raw,
    per100: { deck: _per100(_step_pct(row, 'deck')), self: _per100(_step_pct(row, 'self')) },
    sig: !!(truthy(get(row, 'step_delta')) && row['step_delta']['deck']['sig']),
    exact: !!(truthy(get(row, 'step_delta')) && get(row['step_delta']['deck'], 'exact')),
  };
}

/** 재화 효율 표의 줄 — **축 순서·레벨 순서 그대로**. */
function _cost_rows(axes: any[]): any[] {
  const rows: any[] = [];
  for (const a of axes) {
    for (const s of a['steps']) {
      if (s['base'] || !truthy(s['cost'])) continue;
      const c = s['cost'];
      rows.push({
        axis: a['name'], kind: c['kind'],
        from: s['prev_label'], to: s['label'], cost: c['cost'],
        deck_pct: _step_pct(s, 'deck'), self_pct: _step_pct(s, 'self'),
        per100: c['per100']['deck'], per100_self: c['per100']['self'],
        sig: c['sig'], exact: get(c, 'exact', false),
      });
    }
  }
  return rows;
}

/** 만렙까지의 메뉴얼 총액. 종류가 다른 재화는 **합치지 않고** 따로 센다. */
function _cost_total(rows: any[]): any[] {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r['kind'], (out.get(r['kind']) ?? 0.0) + r['cost']);
  return [...out].map(([kind, cost]) => ({ kind, cost }));
}

/** report 집계 결과 → 육성 효율 지표. 반환 구조는 그대로 HTML로 넘어간다. */
export function analyze(meta: Record<string, any>, cases: Array<Record<string, any>>, exact = false): Record<string, any> {
  const subject = meta['subject'];
  const by_name = new Map<string, Record<string, any>>(cases.map((c) => [c['name'], c]));
  const cost = (get(meta, 'cost') || {}) as Record<string, any>;

  const _self = (c: Record<string, any>): number => {
    for (const ch of c['chars']) if (ch['name'] === subject) return ch['mean'];
    return 0.0;
  };
  const pickDeck = (r: any): number => r['squad_total'];
  const pickSelf = (r: any): number => get(r['chars'], subject, 0.0);

  const decks: any[] = [];
  for (const d of meta['decks']) {
    const base = by_name.get(d['base_case'])!;
    if (!base) throw new Error(`KeyError: '${d['base_case']}'`);
    const base_total = base['total']['mean'];
    const base_self = _self(base);

    const _delta = (cname: string | null | undefined): Record<string, any> | null => {
      const c = cname == null ? undefined : by_name.get(cname);
      if (c === undefined || c['name'] === base['name']) return null;
      return {
        deck: _paired(base['runs'], c['runs'], pickDeck, base_total, exact),
        self: _paired(base['runs'], c['runs'], pickSelf, base_self, exact),
      };
    };

    const axes: any[] = [];
    for (const ax of meta['axes']) {
      const levels = _axis_cost(ax, cost);
      const steps: any[] = [];
      let prev: any = null;
      for (const st of ax['steps']) {
        const cname = get(meta['lookup'], `${d['name']}${SEP}${_step_key(ax['name'], st['label'])}`);
        const dl = truthy(cname) ? _delta(cname) : null;
        const cur = cname == null ? undefined : by_name.get(cname);
        const row: Record<string, any> = {
          label: st['label'],
          base: st['base'],
          level: get(st, 'level'),
          case: (cur ?? base)['name'],
          total: cur ? cur['total']['mean'] : base_total,
          self: cur ? _self(cur) : base_self,
          delta: dl,
          prev_label: prev ? prev['label'] : null,
          step_delta: null,
          step_deck_pct: null,
          step_self_pct: null,
          cost: null,
        };
        if (prev !== null && base_total) {
          row['step_deck_pct'] = (row['total'] - prev['total']) / base_total * 100;
          row['step_self_pct'] = base_self ? (row['self'] - prev['self']) / base_self * 100 : 0.0;
          const pc = by_name.get(prev['case']);
          if (pc !== undefined && pc['name'] !== row['case']) {
            const rc = by_name.get(row['case'])!;
            row['step_delta'] = {
              deck: _paired(pc['runs'], rc['runs'], pickDeck, base_total, exact),
              self: _paired(pc['runs'], rc['runs'], pickSelf, base_self, exact),
            };
          }
        }
        if (levels && !st['base'] && get(st, 'level') != null && String(st['level']) in levels['cum']) {
          row['cost'] = _step_cost(levels, st['level'], row);
        }
        steps.push(row);
        prev = row;
      }
      axes.push({
        name: ax['name'], target: ax['target'], note: ax['note'],
        skill_key: get(ax, 'skill_key', ''),
        kind: levels ? levels['kind'] : '',
        steps,
      });
    }

    const combos: any[] = [];
    for (const cb of meta['combos']) {
      const cname = `${d['name']}${SEP}조합${SEP}${cb['label']}`;
      const dl = _delta(cname);
      if (!dl) continue;
      const parts: any[] = [];
      for (const r of cb['of'] as string[]) {
        const i = r.indexOf(':');
        const ax_name = r.slice(0, i); const label = r.slice(i + 1);
        const pc = get(meta['lookup'], `${d['name']}${SEP}${r}`);
        const pd = truthy(pc) ? _delta(pc) : null;
        parts.push({
          ref: r, axis: ax_name, label,
          deck_pct: pd ? pd['deck']['pct'] : 0.0,
          self_pct: pd ? pd['self']['pct'] : 0.0,
        });
      }
      const sum_deck = sum(parts.map((p) => p['deck_pct']));
      const sum_self = sum(parts.map((p) => p['self_pct']));
      combos.push({
        label: cb['label'], parts,
        delta: dl, sum_deck, sum_self,
        gap_deck: dl['deck']['pct'] - sum_deck,
        gap_self: dl['self']['pct'] - sum_self,
      });
    }

    // 모든 축의 모든 비-기준 단계를 덱 총딜 Δ 내림차순으로.
    const rank = sorted(
      axes.flatMap((a) => (a['steps'] as any[]).filter((s) => !s['base'] && truthy(s['delta']))
        .map((s) => ({ axis: a['name'], target: a['target'], label: s['label'], ...s }))),
      (r) => -r['delta']['deck']['pct']);

    const cost_rows = _cost_rows(axes);

    decks.push({
      name: d['name'], squad: d['squad'], note: d['note'],
      base_case: d['base_case'],
      base_total, base_self,
      base_cv: base['total']['cv'],
      burst_count: get(base, 'burst_count', 0.0),
      enemy: get(base, 'enemy'),
      axes, combos, rank,
      cost_rows, cost_total: _cost_total(cost_rows),
    });
  }

  return {
    subject, baseline: meta['baseline'], decks,
    mode: get(meta, 'mode', ''), mode_notes: get(meta, 'mode_notes') || [],
    cost,
  };
}

// ── 실행 ──────────────────────────────────────────────────────────────────

const HELP = `options:
  --runs RUNS    케이스당 반복 횟수 (--sampled일 때만 의미가 있다. 기본: 스펙의 runs, 없으면 10)
  --sampled      기대값 모드 대신 확률 판정으로 N회 돌려 페어드 델타를 낸다
  --jobs JOBS    병렬 워커 수 (0=자동, 1=직렬)
  --out OUT      출력 HTML 경로 (기본 reports/<스펙명>.html)
  --from-cache   시뮬을 다시 돌리지 않고 직전 결과(.data.json)로 HTML만 다시 만든다
  --dry-run      케이스 전개만 하고 시뮬 횟수·목록을 보여준 뒤 끝낸다
  --open         생성 후 브라우저로 연다`;

async function main(): Promise<void> {
  const args = report_tool.parseArgs({
    prog: 'growth.ts', description: '육성 효율 보고서 생성 (HTML)', positional: ['spec'], help: HELP,
    options: { runs: 'int', sampled: 'bool', jobs: 'int', out: 'str', from_cache: 'bool', dry_run: 'bool', open: 'bool' },
  });

  const slug = slug_from_spec(args.spec);
  prepare(slug);
  const out = args.out ? resolve(args.out) : output_path(slug);
  const cache_path = data_path(slug);

  let spec: Record<string, any>; let cases: Array<Record<string, any>>;
  let meta: Record<string, any>; let seeds: Array<number | null>; let expected: boolean;

  if (args.from_cache) {
    const cached = loadJson(cache_path);
    [spec, cases, meta, seeds] = [cached['spec'], cached['cases'], cached['meta'], cached['seeds']];
    expected = 'expected' in cached ? cached['expected'] : seeds.length <= 1;
    print(`[육성 효율] 캐시 재렌더링: ${cache_path}`);
    // 메타는 스펙에서 다시 만든다 — 지표가 늘어난 뒤에도 옛 캐시가 그대로 살아나도록.
    try {
      const fresh_path = existsSync(args.spec) ? args.spec : spec_path(slug);
      const [fresh_spec, fresh_meta] = expand(loadJson(fresh_path));
      const a = new Set((fresh_spec['cases'] as any[]).map((c) => c['name']));
      const b = new Set(cases.map((c) => c['name']));
      if (a.size === b.size && [...a].every((x) => b.has(x))) meta = fresh_meta;
      else {
        print('  ⚠ 스펙의 케이스가 캐시와 다르다 — 캐시에 저장된 메타로 그린다. 새 지표가 필요하면 시뮬을 다시 돌린다');
      }
    } catch (e) {
      const msg = isSystemExit(e) ? (e as Error).message : String((e as Error)?.message ?? e);
      print(`  ⚠ 스펙을 다시 읽지 못해 캐시 메타로 그린다 (${msg})`);
    }
  } else {
    preserve_spec(args.spec, slug);
    const raw = loadJson(args.spec);
    let raw_spec: Record<string, any>;
    [raw_spec, meta] = expand(raw);
    const b = basename(args.spec);
    spec = report_tool.build_spec(raw_spec, b.slice(0, b.length - extname(b).length));
    if (args.sampled) report_tool.force_sampled_mode(spec);
    // 페어드 비교가 본체다 — 랜덤 시드는 제공하지 않는다 (기대값 모드면 1회로 끝난다)
    let runs: number;
    [expected, runs, seeds] = report_tool.sampling_plan(spec, args.runs, false);
    const total = spec['cases'].length * runs;

    const mode_txt = truthy(get(meta, 'mode')) ? ` [${meta['mode']} 모드]` : '';
    print(`[육성 효율] ${spec['title']}  대상 ${meta['subject']}${mode_txt}`);
    for (const n of (get(meta, 'mode_notes') || []) as string[]) print(`  · ${n}`);
    print(`  덱 ${meta['decks'].length} · 축 ${meta['axes'].length} · 조합 ${meta['combos'].length}`
      + `  →  케이스 ${spec['cases'].length}개 × ${runs}회 = 시뮬 ${total}회`
      + `  (${expected ? '기대값 모드 — 난수 없음' : '확률 판정 · 고정 시드'})`);
    if (args.dry_run) {
      for (const c of spec['cases']) print(`    - ${c['name']}`);
      return;
    }

    const note = char_spec.preview_note(
      sorted(new Set((spec['cases'] as any[]).flatMap((c) => c['squad'].map((x: any) => get(x, 'name', ''))))) as string[]);
    if (note) print(`⚠ ${note}`);

    const jobs = args.jobs || report_tool.autoJobs(total);
    cases = await report_tool.run_report(spec, runs, seeds, jobs);
    writeText(cache_path, dumps({ spec, cases, meta, seeds, expected }));
  }

  const result = analyze(meta, cases, expected);

  const html = render_html(spec, cases, result, seeds, expected);
  writeText(out, html);
  write_manifest(slug, 'report-growth', get(spec, 'title', slug));
  write_index();
  print(`\n생성: ${out}  (${fmt(statSync(out).size / 1024, '.0f')} KB)`);

  for (const d of result['decks']) {
    const cv_txt = expected ? '' : `, CV ${fmt(d['base_cv'], '.2f')}%`;
    print(`\n  [${d['name']}] 기준 ${fmt(d['base_total'] / 1e8, '.2f')}억 `
      + `(대상 ${fmt(d['base_self'] / 1e8, '.2f')}억${cv_txt})`);
    for (const r of d['rank']) {
      // 기대값 모드에서는 Δ가 0일 때만 판정 불가가 뜬다 — 정말 차이가 없다는 뜻이다
      const mark = r['delta']['deck']['sig'] ? '' : (expected ? '  (차이 없음)' : '  (판정 불가)');
      print(`    ${r['axis']} ${fmt(r['label'], '<14')} 덱 ${fmt(r['delta']['deck']['pct'], '+6.2f')}%`
        + `  자기 ${fmt(r['delta']['self']['pct'], '+6.2f')}%${mark}`);
    }
    if (d['cost_rows'].length) {
      print('    ─ 재화 효율 (100장당 덱 딜 Δ)');
      for (const r of d['cost_rows']) {
        const mark = r['sig'] ? '' : (expected ? '  (차이 없음)' : '  (판정 불가)');
        print(`      ${r['axis']} ${_py_str(r['from'])}→${fmt(r['to'], '<3')} `
          + `${fmt(r['cost'], '>4.0f')}장 ${r['kind']} · 덱 ${fmt(r['deck_pct'], '+.2f')}% · `
          + `100장당 ${fmt(r['per100'], '+.3f')}%p${mark}`);
      }
      print('      총 ' + (d['cost_total'] as any[]).map((t) => `${t['kind']} ${fmt(t['cost'], '.0f')}장`).join(' + '));
    }
  }

  if (args.open) openInBrowser(out);
}

if (require.main === module) runMain(main);
