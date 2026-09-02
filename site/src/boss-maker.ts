/**
 * 「보스 메이커」 — 보스를 그려 놓고 그 위에서 전투를 읽는다.
 *
 * 계산기는 지금까지 적을 **숫자 몇 개**로만 다뤘다(방어력·코어 직경·파츠 유무).
 * 그런데 실제로 사람이 궁금해하는 것은 «내 탄착군이 이 코어를 덮는가», «이 폭발이
 * 파츠 둘을 같이 때리는가»처럼 **자리에 관한 것**이다. 이 화면은 그 자리를 그리게 하고,
 * 그린 것에서 엔진이 아는 숫자를 뽑아 낸다.
 *
 * ## 좌표는 인게임 px와 같은 자로 잰다
 *
 * 계산기에는 이미 px가 하나 있다 — 코어 직경(`corePx`, 기본 52)과 무기군별 탄착군
 * 직경(AR 76 · SMG 110 · SG 240 …)이다. 코어 명중 확률이 그 둘의 비로 정해지므로,
 * 캔버스도 **같은 px 공간**을 쓴다. 그래야 화면에 그린 원이 곧 계산에 쓰이는 값이 된다.
 *
 * ## 엔진에 넘기는 것과 넘기지 않는 것
 *
 * 넘기는 것은 엔진이 이미 아는 스칼라뿐이다 — 코어 직경, 파츠 유무, 파츠 파괴 주기,
 * 그리고 원래 있던 전투 조건. **좌표 자체는 넘기지 않는다.** 엔진에는 적 체력도 좌표도
 * 없어서(파츠는 불리언 하나다) 좌표를 먹이려면 계산 모델을 통째로 새로 짜야 하고,
 * 그러면 지금까지의 모든 수치가 흔들린다. 그림은 «어떤 숫자를 넣을지 정하는 자리»다.
 *
 * ## 조준
 *
 * 니케마다 조준점을 하나씩 갖는다. 기본은 **코어**이고, 코어가 없으면 **보스 중앙**이다.
 * 중앙은 코어처럼 따로 찍어 두는 점이며, 안 찍었으면 화면이 찍으라고 말한다.
 *
 * 인게임에서는 풀버스트 때만 유저가 겨냥한 곳에 몰아 쏘고 그 밖에는 자동 사격이 흩어
 * 맞지만, **그 배분을 정하는 공식을 알 수 없다.** 그래서 여기서는 전 구간을 «겨냥한
 * 곳에 집중»으로 본다 — 실제보다 코어 적중이 후하게 잡히는 쪽이며, 화면에 그렇게 적는다.
 */

import type { ElementCode } from './types';

export type ShapeKind = 'circle' | 'rect' | 'triangle';

/** 캔버스에 놓인 것 하나. 자리는 중심 좌표, 크기는 폭·높이(px)다. */
export interface BossShape {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 도(°). 0이면 세우지 않은 그대로 */
  rotation: number;
  color: string;
  /** 이 도형이 보이는 구간(초). 비면 처음부터 끝까지 — 「모양이 바뀌는 보스」가 이걸로 산다. */
  from?: number;
  to?: number;
}

/** 파츠 하나. 도형에 **체력**과 이름이 붙은 것이다. */
export interface BossPart extends BossShape {
  name: string;
  /** 파츠 체력. 0이면 «안 깨지는 파츠»로 본다 */
  hp: number;
}

export interface BossCore {
  x: number;
  y: number;
  /** 지름(px). 그대로 `corePx`가 된다 */
  d: number;
}

/** 조준의 기준점. 코어가 없을 때 여기를 겨냥한다. */
export interface BossCenter {
  x: number;
  y: number;
}

/** 밑그림. 데이터 URL로 담아 두므로 저장본만 있으면 그림도 함께 산다. */
export interface BossImage {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0~1. 밑그림은 대개 흐리게 깔고 그 위에 도형을 얹는다 */
  opacity: number;
}

export interface BossDesign {
  version: 1;
  name: string;
  canvas: { w: number; h: number };
  image: BossImage | null;
  shapes: BossShape[];
  parts: BossPart[];
  core: BossCore | null;
  center: BossCenter | null;
  /** 니케별 폭발 반경(px). 참고용 — 엔진은 폭발 범위를 계산하지 않는다 */
  explosion: Record<string, number>;
}

export const DEFAULT_CANVAS = { w: 960, h: 620 };
/** 인게임 기준 코어 직경. 전투 조건의 기본값과 같은 값이다. */
export const DEFAULT_CORE_PX = 52;

