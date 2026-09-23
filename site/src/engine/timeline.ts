/**
 * Phase 5: 전투 타임라인 시뮬레이터 — `calculator/timeline.py` 직역.
 *
 * simulate(squad, config, enemy) → SimResult
 *
 * 설계:
 *   - dt = 1/60초 (16.67ms) 고정 스텝
 *   - 발사: while current_time >= next_fire_time 루프로 누적 오차 없음
 *   - SG: 펠릿마다 calc_damage() 독립 호출, hit_count notify 펠릿 수만큼 발생
 *   - 버스트 사용 중에도 기본 발사는 계속 진행 (bursting 플래그 없음)
 *   - weapon_change 타입 스킬: 활성 시 임시 무기 교체 후 차지 사격 1발 발사
 *
 * 번역 규칙은 `README.md`. 파이썬 모듈 수준 데이터(`_NIKKE` 등)는 import 시점에 읽지 않고
 * 같은 이름의 **접근 함수**로 둔다(`_NIKKE()`).
 */

import { calc_base_stats } from './base_stat';
import { BuffManager, BURST_GAUGE_EXCEPTIONS, _QUANT_PARTS_KEY, _get_skill_lv, abStat } from './buff_manager';
import { from_config as cheats_from_config } from './cheats';
import { normalize_optimal_range_windows } from './customization';
import { probabilities as pellet_probabilities } from './pellet_accuracy';
import { ShotgunHeatmap } from './shotgun_heatmap';
import { calc_damage, default_hit_type, is_element_match } from './damage';
import {
  HitEvent,
  _is_normal,
  BurstLogEntry,
  BuffEntry,
  BuffEvent,
  BuffSnapshot,
  GaugeLogEntry,
  InstantEvent,
  ReloadLogEntry,
  AmmoLogEntry,
  ChargeLogEntry,
  SimLog,
  SimResult,
} from './sim_result';
import { data } from './data';
import {
  random,
  get,
  has,
  item,
  setdefault,
  truthy,
  or,
  and,
  float,
  int,
  round,
  sum,
  sorted,
  cmp,
  minBy,
  maxBy,
  ValueError,
  tupleKey,
} from './py';

type Dict = Record<string, any>;
/** BuffManager 인스턴스. 형제 모듈 내부 필드(`_active`·`state` 등)를 직접 읽으므로 느슨하게 받는다. */
type BM = any;

// ── 로컬 도우미 (파이썬 의미) ──────────────────────────────────────────────

/** 파이썬 `max(a, b)` — 같으면 앞의 것, NaN·-0 처리까지 CPython과 같다. */
function _pymax(a: number, b: number): number {
  return b > a ? b : a;
}

/** 파이썬 `min(a, b)`. */
function _pymin(a: number, b: number): number {
  return b < a ? b : a;
}

/** 파이썬 `x in coll` — 리스트·튜플·set·frozenset·dict(키)·문자열(부분 문자열). */
function _in(x: any, coll: any): boolean {
  if (coll == null) return false;
  if (Array.isArray(coll)) return coll.includes(x);
  if (coll instanceof Set || coll instanceof Map) return coll.has(x);
  if (typeof coll === 'string') return typeof x === 'string' && coll.includes(x);
  if (typeof coll === 'object') return has(coll, x);
  return false;
}

/** `isinstance(v, dict)`. */
function _isdict(v: any): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    && !(v instanceof Set) && !(v instanceof Map);
}

/** 파이썬 `str(v)` (f-string `{v}`) — None·bool·리스트 표기. 수는 JS 표기(정수/실수 구분 불가). */
function _pystr(v: any): string {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v) || v instanceof Set) return _repr(v);
  return String(v);
}

/** 파이썬 `repr(v)` (f-string `{v!r}`, 리스트의 `str`). */
function _repr(v: any): string {
  if (typeof v === 'string') {
    const quote = v.includes("'") && !v.includes('"') ? '"' : "'";
    let out = '';
    for (const ch of v) {
      if (ch === '\\') out += '\\\\';
      else if (ch === quote) out += '\\' + ch;
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else {
        const cp = ch.codePointAt(0)!;
        if (cp < 0x20 || cp === 0x7f) out += '\\x' + cp.toString(16).padStart(2, '0');
        else out += ch;
      }
    }
    return quote + out + quote;
  }
  if (Array.isArray(v)) return '[' + v.map(_repr).join(', ') + ']';
  if (v instanceof Set) return v.size ? '{' + [...v].map(_repr).join(', ') + '}' : 'set()';
  return _pystr(v);
}

/** f-string `{x:.nf}` — 정확한 이진값 기준 은행가 반올림(파이썬 format과 같다). */
function _fmt(x: number, n: number): string {
  return round(x, n).toFixed(n);
}

/** f-string `{x:,}` — 디버그 출력 전용(근사). */
function _commas(x: any): string {
  if (typeof x !== 'number') return _pystr(x);
  const s = String(x);
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf('.');
  const ip = dot < 0 ? body : body.slice(0, dot);
  const fp = dot < 0 ? '' : body.slice(dot);
  return (neg ? '-' : '') + ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + fp;
}

/** `s.split(sep, 1)[1]` — JS `split`의 limit은 나머지를 버리므로 따로 둔다. */
function _split1(s: string, sep: string): string {
  const i = s.indexOf(sep);
  if (i < 0) throw new Error('IndexError: list index out of range');
  return s.slice(i + sep.length);
}

/** `s.lstrip("-").isdigit()`. */
function _lstrip_isdigit(s: string): boolean {
  return /^[0-9]+$/.test(s.replace(/^-+/, ''));
}

/** `BURST_GAUGE_EXCEPTIONS` — 형제 모듈이 값으로 내든 지연 함수로 내든 받는다. */
function _burst_gauge_exceptions(): Dict {
  const v: any = BURST_GAUGE_EXCEPTIONS;
  return typeof v === 'function' ? v() : v;
}

/** `state["rng_acc"]`의 튜플 키. 파이썬 `(key, name)` 튜플 대신 문자열로 둔다. */
function _tuple_key(parts: string[]): string {
  return tupleKey(...parts);
}
function _acc_get(acc: any, k: string, dflt = 0.0): number {
  if (acc instanceof Map) return acc.has(k) ? acc.get(k) : dflt;
  return get(acc, k, dflt);
}
function _acc_set(acc: any, k: string, v: number): void {
  if (acc instanceof Map) acc.set(k, v);
  else acc[k] = v;
}

// ── 데이터 (파이썬 모듈 수준 `_load(...)` — 접근 함수로) ───────────────────

// py: calculator/timeline.py:53
export function _NIKKE(): Dict {
  return data().parsed_nikke;
}
// py: calculator/timeline.py:54
export function _MECHANICS(): Dict {
  return data().weapon_mechanics;
}
// py: calculator/timeline.py:55
export function _PARSED_SKILLS(): Dict {
  return data().parsed_skills;
}
// py: calculator/timeline.py:56
export function _DELAYS(): Dict {
  return data().weapon_delays;
}
// py: calculator/timeline.py:58
export function _ACCURACY_DATA(): Dict {
  return get(_MECHANICS(), 'accuracy', {});
}
// py: calculator/timeline.py:59
export function _NORMAL_HIT_COEFF(): Dict {
  return get(_MECHANICS(), 'normal_hit_coeff', {});
}

// py: calculator/timeline.py:62
export function normal_hit_coeff(cfg: Dict, weapon_type: string): number {
  // 평타에 곱할 계수. 실전에서 탄퍼짐으로 빗나가는 탄을 보정한다.
  // **평타에만 붙는다** — 스킬·버스트와 변신 모드 사격은 조준 판정이라 보정하지 않는다.
  const over = or(get(cfg, 'normal_hit_coeff'), {});
  if (_in(weapon_type, over)) {
    return _pymax(0.0, float(over[weapon_type]));
  }
  const base = get(_NORMAL_HIT_COEFF(), weapon_type, 1.0);
  return (typeof base === 'number' || typeof base === 'boolean') ? _pymax(0.0, float(base)) : 1.0;
}

// py: calculator/timeline.py:74
export function _MODEL_N(): number {
  return float(get(_ACCURACY_DATA(), '_model_n', 2.55));
}

// py: calculator/timeline.py:76
export const DT = 1 / 60; // 시뮬레이션 스텝 (초)

// ── 소스별 반올림 (장탄 · 차지 시간) ───────────────────────────────────────
//   최대 장탄 = 기본장탄 + Σ 반올림(기본장탄 × 그룹%, 1발) + flat   (하한 1발)
//   차지 시간 = 기본차지 − Σ 반올림(기본차지 × 그룹%, 0.01초) + flat (하한 0초)
// 0.5는 올린다(유저 지정). 음수 쪽도 같은 방향(+∞)이라 −2.5는 −2가 된다.

// py: calculator/timeline.py:89
export function _round_half_up(x: number): number {
  return Math.floor(x + 0.5);
}

// py: calculator/timeline.py:93
export function _quantize(x: number, step: number): number {
  // `x`를 `step` 눈금에 맞춰 반올림. 0.01초 눈금은 부동소수점 오차를 피해 정수로 센다.
  return _round_half_up(x / step) * step;
}

// py: calculator/timeline.py:98
export function _quant_sum(base: number, buffs: Dict, buff_key: string, step: number): number {
  // `base`에 걸린 그룹별 % 기여를 각각 반올림해 더한 총량.
  let parts: any = get(or(get(buffs, _QUANT_PARTS_KEY), {}), buff_key);
  if (parts == null) {
    const total = get(buffs, buff_key, 0.0);
    parts = truthy(total) ? [total] : [];
  }
  return sum((parts as number[]).map((p) => _quantize(base * (p / 100.0), step)));
}

// ── 컨트롤 상수 (context/CONTROL.md) ───────────────────────────────────────
// py: calculator/timeline.py:115
export const _TAP_MIN_HOLD = 0.22; // 사격 전 딜레이 = 최소 누름 시간(초). 더 짧게 누르면 발사 안 됨
export const _TAP_CUTTABLE_DELAY = 0.16; // 사격 후 딜레이(초). 컨트롤로 지울 수 있는 몫
export const _TAP_RELEASE_DEFAULT = 0.03; // 톡톡이 떼는 시간 기본값(초). 하드웨어 하한 0.02
export const _RELOAD_LEAD_DEFAULT = 0.3; // 장전컨 A: 풀버스트 종료 몇 초 전에 재장전을 시작할지
export const _RELOAD_MARGIN_DEFAULT = 0.1; // 장전컨 B: 풀버스트 시작 몇 초 뒤에 재장전이 끝나게 할지
export const _HOLD_LEAD_DEFAULT = 0.5; // 홀드컨: 풀버스트 종료 몇 초 전에 들고 있던 풀차지를 뗄지
export const _CTRL_FRAME = 1.0 / 60.0; // 한 프레임(초). 판정 직후를 가리킬 때 쓰는 최소 여유

// ── 기본 config / enemy ────────────────────────────────────────────────────

// py: calculator/timeline.py:125
export const DEFAULT_CHAR: Dict = {
  level: 400,
  breakthrough: 3,
  core_enhancement: 0,
  affinity: 30,
  skill_levels: { '1': 10, '2': 10, '3': 10 },
  burst_regen_time: 2.0,
  equipment: Object.fromEntries(
    ['머리', '몸통', '팔', '다리'].map((p) => [p, { level: 5, skills: [] }]),
  ),
  cube: { name: '렐릭 베어 큐브', level: 15 },
  console: { common_level: 180, class_level: 100, company_level: 100 },
  collection_stage: 'SR15',
  control: {}, // 컨트롤(톡톡이·장전컨). 스키마·의미는 context/CONTROL.md
};

// py: calculator/timeline.py:139
export const DEFAULT_CONFIG: Dict = {
  duration: 180.0, // 시뮬레이션 시간(초) — 실제 니케 전투 3분
  burst_switch_delay: 0.1, // 버스트 단계 전환 딜레이(초)
  // 사람이 버스트를 누르는 데 걸리는 시간. **버스트 하나하나마다** 이만큼 늦게 나간다.
  burst_reaction: 0.05,
  burst_reenter_delay: 0.5, // reenter 딜레이(초)
  max_burst_count: null, // 최대 풀버스트 횟수 (None = 무제한)
  burst_sequence: null, // 풀버스트별 단계 사용 순서 (None = 자동)
  first_burst_time: 3.0, // 첫 버스트 최소 시작 시간(초)
  allow_unparsed: false, // True면 스킬 미파싱 캐릭터를 스킬 0개로 돌린다
  // 난수(크리·코어히트) 처리 방식. "random" / "expected"
  rng_mode: 'random',
  // 족자 중에는 평타가 빗나가므로 버스트 게이지도 안 찬다고 본다.
  immune_blocks_burst: true,
  // 버스트 게이지 사이클 판정 — "fixed" / "accumulate"
  burst_gauge_mode: 'fixed',
  // 카메라(풀차지 게이지 배율을 받는 니케). None이면 컨트롤에서 유도한다 — _resolve_cameras().
  camera: null,
  // "single"(정확히 1명) / "shared"(컨트롤 켠 전원 — 비현실적 상한).
  camera_mode: 'single',
};

// py: calculator/timeline.py:171
export const DEFAULT_ENEMY: Dict = {
  def: 31784,
  code: null,
  core_px: 0, // 코어 직경(px). 0이면 코어 없음
  core_windows: [], // 코어 노출 [시작, 끝). 비어 있으면 항상 노출
  defense_rate_windows: [], // [시작, 끝, 방어율%]
  has_parts: false, // 파괴 가능 파츠 보유 보스
  optimal_range_weapons: [], // 적정거리 적용 무기군 목록
  optimal_range_windows: [], // [from, to) 무기군 합집합
  immune_windows: [], // 족자
  element_windows: [], // 속저
  // 관통 사격이 꿰뚫는 몸통·파츠 수. 기본은 몸통 하나.
  pierce_pass: { shapes: 1, parts: 0 },
};

// py: calculator/timeline.py:192
export function _pick(key: string, sources: Array<Dict | null | undefined>, dflt: any = null): any {
  // 발사 메카닉 값의 3계층 해석. 앞 소스가 이긴다. `is not None` 검사 — 0을 유효값으로 살린다.
  for (const src of sources) {
    if (src != null && get(src, key) != null) {
      return src[key];
    }
  }
  return dflt;
}

// py: calculator/timeline.py:207
export function _core_hit_prob(weapon_type: string, accuracy_pct: number, core_px: number): number {
  // 명중률·코어 크기로부터 코어히트 확률 반환 (power 모델 P = min(1, (r_c/R)^n)).
  const spec = get(_ACCURACY_DATA(), weapon_type, {});
  const D = _pymax(get(spec, 'base_diameter', 10) - get(spec, 'acc_slope', 0) * accuracy_pct, 1.0);
  const R = D / 2.0;
  const r_c = core_px / 2.0;
  return _pymin(1.0, (r_c / R) ** _MODEL_N());
}

// py: calculator/timeline.py:221
export function _pierce_passthrough(enemy: Dict): [number, number] {
  // 관통 사격이 꿰뚫는 **몸통 수와 파츠 수**. 기본은 몸통 하나.
  const spec = or(get(enemy, 'pierce_pass'), {});
  const shapes = _pymax(1, int(or(get(spec, 'shapes', 1), 1)));
  const parts = _pymax(0, int(or(get(spec, 'parts', 0), 0)));
  return [shapes, parts];
}

// py: calculator/timeline.py:233
export function _apply_hit_coeff(damage: any, cfg: Dict, weapon_type: string, is_skill_shot: boolean): any {
  // 평타 대미지에 무기군 계수를 태운다. 계수가 1이면 값을 손대지 않는다.
  if (is_skill_shot) {
    return damage;
  }
  const k = normal_hit_coeff(cfg, weapon_type);
  // 히트 단위로 반올림해 정수로 남긴다.
  return k === 1.0 ? damage : round(damage * k);
}

// py: calculator/timeline.py:244
export function _notify_frac(bm: BM, key: string, name: string, frac: number, fire: () => void): void {
  // 확률적으로 일어나는 히트 이벤트를 소수 누적으로 발화한다.
  if (frac >= 1.0) {
    fire();
    return;
  }
  if (frac <= 0.0) {
    return;
  }
  const acc = item(bm.state, 'rng_acc');
  const k = _tuple_key([key, name]);
  _acc_set(acc, k, _acc_get(acc, k, 0.0) + frac);
  while (_acc_get(acc, k) >= 1.0) {
    _acc_set(acc, k, _acc_get(acc, k) - 1.0);
    fire();
  }
}

// ── CharState (캐릭터별 발사 상태) ────────────────────────────────────────

// py: calculator/timeline.py:269
export class CharState {
  // 캐릭터 1명의 발사 루프 상태 관리. 버스트 사용 중에도 발사 계속.
  char!: Dict;
  name!: string;
  base_atk!: number;
  enemy_code!: any;
  base_element_match!: boolean;
  burst_stage!: string;
  weapon!: Dict;
  weapon_type!: string;
  base_weapon_type!: string;
  mech!: Dict;
  fire_mode!: string;
  ammo!: number;
  reloading_until!: number;
  _post_reload_end_t!: number;
  next_fire_time!: number;
  _sim_log!: SimLog | null;
  warmup_shots!: number;
  last_fire_t!: number;
  _last_inter!: number;
  post_reload_delay!: number;
  reload_start_delay!: number;
  cover_during_delay!: any;
  _pending_auto_reload!: boolean;
  fire_rate!: number;
  fire_rate_max!: any;
  warmup_bullets!: number;
  muzzles!: number;
  burst_energy!: number;
  charge_time_base!: number;
  post_fire_delay!: number;
  _charge_phase!: string;
  _charge_start_t!: number;
  _charge_end_t!: number;
  _post_delay_end_t!: number;
  pellets!: number;
  is_clip!: boolean;
  _in_weapon_change!: boolean;
  _reload_in_weapon_change!: boolean;
  _wc_shots!: number;
  _wc_new_session!: boolean;
  _wc_dynamic_ammo!: number | null;
  _wc_first_coeff!: number | null;
  _wc_normal_coeff!: number | null;
  accuracy_weapon!: string;
  accuracy_floor_pct!: number;
  _spread_spec!: Dict;
  _spread_scale!: number;
  _spread_reload_at!: number | null;
  shotgun_stats!: Dict;
  _shotgun_heatmap!: ShotgunHeatmap | null;
  _wc_ammo_borrowed!: boolean;
  _wc_refill_on_exit!: boolean;
  weapon_mode_swap!: boolean;
  weapon_mode_swap_at!: number;
  bunny_mode!: any;
  tap_fire!: boolean;
  _tap_hold!: number;
  _tap_charge!: number;
  _tap_release!: number;
  _tap_post!: number;
  tap_full_charge_interval!: number;
  tap_policy!: string;
  tap_reload_at_end!: boolean;
  tap_full_charge_after_reload!: boolean;
  _tap_full_pending!: boolean;
  _tap_reload_anchor!: number;
  _last_full_charge_t!: number;
  _force_full_charge!: boolean;
  _wc_skill_damage!: boolean;
  _wc_name!: any;
  reload_policy!: any;
  reload_lead!: number;
  reload_margin!: number;
  reload_if_dry!: boolean;
  reload_cover_dur!: number | null;
  _reload_ctrl_anchor!: number;
  reload_cancel_on_full!: boolean;
  cover_policy!: any;
  cover_extend!: number;
  _cover_ctrl_anchor!: number;
  _charge_full_t!: number;
  _hold_release_t!: number;
  hold_policy!: any;
  hold_lead!: number;
  _hold_ctrl_anchor!: number;
  _charge_hold_fired!: Set<string>;
  _ch_charge_start_t!: number;
  _ch_judge_t!: number;
  _cover_until!: number;
  _cover_until_reload!: boolean;
  _ctrl_seq!: Dict[];
  _ctrl_seq_i!: number;

