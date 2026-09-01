/**
 * 「오버옵 시각화」 — 불러온 프로필의 오버로드 옵션을 초상화 크기로 본다.
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

/** 배치가 끝난 동그라미 하나. 좌표는 왼쪽 위를 0으로 옮긴 뒤의 값이다. */
export interface PackedCircle extends VisionRow {
  x: number;
  y: number;
  r: number;
}

/** 두 동그라미가 겹치는가. 맞닿는 것은 겹침이 아니다(부동소수 여유를 둔다). */
const overlaps = (a: PackedCircle, b: { x: number; y: number; r: number }): boolean =>
  Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - 1e-6;

/**
 * 큰 것부터 가운데에 놓고 나머지를 그 둘레에 붙여 나간다(원형 팩).
 *
 * 자리를 아무 데나 찾지 않고 **이미 놓인 두 동그라미에 동시에 맞닿는 자리**만 후보로
 * 둔다 — 그래야 틈 없이 붙고, 후보가 유한해서 결과가 매번 같다. 후보 중에서는 가운데에
 * 가장 가까운 것을 고른다. 첫 둘은 맞닿을 짝이 없으므로 가운데와 그 옆에 둔다.
 *
 * 격자와 달리 크기 차이가 자리 배치로도 드러난다 — 큰 것이 가운데, 작은 것이 바깥이다.
 */
export function packCircles(rows: VisionRow[], minR = 20, maxR = 64): PackedCircle[] {
  const placed: PackedCircle[] = [];
  const radiusOf = (share: number) => visionSize(share, minR * 2, maxR * 2) / 2;

  for (const row of rows) {
    const r = radiusOf(row.share);
    if (placed.length === 0) { placed.push({ ...row, x: 0, y: 0, r }); continue; }
    if (placed.length === 1) {
      placed.push({ ...row, x: placed[0]!.r + r, y: 0, r });
      continue;
    }

    let best: PackedCircle | null = null;
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        for (const spot of tangentSpots(placed[i]!, placed[j]!, r)) {
          const candidate: PackedCircle = { ...row, ...spot, r };
          if (placed.some((other) => overlaps(other, candidate))) continue;
          const reach = Math.hypot(candidate.x, candidate.y);
          if (!best || reach < Math.hypot(best.x, best.y) - 1e-9) best = candidate;
        }
      }
    }
    // 맞닿는 자리가 하나도 없으면(드물다) 가운데에서 가장 먼 것 옆에 붙인다.
    if (!best) {
      const far = placed.reduce((a, b) => (Math.hypot(a.x, a.y) >= Math.hypot(b.x, b.y) ? a : b));
      const angle = Math.atan2(far.y, far.x) || 0;
      best = { ...row, r, x: far.x + Math.cos(angle) * (far.r + r), y: far.y + Math.sin(angle) * (far.r + r) };
    }
    placed.push(best);
  }

  // 왼쪽 위를 0으로 옮긴다 — 그리는 쪽이 음수 좌표를 다루지 않게.
  const left = Math.min(...placed.map((c) => c.x - c.r), 0);
  const top = Math.min(...placed.map((c) => c.y - c.r), 0);
  return placed.map((c) => ({ ...c, x: c.x - left, y: c.y - top }));
}

/** 두 동그라미에 동시에 맞닿는 자리(둘, 없으면 빈 목록). 두 원의 교점을 푼 것이다. */
function tangentSpots(
  a: { x: number; y: number; r: number },
  b: { x: number; y: number; r: number },
  r: number,
): Array<{ x: number; y: number }> {
  const ra = a.r + r;
  const rb = b.r + r;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9 || d > ra + rb || d < Math.abs(ra - rb)) return [];
  const mid = (d * d + ra * ra - rb * rb) / (2 * d);
  const height2 = ra * ra - mid * mid;
  if (height2 < 0) return [];
  const height = Math.sqrt(height2);
  const px = a.x + (dx * mid) / d;
  const py = a.y + (dy * mid) / d;
  return [
    { x: px + (dy * height) / d, y: py - (dx * height) / d },
    { x: px - (dy * height) / d, y: py + (dx * height) / d },
  ];
}

/** 배치를 감싸는 상자. SVG viewBox에 그대로 쓴다. */
export const packBounds = (circles: PackedCircle[]): { width: number; height: number } => ({
  width: Math.max(1, Math.ceil(Math.max(...circles.map((c) => c.x + c.r), 0))),
  height: Math.max(1, Math.ceil(Math.max(...circles.map((c) => c.y + c.r), 0))),
});

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
