/**
 * 최적옵작 — 오버로드 12줄을 무엇으로 채워야 이 덱의 총딜이 가장 높은가.
 *
 * 줄의 **자리(부위)** 는 딜에 상관없다 — 엔진이 받는 값은 옵션별 합계뿐이다. 그래서
 * «옵션마다 몇 줄»만 고르면 된다. 인게임에서 한 부위에 같은 옵션은 한 줄뿐이라
 * 옵션 하나는 **최대 4줄**(부위 넷)이고, 4줄 이하라면 언제나 부위에 나눠 놓을 수 있다
 * (`arrangeLines`).
 *
 * 정하고 들어가는 것 (유저 지정 2026-09-26)
 * ---------------------------------------
 * * **방어력은 뺀다** — 딜 덱에서 아무도 쓰지 않는다.
 * * **차지 속도·차지 대미지는 차지 무기만** 본다 — 무기가 SR·RL이거나, 무기 변경으로
 *   SR·RL을 드는 니케. 나머지에게는 효과가 없다.
 * * **우월 코드 4줄·공격력 4줄은 기본으로 고정**한다(많은 니케가 그렇게 맞춘다). 그러면
 *   부위마다 남는 한 줄, 곧 4줄만 고르면 된다. 고정을 풀면 그 옵션도 0~4줄 중에서 고른다.
 * * 모든 줄은 **같은 레벨**로 본다. 옵션 표는 레벨마다 비율이 같아 순위는 거의 안 바뀐다.
 */
import type { EquipPart } from './types';

/** 고르는 옵션(방어력 제외). 화면에 늘어놓는 순서이기도 하다. */
export const OPTIMIZER_OPTIONS = [
  'element_bonus', 'atk_pct', 'crit_rate', 'crit_dmg', 'max_ammo_pct', 'accuracy_pct',
  'charge_speed_pct', 'charge_dmg_pct',
] as const;
export const CHARGE_OPTIONS = new Set(['charge_speed_pct', 'charge_dmg_pct']);
export const PARTS: EquipPart[] = ['머리', '몸통', '팔', '다리'];
export const LINES_PER_PART = 3;
export const TOTAL_LINES = PARTS.length * LINES_PER_PART;
/** 한 옵션이 가질 수 있는 줄 — 부위마다 하나. */
export const MAX_PER_OPTION = PARTS.length;

export type Allocation = Record<string, number>;

export interface OptimizerSetup {
  /** 우월 코드 4줄 고정. */
  fixElement: boolean;
  /** 공격력 4줄 고정. */
  fixAtk: boolean;
  /** 차지 무기인가 — 아니면 차속·차댐을 고르지 않는다. */
  charge: boolean;
}

/** 무기가 차지 무기인가 — 기본 무기나 무기 변경으로 드는 무기 중 SR·RL이 있으면. */
export const isChargeWeapon = (weaponType: string | undefined, changes: readonly string[] = []): boolean =>
  [weaponType ?? '', ...changes].some((type) => type === 'SR' || type === 'RL');

export function fixedAllocation(setup: OptimizerSetup): Allocation {
  return {
    ...(setup.fixElement ? { element_bonus: MAX_PER_OPTION } : {}),
    ...(setup.fixAtk ? { atk_pct: MAX_PER_OPTION } : {}),
  };
}

/** 고정 줄을 뺀 나머지 줄에서 고를 옵션. */
export function freeOptions(setup: OptimizerSetup): string[] {
  const fixed = fixedAllocation(setup);
  return OPTIMIZER_OPTIONS.filter((key) => !(key in fixed) && (setup.charge || !CHARGE_OPTIONS.has(key)));
}

export function freeLines(setup: OptimizerSetup): number {
  return TOTAL_LINES - Object.values(fixedAllocation(setup)).reduce((a, b) => a + b, 0);
}

const choose = (n: number, k: number): number => {
  if (k < 0 || n < k) return 0;
  let out = 1;
  for (let i = 1; i <= k; i += 1) out = (out * (n - k + i)) / i;
  return Math.round(out);
};

/** 옵션 n개에 줄 k개를 옵션마다 `cap`줄 이하로 나누는 방법 수(포함·배제). */
export function countAllocations(n: number, k: number, cap = MAX_PER_OPTION): number {
  if (n === 0) return k === 0 ? 1 : 0;
  let total = 0;
  for (let j = 0; j <= n && j * (cap + 1) <= k; j += 1) {
    total += (j % 2 ? -1 : 1) * choose(n, j) * choose(k - j * (cap + 1) + n - 1, n - 1);
  }
  return total;
}

/** 이 설정으로 돌릴 조합 수(지금 줄로 한 번 재는 기준 판은 빼고). */
export const countFor = (setup: OptimizerSetup): number =>
  countAllocations(freeOptions(setup).length, freeLines(setup));

