import type { DeckResultEntry, ShotgunHeatmapData, ShotgunHeatmapFrame, ShotgunHeatmapScene, SimulationRequest, SimulationResult } from './types';
import { conditionChips } from './report';

export const summarizeFrames = (frames: ShotgunHeatmapFrame[]) => frames.reduce((a, f) => ({
  fired:a.fired+f.pellets, hit:a.hit+f.pellets*f.hit, core:a.core+f.pellets*f.hit*f.core, shots:a.shots+1,
}), {fired:0,hit:0,core:0,shots:0});

export function frameAt(frames: ShotgunHeatmapFrame[], time: number) {
  let lo=0, hi=frames.length;
  while(lo<hi) { const mid=(lo+hi)>>>1; if(frames[mid]!.t<=time) lo=mid+1; else hi=mid; }
  return frames[lo-1];
}

function contains(shape: ShotgunHeatmapScene['shapes'][number], x: number, y: number) {
  const [kind,sx,sy,w,h,rotation]=shape;
  if(w<=0||h<=0) return false;
  const a=-rotation*Math.PI/180, dx=x-sx, dy=y-sy;
  const lx=dx*Math.cos(a)-dy*Math.sin(a), ly=dx*Math.sin(a)+dy*Math.cos(a);
  if(kind==='circle') return (lx/(w/2))**2+(ly/(h/2))**2<=1;
  if(kind==='rect') return Math.abs(lx)<=w/2&&Math.abs(ly)<=h/2;
  const ratio=(ly+h/2)/h;
  return ratio>=0&&ratio<=1&&Math.abs(lx)<=w/2*ratio;
}

type Point = {x:number;y:number;kind:'body'|'core'|'miss'|'density'};
export function pelletPoints(scene: ShotgunHeatmapScene): Point[] {
  return Array.from({length:1024},(_,i)=>{
    const r=scene.radius*((i+.5)/1024)**(1/scene.exponent), angle=i*2.399963229728653;
    const x=scene.aim[0]+r*Math.cos(angle), y=scene.aim[1]+r*Math.sin(angle);
    if(!scene.spatial) return {x,y,kind:'density'};
    const hit=scene.shapes.some(s=>contains(s,x,y)), c=scene.core;
    return {x,y,kind:hit?(c&&(x-c[0])**2+(y-c[1])**2<=c[2]**2?'core':'body'):'miss'};
  });
}

/** Reproducible visual sample, independent of combat RNG and expected totals. */
export function shotPellets(scene: ShotgunHeatmapScene, count:number, seed:number):Point[] {
  let state=seed>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state+.5)/4294967296;};
  return Array.from({length:count},()=>{
    const r=scene.radius*random()**(1/scene.exponent),a=random()*Math.PI*2;
    const x=scene.aim[0]+r*Math.cos(a),y=scene.aim[1]+r*Math.sin(a);
    if(!scene.spatial)return {x,y,kind:'density'};
    const hit=scene.shapes.some(s=>contains(s,x,y)),c=scene.core;
    return {x,y,kind:hit?(c&&(x-c[0])**2+(y-c[1])**2<=c[2]**2?'core':'body'):'miss'};
  });
}
const COLORS={body:'#4ddcd0',core:'#ffd061',miss:'#ff982e',density:'#8eb7ff'};
const percent=(value:number,total:number)=>`${(total>0?value/total*100:0).toFixed(1)}%`;
const number=(value:number)=>value.toLocaleString('ko-KR',{maximumFractionDigits:1});
const cache=new WeakMap<DeckResultEntry, SimulationResult>();
let dismissActive:(()=>void)|undefined;

