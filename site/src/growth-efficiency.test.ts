import { describe, it, expect } from 'vitest';
import { maximumRequest, optionGap, verifiedLines, growthPercent } from './growth-efficiency';
import type { SimulationRequest } from './types';
const steps = { atk: Array.from({length:15}, (_,i)=>i+1), ammo: Array.from({length:15}, (_,i)=>(i+1)*10) };
describe('growth efficiency', () => {
 it('applies target breakthrough but leaves excluded characters untouched', () => {
  const request = {squad:['A','B'],characters:{A:{growthStage:2,overload:{atk:2}},B:{growthStage:3,overload:{atk:4}}}} as unknown as SimulationRequest;
  const next = maximumRequest(request, {A:{머리:[{option:'atk',level:2}]}},steps,{growthStages:{A:10,B:10},excluded:new Set(['B']),equipment:{A:{머리:5},B:{머리:5}},extras:{A:{skillLevels:{'1':10,'2':10,'3':10},collection:{stage:'SR15',favorite:3}},B:{collection:{stage:'SR15',favorite:3}}}});
  expect(next.characters?.A?.growthStage).toBe(10);
  expect(next.characters?.A?.overload).toEqual({atk:15});
  expect(next.characters?.A?.equipLevels?.머리).toBe(5);
  expect(next.characters?.A?.skillLevels?.['1']).toBe(10);
  expect(next.characters?.A?.collection?.favorite).toBe(3);
  expect(next.characters?.B).toEqual(request.characters?.B);
  expect(request.characters?.A?.growthStage).toBe(2);
 });
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


it('keeps existing unrelated options in unrequired slots without raising their levels',()=>{
 const request={squad:['A'],characters:{A:{overloadLines:{머리:[{option:'atk',level:12},{option:'ammo',level:3}]}}}} as unknown as SimulationRequest;
 const next=maximumRequest(request,{A:{머리:[{option:'atk',level:15}]}},steps,{useTargetLevels:true});
 expect(next.characters!.A!.overload).toEqual({atk:15,ammo:30});
 expect(optionGap({option:'ammo',level:3},'',steps)).toBe('목표 미지정 · 제거 불필요');
});
