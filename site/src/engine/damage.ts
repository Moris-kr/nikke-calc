/**
 * Phase 4: 단일 히트 대미지 계산기
 *
 * DealForm:
 *   대미지 = ① 계수 × ② 공방차이 × ③ 보너스 × ④ 차지 × ⑤ 유형별 버프 × ⑥ 적 받는 × ⑦ 우월 코드
 *
 * 이식: calculator/damage.py (hit_type 키 설명은 원본 docstring 참고)
 */
import { float, get, random, round, truthy } from './py';

export const DEFAULT_ENEMY_DEF = 31784.0;

// 파이썬 `max(a, b)` / `min(a, b)` — 같으면 앞의 것(NaN·-0까지 파이썬과 같게).
function _pymax2(a: number, b: number): number {
  return b > a ? b : a;
}
function _pymin2(a: number, b: number): number {
  return b < a ? b : a;
}

// ── 코드 상성 ─────────────────────────────────────────────────────────────

export const _CODE_ADVANTAGE: Record<string, string> = {
  '전격': '수냉',
  '수냉': '작열',
  '작열': '풍압',
  '풍압': '철갑',
  '철갑': '전격',
};

// py: calculator/damage.py:58
/** 캐릭터 코드가 적 코드에 우월한지 반환. */
export function is_element_match(char_code: string, enemy_code: string): boolean {
  return get(_CODE_ADVANTAGE, char_code, '') === enemy_code;
}

// ── 기본 hit_type ─────────────────────────────────────────────────────────

// py: calculator/damage.py:64
/** 파이썬 `default_hit_type(**overrides)` → `default_hit_type({ ...overrides })`. */
export function default_hit_type(overrides: Record<string, any> = {}): Record<string, any> {
  const ht: Record<string, any> = {
    is_core: false,
    core_prob: null,
    is_full_burst: false,
    is_optimal_range: false,
    is_full_charge: false,
    is_burst_damage: false,
    is_aoe_burst: false,
    is_pierce_damage: false,
    is_armor_break_damage: false,
    is_dot: false,
    is_projectile_explosion: false,
    is_projectile_attachment: false,
    is_sequential: false,
    is_split: false,
    is_part: false,
    is_core_damage: false,
    is_normal_atk: true,
    is_weapon_mode_skill: false,
    coeff: null,
    is_final_atk: false,
  };
  // ht.update(overrides) — 명시적으로 넘긴 None(null)도 덮어쓴다. undefined는 파이썬에 없는 값이라 그대로 옮긴다.
  for (const k of Object.keys(overrides)) ht[k] = overrides[k];
  return ht;
}

// ── DealForm 각 항목 ──────────────────────────────────────────────────────

// py: calculator/damage.py:93
/** ① 계수 × (1 + 일반 공격 대미지 배율 %▲) */
export function _factor1(weapon: Record<string, any>, buffs: Record<string, any>, hit_type: Record<string, any>): number {
  let coeff = hit_type['coeff'];
  if (coeff == null) {
    coeff = weapon['damage_coeff'];
  }

  // normal_atk_dmg_pct는 기본 무기 일반 공격에만 적용
  let normal_bonus: number;
  if (truthy(hit_type['is_normal_atk'])) {
    normal_bonus = get(buffs, 'normal_atk_dmg_pct', 0.0) / 100.0;
  } else {
    normal_bonus = 0.0;
  }

  return coeff * (1.0 + normal_bonus);
}

// py: calculator/damage.py:108
/**
 * ② {기본공격력 × (1 + atk_pct%) + atk_flat}
 *    – {적방어력 × (1 + enemy_def_down_pct%) × (1 – def_ignore_pct%)}
 */
