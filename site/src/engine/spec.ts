/**
 * context/spec.py — 기본 육성 스펙 + 캐릭터별 기본 레이어.
 *
 * 합성 순서 (뒤가 이긴다, dict는 재귀 병합 / 리스트·스칼라는 교체):
 *
 *     DEFAULT_CHAR  →  data/char_defaults.json[이름]  →  육성 프로필(선택)  →  호출자 오버라이드
 *
 * 파이썬은 import 시점에 equipment_skills.json · char_defaults.json을 읽어 `DEFAULT_CHAR` ·
 * `CHAR_DEFAULTS`를 만든다. 여기서는 처음 쓸 때 `data()`에서 만들고 `onDataChange`로 비운다.
 * 모듈 밖으로는 같은 이름의 «늦은 창»(`_lazy_view`)을 내보내고, 모듈 안에서는 실제 객체를
 * 주는 `_DEFAULT_CHAR()` · `_CHAR_DEFAULTS()`를 쓴다(structuredClone은 Proxy를 복사하지 못한다).
 *
 * 옮기지 않은 것: `GrowthProfile` · `load_profile`(profiles/*.json 파일을 읽는 CLI·보고서 전용 —
 * `run_request`는 프로필을 주지 않는다). `profile` 인자는 자리만 남겨 두고 오리 타이핑으로 부른다.
 */

import { data, onDataChange } from './data';
import { PyError, ValueError, get, has, item, pop, round, sorted, truthy, or } from './py';
import { ENGINE_GROWTH_FIELDS, growth_profile, resolve_growth } from './growth';
import {
  _deepcopy_marked, _is_float, _lazy_view, _mark_float, _py_eq, _py_float, _py_is_dict, _py_repr, _py_str,
} from './customization';

const SystemExit = (msg: string) => new PyError('SystemExit', msg);

// ── 오버로드 장비 옵션 ─────────────────────────────────────────────────────

export const OVERLOAD_LV = 10;

// py: context/spec.py:47
export function overload(option: string, lines: number, lv: number = OVERLOAD_LV): number {
  const vals = item(item(data().tables.equipment_skills, option), 'values');
  if (!(1 <= lv && lv <= vals.length)) {
    throw ValueError(`${option}: 레벨은 1~${vals.length}이어야 한다 (${lv})`);
  }
  return round(vals[lv - 1] * 100 * lines, 4);
}

// py: context/spec.py:59
export function overload_lines(option: string, lines: number, lv: number = OVERLOAD_LV): number[] {
  const v = overload(option, 1, lv);
  const out = Array.from({ length: lines }, () => v);
  out.forEach((_, i) => _mark_float(out, i));
  return out;
}

// ── 기본 육성 스펙 ─────────────────────────────────────────────────────────

let _DEFAULT_CHAR_CACHE: Record<string, any> | null = null;

// py: context/spec.py:71 (모듈 상수 DEFAULT_CHAR)
export function _DEFAULT_CHAR(): Record<string, any> {
  if (_DEFAULT_CHAR_CACHE !== null) return _DEFAULT_CHAR_CACHE;
  const equipment: Record<string, any> = {};
  for (const p of ['머리', '몸통', '팔', '다리']) equipment[p] = { level: 5, skills: [] };
  const equip_skills: Record<string, any> = {
    atk_pct: overload('atk_pct', 2),
    element_bonus: overload('element_bonus', 4),
    max_ammo_pct: overload('max_ammo_pct', 2),
    crit_rate: 0,
    crit_dmg: 0,
    charge_speed_pct: 0,
    charge_dmg_pct: 0,
    accuracy_pct: 0,
    def_pct: 0,
  };
  // `round(..., 4)`는 float다.
  _mark_float(equip_skills, 'atk_pct');
  _mark_float(equip_skills, 'element_bonus');
  _mark_float(equip_skills, 'max_ammo_pct');
  const c: Record<string, any> = {
    level: 400,
    breakthrough: 3,
    core_enhancement: 0,
    affinity: 30,
    skill_levels: { '1': 10, '2': 10, '3': 10 },
    burst_regen_time: 2.0,
    weapon_mode_swap: false,
    equipment: equipment,
    equip_skills: equip_skills,
    cube: { name: '렐릭 베어 큐브', level: 15 },
    console: { common_level: 180, class_level: 100, company_level: 100 },
    collection_stage: 'SR15',
    favorite_stage: 3,
    control: {},
  };
  _mark_float(c, 'burst_regen_time');
  _DEFAULT_CHAR_CACHE = c;
  return c;
}

