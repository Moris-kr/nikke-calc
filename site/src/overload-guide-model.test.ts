import {it,expect} from 'vitest';
import {guideProfiles,traceSpend,searchGuidePart,solveOverloadGuide,allocateGuideParts,type GuidePlan,type GuideOffer} from './overload-guide-model';
it('accounts for currency switches, repeated keys and existing module locks',()=>{
 const trace=[{locks:1,rolls:10,kind:'effect' as const},{locks:3,rolls:5,kind:'value' as const}];
 expect(traceSpend(trace,0,0)).toMatchObject({modules:38,lock:3,keys:0,effect:20,value:15});
 expect(traceSpend(trace,0,63)).toMatchObject({modules:35,lock:0,keys:450,effectKeys:200,valueKeys:250});
 expect(traceSpend(trace,0,2)).toMatchObject({modules:36,lock:1,keys:250});
 expect(traceSpend(trace,0,1)).toMatchObject({modules:38,lock:3,keys:200});
 expect(traceSpend(trace,1,0).modules).toBe(37);
});
it('enumerates alternatives without counting one physical effect twice',()=>{
 const goals=[{option:'atk_pct',count:4,level:10,alternatives:['crit_dmg']},{option:'crit_dmg',count:4,level:12,alternatives:[]}];
 const profiles=guideProfiles(goals);expect(profiles.some(p=>p.counts[0]===2)).toBe(true);
 for(const p of profiles){const effects=p.target.filter(Boolean);expect(new Set(effects).size).toBe(effects.length);expect(p.counts.reduce((a,b)=>a+b,0)).toBe(effects.length);}
 expect(()=>guideProfiles([{option:'atk_pct',count:4,level:0,alternatives:[]}])).toThrow();
});
it('mixed fixed schedules include both pure endpoints in the pilot search',()=>{
 const current=['atk_pct','element_bonus','crit_dmg'].map(option=>({option,level:1}));
 const profile={target:['atk_pct','element_bonus','crit_dmg'],levels:{atk_pct:10,element_bonus:12,crit_dmg:8},counts:[1,1,1],assignments:[0,1,2]};
 const plans=searchGuidePart(current,0,profile,100,16);const score=(p:GuidePlan)=>p.modules+p.keys/100;
 expect(score(plans.mixed)).toBeLessThanOrEqual(score(plans.modules)+1e-8);expect(score(plans.mixed)).toBeLessThanOrEqual(score(plans.keys)+1e-8);
});
it('globally allocates per-part contributions instead of choosing each part greedily',()=>{
 const goals=[{option:'atk_pct',count:2,level:10,alternatives:[]}];
 const offer=(count:number,modules:number):GuideOffer=>({profile:{target:[],levels:{},counts:[count],assignments:[]},plan:{modules,keys:0} as GuidePlan});
 const answer=allocateGuideParts([[offer(0,0),offer(1,100),offer(2,101)],[offer(0,0),offer(1,2)]],goals,'modules',20);
 expect(answer.reduce((s,p)=>s+p.plan.modules,0)).toBe(101);
 const keyAnswer=allocateGuideParts([[offer(0,0),offer(1,100),offer(2,101)],[offer(0,0),offer(1,2)]],goals,'keys',20);expect(keyAnswer.reduce((s,p)=>s+p.plan.modules,0)).toBe(101);
});
it('requires no spending when the goal is already available and handles partial goals',()=>{
 const rows=['atk_pct','element_bonus','crit_dmg'].map(option=>({option,level:15}));
 const result=solveOverloadGuide({current:[rows,rows,rows,rows],locks:[0,0,0,0],goals:[{option:'atk_pct',count:1,level:10,alternatives:['crit_dmg']}],keyValue:20});
 for(const method of Object.values(result.methods)){expect(method.modules).toBe(0);expect(method.keys).toBe(0);expect(method.parts.reduce((s,p)=>s+p.profile.counts[0]!,0)).toBe(1);}
});