export function _factor2(base_atk: number, enemy_def: number, buffs: Record<string, any>, hit_type: Record<string, any>): number {
  const atk_term = base_atk * (1.0 + get(buffs, 'atk_pct', 0.0) / 100.0)
    + get(buffs, 'atk_flat', 0.0);
  let def_term: number;
  if (truthy(get(hit_type, 'is_armor_break_damage'))) {
    def_term = 0.0;
  } else {
    const eff_def = _pymax2(enemy_def * (1.0 + get(buffs, 'enemy_def_down_pct', 0.0) / 100.0), 0.0);
    def_term = eff_def * (1.0 - get(buffs, 'def_ignore_pct', 0.0) / 100.0);
  }
  return _pymax2(atk_term - def_term, 0.0);
}

// py: calculator/damage.py:122
/**
 * ③ 보너스 배율 반환 및 크리티컬 판정.
 * 반환: [factor3, is_crit, crit_frac]
 */
export function _factor3(
  weapon: Record<string, any>,
  buffs: Record<string, any>,
  hit_type: Record<string, any>,
  expected: boolean = false,
): [number, boolean, number] {
  let bonus = 1.0;
  let is_crit = false;

  let crit_rate: number;
  let crit_dmg: number;
  if (truthy(hit_type['is_normal_atk'])) {
    crit_rate = get(buffs, 'crit_rate', 0.15);
    crit_dmg = get(buffs, 'crit_dmg', 0.0);
  } else {
    crit_rate = get(buffs, 'crit_rate_skill', get(buffs, 'crit_rate', 0.15));
    crit_dmg = get(buffs, 'crit_dmg_skill', get(buffs, 'crit_dmg', 0.0));
  }

  const crit_bonus = 0.5 + crit_dmg / 100.0;
  let crit_frac: number;
  if (truthy(expected)) {
    // 확률 판정 대신 기대값: 크리 기여분 = min(크리확률, 1) × (0.5 + crit_dmg%)
    crit_frac = _pymin2(crit_rate, 1.0);
    bonus += crit_frac * crit_bonus;
  } else if (random.random() < crit_rate) {
    is_crit = true;
    crit_frac = 1.0;
    bonus += crit_bonus;
  } else {
    crit_frac = 0.0;
  }

  // 풀버스트 타임
  if (truthy(hit_type['is_full_burst'])) {
    bonus += 0.5;
  }

  // 적정거리 (일반 공격에만)
  if (truthy(hit_type['is_optimal_range']) && truthy(hit_type['is_normal_atk'])) {
    bonus += 0.3;
  }

  // 코어 대미지 (일반 공격 + core_damage 스킬)
  const core_prob = get(hit_type, 'core_prob');
  const core_weight = (truthy(expected) && core_prob != null)
    ? float(core_prob)
    : (truthy(hit_type['is_core']) ? 1.0 : 0.0);
  // 무기 변경 모드의 스킬 사격도 실제로 코어를 때린다 (유저 인게임 확인, 나유타 `기억 연소`).
  if (truthy(core_weight) && (truthy(hit_type['is_normal_atk']) || truthy(get(hit_type, 'is_core_damage'))
    || truthy(get(hit_type, 'is_weapon_mode_skill')))) {
    // 무기 코어 대미지(예: 200%)는 비코어 기본 100% 대비 추가분 → -100%
    const core_base = (get(weapon, 'core_dmg_mult', 200.0) - 100.0) / 100.0;
    const core_extra = get(buffs, 'core_dmg_pct', 0.0) / 100.0;
    bonus += core_weight * (core_base + core_extra);
  }

  return [bonus, is_crit, crit_frac];
}

// py: calculator/damage.py:194
/**
 * ④ 차지 배율. 풀 차지가 아니면 1.0.
 *     full_charge_mult% × (1 + Σ배율%) + Σ평문%
 */
export function _factor4(weapon: Record<string, any>, buffs: Record<string, any>, hit_type: Record<string, any>): number {
  if (!truthy(hit_type['is_full_charge'])) {
    return 1.0;
  }

  const full_charge_mult = get(weapon, 'full_charge_mult', 100.0) / 100.0;
  const charge_dmg_pct = get(buffs, 'charge_dmg_pct', 0.0) / 100.0;
  const charge_dmg_mag_pct = get(buffs, 'charge_dmg_mag_pct', 0.0) / 100.0;

  return full_charge_mult * (1.0 + charge_dmg_mag_pct) + charge_dmg_pct;
}