export const DEFAULT_CHAR: Record<string, any> = _lazy_view(() => _DEFAULT_CHAR(), {});

let _CHAR_DEFAULTS_CACHE: Record<string, any> | null = null;

// py: context/spec.py:103
function _load_char_defaults(): Record<string, any> {
  const d = data().char_defaults;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(d)) {
    if (!k.startsWith('_')) out[k] = v;
  }
  return out;
}

/** 모듈 상수 `CHAR_DEFAULTS`의 실제 값. */
export function _CHAR_DEFAULTS(): Record<string, any> {
  if (_CHAR_DEFAULTS_CACHE === null) _CHAR_DEFAULTS_CACHE = _load_char_defaults();
  return _CHAR_DEFAULTS_CACHE;
}

export const CHAR_DEFAULTS: Record<string, any> = _lazy_view(() => _CHAR_DEFAULTS(), {});

onDataChange.push(() => {
  _DEFAULT_CHAR_CACHE = null;
  _CHAR_DEFAULTS_CACHE = null;
});

// ── 육성 프로필 (2.5층, 선택) ──────────────────────────────────────────────
// `GrowthProfile` · `load_profile`은 옮기지 않았다(파일 시스템 전용). 아래 상수만 남긴다.

export const GROWTH_KEYS: ReadonlySet<string> = new Set([
  'level', 'breakthrough', 'core_enhancement', 'affinity', 'skill_levels',
  'equipment', 'equip_skills', 'collection_stage', 'favorite_stage', 'console', 'cube',
]);

export const LEVEL_MODES = ['fixed', 'sync'] as const;

// py: context/spec.py:271
export function deep_merge(base: Record<string, any>, over: Record<string, any> | null | undefined): Record<string, any> {
  const out = _deepcopy_marked(base);
  const src = or(over, {} as Record<string, any>) as Record<string, any>;
  for (const [k, v] of Object.entries(src)) {
    if (k.startsWith('_')) {      // `_note` 같은 주석 키는 시뮬에 넘기지 않는다
      continue;
    }
    if (_py_is_dict(v) && _py_is_dict(get(out, k))) {
      out[k] = deep_merge(out[k], v);
      _mark_float(out, k, false);
    } else {
      out[k] = _deepcopy_marked(v);
      _mark_float(out, k, _is_float(src, k));
    }
  }
  return out;
}

// py: context/spec.py:284
export function char_layer(name: string, members: string[] | null = null): Record<string, any> {
  const layer = get(_CHAR_DEFAULTS(), name, {} as Record<string, any>);
  if (members == null) {
    return layer;
  }
  let out = _deepcopy_marked(layer);
  for (const rule of or(get(layer, '_control_rules'), [] as any[]) as any[]) {
    if (_when_ok(name, or(get(rule, 'when'), {}), members)) {
      out = deep_merge(out, { control: or(get(rule, 'control'), {}) });
    }
  }
  return out;
}

