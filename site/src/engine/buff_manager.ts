/**
 * Phase 3-C: 버프 관리자 — calculator/buff_manager.py 직역.
 *
 * 설계:
 *   - 효과 등록(parsed_skills, 장비, 큐브, 소장품) → 통일된 effect 포맷
 *   - notify(event, t, caster) → timing 매칭 시 ActiveBuff 생성/갱신
 *   - tick(t) → 만료 버프 제거, every:Ns 스킬 쿨타임 추적
 *   - get_buffs(caster, target, t) → condition 재평가 후 buffs 딕셔너리 반환
 *
 * 버프 합산 규칙:
 *   - 대부분 stat: 단순 합산
 *   - crit_rate: 기본 15% + 버프 합연산, 100% 상한
 *
 * ── 이식 메모 ──
 * - 파이썬 모듈 수준 데이터(`_NIKKE`·`_PARSED_SKILLS`·`_EQUIP_SKILLS`·`_CUBE`·`_COLLECTION`)는 import 시점에
 *   읽지 않고 **같은 이름의 함수**(`_NIKKE()` …)로 `data()`에서 꺼낸다.
 * - `BURST_GAUGE_EXCEPTIONS`는 `data().burst_gauge._exceptions`를 **조회할 때마다** 따라가는 Proxy다.
 *   `BURST_GAUGE_EXCEPTIONS[c]` · `get(BURST_GAUGE_EXCEPTIONS, c, {})` · `has(...)` · `Object.keys(...)`가
 *   그대로 동작하고, 함수처럼 `BURST_GAUGE_EXCEPTIONS()`로 불러도 현재 사전을 돌려준다.
 *   (데이터가 나중에 들어오거나 다시 들어와도 늘 현재 값을 본다.)
 * - `id(eff)`를 키로 쓰던 사전(`_next_fire`·`_dot_timers`·`_instant_timers`·`_trigger_counts`·`_eff_by_id`)은
 *   효과 객체 자체를 키로 하는 `Map`이다. 튜플 키 안에 `id(eff)`가 들어가는 곳(`_quant_group_key`,
 *   `rng_acc` 키)은 객체마다 고정된 정수를 주는 `pyid()`를 쓴다.
 * - 튜플 키 사전(`_buffs_cache`·`_plan_cache`·`_lazy_target_cache` …)은 문자열로 직렬화한 키의 `Map`이다.
 */

import { at_least } from './pellet_accuracy';
import { NO_ITEM } from './base_stat';
import { NO_CHEATS, Cheats } from './cheats';
import { data } from './data';
import {
  float, get as pyget, has, int, item, KeyError, minBy, or, pop, PyError, pymod, random, reprFloat,
  round, setdefault, sorted, sum, truthy, ValueError,
  tupleKey,
} from './py';

/**
 * `d.get(k, default)` — py.ts의 `get`과 같다. 동적 자료라 결과를 `any`로 받고, 키가 None일 수 있는 곳
 * (`per_char_stacks.get(query_caster)` 등)도 그대로 받는다(None 키는 어떤 사전에도 없다).
 */
function get(d: any, key: any, dflt?: any): any {
  if (key == null) return dflt;
  return pyget(d, key, dflt);
}

type Eff = Record<string, any>;
type Dict = Record<string, any>;

// ── 파이썬 의미 보조 (이 모듈 전용) ─────────────────────────────────────────

/** 파이썬 `s.split(sep, maxsplit)` — JS의 limit과 달리 나머지를 마지막 조각에 남긴다. */
function pysplit(s: string, sep: string, maxsplit: number = -1): string[] {
  const parts = s.split(sep);
  if (maxsplit < 0 || parts.length <= maxsplit + 1) return parts;
  const head = parts.slice(0, maxsplit);
  head.push(parts.slice(maxsplit).join(sep));
  return head;
}

/** 파이썬 `str.isdigit()` (ASCII 숫자). 빈 문자열은 거짓. */
function isdigit(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

/** 파이썬 `s.lstrip("-")`. */
function lstripDash(s: string): string {
  return s.replace(/^-+/, '');
}

/** 파이썬 두 인자 `max(a, b)` — 같으면(또는 비교 불가면) 첫 인자. */
function pmax(a: number, b: number): number {
  return b > a ? b : a;
}

/** 파이썬 두 인자 `min(a, b)` — 같으면(또는 비교 불가면) 첫 인자. */
function pmin(a: number, b: number): number {
  return b < a ? b : a;
}

/** 파이썬 리스트 `==` (문자열 리스트 / None). */
function listEq(a: any[] | null | undefined, b: any[] | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** 파이썬 `id(obj)` 대용 — 객체마다 고정된 정수(키 직렬화용). */
const _PYID = new WeakMap<object, number>();
let _PYID_SEQ = 0;
function pyid(obj: object | null | undefined): number {
  if (obj == null) return 0;  // id(None)
  let v = _PYID.get(obj);
  if (v === undefined) {
    _PYID_SEQ += 1;
    v = _PYID_SEQ;
    _PYID.set(obj, v);
  }
  return v;
}


/** 파이썬 `x in container` — set/list/dict(Map·객체) 모두. */
function inContainer(c: any, x: any): boolean {
  if (c == null) return false;
  if (c instanceof Set || c instanceof Map) return c.has(x);
  if (Array.isArray(c)) return c.includes(x);
  if (typeof c === 'string') return typeof x === 'string' && c.includes(x);
  if (typeof c === 'object') return has(c, x);
  return false;
}

/** `rng_acc` 같은 공유 누적 사전 읽기 — 타임라인이 Map으로 만들었든 객체로 만들었든 받는다. */
function accGet(acc: any, key: string, dflt: number): number {
  if (acc instanceof Map) return acc.has(key) ? acc.get(key) : dflt;
  return get(acc, key, dflt);
}
function accSet(acc: any, key: string, v: number): void {
  if (acc instanceof Map) acc.set(key, v);
  else acc[key] = v;
}

/** 파이썬 `str(x)` — JSON 성질 값. (정수값 float은 구분할 수 없어 정수로 쓴다) */
function pystr(x: any): string {
  if (x === null || x === undefined) return 'None';
  if (x === true) return 'True';
  if (x === false) return 'False';
  return String(x);
}

/** 파이썬 `repr(x)` — 문자열이면 따옴표. */
function pyrepr(x: any): string {
  if (typeof x === 'string') return `'${x}'`;
  return pystr(x);
}

/** 파이썬 `list.index(x)` — 없으면 ValueError. */
function listIndex(xs: any[], x: any): number {
  const i = xs.indexOf(x);
  if (i < 0) throw ValueError(`${pyrepr(x)} is not in list`);
  return i;
}

/** 파이썬 `xs[i]` (음수 색인 포함, 범위 밖이면 IndexError). */
function at(xs: any[], i: number): any {
  const j = i < 0 ? xs.length + i : i;
  if (j < 0 || j >= xs.length) throw new PyError('IndexError', 'list index out of range');
  return xs[j];
}

/** 파이썬 `a, b, c = xs` — 개수가 다르면 ValueError. */
function unpack(xs: string[], n: number): string[] {
  if (xs.length !== n) {
    throw ValueError(xs.length > n
      ? `too many values to unpack (expected ${n})`
      : `not enough values to unpack (expected ${n}, got ${xs.length})`);
  }
  return xs;
}

/** 파이썬 `xs[:n]` — JS `slice(0, n)`은 음수 n도 파이썬과 같게 자른다. */
function pyslice<T>(xs: T[], n: number): T[] {
  return xs.slice(0, n);
}

/** frozenset[str] → 캐시 키 문자열(순서 무관). */
function frozenKey(s: ReadonlySet<string>): string {
  if (s.size === 0) return '';
  return JSON.stringify([...s].sort());
}

const EMPTY_FROZENSET: ReadonlySet<string> = new Set<string>();

function toFrozenSet(x: Iterable<string> | null | undefined): ReadonlySet<string> {
  if (x == null) return EMPTY_FROZENSET;
  if (x instanceof Set) return x;
  return new Set(x);
}

// ── 데이터 (import 시점에 읽지 않는다) ──────────────────────────────────────

// hp_pct 100% 도달 판정 허용 오차 (부동소수점 나눗셈 오차 흡수)
const _HP_EPS = 1e-6;

// py: calculator/buff_manager.py:41
/** eff의 source(스킬1/2/3)에 맞는 스킬 레벨 반환. skill_levels 없으면 skill_level fallback. */
export function _get_skill_lv(char: Dict, eff: Eff): string {
  const levels = get(char, 'skill_levels');
  // 비었는지 보려고 사전을 훑는 것은 비싸다 — 흔한 키가 하나라도 있으면 비지 않은 것이다.
  if (levels != null && typeof levels === 'object' && !Array.isArray(levels)
    ? (levels['1'] !== undefined || levels['2'] !== undefined || levels['3'] !== undefined || truthy(levels))
    : truthy(levels)) {
    const src = get(eff, 'source', '');
    if (src === '스킬1') {
      return pystr(get(levels, '1', 10));
    }
    if (src === '스킬2') {
      return pystr(get(levels, '2', 10));
    }
    if (src === '스킬3') {
      return pystr(get(levels, '3', 10));
    }
  }
  return pystr(get(char, 'skill_level', 10));
}

// py: calculator/buff_manager.py:55
/** `parsed_nikke.json` (파이썬 모듈 전역 `_NIKKE`). */
export function _NIKKE(): Record<string, any> {
  return data().parsed_nikke;
}

// py: calculator/buff_manager.py:58
/** `burst_gauge.json` (파이썬 `_BURST_GAUGE`). */
function _BURST_GAUGE(): Record<string, any> {
  return data().burst_gauge;
}

// py: calculator/buff_manager.py:59
/**
 * 버스트 게이지 손 관리 예외표. {캐릭터: {스킬명: {"burst_energy": 히트당 %}}}
 * 파이썬은 import 때 `_BURST_GAUGE.get("_exceptions", {})`를 읽어 둔다. 여기서는 조회할 때마다
 * 현재 데이터의 `_exceptions`로 넘겨 주는 Proxy다(사전처럼도, 함수처럼도 쓸 수 있다 — 머리말 참고).
 */
function _burst_gauge_exceptions(): Record<string, any> {
  return get(_BURST_GAUGE(), '_exceptions', {});
}
export const BURST_GAUGE_EXCEPTIONS: any = new Proxy(
  (() => _burst_gauge_exceptions()) as any,
  {
    apply: () => _burst_gauge_exceptions(),
    get: (_t, p) => (_burst_gauge_exceptions() as any)[p],
    has: (_t, p) => p in _burst_gauge_exceptions(),
    ownKeys: () => Reflect.ownKeys(_burst_gauge_exceptions()),
    getOwnPropertyDescriptor: (_t, p) => {
      const d = Reflect.getOwnPropertyDescriptor(_burst_gauge_exceptions(), p);
      if (d) d.configurable = true;
      return d;
    },
    set: () => false,
    deleteProperty: () => false,
  },
);

// py: calculator/buff_manager.py:60
/** `parsed_skills.json` (파이썬 모듈 전역 `_PARSED_SKILLS`). */
export function _PARSED_SKILLS(): Record<string, any> {
  return data().parsed_skills;
}

export const FAVORITE_MAX_STAGE = 3;          // 애장품 단계는 0(미보유)~3

// py: calculator/buff_manager.py:65
/**
 * 캐릭터의 활성 스킬 효과 목록. 애장품 단계에 맞는 슬롯 조합을 고른다.
 * (자세한 설명은 원본 docstring 참고)
 */
export function char_effects(name: string, favorite_stage: number | string | null = null): any[] {
  const effs: any[] = get(_PARSED_SKILLS(), name, []);
  const slots: number[] = or(get(get(_NIKKE(), name, {}), 'favorite_slots'), []);
  if (!truthy(slots) || !truthy(effs)) {
    return effs;
  }

  const stage = favorite_stage == null ? FAVORITE_MAX_STAGE : int(favorite_stage);
  if (!(0 <= stage && stage <= FAVORITE_MAX_STAGE)) {
    throw ValueError(
      `[${name}] 애장품 단계는 0~${FAVORITE_MAX_STAGE}여야 한다 (favorite_stage=${pystr(favorite_stage)})`,
    );
  }

  // 슬롯 → 그 슬롯에 실제로 쓸 판본. 애장품 판본이면 그 단계, 기본 판본이면 None.
  const want = new Map<number, number | null>();
  slots.forEach((slot, i) => {
    want.set(slot, i + 1 <= stage ? i + 1 : null);
  });
  const wantItem = (slot: number): number | null => {
    if (!want.has(slot)) throw KeyError(String(slot));
    return want.get(slot)!;
  };
  const out = effs.filter(
    (eff) => get(eff, 'favorite', null) === wantItem(int((item(eff, 'source') as string).replace(/^스킬/, ''))),
  );

  const missing = sorted(
    [...want.keys()].filter((slot) => !effs.some(
      (eff) => item(eff, 'source') === `스킬${slot}` && get(eff, 'favorite', null) === wantItem(slot),
    )),
  );
  if (missing.length > 0) {
    const kind = new Map<number, string>();
    for (const slot of missing) {
      const w = wantItem(slot);
      kind.set(slot, truthy(w) ? `애장품 ${Math.trunc(w as number)}단계` : '기본(비애장품)');
    }
    throw ValueError(
      `[${name}] 애장품 ${stage}단계로 돌리려면 필요한 스킬 판본이 `
      + 'data/parsed_skills.json에 없다: '
      + [...kind.entries()].map(([slot, k]) => `스킬${slot}(${k})`).join(', ') + '\n'
      + '  이대로 두면 그 슬롯의 효과가 통째로 빠져 딜이 조용히 낮게 나온다.\n'
      + '  ① 그 판본을 파싱한다 — char-add 단계 2 (`.agent/skills/char-add/PARSE.md`)\n'
      + '  ② 파싱 전이라면 애장품 3단계(`favorite_stage: 3`)로만 돌린다',
    );
  }
  return out;
}

// py: calculator/buff_manager.py:112
function _EQUIP_SKILLS(): Record<string, any> {
  return data().tables.equipment_skills;
}
// py: calculator/buff_manager.py:113
function _CUBE(): Record<string, any> {
  return data().tables.cube;
}
// py: calculator/buff_manager.py:114
function _COLLECTION(): Record<string, any> {
  return data().tables.collection;
}

// ── 빈 buffs 딕셔너리 템플릿 ──────────────────────────────────────────────

// py: calculator/buff_manager.py:118
export const _BUFFS_ZERO: Record<string, any> = {
  'atk_pct': 0.0,
  'atk_flat': 0.0,
  'def_ignore_pct': 0.0,
  'crit_rate': 0.0,   // 아래 _CRIT_RATE_STATS 경로에서 별도 합산
  'crit_rate_skill': 0.0,   // 같은 경로. 일반 공격 한정 크리율을 뺀 값 (스킬 딜용)
  'crit_dmg': 0.0,   // 아래 _CRIT_DMG_STATS 경로에서 별도 합산
  'crit_dmg_skill': 0.0,   // 같은 경로. 일반 공격 한정 크리뎀을 뺀 값 (스킬 딜용)
  'core_dmg_pct': 0.0,
  'atk_dmg_pct': 0.0,
  'burst_dmg_pct': 0.0,
  'burst_dmg_aoe_pct': 0.0,   // 대상이 '적 전체'인 버스트 대미지에만 가산
  'pierce_dmg_pct': 0.0,
  'dot_dmg_pct': 0.0,
  'armor_break_dmg_pct': 0.0,
  'projectile_explosion_dmg': 0.0,
  'projectile_attachment_dmg': 0.0,
  'sequential_dmg_pct': 0.0,
  'charge_dmg_pct': 0.0,
  'charge_dmg_mag_pct': 0.0,
  'charge_dmg_per_max_ammo_pct': 0.0,
  'damage_accumulate_ratio_pct': 0.0,
  'split_dmg_pct': 0.0,
  'part_dmg_pct': 0.0,
  'received_dmg': 0.0,
  'element_bonus_pct': 0.0,
  'is_element_match': false,
  'def_pct': 0.0,
  'enemy_def_down_pct': 0.0,  // 적 방어력 감소(②). 적 대상 def_pct 버프 합(음수)
  'charge_speed_pct': 0.0,
  'charge_time_flat': 0.0,  // 차지 시간 절대 가감(초). 감소는 음수
  'charge_time_fixed': false,
  'persona_state': false,   // 페르소나 상태 마커. 수치 기여 없이 대상 판정에만 쓴다
  'charge_speed_buff_immune': false,
  'charge_speed_debuff_immune': false,
  'debuff_immune': false,
  'stun_immune': false,
  'stack_change_immune': false,
  'max_ammo_pct': 0.0,
  'max_ammo_flat': 0.0,
  'max_ammo_infinite': false,
  'accuracy_pct': 0.0,
  'normal_atk_dmg_pct': 0.0,
  'reload_speed_pct': 0.0,
  'burst_cooldown': 0.0,  // 버스트 쿨타임 감소 (buff 상태로 지속)
  'max_hp_pct': 0.0,  // 최대 체력 + 현재 체력 동반 증가
  'max_hp_only_pct': 0.0,  // 최대 체력만 증가 (현재 체력 유지)
  'lifesteal_pct': 0.0,
  'def_caster_based_pct': 0.0,
  'taunt': false,
  'pierce_enabled': false,
  'armor_break_enabled': false,  // 일반 공격을 방어력 무시 대미지로 치환
  'attack_speed_pct': 0.0,
  'pellet_count': 0.0,
  'pellet_count_fixed': 0.0,  // >0이면 펠릿 수를 이 값으로 고정 (절대값)
  'fullburst_duration': 0.0,  // 풀버스트 타임 지속 시간 증감 (초)
  'skill_cooldown_pct': 0.0,  // 스킬 쿨타임 % 감소 (음수 = 감소)
  'charge_speed_overflow_conversion_pct': 0.0,  // charge_speed 100% 초과분 × N% → charge_dmg_pct 추가
  'mg_warmup_speed_pct': 0.0,  // MG 예열 진행 속도 % (음수 = 감소). -100이면 warmup_shots 증가 정지
  // 「버스트 충전 속도」는 수령자와 무관하게 **시전자의 발당 기준 게이지 × 버프값**을
  // 매 히트에 가산한다(히트당 가산, 곱연산 아님). `_route_burst_charge()`가 환산해 싣는다.
  'burst_charge_speed_flat': 0.0,  // 모든 시전자가 주는 히트당 게이지 가산량(%p)
};

// parsed_skills stat → buffs 딕셔너리 키 매핑
// 매핑에 없는 stat은 damage/instant type이거나 타임라인 처리 대상
// py: calculator/buff_manager.py:185
export const _STAT_TO_BUFF: Record<string, string> = {
  'atk_pct': 'atk_pct',
  'atk_flat': 'atk_flat',
  'def_ignore_pct': 'def_ignore_pct',
  'crit_rate': 'crit_rate',
  'normal_atk_crit_rate': 'crit_rate',
  'crit_dmg': 'crit_dmg',
  'normal_atk_crit_dmg': 'crit_dmg',
  'core_dmg_pct': 'core_dmg_pct',
  'atk_dmg_pct': 'atk_dmg_pct',
  'burst_dmg_pct': 'burst_dmg_pct',
  'burst_dmg_aoe_pct': 'burst_dmg_aoe_pct',
  'pierce_dmg_pct': 'pierce_dmg_pct',
  'dot_dmg_pct': 'dot_dmg_pct',
  'armor_break_dmg_pct': 'armor_break_dmg_pct',
  'projectile_explosion_dmg': 'projectile_explosion_dmg',
  'projectile_explosion_dmg_pct': 'projectile_explosion_dmg',
  'projectile_attachment_dmg': 'projectile_attachment_dmg',
  'projectile_attachment_dmg_pct': 'projectile_attachment_dmg',
  'sequential_dmg_pct': 'sequential_dmg_pct',
  'charge_dmg_pct': 'charge_dmg_pct',
  'charge_dmg_mag_pct': 'charge_dmg_mag_pct',  // 차지 대미지 배율 ▲ (④ 승수)
  'charge_dmg_per_max_ammo_pct': 'charge_dmg_per_max_ammo_pct',
  'damage_accumulate_ratio_pct': 'damage_accumulate_ratio_pct',
  'split_dmg_pct': 'split_dmg_pct',        // 분배 대미지 ▲ (⑥에 합산)
  'part_dmg_pct': 'part_dmg_pct',         // 파츠 대미지 ▲ (⑤ 선택 합산)
  'part_dmg': 'part_dmg_pct',         // 파츠 큐브 테이블 stat명
  'received_dmg_pct': 'received_dmg',
  'personal_received_dmg_pct': 'received_dmg',
  'element_bonus_pct': 'element_bonus_pct',
  'element_bonus': 'element_bonus_pct',  // 장비·큐브에서 사용하는 stat명 (동일 버프 키로 합산)
  'def_pct': 'def_pct',
  'personal_enemy_def_down_pct': 'enemy_def_down_pct',
  'charge_speed_pct': 'charge_speed_pct',
  'charge_speed_caster_based_pct': 'charge_speed_pct',  // _get_value에서 시전자 charge_time 기준 환산
  'charge_time_flat': 'charge_time_flat',
  'charge_time_fixed': 'charge_time_fixed',
  'persona_state': 'persona_state',
  'charge_speed_buff_immune': 'charge_speed_buff_immune',
  'charge_speed_debuff_immune': 'charge_speed_debuff_immune',
  'debuff_immune': 'debuff_immune',
  'stun_immune': 'stun_immune',
  'stack_change_immune': 'stack_change_immune',
  'max_ammo_pct': 'max_ammo_pct',
  'max_ammo_flat': 'max_ammo_flat',
  'max_ammo_infinite': 'max_ammo_infinite',
  'accuracy_pct': 'accuracy_pct',
  'normal_atk_dmg_pct': 'normal_atk_dmg_pct',
  'reload_speed_pct': 'reload_speed_pct',
  'burst_cooldown': 'burst_cooldown',
  'max_hp_pct': 'max_hp_pct',
  'max_hp_only_pct': 'max_hp_only_pct',
  'lifesteal_pct': 'lifesteal_pct',
  'def_caster_based_pct': 'def_caster_based_pct',
  'taunt': 'taunt',
  'pierce_enabled': 'pierce_enabled',
  'armor_break_enabled': 'armor_break_enabled',
  'attack_speed_pct': 'attack_speed_pct',
  'pellet_count': 'pellet_count',
  'pellet_count_fixed': 'pellet_count_fixed',
  'fullburst_duration': 'fullburst_duration',
  'skill_cooldown_pct': 'skill_cooldown_pct',
  'charge_speed_overflow_conversion_pct': 'charge_speed_overflow_conversion_pct',
  'mg_warmup_speed_pct': 'mg_warmup_speed_pct',
  // 2024-12-05에 「버스트 게이지 획득량」 → 「버스트 게이지 충전 속도」로 표기만 바뀌었다.
  'burst_charge_speed_pct': 'burst_charge_speed_flat',
};

// 크리확률로 합산되는 stat 집합 (백분율 → 확률 환산 후 기본 15%와 합연산)
const _CRIT_RATE_STATS: ReadonlySet<string> = new Set(['crit_rate', 'normal_atk_crit_rate']);
// 원문이 `[일반 공격 크리티컬 확률 n% ▲]`인 것들. 스킬 딜의 크리 판정에 실리면 안 된다.
const _NORMAL_ATK_ONLY_CRIT_RATE_STATS: ReadonlySet<string> = new Set(['normal_atk_crit_rate']);

// 크리 대미지도 같은 구조다.
const _CRIT_DMG_STATS: ReadonlySet<string> = new Set(['crit_dmg', 'normal_atk_crit_dmg']);
const _NORMAL_ATK_ONLY_CRIT_DMG_STATS: ReadonlySet<string> = new Set(['normal_atk_crit_dmg']);

// **소스별로 따로 반올림되는** buff_key (원본 주석 참고).
// 파이썬 frozenset의 순회 순서는 해시 시드에 달려 있다 — 여기서 순회하는 곳(`parts_by_key` 생성)은
// 키 순서만 달라질 뿐 값은 같다. 이 순서로 고정한다.
const _QUANT_BUFF_KEYS: ReadonlySet<string> = new Set(['max_ammo_pct', 'charge_speed_pct']);
export const _QUANT_PARTS_KEY = '_quant_parts';

// 스킬로 걸린 효과의 소스 이름. 장비·큐브·소장품·고급 설정은 `_source_tag`를 달고 온다.
const _SKILL_SOURCE = 'skill';

// py: calculator/buff_manager.py:279
/**
 * 소스별 반올림의 **그룹 식별자**. 같은 그룹은 합산한 뒤 딱 한 번 반올림한다.
 * 튜플 `(caster, source_tag, _quant_group or id(eff))` → 배열. id(eff)는 `pyid(eff)`.
 */
export function _quant_group_key(ab: ActiveBuff): [string, any, any] {
  // 효과 사전과 시전자는 버프가 사는 동안 그대로다 — 한 번 만들어 버프에 붙여 둔다.
  let k = _QGK.get(ab);
  if (k === undefined) {
    const eff = ab.effect;
    k = [ab.caster, get(eff, '_source_tag', _SKILL_SOURCE), or(get(eff, '_quant_group'), pyid(eff))];
    _QGK.set(ab, k);
  }
  return k;
}
/** [고속 엔진] 효과 사전의 고정 칸(stat·scaling·max_stack) — 효과 사전은 만든 뒤 고치지 않는다. */
interface EffMeta { stat: any; scaling: any; max_stack: any }
const _EFF_META = new WeakMap<object, EffMeta>();
function _effMeta(eff: Eff): EffMeta {
  let m = _EFF_META.get(eff);
  if (m === undefined) {
    m = { stat: get(eff, 'stat'), scaling: get(eff, 'scaling'), max_stack: get(eff, 'max_stack', 1) };
    _EFF_META.set(eff, m);
  }
  return m;
}
/** 접힌 스텝의 튜플 키(배열, 스텝과 수명이 같다) → 문자열. */
const _SK = new WeakMap<object, string>();
function _skOf(key: any[]): string {
  let s = _SK.get(key);
  if (s === undefined) { s = serKey(key); _SK.set(key, s); }
  return s;
}
/** 매번 평가 버프의 `(buff_key, 그룹키)` — 버프마다 한 번 만든다. */
const _LQK = new WeakMap<object, { b: string; k: any[]; s: string }>();
function _liveQuantKey(ab: ActiveBuff, buff_key: string): { b: string; k: any[]; s: string } {
  let e = _LQK.get(ab);
  if (e === undefined || e.b !== buff_key) {
    const k = [buff_key, _quant_group_key(ab)];
    e = { b: buff_key, k, s: serKey(k) };
    _LQK.set(ab, e);
  }
  return e;
}
const _QGK = new WeakMap<ActiveBuff, [string, any, any]>();

/** 튜플(중첩 배열 포함) → 문자열 키. 문자열에는 NUL이 없다고 본다. */
function serKey(p: any): string {
  if (typeof p === 'string') return 's' + p + '\u0000';
  if (typeof p === 'number') return 'n' + p + '\u0000';
  if (Array.isArray(p)) {
    let s = '[';
    for (const x of p) s += serKey(x);
    return s + ']';
  }
  return 'j' + JSON.stringify(p) + '\u0000';
}

// py: calculator/buff_manager.py:295
/** `equip_skills` 항목 하나 → **그룹별 합산 퍼센트** 목록. 그룹당 효과 하나가 된다. */
function _equip_option_groups(stat: string, val: any): number[] {
  if (!Array.isArray(val)) {
    return [float(val)];
  }
  const lines = val.map((v: any) => float(v));
  if (lines.length === 0) {
    return [];
  }
  const bt = get(or(get(_EQUIP_SKILLS(), stat), {}), 'buff_type');
  if (!(typeof bt === 'string' && _QUANT_BUFF_KEYS.has(bt))) {
    return [sum(lines)];
  }
  const groups = new Map<number, number>();
  for (const v of lines) {
    groups.set(v, (groups.has(v) ? groups.get(v)! : 0.0) + v);
  }
  return [...groups.values()];
}

// 수치 없이 True만 세우는 boolean 플래그 buff_key
const _BOOL_BUFF_KEYS: ReadonlySet<string> = new Set([
  'charge_time_fixed', 'charge_speed_buff_immune', 'charge_speed_debuff_immune',
  'debuff_immune', 'stun_immune', 'stack_change_immune', 'taunt',
  'pierce_enabled', 'armor_break_enabled', 'persona_state', 'max_ammo_infinite',
]);

// get_buffs 실행 계획의 스텝 종류 (`BuffManager._build_plan` 참고)
const _PLAN_ADD = 0, _PLAN_CRIT = 1, _PLAN_FLAG = 2, _PLAN_LIVE = 3, _PLAN_QUANT = 4, _PLAN_CDMG = 5;

// 계획 캐시 감사 모드. `NIKKE_BUFF_AUDIT=1`이면 매 조회마다 계획을 다시 만들어 캐시와 대조한다.
// 브라우저에는 환경 변수가 없으므로 꺼진다(노드에서만 켤 수 있다).
const _BUFF_AUDIT: boolean = (() => {
  try {
    return (globalThis as any).process?.env?.NIKKE_BUFF_AUDIT === '1';
  } catch {
    return false;
  }
})();

// 대상별 보호막을 만드는 stat 집합.
const _SHIELD_STATS: ReadonlySet<string> = new Set(['shield_from_max_hp_pct', 'shared_shield_from_max_hp_pct']);

// get_buffs 시점에 재평가가 필요한 runtime condition 접두사 집합
// (순회 결과는 참/거짓 하나라 순서가 무관하다)
const _RUNTIME_COND_PREFIXES: readonly string[] = [
  'during_charge', 'during_full_burst', 'not_during_full_burst',
  'during_shield',
  'self_hp_above:', 'self_hp_below:', 'self_hp_max',
  'ally_hp_below:',
  'self_stack_above:', 'self_state:', 'not_self_state:',
  'target_state:', 'not_target_state:',
  'gauge_above:', 'gauge_below:',
  // 적 수 조건은 단일 보스 sim에서 상수 판정이지만 여기 등록해야 한다.
  'enemy_count_above:', 'enemy_count_below:',
];

// py: calculator/buff_manager.py:364
/** 조건부 `passive` 중 **유한 지속**인 것인가. (원본 docstring 참고) */
function _is_cond_finite_passive(eff: Eff): boolean {
  if (get(eff, 'type') !== 'buff') {
    return false;
  }
  if (!(item(item(eff, 'trigger'), 'timing') as any[]).includes('passive')) {
    return false;
  }
  if (!truthy(get(item(eff, 'trigger'), 'condition'))) {
    return false;
  }
  if (get(eff, 'duration_bullets', -1) !== -1) {
    return false;
  }
  const duration = get(eff, 'duration');
  if (duration == null && has(eff, 'duration_values')) {
    return true;
  }
  return duration != null && duration !== -1;
}

// py: calculator/buff_manager.py:393
/** 이 버프가 get_buffs 시점마다 조건을 재평가해야 하는지. (원본 docstring 참고) */
function _has_runtime_cond(conditions: any[], expires: number, duration_bullets: number = -1): boolean {
  if (expires !== Infinity || duration_bullets !== -1) {
    return false;
  }
  for (const c of conditions) {
    for (const prefix of _RUNTIME_COND_PREFIXES) {
      if (c === prefix || (c as string).startsWith(prefix)) {
        return true;
      }
    }
  }
  return false;
}

// 발사와 같은 프레임에 발동하는 트리거 타이밍. (원본 주석 참고)
const _BULLET_BOUND_TIMINGS: ReadonlySet<string> = new Set([
  'full_charge',
  'on_attack', 'hit_count', 'pellet_hit', 'core_hit', 'crit_hit',
  'last_bullet', 'last_bullet_fire',
  'event:full_reload', 'squad_ammo_consume',
]);

// py: calculator/buff_manager.py:432
function _is_bullet_bound_trigger(eff: Eff): boolean {
  for (const timing of (or(get(get(eff, 'trigger', {}), 'timing', []), []) as any[])) {
    if (_BULLET_BOUND_TIMINGS.has(timing)) {
      return true;
    }
  }
  return false;
}

// 활성화 시점이 아닌 get_buffs 시점에 타겟을 결정해야 하는 target 패턴
const _LAZY_RESOLVE_PREFIXES: readonly string[] = [
  'allies_lowest_atk_burst3:',
  'allies_top_atk:',
  'allies_top_atk_excl:',
  'allies_weapon_top_atk:',
  'allies_lowest_hp:',
  'allies_lowest_hp_excl:',
  'allies_top_def:',
  'allies_below_def',
  'allies_random:',
  'allies_random_cover_destroyed:',
];

function _startswith_lazy(s: string): boolean {
  for (const p of _LAZY_RESOLVE_PREFIXES) {
    if (s.startsWith(p)) return true;
  }
  return false;
}

// 주기 대미지 만료 경계 비교용 여유.
const _TICK_EPS = 1e-6;
// 만료 시각에 떨어지는 마지막 틱을 "살짝 당겨" 계산할 때 쓰는 폭.
const _TICK_NUDGE = 1e-4;

// ── ActiveBuff ────────────────────────────────────────────────────────────

let _AB_SEQ = 0;  // ActiveBuff 고유 번호 발급기 (itertools.count() — 0부터)

// 스텝 캐시의 «아직 안 구했다» 표시. None은 «기여 없음»이라는 뜻이라 못 쓴다.
const _STEP_UNSET: unique symbol = Symbol('_STEP_UNSET');

export interface ActiveBuffInit {
  effect: Eff;
  caster: string;
  target_chars: string[] | null;
  activated_at: number;
  expires_at: number;
  stack?: number;
  trigger_count?: number;
  bullets_left?: number;
  bullets_per_target?: Record<string, number>;
  per_char_stacks?: Record<string, number>;
  has_runtime_conditions?: boolean;
  log_pending?: boolean;
  scaling_stack?: number | null;
  shield_per_target?: Record<string, number>;
  shield_max_per_target?: Record<string, number>;
  hp_bonus_flat?: number;
  plan_steps?: Map<string, any>;
  uid?: number;
}

// py: calculator/buff_manager.py:470
/** @dataclass ActiveBuff — 생성자는 키워드 인자 객체 하나. 기본값 사전은 인스턴스마다 새로 만든다. */
export class ActiveBuff {
  effect: Eff;           // parsed effect 항목 원본
  caster: string;        // 시전자 캐릭터명
  target_chars: string[] | null;  // None = 지연 resolve (get_buffs 시점에 결정)
  activated_at: number;
  expires_at: number;    // math.inf = 영구
  stack: number;
  trigger_count: number;
  bullets_left: number;  // duration_bullets 기반 만료용. -1이면 미사용 (단일 caster 전용)
  bullets_per_target: Record<string, number>;  // 캐릭터별 잔여 발사 횟수 (다중 target용)
  per_char_stacks: Record<string, number>;     // 캐릭터별 독립 스택 (use_per_target + max_stack>1 전용)
  has_runtime_conditions: boolean;  // get_buffs 시점 재평가 필요 여부
  log_pending: boolean;  // 지연 resolve 대상이라 activate 로그를 아직 못 남긴 상태.
  scaling_stack: number | null;  // scaling:stack_count + scaling_ref 버프의 발동 시점 참조 중첩
  shield_per_target: Record<string, number>;      // shield_from_max_hp_pct의 대상별 보호막량.
  shield_max_per_target: Record<string, number>;  // 보호막 회복 상한(최초 생성량).
  hp_bonus_flat: number;  // max_hp_from_max_hp_pct가 부여 시점에 확정한 최대 체력 가산분(절대값).
  plan_steps: Map<string, any>;  // 시간 불변 버프의 `_build_plan` 스텝 캐시. {(caster, target, exclude): 스텝}
  uid: number;  // 이 인스턴스의 고유 식별자.

  // [고속 엔진] 효과 사전의 고정 칸을 미리 꺼내 둔다(효과 사전은 버프가 사는 동안 바뀌지 않는다).
  // `abStat(ab, d)` → `abStat(ab, d)`.
  _has_stat!: boolean;
  _stat: any;
  _has_name!: boolean;
  _name: any;

  constructor(kw: ActiveBuffInit) {
    this.effect = kw.effect;
    const e = kw.effect as Dict;
    this._has_stat = e != null && Object.prototype.hasOwnProperty.call(e, 'stat');
    this._stat = this._has_stat ? e['stat'] : undefined;
    this._has_name = e != null && Object.prototype.hasOwnProperty.call(e, 'name');
    this._name = this._has_name ? e['name'] : undefined;
    this.caster = kw.caster;
    this.target_chars = kw.target_chars;
    this.activated_at = kw.activated_at;
    this.expires_at = kw.expires_at;
    this.stack = kw.stack !== undefined ? kw.stack : 1;
    this.trigger_count = kw.trigger_count !== undefined ? kw.trigger_count : 1;
    this.bullets_left = kw.bullets_left !== undefined ? kw.bullets_left : -1;
    this.bullets_per_target = kw.bullets_per_target !== undefined ? kw.bullets_per_target : {};
    this.per_char_stacks = kw.per_char_stacks !== undefined ? kw.per_char_stacks : {};
    this.has_runtime_conditions = kw.has_runtime_conditions !== undefined ? kw.has_runtime_conditions : false;
    this.log_pending = kw.log_pending !== undefined ? kw.log_pending : false;
    this.scaling_stack = kw.scaling_stack !== undefined ? kw.scaling_stack : null;
    this.shield_per_target = kw.shield_per_target !== undefined ? kw.shield_per_target : {};
    this.shield_max_per_target = kw.shield_max_per_target !== undefined ? kw.shield_max_per_target : {};
    this.hp_bonus_flat = kw.hp_bonus_flat !== undefined ? kw.hp_bonus_flat : 0.0;
    this.plan_steps = kw.plan_steps !== undefined ? kw.plan_steps : new Map();
    if (kw.uid !== undefined) {
      this.uid = kw.uid;
    } else {
      this.uid = _AB_SEQ;
      _AB_SEQ += 1;
    }
  }
}

/** [고속 엔진] 효과 사전의 `duration_bullets`·`trigger.condition` — 사전은 만든 뒤 고치지 않는다. */
const _PASSIVE_META = new WeakMap<object, { duration_bullets: any; has_trigger: boolean; conditions: any }>();
function _passiveMeta(eff: Eff): { duration_bullets: any; has_trigger: boolean; conditions: any } {
  let m = _PASSIVE_META.get(eff);
  if (m === undefined) {
    const has_trigger = Object.prototype.hasOwnProperty.call(eff, 'trigger');
    m = {
      duration_bullets: get(eff, 'duration_bullets', -1),
      has_trigger,
      conditions: has_trigger ? get(eff['trigger'], 'condition', []) : undefined,
    };
    _PASSIVE_META.set(eff, m);
  }
  return m;
}

/** `get(ab.effect, 'stat', d)`. */
export function abStat(ab: ActiveBuff, d?: any): any {
  return ab._has_stat ? ab._stat : d;
}
/** `get(ab.effect, 'name', d)`. */
export function abName(ab: ActiveBuff, d?: any): any {
  return ab._has_name ? ab._name : d;
}

/** 파이썬 `fresh != plan`(감사 모드 전용) — 튜플·리스트는 값, ActiveBuff는 uid로 비교(dataclass eq). */
function _plan_eq(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!_plan_eq(a[i], b[i])) return false;
    }
    return true;
  }
  if (a instanceof ActiveBuff && b instanceof ActiveBuff) return a.uid === b.uid;
  return false;
}

