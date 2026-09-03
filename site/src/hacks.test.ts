import { describe, expect, it } from 'vitest';

import {
  activeHacks, formatMult, hacksForRequest, hacksOn, HACK_DMG_MULT_MAX, NO_HACKS, normalizeHacks,
} from './hacks';

describe('핵 켜짐 판정', () => {
  it('아무것도 안 켜면 꺼진 것이다', () => {
    expect(hacksOn(NO_HACKS)).toBe(false);
    expect(hacksOn(undefined)).toBe(false);
    expect(activeHacks(NO_HACKS)).toEqual([]);
  });

  it('배수 1은 켠 것이 아니다 — 곱해도 그대로이므로', () => {
    expect(hacksOn({ ...NO_HACKS, damageMult: 1 })).toBe(false);
    expect(hacksOn({ ...NO_HACKS, damageMult: 1.5 })).toBe(true);
  });

  it('켜진 것들의 이름을 낸다', () => {
    expect(activeHacks({
      burstCharge: true, infiniteAmmo: false, alwaysCrit: true, damageMult: 2,
    })).toEqual(['버충무한핵', '올크리핵', '대미지증가핵 ×2']);
  });

  it('배수는 정수면 정수로 적는다', () => {
    expect(formatMult(2)).toBe('2');
    expect(formatMult(2.5)).toBe('2.5');
    expect(formatMult(1.234)).toBe('1.23');
  });
});

describe('핵 값 되돌리기', () => {
  it('없거나 깨진 저장본은 다 꺼진 상태로 읽는다', () => {
    for (const bad of [undefined, null, 'ㅋㅋ', 42]) {
      expect(normalizeHacks(bad)).toEqual(NO_HACKS);
    }
  });

  it('말이 안 되는 배수는 1로 돌린다', () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 'x']) {
      expect(normalizeHacks({ damageMult: bad }).damageMult).toBe(1);
    }
  });

  it('상한을 넘는 배수는 끄지 않고 자른다', () => {
    // 켠 사람 몰래 꺼져 있는 것보다 «상한까지만 걸린 것»이 덜 놀랍다.
    expect(normalizeHacks({ damageMult: 10_000 }).damageMult).toBe(HACK_DMG_MULT_MAX);
  });
});

describe('요청에 싣기', () => {
  it('하나도 안 켜면 요청에서 통째로 빠진다', () => {
    expect(hacksForRequest(NO_HACKS)).toBeUndefined();
    expect(hacksForRequest(undefined)).toBeUndefined();
  });

  it('켜면 정규화한 값이 실린다', () => {
    expect(hacksForRequest({ ...NO_HACKS, alwaysCrit: true, damageMult: 0 }))
      .toEqual({ ...NO_HACKS, alwaysCrit: true, damageMult: 1 });
  });
});
