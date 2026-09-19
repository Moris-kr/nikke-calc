import {registerGrowthMcp} from './growth-mcp';
import {loadGrowthTarget,saveGrowthTarget,clearGrowthTarget,loadGrowthExcluded,saveGrowthExcluded} from './growth-target-storage';
import {overloadGoalEditor} from './overload-goals-ui';
import {analyzeModulePart,mapLimited} from './overload-cost-client';
import { overloadLinesOf } from './character-settings';
import { GROWTH_PARTS, growthPercent, maximumRequest, optionGap, verifiedLines, type GrowthTargets } from './growth-efficiency';
import { formatDamage } from './model';
import { canvasToBlob, downloadImage, loadPortraits, renderReport } from './report';
import type { BatchResult, CharacterMeta, CharacterOverrides, DeckResultEntry, EquipSetting, OverloadLines, SettingsCatalog, SimulationRequest, SimulationResult } from './types';
import './growth-efficiency.css';
import { recommendGrowth, standaloneGrowth, rankGlobalGrowth, type GrowthPriority } from './growth-priority';
interface Deps {
  settings: SettingsCatalog;
  catalog: Map<string, CharacterMeta>;
  current: (deckId: number, name: string) => CharacterOverrides | undefined;
  deckName: (id: number) => string;
  performance?: { max: number; recommended: number; get: () => number; set: (count: number) => void };
  simulate: (request: SimulationRequest) => Promise<SimulationResult>;
}
interface Pair { before: DeckResultEntry; after: DeckResultEntry; gaps: string[]; reportGaps: string[]; moduleReport: string[][]; excluded: string[]; priority: GrowthPriority[]; singles: Map<string, SimulationResult> }
// Keep the latest comparison per runtime in memory, including its live controls and in-flight work.
const sessions = new WeakMap<SettingsCatalog, {key:string; reopen:()=>void; dispose:()=>void}>();
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
  const el = document.createElement(tag); el.textContent = text; el.className = cls; return el;
};
const percent = (a: number, b: number) => {
  const n = growthPercent(a, b); return n === null ? '비교 불가 (기존 딜 0)' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
};
export const growthLabel = (before: number, after: number, squadTotal?: number): string => {
  const value = growthPercent(before, after);
  const personal = value === null ? '풀 육성 시 상승률 계산 불가 (기존 딜 0)' : `풀 육성 시 ${Math.abs(value).toFixed(2)}% ${value < 0 ? '감소' : '상승'}`;
  if (squadTotal === undefined) return personal;
  const delta = after - before;
  const share = squadTotal > 0 ? `${(Math.abs(delta) / squadTotal * 100).toFixed(2)}%` : '비율 계산 불가';
  return `${personal} · 총딜 대비 ${share} (${formatDamage(Math.abs(delta))}) ${delta < 0 ? '감소' : '상승'}`;
};
export function openGrowthReportPreview(blob: Blob, onClose: () => void = () => {}): () => void {
  const overlay = node('div', '', 'growth-overlay growth-report-overlay');
  const panel = node('section', '', 'growth-dialog growth-report-dialog');
  panel.role = 'dialog'; panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', '육성효율 보고서 이미지');
  const header = node('header'); const close = node('button', '닫기', 'growth-report-close');
  header.append(node('h2', '육성효율 보고서 이미지'), close);
  const image = node('img', '', 'growth-report-image');
  const url = URL.createObjectURL(blob); image.src = url; image.alt = '현재 덱과 최대수치 덱을 나란히 비교한 육성효율 보고서';
  const download = node('button', 'PNG 다운로드', 'growth-primary');
  download.onclick = () => downloadImage(blob, `니케-육성효율-${new Date().toISOString().slice(0,10)}.png`);
  const footer = node('footer'); footer.append(download); panel.append(header, image, footer); overlay.append(panel);
  let disposed = false;
  const dismiss = () => { if (disposed) return; disposed = true; URL.revokeObjectURL(url); overlay.remove(); document.removeEventListener('keydown', keydown, true); onClose(); };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopImmediatePropagation(); dismiss(); }
    if (event.key === 'Tab' && ((event.shiftKey && document.activeElement === close) || (!event.shiftKey && document.activeElement === download))) {
      event.preventDefault(); (event.shiftKey ? download : close).focus();
    }
  };
  close.onclick = dismiss; overlay.onclick = event => { if (event.target === overlay) dismiss(); };
  document.body.append(overlay); document.addEventListener('keydown', keydown, true); close.focus();
  return dismiss;
}
export function openGrowthEfficiency(batch: BatchResult, deps: Deps): void {
  const sessionKey=JSON.stringify(batch.decks.map(entry=>({deckId:entry.deckId,name:deps.deckName(entry.deckId),request:entry.request,total:entry.result.squadTotal,charTotals:entry.result.charTotals})));
  const previous=sessions.get(deps.settings);
  if(previous?.key===sessionKey){previous.reopen();return;}
  previous?.dispose();
  const steps = deps.settings.overloadSteps ?? {};
  const snapshot = structuredClone(batch);
  let opener = document.activeElement as HTMLElement | null;
  const overlay = node('div', '', 'growth-overlay');
  const dialog = node('section', '', 'growth-dialog'); dialog.role = 'dialog'; dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', '육성효율 계산하기');
  const header = node('header'); const title = node('div'); title.append(node('small', 'OVERLOAD · GROWTH REPORT'), node('h2', '각 니케별 유효옵션을 설정해주세요'));
  const close = node('button', '닫기', 'growth-close'); header.append(title, close);
  const intro = node('p', '풀 육성은 이 창에서 설정한 목표 육성과 선택한 오버로드 수치작 목표를 적용한 상태입니다. 돌파·스킬·소장품·장비레벨은 현재 값으로 시작합니다. 큐브·운용·전투 조건은 기존 결과와 동일하며, 실제 육성은 덮어쓰지 않습니다.', 'growth-note');
  intro.append(document.createTextNode(' 창을 닫아도 입력·결과와 진행 중인 계산은 유지됩니다. 페이지를 새로고침하거나 기준 전투 결과가 바뀌면 새 비교로 시작하며, 니케별 목표 옵션과 수치작 타협레벨은 저장값을 불러옵니다.'));
  const costLabel=node('label','','growth-confirm');const costCheck=node('input');costCheck.type='checkbox';costCheck.checked=true;costCheck.setAttribute('aria-label','모듈 가성비 분석');costLabel.append(costCheck,document.createTextNode('모듈 가성비 분석 · 추가 전투/확률 계산으로 시간이 늘어날 수 있습니다.'));
  const currencyLabel=node('label','','growth-confirm');currencyLabel.append(node('span','잠금 재화'));const currencySelect=node('select');currencySelect.setAttribute('aria-label','잠금 재화');for(const [value,label] of [['modules','커스텀 모듈'],['keys','커스텀 락 키']]){const option=node('option',label);option.value=value!;currencySelect.append(option);}currencyLabel.append(currencySelect,node('span','락 키: 매 변경마다 1줄 20개 / 2줄 50개. 변경 모듈은 별도 2개 / 3개. 기존 모듈 잠금은 해제하고 키로 다시 잠그는 방식입니다.','growth-note'));
  const allLevelLabel=node('label','','growth-confirm');allLevelLabel.append(node('span','모든 수치작 타협레벨'));const allLevelSelect=node('select');allLevelSelect.setAttribute('aria-label','모든 수치작 타협레벨');for(let n=1;n<=15;n++)allLevelSelect.add(new Option(`Lv.${n} 이상`,String(n)));allLevelSelect.value='15';allLevelLabel.append(allLevelSelect);
  const resetAll=node('button','전체 목표 옵션 리셋','growth-secondary growth-reset-all');resetAll.type='button';
  const resetTargets:Array<()=>boolean>=[];
  const editor = node('div'); const footer = node('footer');
  const calculate = node('button', '계산하기', 'growth-primary');
  const save = node('button', '보고서 이미지 만들기', 'growth-secondary'); save.disabled = true;
  const message = node('p', '', 'growth-status'); message.setAttribute('aria-live', 'polite');
  const progress = node('progress', '', 'growth-progress'); progress.max=100; progress.value=0; progress.hidden=true; progress.setAttribute('aria-label','육성 계산 진행률');
  const output = node('div', '', 'growth-output'); footer.append(calculate, save, progress, message);
  const performance = node('div', '', 'growth-performance');
  if (deps.performance) {
    const label=node('label','동시 계산 수 ');
    const select=node('select');select.setAttribute('aria-label','육성 동시 계산 수');
    for(let n=1;n<=deps.performance.max;n++){const option=node('option',`${n}개${n===deps.performance.recommended?' · 권장':''}`);option.value=String(n);select.append(option);}
    select.value=String(deps.performance.get());
    select.onchange=()=>deps.performance!.set(Number(select.value));
    label.append(select);
    performance.append(label,node('p','여러 후보를 내 컴퓨터의 CPU 코어로 동시에 계산합니다. 개수를 늘리면 CPU·메모리 사용과 발열이 증가합니다. 처음에는 계산 엔진 준비 시간이 추가되며, 코어 수나 남은 작업 수보다 늘려도 더 빨라지지 않을 수 있습니다. 느려지거나 다른 작업에 지장이 생기면 줄여 주세요.','growth-note'));
  }
  dialog.append(header, intro, performance, costLabel, currencyLabel, allLevelLabel, resetAll, editor, footer, output); overlay.append(dialog); document.body.append(overlay);
  let closed = false, busy = false, pairs: Pair[] = [];
  let unregister=()=>{};let calculationError='';let moduleResults:Record<string,unknown>[]=[];
  let closePreview: (() => void) | null = null;
  const targets: GrowthTargets[] = [];
  const lockMasks:Record<string,Record<string,number>>[]=[];
  const targetLevels:Record<string,Record<string,number>>[]=[];
  const goalNotes:Record<string,string>[]=[];
  const growthStages: Record<string, number>[] = [];
  const excluded: Set<string>[] = [];
  const equipment: Record<string, CharacterOverrides['equipLevels']>[] = [];
  const extras: Record<string, Pick<CharacterOverrides, 'skillLevels' | 'collection'>>[] = [];
  const originals: Record<string, OverloadLines | undefined>[] = [];
  const globalRows = () => rankGlobalGrowth(pairs.flatMap(pair=>[...pair.singles].map(([name,result])=>({deckId:pair.before.deckId,name,before:pair.before.result.squadTotal,after:result.squadTotal,gain:result.squadTotal-pair.before.result.squadTotal}))));
  const costHistory=new Map<string,{name:string;goal:string;gain:number;total:number;efficiency:number}>();
  let completed=0, totalRuns=0;
  const updateProgress=(label:string)=>{ const value=totalRuns ? Math.floor(completed/totalRuns*100) : 100;progress.hidden=false;progress.value=value;message.textContent=`${value}% · ${completed}/${totalRuns}회 완료 · ${label}`; };
  const run = async (request:SimulationRequest,label:string):Promise<SimulationResult> => {
    if(closed) throw new Error('창이 닫혔습니다.'); updateProgress(label);
    const input=structuredClone(request);for(const character of Object.values(input.characters??{}))delete character.overloadLines;
    const result=await deps.simulate(input);completed++;updateProgress(label);return result;
  };
  const acknowledgments: HTMLInputElement[] = [];
  let savedScroll=0;
  const closeDialog = () => { savedScroll=dialog.scrollTop; closePreview?.(); overlay.remove(); document.removeEventListener('keydown', onKey, true); opener?.focus(); };
  const onKey = (event: KeyboardEvent) => {
    if (closePreview) return;
    if (event.key === 'Escape') { event.stopImmediatePropagation(); closeDialog(); }
    if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),summary')];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true); close.onclick = closeDialog;
  sessions.set(deps.settings,{key:sessionKey,
    reopen:()=>{if(overlay.isConnected){close.focus();return;}opener=document.activeElement as HTMLElement|null;document.body.append(overlay);document.addEventListener('keydown',onKey,true);close.focus({preventScroll:true});dialog.scrollTop=savedScroll;},
    dispose:()=>{unregister();closed=true;closePreview?.();overlay.remove();document.removeEventListener('keydown',onKey,true);},
  });
  overlay.onclick = event => { if (event.target === overlay) closeDialog(); }; close.focus();
  const invalidate = () => { pairs = []; save.disabled = true; progress.hidden=true; output.replaceChildren(); message.textContent = '옵션이 변경되었습니다. 다시 계산해 주세요.'; };
  allLevelSelect.onchange=()=>{editor.querySelectorAll('.growth-goals').forEach(host=>host.dispatchEvent(new CustomEvent('set-all-levels',{detail:Number(allLevelSelect.value)})));};
  costCheck.onchange=invalidate;currencySelect.onchange=invalidate;
  const lockEditor = (locked: boolean) => {
    resetAll.disabled=locked;costCheck.disabled=locked;allLevelSelect.disabled=locked;currencySelect.disabled=locked;
    performance.querySelectorAll<HTMLSelectElement>('select').forEach(select=>{select.disabled=locked;});
    output.querySelectorAll<HTMLButtonElement>('.growth-priority-button').forEach(button=>{button.disabled=locked;});
    editor.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button').forEach(el => {
      el.disabled = locked || el.dataset.unavailable==='true' || (!el.classList.contains('growth-exclude') && el.closest<HTMLElement>('.growth-character')?.dataset.excluded === 'true');
    });
  };
  snapshot.decks.forEach((entry, index) => {
    lockMasks[index]={};goalNotes[index]={};targetLevels[index]={};
    targets[index] = {}; originals[index] = {}; growthStages[index] = {}; excluded[index] = new Set(); equipment[index] = {}; extras[index] = {};
    const group = node('section', '', 'growth-deck'); group.append(node('h3', deps.deckName(entry.deckId)));
    for (const name of entry.request.squad.filter(Boolean)) {
      const totals = entry.request.characters?.[name]?.overload ?? deps.settings.characters[name]?.overload ?? {};
      const source = verifiedLines(totals, entry.request.characters?.[name]?.overloadLines ?? deps.current(entry.deckId, name)?.overloadLines, steps);
      originals[index]![name] = source;lockMasks[index]![name]={};targetLevels[index]![name]={};
      const savedTarget=loadGrowthTarget(name,deps.settings.overloadFields);
      if(savedTarget)Object.assign(targetLevels[index]![name]!,savedTarget.levels);
      const lines = overloadLinesOf(savedTarget?.lines??source);for(const [part,rows] of Object.entries(lines))for(const [i,row] of rows.entries()){const original=source?.[part as keyof OverloadLines]?.[i];row.level=Math.max(targetLevels[index]![name]![row.option]??15,original?.option===row.option?original.level:1);} targets[index]![name] = lines;
      let resetting=false;
      const savedNote=node('small',savedTarget?'목표 옵션 저장값 불러옴':'목표 옵션 변경 시 자동 저장','growth-note');
      const persistTarget=()=>{if(resetting)return;const ok=saveGrowthTarget(name,lines,targetLevels[index]![name]!);savedNote.textContent=ok?'목표 옵션 · 줄 수 · 타협레벨 저장됨':'저장 실패 · 브라우저 저장 공간을 확인해 주세요.';if(!ok)message.textContent=savedNote.textContent;};
      const card = node('details', '', 'growth-character'); card.open = true;
      const summary = node('summary');
      const image = deps.catalog.get(name)?.image;
      if (image) { const img = node('img'); img.src = `${import.meta.env.BASE_URL}${image}`; img.alt = ''; summary.append(img); }
      summary.append(node('strong', name), node('span', source ? '현재 옵션 → 수치작 목표' : '부위 정보 없음', 'growth-note'));
      const defaults = deps.settings.characters[name];
      const currentStage = entry.request.characters?.[name]?.growthStage ?? defaults?.growthStage ?? 0;
      growthStages[index]![name] = currentStage;
      const stageLabel = node('label', '', 'growth-stage'); stageLabel.append(node('span', '목표 돌파'));
      const stageSelect = node('select'); stageSelect.setAttribute('aria-label', `${deps.deckName(entry.deckId)} ${name} 목표 돌파`);
      const stageOptions = defaults?.growthOptions ?? [{value:currentStage,label:`${currentStage}단계`}];
      for (const option of stageOptions) stageSelect.add(new Option(option.label, String(option.value)));
      if (!stageOptions.some(option => option.value === currentStage)) stageSelect.add(new Option(`현재 ${currentStage}단계`, String(currentStage)));
      stageSelect.value = String(currentStage);
      stageSelect.onclick = event => event.stopPropagation();
      stageSelect.onchange = () => { growthStages[index]![name] = Number(stageSelect.value); invalidate(); };
      stageLabel.append(stageSelect); summary.append(stageLabel);
      const exclude = node('button', '육성 대상 제외', 'growth-exclude'); exclude.type = 'button'; exclude.setAttribute('aria-label', `${deps.deckName(entry.deckId)} ${name} 육성 대상 제외`);
      exclude.onclick = event => {
        event.preventDefault(); event.stopPropagation();
        const omit = !excluded[index]!.has(name);
        if (omit) excluded[index]!.add(name); else excluded[index]!.delete(name);
        card.dataset.excluded = String(omit); card.open = !omit;
        exclude.textContent = omit ? '육성 대상 포함' : '육성 대상 제외';
        exclude.setAttribute('aria-label', `${deps.deckName(entry.deckId)} ${name} ${exclude.textContent}`);
        lockEditor(false); invalidate();if(!saveGrowthExcluded(name,omit))message.textContent='육성 제외 여부를 저장하지 못했습니다.';
      };
      summary.addEventListener('click', event => { if (excluded[index]!.has(name)) event.preventDefault(); });
      card.addEventListener('toggle', () => { if (excluded[index]!.has(name)) card.open = false; });
      summary.append(exclude); card.append(summary);
      const current = entry.request.characters?.[name];
      const skillLevels = { ...(current?.skillLevels ?? defaults?.skillLevels ?? {'1':10,'2':10,'3':10}) };
      const collection = { ...(current?.collection ?? defaults?.collection ?? {stage:'SR15',favorite:0}) };
      extras[index]![name] = {skillLevels,collection};
      const growthFields = node('div', '', 'growth-fields');
      for (const [key, text] of [['1','목표 스킬1'],['2','목표 스킬2'],['3','목표 버스트']] as const) {
        const label = node('label'); label.append(node('span', text));
        const select = node('select'); select.setAttribute('aria-label', `${deps.deckName(entry.deckId)} ${name} ${text}`);
        for(let lv=1;lv<=10;lv++) if (!defaults?.skillLevelsLocked || lv===10) select.add(new Option(`Lv.${lv}`,String(lv)));
        if (defaults?.skillLevelsLocked) skillLevels[key]=10;
        select.value=String(skillLevels[key]);
        select.onchange=()=>{skillLevels[key]=Number(select.value);invalidate();};
        label.append(select); if(defaults?.skillLevelsLocked) label.append(node('small','미공개 · Lv.10 고정')); growthFields.append(label);
      }
      const collectionLabel = node('label'); collectionLabel.append(node('span','목표 소장품 · 애장품'));
      const collectionSelect = node('select'); collectionSelect.setAttribute('aria-label', `${deps.deckName(entry.deckId)} ${name} 목표 소장품`);
      for(const stage of deps.settings.collectionStages ?? [collection.stage]) collectionSelect.add(new Option(stage,`stage:${stage}`));
      if(defaults?.favoriteItem) for(let stage=1;stage<=3;stage++) collectionSelect.add(new Option(`애장품 ${stage}단계`,`favorite:${stage}`));
      const collectionValue = collection.favorite>0 ? `favorite:${collection.favorite}` : `stage:${collection.stage}`;
      if (![...collectionSelect.options].some(option=>option.value===collectionValue)) collectionSelect.add(new Option(`현재 ${collection.favorite>0 ? `애장품 ${collection.favorite}단계` : collection.stage}`,collectionValue));
      collectionSelect.value=collectionValue;
      collectionSelect.onchange=()=>{const [kind,raw]=collectionSelect.value.split(':'); collection.favorite=kind==='favorite'?Number(raw):0; collection.stage=kind==='favorite'?'SR15':raw!;invalidate();};
      collectionLabel.append(collectionSelect); growthFields.append(collectionLabel); card.append(growthFields);
      if (!source) {
        card.append(node('p', `현재 합계: ${Object.entries(totals).filter(([,v])=>v).map(([key,v])=>`${deps.settings.overloadFields[key]?.label ?? key} ${v}%`).join(' · ') || '없음'}`, 'growth-note'));
        const label = node('label', '', 'growth-confirm'); const check = node('input'); check.type = 'checkbox';
        label.append(check, document.createTextNode('부위별 원본을 확인할 수 없습니다. 아래에 목표 옵션을 직접 설정했습니다.')); card.append(label); acknowledgments.push(check);
      }
      const applyTargets=(allocated:OverloadLines)=>{const next=overloadLinesOf(allocated);for(const part of GROWTH_PARTS)for(const [i,row] of next[part].entries()){const original=source?.[part]?.[i];lines[part][i]={option:row.option,level:Math.max(targetLevels[index]![name]![row.option]??15,original?.option===row.option?original.level:1)};}invalidate();persistTarget();};
      const appliedGoal=node('p','','growth-note');
      const goalEditor=overloadGoalEditor(Object.fromEntries(Object.entries(deps.settings.overloadFields).filter(([key])=>steps[key]?.length===15)),()=>lines,(allocated,description)=>{
        applyTargets(allocated);
        goalNotes[index]![name]=description;appliedGoal.textContent=description;
      },`${deps.deckName(entry.deckId)} ${name}`,targetLevels[index]![name]);
      (goalEditor as HTMLDetailsElement).open=true;
      card.append(node('h4','오버로드 목표 설정'),node('p','아래에서 원하는 옵션의 줄 수와 최소 레벨만 선택하세요. 부위별 현재 옵션은 참고용이며 목표에 따라 바뀌지 않습니다.','growth-note'),goalEditor,appliedGoal);
      const parts = node('div', '', 'growth-parts');
      equipment[index]![name] = {};
      for (const part of GROWTH_PARTS) {
        const area = node('section', '', 'growth-part');
        const partHeader = node('div', '', 'growth-part-header'); partHeader.append(node('h4', part));
        const equip = node('select'); equip.setAttribute('aria-label', `${deps.deckName(entry.deckId)} ${name} ${part} 목표 장비레벨`);
        equip.add(new Option('미장착','없음'));
        for (let lv=0;lv<=5;lv++) equip.add(new Option(`Lv.${lv}`, String(lv)));
        const currentEquip = entry.request.characters?.[name]?.equipLevels?.[part] ?? 5;
        if (typeof currentEquip === 'string' && currentEquip !== '없음') equip.add(new Option(`${currentEquip} (현재)`,currentEquip));
        equip.value = String(currentEquip); equipment[index]![name]![part] = currentEquip;
        equip.title = '목표 장비 강화 레벨 · 오버로드 수치작 레벨과 별개입니다.';
        equip.onchange = () => { const value = equip.value; equipment[index]![name]![part] = /^\d$/.test(value) ? Number(value) : value as EquipSetting; invalidate(); };
        partHeader.append(equip); area.append(partHeader);
        lines[part].forEach((_row, rowIndex) => {
          const original = source ? overloadLinesOf(source)[part][rowIndex] : undefined;
          const line = node('div', '', 'growth-line');
          const oldLabel = original?.option ? `${deps.settings.overloadFields[original.option]?.label ?? original.option} · Lv.${original.level} · ${steps[original.option]?.[original.level-1] ?? '?'}%` : source ? '빈 옵션' : '확인 불가';
          line.append(node('small', `${rowIndex+1}번 · 현재 ${oldLabel}`));
          const select = node('select');select.setAttribute('aria-label',`${deps.deckName(entry.deckId)} ${name} ${part} ${rowIndex+1}번 현재 옵션`);select.add(new Option(oldLabel,original?.option??''));select.disabled=true;select.dataset.unavailable='true';
          const lockLabel=node('label','','growth-lock');const lockCheck=node('input');lockCheck.type='checkbox';lockCheck.setAttribute('aria-label',`${deps.deckName(entry.deckId)} ${name} ${part} ${rowIndex+1}번 현재 잠금`);
          lockCheck.disabled=!original?.option;lockCheck.dataset.unavailable=String(!original?.option);
          lockCheck.onchange=()=>{const mask=lockMasks[index]![name]![part]??0;lockMasks[index]![name]![part]=lockCheck.checked?mask|(1<<rowIndex):mask&~(1<<rowIndex);invalidate();};
          lockLabel.append(lockCheck,document.createTextNode('현재 잠금 (직접 확인)'));
          line.append(select,lockLabel); area.append(line);
        }); parts.append(area);
      }
      const resetTarget=node('button','목표 옵션 리셋','growth-secondary');resetTarget.type='button';resetTarget.setAttribute('aria-label',`${deps.deckName(entry.deckId)} ${name} 목표 옵션 리셋`);
      const resetGoal=()=>{resetting=true;for(const key of Object.keys(targetLevels[index]![name]!))delete targetLevels[index]![name]![key];applyTargets(overloadLinesOf(source));resetting=false;goalEditor.dispatchEvent(new Event('goals-changed'));return clearGrowthTarget(name);};
      resetTargets.push(resetGoal);
      resetTarget.onclick=()=>{message.textContent=resetGoal()?'목표 옵션을 현재 장비 구성 · Lv.15로 초기화했습니다.':'목표를 초기화했지만 브라우저 저장값을 삭제하지 못했습니다.';};
      if(loadGrowthExcluded(name)){excluded[index]!.add(name);card.dataset.excluded='true';card.open=false;exclude.textContent='육성 대상 포함';exclude.setAttribute('aria-label',`${deps.deckName(entry.deckId)} ${name} 육성 대상 포함`);}
      card.append(savedNote,resetTarget,node('p','목표 옵션과 수치작 타협레벨은 니케별로 이 브라우저에 자동 저장됩니다. 리셋하면 현재 장비 구성 · Lv.15로 돌아갑니다.','growth-note'),node('h4','현재 장비 옵션 · 참고용'),node('p','옵션은 위의 12줄 목표 구성에서 설정하세요. 여기서는 목표 장비레벨과 현재 잠금만 변경할 수 있습니다.','growth-note'),parts); group.append(card);
    }
    editor.append(group);
  });
  resetAll.onclick=()=>{if(busy)return;const results=resetTargets.map(reset=>reset());allLevelSelect.value='15';message.textContent=results.every(Boolean)?'모든 덱의 목표 옵션을 현재 장비 구성 · Lv.15로 초기화했습니다.':'목표를 초기화했지만 일부 브라우저 저장값을 삭제하지 못했습니다.';};
  lockEditor(false);
  const gapsFor = (index: number): string[] => {
    const result: string[] = [];
    for (const [name, target] of Object.entries(targets[index]!)) {
      if (excluded[index]!.has(name)) continue;
      const source = originals[index]![name];
      for (const part of GROWTH_PARTS) for (const [i, row] of overloadLinesOf(target)[part].entries()) {
        const gap = optionGap(source ? overloadLinesOf(source)[part][i] : undefined, row.option, steps,row.level);
        if (gap === '빈 옵션 유지' || (gap === '최대수치 달성'||gap==='목표수치 달성') || (!source && !row.option)) continue;
        result.push(`${name} · ${part} ${i+1}번 → ${deps.settings.overloadFields[row.option]?.label ?? '없음'}: ${gap}`);
      }
    }
    return result;
  };
  const reportGapsFor = (index: number): string[] => Object.entries(targets[index]!).flatMap(([name, target]) => {
    if (excluded[index]!.has(name)) return [];
    const source = originals[index]![name];
    let effects = 0, values = 0;
    for (const part of GROWTH_PARTS) for (const [i, row] of overloadLinesOf(target)[part].entries()) {
      const gap = optionGap(source ? overloadLinesOf(source)[part][i] : undefined, row.option, steps,row.level);
      if (gap.includes('효과변경') || gap.includes('효과 제거')) effects++;
      if (gap.includes('수치변경')) values++;
    }
    if (!source) return [`${name} · 부위 원본 없음 · 직접 설정한 목표 기준`];
    const changes = [effects ? '효과변경' : '', values ? '수치변경' : ''].filter(Boolean);
    return changes.length ? [`${name} · ${changes.join(' / ')}`] : [];
  });
  const calculateGrowth = async () => {
    if (busy) return;
    calculationError='';moduleResults=[];
    try {
      if (acknowledgments.some(check=>check.closest<HTMLElement>('.growth-character')?.dataset.excluded !== 'true' && !check.checked)) throw new Error('부위 정보가 없는 니케의 목표 옵션을 설정하고 확인란을 체크해 주세요.');
      const requests = snapshot.decks.map((entry,i)=>maximumRequest(entry.request,targets[i]!,steps,{useTargetLevels:true,growthStages:growthStages[i]!,excluded:excluded[i]!,equipment:equipment[i]!,extras:extras[i]!}));
      busy = true; calculate.disabled = true; save.disabled = true; pairs = []; output.replaceChildren();
      completed=0; totalRuns=snapshot.decks.reduce((sum,entry,i)=>{const n=entry.request.squad.filter(name=>name&&!excluded[i]!.has(name)).length;return sum+2+(n>1?n:0);},0);
      lockEditor(true);
      for (const [i, entry] of snapshot.decks.entries()) {
        const before = {...entry, result: await run(entry.request,`${deps.deckName(entry.deckId)} · 현재 육성`)};
        if (closed) return;
        const after = {...entry, request: requests[i]!, result: await run(requests[i]!,`${deps.deckName(entry.deckId)} · 전체 목표 육성`)};
        if (closed) return;
        const singles = await standaloneGrowth(before.request, after.request,
          entry.request.squad.filter(name=>name && !excluded[i]!.has(name)),
          after.result,(request,name)=>run(request,`${deps.deckName(entry.deckId)} · ${name} 단독 육성`));
        if (closed) return;
        const pair:Pair = {before, after, gaps:gapsFor(i), reportGaps:reportGapsFor(i), moduleReport:[], excluded:[...excluded[i]!],priority:[],singles} ; pairs.push(pair);
        pair.reportGaps.push(...Object.entries(goalNotes[i]!).filter(([name])=>!excluded[i]!.has(name)).map(([name,note])=>`${name} 목표: ${note}`));
        const result = node('section', '', 'growth-result');
        result.append(node('h3', deps.deckName(entry.deckId)), node('strong', percent(before.result.squadTotal,after.result.squadTotal), 'growth-gain'), node('p', `${formatDamage(before.result.squadTotal)} → ${formatDamage(after.result.squadTotal)}`));
        if (before.result.previewNote || after.result.previewNote) result.append(node('p', after.result.previewNote || before.result.previewNote, 'growth-note'));
        const table = node('table'); const head = node('tr'); for (const text of ['니케','현재','목표 육성','변화']) head.append(node('th',text)); table.append(head);
        for (const name of entry.request.squad.filter(Boolean)) { const a=before.result.charTotals[name]??0,b=after.result.charTotals[name]??0; const row=node('tr'); const omitted = pair.excluded.includes(name); const stage = deps.settings.characters[name]?.growthOptions?.find(option=>option.value===after.request.characters?.[name]?.growthStage)?.label; for(const text of [omitted ? `${name} (육성 제외)` : stage ? `${name} (목표 ${stage})` : name,formatDamage(a),formatDamage(b),omitted ? `파티 변화 ${percent(a,b)}` : growthLabel(a,b,before.result.squadTotal)]) row.append(node('td',text)); table.append(row); }
        const gaps = node('details'); gaps.append(node('summary', '옵션 괴리'));
        for(const gap of pair.gaps) gaps.append(node('p',gap));
        result.append(table); if (pair.gaps.length) result.append(gaps); output.append(result);
        const deviations = node('details'); deviations.append(node('summary', '기본 스펙 이탈 내역'));
        deviations.append(node('h4', '현재'), node('pre', before.result.deviations || '없음'), node('h4', '목표 육성'), node('pre', after.result.deviations || '없음'));
        result.append(deviations);
        if (singles.size) {
          const priorityButton=node('button','덱 내 우선순위 계산','growth-secondary growth-priority-button');priorityButton.disabled=true;
          priorityButton.setAttribute('aria-label',`${deps.deckName(entry.deckId)} 덱 내 우선순위 계산`);
          const priorityHost=node('div');result.append(priorityButton,priorityHost);
          priorityButton.onclick=async()=>{
            if(busy)return;busy=true;calculate.disabled=true;save.disabled=true;lockEditor(true);
            completed=0; const n=singles.size; totalRuns=Math.max(0,n*(n-1)/2-1);updateProgress(`${deps.deckName(entry.deckId)} · 덱 내 순위 시작`);
            try {
              pair.priority=await recommendGrowth(before.request,after.request,before.result,after.result,[...singles.keys()],
                (request,name)=>run(request,`${deps.deckName(entry.deckId)} · ${name} · 다음 순위 비교`),
                ()=>{},singles);
              if(closed)return;
              priorityHost.replaceChildren();
          const ranking = node('section','','growth-priority'); ranking.append(node('h4','육성 우선순위 · 덱 대미지 기준'));
          ranking.append(node('p','한 명씩 목표 육성을 적용해 덱 총딜 증가가 가장 큰 후보부터 선택하고, 다음 후보를 다시 계산합니다. 버프·시너지도 포함됩니다. 각 단계의 증가량을 합하면 전체 목표 증가량이 됩니다. 재료 비용을 반영한 가성비나 모든 육성 순서의 최적해는 아닙니다.','growth-note'));
          if (entry.request.rngMode !== 'expected') ranking.append(node('p','현재 RNG 설정의 단일 시드 비교입니다. 안정적인 우선순위 비교에는 expected RNG를 권장합니다.','growth-note'));
          const list = node('ol');
          for (const row of pair.priority) {
            const item = node('li');
            item.append(node('strong',`${row.name} · ${row.gain > 0 ? '육성 추천' : row.gain < 0 ? '육성 보류 · 딜 감소' : '상승 효과 없음'}`));
            item.append(node('p',`앞 순위 육성 후 덱 ${percent(row.previousTotal,row.total)} · ${row.gain>=0?'+':''}${formatDamage(row.gain)} → 총 ${formatDamage(row.total)}`));
            item.append(node('small',`이 니케만 먼저 육성: 덱 ${percent(before.result.squadTotal,before.result.squadTotal+row.standaloneGain)} · 누적 상승 ${percent(before.result.squadTotal,row.total)}`));
            list.append(item);
          }
          ranking.append(list); priorityHost.append(ranking);
          updateProgress(`${deps.deckName(entry.deckId)} · 덱 내 우선순위 완료`);priorityButton.textContent='덱 내 우선순위 다시 계산';
            } catch(error){message.textContent=`덱 내 순위 계산 실패: ${error instanceof Error ? error.message:String(error)}`;}
            finally {busy=false;calculate.disabled=false;save.disabled=false;lockEditor(false);}
          };
        }
      }
      if(costCheck.checked){
        const costSection=node('section','','growth-result growth-cost-results');costSection.append(node('h3','모듈 가성비 · 오버로드만 비교'));
        const methodLink=node('a','확률·계산식·전략의 범위 보기');methodLink.href='https://github.com/Moris-kr/nikke-calc/blob/master/docs/OVERLOAD_PLANNER.md';methodLink.target='_blank';methodLink.rel='noopener noreferrer';costSection.append(methodLink);
        costSection.append(node('p','부위마다 0~3줄의 목표를 설정할 수 있습니다. 목표에서 뺀 옵션은 보존하지 않는 조건이며, 대미지 비교에서도 제외합니다. 최초 장비 개조는 제외합니다. 선택한 목표 레벨의 부위별 줄 배치 6가지 × 순서 6가지 × 두 가지 전략을 비교한 추정값입니다. 모든 행동의 전역 최적해는 아닙니다. ±값은 선택한 전략의 기대값 추정에 대한 95% 오차이며, 실제 소모량의 95% 범위가 아닙니다. 목표 효과 찾기와 목표 레벨 수치작을 따로 표시합니다. 효과 찾기 비용은 선택한 전체 육성 전략 중 효과변경에 쓴 비용으로, 효과만 먼저 맞추는 독립 계산은 아닙니다. 락 키는 모듈과 별도로 표시하며 모듈당 효율에는 키의 가치가 반영되지 않습니다. 대미지는 목표 레벨 기준이며 목표 이상으로 추첨되는 추가 수치의 평균 이득은 포함하지 않습니다. 현재 잠금 상태는 위에서 직접 확인해 주세요.','growth-note'));
        const costRows:{element:HTMLElement;efficiency:number}[]=[];
        const jobs=pairs.flatMap((pair,index)=>[...pair.singles.keys()].map(name=>({pair,index,name})));
        completed=0;totalRuns=jobs.length;
        for(const {pair,index,name} of jobs){
          if(closed)return;updateProgress(`${deps.deckName(pair.before.deckId)} · ${name} 모듈 분석`);
          const article=node('article');article.append(node('h4',`${deps.deckName(pair.before.deckId)} · ${name}`));
          const source=originals[index]![name];
          try{
            if(!source)throw new Error('부위별 원본이 없어 기대값을 계산할 수 없습니다. 현재 장비 옵션을 등록한 뒤 다시 계산해 주세요.');
            const current=overloadLinesOf(source),goal=overloadLinesOf(targets[index]![name]);
            const routes=await mapLimited(GROWTH_PARTS,deps.performance?.get()??1,part=>analyzeModulePart(current[part],goal[part].map(row=>row.option),lockMasks[index]![name]![part]??0,currencySelect.value as 'modules'|'keys',targetLevels[index]![name]));
            if(closed)return;
            const request=structuredClone(pair.before.request);request.characters??={};request.characters[name]={...request.characters[name],overload:structuredClone(pair.after.request.characters?.[name]?.overload)};delete request.characters[name]!.overloadLines;
            const isolated=await deps.simulate(request);if(!Number.isFinite(isolated.squadTotal))throw new Error('오버로드 비교 대미지가 올바르지 않습니다.');
            const gain=isolated.squadTotal-pair.before.result.squadTotal;
            const effect=routes.reduce((sum,r)=>sum+r.effect,0),value=routes.reduce((sum,r)=>sum+r.value,0),keys=routes.reduce((sum,r)=>sum+r.keys,0);
            const lock=routes.reduce((sum,r)=>sum+r.lock,0),change=routes.reduce((sum,r)=>sum+r.change,0),total=lock+change,error=routes.reduce((sum,r)=>sum+r.error95,0);
            const efficiency=total>0?gain/total:0;
            moduleResults.push({deckId:pair.before.deckId,name,currency:currencySelect.value,effect,value,lock,keys,total,error95:error,overloadOnlyGain:gain,damagePerModule:efficiency,parts:GROWTH_PARTS.map((part,i)=>({part,...routes[i]}))});
            const counts=new Map<string,number>();for(const rows of Object.values(goal))for(const row of rows)if(row.option)counts.set(row.option,(counts.get(row.option)??0)+1);
            const goalText=goalNotes[index]![name]??[...counts].map(([key,n])=>`${deps.settings.overloadFields[key]?.label??key} ${n}줄`).join(' · ');
            costHistory.set(`${index}:${name}:${JSON.stringify(targetLevels[index]![name])}:${currencySelect.value}:${JSON.stringify(lockMasks[index]![name])}:${JSON.stringify(goal)}`,{name:`${deps.deckName(pair.before.deckId)} · ${name}`,goal:`${goalText} · ${currencySelect.selectedOptions[0]!.textContent} · 옵션 찾기 ${effect.toFixed(1)} / 수치작 ${value.toFixed(1)} / 잠금 ${lock.toFixed(1)} / 키 ${keys.toFixed(1)}`,gain,total,efficiency});
            if(costHistory.size>50)costHistory.delete(costHistory.keys().next().value!);
            const goalCount=[...counts.values()].reduce((sum,n)=>sum+n,0);

            const breakdown=node('ul');for(const text of [`목표 옵션 ${goalCount}줄 찾기 ${effect.toFixed(1)}개`,`목표 레벨 수치작 ${value.toFixed(1)}개`,`잠금 모듈 ${lock.toFixed(1)}개`])breakdown.append(node('li',text));if(currencySelect.value==='keys')breakdown.append(node('li',`커스텀 락 키 별도 ${keys.toFixed(1)}개 (모듈 합계에 미포함)`));
            article.append(node('strong',`모듈 합계 평균 ${total.toFixed(1)}개 · 추정 오차 ±${error.toFixed(1)}`),breakdown,node('p',`오버로드만 육성: 덱 ${percent(pair.before.result.squadTotal,isolated.squadTotal)} · ${gain>=0?'+':''}${formatDamage(gain)} / ${total>0?`모듈 1개당 기대 딜 증가 ${formatDamage(efficiency)}`:'이미 목표 달성 · 추가 비용 없음'}`));
            pair.moduleReport.push([
              `${name} · 모듈 1개당 기대 딜 증가 ${total>0?formatDamage(efficiency):'추가 비용 없음'}`,
              `모듈 평균 ${total.toFixed(1)}개 (추정 오차 ±${error.toFixed(1)}) · 락 키 별도 ${keys.toFixed(1)}개`,
              `목표 ${goalCount}줄 효과 찾기 ${effect.toFixed(1)}개 · 수치작 ${value.toFixed(1)}개 · 잠금 ${lock.toFixed(1)}개`,
              `오버로드 육성만 적용한 덱 딜 증가: ${gain>=0?'+':''}${formatDamage(gain)} (${percent(pair.before.result.squadTotal,isolated.squadTotal)})`,
            ]);
            const details=node('details');details.append(node('summary','자세히 보기 · 줄 배치와 진행 과정'));
            routes.forEach((route,p)=>{
              const part=GROWTH_PARTS[p]!;details.append(node('h4',`${part} · 옵션 찾기 ${route.effect.toFixed(1)} / 수치작 ${route.value.toFixed(1)} / 잠금 ${route.lock.toFixed(1)} = 모듈 ${route.total.toFixed(1)}개${route.currency==='keys'?` · 락 키 ${route.keys.toFixed(1)}개`:''}`));
              if(route.currency==='keys')details.append(node('p','잠금은 변경 1회 후 풀립니다. 아래에서 보호하는 줄을 매 변경 직전에 키로 다시 잠급니다. 1줄 20개, 2줄 총 50개가 매번 필요합니다.'));
              details.append(node('p',`권장 배치: ${route.target.map((key,slot)=>key?`${slot+1}번 ${deps.settings.overloadFields[key]?.label??key} Lv.${route.levels[slot]} 이상`:`${slot+1}번 목표 없음`).join(' / ')}`));
              if(route.unlocked.length)details.append(node('p',`${route.unlocked.map(i=>i+1).join('·')}번 현재 잠금은 이 전략에서 해제합니다. 다시 잠그는 비용은 포함했습니다.`));
              const instructions=node('ol');
              const effectsReady=route.target.every((key,slot)=>!key||current[part][slot]!.option===key);
              const allReady=effectsReady&&current[part].every((row,i)=>!route.target[i]||row.level>=route.levels[i]!);
              if(allReady)details.append(node('p','이미 목표 달성 · 변경/추가 잠금이 필요 없습니다.'));
              else if(route.mode==='effects-first'&&effectsReady)details.append(node('p','현재 목표 효과가 이미 맞으므로 효과변경과 효과 확보용 잠금을 생략하고 수치 단계로 진행합니다.'));
              (allReady||(route.mode==='effects-first'&&effectsReady)?[]:route.order).forEach(slot=>{
                if(!route.target[slot])return;
                const target=deps.settings.overloadFields[route.target[slot]!]!.label;
                const old=current[part][slot]!;const displaced=old.option&&old.option!==route.target[slot]?`현재 ${deps.settings.overloadFields[old.option]?.label??old.option}을 잃을 수 있습니다. `:'';
                const matches=old.option===route.target[slot];
                if(matches){if(route.mode==='complete-line'&&old.level<route.levels[slot]!)instructions.append(node('li',`${slot+1}번 ${target}: 현재 Lv.${old.level} → Lv.${route.levels[slot]} 이상 수치작 후 나머지 작업 동안 보호합니다.`));else if(!allReady)instructions.append(node('li',`${slot+1}번 ${target}: 확보된 ${route.mode==='complete-line'?'목표 수치 옵션':'효과'}를 다른 줄 작업 동안 보호합니다.`));}
                else instructions.append(node('li',`${slot+1}번에서 ${target} 확보. ${displaced}해당 줄에 나올 때까지 효과변경하고 실패한 결과는 채택하지 않습니다. ${route.mode==='complete-line'?`이 줄을 Lv.${route.levels[slot]} 이상으로 수치변경한 뒤`:'효과를 찾으면'} 나머지 목표가 남았을 때 잠급니다.`));
              });
              if(route.mode==='effects-first'&&!allReady)instructions.append(node('li','목표 효과가 갖춰지면 목표가 없는 줄과 목표 레벨 미만 줄의 잠금을 해제합니다. 목표 이상 줄은 잠그고 나머지 수치를 변경합니다. 새로 목표 레벨 이상을 달성한 줄이 하나 이상 나온 결과만 채택하고 반복합니다.'));
              details.append(instructions,node('p','효과변경은 잠그지 않은 다른 줄의 효과·수치도 바꿉니다. 설명은 현재 장비 기준이며 앞 단계에서 미잠금 옵션을 잃으면 다시 확보해야 합니다. 다른 줄의 목표도 함께 완성되면 해당 변경은 생략합니다. 전부 완성된 후에는 추가 잠금을 하지 않습니다. 실패 결과를 채택하거나 다른 목표로 변경하면 기대값을 다시 계산해야 합니다.','growth-note'));
            });
            article.append(details);costRows.push({element:article,efficiency});
          }catch(error){pair.moduleReport.push([`${name} · 분석 제외`,error instanceof Error?error.message:String(error)]);moduleResults.push({deckId:pair.before.deckId,name,error:error instanceof Error?error.message:String(error)});article.append(node('p',`분석 제외: ${error instanceof Error?error.message:String(error)}`,'growth-note'));costRows.push({element:article,efficiency:-Infinity});}
          completed++;updateProgress(`${deps.deckName(pair.before.deckId)} · ${name} 모듈 분석 완료`);
        }
        for(const row of costRows.sort((a,b)=>b.efficiency-a.efficiency))costSection.append(row.element);
        if(costHistory.size>1){
          const history=node('details');history.append(node('summary','목표 비교 기록 (최근 50건)'));
          history.append(node('p','이 기준 전투 결과에서 직접 계산한 목표를 보관합니다. 목표를 바꾸어 계산하면 비용과 딜을 나란히 비교할 수 있습니다.','growth-note'));
          const table=node('table');const head=node('tr');for(const text of ['대상 · 목표','모듈 기대값','덱 딜 증가','모듈당 딜'])head.append(node('th',text));table.append(head);
          for(const record of costHistory.values()){const row=node('tr');for(const text of [`${record.name} · ${record.goal}`,record.total.toFixed(1),formatDamage(record.gain),record.total>0?formatDamage(record.efficiency):'이미 달성'])row.append(node('td',text));table.append(row);}
          history.append(table);costSection.append(history);
        }
        output.prepend(costSection);
      }
      const global=node('section','','growth-result growth-global-priority');global.append(node('h3','전체 덱 육성 우선순위'));
      global.append(node('p','현재 육성에서 한 니케만 목표 육성했을 때의 덱 총딜 증가량 순입니다. 버프 효과를 포함하며, 후보별 증가량을 합산하면 안 됩니다. 같은 니케도 덱·목표가 다르면 따로 표시합니다. 재료 비용은 미반영입니다.','growth-note'));
      if(snapshot.decks.some(entry=>entry.request.rngMode!=='expected'))global.append(node('p','단일 시드 결과가 포함됩니다. 안정적인 비교에는 expected RNG를 권장합니다.','growth-note'));
      const list=node('ol');
      for(const row of globalRows()) {
        const item=node('li');item.append(node('strong',`${deps.deckName(row.deckId)} · ${row.name}`),node('p',`덱 ${row.gain>=0?'+':''}${formatDamage(row.gain)} (${percent(row.before,row.after)}) · ${formatDamage(row.before)} → ${formatDamage(row.after)}${row.gain<=0?' · 육성 보류':''}`));list.append(item);
      }
      global.append(list);output.prepend(global);
      updateProgress('전체 덱 통합 비교 완료 · 덱 내 시너지 순위는 각 덱의 버튼으로 계산하세요.'); save.disabled = false;
      if(overlay.isConnected)output.scrollIntoView({behavior:'smooth',block:'start'});
    } catch(error) { calculationError=error instanceof Error?error.message:String(error);pairs=[]; save.disabled=true; output.replaceChildren(); message.textContent = `계산 실패: ${error instanceof Error ? error.message : String(error)}`; }
    finally { busy=false; calculate.disabled=false; lockEditor(false); }
  };
  calculate.onclick=()=>{void calculateGrowth();};
  unregister=registerGrowthMcp({
    inspect:()=>({execution:'user-browser',busy,lockCurrency:currencySelect.value,decks:snapshot.decks.map((entry,index)=>({deckId:entry.deckId,name:deps.deckName(entry.deckId),characters:entry.request.squad.filter(Boolean).map(name=>({name,excluded:excluded[index]!.has(name),currentOverloadLines:originals[index]![name]??null,targetOverloadLines:targets[index]![name],targetLevels:targetLevels[index]![name],locks:lockMasks[index]![name],targetGrowthStage:growthStages[index]![name],targetEquipment:equipment[index]![name],...extras[index]![name]}))}))}),
    calculate:async()=>{if(busy)throw new Error('이미 육성 계산이 진행 중입니다. 완료 후 다시 요청해 주세요.');if(closed)throw new Error('육성효율 창을 다시 열어 주세요.');costCheck.checked=true;await calculateGrowth();if(calculationError)throw new Error(calculationError);if(closed)throw new Error('기준 전투가 바뀌었습니다. 육성효율 창에서 다시 요청해 주세요.');return {execution:'user-browser',decks:pairs.map(pair=>({deckId:pair.before.deckId,before:pair.before.result.squadTotal,after:pair.after.result.squadTotal,characters:pair.after.result.charTotals,singles:[...pair.singles].map(([name,result])=>({name,squadTotal:result.squadTotal}))})),modules:moduleResults};},
  });
  save.onclick = async () => {
    if (busy || !pairs.length) return;
    busy = true; save.disabled = true; calculate.disabled = true;
    lockEditor(true);
    try {
      message.textContent = '한 장짜리 보고서 이미지를 만드는 중…';
      await document.fonts?.ready;
      const portraits = await loadPortraits(pairs.flatMap(p=>p.before.request.squad), deps.catalog, import.meta.env.BASE_URL);
      if (closed) return;
      const sections = pairs.map(pair => {
        const make = (entry: DeckResultEntry, suffix: string) => renderReport({total:entry.result.squadTotal,decks:[entry]}, {siteUrl:'moris-kr.github.io/nikke-calc',deckNames:{[entry.deckId]:`${deps.deckName(entry.deckId)} · ${suffix}`}},portraits);
        const left=make(pair.before,'현재'),right=make(pair.after,'목표 육성');
        const height=Math.max(left.height/left.width,right.height/right.width)*568;
        return {pair,left,right,height};
      });
      const canvas = document.createElement('canvas'); canvas.width=2400;
      const unified=globalRows(); const unifiedHeight=unified.length?90+unified.length*29:0;
      canvas.height=Math.ceil(112+unifiedHeight+sections.reduce((sum,s)=>sum+100+s.height+s.pair.before.request.squad.filter(Boolean).length*48+(s.pair.moduleReport.length?90+s.pair.moduleReport.reduce((n,rows)=>n+rows.length*25+14,0):0)+30+Math.max(1,s.pair.reportGaps.length)*23+35+(s.pair.priority.length ? 65+s.pair.priority.length*48 : 0),0))*2;
      if(canvas.height>32000) throw new Error('보고서가 너무 깁니다. 덱 수를 줄여 주세요.');
      const ctx=canvas.getContext('2d'); if(!ctx) throw new Error('이미지 생성이 지원되지 않습니다.');
      ctx.fillStyle='#080e19'; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.scale(2,2);
      const write=(text:string,x:number,y:number,size=16,color='#d9e5f3')=>{ctx.fillStyle=color;ctx.font=`${size}px Pretendard, sans-serif`;ctx.fillText(text,x,y,1140);};
      write(`육성효율 보고서 · OVERLOAD 목표 수치`,28,43,28,'#ad9cff');
      write('풀 육성 = 설정한 목표 돌파·스킬·소장품·장비 + 선택한 오버로드 목표 수치 · 전투 조건 동일',28,76);
      let y=112;
      if(unified.length){
        write('전체 덱 육성 우선순위 · 단독 육성 시 덱 총딜 증가량 순',28,y+22,22,'#ad9cff');
        write('후보별 독립 비교 · 증가량 합산 불가 · 같은 니케도 덱별 구분 · 비용 미반영',28,y+49,14,'#a2b2c9');y+=78;
        unified.forEach((row,index)=>{write(`${index+1}. ${deps.deckName(row.deckId)} · ${row.name} · 덱 ${row.gain>=0?'+':''}${formatDamage(row.gain)} (${percent(row.before,row.after)})${row.gain<=0?' · 육성 보류':''}`,28,y,16);y+=29;});y+=12;
      }
      for(const s of sections) {
        write(`${deps.deckName(s.pair.before.deckId)}   ${percent(s.pair.before.result.squadTotal,s.pair.after.result.squadTotal)}`,28,y+26,24,'#ad9cff');
        ctx.drawImage(s.left,24,y+48,568,s.left.height/s.left.width*568);
        ctx.drawImage(s.right,608,y+48,568,s.right.height/s.right.width*568);
        y+=s.height+80;
        for (const name of s.pair.before.request.squad.filter(Boolean)) {
          const stage = deps.settings.characters[name]?.growthOptions?.find(option=>option.value===s.pair.after.request.characters?.[name]?.growthStage)?.label;
          const a = s.pair.before.result.charTotals[name] ?? 0, b = s.pair.after.result.charTotals[name] ?? 0;
          const omitted = s.pair.excluded.includes(name);
          const gear = GROWTH_PARTS.map(part=>s.pair.after.request.characters?.[name]?.equipLevels?.[part] ?? 5).join('/');
          write(`${name}${omitted ? ' (육성 제외)' : ` (목표 ${stage ?? ''} · 장비 ${gear})`} · ${omitted ? `파티 변화 ${percent(a,b)}` : growthLabel(a,b,s.pair.before.result.squadTotal)}`,28,y,17,'#b9a7ff'); y+=25;
          if (!omitted) {
            const target=s.pair.after.request.characters?.[name];
            const skills=target?.skillLevels; const item=target?.collection;
            write(`스킬 ${skills?.['1'] ?? 10}/${skills?.['2'] ?? 10}/${skills?.['3'] ?? 10} · ${item?.favorite ? `애장품 ${item.favorite}단계` : `소장품 ${item?.stage ?? 'SR15'}`}`,28,y,14,'#a2b2c9');
          }
          y+=23;
        }
        y+=25;
        if(s.pair.moduleReport.length){
          write('모듈 가성비 · 오버로드 육성',28,y,22,'#8be0d4');y+=30;
          write('비용은 기대값 · 락 키 가치는 모듈당 효율에 미반영 · 다른 육성 목표의 이득은 제외',28,y,14,'#a2b2c9');y+=30;
          for(const rows of s.pair.moduleReport){rows.forEach((text,i)=>{write(text,28,y,i===0?17:15,i===0?'#b9dfc3':'#d9e5f3');y+=25;});y+=14;}y+=25;
        }
        if (s.pair.reportGaps.length) { write('옵션 괴리',28,y,18,'#ffce80'); y+=25; }
        for(const gap of s.pair.reportGaps) {write(gap,28,y,15);y+=23;}
        y+=30;
        if (s.pair.priority.length) {
          write('육성 우선순위 · 앞 순위 육성 후 다음 후보 재계산',28,y,18,'#ad9cff'); y+=24;
          write('덱 총딜 증가 기준 · 비용 미반영 · 전체 순서의 최적해는 아님',28,y,14,'#a2b2c9'); y+=25;
          s.pair.priority.forEach((row,index)=>{
            write(`${index+1}. ${row.name} · ${row.gain>0?'추천':row.gain<0?'보류 · 딜 감소':'상승 효과 없음'} · 덱 ${percent(row.previousTotal,row.total)} (${row.gain>=0?'+':''}${formatDamage(row.gain)})`,28,y,16); y+=24;
            write(`총 ${formatDamage(row.total)} · 누적 ${percent(s.pair.before.result.squadTotal,row.total)} · 단독 육성 ${percent(s.pair.before.result.squadTotal,s.pair.before.result.squadTotal+row.standaloneGain)}`,28,y,14,'#a2b2c9');y+=24;
          }); y+=16;
        }
      }
      const blob = await canvasToBlob(canvas);
      if (closed || !overlay.isConnected) return;
      dialog.inert = true;
      closePreview = openGrowthReportPreview(blob, () => { closePreview = null; dialog.inert = false; save.focus(); });
      message.textContent='보고서 미리보기 창에서 확인한 뒤 PNG를 다운로드하세요.';
    } catch(error) { message.textContent=`이미지 생성 실패: ${error instanceof Error ? error.message : String(error)}`; }
    finally { busy=false; calculate.disabled=false; save.disabled = pairs.length === 0; lockEditor(false); }
  };
}