/** 튜플 키 사전 — 삽입 순서를 지키며 원래 튜플도 함께 보관한다(`quant_parts`). */
class TupleDict {
  private m = new Map<string, [any, number]>();
  get(key: any, dflt: number): number {
    const e = this.m.get(serKey(key));
    return e === undefined ? dflt : e[1];
  }
  /** `d[key] = d.get(key, 0.0) + v` — 키 문자열을 미리 만들어 둔 경우. */
  add(s: string, key: any, v: number): void {
    const e = this.m.get(s);
    if (e === undefined) this.m.set(s, [key, 0.0 + v]);
    else e[1] = e[1] + v;
  }
  set(key: any, v: number): void {
    const s = serKey(key);
    const e = this.m.get(s);
    if (e === undefined) this.m.set(s, [key, v]);
    else e[1] = v;
  }
  items(): Array<[any, number]> {
    return [...this.m.values()];
  }
  values(): number[] {
    return [...this.m.values()].map((e) => e[1]);
  }
}

// ── BuffManager ───────────────────────────────────────────────────────────

type Handler = (...args: any[]) => any;

// py: calculator/buff_manager.py:520
/**
 * 5인 스쿼드 버프/디버프 관리자.
 *
 * squad : 캐릭터 인스턴스 목록 (base_stat.py와 동일 구조, skill_level 추가)
 * state : 타임라인 공유 상태. 최소 키: "full_burst", "burst_casted"
 */
export class BuffManager {
  squad: Dict[];
  squad_names: string[];
  slot_names: string[];
  state: Dict;
  cheats: Cheats;
  _char: Record<string, Dict>;
  _effects: Array<[Eff, string]>;
  _char_effects_cache: Map<string, any[]>;
  _active: ActiveBuff[];
  _next_fire: Map<object, [number, number]>;
  _dot_timers: Map<object, [string, number, number]>;
  _ramp_pending: Array<[number, Eff, string, number]>;
  _instant_timers: Map<object, [string, number, number]>;
  _charge_hold_cache: Map<string, Array<[number, string]>>;
  _lazy_target_cache: Map<string, string[]>;
  _event_counts: Map<string, Map<string, number>>;
  _gauge_event_handler: Handler | null;
  _pellet_in_shot_cache: Map<string, Array<[number, string]>>;
  _immune_used: Map<string, number>;
  _cond_finite_passives: Array<[Eff, string]>;
  _conditional_event_counts: Map<string, [number, number]>;
  _trigger_counts: Map<object, number>;
  _cur_t: number;
  _notify_ctx: Dict;
  _in_hp_edge: boolean;
  _instant_handlers: Map<string, Handler>;
  _instant_event_handler: Handler | null;
  _damage_handler: Handler | null;
  _buff_event_handler: Handler | null;
  // (시전자·제외 이름) → 시각 → 집계. 파이썬의 (caster, t, 판, 제외) 튜플 키를 두 단계로 나눈 것 —
  // 판(_cache_version)은 캐시를 비울 때만 바뀌므로 키에서 뺐다.
  _buffs_cache: Map<string, Map<number, Dict>>;
  /** [고속 엔진] `_get_value`의 기본값 캐시 — 효과 사전 → 시전자 → 값(없으면 null). */
  /**
   * [고속 엔진] `max_ammo_buffs` 결과를 프레임을 넘어 다시 쓴다. 계획이 접힌 스텝만으로 되어 있으면
   * 값은 그 스텝들의 만료로만 바뀐다 — 다음 만료(until) 전까지는 같다. 버프 캐시를 비우는 모든 길이 함께 비운다.
   */
  _ammo_reuse = new Map<string, { t: number; until: number; d: Dict }>();
  _raw_value_cache = new WeakMap<object, Map<string, number | null>>();
  _cache_version: number;
  _ammo_plan_cache: Map<string, any[]>;
  _plan_cache: Map<string, any[]>;
  _stat_index: Map<string, ActiveBuff[]>;
  _name_index_cache: Map<string, ActiveBuff[]>;
  _eff_by_id: Map<object, Eff>;
  _stunned_cache: Map<string, boolean>;
  _notify_index: Map<string, Map<string, Array<[Eff, string]>>>;
  _squad_notify_index: Map<string, Array<[Eff, string]>>;
  _squad_hit_index: Map<string, Array<[Eff, string]>>;
  _cond_passive_prev: Map<number, boolean>;
  _every_effects: Array<[Eff, string, string]>;

  // py: calculator/buff_manager.py:533
  constructor(squad: Dict[], state: Dict | null = null) {
    this.squad = squad;
    this.squad_names = squad.map((c) => item(c, 'name') as string);
    this.state = or(state, {}) as Dict;
    // 실제 편성 자리 순서(후열 조건·양옆 아군만 본다). py: buff_manager.py slot_names
    this.slot_names = [...(or(get(this.state, 'slot_order'), this.squad_names) as string[])];

    // 켜 둔 핵. `simulate`가 config에서 읽어 꽂아 준다 — 기본은 아무것도 안 켠 것.
    this.cheats = NO_CHEATS;

    // 캐릭터명 → 인스턴스 빠른 접근
    this._char = {};
    for (const c of squad) this._char[item(c, 'name')] = c;

    // 등록된 효과 목록: (effect, caster_name)
    this._effects = [];

    // 캐릭터명 → 애장품 단계까지 반영한 스킬 효과 목록 (`char_effects()`)
    this._char_effects_cache = new Map();

    // 활성 버프 목록
    this._active = [];

    // every:Ns 효과별 다음 발동 시각. id(effect) → (next_t, interval)
    this._next_fire = new Map();

    // tick_interval damage 효과별 타이머: id(effect) → (caster, next_t, expires_at)
    this._dot_timers = new Map();

    // `same_target:[이름]` DoT의 중첩 램프 예약: [(fire_t, effect, caster, stack)]
    this._ramp_pending = [];

    // tick_interval instant 효과별 타이머: id(effect) → (caster, next_t, expires_at)
    this._instant_timers = new Map();
    // charge_hold:N 임계값 캐시 (캐스터별). `charge_hold_thresholds()` 참조
    this._charge_hold_cache = new Map();

    // 지연 resolve 대상 캐시: (caster, 활성화 시각, target 문자열) → 대상 목록.
    this._lazy_target_cache = new Map();

    // 이벤트별 발동 횟수 (hit_count, burst_cast_count 등 추적용)
    this._event_counts = new Map();  // caster → {event_key: count}
    // 버스트 게이지 가산 로그 콜백. 타임라인이 register_gauge_event_handler()로 주입
    this._gauge_event_handler = null;
    // pellet_hit_in_shot:N 임계값 캐시 (캐스터별). `pellet_in_shot_thresholds()` 참조
    this._pellet_in_shot_cache = new Map();
    // `debuff_immune_count` 소모량: (니케, 버프 이름) → 쓴 개수. 재부여 시 0으로 되돌린다
    this._immune_used = new Map();
    // 조건부 passive 중 유한 지속인 것 — tick()이 조건이 참인 동안 만료를 민다.
    this._cond_finite_passives = [];
    this._conditional_event_counts = new Map();

    // max_trigger 추적: id(effect) → 발동 횟수 (buff/instant/damage/weapon_change 공통)
    this._trigger_counts = new Map();

    // 현재 시각. sync_hp()처럼 t를 받지 않는 지점에서 이벤트를 쏘기 위해 보관
    this._cur_t = 0.0;
    // 지금 처리 중인 notify의 추가 컨텍스트 (hit_crit 등). _condition_ok가 읽는다
    this._notify_ctx = {};
    // sync_hp → notify → _activate → sync_hp 재진입 방지
    this._in_hp_edge = false;

    // instant stat → 핸들러. 타임라인이 register_instant_handler()로 주입
    this._instant_handlers = new Map();

    // instant 이벤트 로그 콜백. 타임라인이 register_instant_event_handler()로 주입
    this._instant_event_handler = null;

    // damage 효과 핸들러. 타임라인이 register_damage_handler()로 주입
    this._damage_handler = null;

    // 버프 활성/만료 이벤트 콜백. 타임라인이 register_buff_event_handler()로 주입
    this._buff_event_handler = null;

    // get_buffs 캐시: (caster, t, _cache_version, exclude) → buffs dict
    this._buffs_cache = new Map();
    this._cache_version = 0;
    // `max_ammo_buffs`용으로 계획을 추린 것. 계획과 수명이 같다(_invalidate_buffs_cache).
    this._ammo_plan_cache = new Map();

    // get_buffs 실행 계획 캐시: (caster, target, exclude_names) → plan
    this._plan_cache = new Map();

    // `_active`를 stat/name으로 되짚는 인덱스.
    this._stat_index = new Map();
    this._name_index_cache = new Map();

    // id(eff) → eff 역참조. _effects는 __init__ 이후 불변이라 1회만 만든다
    this._eff_by_id = new Map();

    // is_stunned 캐시: char_name → bool (_invalidate_buffs_cache 시 함께 초기화)
    this._stunned_cache = new Map();

    // notify 인덱스
    this._notify_index = new Map();
    this._squad_notify_index = new Map();
    this._squad_hit_index = new Map();

    // 조건부 passive 버프의 이전 틱 조건 충족 여부: ActiveBuff.uid → bool
    this._cond_passive_prev = new Map();

    this._every_effects = [];

    this._register_all();

    // `_effects`는 여기서 확정되고 이후 변하지 않는다.
    this._eff_by_id = new Map();
    for (const [eff] of this._effects) this._eff_by_id.set(eff, eff);
    this._every_effects = [];
    for (const [eff, caster] of this._effects) {
      for (const timing of item(item(eff, 'trigger'), 'timing') as string[]) {
        if (timing.startsWith('every:')) {
          this._every_effects.push([eff, caster, timing]);
        }
      }
    }
  }

  // ── 등록 ─────────────────────────────────────────────────────────────

  // py: calculator/buff_manager.py:659
  /** 스쿼드 멤버의 활성 스킬 효과 목록 (그 캐릭터의 애장품 단계 기준). */
  char_effects(name: string): any[] {
    if (!this._char_effects_cache.has(name)) {
      const char = or(get(this._char, name), {});
      this._char_effects_cache.set(name, char_effects(name, get(char, 'favorite_stage', null)));
    }
    return this._char_effects_cache.get(name)!;
  }

  // py: calculator/buff_manager.py:671
  /** 스쿼드 전원의 모든 버프 소스를 효과 목록에 등록. */
  _register_all(): void {
    for (const char of this.squad) {
      const name: string = item(char, 'name');
      // parsed_skills (애장품 단계에 맞는 슬롯 판본만)
      for (const eff of this.char_effects(name)) {
        this._effects.push([eff, name]);
      }
      // 장비 스킬 (부위별 개별 옵션)
      for (const part_data of Object.values(item(char, 'equipment') as Dict)) {
        for (const sk of get(part_data, 'skills', []) as Dict[]) {
          const eff = this._make_equip_effect(item(sk, 'id'), item(sk, 'lv'));
          if (truthy(eff)) {
            this._effects.push([eff!, name]);
          }
        }
      }
      // 장비 옵션 (equip_skills) — 스칼라는 한 그룹, 리스트는 줄별 값
      for (const [stat, val] of Object.entries(get(char, 'equip_skills', {}) as Dict)) {
        for (const gval of _equip_option_groups(stat, val)) {
          let eff = this._make_equip_effect(stat, null, gval);
          if (truthy(eff)) {
            eff = { ...eff!, 'name': '장비 옵션' };
            this._effects.push([eff, name]);
          }
        }
      }
      // 큐브 스킬 (공통 + 종류별)
      const cube_name = item(item(char, 'cube'), 'name');
      const cube_lv = item(item(char, 'cube'), 'level');
      for (const eff of this._make_cube_effects(cube_name, cube_lv)) {
        this._effects.push([eff, name]);
      }
      // 소장품 무기군 스킬
      for (const eff of this._make_collection_effects(char)) {
        this._effects.push([eff, name]);
      }
      // 브라우저 고급 설정: 캐릭터 개인에게만 적용되는 영구 수치.
      for (const [stat, value] of Object.entries(get(char, 'manual_stats', {}) as Dict)) {
        this._effects.push([this._make_manual_effect(stat, float(value)), name]);
      }
    }

    this._build_notify_index();
    this._build_cond_finite_passives();
  }

  // py: calculator/buff_manager.py:706
  /** timing 문자열 → notify 인덱스 조회 키. every:* 는 None 반환 (틱 전용). */
  _timing_to_index_key(timing: string): string | null {
    if (timing === 'passive') {
      return 'battle_start';
    }
    if (timing.startsWith('every:')) {
      return null;
    }
    if (timing.startsWith('burst_cast_count:')) {
      return 'burst_cast';
    }
    if (timing.startsWith('conditional_burst_cast_count:')) {
      return 'burst_cast';
    }
    if (timing.startsWith('conditional_hit_count:')) {
      return 'hit_count';
    }
    if (timing.startsWith('full_burst_start_count:') || timing.startsWith('full_burst_start_exact:')) {
      return 'full_burst_start';
    }
    if (timing.startsWith('full_burst_end_count:')) {
      return 'full_burst_end';
    }
    if (timing.startsWith('full_charge_count:')) {
      return 'full_charge_hit';
    }
    if (timing.startsWith('on_attack_count:')) {
      return 'on_attack';
    }
    if (timing.startsWith('hit_count:')) {
      const parts = pysplit(timing, ':', 2);
      if (parts.length === 3 && !isdigit(lstripDash(parts[1]!))) {
        return `hit_count:${parts[1]}`;
      }
      return 'hit_count';
    }
    if (timing.startsWith('core_hit_count:') || timing.startsWith('core_hit:')) {
      return 'core_hit';
    }
    if (timing.startsWith('crit_hit_count:')) {
      return 'crit_hit';
    }
    if (timing.startsWith('received_hit_count:') || timing.startsWith('received_hit:')) {
      return 'received_hit';
    }
    if (timing.startsWith('pellet_hit_count:') || timing.startsWith('pellet_hit:')) {
      return 'pellet_hit';
    }
    if (timing.startsWith('multi_hit:')) {
      return 'multi_hit';
    }
    if (timing.startsWith('non_full_charge_hit_count:')) {
      return 'non_full_charge_hit';
    }
    if (timing.startsWith('charge_hold_count:')) {
      const parts = timing.split(':');
      return parts.length === 3 ? `charge_hold:${parts[1]}` : timing;
    }
    if (timing.startsWith('hp_below_count:')) {
      // "hp_below_count:T:N" → hp_below:T 이벤트에 반응
      const parts = timing.split(':');
      return parts.length >= 2 ? `hp_below:${parts[1]}` : 'hp_below:';
    }
    if (timing.startsWith('squad_ammo_consume:')) {
      return 'squad_ammo_consume';
    }
    if (timing.startsWith('part_hit_count:')) {
      return 'squad_part_hit';
    }
    if (timing.startsWith('body_hit_count:')) {
      return 'squad_body_hit';
    }
    // 나머지는 timing 자체가 event 키
    return timing;
  }

  // py: calculator/buff_manager.py:759
  /** _effects 로부터 notify 인덱스를 구축. */
  _build_notify_index(): void {
    this._notify_index.clear();
    this._squad_notify_index.clear();
    this._squad_hit_index.clear();
    const valid_types = ['buff', 'instant', 'weapon_change', 'damage'];

    for (const [eff, eff_caster] of this._effects) {
      if (!valid_types.includes(get(eff, 'type'))) {
        continue;
      }
      for (const timing of item(item(eff, 'trigger'), 'timing') as string[]) {
        const key = this._timing_to_index_key(timing);
        if (key == null) {
          continue;
        }
        if (timing.startsWith('squad_ammo_consume:')) {
          let bucket = this._squad_notify_index.get(key);
          if (bucket === undefined) { bucket = []; this._squad_notify_index.set(key, bucket); }
          bucket.push([eff, eff_caster]);
        } else if (timing.startsWith('part_hit_count:') || timing.startsWith('body_hit_count:')) {
          let bucket = this._squad_hit_index.get(key);
          if (bucket === undefined) { bucket = []; this._squad_hit_index.set(key, bucket); }
          bucket.push([eff, eff_caster]);
        } else {
          let caster_idx = this._notify_index.get(eff_caster);
          if (caster_idx === undefined) { caster_idx = new Map(); this._notify_index.set(eff_caster, caster_idx); }
          let bucket = caster_idx.get(key);
          if (bucket === undefined) { bucket = []; caster_idx.set(key, bucket); }
          bucket.push([eff, eff_caster]);
        }
      }
    }
  }

