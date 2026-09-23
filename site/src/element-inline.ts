import fire from './assets/icon-code-fire.png';
import water from './assets/icon-code-water.png';
import wind from './assets/icon-code-wind.png';
import electronic from './assets/icon-code-electronic.png';
import iron from './assets/icon-code-iron.png';
import './element-inline.css';
const icons:Record<string,string>={작열:fire,수냉:water,풍압:wind,전격:electronic,철갑:iron};
const weaknesses:Record<string,string>={작열:'수냉',수냉:'전격',전격:'철갑',철갑:'풍압',풍압:'작열'};
/** 이 코드(보스·속성 저지)에 우월한 코드 — 작열이면 수냉. 없으면 빈 문자열. */
export function superiorCode(code:string):string{return weaknesses[code]??'';}
export function inlineCodeIcon(code?:string):HTMLElement{
 const span=document.createElement('span');span.className='inline-code-icons';span.setAttribute('aria-hidden','true');
 for(const key of code ? [code] : Object.keys(icons)){
  if(!icons[key])continue;
  const img=document.createElement('img');img.src=icons[key]!;img.alt='';img.title=key;span.append(img);
 }
 return span;
}
export function bossElementHint(code:string):HTMLElement{
 const span=document.createElement('span');span.className='inline-element-hint';
 if(!weaknesses[code])return span;
 span.append(inlineCodeIcon(code),document.createTextNode(`${code} 보스 · `),inlineCodeIcon(weaknesses[code]),document.createTextNode(`${weaknesses[code]} 우월`));
 return span;
}

export function elementText(text:string):DocumentFragment {
 const result=document.createDocumentFragment(); let end=0;
 for(const match of text.matchAll(/작열|수냉|풍압|전격|철갑/g)) {
  result.append(document.createTextNode(text.slice(end,match.index)),inlineCodeIcon(match[0]),document.createTextNode(match[0])); end=match.index!+match[0].length;
 }
 result.append(document.createTextNode(text.slice(end))); return result;
}
const enhanced=new WeakMap<HTMLSelectElement,()=>void>();
let serial=0;
export function refreshElementSelect(select:HTMLSelectElement,label:string):void {
 const old=enhanced.get(select); if(old){old();return;}
 const wrapper=document.createElement('span'); wrapper.className='element-select';
 const button=document.createElement('button'); button.type='button';button.className='element-select-button';button.setAttribute('role','combobox');button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
 const menu=document.createElement('div');menu.className='element-select-menu';menu.id=`element-options-${++serial}`;menu.setAttribute('role','listbox');menu.setAttribute('aria-label',label);menu.setAttribute('popover','auto');button.setAttribute('aria-controls',menu.id);
 select.before(wrapper);wrapper.append(select,button,menu);select.hidden=true;
 let active=select.selectedIndex;
 const refresh=()=>{button.replaceChildren(elementText(select.selectedOptions[0]?.textContent??'없음'));button.disabled=select.disabled;[...menu.children].forEach((row,i)=>row.setAttribute('aria-selected',String(i===select.selectedIndex)));};
 const close=()=>{if(menu.matches(':popover-open'))menu.hidePopover();menu.classList.remove('is-open');button.setAttribute('aria-expanded','false');button.removeAttribute('aria-activedescendant');};
 const highlight=()=>{[...menu.children].forEach((row,i)=>row.classList.toggle('is-active',i===active));button.setAttribute('aria-activedescendant',`${menu.id}-${active}`);};
 const choose=(i:number)=>{select.selectedIndex=i;close();refresh();select.dispatchEvent(new Event('change',{bubbles:true}));button.focus();};
 [...select.options].forEach((option,i)=>{const row=document.createElement('div');row.id=`${menu.id}-${i}`;row.setAttribute('role','option');row.append(elementText(option.textContent??''));row.addEventListener('click',event=>{event.preventDefault();choose(i);});menu.append(row);});
 const open=()=>{active=select.selectedIndex;refresh();highlight();const rect=button.getBoundingClientRect();menu.style.left=`${Math.max(4,Math.min(rect.left,window.innerWidth-280))}px`;menu.style.top=`${rect.bottom+4}px`;menu.style.minWidth=`${rect.width}px`;menu.style.maxHeight=`${Math.max(120,window.innerHeight-rect.bottom-12)}px`;if(menu.showPopover)menu.showPopover();menu.classList.add('is-open');button.setAttribute('aria-expanded','true');};
 menu.addEventListener('toggle',()=>{if(!menu.matches(':popover-open')){menu.classList.remove('is-open');button.setAttribute('aria-expanded','false');}});
 button.addEventListener('click',event=>{event.preventDefault();menu.classList.contains('is-open')?close():open();});
 button.addEventListener('keydown',event=>{
  if(event.key==='Escape'||event.key==='Tab'){close();return;}
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();if(!menu.classList.contains('is-open'))open();else active=event.key==='Home'?0:event.key==='End'?select.options.length-1:(active+(event.key==='ArrowDown'?1:-1)+select.options.length)%select.options.length;highlight();}
  else if((event.key==='Enter'||event.key===' ')&&menu.classList.contains('is-open')){event.preventDefault();choose(active);}
 });
 select.addEventListener('change',refresh);enhanced.set(select,refresh);refresh();
}
