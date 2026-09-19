import {evaluateRoute,ORDERS,OPTION_PROB,seeded,type RollStage} from './overload-cost';
import type {OverloadLine} from './types';
export const GUIDE_PARTS=['머리','몸통','팔','다리'] as const;
export type GuideMethod='modules'|'keys'|'mixed';
export interface GuideGoal {option:string;count:number;level:number;alternatives:string[]}
export interface GuideInput {current:OverloadLine[][];locks:number[];goals:GuideGoal[];keyValue:number}
export interface GuideProfile {target:string[];levels:Record<string,number>;counts:number[];assignments:number[]}
export interface GuidePlan {target:string[];levels:Record<string,number>;order:number[];mode:'complete-line'|'effects-first';schedule:number;modules:number;keys:number;lock:number;effect:number;value:number;error95:number;keyError95:number;samples:number}
export interface GuideOffer {profile:GuideProfile;plan:GuidePlan}
export interface GuideResult {methods:Record<GuideMethod,{parts:GuideOffer[];modules:number;keys:number;error95:number;keyError95:number}>;profileCount:number;keyValue:number}
const bits=(mask:number)=>[0,1,2].filter(i=>mask&(1<<i)).length;
const locking=(previous:number,wanted:number)=>{const kept=bits(previous&wanted),added=bits(wanted&~previous);return added*(2*kept+added+1)/2;};
/** A fixed schedule chooses before observing each successful stage's random outcome. */
export function traceSpend(trace:RollStage[],initialLocks:number,schedule:number){
 let permanent=initialLocks,lock=0,keys=0,effect=0,value=0;
 trace.forEach((stage,index)=>{const count=bits(stage.locks);const cost=(1+count)*stage.rolls;if(stage.kind==='effect')effect+=cost;else value+=cost;
  if(schedule&(1<<index)){permanent=0;keys+=(count===2?50:count===1?20:0)*stage.rolls;}
  else{lock+=locking(permanent,stage.locks);permanent=stage.locks;}
 });return {modules:lock+effect+value,keys,lock,effect,value};
}
const score=(plan:{modules:number;keys:number},method:GuideMethod,keyValue:number)=>method==='modules'?plan.modules:method==='keys'?plan.keys:plan.modules+plan.keys/keyValue;
function better(a:Pick<GuidePlan,'modules'|'keys'>,b:Pick<GuidePlan,'modules'|'keys'>|undefined,method:GuideMethod,keyValue:number){if(!b)return true;const diff=score(a,method,keyValue)-score(b,method,keyValue);return diff < -1e-9 || Math.abs(diff)<1e-9&&(method==='keys'?a.modules<b.modules:a.keys<b.keys);}
export function guideProfiles(goals:GuideGoal[]):GuideProfile[]{
 if(!goals.length||goals.length>9||goals.reduce((s,g)=>s+g.count,0)>12||new Set(goals.map(g=>g.option)).size!==goals.length)throw new Error('목표는 효과별 한 번, 합계 1~12줄로 설정해 주세요.');
 for(const g of goals)if(!OPTION_PROB[g.option]||!Number.isInteger(g.count)||g.count<1||g.count>4||!Number.isInteger(g.level)||g.level<1||g.level>15||g.alternatives.some(k=>!OPTION_PROB[k])||new Set([g.option,...g.alternatives]).size!==g.alternatives.length+1)throw new Error('목표 줄 수·레벨·타협 옵션을 확인해 주세요.');
 const choices=goals.flatMap((goal,group)=>[goal.option,...goal.alternatives].map(option=>({option,level:goal.level,group})));
 const result:GuideProfile[]=[];const uniqueCosts=new Set<string>();
 const visit=(start:number,selected:typeof choices,counts:number[])=>{
  const target=selected.map(v=>v.option);while(target.length<3)target.push('');
  const levels=Object.fromEntries(selected.map(v=>[v.option,v.level]));
  const profile={target,levels,counts:[...counts],assignments:selected.map(v=>v.group)};result.push(profile);uniqueCosts.add(profileKey(profile));
  if(uniqueCosts.size>500||result.length>10000)throw new Error('타협 범위가 너무 넓습니다. 허용 옵션 수를 줄여 주세요 (500개 장비 목표 / 10,000개 배분 한도).');
  if(selected.length===3)return;
  for(let i=start;i<choices.length;i++){const c=choices[i]!;if(counts[c.group]!>=goals[c.group]!.count||selected.some(s=>s.option===c.option))continue;counts[c.group]!++;visit(i+1,[...selected,c],counts);counts[c.group]!--;}
 };visit(0,[],goals.map(()=>0));return result;
}
export const profileKey=(profile:GuideProfile)=>profile.target.filter(Boolean).sort().map(option=>`${option}:${profile.levels[option]}`).join('|');
function emptyPlan(profile:GuideProfile):GuidePlan{return {target:profile.target,levels:profile.levels,order:[0,1,2],mode:'complete-line',schedule:0,modules:0,keys:0,lock:0,effect:0,value:0,error95:0,keyError95:0,samples:0};}
/** Enumerate all fixed stage schedules over the same probability traces; no outcome look-ahead. */
export function searchGuidePart(current:OverloadLine[],locks:number,profile:GuideProfile,keyValue:number,pilot=64):Record<GuideMethod,GuidePlan>{
 if(!profile.target.some(Boolean)){const plan=emptyPlan(profile);return {modules:plan,keys:plan,mixed:plan};}
 const best:Partial<Record<GuideMethod,GuidePlan>>={};const permutations=new Set<string>();
 for(const permutation of ORDERS){const target=permutation.map(i=>profile.target[i]!);const signature=target.join('|');if(permutations.has(signature))continue;permutations.add(signature);
  for(const order of ORDERS)for(const mode of ['complete-line','effects-first'] as const){
   const rng=seeded(12345);let effect=0,value=0;
   const transition=Array.from({length:6},()=>({fromModule:0,fromKeys:0,keys:0}));
   for(let trial=0;trial<pilot;trial++){
    const trace:RollStage[]=[];evaluateRoute(current,target,order,locks,rng,mode,'modules',profile.levels,trace);
    if(trace.length>6)throw new Error('작업 단계 수가 모델 범위를 벗어났습니다.');
    trace.forEach((stage,j)=>{const n=bits(stage.locks);if(stage.kind==='effect')effect+=(1+n)*stage.rolls;else value+=(1+n)*stage.rolls;
     transition[j]!.fromModule+=locking(j?trace[j-1]!.locks:locks,stage.locks);transition[j]!.fromKeys+=locking(j?0:locks,stage.locks);transition[j]!.keys+=(n===2?50:n===1?20:0)*stage.rolls;
    });
   }
   for(let schedule=0;schedule<64;schedule++){
    let lock=0,keys=0;for(let j=0;j<6;j++){const t=transition[j]!;if(schedule&(1<<j))keys+=t.keys;else lock+=(j&&(schedule&(1<<(j-1))))?t.fromKeys:t.fromModule;}
    const plan:GuidePlan={target,levels:profile.levels,order,mode,schedule,modules:(lock+effect+value)/pilot,keys:keys/pilot,lock:lock/pilot,effect:effect/pilot,value:value/pilot,error95:0,keyError95:0,samples:pilot};
    for(const method of ['modules','keys','mixed'] as const)if((method==='mixed'||schedule===(method==='modules'?0:63))&&better(plan,best[method],method,keyValue))best[method]=plan;
   }
  }
 }return best as Record<GuideMethod,GuidePlan>;
}
export function refineGuidePart(current:OverloadLine[],locks:number,plan:GuidePlan,samples=4000):GuidePlan{
 if(!plan.target.some(Boolean))return plan;
 const rng=seeded(789123);let modules=0,keys=0,lock=0,effect=0,value=0,m2=0,k2=0;
 for(let i=0;i<samples;i++){const trace:RollStage[]=[];evaluateRoute(current,plan.target,plan.order,locks,rng,plan.mode,'modules',plan.levels,trace);const cost=traceSpend(trace,locks,plan.schedule);modules+=cost.modules;keys+=cost.keys;lock+=cost.lock;effect+=cost.effect;value+=cost.value;m2+=cost.modules**2;k2+=cost.keys**2;}
 const error=(sum:number,sq:number)=>1.96*Math.sqrt(Math.max(0,(sq-sum*sum/samples)/(samples-1))/samples);
 return {...plan,modules:modules/samples,keys:keys/samples,lock:lock/samples,effect:effect/samples,value:value/samples,error95:error(modules,m2),keyError95:error(keys,k2),samples};
}
export function allocateGuideParts(offers:GuideOffer[][],goals:GuideGoal[],method:GuideMethod,keyValue:number):GuideOffer[]{
 let states=new Map<string,{counts:number[];cost:number;modules:number;keys:number;parts:GuideOffer[]}>([[goals.map(()=>0).join(','),{counts:goals.map(()=>0),cost:0,modules:0,keys:0,parts:[]}]]);
 for(const part of offers){
  const bestCount=new Map<string,GuideOffer>();for(const offer of part){const key=offer.profile.counts.join(',');const previous=bestCount.get(key);if(!previous||better(offer.plan,previous.plan,method,keyValue))bestCount.set(key,offer);}
  const next=new Map<string,{counts:number[];cost:number;modules:number;keys:number;parts:GuideOffer[]}>();
  for(const state of states.values())for(const offer of bestCount.values()){
   const counts=state.counts.map((n,i)=>n+offer.profile.counts[i]!);if(counts.some((n,i)=>n>goals[i]!.count))continue;
   const key=counts.join(','),cost=state.cost+score(offer.plan,method,keyValue),old=next.get(key);const modules=state.modules+offer.plan.modules,keys=state.keys+offer.plan.keys;if(!old||better({modules,keys},old,method,keyValue))next.set(key,{counts,cost,modules,keys,parts:[...state.parts,offer]});
  }
  if(next.size>100000)throw new Error('전체 배치 경우의 수가 너무 많습니다. 타협 옵션을 줄여 주세요.');states=next;
 }
 const result=states.get(goals.map(g=>g.count).join(','));if(!result)throw new Error('현재 장비에서 목표를 채울 수 없습니다. 부위별 중복 제한과 장비 원본을 확인해 주세요.');return result.parts;
}
export function solveOverloadGuide(input:GuideInput,progress:(done:number,total:number)=>void=()=>{}):GuideResult{
 if(input.current.length!==4||input.locks.length!==4||!Number.isFinite(input.keyValue)||input.keyValue<1||input.keyValue>10000)throw new Error('장비 4부위와 재화 가중치를 확인해 주세요.');
 for(const [p,rows] of input.current.entries())if(rows.length!==3||rows.some(r=>r.option&&(!OPTION_PROB[r.option]||!Number.isInteger(r.level)||r.level<1||r.level>15))||new Set(rows.filter(r=>r.option).map(r=>r.option)).size!==rows.filter(r=>r.option).length||!Number.isInteger(input.locks[p])||input.locks[p]!<0||input.locks[p]!>7||bits(input.locks[p]!)>2||rows.some((r,i)=>!r.option&&(input.locks[p]!&(1<<i))))throw new Error('현재 옵션·레벨·잠금 정보를 확인해 주세요.');
 const profiles=guideProfiles(input.goals);const unique=[...new Map(profiles.map(p=>[profileKey(p),p])).values()];
 const all:Record<GuideMethod,GuideOffer[][]>={modules:[],keys:[],mixed:[]};let done=0,total=unique.length*4+12;progress(done,total);
 for(let p=0;p<4;p++){
  const cache=new Map<string,Record<GuideMethod,GuidePlan>>();
  for(const profile of unique){if(!profile.target.some(Boolean)||input.current[p]![0]!.option)cache.set(profileKey(profile),searchGuidePart(input.current[p]!,input.locks[p]!,profile,input.keyValue));progress(++done,total);}
  for(const method of ['modules','keys','mixed'] as const)all[method].push(profiles.flatMap(profile=>{const found=cache.get(profileKey(profile));return found?[{profile,plan:found[method]}]:[];}));
 }
 const methods={} as GuideResult['methods'];
 for(const method of ['modules','keys','mixed'] as const){const parts=allocateGuideParts(all[method],input.goals,method,input.keyValue).map((offer,p)=>{const plan=refineGuidePart(input.current[p]!,input.locks[p]!,offer.plan);progress(++done,total);return {...offer,plan};});methods[method]={parts,modules:parts.reduce((s,p)=>s+p.plan.modules,0),keys:parts.reduce((s,p)=>s+p.plan.keys,0),error95:parts.reduce((s,p)=>s+p.plan.error95,0),keyError95:parts.reduce((s,p)=>s+p.plan.keyError95,0)};}
 for(const endpoint of [methods.modules,methods.keys])if(score(endpoint,'mixed',input.keyValue)<score(methods.mixed,'mixed',input.keyValue))methods.mixed=endpoint;
 return {methods,profileCount:unique.length,keyValue:input.keyValue};
}