  // py: calculator/timeline.py:272
  constructor(char: Dict, base_atk: number, enemy_code: any) {
    this.char = char;
    this.name = item(char, 'name');
    this.base_atk = base_atk;

    const weapon_data = item(_NIKKE(), this.name);

    // 로스터 코드 상성은 전투 내내 고정이지만, `element_code_override`는 버프라
    // 활성 여부를 조회 시점에 봐야 한다 → element_match()가 둘을 합친다.
    this.enemy_code = enemy_code;
    this.base_element_match = is_element_match(
      get(weapon_data, 'element_code', ''), enemy_code);

    this.burst_stage = item(weapon_data, 'burst_stage');
    this.weapon = weapon_data;
    this.weapon_type = item(weapon_data, 'weapon_type');
    // 무기 변경 중에도 안 바뀌는 원래 무기 타입.
    this.base_weapon_type = this.weapon_type;

    const mech = item(item(_MECHANICS(), 'weapon_type_defaults'), this.weapon_type);
    this.mech = mech;
    // 파스칼처럼 무기군은 RL이지만 차지할 수 없는 예외는 캐릭터 데이터가 덮어쓴다.
    this.fire_mode = get(weapon_data, 'fire_mode', item(mech, 'type'));

    this.ammo = item(weapon_data, 'max_ammo');
    this.reloading_until = -1.0;
    this._post_reload_end_t = -1.0;
    this.next_fire_time = 0.0;
    this._sim_log = null;

    // MG 예열 (식는 속도가 있어 미사격 시 점진 냉각 — int 아닌 float)
    this.warmup_shots = 0.0;
    this.last_fire_t = -999.0;
    this._last_inter = 0.0; // 직전 발사가 예약한 간격 (_cool_warmup 판정 기준)

    // delay 값: weapon_delays.json 기준
    const _delay_exc = get(item(_DELAYS(), '_exceptions'), this.name, {});
    const _delay_wt = get(item(_DELAYS(), '_defaults_by_weapon_type'), this.weapon_type, {});
    this.post_reload_delay = get(_delay_exc, 'post_reload_delay', get(_delay_wt, 'post_reload_delay', 0.0));
    // 탄을 비워 자동으로 걸리는 재장전은 «마지막 발 → 장전 시작»에도 지연이 있다.
    this.reload_start_delay = get(
      _delay_exc, 'reload_start_delay', get(_delay_wt, 'reload_start_delay', 0.0));
    // 엄폐 니케: 재장 ≥100%일 때 post_fire_delay 중 자동재장전 (장탄 유지)
    this.cover_during_delay = get(_delay_exc, 'cover_during_delay', false);
    this._pending_auto_reload = false;

    // 발사 메카닉 3계층 해석 (_pick 참조).
    this.fire_rate = float(_pick(
      'fire_rate', [_delay_exc, weapon_data, mech],
      get(mech, 'fire_rate_min', 1.0)));
    this.fire_rate_max = _pick(
      'fire_rate_max', [_delay_exc, weapon_data, mech]);
    const _fr_step = _pick('fire_rate_change_pershot', [_delay_exc, weapon_data]);
    if (this.fire_rate_max != null && truthy(_fr_step)) {
      // 캐릭터별 값이 있으면 예열 발수를 곡선에서 직접 유도한다
      this.warmup_bullets = (this.fire_rate_max - this.fire_rate) / _fr_step;
    } else {
      this.warmup_bullets = float(get(mech, 'warmup_bullets', 1.0));
    }

    // 총구 수: 1회 발사에 동시에 나가는 탄 묶음 수. 실제 히트 수 = pellets × muzzles.
    this.muzzles = int(_pick('muzzles', [_delay_exc, weapon_data, mech], 1));
    // 히트당 버스트 게이지(%).
    this.burst_energy = float(
      _pick('burst_energy', [_delay_exc, weapon_data, mech], 0.0));

    // charge (SR/RL)
    if (this.fire_mode === 'charge') {
      const charge_time_raw = get(char, 'charge_time_frames');
      if (charge_time_raw != null) {
        this.charge_time_base = charge_time_raw / 60.0;
      } else {
        this.charge_time_base = item(weapon_data, 'charge_time');
      }
      this.post_fire_delay = get(_delay_exc, 'post_fire_delay', get(_delay_wt, 'post_fire_delay', get(mech, 'post_fire_delay', 0.0)));
    } else {
      this.charge_time_base = 0.0;
      this.post_fire_delay = 0.0;
    }
    this._charge_phase = 'ready';
    this._charge_start_t = 0.0;
    this._charge_end_t = 0.0;
    this._post_delay_end_t = 0.0;

    // SG (계수를 나누는 단위. 히트 수는 self.muzzles를 곱한 값)
    this.pellets = int(_pick('pellets', [_delay_exc, weapon_data, mech], 1));

    // 클립 무기 여부 (일부 SG/RL). 처리는 _finish_reload()·_reload_total_duration().
    const _clip_chars = get(get(_MECHANICS(), 'clip_characters', {}), this.weapon_type, []);
    this.is_clip = _in(this.name, _clip_chars);

    this._in_weapon_change = false;
    // 이 재장전이 무기 변경 모드 안에서 시작됐는가 (모드 탄창 vs 원래 무기 탄창)
    this._reload_in_weapon_change = false;
    this._wc_shots = 0; // 현재 무기 변경 세션에서 실제 발사한 발수
    this._wc_new_session = false; // 이번 tick이 세션 첫 진입인가
    this._wc_dynamic_ammo = null; // 게이지 연동 변경 무기의 진입 시 장탄 스냅샷
    // `first_damage_coeff`(원문 `최초 대미지`)의 레벨 환산값. 세션 첫 발에만 쓴다.
    this._wc_first_coeff = null;
    this._wc_normal_coeff = null; // 같은 세션의 `일반 대미지` 계수
    // 탄착군을 재는 무기군. 빈 문자열이면 지금 든 무기로 잰다.
    this.accuracy_weapon = '';
    // 무기 변경 모드의 명중률 하한(%).
    this.accuracy_floor_pct = -Infinity;
    this._spread_spec = get(weapon_data, 'spread', {});
    this._spread_scale = float(get(this._spread_spec, 'start', 250));
    this._spread_reload_at = null;
    this.shotgun_stats = {};
    this._shotgun_heatmap = null;
    // 연사 무기 모드는 진입 시 self.ammo를 모드 장탄으로 덮어쓴다(원래 장탄은 버린다).
    this._wc_ammo_borrowed = false;
    this._wc_refill_on_exit = false;

    // 모드 지정 플래그: 수동 재장전으로 진입하는 weapon_change 모드를 쓰는가.
    this.weapon_mode_swap = truthy(get(char, 'weapon_mode_swap', false));
    this.weapon_mode_swap_at = float(get(char, 'weapon_mode_swap_at', 0.0));

    // ── 컨트롤 (유저 조작 재현). 정본: context/CONTROL.md ─────────────
    const control = or(get(char, 'control'), {});
    this.bunny_mode = get(control, 'bunny_mode', 'engage');

    // 톡톡이: 차지를 끝까지 하지 않고 짧게 눌렀다 떼기를 반복 (차지형 전용).
    this.tap_fire = false;
    this._tap_hold = 0.0; // 누름 시간 = 사격 전 딜레이 + 차지
    this._tap_charge = 0.0; // 그중 실제로 차지되는 시간
    this._tap_release = 0.0;
    this._tap_post = 0.0;
    const tap = get(control, 'tap_fire');
    if (truthy(tap) && this.fire_mode === 'charge') {
      const rate = float(item(tap, 'rate'));
      this._tap_release = float(get(tap, 'release', _TAP_RELEASE_DEFAULT));
      // 목표 주기를 [사격 전 딜레이 + 차지 + 떼기 + 남은 사격 후 딜레이]로 분해한다.
      const slack = _pymax(0.0, 1.0 / rate - _TAP_MIN_HOLD - this._tap_release);
      this._tap_post = _pymin(_TAP_CUTTABLE_DELAY, slack);
      // 사격 전 딜레이 0.22초는 차지가 시작되기 전 구간이라 차지에 들어가지 않는다.
      this._tap_charge = _pymax(0.0, slack - _TAP_CUTTABLE_DELAY);
      this._tap_hold = _TAP_MIN_HOLD + this._tap_charge;
      this.tap_fire = true;
    }
    // 톡톡이 중 주기적으로 풀차지 한 발을 섞는다.
    this.tap_full_charge_interval = float(get(or(tap, {}), 'full_charge_interval', 0.0));
    // 버충 톡톡이: 풀버스트 **밖에서만** 톡톡이하고, 풀버스트 동안은 평소처럼 풀차지를 든다.
    this.tap_policy = _pystr(get(or(tap, {}), 'policy', 'always'));
    this.tap_reload_at_end = truthy(get(or(tap, {}), 'reload_at_end', true));
    // 재장전 뒤 **첫 발은 풀차지**로 쏘고 톡톡이로 넘어간다. 기본 켬.
    this.tap_full_charge_after_reload = truthy(
      get(or(tap, {}), 'full_charge_after_reload', true));
    this._tap_full_pending = false;
    this._tap_reload_anchor = -1.0;
    this._last_full_charge_t = -1e9;
    this._force_full_charge = false;
    this._wc_skill_damage = false;
    this._wc_name = '';

    // 장전컨: 엄폐로 재장전을 유리한 구간에 밀어 넣는다.
    const rl = or(get(control, 'reload'), {});
    this.reload_policy = get(rl, 'policy', '');
    this.reload_lead = float(get(rl, 'lead', _RELOAD_LEAD_DEFAULT));
    this.reload_margin = float(get(rl, 'margin', _RELOAD_MARGIN_DEFAULT));
    // 비버스트에 탄이 마를 때만 건다 (정책 A 전용).
    this.reload_if_dry = truthy(get(rl, 'if_dry', false));
    // 엄폐 지속 시간(초). None이면 재장전이 끝나는 순간까지만 엄폐한다
    this.reload_cover_dur = (
      get(rl, 'duration') == null ? null : float(item(rl, 'duration')));
    // 이미 처리한 앵커 시각 (사이클당 1회 보장)
    this._reload_ctrl_anchor = -1.0;
    // 탄충 취소: 재장전 중에 탄환 충전이 들어와 탄창이 꽉 차면 재장전을 끊고 즉시 사격한다.
    this.reload_cancel_on_full = truthy(get(rl, 'cancel_on_full', false));

    // 버스트 엄폐컨: 본인이 버스트를 쓴 사이클의 풀버스트 동안 **한 발도 쏘지 않는다.**
    const cv = or(get(control, 'cover'), {});
    this.cover_policy = get(cv, 'policy', '');
    this.cover_extend = float(get(cv, 'extend', 0.0));
    this._cover_ctrl_anchor = -1.0;

    // 홀드(차지 유지): 풀차지가 끝나도 떼지 않고 지정 시각까지 들고 있는다 (차지형 전용).
    this._charge_full_t = -1.0; // 풀차지 도달 시각(래치). <0이면 아직 차지 중
    this._hold_release_t = -1.0; // 떼기 시각. <0이면 홀드 안 함

    // 홀드컨: 본인이 버스트를 쓴 사이클의 풀버스트 동안 풀차지를 들고 있다가 종료 `lead`초 전에 뗀다.
    const hd = or(get(control, 'hold'), {});
    this.hold_policy = get(hd, 'policy', '');
    this.hold_lead = float(get(hd, 'lead', _HOLD_LEAD_DEFAULT));
    this._hold_ctrl_anchor = -1.0;

    // `charge_hold:N` 판정용 상태 (밀크 : 블루밍 바니 부끄러움).
    this._charge_hold_fired = new Set();
    // `charge_hold_after_fb` 정책이 이번 사이클에 잡아 둔 시각.
    this._ch_charge_start_t = -1.0;
    this._ch_judge_t = -1.0;

    // ── 컨트롤 실행층 ────────────────────────────────────────────────
    this._cover_until = -1.0; // >0이면 엄폐 중 (해제 예정 시각)
    this._cover_until_reload = false; // 재장전이 끝날 때까지 엄폐 (duration 미지정)
    // 명시 시퀀스 — 정책으로 표현 못 하는 조작을 시각으로 직접 적는 통로.
    this._ctrl_seq = sorted(
      or(get(control, 'sequence'), []) as Dict[], (a) => float(get(a, 't', 0.0)));
    this._ctrl_seq_i = 0;
  }

  // py: calculator/timeline.py:518
  element_match(bm: BM): boolean {
    // 이 히트에 우월 코드(DealForm ⑦)가 붙는가. 로스터 코드 상성 OR `element_code_override` 버프.
    return this.base_element_match || bm.element_override_match(
      this.name, this.enemy_code);
  }

  // py: calculator/timeline.py:528
  tick(t: number, bm: BM, enemy: Dict, cfg: Dict): HitEvent[] {
    // 기절 중: 일반공격 불가
    if (bm.is_stunned(this.name)) {
      return [];
    }

    // weapon_change 활성 시: 임시 무기 교체 후 해당 무기의 발사 루프로 처리
    let wc_eff = bm.get_weapon_change(this.name);
    if (wc_eff != null) {
      if (!this._in_weapon_change) {
        this._in_weapon_change = true;
        this._wc_shots = 0;
        this._wc_new_session = true;
        this._wc_refill_on_exit = truthy(get(wc_eff, 'refill_on_exit'));
      }
      // 자기 탄창을 관리하는 모드(지속형 + 유한 장탄)만 모드 안에서 재장전을 완료시킨다.
      if (this.reloading_until > 0 && this._reload_in_weapon_change
          && get(wc_eff, 'max_ammo', -1) !== -1
          && get(wc_eff, 'duration') == null
          && get(wc_eff, 'duration_bullets') == null) {
        if (t < this.reloading_until) {
          return [];
        }
        this._finish_reload(t, bm);
      }
      return this._tick_weapon_change(t, bm, enemy, cfg, wc_eff);
    }

    // weapon_change 만료 직후: next_fire_time 리셋으로 과거 발사 빚 방지
    if (this._in_weapon_change) {
      this._in_weapon_change = false;
      this._wc_dynamic_ammo = null;
      this.next_fire_time = t;
      if (this._wc_refill_on_exit) {
        this._restore_special_magazine(t, bm);
      }
      if (this._wc_ammo_borrowed) {
        // 모드 종료 = 재장전 완료 상태로 본다 (유저 확인). 모더니아 `섬멸 모드`.
        this.ammo = this._full_ammo(bm, t);
        this._wc_ammo_borrowed = false;
      }
    }

    // 최대 장탄 증가 버프가 만료되면 초과 잔탄은 잘린다.
    if (this.reloading_until <= 0) {
      const _cap = this._full_ammo(bm, t);
      if (this.ammo > _cap) {
        this.ammo = _cap;
        if (this._sim_log !== null) {
          this._sim_log.ammo_log.push(
            new AmmoLogEntry({ t, caster: this.name, ammo: this.ammo }));
        }
      }
    }

    // 모드 지정 플래그: 진입 조건이 충족된 순간 수동 재장전을 삽입해 모드로 들어간다.
    if (this.weapon_mode_swap
        && t >= this.weapon_mode_swap_at
        && this.reloading_until <= 0
        && this._post_reload_end_t <= 0
        && truthy(bm.manual_swap_ready(this.name, t))) {
      this._start_reload(t, bm);
      return [];
    }

    // ── 컨트롤 실행층 ────────────────────────────────────────────────
    // 홀드컨을 먼저 굴린다 — 뒤이은 시퀀스가 같은 틱에 덮어쓸 수 있게 해서
    // **명시 시퀀스가 정책보다 우선**한다는 규칙을 순서만으로 지킨다.
    this._apply_hold_policy(t, bm);
    if (this._pump_ctrl_seq(t, bm) || this._apply_cover_policy(t, bm)) {
      return [];
    }

    // 재장전 완료 체크 (엄폐 중에도 재장전은 그대로 굴러간다)
    if (this.reloading_until > 0) {
      if (t < this.reloading_until) {
        return [];
      }
      this._finish_reload(t, bm);
      if (this.reloading_until > 0) {
        return []; // 클립 무기 — 탄창이 덜 찼고 다음 클립이 이어졌다
      }
      // 재장전 완료가 발생시킨 event:full_reload로 무기 변경 모드에 진입했을 수 있다.
      wc_eff = bm.get_weapon_change(this.name);
      if (wc_eff != null) {
        this._in_weapon_change = true;
        return this._tick_weapon_change(t, bm, enemy, cfg, wc_eff);
      }
    }

    // 엄폐 중이면 사격도 차징도 불가
    if (this._tick_cover(t)) {
      return [];
    }

    // post_reload_delay 대기 (재장전 완료 후 발사 전 고정 딜레이)
    if (this._post_reload_end_t > 0) {
      if (t < this._post_reload_end_t) {
        return [];
      }
      this._post_reload_end_t = -1.0;
      this.next_fire_time = t;
    }

    if (this.fire_mode === 'auto' || this.fire_mode === 'auto_warmup') {
      return this._tick_auto(t, bm, enemy, cfg);
    } else {
      return this._tick_charge(t, bm, enemy, cfg);
    }
  }

  // ── auto / auto_warmup ────────────────────────────────────────────────

  // py: calculator/timeline.py:632
  _tick_auto(t: number, bm: BM, enemy: Dict, cfg: Dict): HitEvent[] {
    const events: HitEvent[] = [];
    if (this.fire_mode === 'auto_warmup') {
      this._cool_warmup(t, bm);
    }
    while (t >= this.next_fire_time) {
      if (this.ammo <= 0) {
        this._start_reload(t, bm, '재장전 시작', true);
        break;
      }
      const fire_rate = this._current_fire_rate(bm, t);
      events.push(...this._fire(t, bm, enemy, cfg));
      const inter = 1.0 / fire_rate;
      this.next_fire_time += inter;
      if (this.fire_mode === 'auto_warmup') {
        this.last_fire_t = t;
        this._last_inter = inter;
      }
      if (this.next_fire_time <= t) {
        // 프레임당 1발 상한. 밀린 빚을 남기지 않는다.
        this.next_fire_time = t;
        break;
      }
    }

    return events;
  }

  // py: calculator/timeline.py:657
  _cool_warmup(t: number, bm: BM): void {
    // MG 예열은 식는 속도가 있다.
    if (this.warmup_shots <= 0.0) {
      return;
    }
    const idle = t - this.last_fire_t;
    if (idle <= 0.0) {
      return;
    }
    // 판정 기준은 **직전 발사가 실제로 예약한** 간격이다.
    const inter = truthy(this._last_inter)
      ? this._last_inter
      : 1.0 / _pymax(this._current_fire_rate(bm, t), 0.01);
    if (idle <= inter * 1.5) { // 예약된 연사 대기 — 실제 정지가 아님
      return;
    }
    const cool_rate = this.warmup_bullets / get(this.mech, 'cooldown_time', 1.0);
    this.warmup_shots = _pymax(0.0, this.warmup_shots - cool_rate * idle);
    this.last_fire_t = t; // 다음 프레임 중복 차감 방지
  }

  // py: calculator/timeline.py:675
  _current_fire_rate(bm: BM, t: number): number {
    let base: number;
    if (this.fire_mode === 'auto_warmup') {
      const fr_min = this.fire_rate;
      const fr_max = this.fire_rate_max != null ? this.fire_rate_max : fr_min;
      const warmup = this.warmup_bullets;
      base = fr_min + (fr_max - fr_min) * _pymin(this.warmup_shots, warmup) / warmup;
    } else {
      base = this.fire_rate;
    }
    const speed_pct = get(bm.get_buffs(this.name, '__enemy__', t), 'attack_speed_pct', 0.0);
    return base * _pymax(0.01, 1.0 + speed_pct / 100.0);
  }

