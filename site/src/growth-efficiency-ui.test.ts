// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { growthLabel, openGrowthEfficiency, openGrowthReportPreview } from './growth-efficiency-ui';
import { skillManualIIIUnits } from './growth-report';
import type { BatchResult, SettingsCatalog, SimulationRequest, SimulationResult } from './types';
const steps = Array.from({length:15},(_,i)=>i+1);
const settingsTemplate = {overloadSteps:{atk:steps,ammo:steps},overloadFields:{atk:{label:'공격력'},ammo:{label:'장탄'}},characters:{A:{overload:{atk:2}}}} as unknown as SettingsCatalog;
let settings:SettingsCatalog;
beforeEach(()=>{localStorage.clear();settings=structuredClone(settingsTemplate);});
const request = {squad:['A'],characters:{A:{overload:{atk:2}}},duration:180,enemyDef:63000,enemyCode:'작열',corePx:52,hasParts:false,seed:42,rngMode:'expected',defenseRateWindows:[{start:30,end:60,rate:50}]} as unknown as SimulationRequest;
const batch = {total:100,decks:[{deckId:1,request,result:{squadTotal:100,charTotals:{A:100}}}]} as unknown as BatchResult;
const result = (n:number)=>({squadTotal:n,charTotals:{A:n}} as unknown as SimulationResult);
const close=()=>document.querySelector<HTMLButtonElement>('.growth-close')?.click();
afterEach(()=>{close();vi.restoreAllMocks();});
describe('growth efficiency dialog',()=>{
 it('restores counts and excluded state in a new comparison',()=>{
  const deps={settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate:vi.fn()};
  openGrowthEfficiency(batch,deps);
  const count=document.querySelector<HTMLSelectElement>('select[aria-label="덱 1 A 공격력 목표 줄 수"]')!;count.value='4';count.dispatchEvent(new Event('change'));
  document.querySelector<HTMLButtonElement>('.growth-exclude')!.click();close();
  const next=structuredClone(batch);next.decks[0]!.request.duration=90;openGrowthEfficiency(next,deps);
  expect(document.querySelector<HTMLSelectElement>('select[aria-label="덱 1 A 공격력 목표 줄 수"]')!.value).toBe('4');
  expect(document.querySelector<HTMLElement>('.growth-character')!.dataset.excluded).toBe('true');
  expect(document.querySelector<HTMLButtonElement>('.growth-exclude')!.disabled).toBe(false);
  document.querySelector<HTMLButtonElement>('.growth-exclude')!.click();
  expect(document.querySelector<HTMLSelectElement>('select[aria-label="덱 1 A 공격력 목표 줄 수"]')!.disabled).toBe(false);
 });
 it('persists per-character target options and levels across new sessions and resets them',()=>{
  const deps={settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate:vi.fn()};
  openGrowthEfficiency(batch,deps);
  const pick=()=>document.querySelector<HTMLSelectElement>('select[aria-label="덱 1 A 장탄 목표 줄 수"]')!;
  pick().value='1';pick().dispatchEvent(new Event('change'));
  const level=document.querySelector<HTMLSelectElement>('select[aria-label="덱 1 A 장탄 수치작 타협레벨"]')!;level.value='10';level.dispatchEvent(new Event('change'));
  close();const next=structuredClone(batch);next.decks[0]!.request.duration=60;openGrowthEfficiency(next,deps);
  expect(pick().value).toBe('1');
  expect(document.querySelector<HTMLSelectElement>('select[aria-label="덱 1 A 장탄 수치작 타협레벨"]')!.value).toBe('10');
  document.querySelector<HTMLButtonElement>('button[aria-label="덱 1 A 목표 옵션 리셋"]')!.click();
  expect(pick().value).toBe('0');expect(localStorage.getItem('nikke-growth-target:v1:A')).toBeNull();
  expect(document.querySelector<HTMLSelectElement>('select[aria-label="덱 1 A 장탄 수치작 타협레벨"]')!.value).toBe('15');
 });
 it('restores targets and completed results on reopen without running simulations again',async()=>{
  HTMLElement.prototype.scrollIntoView=vi.fn();
  const simulate=vi.fn().mockResolvedValue(result(120));
  const deps={settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate};
  openGrowthEfficiency(batch,deps);
  const skill=document.querySelector<HTMLSelectElement>('select[aria-label="덱 1 A 목표 스킬1"]')!;skill.value='7';skill.dispatchEvent(new Event('change'));
  document.querySelector<HTMLButtonElement>('.growth-primary')!.click();
  await vi.waitFor(()=>expect(document.querySelector('.growth-global-priority')).not.toBeNull());
  const output=document.querySelector('.growth-output')!.textContent;
  close();expect(document.querySelector('.growth-overlay')).toBeNull();
  openGrowthEfficiency(structuredClone(batch),deps);
  expect(document.querySelector('.growth-output')!.textContent).toBe(output);
  expect(document.querySelector<HTMLSelectElement>('select[aria-label="덱 1 A 목표 스킬1"]')!.value).toBe('7');
  expect(simulate).toHaveBeenCalledTimes(2);
  close();const different=structuredClone(batch);different.decks[0]!.request.duration=60;openGrowthEfficiency(different,deps);
  expect(document.querySelector('.growth-output')!.textContent).toBe('');
 });
 it('continues in-flight calculations while closed and restores the completed result',async()=>{
  const simulate=vi.fn().mockImplementationOnce(()=>new Promise<SimulationResult>(resolve=>{finish=resolve;})).mockResolvedValue(result(120));
  let finish!:(value:SimulationResult)=>void;
  const deps={settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate};
  openGrowthEfficiency(batch,deps);document.querySelector<HTMLButtonElement>('.growth-primary')!.click();close();
  finish(result(100));await vi.waitFor(()=>expect(simulate).toHaveBeenCalledTimes(2));
  openGrowthEfficiency(batch,deps);
  await vi.waitFor(()=>expect(document.querySelector('.growth-status')?.textContent).toContain('100%'));
  expect(document.querySelector('.growth-global-priority')).not.toBeNull();
  expect(simulate).toHaveBeenCalledTimes(2);
 });
 it('uses the faster global ranking by default and computes deck synergy only on click',async()=>{
  HTMLElement.prototype.scrollIntoView=vi.fn();
  const many=structuredClone(batch);many.decks[0]!.request.squad=['A','B','C'];
  for(const name of ['B','C'])many.decks[0]!.request.characters![name]={overload:{atk:2}};
  const totals:Record<string,number>={'':100,A:120,B:110,C:115,AB:160,AC:140,BC:130,ABC:170};
  const simulate=vi.fn(async(request:SimulationRequest)=>result(totals[Object.entries(request.characters!).filter(([,v])=>v.overload?.atk===15).map(([k])=>k).sort().join('')]!));
  openGrowthEfficiency(many,{settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate});
  const cost=document.querySelector<HTMLInputElement>('input[aria-label="모듈 가성비 분석"]')!;expect(cost.checked).toBe(true);cost.checked=false;cost.dispatchEvent(new Event('change'));
  document.querySelector<HTMLButtonElement>('.growth-primary')!.click();
  await vi.waitFor(()=>expect(document.querySelector('.growth-status')?.textContent).toContain('100% · 5/5회 완료'));
  expect(simulate).toHaveBeenCalledTimes(5);
  expect([...document.querySelectorAll('.growth-global-priority li strong')].map(el=>el.textContent)).toEqual(['덱 1 · A','덱 1 · C','덱 1 · B']);
  expect(document.querySelector('.growth-priority')).toBeNull();
  document.querySelector<HTMLButtonElement>('.growth-priority-button')!.click();
  await vi.waitFor(()=>expect(document.querySelector('.growth-status')?.textContent).toContain('100% · 2/2회 완료'));
  expect(simulate).toHaveBeenCalledTimes(7);
  expect([...document.querySelectorAll('.growth-priority li strong')].map(el=>el.textContent?.split(' · ')[0])).toEqual(['A','B','C']);
  expect(document.querySelector<HTMLProgressElement>('.growth-progress')!.value).toBe(100);
 });
 it('previews without downloading and downloads only on request, releasing the image when closed', () => {
  const create = vi.fn(()=>'blob:test'); const revoke = vi.fn();
  vi.stubGlobal('URL', {createObjectURL:create,revokeObjectURL:revoke});
  const click = vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  const done = vi.fn(); const dismiss = openGrowthReportPreview(new Blob(['png']), done);
  expect(document.querySelector('.growth-report-image')?.getAttribute('src')).toBe('blob:test');
  expect(click).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('.growth-report-dialog .growth-primary')!.click();
  expect(click).toHaveBeenCalledOnce();
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
  expect(document.querySelector('.growth-report-overlay')).toBeNull();
  expect(revoke).toHaveBeenCalledWith('blob:test');
  dismiss(); expect(done).toHaveBeenCalledOnce(); vi.unstubAllGlobals();
 });
 it('labels personal gains and decreases accurately', () => {
  expect(growthLabel(100,120)).toBe('풀 육성 시 20.00% 상승');
  expect(growthLabel(100,80)).toBe('풀 육성 시 20.00% 감소');
  expect(growthLabel(0,80)).toContain('계산 불가');
  expect(growthLabel(100,120,1000)).toBe('풀 육성 시 20.00% 상승 · 총딜 대비 2.00% (20) 상승');
  expect(growthLabel(100,80,1000)).toContain('총딜 대비 2.00% (20) 감소');
  expect(growthLabel(0,80,1000)).toContain('총딜 대비 8.00% (80) 상승');
  expect(growthLabel(0,80,0)).toContain('총딜 대비 비율 계산 불가 (80) 상승');
 });
 it('recalculates both sides with the saved conditions and invalidates edited reports',async()=>{
  HTMLElement.prototype.scrollIntoView=vi.fn();
  const simulate=vi.fn().mockResolvedValueOnce(result(100)).mockResolvedValueOnce(result(120));
  openGrowthEfficiency(batch,{settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate});
  expect(document.querySelectorAll('.growth-part')).toHaveLength(4);
  expect(document.querySelector<HTMLSelectElement>('.growth-line select')?.value).toBe('atk');
  document.querySelector<HTMLButtonElement>('.growth-primary')!.click();
  await vi.waitFor(()=>expect(document.querySelector('.growth-gain')?.textContent).toBe('+20.00%'));
  expect(simulate).toHaveBeenCalledTimes(2);
  expect(simulate.mock.calls[0]![0]).toEqual(request);
  expect(simulate.mock.calls[1]![0].defenseRateWindows).toEqual(request.defenseRateWindows);
  expect(simulate.mock.calls[1]![0].characters.A.overload).toEqual({atk:15});
  expect(batch.decks[0]!.request.characters!.A!.overload).toEqual({atk:2});
  const select=document.querySelector<HTMLSelectElement>('select[aria-label="덱 1 A 장탄 목표 줄 수"]')!;select.value='1';select.dispatchEvent(new Event('change'));
  expect(document.querySelector('.growth-output')?.textContent).toBe('');
  expect(document.querySelector<HTMLButtonElement>('footer .growth-secondary')?.disabled).toBe(true);
 });
 it('requires acknowledgment for absent or stale part information',()=>{
  const simulate=vi.fn();
  openGrowthEfficiency(batch,{settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:4}]}}),simulate});
  expect(document.querySelector('.growth-character')?.textContent).toContain('부위 정보 없음');
  document.querySelector<HTMLButtonElement>('.growth-primary')!.click();
  expect(simulate).not.toHaveBeenCalled();
  expect(document.querySelector('.growth-status')?.textContent).toContain('확인란');
 });
 it('collapses excluded characters, preserves their build, and restores target controls',async()=>{
  HTMLElement.prototype.scrollIntoView=vi.fn();
  const simulate=vi.fn().mockResolvedValue(result(100));
  openGrowthEfficiency(batch,{settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>undefined,simulate});
  const toggle=document.querySelector<HTMLButtonElement>('.growth-exclude')!;
  toggle.click();
  expect(document.querySelector<HTMLDetailsElement>('.growth-character')?.open).toBe(false);
  document.querySelector<HTMLButtonElement>('.growth-primary')!.click();
  await vi.waitFor(()=>expect(simulate).toHaveBeenCalledTimes(2));
  expect(simulate.mock.calls[1]![0].characters).toEqual(request.characters);
  expect(document.querySelector('.growth-output')?.textContent).toContain('육성 제외');
  expect(document.querySelector('.growth-output')?.textContent).not.toContain('옵션 괴리');
  expect(document.querySelector<HTMLSelectElement>('.growth-stage select')?.disabled).toBe(true);
  toggle.click();
  expect(document.querySelector<HTMLDetailsElement>('.growth-character')?.open).toBe(true);
  expect(document.querySelector<HTMLSelectElement>('.growth-stage select')?.disabled).toBe(false);
 });
 it('starts at the current breakthrough and sends the chosen target',async()=>{
  const configured=structuredClone(settings);
  configured.characters.A!.growthStage=2;
  configured.characters.A!.growthOptions=[{value:2,label:'2돌',affinity:30},{value:10,label:'코강 7',affinity:30}];
  const simulate=vi.fn().mockResolvedValue(result(100));
  openGrowthEfficiency(batch,{settings:configured,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate});
  const stage=document.querySelector<HTMLSelectElement>('.growth-stage select')!;
  expect(stage.value).toBe('2'); stage.value='10';stage.dispatchEvent(new Event('change'));
  document.querySelector<HTMLButtonElement>('.growth-primary')!.click();
  await vi.waitFor(()=>expect(simulate).toHaveBeenCalledTimes(2));
  expect(simulate.mock.calls[1]![0].characters.A.growthStage).toBe(10);
  expect(document.querySelector('.growth-output')?.textContent).toContain('목표 코강 7');
 });
 it('clears incomplete comparisons after failure',async()=>{
  const simulate=vi.fn().mockResolvedValueOnce(result(100)).mockRejectedValueOnce(new Error('시험 오류'));
  openGrowthEfficiency(batch,{settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate});
  document.querySelector<HTMLButtonElement>('.growth-primary')!.click();
  await vi.waitFor(()=>expect(document.querySelector('.growth-status')?.textContent).toContain('시험 오류'));
  expect(document.querySelector<HTMLButtonElement>('footer .growth-secondary')?.disabled).toBe(true);
  expect(document.querySelector<HTMLSelectElement>('.growth-line select')?.disabled).toBe(true);
 });
 it('sends chosen skills, collection and equipment while preserving the current build',async()=>{
  const configured=structuredClone(settings); configured.collectionStages=['없음','SR0','SR15'];
  configured.characters.A!.collection={stage:'SR0',favorite:0};
  configured.characters.A!.skillLevels={'1':4,'2':5,'3':6};
  const simulate=vi.fn().mockResolvedValue(result(100));
  openGrowthEfficiency(batch,{settings:configured,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate});
  const select=(label:string,value:string)=>{const el=document.querySelector<HTMLSelectElement>(`select[aria-label="덱 1 A ${label}"]`)!;el.value=value;el.dispatchEvent(new Event('change'));};
  expect(document.querySelector<HTMLSelectElement>('select[aria-label="덱 1 A 목표 스킬1"]')!.value).toBe('4');
  select('목표 스킬1','10');select('목표 스킬2','9');select('목표 버스트','8');select('목표 소장품','stage:SR15');select('머리 목표 장비레벨','3');
  document.querySelector<HTMLButtonElement>('.growth-primary')!.click();
  await vi.waitFor(()=>expect(simulate).toHaveBeenCalledTimes(2));
  expect(simulate.mock.calls[1]![0].characters.A).toMatchObject({skillLevels:{'1':10,'2':9,'3':8},collection:{stage:'SR15',favorite:0},equipLevels:{머리:3}});
  expect(simulate.mock.calls[0]![0]).toEqual(request);
 });
});

