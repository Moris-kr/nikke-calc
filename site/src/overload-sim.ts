/**
 * 오버로드작 시뮬레이션 — 인게임 «옵션 변경»을 카드의 실제 줄에 그대로 굴린다.
 *
 * 규칙(사용자 확정, 2026-09-22):
 * * 변경 1회 = 모듈 **1 + 모듈로 잠근 줄 수**. 효과 변경·수치 변경이 같은 값이다.
 *   잠금 비용은 잠글 때가 아니라 **변경을 누를 때** 든다. 락키로 잠근 줄은 모듈 계산에서
 *   무시한다.
 * * 커스텀락키는 **잠긴 줄 수**로 정해진다 — 잠금이 한 줄뿐이면 20, 두 줄이면 50(둘 다 락키)
 *   또는 30(하나는 모듈). 인게임에선 한 번 굴리면 풀리지만 여기서는 유지되고, 굴릴 때마다
 *   같은 값이 또 든다.
 * * 잠금은 부위당 최대 두 줄. 빈 줄은 못 잠근다.
 * * 효과 변경: 잠기지 않은 줄의 효과·수치를 새로 굴린다(줄 간 중복 없음, 2·3번째 줄은
 *   50%·30%로 빈 줄이 될 수 있다). 수치 변경: 효과는 두고 잠기지 않은 줄의 레벨만 새로
 *   (같은 레벨은 안 나온다). 확률표는 옵작 가이드와 같은 `overload-cost.ts`다.
 * * 빈 줄을 뺀 결과가 굴리기 전과 **완전히 같으면** 다시 굴린다.
 */

import { APPEARANCE, LEVEL_PROB, OPTION_PROB } from './overload-cost';
import type { EquipPart, OverloadLine, OverloadLines } from './types';

export type LockKind = 'module' | 'key';
/** 한 부위의 세 줄. `null`은 안 잠근 줄. */
export type PartLocks = [LockKind | null, LockKind | null, LockKind | null];

export const MAX_LOCKS = 2;
export const KEY_COST_ONE = 20;
export const KEY_COST_TWO = 50;
/** 다른 한 줄이 모듈로 잠겨 있을 때 락키 한 줄이 드는 값 — 두 줄(50)에서 한 줄(20)을 뺀 몫. */
export const KEY_COST_SECOND = 30;

export interface SimState {
  locks: Record<EquipPart, PartLocks>;
  modules: number;
  keys: number;
  /** 시뮬레이션을 켤 때의 줄. 「처음으로」가 되돌리는 자리다. */
  origin: OverloadLines;
}

export const emptyLocks = (): PartLocks => [null, null, null];

/** 변경 한 번에 드는 재화. */
export function changeCost(locks: PartLocks): { modules: number; keys: number } {
  const moduleLocked = locks.filter((lock) => lock === 'module').length;
  const keyLocked = locks.filter((lock) => lock === 'key').length;
  const total = moduleLocked + keyLocked;
  const keys = keyLocked === 0 ? 0
    : total === 1 ? KEY_COST_ONE
      : keyLocked === 2 ? KEY_COST_TWO : KEY_COST_SECOND;
  return { modules: 1 + moduleLocked, keys };
}

/** 이 줄을 잠글 수 있나 — 옵션이 있고, 이미 잠겼거나 잠금이 두 줄 미만일 때. */
export function canLock(locks: PartLocks, index: number, line: OverloadLine | undefined): boolean {
  if (!line?.option) return false;
  if (locks[index]) return true;
  return locks.filter(Boolean).length < MAX_LOCKS;
}

/** 0 이상 1 미만을 내는 것. 시험에서 갈아 끼운다. */
export type Rng = () => number;
let simRng: Rng = Math.random;
export const setOverloadSimRng = (rng: Rng): void => { simRng = rng; };
export const overloadSimRng = (): Rng => simRng;

function pick<T>(items: T[], weight: (item: T) => number, rng: Rng): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let ticket = rng() * total;
  for (const item of items) {
    ticket -= weight(item);
    if (ticket < 0) return item;
  }
  return items[items.length - 1]!;
}

/** 레벨 하나. `not`을 주면 그 레벨은 빼고 나머지 확률을 다시 나눈다(같은 결과는 안 나온다). */
export function rollLevel(rng: Rng, not?: number): number {
  const levels = LEVEL_PROB.map((_, i) => i + 1).filter((level) => level !== not);
  return pick(levels, (level) => LEVEL_PROB[level - 1]!, rng);
}

const same = (a: OverloadLine, b: OverloadLine): boolean =>
  (a.option || '') === (b.option || '') && (a.option ? a.level === b.level : true);

/** 빈 줄을 뺀 결과가 완전히 같은가 — 그러면 굴린 뜻이 없으니 다시 굴린다. */
const identical = (before: OverloadLine[], after: OverloadLine[]): boolean =>
  before.every((line, i) => same(line, after[i]!));

/**
 * 효과 변경. 잠기지 않은 줄의 효과와 수치를 새로 굴린다.
 * `options`는 이 카탈로그가 아는 옵션(확률표에 없는 것은 안 나온다).
 */
export function rollEffectChange(
  lines: OverloadLine[], locks: PartLocks, options: string[], rng: Rng = simRng,
): OverloadLine[] {
  const pool = options.filter((option) => OPTION_PROB[option]);
  if (pool.length === 0) return lines.map((line) => ({ ...line }));
  const once = (): OverloadLine[] => {
    const out: OverloadLine[] = [];
    const used = new Set(lines.filter((_, i) => locks[i]).map((line) => line.option).filter(Boolean));
    for (let i = 0; i < 3; i += 1) {
      const old = lines[i] ?? { option: '', level: 1 };
      if (locks[i]) { out.push({ ...old }); continue; }
      const appear = APPEARANCE[i] ?? 1;
      if (appear < 1 && rng() >= appear) { out.push({ option: '', level: 1 }); continue; }
      const allowed = pool.filter((option) => !used.has(option));
      if (allowed.length === 0) { out.push({ option: '', level: 1 }); continue; }
      const option = pick(allowed, (key) => OPTION_PROB[key]!, rng);
      used.add(option);
      // 같은 효과가 같은 자리에 다시 나오면 레벨은 반드시 바뀐다.
      out.push({ option, level: rollLevel(rng, option === old.option ? old.level : undefined) });
    }
    return out;
  };
  let result = once();
  for (let tries = 0; tries < 32 && identical(lines, result); tries += 1) result = once();
  return result;
}

/** 수치 변경. 효과는 두고 잠기지 않은 줄의 레벨만 새로 — 같은 레벨은 안 나온다. */
export function rollValueChange(lines: OverloadLine[], locks: PartLocks, rng: Rng = simRng): OverloadLine[] {
  return lines.map((line, i) => (locks[i] || !line.option)
    ? { ...line }
    : { option: line.option, level: rollLevel(rng, line.level) });
}