  // py: calculator/buff_manager.py:784
  _make_equip_effect(skill_id: string, lv: number | null, fixed_val: number | null = null): Eff | null {
    const entry = get(_EQUIP_SKILLS(), skill_id);
    if (!truthy(entry) || skill_id.startsWith('_')) {
      return null;
    }
    let val: number;
    if (fixed_val != null) {
      val = fixed_val;
    } else {
      val = at(item(entry, 'values'), (lv as number) - 1) * 100;  // 소수 → %
    }
    return {
      'type': 'buff',
      'name': `장비:${skill_id}`,
      'trigger': { 'timing': ['passive'], 'condition': [] },
      'target': 'self',
      'stat': item(entry, 'buff_type'),
      'polarity': 'beneficial',
      'fixed_value': val,
      'duration': null,
      '_source_tag': 'equipment',
      // 소스별 반올림의 그룹 태그(`_quant_group_key`). 종류·수치(=레벨)가 같으면
      // 부위가 달라도 같은 태그가 되어 합산 후 한 번만 반올림된다.
      // (파이썬 `{val!r}` — 그룹 식별에만 쓰는 문자열이다)
      '_quant_group': `equip:${skill_id}:${reprFloat(val)}`,
    };
  }

  // py: calculator/buff_manager.py:807
  /** 큐브 효과 목록. (원본 docstring 참고) */
  _make_cube_effects(cube_name: string, cube_lv: number): Eff[] {
    // 큐브를 안 끼면 «공통»(우월 코드 대미지)도 붙지 않는다 — 그것도 큐브의 스킬이다.
    if (cube_name === '없음') {
      return [];
    }
    const names = ['공통'];
    if (cube_name !== '공통') {
      names.push(cube_name);
    }

    const effects: Eff[] = [];
    for (const nm of names) {
      const entry = get(_CUBE(), nm);
      if (!truthy(entry) || nm.startsWith('_') || truthy(get(entry, 'unsupported'))) {
        continue;
      }
      const vals = get(get(entry, 'values', {}), pystr(cube_lv));
      if (!truthy(vals)) {
        continue;
      }
      let val = float(at(vals, 0));
      // 받는 대미지 감소(이로운) → 음수로 저장 (소장품과 같은 규약)
      if (item(entry, 'stat') === 'received_dmg_pct') {
        val = -val;
      }
      const eff: Eff = {
        'type': get(entry, 'type', 'buff'),
        'name': `큐브:${nm}`,
        'trigger': {
          'timing': [get(entry, 'timing', 'battle_start')],
          'condition': [],
        },
        'target': 'self',
        'stat': item(entry, 'stat'),
        'fixed_value': val,
        '_source_tag': 'cube',
      };
      if (eff['type'] === 'buff') {
        eff['polarity'] = 'beneficial';
        eff['duration'] = null;
      }
      effects.push(eff);
    }
    return effects;
  }

  // py: calculator/buff_manager.py:859
  /** 고급 설정 수치를 기존 효과 파이프라인에 맞춘 개인 효과로 변환. */
  _make_manual_effect(stat: string, value: number): Eff {
    if (stat === 'ammo_charge_flat') {
      return {
        'type': 'instant',
        'name': '고급 설정:10발마다 탄환 충전',
        'trigger': { 'timing': ['hit_count:10'], 'condition': [] },
        'target': 'self',
        'stat': stat,
        'polarity': 'beneficial',
        'fixed_value': value,
        'duration': null,
        '_source_tag': 'manual',
      };
    }
    const is_enemy_reduction = stat === 'enemy_def_down_pct';
    const internal_stat = get({
      'received_dmg_pct': 'personal_received_dmg_pct',
      'enemy_def_down_pct': 'personal_enemy_def_down_pct',
    }, stat, stat);
    return {
      'type': 'buff',
      'name': `고급 설정:${stat}`,
      'trigger': { 'timing': ['battle_start'], 'condition': [] },
      'target': 'self',
      'stat': internal_stat,
      'polarity': value >= 0 ? 'beneficial' : 'harmful',
      // 엔진의 enemy_def_down_pct는 방어력 배율 변화량이라 감소가 음수다.
      'fixed_value': is_enemy_reduction ? -value : value,
      'duration': null,
      '_source_tag': 'manual',
    };
  }

  // py: calculator/buff_manager.py:892
  _make_collection_effects(char: Dict): Eff[] {
    const stage = item(char, 'collection_stage');
    if (stage === NO_ITEM) {        // 미장착 — 플랫 스탯도 스킬도 없다
      return [];
    }
    const entry = get(item(_COLLECTION(), '_stat_table'), stage, null);
    if (entry == null) {
      throw KeyError(
        `[${item(char, 'name')}] 알 수 없는 소장품 단계 ${pyrepr(stage)} — `
        + "'R0'~'R15' · 'SR0'~'SR15' 또는 '없음'(미장착)");
    }
    const skill_lv = item(entry, 'skill_lv');
    const idx = skill_lv - 1;
    const rarity_prefix = (stage as string).startsWith('SR') ? 'SR' : 'R';
    const weapon = item(item(_NIKKE(), item(char, 'name')), 'weapon_type');
    const effects: Eff[] = [];

    // common 스킬들 (스킬 이름 키 — 정수 모양이 아니라 객체 순서 = 파이썬 삽입 순서)
    for (const [, skill_data] of Object.entries(item(_COLLECTION(), 'common') as Dict)) {
      if (!has(skill_data, rarity_prefix)) {
        continue;
      }
      let val = at(item(skill_data, rarity_prefix), idx);
      // received_dmg_pct는 감소(이로운) → 음수로 저장
      if (item(skill_data, 'buff_type') === 'received_dmg_pct') {
        val = -val;
      }
      effects.push({
        'type': 'buff',
        'name': '소장품:공통',
        'trigger': { 'timing': ['passive'], 'condition': [] },
        'target': 'self',
        'stat': item(skill_data, 'buff_type'),
        'polarity': 'beneficial',
        'fixed_value': float(val),
        'duration': null,
        '_source_tag': 'collection',
      });
    }

    // 무기군 스킬
    const weapon_data = get(_COLLECTION(), weapon);
    if (truthy(weapon_data) && has(weapon_data, rarity_prefix)) {
      const val = at(item(weapon_data, rarity_prefix), idx);
      effects.push({
        'type': 'buff',
        'name': `소장품:${weapon}`,
        'trigger': { 'timing': ['passive'], 'condition': [] },
        'target': 'self',
        'stat': item(weapon_data, 'buff_type'),
        'polarity': 'beneficial',
        'fixed_value': float(val),
        'duration': null,
        '_source_tag': 'collection',
      });
    }

    return effects;
  }

  // ── instant 콜백 등록 ─────────────────────────────────────────────────

  // py: calculator/buff_manager.py:947
  /** 타임라인이 damage 효과 핸들러를 등록한다. handler(eff, caster, t) 시그니처. */
  register_damage_handler(handler: Handler | null): void {
    this._damage_handler = handler;
  }

  // py: calculator/buff_manager.py:956
  /** 타임라인이 버프 활성/만료 이벤트 콜백을 등록한다. handler(kind, name, caster, target, t, expires_at, ...) */
  register_buff_event_handler(handler: Handler | null): void {
    this._buff_event_handler = handler;
  }

  // py: calculator/buff_manager.py:963
  /** 타임라인이 instant stat 핸들러를 등록한다. handler(eff, caster, t, val) 시그니처. */
  register_instant_handler(stat: string, handler: Handler): void {
    this._instant_handlers.set(stat, handler);
  }

  // py: calculator/buff_manager.py:971
  /** 타임라인이 instant 발동 로그 콜백을 등록한다. handler(name, caster, target, t, stat, value) */
  register_instant_event_handler(handler: Handler | null): void {
    this._instant_event_handler = handler;
  }

  // py: calculator/buff_manager.py:977
  /** 타임라인이 버스트 게이지 가산 로그 콜백을 등록한다. handler(t, caster, source, amount, gauge) */
  register_gauge_event_handler(handler: Handler | null): void {
    this._gauge_event_handler = handler;
  }

  // py: calculator/buff_manager.py:983
  /** 조건부 유한 passive 목록을 `_effects`에서 뽑는다. 등록이 끝난 뒤 한 번 부른다. */
  _build_cond_finite_passives(): void {
    this._cond_finite_passives = this._effects.filter(([eff]) => _is_cond_finite_passive(eff))
      .map(([eff, caster]) => [eff, caster] as [Eff, string]);
  }

  // py: calculator/buff_manager.py:989
  /** 이 효과를 지금 걸면 언제 만료되는가. 종료 조건이 없으면 `inf`. */
  _expires_at(eff: Eff, caster: string, t: number): number {
    let duration = get(eff, 'duration');
    if (duration == null && has(eff, 'duration_values')) {
      const char = get(this._char, caster, {});
      const skill_lv = _get_skill_lv(char, eff);
      const dv = item(eff, 'duration_values');
      duration = float(get(dv, skill_lv, get(dv, '10', 0.0)));
    }
    return duration == null || duration === -1 ? Infinity : t + float(duration);
  }

  // ── 버스트 게이지 (실누적) ─────────────────────────────────────────────
  // py: calculator/buff_manager.py:1000
  /** 공용 버스트 게이지에 가산하고 실제로 들어간 양을 돌려준다. (원본 docstring 참고) */
  add_burst_gauge(amount: number, t: number, caster: string = '', source: string = ''): number {
    if (amount <= 0.0 || !truthy(get(this.state, 'burst_gauge_charging', false))) {
      return 0.0;
    }
    const cur = get(this.state, 'burst_gauge', 0.0);
    const new_ = pmin(100.0, cur + amount);
    this.state['burst_gauge'] = new_;
    const added = new_ - cur;
    if (this._gauge_event_handler != null && added > 0.0) {
      this._gauge_event_handler(t, caster, source, added, new_);
    }
    return added;
  }

  // py: calculator/buff_manager.py:1025
  /** 1단계 진입이 게이지를 0으로 소모한다. 소모량을 로그(`consume`)에 남기고 돌려준다. */
  consume_burst_gauge(t: number): number {
    const cur = get(this.state, 'burst_gauge', 0.0);
    this.state['burst_gauge'] = 0.0;
    if (this._gauge_event_handler != null && cur > 0.0) {
      this._gauge_event_handler(t, '', 'consume', -cur, 0.0);
    }
    return cur;
  }

  // py: calculator/buff_manager.py:1037
  /** 일반 공격 첫 명중을 기록하고 버충속 집계 캐시를 갱신한다. */
  mark_normal_attack_landed(caster: string): void {
    const landed = setdefault(this.state, 'normal_attack_landed', new Set<string>());
    if (!inContainer(landed, caster)) {
      if (landed instanceof Set) landed.add(caster);
      else if (Array.isArray(landed)) (landed as any[]).push(caster);
      else (landed as any)[caster] = true;
      this._invalidate_buffs_cache();
    }
  }

  // py: calculator/buff_manager.py:1049
  /** 같은 버충속 값을 시전자 기준 히트당 게이지(%p)로 환산한다. */
  _route_burst_charge(ab: ActiveBuff, buff_key: string, val: number): [string, number] {
    if (buff_key !== 'burst_charge_speed_flat') {
      return [buff_key, val];
    }
    const weapon = get(_NIKKE(), ab.caster, {});
    let reference: number;
    if (inContainer(get(this.state, 'normal_attack_landed', []), ab.caster)) {
      reference = get(weapon, 'burst_energy', 0.0);
    } else {
      reference = get(weapon, 'burst_energy_raw', get(weapon, 'burst_energy', 0.0) / 2.0);
    }
    return [buff_key, reference * val / 100.0];
  }

  // py: calculator/buff_manager.py:1065
  /** 이 캐스터의 효과가 쓰는 `pellet_hit_in_shot:N` 임계값 — `(값, 원문 표기)`. */
  pellet_in_shot_thresholds(caster: string): Array<[number, string]> {
    const cached = this._pellet_in_shot_cache.get(caster);
    if (cached !== undefined) {
      return cached;
    }
    const found = new Map<string, number>();
    for (const [eff, eff_caster] of this._effects) {
      if (eff_caster !== caster) {
        continue;
      }
      for (const timing of item(item(eff, 'trigger'), 'timing') as string[]) {
        if (!timing.startsWith('pellet_hit_in_shot:')) {
          continue;
        }
        const raw = pysplit(timing, ':', 1)[1]!;
        try {
          found.set(raw, int(raw));
        } catch {
          continue;
        }
      }
    }
    const result = sorted([...found.entries()].map(([raw, v]) => [v, raw] as [number, string]));
    this._pellet_in_shot_cache.set(caster, result);
    return result;
  }

  // py: calculator/buff_manager.py:1091
  /** `debuff_immune_count` 잔량이 있으면 하나 쓰고 True. */
  _consume_immune_charge(name: string): boolean {
    const cap = new Map<string, number>();
    for (const ab of this._active) {
      if (abStat(ab) !== 'debuff_immune_count') {
        continue;
      }
      if (!(or(ab.target_chars, []) as string[]).includes(name)) {
        continue;
      }
      const val = this._get_value(ab.effect, ab, name);
      if (val == null) {
        continue;
      }
      const key = abName(ab, '');
      cap.set(key, pmax(cap.has(key) ? cap.get(key)! : 0.0, float(val)));
    }
    for (const [key, total] of cap) {
      const k = tupleKey(name, key);
      const used = this._immune_used.has(k) ? this._immune_used.get(k)! : 0.0;
      if (used < total) {
        this._immune_used.set(k, used + 1.0);
        return true;
      }
    }
    return false;
  }

  // py: calculator/buff_manager.py:1116
  /**
   * instant 효과를 핸들러로 라우팅하거나 내장 로직으로 처리.
   * `from_tick=True`는 주기 instant의 매 틱 재발동 — 로그와 타이머 등록을 건너뛰고 효과만 적용한다.
   */
  _dispatch_instant(eff: Eff, caster: string, t: number, from_tick: boolean = false): void {
    const stat = get(eff, 'stat', '');
    const char = get(this._char, caster, {});
    const skill_lv = _get_skill_lv(char, eff);

    let val: number | null;
    if (has(eff, 'fixed_value')) {
      val = float(eff['fixed_value']);
    } else if (has(eff, 'values')) {
      const vals = eff['values'];
      val = float(get(vals, skill_lv, get(vals, '10', 0.0)));
    } else {
      val = null;
    }

    // ── instant 이벤트 로그 (처리 전 먼저 기록) ────────────────────────
    if (!from_tick && truthy(this._instant_event_handler) && truthy(get(eff, 'name'))) {
      const raw_target = get(eff, 'target', 'self');
      let _log_targets: string[];
      if (raw_target === 'self') {
        _log_targets = [caster];
      } else if (raw_target === 'all' || raw_target === 'squad') {
        _log_targets = Object.keys(this._char);
      } else {
        _log_targets = has(this._char, raw_target) ? [raw_target] : [caster];
      }
      for (const _tgt of _log_targets) {
        this._instant_event_handler!(eff['name'], caster, _tgt, t, stat, val);
      }
    }

    // ── 주기 instant(tick_interval) 타이머 등록 ────────────────────────
    // 첫 발동은 **등록 시점이 아니라 t + tick_interval**이다. (원본 주석 참고)
    const tick_interval = get(eff, 'tick_interval');
    if (truthy(tick_interval) && !from_tick) {
      const duration = get(eff, 'duration');
      const expires = duration == null || duration === -1 ? Infinity : t + float(duration);
      this._instant_timers.set(eff, [caster, t + tick_interval, expires]);
      return;
    }

    if (stat === 'bunny_mode_switch') {
      const modes = setdefault(this.state, 'bunny_modes', {} as Dict);
      const old = get(modes, caster, null);
      let mode = get(eff, 'mode', 'toggle');
      if (mode === 'toggle') {
        mode = old === 'stance' ? 'engage' : 'stance';
      }
      const opposite = mode === 'engage' ? 'stance' : 'engage';
      const recipients = [caster, ...this.squad_names.filter(
        (n) => n !== caster && get(modes, n, null) === opposite)];
      const labels: Dict = { 'stance': '바니 모드 : 스탠스', 'engage': '바니 모드 : 인게이지' };
      // Snapshot recipients before changing anything; propagation sets, never toggles.
      for (const name of recipients) {
        const previous = get(modes, name, null);
        if (previous === mode) {
          continue;
        }
        modes[name] = mode;
        if (truthy(this._buff_event_handler)) {
          if (truthy(previous)) {
            this._buff_event_handler!('expire', item(labels, previous), caster, name, t, t);
          }
          this._buff_event_handler!('activate', item(labels, mode), caster, name, t, Infinity);
        }
      }
      this._invalidate_buffs_cache();
      for (const name of recipients) {
        this.notify(`event:${item(labels, mode)}`, t, name);
      }
      return;
    }

    // ── 내장 처리 ──────────────────────────────────────────────────────

    // force_skill_use — `[스킬 N 강제 사용]` (원본 주석 참고)
    if (stat === 'force_skill_use') {
      const slot = get(eff, 'target_skill');
      if (!truthy(slot)) {
        throw ValueError(`[${caster}] force_skill_use에 target_skill이 없다: ${pystr(get(eff, 'name'))}`);
      }
      for (const other of this.char_effects(caster)) {
        if (get(other, 'source', null) !== slot || other === eff) {
          continue;
        }
        if (this._condition_ok(get(item(other, 'trigger'), 'condition', []), caster, t, other)) {
          this._activate(other, caster, t);
        }
      }
      return;
    }

    // feather_refresh — 소환체를 슬롯 단위로 (재)소환 (아인 니어 페더)
    if (stat === 'feather_refresh') {
      const fid = get(eff, 'feather_id');
      const slots: any[] = or(get(eff, 'feather_slots'), []);
      if (!truthy(fid) || !truthy(slots)) {
        return;
      }
      const base = float(get(eff, 'feather_interval_base', 8.0));
      const reduction = float(get(eff, 'feather_interval_reduction_pct', 0.0)) / 100.0;
      const st = setdefault(setdefault(this.state, 'feathers', {} as Dict), caster, {} as Dict);
      st[fid] = {
        'expiry': slots.map((d) => (float(d) < 0 ? Infinity : t + float(d))),
        'next_t': t + pmax(0.001, base * (1.0 - reduction * (slots.length - 1))),
        'base': base,
        'reduction': reduction,
      };
      return;
    }

    // skill_cooldown_reduce_pct — 스킬 재사용 시간 N% ▼ (즉시 1회)
    if (stat === 'skill_cooldown_reduce_pct') {
      if (!truthy(val)) {
        return;
      }
      const factor = pmax(0.0, 1.0 - float(val!) / 100.0);
      const target_chars = new Set(this._resolve_target(get(eff, 'target', 'self'), caster));
      for (const [_eff, _caster] of this._effects) {
        if (!target_chars.has(_caster)) {
          continue;
        }
        if (!(item(item(_eff, 'trigger'), 'timing') as string[]).some((tm) => tm.startsWith('every:'))) {
          continue;
        }
        const entry = this._next_fire.get(_eff);
        if (entry === undefined) {
          continue;
        }
        const [next_t, interval] = entry;
        this._next_fire.set(_eff, [t + pmax(0.0, next_t - t) * factor, interval]);
      }
      return;
    }

    // Generic stack addition changes existing beneficial stacks on the recipients.
    // It neither raises their caps nor creates a buff which has not been applied.
    if (stat === 'buff_stack_add' && !truthy(get(eff, 'target_effect'))) {
      const targets = new Set(this._resolve_target(get(eff, 'target', 'self'), caster));
      const changed: Array<[ActiveBuff, string, number, number]> = [];
      const reached: Array<[string, number, string]> = [];
      for (const ab of [...this._active]) {
        const maximum = get(ab.effect, 'max_stack', 1);
        if (get(ab.effect, 'type') !== 'buff' || get(ab.effect, 'polarity') !== 'beneficial'
            || maximum === 1 || t >= ab.expires_at) {
          continue;
        }
        const recipients = ab.target_chars == null ? this._resolve_lazy(ab) : ab.target_chars;
        const affected = recipients.filter((n) => targets.has(n)
          && !this._has_immune(n, 'stack_change_immune'));
        if (!truthy(affected)) {
          continue;
        }
        if (recipients.length > 1 && !truthy(ab.per_char_stacks)) {
          const pcs: Record<string, number> = {};
          for (const n of recipients) pcs[n] = ab.stack;
          ab.per_char_stacks = pcs;
        }
        for (const recipient of affected) {
          const previous = get(ab.per_char_stacks, recipient, ab.stack);
          const cap = this._effective_stack_cap(ab.effect, recipient, t);
          let count = previous + int(or(val, 1) as number);
          if (maximum !== -1) {
            count = pmin(count, cap);
          }
          if (count === previous) {
            continue;
          }
          const old_hp = this.effective_max_hp(recipient);
          if (truthy(ab.per_char_stacks)) {
            ab.per_char_stacks[recipient] = count;
          } else {
            ab.stack = count;
          }
          changed.push([ab, recipient, this.effective_max_hp(recipient) - old_hp, count]);
          if (truthy(abName(ab)) && recipient === ab.caster) {
            reached.push([ab.effect['name'], count, ab.caster]);
          }
        }
      }
      this._invalidate_buffs_cache();
      for (const [ab, recipient, hp_delta, count] of changed) {
        if (has(get(this.state, 'hp', {}), recipient)) {
          const st = abStat(ab);
          if (st === 'max_hp_pct' || st === 'hp_caster_based_pct') {
            this.state['hp'][recipient] += pmax(0, hp_delta);
          }
          this.sync_hp(recipient);
        }
        if (truthy(this._buff_event_handler) && truthy(abName(ab))) {
          this._buff_event_handler!('activate', ab.effect['name'], ab.caster, recipient,
            t, ab.expires_at, this._get_value(ab.effect, ab, recipient),
            abStat(ab, null), count, get(ab.effect, 'max_stack', 1));
        }
      }
      for (const [name, count, owner] of reached) {
        this.notify(`stack_reach:${name}:${count}`, t, owner);
      }
      return;
    }

    // buff_stack_add / buff_stack_remove
    if (stat === 'buff_stack_add' || stat === 'buff_stack_remove') {
      const target_name = get(eff, 'target_effect', '');
      const delta = stat === 'buff_stack_add' ? int(or(val, 1) as number) : -int(or(val, 1) as number);
      // notify는 _active를 다시 건드릴 수 있으므로 루프를 다 돈 뒤에 emit한다
      const reached: Array<[string, number, string]> = [];
      for (const ab of this._active) {
        if (abName(ab, null) !== target_name) {
          continue;
        }
        const affected = (or(ab.target_chars, []) as string[]).filter((c) => c === caster);
        if (!truthy(affected)) {
          continue;
        }
        // stack_change_immune인 대상은 건너뜀
        if (affected.some((c) => this._has_immune(c, 'stack_change_immune'))) {
          continue;
        }
        const max_s = get(ab.effect, 'max_stack', 1);
        let cap = this._effective_stack_cap(ab.effect, caster, t);
        if (max_s === -1) {
          cap = ab.stack + delta;
        }
        const prev_stack = ab.stack;
        ab.stack = pmax(1, pmin(ab.stack + delta, cap));
        // 스택 부여는 "버프를 다시 붙이는" 동작이라 지속시간도 갱신한다. _activate()와 같은 규칙.
        if (delta > 0 && ab.expires_at !== Infinity) {
          const duration = get(ab.effect, 'duration');
          if (duration != null && duration > 0) {
            this._invalidate_buffs_cache();
            ab.activated_at = t;
            ab.expires_at = t + duration;
          }
        }
        if (ab.stack !== prev_stack) {
          this._invalidate_buffs_cache();
          if (delta > 0 && truthy(abName(ab))) {
            reached.push([ab.effect['name'], ab.stack, ab.caster]);
          }
        }
        if (truthy(this._buff_event_handler) && truthy(abName(ab))) {
          const new_val = this._get_value(ab.effect, ab);
          for (const tgt of affected) {
            this._buff_event_handler!(
              'activate', ab.effect['name'], ab.caster, tgt,
              t, ab.expires_at, new_val, abStat(ab, null),
              ab.stack, get(ab.effect, 'max_stack', 1),
            );
          }
        }
      }
      // 스택이 새 값에 도달했으면 stack_reach 이벤트 발생 (_activate()와 동일)
      for (const [name, stack, ab_caster] of reached) {
        this.notify(`stack_reach:${name}:${stack}`, t, ab_caster);
      }
      return;
    }

    // buff_stack_init: 대상 버프를 N 스택으로 초기 생성 (없을 때만)
    if (stat === 'buff_stack_init') {
      const target_name = get(eff, 'target_effect', '');
      const init_count = int(or(val, 1) as number);
      const already = this._active.some(
        (ab) => abName(ab, null) === target_name && (or(ab.target_chars, []) as string[]).includes(caster),
      );
      if (!already && init_count > 0 && truthy(target_name)) {
        let target_eff: Eff | null = null;
        for (const [e, ec] of this._effects) {
          if (get(e, 'name', null) === target_name && ec === caster && get(e, 'type') === 'buff') {
            target_eff = e;
            break;
          }
        }
        if (target_eff != null) {
          const raw_target = get(target_eff, 'target', 'self');
          const lazy = typeof raw_target === 'string' && _startswith_lazy(raw_target);
          const targets = lazy ? null : this._resolve_target(raw_target, caster);
          const max_s = get(target_eff, 'max_stack', 1);
          const init_stack = pmin(init_count, max_s !== -1 ? max_s : init_count);
          const duration = get(target_eff, 'duration');
          const expires = duration == null || duration === -1 ? Infinity : t + duration;
          this._invalidate_buffs_cache();
          const ab_new = new ActiveBuff({
            effect: target_eff,
            caster: caster,
            target_chars: targets,
            activated_at: t,
            expires_at: expires,
            stack: init_stack,
            has_runtime_conditions: _has_runtime_cond(get(item(target_eff, 'trigger'), 'condition', []), expires, get(target_eff, 'duration_bullets', -1)),
            scaling_stack: this._capture_scaling_stack(target_eff, caster),
          });
          this._active.push(ab_new);
          if (truthy(this._buff_event_handler) && truthy(target_name) && truthy(targets)) {
            const new_val = this._get_value(target_eff, ab_new, caster);
            for (const tgt of targets!) {
              this._buff_event_handler!(
                'activate', target_name, caster, tgt,
                t, expires, new_val, get(target_eff, 'stat', null),
                init_count, get(target_eff, 'max_stack', 1),
              );
            }
          }
        }
      }
      return;
    }

    // debuff_stack_add / debuff_stack_remove
    if (stat === 'debuff_stack_add' || stat === 'debuff_stack_remove') {
      const target_name = get(eff, 'target_effect', '');
      // scaling:stack_count + scaling_ref → 참조 게이지/스택 값을 delta로 사용
      let raw_delta = int(or(val, 1) as number);
      if (get(eff, 'scaling') === 'stack_count') {
        const ref_val = this.ref_count(caster, get(eff, 'scaling_ref', ''));
        if (ref_val != null) {
          raw_delta = ref_val;
        }
      }
      const delta = stat === 'debuff_stack_add' ? raw_delta : -raw_delta;
      const target_chars = this._resolve_target(get(eff, 'target', 'self'), caster);
      for (const ab of this._active) {
        if (truthy(target_name)) {
          // 특정 버프명 지정: 이름 일치 여부로 필터
          if (abName(ab, null) !== target_name) {
            continue;
          }
        } else {
          // target_effect 미지정: 중첩 가능한(max_stack > 1) harmful 버프 전체에 적용
          if (get(ab.effect, 'polarity') !== 'harmful') {
            continue;
          }
          if (get(ab.effect, 'max_stack', 1) <= 1) {
            continue;
          }
        }
        let affected = target_chars.filter((tc) => (or(ab.target_chars, []) as string[]).includes(tc));
        if (!truthy(affected)) {
          continue;
        }
        // stack_change_immune인 대상은 건너뜀
        affected = affected.filter((c) => !this._has_immune(c, 'stack_change_immune'));
        if (!truthy(affected)) {
          continue;
        }
        const max_s = get(ab.effect, 'max_stack', 1);
        const cap = max_s !== -1 ? max_s : ab.stack + delta;
        if (truthy(target_name)) {
          ab.stack = pmax(0, pmin(ab.stack + delta, cap));
        } else {
          // 중첩 가능 해로운 효과 범용 감소: 완전 제거 불가, 최소 1스택 유지
          ab.stack = pmax(1, pmin(ab.stack + delta, cap));
        }
        this._invalidate_values();
        // 스택 변화를 buff_event_handler에 알려 UI 타임라인 갱신
        if (truthy(this._buff_event_handler) && truthy(abName(ab))) {
          const new_val = this._get_value(ab.effect, ab);
          for (const tgt of affected) {
            this._buff_event_handler!(
              'activate', ab.effect['name'], ab.caster, tgt,
              t, ab.expires_at, new_val, abStat(ab, null),
              ab.stack, get(ab.effect, 'max_stack', 1),
            );
          }
        }
      }
      return;
    }

    // debuff_cleanse: 대상의 harmful 버프 제거 (harmful_irremovable은 제거 불가)
    if (stat === 'debuff_cleanse') {
      const target_chars = this._resolve_target(get(eff, 'target', 'self'), caster);
      this._invalidate_buffs_cache();
      this._active = this._active.filter(
        (ab) => !(
          get(ab.effect, 'polarity') === 'harmful'
          && target_chars.some((tc) => (or(ab.target_chars, []) as string[]).includes(tc))
        ),
      );
      return;
    }

    // remove_named_buff: 특정 name의 버프 즉시 제거 (_active + _dot_timers 모두)
    if (stat === 'remove_named_buff') {
      const target_name = get(eff, 'target_effect', '');
      const to_remove = this._active.filter((ab) => abName(ab, null) === target_name);
      const removed_ids = new Set<object>(to_remove.map((ab) => ab.effect));
      this._invalidate_buffs_cache();
      this._active = this._active.filter(
        (ab) => abName(ab, null) !== target_name,
      );
      for (const eid of removed_ids) {
        this._dot_timers.delete(eid);
        this._instant_timers.delete(eid);
      }
      if (truthy(this._buff_event_handler)) {
        for (const ab of to_remove) {
          if (truthy(abName(ab))) {
            for (const tgt of (or(ab.target_chars, []) as string[])) {
              this._buff_event_handler!('expire', ab.effect['name'], ab.caster, tgt, t, t);
            }
          }
        }
      }
      // 이름 있는 버프가 제거되면 그 상태는 끝난 것이다 — 만료 경로(tick)와 동일하게 state_end.
      // notify는 순회가 끝난 뒤 emit — 순회 중 emit하면 재진입으로 `_active`가 바뀐다.
      for (const _ab of to_remove) {
        const _n = get(_ab.effect, 'name');
        if (truthy(_n)) {
          this.notify(`event:state_end:${_n}`, t, _ab.caster);
        }
      }
      return;
    }

    // trigger_count_reduce: target_effect 버프의 스택을 fixed_value만큼 감소, 0이 되면 제거
    if (stat === 'trigger_count_reduce') {
      const target_name = get(eff, 'target_effect', '');
      const reduce = int(or(val, 1) as number);
      const to_remove: number[] = [];
      for (const ab of this._active) {
        if (abName(ab, null) !== target_name) {
          continue;
        }
        if (!(or(ab.target_chars, []) as string[]).includes(caster)) {
          continue;
        }
        ab.stack = pmax(0, ab.stack - reduce);
        this._invalidate_values();
        if (ab.stack <= 0) {
          to_remove.push(ab.uid);
        }
      }
      if (truthy(to_remove)) {
        this._invalidate_buffs_cache();
      }
      this._active = this._active.filter((ab) => !to_remove.includes(ab.uid));
      return;
    }

    // gauge_charge / gauge_consume / gauge_consume_as_ammo
    if (stat === 'gauge_charge' || stat === 'gauge_consume' || stat === 'gauge_consume_as_ammo') {
      const gauge_id = get(eff, 'gauge_id', '');
      if (!truthy(gauge_id) || val == null) {
        return;
      }
      const gauges = setdefault(setdefault(this.state, 'gauges', {} as Dict), caster, {} as Dict);
      const gauge_max_key = `_gauge_max:${gauge_id}`;

      // gauge_max가 처음 선언된 항목에서 기본 최대값 등록
      if (has(eff, 'gauge_max')) {
        this.state['gauges'][caster][gauge_max_key] = float(eff['gauge_max']);
      }

      const current = get(gauges, gauge_id, 0.0);
      if (stat === 'gauge_charge') {
        const new_val = current + val;
        const base_cap = get(gauges, gauge_max_key, Infinity);
        // 활성 gauge_max_add buff 합산
        const add_cap = sum(
          this._active
            .filter((ab) => ab.caster === caster
              && abStat(ab) === 'gauge_max_add'
              && get(ab.effect, 'gauge_id', null) === gauge_id)
            .map((ab) => get(ab.effect, 'fixed_value', 0.0) as number),
        );
        const cap = base_cap + add_cap;
        gauges[gauge_id] = pmin(new_val, cap);
      } else {  // gauge_consume / gauge_consume_as_ammo
        let consumed: number;
        if (val === -1.0) {  // fixed_value: -1 = 전체 소모
          consumed = current;
          gauges[gauge_id] = 0.0;
        } else {
          consumed = pmin(val, current);
          gauges[gauge_id] = pmax(0.0, current - val);
        }
        // gauge_consume_as_ammo: 실제 소모량만큼 squad_ammo_consume 이벤트 발생
        if (stat === 'gauge_consume_as_ammo' && consumed > 0) {
          const n = int(consumed);
          for (let _i = 0; _i < n; _i += 1) {
            this.notify('squad_ammo_consume', t, caster);
          }
        }
      }
      return;
    }

    // squad_ammo_consume_as: "탄환 소모 N발" 표기 — 실제 장탄은 1발만 줄고,
    // 아군 탄 소비 총합 카운터에만 N발로 계상된다. 발사 자체가 이미 1발을 계상했으므로 N-1발만 추가.
    if (stat === 'squad_ammo_consume_as') {
      const extra = int(or(val, 0) as number) - 1;
      const n = pmax(0, extra);
      for (let _i = 0; _i < n; _i += 1) {
        this.notify('squad_ammo_consume', t, caster);
      }
      return;
    }

    // named_buff_duration_extend: target_effect 이름의 활성 버프 _end_t += fixed_value
    if (stat === 'named_buff_duration_extend') {
      const target_name = get(eff, 'target_effect', '');
      if (truthy(target_name) && val != null) {
        const extend_targets = new Set(this._resolve_target(get(eff, 'target', 'self'), caster));
        const prefix = target_name + ' ';
        for (const ab of this._active) {
          const ab_name: string = abName(ab, '');
          if (ab_name !== target_name && !ab_name.startsWith(prefix)) {
            continue;
          }
          if (ab.expires_at === Infinity) {
            continue;
          }
          // set.intersection — 파이썬은 문자열 set 순회 순서가 실행마다 다르다(로그 순서만 영향).
          // 여기서는 extend_targets 순서로 고정한다.
          const abt = new Set(or(ab.target_chars, []) as string[]);
          const affected = [...extend_targets].filter((x) => abt.has(x));
          if (!truthy(affected)) {
            continue;
          }
          ab.expires_at += val;
          // DoT는 틱 스케줄이 _dot_timers에 별도로 복사돼 있다. (원본 주석 참고)
          const dot = this._dot_timers.get(ab.effect);
          if (dot !== undefined) {
            const [d_caster, d_next] = dot;
            this._dot_timers.set(ab.effect, [d_caster, d_next, ab.expires_at]);
          }
          if (truthy(this._buff_event_handler) && truthy(abName(ab))) {
            const new_val = this._get_value(ab.effect, ab);
            for (const tgt of affected) {
              this._buff_event_handler!(
                'activate', ab.effect['name'], ab.caster, tgt,
                t, ab.expires_at, new_val, abStat(ab, null),
                ab.stack, get(ab.effect, 'max_stack', 1),
              );
            }
          }
        }
      }
      return;
    }

    // ── 외부 핸들러 ────────────────────────────────────────────────────
    const handler = this._instant_handlers.get(stat);
    if (truthy(handler)) {
      handler!(eff, caster, t, val);
    }
  }