it('전체 덱 스킬칩 가성비 — 스킬만 목표로 올린 딜 증가를 매뉴얼 III 환산 개수로 나눠 모듈 가성비 위에 보인다',async()=>{
  const name='신 : 스위프트 바니';
  const configured=structuredClone(settings);
  configured.characters={[name]:{overload:{atk:2},skillLevels:{'1':4,'2':5,'3':6}}} as unknown as SettingsCatalog['characters'];
  const req={...structuredClone(request),squad:[name],characters:{[name]:{overload:{atk:2},skillLevels:{'1':4,'2':5,'3':6}}}} as unknown as SimulationRequest;
  const b={total:100,decks:[{deckId:1,request:req,result:{squadTotal:100,charTotals:{[name]:100}}}]} as unknown as BatchResult;
  // 현재 100 → 목표 육성 150 → 스킬만 올린 판 130.
  const simulate=vi.fn().mockImplementation(async(r:SimulationRequest)=>{
    const lv=r.characters?.[name]?.skillLevels;
    const n=lv?.['1']===10&&!r.characters?.[name]?.equipLevels?.머리?(JSON.stringify(r.characters?.[name]?.overload)===JSON.stringify({atk:2})?130:150):100;
    return {squadTotal:n,charTotals:{[name]:n}} as unknown as SimulationResult;
  });
  openGrowthEfficiency(b,{settings:configured,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:2}]},skillLevels:{'1':4,'2':5,'3':6}}),simulate});
  const select=(label:string,value:string)=>{const el=document.querySelector<HTMLSelectElement>(`select[aria-label="덱 1 ${name} ${label}"]`)!;el.value=value;el.dispatchEvent(new Event('change'));};
  select('목표 스킬1','10');select('목표 스킬2','10');select('목표 버스트','10');
  document.querySelector<HTMLButtonElement>('.growth-primary')!.click();
  await vi.waitFor(()=>expect(document.querySelector('.growth-skill-priority')).not.toBeNull(),{timeout:5000});
  const section=document.querySelector<HTMLElement>('.growth-skill-priority')!;
  expect(section.querySelector('h3')!.textContent).toBe('전체 덱 스킬칩 가성비 우선순위');
  const units=skillManualIIIUnits({name,current:[4,5,6],target:[10,10,10]});
  expect(units.units).toBe(units.skill3+2*units.burst3);
  expect(section.textContent).toContain(`덱 1 · ${name}`);
  expect(section.textContent).toContain(`환산 ${units.units.toLocaleString('ko-KR')}개`);
  // 스킬만 올린 판은 현재 판에서 스킬 레벨만 바꾼 요청이다.
  const skillOnly=simulate.mock.calls.map(c=>c[0] as SimulationRequest).find(r=>JSON.stringify(r.characters?.[name]?.overload)===JSON.stringify({atk:2})&&r.characters?.[name]?.skillLevels?.['1']===10)!;
  expect(skillOnly.characters![name]!.skillLevels).toEqual({'1':10,'2':10,'3':10});
  // 모듈 가성비 섹션이 있으면 스킬칩 섹션이 그 위다.
  const cost=document.querySelector('.growth-cost-results');
  if(cost) expect(section.compareDocumentPosition(cost)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('keeps browser calculation but exposes no external engine exchange',()=>{
 openGrowthEfficiency(batch,{settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate:vi.fn()});
 expect(document.querySelector('.growth-external')).toBeNull();
 expect(document.querySelector('textarea[aria-label="외부 계산 프롬프트"]')).toBeNull();
 expect(document.querySelector('a[download]')).toBeNull();
 expect(document.querySelector('.growth-primary')!.textContent).toBe('계산하기');
});
it('applies line counts immediately without compromise or apply buttons',()=>{
 const currentLines={머리:[{option:'atk',level:2}]};
 openGrowthEfficiency(batch,{settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:currentLines}),simulate:vi.fn()});
 const count=document.querySelector<HTMLSelectElement>('select[aria-label="덱 1 A 공격력 목표 줄 수"]')!;count.value='4';count.dispatchEvent(new Event('change'));
 expect([...document.querySelectorAll<HTMLSelectElement>('.growth-line select')].filter(s=>s.value==='atk')).toHaveLength(1);
 expect([...document.querySelectorAll<HTMLSelectElement>('.growth-line select')].every(s=>s.disabled)).toBe(true);
 expect(document.querySelector<HTMLDetailsElement>('.growth-goals')!.open).toBe(true);
 expect(document.querySelector('select[aria-label*="타협 옵션"]')).toBeNull();
 expect(document.querySelector('.growth-goal-actions')).toBeNull();
 count.value='3';count.dispatchEvent(new Event('change'));
 const ammo=document.querySelector<HTMLSelectElement>('select[aria-label="덱 1 A 장탄 목표 줄 수"]')!;ammo.value='1';ammo.dispatchEvent(new Event('change'));
 expect(count.value).toBe('3');expect(ammo.value).toBe('1');
 expect(document.querySelector<HTMLSelectElement>('.growth-line select')!.value).toBe('atk');
});