/** 고정 줄 + 옵션마다 몇 줄 — 가능한 조합 전부. */
export function enumerateAllocations(setup: OptimizerSetup): Allocation[] {
  const options = freeOptions(setup);
  const fixed = fixedAllocation(setup);
  const out: Allocation[] = [];
  const pick = (index: number, left: number, acc: Allocation) => {
    if (index === options.length - 1) {
      if (left <= MAX_PER_OPTION) out.push({ ...fixed, ...acc, ...(left > 0 ? { [options[index]!]: left } : {}) });
      return;
    }
    for (let n = Math.min(MAX_PER_OPTION, left); n >= 0; n -= 1) {
      pick(index + 1, left - n, n > 0 ? { ...acc, [options[index]!]: n } : acc);
    }
  };
  if (options.length === 0) return freeLines(setup) === 0 ? [{ ...fixed }] : [];
  pick(0, freeLines(setup), {});
  return out;
}

/** 조합 → 엔진이 받는 옵션별 합계. 줄은 모두 `level`이다. */
export function totalsOf(allocation: Allocation, steps: Record<string, number[]>, level: number,
  fields: string[]): Record<string, number> {
  const totals: Record<string, number> = Object.fromEntries(fields.map((key) => [key, 0]));
  for (const [key, count] of Object.entries(allocation)) {
    const table = steps[key];
    if (!table || count <= 0) continue;
    const value = table[Math.min(Math.max(1, level), table.length) - 1] ?? 0;
    totals[key] = Math.round(value * count * 1000) / 1000;
  }
  return totals;
}

/**
 * 조합을 부위 넷에 나눠 놓는다 — 옵션별로 줄을 늘어놓고 차례로 머리·몸통·팔·다리에
 * 돌려 넣으면, 한 옵션(4줄 이하)이 한 부위에 두 번 들어가는 일이 없다.
 */
export function arrangeLines(allocation: Allocation): Record<EquipPart, string[]> {
  const order = OPTIMIZER_OPTIONS.filter((key) => (allocation[key] ?? 0) > 0);
  const flat = order.flatMap((key) => Array.from({ length: allocation[key]! }, () => key));
  const out = Object.fromEntries(PARTS.map((part) => [part, [] as string[]])) as Record<EquipPart, string[]>;
  flat.forEach((key, index) => out[PARTS[index % PARTS.length]!]!.push(key));
  return out;
}

/** 조합을 사람이 읽는 줄 — «우월 4 · 공격력 4 · 크리티컬 대미지 4». */
export function allocationLabel(allocation: Allocation, labelOf: (key: string) => string): string {
  return OPTIMIZER_OPTIONS.filter((key) => (allocation[key] ?? 0) > 0)
    .map((key) => `${labelOf(key)} ${allocation[key]}`).join(' · ');
}

/** 진행 상황 — 몇 퍼센트, 남은 시간(초). 처음 몇 판은 워커가 뜨는 시간이 섞여 추정을 미룬다. */
export function progressOf(done: number, total: number, elapsedMs: number): { percent: number; remainingSec: number | null } {
  const percent = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 100;
  if (done < 3 || elapsedMs <= 0) return { percent, remainingSec: null };
  return { percent, remainingSec: Math.max(0, Math.round(((total - done) * elapsedMs) / done / 1000)) };
}

