import { describe, expect, it } from 'vitest';

import { OPTION_PROB } from './overload-cost';
import {
  canLock, changeCost, rollEffectChange, rollLevel, rollValueChange, type PartLocks,
} from './overload-sim';
import type { OverloadLine } from './types';

/** 결정론적 난수 — 시험은 «규칙»을 보지 «운»을 보지 않는다. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const OPTIONS = Object.keys(OPTION_PROB);
const lines = (...rows: Array<[string, number]>): OverloadLine[] =>
  rows.map(([option, level]) => ({ option, level }));

describe('변경 비용', () => {
  it('모듈은 1 + 모듈로 잠근 줄, 락키는 잠긴 줄 수로 20·30·50', () => {
    expect(changeCost([null, null, null])).toEqual({ modules: 1, keys: 0 });
    expect(changeCost(['module', null, null])).toEqual({ modules: 2, keys: 0 });
    expect(changeCost(['module', 'module', null])).toEqual({ modules: 3, keys: 0 });
    expect(changeCost(['key', null, null])).toEqual({ modules: 1, keys: 20 });
    expect(changeCost(['key', 'key', null])).toEqual({ modules: 1, keys: 50 });
    // 섞으면: 모듈은 락키 줄을 무시하고, 락키는 «두 번째 잠금»이라 30.
    expect(changeCost(['module', 'key', null])).toEqual({ modules: 2, keys: 30 });
    expect(changeCost(['key', 'module', null])).toEqual({ modules: 2, keys: 30 });
  });

  it('잠금은 옵션이 있는 줄만, 부위당 두 줄까지', () => {
    const locks: PartLocks = ['module', 'key', null];
    expect(canLock(locks, 2, { option: 'atk_pct', level: 5 })).toBe(false);
    expect(canLock(locks, 0, { option: 'atk_pct', level: 5 })).toBe(true);
    expect(canLock([null, null, null], 1, { option: '', level: 1 })).toBe(false);
    expect(canLock([null, null, null], 1, { option: 'crit_dmg', level: 1 })).toBe(true);
  });
});

describe('굴림', () => {
  it('레벨은 1~15에서 나오고, 뺄 레벨을 주면 그 값은 절대 안 나온다', () => {
    const rng = seeded(7);
    for (let i = 0; i < 300; i += 1) {
      const level = rollLevel(rng, 7);
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(15);
      expect(level).not.toBe(7);
    }
  });

  it('효과 변경은 잠긴 줄을 그대로 두고, 나머지에 잠긴 효과를 다시 주지 않는다', () => {
    const before = lines(['atk_pct', 15], ['crit_dmg', 9], ['def_pct', 3]);
    const rng = seeded(11);
    for (let i = 0; i < 200; i += 1) {
      const after = rollEffectChange(before, ['module', null, 'key'], OPTIONS, rng);
      expect(after[0]).toEqual({ option: 'atk_pct', level: 15 });
      expect(after[2]).toEqual({ option: 'def_pct', level: 3 });
      if (after[1]!.option) {
        expect(['atk_pct', 'def_pct']).not.toContain(after[1]!.option);
        expect(after[1]!.level).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('첫 줄은 언제나 나오고, 2·3번째 줄은 빈 줄이 될 수 있다 — 중복 효과는 없다', () => {
    const before = lines(['atk_pct', 1], ['', 1], ['', 1]);
    const rng = seeded(3);
    let emptySeen = false;
    for (let i = 0; i < 300; i += 1) {
      const after = rollEffectChange(before, [null, null, null], OPTIONS, rng);
      expect(after[0]!.option).toBeTruthy();
      const picked = after.map((line) => line.option).filter(Boolean);
      expect(new Set(picked).size).toBe(picked.length);
      if (!after[1]!.option || !after[2]!.option) emptySeen = true;
    }
    expect(emptySeen).toBe(true);
  });

  it('빈 줄을 뺀 결과가 완전히 같으면 다시 굴린다', () => {
    const before = lines(['atk_pct', 15], ['', 1], ['', 1]);
    // 옵션이 하나뿐이면 효과는 언제나 같다 — 그래도 레벨이 바뀌어야 «변경»이다.
    const rng = seeded(5);
    for (let i = 0; i < 100; i += 1) {
      const after = rollEffectChange(before, [null, 'module', 'module'], ['atk_pct'], rng);
      expect(after[0]!.option).toBe('atk_pct');
      expect(after[0]!.level).not.toBe(15);
    }
  });

  it('수치 변경은 효과를 두고 잠기지 않은 줄의 레벨만 바꾼다 — 같은 레벨은 안 나온다', () => {
    const before = lines(['atk_pct', 15], ['crit_dmg', 9], ['', 1]);
    const rng = seeded(21);
    for (let i = 0; i < 200; i += 1) {
      const after = rollValueChange(before, ['module', null, null], rng);
      expect(after[0]).toEqual({ option: 'atk_pct', level: 15 });
      expect(after[1]!.option).toBe('crit_dmg');
      expect(after[1]!.level).not.toBe(9);
      expect(after[2]).toEqual({ option: '', level: 1 });
    }
  });
});