// py: calculator/damage.py:227
/**
 * ⑤ 유형별 버프.
 * 100% + 공격대미지▲ [+ 대미지 유형별 버프 선택 합산]
 */
export function _factor5(buffs: Record<string, any>, hit_type: Record<string, any>): number {
  let val = 1.0 + get(buffs, 'atk_dmg_pct', 0.0) / 100.0;

  if (truthy(get(hit_type, 'is_burst_damage'))) {
    val += get(buffs, 'burst_dmg_pct', 0.0) / 100.0;
    // 대상이 '적 전체'인 버스트 대미지에만 추가 가산 (트리나 뻗은 뿌리).
    if (truthy(get(hit_type, 'is_aoe_burst'))) {
      val += get(buffs, 'burst_dmg_aoe_pct', 0.0) / 100.0;
    }
  }
  if (truthy(get(hit_type, 'is_pierce_damage'))) {
    val += get(buffs, 'pierce_dmg_pct', 0.0) / 100.0;
  }
  if (truthy(get(hit_type, 'is_armor_break_damage'))) {
    val += get(buffs, 'armor_break_dmg_pct', 0.0) / 100.0;
  }
  if (truthy(get(hit_type, 'is_dot'))) {
    val += get(buffs, 'dot_dmg_pct', 0.0) / 100.0;
  }
  if (truthy(get(hit_type, 'is_projectile_explosion'))) {
    val += get(buffs, 'projectile_explosion_dmg', 0.0) / 100.0;
  }
  if (truthy(get(hit_type, 'is_projectile_attachment'))) {
    val += get(buffs, 'projectile_attachment_dmg', 0.0) / 100.0;
  }
  if (truthy(get(hit_type, 'is_sequential'))) {
    val += get(buffs, 'sequential_dmg_pct', 0.0) / 100.0;
  }

  // 파츠 대미지 — hit_type["is_part"]로 제어
  if (truthy(get(hit_type, 'is_part'))) {
    val += get(buffs, 'part_dmg_pct', 0.0) / 100.0;
  }

  return val;
}

// py: calculator/damage.py:261
/**
 * ⑥ 적 받는 대미지.
 * 100% + received_dmg▲ [+ split_dmg▲]
 */
export function _factor6(buffs: Record<string, any>, hit_type: Record<string, any>): number {
  let val = 1.0 + get(buffs, 'received_dmg', 0.0) / 100.0;

  if (truthy(get(hit_type, 'is_split'))) {
    val += get(buffs, 'split_dmg_pct', 0.0) / 100.0;
  }

  return val;
}

// py: calculator/damage.py:275
/** ⑦ 우월 코드. 100% [+ 10% + element_bonus%▲] */
export function _factor7(buffs: Record<string, any>): number {
  if (!truthy(get(buffs, 'is_element_match', false))) {
    return 1.0;
  }
  return 1.0 + 0.1 + get(buffs, 'element_bonus_pct', 0.0) / 100.0;
}

// py: calculator/damage.py:282
/** Timed enemy veil is independent of received damage and ordinary DEF. */
export function _defense_rate_factor(buffs: Record<string, any>, hit_type: Record<string, any>): number {
  if (truthy(get(hit_type, 'is_armor_break_damage'))) {
    return 1.0;
  }
  return 1.0 - get(buffs, 'enemy_defense_rate_pct', 0.0) / 100.0;
}

// ── 디버그 출력용 서식(파이썬 f-string 흉내) ─────────────────────────────

function _fixed(x: number, digits: number): string {
  return round(x, digits).toFixed(digits);
}

