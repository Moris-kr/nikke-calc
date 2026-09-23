/**
 * calculator/customization.py — 브라우저 캐릭터 설정의 스키마와 검증.
 *
 * 파이썬은 import 시점에 cube.json · collection.json · parsed_nikke.json · weapon_mechanics.json을
 * **파일에서** 읽어 상수(CUBE_NAMES · COLLECTION_STAGES · CONSOLE_CLASSES · CONSOLE_COMPANIES ·
 * WEAPON_TYPES · OPTIMAL_RANGE_WEAPONS)를 만든다. 여기서는 데이터가 들어올 때(`onDataChange`) 한 번
 * 스냅샷을 뜬다 — 그래야 뒤에 `_inject_custom_characters`가 parsed_nikke에 얹은 커스텀 니케가
 * 소속 목록에 섞이지 않는다(파이썬도 파일을 읽으므로 섞이지 않는다).
 *
 * 맨 아래 «TS 전용» 절은 파이썬 표기(repr/str/`:g`)와 «정수값인 float»를 재현하는 도우미다.
 * JSON.parse는 `2.0`과 `2`를 가르지 못하므로, 파이썬에서 float로 만들어진 값은 담긴 사전에
 * 표시(mark)해 두고 이탈 보고(`spec._fmt`)가 `2.0`으로 찍게 한다.
 */

import { NO_ITEM } from './base_stat';
import { FAVORITE_MAX_STAGE } from './buff_manager';
import { DMG_MULT_MAX as HACK_DMG_MULT_MAX, from_config } from './cheats';
import { resolve_character_growth } from './growth';
import { data, hasEngineData, onDataChange } from './data';
import {
  TypeError_, ValueError, deepcopy, float as py_float, get, has, isfinite, item, sorted, truthy,
} from './py';

// TS 전용 — «정수값인 파이썬 float» 표시(맨 아래 절). 모듈 상수가 쓰므로 맨 앞에 둔다.
const _PY_FLOATS = new WeakMap<object, Set<string>>();

// 순서는 **인게임 오버로드 표기 순서**다 — 우코·공증·장탄·차속·차댐·명중·크확·크댐·방어.
export const OVERLOAD_FIELDS: Record<string, Record<string, any>> = {
  element_bonus: { label: '우월 코드 대미지', unit: '%', min: 0.0, max: 1000.0 },
  atk_pct: { label: '공격력', unit: '%', min: 0.0, max: 1000.0 },
  max_ammo_pct: { label: '최대 장탄수', unit: '%', min: 0.0, max: 10000.0 },
  charge_speed_pct: { label: '차지 속도', unit: '%', min: 0.0, max: 1000.0 },
  charge_dmg_pct: { label: '차지 대미지', unit: '%', min: 0.0, max: 1000.0 },
  accuracy_pct: { label: '명중률', unit: '%', min: 0.0, max: 1000.0 },
  crit_rate: { label: '크리티컬 확률', unit: '%', min: 0.0, max: 100.0 },
  crit_dmg: { label: '크리티컬 대미지', unit: '%', min: 0.0, max: 1000.0 },
  def_pct: { label: '방어력', unit: '%', min: 0.0, max: 1000.0 },
};
// 위 min/max는 전부 파이썬 float 리터럴이다(메시지에 `0.0~1000.0`으로 찍힌다).
for (const meta of Object.values(OVERLOAD_FIELDS)) {
  _mark_float(meta, 'min');
  _mark_float(meta, 'max');
}

// ── 데이터에서 뜨는 상수 (파이썬은 import 시점에 파일에서 읽는다) ─────────────────

interface _DataConstants {
  CUBE_NAMES: string[];
  COLLECTION_STAGES: string[];
  CONSOLE_CLASSES: string[];
  CONSOLE_COMPANIES: string[];
  CONSOLE_FIELDS: Record<string, Record<string, any>>;
  WEAPON_TYPES: string[];
  OPTIMAL_RANGE_WEAPONS: string[];
}

let _CONSTANTS: _DataConstants | null = null;

function _init_constants(): _DataConstants {
  const CONSOLE_CLASSES = _roster_buckets('class');
  const CONSOLE_COMPANIES = _roster_buckets('manufacturer');
  const [WEAPON_TYPES, OPTIMAL_RANGE_WEAPONS] = _load_weapon_types();
  _CONSTANTS = {
    CUBE_NAMES: _load_cube_names(),
    COLLECTION_STAGES: _load_collection_stages(),
    CONSOLE_CLASSES,
    CONSOLE_COMPANIES,
    // 콘솔 세 축. `공통`은 전체 하나지만 `클래스`·`기업`은 소속마다 레벨을 받는다.
    CONSOLE_FIELDS: {
      common_level: { label: '공통 콘솔', buckets: [] },
      class_level: { label: '클래스 콘솔', buckets: CONSOLE_CLASSES },
      company_level: { label: '기업 콘솔', buckets: CONSOLE_COMPANIES },
    },
    WEAPON_TYPES,
    OPTIMAL_RANGE_WEAPONS,
  };
  return _CONSTANTS;
}

function _constants(): _DataConstants {
  return _CONSTANTS ?? _init_constants();
}

// py: calculator/customization.py:38
function _load_cube_names(): string[] {
  const table = data().tables.cube;
  return Object.keys(table).filter((k) => !k.startsWith('_') && k !== '공통');
}

// py: calculator/customization.py:55
function _load_collection_stages(): string[] {
  const table = data().tables.collection;
  return [NO_ITEM, ...Object.keys(item(table, '_stat_table'))];
}

export const CUBE_NAMES: readonly string[] = _lazy_view(() => _constants().CUBE_NAMES, []);
export const COLLECTION_STAGES: readonly string[] = _lazy_view(() => _constants().COLLECTION_STAGES, []);

// 애장품은 소장품 슬롯을 공유한다.
export const FAVORITE_COLLECTION_STAGE = 'SR15';

export const SKILL_LEVEL_KEYS: ReadonlySet<string> = new Set(['1', '2', '3']);
export const EQUIP_PARTS = ['머리', '몸통', '팔', '다리'] as const;
export const EQUIP_LEVEL_MAX = 5;

// 장비는 세 갈래다 (`base_stat._equip_stat`): 숫자 0~5 / "T1"~"T9" / "없음".
export const EQUIP_TIERS: readonly string[] = [NO_ITEM, ...Array.from({ length: 9 }, (_, i) => `T${i + 1}`)];

// py: calculator/customization.py:87
// TS 전용 인자 `_int_bounds` — 호출부가 정수 리터럴로 범위를 준 곳(파이썬 메시지에 `-100~100`으로 찍힌다).
function _stat(label: string, unit: string = '%', minimum: number = -1000.0,
  maximum: number = 10000.0, _int_bounds: boolean = false): Record<string, any> {
  const out: Record<string, any> = { label: label, unit: unit, min: minimum, max: maximum };
  if (!_int_bounds) {
    _mark_float(out, 'min');
    _mark_float(out, 'max');
  }
  return out;
}