// py: context/spec.py:302
export function build_char(name: string, over: Record<string, any> | null = null, base: Record<string, any> | null = null,
  no_layer: boolean = false, members: string[] | null = null,
  profile: any = null): Record<string, any> {
  let c = _deepcopy_marked(truthy(base) ? base! : _DEFAULT_CHAR());
  const over_ = or(over, {} as Record<string, any>) as Record<string, any>;
  const explicit_control = has(over_, '_control_override');
  const control_override = _deepcopy_marked(get(over_, '_control_override'));
  const direct_growth = [...ENGINE_GROWTH_FIELDS].some((key) => has(over_, key));
  const custom_base_growth = base != null && [...ENGINE_GROWTH_FIELDS].some((key) => has(base, key));
  if (!direct_growth && !custom_base_growth) {
    const meta = get(_nikke(), name);
    if (meta == null) {
      throw ValueError(`${name}: 캐릭터 메타데이터를 찾을 수 없다`);
    }
    const growth_range = growth_profile(name, meta);
    c = deep_merge(c, resolve_growth(name, meta, growth_range['default_stage']));
  }
  if (!no_layer) {
    c = deep_merge(c, char_layer(name, members));
  }
  if (profile != null) {
    c = deep_merge(c, profile.layer(name));
  }
  c = deep_merge(c, over);
  if (explicit_control) {
    c['control'] = control_override;
    _mark_float(c, 'control', false);
  }
  c['name'] = name;
  if (is_preview(name)) {
    const bad: Record<string, any> = {};
    const levels = or(get(c, 'skill_levels'), {} as Record<string, any>) as Record<string, any>;
    for (const [k, v] of Object.entries(levels)) {
      if (!_py_eq(v, 10)) {
        bad[k] = v;
        _mark_float(bad, k, _is_float(levels, k));
      }
    }
    if (truthy(bad)) {
      throw ValueError(
        `${name}: 프리뷰 캐릭터는 스킬 레벨 10으로만 실행할 수 있다 (요청 ${_py_repr(bad)}). `
        + '출시 전 카드가 레벨 10 기준이라 1~9 계수가 존재하지 않는다 — '
        + '출시 후 char-add 단계 R(정식 등록)에서 채운다',
      );
    }
  }
  return c;
}

// py: context/spec.py:349
export function build_squad(names: string[], chars: Record<string, any> | null = null,
  base: Record<string, any> | null = null, no_layer: Set<string> | null = null,
  profile: any = null): Array<Record<string, any>> {
  const over = or(chars, {} as Record<string, any>) as Record<string, any>;
  const skip = no_layer ?? new Set<string>();
  const explicit = new Set<string>();
  for (const [n, v] of Object.entries(over)) {
    if (has(or(v, {}), 'burst_pattern')) explicit.add(n);
  }
  return resolve_patterns(
    names.map((n) => build_char(n, get(over, n), base, skip.has(n), names, profile)), explicit);
}

// ── 버스트 운용 패턴 ───────────────────────────────────────────────────────

// py: context/spec.py:374
// 파이썬의 `_NIKKE_CACHE`(지연 로드한 parsed_nikke 사본). 커스텀 니케도 같은 객체에 얹힌다.
export function _nikke(): Record<string, any> {
  return data().parsed_nikke;
}

// py: context/spec.py:385
function _same_stage_others(name: string, members: string[]): string[] {
  const nk = _nikke();
  const my_stage = _py_str(get(get(nk, name, {}), 'burst_stage', ''));
  return members.filter(
    (m) => m !== name && [my_stage, 'A'].includes(_py_str(get(get(nk, m, {}), 'burst_stage', ''))),
  );
}

// py: context/spec.py:395
export function max_burst_floor(names: string[]): number | null {
  const vals: any[] = [];
  for (const n of names) {
    const v = get(or(get(_CHAR_DEFAULTS(), n), {}), '_max_burst_count');
    if (truthy(v)) vals.push(v);
  }
  return vals.length ? vals.reduce((a, b) => (b > a ? b : a)) : null;
}

// py: context/spec.py:407
export function is_preview(name: string): boolean {
  return truthy(get(get(_nikke(), name, {}), 'preview'));
}

// py: context/spec.py:416
export function preview_note(names: string[]): string {
  const pv = names.filter((n) => is_preview(n));
  if (!pv.length) {
    return '';
  }
  // 카드조차 없어 스킬을 창작한 (임시) 항목은 따로 말한다.
  const made = pv.filter((n) => truthy(get(get(_nikke(), n, {}), 'fabricated')));
  const carded = pv.filter((n) => !made.includes(n));
  const parts: string[] = [];
  if (carded.length) {
    parts.push(`[프리뷰 · 미검증] ${carded.join(', ')} — 출시 전 카드(스킬 레벨 10) 기준. `
      + '인게임 검증 전이므로 수치·발동 조건이 바뀔 수 있다');
  }
  if (made.length) {
    parts.push(`[임시 · 창작] ${made.join(', ')} — 스킬이 공개되지 않아 임의로 창작한 `
      + '값으로 계산했다. 실제 성능과 무관하다');
  }
  return parts.join(' / ');
}