it('lets MCP read goals and run the same browser calculation without exporting code',async()=>{
 HTMLElement.prototype.scrollIntoView=vi.fn();
 const {inspectGrowthPlan,calculateGrowthPlan}=await import('./growth-mcp');
 const moduleClient=await import('./overload-cost-client');
 vi.spyOn(moduleClient,'analyzeModulePart').mockResolvedValue({levels:[15,15,15],currency:'modules',mode:'effects-first',target:['atk_pct','element_bonus','crit_dmg'],order:[0,1,2],effect:0,value:100,lock:3,change:100,total:103,keys:0,error95:1,samples:4000,unlocked:[]});
 const keys=['atk_pct','element_bonus','crit_dmg'];
 const fullSettings={...settingsTemplate,overloadSteps:Object.fromEntries(keys.map(k=>[k,steps])),overloadFields:Object.fromEntries(keys.map(k=>[k,{label:k}])),characters:{A:{overload:Object.fromEntries(keys.map(k=>[k,4]))}}} as unknown as SettingsCatalog;
 const lines=Object.fromEntries(['머리','몸통','팔','다리'].map(part=>[part,keys.map(option=>({option,level:1}))]));
 const saved=structuredClone(batch);saved.decks[0]!.request.characters={A:{overload:Object.fromEntries(keys.map(k=>[k,4])),overloadLines:lines}};
 const simulate=vi.fn().mockResolvedValue(result(120));
 openGrowthEfficiency(saved,{settings:fullSettings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:lines}),simulate});
 const plan=inspectGrowthPlan();expect(plan.execution).toBe('user-browser');expect(plan).not.toHaveProperty('prompt');expect(plan).not.toHaveProperty('engineVersion');
 const answer=await calculateGrowthPlan();expect(answer.execution).toBe('user-browser');expect(simulate).toHaveBeenCalledTimes(3);expect(answer.modules).toHaveLength(1);
 expect(document.querySelector('.growth-cost-results')!.textContent).toContain('목표 옵션 12줄 찾기 0.0개');
 expect(document.querySelector('.growth-cost-results')!.textContent).toContain('목표 레벨 수치작 400.0개');
});