export const MANUAL_STATS: Record<string, Record<string, any>> = {
  atk_pct: _stat('공격력'),
  atk_flat: _stat('고정 공격력', '', -10_000_000, 10_000_000, true),
  def_ignore_pct: _stat('방어력 무시'),
  enemy_def_down_pct: _stat('적 방어력 감소'),
  def_pct: _stat('방어력'),
  crit_rate: _stat('크리티컬 확률', '%', -100, 100, true),
  crit_dmg: _stat('크리티컬 대미지'),
  core_dmg_pct: _stat('코어 대미지'),
  normal_atk_dmg_pct: _stat('일반 공격 대미지'),
  atk_dmg_pct: _stat('공격 대미지'),
  burst_dmg_pct: _stat('버스트 대미지'),
  burst_dmg_aoe_pct: _stat('광역 버스트 대미지'),
  pierce_dmg_pct: _stat('관통 대미지'),
  dot_dmg_pct: _stat('지속 대미지'),
  armor_break_dmg_pct: _stat('방어력 무시 대미지'),
  projectile_explosion_dmg: _stat('투사체 폭발 대미지'),
  projectile_attachment_dmg: _stat('투사체 부착 대미지'),
  sequential_dmg_pct: _stat('순차 대미지'),
  charge_dmg_pct: _stat('차지 대미지'),
  charge_dmg_mag_pct: _stat('차지 대미지 배율'),
  split_dmg_pct: _stat('분배 대미지'),
  part_dmg_pct: _stat('파츠 대미지'),
  received_dmg_pct: _stat('받는 대미지(개인 딜 적용)'),
  element_bonus_pct: _stat('우월 코드 대미지'),
  charge_speed_pct: _stat('차지 속도'),
  charge_speed_overflow_conversion_pct: _stat('초과 차지 속도 변환'),
  max_ammo_pct: _stat('최대 장탄수'),
  max_ammo_flat: _stat('고정 최대 장탄수', '발', -10000, 10000, true),
  ammo_charge_flat: _stat('10발마다 탄환 충전', '발', 0, 10000, true),
  accuracy_pct: _stat('명중률'),
  reload_speed_pct: _stat('재장전 속도'),
  attack_speed_pct: _stat('공격 속도'),
  mg_warmup_speed_pct: _stat('MG 예열 속도'),
  burst_cooldown: _stat('버스트 쿨타임 감소', '초', -1000, 1000, true),
  skill_cooldown_pct: _stat('스킬 쿨타임 변화', '%', -1000, 1000, true),
  max_hp_pct: _stat('최대·현재 체력'),
  max_hp_only_pct: _stat('최대 체력'),
  lifesteal_pct: _stat('흡혈'),
  def_caster_based_pct: _stat('시전자 기반 방어력'),
  pellet_count: _stat('펠릿 수 추가', '개', -100, 100, true),
  pellet_count_fixed: _stat('펠릿 수 고정', '개', 0, 100, true),
  fullburst_duration: _stat('풀 버스트 지속시간', '초', -1000, 1000, true),
};

// py: calculator/customization.py:138
function _number(value: any, field: string, meta: Record<string, any>): number {
  if (typeof value !== 'number') {
    throw ValueError(`${field}: 숫자여야 한다`);
  }
  const number = value;
  if (!isfinite(number)) {
    throw ValueError(`${field}: 유한한 숫자여야 한다`);
  }
  if (number < meta['min'] || number > meta['max']) {
    throw ValueError(
      `${field}: ${_py_str(meta['min'], _is_float(meta, 'min'))}~${_py_str(meta['max'], _is_float(meta, 'max'))} 범위여야 한다`);
  }
  return number;
}

// py: calculator/customization.py:149
// 호출부는 전부 float 리터럴로 범위를 준다(0.1·20.0·0.0·1.0·300.0).
function _control_number(value: any, field: string, minimum: number, maximum: number): number {
  const meta: Record<string, any> = { min: minimum, max: maximum };
  _mark_float(meta, 'min');
  _mark_float(meta, 'max');
  return _number(value, field, meta);
}