  // py: calculator/timeline.py:686
  _fire(t: number, bm: BM, enemy: Dict, cfg: Dict): HitEvent[] {
    const events: HitEvent[] = [];
    this._apply_wc_first_coeff();
    const infinite_ammo = truthy(get(bm.get_buffs(this.name, '__enemy__', t), 'max_ammo_infinite', false));
    const is_last = (this.ammo === 1 && !infinite_ammo);
    if (is_last) {
      bm.notify('last_bullet_fire', t, this.name);
    }

    if (this.fire_mode === 'auto_warmup') {
      if (this.warmup_shots < this.warmup_bullets) {
        const wsp = get(bm.get_buffs(this.name, '__enemy__', t), 'mg_warmup_speed_pct', 0.0);
        const incr = _pymax(0.0, 1.0 + wsp / 100.0);
        this.warmup_shots = _pymin(this.warmup_shots + incr, this.warmup_bullets);
      }
    }

    if (this._in_weapon_change) {
      // weapon_change의 duration_bullets 카운트. 발사 시점에 직접 센다.
      this._wc_shots += 1;
    }

    if (!infinite_ammo) {
      this.ammo -= 1;
    }
    // 핵의 무한 장탄은 «탄창이 안 비는 것»이다.
    if (bm.cheats.infinite_ammo) {
      this.ammo = this._full_ammo(bm, t);
    }
    if (this._sim_log !== null) {
      this._sim_log.ammo_log.push(new AmmoLogEntry({ t, caster: this.name, ammo: this.ammo }));
    }
    if (!infinite_ammo) {
      bm.notify('squad_ammo_consume', t, this.name);
    }
    const buffs = bm.get_buffs(this.name, '__enemy__', t);
    buffs['is_element_match'] = this.element_match(bm);
    const is_optimal = _in(this.weapon_type, get(enemy, 'optimal_range_weapons', []));

    // 코어히트 확률: core_px>0이면 명중률·탄착군·코어 크기로 계산, 0이면 코어 없음
    let P_core: number;
    if (get(enemy, 'core_px', 0) > 0) {
      P_core = _core_hit_prob(
        or(this.accuracy_weapon, this.weapon_type),
        _pymax(get(buffs, 'accuracy_pct', 0.0), this.accuracy_floor_pct),
        get(enemy, 'core_px', 50),
      );
    } else {
      P_core = 0.0;
    }

    const is_full_burst = get(bm.state, 'full_burst', false);
    const debug_char = get(cfg, '_debug_char', null);
    const in_debug_window = (
      debug_char === this.name
      && get(cfg, '_debug_t0', -1.0) <= t && t <= get(cfg, '_debug_t1', -1.0)
    );

    // 실효 펠릿 수: pellet_count_fixed > 0이면 절대값 고정, 아니면 기본값 + 증가량.
    const pellet_fixed = get(buffs, 'pellet_count_fixed', 0.0);
    let split: number;
    if (pellet_fixed > 0) {
      split = _pymax(1, int(round(pellet_fixed)));
    } else {
      split = _pymax(1, this.pellets + int(round(get(buffs, 'pellet_count', 0.0))));
    }
    const hit_count = split * this.muzzles;

    const expected = get(cfg, 'rng_mode') === 'expected';
    const _pp = this._pellet_probabilities(t, bm, enemy, buffs, P_core, hit_count);
    const P_hit = _pp[0];
    P_core = _pp[1];
    let landed = 0;
    let core_frac = 0.0;
    for (let i = 0; i < hit_count; i += 1) {
      if (P_hit <= 0 || (!expected && P_hit < 1 && random.random() >= P_hit)) {
        continue;
      }
      landed += 1;
      const weight = expected ? P_hit : 1.0;
      // 히트마다 독립 샘플링. 기대값 모드는 판정 대신 확률을 넘긴다
      const is_core = expected ? (P_core >= 1.0) : (random.random() < P_core);
      const coeff = split > 1 ? (item(this.weapon, 'damage_coeff') / split) : null;
      const ht = default_hit_type({
        is_core: is_core,
        core_prob: (expected ? P_core : null),
        is_full_burst: is_full_burst,
        is_optimal_range: is_optimal,
        is_normal_atk: !this._wc_is_skill_damage(),
        is_weapon_mode_skill: this._wc_is_skill_damage(),
        is_pierce_damage: truthy(get(buffs, 'pierce_enabled')),
        is_armor_break_damage: truthy(get(buffs, 'armor_break_enabled')),
        coeff: coeff,
        _debug_factors: in_debug_window,
      });
      if (in_debug_window && i === 0) {
        console.log(`t=${_fmt(t, 3)}s  base_atk=${_commas(this.base_atk)}  enemy_def=${_commas(get(enemy, 'def', 31784))}`);
      }
      const res = calc_damage(
        this.base_atk, buffs, this.weapon,
        ht, get(enemy, 'def', 31784),
        expected,
      );
      if (in_debug_window && i === 0) {
        console.log('');
      }
      // 기대값 모드에서는 한 히트에 코어/비코어가 섞여 있어 태그를 코어로 가르지 않는다
      const tag = hit_count > 1
        ? (is_core ? `core:pellet:${i}` : `pellet:${i}`)
        : (is_core ? 'core' : 'normal');
      // 이 한 발이 코어를 맞은 몫. 기대값 모드는 확률 그대로, 난수 모드는 0/1이다.
      core_frac = expected ? P_core : (is_core ? 1.0 : 0.0);
      // 변신 모드 사격은 스킬 대미지 취급이라 평타 계수를 태우지 않는다.
      const shot_damage = _apply_hit_coeff((weight === 1 ? res['damage'] : round(res['damage'] * weight)), cfg, this.weapon_type,
        this._wc_is_skill_damage());
      events.push(new HitEvent({
        t, caster: this.name, damage: shot_damage,
        is_crit: res['is_crit'], hit_tag: tag,
        core_frac: core_frac,
        ...(this._wc_is_skill_damage() ? { skill_name: this._wc_name } : {}),
      }));
      events.push(...this._pierce_extra({
        ht, base_damage: shot_damage, is_crit: res['is_crit'], buffs,
        enemy, cfg, expected, t, tag, hit_weight: weight,
      }));
      _notify_frac(bm, 'pellet_hit', this.name, weight, () => bm.notify('pellet_hit', t, this.name));
      const body_ev = truthy(get(enemy, 'has_parts', false)) ? 'squad_part_hit' : 'squad_body_hit';
      _notify_frac(bm, body_ev, this.name, weight * (1.0 - core_frac),
        () => bm.notify_team_hit(body_ev, t, this.name));
      _notify_frac(bm, 'crit_hit', this.name, weight * res['crit_frac'],
        () => bm.notify('crit_hit', t, this.name));
      _notify_frac(bm, 'core_hit', this.name, weight * core_frac,
        () => bm.notify('core_hit', t, this.name));
    }

    // 「일반 공격 1회로 펠릿 N개 이상 명중 시」 — 이 **한 발**의 명중 펠릿 수로 판정한다.
    const _gauge_hits = expected ? hit_count * P_hit : float(landed);
    for (const [_need, _raw] of bm.pellet_in_shot_thresholds(this.name)) {
      if (_gauge_hits >= _need - 1e-9) {
        bm.notify(`pellet_hit_in_shot:${_pystr(_raw)}`, t, this.name);
      }
    }

    // 일반 공격 명중은 충전 창 밖에서도 시전자 기준 버충값을 `(발당)`→`(대상)`으로 전환한다.
    if (_gauge_hits > 0 && !this._wc_is_skill_damage()) {
      bm.mark_normal_attack_landed(this.name);
    }

    // 버스트 게이지: 명중 수만큼. 버프 표는 명중 표시 **뒤**에 다시 읽는다.
    if (_gauge_hits > 0 && this._weapon_gauge_lands(bm, t)) {
      const gauge_buffs = bm.get_buffs(this.name, '__enemy__', t);
      bm.add_burst_gauge(this._burst_gain(gauge_buffs, _gauge_hits), t, this.name, 'weapon');
    }

    // hit_count: 발사 1회당 1회 (펠릿 수와 무관). pellet_hit은 루프 내 펠릿마다 발생
    if (expected && 0 < P_hit && P_hit < 1) {
      bm.notify(`multi_hit:${hit_count}`, t, this.name, { pellet_probability: P_hit });
    } else if (landed) {
      bm.notify(`multi_hit:${landed}`, t, this.name);
    }
    const attack_hit = expected ? (1 - (1 - P_hit) ** hit_count) : float(landed > 0);
    _notify_frac(bm, 'hit_count', this.name, attack_hit,
      () => bm.notify('hit_count', t, this.name, { core_frac: core_frac }));
    bm.notify('on_attack', t, this.name);
    if (!this._wc_is_skill_damage()) {
      bm.consume_bullet_buffs(this.name, t);
    }
    if (is_last) {
      bm.notify('last_bullet', t, this.name);
    }

    return events;
  }

  // py: calculator/timeline.py:845
  _pierce_extra(kw: {
    ht: Dict; base_damage: any; is_crit: boolean; buffs: Dict; enemy: Dict;
    cfg: Dict; expected: boolean; t: number; tag: string; hit_weight?: number;
  }): HitEvent[] {
    // 관통이 꿰뚫고 지나간 **나머지 대상** 몫. **트리거는 늘리지 않는다.** 대미지만 더한다.
    const { ht, base_damage, is_crit, buffs, enemy, cfg, expected, t, tag } = kw;
    const hit_weight = kw.hit_weight === undefined ? 1.0 : kw.hit_weight;
    if (!truthy(get(ht, 'is_pierce_damage'))) {
      return [];
    }
    const [shapes, parts] = _pierce_passthrough(enemy);
    if (shapes <= 1 && parts <= 0) {
      return [];
    }

    const extra: HitEvent[] = [];
    const named: Dict = this._wc_is_skill_damage() ? { skill_name: this._wc_name } : {};
    for (let _ = 0; _ < shapes - 1; _ += 1) {
      extra.push(new HitEvent({
        t, caster: this.name, damage: base_damage,
        is_crit, hit_tag: `pierce:${tag}`, ...named,
      }));
    }
    // 파츠 판정은 파츠를 가진 보스에서만 성립한다.
    if (parts > 0 && truthy(get(enemy, 'has_parts', false))) {
      const part_ht = { ...ht, is_part: true };
      const part_res = calc_damage(
        this.base_atk, buffs, this.weapon,
        part_ht, get(enemy, 'def', 31784), expected,
      );
      const part_damage = _apply_hit_coeff((hit_weight === 1 ? part_res['damage'] : round(part_res['damage'] * hit_weight)), cfg, this.weapon_type,
        this._wc_is_skill_damage());
      for (let _ = 0; _ < parts; _ += 1) {
        extra.push(new HitEvent({
          t, caster: this.name, damage: part_damage,
          is_crit: part_res['is_crit'],
          hit_tag: 'pierce:part', ...named,
        }));
      }
    }
    return extra;
  }

  // ── charge (SR/RL) ────────────────────────────────────────────────────

  // py: calculator/timeline.py:886
  _effective_charge_time(bm: BM, t: number): number {
    // 현재 버프를 반영한 유효 차지 시간(초).
    const buffs = bm.get_buffs(this.name, '__enemy__', t);
    if (truthy(get(buffs, 'charge_time_fixed'))) {
      return this._fixed_charge_time(bm);
    }
    // 차지 속도 % 버프도 장탄과 같다 — 소스마다 0.01초 눈금에 반올림한 뒤 더한다.
    const cut = _quant_sum(this.charge_time_base, buffs, 'charge_speed_pct', 0.01);
    // charge_time_flat(초)은 차지 속도 % 를 적용한 뒤 더한다.
    return _pymax(0.0, _pymax(0.0, this.charge_time_base - cut)
      + get(buffs, 'charge_time_flat', 0.0));
  }

  // py: calculator/timeline.py:900
  _tap_active(bm: BM): boolean {
    // 지금 톡톡이로 쏘는가. `burst_charge` 정책은 풀버스트 밖(버충 구간)에서만 톡톡이다.
    if (!this.tap_fire) {
      return false;
    }
    if (this.tap_policy === 'burst_charge') {
      return !truthy(get(bm.state, 'full_burst', false));
    }
    return true;
  }

  // py: calculator/timeline.py:908
  _weapon_gauge_lands(bm: BM, t: number): boolean {
    // 이 무기 사격이 버스트 게이지를 채우는가. 족자 중에는 평타 몫의 게이지도 안 찬다.
    if (this._wc_is_skill_damage()) {
      return true;
    }
    const frame_t = round(t, 9);
    const blocked: any[] = get(bm.state, 'gauge_weapon_blocked', []);
    return !blocked.some(([lo, hi]: number[]) => lo! <= frame_t && frame_t < hi!);
  }

  // py: calculator/timeline.py:922
  _burst_gain(buffs: Dict, hit_count: number, full_charge = false,
    burst_energy: number | null = null): number {
    // 이번 발사가 만드는 버스트 게이지(%). 충전 창 판정은 하지 않는다.
    const be = burst_energy == null ? this.burst_energy : burst_energy;
    let gain = be * hit_count;
    if (full_charge) {
      gain *= get(this.weapon, 'full_charge_mult', 100.0) / 100.0;
    }
    return gain + hit_count * get(buffs, 'burst_charge_speed_flat', 0.0);
  }

  // py: calculator/timeline.py:943
  _tick_charge(t: number, bm: BM, enemy: Dict, cfg: Dict): HitEvent[] {
    const events: HitEvent[] = [];

    if (this._charge_phase === 'ready') {
      if (this.ammo <= 0) {
        this._start_reload(t, bm, '재장전 시작', true);
        return events;
      }
      // `charge_hold_after_fb`: 정책이 잡은 차지 시작 시각을 기다린다.
      if (this._ch_charge_start_t > 0 && t < this._ch_charge_start_t) {
        if (this._ch_charge_start_t - t <= this._effective_charge_time(bm, t) + 0.4) {
          return events;
        }
      }
      this._charge_start_t = t;
      this._charge_phase = 'charging';
      this._charge_hold_fired.clear();
      // 이 발을 풀차지로 쏠지 여기서 정한다 (톡톡이 중 주기적 풀차지).
      this._force_full_charge = (
        this.tap_full_charge_interval > 0
        && t - this._last_full_charge_t >= this.tap_full_charge_interval
      ) || this._tap_full_pending;
      // 의도한 차지가 시작된 순간에만 홀드를 건다. **늦게 시작해도 그대로 진행한다**.
      if (this._ch_charge_start_t > 0 && t >= this._ch_charge_start_t) {
        const _th = bm.charge_hold_thresholds(this.name);
        const need = _th[_th.length - 1][0];
        this._hold_release_t = (
          t + this._effective_charge_time(bm, t) + need + _CTRL_FRAME
        );
        this._ch_charge_start_t = -1.0;
        this._force_full_charge = true; // 판정에는 풀차지가 필요하다
      }
      setdefault<Dict>(bm.state, 'charging', {})[this.name] = true;
      bm._invalidate_buffs_cache();
      if (this.ammo === 1) {
        bm.notify('last_bullet_fire', t, this.name);
      }
    }

    if (this._charge_phase === 'charging') {
      // 홀드 구간에서는 톡톡이를 멈춘다.
      const bunny_switch = (bm.weapon_change_name(this.name) !== '마이티 스톰프'
        && _in(this.name, get(bm.state, 'bunny_modes', {}))
        && bm.state['bunny_modes'][this.name] !== this.bunny_mode);
      let is_full: boolean;
      if (this._tap_active(bm) && !this._force_full_charge && this._hold_release_t < 0 && !bunny_switch) {
        // 톡톡이: 누르는 시간이 고정이고, 그중 사격 전 딜레이를 뺀 만큼만 차지된다.
        this._charge_end_t = this._charge_start_t + this._tap_hold;
        if (t < this._charge_end_t) {
          return events;
        }
        is_full = this._tap_charge >= this._effective_charge_time(bm, t);
      } else {
        // 풀차지 도달을 래치한다.
        if (this._charge_full_t < 0) {
          this._charge_end_t = this._charge_start_t + this._effective_charge_time(bm, t);
          if (t < this._charge_end_t) {
            return events;
          }
          this._charge_full_t = t;
        }
        is_full = true;
        // `풀 차지 상태를 N초 이상 유지 시` — 판정은 임계를 넘는 **그 순간 1회뿐**이다.
        const _phase_before = this._charge_phase;
        const _reload_before = this.reloading_until;
        this._notify_charge_hold(t, bm);
        // **이 프레임의 판정이** 강제 재장전·탄환 제거를 걸었으면 이 발은 나가지 않는다
        if (this._charge_phase !== _phase_before
            || this.reloading_until !== _reload_before) {
          return events;
        }
        if (bunny_switch && bm.state['bunny_modes'][this.name] !== this.bunny_mode) {
          return events;
        }
        // 홀드: 풀차지가 끝나도 시퀀스가 지정한 시각까지 떼지 않는다.
        if (this._hold_release_t >= 0 && t < this._hold_release_t) {
          return events;
        }
      }
      events.push(...this._charge_fire(t, bm, enemy, cfg, is_full));
    } else if (this._charge_phase === 'post_delay' && t >= this._post_delay_end_t) {
      if (this._pending_auto_reload) {
        this._pending_auto_reload = false;
        this._auto_reload(t, bm);
      }
      this._charge_phase = 'ready';
      return this._tick_charge(t, bm, enemy, cfg);
    }

    return events;
  }

  // py: calculator/timeline.py:1035
  _notify_charge_hold(t: number, bm: BM): void {
    // `charge_hold:N` 트리거 발생. 풀차지 유지 시간이 N을 넘긴 첫 프레임에 1회.
    if (this._charge_full_t < 0) {
      return;
    }
    // An ally can satisfy the requested mode earlier in this same frame.
    // Release the held shot instead of toggling the whole pair back again.
    if (get(get(bm.state, 'bunny_modes', {}), this.name) === this.bunny_mode) {
      return;
    }
    const held = t - this._charge_full_t;
    for (const [value, raw] of bm.charge_hold_thresholds(this.name)) {
      if (this._charge_hold_fired.has(raw) || held < value) {
        continue;
      }
      this._charge_hold_fired.add(raw);
      bm.notify(`charge_hold:${_pystr(raw)}`, t, this.name);
    }
  }

  // py: calculator/timeline.py:1055
  _pellet_probabilities(t: number, bm: BM, enemy: Dict, buffs: Dict, core_probability: number,
    pellet_count = 1): [number, number] {
    if (or(this.accuracy_weapon, this.weapon_type) !== 'SG') {
      return [1.0, core_probability];
    }
    const spec = get(_ACCURACY_DATA(), or(this.accuracy_weapon, this.weapon_type), {});
    const accuracy = _pymax(get(buffs, 'accuracy_pct', 0), this.accuracy_floor_pct);
    let radius = _pymax(1, get(spec, 'base_diameter', 10) - get(spec, 'acc_slope', 0) * accuracy) / 2;
    const _model = get(enemy, 'shotgun_model');
    if ((_model === 'spatial-v1' || _model === 'spatial-convergence-v1') && !this._in_weapon_change) {
      const spread = this._spread_spec;
      const start = float(get(spread, 'start', 250));
      let scale = start;
      if (get(enemy, 'shotgun_model') === 'spatial-convergence-v1') {
        // Explicit experimental policy: contract after each shot,
        // recover only during the reload gap.
        this._recover_spread(t);
        scale = this._spread_scale;
        this._spread_scale = _pymax(float(get(spread, 'end', start)), scale - float(get(spread, 'per_shot', 0)));
      }
      radius *= scale / 250;
    }
    const [hit, core] = pellet_probabilities(enemy, this.name, t, get(bm.state, 'full_burst', false),
      radius, core_probability, _MODEL_N());
    if (truthy(get(enemy, 'shotgun_report'))) {
      if (this._shotgun_heatmap === null) {
        this._shotgun_heatmap = new ShotgunHeatmap();
      }
      this._shotgun_heatmap.record(enemy, this.name, t, get(bm.state, 'full_burst', false),
        radius, accuracy, pellet_count, hit, core, _MODEL_N());
    }
    const _model2 = get(enemy, 'shotgun_model');
    if (_model2 === 'spatial-v1' || _model2 === 'spatial-convergence-v1') {
      const stats = this.shotgun_stats;
      const _amounts: Array<[string, number]> = [
        ['fired', pellet_count], ['hit', pellet_count * hit],
        ['core', pellet_count * hit * core], ['miss', pellet_count * (1 - hit)],
      ];
      for (const [key, amount] of _amounts) {
        stats[key] = get(stats, key, 0) + amount;
      }
      const override = get(get(or(get(enemy, 'shotgun_geometry'), {}), 'spread', {}), this.name);
      const diameter = (truthy(override) && override > 0) ? override : radius * 2;
      stats['minDiameter'] = _pymin(get(stats, 'minDiameter', diameter), diameter);
      stats['maxDiameter'] = _pymax(get(stats, 'maxDiameter', diameter), diameter);
    }
    return [hit, core];
  }

  // py: calculator/timeline.py:1091
  _charge_fire(t: number, bm: BM, enemy: Dict, cfg: Dict, is_full: boolean): HitEvent[] {
    // 차지 무기 1발 발사 처리. `is_full=False`면 논차지 샷(톡톡이).
    const events: HitEvent[] = [];
    this._apply_wc_first_coeff();
    const is_optimal = _in(this.weapon_type, get(enemy, 'optimal_range_weapons', []));
    if (is_full) {
      this._last_full_charge_t = t;
      this._force_full_charge = false;
      this._tap_full_pending = false;
      bm.notify('full_charge', t, this.name);
    }
    let buffs: Dict = bm.get_buffs(this.name, '__enemy__', t);
    // 에밀리아 `미정령의 축복`: 최종 최대 장탄 수 1발마다 차지 대미지 증가.
    const per_ammo_charge = get(buffs, 'charge_dmg_per_max_ammo_pct', 0.0);
    if (truthy(per_ammo_charge)) {
      buffs = { ...buffs };
      buffs['charge_dmg_pct'] = item(buffs, 'charge_dmg_pct') + per_ammo_charge * this._full_ammo(bm, t);
    }
    buffs['is_element_match'] = this.element_match(bm);
    // 재생 화면의 차징 게이지 — 기록만 한다(아래 딜 계산에는 손대지 않는다).
    if (this._sim_log !== null && 0 <= this._charge_start_t && this._charge_start_t <= t) {
      const _fcm = float(get(this.weapon, 'full_charge_mult', 100.0));
      const _value = (_fcm * (1.0 + get(buffs, 'charge_dmg_mag_pct', 0.0) / 100.0)
        + get(buffs, 'charge_dmg_pct', 0.0));
      this._sim_log.charge_log.push(new ChargeLogEntry({
        caster: this.name, start: this._charge_start_t,
        full_at: this._charge_start_t + this._effective_charge_time(bm, t),
        fire: t, full: truthy(is_full), value: _value,
      }));
    }
    let P_core: number;
    if (get(enemy, 'core_px', 0) > 0) {
      P_core = _core_hit_prob(
        or(this.accuracy_weapon, this.weapon_type),
        _pymax(get(buffs, 'accuracy_pct', 0.0), this.accuracy_floor_pct),
        get(enemy, 'core_px', 50),
      );
    } else {
      P_core = 0.0;
    }
    const expected = get(cfg, 'rng_mode') === 'expected';

    // 펠릿 분할. **차지 샷건**(드레이크 : 그레이트 빌런)을 위해 자동 사격 쪽과 같은 규칙으로 나눈다.
    const pellet_fixed = get(buffs, 'pellet_count_fixed', 0.0);
    let split: number;
    if (pellet_fixed > 0) {
      split = _pymax(1, int(round(pellet_fixed)));
    } else {
      split = _pymax(1, this.pellets + int(round(get(buffs, 'pellet_count', 0.0))));
    }
    const hit_count = split * this.muzzles;

    const debug_char = get(cfg, '_debug_char', null);
    const in_debug_window = (
      debug_char === this.name
      && get(cfg, '_debug_t0', -1.0) <= t && t <= get(cfg, '_debug_t1', -1.0)
    );

    const is_full_burst = get(bm.state, 'full_burst', false);
    if (in_debug_window) {
      console.log(`t=${_fmt(t, 3)}s  base_atk=${_commas(this.base_atk)}  enemy_def=${_commas(get(enemy, 'def', 31784))}`);
    }
    const _pp = this._pellet_probabilities(t, bm, enemy, buffs, P_core, hit_count);
    const P_hit = _pp[0];
    P_core = _pp[1];
    let landed = 0;
    let is_core = false;
    let res: Dict = { damage: 0, crit_frac: 0, is_crit: false };
    let shot_damage: any = 0;
    let ht: Dict | null = null;
    let tag = 'normal';
    let weight = 1.0;
    for (let _ = 0; _ < hit_count; _ += 1) {
      if (P_hit <= 0 || (!expected && P_hit < 1 && random.random() >= P_hit)) {
        continue;
      }
      landed += 1;
      weight = expected ? P_hit : 1.0;
      // 코어는 펠릿마다 따로 굴린다 (P_core가 1이면 기대값 모드에서도 코어로 남긴다).
      is_core = expected ? (P_core >= 1.0) : (random.random() < P_core);
      ht = default_hit_type({
        is_core: is_core,
        core_prob: (expected ? P_core : null),
        is_full_burst: is_full_burst,
        is_optimal_range: is_optimal,
        is_normal_atk: !this._wc_is_skill_damage(),
        is_weapon_mode_skill: this._wc_is_skill_damage(),
        is_full_charge: is_full,
        is_pierce_damage: truthy(get(buffs, 'pierce_enabled')),
        is_armor_break_damage: truthy(get(buffs, 'armor_break_enabled')),
        is_projectile_explosion: (this.base_weapon_type === 'RL'),
        // 표기 대미지는 **한 발** 값이라 펠릿 수로 나눠 태운다(자동 사격과 같다).
        coeff: split > 1 ? (item(this.weapon, 'damage_coeff') / split) : null,
        _debug_factors: in_debug_window,
      });
      res = calc_damage(
        this.base_atk, buffs, this.weapon,
        ht, get(enemy, 'def', 31784),
        expected,
      );
      if (is_full) {
        tag = is_core ? 'core+full_charge_hit' : 'full_charge_hit';
      } else {
        // 논차지 샷은 일반 발사와 같은 취급 (차지 배율 없음)
        tag = is_core ? 'core' : 'normal';
      }
      shot_damage = _apply_hit_coeff((weight === 1 ? res['damage'] : round(res['damage'] * weight)), cfg, this.weapon_type,
        this._wc_is_skill_damage());
      events.push(new HitEvent({
        t, caster: this.name, damage: shot_damage,
        is_crit: res['is_crit'], hit_tag: tag,
        // 코어를 맞은 몫 (`_fire`와 같은 값·같은 취지).
        core_frac: (expected ? P_core : (is_core ? 1.0 : 0.0)),
        ...(this._wc_is_skill_damage() ? { skill_name: this._wc_name } : {}),
      }));
    }
    if (in_debug_window) {
      console.log('');
    }
    if (landed) {
      events.push(...this._pierce_extra({
        ht: ht!, base_damage: shot_damage, is_crit: res['is_crit'], buffs,
        enemy, cfg, expected, t, tag, hit_weight: weight,
      }));
    }
    // 명중 직후 파생되는 "자신이 가한 피해량 비례 고정 대미지"의 기준값.
    setdefault<Dict>(bm.state, 'last_normal_hit_damage', {})[this.name] = res['damage'];
    const is_last = (this.ammo === 1);
    if (this._in_weapon_change) {
      // weapon_change의 duration_bullets 카운트 (_fire()와 동일 취지).
      this._wc_shots += 1;
    }
    this.ammo -= 1;
    // 차지 무기도 마찬가지로 탄창이 안 빈다(`_fire`와 같은 취지).
    if (bm.cheats.infinite_ammo) {
      this.ammo = this._full_ammo(bm, t);
    }
    if (this._sim_log !== null) {
      this._sim_log.ammo_log.push(new AmmoLogEntry({ t, caster: this.name, ammo: this.ammo }));
    }
    bm.notify('squad_ammo_consume', t, this.name);
    const attack_hit = expected ? (1 - (1 - P_hit) ** hit_count) : float(landed > 0);
    _notify_frac(bm, 'hit_count', this.name, attack_hit,
      () => bm.notify('hit_count', t, this.name, { core_frac: expected ? P_core : float(is_core) }));
    if (is_full) {
      _notify_frac(bm, 'full_charge_hit', this.name, attack_hit, () => bm.notify('full_charge_hit', t, this.name));
    } else {
      _notify_frac(bm, 'non_full_charge_hit', this.name, attack_hit, () => bm.notify('non_full_charge_hit', t, this.name));
    }
    // 일반 공격 명중이면 충전 창·풀차지와 무관하게 시전자 기준값을 갱신한다.
    const _gauge_hits = expected ? hit_count * P_hit : float(landed);
    if (_gauge_hits > 0 && !this._wc_is_skill_damage()) {
      bm.mark_normal_attack_landed(this.name);
    }
    // 버스트 게이지. **풀차지 배율은 카메라가 이 니케를 보고 있을 때만 붙는다**.
    if (_gauge_hits > 0 && this._weapon_gauge_lands(bm, t)) {
      const gauge_buffs = bm.get_buffs(this.name, '__enemy__', t);
      bm.add_burst_gauge(
        this._burst_gain(gauge_buffs, _gauge_hits,
          (is_full && _in(this.name, get(bm.state, 'camera', [])))),
        t, this.name,
        is_full ? 'weapon:full_charge' : 'weapon');
    }
    const body_ev = truthy(get(enemy, 'has_parts', false)) ? 'squad_part_hit' : 'squad_body_hit';
    const core_frac = expected ? P_core : (is_core ? 1.0 : 0.0);
    _notify_frac(bm, body_ev, this.name, attack_hit * (1.0 - core_frac),
      () => bm.notify_team_hit(body_ev, t, this.name));
    bm.notify('on_attack', t, this.name);
    if (!this._wc_is_skill_damage()) {
      bm.consume_bullet_buffs(this.name, t);
    }
    _notify_frac(bm, 'crit_hit', this.name, attack_hit * res['crit_frac'],
      () => bm.notify('crit_hit', t, this.name));
    _notify_frac(bm, 'core_hit', this.name, attack_hit * core_frac,
      () => bm.notify('core_hit', t, this.name));
    if (is_last) {
      bm.notify('last_bullet', t, this.name);
    }

    // 톡톡이는 **사격 후 딜레이를 줄이는 컨트롤이다**.
    if (this._tap_active(bm)) {
      this._post_delay_end_t = t + this._tap_release + this._tap_post;
    } else {
      this._post_delay_end_t = t + this.post_fire_delay;
      // 엄폐 니케 + 재장 ≥100%: 딜레이 중 자동재장전 예약 (장탄 유지)
      if (truthy(this.cover_during_delay) && get(buffs, 'reload_speed_pct', 0.0) >= 100.0) {
        this._pending_auto_reload = true;
      }
    }
    this._charge_phase = 'post_delay';
    this._charge_full_t = -1.0;
    this._hold_release_t = -1.0;
    setdefault<Dict>(bm.state, 'charging', {})[this.name] = false;
    bm._invalidate_buffs_cache();
    return events;
  }

