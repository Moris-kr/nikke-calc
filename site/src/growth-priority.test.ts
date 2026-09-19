import { describe, it, expect, vi } from 'vitest';
import { recommendGrowth, standaloneGrowth, rankGlobalGrowth } from './growth-priority';
import type { SimulationRequest, SimulationResult } from './types';
const result = (squadTotal:number) => ({squadTotal} as SimulationResult);
const before = {squad:['A','B','C'],characters:{A:{growthStage:0},B:{growthStage:0},C:{growthStage:0}},duration:180,enemyDef:0,enemyCode:'작열',corePx:0,hasParts:false,seed:42,rngMode:'expected'} as SimulationRequest;
const target = {...before,characters:{A:{growthStage:10},B:{growthStage:10},C:{growthStage:10}}};
describe('growth priority',()=>{
  it('sorts all decks by absolute team gain and keeps repeated characters separate',()=>{
    const rows=[{deckId:1,name:'A',before:100,after:150,gain:50},{deckId:2,name:'A',before:1000,after:1100,gain:100}];
    expect(rankGlobalGrowth(rows).map(row=>row.deckId)).toEqual([2,1]);expect(rows[0]!.deckId).toBe(1);
  });
  it('evaluates single upgrades once and reuses them for the optional greedy ranking',async()=>{
    const totals:Record<string,number>={A:120,B:110,C:115,AB:160,AC:140,BC:130,ABC:170};
    const simulate=vi.fn(async(request:SimulationRequest)=>result(totals[Object.entries(request.characters!).filter(([,v])=>v.growthStage===10).map(([k])=>k).sort().join('')]!));
    const singles=await standaloneGrowth(before,target,['A','B','C'],result(170),simulate);
    expect(simulate).toHaveBeenCalledTimes(3);
    await recommendGrowth(before,target,result(100),result(170),['A','B','C'],simulate,()=>{},singles);
    expect(simulate).toHaveBeenCalledTimes(5);
  });
  it('recomputes team marginal gains, including synergy, without modifying the baseline',async()=>{
    const totals:Record<string,number>={A:120,B:110,C:115,AB:160,AC:140,BC:130,ABC:170};
    const simulate=vi.fn(async(request:SimulationRequest)=>{
      expect(request.seed).toBe(42);
      return result(totals[Object.entries(request.characters!).filter(([,v])=>v.growthStage===10).map(([k])=>k).sort().join('')]!);
    });
    const rows=await recommendGrowth(before,target,result(100),result(170),['A','B','C'],simulate);
    expect(rows.map(r=>r.name)).toEqual(['A','B','C']);
    expect(rows.map(r=>r.gain)).toEqual([20,40,10]);
    expect(rows.map(r=>r.standaloneGain)).toEqual([20,10,15]);
    expect(simulate).toHaveBeenCalledTimes(5);
    expect(before.characters!.A!.growthStage).toBe(0);
  });
  it('uses cached full result for one candidate and preserves negative gains',async()=>{
    const simulate=vi.fn();
    const rows=await recommendGrowth(before,target,result(100),result(90),['A'],simulate);
    expect(rows[0]!.gain).toBe(-10); expect(simulate).not.toHaveBeenCalled();
    expect(await recommendGrowth(before,target,result(100),result(100),[],simulate)).toEqual([]);
  });
});

it('runs independent single upgrades concurrently but retains squad order',async()=>{
  const finishes: Array<()=>void> = [];
  const simulate=vi.fn(()=>new Promise<SimulationResult>(resolve=>finishes.push(()=>resolve(result(120)))));
  const pending=standaloneGrowth(before,target,['A','B','C'],result(170),simulate);
  expect(simulate).toHaveBeenCalledTimes(3);
  finishes.reverse().forEach(finish=>finish());
  expect([...(await pending).keys()]).toEqual(['A','B','C']);
});