// py: context/spec.py:439
export function burst_stage(name: string): string {
  return _py_str(get(get(_nikke(), name, {}), 'burst_stage', ''));
}

// py: context/spec.py:444
export function _when_ok(name: string, cond: Record<string, any>, members: string[]): boolean {
  const nk = _nikke();
  for (const [key, val] of Object.entries(cond)) {
    let ok: boolean;
    if (key === 'same_stage_cd_max') {
      ok = _same_stage_others(name, members).some(
        (m) => _py_float(or(get(get(nk, m, {}), 'burst_cooldown'), 1e9)) <= val,
      );
    } else if (key === 'same_stage_other') {
      ok = truthy(_same_stage_others(name, members)) === truthy(val);
    } else if (key === 'with_member') {
      ok = (val as any[]).some((m) => members.includes(m));
    } else if (key === 'position') {
      ok = members.includes(name) && _py_eq(members.indexOf(name) + 1, val);
    } else {
      throw SystemExit(`[${name}] 알 수 없는 레이어 조건 키: ${_py_repr(key)}`);
    }
    if (!ok) {
      return false;
    }
  }
  return true;
}

// py: context/spec.py:476
export function resolve_patterns(squad: Array<Record<string, any>>, explicit: Set<string> | null = null): Array<Record<string, any>> {
  const members = squad.map((c) => c['name']);
  const named = explicit ?? new Set<string>();
  for (const c of squad) {
    const name = c['name'];
    if (named.has(name) || !truthy(get(c, 'burst_pattern'))) {
      continue;
    }
    const layer = or(get(_CHAR_DEFAULTS(), name), {} as Record<string, any>) as Record<string, any>;
    const cond = get(layer, '_burst_pattern_when');
    if (truthy(cond) && !_when_ok(name, cond, members)) {
      pop(c, 'burst_pattern', null);
      continue;
    }
    for (const rule of or(get(layer, '_burst_pattern_rules'), [] as any[]) as any[]) {
      if (_when_ok(name, or(get(rule, 'when'), {}), members)) {
        c['burst_pattern'] = item(rule, 'use');
        break;
      }
    }
  }
  return squad;
}

// py: context/spec.py:508
export function burst_pattern_of(name: string, chosen: string | null | undefined): unknown {
  if (!truthy(chosen)) {
    return null;
  }
  const catalog = or(get(or(get(_CHAR_DEFAULTS(), name), {}), '_burst_patterns'), {} as Record<string, any>) as Record<string, any>;
  if (!has(catalog, chosen!)) {
    const keys = Object.keys(catalog);
    throw SystemExit(
      `[${name}] 버스트 패턴 '${chosen}'이 data/char_defaults.json에 없다. `
      + `등록된 패턴: ${keys.length ? _py_repr(keys) : '없음'}`,
    );
  }
  return catalog[chosen!];
}

// py: context/spec.py:521
export function build_config(squad: Array<Record<string, any>>, config: Record<string, any> | null = null): Record<string, any> {
  const cfg = _deepcopy_marked(or(config, {} as Record<string, any>) as Record<string, any>);
  if (truthy(get(cfg, 'burst_sequence'))) {
    return cfg;
  }
  const pats: Record<string, any> = {};
  for (const c of squad) {
    const v = burst_pattern_of(c['name'], get(c, 'burst_pattern'));
    if (v != null) {
      pats[c['name']] = v;
    }
  }
  if (truthy(pats)) {
    cfg['burst_pattern'] = { ...pats, ...(or(get(cfg, 'burst_pattern'), {}) as Record<string, any>) };
  }
  return cfg;
}

// ── 1층 이탈 보고 ──────────────────────────────────────────────────────────

const _SKIP_KEYS = ['name', 'equipment'];  // equipment는 부위별 dict라 노이즈만 된다

// py: context/spec.py:549
// TS 전용 인자 `_is_float_value` — 정수값인 파이썬 float를 `2.0`으로 적기 위한 표시.
function _fmt(v: any, _is_float_value: boolean = false): string {
  if (_py_is_dict(v)) {
    return truthy(v)
      ? '{' + Object.entries(v).map(([k, x]) => `${k}=${_fmt(x, _is_float(v, k))}`).join(', ') + '}'
      : '없음';
  }
  return _py_str(v, _is_float_value);
}