export function emptyDesign(name = '새 보스'): BossDesign {
  return {
    version: 1,
    name,
    canvas: { ...DEFAULT_CANVAS },
    image: null,
    shapes: [],
    parts: [],
    core: null,
    center: null,
    explosion: {},
  };
}

/** 새 id. 시간과 난수를 섞어 같은 초에 여럿을 만들어도 겹치지 않게 한다. */
export const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ── 자리 계산 ───────────────────────────────────────────────────────────────

/** 두 점 사이 거리(px). 파츠끼리 얼마나 떨어졌는지 재는 데 쓴다. */
export const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 도형의 «반지름». 원은 그대로, 네모·삼각형은 외접원으로 어림한다. */
export const outerRadius = (shape: { kind: ShapeKind; w: number; h: number }): number =>
  (shape.kind === 'circle' ? Math.max(shape.w, shape.h) / 2 : Math.hypot(shape.w, shape.h) / 2);

/** 이 점이 도형 안에 있는가. 고르기·끌기 판정에 쓴다. */
export function hitTest(shape: BossShape, x: number, y: number): boolean {
  const dx = x - shape.x;
  const dy = y - shape.y;
  // 세워 둔 도형은 점을 반대로 돌려 놓고 판정한다 — 도형을 돌리는 것보다 싸다.
  const rad = (-(shape.rotation || 0) * Math.PI) / 180;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  const halfW = shape.w / 2;
  const halfH = shape.h / 2;
  if (shape.kind === 'circle') return (lx / halfW) ** 2 + (ly / halfH) ** 2 <= 1;
  if (shape.kind === 'rect') return Math.abs(lx) <= halfW && Math.abs(ly) <= halfH;
  // 삼각형 — 위 꼭짓점 하나, 아래 변 하나. 높이에 따라 좁아지는 폭 안인지 본다.
  const t = (ly + halfH) / shape.h;         // 0(위 꼭짓점) → 1(아래 변)
  return t >= 0 && t <= 1 && Math.abs(lx) <= halfW * t;
}

/** 폭발 원이 덮는 파츠들. 원과 파츠의 외접원이 겹치면 «덮는다»로 본다. */
export function partsInBlast(
  parts: BossPart[],
  at: { x: number; y: number },
  radius: number,
): BossPart[] {
  if (!(radius > 0)) return [];
  return parts.filter((part) => distance(part, at) <= radius + outerRadius(part));
}

// ── 조준과 탄착군 ───────────────────────────────────────────────────────────

/** 겨냥하는 자리. 코어가 먼저고, 없으면 보스 중앙이다. 둘 다 없으면 정할 수 없다. */
export function aimPoint(design: BossDesign): { x: number; y: number; on: 'core' | 'center' } | null {
  if (design.core) return { x: design.core.x, y: design.core.y, on: 'core' };
  if (design.center) return { x: design.center.x, y: design.center.y, on: 'center' };
  return null;
}

export interface AccuracyTable {
  modelN: number;
  weapons: Record<string, { baseDiameter: number; accSlope: number }>;
}

/**
 * 탄착군 반지름(px). 지름 D = 기본 − 기울기 × 명중%이고 그 절반이다.
 *
 * 계산기 본체(`calculator/timeline.py _core_hit_prob`)와 같은 식이다 — 표를 설정에서
 * 그대로 받아 오므로 한쪽만 바뀌어 어긋나는 일이 없다.
 */
export function spreadRadius(
  table: AccuracyTable | undefined,
  weapon: string,
  accuracyPct = 0,
): number {
  const spec = table?.weapons?.[weapon];
  const base = spec?.baseDiameter ?? 10;
  const slope = spec?.accSlope ?? 0;
  return Math.max(base - slope * accuracyPct, 1) / 2;
}

/** 코어 명중 확률. P = min(1, (코어반경 / 탄착군반경)^n). */
export function coreHitChance(
  table: AccuracyTable | undefined,
  weapon: string,
  corePx: number,
  accuracyPct = 0,
): number {
  if (!(corePx > 0)) return 0;
  const radius = spreadRadius(table, weapon, accuracyPct);
  return Math.min(1, ((corePx / 2) / radius) ** (table?.modelN ?? 2.55));
}

// ── 그림 → 엔진이 아는 숫자 ─────────────────────────────────────────────────

/** 파츠 하나가 깨지는 시각(초). 체력 ÷ 초당 대미지. */
export const breakTime = (hp: number, dps: number): number | null =>
  (hp > 0 && dps > 0 ? hp / dps : null);