  // ── 이벤트 통지 ───────────────────────────────────────────────────────

  // py: calculator/buff_manager.py:1601
  /**
   * 타임라인이 이벤트 발생 시 호출. 파이썬 `**ctx` → 마지막 인자 객체(count, hit_crit, core_frac,
   * pellet_probability …). ctx는 `_notify_ctx`에 실어 `_condition_ok`가 읽고, 끝나면 반드시 되돌린다.
   *
   * event: "battle_start", "full_burst_start", "hit_count", "burst_cast",
   *        "full_charge_hit", "enemy_death", ... (timing 값과 동일 형식)
   */
  notify(event: string, t: number, caster: string, ctx: Dict = {}): void {
    const prev_ctx = this._notify_ctx;
    this._notify_ctx = ctx;
    try {
      this._notify(event, t, caster);
    } finally {
      this._notify_ctx = prev_ctx;
    }
  }

  // py: calculator/buff_manager.py:1627
  _notify(event: string, t: number, caster: string): void {
    this._cur_t = t;
    // squad_ammo_consume: 스쿼드 전체 탄환 소비 카운터 — caster와 무관하게 합산, 모든 스쿼드원 효과 순회
    if (event === 'squad_ammo_consume') {
      let team_counts = this._event_counts.get('__squad__');
      if (team_counts === undefined) { team_counts = new Map(); this._event_counts.set('__squad__', team_counts); }
      team_counts.set(event, (team_counts.has(event) ? team_counts.get(event)! : 0) + 1);
      const current_count = team_counts.get(event)!;
      for (const [eff, eff_caster] of (this._squad_notify_index.get(event) ?? [])) {
        for (const timing of item(item(eff, 'trigger'), 'timing') as string[]) {
          if (this._timing_match(timing, event, current_count, t, eff, eff_caster)) {
            if (this._condition_ok(get(item(eff, 'trigger'), 'condition', []), eff_caster, t, eff)) {
              this._activate(eff, eff_caster, t);
            }
            break;
          }
        }
      }
      return;
    }

    let counts = this._event_counts.get(caster);
    if (counts === undefined) { counts = new Map(); this._event_counts.set(caster, counts); }
    counts.set(event, (counts.has(event) ? counts.get(event)! : 0) + 1);
    const current_count = counts.get(event)!;

    const caster_idx = this._notify_index.get(caster);
    const index_event = event.startsWith('multi_hit:') ? 'multi_hit' : event;
    const candidates = (caster_idx !== undefined ? caster_idx.get(index_event) : undefined) ?? [];

    for (const [eff] of candidates) {
      for (const timing of item(item(eff, 'trigger'), 'timing') as string[]) {
        if (this._timing_match(timing, event, current_count, t, eff, caster)) {
          const is_passive = (timing === 'passive');
          if (is_passive) {
            const conditions = get(item(eff, 'trigger'), 'condition', []);
            const cond_met = !truthy(conditions) || this._condition_ok(conditions, caster, t, eff);
            if (_is_cond_finite_passive(eff)) {
              // 유한 지속은 조건이 거짓이면 아예 걸지 않는다. (원본 주석 참고)
              if (cond_met) {
                this._activate(eff, caster, t);
              }
            } else {
              this._activate(eff, caster, t, !cond_met);
            }
          } else if (this._condition_ok(get(item(eff, 'trigger'), 'condition', []), caster, t, eff)) {
            this._activate(eff, caster, t);
          }
          break;
        }
      }
    }
  }

  // py: calculator/buff_manager.py:1669
  /** part_hit / body_hit 스쿼드 브로드캐스트. (원본 docstring 참고) */
  notify_team_hit(event: string, t: number, attacker: string): void {
    let team_counts = this._event_counts.get('__squad__');
    if (team_counts === undefined) { team_counts = new Map(); this._event_counts.set('__squad__', team_counts); }
    team_counts.set(event, (team_counts.has(event) ? team_counts.get(event)! : 0) + 1);
    const current_count = team_counts.get(event)!;
    for (const [eff, eff_caster] of (this._squad_hit_index.get(event) ?? [])) {
      for (const timing of item(item(eff, 'trigger'), 'timing') as string[]) {
        if (this._timing_match(timing, event, current_count, t, eff, eff_caster)) {
          if (this._condition_ok(get(item(eff, 'trigger'), 'condition', []), eff_caster, t, eff)) {
            this._activate(eff, attacker, t);
          }
          break;
        }
      }
    }
  }

  // py: calculator/buff_manager.py:1687
  /** 활성화된 trigger_count_reduce 버프가 eff를 대상으로 하면 n을 감소시킨다. 최솟값 1. */
  _apply_trigger_count_reduce(n: number, eff: Eff, caster: string, t: number): number {
    if (!truthy(caster)) {
      return n;
    }
    const eff_timings = new Set<string>(get(get(eff, 'trigger', {}), 'timing', []));
    let reduce = 0.0;
    for (const ab of this._active) {
      if (ab.caster !== caster) {
        continue;
      }
      if (abStat(ab) !== 'trigger_count_reduce') {
        continue;
      }
      if (!(ab.expires_at === Infinity || ab.expires_at > t)) {
        continue;
      }
      const target_name = get(ab.effect, 'target_effect', '');
      if (!truthy(target_name)) {
        continue;
      }
      // eff 자신이 target이거나, 같은 timing 그룹의 다른 effect가 target인 경우
      if (get(eff, 'name', null) === target_name) {
        reduce += get(ab.effect, 'fixed_value', 0.0);
      } else {
        for (const [reg_eff, reg_caster] of this._effects) {
          if (reg_caster !== caster) {
            continue;
          }
          if (get(reg_eff, 'name', null) !== target_name) {
            continue;
          }
          const reg_timings: string[] = get(get(reg_eff, 'trigger', {}), 'timing', []);
          if (reg_timings.some((x) => eff_timings.has(x))) {
            reduce += get(ab.effect, 'fixed_value', 0.0);
            break;
          }
        }
      }
    }
    return pmax(1, n - int(reduce));
  }

  // py: calculator/buff_manager.py:1723
  /** timing 문자열과 현재 이벤트가 매칭되는지 확인. */
  _timing_match(timing: string, event: string, count: number, t: number, eff: Eff, caster: string = ''): boolean {
    // passive: battle_start에 한 번 등록 (영구 지속)
    if (timing === 'passive') {
      return event === 'battle_start';
    }

    // on_attack: auto(_fire)와 charge(_tick_charge) 양쪽에서 직접 notify
    if (timing === 'on_attack' && event === 'on_attack') {
      return true;
    }

    // battle_start, full_burst_start, full_burst_end, ...
    if (timing === event && !timing.startsWith('multi_hit:')) {
      return true;
    }

    // every:Ns: 내부 타이머로 관리 (tick에서 처리), notify에서는 무시
    if (timing.startsWith('every:')) {
      return false;
    }

    // on_attack_count:N — `일반 공격 N회 공격 시`. 발사 1회당 1씩 오른다.
    if (timing.startsWith('on_attack_count:') && event === 'on_attack') {
      const raw = timing.split(':')[1]!;
      if (!isdigit(lstripDash(raw))) return false;
      const n = this._apply_trigger_count_reduce(int(raw), eff, caster, t);
      return n > 0 && pymod(count, n) === 0;
    }

    // burst_cast_count:N — N번째 이후 버스트마다 누적 발동 (count >= N)
    if (timing.startsWith('burst_cast_count:') && event === 'burst_cast') {
      const raw = timing.split(':')[1]!;
      if (!isdigit(lstripDash(raw))) return false;
      return count >= int(raw);
    }

    // 조건을 만족한 자기 버스트만 별도 계수한다.
    if (timing.startsWith('conditional_burst_cast_count:') && event === 'burst_cast') {
      const parts = pysplit(timing, ':', 2);
      if (parts.length !== 3 || !isdigit(lstripDash(parts[2]!))) {
        return false;
      }
      if (!this._condition_ok(get(get(eff, 'trigger', {}), 'condition', []), caster, t, eff)) {
        return false;
      }
      const key = tupleKey(caster, parts[1]);
      let [last_base_count, conditional_count] = this._conditional_event_counts.get(key) ?? [-1, 0];
      if (last_base_count !== count) {
        conditional_count += 1;
        this._conditional_event_counts.set(key, [count, conditional_count]);
      }
      return conditional_count >= int(parts[2]!);
    }

    // 조건을 만족한 일반 공격만 별도 계수한다.
    if (timing.startsWith('conditional_hit_count:') && event === 'hit_count') {
      const parts = pysplit(timing, ':', 2);
      if (parts.length !== 3 || !isdigit(lstripDash(parts[2]!))) {
        return false;
      }
      if (!this._condition_ok(get(get(eff, 'trigger', {}), 'condition', []), caster, t, eff)) {
        return false;
      }
      const key = tupleKey(caster, `hit:${parts[1]}`);
      let [last_base_count, conditional_count] = this._conditional_event_counts.get(key) ?? [-1, 0];
      if (last_base_count !== count) {
        conditional_count += 1;
        this._conditional_event_counts.set(key, [count, conditional_count]);
      }
      return pymod(conditional_count, int(parts[2]!)) === 0;
    }

    // full_burst_start_count:N — N번째 이상 매번 발동 (>= N)
    if (timing.startsWith('full_burst_start_count:') && event === 'full_burst_start') {
      const raw = timing.split(':')[1]!;
      if (!isdigit(lstripDash(raw))) return false;
      return count >= int(raw);
    }

    // full_burst_start_exact:N — 정확히 N번째만 발동 (== N)
    if (timing.startsWith('full_burst_start_exact:') && event === 'full_burst_start') {
      const raw = timing.split(':')[1]!;
      if (!isdigit(lstripDash(raw))) return false;
      return count === int(raw);
    }

    // full_burst_end_count:N — N번째 이상 매번 발동 (>= N)
    if (timing.startsWith('full_burst_end_count:') && event === 'full_burst_end') {
      const raw = timing.split(':')[1]!;
      if (!isdigit(lstripDash(raw))) return false;
      return count >= int(raw);
    }

    // full_charge_count:N  (trigger_count_reduce 버프로 N 감소 가능)
    if (timing.startsWith('full_charge_count:') && event === 'full_charge_hit') {
      const raw = timing.split(':')[1]!;
      if (!isdigit(lstripDash(raw))) return false;
      let n = int(raw);
      n = this._apply_trigger_count_reduce(n, eff, caster, t);
      return pymod(count, n) === 0;
    }

    // hit_count:[스킬명]:N — named damage effect 명중 N회마다
    if (timing.startsWith('hit_count:') && event.startsWith('hit_count:') && event !== 'hit_count') {
      const parts = pysplit(timing, ':', 2);
      if (parts.length === 3 && `hit_count:${parts[1]}` === event) {
        const raw = parts[2]!;
        if (!isdigit(lstripDash(raw))) return false;
        let n = int(raw);
        n = this._apply_trigger_count_reduce(n, eff, caster, t);
        return pymod(count, n) === 0;
      }
      return false;
    }

    // hit_count:N  (trigger_count_reduce 버프로 N 감소 가능)
    // hit_count:{0} 형태면 trigger_values에서 현재 스킬 레벨 기준 N을 꺼냄
    if (timing.startsWith('hit_count:') && event === 'hit_count') {
      let raw = timing.split(':')[1]!;
      if (raw.startsWith('{') && raw.endsWith('}')) {
        const tv = get(eff, 'trigger_values', {});
        if (truthy(tv)) {
          const char = get(this._char, caster, {});
          const skill_lv = _get_skill_lv(char, eff);
          raw = pystr(get(tv, skill_lv, get(tv, '10', raw)));
        }
      }
      if (!isdigit(lstripDash(raw))) return false;
      let n = int(raw);
      n = this._apply_trigger_count_reduce(n, eff, caster, t);
      return pymod(count, n) === 0;
    }

    // burst_enter:N
    if (timing.startsWith('burst_enter:') && event.startsWith('burst_enter:')) {
      return timing === event;
    }

    // squad_burst_cast:N
    if (timing.startsWith('squad_burst_cast:') && event.startsWith('squad_burst_cast:')) {
      return timing === event;
    }

    // core_hit:N / core_hit_count:N (trigger_count_reduce 버프로 N 감소 가능)
    if ((timing.startsWith('core_hit:') || timing.startsWith('core_hit_count:')) && event === 'core_hit') {
      const raw = timing.split(':')[1]!;
      if (!isdigit(lstripDash(raw))) return false;
      let n = int(raw);
      n = this._apply_trigger_count_reduce(n, eff, caster, t);
      return pymod(count, n) === 0;
    }

    // crit_hit_count:N  (trigger_count_reduce 버프로 N 감소 가능)
    if (timing.startsWith('crit_hit_count:') && event === 'crit_hit') {
      const raw = timing.split(':')[1]!;
      if (!isdigit(lstripDash(raw))) return false;
      let n = int(raw);
      n = this._apply_trigger_count_reduce(n, eff, caster, t);
      return pymod(count, n) === 0;
    }

    // received_hit:N
    if (timing.startsWith('received_hit:') && event === 'received_hit') {
      const raw = timing.split(':')[1]!;
      if (!isdigit(lstripDash(raw))) return false;
      return pymod(count, int(raw)) === 0;
    }

    // pellet_hit_count:N 또는 pellet_hit:N  (trigger_count_reduce 버프로 N 감소 가능)
    if ((timing.startsWith('pellet_hit_count:') || timing.startsWith('pellet_hit:')) && event === 'pellet_hit') {
      const raw = timing.split(':')[1]!;
      if (!isdigit(lstripDash(raw))) return false;
      let n = int(raw);
      n = this._apply_trigger_count_reduce(n, eff, caster, t);
      return pymod(count, n) === 0;
    }

    // hp_below:N → 타임라인이 체력 변화 시 "hp_below:N" 이벤트 발생
    if (timing.startsWith('hp_below:') && event.startsWith('hp_below:')) {
      return timing === event;
    }

    // hp_below_count:threshold:N → "hp_below:threshold" 이벤트의 N번째 발생 시
    if (timing.startsWith('hp_below_count:') && event.startsWith('hp_below:')) {
      const parts = timing.split(':');
      if (parts.length === 3 && event === `hp_below:${parts[1]}`) {
        return count === int(parts[2]!);
      }
    }

    // stack_reach:버프명:N — 해당 버프 스택이 N에 도달하는 순간 발동
    if (timing.startsWith('stack_reach:') && event.startsWith('stack_reach:')) {
      return timing === event;
    }

    // event:xxx
    if (timing.startsWith('event:') && event === timing) {
      return true;
    }

    // weapon_hit:name
    if (timing.startsWith('weapon_hit:') && event.startsWith('weapon_hit:')) {
      return timing === event;
    }

    // charge_hold:N
    if (timing.startsWith('charge_hold:') && event.startsWith('charge_hold:')) {
      return timing === event;
    }

    // charge_hold_count:H:N — H초 이상 풀차지 유지를 N회 누적할 때마다
    if (timing.startsWith('charge_hold_count:') && event.startsWith('charge_hold:')) {
      const parts = timing.split(':');
      if (parts.length !== 3 || event !== `charge_hold:${parts[1]}`) {
        return false;
      }
      const raw = parts[2]!;
      return isdigit(raw) && int(raw) > 0 && pymod(count, int(raw)) === 0;
    }

    // non_full_charge_hit_count:N — 비풀차지 발사 N회마다
    if (timing.startsWith('non_full_charge_hit_count:') && event === 'non_full_charge_hit') {
      const raw = pysplit(timing, ':', 1)[1]!;
      return isdigit(raw) && int(raw) > 0 && pymod(count, int(raw)) === 0;
    }

    // multi_hit:N — 단일 공격의 실제 명중 수가 문턱 이상이면 발동
    if (timing.startsWith('multi_hit:') && event.startsWith('multi_hit:')) {
      const need = pysplit(timing, ':', 1)[1]!;
      const actual = pysplit(event, ':', 1)[1]!;
      if (!(isdigit(need) && isdigit(actual) && int(actual) >= int(need))) {
        return false;
      }
      const probability = get(this._notify_ctx, 'pellet_probability', 1);
      if (probability >= 1) {
        return true;
      }
      const chance = at_least(int(actual), probability, int(need));
      const key = tupleKey('multi_hit_expected', caster, pyid(eff), timing);
      const acc = item(this.state, 'rng_acc');
      accSet(acc, key, accGet(acc, key, 0) + chance);
      if (accGet(acc, key, 0) >= 1 - 1e-12) {
        accSet(acc, key, pmax(0, accGet(acc, key, 0) - 1));
        return true;
      }
      return false;
    }

    // squad_ammo_consume:N — 스쿼드 전체 탄환 소비 누적 N발마다 발동
    if (timing.startsWith('squad_ammo_consume:') && event === 'squad_ammo_consume') {
      const raw = timing.split(':')[1]!;
      if (!isdigit(lstripDash(raw))) return false;
      return pymod(count, int(raw)) === 0;
    }

    // part_hit_count:N — 스쿼드 내 아군이 파츠 명중할 때마다 (squad_part_hit 이벤트)
    if (timing.startsWith('part_hit_count:') && event === 'squad_part_hit') {
      const raw = timing.split(':')[1]!;
      if (!isdigit(lstripDash(raw))) return false;
      return pymod(count, int(raw)) === 0;
    }

    // body_hit_count:N — 스쿼드 내 아군이 본체 명중할 때마다 (squad_body_hit 이벤트)
    if (timing.startsWith('body_hit_count:') && event === 'squad_body_hit') {
      const raw = timing.split(':')[1]!;
      if (!isdigit(lstripDash(raw))) return false;
      return pymod(count, int(raw)) === 0;
    }

    return false;
  }