// py: calculator/customization.py:153
export function _normalize_control(raw: any): Record<string, any> {
  if (!_py_is_dict(raw)) {
    throw ValueError('컨트롤 설정은 객체여야 합니다');
  }
  const _allowed = new Set(['tap_fire', 'reload', 'cover', 'hold', 'bunny_mode']);
  const unknown = Object.keys(raw).filter((k) => !_allowed.has(k));
  if (unknown.length) {
    throw ValueError(`지원하지 않는 컨트롤: ${_py_repr(sorted(unknown))}`);
  }
  const result: Record<string, any> = {};

  if (has(raw, 'bunny_mode')) {
    if (!_py_in(raw['bunny_mode'], ['stance', 'engage'])) {
      throw ValueError('바니 모드는 stance 또는 engage여야 합니다');
    }
    result['bunny_mode'] = raw['bunny_mode'];
  }

  const tap = get(raw, 'tap_fire');
  if (tap != null) {
    const _tap_keys = new Set([
      'rate', 'release', 'full_charge_interval', 'policy', 'reload_at_end',
      'full_charge_after_reload',
    ]);
    if (!_py_is_dict(tap) || Object.keys(tap).some((k) => !_tap_keys.has(k)) || !has(tap, 'rate')) {
      throw ValueError('톡톡이는 rate와 선택 release/full_charge_interval/policy/reload_at_end/'
        + 'full_charge_after_reload만 지원합니다');
    }
    const normalized_tap: Record<string, any> = {};
    _set_float(normalized_tap, 'rate', _control_number(tap['rate'], 'tap_fire.rate', 0.1, 20.0));
    // 버충 톡톡이 — 풀버스트 밖에서만 톡톡이. 기본(always)은 값 자체를 안 싣는다.
    if (has(tap, 'policy')) {
      if (!_py_in(tap['policy'], ['always', 'burst_charge'])) {
        throw ValueError('톡톡이 정책은 always 또는 burst_charge여야 합니다');
      }
      if (tap['policy'] === 'burst_charge') {
        normalized_tap['policy'] = 'burst_charge';
      }
    }
    if (has(tap, 'reload_at_end')) {
      if (typeof tap['reload_at_end'] !== 'boolean') {
        throw ValueError('tap_fire.reload_at_end는 true/false여야 합니다');
      }
      normalized_tap['reload_at_end'] = tap['reload_at_end'];
    }
    if (has(tap, 'full_charge_after_reload')) {
      if (typeof tap['full_charge_after_reload'] !== 'boolean') {
        throw ValueError('tap_fire.full_charge_after_reload는 true/false여야 합니다');
      }
      normalized_tap['full_charge_after_reload'] = tap['full_charge_after_reload'];
    }
    if (has(tap, 'release')) {
      _set_float(normalized_tap, 'release', _control_number(
        tap['release'], 'tap_fire.release', 0.0, 1.0,
      ));
    }
    if (has(tap, 'full_charge_interval')) {
      _set_float(normalized_tap, 'full_charge_interval', _control_number(
        tap['full_charge_interval'], 'tap_fire.full_charge_interval', 0.0, 300.0,
      ));
    }
    result['tap_fire'] = normalized_tap;
  }

  const reload = get(raw, 'reload');
  if (reload != null) {
    const _reload_keys = new Set(['policy', 'lead', 'margin', 'if_dry', 'duration']);
    if (!_py_is_dict(reload) || Object.keys(reload).some((k) => !_reload_keys.has(k))) {
      throw ValueError('지원하지 않는 재장전 컨트롤 설정입니다');
    }
    const policy = get(reload, 'policy');
    if (!_py_in(policy, ['before_fb_end', 'into_fb'])) {
      throw ValueError('재장전 정책은 before_fb_end 또는 into_fb여야 합니다');
    }
    const normalized_reload: Record<string, any> = { policy: policy };
    for (const key of ['lead', 'margin', 'duration']) {
      if (has(reload, key)) {
        _set_float(normalized_reload, key, _control_number(
          reload[key], `reload.${key}`, 0.0, 300.0,
        ));
      }
    }
    if (has(reload, 'if_dry')) {
      if (typeof reload['if_dry'] !== 'boolean') {
        throw ValueError('reload.if_dry는 참/거짓이어야 합니다');
      }
      normalized_reload['if_dry'] = reload['if_dry'];
    }
    result['reload'] = normalized_reload;
  }

  const cover = get(raw, 'cover');
  if (cover != null) {
    const _cover_keys = new Set(['policy', 'extend']);
    if (!_py_is_dict(cover) || Object.keys(cover).some((k) => !_cover_keys.has(k))) {
      throw ValueError('지원하지 않는 엄폐 컨트롤 설정입니다');
    }
    if (get(cover, 'policy') !== 'own_full_burst') {
      throw ValueError('엄폐 정책은 own_full_burst여야 합니다');
    }
    const normalized_cover: Record<string, any> = { policy: 'own_full_burst' };
    if (has(cover, 'extend')) {
      _set_float(normalized_cover, 'extend', _control_number(
        cover['extend'], 'cover.extend', 0.0, 300.0,
      ));
    }
    result['cover'] = normalized_cover;
  }

  const hold = get(raw, 'hold');
  if (hold != null) {
    const _hold_keys = new Set(['policy', 'lead']);
    if (!_py_is_dict(hold) || Object.keys(hold).some((k) => !_hold_keys.has(k))) {
      throw ValueError('지원하지 않는 홀드 컨트롤 설정입니다');
    }
    const policy = get(hold, 'policy');
    if (!_py_in(policy, ['own_full_burst', 'charge_hold_after_fb'])) {
      throw ValueError('지원하지 않는 홀드 정책입니다');
    }
    const normalized_hold: Record<string, any> = { policy: policy };
    if (has(hold, 'lead')) {
      _set_float(normalized_hold, 'lead', _control_number(
        hold['lead'], 'hold.lead', 0.0, 300.0,
      ));
    }
    result['hold'] = normalized_hold;
  }

  return result;
}

// 인게임·블라블라링크의 표기 순서.
const _OFFICIAL_ORDER: Record<string, readonly string[]> = {
  manufacturer: ['엘리시온', '테트라', '미실리스', '필그림', '어브노말'],
  class: ['화력형', '방어형', '지원형'],
};

// py: calculator/customization.py:260
function _roster_buckets(field: string): string[] {
  const nikke = data().parsed_nikke;
  const seen = new Set<any>();
  for (const [name, meta] of Object.entries(nikke)) {
    if (!name.startsWith('test_') && truthy(get(meta, field))) {
      seen.add(get(meta, field));
    }
  }
  const official = _OFFICIAL_ORDER[field]!;
  const ordered: any[] = official.filter((bucket) => seen.has(bucket));
  const officialSet = new Set<any>(official);
  ordered.push(...sorted([...seen].filter((b) => !officialSet.has(b))));
  return ordered;
}

export const CONSOLE_CLASSES: readonly string[] = _lazy_view(() => _constants().CONSOLE_CLASSES, []);
export const CONSOLE_COMPANIES: readonly string[] = _lazy_view(() => _constants().CONSOLE_COMPANIES, []);

export const CONSOLE_MAX_LEVEL = 1000;

export const CONSOLE_FIELDS: Record<string, Record<string, any>> = _lazy_view(() => _constants().CONSOLE_FIELDS, {});

// py: calculator/customization.py:293
function _console_number(value: any, label: string): number {
  if (!_py_is_int(value)
    || !(0 <= value && value <= CONSOLE_MAX_LEVEL)) {
    throw ValueError(`${label} 레벨은 0~${CONSOLE_MAX_LEVEL} 정수여야 한다`);
  }
  return value;
}

export const BURST_REGEN_DEFAULT = 2.0;
export const BURST_REGEN_MIN = 0.0;
export const BURST_REGEN_MAX = 20.0;

export const BURST_REACTION_MIN = 0.0;
export const BURST_REACTION_MAX = 3.0;

export const ENDGAME_DEFAULT = 20.0;
export const ENDGAME_MAX = 180.0;

export const SYNCHRO_MIN = 1;
export const SYNCHRO_MAX = 1400;
export const SYNCHRO_MEASURED_MAX = 1161;

// py: calculator/customization.py:328
export function normalize_burst_regen(raw: any): number | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw !== 'number') {
    throw ValueError('버스트 게이지 충전 시간은 숫자여야 한다');
  }
  const value = raw;
  if (!(BURST_REGEN_MIN <= value && value <= BURST_REGEN_MAX)) {
    throw ValueError(
      `버스트 게이지 충전 시간은 ${_py_float_repr(BURST_REGEN_MIN)}~${_py_float_repr(BURST_REGEN_MAX)}초여야 한다`);
  }
  return value;
}

// py: calculator/customization.py:341
export function normalize_burst_reaction(raw: any): number | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw !== 'number' || !isfinite(raw)) {
    throw ValueError('버스트 반응속도는 숫자여야 한다');
  }
  const value = raw;
  if (!(BURST_REACTION_MIN <= value && value <= BURST_REACTION_MAX)) {
    throw ValueError(
      `버스트 반응속도는 ${_py_float_repr(BURST_REACTION_MIN)}~${_py_float_repr(BURST_REACTION_MAX)}초여야 한다`);
  }
  return value;
}

export const BURST_STAGES = ['1', '2', '3'] as const;

export const BURST_SEQUENCE_MAX_CYCLES = 60;