/** Diagnostics run in the existing worker, only on demand. Saved result inputs are authoritative. */
export function openShotgunHeatmap(entry: DeckResultEntry, deckName: string,
  simulate:(request:SimulationRequest)=>Promise<SimulationResult>) {
  dismissActive?.();
  const previousFocus=document.activeElement as HTMLElement|null;
  const overlay=document.createElement('div');
  overlay.className='custom-modal shotgun-modal';
  overlay.innerHTML=`<section class="custom-card shotgun-card" role="dialog" aria-modal="true" aria-label="샷건 히트맵">
    <div class="custom-head"><div><small>SHOTGUN ANALYSIS</small><h2>샷건 히트맵</h2></div><button type="button" data-hm-close aria-label="히트맵 닫기">✕</button></div>
    <p data-hm-condition class="hm-condition"></p><p data-hm-status role="status">사격별 진단을 계산하는 중… 이 창을 처음 열 때만 추가 계산합니다.</p>
    <div data-hm-content hidden>
      <div class="hm-characters" role="group" aria-label="샷건 캐릭터 선택"></div>
      <div class="hm-toolbar"><label>표시 방식 <select data-hm-view><option value="shot">시점별 탄착군</option><option value="density">전체 전투 · 탄착 밀도</option><option value="outcome">전체 전투 · 명중 구분</option></select></label>
      <label><input type="checkbox" data-hm-outline checked> 보스·코어 윤곽</label><label><input type="checkbox" data-hm-spread checked> 탄착군 범위</label></div>
      <div class="hm-layout"><div class="hm-visual"><canvas data-hm-canvas width="640" height="640" aria-label="샷건 탄착군과 명중 분포"></canvas>
      <div class="hm-legend" data-hm-legend></div>
      <p data-hm-caption></p></div><div class="hm-detail"><h3 data-hm-name></h3><div data-hm-totals class="hm-metrics"></div>
      <h4>선택 시점의 사격</h4><div data-hm-frame></div><h4>풀버스트 여부별 명중</h4><div data-hm-burst></div>
      <details><summary>판정과 수치 읽는 법</summary><p>표시는 실제 게임에서 촬영한 탄흔이 아닌 계산 엔진의 확률 분포입니다. 시점별 점은 해당 사격의 펠릿 수만큼 생성한 모형 표본입니다. 번호로 빗나간 점까지 셀 수 있습니다. 표시 표본의 명중 개수는 기대 명중률과 다를 수 있으며 전투 대미지 계산에는 사용하지 않습니다. 전체 누적 히트맵은 별도의 1,024점 확률 적분을 사용합니다. 재생 중 점의 이동은 설명용 모션입니다.</p>
      <p>명중과 코어 비율의 분모는 발사한 전체 펠릿입니다. 몸통과 코어는 중복 없이 나눕니다. 난수 모드에서도 여기의 비율은 사격 시점별 기대값이며 실제 추첨 결과가 아닙니다. 무적·속성 저항·관통 중첩·스킬 추가 대미지는 이 공간 히트맵에 포함하지 않습니다.</p>
      <p>전체 전투는 모든 사격을 펠릿 수로 가중 합산합니다. 밝기는 선택 캐릭터 안에서 상대적인 밀도입니다. 도형·조준점이 변하면 누적 분포와 선택 시점의 윤곽이 다를 수 있습니다. 기존 고정 명중률 모드는 빗나간 공간 위치를 정의하지 않으므로 밀도만 표시합니다.</p></details></div></div>
      <div class="hm-playback"><button type="button" data-hm-play>재생</button><button type="button" data-hm-prev aria-label="이전 사격">이전 사격</button><button type="button" data-hm-next aria-label="다음 사격">다음 사격</button>
      <label>재생속도 <select data-hm-speed><option value=".5">0.5배</option><option value="1" selected>1배</option><option value="2">2배</option><option value="5">5배</option></select></label><output data-hm-time></output></div>
      <input type="range" data-hm-timebar min="0" step="0.01" value="0" aria-label="히트맵 전투 시간">
      <canvas data-hm-chart width="1000" height="140" aria-label="시간별 예상 명중률 추이 · 클릭하여 시점 선택"></canvas>
      <p class="hm-note">시간 막대나 그래프를 눌러 탐색하세요. 청록 선은 사격 시점별 명중률, 노란 선은 전체 펠릿 대비 코어 비율입니다.</p>
    </div><p class="hm-note">탄착 분포·보스 크기는 계산 모형의 가정입니다. 인게임 실측으로 확정된 히트박스나 분포가 아닙니다.</p>
  </section>`;
  // Keep playback next to the visual instead of below a long detail column.
  overlay.querySelector('.hm-layout')!.before(overlay.querySelector('.hm-playback')!, overlay.querySelector('[data-hm-timebar]')!);
  document.body.append(overlay);
  const el=<T extends HTMLElement=HTMLElement>(s:string)=>overlay.querySelector<T>(s)!;
  const conditions=conditionChips(entry).filter(chip=>!entry.request.shotgunGeometry||!chip.startsWith('샷건'));
  if(entry.request.shotgunGeometry)conditions.push('보스메이커 도형·조준점 판정');
  conditions.push(entry.request.rngMode==='expected'?'기대값 계산':'난수 계산');
  el('[data-hm-condition]').textContent=`${deckName} · ${conditions.join(' · ')}`;
  let closed=false, playing=false, raf=0, last=0, time=0, name='', data:ShotgunHeatmapData|undefined;
  const heatCache=new Map<string, HTMLCanvasElement>();
  const close=()=>{if(closed)return;closed=true;cancelAnimationFrame(raf);document.removeEventListener('keydown',onKey,true);overlay.remove();previousFocus?.focus();if(dismissActive===close)dismissActive=undefined;};
  dismissActive=close;
  const onKey=(e:KeyboardEvent)=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
    if(e.key==='Tab') {
      const focusable=[...overlay.querySelectorAll<HTMLElement>('button:not(:disabled),select,input,summary')].filter(e=>e.getClientRects().length);
      const first=focusable[0],end=focusable.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();end?.focus();}
      else if(!e.shiftKey&&document.activeElement===end){e.preventDefault();first?.focus();}
    }
  };
  document.addEventListener('keydown',onKey,true);
  el('[data-hm-close]').onclick=close;
  el('[data-hm-close]').focus();
  let backdropPress=false;
  overlay.onpointerdown=e=>{backdropPress=e.target===overlay;};
  overlay.onclick=e=>{if(e.target===overlay&&backdropPress)close();backdropPress=false;};
  const slider=el<HTMLInputElement>('[data-hm-timebar]'); slider.max=String(entry.request.duration);
  const view=el<HTMLSelectElement>('[data-hm-view]');
  const canvas=el<HTMLCanvasElement>('[data-hm-canvas]'), chart=el<HTMLCanvasElement>('[data-hm-chart]');
  const ctx=canvas.getContext('2d'), chartCtx=chart.getContext('2d');
  const metric=(label:string,value:string)=>{const box=document.createElement('div');const small=document.createElement('small');small.textContent=label;const strong=document.createElement('strong');strong.textContent=value;box.append(small,strong);return box;};
  function draw() {
    if(!data||!ctx)return;
    const f=frameAt(data.frames,time), scene=f?data.scenes[f.scene]:undefined;
    const dots=f&&scene?shotPellets(scene,f.pellets,entry.request.seed+Math.round(f.t*10000)):[];
    el('[data-hm-legend]').innerHTML=view.value==='shot'
      ? '<span style="color:#ff4545">● 명중 위치</span><span style="color:#ffd061">○ 코어 명중 테두리</span><span style="color:#ff982e">● 빗나감</span><span style="color:#8eb7ff">● 고정확률 모드</span>'
      : '<span style="color:#4ddcd0">● 몸통</span><span style="color:#ffd061">● 코어</span><span style="color:#ff982e">● 빗나감</span><span style="color:#8eb7ff">● 밀도</span>';
    const [bx,by,bw]=data.bounds, scale=600/bw, px=(x:number)=>20+(x-bx)*scale, py=(y:number)=>20+(y-by)*scale;
    ctx.fillStyle='#07111e';ctx.fillRect(0,0,640,640);
    ctx.strokeStyle='#1b2b42';ctx.lineWidth=1;
    for(let i=20;i<=620;i+=60){ctx.beginPath();ctx.moveTo(i,20);ctx.lineTo(i,620);ctx.moveTo(20,i);ctx.lineTo(620,i);ctx.stroke();}
    if(view.value!=='shot') {
      let heat=heatCache.get(view.value);
      if(!heat){
      heat=document.createElement('canvas');heat.width=data.size;heat.height=data.size;
      const hctx=heat.getContext('2d')!;
      const peak=Math.max(...data.density,1e-9);
      for(let i=0;i<data.density.length;i++) {
        const n=data.density[i]!;if(!n)continue;
        const intensity=Math.sqrt(n/peak);
        if(view.value==='outcome'&&data.spatial){
          const b=data.body[i]!/n,c=data.core[i]!/n,m=data.miss[i]!/n;
          hctx.fillStyle=`rgba(${Math.round(77*b+255*c+255*m)},${Math.round(220*b+208*c+152*m)},${Math.round(208*b+97*c+46*m)},${intensity})`;
        }else hctx.fillStyle=`rgba(100,178,255,${intensity})`;
        hctx.fillRect(i%data.size,Math.floor(i/data.size),1,1);
      }
      heatCache.set(view.value,heat);
      }
      ctx.imageSmoothingEnabled=true;ctx.drawImage(heat,20,20,600,600);
    }
    if(scene) {
      if(el<HTMLInputElement>('[data-hm-outline]').checked){
        ctx.strokeStyle='#d3dfef';ctx.lineWidth=2;ctx.fillStyle='rgba(173,203,239,.035)';
        for(const [kind,x,y,w,h,rotation] of scene.shapes){
          ctx.save();ctx.translate(px(x),py(y));ctx.rotate(rotation*Math.PI/180);ctx.beginPath();
          if(kind==='circle')ctx.ellipse(0,0,w*scale/2,h*scale/2,0,0,Math.PI*2);
          else if(kind==='rect')ctx.rect(-w*scale/2,-h*scale/2,w*scale,h*scale);
          else {ctx.moveTo(0,-h*scale/2);ctx.lineTo(w*scale/2,h*scale/2);ctx.lineTo(-w*scale/2,h*scale/2);ctx.closePath();}
          ctx.fill();ctx.stroke();ctx.restore();
        }
        if(scene.core){ctx.strokeStyle=COLORS.core;ctx.beginPath();ctx.arc(px(scene.core[0]),py(scene.core[1]),scene.core[2]*scale,0,Math.PI*2);ctx.stroke();}
      }
      if(el<HTMLInputElement>('[data-hm-spread]').checked){ctx.strokeStyle='#7e9dce';ctx.setLineDash([5,6]);ctx.beginPath();ctx.arc(px(scene.aim[0]),py(scene.aim[1]),scene.radius*scale,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
      if(view.value==='shot'){
        const progress=playing?Math.min(1,Math.max(0,(time-f!.t)/.18)):1;
        for(const [index,p] of dots.entries()){
          const hit=p.kind==='body'||p.kind==='core';
          const x=px(scene.aim[0]+(p.x-scene.aim[0])*progress),y=py(scene.aim[1]+(p.y-scene.aim[1])*progress);
          ctx.fillStyle=hit?'#ff4545':p.kind==='miss'?COLORS.miss:COLORS.density;
          ctx.globalAlpha=1;
          ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
          if(p.kind==='core'){ctx.strokeStyle=COLORS.core;ctx.lineWidth=1;ctx.stroke();}
          if(progress===1){ctx.fillStyle='#ffffff';ctx.font='bold 12px system-ui';ctx.fillText(String(index+1),x+6,y-5);}
        }ctx.globalAlpha=1;
      }
      ctx.strokeStyle='#fff';ctx.beginPath();ctx.moveTo(px(scene.aim[0])-7,py(scene.aim[1]));ctx.lineTo(px(scene.aim[0])+7,py(scene.aim[1]));ctx.moveTo(px(scene.aim[0]),py(scene.aim[1])-7);ctx.lineTo(px(scene.aim[0]),py(scene.aim[1])+7);ctx.stroke();
    }
    ctx.fillStyle='#b6c9e4';ctx.font='14px system-ui';ctx.fillText(`범위 ${bw.toFixed(0)} × ${bw.toFixed(0)} 모형 단위`,22,638);
    el('[data-hm-caption]').textContent=view.value==='shot'?(f?`${f.t.toFixed(2)}초 · ${f.pellets}펠릿 표시 표본${scene?.spatial?` · 명중 ${dots.filter(p=>p.kind==='body'||p.kind==='core').length}개 / 빗나감 ${dots.filter(p=>p.kind==='miss').length}개`:''} · 확정 탄흔이 아닌 모형 예시`:'아직 샷건을 발사하지 않은 시점입니다.'):'전투 전체의 누적 기대 분포 · 윤곽과 조준점은 선택 시점 기준';
    el('[data-hm-frame]').replaceChildren(...(f&&scene?[
      metric('사격 시각 / 상태',`${f.t.toFixed(2)}초 · ${f.fullBurst?'풀버스트':'일반 구간'}`),
      metric('예상 명중 / 코어',`${percent(f.hit,1)} / ${percent(f.hit*f.core,1)}`),
      metric('탄착군 직경 / 명중 보정',`${(scene.radius*2).toFixed(1)} / ${f.accuracy.toFixed(2)}%`),
      metric('조준점 / 코어 노출',`(${scene.aim.map(v=>v.toFixed(1)).join(', ')}) / ${scene.spatial?(scene.core?'있음':'없음'):'공간 판정 없음'}`),
    ]:[metric('대기','첫 사격 전')])) ;
    slider.value=String(time);el('[data-hm-time]').textContent=`${time.toFixed(2)} / ${entry.request.duration}초`;
    if(chartCtx){
      chartCtx.fillStyle='#07111e';chartCtx.fillRect(0,0,1000,140);
      for(const [key,color] of [['hit',COLORS.body],['core',COLORS.core]] as const){
        chartCtx.strokeStyle=color;chartCtx.lineWidth=2;chartCtx.beginPath();
        data.frames.forEach((f,i)=>{const x=f.t/entry.request.duration*1000,y=120-(key==='hit'?f.hit:f.hit*f.core)*100;i?chartCtx.lineTo(x,y):chartCtx.moveTo(x,y);});chartCtx.stroke();
      }
      chartCtx.strokeStyle='#fff';const x=time/entry.request.duration*1000;chartCtx.beginPath();chartCtx.moveTo(x,0);chartCtx.lineTo(x,140);chartCtx.stroke();
      chartCtx.fillStyle='#b6c9e4';chartCtx.font='13px system-ui';chartCtx.fillText('100%',5,16);chartCtx.fillText('0%',5,136);
    }
  }
  function pause(){playing=false;cancelAnimationFrame(raf);el('[data-hm-play]').textContent='재생';}
  function tick(now:number){if(!playing||closed)return;if(now-last>=40){time=Math.min(entry.request.duration,time+(now-last)/1000*Number(el<HTMLSelectElement>('[data-hm-speed]').value));last=now;draw();}if(time>=entry.request.duration)pause();else raf=requestAnimationFrame(tick);}
  el('[data-hm-play]').onclick=()=>{if(playing){pause();draw();return;}if(time>=entry.request.duration)time=0;playing=true;last=performance.now();el('[data-hm-play]').textContent='일시정지';raf=requestAnimationFrame(tick);};
  slider.oninput=()=>{pause();time=Number(slider.value);draw();};
  chart.onclick=e=>{pause();const rect=chart.getBoundingClientRect();time=Math.max(0,Math.min(entry.request.duration,(e.clientX-rect.left)/rect.width*entry.request.duration));draw();};
  for(const [selector,direction] of [['[data-hm-prev]',-1],['[data-hm-next]',1]] as const)el(selector).onclick=()=>{if(!data)return;pause();const frames=direction===1?data.frames:[...data.frames].reverse();const f=frames.find(f=>direction===1?f.t>time+.0001:f.t<time-.0001);if(f)time=f.t;draw();};
  view.onchange=draw;el<HTMLInputElement>('[data-hm-outline]').onchange=draw;el<HTMLInputElement>('[data-hm-spread]').onchange=draw;
  void(async()=>{
    try{
      if(!ctx||!chartCtx)throw new Error('이 브라우저에서는 캔버스 표시를 사용할 수 없습니다.');
      const result=cache.get(entry)??await simulate({...entry.request,shotgunReport:true});
      if(!result.shotgunReport||!Object.keys(result.shotgunReport).length)throw new Error('이 전투에는 샷건 사격 기록이 없습니다. 샷건 캐릭터가 실제로 사격했는지 확인해 주세요.');
      cache.set(entry,result);
      if(closed)return;
      el('[data-hm-status]').textContent=Math.abs(result.squadTotal-entry.result.squadTotal)>.5?'현재 엔진으로 재계산한 진단입니다. 저장된 결과와 총 대미지가 달라 원래 결과를 덮어쓰지 않았습니다.':'저장된 결과의 전투 조건으로 사격 진단을 준비했습니다.';
      el('[data-hm-content]').hidden=false;
      const select=(selected:string)=>{
        name=selected;data=result.shotgunReport![name]!;heatCache.clear();
        el('[data-hm-name]').textContent=name;
        el('[data-hm-totals]').replaceChildren(metric('전체 명중',percent(data.hit,data.fired)),metric('코어',percent(data.coreHits,data.fired)),metric('몸통',percent(data.hit-data.coreHits,data.fired)),metric('빗나감',percent(data.fired-data.hit,data.fired)),metric('발사 펠릿 / 사격 횟수',`${number(data.fired)} / ${data.frames.length}회`),metric('캐릭터 대미지',number(result.charTotals[name]??0)));
        const summaries=[false,true].map(full=>{const s=summarizeFrames(data!.frames.filter(f=>f.fullBurst===full));return metric(full?'풀버스트 중':'일반 구간',s.fired?`${percent(s.hit,s.fired)} 명중 · ${number(s.fired)}펠릿`:'사격 없음');});el('[data-hm-burst]').replaceChildren(...summaries);
        overlay.querySelectorAll<HTMLButtonElement>('[data-hm-character]').forEach(b=>b.setAttribute('aria-pressed',String(b.textContent===name)));
        const outcome=view.querySelector<HTMLOptionElement>('option[value="outcome"]')!;outcome.disabled=!data.spatial;
        if(!data.spatial&&view.value==='outcome')view.value='density';draw();
      };
      for(const character of Object.keys(result.shotgunReport)){
        const button=document.createElement('button');button.type='button';button.dataset.hmCharacter='';button.textContent=character;button.onclick=()=>select(character);el('.hm-characters').append(button);
      }
      select(Object.keys(result.shotgunReport)[0]!);
    }catch(error){if(!closed)el('[data-hm-status]').textContent=`진단을 불러오지 못했습니다: ${(error as Error).message}`;}
  })();
  return close;
}