  // py: calculator/buff_manager.py:1956
  /** 발동 시점 조건 평가. False이면 발동 안 함. */
  _condition_ok(conditions: string[], caster: string, t: number, eff: Eff | null = null): boolean {
    // burst_casted 계열 조건 평가 기준 캐릭터:
    // effect의 target이 단일 캐릭터 이름(스쿼드원)이면 그 캐릭터 기준, 아니면 caster 기준
    const raw_target = truthy(eff) ? get(eff, 'target', '') : '';
    const burst_check_char = (
      typeof raw_target === 'string' && this.squad_names.includes(raw_target)
        ? raw_target
        : caster
    );
    for (const cond of conditions) {
      if (cond === 'during_charge') {
        if (!truthy(get(get(this.state, 'charging', {}), caster))) {
          return false;
        }
      } else if (cond === 'during_full_burst') {
        if (!truthy(get(this.state, 'full_burst'))) {
          return false;
        }
      } else if (cond === 'not_during_full_burst') {
        if (truthy(get(this.state, 'full_burst'))) {
          return false;
        }
      } else if (cond === 'allies_cover_destroyed') {
        const destroyed = get(this.state, 'cover_destroyed', {});
        if (!this.squad_names.some((name) => truthy(get(destroyed, name, false)))) {
          return false;
        }
      } else if (cond === 'no_allies_cover_destroyed') {
        const destroyed = get(this.state, 'cover_destroyed', {});
        if (this.squad_names.some((name) => truthy(get(destroyed, name, false)))) {
          return false;
        }
      } else if (cond === 'trigger_hit_crit') {
        // 트리거를 발생시킨 그 히트가 크리티컬이었는가 — notify의 ctx로 전달된다.
        if (!truthy(get(this._notify_ctx, 'hit_crit'))) {
          return false;
        }
      } else if (cond === 'not_core') {
        // Gate the triggering hit, not the normal-hit counter. In expected
        // mode accumulate only the eligible (e.g. every sixth) hit's share.
        const core_frac = get(this._notify_ctx, 'core_frac');
        if (core_frac == null || core_frac >= 1.0) {
          return false;
        }
        if (core_frac > 0.0) {
          const acc = setdefault(this.state, 'rng_acc', {} as Dict);
          const key = tupleKey('not_core', pyid(eff as object), caster);
          accSet(acc, key, accGet(acc, key, 0.0) + 1.0 - core_frac);
          if (accGet(acc, key, 0.0) < 1.0) {
            return false;
          }
          accSet(acc, key, accGet(acc, key, 0.0) - 1.0);
        }
      } else if (cond === 'burst_casted') {
        if (!truthy(get(get(this.state, 'burst_casted', {}), burst_check_char))) {
          return false;
        }
      } else if (cond === 'burst_not_casted') {
        if (truthy(get(get(this.state, 'burst_casted', {}), burst_check_char))) {
          return false;
        }
      } else if (cond.startsWith('prob:')) {
        // prob:{0} 형태면 trigger_values에서 현재 스킬 레벨 기준 확률을 꺼낸다
        let raw = pysplit(cond, ':', 1)[1]!;
        if (raw.startsWith('{') && raw.endsWith('}')) {
          const tv = get(or(eff, {}), 'trigger_values', {});
          if (!truthy(tv)) {
            return false;
          }
          const char = get(this._char, caster, {});
          raw = pystr(get(tv, _get_skill_lv(char, eff as Eff), get(tv, '10', null)));
        }
        const p = float(raw) / 100;
        // 기대값 모드에서는 난수를 굴리지 않고 확률을 (효과, 캐스터)별로 누적해
        // 1.0을 넘길 때마다 발동시킨다.
        if (truthy(get(this.state, 'rng_expected'))) {
          const acc = setdefault(this.state, 'rng_acc', {} as Dict);
          const key = tupleKey('prob', pyid(eff as object), caster);
          accSet(acc, key, accGet(acc, key, 0.0) + p);
          if (accGet(acc, key, 0.0) < 1.0) {
            return false;
          }
          accSet(acc, key, accGet(acc, key, 0.0) - 1.0);
        } else if (random.random() >= p) {
          return false;
        }
      } else if (cond === 'target_stunned') {
        // 기절은 이름 있는 상태가 아니므로 target_state:로 잡지 않는다.
        if (!this.is_stunned('__enemy__')) {
          return false;
        }
      } else if (cond.startsWith('self_hp_above:')) {
        const n = float(cond.split(':')[1]!);
        const hp_pct = get(get(this.state, 'hp_pct', {}), caster, 100.0);
        if (hp_pct < n) {
          return false;
        }
      } else if (cond.startsWith('self_hp_below:')) {
        const n = float(cond.split(':')[1]!);
        const hp_pct = get(get(this.state, 'hp_pct', {}), caster, 100.0);
        if (hp_pct > n) {
          return false;
        }
      } else if (cond === 'self_hp_max') {
        const hp_pct = get(get(this.state, 'hp_pct', {}), caster, 100.0);
        if (hp_pct < 100.0) {
          return false;
        }
      } else if (cond === 'during_shield') {
        if (!this.has_shield(caster)) {
          return false;
        }
      } else if (cond.startsWith('ally_hp_below:')) {
        // 발동 시점에는 target이 아직 resolve되기 전이라 개별 대상을 볼 수 없다.
        const n = float(cond.split(':')[1]!);
        const hp_map = get(this.state, 'hp_pct', {});
        const hps = this.squad_names.map((x) => get(hp_map, x, 100.0) as number);
        if ((hps.length > 0 ? minBy(hps) : 100.0) > n) {
          return false;
        }
      } else if (cond === 'back_row') {
        const idx = listIndex(this.slot_names, caster);
        if (!(idx === 1 || idx === 3)) {  // 후열 = 포지션 2(idx 1) 또는 4(idx 3)
          return false;
        }
      } else if (cond === 'squad_ally_exists') {
        // 소속 스쿼드가 같은 아군이 자신 외에 편성돼 있어야 True.
        const my_squad = get(get(_NIKKE(), caster, {}), 'squad', null);
        if (!truthy(my_squad) || !this.squad_names.some(
          (n) => n !== caster && get(get(_NIKKE(), n, {}), 'squad', null) === my_squad,
        )) {
          return false;
        }
      } else if (cond === 'has_burst1_ally') {
        // 자신 제외 스쿼드에 1버스트 캐릭터가 있어야 함
        const burst_stages = get(this.state, 'burst_stages', {});
        const has_ = this.squad_names.some((n) => n !== caster && get(burst_stages, n, null) === '1');
        if (!has_) {
          return false;
        }
      } else if (cond === 'no_burst1_ally') {
        // 자신 제외 스쿼드에 1버스트 캐릭터가 없어야 함
        const burst_stages = get(this.state, 'burst_stages', {});
        const has_ = this.squad_names.some((n) => n !== caster && get(burst_stages, n, null) === '1');
        if (has_) {
          return false;
        }
      } else if (cond === 'has_defender_ally' || cond === 'no_defender_ally') {
        const has_ = this.squad_names.some(
          (n) => n !== caster && get(get(_NIKKE(), n, {}), 'class', null) === '방어형',
        );
        if (has_ !== (cond === 'has_defender_ally')) {
          return false;
        }
      } else if (cond === 'optimal_range') {
        // 적정 사거리 여부의 정본은 `enemy["optimal_range_weapons"]`다.
        const wt = get(get(_NIKKE(), caster, {}), 'weapon_type', null);
        if (!inContainer(or(get(get(this.state, 'enemy', {}), 'optimal_range_weapons'), []), wt)) {
          return false;
        }
      } else if (cond.startsWith('gauge_above:')) {
        const parts = cond.split(':');
        const gauge_id = parts[1]!, threshold = float(parts[2]!);
        const current = get(get(get(this.state, 'gauges', {}), caster, {}), gauge_id, 0.0);
        if (current < threshold) {
          return false;
        }
      } else if (cond.startsWith('gauge_below:')) {
        const parts = cond.split(':');
        const gauge_id = parts[1]!, threshold = float(parts[2]!);
        const current = get(get(get(this.state, 'gauges', {}), caster, {}), gauge_id, 0.0);
        if (current >= threshold) {
          return false;
        }
      } else if (cond.startsWith('gauge_eq:')) {
        const parts = cond.split(':');
        const gauge_id = parts[1]!, threshold = float(parts[2]!);
        const current = get(get(get(this.state, 'gauges', {}), caster, {}), gauge_id, 0.0);
        if (current !== threshold) {
          return false;
        }
      } else if (cond.startsWith('gauge_mod:')) {
        const parts = cond.split(':');
        const gauge_id = parts[1]!, mod = int(parts[2]!), rem = int(parts[3]!);
        const current = int(get(get(get(this.state, 'gauges', {}), caster, {}), gauge_id, 0));
        if (pymod(current, mod) !== rem) {
          return false;
        }
      } else if (cond.startsWith('self_state:')) {
        const state_name = cond.slice('self_state:'.length);
        if (!this._has_self_state(caster, state_name)) {
          return false;
        }
      } else if (cond.startsWith('not_self_state:')) {
        const state_name = cond.slice('not_self_state:'.length);
        if (this._has_self_state(caster, state_name)) {
          return false;
        }
      } else if (cond.startsWith('target_state:')) {
        const state_name = cond.slice('target_state:'.length);
        if (!this._has_target_state(state_name)) {
          return false;
        }
      } else if (cond.startsWith('target_stack_above:')) {
        const parts = cond.split(':');
        const stack_name = parts[1]!, threshold = int(parts[2]!);
        let current = 0;
        let any_ = false;
        for (const ab of this._by_name(stack_name)) {
          if (!(or(ab.target_chars, []) as string[]).includes('__enemy__')) continue;
          if (!any_ || ab.stack > current) { current = ab.stack; any_ = true; }
        }
        if (current < threshold) {
          return false;
        }
      } else if (cond.startsWith('not_target_state:')) {
        const state_name = cond.slice('not_target_state:'.length);
        if (this._has_target_state(state_name)) {
          return false;
        }
      } else if (cond.startsWith('target_code:')) {
        const code = cond.slice('target_code:'.length);
        const enemy_code = get(get(this.state, 'enemy', {}), 'code', '');
        if (truthy(enemy_code) && enemy_code !== code) {
          return false;
        }
      } else if (cond.startsWith('enemy_count_below:')) {
        // 단일 보스 sim: 적 1기. "랩쳐 N기 이하" → 1 <= N (N>=1이면 항상 참)
        const n = int(cond.split(':')[1]!);
        if (1 > n) {
          return false;
        }
      } else if (cond.startsWith('enemy_count_above:')) {
        // 단일 보스 sim: 적 1기. "랩쳐 N기 이상" → 1 >= N (N>=2이면 항상 거짓 → 무발동)
        const n = int(cond.split(':')[1]!);
        if (1 < n) {
          return false;
        }
      } else if (cond.startsWith('self_stack_above:')) {
        const parts = cond.split(':');
        const stack_name = parts[1]!, threshold = int(parts[2]!);
        let current = 0;
        for (const ab of this._active) {
          if (abName(ab, null) === stack_name
              && ab.caster === caster
              && ((or(ab.target_chars, []) as string[]).includes(caster)
                || (or(ab.target_chars, []) as string[]).includes('__enemy__'))) {
            current = ab.stack;
            break;
          }
        }
        if (current < threshold) {
          return false;
        }
      } else if (cond.startsWith('self_stat_above:')) {
        // "자신이 [stat] 증가 상태라면" — 버프 *이름*이 아니라 **stat 값**으로 판정한다.
        const parts = cond.split(':');
        const stat_key = parts[1]!, threshold = float(parts[2]!);
        const buff_key = get(_STAT_TO_BUFF, stat_key, stat_key);
        if (get(this.get_buffs(caster, '__enemy__', t), buff_key, 0.0) <= threshold) {
          return false;
        }
      } else if (cond === 'core_hit') {
        // 코어 유무는 enemy["core_px"]가 정본 (>=1이면 코어 있음, 0이면 없음).
        if (float(or(get(get(this.state, 'enemy', {}), 'core_px', 0), 0)) < 1) {
          return false;
        }
      }
      // 나머지 condition은 get_buffs에서 재평가
    }
    return true;
  }

  // py: calculator/buff_manager.py:2201
  /** self_state:/not_self_state: 판정의 단일 창구. (원본 docstring 참고) */
  _has_self_state(caster: string, state_name: string): boolean {
    const bunny: Dict = { '바니 모드 : 스탠스': 'stance', '바니 모드 : 인게이지': 'engage' };
    if (has(bunny, state_name)) {
      return get(get(this.state, 'bunny_modes', {}), caster, null) === bunny[state_name];
    }
    if (this._by_name(state_name).some((ab) => (or(ab.target_chars, []) as string[]).includes(caster))) {
      return true;
    }
    return this.weapon_change_name(caster) === state_name;
  }

  // py: calculator/buff_manager.py:2215
  /** `element_code_override` 버프로 이 적에게 우월 코드가 성립하는가. */
  element_override_match(name: string, enemy_code: string): boolean {
    if (!truthy(enemy_code)) {
      return false;
    }
    return this._by_stat('element_code_override').some(
      (ab) => get(ab.effect, 'target_code', null) === enemy_code
        && (or(ab.target_chars, []) as string[]).includes(name),
    );
  }

  // py: calculator/buff_manager.py:2232
  /** `persona_state` 마커 버프 보유 여부 — `allies_burst3_persona_excl_self` 판정용. */
  _has_persona_state(name: string): boolean {
    return this._active.some(
      (ab) => abStat(ab) === 'persona_state' && (or(ab.target_chars, []) as string[]).includes(name),
    );
  }

  // py: calculator/buff_manager.py:2239
  /** `event:{name}` 통지 대상. (원본 docstring 참고) */
  _event_audience(eff: Eff, targets: string[] | null, caster: string): string[] {
    if (get(eff, 'event_scope') !== 'recipients') {
      return [...this.squad_names];
    }
    return (or(targets, [caster]) as string[]).filter((c) => this.squad_names.includes(c));
  }

  // py: calculator/buff_manager.py:2252
  /** 이 캐스터의 효과가 쓰는 `charge_hold:N` 임계값 목록 — `(값, 원문 표기)`. */
  charge_hold_thresholds(caster: string): Array<[number, string]> {
    const cached = this._charge_hold_cache.get(caster);
    if (cached !== undefined) {
      return cached;
    }
    const found = new Map<string, number>();
    for (const [eff, eff_caster] of this._effects) {
      if (eff_caster !== caster) {
        continue;
      }
      for (const timing of item(item(eff, 'trigger'), 'timing') as string[]) {
        let raw: string;
        if (timing.startsWith('charge_hold:')) {
          raw = pysplit(timing, ':', 1)[1]!;
        } else if (timing.startsWith('charge_hold_count:')) {
          const parts = timing.split(':');
          if (parts.length !== 3) {
            continue;
          }
          raw = parts[1]!;
        } else {
          continue;
        }
        try {
          found.set(raw, float(raw));
        } catch {
          continue;
        }
      }
    }
    const result = sorted([...found.entries()].map(([raw, v]) => [v, raw] as [number, string]));
    this._charge_hold_cache.set(caster, result);
    return result;
  }

  // py: calculator/buff_manager.py:2283
  /** target_state:/not_target_state: 판정의 단일 창구. 단일 적 가정. */
  _has_target_state(state_name: string): boolean {
    return this._by_name(state_name).some(
      (ab) => (or(ab.target_chars, []) as string[]).includes('__enemy__'),
    );
  }

  // py: calculator/buff_manager.py:2292
  /** 현재 활성 weapon_change 효과의 이름. 없으면 빈 문자열. */
  weapon_change_name(caster: string): string {
    const info = get(get(this.state, 'weapon_change', {}), caster);
    if (!truthy(info)) {
      return '';
    }
    return get(item(info, 'effect'), 'name', '');
  }

  // py: calculator/buff_manager.py:2299
  /** 수동 재장전으로 지금 진입 가능한 weapon_change가 있는가. */
  manual_swap_ready(caster: string, t: number): boolean {
    if (has(get(this.state, 'weapon_change', {}), caster)) {
      return false;
    }
    const idx = this._notify_index.get(caster);
    for (const [eff, eff_caster] of ((idx !== undefined ? idx.get('event:full_reload') : undefined) ?? [])) {
      if (get(eff, 'type') !== 'weapon_change') {
        continue;
      }
      const conds = get(item(eff, 'trigger'), 'condition', []);
      if (truthy(conds) && this._condition_ok(conds, eff_caster, t, eff)) {
        return true;
      }
    }
    return false;
  }

  // py: calculator/buff_manager.py:2317
  /** 현재 활성 max_hp 계열 버프를 반영한 최대 체력 절대값. get_buffs() 재귀 없이 _active를 직접 순회한다. */
  effective_max_hp(name: string): number {
    const base_hp = get(get(get(this.state, 'base_stats', {}), name, {}), 'hp', 0.0);
    let bonus_pct = 0.0;
    let bonus_flat = 0.0;
    for (const ab of this._active) {
      const stat = abStat(ab, '');
      if (!(or(ab.target_chars, []) as string[]).includes(name)) {
        continue;
      }
      if (stat === 'max_hp_pct' || stat === 'max_hp_only_pct') {
        const val = this._get_value(ab.effect, ab, name);
        if (val != null) {
          bonus_pct += val;
        }
      } else if (stat === 'hp_caster_based_pct' || stat === 'hp_only_caster_based_pct') {
        const caster_base_hp = get(get(get(this.state, 'base_stats', {}), ab.caster, {}), 'hp', 0.0);
        const val = this._get_value(ab.effect, ab, name);
        if (val != null) {
          bonus_flat += caster_base_hp * val / 100.0;
        }
      } else if (stat === 'max_hp_from_max_hp_pct') {
        // 부여 시점에 확정한 절대값(`ActiveBuff.hp_bonus_flat`).
        bonus_flat += ab.hp_bonus_flat;
      }
    }
    return base_hp * (1.0 + bonus_pct / 100.0) + bonus_flat;
  }

  // py: calculator/buff_manager.py:2342
  /** name에게 현재 적용 중인 보호막 총량. */
  shield_amount(name: string): number {
    return sum(
      this._active
        .filter((ab) => _SHIELD_STATS.has(abStat(ab)))
        .map((ab) => get(ab.shield_per_target, name, 0.0) as number),
    );
  }

  // py: calculator/buff_manager.py:2354
  /** name에게 양수 보호막이 하나 이상 활성화돼 있는지 반환. */
  has_shield(name: string): boolean {
    return this._active.some(
      (ab) => _SHIELD_STATS.has(abStat(ab)) && get(ab.shield_per_target, name, 0.0) > 0.0,
    );
  }

  // py: calculator/buff_manager.py:2362
  /** name의 활성 보호막을 생성량 상한까지 회복한다. */
  heal_shield(name: string, amount: number): void {
    let remain = pmax(0.0, amount);
    for (const ab of [...this._active].reverse()) {
      if (remain <= 0.0 || !_SHIELD_STATS.has(abStat(ab))) {
        continue;
      }
      if (!has(ab.shield_per_target, name)) {
        continue;
      }
      const current = ab.shield_per_target[name]!;
      const cap = get(ab.shield_max_per_target, name, current);
      const gain = pmin(remain, pmax(0.0, cap - current));
      ab.shield_per_target[name] = current + gain;
      remain -= gain;
    }
  }

  // py: calculator/buff_manager.py:2376
  /** 대상의 `다음 보호막 체력 ▲`을 합산해 1회 소비한다. */
  consume_next_shield_multiplier(name: string): number {
    const consumed: ActiveBuff[] = [];
    let bonus = 0.0;
    for (const ab of this._active) {
      if (abStat(ab) !== 'next_shield_hp_pct'
          || !truthy(get(ab.effect, 'consume_next_shield'))) {
        continue;
      }
      const targets = or(ab.target_chars, null) ?? this._resolve_target(get(ab.effect, 'target', 'self'), ab.caster);
      if (!(targets as string[]).includes(name)) {
        continue;
      }
      const val = this._get_value(ab.effect, ab, ab.caster);
      if (val != null) {
        bonus += val;
      }
      consumed.push(ab);
    }
    if (truthy(consumed)) {
      // `ab not in consumed` — dataclass eq는 uid까지 비교하므로 동일성과 같다
      this._active = this._active.filter((ab) => !consumed.includes(ab));
      this._invalidate_buffs_cache();
    }
    return 1.0 + bonus / 100.0;
  }

  // py: calculator/buff_manager.py:2401
  /** state['hp']를 기준으로 state['hp_pct']를 재계산한다. (원본 docstring 참고) */
  sync_hp(name: string): void {
    const hp = get(get(this.state, 'hp', {}), name, null);
    if (hp == null) {
      return;
    }
    const max_hp = this.effective_max_hp(name);
    if (max_hp <= 0) {
      return;
    }
    const prev_pct = get(item(this.state, 'hp_pct'), name, null);
    const new_pct = hp / max_hp * 100.0;
    this.state['hp_pct'][name] = new_pct;

    if (prev_pct != null) {
      if (new_pct < prev_pct) {
        // 자신의 HP 임계값 timing. 이 캐릭터가 실제로 등록한 문턱만 순회하고,
        // 위에서 아래로 통과한 순간에 한 번 발동한다.
        const idx = this._notify_index.get(name);
        for (const event of (idx !== undefined ? [...idx.keys()] : [])) {
          if (!event.startsWith('hp_below:')) {
            continue;
          }
          let threshold: number;
          try {
            threshold = float(pysplit(event, ':', 1)[1]!);
          } catch {
            continue;
          }
          if (prev_pct > threshold + _HP_EPS && new_pct <= threshold + _HP_EPS) {
            this.notify(event, this._cur_t, name);
          }
        }
        this._notify_adjacent_hp_below(name, prev_pct, new_pct);
      } else if (prev_pct < 100.0 - _HP_EPS && 100.0 - _HP_EPS <= new_pct) {
        this._notify_adjacent_hp_max(name);
      }
    }
  }

  // py: calculator/buff_manager.py:2436
  /** changed가 관찰자의 인접 HP 임계값을 하향 통과한 이벤트를 알린다. */
  _notify_adjacent_hp_below(changed: string, prev_pct: number, new_pct: number): void {
    if (this._in_hp_edge) {
      return;
    }
    this._in_hp_edge = true;
    try {
      for (const observer of this.squad_names) {
        if (observer === changed) {
          continue;
        }
        if (!this._resolve_target('allies_adjacent:2', observer).includes(changed)) {
          continue;
        }
        const event_keys = this._notify_index.get(observer);
        for (const event of (event_keys !== undefined ? [...event_keys.keys()] : [])) {
          const prefix = 'event:adjacent_hp_below:';
          if (!event.startsWith(prefix)) {
            continue;
          }
          let threshold: number;
          try {
            threshold = float(event.slice(prefix.length));
          } catch {
            continue;
          }
          if (prev_pct > threshold + _HP_EPS && new_pct <= threshold + _HP_EPS) {
            this.notify(event, this._cur_t, observer);
          }
        }
      }
    } finally {
      this._in_hp_edge = false;
    }
  }

  // py: calculator/buff_manager.py:2461
  /** changed가 최대 체력에 도달했음을 '양 옆에 changed를 둔' 아군에게 알린다. */
  _notify_adjacent_hp_max(changed: string): void {
    if (this._in_hp_edge) {
      return;
    }
    this._in_hp_edge = true;
    try {
      for (const observer of this.squad_names) {
        if (observer === changed) {
          continue;
        }
        if (this._resolve_target('allies_adjacent:2', observer).includes(changed)) {
          this.notify('event:adjacent_hp_max', this._cur_t, observer);
        }
      }
    } finally {
      this._in_hp_edge = false;
    }
  }

  // py: calculator/buff_manager.py:2479
  /** char_name이 현재 immune_stat 버프를 가지고 있는지 확인. */
  _has_immune(char_name: string, immune_stat: string): boolean {
    // (파이썬은 여기서 `buff_key = _STAT_TO_BUFF.get(immune_stat, immune_stat)`를 구하지만 쓰지 않는다)
    for (const ab of this._active) {
      if (abStat(ab) !== immune_stat) {
        continue;
      }
      if ((or(ab.target_chars, []) as string[]).includes(char_name)) {
        return true;
      }
    }
    return false;
  }

  // py: calculator/buff_manager.py:2489
  /** char_name이 현재 기절(stun) 상태이면 True. 결과는 _stunned_cache에 캐싱된다. */
  is_stunned(char_name: string): boolean {
    const cached = this._stunned_cache.get(char_name);
    if (cached !== undefined) {
      return cached;
    }
    const result = this._compute_is_stunned(char_name);
    this._stunned_cache.set(char_name, result);
    return result;
  }

  // py: calculator/buff_manager.py:2502
  _compute_is_stunned(char_name: string): boolean {
    if (this._has_immune(char_name, 'stun_immune')) {
      return false;
    }
    for (const ab of this._active) {
      if (abStat(ab) === 'stun' && (or(ab.target_chars, []) as string[]).includes(char_name)) {
        return true;
      }
    }
    return false;
  }

