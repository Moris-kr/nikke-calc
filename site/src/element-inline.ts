import fire from './assets/icon-code-fire.png';
import water from './assets/icon-code-water.png';
import wind from './assets/icon-code-wind.png';
import electronic from './assets/icon-code-electronic.png';
import iron from './assets/icon-code-iron.png';
import './element-inline.css';
const icons:Record<string,string>={작열:fire,수냉:water,풍압:wind,전격:electronic,철갑:iron};
const weaknesses:Record<string,string>={작열:'수냉',수냉:'전격',전격:'철갑',철갑:'풍압',풍압:'작열'};
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
