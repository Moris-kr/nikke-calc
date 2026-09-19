import {it,expect} from 'vitest';
import {createModulePacket,parseModuleResult,modulePrompt} from './overload-external';
const job={id:'a',current:[{option:'atk_pct',level:15},{option:'element_bonus',level:15},{option:'crit_dmg',level:1}],target:['atk_pct','element_bonus','crit_dmg'],locks:3};
it('binds external results to the request, model, complete job set and numeric totals',()=>{
 const packet=createModulePacket([job]);const row={id:'a',mode:'complete-line',target:job.target,order:[0,1,2],lock:0,change:264,total:264,error95:0,samples:4000,unlocked:[]};
 const value={format:'nikke-overload-result',version:1,model:packet.model,requestId:packet.requestId,results:[row]};
 expect(parseModuleResult(JSON.stringify(value),packet).get('a')!.total).toBe(264);
 expect(()=>parseModuleResult(JSON.stringify({...value,requestId:'old'}),packet)).toThrow();
 expect(()=>parseModuleResult(JSON.stringify({...value,results:[{...row,total:2}]}),packet)).toThrow();
 expect(()=>parseModuleResult(JSON.stringify({...value,results:[]}),packet)).toThrow();
 expect(modulePrompt(packet)).toContain('node solver.mjs < job.json');
 expect(modulePrompt(packet)).toContain('estimateModules');
});
