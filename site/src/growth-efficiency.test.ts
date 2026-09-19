import { describe, it, expect } from 'vitest';
import { maximumRequest, optionGap, verifiedLines, growthPercent } from './growth-efficiency';
import type { SimulationRequest } from './types';
const steps = { atk: Array.from({length:15}, (_,i)=>i+1), ammo: Array.from({length:15}, (_,i)=>(i+1)*10) };
describe('growth efficiency', () => {
 it('changes only overload without mutating the baseline', () => {
  const request = { squad:['A'], duration:180, enemyDef:63000, enemyCode:'', corePx:0, hasParts:false, seed:42, characters:{A:{overload:{atk:2},skillLevels:{'1':7,'2':8,'3':9}}} } as SimulationRequest;
  const next = maximumRequest(request, {A:{머리:[{option:'ammo',level:1}]}}, steps);
  expect(next.characters?.A?.overload).toEqual({ammo:150});
  expect(next.characters?.A?.skillLevels).toEqual(request.characters?.A?.skillLevels);
  expect(request.characters?.A?.overload).toEqual({atk:2});
 });
 it('rejects duplicate equipment effects', () => {
  expect(()=>maximumRequest({squad:['A']} as SimulationRequest,{A:{머리:[{option:'atk',level:1},{option:'atk',level:2}]}},steps)).toThrow();
 });
 it('does not invent part data from totals or stale lines', () => {
  expect(verifiedLines({atk:3},{머리:[{option:'atk',level:2}]},steps)).toBeUndefined();
  expect(verifiedLines({atk:2},{머리:[{option:'atk',level:2}]},steps)).toBeDefined();
 });
 it('distinguishes changing the effect from increasing its value', () => {
  expect(optionGap({option:'atk',level:2},'atk',steps)).toContain('13');
  expect(optionGap({option:'atk',level:2},'ammo',steps)).toContain('효과변경 필요');
  expect(optionGap({option:'atk',level:15},'atk',steps)).toBe('최대수치 달성');
  expect(growthPercent(0,10)).toBeNull();
  expect(growthPercent(100,120)).toBeCloseTo(20);
 });
});

