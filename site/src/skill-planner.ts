import data from './skill-costs.json';

export const PLANNER_KEY = 'nikke-skill-planner-v1';
export const MANUALS = ['7092001', '7092002', '7092003', '7091001', '7091002', '7091003'] as const;
export const MATERIAL_NAMES: Record<string, string> = data.items;
type Costs = Record<string, number>;
type SkillCosts = Record<string, Costs[]>;
export interface PlanRow { name: string; current: number[]; target: number[] }
export interface PlannerState { rows: PlanRow[]; inventory: Costs }
const characters = data.characters as unknown as Record<string, SkillCosts>;
export const characterCosts = (name: string): SkillCosts | undefined => characters[name];

export function calculatePlan(rows: PlanRow[], inventory: Costs) {
  const required: Costs = {};
  const names = new Set<string>();
  for (const quantity of Object.values(inventory)) {
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('보유량은 0 이상의 정수로 입력해 주세요.');
  }
  for (const row of rows) {
    const costs = characterCosts(row.name);
    if (!costs) throw new Error('소모량이 확인되지 않은 캐릭터입니다.');
    if (names.has(row.name)) throw new Error('같은 캐릭터는 한 번만 추가할 수 있습니다.');
    names.add(row.name);
    if (row.current.length !== 3 || row.target.length !== 3) throw new Error('스킬 레벨을 확인해 주세요.');
    for (let i = 0; i < 3; i++) {
      const from = row.current[i]!;
      const to = row.target[i]!;
      const steps = costs[String(i + 1)] ?? [];
      if (![from, to].every((n) => Number.isInteger(n) && n >= 1 && n <= steps.length + 1) || to < from) {
        throw new Error('목표 레벨은 현재 레벨 이상이어야 합니다.');
      }
      for (let level = from; level < to; level++) {
        for (const [item, amount] of Object.entries(steps[level - 1]!)) {
          required[item] = (required[item] ?? 0) + amount;
        }
      }
    }
  }
  const shortage: Costs = {}, remaining: Costs = {};
  for (const item of new Set([...Object.keys(required), ...Object.keys(inventory), ...MANUALS])) {
    shortage[item] = Math.max(0, (required[item] ?? 0) - (inventory[item] ?? 0));
    remaining[item] = Math.max(0, (inventory[item] ?? 0) - (required[item] ?? 0));
  }
  return { required, shortage, remaining };
}

/** 30 DAY 성장 보급 상자(게임 아이템 9201010). 하나를 열 때마다 아래 매뉴얼 중 **한 가지**를 골라 받는다. */
export const UPGRADE_CHEST = '9201010';
export const UPGRADE_CHEST_NAME = '30 DAY 성장 보급 상자';
/** 상자 1개로 받는 개수(유저 제공 2026-09-25). */
export const CHEST_EXCHANGE: Record<string, number> = {
  '7091001': 28, '7091002': 20, '7091003': 8,
  '7092001': 14, '7092002': 10, '7092003': 4,
};

export interface ChestRow { id: string; shortage: number; per: number; boxes: number; gained: number; surplus: number }

/**
 * 부족한 매뉴얼을 상자로 채우는 데 드는 개수. 상자 하나는 한 가지만 주므로 매뉴얼마다 따로 올림하고 더한다 —
 * 한 상자를 둘로 나눌 수 없어 이것이 최소다. 부족이 없는 매뉴얼은 빠진다.
 */
export function chestPlan(shortage: Costs): { rows: ChestRow[]; total: number } {
  const rows = MANUALS.filter((id) => (shortage[id] ?? 0) > 0).map((id): ChestRow => {
    const per = CHEST_EXCHANGE[id]!;
    const need = shortage[id]!;
    const boxes = Math.ceil(need / per);
    return { id, shortage: need, per, boxes, gained: boxes * per, surplus: boxes * per - need };
  });
  return { rows, total: rows.reduce((sum, row) => sum + row.boxes, 0) };
}

export function readPlannerState(raw: string | null): PlannerState {
  try {
    const state = JSON.parse(raw ?? 'null') as PlannerState;
    if (!state || !Array.isArray(state.rows) || !state.inventory || typeof state.inventory !== 'object' || Array.isArray(state.inventory)) throw new Error();
    calculatePlan(state.rows, state.inventory);
    return state;
  } catch {
    return { rows: [], inventory: {} };
  }
}
