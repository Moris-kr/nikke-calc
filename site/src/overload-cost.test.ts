import {describe,it,expect} from 'vitest';
import {effectOutcomes,evaluateRoute,estimateModules,LEVEL_PROB,OPTION_PROB,seeded} from './overload-cost';
const row=(option:string,level=15)=>({option,level});
describe('module model',()=>{
 it('normalizes official-style weights and conditional effect outcomes',()=>{
  expect(Object.values(OPTION_PROB).reduce((a,b)=>a+b,0)).toBeCloseTo(1);
  expect(LEVEL_PROB.reduce((a,b)=>a+b,0)).toBeCloseTo(1);
  const outcomes=effectOutcomes([row('atk_pct'),row('element_bonus'),row('crit_dmg')],0);
  expect(outcomes.reduce((sum,o)=>sum+o.prob,0)).toBeCloseTo(1);
  expect(outcomes.filter(o=>o.options[1]&&o.options[2]).reduce((sum,o)=>sum+o.prob,0)).toBeCloseTo(.15);
  for(const outcome of outcomes)expect(new Set(outcome.options.filter(Boolean)).size).toBe(outcome.options.filter(Boolean).length);
 });
 it('counts free different-value redraw exactly and preserves existing locks',()=>{
  const current=[row('atk_pct'),row('element_bonus'),row('crit_dmg',1)];
  const result=evaluateRoute(current,['atk_pct','element_bonus','crit_dmg'],[0,1,2],3,seeded(1));
  expect(result.change).toBeCloseTo(3*.88/.01);expect(result.lock).toBe(0);
 });
 it('charges new locks separately as 1 then 2, and does not lock after completion',()=>{
  const current=[row('atk_pct'),row('element_bonus'),row('crit_dmg',1)];
  const result=evaluateRoute(current,['atk_pct','element_bonus','crit_dmg'],[0,1,2],0,seeded(1));
  expect(result.lock).toBe(3);expect(result.change).toBeCloseTo(264);
  expect(evaluateRoute(current.map(r=>({...r,level:15})),['atk_pct','element_bonus','crit_dmg'],[0,1,2],0,seeded(1))).toMatchObject({lock:0,change:0});
 });
});

it('returns reproducible finite estimates and a valid route',()=>{
 const current=[row('atk_pct',1),row('element_bonus',4),row('crit_dmg',7)];
 const first=estimateModules(current,['atk_pct','element_bonus','crit_dmg'],0,4000);
 const second=estimateModules(current,['atk_pct','element_bonus','crit_dmg'],0,4000);
 expect(second).toEqual(first);expect(first.total).toBeGreaterThan(0);expect(first.total).toBeCloseTo(first.lock+first.change);expect(first.error95).toBeLessThan(first.total*.05);
});

it('conditional expectation agrees with independent full roll simulation',()=>{
 const rng=seeded(98765);const initial=[row('atk_pct',1),row('element_bonus',4),row('crit_dmg',7)];
 let actual=0,squares=0;const samples=3000;
 const draw=()=>{let ticket=rng();for(let i=0;i<15;i++){ticket-=LEVEL_PROB[i]!;if(ticket<0)return i+1;}return 15;};
 for(let sample=0;sample<samples;sample++){
  const levels=[1,4,7];let locks=0,cost=0;
  while(levels.some(l=>l!==15)){
   for(let i=0;i<3;i++)if(levels[i]===15&&!(locks&(1<<i))){cost+=1+[0,1,2].filter(j=>locks&(1<<j)).length;locks|=1<<i;}
   cost+=1+[0,1,2].filter(j=>locks&(1<<j)).length;
   const next=levels.map((old,i)=>{if(locks&(1<<i))return old;let level=draw();while(level===old)level=draw();return level;});
   if(next.some((level,i)=>level===15&&levels[i]!==15))next.forEach((level,i)=>{levels[i]=level;});
  }
  actual+=cost;squares+=cost*cost;
 }
 const modelRng=seeded(442);let estimate=0;for(let n=0;n<samples;n++){const value=evaluateRoute(initial,['atk_pct','element_bonus','crit_dmg'],[0,1,2],0,modelRng,'effects-first');estimate+=value.lock+value.change;}
 const mean=actual/samples,standardError=Math.sqrt((squares/samples-mean*mean)/samples);
 expect(Math.abs(mean-estimate/samples)).toBeLessThan(4*standardError);
});
