import {solveOverloadGuide,type GuideInput} from './overload-guide-model';
self.onmessage=(event:MessageEvent<GuideInput>)=>{try{const result=solveOverloadGuide(event.data,(done,total)=>self.postMessage({progress:{done,total}}));self.postMessage({result});}catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}};