  // ── weapon_change ─────────────────────────────────────────────────────

  // py: calculator/timeline.py:1275
  _apply_wc_first_coeff(): void {
    // 무기 변경 세션의 **첫 발**만 `최초 대미지` 계수로 쏘게 한다.
    if (!this._in_weapon_change || this._wc_first_coeff === null) {
      return;
    }
    const coeff = this._wc_shots === 0 ? this._wc_first_coeff : this._wc_normal_coeff;
    if (coeff !== null && get(this.weapon, 'damage_coeff', null) !== coeff) {
      this.weapon = { ...this.weapon, damage_coeff: coeff };
    }
  }

  // py: calculator/timeline.py:1293
  _wc_is_skill_damage(): boolean {
    // 지금 사격이 **스킬 대미지**로 취급되는 무기 변경 모드 안인가.
    return this._in_weapon_change && this._wc_skill_damage;
  }

  // py: calculator/timeline.py:1303
  _tick_weapon_change(t: number, bm: BM, enemy: Dict, cfg: Dict, wc_eff: Dict): HitEvent[] {
    // weapon_change 활성 중 발사 루프. CharState 필드를 임시 교체하고 처리 후 원복한다.
    // weapon_change effect의 스킬 레벨별 damage_coeff 결정
    const skill_lv = _get_skill_lv(this.char, wc_eff);
    const dc: any = get(wc_eff, 'damage_coeff', {});
    let coeff: number;
    if (_isdict(dc)) {
      coeff = float(get(dc, skill_lv, get(dc, '10', 0.0)));
    } else {
      coeff = float(dc);
    }

    // `최초 대미지` / `일반 대미지` 2단 계수.
    const fdc = get(wc_eff, 'first_damage_coeff');
    if (_isdict(fdc)) {
      this._wc_first_coeff = float(get(fdc, skill_lv, get(fdc, '10', 0.0)));
    } else if (fdc != null) {
      this._wc_first_coeff = float(fdc);
    } else {
      this._wc_first_coeff = null;
    }
    this._wc_normal_coeff = coeff;
    // 모드 사격이 스킬 대미지로 취급되는 예외(나유타 `기억 연소`).
    this._wc_skill_damage = truthy(get(wc_eff, 'skill_damage'));
    this._wc_name = get(wc_eff, 'name', '');

    const wc_weapon_type = get(wc_eff, 'weapon_type', 'SR');
    const wc_mech = get(item(_MECHANICS(), 'weapon_type_defaults'), wc_weapon_type, {});
    const wc_fire_mode: string = get(wc_mech, 'type', 'charge');
    let wc_max_ammo = get(wc_eff, 'max_ammo', 1);
    const gauge_ref = get(wc_eff, 'max_ammo_gauge_ref');
    if (truthy(gauge_ref)) {
      if (this._wc_new_session || this._wc_dynamic_ammo === null) {
        const held = get(get(get(bm.state, 'gauges', {}), this.name, {}), gauge_ref, 0.0);
        this._wc_dynamic_ammo = _pymin(int(wc_max_ammo), _pymax(0, int(held)));
      }
      wc_max_ammo = this._wc_dynamic_ammo;
    }
    const wc_charge_time = get(wc_eff, 'charge_time', 1.0);
    const wc_full_charge_mult = get(wc_eff, 'full_charge_mult', 100.0);
    const wc_reload_time = get(wc_eff, 'reload_time', get(this.weapon, 'reload_time', 1.5));
    const wc_core_dmg_mult = get(wc_eff, 'core_dmg_mult', get(this.weapon, 'core_dmg_mult', 200.0));

    // 변경 무기의 발사 메카닉. 수동 실측 → 스킬 텍스트 → 변경 무기군 기본값 순.
    const wc_over = get(get(get(_DELAYS(), '_weapon_change', {}), this.name, {}), get(wc_eff, 'name', ''), {});
    const wc_fire_rate = float(_pick('fire_rate', [wc_over, wc_eff, wc_mech],
      get(wc_mech, 'fire_rate_min', 1.0)));
    const wc_fire_rate_max = _pick('fire_rate_max', [wc_over, wc_eff, wc_mech]);
    const wc_warmup_bullets = float(_pick('warmup_bullets', [wc_over, wc_eff, wc_mech], 1.0));
    const wc_pellets = int(_pick('pellets', [wc_over, wc_eff, wc_mech], 1));
    // 변경 무기의 히트당 버스트 게이지.
    const wc_burst_energy = float(_pick('burst_energy', [wc_over, wc_eff, wc_mech], 0.0));
    const wc_muzzles = int(_pick('muzzles', [wc_over, wc_eff], 1));
    // 발사 후 딜레이도 실측 계층(`weapon_delays._weapon_change`)이 먼저다.
    const wc_post_fire_delay = _pick('post_fire_delay', [wc_over, wc_eff],
      get(wc_mech, 'post_fire_delay', 0.0));
    // 모드의 명중률 하한.
    const wc_accuracy_floor = float(_pick('accuracy_pct', [wc_over, wc_eff], -Infinity));
    // 탄착군을 잴 무기군. 안 주면 모드 무기로 잰다(종전과 같다).
    const wc_accuracy_weapon = _pystr(or(_pick('accuracy_weapon', [wc_over, wc_eff], ''), ''));

    // 임시 무기 dict 구성 (calc_damage가 weapon["full_charge_mult"] 등을 참조)
    const wc_weapon_dict: Dict = {
      ...this.weapon,
      weapon_type: wc_weapon_type,
      damage_coeff: coeff,
      max_ammo: wc_max_ammo !== -1 ? wc_max_ammo : 999999,
      charge_time: wc_charge_time,
      full_charge_mult: wc_full_charge_mult,
      reload_time: wc_reload_time,
      core_dmg_mult: wc_core_dmg_mult,
    };

    // 발사 전 charge_phase가 ready인 경우 ammo를 weapon_change 장탄으로 세팅
    if (this._wc_new_session && (truthy(get(wc_eff, 'fixed_bullets')) || truthy(get(wc_eff, 'fresh_charge')))) {
      // An explicitly fresh replacement starts a new charge, even if the old SR
      // was in post-delay or had already latched a full charge for a mode switch.
      this._charge_phase = 'ready';
      this._charge_full_t = -1.0;
      this._hold_release_t = -1.0;
      this._pending_auto_reload = false;
    }
    const was_ready = (this._charge_phase === 'ready');

    // CharState 필드 임시 교체
    const orig_weapon = this.weapon;
    const orig_weapon_type = this.weapon_type;
    const orig_mech = this.mech;
    const orig_fire_mode = this.fire_mode;
    const orig_pellets = this.pellets;
    const orig_muzzles = this.muzzles;
    const orig_burst_energy = this.burst_energy;
    const orig_fire_rate = this.fire_rate;
    const orig_fire_rate_max = this.fire_rate_max;
    const orig_warmup_bullets = this.warmup_bullets;
    const orig_charge_time = this.charge_time_base;
    const orig_post_delay = this.post_fire_delay;
    const orig_cover_during_delay = this.cover_during_delay;
    const orig_accuracy_floor = this.accuracy_floor_pct;
    const orig_accuracy_weapon = this.accuracy_weapon;
    let orig_ammo: number | null = !was_ready ? this.ammo : null;

    this.weapon = wc_weapon_dict;
    this.weapon_type = wc_weapon_type;
    this.mech = or(wc_mech, orig_mech);
    this.fire_mode = wc_fire_mode;
    this.pellets = wc_pellets;
    this.muzzles = wc_muzzles;
    this.burst_energy = wc_burst_energy;
    this.fire_rate = wc_fire_rate;
    this.fire_rate_max = wc_fire_rate_max;
    this.warmup_bullets = wc_warmup_bullets;
    this.charge_time_base = wc_charge_time;
    this.post_fire_delay = wc_post_fire_delay;
    this.cover_during_delay = get(wc_eff, 'cover_during_delay', this.cover_during_delay);
    this.accuracy_floor_pct = wc_accuracy_floor;
    this.accuracy_weapon = wc_accuracy_weapon;

    // 실효 최대 장탄.
    let wc_ammo_full: number;
    if (wc_max_ammo === -1) {
      wc_ammo_full = 999999;
    } else if (truthy(get(wc_eff, 'max_ammo_buff_applies'))) {
      wc_ammo_full = this._full_ammo(bm, t); // self.weapon이 변경 무기로 교체된 상태
    } else {
      wc_ammo_full = wc_max_ammo;
    }

    if (wc_fire_mode === 'charge') {
      // 세션에 새로 들어왔으면 **차지 상태와 무관하게** 모드의 탄창을 채운다.
      if (was_ready || this._wc_new_session) {
        this.ammo = wc_ammo_full;
      }
      if (this._wc_new_session && !was_ready) {
        // 이전 무기의 차지가 진행 중인 채로 모드에 진입했다면 차지를 새로 시작한다.
        this._charge_start_t = t;
      }
    } else if (this._wc_new_session) {
      // 연사 무기: 세션 진입 시 1회만 장탄을 채우고 발사 시계를 현재 시각에 맞춘다.
      this.ammo = wc_ammo_full;
      this.next_fire_time = t;
      orig_ammo = null;
      this._wc_ammo_borrowed = true;
    }
    if (this._wc_new_session && truthy(get(wc_eff, 'refill_on_exit'))) {
      this.reloading_until = -1.0;
      this._reload_in_weapon_change = false;
      this._post_reload_end_t = -1.0;
    }
    this._wc_new_session = false;

    // 발수 카운트는 _fire()/_tick_charge()가 self._wc_shots에 직접 누적한다
    let events: HitEvent[];
    if (wc_fire_mode === 'auto' || wc_fire_mode === 'auto_warmup') {
      events = this._tick_auto(t, bm, enemy, cfg);
    } else {
      events = this._tick_charge(t, bm, enemy, cfg);
    }

    if (events.length > 0 && truthy(get(wc_eff, 'continuous_charge'))) {
      // Begin the next charge at the previous scheduled endpoint, avoiding a
      // post-delay frame and cumulative frame rounding over ten half-second shots.
      // Floating-point tolerance keeps an exact boundary shot on its frame.
      this._charge_start_t = this._charge_end_t - 1e-10;
      this._charge_phase = 'charging';
      this._charge_full_t = -1.0;
      this._charge_hold_fired.clear();
      setdefault<Dict>(bm.state, 'charging', {})[this.name] = true;
    }

    // 원복
    this.weapon = orig_weapon;
    this.weapon_type = orig_weapon_type;
    this.mech = orig_mech;
    this.fire_mode = orig_fire_mode;
    this.pellets = orig_pellets;
    this.muzzles = orig_muzzles;
    this.burst_energy = orig_burst_energy;
    this.fire_rate = orig_fire_rate;
    this.fire_rate_max = orig_fire_rate_max;
    this.warmup_bullets = orig_warmup_bullets;
    this.charge_time_base = orig_charge_time;
    this.post_fire_delay = orig_post_delay;
    this.cover_during_delay = orig_cover_during_delay;
    this.accuracy_floor_pct = orig_accuracy_floor;
    this.accuracy_weapon = orig_accuracy_weapon;
    if (orig_ammo !== null && was_ready) {
      // ready→charging 전환만 된 경우는 ammo 원복 불필요 (충전 중)
    }

    // duration_bullets 기반: 지정 발수를 다 쏘면 weapon_change 종료
    let duration_bullets: any = get(wc_eff, 'duration_bullets');
    if (duration_bullets != null) {
      duration_bullets = int(duration_bullets);
      if (truthy(gauge_ref)) {
        duration_bullets = wc_ammo_full;
      } else if (!truthy(get(wc_eff, 'fixed_bullets')) && wc_max_ammo !== -1
          && duration_bullets === wc_max_ammo) {
        // "모든 탄환 발사 시 제거" 형태 — 장탄 버프로 장탄이 늘면 발수도 함께 늘어난다
        duration_bullets = wc_ammo_full;
      }
    }
    if (duration_bullets != null && this._wc_shots >= duration_bullets) {
      // 원래 무기로 돌아오면 charge_phase를 ready로 초기화
      if (!truthy(get(wc_eff, 'refill_on_exit'))) {
        this._charge_phase = 'ready';
      }
      if (wc_fire_mode === 'auto' || wc_fire_mode === 'auto_warmup') {
        // 마지막 발과 같은 tick에 잡힌 변경 무기 재장전 예약은 무효
        this.reloading_until = -1.0;
        this.next_fire_time = t;
      }
      this.ammo = orig_ammo !== null ? orig_ammo : item(this.weapon, 'max_ammo');
      if (truthy(get(wc_eff, 'refill_on_exit'))) {
        this._restore_special_magazine(t, bm);
      }
      this._wc_ammo_borrowed = false; // 여기서 이미 원복했다 (tick의 만료 처리와 중복 금지)
      this._wc_dynamic_ammo = null;
      // 장탄 원복이 끝난 뒤에 종료 이벤트를 쏜다.
      bm.end_weapon_change(this.name, t);
    }

    return events;
  }

  // py: calculator/timeline.py:1540
  _restore_special_magazine(t: number, bm: BM): void {
    // Replacement completion is an ammo refill, not a reload event.
    this.ammo = this._full_ammo(bm, t, true);
    this._recover_spread(t);
    this.reloading_until = -1.0;
    this._reload_in_weapon_change = false;
    this._pending_auto_reload = false;
    this._post_reload_end_t = -1.0;
    // 탄창 복구는 마지막 사격이 예약한 후딜을 취소하지 않는다.
    if (this._charge_phase !== 'post_delay' || this._post_delay_end_t <= t) {
      this._charge_phase = 'ready';
    }
    this._charge_full_t = -1.0;
    this._hold_release_t = -1.0;
    this._wc_refill_on_exit = false;
    setdefault<Dict>(bm.state, 'charging', {})[this.name] = false;
    if (this._sim_log !== null) {
      this._sim_log.ammo_log.push(new AmmoLogEntry({ t, caster: this.name, ammo: this.ammo }));
    }
  }

  // py: calculator/timeline.py:1558
  _fixed_charge_time(bm: BM): number {
    // charge_time_fixed 버프의 fixed_value(초). 복수이면 가장 나중에 부여된 값.
    let best: number | null = null;
    let best_key: [number, number] | null = null;
    for (const ab of bm._active) {
      if (ab.caster !== this.name) {
        continue;
      }
      if (abStat(ab, null) !== 'charge_time_fixed') {
        continue;
      }
      const val = get(ab.effect, 'fixed_value');
      if (val == null) {
        continue;
      }
      // uid는 단조 증가라 같은 프레임에 부여된 복수 항목은 배열 순서상 뒤쪽이 이긴다.
      const key: [number, number] = [ab.activated_at, ab.uid];
      if (best_key === null || cmp(key, best_key) > 0) {
        best = float(val);
        best_key = key;
      }
    }
    return best === null ? this.charge_time_base : best;
  }

  // ── 재장전 ────────────────────────────────────────────────────────────

  // py: calculator/timeline.py:1592
  _fixed_reload_time(bm: BM): number | null {
    // reload_time_fixed 버프의 고정 재장전 시간(초). 복수이면 최대값. 없으면 None.
    let max_val: number | null = null;
    for (const ab of bm._active) {
      if (abStat(ab, null) !== 'reload_time_fixed') {
        continue;
      }
      if (!_in(this.name, or(ab.target_chars, []))) {
        continue;
      }
      const val = bm._get_value(ab.effect, ab);
      if (val != null) {
        max_val = max_val === null ? float(val) : _pymax(max_val, float(val));
      }
    }
    return max_val;
  }

  // ── 컨트롤 실행층 (정본: context/CONTROL.md) ──────────────────────────

  // py: calculator/timeline.py:1622
  _tick_cover(t: number): boolean {
    // 엄폐 구간의 만료를 처리하고 '지금 엄폐 중인가'를 반환.
    if (this._cover_until_reload) {
      if (this.reloading_until > 0) {
        return true;
      }
      this._exit_cover(t); // duration 미지정 = 재장전이 끝나는 순간 이탈
      return false;
    }
    if (this._cover_until > 0) {
      if (t < this._cover_until) {
        return true;
      }
      this._exit_cover(t);
    }
    return false;
  }

  // py: calculator/timeline.py:1635
  _enter_cover(t: number, bm: BM, duration: any, label: string): void {
    // 엄폐 진입 — 사격·차징을 멈추고, 탄이 덜 찼으면 재장전을 건다.
    if (duration == null) {
      this._cover_until_reload = true;
      this._cover_until = -1.0;
    } else {
      this._cover_until_reload = false;
      this._cover_until = t + float(duration);
    }
    // 엄폐하면 들고 있던 차지는 무효다
    if (this.fire_mode === 'charge') {
      this._charge_phase = 'ready';
    }
    this._charge_full_t = -1.0;
    this._hold_release_t = -1.0;
    setdefault<Dict>(bm.state, 'charging', {})[this.name] = false;
    bm.notify('event:cover', t, this.name);
    // 엄폐와 재장전은 별개 사건이다.
    if (this._sim_log !== null) {
      this._sim_log.reload_log.push(new ReloadLogEntry({ t, caster: this.name, event: label }));
    }
    // 이미 재장전 중이면 다시 걸지 않는다
    if (this.reloading_until <= 0 && this.ammo < this._full_ammo(bm, t)) {
      this._start_reload(t, bm);
    }
    bm._invalidate_buffs_cache();
  }

