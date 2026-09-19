import './overload-guide.css';
import {GUIDE_PARTS,type GuideGoal,type GuideResult,type GuideMethod} from './overload-guide-model';
import type {CharacterOverrides,SettingsCatalog,OverloadLine} from './types';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',cls='')=>{const node=document.createElement(tag);node.textContent=text;node.className=cls;return node;};
export function openOverloadGuide(name:string,catalog:SettingsCatalog,current:CharacterOverrides):void{
 const storageKey=`nikke-overload-guide:v1:${name}`;
 let saved:any=null;try{saved=JSON.parse(localStorage.getItem(storageKey)??'null');}catch{}
 const previous=document.activeElement as HTMLElement|null;
 const overlay=el('div','','og-overlay');const dialog=el('section','','og-dialog');dialog.role='dialog';dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',`${name} 옵작 가이드`);
 const close=el('button','닫기');close.type='button';const header=el('header');header.append(el('h2',`${name} · 옵작 가이드`),close);
 const intro=el('p','현재 장비에서 원하는 효과 줄 수와 최소 레벨 이상을 갖추는 경로를 비교합니다. 타협 옵션도 목표 1줄로 인정하며 한 옵션이 두 목표를 동시에 채우지는 않습니다. 목표 밖의 옵션은 유지할 필요가 없는 것으로 계산합니다.');
 const fields=Object.entries(catalog.overloadFields).filter(([key])=>catalog.overloadSteps?.[key]?.length===15);
 const rows:OverloadLine[][]=GUIDE_PARTS.map(part=>Array.from({length:3},(_,i)=>({...current.overloadLines?.[part]?.[i]??{option:'',level:1}})));
 const totals:Record<string,number>={};for(const row of rows.flat())if(row.option)totals[row.option]=(totals[row.option]??0)+(catalog.overloadSteps?.[row.option]?.[row.level-1]??0);
 const known=!!current.overloadLines&&[...new Set([...Object.keys(totals),...Object.keys(current.overload??{})])].every(key=>Math.abs((totals[key]??0)-(current.overload?.[key]??0))<.011);
 const inputs=el('div');const source=el('details');source.open=true;source.append(el('summary','현재 옵션과 잠금 상태'));const locks=[0,0,0,0];
 const sourceGrid=el('div','','og-parts');rows.forEach((part,p)=>{const box=el('section');box.append(el('h4',GUIDE_PARTS[p]));part.forEach((row,i)=>{const label=el('label','','og-current');const lock=el('input');lock.type='checkbox';lock.disabled=!row.option;lock.dataset.unavailable=String(!row.option);lock.setAttribute('aria-label',`${GUIDE_PARTS[p]} ${i+1}번 현재 잠금`);lock.onchange=()=>{locks[p]=lock.checked?locks[p]!|(1<<i):locks[p]!&~(1<<i);invalidate();};label.append(lock,document.createTextNode(`${i+1}번 ${row.option?`${catalog.overloadFields[row.option]?.label??row.option} Lv.${row.level}`:'빈 옵션'}`));box.append(label);});sourceGrid.append(box);});source.append(sourceGrid,el('p','현재 잠금은 연동되지 않으므로 직접 체크해 주세요. 첫 옵션이 없는 부위는 미개조로 보고 목표 배치에서 제외합니다. 최초 장비 개조 비용은 포함하지 않습니다.','og-note'));inputs.append(source);
 const counts=new Map<string,number>();for(const row of rows.flat())if(row.option)counts.set(row.option,(counts.get(row.option)??0)+1);
 const goals:GuideGoal[]=fields.map(([option])=>{const old=Array.isArray(saved?.goals)?saved.goals.find((g:any)=>g?.option===option):undefined;return {option,count:Number.isInteger(old?.count)&&old.count>=0&&old.count<=4?old.count:counts.get(option)??0,level:Number.isInteger(old?.level)&&old.level>=1&&old.level<=15?old.level:15,alternatives:Array.isArray(old?.alternatives)?[...new Set<string>(old.alternatives.filter((key:any)=>key!==option&&fields.some(([field])=>field===key)))]:[]};});
 const bulkLabel=el('label','','og-bulk');bulkLabel.append(el('span','모든 최소 레벨 설정'));const bulk=el('select');for(let level=1;level<=15;level++)bulk.add(new Option(`Lv.${level} 이상`,String(level)));bulk.value='15';bulk.setAttribute('aria-label','옵작 가이드 모든 최소 레벨');bulkLabel.append(bulk);inputs.append(bulkLabel);
 const goalTable=el('div','','og-goals');const levels:HTMLSelectElement[]=[];
 goals.forEach((goal)=>{const line=el('section','','og-goal');line.append(el('strong',catalog.overloadFields[goal.option]!.label));const count=el('select');count.setAttribute('aria-label',`${catalog.overloadFields[goal.option]!.label} 목표 줄 수`);for(let n=0;n<=4;n++)count.add(new Option(`${n}줄`,String(n)));count.value=String(goal.count);count.onchange=()=>{goal.count=Number(count.value);invalidate();};
  const level=el('select');level.setAttribute('aria-label',`${catalog.overloadFields[goal.option]!.label} 최소 레벨`);for(let n=1;n<=15;n++)level.add(new Option(`Lv.${n} · ${catalog.overloadSteps![goal.option]![n-1]}% 이상`,String(n)));level.value=String(goal.level);level.onchange=()=>{goal.level=Number(level.value);invalidate();};levels.push(level);
  const alternatives=el('details');alternatives.append(el('summary','허용할 타협 옵션'));const checks=el('div','','og-alternatives');for(const [option,meta] of fields)if(option!==goal.option){const label=el('label');const checkbox=el('input');checkbox.type='checkbox';checkbox.checked=goal.alternatives.includes(option);checkbox.setAttribute('aria-label',`${catalog.overloadFields[goal.option]!.label} 대신 ${meta.label}`);checkbox.onchange=()=>{goal.alternatives=checkbox.checked?[...goal.alternatives,option]:goal.alternatives.filter(k=>k!==option);invalidate();};label.append(checkbox,document.createTextNode(meta.label));checks.append(label);}alternatives.append(checks,el('small','대체 효과에도 같은 최소 레벨을 적용합니다.'));line.append(count,level,alternatives);goalTable.append(line);
 });inputs.append(goalTable);
 const weightLabel=el('label','','og-bulk');weightLabel.append(el('span','혼합 비교: 모듈 1개와 동등하게 볼 락 키 개수'));const weight=el('input');weight.type='number';weight.min='1';weight.max='10000';weight.value=String(Number.isFinite(saved?.keyValue)&&saved.keyValue>=1&&saved.keyValue<=10000?saved.keyValue:20);weight.setAttribute('aria-label','혼합 재화 가중치');weight.oninput=()=>invalidate();weightLabel.append(weight);inputs.append(weightLabel,el('p','공식 환산율이 아닌 비교 선호도입니다. 혼합 점수 = 모듈 + 락 키 ÷ 입력값. 값을 키우면 락 키를 더 쓰더라도 모듈을 아끼는 쪽을 선호합니다.','og-note'));
 const actions=el('footer');const run=el('button','가이드 계산하기','og-primary');const cancel=el('button','계산 취소');cancel.hidden=true;const status=el('p','','og-status');status.setAttribute('aria-live','polite');const progress=el('progress');progress.max=100;progress.hidden=true;actions.append(run,cancel,progress,status);const output=el('div','','og-results');
 inputs.append(el('p','목표 줄 수·최소 레벨·타협 옵션·재화 가중치는 니케별로 이 브라우저에 자동 저장됩니다. 현재 잠금은 매번 직접 확인해 주세요.','og-note'));
 dialog.append(header,intro,inputs,actions,output);overlay.append(dialog);document.body.append(overlay);
 let worker:Worker|undefined,disposed=false;const cleanup=()=>{worker?.terminate();worker=undefined;};
 const lockInputs=(busy:boolean)=>{run.disabled=busy||!known;cancel.hidden=!busy;inputs.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input,select').forEach(input=>{input.disabled=busy||input.dataset.unavailable==='true';});};
 function invalidate(){try{localStorage.setItem(storageKey,JSON.stringify({goals,keyValue:Number(weight.value)}));}catch{}output.replaceChildren();progress.hidden=true;status.textContent=`목표 ${goals.reduce((s,g)=>s+g.count,0)}/12줄 · 설정을 변경했습니다. 계산을 눌러 주세요.`;}
 bulk.onchange=()=>{goals.forEach((goal,i)=>{goal.level=Number(bulk.value);levels[i]!.value=bulk.value;});invalidate();};
 const dismiss=()=>{if(disposed)return;disposed=true;cleanup();overlay.remove();document.removeEventListener('keydown',keydown,true);previous?.focus();};
 const keydown=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopImmediatePropagation();dismiss();}if(event.key==='Tab'){const items=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')].filter(node=>node.getClientRects().length);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};document.addEventListener('keydown',keydown,true);close.onclick=dismiss;overlay.onclick=event=>{if(event.target===overlay)dismiss();};close.focus();
 cancel.onclick=()=>{cleanup();lockInputs(false);progress.hidden=true;status.textContent='계산을 취소했습니다. 입력은 유지됩니다.';};
 const show=(result:GuideResult)=>{
  output.replaceChildren();output.append(el('p',`장비 목표 ${result.profileCount}종의 배분을 비교했습니다. 결과는 제한된 절차·고정 전환 순서 안의 최소 추정값이며 전역 최적해는 아닙니다. 후보당 64개 예비 표본으로 선택하고 최종 경로를 독립 4,000개 표본으로 평가했습니다. ±는 평균 추정 오차이며 실제 소모량 범위가 아닙니다. 후보 선택·모델 오차는 포함하지 않습니다.`,'og-note'));
  const names:Record<GuideMethod,string>={modules:'① 모듈 잠금만 · 모듈 최소',keys:'② 락 키 잠금만 · 키 최소',mixed:'③ 혼합 · 설정 가중치 최소'};
  for(const method of ['modules','keys','mixed'] as const){const answer=result.methods[method];const card=el('article');card.append(el('h3',names[method]),el('strong',`모듈 ${answer.modules.toFixed(1)}개 ±${answer.error95.toFixed(1)} · 락 키 ${answer.keys.toFixed(1)}개 ±${answer.keyError95.toFixed(1)}`));
   if(method==='mixed')card.append(el('p',`비교 점수 ${(answer.modules+answer.keys/result.keyValue).toFixed(1)} (모듈 1 : 키 ${result.keyValue}). 전환이 이득이 없으면 한 가지 잠금 방식만 추천할 수 있습니다.`));
   const breakdown=answer.parts.reduce((sum,part)=>({effect:sum.effect+part.plan.effect,value:sum.value+part.plan.value,lock:sum.lock+part.plan.lock}),{effect:0,value:0,lock:0});card.append(el('p',`효과 찾기 ${breakdown.effect.toFixed(1)} · 수치작 ${breakdown.value.toFixed(1)} · 잠금 모듈 ${breakdown.lock.toFixed(1)}`));
   answer.parts.forEach((offer,p)=>{const {plan,profile}=offer;const details=el('details');details.append(el('summary',`${GUIDE_PARTS[p]} · 모듈 ${plan.modules.toFixed(1)} / 키 ${plan.keys.toFixed(1)}`));
    details.append(el('p',`효과 찾기: 모듈 ${plan.effect.toFixed(1)}개 · 락 키 ${(plan.effectKeys??0).toFixed(1)}개`),el('p',`수치작: 모듈 ${plan.value.toFixed(1)}개 · 락 키 ${(plan.valueKeys??0).toFixed(1)}개`),el('p',`잠금 설정: 모듈 ${plan.lock.toFixed(1)}개`));
    if(!plan.target.some(Boolean)){details.append(el('p','이 부위는 작업하지 않습니다.'));card.append(details);return;}
    for(const [slot,option] of plan.target.entries())if(option){const group=profile.assignments[profile.target.indexOf(option)]!;const originalGoal=goals.filter(g=>g.count)[group]!;details.append(el('p',`${slot+1}번: ${catalog.overloadFields[option]!.label} Lv.${plan.levels[option]} 이상${option!==originalGoal.option?` (${catalog.overloadFields[originalGoal.option]!.label}의 타협 옵션)`:''}`));}
    details.append(el('p','아래 순서는 시뮬레이션에서 선택한 옵션을 기준으로 한 진행 예시입니다. 실제 옵작에서는 직접 설정한 타협 옵션도 함께 확인해 주세요. 허용한 타협 옵션으로 목표 줄 수와 최소 레벨을 충족했다면, 예시에 적힌 옵션만 찾으려고 계속 돌릴 필요는 없습니다. 선택을 바꾸면 이후 순서와 예상 비용은 달라질 수 있습니다.','og-note'));
    const steps=el('ol');
    const kept=plan.target.map((option,i)=>option&&(locks[p]!&(1<<i))&&rows[p]![i]!.option===option&&(plan.mode==='effects-first'||rows[p]![i]!.level>=plan.levels[option]!)?i:-1).filter(i=>i>=0);
    const lineNames=(slots:number[])=>slots.map(i=>`${i+1}번 줄`).join(' · ');
    const released=[0,1,2].filter(i=>(locks[p]!&(1<<i))&&!kept.includes(i));
    if(released.length)steps.append(el('li',`${lineNames(released)}의 잠금을 해제하세요. 이 줄은 이번 목표와 다르거나 수치작이 필요합니다.`));
    const knownEffects:(string|null)[]=rows[p]!.map(row=>row.option);const knownLevels=rows[p]!.map(row=>row.level);
    if(plan.target.every((option,i)=>!option||(knownEffects[i]===option&&knownLevels[i]!>=plan.levels[option]!))){details.append(el('p','이미 목표 달성 · 변경하거나 새로 잠글 필요 없습니다.'));card.append(details);return;}
    for(const slot of plan.order){const option=plan.target[slot];if(!option||kept.includes(slot))continue;
      const label=catalog.overloadFields[option]!.label;const level=plan.levels[option]!;const value=catalog.overloadSteps?.[option]?.[level-1];
      const protectedText=kept.length?`${lineNames(kept)}을 잠근 상태로`:'아무 줄도 잠그지 않고';
      if(knownEffects[slot]!==option){
        steps.append(el('li',`${protectedText}, ${slot+1}번 줄에 ${label}이 나올 때까지 ‘효과변경’을 하세요.${knownEffects[slot]===null?' 앞 작업 후 이미 이 효과가 있으면 건너뛰세요.':''}`));
        const lost=[0,1,2].filter(i=>i!==slot&&!kept.includes(i)&&plan.target[i]&&knownEffects[i]===plan.target[i]);
        if(lost.length)steps.append(el('li',`이 경로는 ${lineNames(lost)}의 기존 옵션을 잠그지 않고 진행하므로 바뀔 수 있습니다. 바뀌면 뒤 단계에서 다시 맞춥니다.`));
        for(let i=0;i<3;i++)if(!kept.includes(i)){knownEffects[i]=null;knownLevels[i]=0;}knownEffects[slot]=option;
      }
      if(plan.mode==='complete-line'&&knownLevels[slot]!<level){steps.append(el('li',`${protectedText}, ${slot+1}번 줄이 Lv.${level}${value===undefined?'':` (${value}%)`} 이상 나올 때까지 ‘수치변경’을 하세요. 이미 목표 이상이면 건너뛰세요.`));for(let i=0;i<3;i++)if(!kept.includes(i))knownLevels[i]=0;knownLevels[slot]=level;}
      kept.push(slot);
    }
    if(plan.mode==='effects-first'){
      steps.append(el('li','위 효과를 모두 맞췄으면 수치가 목표보다 낮은 줄의 잠금을 해제하세요.'));
      const targets=plan.target.flatMap((option,i)=>option?[`${i+1}번 줄 Lv.${plan.levels[option]} 이상`]:[]).join(' · ');
      steps.append(el('li',`${targets}: 이 조건을 이미 만족한 줄만 잠그고 ‘수치변경’을 하세요.`));
      steps.append(el('li','미완성 줄 중 하나라도 목표 수치 이상이 나오면 새 결과를 선택하세요. 그 줄도 잠근 뒤, 남은 줄이 목표 이상이 될 때까지 반복하세요.'));
    }
    steps.append(el('li','모든 목표를 맞추면 종료하세요. 목표에 못 미친 결과는 선택하지 마세요.'));
    details.append(steps);
    const schedule=Array.from({length:6},(_,i)=>`${i+1}번째 작업: ${plan.schedule&(1<<i)?'락 키':'모듈'}`).join(' → ');
    details.append(el('p',plan.schedule===0?'잠금은 모두 모듈을 사용하세요.':plan.schedule===63?'잠금은 모두 락 키를 사용하세요. 돌릴 때마다 같은 줄을 다시 잠그세요.':`잠금 방식: ${schedule}`));
    if(plan.schedule!==0&&plan.schedule!==63)details.append(el('p','한 목표가 나올 때까지 반복해서 돌리는 것을 작업 1회로 셉니다. 이미 맞춰져서 건너뛴 작업은 세지 않습니다. 모듈→락 키로 바꿀 때는 잠금을 해제한 뒤 키로 다시 잠그세요. 락 키→모듈로 바꿀 때는 모듈로 새로 잠그세요.','og-note'));
    card.append(details);
   });output.append(card);
  }
 };
 run.onclick=()=>{if(!known)return;output.replaceChildren();progress.hidden=false;progress.value=0;status.textContent='0% · 후보 배치를 준비합니다.';lockInputs(true);
  worker=new Worker(new URL('./overload-guide.worker.ts',import.meta.url),{type:'module'});worker.onmessage=event=>{if(disposed)return;if(event.data.progress){const {done,total}=event.data.progress;progress.value=Math.floor(done/total*100);status.textContent=`${progress.value}% · ${done}/${total}개 후보 작업 완료`;return;}cleanup();lockInputs(false);if(event.data.error){status.textContent=event.data.error;progress.hidden=true;}else{show(event.data.result);progress.value=100;status.textContent='계산 완료 · 현재 장비 설정은 변경하지 않았습니다.';}};worker.onerror=event=>{cleanup();lockInputs(false);progress.hidden=true;status.textContent=event.message||'계산에 실패했습니다.';};worker.postMessage({current:rows,locks,goals:goals.filter(g=>g.count),keyValue:Number(weight.value)});
 };lockInputs(false);if(!known)status.textContent='부위별 원본이 없거나 합계와 일치하지 않습니다. 캐릭터의 현재 장비 옵션을 먼저 입력해 주세요.';else invalidate();
}