function _group(s: string): string {
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf('.');
  const ip = dot >= 0 ? body.slice(0, dot) : body;
  const fp = dot >= 0 ? body.slice(dot) : '';
  return (neg ? '-' : '') + ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + fp;
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────

export interface DamageResult {
  damage: number;
  is_crit: boolean;
  crit_frac: number;
}

// py: calculator/damage.py:295
/**
 * 단일 히트 대미지 계산.
 * 파이썬 키워드 호출 `calc_damage(base_atk=, buffs=, weapon=, hit_type=, enemy_def=, expected=)`는
 * 같은 순서의 위치 인자로 부른다.
 */
export function calc_damage(
  base_atk: number,
  buffs: Record<string, any>,
  weapon: Record<string, any>,
  hit_type: Record<string, any> | null = null,
  enemy_def: number = DEFAULT_ENEMY_DEF,
  expected: boolean = false,
): DamageResult {
  if (hit_type == null) {
    hit_type = default_hit_type();
  }

  const f1 = _factor1(weapon, buffs, hit_type);
  const f2 = _factor2(base_atk, enemy_def, buffs, hit_type);
  const [f3, is_crit, crit_frac] = _factor3(weapon, buffs, hit_type, expected);
  const f4 = _factor4(weapon, buffs, hit_type);
  const f5 = _factor5(buffs, hit_type);
  const f6 = _factor6(buffs, hit_type);
  const f7 = _factor7(buffs);

  // ① × ② × ③ × ④ × ⑤ × ⑥ × ⑦
  // ①의 계수는 %이므로 /100
  let damage = (f1 / 100.0) * f2 * f3 * f4 * f5 * f6 * f7;

  // 핵(`calculator/cheats.py`)의 대미지 배수. ①~⑦ **밖에서** 곱한다.
  damage *= get(buffs, 'cheat_dmg_mult', 1.0);

  const veil = _defense_rate_factor(buffs, hit_type);
  damage *= veil;

  if (truthy(get(hit_type, '_debug_factors'))) {
    const crit = truthy(expected) ? `기대 ${_fixed(crit_frac, 3)}` : (is_crit ? 'True' : 'False');
    console.log(
      `  ①계수=${_fixed(f1, 4)}%  ②공방차=${_group(_fixed(f2, 1))}`
      + `  ③보너스=${_fixed(f3, 4)}(크리=${crit})`
      + `  ④차지=${_fixed(f4, 4)}  ⑤유형=${_fixed(f5, 4)}  ⑥받는=${_fixed(f6, 4)}  ⑦코드=${_fixed(f7, 4)}`
      + `  → ${_group(String(_pymax2(round(damage), 1)))}`,
    );
  }

  // 공격력 < 방어력이면 f2=0 → 최소 1 보장
  return {
    damage: truthy(veil) ? _pymax2(round(damage), 1) : 0,
    is_crit: is_crit, crit_frac: crit_frac,
  };
}

// py: calculator/damage.py:356
/**
 * 크리티컬 확률을 기댓값으로 처리한 평균 대미지.
 * 시뮬레이션 없이 기댓값을 빠르게 검산할 때 사용.
 */
export function calc_damage_avg(
  base_atk: number,
  buffs: Record<string, any>,
  weapon: Record<string, any>,
  hit_type: Record<string, any> | null = null,
  enemy_def: number = DEFAULT_ENEMY_DEF,
): number {
  if (hit_type == null) {
    hit_type = default_hit_type();
  }

  const f1 = _factor1(weapon, buffs, hit_type);
  const f2 = _factor2(base_atk, enemy_def, buffs, hit_type);
  const [f3] = _factor3(weapon, buffs, hit_type, true);
  const f4 = _factor4(weapon, buffs, hit_type);
  const f5 = _factor5(buffs, hit_type);
  const f6 = _factor6(buffs, hit_type);
  const f7 = _factor7(buffs);

  const veil = _defense_rate_factor(buffs, hit_type);
  return truthy(veil) ? _pymax2((f1 / 100.0) * f2 * f3 * f4 * f5 * f6 * f7 * veil, 1.0) : 0.0;
}
