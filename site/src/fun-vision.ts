/**
 * 「니케 시각화」 — 불러온 프로필을 초상화 크기로 본다.
 *
 * 표로 보면 숫자 199줄이지만, 크기로 보면 «내가 어디에 부어 놨는지»가 한눈에 들어온다.
 * 재미로 보는 화면이라 계산에는 관여하지 않는다.
 *
 * **계산기에 세팅한 값이 아니라 불러온 프로필을 쓴다.** 덱마다 만져 둔 값은 «이 조합에서
 * 이랬으면»이라는 가정이고, 여기서 보고 싶은 것은 내 계정의 실제 육성 상태다.
 */

import type { CharacterOverrides } from './types';

/** 무엇을 기준으로 크기를 매길지. */
export type VisionMetric = 'element' | 'element_atk';

export const VISION_METRICS: Array<{ key: VisionMetric; label: string; hint: string }> = [
  { key: 'element', label: '우월 코드', hint: '오버로드 「우월 코드 대미지」 합계' },
  {
    key: 'element_atk',
    label: '우월 코드 + 공격력',
    hint: '「우월 코드 대미지」와 「공격력」 합계를 더한 값',
  },
];

/** 한 니케의 자리 — 이름과 크기의 근거가 되는 값. */
export interface VisionRow {
  name: string;
  value: number;
  /** 가장 큰 값을 1로 둔 비율. 초상화 크기가 이 값을 따른다. */
  share: number;
}

/** 그 기준으로 이 니케가 갖는 값. 없는 옵션은 0으로 친다. */
export function metricValue(over: CharacterOverrides | undefined, metric: VisionMetric): number {
  const overload = over?.overload ?? {};
  const element = Number(overload.element_bonus ?? 0);
  if (metric === 'element') return element;
  return element + Number(overload.atk_pct ?? 0);
}

/**
 * 불러온 프로필 → 큰 순서로 세운 목록.
 *
 * 값이 0인 니케는 뺀다 — 안 키운 니케까지 세우면 화면이 «가진 것 전부»가 되어
 * 정작 보고 싶은 «어디에 부었나»가 묻힌다.
 *
 * 크기는 **넓이가 아니라 한 변**에 비례시킨다. 값이 두 배인 니케를 넓이로 두 배 키우면
 * 한 변은 1.41배뿐이라 차이가 작아 보이고, 값 차이가 큰 계정에서는 작은 쪽이 점이 된다.
 */
export function visionRows(
  roster: Record<string, CharacterOverrides>,
  metric: VisionMetric,
  known: (name: string) => boolean,
): VisionRow[] {
  const rows = Object.entries(roster)
    .filter(([name]) => known(name))
    .map(([name, over]) => ({ name, value: metricValue(over, metric) }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'ko'));

  const top = rows[0]?.value ?? 0;
  return rows.map((row) => ({ ...row, share: top > 0 ? row.value / top : 0 }));
}

/** 한 변의 픽셀 크기. 가장 작은 것도 얼굴은 보여야 하므로 바닥을 둔다. */
export const visionSize = (share: number, min = 44, max = 132): number =>
  Math.round(min + (max - min) * Math.max(0, Math.min(1, share)));

/** 화면 위쪽에 적는 한 줄. 몇 명이 얼마나 되는지. */
export function visionSummary(rows: VisionRow[], metric: VisionMetric): string {
  if (rows.length === 0) return '';
  const label = VISION_METRICS.find((entry) => entry.key === metric)?.label ?? '';
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  // 꼬리 0은 턴다. 「.0+$」로 한 번에 자르면 정수부의 0까지 먹으므로(1200 → 12)
  // 소수부만 집어 자른다.
  const digits = (value: number) =>
    value.toFixed(2).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return `${rows.length}명 · ${label} 합계 ${digits(total)}% · 1등 ${rows[0]!.name} ${digits(rows[0]!.value)}%`;
}