/** «약 1분 20초» · «약 8초». */
export function durationLabel(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m}분 ${rest}초` : `${m}분`;
}

// ── 빠른 탐색 ────────────────────────────────────────────────────────────
// 고정을 풀면 조합이 수천~2만 개로 늘어 전수로는 수 분~수십 분이 걸린다. 그래서
//   1단계: 4우·4공 고정 조합(126·35개)을 전부 잰다 — 대부분의 답이 이 안에 있다.
//   2단계: 지금까지 가장 좋은 조합 **몇 개(빔)** 에서 한 줄 또는 두 줄을 다른 옵션으로 옮긴
//          이웃을 전부 잰다. 상위 몇 개가 더 바뀌지 않으면 멈춘다.
// 두 줄 이동을 넣은 까닭은 장탄처럼 **두 줄이 모여야 한 발이 느는** 계단 효과 때문이다 —
// 한 줄씩만 옮기면 그 계단을 못 넘는다.
// 1등 하나만 따라가면(빔 1) 크리티컬 확률·대미지처럼 **함께 올려야 값이 나는** 옵션을 놓친다 —
// 전수 결과와 견준 벤치(2026-09-26, 앨리스·레드 후드 전 조합)에서 빔 1은 3위(−0.03%)에 멈췄고
// 빔 2~3은 1위를 찾았다. 그래서 상위 3개를 함께 따라간다. 그래도 전수가 아니라 근사다.

/** 빠른 탐색 2단계의 최대 회차. 벤치에서는 3~4회차에서 멈췄다. */
export const FAST_MAX_ROUNDS = 6;
/** 2단계에서 함께 따라가는 상위 조합 수(빔 폭). */
export const FAST_BEAM = 3;

/** 조합을 가리키는 열쇠 — 옵션 순서대로 줄 수를 잇는다. */
export const allocationKey = (allocation: Allocation): string =>
  OPTIMIZER_OPTIONS.map((key) => allocation[key] ?? 0).join(',');

/** 빠른 탐색 1단계의 조합 — 우월·공격력 4줄 고정. */
export const seedSetup = (setup: OptimizerSetup): OptimizerSetup => ({ ...setup, fixElement: true, fixAtk: true });

/** 한 줄 또는 두 줄을 옵션 A에서 B로 옮긴 조합들. 고정된 옵션은 건드리지 않는다. */
export function neighborsOf(allocation: Allocation, options: string[]): Allocation[] {
  const out = new Map<string, Allocation>();
  for (const from of options) {
    for (const to of options) {
      if (from === to) continue;
      for (const move of [1, 2]) {
        const have = allocation[from] ?? 0;
        const room = MAX_PER_OPTION - (allocation[to] ?? 0);
        if (have < move || room < move) continue;
        const next: Allocation = { ...allocation, [to]: (allocation[to] ?? 0) + move };
        if (have === move) delete next[from];
        else next[from] = have - move;
        out.set(allocationKey(next), next);
      }
    }
  }
  return [...out.values()];
}

/** 2단계 한 회차의 최대 이웃 수 — 옵션 쌍마다 한 줄·두 줄. */
export const maxNeighbors = (optionCount: number): number => 2 * optionCount * (optionCount - 1);

/** 빠른 탐색이 돌 수 있는 최대 판 수(상한 — 이웃이 겹치고 이미 잰 것은 다시 안 재서 실제는 훨씬 적다). */
export const fastBudget = (setup: OptimizerSetup): number =>
  Math.min(countFor(setup),
    countFor(seedSetup(setup)) + FAST_MAX_ROUNDS * FAST_BEAM * maxNeighbors(freeOptions(setup).length));

/**
 * 빠른 탐색이 보통 도는 판 수(예상 시간용). 1단계 전부 + 이웃 4회차 분량 — 벤치 네 가지(앨리스·레드 후드,
 * 조합 1,751~23,940개)에서 실제로 돈 판 수(77·263·357·473)는 모두 이 안이었고 전부 전수의 1위를 찾았다.
 */
export const fastTypical = (setup: OptimizerSetup): number =>
  Math.min(fastBudget(setup), countFor(seedSetup(setup)) + 4 * maxNeighbors(freeOptions(setup).length));

export interface FastScore { allocation: Allocation; total: number }

export interface FastSearchResult {
  /** 잰 조합 전부(딜 높은 순). */
  ranked: FastScore[];
  /** 2단계를 몇 회차 돌았나. */
  rounds: number;
  /** 더 나아지지 않아 멈췄나(아니면 회차 상한에 닿았다). */
  converged: boolean;
}

/**
 * 빠른 탐색. `evaluate`는 조합 묶음을 받아 덱 총딜(실패는 null)을 같은 순서로 돌려준다 —
 * 판을 어떻게 돌리고 진행을 어떻게 알리는지는 부르는 쪽 몫이다.
 */
export async function fastSearch(
  setup: OptimizerSetup,
  evaluate: (allocations: Allocation[], phase: { stage: 1 | 2; round: number }) => Promise<Array<number | null>>,
  beam = FAST_BEAM,
): Promise<FastSearchResult> {
  const scored = new Map<string, FastScore>();
  /** 계산에 실패한 조합 — 다음 회차에 다시 돌리지 않는다. */
  const failed = new Set<string>();
  const measure = async (allocations: Allocation[], phase: { stage: 1 | 2; round: number }) => {
    const fresh = [...new Map(allocations.map((allocation) => [allocationKey(allocation), allocation])).entries()]
      .filter(([key]) => !scored.has(key) && !failed.has(key));
    if (fresh.length === 0) return;
    const totals = await evaluate(fresh.map(([, allocation]) => allocation), phase);
    fresh.forEach(([key, allocation], index) => {
      const total = totals[index];
      if (total != null && Number.isFinite(total)) scored.set(key, { allocation, total });
      else failed.add(key);
    });
  };
  const topOf = (): FastScore[] => [...scored.values()].sort((a, b) => b.total - a.total).slice(0, beam);
  const sameTop = (a: FastScore[], b: FastScore[]) =>
    a.length === b.length && a.every((entry, index) => allocationKey(entry.allocation) === allocationKey(b[index]!.allocation));

  await measure(enumerateAllocations(seedSetup(setup)), { stage: 1, round: 0 });
  let top = topOf();
  const options = freeOptions(setup);
  let rounds = 0;
  let converged = false;
  while (top.length && rounds < FAST_MAX_ROUNDS) {
    rounds += 1;
    await measure(top.flatMap((entry) => neighborsOf(entry.allocation, options)), { stage: 2, round: rounds });
    const next = topOf();
    if (sameTop(next, top)) { converged = true; break; }
    top = next;
  }
  return { ranked: [...scored.values()].sort((a, b) => b.total - a.total), rounds, converged };
}
