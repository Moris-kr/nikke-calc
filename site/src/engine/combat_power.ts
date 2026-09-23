/**
 * calculator/combat_power.py — 인게임 전투력(투력) 계산.
 *
 *     전투력 = (① + ② + ③) × ④ / 100
 *       ① 0.7  × 체력
 *       ② 19.35 × 공격력
 *       ③ 70   × 방어력
 *       ④ 1.3 + 0.01×1스킬 + 0.01×2스킬 + 0.02×버스트
 *           + 0.00828×(우코 오버로드 단계합)
 *           + 0.0069 ×(비우코 오버로드 단계합)
 *           + 0.0092 ×(큐브 계수)
 *           + 0.0069 ×(소장품 계수)
 *
 * **딜 계산과는 무관하다.** 전투력은 인게임 표기값을 재현하는 별도 지표이고, 목록을 정렬하는 데만 쓴다.
 *
 * 파이썬은 모듈을 불러올 때 표(`equipment_skills.json`·`cube.json`)를 읽지만, 여기서는 함수 안에서
 * `data()`로 꺼낸다.
 */
import { data } from './data';
import { calc_base_stats } from './base_stat';
import { float, get, has, int, or, round, sorted, sum, truthy } from './py';

// py: calculator/combat_power.py:37
function _EQUIP_SKILLS(): Record<string, any> {
  return data().tables.equipment_skills;
}
// py: calculator/combat_power.py:38
function _CUBE(): Record<string, any> {
  return data().tables.cube;
}

// 오버로드에서 «우월 코드» 옵션은 이것 하나다. 나머지는 전부 비우코로 친다.
export const ELEMENT_OPTION = 'element_bonus';

// py: calculator/combat_power.py:44
/** 단계표의 (1단계 값, 단계당 증가폭). 표가 등차라서 이 둘이면 충분하다. */
export function _stage_steps(option: string): [number, number] {
  const values = (_EQUIP_SKILLS()[option]['values'] as number[]).map((v) => v * 100);
  return [values[0]!, (values[values.length - 1]! - values[0]!) / (values.length - 1)];
}

// py: calculator/combat_power.py:50
/**
 * 옵션 합계 퍼센트 → **단계 합**. 단계표가 등차수열이라 합계 = n×(base − step) + (단계합)×step 에서
 * 역산한다. 풀리지 않으면 0을 준다.
 */
export function stage_sum(option: string, total_pct: number): number {
  if (total_pct <= 0) {
    return 0;
  }
  const [base, step] = _stage_steps(option);
  for (let count = 1; count < 13; count += 1) {          // 오버로드는 4부위 × 3옵션 = 최대 12개
    const raw = (total_pct - count * (base - step)) / step;
    const rounded = round(raw);
    if (count <= rounded && rounded <= 15 * count && Math.abs(raw - rounded) < 0.03) {
      return rounded;
    }
  }
  return 0;
}

// py: calculator/combat_power.py:74
/** 큐브 레벨 → (고유 스킬 레벨, 공통 스킬 레벨). `cube.json`의 레벨별 값의 계단 번호다. */
export function _cube_skill_levels(level: number): [number, number] {
  const steps = (entry: Record<string, any>): Map<number, number> => {
    // 값(문자열) → 계단 번호. 파이썬 dict 삽입 순서 = Map.
    const seen = new Map<unknown, number>();
    const out = new Map<number, number>();
    for (const key of sorted(Object.keys(entry['values']), (k) => int(k))) {
      const value = entry['values'][key][0];
      if (!seen.has(value)) seen.set(value, seen.size + 1);
      out.set(int(key), seen.get(value)!);
    }
    return out;
  };

  // 고유 스킬의 계단은 큐브 종류와 무관하게 같다 — 아무거나 하나로 읽는다.
  const cube = _CUBE();
  const ownKey = Object.keys(cube).find((k) => !k.startsWith('_') && k !== '공통');
  if (ownKey === undefined) throw new Error('StopIteration');
  const own = cube[ownKey];
  const first = steps(own).get(level) ?? 0;
  const second = steps(cube['공통']).get(level) ?? 0;
  return [first, second];
}

// py: calculator/combat_power.py:95
/** 큐브 계수. 4레벨 이하 = 1스킬 + 1, 5레벨 이상 = 1스킬 + 2스킬 + 4. */
export function cube_coeff(cube: Record<string, any> | null | undefined): number {
  if (!truthy(cube)) {
    return 0.0;
  }
  const level = int(or(get(cube!, 'level'), 0));
  if (level <= 0) {
    return 0.0;
  }
  const [first, second] = _cube_skill_levels(level);
  return level <= 4 ? (first + 1) : (first + second + 4);
}

// py: calculator/combat_power.py:106
/** 소장품 계수. R = 1스킬 + 6.33, SR = 1스킬 + 2스킬 + 10.66. 소장품 스킬 레벨 = 소장품 레벨. */
export function collection_coeff(stage: string | null | undefined): number {
  if (!truthy(stage) || stage === '없음') {
    return 0.0;
  }
  const s = stage as string;
  const grade = s.toUpperCase().startsWith('SR') ? 'SR' : 'R';
  // 파이썬 `str.isdigit` — 소장품 단계 표기는 ASCII 숫자만 쓴다.
  const digits = [...s].filter((ch) => ch >= '0' && ch <= '9').join('');
  const level = digits ? int(digits) : 0;
  if (level <= 0) {
    return 0.0;
  }
  return grade === 'R' ? (level + 6.33) : (level * 2 + 10.66);
}

// py: calculator/combat_power.py:122
/** 캐릭터 인스턴스(`context.spec` 형식) → 인게임 전투력. */
export function combat_power(char: Record<string, any>): number {
  const stats = calc_base_stats(char);
  const base = 0.7 * stats['hp']! + 19.35 * stats['atk']! + 70 * stats['def']!;

  const skills = or(get(char, 'skill_levels'), {} as Record<string, any>) as Record<string, any>;
  const over = or(get(char, 'equip_skills'), {} as Record<string, any>) as Record<string, any>;
  const element = stage_sum(ELEMENT_OPTION, float(or(get(over, ELEMENT_OPTION, 0), 0)));
  const other = sum(
    Object.entries(over)
      .filter(([option]) => option !== ELEMENT_OPTION && has(_EQUIP_SKILLS(), option))
      .map(([option, value]) => stage_sum(option, float(or(value, 0)))),
  );

  const mult = (
    1.3
    + 0.01 * int(or(get(skills, '1', 0), 0))
    + 0.01 * int(or(get(skills, '2', 0), 0))
    + 0.02 * int(or(get(skills, '3', 0), 0))
    + 0.00828 * element
    + 0.0069 * other
    + 0.0092 * cube_coeff(get(char, 'cube'))
    + 0.0069 * collection_coeff(get(char, 'collection_stage'))
  );
  return base * mult / 100;
}
