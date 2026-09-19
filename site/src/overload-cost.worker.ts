import {estimateModules} from './overload-cost';
import type {OverloadLine} from './types';
self.onmessage=(event:MessageEvent<{current:OverloadLine[];target:string[];locks:number;currency?:'modules'|'keys';levels?:Record<string,number>}>)=>{
 try{if(event.data.target.filter(Boolean).length!==3)throw new Error('육성효율 계산은 부위마다 목표 효과 3줄이 필요합니다. 부분 목표는 옵작 가이드를 이용해 주세요.');self.postMessage({result:estimateModules(event.data.current,event.data.target,event.data.locks,4000,event.data.currency,event.data.levels)});}catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