  // py: calculator/timeline.py:1663
  _exit_cover(t: number): void {
    this._cover_until = -1.0;
    this._cover_until_reload = false;
    // 엄폐 동안 밀린 발사를 몰아 쏘지 않는다
    this.next_fire_time = _pymax(this.next_fire_time, t);
    if (this.fire_mode === 'charge') {
      this._charge_phase = 'ready';
    }
  }

  // py: calculator/timeline.py:1671
  _pump_ctrl_seq(t: number, bm: BM): boolean {
    // 명시 시퀀스 — 정책과 같은 입구로 들어가는 또 하나의 액션 생산자.
    let entered = false;
    while (this._ctrl_seq_i < this._ctrl_seq.length) {
      const act = this._ctrl_seq[this._ctrl_seq_i]!;
      if (t < float(get(act, 't', 0.0))) {
        break;
      }
      this._ctrl_seq_i += 1;
      const kind = get(act, 'action', null);
      if (kind === 'cover') {
        this._enter_cover(t, bm, get(act, 'duration', null), '엄폐(시퀀스)');
        entered = true;
      } else if (kind === 'hold' && this.fire_mode === 'charge') {
        // 다음 풀차지를 `until`(절대 시각)까지 들고 있는다.
        const until = get(act, 'until');
        this._hold_release_t = until == null ? -1.0 : float(until);
      }
    }
    return entered;
  }

  // py: calculator/timeline.py:1695
  _apply_cover_policy(t: number, bm: BM): boolean {
    // 기본 전략(정책)들의 진입점. 조건이 맞으면 엄폐 구간을 하나 연다. 열었으면 True.
    if (this._cover_until_reload || this._cover_until > 0) {
      return false; // 이미 엄폐 중
    }
    // 모드 탄창 로직을 흔들지 않도록 weapon_change 중에는 걸지 않는다
    if (this._in_weapon_change || bm.get_weapon_change(this.name) != null) {
      return false;
    }
    return (this._apply_burst_cover(t, bm) || this._apply_reload_cover(t, bm)
      || this._apply_tap_reload(t, bm));
  }

  // py: calculator/timeline.py:1710
  _apply_tap_reload(t: number, bm: BM): boolean {
    // 버충 톡톡이의 재장전 — 풀버스트가 끝나는 순간 엄폐해 탄창을 채우고 곧바로 톡톡이로.
    if (!(this.tap_fire && this.tap_policy === 'burst_charge'
        && (this.tap_reload_at_end || this.tap_full_charge_after_reload))) {
      return false;
    }
    if (this.fire_mode !== 'charge' || truthy(get(bm.state, 'full_burst', false))) {
      return false;
    }
    const anchor = get(bm.state, 'full_burst_end_t', -1.0);
    if (anchor <= 0 || t < anchor || anchor === this._tap_reload_anchor) {
      return false;
    }
    this._tap_reload_anchor = anchor;
    // 재장전 뒤 첫 발은 풀차지.
    if (this.tap_full_charge_after_reload) {
      this._tap_full_pending = true;
    }
    if (!this.tap_reload_at_end) {
      return false;
    }
    // 이미 재장전 중이거나 탄이 꽉 찼으면 엄폐할 일이 없다.
    if (this.reloading_until > 0 || this.ammo >= this._full_ammo(bm, t)) {
      return false;
    }
    this._enter_cover(t, bm, null, '엄폐 시작(버충 톡톡이 재장전)');
    return true;
  }

  // py: calculator/timeline.py:1738
  _apply_hold_policy(t: number, bm: BM): void {
    // 홀드컨 — 본인 버스트 사이클의 풀버스트 동안 풀차지를 들고 있는다.
    if (this.fire_mode !== 'charge') {
      return;
    }
    if (_in(this.name, get(bm.state, 'bunny_modes', {}))) {
      return; // Explicit bunny mode control owns the hold; avoid conflicting toggles.
    }
    if (!(this.hold_policy === 'own_full_burst' || this.hold_policy === 'charge_hold_after_fb')) {
      return;
    }
    if (!truthy(get(bm.state, 'full_burst', false))) {
      return;
    }
    if (!truthy(get(get(bm.state, 'burst_casted', {}), this.name))) {
      return;
    }
    const anchor = get(bm.state, 'full_burst_end_t', -1.0);
    if (anchor <= 0 || anchor === this._hold_ctrl_anchor) {
      return; // 이 사이클에서 이미 걸었다
    }
    this._hold_ctrl_anchor = anchor;

    if (this.hold_policy === 'own_full_burst') {
      this._hold_release_t = anchor - this.hold_lead;
      return;
    }

    // `charge_hold_after_fb` — 본인 버스트가 **끝난 직후에** `charge_hold:N` 판정이
    // 떨어지도록 차지 시작 시각을 역산한다.
    //   판정 시각 = 풀버스트 종료 + lead
    //   차지 시작 = 판정 시각 − 차지 시간 − 유지 임계
    const thresholds = bm.charge_hold_thresholds(this.name);
    if (!truthy(thresholds)) {
      return; // `charge_hold:N`을 쓰지 않는 캐릭터에는 의미가 없다
    }
    const need = thresholds[thresholds.length - 1][0];
    this._ch_judge_t = anchor + this.hold_lead;
    this._ch_charge_start_t = this._ch_judge_t - this._effective_charge_time(bm, t) - need;
  }

  // py: calculator/timeline.py:1784
  _apply_burst_cover(t: number, bm: BM): boolean {
    // 버스트 엄폐컨 — 본인이 버스트를 쓴 사이클의 풀버스트 동안 엄폐한다.
    if (this.cover_policy !== 'own_full_burst') {
      return false;
    }
    if (!truthy(get(bm.state, 'full_burst', false))) {
      return false;
    }
    if (!truthy(get(get(bm.state, 'burst_casted', {}), this.name))) {
      return false;
    }
    const anchor = get(bm.state, 'full_burst_end_t', -1.0);
    if (anchor <= 0 || anchor === this._cover_ctrl_anchor) {
      return false; // 이 사이클에서 이미 걸었다
    }
    const duration = anchor - t + this.cover_extend;
    if (duration <= 0) {
      return false;
    }
    this._cover_ctrl_anchor = anchor;
    this._enter_cover(t, bm, duration, '엄폐 시작(버스트 엄폐컨)');
    return true;
  }

  // py: calculator/timeline.py:1811
  _apply_reload_cover(t: number, bm: BM): boolean {
    // 장전컨 — 재장전을 유리한 구간에 밀어 넣는다.
    if (!truthy(this.reload_policy)) {
      return false;
    }
    if (this.reloading_until > 0 || this._post_reload_end_t > 0) {
      return false;
    }
    if (this.ammo >= this._full_ammo(bm, t)) {
      return false;
    }

    let anchor: number;
    if (this.reload_policy === 'before_fb_end') {
      if (!truthy(get(bm.state, 'full_burst', false))) {
        return false;
      }
      anchor = get(bm.state, 'full_burst_end_t', -1.0);
      if (anchor <= 0 || t < anchor - this.reload_lead) {
        return false;
      }
      if (this.reload_if_dry && !this._dry_before_next_fb(t, bm, anchor)) {
        return false;
      }
    } else if (this.reload_policy === 'into_fb') {
      anchor = get(bm.state, 'next_fb_start_pred', -1.0);
      if (anchor <= 0) {
        return false; // 관측 주기가 없는 첫 사이클
      }
      if (t < anchor - (this._reload_total_duration(bm, t) - this.reload_margin)) {
        return false;
      }
    } else {
      return false;
    }

    if (anchor === this._reload_ctrl_anchor) {
      return false; // 이 사이클에서 이미 걸었다
    }
    this._reload_ctrl_anchor = anchor;
    this._enter_cover(t, bm, this.reload_cover_dur, '엄폐 시작(장전컨)');
    return true;
  }

  // py: calculator/timeline.py:1852
  _dry_before_next_fb(t: number, bm: BM, fb_end: number): boolean {
    // 남은 장탄으로 다음 풀버스트 시작까지 버티지 못하면 True (`reload.if_dry`).
    const nxt = get(bm.state, 'next_fb_start_pred', -1.0);
    if (nxt <= 0) {
      return false;
    }
    const need = (fb_end - t) + _pymax(0.0, nxt - fb_end);
    const have = this.ammo / _pymax(this._current_fire_rate(bm, t), 0.01);
    return have < need;
  }

  // py: calculator/timeline.py:1877
  _reload_duration(bm: BM, t: number): number {
    // 현재 버프를 반영한 재장전 **1회** 소요 시간(초).
    const fixed = this._fixed_reload_time(bm);
    if (fixed !== null) {
      // "재장전 시간 N초로 고정" — 절대 고정이라 reload_speed_pct를 타지 않는다
      return fixed;
    }
    return item(this.weapon, 'reload_time') * this._reload_speed_factor(bm, t);
  }

  // py: calculator/timeline.py:1889
  _reload_speed_factor(bm: BM, t: number): number {
    // 재장전 시간에 곱할 배수. 앞뒤 딜레이에도 같이 곱한다.
    const speed_pct = get(bm.get_buffs(this.name, '__enemy__', t), 'reload_speed_pct', 0.0) / 100.0;
    return _pymax(0.0, 1.0 - speed_pct);
  }

  // py: calculator/timeline.py:1901
  _is_clip_reload(bm: BM): boolean {
    // 지금 굴러가는 재장전이 클립 장전인가.
    return this.is_clip && bm.get_weapon_change(this.name) == null;
  }

  // py: calculator/timeline.py:1908
  _clip_gain(full: number): number {
    // 클립 1회가 채우는 발수 = **현재** 최대 장탄의 1/3을 **반올림**한 값.
    return _pymax(1, Math.floor(full / 3 + 0.5));
  }

  // py: calculator/timeline.py:1918
  _reload_total_duration(bm: BM, t: number): number {
    // 지금 재장전을 시작하면 **탄창이 다 찰 때까지** 걸리는 시간(초).
    const one = this._reload_duration(bm, t);
    if (!this._is_clip_reload(bm)) {
      return one;
    }
    const full = this._full_ammo(bm, t);
    const clips = Math.ceil(_pymax(0, full - this.ammo) / this._clip_gain(full));
    return one * _pymax(1, clips);
  }

  // py: calculator/timeline.py:1932
  _recover_spread(t: number): void {
    if (this._spread_reload_at !== null) {
      this._spread_scale = _pymin(float(get(this._spread_spec, 'start', 250)), this._spread_scale + _pymax(0, t - this._spread_reload_at) * float(get(this._spread_spec, 'recovery', 0)));
      this._spread_reload_at = null;
    }
  }

  // py: calculator/timeline.py:1937
  _start_reload(t: number, bm: BM, label = '재장전 시작', from_empty = false): void {
    // 탄을 비워 자동으로 걸린 재장전만 시작 지연을 얹는다.
    const lead = from_empty ? (this.reload_start_delay * this._reload_speed_factor(bm, t)) : 0.0;
    this.reloading_until = t + lead + this._reload_duration(bm, t);
    this._recover_spread(t);
    this._spread_reload_at = t;
    this._reload_in_weapon_change = bm.get_weapon_change(this.name) != null;
    // 차지 중에 재장전이 걸리면 차지는 무효다.
    if (this.fire_mode === 'charge') {
      this._charge_phase = 'ready';
    }
    this._charge_full_t = -1.0;
    this._hold_release_t = -1.0;
    setdefault<Dict>(bm.state, 'charging', {})[this.name] = false;
    bm._invalidate_buffs_cache();
    // 예열은 재장전으로 리셋되지 않는다.
    if (this._sim_log !== null) {
      this._sim_log.reload_log.push(new ReloadLogEntry({ t, caster: this.name, event: label }));
    }
  }

  // py: calculator/timeline.py:1958
  _cancel_reload(t: number, _bm: BM): void {
    // 진행 중인 재장전을 **완료시키지 않고** 끊는다 (탄충 취소 컨트롤).
    this._recover_spread(t);
    this.reloading_until = -1.0;
    this._reload_in_weapon_change = false;
    if (this._sim_log !== null) {
      this._sim_log.reload_log.push(
        new ReloadLogEntry({ t, caster: this.name, event: '재장전 취소(탄충)' }));
    }
  }

  // py: calculator/timeline.py:1974
  _full_ammo(bm: BM, t: number, original_weapon = false): number {
    // 무기 변경 모드 중이면 그 모드의 장탄으로 채운다.
    let base = item(this.weapon, 'max_ammo');
    const wc_eff = bm.get_weapon_change(this.name);
    if (wc_eff != null && !original_weapon) {
      const wc_max = get(wc_eff, 'max_ammo', -1);
      if (wc_max !== -1) {
        if (!truthy(get(wc_eff, 'max_ammo_buff_applies'))) {
          return int(wc_max);
        }
        // 부르는 자리마다 교체 여부가 달라 밑값이 흔들리면 안 된다.
        base = int(wc_max);
      }
    }
    const buffs = bm.max_ammo_buffs(this.name, '__enemy__', t);
    // 장탄 % 버프는 소스마다 따로 발수로 반올림한 뒤 더한다.
    const ammo_gain = int(_quant_sum(base, buffs, 'max_ammo_pct', 1.0));
    const ammo_flat = int(round(get(buffs, 'max_ammo_flat', 0.0)));
    // 감소 버프가 겹쳐도 최대 장탄은 1발 아래로 내려가지 않는다.
    return _pymax(1, base + ammo_gain + ammo_flat);
  }

  // py: calculator/timeline.py:2000
  _finish_reload(t: number, bm: BM): void {
    // 재장전 1회를 완료한다. 클립 무기는 탄창이 다 찼을 때만 '완료'다.
    const full = this._full_ammo(bm, t);
    if (this._is_clip_reload(bm)) {
      this.ammo = _pymin(full, this.ammo + this._clip_gain(full));
      if (this.ammo < full) {
        if (this._sim_log !== null) {
          this._sim_log.ammo_log.push(new AmmoLogEntry({ t, caster: this.name, ammo: this.ammo }));
        }
        this._start_reload(t, bm, '클립 재장전');
        return;
      }
    } else {
      this.ammo = full;
    }
    this._recover_spread(t);
    this.reloading_until = -1.0;
    this._reload_in_weapon_change = false;
    bm.notify('event:full_reload', t, this.name);
    if (this._sim_log !== null) {
      this._sim_log.reload_log.push(new ReloadLogEntry({ t, caster: this.name, event: '재장전 완료' }));
      this._sim_log.ammo_log.push(new AmmoLogEntry({ t, caster: this.name, ammo: this.ammo }));
    }
    if (this.post_reload_delay > 0.0) {
      this._post_reload_end_t = t + this.post_reload_delay * this._reload_speed_factor(bm, t);
    } else {
      this.next_fire_time = t;
    }
  }

  // py: calculator/timeline.py:2032
  _auto_reload(t: number, bm: BM): void {
    // 엄폐 니케의 딜레이 중 자동재장전. 장탄을 최대로 채우고 event:full_reload 발동.
    this.ammo = this._full_ammo(bm, t);
    bm.notify('event:full_reload', t, this.name);
    if (this._sim_log !== null) {
      this._sim_log.reload_log.push(new ReloadLogEntry({ t, caster: this.name, event: '자동 재장전(엄폐)' }));
      this._sim_log.ammo_log.push(new AmmoLogEntry({ t, caster: this.name, ammo: this.ammo }));
    }
  }
}

// ── BurstController ───────────────────────────────────────────────────────

// py: calculator/timeline.py:2044
export function charge_end(start: number, regen: number, windows: Array<[number, number]>): number {
  // `start`부터 게이지를 채워 `regen`초어치가 차는 시각. 족자 구간만큼 뒤로 밀린다.
  if (!truthy(windows)) {
    return start + regen;
  }
  let t = start;
  let remaining = regen;
  for (const [lo, hi] of sorted(windows)) {
    if (hi <= t) {
      continue; // 이미 지난 구간
    }
    if (lo >= t + remaining) {
      break; // 이 구간이 오기 전에 다 찬다
    }
    remaining -= _pymax(0.0, lo - t); // 구간 시작 전까지 채운 몫
    t = hi; // 족자 동안 멈췄다가 끝나면 재개
  }
  return t + remaining;
}

// py: calculator/timeline.py:2064
export class BurstController {
  // 스쿼드 버스트 흐름 관리. 발사 루프와 완전 독립.
  config: Dict;
  cheats: any;
  _gauge_blocked: Array<[number, number]>;
  char_states: Record<string, CharState>;
  enemy_def: any;
  squad_names: string[];
  slot_names: string[];
  _default_burst_stage: Record<string, any>;
  _max_burst_count: number | null;
  _burst_sequence: Dict[] | null;
  _burst_count: number;
  _no_burst_char: string | null;
  _no_burst_names: Set<string>;
  _burst_pattern: Dict;
  _sim_duration: number;
  _burst_reaction: number;
  burst_order: Record<string, string[]>;
  _burst_cd: Record<string, number>;
  burst_ready_at: Record<string, number>;
  _cd_applied_at_cast: Record<string, number>;
  gauge_full_at: Record<string, number>;
  _gauge_mode: string;
  _phase: string;
  _next_action_t: number;
  _full_burst_end_t: number;
  _last_fb_start_t: number;
  _obs_next_fb: number;
  _cd_next_fb: number;
  _cd_wait_candidates: string[] | null;
  _reenter_stage: string;
  _pending_burst_dmg: Array<[string, Dict, number]>;
  _fb_caster: string;
  _log: SimLog | null;

  // py: calculator/timeline.py:2074
  constructor(
    squad: Dict[],
    config: Dict,
    char_states: Record<string, CharState>,
    enemy: Dict,
  ) {
    this.config = config;
    // 켜 둔 핵. 게이지 충전은 표(buffs)가 아니라 **시간**의 문제라 여기서 직접 읽는다.
    this.cheats = cheats_from_config(config);
    // 족자 중에는 평타가 빗나가니 버스트 게이지도 안 찬다 — 옵션이다.
    this._gauge_blocked = (
      truthy(get(config, 'immune_blocks_burst'))
        ? (or(get(enemy, 'immune_windows'), []) as any[]).map(([a, b]: any[]) => [float(a), float(b)] as [number, number])
        : []
    );
    this.char_states = char_states;
    this.enemy_def = get(enemy, 'def', 31784);
    this.squad_names = squad.map((c) => item(c, 'name'));
    // 같은 단계 버스트 우선순위만 실제 자리 순서(앞자리 먼저). py: timeline.py slot_names
    this.slot_names = [...(or(get(config, '_slot_order'), this.squad_names) as string[])];

    // 캐릭터별 기본(고정) 버스트 단계 — 변하지 않음
    this._default_burst_stage = {};
    for (const c of squad) {
      const _bs = get(c, 'burst_stage');
      this._default_burst_stage[item(c, 'name')] = truthy(_bs) ? _bs : item(item(_NIKKE(), item(c, 'name')), 'burst_stage');
    }

    // 최대 풀버스트 횟수 / 사이클별 단계 사용 순서 / 버스트 미사용 캐릭터
    this._max_burst_count = get(config, 'max_burst_count', null);
    this._burst_sequence = get(config, 'burst_sequence', null);
    this._burst_count = 0;
    this._no_burst_char = get(config, 'no_burst_char', null);
    // 버스트를 아예 안 쓰는 캐릭터들. **후보에서 통째로 빠진다**.
    this._no_burst_names = new Set(or(get(config, 'no_burst_chars'), []) as string[]);

    // 캐릭터별 버스트 사용 패턴 — {이름: "every:3" | [1, 3, 5, ...]}.
    this._burst_pattern = or(get(config, 'burst_pattern'), {});
    // `last:N`(막바지 최우선)이 남은 시간을 재려면 전투 길이를 알아야 한다.
    this._sim_duration = float(get(config, 'duration', 180.0));
    // 버스트 반응속도.
    this._burst_reaction = float(get(config, 'burst_reaction', 0.05));

    // 단계별 우선순위 목록 (입력 순서) — tick마다 _rebuild_burst_order()로 갱신
    this.burst_order = { '1': [], '2': [], '3': [] };
    this._rebuild_burst_order({});

    // 캐릭터별 버스트 쿨타임 (parsed_nikke.json burst_cooldown 필드)
    this._burst_cd = {};
    for (const c of squad) {
      this._burst_cd[item(c, 'name')] = get(item(_NIKKE(), item(c, 'name')), 'burst_cooldown', 40.0);
    }

    // 캐릭터별 버스트 사용 가능 시각
    this.burst_ready_at = {};
    for (const n of this.squad_names) this.burst_ready_at[n] = 0.0;

    // burst_cast 시 반영된 burst_cooldown 추적 (full_burst_start 소급 보정용)
    this._cd_applied_at_cast = {};
    for (const n of this.squad_names) this._cd_applied_at_cast[n] = 0.0;

    // 버스트 게이지 충전 완료 시각 — 첫 버스트는 burst_regen_time 무시, first_burst_time에 발동
    const _first_burst_t = this.cheats.burst_charge ? 0.0 : get(config, 'first_burst_time', 3.0);
    this.gauge_full_at = {};
    for (const c of squad) this.gauge_full_at[item(c, 'name')] = _first_burst_t;

    // 게이지 사이클 판정 방식 — "fixed"(종전 고정 시간) / "accumulate"(실누적).
    this._gauge_mode = get(config, 'burst_gauge_mode', 'fixed');

    // 버스트 진행 상태  "idle" / "stage:N" / "reenter:N" / "switching" / "full_burst"
    this._phase = 'idle';
    this._next_action_t = Infinity;
    this._full_burst_end_t = -1.0;
    // 다음 풀버스트 시작 예측.
    this._last_fb_start_t = -1.0;
    this._obs_next_fb = -1.0;
    this._cd_next_fb = -1.0; // 관측이 없는 동안 쓰는 쿨타임 기반 예측

    // 쿨타임 대기 중인 단계의 후보 목록 (대기가 아니면 None).
    this._cd_wait_candidates = null;

    // reenter 대기 중인 단계
    this._reenter_stage = '';

    // 풀버스트 진입 시 발동할 버스트 대미지 (버프 적용 후 계산)
    this._pending_burst_dmg = []; // (caster, eff, hit_count)

    // 현재 풀버스트 사이클의 3단계 버스트 발동자 (fullburst_duration 귀속용)
    this._fb_caster = '';

    // verbose 로그 (simulate에서 주입)
    this._log = null;
  }

