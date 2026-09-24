import { describe, expect, it } from 'vitest';
import { calculatePlan, characterCosts, chestPlan, readPlannerState } from './skill-planner';

describe('skill manual planning', () => {
  it('sums all three skills from 1 to 10, sharing the skill manuals', () => {
    const result = calculatePlan([{ name: '신 : 스위프트 바니', current: [1, 1, 1], target: [10, 10, 10] }], { '7091001': 2000 });
    expect(result.required['7091001']).toBe(2188);
    expect(result.required['7091002']).toBe(1550);
    expect(result.required['7091003']).toBe(630);
    expect(result.required['7092001']).toBe(1094);
    expect(result.required['7093002']).toBe(1440);
    expect(result.shortage['7091001']).toBe(188);
  });
  it('charges only the requested transitions and subtracts inventory once across characters', () => {
    const result = calculatePlan([
      { name: '신 : 스위프트 바니', current: [4, 5, 10], target: [5, 5, 10] },
      { name: '길티 : 마이티 바니', current: [4, 5, 10], target: [5, 5, 10] },
    ], { '7091001': 50, '7091002': 200 });
    expect(result.required['7091001']).toBe(84);
    expect(result.shortage['7091001']).toBe(34);
    expect(result.remaining['7091002']).toBe(80);
    expect(result.shortage['7091002']).toBe(0);
  });
  it('rejects invalid, unsupported, duplicate, and decreasing plans', () => {
    const row = { name: '신 : 스위프트 바니', current: [1, 1, 1], target: [2, 1, 1] };
    expect(() => calculatePlan([{ ...row, target: [0, 1, 1] }], {})).toThrow();
    expect(() => calculatePlan([{ ...row, current: [3, 1, 1] }], {})).toThrow();
    expect(() => calculatePlan([{ ...row, name: 'unknown' }], {})).toThrow();
    expect(() => calculatePlan([row, row], {})).toThrow();
    expect(() => calculatePlan([row], { '7091001': -1 })).toThrow();
    expect(characterCosts('unknown')).toBeUndefined();
  });
  it('30 DAY 성장 보급 상자 — 매뉴얼마다 부족분을 교환량으로 나눠 올림하고 더한다', () => {
    // 상자 1개 = 스킬 I 28 · II 20 · III 8 / 버스트 I 14 · II 10 · III 4 중 하나.
    const plan = chestPlan({ '7091001': 188, '7091003': 8, '7092003': 1, '7092001': 0 });
    expect(plan.rows.map((r) => [r.id, r.boxes, r.gained, r.surplus])).toEqual([
      ['7092003', 1, 4, 3],
      ['7091001', 7, 196, 8],
      ['7091003', 1, 8, 0],
    ]);
    expect(plan.total).toBe(9);
    expect(chestPlan({}).total).toBe(0);
  });
  it('restores valid state and discards corrupted local data', () => {
    expect(readPlannerState('{')).toEqual({ rows: [], inventory: {} });
    expect(readPlannerState('{"rows":{},"inventory":null}')).toEqual({ rows: [], inventory: {} });
    expect(readPlannerState('{"rows":[],"inventory":{"7091001":42}}').inventory['7091001']).toBe(42);
  });
});
