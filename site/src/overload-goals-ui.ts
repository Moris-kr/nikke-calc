import {inlineCodeIcon} from './element-inline';
import {allocateOverloadGoals,type OverloadGoal} from './overload-goals';
import type {OverloadLines} from './types';
export function overloadGoalEditor(fields:Record<string,{label:string}>,getCurrent:()=>OverloadLines,onApply:(lines:OverloadLines,description:string)=>void,prefix:string,levels:Record<string,number>={}):HTMLElement{
 const host=document.createElement('details');host.className='growth-goals';
 const summary=document.createElement('summary');summary.textContent='12줄 목표 구성';host.append(summary);
 const note=document.createElement('p');note.className='growth-note';note.textContent='예: 우월 4줄 + 공격력 4줄 + 크리티컬 대미지 4줄. 줄 수를 바꾸면 부위별 목표에 바로 반영됩니다. 효과마다 최대 4줄, 합계 최대 12줄이며, 이미 12줄이면 다른 효과의 줄 수를 먼저 줄여 주세요. 같은 효과가 한 부위에 중복되지 않도록 현재 배치를 최대한 유지합니다. 0줄은 제거 목표가 아니라 요구하지 않는 옵션입니다. 기존 옵션을 지우기 위한 추가 변경은 하지 않습니다. 실제 계산은 계산하기를 누르면 시작합니다.';host.append(note);
 const goals:OverloadGoal[]=Object.keys(fields).map(option=>({option,count:0,alternatives:[]}));
 const table=document.createElement('div');table.className='growth-goal-rows';
 const counts:HTMLSelectElement[]=[];const levelSelects:HTMLSelectElement[]=[];const notice=document.createElement('p');notice.className='growth-note';notice.setAttribute('aria-live','polite');
 const update=()=>{notice.textContent=`현재 목표 합계 ${goals.reduce((sum,g)=>sum+g.count,0)}/12줄`;};
 const sync=()=>{const totals=new Map<string,number>();for(const rows of Object.values(getCurrent()))for(const row of rows??[])if(row.option)totals.set(row.option,(totals.get(row.option)??0)+1);goals.forEach((g,i)=>{g.count=totals.get(g.option)??0;counts[i]!.value=String(g.count);levelSelects[i]!.value=String(levels[g.option]??15);});update();};
 const apply=()=>{const plan=allocateOverloadGoals(goals,getCurrent(),1);for(const rows of Object.values(plan.lines))for(const row of rows??[])row.level=levels[row.option]??15;const description=goals.filter(g=>g.count).map(g=>`${fields[g.option]!.label} ${g.count}줄 · Lv.${levels[g.option]??15} 이상`).join(' · ')||'목표 옵션 없음';onApply(plan.lines,description);update();};
 for(const goal of goals){const row=document.createElement('div');row.className='growth-goal-row';const label=document.createElement('strong');label.textContent=fields[goal.option]!.label;if(goal.option==='element_bonus')label.prepend(inlineCodeIcon());
  const count=document.createElement('select');count.setAttribute('aria-label',`${prefix} ${label.textContent} 목표 줄 수`);for(let n=0;n<=4;n++)count.add(new Option(`${n}줄`,String(n)));count.onchange=()=>{
   const selected=Number(count.value);sync();const previous=goal.count;goal.count=selected;count.value=String(selected);
   try{apply();}
   catch(error){goal.count=previous;count.value=String(previous);notice.textContent=error instanceof Error?error.message:String(error);}
  };counts.push(count);const level=document.createElement('select');level.className='growth-goal-level';level.setAttribute('aria-label',`${prefix} ${label.textContent} 수치작 타협레벨`);for(let n=1;n<=15;n++)level.add(new Option(`Lv.${n} 이상`,String(n)));level.value=String(levels[goal.option]??15);level.onchange=()=>{const selected=Number(level.value);sync();levels[goal.option]=selected;level.value=String(selected);apply();};levelSelects.push(level);row.append(label,count,level);table.append(row);
 }
 host.addEventListener('set-eight-lines',()=>{sync();for(const [i,goal] of goals.entries()){goal.count=['element_bonus','atk_pct'].includes(goal.option)?4:0;counts[i]!.value=String(goal.count);}apply();});
 host.addEventListener('set-all-levels',event=>{sync();const value=(event as CustomEvent<number>).detail;for(const [i,goal] of goals.entries()){levels[goal.option]=value;levelSelects[i]!.value=String(value);}apply();});
 host.append(table,notice);host.addEventListener('goals-changed',sync);sync();host.addEventListener('toggle',()=>{if(host.open)sync();});return host;
}
