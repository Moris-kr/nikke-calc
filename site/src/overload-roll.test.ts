import { describe, expect, it } from 'vitest';

import { LEVEL_WEIGHTS, rollLevel, rollLines } from './overload-roll';

/** 정해진 값들을 차례로 내는 가짜 주사위. */
const dice = (...values: number[]) => {
  let at = 0;
  return () => values[Math.min(at++, values.length - 1)]!;
};

describe('깡오버 랜덤', () => {
  it('레벨 분포는 합이 1이고 1~15만 있다', () => {
    expect(LEVEL_WEIGHTS).toHaveLength(15);
    expect(LEVEL_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0)).toBeCloseTo(1, 10);
    expect(LEVEL_WEIGHTS.map(([level]) => level)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
  });

  it('1~5는 각 12%, 6~10은 각 7%, 11~15는 각 1%', () => {
    for (const [level, weight] of LEVEL_WEIGHTS) {
      expect(weight).toBeCloseTo(level <= 5 ? 0.12 : level <= 10 ? 0.07 : 0.01, 10);
    }
  });

  it('주사위 눈이 구간을 가른다', () => {
    expect(rollLevel(dice(0))).toBe(1);
    expect(rollLevel(dice(0.59))).toBe(5);          // 1~5가 0.60까지
    expect(rollLevel(dice(0.61))).toBe(6);
    expect(rollLevel(dice(0.94))).toBe(10);         // 6~10이 0.95까지
    expect(rollLevel(dice(0.96))).toBe(11);
    expect(rollLevel(dice(0.999999))).toBe(15);
    expect(rollLevel(dice(1))).toBe(15);            // 티끌이 남아도 목록 밖으로 안 나간다
  });

  it('굴린 줄은 고른 옵션 안에서만 나온다', () => {
    const pool = ['atk', 'crit_rate', 'charge_dmg'];
    const lines = rollLines(pool, 12);
    expect(lines).toHaveLength(12);
    for (const line of lines) {
      expect(pool).toContain(line.option);
      expect(line.level).toBeGreaterThanOrEqual(1);
      expect(line.level).toBeLessThanOrEqual(15);
    }
  });

  it('고를 옵션이 없으면 아무것도 안 굴린다', () => {
    // 「옵션 없음 Lv7」 같은 뜻 없는 줄을 남기지 않는다.
    expect(rollLines([], 12)).toEqual([]);
  });
});
