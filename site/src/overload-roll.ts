/**
 * 「깡오버 랜덤」 — 오버로드 옵션 12줄을 그 자리에서 굴린다.
 *
 * 안 키운 서포터를 재 볼 때 오버로드를 열두 줄 손으로 넣는 것이 가장 지겨운 일이라는
 * 이야기가 올라왔다. 정확한 스펙이 필요한 게 아니라 «대충 이런 장비를 낀 사람»이
 * 필요한 자리라, 굴려서 채운다.
 *
 * **인게임 확률표가 아니다.** 옵션이 무엇으로 뜨는지는 우리가 모르므로 고른 옵션들
 * 안에서 고르게 굴리고, 레벨만 실제 감각에 맞춘 분포를 쓴다(1~5는 각 12%, 6~10은
 * 각 7%, 11~15는 각 1% — 합 100%). 화면도 그렇게 적어 둔다: 이 값으로 낸 딜은
 * «이 정도 장비면 이쯤»이지 누군가의 실제 스펙이 아니다.
 */

/** 레벨 분포. `[레벨, 확률]`이며 합이 1이다. */
export const LEVEL_WEIGHTS: Array<[number, number]> = [
  ...Array.from({ length: 5 }, (_, i) => [i + 1, 0.12] as [number, number]),
  ...Array.from({ length: 5 }, (_, i) => [i + 6, 0.07] as [number, number]),
  ...Array.from({ length: 5 }, (_, i) => [i + 11, 0.01] as [number, number]),
];

/** 한 줄. 화면의 `OverloadLine`과 같은 모양이다. */
export interface RolledLine {
  option: string;
  level: number;
}

/** 0 이상 1 미만을 내는 것. 시험에서 갈아 끼운다. */
export type Rng = () => number;

/** 분포대로 레벨 하나. */
export function rollLevel(rng: Rng = Math.random): number {
  let ticket = rng();
  for (const [level, weight] of LEVEL_WEIGHTS) {
    ticket -= weight;
    if (ticket < 0) return level;
  }
  // 부동소수점이 마지막 자리에서 남기는 티끌. 맨 끝을 준다.
  return LEVEL_WEIGHTS[LEVEL_WEIGHTS.length - 1]![0];
}

/**
 * 줄 `count`개를 굴린다. `options`가 비면 아무것도 안 굴린다 — 고를 것이 없는데
 * 빈 줄을 채우면 «옵션 없음 Lv7» 같은 뜻 없는 줄이 남는다.
 */
export function rollLines(options: string[], count: number, rng: Rng = Math.random): RolledLine[] {
  if (options.length === 0) return [];
  return Array.from({ length: Math.max(0, count) }, () => ({
    option: options[Math.min(options.length - 1, Math.floor(rng() * options.length))]!,
    level: rollLevel(rng),
  }));
}
