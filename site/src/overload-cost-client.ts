import type {OverloadLine} from './types';
import type {ModuleRoute} from './overload-cost';
export function analyzeModulePart(current:OverloadLine[],target:string[],locks:number,currency:'modules'|'keys'='modules',levels:Record<string,number>={}):Promise<ModuleRoute>{
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./overload-cost.worker.ts',import.meta.url),{type:'module'});
  const timer=setTimeout(()=>{worker.terminate();reject(new Error('모듈 분석 시간이 초과되었습니다. 다시 시도해 주세요.'));},120000);
  const finish=()=>{clearTimeout(timer);worker.terminate();};
  worker.onmessage=event=>{finish();if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.result);};
  worker.onerror=event=>{finish();reject(new Error(event.message||'모듈 분석 작업 오류'));};
  worker.postMessage({current,target,locks,currency,levels});
 });
}
/** Drain started work before reporting an error; never leave background work writing into a new run. */
export async function mapLimited<T,R>(items:T[],limit:number,run:(item:T,index:number)=>Promise<R>):Promise<R[]>{
 let next=0,error:unknown;const results:R[]=[];
 await Promise.all(Array.from({length:Math.max(1,Math.min(items.length,Math.trunc(limit)||1))},async()=>{
  while(next<items.length&&!error){const index=next++;try{results[index]=await run(items[index]!,index);}catch(reason){error=reason||new Error('계산 실패');}}
 }));
 if(error)throw error;return results;
}