// py: calculator/customization.py:361
export function normalize_burst_sequence(raw: any, names: string[]): Array<Record<string, string[]>> | null {
  if (raw == null) {
    return null;
  }
  if (!Array.isArray(raw)) {
    throw ValueError('버스트 순서는 사이클 목록이어야 한다');
  }
  if (!raw.length) {
    return null;
  }
  if (raw.length > BURST_SEQUENCE_MAX_CYCLES) {
    throw ValueError(`버스트 순서는 ${BURST_SEQUENCE_MAX_CYCLES}사이클까지다`);
  }

  const allowed = new Set(names);
  const out: Array<Record<string, string[]>> = [];
  let index = 0;
  for (const cycle of raw) {
    index += 1;
    if (!_py_is_dict(cycle)) {
      throw ValueError(`${index}번째 버스트 순서가 올바르지 않다`);
    }
    const entry: Record<string, string[]> = {};
    for (const stage of BURST_STAGES) {
      const picked = truthy(get(cycle, stage)) ? get(cycle, stage) : [];
      if (!Array.isArray(picked)) {
        throw ValueError(`${index}번째 ${stage}단계 버스트 순서가 올바르지 않다`);
      }
      const slot: string[] = [];
      for (const value of picked) {
        const name = _py_strip(_py_str(value));
        if (!name) {
          continue;
        }
        if (!allowed.has(name)) {
          throw ValueError(`버스트 순서에 편성에 없는 니케가 있다: ${name}`);
        }
        if (!slot.includes(name)) {
          slot.push(name);
        }
      }
      entry[stage] = slot;
    }
    out.push(entry);
  }

  // 전부 비어 있으면 안 준 것과 같다.
  if (!out.some((entry) => BURST_STAGES.some((stage) => entry[stage]!.length > 0))) {
    return null;
  }
  return out;
}

// py: calculator/customization.py:411
export function normalize_synchro_level(raw: any): number | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw !== 'number') {
    throw ValueError('싱크로 레벨은 숫자여야 한다');
  }
  if (_py_float(raw) !== _py_int(raw)) {
    throw ValueError('싱크로 레벨은 정수여야 한다');
  }
  const value = _py_int(raw);
  if (!(SYNCHRO_MIN <= value && value <= SYNCHRO_MAX)) {
    throw ValueError(`싱크로 레벨은 ${SYNCHRO_MIN}~${SYNCHRO_MAX}이어야 한다`);
  }
  return value;
}

// 「누가 이 버프를 받았나」를 카드에 띄울 버프들.
export const BUFF_TARGET_WATCH: Record<string, ReadonlyArray<readonly [string, string]>> = {
  '리버렐리오': [['차분한 수심 4', '차분한 수심 대상']],
  '미란다': [['웨이크업! 4', '크확 대상']],
};

// py: calculator/customization.py:440
function _load_weapon_types(): [string[], string[]] {
  const table = data().weapon_mechanics;
  const defaults = item(table, 'weapon_type_defaults');
  return [
    Object.keys(defaults),
    Object.entries(defaults).filter(([, spec]) => truthy(get(spec as any, 'optimal_range', true))).map(([w]) => w),
  ];
}

export const WEAPON_TYPES: readonly string[] = _lazy_view(() => _constants().WEAPON_TYPES, []);
export const OPTIMAL_RANGE_WEAPONS: readonly string[] = _lazy_view(() => _constants().OPTIMAL_RANGE_WEAPONS, []);

// py: calculator/customization.py:463
export function normalize_optimal_range(raw: any): string[] {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw ValueError('적정거리 무기군은 배열이어야 한다');
  }
  const { WEAPON_TYPES, OPTIMAL_RANGE_WEAPONS } = _constants();
  const unknown = raw.filter((w: any) => !_py_in(w, WEAPON_TYPES));
  if (unknown.length) {
    throw ValueError(`지원하지 않는 무기군: ${_py_repr(sorted(unknown))}`);
  }
  // 순서가 흔들려도 같은 설정이다 — 정본 순서로 세운다.
  return OPTIMAL_RANGE_WEAPONS.filter((w) => new Set(raw).has(w));
}

// py: calculator/customization.py:487
export function normalize_normal_hit_coeff(raw: any): Record<string, number> {
  if (raw == null) {
    return {};
  }
  if (!_py_is_dict(raw)) {
    throw ValueError('평타 계수는 무기군을 키로 하는 객체여야 한다');
  }
  const { WEAPON_TYPES } = _constants();
  const out: Record<string, number> = {};
  for (const [weapon, value] of Object.entries(raw)) {
    if (!WEAPON_TYPES.includes(weapon)) {
      throw ValueError(`지원하지 않는 무기군: ${weapon}`);
    }
    if (typeof value !== 'number') {
      throw ValueError(`${weapon} 평타 계수는 숫자여야 한다`);
    }
    if (!(0.0 <= value && value <= 2.0)) {
      throw ValueError(`${weapon} 평타 계수는 0~2 사이여야 한다`);
    }
    out[weapon] = value;
  }
  // 무기군 순서를 정본으로 세운다.
  const ordered: Record<string, number> = {};
  for (const w of WEAPON_TYPES) {
    if (has(out, w)) _set_float(ordered, w, out[w]!);
  }
  return ordered;
}

export const PHASE_WINDOW_MAX = 180.0;
export const ELEMENT_CODES = ['작열', '수냉', '풍압', '전격', '철갑'] as const;

// py: calculator/customization.py:519
function _window(raw: any, label: string): [number, number] {
  if (!_py_is_dict(raw)) {
    throw ValueError(`${label} 구간은 객체여야 한다`);
  }
  let start: number;
  let end: number;
  try {
    start = _py_float(item(raw, 'from'));
    end = _py_float(item(raw, 'to'));
  } catch {
    // 파이썬: except (KeyError, TypeError, ValueError)
    throw ValueError(`${label} 구간에는 from·to 숫자가 필요하다`);
  }
  if (!(isfinite(start) && isfinite(end))) {
    throw ValueError(`${label} 구간은 유한한 숫자여야 한다`);
  }
  if (!(0 <= start && start <= PHASE_WINDOW_MAX) || !(0 <= end && end <= PHASE_WINDOW_MAX)) {
    throw ValueError(`${label} 구간은 0~${_py_fmt_g(PHASE_WINDOW_MAX)}초여야 한다`);
  }
  if (start >= end) {
    throw ValueError(`${label} 구간은 시작이 끝보다 앞서야 한다 (${_py_fmt_g(start)}~${_py_fmt_g(end)})`);
  }
  return [start, end];
}

// py: calculator/customization.py:536
export function normalize_hacks(raw: any): Record<string, any> | null {
  if (raw == null) {
    return null;
  }
  if (!_py_is_dict(raw)) {
    throw ValueError('핵 설정은 객체여야 한다');
  }
  const mult_raw = get(raw, 'damageMult');
  const mult = mult_raw == null ? 1.0 : _py_float(mult_raw);
  if (!isfinite(mult) || !(0 < mult && mult <= HACK_DMG_MULT_MAX)) {
    throw ValueError(`대미지 배수는 0 초과 ${_py_fmt_g(HACK_DMG_MULT_MAX)} 이하여야 한다`);
  }
  const cheats: Record<string, any> = {
    burst_charge: truthy(get(raw, 'burstCharge')),
    infinite_ammo: truthy(get(raw, 'infiniteAmmo')),
    always_crit: truthy(get(raw, 'alwaysCrit')),
  };
  _set_float(cheats, 'damage_mult', mult);
  return from_config({ cheats: cheats }).on ? cheats : null;
}

