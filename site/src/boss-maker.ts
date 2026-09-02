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

import { fromBase64Url, nameHash, toBase64Url } from './share-code';
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
  /** 저장본을 가르는 열쇠. 이름은 겹쳐도 되지만 이것은 겹치지 않는다 */
  id: string;
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
    id: newId('boss'),
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

// ── 탄착점 ──────────────────────────────────────────────────────────────────

/** 글자 → 32비트 씨앗. 같은 글자면 언제나 같은 수다(조합 코드의 해시와 같은 방식). */
const seedOf = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

/** mulberry32 — 씨앗 하나로 늘 같은 수열을 낸다. 탄착점이 프레임마다 떨지 않게 한다. */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * 탄이 박히는 자리들. 조준점을 0으로 둔 상대 좌표(px)다.
 *
 * **엔진이 코어 명중률을 내는 그 분포를 그대로 쓴다.** 계산기는
 * `P(코어 명중) = (코어반경 / 탄착군반경)^n`으로 본다 — 이는 «탄이 반경 r 안에 박힐
 * 확률이 `(r/R)^n`»이라는 말과 같다. 그래서 `r = R · u^(1/n)`로 뽑으면(u는 0~1 균등)
 * 찍힌 점이 코어 안에 드는 비율이 엔진이 쓰는 확률과 **정확히 맞는다**. 눈으로 세어도
 * 계산과 어긋나지 않는다는 뜻이다.
 *
 * n이 2보다 크므로 점은 넓이 기준으로 봐도 가운데에 몰린다 — 작은 코어가 생각보다
 * 자주 맞는 이유가 이 쏠림이다.
 *
 * 씨앗은 «누가·언제»로 짓는다. 같은 사격은 다시 그려도 같은 자리에 박혀야 한다 —
 * 프레임마다 새로 뽑으면 재생할 때 점들이 부글거린다.
 */
export function impactOffsets(
  seed: string,
  count: number,
  radius: number,
  modelN = 2.55,
): Array<{ x: number; y: number }> {
  if (!(count > 0) || !(radius > 0)) return [];
  const random = randomFrom(seedOf(seed));
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const u = random();
    const angle = random() * Math.PI * 2;
    const r = radius * u ** (1 / (modelN || 2.55));
    out.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  }
  return out;
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
    return reviveDesign(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 이미 풀어 놓은 값 하나를 저장본으로. 빠진 칸은 빈 판의 값으로 채운다. */
function reviveDesign(value: unknown): BossDesign | null {
  const saved = value as Partial<BossDesign> | null;
  if (!saved || saved.version !== 1 || !Array.isArray(saved.shapes)) return null;
  const base = emptyDesign(typeof saved.name === 'string' ? saved.name : '새 보스');
  return {
    ...base,
    ...saved,
    version: 1,
    // 옛 저장본에는 id가 없다 — 그때는 새로 붙인다.
    id: typeof saved.id === 'string' && saved.id ? saved.id : base.id,
    canvas: saved.canvas ?? base.canvas,
    shapes: saved.shapes ?? [],
    parts: Array.isArray(saved.parts) ? saved.parts : [],
    explosion: saved.explosion ?? {},
    core: saved.core ?? null,
    center: saved.center ?? null,
    image: saved.image ?? null,
  };
}

// ── 저장본 여러 벌 ──────────────────────────────────────────────────────────
// 보스는 하나만 만들지 않는다 — 레이드 보스마다, 페이즈마다 다른 판을 두고 오간다.

export interface BossLibrary {
  designs: BossDesign[];
  /** 지금 보고 있는 저장본. 목록이 비면 빈 문자열이다 */
  activeId: string;
}

export const emptyLibrary = (): BossLibrary => {
  const first = emptyDesign();
  return { designs: [first], activeId: first.id };
};

/**
 * 저장함을 읽는다. **옛 단일 저장본도 받아 준다** — 보스 하나만 두던 시절에 그려 둔
 * 것이 사라지면 안 되므로, 그 모양이면 한 벌짜리 저장함으로 감싼다.
 */
export function parseLibrary(raw: string | null): BossLibrary | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { designs?: unknown[]; activeId?: unknown } | null;
    if (!value) return null;
    if (!Array.isArray(value.designs)) {
      const single = reviveDesign(value);
      return single ? { designs: [single], activeId: single.id } : null;
    }
    const designs = value.designs
      .map(reviveDesign)
      .filter((design): design is BossDesign => design !== null);
    if (designs.length === 0) return null;
    const activeId = typeof value.activeId === 'string'
      && designs.some((design) => design.id === value.activeId)
      ? value.activeId : designs[0]!.id;
    return { designs, activeId };
  } catch {
    return null;
  }
}

