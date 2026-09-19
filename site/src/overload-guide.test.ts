// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {openOverloadGuide} from './overload-guide';
import type {SettingsCatalog} from './types';
it('opens an isolated target dialog, includes alternatives and cancels its worker',()=>{
 localStorage.clear();
 const terminate=vi.fn(),postMessage=vi.fn();vi.stubGlobal('Worker',class{terminate=terminate;postMessage=postMessage;});
 const settings={overloadFields:{atk_pct:{label:'공격력'},crit_dmg:{label:'크리티컬 대미지'}},overloadSteps:{atk_pct:Array.from({length:15},(_,i)=>i+1),crit_dmg:Array.from({length:15},(_,i)=>i+1)}} as unknown as SettingsCatalog;
 openOverloadGuide('테스트',settings,{overload:{atk_pct:1},overloadLines:{머리:[{option:'atk_pct',level:1}]}});
 const level=document.querySelector<HTMLSelectElement>('select[aria-label="공격력 최소 레벨"]')!;expect(level.value).toBe('15');
 const alternative=document.querySelector<HTMLInputElement>('input[aria-label="공격력 대신 크리티컬 대미지"]')!;alternative.click();
 const bulk=document.querySelector<HTMLSelectElement>('select[aria-label="옵작 가이드 모든 최소 레벨"]')!;bulk.value='10';bulk.dispatchEvent(new Event('change'));expect(level.value).toBe('10');
 document.querySelector<HTMLButtonElement>('.og-primary')!.click();expect(postMessage.mock.calls[0]![0].goals[0]).toMatchObject({count:1,level:10,alternatives:['crit_dmg']});
 [...document.querySelectorAll<HTMLButtonElement>('.og-dialog button')].find(b=>b.textContent==='계산 취소')!.click();expect(terminate).toHaveBeenCalledOnce();
 [...document.querySelectorAll<HTMLButtonElement>('.og-dialog button')].find(b=>b.textContent==='닫기')!.click();expect(document.querySelector('.og-overlay')).toBeNull();
 openOverloadGuide('테스트',settings,{overload:{atk_pct:1},overloadLines:{머리:[{option:'atk_pct',level:1}]}});
 expect(document.querySelector<HTMLSelectElement>('select[aria-label="공격력 최소 레벨"]')!.value).toBe('10');
 expect(document.querySelector<HTMLInputElement>('input[aria-label="공격력 대신 크리티컬 대미지"]')!.checked).toBe(true);
 [...document.querySelectorAll<HTMLButtonElement>('.og-dialog button')].find(b=>b.textContent==='닫기')!.click();vi.unstubAllGlobals();
});
it('skips effect search for a matching existing second line',()=>{
 localStorage.clear();let worker:any;
 vi.stubGlobal('Worker',class{onmessage:any;terminate(){}postMessage(){}constructor(){worker=this;}});
 const settings={overloadFields:{atk_pct:{label:'공격력'},element_bonus:{label:'우월 코드 대미지'}},overloadSteps:{atk_pct:Array.from({length:15},(_,i)=>i+1),element_bonus:Array.from({length:15},(_,i)=>i+1)}} as unknown as SettingsCatalog;
 openOverloadGuide('테스트',settings,{overload:{atk_pct:1,element_bonus:1},overloadLines:{머리:[{option:'atk_pct',level:1},{option:'element_bonus',level:1}]}});
 document.querySelector<HTMLButtonElement>('.og-primary')!.click();
 const offer={profile:{target:['element_bonus','',''],levels:{element_bonus:15},counts:[0,1],assignments:[1]},plan:{target:['','element_bonus',''],levels:{element_bonus:15},order:[1,0,2],mode:'complete-line',schedule:0,modules:100,keys:0,effect:0,value:100,lock:0,error95:0,keyError95:0}};
 const answer={parts:[offer],modules:100,keys:0,error95:0,keyError95:0};
 worker.onmessage({data:{result:{profileCount:1,keyValue:20,methods:{modules:answer,keys:answer,mixed:answer}}}});
 const output=document.querySelector('.og-results')!.textContent!;
 expect(output).not.toContain('‘효과변경’');expect(output).not.toContain('잠금을 모두 해제');expect(output).toContain('2번 줄이 Lv.15');
 [...document.querySelectorAll<HTMLButtonElement>('.og-dialog button')].find(b=>b.textContent==='닫기')!.click();vi.unstubAllGlobals();
});