// py: calculator/customization.py:560
export function normalize_optimal_range_windows(raw: any): Array<Record<string, any>> {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw) || raw.length > 100) {
    throw ValueError('적정거리 설정은 최대 100개 구간의 배열이어야 한다');
  }
  const out: Array<Record<string, any>> = [];
  for (const it of raw) {
    if (!_py_is_dict(it) || !_same_key_set(it, ['from', 'to', 'weapons'])) {
      throw ValueError('적정거리 구간은 from·to·weapons 객체여야 한다');
    }
    if (['from', 'to'].some((key) => typeof it[key] === 'boolean')) {
      throw ValueError('적정거리 구간에는 숫자가 필요하다');
    }
    // 파이썬의 OverflowError(거대 정수) 분기는 JS에서 Infinity로 들어와
    // `_window`가 같은 문구(«적정거리 구간은 유한한 숫자여야 한다»)로 막는다.
    const [start, end] = _window(it, '적정거리');
    const weapons = it['weapons'];
    if (!Array.isArray(weapons) || weapons.some((w: any) => typeof w !== 'string')) {
      throw ValueError('적정거리 무기군은 문자열 배열이어야 한다');
    }
    const row: Record<string, any> = {};
    _set_float(row, 'from', start);
    _set_float(row, 'to', end);
    row['weapons'] = normalize_optimal_range(weapons);
    out.push(row);
  }
  return out;
}

// py: calculator/customization.py:587
export function normalize_immune_windows(raw: any): number[][] {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw ValueError('족자 설정은 배열이어야 한다');
  }
  return raw.map((it: any) => _float_list([..._window(it, '족자')]));
}

// py: calculator/customization.py:596
export function normalize_defense_rate_windows(raw: any): number[][] {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw) || raw.length > 100) {
    throw ValueError('방어율 설정은 최대 100개 구간의 배열이어야 한다');
  }
  const result: number[][] = [];
  for (let it of raw) {
    if (Array.isArray(it) && it.length === 3) {
      it = { from: it[0], to: it[1], rate: it[2] };
    }
    if (!_py_is_dict(it) || Object.keys(it).some((k) => !['from', 'to', 'rate'].includes(k))) {
      throw ValueError('방어율 구간은 from·to·rate 객체여야 한다');
    }
    if (['from', 'to', 'rate'].some((key) => typeof get(it, key) === 'boolean')) {
      throw ValueError('방어율 구간에는 숫자가 필요하다');
    }
    const [start, end] = _window(it, '방어율');
    let rate: number;
    try {
      rate = _py_float(get(it, 'rate', 60.0));
    } catch {
      throw ValueError('방어율은 0~100 사이의 유한한 숫자여야 한다');
    }
    if (!isfinite(rate) || !(0 <= rate && rate <= 100)) {
      throw ValueError('방어율은 0~100 사이의 유한한 숫자여야 한다');
    }
    result.push(_float_list([start, end, rate]));
  }
  return result;
}

// py: calculator/customization.py:624
export function normalize_element_windows(raw: any): Array<Record<string, any>> {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw ValueError('속저 설정은 배열이어야 한다');
  }
  const out: Array<Record<string, any>> = [];
  for (const it of raw) {
    const [start, end] = _window(it, '속저');
    const code = get(it, 'code');
    if (!_py_in(code, ELEMENT_CODES)) {
      throw ValueError(`속저 속성은 ${ELEMENT_CODES.join(', ')} 중 하나여야 한다 (${_py_repr(code)})`);
    }
    const row: Record<string, any> = {};
    _set_float(row, 'from', start);
    _set_float(row, 'to', end);
    row['code'] = code;
    out.push(row);
  }
  return out;
}

// py: calculator/customization.py:643
export function normalize_console(raw: any): Record<string, any> {
  if (raw == null) {
    return {};
  }
  if (!_py_is_dict(raw)) {
    throw ValueError('콘솔 설정은 객체여야 한다');
  }
  const { CONSOLE_FIELDS } = _constants();
  const unknown = Object.keys(raw).filter((k) => !has(CONSOLE_FIELDS, k));
  if (unknown.length) {
    throw ValueError(`지원하지 않는 콘솔 항목: ${_py_repr(sorted(unknown))}`);
  }

  const result: Record<string, any> = {};
  for (const [key, meta] of Object.entries(CONSOLE_FIELDS)) {
    if (!has(raw, key)) {
      continue;
    }
    const value = raw[key];
    const label: string = meta['label'];
    const buckets: string[] = meta['buckets'];
    if (!buckets.length) {
      result[key] = _console_number(value, label);
      continue;
    }
    if (!_py_is_dict(value)) {
      // 구버전 표기(숫자 하나) — 전 소속 동일이라는 뜻으로 편다.
      const v = _console_number(value, label);
      const spread: Record<string, number> = {};
      for (const b of buckets) spread[b] = v;
      result[key] = spread;
      continue;
    }
    const valueKeys = new Set(Object.keys(value));
    const missing = buckets.filter((b) => !valueKeys.has(b));
    if (missing.length) {
      throw ValueError(`${label}에 빠진 소속이 있다: ${_py_repr(sorted(new Set(missing)))}`);
    }
    const bucketSet = new Set(buckets);
    const extra = Object.keys(value).filter((k) => !bucketSet.has(k));
    if (extra.length) {
      throw ValueError(`${label}에 모르는 소속이 있다: ${_py_repr(sorted(extra))}`);
    }
    const per: Record<string, number> = {};
    for (const bucket of buckets) {
      per[bucket] = _console_number(value[bucket], `${label}(${bucket})`);
    }
    result[key] = per;
  }
  return result;
}