  // py: calculator/timeline.py:2179
  tick(t: number, bm: BM, state: Dict): HitEvent[] {
    const events: HitEvent[] = [];

    // ── 유효 버스트 단계 갱신 ─────────────────────────────────────────
    const active_stages: Record<string, string> = {};
    for (const ab of bm._active) {
      const stat: string = abStat(ab, '');
      if (stat.startsWith('burst_stage_override:') && !stat.includes('reenter')) {
        const n = stat.split(':')[1]!;
        active_stages[ab.caster] = n;
      }
    }
    this._rebuild_burst_order(active_stages);
    // state["burst_stages"]는 condition 평가에 쓰이므로 현재 유효 단계로 동기화
    for (const name of this.squad_names) {
      const _as = get(active_stages, name);
      item(state, 'burst_stages')[name] = (
        truthy(_as) ? _as : get(this._default_burst_stage, name, '')
      );
    }

    // ── 풀버스트 종료 ──────────────────────────────────────────────────
    if (this._phase === 'full_burst' && t >= this._full_burst_end_t - 1e-9) {
      this._phase = 'idle';
      state['full_burst'] = false;
      bm._invalidate_buffs_cache();
      // burst_casted 리셋은 notify 이후
      for (const n of this.squad_names) {
        bm.notify('full_burst_end', t, n);
      }
      for (const n of this.squad_names) {
        item(state, 'burst_casted')[n] = false;
      }
      if (this._log !== null) {
        this._log.burst_log.push(new BurstLogEntry({ t, event: 'full_burst 종료', caster: '' }));
      }
      for (const name of this.squad_names) {
        if (this.cheats.burst_charge) {
          // 충전 시간 0.
          this.gauge_full_at[name] = t;
          continue;
        }
        const regen = get(this.char_states[name]!.char, 'burst_regen_time', 2.0);
        this.gauge_full_at[name] = charge_end(t, regen, this._gauge_blocked);
      }
      this._burst_count += 1;
      // 관측이 아직 없는 사이클(= 첫 사이클)의 예측을 **여기서 한 번만** 낸다.
      if (this._obs_next_fb <= 0.0) {
        this._cd_next_fb = this._predict_next_fb_start(t);
      }
    }

    // ── idle → 게이지 충전 완료 시 1단계 진입 ─────────────────────────
    const _at_max = (this._max_burst_count != null && this._burst_count >= this._max_burst_count);
    if (this._phase === 'idle' && !_at_max) {
      if (this._gauge_ready(t, state)) {
        // 버스트 흐름 로그에는 **"accumulate"에서만** 적는다.
        if (this._log !== null && this._gauge_mode === 'accumulate') {
          this._log.burst_log.push(new BurstLogEntry({
            t, event: `게이지 만충 ${_fmt(get(state, 'burst_gauge', 0.0), 1)}% → 1단계 진입 (소모)`,
            caster: '',
          }));
        }
        // 1단계 진입이 게이지를 소모한다(두 모드 모두 — 로그에 남는다).
        bm.consume_burst_gauge(t);
        this._phase = 'stage:1';
        this._next_action_t = t + this._burst_reaction;
        for (const n of this.squad_names) {
          bm.notify('burst_enter:1', t, n);
        }
      }
    }

    // ── 쿨 대기 중 도착한 버스트 쿨감 반영 ─────────────────────────────
    if (truthy(this._cd_wait_candidates)) {
      const earliest = minBy(this._cd_wait_candidates!.map((n) => get(this.burst_ready_at, n, 0.0) as number));
      this._next_action_t = _pymin(this._next_action_t, _pymax(t, earliest));
    }

    // ── 단계 스킬 사용 ─────────────────────────────────────────────────
    if (this._phase.startsWith('stage:') && t >= this._next_action_t - 1e-9) {
      const stage = this._phase.split(':')[1]!;
      const [ev, advanced, reenter_info] = this._try_use_stage(stage, t, bm, state);
      events.push(...ev);

      if (truthy(reenter_info)) {
        // reenter: 같은 단계 재진입 대기 (사용자는 딜레이 후 재선출)
        const r_stage = reenter_info![1];
        this._reenter_stage = r_stage;
        this._phase = `reenter:${r_stage}`;
        this._next_action_t = t + get(this.config, 'burst_reenter_delay', 0.5);
      } else if (advanced) {
        if (stage === '3') {
          this._phase = 'switching';
          this._next_action_t = t + 0.05;
        } else {
          const next_stage = String(int(stage) + 1);
          this._phase = `stage:${next_stage}`;
          this._next_action_t = (t + get(this.config, 'burst_switch_delay', 0.1)
            + this._burst_reaction);
          for (const n of this.squad_names) {
            bm.notify(`burst_enter:${next_stage}`, t, n);
          }
        }
      }
    }

    // ── reenter 딜레이 완료 → 재진입 ──────────────────────────────────
    if (this._phase.startsWith('reenter:') && t >= this._next_action_t - 1e-9) {
      const r_stage = this._reenter_stage;
      // 재진입 단계 진입 이벤트 발생 (burst_enter:N 조건 트리거용)
      for (const n of this.squad_names) {
        bm.notify(`burst_enter:${r_stage}`, t, n);
      }
      // 해당 단계 후보 중 쿨타임이 풀린 캐릭터를 재선출 (reenter 발동자는 이미 쿨)
      const [ev, advanced, reenter_info] = this._try_use_stage(r_stage, t, bm, state);
      events.push(...ev);
      // 같은 단계 재진입은 사이클당 한 번.
      if (!advanced && reenter_info === null) {
        // 전원 쿨타임 중이면 대기 (이미 _next_action_t가 갱신됨)
      } else if (r_stage === '3') {
        this._phase = 'switching';
        this._next_action_t = t + 0.05;
      } else {
        const next_stage = String(int(r_stage) + 1);
        this._phase = `stage:${next_stage}`;
        this._next_action_t = (t + get(this.config, 'burst_switch_delay', 0.1)
          + this._burst_reaction);
        for (const n of this.squad_names) {
          bm.notify(`burst_enter:${next_stage}`, t, n);
        }
      }
    }

    // ── 전환 딜레이 → 풀버스트 진입 ───────────────────────────────────
    if (this._phase === 'switching' && t >= this._next_action_t - 1e-9) {
      this._phase = 'full_burst';
      // fullburst_duration 버프(초) 합산. caster당 1회만 집계한다.
      const seen_casters = new Set<string>();
      let fb_ext = 0.0;
      for (const ab of bm._active) {
        if (abStat(ab, null) !== 'fullburst_duration') {
          continue;
        }
        if (seen_casters.has(ab.caster)) {
          continue;
        }
        // burst_cast 타이밍으로 등록된 fullburst_duration은 3단계 발동자일 때만 반영
        const timings = get(get(ab.effect, 'trigger', {}), 'timing', []);
        if (_in('burst_cast', timings) && ab.caster !== this._fb_caster) {
          continue;
        }
        let val = get(ab.effect, 'fixed_value');
        if (val == null) {
          const lv = _get_skill_lv(this.char_states[ab.caster]!.char, ab.effect);
          const vals = get(ab.effect, 'values', {});
          val = float(get(vals, lv, get(vals, '10', 0.0)));
        }
        fb_ext += float(val);
        seen_casters.add(ab.caster);
      }
      this._full_burst_end_t = t + _pymax(1.0, 10.0 + fb_ext);
      state['full_burst'] = true;
      // 장전컨(context/CONTROL.md)이 쓰는 사이클 정보를 state에 공개한다.
      state['full_burst_end_t'] = this._full_burst_end_t;
      if (this._last_fb_start_t >= 0.0) {
        this._obs_next_fb = t + (t - this._last_fb_start_t);
      }
      this._last_fb_start_t = t;
      bm._invalidate_buffs_cache();
      for (const n of this.squad_names) {
        bm.notify('full_burst_start', t, n);
      }
      // full_burst_start마다 burst_cooldown 버프를 burst_ready_at에 반영.
      // dict.fromkeys: 동명 캐릭터 중복 보정 방지
      for (const n of [...new Set(this.squad_names)]) {
        const cd_now = get(bm.get_buffs(n, '__enemy__', t), 'burst_cooldown', 0.0);
        if (item(this.burst_ready_at, n) > t) {
          const extra = cd_now - get(this._cd_applied_at_cast, n, 0.0);
          if (extra > 0.0) {
            this.burst_ready_at[n] = _pymax(t, item(this.burst_ready_at, n) - extra);
          }
        }
        // 다음 full_burst_start에서 재적용 가능하도록 초기화
        this._cd_applied_at_cast[n] = 0;
      }
      // 버스트 스킬 대미지: full_burst_start 버프 적용 후 계산
      events.push(...this._fire_pending_burst_dmg(t, bm));
      if (this._log !== null) {
        this._log.burst_log.push(new BurstLogEntry({
          t, event: 'full_burst 시작', caster: '', planned_end: this._full_burst_end_t,
        }));
        const snap = new BuffSnapshot({ t, buffs_by_char: {} });
        for (const n of this.squad_names) {
          const entries: BuffEntry[] = [];
          for (const ab of bm._active) {
            const resolved = (
              ab.target_chars == null
                ? bm._resolve_target(get(ab.effect, 'target', 'self'), ab.caster)
                : ab.target_chars
            );
            if (_in(n, resolved)) {
              entries.push(new BuffEntry({
                name: get(ab.effect, 'name', abStat(ab, '?')),
                caster: ab.caster,
                expires_at: ab.expires_at,
              }));
            }
          }
          snap.buffs_by_char[n] = entries;
        }
        this._log.buff_snapshots.push(snap);
      }
    }

    // ── 충전 창 공개 ──────────────────────────────────────────────────
    // 게이지는 **풀버스트가 끝나기 전까지는 충전되지 않는다**. 그 조건이 `_phase == "idle"`과 같다.
    state['burst_gauge_charging'] = (this._phase === 'idle');

    // ── 다음 풀버스트 시작 예측 ────────────────────────────────────────
    // **관측이 있으면 관측이 이긴다.**
    state['next_fb_start_pred'] = (
      this._obs_next_fb > 0.0 ? this._obs_next_fb : this._cd_next_fb);

    return events;
  }

  // py: calculator/timeline.py:2391
  _predict_next_fb_start(t: number): number {
    // 다음 풀버스트가 시작할 시각. 없으면 `-1.0`.
    //   열림₁ = max(기준, 게이지 준비)          기준 = 풀버스트 중이면 그 종료, 아니면 지금
    //   누름ₖ = min over 후보 n ( max(열림ₖ, 쿨 해제[n]) ) + 반응속도
    //   열림ₖ₊₁ = 누름ₖ + burst_switch_delay
    //   예측 = 누름₃ + 0.05
    const in_fb = this._phase === 'full_burst';
    if (this._max_burst_count != null
        && this._burst_count + (in_fb ? 1 : 0) >= this._max_burst_count) {
      return -1.0;
    }

    let base = in_fb ? this._full_burst_end_t : t;
    if (this._gauge_mode !== 'accumulate') {
      if (in_fb) {
        base = charge_end(base, maxBy(this.squad_names.map(
          (n) => get(this.char_states[n]!.char, 'burst_regen_time', 2.0) as number)), this._gauge_blocked);
      } else {
        base = _pymax(base, maxBy(Object.values(this.gauge_full_at)));
      }
    }

    const cycle_idx = this._burst_count + (in_fb ? 1 : 0);
    let first = 1;
    if (this._phase.startsWith('stage:') || this._phase.startsWith('reenter:')) {
      first = int(this._phase.split(':')[1]!);
      base = _pymax(t, this._next_action_t < Infinity ? this._next_action_t : t);
    } else if (this._phase === 'switching') {
      return _pymax(t, this._next_action_t) + 0.05;
    }

    let at = base + this._burst_reaction;
    for (let i = first; i < 4; i += 1) {
      const stage = String(i);
      const cands = this._predict_candidates(stage, cycle_idx);
      if (!truthy(cands)) {
        return -1.0; // 그 단계를 쓸 사람이 없다 — 사이클이 영영 안 돈다
      }
      const _at = at;
      at = minBy(cands.map((n) => _pymax(_at, get(this.burst_ready_at, n, 0.0))));
      if (stage !== '3') {
        at += get(this.config, 'burst_switch_delay', 0.1) + this._burst_reaction;
      }
    }
    return at + 0.05;
  }

  // py: calculator/timeline.py:2439
  _predict_candidates(stage: string, cycle_idx: number): string[] {
    // 예측용 단계 후보. `_try_use_stage()`가 쓰는 것과 같은 출처.
    if (this._burst_sequence != null
        && cycle_idx < this._burst_sequence.length) {
      return get(this._burst_sequence[cycle_idx]!, stage, []);
    }
    return get(this.burst_order, stage, []);
  }

  // py: calculator/timeline.py:2450
  _gauge_ready(t: number, state: Dict): boolean {
    // 1단계에 진입할 수 있는가. **두 모델이 갈리는 유일한 지점이다.**
    if (this._gauge_mode === 'accumulate') {
      return this.cheats.burst_charge || get(state, 'burst_gauge', 0.0) >= 100.0 - 1e-9;
    }
    return this.squad_names.every((n) => t >= item(this.gauge_full_at, n) - 1e-9);
  }

  // py: calculator/timeline.py:2461
  _pattern_rank(name: string, cycle: number, t: number): number {
    // 이번 사이클의 우선순위 등급. 낮을수록 먼저 쓴다.
    //  -1 — `last:N`, 0 — 이번 사이클이 그 차례, 1 — 패턴 없음, 2 — 패턴이 있지만 이번 사이클이 아님
    const pat = get(this._burst_pattern, name);
    if (pat == null) {
      return 1;
    }
    if (typeof pat === 'string' && pat.startsWith('last:')) {
      // 막바지 전용 — 남은 시간이 N초 미만이면 누구보다 먼저 쓴다.
      const seconds = float(_split1(pat, ':'));
      return this._sim_duration - t < seconds ? -1 : 1;
    }
    let due: boolean;
    if (typeof pat === 'string' && pat.startsWith('every:')) {
      const n = int(_split1(pat, ':'));
      due = n > 0 && cycle % n === 0;
    } else {
      due = new Set(pat as any[]).has(cycle);
    }
    return due ? 0 : 2;
  }

  // py: calculator/timeline.py:2488
  _try_use_stage(stage: string, t: number, bm: BM, state: Dict): [HitEvent[], boolean, [string, string] | null] {
    // 반환: (events, advanced, reenter_info)   reenter_info: (caster, stage) or None
    let candidates: string[];
    if (
      this._burst_sequence != null
      && this._burst_count < this._burst_sequence.length
    ) {
      candidates = get(this._burst_sequence[this._burst_count]!, stage, []);
    } else {
      candidates = get(this.burst_order, stage, []);
      if (truthy(this._burst_pattern)) {
        const cycle = this._burst_count + 1; // 1-based — 유저가 세는 "N번째 버스트"
        candidates = sorted(candidates, (n) => this._pattern_rank(n, cycle, t));
        // 이번 사이클이 «차례»인 사람이 있으면 그 사람만 후보다.
        // 기절한 사람은 못 누르므로 빼고, 차례인 사람이 아무도 남지 않으면 평소 순서로 돌아간다.
        const due = candidates.filter(
          (name) => this._pattern_rank(name, cycle, t) === 0 && !bm.is_stunned(name),
        );
        if (truthy(due)) {
          candidates = due;
        }
      }
    }
    // 쿨 대기 플래그는 매번 새로 판정한다 (아래 대기 분기에서만 다시 세운다)
    this._cd_wait_candidates = null;

    if (!truthy(candidates)) {
      // 해당 단계 캐릭터가 없으면 이 단계에서 버스트 진행 불가 (영구 블록)
      this._next_action_t = Infinity;
      return [[], false, null];
    }

    for (const name of candidates) {
      if (t < get(this.burst_ready_at, name, 0.0) - 1e-9) {
        continue;
      }
      if (bm.is_stunned(name)) {
        continue;
      }
      const events = this._cast_burst(name, stage, t, bm, state);

      // burst_stage_override:reenterN 버프 활성 여부 확인
      const reenter = this._check_reenter(name, bm);
      if (truthy(reenter)) {
        return [events, false, [name, reenter!]];
      }
      return [events, true, null];
    }

    // 전원 쿨타임 중 → 대기.
    const earliest = minBy(candidates.map((n) => get(this.burst_ready_at, n, 0.0) as number));
    this._next_action_t = _pymax(this._next_action_t, earliest);
    this._cd_wait_candidates = [...candidates];
    return [[], false, null];
  }

  // py: calculator/timeline.py:2548
  _fire_pending_burst_dmg(t: number, bm: BM): HitEvent[] {
    // 풀버스트 진입 후 버프 적용 상태에서 미뤄둔 bonus_damage 발동.
    const events: HitEvent[] = [];
    for (const [name, eff, hit_count] of this._pending_burst_dmg) {
      const cs = this.char_states[name]!;
      const buffs = bm.get_buffs(
        name, '__enemy__', t,
        get(eff, '_exclude_buffs', new Set<string>()),
      );
      buffs['is_element_match'] = cs.element_match(bm);

      let coeff = item(eff, '_coeff');
      // scaling: "stack_count" → 참조 게이지/버프의 현재 수치만큼 계수 곱산
      if (get(eff, 'scaling', null) === 'stack_count') {
        const stack = bm.ref_count(name, get(eff, 'scaling_ref', ''));
        coeff *= stack != null ? stack : 0;
      }

      if (coeff === 0.0) {
        continue;
      }

      const debug_char = get(this.config, '_debug_char', null);
      const in_debug_window = (
        debug_char === name
        && get(this.config, '_debug_t0', -1.0) <= t && t <= get(this.config, '_debug_t1', -1.0)
      );
      const ht = default_hit_type({
        is_normal_atk: false,
        is_full_burst: true,
        coeff: coeff,
        is_final_atk: true,
        _debug_factors: in_debug_window,
      });
      for (let _ = 0; _ < hit_count; _ += 1) {
        if (in_debug_window) {
          console.log(`t=${_fmt(t, 3)}s  [${_pystr(get(eff, 'name', '버스트 스킬'))}]  base_atk=${_commas(cs.base_atk)}  enemy_def=${_commas(this.enemy_def)}`);
        }
        const res = calc_damage(
          cs.base_atk, buffs, cs.weapon,
          ht, this.enemy_def,
          (get(this.config, 'rng_mode') === 'expected'),
        );
        if (in_debug_window) {
          console.log('');
        }
        events.push(new HitEvent({
          t, caster: name, damage: res['damage'],
          is_crit: res['is_crit'], hit_tag: 'bonus_damage',
          skill_name: get(eff, 'name', '버스트 스킬'),
        }));
      }
    }
    this._pending_burst_dmg.length = 0;
    return events;
  }

  // py: calculator/timeline.py:2598
  _rebuild_burst_order(bm_active_stages: Record<string, string>): void {
    // burst_order를 현재 유효 버스트 단계 기준으로 재구성한다.
    const order: Record<string, string[]> = { '1': [], '2': [], '3': [] };
    for (const name of this.slot_names) {
      if (this._burst_sequence == null && (
        name === this._no_burst_char || this._no_burst_names.has(name)
      )) {
        continue;
      }
      const _as = get(bm_active_stages, name);
      const stage = truthy(_as) ? _as : get(this._default_burst_stage, name, '');
      if (stage === 'A') {
        for (const s of ['1', '2', '3']) {
          order[s]!.push(name);
        }
      } else if (_in(stage, order)) {
        order[stage]!.push(name);
      }
    }
    this.burst_order = order;
  }

  // py: calculator/timeline.py:2617
  _check_reenter(name: string, bm: BM): string | null {
    // 버스트 사용 후 활성화된 burst_stage_override:reenterN 버프가 있으면 대상 단계 반환.
    for (const ab of bm._active) {
      if (ab.caster !== name) {
        continue;
      }
      const stat: string = abStat(ab, '');
      if (stat.startsWith('burst_stage_override:reenter')) {
        return stat.split('reenter')[1]!;
      }
    }
    return null;
  }