  // py: calculator/buff_manager.py:2510
  /** 효과를 ActiveBuff로 변환해 활성 목록에 추가하거나 갱신. */
  _activate(eff: Eff, caster: string, t: number, suppress_event: boolean = false): void {
    // max_trigger: 전투 중 최대 발동 횟수 제한
    const max_trigger = get(eff, 'max_trigger');
    if (max_trigger != null) {
      const eid = eff;
      if ((this._trigger_counts.has(eid) ? this._trigger_counts.get(eid)! : 0) >= max_trigger) {
        return;
      }
      this._trigger_counts.set(eid, (this._trigger_counts.has(eid) ? this._trigger_counts.get(eid)! : 0) + 1);
    }

    if (get(eff, 'type') === 'instant') {
      this._dispatch_instant(eff, caster, t);
      return;
    }

    if (get(eff, 'type') === 'damage') {
      const tick_interval = get(eff, 'tick_interval');
      if (truthy(tick_interval) && truthy(this._damage_handler)) {
        // tick_interval이 있으면 DoT 타이머 등록 (이미 활성이면 갱신)
        // 첫 틱 위상은 두 유형이다 (type 1 `tick_start: "immediate"` / type 2 기본).
        let duration = get(eff, 'duration');
        let expires = duration == null || duration === -1 ? Infinity : t + duration;
        const first_t = get(eff, 'tick_start') === 'immediate' ? t : t + tick_interval;
        this._dot_timers.set(eff, [caster, first_t, expires]);
        // DoT는 _active에도 등록해야 target_state/debuff_cleanse/remove_named_buff
        // 등이 name·polarity 기준으로 조회할 수 있다.
        const raw_target = get(eff, 'target', 'self');
        const lazy = typeof raw_target === 'string' && _startswith_lazy(raw_target);
        const targets = lazy ? null : this._resolve_target(raw_target, caster);
        const max_stack = get(eff, 'max_stack', 1);
        const existing = this._active.find((ab) => ab.effect === eff && ab.caster === caster) ?? null;
        // scaling_ref가 있는 DoT는 등록 시점 참조 스택/게이지 값을 초기 stack으로 캡처
        const scaling_ref = get(eff, 'scaling_ref', '');
        let init_stack: number;
        if (truthy(scaling_ref) && get(eff, 'scaling') === 'stack_count') {
          const ref_val = this.ref_count(caster, scaling_ref);
          init_stack = ref_val != null ? ref_val : 1;
        } else {
          init_stack = 1;
        }

        if (existing != null) {
          // 재발동: 타이머 갱신은 위에서 됐으므로 스택/만료만 갱신
          this._invalidate_values();
          if (max_stack === 1) {
            existing.expires_at = expires;
          } else if (truthy(scaling_ref) && get(eff, 'scaling') === 'stack_count') {
            // scaling_ref 기반 DoT: 재발동 시에도 참조값으로 스택을 재초기화
            existing.stack = init_stack;
            existing.expires_at = expires;
          } else {
            const cap = max_stack !== -1 ? max_stack : existing.stack + 1;
            existing.stack = pmin(existing.stack + 1, cap);
            existing.expires_at = expires;
          }
          if (truthy(this._buff_event_handler) && truthy(get(eff, 'name'))) {
            for (const tgt of (or(existing.target_chars, []) as string[])) {
              this._buff_event_handler!('activate', eff['name'], caster, tgt, t, existing.expires_at, null, get(eff, 'stat', null), existing.stack, get(eff, 'max_stack', 1));
            }
          }
        } else {
          this._invalidate_buffs_cache();
          this._active.push(new ActiveBuff({
            effect: eff, caster: caster, target_chars: targets,
            activated_at: t, expires_at: expires, stack: init_stack,
            has_runtime_conditions: _has_runtime_cond(get(item(eff, 'trigger'), 'condition', []), expires, get(eff, 'duration_bullets', -1)),
          }));
          if (truthy(this._buff_event_handler) && truthy(get(eff, 'name')) && truthy(targets)) {
            for (const tgt of targets!) {
              this._buff_event_handler!('activate', eff['name'], caster, tgt, t, expires, null, get(eff, 'stat', null), 1, get(eff, 'max_stack', 1));
            }
          }
        }

        // target이 `same_target:[이름]`인 DoT는 짝 효과가 **히트마다 한 중첩씩** 얹는다.
        // 계산기는 순차 히트를 같은 t에 몰아 쏘므로 여기서 램프를 펼친다.
        const ramp_n = this._same_target_ramp_hits(eff, caster);
        if (truthy(ramp_n)) {
          const ab = this._active.find((a) => a.effect === eff && a.caster === caster) ?? null;
          if (ab != null) {
            // 램프는 짝 공격의 타간 간격(`ramp_interval`, 초)에 맞춰 펼친다.
            const gap = float(get(eff, 'ramp_interval', 0.22));
            const cap = max_stack !== -1 ? max_stack : ramp_n!;
            this._ramp_pending = this._ramp_pending.filter(
              (p) => !(p[1] === eff && p[2] === caster),
            );
            for (let i = 1; i < ramp_n! + 1; i += 1) {
              this._ramp_pending.push([t + i * gap, eff, caster, pmin(i, cap)]);
            }
            // 지속시간은 **마지막 중첩 부여 기준**으로 다시 잡는다.
            const last_t = t + ramp_n! * gap;
            duration = get(eff, 'duration');
            expires = (duration == null || duration === -1
              ? Infinity : last_t + duration);
            ab.expires_at = expires;
            ab.stack = 0;
            this._invalidate_values();
            // 주기 틱은 램프가 끝난 뒤 +interval부터 잇는다.
            this._dot_timers.set(eff, [caster, last_t + tick_interval, expires]);
          }
        }
      } else if (truthy(this._damage_handler)) {
        // tick_interval 없으면 즉시 1회 발동
        this._damage_handler!(eff, caster, t);
      }
      return;
    }

    if (get(eff, 'type') === 'weapon_change') {
      // 발사 루프 교체는 타임라인이 처리하지만, 활성 여부는 state에 기록
      const wc = setdefault(this.state, 'weapon_change', {} as Dict);
      const name = get(eff, 'name', '');
      // toggle: 진입과 해제가 같은 조건인 모드 — 이미 활성이면 이번 발동은 해제다
      if (truthy(get(eff, 'toggle')) && truthy(name) && this.weapon_change_name(caster) === name) {
        this.end_weapon_change(caster, t);
        return;
      }
      const duration = get(eff, 'duration');
      const expires = duration == null || duration === -1 ? Infinity : t + duration;
      wc[caster] = {
        'effect': eff,
        'activated_at': t,
        'expires_at': expires,
      };
      this._invalidate_buffs_cache();
      // 모드 진입도 상태 변화다 — 일반 버프와 동일하게 event:{name}을 스쿼드에 브로드캐스트
      if (truthy(name)) {
        for (const _sq of this.squad_names) {
          this.notify(`event:${name}`, t, _sq);
        }
      }
      return;
    }

    let duration = get(eff, 'duration');
    if (duration == null && has(eff, 'duration_values')) {
      const char = get(this._char, caster, {});
      const skill_lv = _get_skill_lv(char, eff);
      const dv = item(eff, 'duration_values');
      duration = float(get(dv, skill_lv, get(dv, '10', 0.0)));
    }
    const expires = duration == null || duration === -1 ? Infinity : t + duration;

    const raw_target = get(eff, 'target', 'self');
    const lazy = typeof raw_target === 'string' && _startswith_lazy(raw_target);
    let targets: string[] | null = lazy ? null : this._resolve_target(raw_target, caster);

    // harmful 효과: debuff_immune 또는 named debuff immunity인 대상 제거
    if (get(eff, 'polarity') === 'harmful' && targets != null) {
      const eff_name = get(eff, 'name', '');
      const named_immune = truthy(eff_name) ? `debuff_immune:${eff_name}` : null;
      targets = targets.filter(
        (c) => !this._has_immune(c, 'debuff_immune')
          && (named_immune == null || !this._has_immune(c, named_immune))
          && !this._consume_immune_charge(c),
      );
      if (!truthy(targets)) {
        return;
      }
    }

    const max_stack = get(eff, 'max_stack', 1);

    const duration_bullets = get(eff, 'duration_bullets', -1);
    // duration_bullets 버프: target이 확정된 경우 캐릭터별 독립 카운터 사용.
    // 미확정(lazy) target은 기존 bullets_left 방식 유지.
    const use_per_target = duration_bullets !== -1 && targets != null;

    // 동일 효과(name + caster + target) 기존 버프 탐색 (원본 주석 참고)
    let name = get(eff, 'name', '');
    let existing: ActiveBuff | null = null;
    for (const ab of this._active) {
      // Explicitly linked trigger clauses can apply the same named stack.
      // Unrelated effects retain their original identity-based behavior.
      const same_effect = ab.effect === eff || (
        truthy(get(eff, 'stack_group'))
        && get(ab.effect, 'stack_group', null) === eff['stack_group']
      );
      if (same_effect && ab.caster === caster) {
        if (lazy || use_per_target || listEq(ab.target_chars, targets)) {
          existing = ab;
          break;
        }
      }
    }

    if (existing != null) {
      this._invalidate_values();
      if (max_stack === 1) {
        existing.activated_at = t;
        existing.expires_at = expires;
        existing.trigger_count += 1;
        if (duration_bullets !== -1) {
          if (use_per_target) {
            // target_chars를 새로 resolve한 targets으로 복원 (이전 소모로 제거된 캐릭터 재추가)
            existing.target_chars = [...targets!];
            const bpt: Record<string, number> = {};
            for (const c of targets!) bpt[c] = duration_bullets;
            existing.bullets_per_target = bpt;
          } else {
            existing.bullets_left = duration_bullets;
          }
        }
      } else {
        const recipients = (or(or(existing.target_chars, targets), [caster]) as string[]);
        let cap: number;
        if (max_stack !== -1) {
          cap = max_stack;
          let any_ = false;
          for (const recipient of recipients) {
            const v = this._effective_stack_cap(eff, recipient, t);
            if (!any_ || v > cap) { cap = v; any_ = true; }
          }
        } else {
          cap = existing.stack + 1;
        }
        const prev_stack = existing.stack;
        if (truthy(existing.per_char_stacks) && !use_per_target) {
          for (const recipient of recipients) {
            const current = get(existing.per_char_stacks, recipient, existing.stack);
            const limit = this._effective_stack_cap(eff, recipient, t);
            existing.per_char_stacks[recipient] = (max_stack === -1 ? current + 1
              : pmin(current + 1, limit));
          }
        }
        existing.stack = pmin(existing.stack + 1, cap);
        existing.activated_at = t;
        existing.expires_at = expires;
        existing.trigger_count += 1;
        if (duration_bullets !== -1) {
          if (use_per_target) {
            // 캐릭터별 독립 스택 갱신:
            // - bullets_per_target에 남아있는 캐릭터(아직 발사 안 함): 기존 스택+1
            // - 이미 발사해서 만료된 캐릭터: 스택 1로 초기화
            const new_per_char: Record<string, number> = {};
            for (const c of targets!) {
              if (has(existing.bullets_per_target, c)) {
                const cur = truthy(existing.per_char_stacks) ? get(existing.per_char_stacks, c, existing.stack) : existing.stack;
                const cap_c = max_stack !== -1 ? this._effective_stack_cap(eff, c, t) : cur + 1;
                new_per_char[c] = pmin(cur + 1, cap_c);
              } else {
                new_per_char[c] = 1;
              }
            }
            existing.per_char_stacks = new_per_char;
            existing.target_chars = [...targets!];
            const bpt: Record<string, number> = {};
            for (const c of targets!) bpt[c] = duration_bullets;
            existing.bullets_per_target = bpt;
          } else {
            existing.bullets_left = duration_bullets;
          }
        }
        // 스택이 새 값에 도달했으면 stack_reach 이벤트 발생
        if (existing.stack !== prev_stack && truthy(name)) {
          this.notify(`stack_reach:${name}:${existing.stack}`, t, caster);
        }
        // 스택 갱신 시에도 event:{name} notify (의존 버프 갱신용)
        if (truthy(name)) {
          for (const _sq of this._event_audience(eff, existing.target_chars, caster)) {
            this.notify(`event:${name}`, t, _sq);
          }
        }
      }
      // 재발동이므로 참조 중첩도 이 시점 값으로 다시 고정
      existing.scaling_stack = this._capture_scaling_stack(eff, caster);

      // 갱신 이벤트: 만료 시각이 바뀌었으므로 activate로 재기록
      if (truthy(this._buff_event_handler) && truthy(name) && existing.target_chars == null) {
        existing.log_pending = true;   // 위와 같은 이유로 resolve 시점까지 미룬다
      } else if (truthy(this._buff_event_handler) && truthy(name)) {
        const _stat = get(eff, 'stat', null);
        const log_chars = existing.target_chars;
        for (const tgt of (or(log_chars, []) as string[])) {
          const tgt_stack = truthy(existing.per_char_stacks) ? get(existing.per_char_stacks, tgt, null) : null;
          const _val = this._get_value(eff, existing, caster, tgt_stack);
          this._buff_event_handler!('activate', name, caster, tgt, t, existing.expires_at, _val, _stat,
            or(tgt_stack, existing.stack), get(eff, 'max_stack', 1));
        }
      }
    } else {
      this._invalidate_buffs_cache();
      let bpt: Record<string, number> = {};
      if (use_per_target) {
        for (const c of (or(targets, []) as string[])) bpt[c] = duration_bullets;
      } else {
        bpt = {};
      }
      let pcs: Record<string, number> = {};
      if (use_per_target && max_stack !== 1) {
        for (const c of (or(targets, []) as string[])) pcs[c] = 1;
      } else {
        pcs = {};
      }
      this._active.push(new ActiveBuff({
        effect: eff,
        caster: caster,
        target_chars: targets,
        activated_at: t,
        expires_at: expires,
        stack: 1,
        trigger_count: 1,
        bullets_left: use_per_target ? -1 : duration_bullets,
        bullets_per_target: bpt,
        per_char_stacks: pcs,
        has_runtime_conditions: _has_runtime_cond(get(item(eff, 'trigger'), 'condition', []), expires, get(eff, 'duration_bullets', -1)),
        scaling_stack: this._capture_scaling_stack(eff, caster),
      }));
      name = get(eff, 'name', '');
      // debuff_immune_count 재부여 — 그 이름의 소모량을 되돌린다(잠량 재충전).
      if (get(eff, 'stat') === 'debuff_immune_count' && truthy(targets)) {
        for (const tgt of targets!) {
          this._immune_used.delete(tupleKey(tgt, name));
        }
      }
      // max_hp_from_max_hp_pct — 「시전자의 최종 최대 체력 비례 최대 체력 N% ▲」.
      // 가산분은 **부여 시점의 시전자 effective_max_hp** 기준으로 확정해 버프에 싣는다.
      if (get(eff, 'stat') === 'max_hp_from_max_hp_pct' && truthy(targets) && has(this.state, 'hp')) {
        const ab_ref = at(this._active, -1) as ActiveBuff;
        const full_val = this._get_value(eff, ab_ref, caster);
        if (full_val != null) {
          ab_ref.hp_bonus_flat = 0.0;
          ab_ref.hp_bonus_flat = this.effective_max_hp(caster) * full_val / 100.0;
          for (const tgt of targets!) {
            if (has(this.state['hp'], tgt)) {
              this.state['hp'][tgt] = pmin(this.state['hp'][tgt] + ab_ref.hp_bonus_flat,
                this.effective_max_hp(tgt));
              this.sync_hp(tgt);
            }
          }
        }
      }
      if (truthy(name)) {
        // 기본은 스쿼드 전체 브로드캐스트, event_scope: "recipients"면 수령자 한정
        for (const _sq of this._event_audience(eff, targets, caster)) {
          this.notify(`event:${name}`, t, _sq);
        }
        // 스택 1로 처음 등록 시도 stack_reach:버프명:1
        this.notify(`stack_reach:${name}:1`, t, caster);
      }
      // 신규 등록 이벤트 (suppress_event=True이면 억제 — 조건부 passive 미충족 시)
      if (truthy(this._buff_event_handler) && truthy(name) && !suppress_event) {
        if (targets == null) {
          // 지연 resolve: 대상이 아직 없다. _resolve_lazy()가 확정하는 순간 남긴다
          (at(this._active, -1) as ActiveBuff).log_pending = true;
        } else if (truthy(targets)) {
          const ab_new = this._active.find((ab) => ab.effect === eff && ab.caster === caster) ?? null;
          const _val = ab_new != null ? this._get_value(eff, ab_new, caster) : null;
          const _stat = get(eff, 'stat', null);
          for (const tgt of targets) {
            this._buff_event_handler!('activate', name, caster, tgt, t, expires, _val, _stat,
              (ab_new != null ? ab_new.stack : 1), get(eff, 'max_stack', 1));
          }
        }
      }
    }

    // event:stat_applied:XXX — stat 유형별 버프 적용 시 해당 target_chars에게 notify
    const stat = get(eff, 'stat', '');
    const _STAT_APPLIED_EVENTS = ['dot_dmg_pct', 'split_dmg_pct'];
    if (_STAT_APPLIED_EVENTS.includes(stat) && truthy(targets)) {
      const event_name = `event:stat_applied:${stat}`;
      for (const tgt of targets!) {
        if (tgt !== '__enemy__') {
          this.notify(event_name, t, tgt);
        }
      }
    }

    // 보호막을 ActiveBuff 수명에 결합해 대상별 생성량을 기록한다.
    if (_SHIELD_STATS.has(stat) && truthy(targets)) {
      const ab_ref = this._active.find((ab) => ab.effect === eff && ab.caster === caster) ?? null;
      if (ab_ref != null) {
        const val = this._get_value(eff, ab_ref, caster);
        let amount = val != null ? this.effective_max_hp(caster) * val / 100.0 : 0.0;
        if (stat === 'shield_from_max_hp_pct') {
          amount *= this.consume_next_shield_multiplier(caster);
        }
        const spt: Record<string, number> = {};
        for (const tgt of (or(ab_ref.target_chars, []) as string[])) {
          if (tgt !== '__enemy__') spt[tgt] = amount;
        }
        ab_ref.shield_per_target = spt;
        ab_ref.shield_max_per_target = { ...ab_ref.shield_per_target };
        for (const tgt of Object.keys(ab_ref.shield_per_target)) {
          this.notify('event:shield_applied', t, tgt);
        }
      }
    }

    // hp_caster_based_pct / hp_only_caster_based_pct 발동 후처리
    if ((stat === 'hp_caster_based_pct' || stat === 'hp_only_caster_based_pct') && has(this.state, 'hp')) {
      const ab_ref = this._active.find((ab) => ab.effect === eff && ab.caster === caster) ?? null;
      if (ab_ref != null && truthy(targets)) {
        if (stat === 'hp_caster_based_pct') {
          const caster_base_hp = get(get(get(this.state, 'base_stats', {}), caster, {}), 'hp', 0.0);
          const full_val = this._get_value(eff, ab_ref, caster);
          const unit_val = (full_val != null && ab_ref.stack > 0) ? (full_val / ab_ref.stack) : null;
          if (unit_val != null && caster_base_hp > 0) {
            for (const tgt of targets!) {
              if (has(this.state['hp'], tgt)) {
                this.state['hp'][tgt] = pmin(
                  this.state['hp'][tgt] + caster_base_hp * unit_val / 100.0,
                  this.effective_max_hp(tgt),
                );
                this.sync_hp(tgt);
              }
            }
          }
        } else {  // hp_only_caster_based_pct: 최대 체력만 증가, 현재 체력 유지
          for (const tgt of targets!) {
            if (has(this.state['hp'], tgt)) {
              this.sync_hp(tgt);
            }
          }
        }
      }
    }

    // max_hp_pct / max_hp_only_pct 발동 후처리
    if ((stat === 'max_hp_pct' || stat === 'max_hp_only_pct') && has(this.state, 'hp')) {
      const ab_ref = this._active.find((ab) => ab.effect === eff && ab.caster === caster) ?? null;
      if (ab_ref != null && truthy(targets)) {
        if (stat === 'max_hp_pct') {
          // 현재 체력 동반 증가: 이번 스택 1회분 단위값만큼 hp 가산
          const base_hp = get(get(get(this.state, 'base_stats', {}), caster, {}), 'hp', 0.0);
          const full_val = this._get_value(eff, ab_ref, caster);  // 현재 스택 기준 전체값
          const unit_val = (full_val != null && ab_ref.stack > 0) ? (full_val / ab_ref.stack) : null;
          if (unit_val != null && base_hp > 0) {
            for (const tgt of targets!) {
              if (has(this.state['hp'], tgt)) {
                this.state['hp'][tgt] = pmin(
                  this.state['hp'][tgt] + base_hp * unit_val / 100.0,
                  this.effective_max_hp(tgt),
                );
                this.sync_hp(tgt);
              }
            }
          }
        } else {
          // 최대 체력만 증가: hp 절대값 변화 없음, hp_pct만 재동기화
          for (const tgt of targets!) {
            if (has(this.state['hp'], tgt)) {
              this.sync_hp(tgt);
            }
          }
        }
      }
    }
  }

  // ── 틱 (every:Ns 처리 + 만료 정리) ──────────────────────────────────

  // py: calculator/buff_manager.py:2889
  /**
   * 매 프레임(또는 적절한 간격)마다 호출.
   * - 만료 버프 제거
   * - every:Ns 효과 발동 체크
   */
  tick(t: number): void {
    this._cur_t = t;

    // 조건부 passive + 유한 지속: 조건이 참인 동안 만료를 민다(`_is_cond_finite_passive`).
    if (truthy(this._cond_finite_passives)) {
      const down = get(this.state, 'down');
      for (const [eff, caster] of this._cond_finite_passives) {
        if (truthy(down) && inContainer(down, caster)) {
          continue;
        }
        if (!this._condition_ok(get(item(eff, 'trigger'), 'condition', []), caster, t, eff)) {
          continue;
        }
        const ab = this._active.find((a) => a.effect === eff && a.caster === caster) ?? null;
        if (ab == null) {
          this._activate(eff, caster, t);
        } else {
          // 갱신은 조용히 한다 — 조건이 참인 내내 activate 로그가 쌓이지 않도록.
          ab.expires_at = pmax(ab.expires_at, this._expires_at(eff, caster, t));
          this._invalidate_values();
        }
      }
    }

    // ── `same_target:[이름]` DoT 중첩 램프 ────────────────────────────
    // 아래 주기 틱보다 **먼저** 처리해야 같은 프레임에서 중첩이 앞서 반영된다.
    if (truthy(this._damage_handler) && truthy(this._ramp_pending)) {
      const due = this._ramp_pending.filter((p) => t >= p[0]);
      if (truthy(due)) {
        this._ramp_pending = this._ramp_pending.filter((p) => t < p[0]);
        for (const [, eff, caster, stack] of sorted(due, (p) => p[0])) {
          const ab = this._active.find((a) => a.effect === eff && a.caster === caster) ?? null;
          if (ab == null) {
            continue;
          }
          ab.stack = stack;
          this._invalidate_values();
          this._damage_handler!(eff, caster, t);
        }
      }
    }

    // ── 주기 대미지(tick_interval) — 만료 정리보다 **먼저** 처리한다 ──────
    // (파이썬은 순회 중 dict 크기가 바뀌면 RuntimeError다. Map은 새 키도 순회한다 — 정상 경로에서는 없는 일.)
    if (truthy(this._damage_handler) && this._dot_timers.size > 0) {
      const eff_by_id = this._eff_by_id;  // __init__에서 만든 id → eff 역참조 맵
      const expired_dots: object[] = [];
      for (const [eid, [caster, next_t, expires_at]] of this._dot_timers) {
        const eff = eff_by_id.get(eid);
        if (eff === undefined) {
          expired_dots.push(eid);
          continue;
        }
        // 만료 경계는 첫 틱 위상과 짝을 이룬다 — 양쪽 유형의 틱 회수를 같게 만든다.
        let limit: number;
        if (get(eff, 'tick_start') === 'immediate') {
          limit = expires_at - _TICK_EPS;
        } else {
          limit = expires_at + _TICK_EPS;
        }
        if (next_t > limit) {
          expired_dots.push(eid);
          continue;
        }
        if (t >= next_t) {
          // DoT는 _activate 시점에 조건 통과 후 등록된 것이므로 틱마다 재검사 없이 무조건 발동한다.
          // 만료 시각에 떨어지는 type 2의 마지막 틱은 **만료 직전 시각으로 당겨서** 계산한다.
          let dmg_t = t;
          if (t >= expires_at) {
            dmg_t = expires_at - _TICK_NUDGE;
          }
          this._damage_handler!(eff, caster, dmg_t);
          const interval = get(eff, 'tick_interval', 1.0);
          this._dot_timers.set(eid, [caster, next_t + interval, expires_at]);
        }
      }
      for (const eid of expired_dots) {
        this._dot_timers.delete(eid);
      }
    }

    // ── 소환체 주기 공격(feather_tick) ────────────────────────────────
    const feathers = get(this.state, 'feathers');
    if (truthy(feathers)) {
      for (const f_caster of Object.keys(feathers)) {
        const by_id = feathers[f_caster];
        for (const fk of Object.keys(by_id)) {
          const st = by_id[fk];
          const nxt = get(st, 'next_t', null);
          if (nxt == null || t < nxt) {
            continue;
          }
          let n = 0;
          for (const e of item(st, 'expiry') as number[]) if (e > t) n += 1;
          if (n === 0) {
            st['next_t'] = null;      // 전멸 — 재소환 전까지 정지
            continue;
          }
          this.notify('feather_tick', t, f_caster);
          st['next_t'] = nxt + pmax(0.001, st['base'] * (1.0 - st['reduction'] * (n - 1)));
        }
      }
    }

    // 만료 버프 제거 + state_end 이벤트 발생
    let any_expired = false;
    for (const ab of this._active) {
      if (t >= ab.expires_at) { any_expired = true; break; }
    }
    const expired_buffs = any_expired ? this._active.filter((ab) => t >= ab.expires_at) : [];
    if (truthy(expired_buffs)) {
      this._invalidate_buffs_cache();
    }
    this._active = any_expired ? this._active.filter((ab) => t < ab.expires_at) : this._active.slice();
    for (const ab of expired_buffs) {
      const name = abName(ab, '');
      if (truthy(name)) {
        this.notify(`event:state_end:${name}`, t, ab.caster);
        if (truthy(this._buff_event_handler)) {
          // 한 번도 조회되지 않고 만료된 지연 resolve 버프는 여기서 확정한다
          const log_chars = this._resolve_lazy(ab);
          for (const tgt of (or(log_chars, []) as string[])) {
            this._buff_event_handler!('expire', name, ab.caster, tgt, t, t);
          }
        }
      }
      // hp_caster_based_pct / hp_only_caster_based_pct 만료 시 현재 체력 캡
      const st = abStat(ab);
      if ((st === 'hp_caster_based_pct' || st === 'hp_only_caster_based_pct') && has(this.state, 'hp')) {
        for (const tgt of (or(ab.target_chars, []) as string[])) {
          if (has(this.state['hp'], tgt)) {
            const new_max = this.effective_max_hp(tgt);
            if (this.state['hp'][tgt] > new_max) {
              this.state['hp'][tgt] = new_max;
            }
            this.sync_hp(tgt);
          }
        }
      }
    }

    // weapon_change 만료 정리 (state_end 이벤트 포함)
    const wc = get(this.state, 'weapon_change', {});
    // Allow the continuous attack scheduled exactly at the duration endpoint.
    const expired = Object.entries(wc as Dict)
      .filter(([, info]) => (truthy(get(item(info, 'effect'), 'continuous_charge'))
        ? t > info['expires_at'] + 1e-8
        : t >= info['expires_at']))
      .map(([name]) => name);
    for (const name of expired) {
      this.end_weapon_change(name, t);
    }

    // 조건부 passive 버프: 조건 충족 여부 변화 감지 → buff_event_handler 발생
    if (truthy(this._buff_event_handler)) {
      for (const ab of this._active) {
        if (ab.expires_at < Infinity) {
          continue;
        }
        const pm = _passiveMeta(ab.effect);
        if (pm.duration_bullets !== -1) {
          continue;  // 영구 passive만 대상; N발 유지 조건은 발동 시 고정
        }
        const conditions = pm.has_trigger ? pm.conditions : get(item(ab.effect, 'trigger'), 'condition', []);
        if (!truthy(conditions)) {
          continue;  // 무조건 passive는 이미 t=0에 등록됨
        }
        const bid = ab.uid;
        const now_met = this._runtime_condition_ok(conditions, ab.caster, ab.caster, ab.caster, t);
        const prev_met = this._cond_passive_prev.get(bid);
        if (prev_met === undefined) {
          // 첫 틱: 현재 상태만 기록, 이미 suppress_event로 처리됨
          this._cond_passive_prev.set(bid, now_met);
        } else if (now_met && !prev_met) {
          // False → True: 조건 충족 시작 → activate 이벤트
          this._cond_passive_prev.set(bid, true);
          const tgt_chars = (
            ab.target_chars == null
              ? this._resolve_target(get(ab.effect, 'target', 'self'), ab.caster)
              : ab.target_chars
          );
          const _val = this._get_value(ab.effect, ab, ab.caster);
          const _stat = abStat(ab, null);
          for (const tgt of tgt_chars) {
            this._buff_event_handler!('activate', abName(ab, ''), ab.caster, tgt, t, Infinity, _val, _stat,
              ab.stack, get(ab.effect, 'max_stack', 1));
          }
        } else if (!now_met && prev_met) {
          // True → False: 조건 해제 → expire 이벤트
          this._cond_passive_prev.set(bid, false);
          const tgt_chars = (
            ab.target_chars == null
              ? this._resolve_target(get(ab.effect, 'target', 'self'), ab.caster)
              : ab.target_chars
          );
          for (const tgt of tgt_chars) {
            this._buff_event_handler!('expire', abName(ab, ''), ab.caster, tgt, t, t);
          }
        }
      }
    }

    // every:Ns 처리 (`_every_effects`는 __init__에서 한 번만 추린다)
    for (const [eff, caster, timing] of this._every_effects) {
      const eid = eff;
      const base_interval = float(timing.slice(6, -1));  // "every:20s" → 20.0
      // skill_cooldown_pct 버프 반영: 음수 = 감소 (예: -75% → interval × 0.25)
      const cool_pct = sum(
        this._by_stat('skill_cooldown_pct')
          .filter((ab) => ab.target_chars == null || (or(ab.target_chars, []) as string[]).includes(caster))
          .map((ab) => or(this._get_value(ab.effect, ab, caster), 0.0) as number),
      );
      // effect_interval 버프 반영: 이 효과(target_effect)의 발동 주기를 초 단위로 가감
      const eff_name = get(eff, 'name', '');
      let flat = 0.0;
      if (truthy(eff_name)) {
        flat = sum(
          this._by_stat('effect_interval')
            .filter((ab) => get(ab.effect, 'target_effect', null) === eff_name
              && (ab.target_chars == null || (or(ab.target_chars, []) as string[]).includes(caster)))
            .map((ab) => or(this._get_value(ab.effect, ab, caster), 0.0) as number),
        );
      }
      let interval = pmax(0.0, base_interval + flat) * pmax(0.0, 1.0 + cool_pct / 100.0);
      interval = pmax(interval, base_interval * 0.05);  // 최소 5% cap
      if (!this._next_fire.has(eid)) {
        // 전투 시작 후 interval초 후 첫 발동
        this._next_fire.set(eid, [interval, interval]);
      }
      let [next_t, prev_interval] = this._next_fire.get(eid)!;
      if (interval !== prev_interval) {
        // 쿨감이 도중에 켜지거나 꺼졌다 — 남은 시간을 새 배율로 비례 재조정한다.
        if (prev_interval === 0) throw new PyError('ZeroDivisionError', 'float division by zero');
        next_t = t + pmax(0.0, next_t - t) * (interval / prev_interval);
      }
      this._next_fire.set(eid, [next_t, interval]);
      if (t >= next_t) {
        if (this._condition_ok(get(item(eff, 'trigger'), 'condition', []), caster, t, eff)) {
          this._activate(eff, caster, t);
        }
        this._next_fire.set(eid, [next_t + interval, interval]);
      }
    }

    // tick_interval instant 처리
    if (this._instant_timers.size > 0) {
      const eff_by_id = this._eff_by_id;
      const expired_instants: object[] = [];
      for (const [eid, [caster, next_t, expires_at]] of [...this._instant_timers.entries()]) {
        if (t >= expires_at) {
          expired_instants.push(eid);
          continue;
        }
        if (t < next_t) {
          continue;
        }
        const eff = eff_by_id.get(eid);
        if (eff === undefined) {
          expired_instants.push(eid);
          continue;
        }
        // 영구(duration -1) 주기 instant는 런타임 조건을 매 틱 재평가한다.
        if (get(eff, 'duration') === -1) {
          const conds = get(item(eff, 'trigger'), 'condition', []);
          if (truthy(conds) && !this._runtime_condition_ok(conds, caster, caster, caster, t)) {
            this._instant_timers.set(eid, [caster, next_t + get(eff, 'tick_interval', 1.0), expires_at]);
            continue;
          }
        }
        this._dispatch_instant(eff, caster, t, true);
        const interval = get(eff, 'tick_interval', 1.0);
        this._instant_timers.set(eid, [caster, next_t + interval, expires_at]);
      }
      for (const eid of expired_instants) {
        this._instant_timers.delete(eid);
      }
    }
  }

  // ── 버프 집계 ─────────────────────────────────────────────────────────

  // py: calculator/buff_manager.py:3133
  /** 이미 활성인 버프의 **값만** 바뀌었다. 이 프레임에 집계해 둔 결과(`_buffs_cache`)만 버린다. */
  _invalidate_values(): void {
    this._buffs_cache.clear();
    this._ammo_reuse.clear();
  }

  // py: calculator/buff_manager.py:3144
  _invalidate_buffs_cache(): void {
    this._cache_version += 1;
    this._buffs_cache.clear();
    this._ammo_reuse.clear();
    this._stunned_cache.clear();
    // 아래 셋은 전부 "`_active`가 그대로인 동안" 유효한 파생물이다.
    this._plan_cache.clear();
    this._ammo_plan_cache.clear();
    this._stat_index.clear();
    this._name_index_cache.clear();
  }

