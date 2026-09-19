import { overloadLinesOf } from './character-settings';
import { GROWTH_PARTS, growthPercent, maximumRequest, optionGap, verifiedLines, type GrowthTargets } from './growth-efficiency';
import { formatDamage } from './model';
import { canvasToBlob, downloadImage, loadPortraits, renderReport } from './report';
import type { BatchResult, CharacterMeta, CharacterOverrides, DeckResultEntry, OverloadLines, SettingsCatalog, SimulationRequest, SimulationResult } from './types';
import './growth-efficiency.css';
interface Deps {
  settings: SettingsCatalog;
  catalog: Map<string, CharacterMeta>;
  current: (deckId: number, name: string) => CharacterOverrides | undefined;
  deckName: (id: number) => string;
  simulate: (request: SimulationRequest) => Promise<SimulationResult>;
}
interface Pair { before: DeckResultEntry; after: DeckResultEntry; gaps: string[]; reportGaps: string[] }
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
  const el = document.createElement(tag); el.textContent = text; el.className = cls; return el;
};
const percent = (a: number, b: number) => {
  const n = growthPercent(a, b); return n === null ? '비교 불가 (기존 딜 0)' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
};
export function openGrowthEfficiency(batch: BatchResult, deps: Deps): void {
  const steps = deps.settings.overloadSteps ?? {};
  const snapshot = structuredClone(batch);
  const opener = document.activeElement as HTMLElement | null;
  const overlay = node('div', '', 'growth-overlay');
  const dialog = node('section', '', 'growth-dialog'); dialog.role = 'dialog'; dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', '육성효율 계산하기');
  const header = node('header'); const title = node('div'); title.append(node('small', 'OVERLOAD · GROWTH REPORT'), node('h2', '각 니케별 유효옵션을 설정해주세요'));
  const close = node('button', '닫기', 'growth-close'); header.append(title, close);
  const intro = node('p', '결과에 저장된 덱과 전투 조건을 기준으로 비교합니다. 선택한 효과는 모두 Lv.15로 계산하며, 빈 옵션은 비워 둡니다. 스킬·큐브·장비 강화 등 다른 육성은 그대로 유지합니다.', 'growth-note');
  const editor = node('div'); const footer = node('footer');
  const calculate = node('button', '계산하기', 'growth-primary');
  const save = node('button', '보고서 이미지 만들기', 'growth-secondary'); save.disabled = true;
  const message = node('p', '', 'growth-status'); message.setAttribute('aria-live', 'polite');
  const output = node('div', '', 'growth-output'); footer.append(calculate, save);
  dialog.append(header, intro, editor, footer, message, output); overlay.append(dialog); document.body.append(overlay);
  let closed = false, busy = false, pairs: Pair[] = [];
  const targets: GrowthTargets[] = [];
  const originals: Record<string, OverloadLines | undefined>[] = [];
  const acknowledgments: HTMLInputElement[] = [];
  const closeDialog = () => { closed = true; overlay.remove(); document.removeEventListener('keydown', onKey, true); opener?.focus(); };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopImmediatePropagation(); closeDialog(); }
    if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),summary')];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true); close.onclick = closeDialog;
  overlay.onclick = event => { if (event.target === overlay) closeDialog(); }; close.focus();
  const invalidate = () => { pairs = []; save.disabled = true; output.replaceChildren(); message.textContent = '옵션이 변경되었습니다. 다시 계산해 주세요.'; };
  snapshot.decks.forEach((entry, index) => {
    targets[index] = {}; originals[index] = {};
    const group = node('section', '', 'growth-deck'); group.append(node('h3', deps.deckName(entry.deckId)));
    for (const name of entry.request.squad.filter(Boolean)) {
      const totals = entry.request.characters?.[name]?.overload ?? deps.settings.characters[name]?.overload ?? {};
      const source = verifiedLines(totals, entry.request.characters?.[name]?.overloadLines ?? deps.current(entry.deckId, name)?.overloadLines, steps);
      originals[index]![name] = source;
      const lines = overloadLinesOf(source); targets[index]![name] = lines;
      const card = node('details', '', 'growth-character'); card.open = true;
      const summary = node('summary');
      const image = deps.catalog.get(name)?.image;
      if (image) { const img = node('img'); img.src = `${import.meta.env.BASE_URL}${image}`; img.alt = ''; summary.append(img); }
      summary.append(node('strong', name), node('span', source ? '현재 옵션 → Lv.15 목표' : '부위 정보 없음', 'growth-note')); card.append(summary);
      if (!source) {
        card.append(node('p', `현재 합계: ${Object.entries(totals).filter(([,v])=>v).map(([key,v])=>`${deps.settings.overloadFields[key]?.label ?? key} ${v}%`).join(' · ') || '없음'}`, 'growth-note'));
        const label = node('label', '', 'growth-confirm'); const check = node('input'); check.type = 'checkbox';
        label.append(check, document.createTextNode('부위별 원본을 확인할 수 없습니다. 아래에 목표 옵션을 직접 설정했습니다.')); card.append(label); acknowledgments.push(check);
      }
      const parts = node('div', '', 'growth-parts');
      for (const part of GROWTH_PARTS) {
        const area = node('section', '', 'growth-part'); area.append(node('h4', part));
        lines[part].forEach((row, rowIndex) => {
          const original = source ? overloadLinesOf(source)[part][rowIndex] : undefined;
          const line = node('div', '', 'growth-line');
          const oldLabel = original?.option ? `${deps.settings.overloadFields[original.option]?.label ?? original.option} · Lv.${original.level} · ${steps[original.option]?.[original.level-1] ?? '?'}%` : source ? '빈 옵션' : '확인 불가';
          line.append(node('small', `${rowIndex+1}번 · 현재 ${oldLabel}`));
          const select = node('select'); select.setAttribute('aria-label', `${deps.deckName(entry.deckId)} ${name} ${part} ${rowIndex+1}번 목표 옵션`);
          select.add(new Option('옵션 없음', ''));
          for (const [key, field] of Object.entries(deps.settings.overloadFields)) if (steps[key]?.length === 15) select.add(new Option(`${field.label} · ${steps[key]![14]}%`, key));
          select.value = row.option;
          const gap = node('span', optionGap(original, row.option, steps), 'growth-gap');
          select.onchange = () => { row.option = select.value; gap.textContent = optionGap(original, row.option, steps); invalidate(); };
          line.append(select, gap); area.append(line);
        }); parts.append(area);
      }
      card.append(parts); group.append(card);
    }
    editor.append(group);
  });
  const gapsFor = (index: number): string[] => {
    const result: string[] = [];
    for (const [name, target] of Object.entries(targets[index]!)) {
      const source = originals[index]![name];
      for (const part of GROWTH_PARTS) for (const [i, row] of overloadLinesOf(target)[part].entries()) {
        const gap = optionGap(source ? overloadLinesOf(source)[part][i] : undefined, row.option, steps);
        if (gap === '빈 옵션 유지' || gap === '최대수치 달성' || (!source && !row.option)) continue;
        result.push(`${name} · ${part} ${i+1}번 → ${deps.settings.overloadFields[row.option]?.label ?? '없음'}: ${gap}`);
      }
    }
    return result;
  };
  const reportGapsFor = (index: number): string[] => Object.entries(targets[index]!).flatMap(([name, target]) => {
    const source = originals[index]![name];
    let effects = 0, values = 0;
    for (const part of GROWTH_PARTS) for (const [i, row] of overloadLinesOf(target)[part].entries()) {
      const gap = optionGap(source ? overloadLinesOf(source)[part][i] : undefined, row.option, steps);
      if (gap.includes('효과변경') || gap.includes('효과 제거')) effects++;
      if (gap.includes('수치변경')) values++;
    }
    return [`${name} · ${source ? `효과변경 ${effects}줄 / 수치변경 ${values}줄 필요` : '부위 원본 없음 · 직접 설정한 목표 기준'}`];
  });
  calculate.onclick = async () => {
    if (busy) return;
    try {
      if (acknowledgments.some(check=>!check.checked)) throw new Error('부위 정보가 없는 니케의 목표 옵션을 설정하고 확인란을 체크해 주세요.');
      const requests = snapshot.decks.map((entry,i)=>maximumRequest(entry.request,targets[i]!,steps));
      busy = true; calculate.disabled = true; save.disabled = true; pairs = []; output.replaceChildren();
      editor.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(el=>el.disabled=true);
      for (const [i, entry] of snapshot.decks.entries()) {
        message.textContent = `${i+1}/${snapshot.decks.length}덱 · 현재 옵션 계산 중…`;
        const before = {...entry, result: await deps.simulate(structuredClone(entry.request))};
        if (closed) return;
        message.textContent = `${i+1}/${snapshot.decks.length}덱 · Lv.15 목표 계산 중…`;
        const after = {...entry, request: requests[i]!, result: await deps.simulate(requests[i]!)};
        if (closed) return;
        const pair = {before, after, gaps:gapsFor(i), reportGaps:reportGapsFor(i)}; pairs.push(pair);
        const result = node('section', '', 'growth-result');
        result.append(node('h3', deps.deckName(entry.deckId)), node('strong', percent(before.result.squadTotal,after.result.squadTotal), 'growth-gain'), node('p', `${formatDamage(before.result.squadTotal)} → ${formatDamage(after.result.squadTotal)}`));
        if (before.result.previewNote || after.result.previewNote) result.append(node('p', after.result.previewNote || before.result.previewNote, 'growth-note'));
        const table = node('table'); const head = node('tr'); for (const text of ['니케','현재','Lv.15 목표','변화']) head.append(node('th',text)); table.append(head);
        for (const name of entry.request.squad.filter(Boolean)) { const a=before.result.charTotals[name]??0,b=after.result.charTotals[name]??0; const row=node('tr'); for(const text of [name,formatDamage(a),formatDamage(b),percent(a,b)]) row.append(node('td',text)); table.append(row); }
        const gaps = node('details'); gaps.append(node('summary', `옵션 괴리 · ${pair.gaps.length}줄`));
        for(const gap of pair.gaps) gaps.append(node('p',gap));
        if (!pair.gaps.length) gaps.append(node('p','설정한 옵션이 모두 최대수치입니다.'));
        result.append(table,gaps); output.append(result);
        const deviations = node('details'); deviations.append(node('summary', '기본 스펙 이탈 내역'));
        deviations.append(node('h4', '현재'), node('pre', before.result.deviations || '없음'), node('h4', 'Lv.15 목표'), node('pre', after.result.deviations || '없음'));
        result.append(deviations);
      }
      message.textContent = '비교 완료 · 선택한 옵션의 최대수치 비교이며, 최적 조합이나 딜 상승을 보장하지 않습니다.'; save.disabled = false;
      output.scrollIntoView({behavior:'smooth',block:'start'});
    } catch(error) { pairs=[]; save.disabled=true; output.replaceChildren(); message.textContent = `계산 실패: ${error instanceof Error ? error.message : String(error)}`; }
    finally { busy=false; calculate.disabled=false; editor.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(el=>el.disabled=false); }
  };
  save.onclick = async () => {
    if (busy || !pairs.length) return;
    busy = true; save.disabled = true; calculate.disabled = true;
    editor.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(el=>el.disabled=true);
    try {
      message.textContent = '한 장짜리 보고서 이미지를 만드는 중…';
      await document.fonts?.ready;
      const portraits = await loadPortraits(pairs.flatMap(p=>p.before.request.squad), deps.catalog, import.meta.env.BASE_URL);
      if (closed) return;
      const sections = pairs.map(pair => {
        const make = (entry: DeckResultEntry, suffix: string) => renderReport({total:entry.result.squadTotal,decks:[entry]}, {siteUrl:'moris-kr.github.io/nikke-calc',deckNames:{[entry.deckId]:`${deps.deckName(entry.deckId)} · ${suffix}`}},portraits);
        const left=make(pair.before,'현재'),right=make(pair.after,'Lv.15 목표');
        const height=Math.max(left.height/left.width,right.height/right.width)*568;
        return {pair,left,right,height};
      });
      const canvas = document.createElement('canvas'); canvas.width=2400;
      canvas.height=Math.ceil(112+sections.reduce((sum,s)=>sum+100+s.height+Math.max(1,s.pair.reportGaps.length)*23+35,0))*2;
      if(canvas.height>32000) throw new Error('보고서가 너무 깁니다. 덱 수를 줄여 주세요.');
      const ctx=canvas.getContext('2d'); if(!ctx) throw new Error('이미지 생성이 지원되지 않습니다.');
      ctx.fillStyle='#080e19'; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.scale(2,2);
      const write=(text:string,x:number,y:number,size=16,color='#d9e5f3')=>{ctx.fillStyle=color;ctx.font=`${size}px Pretendard, sans-serif`;ctx.fillText(text,x,y,1140);};
      write('육성효율 보고서 · OVERLOAD Lv.15',28,43,28,'#ad9cff');
      write('현재 육성 / 선택 옵션 최대수치 · 전투 조건과 다른 육성은 동일',28,76);
      let y=112;
      for(const s of sections) {
        write(`${deps.deckName(s.pair.before.deckId)}   ${percent(s.pair.before.result.squadTotal,s.pair.after.result.squadTotal)}`,28,y+26,24,'#ad9cff');
        ctx.drawImage(s.left,24,y+48,568,s.left.height/s.left.width*568);
        ctx.drawImage(s.right,608,y+48,568,s.right.height/s.right.width*568);
        y+=s.height+80; write('옵션 괴리',28,y,18,'#ffce80'); y+=25;
        for(const gap of s.pair.reportGaps) {write(gap,28,y,15);y+=23;}
        y+=30;
      }
      downloadImage(await canvasToBlob(canvas),`니케-육성효율-${new Date().toISOString().slice(0,10)}.png`);
      message.textContent='덱마다 현재·최대수치를 나란히 묶은 PNG 한 장을 저장했습니다.';
    } catch(error) { message.textContent=`이미지 생성 실패: ${error instanceof Error ? error.message : String(error)}`; }
    finally { busy=false; calculate.disabled=false; save.disabled = pairs.length === 0; editor.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(el=>el.disabled=false); }
  };
}