export interface PartBreak {
  id: string;
  name: string;
  /** 깨지는 시각(초). 전투가 끝나도록 안 깨지면 `null` */
  at: number | null;
}

/**
 * 파츠마다 깨지는 시각. 빠른 순서로 세운다.
 *
 * DPS는 «스쿼드 전체가 이 파츠만 때린다»는 가정이라 실제보다 이르다 — 화면에 그렇게
 * 적고, 값이 마음에 안 들면 주기를 손으로 덮을 수 있게 둔다.
 */
export function partBreaks(parts: BossPart[], dps: number, duration: number): PartBreak[] {
  return parts
    .map((part) => {
      const at = breakTime(part.hp, dps);
      return {
        id: part.id,
        name: part.name,
        at: at !== null && at <= duration ? at : null,
      };
    })
    .sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
}

/**
 * 엔진에 넘길 파츠 파괴 주기(초).
 *
 * 엔진은 «N초마다 한 번»만 다룬다(`part_break_interval`). 파츠가 여럿이면 **가장 먼저
 * 깨지는 시각**을 주기로 삼는다 — 첫 파괴 시점이 맞아야 파괴에 반응하는 스킬
 * (레이븐 「일점 공격」 등)이 제때 걸리기 때문이다.
 */
export function derivedPartBreakInterval(
  parts: BossPart[],
  dps: number,
  duration: number,
): number {
  const first = partBreaks(parts, dps, duration).find((entry) => entry.at !== null);
  return first?.at ?? 0;
}

/** 그림에서 뽑아 낸, 엔진이 아는 값들. */
export interface DerivedEnemy {
  corePx: number;
  hasParts: boolean;
  partBreakInterval: number;
}

export function derivedEnemy(design: BossDesign, dps: number, duration: number): DerivedEnemy {
  return {
    corePx: design.core ? Math.round(design.core.d) : 0,
    hasParts: design.parts.length > 0,
    partBreakInterval: derivedPartBreakInterval(design.parts, dps, duration),
  };
}

// ── 시간에 따른 보스 상태 ───────────────────────────────────────────────────

export interface BossPhaseView {
  /** 족자 — 그 구간 동안 평타가 빗나간다. 화면에서는 보스가 사라진다 */
  immune: boolean;
  /** 속저 — 그 구간 동안 그 코드에 우월한 니케만 통한다. 방어막을 씌운다 */
  shield: ElementCode | null;
}

/** 몇 초일 때 보스가 어떤 상태인가. 구간은 `[시작, 끝)` 반개구간이다(엔진과 같다). */
export function phaseAt(
  t: number,
  immuneWindows: Array<{ from: number; to: number }>,
  elementWindows: Array<{ from: number; to: number; code: ElementCode }>,
): BossPhaseView {
  const immune = immuneWindows.some((w) => t >= w.from && t < w.to);
  const shield = elementWindows.find((w) => t >= w.from && t < w.to)?.code ?? null;
  return { immune, shield };
}

/** 그 시각에 보이는 도형·파츠만. 구간을 안 적은 것은 늘 보인다. */
export const visibleAt = <T extends { from?: number; to?: number }>(items: T[], t: number): T[] =>
  items.filter((item) => t >= (item.from ?? 0) && t < (item.to ?? Infinity));

/** 속성별 방어막 색. 계산기의 코드 색과 같은 계열로 둔다. */
export const ELEMENT_COLOR: Record<string, string> = {
  풍압: '#7fe08a',
  수냉: '#6fc7ff',
  작열: '#ff8f6b',
  전격: '#c79bff',
  철갑: '#ffd166',
};

// ── 저장 ────────────────────────────────────────────────────────────────────

/** 저장본을 읽어 온다. 모양이 어긋나면 새 판을 준다 — 옛 저장본에 화면이 끌려가지 않게. */
export function parseDesign(raw: string | null): BossDesign | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<BossDesign>;
    if (!value || value.version !== 1 || !Array.isArray(value.shapes)) return null;
    const base = emptyDesign(typeof value.name === 'string' ? value.name : '새 보스');
    return {
      ...base,
      ...value,
      version: 1,
      canvas: value.canvas ?? base.canvas,
      shapes: value.shapes ?? [],
      parts: Array.isArray(value.parts) ? value.parts : [],
      explosion: value.explosion ?? {},
      core: value.core ?? null,
      center: value.center ?? null,
      image: value.image ?? null,
    };
  } catch {
    return null;
  }
}
