// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openGrowthEfficiency } from './growth-efficiency-ui';
import type { BatchResult, SettingsCatalog, SimulationRequest, SimulationResult } from './types';
const steps = Array.from({length:15},(_,i)=>i+1);
const settings = {overloadSteps:{atk:steps,ammo:steps},overloadFields:{atk:{label:'공격력'},ammo:{label:'장탄'}},characters:{A:{overload:{atk:2}}}} as unknown as SettingsCatalog;
const request = {squad:['A'],characters:{A:{overload:{atk:2}}},duration:180,enemyDef:63000,enemyCode:'작열',corePx:52,hasParts:false,seed:42,rngMode:'expected',defenseRateWindows:[{start:30,end:60,rate:50}]} as unknown as SimulationRequest;
const batch = {total:100,decks:[{deckId:1,request,result:{squadTotal:100,charTotals:{A:100}}}]} as unknown as BatchResult;
const result = (n:number)=>({squadTotal:n,charTotals:{A:n}} as unknown as SimulationResult);
const close=()=>document.querySelector<HTMLButtonElement>('.growth-close')?.click();
afterEach(()=>{close();vi.restoreAllMocks();});
describe('growth efficiency dialog',()=>{
 it('recalculates both sides with the saved conditions and invalidates edited reports',async()=>{
  HTMLElement.prototype.scrollIntoView=vi.fn();
  const simulate=vi.fn().mockResolvedValueOnce(result(100)).mockResolvedValueOnce(result(120));
  openGrowthEfficiency(batch,{settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate});
  expect(document.querySelectorAll('.growth-part')).toHaveLength(4);
  expect(document.querySelector('select')?.value).toBe('atk');
  document.querySelector<HTMLButtonElement>('.growth-primary')!.click();
  await vi.waitFor(()=>expect(document.querySelector('.growth-gain')?.textContent).toBe('+20.00%'));
  expect(simulate).toHaveBeenCalledTimes(2);
  expect(simulate.mock.calls[0]![0]).toEqual(request);
  expect(simulate.mock.calls[1]![0].defenseRateWindows).toEqual(request.defenseRateWindows);
  expect(simulate.mock.calls[1]![0].characters.A.overload).toEqual({atk:15});
  expect(batch.decks[0]!.request.characters!.A!.overload).toEqual({atk:2});
  const select=document.querySelector('select')!;select.value='ammo';select.dispatchEvent(new Event('change'));
  expect(document.querySelector('.growth-output')?.textContent).toBe('');
  expect(document.querySelector<HTMLButtonElement>('.growth-secondary')?.disabled).toBe(true);
 });
 it('requires acknowledgment for absent or stale part information',()=>{
  const simulate=vi.fn();
  openGrowthEfficiency(batch,{settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:4}]}}),simulate});
  expect(document.querySelector('.growth-character')?.textContent).toContain('부위 정보 없음');
  document.querySelector<HTMLButtonElement>('.growth-primary')!.click();
  expect(simulate).not.toHaveBeenCalled();
  expect(document.querySelector('.growth-status')?.textContent).toContain('확인란');
 });
 it('clears incomplete comparisons after failure',async()=>{
  const simulate=vi.fn().mockResolvedValueOnce(result(100)).mockRejectedValueOnce(new Error('시험 오류'));
  openGrowthEfficiency(batch,{settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate});
  document.querySelector<HTMLButtonElement>('.growth-primary')!.click();
  await vi.waitFor(()=>expect(document.querySelector('.growth-status')?.textContent).toContain('시험 오류'));
  expect(document.querySelector<HTMLButtonElement>('.growth-secondary')?.disabled).toBe(true);
  expect(document.querySelector<HTMLSelectElement>('select')?.disabled).toBe(false);
 });
});

