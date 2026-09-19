import type { CharacterMeta } from './types';
import { initials, squash } from './nikke-search';
import './pickup-history.css';

export interface PickupEvent { id: string; start: string; end?: string; names: string[]; kind: 'new' | 'rerun'; limited?: boolean; collab?: boolean; sourceIds: string[]; note?: string; tags?: string[] }
export interface PickupHistory { updatedAt: string; coverageNote: string; sources: { id: string; url: string; title: string }[]; events: PickupEvent[] }
export interface PickupFilters { year: string; kind: string; query: string; order: 'asc' | 'desc' }
type SearchCharacter = Pick<CharacterMeta, 'name' | 'aliases'>;
const validDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export function validatePickupHistory(value: unknown): PickupHistory {
  const d = value as PickupHistory;
  const fail = () => { throw new Error('픽업 기록 데이터 형식을 확인해 주세요.'); };
  if (!d || !validDate(d.updatedAt) || typeof d.coverageNote !== 'string' || !Array.isArray(d.sources) || !Array.isArray(d.events)) return fail();
  const ids = new Set<string>();
  for (const s of d.sources) {
    if (!s || typeof s.id !== 'string' || ids.has(s.id) || typeof s.title !== 'string' || typeof s.url !== 'string') return fail();
    try { if (new URL(s.url).protocol !== 'https:') return fail(); } catch { return fail(); }
    ids.add(s.id);
  }
  const events = new Set<string>();
  for (const e of d.events) {
    if (!e || typeof e.id !== 'string' || events.has(e.id) || !validDate(e.start) || (e.end !== undefined && (!validDate(e.end) || e.end < e.start)) || !['new', 'rerun'].includes(e.kind) || !Array.isArray(e.names) || !e.names.length || !e.names.every(n => typeof n === 'string' && n.trim()) || !Array.isArray(e.sourceIds) || !e.sourceIds.length || !e.sourceIds.every(id => ids.has(id)) || (e.note !== undefined && typeof e.note !== 'string') || (e.tags !== undefined && (!Array.isArray(e.tags) || !e.tags.every(t => typeof t === 'string'))) || (e.limited !== undefined && typeof e.limited !== 'boolean') || (e.collab !== undefined && typeof e.collab !== 'boolean')) return fail();
    events.add(e.id);
  }
  return d;
}
export function filterPickupEvents(events: PickupEvent[], f: PickupFilters, catalog: SearchCharacter[]): PickupEvent[] {
  const q = squash(f.query);
  const aliases = new Map(catalog.map(c => [c.name, c.aliases ?? []]));
  return events.filter(e => (!f.year || e.start.startsWith(f.year)) && (!f.kind || (f.kind === 'limited' ? e.limited : f.kind === 'collab' ? e.collab : e.kind === f.kind)) && (!q || e.names.some(n => [n, ...(aliases.get(n) ?? [])].some(s => squash(s).includes(q) || squash(initials(s)).includes(q)))))
    .sort((a, b) => (a.start.localeCompare(b.start) || a.id.localeCompare(b.id)) * (f.order === 'asc' ? 1 : -1));
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node;
};
const labels = (e: PickupEvent) => [e.kind === 'new' ? '신규' : '복각', ...(e.limited ? ['한정'] : []), ...(e.collab ? ['콜라보'] : [])];
function portraitUrl(char: CharacterMeta | undefined): string | undefined {
  if (!char?.image) return;
  const url = new URL(`${import.meta.env.BASE_URL}${char.image}`, location.href);
  return url.origin === location.origin ? url.href : undefined;
}
export async function renderPickupHistory(host: HTMLElement, catalog: CharacterMeta[]): Promise<void> {
  host.replaceChildren(el('p', '픽업 기록을 불러오는 중…', 'pickup-status'));
  let data: PickupHistory;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}pickup-history.json`);
    if (!response.ok) throw new Error('load');
    data = validatePickupHistory(await response.json());
  } catch {
    const retry = el('button', '다시 불러오기'); retry.type = 'button'; retry.onclick = () => { void renderPickupHistory(host, catalog); };
    host.replaceChildren(el('p', '픽업 기록을 불러오지 못했습니다.'), retry); return;
  }
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  const byName = new Map(catalog.map(c => [c.name, c]));
  const state: PickupFilters = { year: '', kind: '', query: '', order: 'asc' };
  const root = el('section', '', 'pickup-history');
  const heading = el('div', '', 'pickup-heading');
  heading.append(el('span', 'RECRUITMENT ARCHIVE', 'pickup-eyebrow'), el('h2', '니케 픽업 타임라인'), el('p', '날짜순으로 살펴보고, 캐릭터를 눌러 기록과 출처를 확인하세요.'));
  const controls = el('div', '', 'pickup-controls');
  const search = el('input'); search.type = 'search'; search.placeholder = '이름 · 별명 · 초성 검색'; search.setAttribute('aria-label', '픽업 캐릭터 검색');
  const select = (label: string, options: [string, string][]) => { const node = el('select'); node.setAttribute('aria-label', label); options.forEach(([value, text]) => { const opt = el('option', text); opt.value = value; node.append(opt); }); return node; };
  const year = select('픽업 연도', [['', '전체 연도'], ...[...new Set(data.events.map(e => e.start.slice(0, 4)))].sort().reverse().map(y => [y, `${y}년`] as [string, string])]);
  const kind = select('픽업 유형', [['', '전체 유형'], ['new', '신규'], ['rerun', '복각'], ['limited', '한정'], ['collab', '콜라보']]);
  const order = select('날짜 정렬', [['asc', '오래된 순'], ['desc', '최신 순']]);
  const reset = el('button', '초기화'); reset.type = 'button';
  const download = el('button', 'PNG 저장', 'pickup-export'); download.type = 'button';
  controls.append(search, year, kind, order, reset, download);
  const summary = el('p', '', 'pickup-summary'); summary.setAttribute('aria-live', 'polite');
  const grid = el('div', '', 'pickup-grid');
  const status = el('p', '', 'pickup-status'); status.setAttribute('aria-live', 'polite');
  let exporting = false;
  let revision = 0;
  let downloadUrls: string[] = [];
  const dialog = el('dialog', '', 'pickup-dialog'); dialog.setAttribute('aria-label', '픽업 상세 기록');
  const close = el('button', '닫기', 'pickup-close'); close.type = 'button'; close.onclick = () => dialog.close();
  const details = el('div'); dialog.append(close, details);
  const openDetails = (event: PickupEvent) => {
    details.replaceChildren(el('h3', event.names.join(' · ')), el('p', `${event.start} ~ ${event.end ?? '종료일 미확인'} · ${labels(event).join(' / ')}`));
    if (event.note) details.append(el('p', event.note));
    event.names.forEach(name => {
      const history = data.events.filter(e => e.names.includes(name)).sort((a, b) => a.start.localeCompare(b.start));
      const latest = history.filter(e => e.start <= today).at(-1);
      details.append(el('h4', `${name} · 수록된 픽업 ${history.length}회`));
      if (latest) { const days = Math.floor((Date.parse(today) - Date.parse(latest.start)) / 86400000); details.append(el('p', `수록된 마지막 픽업 시작: ${latest.start} (${today} KST 기준 ${days}일 경과)`)); }
      const list = el('ul'); history.forEach(e => list.append(el('li', `${e.start} · ${labels(e).join(' / ')}`))); details.append(list);
    });
    details.append(el('h4', '이 기록의 출처'));
    event.sourceIds.forEach(id => { const source = data.sources.find(s => s.id === id)!; const a = el('a', source.title); a.href = source.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; details.append(a); });
    details.append(el('p', '수록된 기록 기준이며, 다음 픽업 일정이나 복각 주기를 예측하지 않습니다.', 'pickup-muted'));
    dialog.showModal();
  };
  const draw = () => {
    revision++;
    downloadUrls.forEach(url => URL.revokeObjectURL(url)); downloadUrls = [];
    status.replaceChildren();
    const filtered = filterPickupEvents(data.events, state, catalog);
    summary.textContent = `${filtered.length}건 / 전체 ${data.events.length}건 · 자료 확인 ${data.updatedAt} · 날짜 KST`;
    download.disabled = exporting || !filtered.length;
    grid.replaceChildren();
    if (!filtered.length) grid.append(el('p', '조건에 맞는 픽업 기록이 없습니다.', 'pickup-empty'));
    filtered.forEach(event => {
      const special = event.tags?.length || event.names.some(n => byName.get(n)?.manufacturer === '필그림');
      const card = el('button', '', 'pickup-card' + (event.limited ? ' pickup-limited' : '') + (special ? ' pickup-special' : '')); card.type = 'button'; card.setAttribute('aria-label', `${event.start} ${event.names.join(', ')} 픽업 상세`);
      const date = el('time', event.start.replaceAll('-', '.'), 'pickup-date'); date.dateTime = event.start; card.append(date);
      const faces = el('div', '', 'pickup-faces' + (event.names.length > 1 ? ' pickup-multiple' : ''));
      event.names.forEach(name => {
        const figure = el('span', '', 'pickup-person'); const face = el('span', 'N', 'pickup-face'); const url = portraitUrl(byName.get(name));
        if (url) { const image = el('img'); image.src = url; image.alt = ''; image.loading = 'lazy'; image.onerror = () => image.remove(); face.append(image); }
        figure.append(face, el('span', name, 'pickup-name')); faces.append(figure);
      });
      const badges = el('span', '', 'pickup-badges'); [...labels(event), ...(event.start > today ? ['예정'] : []), ...(event.tags ?? [])].forEach(label => badges.append(el('span', label, `pickup-badge${label === '복각' ? ' pickup-rerun' : ''}`)));
      card.append(faces, badges); card.onclick = () => openDetails(event); grid.append(card);
    });
  };
  search.oninput = () => { state.query = search.value; draw(); };
  year.onchange = () => { state.year = year.value; draw(); }; kind.onchange = () => { state.kind = kind.value; draw(); }; order.onchange = () => { state.order = order.value as 'asc' | 'desc'; draw(); };
  reset.onclick = () => { search.value = year.value = kind.value = ''; order.value = 'asc'; Object.assign(state, { query: '', year: '', kind: '', order: 'asc' }); draw(); };
  download.onclick = async () => {
    exporting = true;
    const requestedRevision = revision;
    downloadUrls.forEach(url => URL.revokeObjectURL(url)); downloadUrls = [];
    download.disabled = true; status.textContent = '이미지를 만드는 중…';
    try {
      const pages = await exportPickupPages(filterPickupEvents(data.events, state, catalog), byName, data.updatedAt);
      if (requestedRevision !== revision) return;
      status.replaceChildren(document.createTextNode(`${pages.length}개 이미지 준비 완료. 각 파일을 눌러 저장하세요. `));
      pages.forEach((blob, i) => { const a = el('a', `PNG ${i + 1} 저장`); const url = URL.createObjectURL(blob); downloadUrls.push(url); a.href = url; a.download = `nikke-pickup-${data.updatedAt}-${i + 1}.png`; status.append(a, document.createTextNode(' ')); });
    } catch { if (requestedRevision === revision) status.textContent = '이미지 생성에 실패했습니다. 다시 시도해 주세요.'; }
    finally { exporting = false; download.disabled = !filterPickupEvents(data.events, state, catalog).length; }
  };
  root.append(heading, controls, summary, el('p', data.coverageNote, 'pickup-coverage'), status, grid, dialog); host.replaceChildren(root); draw();
}

async function exportPickupPages(events: PickupEvent[], catalog: Map<string, CharacterMeta>, updatedAt: string): Promise<Blob[]> {
  const cache = new Map<string, HTMLImageElement | null>();
  await Promise.all([...new Set(events.flatMap(e => e.names))].map(async name => {
    const url = portraitUrl(catalog.get(name)); if (!url) return;
    const image = new Image();
    await new Promise<void>(resolve => { const timer = setTimeout(() => { image.src = ''; resolve(); }, 5000); image.onload = () => { clearTimeout(timer); cache.set(name, image); resolve(); }; image.onerror = () => { clearTimeout(timer); resolve(); }; image.src = url; });
  }));
  const blobs: Blob[] = [];
  // Split the filtered archive into bounded pages, including every grouped portrait.
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  for (let offset = 0; offset < events.length; offset += 24) {
    const page = events.slice(offset, offset + 24);
    const rowHeight = Math.max(220, 80 + Math.max(...page.map(e => e.names.length)) * 68);
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 160 + Math.ceil(page.length / 6) * rowHeight;
    if (canvas.height > 8192) throw new Error('이 기록은 이미지 저장 한도를 초과합니다.');
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('canvas');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#172532'; ctx.font = 'bold 30px sans-serif'; ctx.fillText('NIKKE · 픽업 타임라인', 30, 48); ctx.font = '16px sans-serif'; ctx.fillText(`자료 확인 ${updatedAt} · 선택 ${events.length}건 · ${offset + 1}–${offset + page.length} / 날짜는 픽업 시작일 (KST)`, 30, 80); ctx.fillText('수록 기록 기준 · 상세 출처는 사이트에서 확인', 30, 106);
    page.forEach((event, i) => {
      const x = 20 + (i % 6) * 196; const y = 136 + Math.floor(i / 6) * rowHeight;
      const special = event.tags?.length || event.names.some(n => catalog.get(n)?.manufacturer === '필그림');
      ctx.strokeStyle = event.limited ? '#d97878' : special ? '#c4a14f' : '#dfe5e9'; ctx.strokeRect(x, y, 182, rowHeight - 16); ctx.fillStyle = '#233a4e'; ctx.font = 'bold 17px sans-serif'; ctx.fillText(event.start.replaceAll('-', '.'), x + 12, y + 27);
      event.names.forEach((name, j) => {
        const py = y + 42 + j * 68; const image = cache.get(name); ctx.fillStyle = '#eef2f5'; ctx.fillRect(x + 10, py, 48, 54);
        if (image) { const scale = Math.max(48 / image.width, 54 / image.height); const sw = 48 / scale; const sh = 54 / scale; ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) * .2, sw, sh, x + 10, py, 48, 54); }
        ctx.fillStyle = '#172532'; ctx.font = 'bold 12px sans-serif'; let line = ''; let row = 0;
        for (const char of name) { if (ctx.measureText(line + char).width > 106) { ctx.fillText(line, x + 65, py + 15 + row * 15); row++; line = ''; } line += char; } ctx.fillText(line, x + 65, py + 15 + row * 15);
      });
      ctx.fillStyle = '#5f7586'; ctx.font = '12px sans-serif'; ctx.fillText([...labels(event), ...(event.start > today ? ['예정'] : [])].join(' · '), x + 12, y + rowHeight - 28);
    });
    blobs.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('png')), 'image/png')));
  }
  return blobs;
}