// py: context/spec.py:555
function _flatten(d: Record<string, any>, prefix: string = ''): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(d)) {
    if (k.startsWith('_') || (!prefix && _SKIP_KEYS.includes(k))) {
      continue;
    }
    const key = `${prefix}${k}`;
    const stop = prefix.startsWith('control.');     // 정책 안쪽은 더 쪼개지 않는다
    if (_py_is_dict(v) && truthy(v) && !stop) {
      const sub = _flatten(v, key + '.');
      for (const [sk, sv] of Object.entries(sub)) {
        out[sk] = sv;
        _mark_float(out, sk, _is_float(sub, sk));
      }
    } else {
      out[key] = v;
      _mark_float(out, key, _is_float(d, k));
    }
  }
  return out;
}

/** `(키, 기준값, 실제값, 출처)` + TS 전용 float 표시(기준값·실제값). */
export type Deviation = [string, unknown, unknown, string] & { _float?: [boolean, boolean] };

// py: context/spec.py:570
export function char_deviations(char: Record<string, any>, members: string[] | null = null,
  profile: any = null): Deviation[] {
  const name = get(char, 'name', '');
  const ref = build_char(name, null, null, false, members, profile);
  const base = _flatten(profile != null ? ref : _DEFAULT_CHAR());
  const layered = _flatten(ref);                                 // 레이어(+프로필)까지만 적용한 모습
  const cur = _flatten(char);

  const out: Deviation[] = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(cur)]);
  for (const k of sorted(keys)) {
    const b = get(base, k, '없음');
    const c = get(cur, k, '없음');
    if (_py_eq(b, c) || (_py_eq(b, {}) && !has(cur, k))) {
      continue;        // `control: {}` → 하위 정책 줄로 이미 드러난다
    }
    const src = _py_eq(get(layered, k, '없음'), c) ? '레이어' : '지정';
    const row = [k, b, c, src] as Deviation;
    row._float = [_is_float(base, k), _is_float(cur, k)];
    out.push(row);
  }
  return out;
}

// py: context/spec.py:599
// 파이썬은 {이름: 이탈} dict다. 이름이 정수 모양(커스텀 니케)이면 JS 객체는 순서가 바뀌므로 Map으로 둔다.
export function squad_deviations(squad: Array<Record<string, any>>, profile: any = null): Map<string, Deviation[]> {
  const members = squad.map((c) => get(c, 'name', ''));
  const out = new Map<string, Deviation[]>();
  for (const c of squad) {
    const d = char_deviations(c, members, profile);
    if (d.length) {
      out.set(get(c, 'name', '?'), d);
    }
  }
  return out;
}

// py: context/spec.py:607
export function format_deviations(squad: Array<Record<string, any>>, indent: string = '',
  profile: any = null): string {
  const names = squad.map((c) => get(c, 'name', ''));
  const note = preview_note(names);
  const head: string[] = note ? [`${indent}⚠ ${note}`] : [];
  if (profile != null) {
    head.push(`${indent}⚠ ${profile.header()}`);
    head.push(...[...profile.notes(names), ...profile.cube_notes(squad)].map((n: string) => `${indent}⚠ ${n}`));
  }
  const dev = squad_deviations(squad, profile);
  const label = profile != null ? '프로필(2.5층)' : '기본 스펙(1층)';
  if (!dev.size) {
    if (profile != null) {
      return [...head, `${indent}프로필 그대로 — 추가 지정 없음.`].join('\n');
    }
    return [...head, `${indent}기본 스펙(1층) 그대로 — 컨트롤 자동 · 공통 장비 옵션.`].join('\n');
  }
  const lines = [...head, `${indent}⚠ ${label} 이탈 ${dev.size}명 —`];
  for (const [nm, items] of dev) {
    for (const row of items) {
      const [k, b, c, src] = row;
      const [bf, cf] = row._float ?? [false, false];
      lines.push(`${indent}  [${nm}] ${k}: ${_fmt(b, bf)} → ${_fmt(c, cf)}  (${src})`);
    }
  }
  return lines.join('\n');
}