it('defaults value targets to 15 and applies individual and bulk thresholds to damage',async()=>{
 HTMLElement.prototype.scrollIntoView=vi.fn();const simulate=vi.fn().mockResolvedValue(result(120));
 openGrowthEfficiency(batch,{settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate});
 const level=document.querySelector<HTMLSelectElement>('select[aria-label="덱 1 A 공격력 수치작 타협레벨"]')!;expect(level.value).toBe('15');
 level.value='8';level.dispatchEvent(new Event('change'));
 const {inspectGrowthPlan}=await import('./growth-mcp');expect((inspectGrowthPlan().decks as any)[0].characters[0].targetOverloadLines.머리[0].level).toBe(8);
 const bulk=document.querySelector<HTMLSelectElement>('select[aria-label="모든 수치작 타협레벨"]')!;bulk.value='10';bulk.dispatchEvent(new Event('change'));
 expect([...document.querySelectorAll<HTMLSelectElement>('.growth-goal-level')].every(select=>select.value==='10')).toBe(true);
 document.querySelector<HTMLButtonElement>('.growth-primary')!.click();await vi.waitFor(()=>expect(simulate).toHaveBeenCalledTimes(2));
 expect(simulate.mock.calls[1]![0].characters.A.overload.atk).toBe(10);
});