// py: calculator/customization.py:687
export function normalize_character_overrides(
  raw: any, { character_name = null }: { character_name?: string | null } = {},
): Record<string, any> {
  if (raw == null) {
    return {};
  }
  if (!_py_is_dict(raw)) {
    throw ValueError('캐릭터 설정은 객체여야 한다');
  }
  const _sections = new Set([
    'growthStage', 'overload', 'cube', 'manualStats', 'skillLevels', 'control',
    'burst', 'equipLevels', 'collection', 'weaponModeSwapAt',
  ]);
  const unknown_sections = Object.keys(raw).filter((k) => !_sections.has(k));
  if (unknown_sections.length) {
    throw ValueError(`지원하지 않는 캐릭터 설정: ${_py_repr(sorted(unknown_sections))}`);
  }

  const result: Record<string, any> = {};
  if (has(raw, 'weaponModeSwapAt')) {
    if (character_name != null && character_name !== '신데렐라 : 크리스탈 웨이브') {
      throw ValueError('저격 모드 변경은 신데렐라 : 크리스탈 웨이브만 지원합니다');
    }
    const swap_at = raw['weaponModeSwapAt'];
    if (typeof swap_at !== 'number'
      || !isfinite(swap_at) || !(0 <= swap_at && swap_at <= 180)) {
      throw ValueError('저격 모드 변경 시점은 0~180초 숫자여야 합니다');
    }
    result['weapon_mode_swap'] = true;
    _set_float(result, 'weapon_mode_swap_at', swap_at);
  }
  if (has(raw, 'control')) {
    result['_control_override'] = _normalize_control(raw['control']);
  }
  const burst = get(raw, 'burst');
  if (burst != null) {
    // 버스트 운용 배정. 러너(bridge)가 config의 burst_pattern·no_burst_chars로 옮긴다.
    if (!_py_is_dict(burst)) {
      throw ValueError('버스트 운용 설정은 객체여야 합니다');
    }
    const mode = get(burst, 'mode');
    if (mode === 'skip') {
      result['_burst_assignment'] = { mode: 'skip' };
    } else if (mode === 'priority') {
      const every = get(burst, 'every', 1);
      if (!_py_is_int(every) || every < 1) {
        throw ValueError('버스트 우선 사용 주기(n)는 1 이상 정수여야 합니다');
      }
      result['_burst_assignment'] = { mode: 'priority', every: every };
    } else if (mode === 'endgame') {
      const seconds = get(burst, 'seconds', ENDGAME_DEFAULT);
      if (typeof seconds !== 'number'
        || !isfinite(seconds) || !(0 < seconds && seconds <= ENDGAME_MAX)) {
        throw ValueError(`막바지 최우선 시간은 0 초과 ${_py_float_repr(ENDGAME_MAX)}초 이하여야 합니다`);
      }
      const assignment: Record<string, any> = { mode: 'endgame' };
      _set_float(assignment, 'seconds', seconds);
      result['_burst_assignment'] = assignment;
    } else {
      throw ValueError('버스트 운용 mode는 priority · endgame · skip 중 하나여야 합니다');
    }
  }
  if (has(raw, 'growthStage')) {
    const growth_stage = raw['growthStage'];
    if (character_name == null) {
      throw ValueError('돌파 단계 설정에는 캐릭터 이름이 필요하다');
    }
    _py_update(result, resolve_character_growth(character_name, growth_stage));
  }

  const skill_levels = get(raw, 'skillLevels');
  if (skill_levels != null) {
    if (!_py_is_dict(skill_levels)) {
      throw ValueError('스킬 레벨 설정은 객체여야 한다');
    }
    const unknown = Object.keys(skill_levels).filter((k) => !SKILL_LEVEL_KEYS.has(k));
    if (unknown.length) {
      throw ValueError(`지원하지 않는 스킬 키: ${_py_repr(sorted(unknown))}`);
    }
    // 주의: 키가 "1"·"2"·"3"(정수 모양)이라 JS 객체는 순회 순서가 오름차순이다
    // (파이썬은 요청의 키 순서). 값은 같고, 둘 이상이 틀렸을 때 어느 키를 먼저 꾸짖는지만 갈린다.
    const normalized_levels: Record<string, any> = {};
    for (const [key, value] of Object.entries(skill_levels)) {
      if (!_py_is_int(value) || !(1 <= (value as number) && (value as number) <= 10)) {
        throw ValueError(`스킬 ${key} 레벨은 1~10 정수여야 한다`);
      }
      normalized_levels[key] = value;
    }
    result['skill_levels'] = normalized_levels;
  }

  const overload = get(raw, 'overload');
  if (overload != null) {
    if (!_py_is_dict(overload)) {
      throw ValueError('오버로드 설정은 객체여야 한다');
    }
    const unknown = Object.keys(overload).filter((k) => !has(OVERLOAD_FIELDS, k));
    if (unknown.length) {
      throw ValueError(`지원하지 않는 오버로드 옵션: ${_py_repr(sorted(unknown))}`);
    }
    const equip_skills: Record<string, any> = {};
    for (const [key, value] of Object.entries(overload)) {
      _set_float(equip_skills, key, _number(value, key, OVERLOAD_FIELDS[key]!));
    }
    result['equip_skills'] = equip_skills;
  }

  // 소장품 / 애장품. 둘은 같은 슬롯이라 한 설정으로 받는다.
  const collection = get(raw, 'collection');
  if (collection != null) {
    if (!_py_is_dict(collection) || Object.keys(collection).some((k) => k !== 'stage' && k !== 'favorite')) {
      throw ValueError('소장품 설정은 stage와 favorite만 포함해야 한다');
    }
    const favorite = get(collection, 'favorite', 0);
    if (!_py_is_int(favorite)
      || !(0 <= favorite && favorite <= FAVORITE_MAX_STAGE)) {
      throw ValueError(`애장품 단계는 0~${FAVORITE_MAX_STAGE} 정수여야 한다`);
    }
    if (favorite > 0) {
      result['collection_stage'] = FAVORITE_COLLECTION_STAGE;
    } else {
      const stage = get(collection, 'stage', NO_ITEM);
      if (!_py_in(stage, _constants().COLLECTION_STAGES)) {
        throw ValueError(
          `소장품 단계는 ${NO_ITEM} 또는 R0~R15 · SR0~SR15 중 하나여야 한다 (${_py_repr(stage)})`);
      }
      result['collection_stage'] = stage;
    }
    result['favorite_stage'] = favorite;
  }

  const cube = get(raw, 'cube');
  if (cube != null) {
    if (!_py_is_dict(cube) || Object.keys(cube).some((k) => k !== 'name' && k !== 'level')) {
      throw ValueError('큐브 설정은 name과 level만 포함해야 한다');
    }
    const name = get(cube, 'name');
    const level = get(cube, 'level');
    // 「없음」은 큐브를 안 낀 상태다. 레벨은 0으로 못 박는다.
    if (name === '없음') {
      result['cube'] = { name: '없음', level: 0 };
    } else {
      const { CUBE_NAMES } = _constants();
      if (!_py_in(name, CUBE_NAMES)) {
        throw ValueError(`큐브는 없음, ${CUBE_NAMES.join(', ')} 중 하나여야 한다`);
      }
      if (!_py_is_int(level) || !(1 <= level && level <= 15)) {
        throw ValueError('큐브 레벨은 1~15 정수여야 한다');
      }
      result['cube'] = { name: name, level: level };
    }
  }

  const equip_levels = get(raw, 'equipLevels');
  if (equip_levels != null) {
    if (!_py_is_dict(equip_levels)) {
      throw ValueError('장비 레벨 설정은 객체여야 한다');
    }
    const unknown = Object.keys(equip_levels).filter((k) => !(EQUIP_PARTS as readonly string[]).includes(k));
    if (unknown.length) {
      throw ValueError(`지원하지 않는 장비 부위: ${_py_repr(sorted(unknown))}`);
    }
    const equipment: Record<string, any> = {};
    for (const [part, level] of Object.entries(equip_levels)) {
      // 문자열은 등급(미장착·일반 T1~T9) — 강화 단계가 없는 갈래다.
      if (typeof level === 'string') {
        if (!EQUIP_TIERS.includes(level)) {
          throw ValueError(
            `장비 등급(${part})은 ${NO_ITEM} 또는 T1~T9여야 한다 (${_py_repr(level)})`);
        }
        equipment[part] = { tier: level };
        continue;
      }
      if (!_py_is_int(level)
        || !(0 <= (level as number) && (level as number) <= EQUIP_LEVEL_MAX)) {
        throw ValueError(`장비 레벨(${part})은 0~${EQUIP_LEVEL_MAX} 정수여야 한다`);
      }
      equipment[part] = { level: level };
    }
    if (truthy(equipment)) {
      result['equipment'] = equipment;
    }
  }

  const manual = get(raw, 'manualStats');
  if (manual != null) {
    if (!_py_is_dict(manual)) {
      throw ValueError('고급 수치 설정은 객체여야 한다');
    }
    const unknown = Object.keys(manual).filter((k) => !has(MANUAL_STATS, k));
    if (unknown.length) {
      throw ValueError(`지원하지 않는 고급 수치: ${_py_repr(sorted(unknown))}`);
    }
    const manual_stats: Record<string, any> = {};
    for (const [key, value] of Object.entries(manual)) {
      _set_float(manual_stats, key, _number(value, key, MANUAL_STATS[key]!));
    }
    result['manual_stats'] = manual_stats;
  }

  return result;
}