/** 고른 저장본. 목록이 비었을 리는 없지만, 비면 빈 판을 준다. */
export const activeDesign = (library: BossLibrary): BossDesign =>
  library.designs.find((design) => design.id === library.activeId)
  ?? library.designs[0] ?? emptyDesign();

/** 저장본 하나를 덮어쓴다. 없으면 뒤에 붙인다. */
export function putDesign(library: BossLibrary, design: BossDesign): BossLibrary {
  const at = library.designs.findIndex((entry) => entry.id === design.id);
  const designs = at < 0
    ? [...library.designs, design]
    : library.designs.map((entry, index) => (index === at ? design : entry));
  return { designs, activeId: design.id };
}

/** 저장본을 지운다. **마지막 하나는 지우지 않고 비운다** — 빈 저장함은 다룰 데가 없다. */
export function dropDesign(library: BossLibrary, id: string): BossLibrary {
  const designs = library.designs.filter((design) => design.id !== id);
  if (designs.length === 0) return emptyLibrary();
  const activeId = designs.some((design) => design.id === library.activeId)
    ? library.activeId : designs[0]!.id;
  return { designs, activeId };
}

/** 저장본을 통째로 베낀다. 이름 뒤에 «사본»을 붙이고 그것을 편다. */
export function copyDesign(library: BossLibrary, id: string): BossLibrary {
  const source = library.designs.find((design) => design.id === id);
  if (!source) return library;
  const copy: BossDesign = {
    ...structuredClone(source),
    id: newId('boss'),
    name: `${source.name} 사본`.slice(0, 24),
  };
  return { designs: [...library.designs, copy], activeId: copy.id };
}

// ── 공유 코드 ───────────────────────────────────────────────────────────────

/** 보스 코드 접두사. 조합(NK2)·전투 조건(NK3)·유니온 판(NK4) 다음 자리다. */
export const BOSS_PREFIX = 'NK5-';

const KINDS: ShapeKind[] = ['circle', 'rect', 'triangle'];
/** 코드가 감당하는 최대치. 남이 만든 코드가 화면을 못 세우게 하면 안 된다. */
const CODE_LIMITS = { shapes: 60, parts: 24, name: 24, partName: 16 };

const int = (value: number): number => Math.round(value);
const tenth = (value: number): number => Math.round(value * 10);

/** 도형 하나를 코드에 실을 짧은 모양으로. 기본값인 칸은 아예 빼서 코드를 줄인다. */
function packShape(shape: BossShape): Record<string, unknown> {
  const out: Record<string, unknown> = {
    k: Math.max(0, KINDS.indexOf(shape.kind)),
    x: int(shape.x), y: int(shape.y), w: int(shape.w), h: int(shape.h),
  };
  if (shape.rotation) out.r = int(shape.rotation);
  if (shape.from) out.f = tenth(shape.from);
  if (shape.to) out.t = tenth(shape.to);
  return out;
}

function unpackShape(raw: unknown, color: string): BossShape | null {
  const item = raw as Record<string, unknown> | null;
  if (!item || typeof item !== 'object') return null;
  // 크기는 **양수라야 말이 된다** — 0이나 음수로 온 도형은 고쳐 주지 않고 버린다.
  // (좌표는 화면 밖이어도 끌어오면 되지만, 크기가 없는 도형은 아무것도 아니다.)
  const size = (value: unknown) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(2000, Math.max(4, Math.round(n)));
  };
  const w = size(item.w);
  const h = size(item.h);
  if (!w || !h) return null;
  const coord = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(4000, Math.max(-2000, Math.round(n))) : 0;
  };
  const seconds = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.min(6000, Math.round(n)) / 10 : undefined;
  };
  const shape: BossShape = {
    id: newId('shape'),
    kind: KINDS[Number(item.k)] ?? 'circle',
    x: coord(item.x), y: coord(item.y), w, h,
    rotation: Number.isFinite(Number(item.r))
      ? Math.min(180, Math.max(-180, Math.round(Number(item.r)))) : 0,
    color,
  };
  const from = seconds(item.f);
  const to = seconds(item.t);
  if (from !== undefined) shape.from = from;
  if (to !== undefined) shape.to = to;
  return shape;
}

/**
 * 보스 한 벌을 코드 한 줄로.
 *
 * **밑그림은 담지 않는다.** 데이터 URL이라 그림 하나로 코드가 수십 KB가 되어 붙여넣는
 * 자리에서 잘린다 — 받는 쪽은 도형·파츠·코어만 받고 밑그림은 각자 깐다.
 *
 * 폭발 반경은 니케 이름 대신 **이름 해시**로 싣는다(조합 코드와 같은 방식) — 한글
 * 이름을 그대로 실으면 한 글자가 3바이트라 코드가 금세 길어진다.
 */