it('resets all displayed deck goals including excluded characters and clears saved goals',()=>{
 const multiple=structuredClone(batch);multiple.decks.push({...structuredClone(multiple.decks[0]!),deckId:2});
 openGrowthEfficiency(multiple,{settings,catalog:new Map(),deckName:id=>`덱 ${id}`,current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate:vi.fn()});
 for(const el of document.querySelectorAll<HTMLSelectElement>('select[aria-label$="장탄 목표 줄 수"]')){el.value='2';el.dispatchEvent(new Event('change'));}
 const bulk=document.querySelector<HTMLSelectElement>('select[aria-label="모든 수치작 타협레벨"]')!;bulk.value='10';bulk.dispatchEvent(new Event('change'));
 document.querySelector<HTMLButtonElement>('.growth-exclude')!.click();
 document.querySelector<HTMLButtonElement>('.growth-reset-all')!.click();
 expect([...document.querySelectorAll<HTMLSelectElement>('select[aria-label$="장탄 목표 줄 수"]')].map(x=>x.value)).toEqual(['0','0']);
 expect([...document.querySelectorAll<HTMLSelectElement>('.growth-goal-level')].every(x=>x.value==='15')).toBe(true);
 expect(bulk.value).toBe('15');expect(localStorage.getItem('nikke-growth-target:v1:A')).toBeNull();
 expect(document.querySelector<HTMLElement>('.growth-character')!.dataset.excluded).toBe('true');
});

