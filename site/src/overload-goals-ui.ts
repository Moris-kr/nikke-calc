import {allocateOverloadGoals,type OverloadGoal} from './overload-goals';
import type {OverloadLines} from './types';
export function overloadGoalEditor(fields:Record<string,{label:string}>,getCurrent:()=>OverloadLines,onApply:(lines:OverloadLines,description:string)=>void,prefix:string):HTMLElement{
 const host=document.createElement('details');host.className='growth-goals';
 const summary=document.createElement('summary');summary.textContent='12줄 목표 구성 · 타협 옵션';host.append(summary);
 const note=document.createElement('p');note.className='growth-note';note.textContent='예: 우월 4줄 + 공격력 4줄 + 크리티컬 대미지 4줄. 효과마다 최대 4줄, 합계 12줄입니다. 2·3순위 타협안을 적용하면 지정한 대체 효과로 바꿉니다. 같은 효과가 부위에 중복되지 않도록 현재 배치를 최대한 유지합니다. 모듈 분석에서는 배치를 다시 비교합니다.';host.append(note);
 const goals:OverloadGoal[]=Object.keys(fields).map(option=>({option,count:0,alternatives:['','']}));
 const table=document.createElement('div');table.className='growth-goal-rows';
 const counts:HTMLSelectElement[]=[];const notice=document.createElement('p');notice.className='growth-note';notice.setAttribute('aria-live','polite');
 const update=()=>{notice.textContent=`목표 합계 ${goals.reduce((sum,g)=>sum+g.count,0)}/12줄 · 적용 버튼을 눌러야 부위별 목표에 반영됩니다.`;};
 for(const goal of goals){const row=document.createElement('div');row.className='growth-goal-row';const label=document.createElement('strong');label.textContent=fields[goal.option]!.label;
  const count=document.createElement('select');count.setAttribute('aria-label',`${prefix} ${label.textContent} 목표 줄 수`);for(let n=0;n<=4;n++)count.add(new Option(`${n}줄`,String(n)));count.onchange=()=>{goal.count=Number(count.value);update();};counts.push(count);row.append(label,count);
  for(let i=0;i<2;i++){const select=document.createElement('select');select.setAttribute('aria-label',`${prefix} ${label.textContent} ${i+2}순위 타협 옵션`);select.add(new Option(`${i+2}순위 · 없음`,''));for(const [key,field] of Object.entries(fields))if(key!==goal.option)select.add(new Option(field.label,key));select.onchange=()=>{goal.alternatives[i]=select.value;update();};row.append(select);}
  table.append(row);
 }
 const actions=document.createElement('div');actions.className='growth-goal-actions';
 for(let rank=1;rank<=3;rank++){const button=document.createElement('button');button.type='button';button.textContent=rank===1?'원래 목표 적용':`${rank}순위 타협안 적용`;button.className='growth-secondary';button.onclick=()=>{
  try{if(!goals.some(goal=>goal.count))throw new Error('목표 줄 수를 먼저 설정해 주세요.');
    const plan=allocateOverloadGoals(goals,getCurrent(),rank);
    const primary=goals.filter(g=>g.count).map(g=>`${fields[g.option]!.label} ${g.count}줄`).join(' · ');
    const substitutions=plan.substitutions.map(s=>`${fields[s.from]!.label} → ${fields[s.to]!.label} ${s.count}줄 (${s.rank}순위)`);
    const description=`${primary}${substitutions.length?' / 타협: '+substitutions.join(' · '):' / 원래 목표'}`;
    onApply(plan.lines,description);notice.textContent=`적용: ${description}`;
  }catch(error){notice.textContent=error instanceof Error?error.message:String(error);}
 };actions.append(button);}
 const importButton=document.createElement('button');importButton.type='button';importButton.className='growth-secondary';importButton.textContent='현재 목표 줄 수 가져오기';importButton.onclick=()=>{const totals=new Map<string,number>();for(const rows of Object.values(getCurrent()))for(const row of rows??[])if(row.option)totals.set(row.option,(totals.get(row.option)??0)+1);goals.forEach((g,i)=>{g.count=totals.get(g.option)??0;counts[i]!.value=String(g.count);});update();};actions.append(importButton);
 host.append(table,actions,notice);update();return host;
}