// (`_self_test`와 `__main__`은 옮기지 않는다 — CLI 자가 점검용이다.)

// ═════════════════════════════════════════════════════════════════════════
// TS 전용 — 파이썬 의미·표기 도우미 (spec.ts · bridge.ts · growth.ts가 함께 쓴다)
// ═════════════════════════════════════════════════════════════════════════

/** `isinstance(v, dict)` — JSON 객체(배열·null 아님). */
export function _py_is_dict(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set);
}

/**
 * `isinstance(v, int) and not isinstance(v, bool)`.
 * JSON.parse는 `5`와 `5.0`을 가르지 못한다. 브라우저 요청(JSON.stringify)은 정수값 실수를
 * 늘 `5`로 적고 파이썬도 그것을 int로 읽으므로, 정수값이면 int로 본다.
 */
export function _py_is_int(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** `x in (a, b, ...)` — 파이썬 `==` 비교(문자열·수). */
export function _py_in(x: unknown, seq: readonly unknown[]): boolean {
  for (const s of seq) {
    if (_py_eq(x, s)) return true;
  }
  return false;
}

/** 파이썬 `a == b` (JSON 자료). bool은 int와 같게 비교된다(True == 1). */
export function _py_eq(a: any, b: any): boolean {
  const an = typeof a === 'number' || typeof a === 'boolean';
  const bn = typeof b === 'number' || typeof b === 'boolean';
  if (an && bn) return Number(a) === Number(b);
  if (an || bn) return false;
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!_py_eq(a[i], b[i])) return false;
    return true;
  }
  if (_py_is_dict(a) && _py_is_dict(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!_py_eq(a[k], b[k])) return false;
    }
    return true;
  }
  return a === b;
}

/** `set(d) == set(keys)`. */
function _same_key_set(d: Record<string, any>, keys: string[]): boolean {
  const ks = Object.keys(d);
  return ks.length === keys.length && keys.every((k) => has(d, k));
}

/** `d.update(other)` — 표시(float)까지 옮긴다. */
export function _py_update(d: Record<string, any>, other: Record<string, any>): void {
  for (const [k, v] of Object.entries(other)) {
    d[k] = v;
    _mark_float(d, k, _is_float(other, k));
  }
}

/** 파이썬 `float(x)` — None·객체는 TypeError, 문자열은 파싱, bool은 0/1. */
export function _py_float(x: any): number {
  if (typeof x === 'number') return x;
  if (typeof x === 'boolean' || typeof x === 'string') return py_float(x);
  const tn = x == null ? 'NoneType' : Array.isArray(x) ? 'list' : 'dict';
  throw TypeError_(`float() argument must be a string or a real number, not '${tn}'`);
}

/** 파이썬 `int(x)` — None·객체는 TypeError. */
export function _py_int(x: any): number {
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) {
      throw Number.isNaN(x)
        ? ValueError('cannot convert float NaN to integer')
        : new Error('OverflowError: cannot convert float infinity to integer');
    }
    return Math.trunc(x) + 0;
  }
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (typeof x === 'string') {
    const s = x.trim().replace(/_/g, '');
    if (!/^[+-]?\d+$/.test(s)) throw ValueError(`invalid literal for int() with base 10: ${_py_repr(x)}`);
    return parseInt(s, 10);
  }
  const tn = x == null ? 'NoneType' : Array.isArray(x) ? 'list' : 'dict';
  throw TypeError_(`int() argument must be a string, a bytes-like object or a real number, not '${tn}'`);
}

/** 파이썬 `str.strip()` (인자 없음). */
export function _py_strip(s: string): string {
  return s.replace(/^[\s\x1c-\x1f\x85]+|[\s\x1c-\x1f\x85]+$/g, '');
}

/** 파이썬 `repr(float)` — 가장 짧은 왕복 표기, 지수는 1e16 이상·1e-4 미만에서. */
export function _py_float_repr(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const sign = x < 0 ? '-' : '';
  const e = Math.abs(x).toExponential(); // 가장 짧은 왕복 자릿수
  const [mant, expStr] = e.split('e') as [string, string];
  const exp = parseInt(expStr, 10);
  const digits = mant.replace('.', '');
  if (exp >= 16 || exp < -4) {
    const rest = digits.slice(1);
    const es = Math.abs(exp) < 10 ? `0${Math.abs(exp)}` : `${Math.abs(exp)}`;
    return `${sign}${digits[0]}${rest ? `.${rest}` : ''}e${exp < 0 ? '-' : '+'}${es}`;
  }
  let s: string;
  if (exp < 0) {
    s = `0.${'0'.repeat(-exp - 1)}${digits}`;
  } else if (digits.length <= exp + 1) {
    s = `${digits}${'0'.repeat(exp + 1 - digits.length)}.0`;
  } else {
    s = `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`;
  }
  return sign + s;
}

