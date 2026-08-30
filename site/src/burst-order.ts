import type { BattleTimeline, CharacterMeta, DeckState } from './types';

// 버스트 순서를 손으로 정하는 층.
//
// 평소에는 계산기가 알아서 고른다 — 편성 순서대로, 쿨이 도는 사람부터. 그런데 「이번
// 사이클은 크라운 말고 리타를 먼저」처럼 사람이 굴리는 실제 운용은 그 규칙으로 안 나온다.
// 여기서 사이클마다 단계별로 누구를 쓸지 직접 적어 두면 엔진이 그대로 따른다.
//
// **적어 둔 만큼만 따른다.** 전투가 적어 둔 사이클보다 길어지면 그 뒤는 평소 순서로
// 돌아간다 — 버스트 패턴은 우선순위지 절대 규칙이 아니다(엔진 `_try_use_stage`).

export type BurstStage = '1' | '2' | '3';

export const BURST_STAGES: BurstStage[] = ['1', '2', '3'];

/**
 * 풀버스트 한 사이클. 단계마다 **후보 목록**이다 — 엔진은 앞에서부터 쓸 수 있는 사람을
 * 고르므로, 화면이 한 명만 적어도 그 사람이 쿨이면 그 단계가 통째로 막히지 않는다.
 */
export type BurstCycle = Record<BurstStage, string[]>;

export type BurstSequence = BurstCycle[];

/** 왼손이 안 움직이는 자리 다섯. 편성이 다섯이라 딱 맞는다. */
export const HOTKEYS = ['A', 'S', 'D', 'F', 'G'] as const;

/** 한 걸음 — 몇 번째 풀버스트의 몇 단계인가. `cycle`은 1부터다(사람이 세는 대로). */
export interface BurstStep {
  cycle: number;
  stage: BurstStage;
}

/** 풀버스트 한 사이클이 도는 데 걸리는 시간(초). 버스트 10초 + 쿨 10초. */
const CYCLE_SECONDS = 20;

/** 사이클 수 상한. 이보다 길게 적을 일은 없고, 화면이 끝없이 늘어나는 것을 막는다. */
export const MAX_CYCLES = 30;

/**
 * 전투 시간으로 어림한 풀버스트 횟수.
 *
 * 계산을 한 번이라도 돌렸으면 `cyclesFromTimeline`이 **실제 횟수**를 주므로 그쪽이 낫다.
 * 이건 아직 안 돌려 본 사람에게 시작점을 주는 값이다.
 */
export function estimateCycles(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 1;
  return Math.max(1, Math.min(MAX_CYCLES, Math.ceil(duration / CYCLE_SECONDS)));
}

/** 지난 계산에서 풀버스트가 실제로 몇 번 돌았나. 타임라인이 없으면 null. */
export function cyclesFromTimeline(timeline: BattleTimeline | undefined): number | null {
  const windows = timeline?.fullBurst;
  if (!Array.isArray(windows) || windows.length === 0) return null;
  return Math.min(MAX_CYCLES, windows.length);
}

/** 걸어갈 순서. 사이클마다 1버 → 2버 → 3버. */
export function stepsFor(cycles: number): BurstStep[] {
  const steps: BurstStep[] = [];
  for (let cycle = 1; cycle <= Math.max(0, cycles); cycle += 1) {
    for (const stage of BURST_STAGES) steps.push({ cycle, stage });
  }
  return steps;
}

/** 걸음 하나를 저장 키로. `2:3` = 두 번째 풀버스트의 3버. */
export const stepKey = (step: BurstStep): string => `${step.cycle}:${step.stage}`;

export interface CandidateSource {
  /** 편성. 빈 칸은 걸러 낸다. */
  squad: string[];
  /** 이름 → 카탈로그. 버스트 단계를 여기서 읽는다. */
  metaOf: (name: string) => CharacterMeta | undefined;
  /** 「버스트 안 씀」으로 잡아 둔 사람. 후보에서 뺀다. */
  skipped?: Set<string>;
}

/**
 * 이 단계를 채울 수 있는 니케.
 *
 * **편성 순서를 지킨다** — 단축키가 자리를 바꾸면 손이 외운 위치가 무너진다.
 * 단계가 `A`인 니케(레드 후드)는 어느 단계에나 선다.
 */