  // py: calculator/buff_manager.py:3155
  /** 대상에게 적용 중인 `buff_max_stack_add`를 포함한 중첩 상한. */
  _effective_stack_cap(eff: Eff, recipient: string, t: number): number {
    const base = int(get(eff, 'max_stack', 1));
    if (base <= 1) {
      return base;
    }

    let bonus = 0.0;
    for (const ab of this._by_stat('buff_max_stack_add')) {
      if (t >= ab.expires_at || !(or(ab.target_chars, []) as string[]).includes(recipient)) {
        continue;
      }
      if (ab.has_runtime_conditions && !this._runtime_condition_ok(
        get(item(ab.effect, 'trigger'), 'condition', []),
        ab.caster,
        recipient,
        recipient,
        t,
      )) {
        continue;
      }
      const value = this._get_value(ab.effect, ab, recipient);
      if (value != null) {
        bonus += value;
      }
    }
    return base + pmax(0, int(bonus));
  }

  // ── `_active` 인덱스 ──────────────────────────────────────────────────

  // py: calculator/buff_manager.py:3188
  /** `stat`이 일치하는 활성 버프 목록 (_active 순서 유지). */
  _by_stat(stat: string): ActiveBuff[] {
    let out = this._stat_index.get(stat);
    if (out === undefined) {
      out = this._active.filter((ab) => abStat(ab, null) === stat);
      this._stat_index.set(stat, out);
    }
    return out;
  }

  // py: calculator/buff_manager.py:3197
  /** 효과 이름이 일치하는 활성 버프 목록 (_active 순서 유지). */
  _by_name(name: string): ActiveBuff[] {
    let out = this._name_index_cache.get(name);
    if (out === undefined) {
      out = this._active.filter((ab) => abName(ab, null) === name);
      this._name_index_cache.set(name, out);
    }
    return out;
  }

  // py: calculator/buff_manager.py:3210
  /** 이 버프의 기여가 `_active`가 그대로인 동안 절대 변하지 않는가. (원본 docstring 참고) */
  static _is_time_invariant(ab: ActiveBuff): boolean {
    if (ab.expires_at !== Infinity) {
      return false;
    }
    return BuffManager._is_value_invariant(ab);
  }

  /** [고속 엔진] `_is_time_invariant`에서 «끝나는 시각 없음»만 뺀 것 — 살아 있는 동안 값이 같은가. */
  static _is_value_invariant(ab: ActiveBuff): boolean {
    if (ab.has_runtime_conditions) {
      return false;
    }
    if (ab.target_chars == null) {
      return false;
    }
    if (truthy(ab.per_char_stacks)) {
      return false;
    }
    const eff = ab.effect;
    if (truthy(get(eff, 'scaling'))) {
      return false;
    }
    if (get(eff, 'max_stack', 1) !== 1) {
      return false;
    }
    if (ab.bullets_left !== -1 || truthy(ab.bullets_per_target)) {
      return false;
    }
    if (get(eff, 'stat') === 'burst_charge_speed_pct') {
      // 그 시전자가 일반 공격을 명중시켰는지에 따라 참조값이 바뀐다.
      return false;
    }
    return true;
  }

  // py: calculator/buff_manager.py:3248
  /**
   * 시간 불변 버프 1개를 미리 평가해 스텝으로 축약. 기여가 없으면 None.
   * 분기 순서는 `get_buffs`의 조회 시점 경로와 **한 줄씩 대응한다.**
   */
  _plan_step(ab: ActiveBuff, caster: string, target: string,
    exclude_names: ReadonlySet<string>): any[] | null {
    const eff = ab.effect;
    if (exclude_names.size > 0 && ab.caster === caster && exclude_names.has(get(eff, 'name', null))) {
      return null;
    }
    const stat = get(eff, 'stat', '');
    let buff_key = get(_STAT_TO_BUFF, stat, null) as string | null;
    if (!truthy(buff_key)) {
      return null;
    }

    const target_chars = or(ab.target_chars, []) as string[];
    const applies_to_caster = target_chars.includes(caster);
    const applies_to_target = target_chars.includes(target);
    // 고급 설정의 개인 수치는 적이 아니라 본인에게 붙은 채로 ⑥에 반영된다.
    if (stat === 'personal_received_dmg_pct' || stat === 'personal_enemy_def_down_pct') {
      if (!applies_to_caster) {
        return null;
      }
    } else if (buff_key === 'received_dmg') {
      if (!applies_to_target) {
        return null;
      }
    } else if (buff_key === 'split_dmg_pct') {
      if (!applies_to_caster) {
        return null;
      }
    } else if (!(applies_to_caster || applies_to_target)) {
      return null;
    }

    if (stat === 'def_pct' && applies_to_target && !applies_to_caster) {
      buff_key = 'enemy_def_down_pct';
    }
    const actual_recipient = applies_to_caster ? caster : target;

    if (_BOOL_BUFF_KEYS.has(buff_key!)) {
      return [_PLAN_FLAG, buff_key, null];
    }

    const val = this._get_value(eff, ab, actual_recipient, null);
    if (val == null) {
      return null;
    }
    if (_CRIT_RATE_STATS.has(stat)) {
      // key 자리에 「일반 공격 한정인가」를 싣는다 — 스킬 딜용 합에서 뺄 기여를 가린다
      return [_PLAN_CRIT, _NORMAL_ATK_ONLY_CRIT_RATE_STATS.has(stat), val / 100];
    }
    if (_CRIT_DMG_STATS.has(stat)) {
      return [_PLAN_CDMG, _NORMAL_ATK_ONLY_CRIT_DMG_STATS.has(stat), val];
    }
    if (_QUANT_BUFF_KEYS.has(buff_key!)) {
      return [_PLAN_QUANT, [buff_key, _quant_group_key(ab)], val];
    }
    return [_PLAN_ADD, buff_key, val];
  }

  // py: calculator/buff_manager.py:3299
  /** `_active`를 훑는 순서를 그대로 보존한 get_buffs 실행 계획. (원본 docstring 참고) */
  _build_plan(caster: string, target: string, exclude_names: ReadonlySet<string>): any[] {
    const key = caster + '\u0000' + target + '\u0000' + frozenKey(exclude_names);
    const plan: any[] = [];
    for (const ab of this._active) {
      // [고속 엔진] 파이썬은 끝나는 시각이 있는 버프를 전부 «매번 평가»(LIVE)로 돌린다. 그런데
      // 값이 시간·상태에 따라 변하지 않는 버프(중첩·비례·조건·탄환 수 없음)는 **끝나기 전까지 값이
      // 같다**. 그런 버프는 스텝을 미리 접어 두고, 조회 때 만료만 본다(4번째 칸 = 그 버프).
      // 합산 순서는 `_active` 순서 그대로라 결과는 한 자리까지 같다.
      if (!BuffManager._is_value_invariant(ab)) {
        plan.push([_PLAN_LIVE, ab, null]);
        continue;
      }
      let step: any = ab.plan_steps.has(key) ? ab.plan_steps.get(key) : _STEP_UNSET;
      if (step === _STEP_UNSET) {
        step = this._plan_step(ab, caster, target, exclude_names);
        ab.plan_steps.set(key, step);
      }
      if (step != null) {
        plan.push(ab.expires_at !== Infinity ? [step[0], step[1], step[2], ab] : step);
      }
    }
    this._plan_cache.set(key, plan);
    return plan;
  }

  // py: calculator/buff_manager.py:3325
  /** `get_buffs`에서 **최대 장탄 두 키만** 뽑은 것 — `max_ammo_pct`(그룹 목록 포함)·`max_ammo_flat`. */
  max_ammo_buffs(caster: string, target: string, t: number): Dict {
    const cached = this._buffs_cache.get(caster + '\u0000')?.get(t);
    if (cached !== undefined) {
      return cached;
    }
    const ammo_key = caster + '\u0000' + target;
    let plan = this._ammo_plan_cache.get(ammo_key);
    if (plan === undefined) {
      let full = this._plan_cache.get(caster + '\u0000' + target + '\u0000');
      if (full === undefined) {
        full = this._build_plan(caster, target, EMPTY_FROZENSET);
      }
      // 순서를 그대로 둔 채 쓸모없는 스텝만 뺀다.
      plan = [];
      for (const step of full) {
        const [kind, key] = step;
        if (kind === _PLAN_ADD) {
          if (key === 'max_ammo_flat') {
            plan.push(step);
          }
        } else if (kind === _PLAN_QUANT) {
          if (key[0] === 'max_ammo_pct') {
            plan.push(step);
          }
        } else if (kind === _PLAN_LIVE) {
          const bk = get(_STAT_TO_BUFF, get((key as ActiveBuff).effect, 'stat', ''), null);
          if (bk === 'max_ammo_pct' || bk === 'max_ammo_flat' || (truthy(bk) && (key as ActiveBuff).target_chars == null)) {
            plan.push(step);
          }
        }
      }
      this._ammo_plan_cache.set(ammo_key, plan);
    }
    const reuse = this._ammo_reuse.get(ammo_key);
    if (reuse !== undefined && t >= reuse.t && t < reuse.until) {
      return reuse.d;
    }
    let reuse_until = Infinity;
    let flat = 0.0;
    const quant_parts = new TupleDict();
    for (const [kind, key, pre, until] of plan) {
      if (until !== undefined) {
        if (t >= until.expires_at) {
          continue;
        }
        if (until.expires_at < reuse_until) reuse_until = until.expires_at;
      }
      if (kind === _PLAN_LIVE) {
        reuse_until = -Infinity;  // 매번 평가 버프가 있으면 다시 쓰지 않는다
      }
      if (kind === _PLAN_ADD) {
        if (key === 'max_ammo_flat') {
          flat = flat + pre;
        }
        continue;
      }
      if (kind === _PLAN_QUANT) {
        if (key[0] === 'max_ammo_pct') {
          quant_parts.add(_skOf(key), key, pre);
        }
        continue;
      }
      if (kind !== _PLAN_LIVE) {
        continue;
      }
      const ab = key as ActiveBuff;
      if (t >= ab.expires_at) {
        continue;
      }
      const eff = ab.effect;
      const stat = get(eff, 'stat', '');
      const buff_key = get(_STAT_TO_BUFF, stat, null) as string | null;
      if (!truthy(buff_key)) {
        continue;
      }
      const target_chars = ab.target_chars != null ? ab.target_chars : this._resolve_lazy(ab);
      if (!(buff_key === 'max_ammo_pct' || buff_key === 'max_ammo_flat')) {
        continue;
      }
      const applies_to_caster = target_chars.includes(caster);
      const applies_to_target = target_chars.includes(target);
      if (!(applies_to_caster || applies_to_target)) {
        continue;
      }
      const actual_recipient = applies_to_caster ? caster : target;
      if (ab.has_runtime_conditions) {
        const conditions = get(item(eff, 'trigger'), 'condition', []);
        if (!this._runtime_condition_ok(
          conditions, ab.caster, caster, actual_recipient, t,
        )) {
          continue;
        }
      }
      const char_stack = truthy(ab.per_char_stacks) ? get(ab.per_char_stacks, caster, null) : null;
      const val = this._get_value(eff, ab, actual_recipient, char_stack);
      if (val == null) {
        continue;
      }
      if (buff_key === 'max_ammo_pct') {
        const gk = _liveQuantKey(ab, buff_key);
        quant_parts.add(gk.s, gk.k, val);
      } else {
        flat = flat + val;
      }
    }
    const parts = quant_parts.values();
    let total = 0.0;
    for (const v of parts) {
      total = total + v;
    }
    const d = {
      'max_ammo_pct': total, 'max_ammo_flat': flat,
      [_QUANT_PARTS_KEY]: { 'max_ammo_pct': parts },
    };
    if (reuse_until > t) this._ammo_reuse.set(ammo_key, { t, until: reuse_until, d });
    else this._ammo_reuse.delete(ammo_key);
    return d;
  }

  // py: calculator/buff_manager.py:3412
  /**
   * 현재 시각 t에서 caster가 target을 공격할 때 적용되는 buffs 딕셔너리 반환.
   * `exclude_names`: caster 본인이 건 버프 중 이 이름들은 집계에서 뺀다(파이썬 frozenset —
   * Set·배열 등 아무 순회 가능한 문자열 모음이면 된다).
   */
  get_buffs(caster: string, target: string, t: number,
    exclude_names: Iterable<string> = EMPTY_FROZENSET): Dict {
    const excl = exclude_names === EMPTY_FROZENSET ? EMPTY_FROZENSET : toFrozenSet(exclude_names);
    const excl_key = frozenKey(excl);
    const outer_key = caster + '\u0000' + excl_key;
    let by_t = this._buffs_cache.get(outer_key);
    const cached = by_t?.get(t);
    if (cached !== undefined) {
      return cached;
    }

    let plan = this._plan_cache.get(caster + '\u0000' + target + '\u0000' + excl_key);
    if (plan === undefined) {
      plan = this._build_plan(caster, target, excl);
    } else if (_BUFF_AUDIT) {
      const fresh = this._build_plan(caster, target, excl);
      if (!_plan_eq(fresh, plan)) {
        throw new PyError('AssertionError',
          `get_buffs 계획 캐시가 낡았다 (caster=${caster}, t=${reprFloat(t)}). `
          + '`_active`를 바꾸고 _invalidate_buffs_cache()를 부르지 않은 경로가 있다.');
      }
      plan = fresh;
    }

    const buffs: Dict = { ..._BUFFS_ZERO };
    const crit_rate_parts: number[] = [0.15];
    // 일반 공격 한정 기여를 뺀 합. **따로 누산**하는 이유는 순서 보존이다.
    const crit_rate_skill_parts: number[] = [0.15];
    // 크리 대미지도 같은 이유로 순서 보존 리스트.
    const crit_dmg_parts: number[] = [0.0];
    const crit_dmg_skill_parts: number[] = [0.0];  // 기본 크리확률 15%
    // 소스별 반올림 스탯의 그룹별 기여. {(buff_key, 그룹키): 합} — 삽입 순서가 곧 `_active` 순서.
    const quant_parts = new TupleDict();

    for (const [kind, key, pre, until] of plan) {
      // 끝나는 시각이 있는 접힌 스텝 — 만료됐으면 매번 평가 경로처럼 건너뛴다
      if (until !== undefined && t >= until.expires_at) {
        continue;
      }
      // 미리 접어 둔 스텝 — 시간 불변 버프의 기여 (`_build_plan`)
      if (kind === _PLAN_ADD) {
        buffs[key] = get(buffs, key, 0.0) + pre;
        continue;
      }
      if (kind === _PLAN_CRIT) {
        crit_rate_parts.push(pre);
        if (!key) {  // key = 일반 공격 한정 여부
          crit_rate_skill_parts.push(pre);
        }
        continue;
      }
      if (kind === _PLAN_CDMG) {
        crit_dmg_parts.push(pre);
        if (!key) {  // key = 일반 공격 한정 여부
          crit_dmg_skill_parts.push(pre);
        }
        continue;
      }
      if (kind === _PLAN_QUANT) {
        quant_parts.add(_skOf(key), key, pre);
        continue;
      }
      if (kind === _PLAN_FLAG) {
        buffs[key] = true;
        continue;
      }

      // _PLAN_LIVE — 시간·상태에 따라 기여가 변하는 버프는 매번 평가한다
      const ab = key as ActiveBuff;
      if (t >= ab.expires_at) {
        continue;
      }

      const eff = ab.effect;
      if (excl.size > 0 && ab.caster === caster && excl.has(get(eff, 'name', null))) {
        continue;
      }
      const stat = get(eff, 'stat', '');
      let buff_key = get(_STAT_TO_BUFF, stat, null) as string | null;
      if (!truthy(buff_key)) {
        continue;
      }

      // 지연 resolve: 활성화 시점 직후 첫 조회 때 1회 결정하고 캐싱.
      const target_chars = ab.target_chars != null ? ab.target_chars : this._resolve_lazy(ab);

      // 대상 확인: 버프가 caster 또는 target에게 적용되는지
      const applies_to_caster = target_chars.includes(caster);
      const applies_to_target = target_chars.includes(target);

      // received_dmg 계열: 적(target)에게 부여된 것만 ⑥에 반영
      // split_dmg 계열: 아군(caster)에게 부여된 것만 ⑥에 반영
      if (stat === 'personal_received_dmg_pct' || stat === 'personal_enemy_def_down_pct') {
        if (!applies_to_caster) {
          continue;
        }
      } else if (buff_key === 'received_dmg') {
        if (!applies_to_target) {
          continue;
        }
      } else if (buff_key === 'split_dmg_pct') {
        if (!applies_to_caster) {
          continue;
        }
      } else if (!(applies_to_caster || applies_to_target)) {
        continue;
      }

      // def_pct: 적(enemy)에게 부여되면 방어력 감소(②)로 라우팅.
      if (stat === 'def_pct' && applies_to_target && !applies_to_caster) {
        buff_key = 'enemy_def_down_pct';
      }

      // caster_based 환산을 위해 실제 버프 수령자를 특정
      const actual_recipient = applies_to_caster ? caster : target;

      // runtime condition 재평가: **수령자를 확정한 뒤에** 본다.
      if (ab.has_runtime_conditions) {
        const conditions = get(item(eff, 'trigger'), 'condition', []);
        if (!this._runtime_condition_ok(
          conditions, ab.caster, caster, actual_recipient, t,
        )) {
          continue;
        }
      }

      // boolean 플래그 스탯: 수치 없이 True만 세팅
      if (_BOOL_BUFF_KEYS.has(buff_key!)) {
        buffs[buff_key!] = true;
        continue;
      }

      const char_stack = truthy(ab.per_char_stacks) ? get(ab.per_char_stacks, caster, null) : null;
      let val = this._get_value(eff, ab, actual_recipient, char_stack);
      if (val == null) {
        continue;
      }
      // 「버스트 충전 속도」는 시전자 기준 히트당 %p로 환산해 싣는다(실누적 게이지).
      [buff_key, val] = this._route_burst_charge(ab, buff_key!, val);

      if (_CRIT_RATE_STATS.has(stat)) {
        crit_rate_parts.push(val / 100);
        if (!_NORMAL_ATK_ONLY_CRIT_RATE_STATS.has(stat)) {
          crit_rate_skill_parts.push(val / 100);
        }
      } else if (_CRIT_DMG_STATS.has(stat)) {
        crit_dmg_parts.push(val);
        if (!_NORMAL_ATK_ONLY_CRIT_DMG_STATS.has(stat)) {
          crit_dmg_skill_parts.push(val);
        }
      } else if (_QUANT_BUFF_KEYS.has(buff_key)) {
        const gk = _liveQuantKey(ab, buff_key);
        quant_parts.add(gk.s, gk.k, val);
      } else {
        buffs[buff_key] = get(buffs, buff_key, 0.0) + val;
      }
    }

    // 크리확률 합성: 단순 합연산. 100%에서 자른다.
    buffs['crit_rate'] = pmin(1.0, sum(crit_rate_parts));
    buffs['crit_rate_skill'] = pmin(1.0, sum(crit_rate_skill_parts));

    // 크리 대미지는 상한이 없다 — 합만 낸다 (③ 가산 항 `0.5 + crit_dmg%`).
    buffs['crit_dmg'] = sum(crit_dmg_parts);
    buffs['crit_dmg_skill'] = sum(crit_dmg_skill_parts);

    // 소스별 반올림 스탯: 그룹별 목록과 합계를 함께 싣는다.
    // 차지 속도 «효과» 면역은 여기서 **스킬로 걸린 기여만** 골라 뺀다. (원본 주석 참고)
    const immune_up = buffs['charge_speed_buff_immune'];
    const immune_down = buffs['charge_speed_debuff_immune'];
    const parts_by_key: Record<string, number[]> = {};
    for (const k of _QUANT_BUFF_KEYS) parts_by_key[k] = [];
    for (const [[bk, group], v] of quant_parts.items()) {
      if (
        bk === 'charge_speed_pct'
        && group[1] === _SKILL_SOURCE
        && ((v > 0 && truthy(immune_up)) || (v < 0 && truthy(immune_down)))
      ) {
        continue;
      }
      parts_by_key[bk]!.push(v);
      buffs[bk] = get(buffs, bk, 0.0) + v;
    }
    buffs[_QUANT_PARTS_KEY] = parts_by_key;

    // atk_from_hp_pct: 최종 최대 HP × (val/100) → atk_flat에 합산
    for (const ab of this._by_stat('atk_from_hp_pct')) {
      if (t >= ab.expires_at) {
        continue;
      }
      const target_chars = (
        ab.target_chars == null
          ? this._resolve_target(get(ab.effect, 'target', 'self'), ab.caster)
          : ab.target_chars
      );
      if (!target_chars.includes(caster)) {
        continue;
      }
      // 위 검사를 지났으므로 이 버프의 수령자는 caster로 확정이다.
      if (ab.has_runtime_conditions) {
        const conditions = get(item(ab.effect, 'trigger'), 'condition', []);
        if (!this._runtime_condition_ok(conditions, ab.caster, caster, caster, t)) {
          continue;
        }
      }
      const val = this._get_value(ab.effect, ab, caster);
      if (val == null) {
        continue;
      }
      const final_hp = this.effective_max_hp(caster);
      buffs['atk_flat'] = get(buffs, 'atk_flat', 0.0) + final_hp * (val / 100.0);
    }

    // atk_caster_based_pct: 시전자 공격력 × (val/100) → 수령자 atk_flat에 합산
    for (const ab of this._by_stat('atk_caster_based_pct')) {
      if (t >= ab.expires_at) {
        continue;
      }
      const target_chars = (
        ab.target_chars == null
          ? this._resolve_target(get(ab.effect, 'target', 'self'), ab.caster)
          : ab.target_chars
      );
      if (!target_chars.includes(caster)) {
        continue;
      }
      // 위 검사를 지났으므로 이 버프의 수령자는 caster로 확정이다.
      if (ab.has_runtime_conditions) {
        const conditions = get(item(ab.effect, 'trigger'), 'condition', []);
        if (!this._runtime_condition_ok(conditions, ab.caster, caster, caster, t)) {
          continue;
        }
      }
      const val = this._get_value(ab.effect, ab, ab.caster);
      if (val == null) {
        continue;
      }
      const caster_atk = get(get(get(this.state, 'base_stats', {}), ab.caster, {}), 'atk', 0.0);
      // atk_buff_mag_pct: 이 named buff를 target_effect로 참조하는 배율 적용
      let mag_mult = 1.0;
      const buff_name = abName(ab, '');
      if (truthy(buff_name)) {
        for (const mag_ab of this._by_stat('atk_buff_mag_pct')) {
          if (mag_ab.expires_at <= t) {
            continue;
          }
          if (get(mag_ab.effect, 'target_effect', null) !== buff_name) {
            continue;
          }
          const mag_tgt = (
            mag_ab.target_chars == null
              ? this._resolve_target(get(mag_ab.effect, 'target', 'self'), mag_ab.caster)
              : mag_ab.target_chars
          );
          if (!mag_tgt.includes(caster)) {
            continue;
          }
          const mag_val = this._get_value(mag_ab.effect, mag_ab, mag_ab.caster);
          if (mag_val != null) {
            mag_mult += mag_val / 100.0;
          }
        }
      }
      buffs['atk_flat'] = get(buffs, 'atk_flat', 0.0) + caster_atk * (val / 100.0) * mag_mult;
    }

    // charge_time_fixed가 있으면 차지속도 관련 버프/디버프 모두 0
    if (truthy(buffs['charge_time_fixed'])) {
      buffs['charge_speed_pct'] = 0.0;
      parts_by_key['charge_speed_pct'] = [];
    }

    // charge_speed 100% 초과분을 charge_dmg_pct로 환산 (레드 후드)
    const conv = buffs['charge_speed_overflow_conversion_pct'];
    if (conv > 0.0) {
      const overflow = pmax(0.0, buffs['charge_speed_pct'] - 100.0);
      if (overflow > 0.0) {
        buffs['charge_dmg_pct'] += overflow * conv / 100.0;
      }
    }

    // 핵(`calculator/cheats.py`)은 계산식이 아니라 **입력 표**를 바꾼다.
    if (this.cheats.on) {
      this.cheats.apply_to_buffs(buffs);
    }

    // Veil is a separate final damage multiplier, never received_dmg.
    // Query at the actual hit time, including battle-start and DoT ticks.
    // Copied/accumulated damage already includes this reduction at source.
    const windows: any[] = or(get(get(this.state, 'enemy', {}), 'defense_rate_windows'), []);
    if (truthy(windows)) {
      const frame_t = round(t, 9);
      let best = 0.0;
      let any_ = false;
      for (const w of windows) {
        const [start, end, rate] = w as [number, number, number];
        if (start <= frame_t && frame_t < end) {
          if (!any_ || rate > best) { best = rate; any_ = true; }
        }
      }
      buffs['enemy_defense_rate_pct'] = any_ ? best : 0.0;
    }

    if (by_t === undefined) { by_t = new Map(); this._buffs_cache.set(outer_key, by_t); }
    by_t.set(t, buffs);
    return buffs;
  }

  // py: calculator/buff_manager.py:3688
  /** get_buffs 호출 시마다 재평가하는 상태 의존 condition. */
  _runtime_condition_ok(
    conditions: string[],
    buff_caster: string,
    _query_caster: string,
    query_target: string,
    _t: number,
  ): boolean {
    for (const cond of conditions) {
      if (cond === 'during_charge') {
        if (!truthy(get(get(this.state, 'charging', {}), buff_caster))) {
          return false;
        }
      } else if (cond === 'during_full_burst') {
        if (!truthy(get(this.state, 'full_burst'))) {
          return false;
        }
      } else if (cond === 'not_during_full_burst') {
        if (truthy(get(this.state, 'full_burst'))) {
          return false;
        }
      } else if (cond.startsWith('self_hp_above:')) {
        const n = float(cond.split(':')[1]!);
        const hp_pct = get(get(this.state, 'hp_pct', {}), buff_caster, 100.0);
        if (hp_pct < n) {
          return false;
        }
      } else if (cond.startsWith('self_hp_below:')) {
        const n = float(cond.split(':')[1]!);
        const hp_pct = get(get(this.state, 'hp_pct', {}), buff_caster, 100.0);
        if (hp_pct > n) {
          return false;
        }
      } else if (cond === 'self_hp_max') {
        const hp_pct = get(get(this.state, 'hp_pct', {}), buff_caster, 100.0);
        if (hp_pct < 100.0) {
          return false;
        }
      } else if (cond === 'during_shield') {
        if (!this.has_shield(buff_caster)) {
          return false;
        }
      } else if (cond.startsWith('ally_hp_below:')) {
        const n = float(cond.split(':')[1]!);
        // 대상이 아군이고 체력이 N% 이하인지
        const hp_pct = get(get(this.state, 'hp_pct', {}), query_target, 100.0);
        if (hp_pct > n) {
          return false;
        }
      } else if (cond.startsWith('self_stack_above:')) {
        const parts = cond.split(':');
        const stack_name = parts[1]!, threshold = int(parts[2]!);
        let current = 0;
        for (const ab of this._by_name(stack_name)) {
          if (ab.caster === buff_caster
              && ((or(ab.target_chars, []) as string[]).includes(buff_caster)
                || (or(ab.target_chars, []) as string[]).includes('__enemy__'))) {
            current = ab.stack;
            break;
          }
        }
        if (current < threshold) {
          return false;
        }
      } else if (cond.startsWith('gauge_above:')) {
        const parts = cond.split(':');
        const gauge_id = parts[1]!, threshold = float(parts[2]!);
        const current = get(get(get(this.state, 'gauges', {}), buff_caster, {}), gauge_id, 0.0);
        if (current < threshold) {
          return false;
        }
      } else if (cond.startsWith('gauge_below:')) {
        const parts = cond.split(':');
        const gauge_id = parts[1]!, threshold = float(parts[2]!);
        const current = get(get(get(this.state, 'gauges', {}), buff_caster, {}), gauge_id, 0.0);
        if (current >= threshold) {
          return false;
        }
      } else if (cond.startsWith('self_state:')) {
        const state_name = cond.slice('self_state:'.length);
        const has_state = this._has_self_state(buff_caster, state_name);
        if (!has_state) {
          return false;
        }
      } else if (cond.startsWith('not_self_state:')) {
        const state_name = cond.slice('not_self_state:'.length);
        const has_state = this._has_self_state(buff_caster, state_name);
        if (has_state) {
          return false;
        }
      } else if (cond.startsWith('target_state:')) {
        const state_name = cond.slice('target_state:'.length);
        if (!this._has_target_state(state_name)) {
          return false;
        }
      } else if (cond.startsWith('not_target_state:')) {
        const state_name = cond.slice('not_target_state:'.length);
        if (this._has_target_state(state_name)) {
          return false;
        }
      } else if (cond.startsWith('enemy_count_below:')) {
        // 단일 보스 sim: 적 1기. "랩쳐 N기 이하" → 1 <= N (N>=1이면 항상 참)
        if (1 > int(cond.split(':')[1]!)) {
          return false;
        }
      } else if (cond.startsWith('enemy_count_above:')) {
        // 단일 보스 sim: 적 1기. "랩쳐 N기 이상" → 1 >= N (N>=2이면 항상 거짓)
        if (1 < int(cond.split(':')[1]!)) {
          return false;
        }
      }
      // prob:N은 notify 시점에만 평가 (get_buffs에서 재판정하지 않음)
    }
    return true;
  }

