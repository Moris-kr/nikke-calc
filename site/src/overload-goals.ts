import {overloadLinesOf} from './character-settings';
import {GROWTH_PARTS} from './growth-efficiency';
import type {OverloadLines} from './types';
export interface OverloadGoal {option:string; count:number; alternatives:string[]}
export interface GoalAllocation {lines:OverloadLines; substitutions:{from:string;to:string;count:number;rank:number}[]}
/** Exact minimum-effect-change assignment for the selected composition, not a module-cost optimizer. */
export function allocateOverloadGoals(goals:OverloadGoal[], current:OverloadLines, rank=1):GoalAllocation {
  if(!Number.isInteger(rank)||rank<1||rank>3)throw new Error('목표 순위는 1~3순위로 선택해 주세요.');
  const counts=new Map<string,number>();const substitutions:GoalAllocation['substitutions']=[];
  let total=0;const primaries=new Set<string>();
  for(const goal of goals){
    if(!Number.isInteger(goal.count)||goal.count<0||goal.count>4)throw new Error('각 효과는 0~4줄로 설정해 주세요.');
    if(!goal.count)continue;
    if(!goal.option||primaries.has(goal.option))throw new Error('동일한 목표 효과를 중복 등록할 수 없습니다.');
    primaries.add(goal.option);
    const choices=[goal.option,...goal.alternatives];
    if(new Set(choices.filter(Boolean)).size!==choices.filter(Boolean).length)throw new Error('타협 옵션은 서로 다른 효과를 선택해 주세요.');
    let selectedRank=rank;while(selectedRank>1&&!choices[selectedRank-1])selectedRank--;
    const chosen=choices[selectedRank-1]!;
    counts.set(chosen,(counts.get(chosen)??0)+goal.count);total+=goal.count;
    if(chosen!==goal.option)substitutions.push({from:goal.option,to:chosen,count:goal.count,rank:choices.indexOf(chosen)+1});
  }
  if(total>12)throw new Error('목표 옵션은 합계 12줄까지 설정할 수 있습니다.');
  if([...counts.values()].some(count=>count>4))throw new Error('타협 후 같은 효과가 4줄을 초과합니다. 부위별 중복이 불가능하므로 목표를 바꿔 주세요.');
  const original=overloadLinesOf(current),lines=overloadLinesOf({});
  type Edge={to:number;rev:number;cap:number;cost:number};
  const graph:Edge[][]=[];const vertex=()=>{graph.push([]);return graph.length-1;};
  const add=(from:number,to:number,cap:number,cost:number)=>{const edge={to,rev:graph[to]!.length,cap,cost};graph[from]!.push(edge);graph[to]!.push({to:from,rev:graph[from]!.length-1,cap:0,cost:-cost});return edge;};
  const source=vertex(),sink=vertex();const rows=GROWTH_PARTS.map(()=>Array.from({length:3},()=>vertex()));
  for(const part of rows)for(const row of part)add(row,sink,1,0);
  const assignments:{edge:Edge;part:number;row:number;option:string}[]=[];
  for(const [option,count] of counts){const effect=vertex();add(source,effect,count,0);
    GROWTH_PARTS.forEach((part,p)=>{const partEffect=vertex();add(effect,partEffect,1,0);
      rows[p]!.forEach((slot,row)=>assignments.push({edge:add(partEffect,slot,1,original[part][row]!.option===option?0:1),part:p,row,option}));
    });
  }
  for(let flow=0;flow<total;flow++){
    const distance=graph.map(()=>Infinity),previous:({from:number;edge:number}|undefined)[]=graph.map(()=>undefined);distance[source]=0;
    for(let pass=0;pass<graph.length;pass++){let changed=false;graph.forEach((edges,from)=>edges.forEach((edge,index)=>{if(edge.cap>0&&distance[from]!+edge.cost<distance[edge.to]!){distance[edge.to]=distance[from]!+edge.cost;previous[edge.to]={from,edge:index};changed=true;}}));if(!changed)break;}
    if(!previous[sink])throw new Error('부위별 중복 없이 배치할 수 없는 목표입니다.');
    for(let v=sink;v!==source;){const step=previous[v]!;const edge=graph[step.from]![step.edge]!;edge.cap--;graph[v]![edge.rev]!.cap++;v=step.from;}
  }
  for(const assignment of assignments)if(assignment.edge.cap===0)lines[GROWTH_PARTS[assignment.part]!]![assignment.row]={option:assignment.option,level:15};
  return {lines,substitutions};
}
