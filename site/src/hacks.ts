/**
 * 핵 — 게임에 없는 값을 억지로 켜는 스위치.
 *
 * 이 계산기가 파는 것은 «인게임에서 이만큼 나온다»는 믿음뿐이라, 그것을 깨는 스위치는
 * 절대 조용히 켜져 있으면 안 된다. 그래서 이 파일은 «켜졌나»(`hacksOn`)와 «무엇이
 * 켜졌나»(`activeHacks`)를 화면이 쉽게 크게 떠들 수 있는 모양으로 낸다.
 *
 * 엔진 쪽 정본은 `calculator/cheats.py`이고, 브리지가 여기 이름을 그대로 받는다.
 * 하나도 안 켰으면 요청에 **아예 싣지 않는다**(`hacksForRequest`) — 그래야 켠 적 없는
 * 사람의 캐시 키가 갈리지 않고, 결과도 예전과 한 톨도 다르지 않다.
 */

export interface HackSettings {
  /** 버충무한핵 — 버스트 게이지 충전과 버스트 쿨타임이 0. */
  burstCharge: boolean;
  /** 무한장탄핵 — 탄창이 비지 않아 재장전이 사라진다. */
  infiniteAmmo: boolean;
  /** 올크리핵 — 크리티컬 확률 100%. */
  alwaysCrit: boolean;
  /** 대미지증가핵 — 최종 대미지에 곱하는 배수. 1이면 안 켠 것이다. */
  damageMult: number;
}

/** 대미지 배수 상한. 엔진(`calculator/cheats.py`)과 같은 값이어야 한다. */
export const HACK_DMG_MULT_MAX = 1000;

/** 아무것도 안 켠 상태. */
export const NO_HACKS: HackSettings = {
  burstCharge: false,
  infiniteAmmo: false,
  alwaysCrit: false,
  damageMult: 1,
};

/** 하나라도 켜져 있나. */
export const hacksOn = (hacks: HackSettings | undefined): boolean =>
  Boolean(hacks) && (hacks!.burstCharge || hacks!.infiniteAmmo || hacks!.alwaysCrit
    || hacks!.damageMult !== 1);

/** 켜진 핵의 이름들. 배너가 그대로 늘어놓는다. */
export function activeHacks(hacks: HackSettings | undefined): string[] {
  if (!hacks) return [];
  const on: string[] = [];
  if (hacks.burstCharge) on.push('버충무한핵');
  if (hacks.infiniteAmmo) on.push('무한장탄핵');
  if (hacks.alwaysCrit) on.push('올크리핵');
  if (hacks.damageMult !== 1) on.push(`대미지증가핵 ×${formatMult(hacks.damageMult)}`);
  return on;
}

/** 배수 표기. 정수는 정수로, 소수는 소수점 둘째 자리까지 — 「×2」와 「×2.50」을 가른다. */
export const formatMult = (mult: number): string =>
  Number.isInteger(mult) ? String(mult) : String(Number(mult.toFixed(2)));

/**
 * 저장본·입력값을 쓸 수 있는 모양으로 되돌린다. 범위를 벗어난 배수는 **끄지 않고
 * 자른다** — 켠 사람 몰래 꺼져 있는 것보다 낫다.
 */
export function normalizeHacks(raw: unknown): HackSettings {
  if (!raw || typeof raw !== 'object') return { ...NO_HACKS };
  const value = raw as Partial<Record<keyof HackSettings, unknown>>;
  const mult = Number(value.damageMult);
  return {
    burstCharge: Boolean(value.burstCharge),
    infiniteAmmo: Boolean(value.infiniteAmmo),
    alwaysCrit: Boolean(value.alwaysCrit),
    damageMult: Number.isFinite(mult) && mult > 0
      ? Math.min(mult, HACK_DMG_MULT_MAX)
      : 1,
  };
}

/** 요청에 실을 모양. 하나도 안 켰으면 `undefined` — 요청에서 통째로 빠진다. */
export const hacksForRequest = (hacks: HackSettings | undefined): HackSettings | undefined =>
  hacksOn(hacks) ? normalizeHacks(hacks) : undefined;
