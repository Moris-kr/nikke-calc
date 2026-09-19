import type {OverloadLine} from './types';
export const OPTION_PROB:Record<string,number>={element_bonus:.10,atk_pct:.10,crit_dmg:.10,def_pct:.10,max_ammo_pct:.12,accuracy_pct:.12,charge_dmg_pct:.12,charge_speed_pct:.12,crit_rate:.12};
export const LEVEL_PROB=Array.from({length:15},(_,i)=>i<5?.12:i<10?.07:.01);
export const APPEARANCE=[1,.5,.3];
export const ORDERS=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
export type LockCurrency = 'modules'|'keys';
export interface ModuleRoute {currency:LockCurrency;effect:number;value:number;keys:number;mode:'complete-line'|'effects-first';target:string[];order:number[];lock:number;change:number;total:number;error95:number;samples:number;unlocked:number[]}
export const seeded=(seed:number)=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
const count=(mask:number)=>[0,1,2].filter(i=>mask&(1<<i)).length;
interface Outcome{options:string[];prob:number}
const distributions=new Map<string,Outcome[]>();
export function effectOutcomes(current:OverloadLine[],locks:number):Outcome[]{
  const key=current.map((row,i)=>locks&(1<<i)?row.option:'').join('|');
  const found=distributions.get(key);if(found)return found;
  const fixed=current.filter((_,i)=>locks&(1<<i)).map(row=>row.option);const outcomes:Outcome[]=[];
  function visit(slot:number,options:string[],used:string[],prob:number){
    if(slot===3){outcomes.push({options,prob});return;}
    if(locks&(1<<slot)){visit(slot+1,[...options,current[slot]!.option],used,prob);return;}
    const appear=APPEARANCE[slot]!;
    if(appear<1)visit(slot+1,[...options,''],used,prob*(1-appear));
    const allowed=Object.entries(OPTION_PROB).filter(([key])=>!used.includes(key));
    const total=allowed.reduce((sum,[,weight])=>sum+weight,0);
    for(const [effect,weight] of allowed)visit(slot+1,[...options,effect],[...used,effect],prob*appear*weight/total);
  }
  visit(0,[],fixed,1);distributions.set(key,outcomes);return outcomes;
}
function pick<T>(items:T[],weight:(item:T)=>number,rng:()=>number):T{
  let ticket=rng()*items.reduce((sum,item)=>sum+weight(item),0);
  for(const item of items){ticket-=weight(item);if(ticket<0)return item;}
  return items[items.length-1]!;
}
function level(rng:()=>number,old?:number,excludeMax=false):number{
  const levels=LEVEL_PROB.map((_,i)=>i+1).filter(lv=>lv!==old&&(!excludeMax||lv!==15));
  return pick(levels,lv=>LEVEL_PROB[lv-1]!,rng);
}
const conditional=new Map<string,{outcomes:Outcome[];prob:number}>();
/** A complete-line-first policy. Waiting time is integrated analytically; only successful outcomes are sampled. */
export function evaluateRoute(initial:OverloadLine[],target:string[],order:number[],initialLocks:number,rng:()=>number,mode:'complete-line'|'effects-first'='complete-line',currency:LockCurrency='modules'):{lock:number;change:number;effect:number;value:number;keys:number}{
  const state=initial.map(row=>({...row}));let locks=currency==='keys'?0:initialLocks;let lock=0,change=0,effect=0,value=0,keys=0;
  const charge=(rolls:number,kind:'effect'|'value')=>{const n=count(locks),modules=(1+n)*rolls;change+=modules;if(kind==='effect')effect+=modules;else value+=modules;if(currency==='keys')keys+=(n===2?50:n===1?20:0)*rolls;};
  const done=(i:number)=>state[i]!.option===target[i]&&(mode==='effects-first'||state[i]!.level===15);
  for(let i=0;i<3;i++)if(!done(i))locks&=~(1<<i);
  for(const slot of order){
    if(order.every(done))break;
    if(locks&(1<<slot))continue;
    if(state[slot]!.option!==target[slot]){
      const key=state.map((row,i)=>locks&(1<<i)?row.option:'').join('|')+`:${slot}:${target[slot]}`;
      let dist=conditional.get(key);
      if(!dist){const outcomes=effectOutcomes(state,locks).filter(outcome=>outcome.options[slot]===target[slot]);dist={outcomes,prob:outcomes.reduce((sum,o)=>sum+o.prob,0)};conditional.set(key,dist);}
      if(!(dist.prob>0))throw new Error('잠금 상태에서 목표 효과가 등장할 수 없습니다.');
      charge(1/dist.prob,'effect');
      const outcome=pick(dist.outcomes,o=>o.prob,rng);
      for(let i=0;i<3;i++)if(!(locks&(1<<i))){const old=state[i]!;const option=outcome.options[i]!;state[i]={option,level:option?level(rng,option===old.option?old.level:undefined):1};}
    }
    if(mode==='complete-line'&&state[slot]!.level!==15){
      // Retain the old result on failure. No-identical redraw renormalizes away the old tier.
      charge((1-LEVEL_PROB[state[slot]!.level-1]!)/LEVEL_PROB[14]!,'value');
      for(let i=0;i<3;i++)if(!(locks&(1<<i))&&state[i]!.option)state[i]!.level=i===slot?15:level(rng,state[i]!.level);
    }
    if(!order.every(done)){if(currency==='modules')lock+=count(locks)+1;locks|=1<<slot;}
  }
  if(mode==='effects-first'){
    // Once effects are complete, release low-value locks. Secure every Lv.15 result;
    // accept a value reset only when it produces at least one new Lv.15 line.
    for(let i=0;i<3;i++)if(state[i]!.level!==15)locks&=~(1<<i);
    while(state.some(row=>row.level!==15)){
      for(let i=0;i<3;i++)if(state[i]!.level===15&&!(locks&(1<<i))){if(currency==='modules')lock+=count(locks)+1;locks|=1<<i;}
      const remaining=[0,1,2].filter(i=>!(locks&(1<<i)));
      const probability=(i:number)=>.01/(1-LEVEL_PROB[state[i]!.level-1]!);
      const outcomes:{mask:number;prob:number}[]=[];
      for(let bits=1;bits<(1<<remaining.length);bits++){
        let prob=1;for(let j=0;j<remaining.length;j++){const q=probability(remaining[j]!);prob*=bits&(1<<j)?q:1-q;}
        outcomes.push({mask:bits,prob});
      }
      charge(1/outcomes.reduce((sum,outcome)=>sum+outcome.prob,0),'value');
      const chosen=pick(outcomes,outcome=>outcome.prob,rng);
      remaining.forEach((i,j)=>{state[i]!.level=chosen.mask&(1<<j)?15:level(rng,state[i]!.level,true);});
    }
  }
  return {lock,change,effect,value,keys};
}
export function estimateModules(current:OverloadLine[],options:string[],initialLocks=0,samples=4000,currency:LockCurrency='modules'):ModuleRoute{
  if(!['modules','keys'].includes(currency))throw new Error('잠금 재화가 올바르지 않습니다.');
  if(current.length!==3||options.length!==3||options.some(option=>!OPTION_PROB[option])||new Set(options).size!==3)throw new Error('모듈 분석은 부위마다 서로 다른 목표 효과 3줄이 필요합니다.');
  if(!current[0]?.option||new Set(current.filter(row=>row.option).map(row=>row.option)).size!==current.filter(row=>row.option).length)throw new Error('현재 장비의 첫 줄과 중복 효과를 확인해 주세요. 최초 오버로드 전환은 분석에 포함하지 않습니다.');
  if(current.some(row=>row.option&&(!OPTION_PROB[row.option]||!Number.isInteger(row.level)||row.level<1||row.level>15)))throw new Error('현재 옵션·레벨을 확인해 주세요.');
  if(!Number.isInteger(initialLocks)||initialLocks<0||initialLocks>7||current.some((row,i)=>(initialLocks&(1<<i))&&!row.option))throw new Error('빈 옵션은 잠글 수 없습니다.');
  if(!Number.isInteger(samples)||samples<2||samples>100000)throw new Error('표본 수가 올바르지 않습니다.');
  const run=(target:string[],order:number[],n:number,seed:number,mode:ModuleRoute['mode'])=>{
    const rng=seeded(seed);let lock=0,change=0,effect=0,value=0,keys=0,sum2=0;
    for(let i=0;i<n;i++){const cost=evaluateRoute(current,target,order,initialLocks,rng,mode,currency);lock+=cost.lock;change+=cost.change;effect+=cost.effect;value+=cost.value;keys+=cost.keys;sum2+=(cost.lock+cost.change)**2;}
    const total=(lock+change)/n;
    return {currency,effect:effect/n,value:value/n,keys:keys/n,mode,target,order,lock:lock/n,change:change/n,total,error95:n>1?1.96*Math.sqrt(Math.max(0,(sum2-n*total*total)/(n-1))/n):0,samples:n,
      unlocked:[0,1,2].filter(i=>(initialLocks&(1<<i))&&(currency==='keys'||current[i]!.option!==target[i]||current[i]!.level!==15))};
  };
  let best:ModuleRoute|undefined;
  // Independent pilot and evaluation samples avoid reporting the selection minimum as an unbiased estimate.
  for(const permutation of ORDERS)for(const order of ORDERS)for(const mode of ['complete-line','effects-first'] as const){const target=permutation.map(i=>options[i]!);const candidate=run(target,order,96,12345,mode);if(!best||candidate.total<best.total)best=candidate;}
  return run(best!.target,best!.order,samples,789123,best!.mode);
}
