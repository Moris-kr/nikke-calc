import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PyRandom, round, int, pymod, floordiv, sum, truthy, sorted } from './py';

const expectPath = process.env.PY_EXPECT;

describe('파이썬 의미', () => {
  it('Neumaier 합산 — CPython 3.12 sum()', () => {
    expect(sum([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1])).toBe(1.0);
    expect(sum([1e16, 1.0, -1e16])).toBe(1.0);
    expect(sum([])).toBe(0);
  });
  it('참·거짓 — 빈 리스트·사전은 거짓', () => {
    expect(truthy([])).toBe(false);
    expect(truthy({})).toBe(false);
    expect(truthy(NaN)).toBe(true);
    expect(truthy('0')).toBe(true);
  });
  it('안정 정렬과 튜플 비교', () => {
    expect(sorted([[2, 'b'], [1, 'z'], [2, 'a']])).toEqual([[1, 'z'], [2, 'a'], [2, 'b']]);
    expect(sorted([3, 1, 2], undefined, true)).toEqual([3, 2, 1]);
  });
  it.runIf(Boolean(expectPath))('CPython과 같은 난수·반올림·나눗셈', () => {
    const want = JSON.parse(readFileSync(expectPath!, 'utf-8'));
    for (const seed of [0, 42, 7, 123456789012]) {
      const r = new PyRandom(seed);
      expect([0, 1, 2, 3, 4].map(() => r.random())).toEqual(want[`rand_${seed}`]);
      expect(r.sample(['a', 'b', 'c', 'd', 'e'], 3)).toEqual(want[`sample_${seed}`]);
      expect(r.random()).toBe(want[`after_${seed}`]);
    }
    expect([round(0.125, 2), round(2.675, 2), round(1.5), round(2.5), round(-2.5), round(-0.5), round(0.5), round(123.4567, 3), round(1e-7, 3), round(-1.005, 2), round(1234.5, 0), round(0.285, 2), round(99.995, 2)]).toEqual(want.round);
    expect([int(3.9), int(-3.9)]).toEqual(want.int);
    expect([pymod(7.5, 2), pymod(-7.5, 2), pymod(7.5, -2), pymod(-7, 3)]).toEqual(want.mod);
    expect([floordiv(7.5, 2), floordiv(-7.5, 2), floordiv(7, 2), floordiv(-7, 2)]).toEqual(want.floordiv);
  });
});