/** 파이썬 `format(x, "g")` — 유효숫자 6자리, 동률은 짝수 쪽(정확한 이진값 기준). */
export function _py_fmt_g(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const P = 6;
  const sign = x < 0 ? '-' : '';
  const ax = Math.abs(x);
  // 정확한 십진 전개에서 유효숫자 P자리로 반올림(동률이면 짝수).
  let digits: string;
  let exp: number;
  if (ax >= 1e21) {
    const m = ax.toExponential(P - 1);
    const [mm, ee] = m.split('e') as [string, string];
    digits = mm.replace('.', '');
    exp = parseInt(ee, 10);
  } else {
    const exact = ax.toFixed(100);
    const dot = exact.indexOf('.');
    const all = exact.slice(0, dot) + exact.slice(dot + 1);
    const intLen = dot;
    let first = 0;
    while (first < all.length && all[first] === '0') first += 1;
    exp = intLen - first - 1;
    const kept = all.slice(first, first + P).padEnd(P, '0');
    const rest = all.slice(first + P);
    let n = BigInt(kept);
    const r0 = rest.charCodeAt(0) - 48;
    const tail = rest.slice(1).replace(/0+$/, '');
    let up: boolean;
    if (!(r0 >= 0)) up = false;
    else if (r0 > 5) up = true;
    else if (r0 < 5) up = false;
    else if (tail.length > 0) up = true;
    else up = n % 2n === 1n;
    if (up) n += 1n;
    digits = n.toString();
    if (digits.length > P) {
      digits = digits.slice(0, P);
      exp += 1;
    }
  }
  if (exp >= -4 && exp < P) {
    let s: string;
    if (exp < 0) s = `0.${'0'.repeat(-exp - 1)}${digits}`;
    else s = `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`;
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return sign + s;
  }
  let mant = `${digits[0]}.${digits.slice(1)}`.replace(/0+$/, '').replace(/\.$/, '');
  const es = Math.abs(exp) < 10 ? `0${Math.abs(exp)}` : `${Math.abs(exp)}`;
  mant = `${mant}e${exp < 0 ? '-' : '+'}${es}`;
  return sign + mant;
}

function _py_str_repr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (c < 0x20 || c === 0x7f) out += `\\x${c.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return out + quote;
}

/**
 * 파이썬 `repr(v)` (JSON 자료). `is_float`이면 정수값 수를 `2.0`으로 적는다.
 * 사전·리스트 안의 수는 담긴 객체의 float 표시를 본다.
 */
export function _py_repr(v: any, is_float: boolean = false): string {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') {
    if (is_float || !Number.isInteger(v)) return _py_float_repr(v);
    return String(v);
  }
  if (typeof v === 'string') return _py_str_repr(v);
  if (Array.isArray(v)) {
    return `[${v.map((x, i) => _py_repr(x, _is_float(v, i))).join(', ')}]`;
  }
  if (v instanceof Set) {
    return v.size ? `{${[...v].map((x) => _py_repr(x)).join(', ')}}` : 'set()';
  }
  if (typeof v === 'object') {
    return `{${Object.entries(v).map(([k, x]) => `${_py_str_repr(k)}: ${_py_repr(x, _is_float(v, k))}`).join(', ')}}`;
  }
  return String(v);
}

/** 파이썬 `str(v)`. 문자열은 그대로, 나머지는 repr과 같다. */
export function _py_str(v: any, is_float: boolean = false): string {
  if (typeof v === 'string') return v;
  return _py_repr(v, is_float);
}

// ── «정수값인 파이썬 float» 표시 ─────────────────────────────────────────
// JSON 자료에는 int/float 구분이 없다. 파이썬에서 `float(...)`로 만들어져 캐릭터 dict에 들어가는
// 값은 담긴 객체·키에 표시해 두고, 사본(`_deepcopy_marked`)과 병합(`spec.deep_merge`)이 옮긴다.
// 계산에는 영향이 없다 — 이탈 보고 글(`2.0 → 2.5`)을 파이썬과 같게 찍는 데만 쓴다.

/** (obj, key)의 값이 파이썬 float인지 표시(또는 해제). */
export function _mark_float(obj: object, key: string | number, is_float: boolean = true): void {
  const k = String(key);
  let s = _PY_FLOATS.get(obj);
  if (is_float) {
    if (!s) { s = new Set(); _PY_FLOATS.set(obj, s); }
    s.add(k);
  } else if (s) {
    s.delete(k);
  }
}

/** (obj, key)의 값이 파이썬 float인가. */
export function _is_float(obj: unknown, key: string | number): boolean {
  if (obj === null || typeof obj !== 'object') return false;
  const s = _PY_FLOATS.get(obj as object);
  return !!s && s.has(String(key));
}

/** `obj[key] = value` + float 표시. */
export function _set_float(obj: Record<string, any>, key: string, value: number): void {
  obj[key] = value;
  _mark_float(obj, key);
}

function _float_list(xs: number[]): number[] {
  xs.forEach((_, i) => _mark_float(xs, i));
  return xs;
}

function _copy_marks(src: any, dst: any): void {
  if (src === null || typeof src !== 'object' || dst === null || typeof dst !== 'object') return;
  const s = _PY_FLOATS.get(src);
  if (s && s.size) _PY_FLOATS.set(dst, new Set(s));
  if (Array.isArray(src)) {
    src.forEach((x, i) => _copy_marks(x, dst[i]));
  } else if (_py_is_dict(src)) {
    for (const k of Object.keys(src)) _copy_marks(src[k], dst[k]);
  }
}

/** `copy.deepcopy` + float 표시 복사. */
export function _deepcopy_marked<T>(v: T): T {
  const out = deepcopy(v);
  _copy_marks(v, out);
  return out;
}

/**
 * 데이터에 달린 모듈 상수를 «늦게» 보여 주는 창. 파이썬은 import 시점에 파일을 읽어 상수를 만들지만
 * 여기서는 그때 데이터가 없을 수 있으므로, 처음 쓸 때 실제 값으로 넘긴다. (structuredClone은
 * Proxy를 복사하지 못하므로 모듈 안에서는 실제 값을 주는 함수를 쓴다.)
 */
export function _lazy_view<T extends object>(resolve: () => T, shape: T): T {
  return new Proxy(shape, {
    get: (_t, p) => {
      const o: any = resolve();
      const v = o[p];
      return typeof v === 'function' ? v.bind(o) : v;
    },
    has: (_t, p) => p in (resolve() as object),
    ownKeys: () => Reflect.ownKeys(resolve() as object),
    getOwnPropertyDescriptor: (_t, p) => {
      const d = Reflect.getOwnPropertyDescriptor(resolve() as object, p);
      if (d && p !== 'length') d.configurable = true;
      return d;
    },
    set: (_t, p, v) => {
      (resolve() as any)[p] = v;
      return true;
    },
    deleteProperty: (_t, p) => delete (resolve() as any)[p],
  });
}

// 데이터가 들어오는 즉시(커스텀 니케가 얹히기 전에) 상수를 뜬다. 모듈 끝에 두는 것은
// `_init_constants`가 쓰는 모듈 상수(_OFFICIAL_ORDER 등)가 모두 초기화된 뒤여야 해서다.
onDataChange.push(() => { _init_constants(); });
if (hasEngineData()) _init_constants();
