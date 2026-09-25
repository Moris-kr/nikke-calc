/**
 * 덱 실험실 — 편성 화면의 «최적큐브 찾기»와 «니케 경우의 수»가 쓰는 계산 순서.
 *
 * 화면(`deck-lab-ui.ts`)과 떼어 둔 이유는 둘 다 **판을 여러 번 돌리는 절차**이기 때문이다.
 * 한 판을 어떻게 돌리는지(`run`)는 부르는 쪽이 건네고, 여기서는 «무엇을 어떤 순서로
 * 돌려 무엇을 고르나»만 정한다 — 그래서 시험에서 가짜 `run`으로 순서를 그대로 확인할 수 있다.
 */
import type { CharacterOverrides, CubeSelection, DeckState } from './types';

/** 한 판의 결과 중 덱 실험실이 읽는 것. */
export interface LabRun {
  squadTotal: number;
  charTotals: Record<string, number>;
}

export type LabRunner = (deck: DeckState) => Promise<LabRun>;

const cloneDeck = (deck: DeckState): DeckState => structuredClone(deck);

/** 사람이 «그만»을 눌렀을 때 던진다. 실패와 갈라 적는다. */
export class LabStopped extends Error {
  constructor() {
    super('중지했습니다.');
    this.name = 'LabStopped';
  }
}

/**
 * 한꺼번에 `limit`판까지만 띄운다. 워커 풀은 받은 만큼 줄을 세우므로 전부 한 번에
 * 던져도 돌기는 하지만, 그러면 «중지»를 눌러도 이미 줄 선 판은 끝까지 돈다.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  stopped: () => boolean = () => false,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      if (stopped()) throw new LabStopped();
      const index = next;
      next += 1;
      out[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  if (stopped()) throw new LabStopped();
  return out;
}

// ── 최적큐브 찾기 ─────────────────────────────────────────────────────────

export interface CubeTrial {
  cube: CubeSelection;
  total: number | null;
  error?: string;
}

export interface CubeStep {
  slot: number;
  name: string;
  before?: CubeSelection;
  after?: CubeSelection;
  /** 이 자리를 고르기 직전의 덱 총딜(앞 자리에서 바꾼 큐브가 반영된 값). */
  baseTotal: number;
  /** 고른 큐브로의 덱 총딜. 바꾸지 않았으면 `baseTotal`과 같다. */
  bestTotal: number;
  changed: boolean;
  /** 딜 높은 순. */
  trials: CubeTrial[];
}

export interface CubeSearchResult {
  baseTotal: number;
  finalTotal: number;
  steps: CubeStep[];
  /** 고른 큐브를 모두 끼운 덱. */
  deck: DeckState;
}

export interface CubeSearchOptions {
  deck: DeckState;
  /** 끼워 볼 큐브 이름(카탈로그 순서). «없음»은 넣지 않는다. */
  cubes: string[];
  levelOf: (cube: string) => number;
  /** 개별 설정이 없는 니케의 지금 큐브(기본값). */
  defaultCube: (name: string) => CubeSelection | undefined;
  /** 개별 설정이 없는 니케에 큐브만 바꿔 끼울 때 바탕이 될 설정. */
  baseOverrides: (name: string) => CharacterOverrides;
  run: LabRunner;
  limit?: number;
  onProgress?: (done: number, total: number, slot: number, name: string) => void;
  stopped?: () => boolean;
}

export const sameCube = (a?: CubeSelection, b?: CubeSelection): boolean =>
  Boolean(a && b && a.name === b.name && a.level === b.level);

/** 덱에서 그 니케만 큐브를 바꾼 사본. */
export function withCube(
  deck: DeckState,
  name: string,
  cube: CubeSelection,
  baseOverrides: (name: string) => CharacterOverrides,
): DeckState {
  const next = cloneDeck(deck);
  const own = next.characters[name] ?? baseOverrides(name);
  next.characters[name] = { ...own, cube: { ...cube } };
  return next;
}

/**
 * 1번 자리부터 차례로, 그 니케에 큐브를 하나씩 끼워 덱 총딜을 재고 가장 높은 것을 남긴다.
 * 다른 니케의 큐브는 그대로 두고, 앞 자리에서 고른 큐브는 다음 자리를 잴 때 이미 끼워져 있다.
 * 지금 큐브보다 **높을 때만** 바꾼다 — 같으면(효과를 안 받는 큐브끼리) 그대로 둔다.
 */