it('sets every character to eight required lines while preserving thresholds and exclusions',()=>{
 const keys=['element_bonus','atk_pct','crit_dmg'];
 const configured={...settingsTemplate,overloadSteps:Object.fromEntries(keys.map(k=>[k,steps])),overloadFields:Object.fromEntries(keys.map(k=>[k,{label:k}])),characters:{A:{overload:{}}}} as unknown as SettingsCatalog;
 const multiple=structuredClone(batch);multiple.decks.push({...structuredClone(multiple.decks[0]!),deckId:2});
 openGrowthEfficiency(multiple,{settings:configured,catalog:new Map(),deckName:id=>`덱 ${id}`,current:()=>({}),simulate:vi.fn()});
 const bulk=document.querySelector<HTMLSelectElement>('select[aria-label="모든 수치작 타협레벨"]')!;bulk.value='10';bulk.dispatchEvent(new Event('change'));
 document.querySelector<HTMLButtonElement>('.growth-exclude')!.click();
 document.querySelector<HTMLButtonElement>('.growth-eight-lines')!.click();
 for(const key of keys)expect([...document.querySelectorAll<HTMLSelectElement>(`select[aria-label$="${key} 목표 줄 수"]`)].map(x=>x.value)).toEqual(key==='crit_dmg'?['0','0']:['4','4']);
 expect([...document.querySelectorAll<HTMLSelectElement>('.growth-goal-level')].every(x=>x.value==='10')).toBe(true);
 expect(document.querySelector<HTMLElement>('.growth-character')!.dataset.excluded).toBe('true');
 expect(localStorage.getItem('nikke-growth-target:v1:A')).toContain('element_bonus');
});