  // py: calculator/timeline.py:2627
  _cast_burst(name: string, stage: string, t: number, bm: BM, state: Dict): HitEvent[] {
    // 버스트 스킬 사용. buff notify + instant 처리 + damage 계산.
    const events: HitEvent[] = [];
    setdefault<Dict>(state, 'burst_casted', {})[name] = true;

    // 개별 버스트 쿨타임 갱신 (burst_cooldown buff 차감 반영)
    let cd = get(this._burst_cd, name, 40.0);
    const buffs = bm.get_buffs(name, '__enemy__', t);
    const cd_buff = get(buffs, 'burst_cooldown', 0.0);
    this._cd_applied_at_cast[name] = cd_buff;
    cd = _pymax(0.0, cd - cd_buff);
    // 핵: 충전이 없다는 말은 게이지뿐 아니라 **버스트 쿨도 없다**는 뜻이다.
    if (this.cheats.burst_charge) {
      cd = 0.0;
    }
    this.burst_ready_at[name] = t + cd;

    bm.notify('burst_cast', t, name);
    bm.notify(`squad_burst_cast:${stage}`, t, name);
    // "아군이 버스트 스킬 사용 시"는 스쿼드원 각자의 리스너에 전달되는 사건이다.
    for (const owner of this.squad_names) {
      bm.notify('event:ally_burst_cast', t, owner);
    }

    const is_reenter = this._phase.startsWith('reenter:');
    const event_label = is_reenter ? `reenter:${stage} 사용` : `stage:${stage} 사용`;
    if (this._log !== null) {
      this._log.burst_log.push(new BurstLogEntry({ t, event: event_label, caster: name }));
    }

    // 3단계 버스트 발동자를 기록 (fullburst_duration 귀속용)
    if (stage === '3') {
      this._fb_caster = name;
    }

    // 스킬3의 instant/damage 타입은 모두 위 bm.notify("burst_cast") 경로에서 처리된다

    return events;
  }
}

// py: calculator/timeline.py:2669
export function _later_burst_cast_buffs(bm: BM, caster: string, eff: Dict): Set<string> {
  // `eff`보다 **뒤에** 서술된 같은 `burst_cast` 트리거 buff들의 이름.
  const effs: Dict[] = bm.char_effects(caster);
  // name + source + stat로 위치를 되짚는다 (name은 캐릭터 내 사실상 유일).
  const key = [get(eff, 'name', null), get(eff, 'source', null), get(eff, 'stat', null)];
  let i = 0;
  let found = false;
  for (i = 0; i < effs.length; i += 1) {
    const e = effs[i]!;
    if (e === eff || (
      get(e, 'name', null) === key[0]
      && get(e, 'source', null) === key[1]
      && get(e, 'stat', null) === key[2])) {
      found = true;
      break;
    }
  }
  if (!found) {
    return new Set();
  }
  const later = new Set<string>();
  for (const e of effs.slice(i + 1)) {
    if (get(e, 'type', null) !== 'buff') {
      continue;
    }
    if (!_in('burst_cast', get(get(e, 'trigger', {}), 'timing', []))) {
      continue;
    }
    const nm = get(e, 'name');
    if (truthy(nm)) {
      later.add(nm);
    }
  }
  return later;
}

// ── instant 핸들러 등록 ────────────────────────────────────────────────────

// py: calculator/timeline.py:2702
export function _register_instant_handlers(bm: BM, char_states: Record<string, CharState>, burst_ctrl: BurstController): void {
  // BuffManager에 타임라인 전용 instant stat 핸들러를 등록한다.

  // py: calculator/timeline.py:2705
  function _resolve_targets(eff: Dict, caster: string): string[] {
    // target 필드를 캐릭터명 목록으로 변환 (아군 only). 매칭 아군이 없으면 무발동.
    const target = get(eff, 'target', 'self');
    const names: string[] = bm._resolve_target(target, caster);
    const allies = names.filter((n) => has(char_states, n));
    return allies;
  }

  // py: calculator/timeline.py:2720
  function _effective_max_ammo(cs: CharState, t: number): number {
    // 재장전이 채우는 최대치와 같은 값이어야 한다.
    return cs._full_ammo(bm, t);
  }

  // py: calculator/timeline.py:2725
  function _cancel_reload_if_full(cs: CharState, t: number, max_ammo: number): void {
    // 탄충 취소 컨트롤 — 재장전 중에 탄창이 꽉 차면 재장전을 끊고 바로 쏜다.
    if (cs.reload_cancel_on_full && cs.reloading_until > 0
        && cs.ammo >= max_ammo) {
      cs._cancel_reload(t, bm);
    }
  }

  // py: calculator/timeline.py:2732
  function handle_ammo_charge_pct(eff: Dict, caster: string, t: number, val: number): void {
    const target_names = _resolve_targets(eff, caster);
    for (const name of target_names) {
      const cs = get(char_states, name) as CharState | undefined;
      if (cs == null) {
        continue;
      }
      const max_ammo = _effective_max_ammo(cs, t);
      const charge = round(max_ammo * (val / 100.0));
      cs.ammo = _pymin(cs.ammo + charge, max_ammo);
      if (cs._sim_log !== null) {
        cs._sim_log.ammo_log.push(new AmmoLogEntry({ t, caster: name, ammo: cs.ammo }));
      }
      _cancel_reload_if_full(cs, t, max_ammo);
    }
    // 이 instant 효과 발동을 이벤트로 전파 (예: 급조 탄환 → 임시 개조 트리거)
    const eff_name = get(eff, 'name', '');
    if (truthy(eff_name)) {
      bm.notify(`event:${_pystr(eff_name)}`, t, caster);
    }
  }

  // py: calculator/timeline.py:2749
  function handle_ammo_charge_flat(eff: Dict, caster: string, t: number, val: number): void {
    const target_names = _resolve_targets(eff, caster);
    for (const name of target_names) {
      const cs = get(char_states, name) as CharState | undefined;
      if (cs == null) {
        continue;
      }
      const max_ammo = _effective_max_ammo(cs, t);
      cs.ammo = _pymin(cs.ammo + int(val), max_ammo);
      if (cs._sim_log !== null) {
        cs._sim_log.ammo_log.push(new AmmoLogEntry({ t, caster: name, ammo: cs.ammo }));
      }
      _cancel_reload_if_full(cs, t, max_ammo);
    }
  }

  // py: calculator/timeline.py:2761
  function handle_burst_charge_pct(eff: Dict, caster: string, t: number, val: number): void {
    // 「버스트 게이지 충전 N%」. **target: all_allies여도 1회만 더한다.**
    if (!truthy(_resolve_targets(eff, caster))) {
      return;
    }
    bm.add_burst_gauge(val, t, caster, `charge_pct:${_pystr(get(eff, 'name', ''))}`);
  }

  // py: calculator/timeline.py:2770
  function handle_burst_cooldown_reduce(eff: Dict, caster: string, t: number, val: number): void {
    const target_names = _resolve_targets(eff, caster);
    for (const name of target_names) {
      burst_ctrl.burst_ready_at[name] = _pymax(t, get(burst_ctrl.burst_ready_at, name, 0.0) - val);
    }
  }

  // py: calculator/timeline.py:2775
  function handle_heal_hp_pct(eff: Dict, caster: string, t: number, val: number): void {
    const target_names = _resolve_targets(eff, caster);
    const hp = item(bm.state, 'hp');
    for (const name of target_names) {
      const base_hp = get(get(item(bm.state, 'base_stats'), name, {}), 'hp', 0.0);
      const max_hp = bm.effective_max_hp(name);
      let heal_base: number;
      if (get(eff, 'scaling', null) === 'max_hp') {
        heal_base = max_hp;
      } else if (get(eff, 'scaling', null) === 'caster_max_hp') {
        heal_base = bm.effective_max_hp(caster);
      } else {
        heal_base = base_hp;
      }
      hp[name] = _pymin(get(hp, name, base_hp) + heal_base * val / 100.0, max_hp);
      bm.sync_hp(name);
      bm.notify('event:heal_received', t, name);
    }
  }

  // py: calculator/timeline.py:2791
  function handle_current_hp_reduce(eff: Dict, caster: string, _t: number, val: number): void {
    // `[현재 체력 N% ▼]`은 *현재* 체력의 N%다. 곱연산이라 체력은 0에 수렴할 뿐 0이 되지 않는다.
    const target_names = _resolve_targets(eff, caster);
    const hp = item(bm.state, 'hp');
    for (const name of target_names) {
      const base_hp = get(get(item(bm.state, 'base_stats'), name, {}), 'hp', 0.0);
      const cur = get(hp, name, base_hp);
      hp[name] = _pymax(cur * (1.0 - val / 100.0), 0.0);
      bm.sync_hp(name);
    }
  }

  // py: calculator/timeline.py:2802
  function handle_cover_heal_pct(eff: Dict, caster: string, t: number, _val: number): void {
    // "엄폐물 체력 회복 시" 후속 효과는 회복 instant가 적용된 대상 기준으로 같은 프레임에 발동해야 한다.
    for (const name of _resolve_targets(eff, caster)) {
      bm.notify('event:cover_healed', t, name);
    }
  }

  // py: calculator/timeline.py:2808
  function handle_shield_heal_from_caster_max_hp_pct(eff: Dict, caster: string, _t: number, val: number): void {
    const amount = bm.effective_max_hp(caster) * val / 100.0;
    for (const name of _resolve_targets(eff, caster)) {
      bm.heal_shield(name, amount);
    }
  }

  // py: calculator/timeline.py:2813
  function handle_force_reload(eff: Dict, caster: string, t: number, _val: number): void {
    const target_names = _resolve_targets(eff, caster);
    for (const name of target_names) {
      const cs = get(char_states, name) as CharState | undefined;
      if (cs == null || cs.reloading_until > 0) {
        continue;
      }
      cs.ammo = 0;
      cs._start_reload(t, bm);
    }
  }

  bm.register_instant_handler('ammo_charge_pct', handle_ammo_charge_pct);
  bm.register_instant_handler('ammo_charge_flat', handle_ammo_charge_flat);
  bm.register_instant_handler('burst_cooldown_reduce', handle_burst_cooldown_reduce);
  bm.register_instant_handler('burst_charge_pct', handle_burst_charge_pct);
  bm.register_instant_handler('heal_hp_pct', handle_heal_hp_pct);
  bm.register_instant_handler('current_hp_reduce', handle_current_hp_reduce);
  bm.register_instant_handler('cover_heal_pct', handle_cover_heal_pct);
  bm.register_instant_handler('shield_heal_from_caster_max_hp_pct', handle_shield_heal_from_caster_max_hp_pct);
  bm.register_instant_handler('force_reload', handle_force_reload);
}

// ── simulate ──────────────────────────────────────────────────────────────

// py: calculator/timeline.py:2835
export function _check_names(names: string[], allow_unparsed: boolean): void {
  // 스쿼드 이름을 정본 JSON 두 곳과 대조한다 (context/ALIASES.md).
  const unknown = names.filter((n) => !has(_NIKKE(), n));
  if (truthy(unknown)) {
    throw ValueError(
      `parsed_nikke.json에 없는 캐릭터: ${_repr(unknown)}\n`
      + '  정식 명칭을 써야 한다. 별칭 표: context/ALIASES.md',
    );
  }
  if (allow_unparsed) {
    return;
  }
  const unparsed = names.filter((n) => !has(_PARSED_SKILLS(), n));
  if (truthy(unparsed)) {
    throw ValueError(
      `스킬이 파싱되지 않은 캐릭터: ${_repr(unparsed)}\n`
      + '  이대로 돌리면 스킬 0개로 계산되어 결과가 조용히 틀린다.\n'
      + '  ① 별칭을 쓴 것은 아닌지 확인 — `마스트` → `마스트 : 로망틱 메이드` (context/ALIASES.md)\n'
      + '  ② 파싱 전 신규 캐릭터를 의도적으로 돌리는 것이라면 '
      + "config['allow_unparsed']=True (CLI: --allow-unparsed)",
    );
  }
}

// py: calculator/timeline.py:2862
export function _is_charge_nikke(name: string): boolean {
  // 풀차지 게이지 배율을 받을 수 있는 니케인가 (SR·RL). 카메라 유도 판정용.
  return _pick('full_charge_mult',
    [get(item(_DELAYS(), '_exceptions'), name), get(_NIKKE(), name)]) != null;
}

// py: calculator/timeline.py:2868
export function _burst_charge_carriers(squad: Dict[]): string[] {
  // 버충 톡톡이(`tap_fire.policy = "burst_charge"`)를 켠 니케들.
  const out: string[] = [];
  for (const c of squad) {
    const tap = or(get(or(get(c, 'control'), {}), 'tap_fire'), {});
    if (truthy(tap) && get(tap, 'policy', null) === 'burst_charge') {
      out.push(item(c, 'name'));
    }
  }
  return out;
}

// py: calculator/timeline.py:2878
export function _resolve_cameras(squad: Dict[], cfg: Dict): Set<string> {
  // 카메라를 받은 니케 집합. 풀차지 게이지 배율이 붙는 대상이다.
  const mode: any = get(cfg, 'camera_mode', 'single');
  if (!(mode === 'single' || mode === 'shared')) {
    throw ValueError(
      `camera_mode는 "single" 또는 "shared"여야 한다: ${_repr(mode)}. context/CONTROL.md §카메라`);
  }

  const carriers = _burst_charge_carriers(squad);
  if (carriers.length > 1) {
    throw ValueError(
      `버충 톡톡이는 한 명만 켤 수 있다 (카메라를 나눠 가질 수 없다): ${_repr(carriers)}. `
      + 'context/CONTROL.md §톡톡이');
  }
  if (truthy(carriers)) {
    return new Set(carriers);
  }

  const named = get(cfg, 'camera');
  if (named != null) {
    let names: any[];
    if (typeof named === 'string') {
      names = [named];
    } else if (Array.isArray(named) || named instanceof Set) {
      names = [...named];
    } else {
      names = Object.keys(named);
    }
    names = names.filter((n) => truthy(n));
    if (mode === 'single' && names.length > 1) {
      throw ValueError(
        `camera_mode="single"에는 카메라를 한 명만 줄 수 있다: ${_repr(names)}. `
        + '여러 명을 보려면 camera_mode="shared". context/CONTROL.md §카메라');
    }
    return new Set(names);
  }

  const controlled: string[] = squad.filter((c) => truthy(get(c, 'control'))).map((c) => item(c, 'name'));
  if (mode === 'shared' && truthy(controlled)) {
    return new Set(controlled);
  }
  if (controlled.length === 1 && _is_charge_nikke(controlled[0]!)) {
    return new Set(controlled);
  }
  // 기본 카메라는 실제 편성 3번 자리(전투 시작 카메라 위치) — 사이트가 3번 자리에 카메라를 표시한다.
  const slots: string[] = [...(or(get(cfg, '_slot_order'), squad.map((c) => item(c, 'name'))) as string[])];
  if (slots.length >= 3) {
    return new Set([slots[2]!]);
  }
  return slots.length > 0 ? new Set([slots[0]!]) : new Set();
}