export function candidatesFor(stage: BurstStage, source: CandidateSource): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of source.squad) {
    const name = (raw ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (source.skipped?.has(name)) continue;
    const meta = source.metaOf(name);
    if (!meta) continue;
    const own = String(meta.burstStage).toUpperCase();
    if (own === stage || own === 'A') out.push(name);
  }
  return out;
}

/** 고른 것들(`걸음키 → 이름`)을 엔진이 받는 모양으로 편다. */
export function sequenceFrom(picks: Record<string, string>, cycles: number): BurstSequence {
  const out: BurstSequence = [];
  for (let cycle = 1; cycle <= Math.max(0, cycles); cycle += 1) {
    const entry: BurstCycle = { 1: [], 2: [], 3: [] };
    for (const stage of BURST_STAGES) {
      const picked = picks[stepKey({ cycle, stage })];
      if (picked) entry[stage] = [picked];
    }
    out.push(entry);
  }
  return out;
}

/** 채운 사이클이 하나도 없으면 null — 요청에 안 싣는다(평소 순서 그대로). */
export function trimSequence(sequence: BurstSequence | undefined): BurstSequence | null {
  if (!Array.isArray(sequence) || sequence.length === 0) return null;
  // 뒤쪽의 빈 사이클은 잘라 낸다. 남겨 두면 그 사이클에서 후보가 비어 버스트가 막힌다.
  const out = sequence.map((cycle) => ({
    1: [...(cycle['1'] ?? [])],
    2: [...(cycle['2'] ?? [])],
    3: [...(cycle['3'] ?? [])],
  }) as BurstCycle);
  const filled = (cycle: BurstCycle): boolean =>
    BURST_STAGES.some((stage) => (cycle[stage] ?? []).length > 0);
  while (out.length > 0 && !filled(out[out.length - 1]!)) out.pop();
  return out.length > 0 ? out : null;
}

/** 편성에 없는 이름은 떨군다. 편성을 바꾼 뒤 남아 있던 순서가 조용히 틀리지 않게. */
export function pruneToSquad(
  sequence: BurstSequence | undefined, squad: string[],
): BurstSequence | null {
  const alive = new Set(squad.map((name) => (name ?? '').trim()).filter(Boolean));
  if (!Array.isArray(sequence)) return null;
  return trimSequence(sequence.map((cycle) => ({
    1: (cycle['1'] ?? []).filter((name) => alive.has(name)),
    2: (cycle['2'] ?? []).filter((name) => alive.has(name)),
    3: (cycle['3'] ?? []).filter((name) => alive.has(name)),
  }) as BurstCycle));
}

/** 저장해 둔 순서를 다시 걸음별 선택으로. 창을 다시 열면 하던 자리가 남아 있어야 한다. */
export function picksFrom(sequence: BurstSequence | undefined): Record<string, string> {
  const picks: Record<string, string> = {};
  (sequence ?? []).forEach((cycle, index) => {
    for (const stage of BURST_STAGES) {
      const first = (cycle[stage] ?? [])[0];
      if (first) picks[stepKey({ cycle: index + 1, stage })] = first;
    }
  });
  return picks;
}

/** 몇 칸을 채웠나 / 몇 칸인가. 창 위쪽에 그대로 적는다. */
export function progressOf(
  picks: Record<string, string>, steps: BurstStep[],
): { done: number; total: number } {
  const total = steps.length;
  const done = steps.filter((step) => picks[stepKey(step)]).length;
  return { done, total };
}

/** 목록에 적는 한 줄. 「1버 리타 → 2버 크라운 → 3버 앨리스」 */
export function cycleLine(cycle: BurstCycle | undefined): string {
  if (!cycle) return '자동';
  const parts = BURST_STAGES
    .map((stage) => {
      const name = (cycle[stage] ?? [])[0];
      return name ? `${stage}버 ${name}` : null;
    })
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' → ') : '자동';
}

/** 덱에 잡아 둔 순서를 요청에 실을 모양으로. 편성이 바뀌었으면 그에 맞춰 걸러 낸다. */
export function sequenceForDeck(deck: DeckState): BurstSequence | null {
  return pruneToSquad(deck.burstSequence, deck.squad);
}