it('excludes non-advantaged characters per boss and persists exclusion without toggling it back',()=>{
 const multiple=structuredClone(batch);multiple.decks[0]!.request.squad=['A','B','C'];
 const catalog=new Map([['A',{elementCode:'수냉'}],['B',{elementCode:'작열'}],['C',{elementCode:''}]]) as any;
 openGrowthEfficiency(multiple,{settings,catalog,deckName:()=> '덱 1',current:()=>({}),simulate:vi.fn()});
 const button=document.querySelector<HTMLButtonElement>('.growth-exclude-non-element')!;button.click();button.click();
 const cards=[...document.querySelectorAll<HTMLElement>('.growth-character')];
 expect(cards[0]!.dataset.excluded).not.toBe('true');expect(cards[1]!.dataset.excluded).toBe('true');expect(cards[2]!.dataset.excluded).not.toBe('true');
 expect(localStorage.getItem('nikke-growth-excluded:v1:B')).toBe('true');
 expect(document.querySelector('.growth-status')!.textContent).toContain('속성 미확인');
});
it('leaves targets unchanged when the boss has no element',()=>{
 const noCode=structuredClone(batch);noCode.decks[0]!.request.enemyCode='';
 openGrowthEfficiency(noCode,{settings,catalog:new Map([['A',{elementCode:'수냉'}]]) as any,deckName:()=> '덱 1',current:()=>({}),simulate:vi.fn()});
 document.querySelector<HTMLButtonElement>('.growth-exclude-non-element')!.click();
 expect(document.querySelector<HTMLElement>('.growth-character')!.dataset.excluded).not.toBe('true');
});


it('includes all excluded deck entries and persists inclusion without resetting goals',()=>{
 const multiple=structuredClone(batch);multiple.decks.push({...structuredClone(multiple.decks[0]!),deckId:2});
 localStorage.setItem('nikke-growth-excluded:v1:A','true');
 openGrowthEfficiency(multiple,{settings,catalog:new Map(),deckName:id=>`덱 ${id}`,current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate:vi.fn()});
 const savedGoal=localStorage.getItem('nikke-growth-target:v1:A');
 const button=document.querySelector<HTMLButtonElement>('.growth-reset-included')!;
 expect(button.previousElementSibling?.classList.contains('growth-reset-all')).toBe(true);
 expect(document.querySelectorAll('.growth-character[data-excluded="true"]')).toHaveLength(2);
 button.click();button.click();
 expect(document.querySelectorAll('.growth-character[data-excluded="true"]')).toHaveLength(0);
 expect([...document.querySelectorAll<HTMLDetailsElement>('.growth-character')].every(card=>card.open)).toBe(true);
 expect(localStorage.getItem('nikke-growth-excluded:v1:A')).not.toBe('true');
 expect(localStorage.getItem('nikke-growth-target:v1:A')).toBe(savedGoal);
});