export async function findBestCubes(options: CubeSearchOptions): Promise<CubeSearchResult> {
  const { cubes, levelOf, defaultCube, baseOverrides, run } = options;
  const stopped = options.stopped ?? (() => false);
  let deck = cloneDeck(options.deck);
  const members = deck.squad.map((name, slot) => ({ name, slot })).filter((entry) => entry.name);
  const total = members.length * cubes.length;
  let done = 0;

  const first = await run(deck);
  if (stopped()) throw new LabStopped();
  const baseTotal = first.squadTotal;
  let currentTotal = baseTotal;
  const steps: CubeStep[] = [];

  for (const { name, slot } of members) {
    const before = deck.characters[name]?.cube ?? defaultCube(name);
    const trials = await mapLimit(cubes, options.limit ?? 6, async (cubeName): Promise<CubeTrial> => {
      const cube = { name: cubeName, level: levelOf(cubeName) };
      try {
        // 지금 낀 것과 같으면 다시 돌리지 않는다 — 방금 잰 덱 총딜이 곧 그 값이다.
        const totalOf = sameCube(cube, before) ? currentTotal
          : (await run(withCube(deck, name, cube, baseOverrides))).squadTotal;
        return { cube, total: Number.isFinite(totalOf) ? totalOf : null };
      } catch (error) {
        if (error instanceof LabStopped) throw error;
        return { cube, total: null, error: error instanceof Error ? error.message : String(error) };
      } finally {
        done += 1;
        options.onProgress?.(done, total, slot, name);
      }
    }, stopped);
    trials.sort((a, b) => (b.total ?? -Infinity) - (a.total ?? -Infinity));
    const best = trials[0];
    // 부동소수 흔들림으로 바뀌지 않게 아주 작은 여유를 둔다.
    const better = best?.total != null && best.total > currentTotal + Math.max(1e-6, Math.abs(currentTotal) * 1e-9);
    const step: CubeStep = {
      slot, name, ...(before ? { before } : {}), baseTotal: currentTotal, bestTotal: currentTotal,
      changed: false, trials,
    };
    if (better) {
      deck = withCube(deck, name, best.cube, baseOverrides);
      step.after = best.cube;
      step.bestTotal = best.total!;
      step.changed = true;
      currentTotal = best.total!;
    } else if (before) step.after = before;
    steps.push(step);
  }
  return { baseTotal, finalTotal: currentTotal, steps, deck };
}

// ── 니케 경우의 수 ────────────────────────────────────────────────────────

/**
 * 자리마다 «지금 니케 + 바꿔 볼 니케들»을 곱한 편성 목록. 첫 줄은 언제나 지금 편성이다.
 * 한 편성 안에 같은 니케가 두 번 서는 조합은 뺀다(게임에서 설 수 없다).
 */
export function buildCases(squad: string[], alternatives: string[][]): string[][] {
  let cases: string[][] = [[]];
  squad.forEach((current, slot) => {
    const options = [current, ...(alternatives[slot] ?? []).filter((name) => name && name !== current)];
    const unique = [...new Set(options)];
    const next: string[][] = [];
    for (const partial of cases) {
      for (const name of unique) {
        if (name && partial.includes(name)) continue;
        next.push([...partial, name]);
      }
    }
    cases = next;
  });
  return cases;
}

/**
 * 만들어질 편성 수. 곱이 너무 크면 다 만들어 보지 않고 곱 그대로 돌려준다 — 어차피
 * 한도를 넘어 돌리지 않을 판이고, 수십만 줄을 만들다 탭이 멈추면 안 된다.
 */
export function countCases(squad: string[], alternatives: string[][]): number {
  const bound = squad.reduce((product, current, slot) => product
    * new Set([current, ...(alternatives[slot] ?? []).filter((name) => name && name !== current)]).size, 1);
  return bound > 20_000 ? bound : buildCases(squad, alternatives).length;
}

export interface CaseResult {
  squad: string[];
  /** 지금 편성과 달라진 자리. */
  changed: number[];
  total: number | null;
  charTotals: Record<string, number>;
  error?: string;
}

export interface CaseRunOptions {
  deck: DeckState;
  alternatives: string[][];
  /** 새로 서는 니케의 설정 — 다른 덱에서 만진 값이나 불러온 로스터. 없으면 기본값. */
  overridesFor: (name: string) => CharacterOverrides | undefined;
  run: LabRunner;
  limit?: number;
  onProgress?: (done: number, total: number) => void;
  stopped?: () => boolean;
}

/** 그 편성을 덱으로 — 남은 니케는 설정을 지키고, 새 니케는 `overridesFor`로 채운다. */
export function deckForCase(
  deck: DeckState,
  squad: string[],
  overridesFor: (name: string) => CharacterOverrides | undefined,
): DeckState {
  const next: DeckState = { ...cloneDeck(deck), squad: [...squad], characters: {} };
  for (const name of squad) {
    if (!name) continue;
    const own = deck.characters[name] ?? overridesFor(name);
    if (own) next.characters[name] = structuredClone(own);
  }
  return next;
}

export async function runCases(options: CaseRunOptions): Promise<CaseResult[]> {
  const squads = buildCases(options.deck.squad, options.alternatives);
  let done = 0;
  const results = await mapLimit(squads, options.limit ?? 6, async (squad): Promise<CaseResult> => {
    const changed = squad.flatMap((name, slot) => (name !== options.deck.squad[slot] ? [slot] : []));
    try {
      const result = await options.run(deckForCase(options.deck, squad, options.overridesFor));
      return {
        squad, changed, total: Number.isFinite(result.squadTotal) ? result.squadTotal : null,
        charTotals: result.charTotals,
      };
    } catch (error) {
      if (error instanceof LabStopped) throw error;
      return { squad, changed, total: null, charTotals: {}, error: error instanceof Error ? error.message : String(error) };
    } finally {
      done += 1;
      options.onProgress?.(done, squads.length);
    }
  }, options.stopped);
  return results;
}
