// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {openOverloadGuide} from './overload-guide';
import type {SettingsCatalog} from './types';
it('opens an isolated target dialog, includes alternatives and cancels its worker',()=>{
 const terminate=vi.fn(),postMessage=vi.fn();vi.stubGlobal('Worker',class{terminate=terminate;postMessage=postMessage;});
 const settings={overloadFields:{atk_pct:{label:'공격력'},crit_dmg:{label:'크리티컬 대미지'}},overloadSteps:{atk_pct:Array.from({length:15},(_,i)=>i+1),crit_dmg:Array.from({length:15},(_,i)=>i+1)}} as unknown as SettingsCatalog;
 openOverloadGuide('테스트',settings,{overload:{atk_pct:1},overloadLines:{머리:[{option:'atk_pct',level:1}]}});
 const level=document.querySelector<HTMLSelectElement>('select[aria-label="공격력 최소 레벨"]')!;expect(level.value).toBe('15');
 const alternative=document.querySelector<HTMLInputElement>('input[aria-label="공격력 대신 크리티컬 대미지"]')!;alternative.click();
 const bulk=document.querySelector<HTMLSelectElement>('select[aria-label="옵작 가이드 모든 최소 레벨"]')!;bulk.value='10';bulk.dispatchEvent(new Event('change'));expect(level.value).toBe('10');
 document.querySelector<HTMLButtonElement>('.og-primary')!.click();expect(postMessage.mock.calls[0]![0].goals[0]).toMatchObject({count:1,level:10,alternatives:['crit_dmg']});
 [...document.querySelectorAll<HTMLButtonElement>('.og-dialog button')].find(b=>b.textContent==='계산 취소')!.click();expect(terminate).toHaveBeenCalledOnce();
 [...document.querySelectorAll<HTMLButtonElement>('.og-dialog button')].find(b=>b.textContent==='닫기')!.click();expect(document.querySelector('.og-overlay')).toBeNull();vi.unstubAllGlobals();
});