it('downloads the completed full result as HTML and invalidates export when goals change',async()=>{
 HTMLElement.prototype.scrollIntoView=vi.fn();
 const create=vi.fn((_blob:Blob)=> 'blob:html');vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:vi.fn()});
 vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 openGrowthEfficiency(batch,{settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({overloadLines:{머리:[{option:'atk',level:2}]}}),simulate:vi.fn().mockResolvedValue(result(120))});
 const save=document.querySelector<HTMLButtonElement>('.growth-save-html')!;expect(save.disabled).toBe(true);
 const cost=document.querySelector<HTMLInputElement>('input[aria-label="모듈 가성비 분석"]')!;cost.checked=false;cost.dispatchEvent(new Event('change'));
 document.querySelector<HTMLButtonElement>('.growth-primary')!.click();
 await vi.waitFor(()=>expect(save.disabled).toBe(false));save.click();
 const blob=create.mock.calls[0]![0] as unknown as Blob;expect(blob.type).toBe('text/html;charset=utf-8');
 const text=await new Promise<string>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.readAsText(blob);});
 expect(text).toContain('전체 덱 육성 우선순위');expect(text).toContain('목표 스킬 필요 재료');expect(text).toContain('기본 스펙 이탈 내역');expect(text).not.toContain('<button');
 const skill=document.querySelector<HTMLSelectElement>('select[aria-label="덱 1 A 목표 스킬1"]')!;skill.value='7';skill.dispatchEvent(new Event('change'));expect(save.disabled).toBe(true);
});

it('easy calculation re-includes advantaged characters, applies 4/4 Lv10 and starts simulation',async()=>{
 HTMLElement.prototype.scrollIntoView=vi.fn();
 const keys=['element_bonus','atk_pct','crit_dmg'];
 const configured={...settingsTemplate,overloadSteps:Object.fromEntries(keys.map(k=>[k,steps])),overloadFields:Object.fromEntries(keys.map(k=>[k,{label:k}])),characters:{A:{overload:{}},B:{overload:{}}}} as unknown as SettingsCatalog;
 const multiple=structuredClone(batch);multiple.decks[0]!.request.squad=['A','B'];multiple.decks[0]!.request.characters={A:{overload:{element_bonus:12},overloadLines:{머리:[{option:'element_bonus',level:12}]}},B:{overload:{}}};
 const simulate=vi.fn().mockResolvedValue({squadTotal:120,charTotals:{A:110,B:10}});
 openGrowthEfficiency(multiple,{settings:configured,catalog:new Map([['A',{elementCode:'수냉'}],['B',{elementCode:'작열'}]]) as any,deckName:()=> '덱 1',current:()=>({}),simulate});
 document.querySelector<HTMLInputElement>('input[aria-label="모듈 가성비 분석"]')!.click();
 document.querySelector<HTMLButtonElement>('.growth-exclude')!.click();
 document.querySelector<HTMLButtonElement>('.growth-easy-calculate')!.click();
 await vi.waitFor(()=>expect(simulate).toHaveBeenCalled());
 const cards=[...document.querySelectorAll<HTMLElement>('.growth-character')];
 expect(cards[0]!.dataset.excluded).toBe('false');expect(cards[1]!.dataset.excluded).toBe('true');
 for(const key of keys)expect(cards[0]!.querySelector<HTMLSelectElement>(`select[aria-label$="${key} 목표 줄 수"]`)!.value).toBe(key==='crit_dmg'?'0':'4');
 expect([...cards[0]!.querySelectorAll<HTMLSelectElement>('.growth-goal-level')].every(x=>x.value==='10')).toBe(true);
 await vi.waitFor(()=>expect(document.querySelector('.growth-status')?.textContent).toContain('100%'));
 expect(simulate.mock.calls.some(([r])=>r.characters?.A?.overload?.element_bonus===42)).toBe(true);
});
it('easy calculation requires an identified boss element',()=>{
 const missing=structuredClone(batch);missing.decks[0]!.request.enemyCode='';const simulate=vi.fn();
 openGrowthEfficiency(missing,{settings,catalog:new Map(),deckName:()=> '덱 1',current:()=>({}),simulate});
 document.querySelector<HTMLButtonElement>('.growth-easy-calculate')!.click();
 expect(simulate).not.toHaveBeenCalled();expect(document.querySelector('.growth-status')!.textContent).toContain('보스 속성이 필요');
});