// py: calculator/timeline.py:2926
export function simulate(
  squad: Dict[],
  config: Dict | null = null,
  enemy: Dict | null = null,
  verbose = false,
  seed: number | null = null,
): SimResult {
  // 스쿼드 전투 시뮬레이션 (1~5인).
  //   seed : 난수 시드. None이면 시드를 건드리지 않는다. 정수를 주면 결과가 완전히 결정론적이 된다.
  //   난수를 아예 없애고 싶으면 `config={"rng_mode": "expected"}`.
  if (seed != null) {
    random.seed(seed);
  }

  const cfg: Dict = { ...DEFAULT_CONFIG, ...or(config, {}) };
  const enm: Dict = { ...DEFAULT_ENEMY, ...or(enemy, {}) };
  const core_px = item(enm, 'core_px');
  const core_windows: Array<[number, number]> = (or(get(enm, 'core_windows'), []) as any[]).map(
    ([a, b]: any[]) => [float(a), float(b)] as [number, number]);
  const optimal_range_weapons = item(enm, 'optimal_range_weapons');
  const optimal_range_windows: Dict[] = normalize_optimal_range_windows(get(enm, 'optimal_range_windows', null));

  // py: calculator/timeline.py:2962
  function _update_optimal_range(t: number): void {
    const frame_t = round(t, 9);
    const active = optimal_range_windows.filter((w) => w['from'] <= frame_t && frame_t < w['to']);
    if (truthy(active)) {
      const _s = new Set<string>();
      for (const w of active) for (const weapon of w['weapons']) _s.add(weapon);
      enm['optimal_range_weapons'] = _s;
    } else {
      enm['optimal_range_weapons'] = optimal_range_weapons;
    }
  }

  _update_optimal_range(0.0);

  // py: calculator/timeline.py:2972
  function _update_core_exposure(t: number): void {
    // DT 누적으로 30초가 29.999999999…가 되어 경계가 한 프레임 밀리지 않게 한다.
    const frame_t = round(t, 9);
    enm['core_px'] = (!truthy(core_windows) || core_windows.some(
      ([lo, hi]) => lo <= frame_t && frame_t < hi,
    )) ? core_px : 0;
  }

  _update_core_exposure(0.0);
  const duration = item(cfg, 'duration');

  if (!(cfg['rng_mode'] === 'random' || cfg['rng_mode'] === 'expected')) {
    throw ValueError(`rng_mode는 "random" 또는 "expected"여야 한다: ${_repr(cfg['rng_mode'])}`);
  }

  squad = squad.map((c) => ({ ...DEFAULT_CHAR, ...c }));
  _check_names(squad.map((c) => item(c, 'name')), truthy(item(cfg, 'allow_unparsed')));
  // 편성 자리와 무관한 결과(2026-09-23). 처리 순서는 이름순, 실제 자리는 자리를 보는 스킬만 쓴다.
  // py: calculator/timeline.py — slot_order / sorted(squad, key=name)
  const slot_order: string[] = squad.map((c) => item(c, 'name') as string);
  squad = sorted(squad, (c: Dict) => item(c, 'name') as string);

  if (!(cfg['burst_gauge_mode'] === 'fixed' || cfg['burst_gauge_mode'] === 'accumulate')) {
    throw ValueError(
      `burst_gauge_mode는 "fixed" 또는 "accumulate"여야 한다: ${_repr(cfg['burst_gauge_mode'])}`);
  }
  cfg['_slot_order'] = slot_order;
  cfg['_camera'] = _resolve_cameras(squad, cfg);

  const base_stats: Record<string, Dict> = {};
  for (const c of squad) base_stats[item(c, 'name')] = calc_base_stats(c);

  const _per = (f: (c: Dict) => any): Dict => {
    const o: Dict = {};
    for (const c of squad) o[item(c, 'name')] = f(c);
    return o;
  };
  const state: Dict = {
    full_burst: false,
    // 장전컨(context/CONTROL.md)용 풀버스트 사이클 정보. BurstController가 갱신
    full_burst_end_t: -1.0, // 현재 풀버스트 종료 시각 (진입 시 확정)
    next_fb_start_pred: -1.0, // 다음 풀버스트 시작 예측 (직전 사이클 주기 기준)
    burst_casted: _per(() => false),
    hp_pct: _per(() => 100.0),
    hp: _per((c) => float(item(item(base_stats, item(c, 'name')), 'hp'))),
    base_stats: base_stats,
    // 기대값 모드에서 확률 이벤트를 소수 누적 발화시키는 잔여분. 키: (이벤트명, 캐릭터명) → 누적값
    rng_acc: {},
    // 기대값 모드 여부.
    rng_expected: get(cfg, 'rng_mode') === 'expected',
    stacks: _per(() => ({})),
    gauges: _per(() => ({})),
    burst_stages: _per((c) => item(item(_NIKKE(), item(c, 'name')), 'burst_stage')),
    enemy: enm,
    // 버스트 게이지 — **스쿼드 공용 1개**다. 만충 100, 초과분은 버려진다.
    burst_gauge: 0.0,
    // 일반 공격을 1회라도 명중시킨 니케들.
    normal_attack_landed: new Set<string>(),
    // 지금이 충전 창인가. BurstController.tick()이 매 프레임 갱신한다.
    burst_gauge_charging: true,
    // 족자 구간 — 무기 사격 몫의 게이지가 안 차는 창(`CharState._weapon_gauge_lands`).
    gauge_weapon_blocked: (
      truthy(get(cfg, 'immune_blocks_burst'))
        ? (or(get(enm, 'immune_windows'), []) as any[]).map(([a, b]: any[]) => [float(a), float(b)])
        : []),
    // 카메라가 보고 있는 니케 집합(`_resolve_cameras()`).
    camera: cfg['_camera'],
    // 실제 편성 자리(1번부터). 후열 조건·양옆 아군 대상만 본다.
    slot_order: slot_order,
  };

  const enemy_code = get(enm, 'code', '');

  const char_states: Record<string, CharState> = {};
  for (const c of squad) {
    char_states[item(c, 'name')] = new CharState(c, float(item(item(base_stats, item(c, 'name')), 'atk')), enemy_code);
  }

  const bm: BM = new BuffManager(squad, state);
  // 핵(`calculator/cheats.py`). 켜져 있으면 get_buffs가 내는 표마다 얹힌다.
  bm.cheats = cheats_from_config(cfg);
  const burst_ctrl = new BurstController(squad, cfg, char_states, enm);
  _register_instant_handlers(bm, char_states, burst_ctrl);

  const sim_log: SimLog | null = verbose ? new SimLog({}) : null;
  burst_ctrl._log = sim_log;
  for (const cs of Object.values(char_states)) {
    cs._sim_log = sim_log;
  }
  const result = new SimResult({ duration, log: sim_log });
  result.char_total = _per(() => 0);

  // 도로시 `낙인` 계열: 유지 시간 동안 스쿼드가 실제로 입힌 대미지를 모아 두었다가
  // 만료 시 적 전체 분배 대미지로 방출한다. ActiveBuff 인스턴스를 키로 삼는다(`id(ab)` → 객체 키).
  const damage_accumulators = new Map<object, Dict>();

  // `_active`를 마지막으로 훑은 버전. 그대로면 다시 훑지 않는다.
  let _acc_scan_version = -1;

  // py: calculator/timeline.py:3057
  function _sync_damage_accumulators(t: number): void {
    // 새로 붙은 «대미지 누적» 버프를 훑어 등록한다. 버전이 그대로면 건너뛴다.
    if (bm._cache_version === _acc_scan_version) {
      return;
    }
    _acc_scan_version = bm._cache_version;
    for (const ab of bm._active) {
      const eff = ab.effect;
      if (get(eff, 'stat', null) !== 'damage_accumulate' || damage_accumulators.has(ab)) {
        continue;
      }
      const caster = ab.caster;
      const cs = get(char_states, caster) as CharState | undefined;
      if (cs == null) {
        continue;
      }
      const val = or(bm._get_value(eff, ab, caster), 0.0);
      const buffs = bm.get_buffs(caster, '__enemy__', t);
      const final_atk = cs.base_atk * (1.0 + get(buffs, 'atk_pct', 0.0) / 100.0) + get(buffs, 'atk_flat', 0.0);
      damage_accumulators.set(ab, {
        caster: caster, expires: ab.expires_at, damage: 0.0,
        cap: _pymax(0.0, final_atk * val / 100.0), effect: eff,
        ratio: _pymax(0.0, float(get(eff, 'accumulate_ratio_pct', 100.0))
          * (1.0 + get(buffs, 'damage_accumulate_ratio_pct', 0.0) / 100.0)),
      });
    }
  }

  // py: calculator/timeline.py:3087
  function _accumulate_damage(events: HitEvent[], t: number): void {
    _sync_damage_accumulators(t);
    const total = sum(events.map((ev) => ev.damage));
    if (total <= 0.0) {
      return;
    }
    for (const acc of damage_accumulators.values()) {
      if (t < acc['expires']) {
        acc['damage'] = _pymin(
          acc['cap'], acc['damage'] + total * acc['ratio'] / 100.0,
        );
      }
    }
  }

  // py: calculator/timeline.py:3098
  function _release_damage_accumulators(t: number): HitEvent[] {
    const released: HitEvent[] = [];
    for (const [key, acc] of [...damage_accumulators.entries()]) {
      if (t < acc['expires']) {
        continue;
      }
      if (acc['damage'] > 0.0) {
        released.push(new HitEvent({
          t, caster: acc['caster'], damage: acc['damage'], is_crit: false,
          hit_tag: get(acc['effect'], 'release_stat', 'split_damage'),
          skill_name: get(acc['effect'], 'name', 'damage_accumulate'),
        }));
      }
      damage_accumulators.delete(key);
    }
    return released;
  }

  // damage 핸들러: bm.tick()/_activate()에서 호출되는 damage 효과를 처리
  const _dot_events: HitEvent[] = [];

  // py: calculator/timeline.py:3115
  function _handle_damage_eff(eff: Dict, caster: string, t: number): void {
    if (get(eff, 'target', null) === 'all_projectiles') {
      return;
    }
    const cs = get(char_states, caster) as CharState | undefined;
    if (cs == null) {
      return;
    }
    const skill_lv = _get_skill_lv(cs.char, eff);
    let coeff: number;
    if (has(eff, 'values')) {
      const vals = eff['values'];
      coeff = float(get(vals, skill_lv, get(vals, '10', 0.0)));
    } else if (has(eff, 'fixed_value')) {
      coeff = float(eff['fixed_value']);
    } else {
      coeff = 0.0;
    }

    // scaling:stack_count + dot_damage → 틱당 계수에 현재 스택 수를 곱함
    if (get(eff, 'scaling', null) === 'stack_count' && (get(eff, 'stat', '') as string).startsWith('dot_damage')) {
      const ref = get(eff, 'scaling_ref', '');
      // 자신의 _active 엔트리에 캡처된 stack 값을 먼저 확인
      let scale: any = null;
      const eff_name = get(eff, 'name', '');
      for (const ab of bm._active) {
        if (ab.caster === caster && get(ab.effect, 'name', null) === eff_name) {
          scale = ab.stack;
          break;
        }
      }
      if (scale == null) {
        // 자기 엔트리가 없을 때만 참조 게이지/버프를 본다
        scale = bm.ref_count(caster, ref);
      }
      coeff *= scale != null ? scale : 0;
    }

    if (coeff === 0.0) {
      return;
    }

    // dmg_scale_mag_pct: target_effect가 이 효과를 참조하는 버프의 배율 적용
    const eff_name = get(eff, 'name', '');
    if (truthy(eff_name)) {
      for (const ab of bm._active) {
        if (abStat(ab, null) === 'dmg_scale_mag_pct'
            && get(ab.effect, 'target_effect', null) === eff_name
            && ab.caster === caster
            && t < ab.expires_at) {
          const mag = bm._get_value(ab.effect, ab, caster);
          if (mag != null) {
            coeff *= (1.0 + mag / 100.0);
          }
        }
      }
    }

    const eff_with_coeff: Dict = { ...eff, _coeff: coeff };

    // bonus_damage + burst_cast → 풀버스트 시점으로 pending. 단 **3버스트 캐릭터만** 보류한다.
    let stat: string = get(eff, 'stat', '');
    const timings = get(get(eff, 'trigger', {}), 'timing', []);
    const target_field: any = get(eff, 'target', '');
    // 에밀리아 `대정령의 철퇴`: 직전 풀차지 공격이 실제로 가한 피해량의 일정 비율을 본체 고정 피해로 준다.
    if (stat === 'fixed_damage_from_dealt_pct') {
      const dealt = get(get(bm.state, 'last_normal_hit_damage', {}), caster, 0.0);
      if (dealt > 0.0) {
        _dot_events.push(new HitEvent({
          t, caster, damage: dealt * coeff / 100.0,
          is_crit: false, hit_tag: stat,
          skill_name: get(eff, 'name', stat),
        }));
      }
      return;
    }
    const is_burst3 = _pystr(get(get(_NIKKE(), caster, {}), 'burst_stage', '')) === '3';
    if (stat === 'bonus_damage' && _in('burst_cast', timings) && is_burst3) {
      // same_target:X → 짝이 되는 sequential 효과의 hit_count만큼 반복 발동
      let hit_count = 1;
      if (typeof target_field === 'string' && target_field.startsWith('same_target:')) {
        const ref_name = target_field.slice('same_target:'.length);
        for (const ref_eff of bm.char_effects(caster)) {
          if (get(ref_eff, 'name', null) !== ref_name) {
            continue;
          }
          const ref_stat: string = get(ref_eff, 'stat', '');
          const ref_parts = ref_stat.split(':');
          if (ref_parts.length > 1 && _lstrip_isdigit(ref_parts[1]!)) {
            hit_count = int(ref_parts[1]!);
          }
          break;
        }
      }
      // 원문 블록 순서 = 실행 순서: 이 딜보다 뒤에 서술된 같은 burst_cast 버프는 실리면 안 된다.
      eff_with_coeff['_exclude_buffs'] = _later_burst_cast_buffs(bm, caster, eff);
      burst_ctrl._pending_burst_dmg.push([caster, eff_with_coeff, hit_count]);
      return;
    }

    // damage_formula: "normal_attack" → is_normal_atk=True で일반 공격 버프 적용
    const is_normal = get(eff, 'damage_formula', null) === 'normal_attack';
    let buffs: Dict = bm.get_buffs(caster, '__enemy__', t);
    buffs['is_element_match'] = cs.element_match(bm);
    let damage_base_atk = cs.base_atk;
    // 최대 체력의 일부를 기존 최종 공격력에 합산한다.
    if (get(eff, 'scaling', null) === 'max_hp_additive') {
      const hp_pct = float(get(eff, 'scaling_hp_pct', 0.0));
      buffs = {
        ...buffs, atk_flat: get(buffs, 'atk_flat', 0.0)
          + bm.effective_max_hp(caster) * hp_pct / 100.0,
      };
    }
    // 킬로처럼 "최종 최대 체력 N%를 공격력으로 환산"하는 스킬은 캐릭터의 공격력과 공격력 버프를 전혀 쓰지 않는다.
    if (get(eff, 'scaling', null) === 'max_hp_conversion') {
      const hp_pct = float(get(eff, 'scaling_hp_pct', 0.0));
      damage_base_atk = bm.effective_max_hp(caster) * hp_pct / 100.0;
      buffs = { ...buffs, atk_pct: 0.0, atk_flat: 0.0 };
    }
    const is_full_burst = get(bm.state, 'full_burst', false);
    stat = get(eff, 'stat', 'damage');
    const stat_parts = stat.split(':');
    const base_stat = stat_parts[0]!;
    // hit_count 결정
    let hit_count: any = 1;
    const gauge_ref = get(eff, 'hit_count_gauge_ref');
    if (truthy(gauge_ref)) {
      hit_count = int(get(get(get(bm.state, 'gauges', {}), caster, {}), gauge_ref, 0));
    } else if (stat_parts.length > 1 && _lstrip_isdigit(stat_parts[1]!)) {
      hit_count = int(stat_parts[1]!);
    } else if (stat_parts.length > 1) {
      // "<damage_stat>:이름" 형태 — scaling 값 무관하게 게이지/스택/소환체 수 읽기
      const n = bm.ref_count(caster, stat_parts[1]);
      if (n != null) {
        hit_count = n;
      }
    } else if (get(eff, 'scaling', null) === 'stack_count' && base_stat !== 'dot_damage') {
      // damage stat + scaling:stack_count → scaling_ref 게이지/스택 수만큼 발사.
      const ref = or(get(eff, 'scaling_ref', ''), stat_parts.length > 1 ? stat_parts[1] : '');
      const n = bm.ref_count(caster, ref);
      if (n != null) {
        hit_count = n;
      }
    }
    const weapon_type = get(cs.weapon, 'weapon_type', '');
    const ht = default_hit_type({
      is_normal_atk: is_normal,
      is_full_burst: is_full_burst,
      // core_damage는 "코어 명중 대미지"가 명시된 확정 코어 히트
      is_core: (get(enm, 'core_px', 0) > 0 && is_normal) || base_stat === 'core_damage',
      is_core_damage: (base_stat === 'core_damage'),
      // 파츠 판정은 원문이 파츠를 명시한 스킬(hits_parts)에만 붙는다 — 파츠 보스일 때만
      is_part: and(truthy(get(eff, 'hits_parts')), get(enm, 'has_parts', false)),
      is_optimal_range: (_in(weapon_type, get(enm, 'optimal_range_weapons', [])) && is_normal),
      is_burst_damage: (base_stat === 'burst_damage'),
      // 대상 설명이 '적 전체에게'인 버스트 대미지 → burst_dmg_aoe_pct 수혜
      is_aoe_burst: (base_stat === 'burst_damage' && target_field === 'all_enemies'),
      is_pierce_damage: (base_stat === 'pierce_damage'),
      is_armor_break_damage: (base_stat === 'armor_break_damage'),
      is_dot: (base_stat === 'dot_damage'),
      is_projectile_explosion: (base_stat === 'projectile_explosion_damage'
        || (is_normal && cs.base_weapon_type === 'RL')),
      is_projectile_attachment: (base_stat === 'projectile_attachment_damage'),
      is_sequential: (base_stat === 'sequential_damage'),
      is_split: (base_stat === 'split_damage'),
      coeff: eff_with_coeff['_coeff'],
      is_final_atk: true,
    });
    const debug_char = get(cfg, '_debug_char', null);
    const in_debug_window = (
      debug_char === caster
      && get(cfg, '_debug_t0', -1.0) <= t && t <= get(cfg, '_debug_t1', -1.0)
    );
    ht['_debug_factors'] = in_debug_window;

    for (let _ = 0; _ < hit_count; _ += 1) {
      if (in_debug_window) {
        console.log(`t=${_fmt(t, 3)}s  [${_pystr(get(eff, 'name', stat))}]  base_atk=${_commas(damage_base_atk)}  enemy_def=${_commas(get(enm, 'def', 31784))}`);
      }
      const res = calc_damage(
        damage_base_atk, buffs, cs.weapon,
        ht, get(enm, 'def', 31784),
        (get(cfg, 'rng_mode') === 'expected'),
      );
      if (in_debug_window) {
        console.log('');
      }
      const hit_tag = is_normal ? 'normal_skill' : base_stat;
      _dot_events.push(new HitEvent({
        t, caster, damage: res['damage'],
        is_crit: res['is_crit'], hit_tag: hit_tag,
        skill_name: get(eff, 'name', stat),
      }));
      // hit_count:[스킬명] 이벤트 — named damage effect 명중마다 발생.
      // 기대값 모드에는 is_crit이 없으므로 crit_frac을 소수 누적해 같은 장기 빈도로 발화시킨다.
      if (truthy(eff_name)) {
        let hit_crit = res['is_crit'];
        if (!truthy(hit_crit) && get(cfg, 'rng_mode') === 'expected') {
          const _crit_fired: number[] = [];
          _notify_frac(bm, `skill_crit:${_pystr(eff_name)}`, caster,
            get(res, 'crit_frac', 0.0), () => { _crit_fired.push(1); });
          hit_crit = truthy(_crit_fired);
        }
        bm.notify(`hit_count:${_pystr(eff_name)}`, t, caster, { hit_crit: hit_crit });
      }
    }

    // 스킬 대미지도 무기와 **같은 히트당 값**으로 게이지를 준다. 풀차지 배율은 없다.
    const gauge_src = or(eff_name, stat);
    const gauge_be = get(get(get(_burst_gauge_exceptions(), caster, {}), gauge_src, {}), 'burst_energy');
    bm.add_burst_gauge(cs._burst_gain(buffs, hit_count, false, gauge_be), t, caster,
      `skill:${_pystr(gauge_src)}`);

    // weapon_hit:name 이벤트 발생 (hit_count:N 트리거로 발사된 발사체 명중 시)
    if (truthy(eff_name)) {
      bm.notify(`weapon_hit:${_pystr(eff_name)}`, t, caster);
    }
  }

  bm.register_damage_handler(_handle_damage_eff);

  if (sim_log !== null) {
    // py: calculator/timeline.py:3331
    const _buff_event_cb = (kind: string, name: string, caster: string, target: string, t: number,
      expires_at: number, value: number | null = null, stat: string | null = null,
      stack: number | null = null, max_stack: number | null = null): void => {
      sim_log.buff_events.push(new BuffEvent({
        t, kind, name, caster, target, expires_at,
        value, stat, stack, max_stack,
      }));
    };
    bm.register_buff_event_handler(_buff_event_cb);

    // py: calculator/timeline.py:3340
    const _instant_event_cb = (name: string, caster: string, target: string, t: number, stat: string, value: number | null): void => {
      sim_log.instant_events.push(new InstantEvent({
        t, name, caster, target, stat, value,
      }));
    };
    bm.register_instant_event_handler(_instant_event_cb);

    // py: calculator/timeline.py:3346
    const _gauge_event_cb = (t: number, caster: string, source: string, amount: number, gauge: number): void => {
      sim_log.gauge_log.push(new GaugeLogEntry({
        t, caster, source, amount, gauge,
      }));
    };
    bm.register_gauge_event_handler(_gauge_event_cb);

    // 카메라는 풀차지 **게이지** 배율에만 쓰이므로 사이클을 판정하는 모드에서만 적는다.
    if (cfg['burst_gauge_mode'] === 'accumulate') {
      const _cams = squad.filter((c) => _in(item(c, 'name'), cfg['_camera'])).map((c) => item(c, 'name') as string);
      let _who = truthy(_cams) ? _cams.join(' · ') : '없음';
      if (_cams.length > 1) {
        _who += '  [camera_mode="shared" — 비현실적 상한]';
      }
      sim_log.burst_log.push(new BurstLogEntry({
        t: 0.0, event: `카메라 초점: ${_who}`, caster: '',
      }));
    }
  }

  // py: calculator/timeline.py:3362
  function _apply_lifesteal(ev: HitEvent, bm: BM, base_stats: Dict, t: number): void {
    const buffs = bm.get_buffs(ev.caster, '__enemy__', t);
    const ls = get(buffs, 'lifesteal_pct', 0.0);
    if (ls <= 0.0) {
      return;
    }
    const heal = ev.damage * ls / 100.0;
    const hp = item(bm.state, 'hp');
    const bs = get(base_stats, ev.caster, {});
    const base_hp = float(get(bs, 'hp', 0.0));
    const max_hp = bm.effective_max_hp(ev.caster);
    hp[ev.caster] = _pymin(get(hp, ev.caster, base_hp) + heal, max_hp);
    bm.sync_hp(ev.caster);
    bm.notify('event:heal_received', t, ev.caster);
  }

  bm.battle_start(0.0);

  // battle_start 버프 적용 후 장탄을 실제 max_ammo로 초기화
  for (const cs of Object.values(char_states)) {
    cs.ammo = cs._full_ammo(bm, 0.0);
    if (sim_log !== null) {
      sim_log.ammo_log.push(new AmmoLogEntry({ t: 0.0, caster: cs.name, ammo: cs.ammo }));
    }
  }

  // 파츠 파괴 주기 (config["part_break_interval"], 초). 0/미지정이면 무발동.
  const _part_break_interval = float(or(get(cfg, 'part_break_interval', 0), 0));
  let _next_part_break = _part_break_interval > 0 ? _part_break_interval : Infinity;

  // ── 보스 페이즈 관문 (족자 · 속저) ────────────────────────────────────
  const _immune_windows: Array<[number, number]> = (or(get(enm, 'immune_windows'), []) as any[]).map(
    ([a, b]: any[]) => [float(a), float(b)] as [number, number]);
  const _element_windows: Array<[number, number, string]> = (or(get(enm, 'element_windows'), []) as any[]).map(
    (w: Dict) => [float(item(w, 'from')), float(item(w, 'to')), _pystr(item(w, 'code'))] as [number, number, string]);
  // 속저 판정은 인게임과 같이 **우월 코드 버프까지 인정한다**.
  const _roster_code: Record<string, any> = {};
  for (const c of squad) {
    _roster_code[item(c, 'name')] = get(get(_NIKKE(), item(c, 'name'), {}), 'element_code', '');
  }

  // py: calculator/timeline.py:3407
  function _beats(name: string, code: string): boolean {
    return (truthy(is_element_match(get(_roster_code, name, ''), code))
      || truthy(bm.element_override_match(name, code)));
  }

  // py: calculator/timeline.py:3411
  function _gate(events: HitEvent[], t: number): HitEvent[] {
    if (!truthy(events) || (!truthy(_immune_windows) && !truthy(_element_windows))) {
      return events;
    }
    if (_immune_windows.some(([lo, hi]) => lo <= t && t < hi)) {
      events = events.filter((ev) => !_is_normal(ev));
    }
    const blocking = _element_windows.filter(([lo, hi]) => lo <= t && t < hi).map(([, , code]) => code);
    if (!truthy(blocking)) {
      return events;
    }
    return events.filter((ev) => blocking.every((code) => _beats(ev.caster, code)));
  }

  let t = 0.0;
  while (t <= duration) {
    _update_optimal_range(t);
    _update_core_exposure(t);
    bm.tick(t);
    _sync_damage_accumulators(t);

    for (const ev of _gate(_release_damage_accumulators(t), t)) {
      result.hits.push(ev);
      result.char_total[ev.caster] = item(result.char_total, ev.caster) + ev.damage;
      _apply_lifesteal(ev, bm, base_stats, t);
    }

    if (t >= _next_part_break) {
      for (const char of squad) {
        bm.notify('event:part_destroy', t, item(char, 'name'));
      }
      _next_part_break += _part_break_interval;
    }

    // 주의: 관문이 없으면 `_gate`는 `_dot_events` 자체를 돌려준다(파이썬과 같은 별칭).
    // 아래 순회 중 라이프스틸 notify가 `_dot_events`에 덧붙이면 그것도 순회된다 — 파이썬 리스트와 같다.
    const _gated_dots = _gate(_dot_events, t);
    _accumulate_damage(_gated_dots, t);
    for (const ev of _gated_dots) {
      result.hits.push(ev);
      result.char_total[ev.caster] = item(result.char_total, ev.caster) + ev.damage;
      _apply_lifesteal(ev, bm, base_stats, t);
    }
    _dot_events.length = 0;

    let burst_events = burst_ctrl.tick(t, bm, state);
    burst_events = _gate(burst_events, t);
    _accumulate_damage(burst_events, t);
    for (const ev of burst_events) {
      result.hits.push(ev);
      result.char_total[ev.caster] = item(result.char_total, ev.caster) + ev.damage;
      _apply_lifesteal(ev, bm, base_stats, t);
    }

    for (const char of squad) {
      const name: string = item(char, 'name');
      const char_events = _gate(char_states[name]!.tick(t, bm, enm, cfg), t);
      _accumulate_damage(char_events, t);
      for (const ev of char_events) {
        result.hits.push(ev);
        result.char_total[name] = item(result.char_total, name) + ev.damage;
        _apply_lifesteal(ev, bm, base_stats, t);
      }
    }

    t += DT;
  }

  // 마지막 프레임에 쌓인 몫을 한 번 더 수거한다.
  if (truthy(_dot_events)) {
    const _g = _gate(_dot_events, t);
    if (_g !== _dot_events) {
      _dot_events.splice(0, _dot_events.length, ..._g);
    }
    _accumulate_damage(_dot_events, t);
    for (const ev of _dot_events) {
      result.hits.push(ev);
      result.char_total[ev.caster] = item(result.char_total, ev.caster) + ev.damage;
      _apply_lifesteal(ev, bm, base_stats, t);
    }
    _dot_events.length = 0;
  }

  const _shotgun_stats: Dict = {};
  for (const [name, cs] of Object.entries(char_states)) {
    if (truthy(cs.shotgun_stats)) {
      const _o: Dict = {};
      for (const [k, v] of Object.entries(cs.shotgun_stats)) _o[k] = round(v as number, 4);
      _shotgun_stats[name] = _o;
    }
  }
  result.shotgun_stats = _shotgun_stats;
  const _shotgun_report: Dict = {};
  for (const [name, cs] of Object.entries(char_states)) {
    if (cs._shotgun_heatmap !== null) {
      _shotgun_report[name] = cs._shotgun_heatmap.finish();
    }
  }
  result.shotgun_report = _shotgun_report;
  result.squad_total = sum(Object.values(result.char_total) as number[]);
  // `list.sort(key=lambda e: e.t)` — JS `Array.prototype.sort`도 안정 정렬이라 결과가 같다
  // (히트가 수십만 개라 `splice(..., ...sorted())`의 인자 전개는 스택을 넘칠 수 있다).
  result.hits.sort((a: HitEvent, b: HitEvent) => cmp(a.t, b.t));

  return result;
}