export function encodeBossCode(design: BossDesign): string {
  const out: Record<string, unknown> = { n: design.name.slice(0, CODE_LIMITS.name) };
  if (design.canvas.w !== DEFAULT_CANVAS.w || design.canvas.h !== DEFAULT_CANVAS.h) {
    out.c = [int(design.canvas.w), int(design.canvas.h)];
  }
  if (design.shapes.length > 0) {
    out.s = design.shapes.slice(0, CODE_LIMITS.shapes).map(packShape);
  }
  if (design.parts.length > 0) {
    out.p = design.parts.slice(0, CODE_LIMITS.parts).map((part) => ({
      ...packShape(part),
      n: part.name.slice(0, CODE_LIMITS.partName),
      hp: Math.max(0, int(part.hp)),
    }));
  }
  if (design.core) out.k = [int(design.core.x), int(design.core.y), int(design.core.d)];
  if (design.center) out.m = [int(design.center.x), int(design.center.y)];
  const blast: Record<string, number> = {};
  for (const [name, radius] of Object.entries(design.explosion)) {
    if (radius > 0) blast[nameHash(name).toString(36)] = int(radius);
  }
  if (Object.keys(blast).length > 0) out.e = blast;
  return BOSS_PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(out)));
}

/**
 * 보스 코드를 읽는다. 없는 칸은 빈 값으로 두고, 범위를 벗어난 값은 잘라 낸다 —
 * 남이 만든 코드가 화면을 깨뜨리면 안 된다.
 *
 * `catalogNames`를 주면 폭발 반경의 이름 해시를 실제 이름으로 되돌린다. 안 주면
 * 그 칸만 비운 채 나머지를 살린다.
 */
export function decodeBossCode(code: string, catalogNames: string[] = []): BossDesign {
  const trimmed = code.trim();
  if (!trimmed) throw new Error('보스 코드를 입력해 주세요.');
  if (!trimmed.startsWith(BOSS_PREFIX)) {
    throw new Error('보스 코드는 «NK5-»로 시작합니다.');
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(new TextDecoder().decode(fromBase64Url(trimmed.slice(BOSS_PREFIX.length))));
  } catch {
    throw new Error('보스 코드를 읽지 못했습니다. 중간이 잘리지 않았는지 확인해 주세요.');
  }
  if (!raw || typeof raw !== 'object') throw new Error('보스 코드를 읽지 못했습니다.');

  const design = emptyDesign(
    typeof raw.n === 'string' && raw.n.trim() ? raw.n.trim().slice(0, CODE_LIMITS.name) : '받은 보스',
  );
  const numbers = (value: unknown, count: number): number[] | null => {
    if (!Array.isArray(value) || value.length !== count) return null;
    const out = value.map((entry) => Number(entry));
    return out.every((entry) => Number.isFinite(entry)) ? out : null;
  };

  const canvas = numbers(raw.c, 2);
  if (canvas) {
    const [w, h] = canvas as [number, number];
    if (w >= 200 && h >= 200 && w <= 4000 && h <= 4000) {
      design.canvas = { w: Math.round(w), h: Math.round(h) };
    }
  }
  if (Array.isArray(raw.s)) {
    for (const item of raw.s.slice(0, CODE_LIMITS.shapes)) {
      const shape = unpackShape(item, 'rgba(120,150,190,.35)');
      if (shape) design.shapes.push(shape);
    }
  }
  if (Array.isArray(raw.p)) {
    for (const item of raw.p.slice(0, CODE_LIMITS.parts)) {
      const shape = unpackShape(item, '#ffb347');
      if (!shape) continue;
      const entry = item as Record<string, unknown>;
      const hp = Number(entry.hp);
      design.parts.push({
        ...shape,
        id: newId('part'),
        name: typeof entry.n === 'string' && entry.n.trim()
          ? entry.n.trim().slice(0, CODE_LIMITS.partName) : `파츠 ${design.parts.length + 1}`,
        hp: Number.isFinite(hp) && hp > 0 ? Math.min(1e12, Math.round(hp)) : 0,
      });
    }
  }
  const core = numbers(raw.k, 3);
  if (core) {
    const [x, y, d] = core as [number, number, number];
    if (d >= 4 && d <= 400) design.core = { x: Math.round(x), y: Math.round(y), d: Math.round(d) };
  }
  const center = numbers(raw.m, 2);
  if (center) {
    const [x, y] = center as [number, number];
    design.center = { x: Math.round(x), y: Math.round(y) };
  }
  if (raw.e && typeof raw.e === 'object' && catalogNames.length > 0) {
    const byHash = new Map(catalogNames.map((name) => [nameHash(name).toString(36), name]));
    for (const [key, value] of Object.entries(raw.e as Record<string, unknown>)) {
      const name = byHash.get(key);
      const radius = Number(value);
      if (name && Number.isFinite(radius) && radius > 0) {
        design.explosion[name] = Math.min(600, Math.round(radius));
      }
    }
  }
  return design;
}
