import {allocateOverloadGoals,type OverloadGoal} from './overload-goals';
import type {OverloadLines} from './types';
export function overloadGoalEditor(fields:Record<string,{label:string}>,getCurrent:()=>OverloadLines,onApply:(lines:OverloadLines,description:string)=>void,prefix:string):HTMLElement{
 const host=document.createElement('details');host.className='growth-goals';
 const summary=document.createElement('summary');summary.textContent='12줄 목표 구성';host.append(summary);
 const note=document.createElement('p');note.className='growth-note';note.textContent='예: 우월 4줄 + 공격력 4줄 + 크리티컬 대미지 4줄. 줄 수를 바꾸면 부위별 목표에 바로 반영됩니다. 효과마다 최대 4줄, 합계 최대 12줄이며, 이미 12줄이면 다른 효과의 줄 수를 먼저 줄여 주세요. 같은 효과가 한 부위에 중복되지 않도록 현재 배치를 최대한 유지합니다. 실제 계산은 계산하기를 누르면 시작합니다.';host.append(note);
 const goals:OverloadGoal[]=Object.keys(fields).map(option=>({option,count:0,alternatives:[]}));
 const table=document.createElement('div');table.className='growth-goal-rows';
 const counts:HTMLSelectElement[]=[];const notice=document.createElement('p');notice.className='growth-note';notice.setAttribute('aria-live','polite');
 const update=()=>{notice.textContent=`현재 목표 합계 ${goals.reduce((sum,g)=>sum+g.count,0)}/12줄`;};
 const sync=()=>{const totals=new Map<string,number>();for(const rows of Object.values(getCurrent()))for(const row of rows??[])if(row.option)totals.set(row.option,(totals.get(row.option)??0)+1);goals.forEach((g,i)=>{g.count=totals.get(g.option)??0;counts[i]!.value=String(g.count);});update();};
 for(const goal of goals){const row=document.createElement('div');row.className='growth-goal-row';const label=document.createElement('strong');label.textContent=fields[goal.option]!.label;
  const count=document.createElement('select');count.setAttribute('aria-label',`${prefix} ${label.textContent} 목표 줄 수`);for(let n=0;n<=4;n++)count.add(new Option(`${n}줄`,String(n)));count.onchange=()=>{
   const selected=Number(count.value);sync();const previous=goal.count;goal.count=selected;count.value=String(selected);
   try{const plan=allocateOverloadGoals(goals,getCurrent(),1);const description=goals.filter(g=>g.count).map(g=>`${fields[g.option]!.label} ${g.count}줄`).join(' · ')||'목표 옵션 없음';onApply(plan.lines,description);update();}
   catch(error){goal.count=previous;count.value=String(previous);notice.textContent=error instanceof Error?error.message:String(error);}
  };counts.push(count);row.append(label,count);table.append(row);
 }
 host.append(table,notice);host.addEventListener('goals-changed',sync);sync();host.addEventListener('toggle',()=>{if(host.open)sync();});return host;
}
