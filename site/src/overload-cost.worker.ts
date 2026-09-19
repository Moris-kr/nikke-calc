import {estimateModules} from './overload-cost';
import type {OverloadLine} from './types';
self.onmessage=(event:MessageEvent<{current:OverloadLine[];target:string[];locks:number}>)=>{
 try{self.postMessage({result:estimateModules(event.data.current,event.data.target,event.data.locks)});}catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
