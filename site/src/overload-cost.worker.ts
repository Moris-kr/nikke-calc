import {estimateModules} from './overload-cost';
import type {OverloadLine} from './types';
self.onmessage=(event:MessageEvent<{current:OverloadLine[];target:string[];locks:number;currency?:'modules'|'keys';levels?:Record<string,number>}>)=>{
 try{self.postMessage({result:estimateModules(event.data.current,event.data.target,event.data.locks,4000,event.data.currency,event.data.levels)});}catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
