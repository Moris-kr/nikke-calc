import type {OverloadLines} from './types';
const key=(name:string)=>`nikke-growth-target:v1:${name}`;
export function loadGrowthTarget(name:string,fields:Record<string,unknown>):{lines:OverloadLines;levels:Record<string,number>}|null{
 try{
  const value=JSON.parse(localStorage.getItem(key(name))??'null');
  if(!value?.lines||!value.levels)return null;
  for(const part of ['머리','몸통','팔','다리'])if(!Array.isArray(value.lines[part])||value.lines[part].length!==3||value.lines[part].some((row:any)=>!row||typeof row.option!=='string'||(row.option&&!Object.hasOwn(fields,row.option))||!Number.isInteger(row.level)||row.level<1||row.level>15))return null;
  for(const [option,level] of Object.entries(value.levels))if(!Object.hasOwn(fields,option)||!Number.isInteger(level)||Number(level)<1||Number(level)>15)return null;
  return value;
 }catch{return null;}
}
export function saveGrowthTarget(name:string,lines:OverloadLines,levels:Record<string,number>):boolean{
 try{localStorage.setItem(key(name),JSON.stringify({lines,levels}));return true;}catch{return false;}
}
export function clearGrowthTarget(name:string):boolean{
 try{localStorage.removeItem(key(name));return true;}catch{return false;}
}
export function loadGrowthExcluded(name:string):boolean{
 try{return localStorage.getItem(`nikke-growth-excluded:v1:${name}`)==='true';}catch{return false;}
}
export function saveGrowthExcluded(name:string,excluded:boolean):boolean{
 try{localStorage.setItem(`nikke-growth-excluded:v1:${name}`,String(excluded));return true;}catch{return false;}
}