  // py: calculator/buff_manager.py:3782
  /** `scaling_ref` 등이 가리키는 이름의 현재 수치. 게이지도 버프도 아니면 None. */
  ref_count(caster: string, ref: string): number | null {
    if (!truthy(ref)) {
      return null;
    }
    const gauges = get(get(this.state, 'gauges', {}), caster, {});
    if (has(gauges, ref)) {
      return int(gauges[ref]);
    }
    // 소환체(feather_id) — 게이지와 같은 자리에서 본다. 값은 현재 생존 수
    const feathers = get(get(this.state, 'feathers', {}), caster, {});
    if (has(feathers, ref)) {
      let n = 0;
      for (const e of item(feathers[ref], 'expiry') as number[]) if (e > this._cur_t) n += 1;
      return n;
    }
    for (const ab of this._by_name(ref)) {
      if (ab.caster === caster) {
        return get(ab.per_char_stacks, caster, ab.stack);
      }
    }
    return null;
  }

  // py: calculator/buff_manager.py:3806
  /** `target: "same_target:[이름]"` DoT가 한 트리거에 몇 번 얹히는가. 짝을 못 찾으면 None. */
  _same_target_ramp_hits(eff: Eff, caster: string): number | null {
    const target = get(eff, 'target', '');
    if (typeof target !== 'string' || !target.startsWith('same_target:')) {
      return null;
    }
    const ref_name = target.slice('same_target:'.length);
    for (const [other, other_caster] of this._effects) {
      if (other_caster !== caster || get(other, 'name', null) !== ref_name) {
        continue;
      }
      const parts = (get(other, 'stat', '') as string).split(':');
      if (parts.length < 2) {
        return 1;
      }
      if (isdigit(lstripDash(parts[1]!))) {
        return int(parts[1]!);
      }
      const n = this.ref_count(caster, parts[1]!);
      return n != null ? n : 1;
    }
    return null;
  }

  // py: calculator/buff_manager.py:3832
  /** 효과 항목에서 현재 스킬 레벨 + 스택 기준 수치 반환. %값 그대로 반환. */
  _get_value(eff: Eff, ab: ActiveBuff, query_caster: string | null = null, stack_override: number | null = null): number | null {
    // [고속 엔진] 기본값(고정값 또는 스킬 레벨별 값)은 효과 사전·시전자·육성 설정에만 달렸다 —
    // 한 판 안에서는 변하지 않으므로 (효과, 시전자)마다 한 번만 구한다. 효과 사전은 만든 뒤
    // 고치지 않는다(값이 바뀌는 효과는 새 사전을 만든다).
    let per = this._raw_value_cache.get(eff);
    if (per === undefined) {
      per = new Map();
      this._raw_value_cache.set(eff, per);
    }
    let raw = per.get(ab.caster);
    if (raw === undefined) {
      if (has(eff, 'fixed_value')) {
        raw = float(eff['fixed_value']);
      } else if (has(eff, 'values')) {
        const char = get(this._char, ab.caster, {});
        const skill_lv = _get_skill_lv(char, eff);
        const vals = eff['values'];
        raw = float(get(vals, skill_lv, get(vals, '10', 0.0)));
      } else {
        raw = null;
      }
      per.set(ab.caster, raw);
    }
    if (raw === null) {
      return null;
    }
    let base: number = raw;
    const meta = _effMeta(eff);

    // charge_speed_caster_based_pct: 시전자 charge_time 기준으로 환산
    if (meta.stat === 'charge_speed_caster_based_pct') {
      const caster_nikke = get(_NIKKE(), ab.caster, {});
      const caster_charge_time = get(caster_nikke, 'charge_time', null);
      if (caster_charge_time == null) {
        return null;
      }
      const target_name = query_caster;  // get_buffs의 caster(=실제 버프 수령자)
      const target_nikke = truthy(target_name) ? get(_NIKKE(), target_name!, {}) : {};
      const target_charge_time = or(get(target_nikke, 'charge_time', null), caster_charge_time);
      const reduction_sec = caster_charge_time * base / 100.0;
      base = reduction_sec / target_charge_time * 100.0;
    }

    // lost_hp_pct: 잃은 체력 % 비례 (실제값 = base × 잃은 체력%)
    const scaling = meta.scaling;
    if (scaling === 'lost_hp_pct') {
      const hp_pct = get(get(this.state, 'hp_pct', {}), ab.caster, 100.0);
      const lost = pmax(0.0, 100.0 - hp_pct);
      return base * lost;
    }

    // 스택 합산 (per_char_stacks 오버라이드 우선 적용)
    const eff_stack = (stack_override != null ? stack_override
      : (query_caster != null ? get(ab.per_char_stacks, query_caster, ab.stack) : ab.stack));
    if (scaling === 'stack_count') {
      const ref = get(eff, 'scaling_ref');
      if (truthy(ref)) {
        // 발동 시점에 고정한 값이 있으면 그것을 쓴다 (_capture_scaling_stack 참고).
        const captured = ab.scaling_stack;
        const stack = captured != null ? captured : this.ref_count(ab.caster, ref);
        base *= stack != null ? stack : 0;
      } else {
        base *= eff_stack;
      }
      return base;
    }

    return meta.max_stack !== 1 ? base * eff_stack : base;
  }

  // ── 타겟 resolve ──────────────────────────────────────────────────────

  // py: calculator/buff_manager.py:3883
  /** 지연 resolve 버프(`_LAZY_RESOLVE_PREFIXES`)의 대상을 1회 결정하고 캐싱한다. (원본 docstring 참고) */
  _resolve_lazy(ab: ActiveBuff): string[] {
    if (ab.target_chars == null) {
      const raw_target = get(ab.effect, 'target', 'self');
      const key = tupleKey(ab.caster, ab.activated_at,
        typeof raw_target === 'string' ? raw_target : JSON.stringify(raw_target));
      let shared = this._lazy_target_cache.get(key);
      if (shared === undefined) {
        shared = this._resolve_target(raw_target, ab.caster);
        this._lazy_target_cache.set(key, shared);
      }
      ab.target_chars = [...shared];
      if (ab.bullets_left !== -1) {
        const bpt: Record<string, number> = {};
        for (const c of ab.target_chars) bpt[c] = ab.bullets_left;
        ab.bullets_per_target = bpt;
        ab.bullets_left = -1;
      }
      if (ab.log_pending) {
        ab.log_pending = false;
        const name = abName(ab, '');
        if (truthy(this._buff_event_handler) && truthy(name)) {
          const val = this._get_value(ab.effect, ab, ab.caster);
          const stat = abStat(ab, null);
          for (const tgt of ab.target_chars) {
            this._buff_event_handler!('activate', name, ab.caster, tgt,
              ab.activated_at, ab.expires_at, val, stat,
              ab.stack, get(ab.effect, 'max_stack', 1));
          }
        }
      }
    }
    return ab.target_chars;
  }

  // py: calculator/buff_manager.py:3924
  /** target 문자열 → 캐릭터명 목록. */
  _resolve_target(target: any, caster: string): string[] {
    if (Array.isArray(target)) {
      const result: string[] = [];
      for (const t of target) {
        result.push(...this._resolve_target(t, caster));
      }
      return result;
    }

    if (target === 'self') {
      return [caster];
    }
    // 캐릭터 이름 직접 지정 (예: "이사벨" — 아르카나 마법사 카드 예외)
    if (this.squad_names.includes(target)) {
      return [target];
    }
    if (target === 'all_allies') {
      return [...this.squad_names];
    }
    if (target === 'all_allies_burst_casted') {
      return this.squad_names.filter((n) => truthy(get(get(this.state, 'burst_casted', {}), n)));
    }
    if (target === 'all_allies_burst_not_casted') {
      return this.squad_names.filter((n) => !truthy(get(get(this.state, 'burst_casted', {}), n)));
    }
    if (target === 'all_allies_excl_self') {
      return this.squad_names.filter((n) => n !== caster);
    }
    if ((target as string).startsWith('allies_named:')) {
      const name = (target as string).slice('allies_named:'.length);
      return this.squad_names.includes(name) ? [name] : [];
    }
    if (target === 'allies_same_squad') {
      const squad_id = get(get(_NIKKE(), caster, {}), 'squad', null);
      return this.squad_names.filter((n) => get(get(_NIKKE(), n, {}), 'squad', null) === squad_id);
    }
    if (['enemy', 'all_enemies', 'target', 'target_body', 'same_target',
      'enemies_in_range', 'enemies_nearest_in_range'].includes(target)) {
      // 적 대상: "__enemy__" 센티널 사용 (타임라인이 판단)
      return ['__enemy__'];
    }

    const ts = target as string;
    if (ts.startsWith('allies_lowest_atk_burst3:')) {
      const n = int(ts.split(':')[1]!);
      let burst3 = this.squad_names.filter(
        (name) => get(get(_NIKKE(), name, {}), 'burst_stage', null) === '3');
      burst3 = sorted(burst3, (x) => this._effective_atk(x));
      return pyslice(burst3, n);
    }

    if (ts.startsWith('allies:')) {
      const n = int(ts.split(':')[1]!);
      return pyslice(this.squad_names, n);
    }
    if (ts.startsWith('allies_top_atk:')) {
      const n = int(ts.split(':')[1]!);
      return this._top_by('atk', n);
    }
    if (ts.startsWith('allies_top_atk_excl:')) {
      const n = int(ts.split(':')[1]!);
      return this._top_by('atk', n, caster);
    }
    if (ts.startsWith('allies_lowest_hp:')) {
      const n = int(ts.split(':')[1]!);
      return this._lowest_hp(n);
    }
    if (ts.startsWith('allies_lowest_hp_excl:')) {
      const n = int(ts.split(':')[1]!);
      return this._lowest_hp(n, caster);
    }
    if (ts.startsWith('allies_top_def:')) {
      const n = int(ts.split(':')[1]!);
      return this._top_by('def', n);
    }
    if (ts.startsWith('allies_random:')) {
      const n = int(ts.split(':')[1]!);
      const pool = this.squad_names.filter((x) => x !== caster);
      return random.sample(pool, Math.min(n, pool.length));
    }
    if (ts.startsWith('allies_random_debuffed:')) {
      const n = int(ts.split(':')[1]!);
      const pool = this.squad_names.filter(
        (x) => this._active.some((ab) => get(ab.effect, 'polarity') === 'harmful'
          && (or(ab.target_chars, []) as string[]).includes(x)),
      );
      return random.sample(pool, Math.min(n, pool.length));
    }
    if (ts.startsWith('allies_random_cover_destroyed:')) {
      const n = int(ts.split(':')[1]!);
      const destroyed = get(this.state, 'cover_destroyed', {});
      const pool = this.squad_names.filter((x) => truthy(get(destroyed, x, false)));
      return random.sample(pool, Math.min(n, pool.length));
    }
    if (ts.startsWith('allies_adjacent:')) {
      const n = int(ts.split(':')[1]!);
      const idx = listIndex(this.slot_names, caster);
      const adj: string[] = [];
      if (idx > 0) {
        adj.push(this.slot_names[idx - 1]!);
      }
      if (idx < this.slot_names.length - 1) {
        adj.push(this.slot_names[idx + 1]!);
      }
      return [caster, ...pyslice(adj, n)];
    }
    // "최종 공격력이 가장 높은 [무기] 소지 아군 N기" — 무기 필터 ∩ 공격력 top N. (레오나 `용기있는 시선 2`)
    if (ts.startsWith('allies_weapon_top_atk:')) {
      const [, wtype, cnt] = unpack(ts.split(':'), 3);
      let pool = this.squad_names.filter(
        (c) => item(item(_NIKKE(), c), 'weapon_type') === wtype);
      pool = sorted(pool, (x) => this._effective_atk(x), true);
      return pyslice(pool, int(cnt!));
    }
    if (ts.startsWith('allies_weapon_excl_self:')) {
      const wtype = ts.split(':')[1];
      return this.squad_names.filter(
        (n) => item(item(_NIKKE(), n), 'weapon_type') === wtype && n !== caster);
    }
    if (ts.startsWith('allies_weapon:')) {
      const wtype = ts.split(':')[1];
      return this.squad_names.filter(
        (n) => item(item(_NIKKE(), n), 'weapon_type') === wtype);
    }
    // "기본 차지 시간이 가장 긴 아군 N기" — 버프를 뺀 무기 표기 차지 시간 기준. (마나 `매터 시그마 4`)
    if (ts.startsWith('allies_top_base_charge_time:')) {
      const n = int(ts.split(':')[1]!);
      let charged = this.squad_names.filter(
        (c) => (or(get(item(_NIKKE(), c), 'charge_time', null), 0.0) as number) > 0);
      charged = sorted(charged, (c) => -item(item(_NIKKE(), c), 'charge_time'));
      return pyslice(charged, n);
    }
    // "[버프명] 상태인 아군 전체" — 부여 시점 스냅샷(비lazy).
    if (ts.startsWith('allies_with_buff:')) {
      const buff_name = pysplit(ts, ':', 1)[1]!;
      return this.squad_names.filter((n) => this._has_self_state(n, buff_name));
    }
    // "[버프명] 상태가 아닌 아군 전체" — 부여 시점 스냅샷(비lazy).
    if (ts.startsWith('allies_without_buff:')) {
      const buff_name = pysplit(ts, ':', 1)[1]!;
      return this.squad_names.filter((n) => !this._has_self_state(n, buff_name));
    }
    // "직전에 버스트 스킬을 사용한 [무기] 아군 전체" — burst_casted ∩ 무기유형.
    if (ts.startsWith('allies_burst_casted_weapon:')) {
      const wtype = pysplit(ts, ':', 1)[1]!;
      const casted = get(this.state, 'burst_casted', {});
      return this.squad_names.filter(
        (n) => truthy(get(casted, n)) && item(item(_NIKKE(), n), 'weapon_type') === wtype);
    }
    if (ts.startsWith('allies_class:')) {
      let cls = ts.split(':')[1]!;
      cls = get({ '공격': '화력형', '방어': '방어형', '지원': '지원형' }, cls, cls);
      return this.squad_names.filter((n) => item(item(_NIKKE(), n), 'class') === cls);
    }
    if (ts.startsWith('allies_code_excl_self:')) {
      const code = ts.split(':')[1];
      return this.squad_names.filter(
        (n) => n !== caster && get(item(_NIKKE(), n), 'element_code', null) === code);
    }
    if (ts.startsWith('allies_code:')) {
      const code = ts.split(':')[1];
      return this.squad_names.filter((n) => get(item(_NIKKE(), n), 'element_code', null) === code);
    }
    // 코드 + 무기유형 복합. leftmost는 스쿼드 입력 순서 기준 앞에서 N명
    if (ts.startsWith('allies_code_weapon_leftmost:')) {
      const [, code, wtype, n] = unpack(ts.split(':'), 4);
      return pyslice(this._code_weapon(code!, wtype!), int(n!));
    }
    if (ts.startsWith('allies_code_weapon:')) {
      const [, code, wtype] = unpack(ts.split(':'), 3);
      return this._code_weapon(code!, wtype!);
    }
    if (ts.startsWith('allies_below_def')) {
      // 원문이 "자신보다 **최종** 방어력이 낮은 아군" → 버프 반영 후 방어력으로 비교.
      const caster_def = this._effective_def(caster);
      return this.squad_names.filter((n) => this._effective_def(n) < caster_def);
    }
    // 아래 셋은 원문이 «**기본** 버스트 단계 Step 3»이다 — `state.burst_stages`(지금 유효 단계)가 아니라
    // 캐릭터의 기본 단계를 본다. 라피 : 레드 후드처럼 1버로 쓰는 동안(`burst_stage_override:1`)에도
    // 기본 단계는 3이다(유저 피드백 2026-09-26: 1버 레드 후드가 에이다 버프를 못 받던 문제).
    if (ts === 'allies_burst3') {
      return this.squad_names.filter((n) => this._base_burst_stage(n) === '3');
    }
    // "자신을 제외한 기본 버스트 단계 Step3인 페르소나 상태 아군 전체".
    if (ts === 'allies_burst3_persona_excl_self') {
      return this.squad_names.filter(
        (n) => n !== caster && this._base_burst_stage(n) === '3' && this._has_persona_state(n));
    }
    // "직전에 버스트 스킬을 사용한 기본 버스트 단계 Step 3 아군" — burst_casted ∩ 기본 B3.
    if (ts === 'allies_burst_casted_burst3') {
      const casted = get(this.state, 'burst_casted', {});
      return this.squad_names.filter(
        (n) => truthy(get(casted, n)) && this._base_burst_stage(n) === '3');
    }

    // 적 관련 (타임라인 처리)
    // `same_target:[이름]`도 같은 적을 가리킨다 — 접두사까지 봐야 []로 새지 않는다.
    if (ts.startsWith('enemies') || ts.startsWith('same_target:')
        || ts === 'target' || ts === 'target_body' || ts === 'same_target') {
      return ['__enemy__'];
    }

    // 커버, 발사체 등
    return [];
  }

  /** 캐릭터의 기본 버스트 단계(데이터 그대로). 1버 대체 같은 지금 유효 단계는 `state.burst_stages`다. */
  _base_burst_stage(name: string): string | null {
    const stage = get(get(_NIKKE(), name, {}), 'burst_stage', null);
    return stage == null ? null : String(stage);
  }

  // py: calculator/buff_manager.py:4101
  /** 코드·무기유형 둘 다 일치하는 아군을 스쿼드 입력 순서대로 반환. */
  _code_weapon(code: string, wtype: string): string[] {
    return this.squad_names.filter(
      (n) => get(item(_NIKKE(), n), 'element_code', null) === code
        && get(item(_NIKKE(), n), 'weapon_type', null) === wtype);
  }

  // py: calculator/buff_manager.py:4107
  /** 활성 버프(atk_pct, atk_flat)를 반영한 최종 공격력. 타겟 정렬용. */
  _effective_atk(name: string): number {
    const base = get(get(get(this.state, 'base_stats', {}), name, {}), 'atk', 0.0);
    let atk_pct = 0.0;
    let atk_flat = 0.0;
    for (const ab of this._active) {
      if (!(or(ab.target_chars, []) as string[]).includes(name)) {
        continue;
      }
      const stat = abStat(ab, '');
      if (stat === 'atk_pct') {
        const v = this._get_value(ab.effect, ab, name);
        if (v != null) {
          atk_pct += v;
        }
      } else if (stat === 'atk_caster_based_pct') {
        const v = this._get_value(ab.effect, ab, ab.caster);
        if (v != null) {
          const caster_atk = get(get(get(this.state, 'base_stats', {}), ab.caster, {}), 'atk', 0.0);
          atk_flat += caster_atk * (v / 100.0);
        }
      } else if (stat === 'atk_flat') {
        const v = this._get_value(ab.effect, ab, name);
        if (v != null) {
          atk_flat += v;
        }
      }
    }
    return base * (1 + atk_pct / 100) + atk_flat;
  }

  // py: calculator/buff_manager.py:4131
  /** `scaling: stack_count` + `scaling_ref` 버프의 참조 중첩을 발동 시점 값으로 고정. (원본 docstring 참고) */
  _capture_scaling_stack(eff: Eff, caster: string): number | null {
    if (get(eff, 'scaling') !== 'stack_count' || !truthy(get(eff, 'scaling_ref'))) {
      return null;
    }
    const duration = get(eff, 'duration');
    if (duration == null || duration === -1) {
      return null;
    }
    return this.ref_count(caster, eff['scaling_ref']);
  }

  // py: calculator/buff_manager.py:4150
  /** 활성 버프(def_pct, def_caster_based_pct)를 반영한 최종 방어력. allies_below_def 판정용. */
  _effective_def(name: string): number {
    const base = get(get(get(this.state, 'base_stats', {}), name, {}), 'def', 0.0);
    let def_pct = 0.0;
    let def_flat = 0.0;
    for (const ab of this._active) {
      if (!(or(ab.target_chars, []) as string[]).includes(name)) {
        continue;
      }
      const stat = abStat(ab, '');
      if (stat === 'def_pct') {
        const v = this._get_value(ab.effect, ab, name);
        if (v != null) {
          def_pct += v;
        }
      } else if (stat === 'def_caster_based_pct') {
        const v = this._get_value(ab.effect, ab, ab.caster);
        if (v != null) {
          const caster_def = get(get(get(this.state, 'base_stats', {}), ab.caster, {}), 'def', 0.0);
          def_flat += caster_def * (v / 100.0);
        }
      }
    }
    return base * (1 + def_pct / 100) + def_flat;
  }

  // py: calculator/buff_manager.py:4171
  _top_by(stat: string, n: number, exclude: string | null = null): string[] {
    let pool = this.squad_names.filter((name) => name !== exclude);
    if (stat === 'atk') {
      pool = sorted(pool, (x) => this._effective_atk(x), true);
    } else {
      const base_stats = get(this.state, 'base_stats', {});
      pool = sorted(pool, (x) => get(get(base_stats, x, {}), stat, 0), true);
    }
    return pyslice(pool, n);
  }

  // py: calculator/buff_manager.py:4180
  _lowest_hp(n: number, exclude: string | null = null): string[] {
    const hp_pct = get(this.state, 'hp_pct', {});
    const names = this.squad_names.filter((x) => x !== exclude);
    // 동률이면 squad_names 순서(앞쪽 우선)로 결정
    const pool = sorted(names,
      (x) => [get(hp_pct, x, 100.0), listIndex(this.squad_names, x)]);
    return pyslice(pool, n);
  }

  // ── 편의 메서드 ───────────────────────────────────────────────────────

  // py: calculator/buff_manager.py:4190
  /** 캐릭터가 현재 무기 변경 상태인지 반환. */
  is_weapon_changed(caster: string): boolean {
    return has(get(this.state, 'weapon_change', {}), caster);
  }

  // py: calculator/buff_manager.py:4194
  /** 현재 활성 weapon_change effect 반환. 없으면 None. */
  get_weapon_change(caster: string): Eff | null {
    const info = get(get(this.state, 'weapon_change', {}), caster);
    return truthy(info) ? info['effect'] : null;
  }

  // py: calculator/buff_manager.py:4202
  /** 무기 변경을 종료할 때 호출. t를 주면 event:state_end:{모드명}을 발생시킨다. */
  end_weapon_change(caster: string, t: number | null = null): void {
    const info = pop(get(this.state, 'weapon_change', {}), caster, null);
    if (info == null) {
      return;
    }
    this._invalidate_buffs_cache();
    const name = get(item(info, 'effect'), 'name', '');
    if (t != null && truthy(name)) {
      this.notify(`event:state_end:${name}`, t, caster);
    }
  }

  // py: calculator/buff_manager.py:4215
  /** 발사 1회 소모 시 duration_bullets 기반 버프 카운트를 차감하고 소진된 버프를 제거. */
  consume_bullet_buffs(caster: string, t: number = 0.0): void {
    const to_remove: number[] = [];
    for (const ab of this._active) {
      // 이번 발사 중 막 활성화된 버프는 소모하지 않음 (첫 발사도 효과에 포함).
      // 단, 트리거가 발사와 같은 프레임에 발동하는 종류(full_charge 등)이면 카운트해야 함.
      if (ab.activated_at === t && !_is_bullet_bound_trigger(ab.effect)) {
        continue;
      }

      // lazy-target duration_bullets: 타겟을 여기서 확정하고 per-target 카운터로 옮긴다.
      if (ab.target_chars == null && ab.bullets_left !== -1) {
        this._resolve_lazy(ab);
        this._invalidate_buffs_cache();
      }

      // 캐릭터별 독립 카운터 (다중 target duration_bullets 버프)
      const bpt0 = ab.bullets_per_target;
      if (bpt0 != null && Object.prototype.hasOwnProperty.call(bpt0, caster)) {
        ab.bullets_per_target[caster] = ab.bullets_per_target[caster]! - 1;
        if (ab.bullets_per_target[caster]! <= 0) {
          delete ab.bullets_per_target[caster];
          if (ab.target_chars != null) {
            ab.target_chars = ab.target_chars.filter((c) => c !== caster);
          }
          this._invalidate_buffs_cache();
          const eff_name = abName(ab, '');
          if (truthy(this._buff_event_handler) && truthy(eff_name)) {
            this._buff_event_handler!('expire', eff_name, ab.caster, caster, t, t);
          }
          if (!truthy(ab.bullets_per_target)) {  // 모든 대상 소진 → 버프 전체 제거
            to_remove.push(ab.uid);
          }
        }
        continue;
      }

      // 시전자 본인 발사로 소모 (self-target 포함 비lazy 단일 카운터)
      if (ab.caster !== caster || ab.bullets_left === -1) {
        continue;
      }
      ab.bullets_left -= 1;
      if (ab.bullets_left <= 0) {
        to_remove.push(ab.uid);
      }
    }

    if (to_remove.length === 0) {
      // 뺄 것이 없다 — 파이썬처럼 새 목록으로만 바꾼다(목록을 쥔 쪽과 공유하지 않게).
      this._active = this._active.slice();
      return;
    }
    const removed_ids = new Set(to_remove);
    const removed_buffs = this._active.filter((ab) => removed_ids.has(ab.uid));
    if (removed_ids.size > 0) {
      this._invalidate_buffs_cache();
    }
    this._active = this._active.filter((ab) => !removed_ids.has(ab.uid));
    for (const ab of removed_buffs) {
      const name = abName(ab, '');
      if (truthy(name)) {
        this.notify(`event:state_end:${name}`, t, ab.caster);
        if (truthy(this._buff_event_handler)) {
          for (const tgt of (or(ab.target_chars, []) as string[])) {
            this._buff_event_handler!('expire', name, ab.caster, tgt, t, t);
          }
        }
      }
    }
  }

  // py: calculator/buff_manager.py:4267
  /** 전투 시작 시 모든 캐릭터에 대해 battle_start 이벤트 발생. */
  battle_start(t: number = 0.0): void {
    for (const name of this.squad_names) {
      this.notify('battle_start', t, name);
    }
    // 단일 보스 가정: 전투 시작 시 일반 적 등장과 타겟(보스) 출현이 같은 시점에 각각 한 번 발생한다.
    for (const name of this.squad_names) {
      this.notify('event:enemy_spawn', t, name);
      this.notify('event:target_spawn', t, name);
    }
  }

  // py: calculator/buff_manager.py:4278
  /** 전투 초기화. */
  reset(): void {
    this._active.length = 0;
    this._next_fire.clear();
    this._dot_timers.clear();
    this._ramp_pending.length = 0;
    this._instant_timers.clear();
    this._lazy_target_cache.clear();
    this._event_counts.clear();
    this._conditional_event_counts.clear();
    this._trigger_counts.clear();
    this._buffs_cache.clear();
    this._ammo_reuse.clear();
    this._plan_cache.clear();
    this._ammo_plan_cache.clear();
    this._stat_index.clear();
    this._name_index_cache.clear();
    this._cache_version = 0;
    this._cond_passive_prev.clear();

    pop(this.state, 'weapon_change', null);
    pop(this.state, 'feathers', null);
  }
}
