import type { CharacterMeta } from './types';
import { initials, squash } from './nikke-search';
import './pickup-history.css';
import fire from './assets/icon-code-fire.png';
import water from './assets/icon-code-water.png';
import wind from './assets/icon-code-wind.png';
import electronic from './assets/icon-code-electronic.png';
import iron from './assets/icon-code-iron.png';
const elementIcons: Record<string, string> = { 작열: fire, 수냉: water, 풍압: wind, 전격: electronic, 철갑: iron };

export interface PickupEvent { id: string; start: string; end?: string; names: string[]; kind: 'new' | 'rerun'; limited?: boolean; collab?: boolean; sourceIds: string[]; note?: string; tags?: string[]; gifts?: string[]; giftNote?: string }
export interface PickupHistory { updatedAt: string; coverageNote: string; sources: { id: string; url: string; title: string }[]; events: PickupEvent[] }
export interface PickupFilters { year: string; kind: string; query: string; element?: string; order: 'asc' | 'desc' }
export interface PickupCard extends PickupEvent { isGift?: boolean }

// Expand after chronological sorting so gifts stay directly after their pickup in either direction.
export function expandPickupCards(events: PickupEvent[]): PickupCard[] {
  return events.flatMap(event => [
    { ...event, gifts: undefined, giftNote: undefined },
    ...(event.gifts ?? []).map((name, index) => ({
      id: `${event.id}-gift-${index}`, start: event.start, names: [name], kind: event.kind,
      collab: true, sourceIds: event.sourceIds, isGift: true,
      note: event.giftNote ?? '콜라보 시작일 기준입니다. 실제 수령 조건은 출처 공지를 확인하세요.',
    })),
  ]);
}

export function filterPickupCards(events: PickupEvent[], filters: PickupFilters, catalog: CharacterMeta[]): PickupCard[] {
  const byName = new Map(catalog.map(c => [c.name, c]));
  return expandPickupCards(filterPickupEvents(events, filters, catalog)).flatMap(card => {
    const names = card.names.filter(name => !filters.element || byName.get(name)?.elementCode === filters.element);
    return names.length ? [{ ...card, names }] : [];
  });
}

export function pickupExportLayout(cards: PickupCard[]) {
  const rows: { y: number; height: number }[] = [];
  let height = 136;
  for (let i = 0; i < cards.length; i += 6) {
    const rowHeight = Math.max(240, 116 + Math.max(...cards.slice(i, i + 6).map(e => e.names.length)) * 68);
    rows.push({ y: height, height: rowHeight });
    height += rowHeight;
  }
  height += 24;
  // One image, including on devices with conservative canvas dimension limits.
  const scale = Math.min(1, 8192 / height);
  return { rows, height, scale, pixelWidth: Math.floor(1200 * scale), pixelHeight: Math.floor(height * scale) };
}
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
    if (e.gifts !== undefined && (!e.collab || !Array.isArray(e.gifts) || !e.gifts.length || !e.gifts.every(n => typeof n === 'string' && n.trim() && !e.names.includes(n)) || new Set(e.gifts).size !== e.gifts.length)) return fail();
    if (e.giftNote !== undefined && (typeof e.giftNote !== 'string' || !e.gifts?.length)) return fail();
  }
  return d;
}
export function filterPickupEvents(events: PickupEvent[], f: PickupFilters, catalog: SearchCharacter[]): PickupEvent[] {
  const q = squash(f.query);
  const aliases = new Map(catalog.map(c => [c.name, c.aliases ?? []]));
  return events.filter(e => (!f.year || e.start.startsWith(f.year)) && (!f.kind || (f.kind === 'limited' ? e.limited : f.kind === 'collab' ? e.collab : e.kind === f.kind)) && (!q || eventNames(e).some(n => [n, ...(aliases.get(n) ?? [])].some(s => squash(s).includes(q) || squash(initials(s)).includes(q)))))
    .sort((a, b) => (a.start.localeCompare(b.start) || a.id.localeCompare(b.id)) * (f.order === 'asc' ? 1 : -1));
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node;
};
const labels = (e: PickupCard) => [e.isGift ? '배포' : e.kind === 'new' ? '신규' : '복각', ...(e.limited ? ['한정'] : []), ...(e.collab ? ['콜라보'] : [])];
export const eventNames = (e: PickupEvent): string[] => [...e.names, ...(e.gifts ?? [])];
export function pickupHonor(e: PickupEvent, catalog: Map<string, Pick<CharacterMeta, 'manufacturer'>>): string {
  const titles = [];
  if (e.names.some(n => catalog.get(n)?.manufacturer === '필그림')) titles.push('필그림');
  if (e.tags?.includes('오버스펙')) titles.push('오버스펙');
  return titles.join(' · ');
}
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
  let dark = false;
  try { dark = localStorage.getItem('nikke-pickup-theme') === 'dark'; } catch { /* Storage can be disabled. */ }
  root.dataset.theme = dark ? 'dark' : 'light';
  const heading = el('div', '', 'pickup-heading');
  heading.append(el('span', 'RECRUITMENT ARCHIVE', 'pickup-eyebrow'), el('h2', '니케 픽업 타임라인'), el('p', '날짜순으로 살펴보고, 캐릭터를 눌러 기록과 출처를 확인하세요.'));
  const controls = el('div', '', 'pickup-controls');
  const search = el('input'); search.type = 'search'; search.placeholder = '이름 · 별명 · 초성 검색'; search.setAttribute('aria-label', '픽업 캐릭터 검색');
  const select = (label: string, options: [string, string][]) => { const node = el('select'); node.setAttribute('aria-label', label); options.forEach(([value, text]) => { const opt = el('option', text); opt.value = value; node.append(opt); }); return node; };
  const year = select('픽업 연도', [['', '전체 연도'], ...[...new Set(data.events.map(e => e.start.slice(0, 4)))].sort().reverse().map(y => [y, `${y}년`] as [string, string])]);
  const kind = select('픽업 유형', [['', '전체 유형'], ['new', '신규'], ['rerun', '복각'], ['limited', '한정'], ['collab', '콜라보']]);
  const element = select('픽업 속성', [['', '전체 속성'], ...Object.keys(elementIcons).map(code => [code, code] as [string, string])]);
  const order = select('날짜 정렬', [['asc', '오래된 순'], ['desc', '최신 순']]);
  const reset = el('button', '초기화'); reset.type = 'button';
  const download = el('button', 'PNG 저장', 'pickup-export'); download.type = 'button';
  const theme = el('button', '다크모드', 'pickup-theme'); theme.type = 'button'; theme.setAttribute('aria-pressed', String(dark));
  controls.append(search, year, kind, element, order, reset, theme, download);
  const summary = el('p', '', 'pickup-summary'); summary.setAttribute('aria-live', 'polite');
  const grid = el('div', '', 'pickup-grid');
  const status = el('p', '', 'pickup-status'); status.setAttribute('aria-live', 'polite');
  let exporting = false;
  let revision = 0;
  let downloadUrls: string[] = [];
  const dialog = el('dialog', '', 'pickup-dialog'); dialog.setAttribute('aria-label', '픽업 상세 기록');
  const close = el('button', '닫기', 'pickup-close'); close.type = 'button'; close.onclick = () => dialog.close();
  const details = el('div'); dialog.append(close, details);
  const openDetails = (event: PickupCard) => {
    details.replaceChildren(el('h3', eventNames(event).join(' · ')), el('p', `${event.isGift ? `콜라보 배포 기준일 ${event.start}` : `모집 기간 ${event.start} ~ ${event.end ?? '종료일 미확인'}`} · ${labels(event).join(' / ')}`));
    if (event.note) details.append(el('p', event.note));
    if (event.gifts?.length) details.append(el('p', `콜라보 배포: ${event.gifts.join(' · ')}. ${event.giftNote ?? '콜라보 첫날에 함께 표시하며, 수령 조건은 출처 공지를 확인하세요.'}`, 'pickup-gift-note'));
    eventNames(event).forEach(name => {
      const history = data.events.filter(e => eventNames(e).includes(name)).sort((a, b) => a.start.localeCompare(b.start));
      const latest = history.filter(e => e.start <= today).at(-1);
      details.append(el('h4', `${name} · 수록된 모집/배포 ${history.length}회`));
      if (latest) { const days = Math.floor((Date.parse(today) - Date.parse(latest.start)) / 86400000); details.append(el('p', `수록된 마지막 모집/배포 시작: ${latest.start} (${today} KST 기준 ${days}일 경과)`)); }
      const list = el('ul'); history.forEach(e => list.append(el('li', `${e.start} · ${e.gifts?.includes(name) ? '콜라보 배포' : labels(e).join(' / ')}`))); details.append(list);
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
    const cards = filterPickupCards(data.events, state, catalog);
    summary.textContent = `${cards.length}카드 표시 · 전체 모집 기록 ${data.events.length}건 · 자료 확인 ${data.updatedAt} · 날짜 KST`;
    download.disabled = exporting || !cards.length;
    grid.replaceChildren();
    if (!cards.length) grid.append(el('p', '조건에 맞는 픽업 기록이 없습니다.', 'pickup-empty'));
    cards.forEach(event => {
      const honor = pickupHonor(event, byName);
      const card = el('button', '', 'pickup-card' + (event.isGift ? ' pickup-gift-card' : '') + (event.limited ? ' pickup-limited' : '') + (honor ? ' pickup-special' : '') + (honor && event.limited ? ' pickup-prestige' : '')); card.type = 'button'; card.setAttribute('aria-label', `${event.start} ${eventNames(event).join(', ')} ${event.isGift ? '배포' : '픽업'} 상세`);
      const date = el('time', event.start.replaceAll('-', '.'), 'pickup-date'); date.dateTime = event.start; card.append(date);
      if (honor) card.append(el('span', `${event.limited ? '✦ 한정 ' : '★ '}${honor}`, 'pickup-honor'));
      const faces = el('div', '', 'pickup-faces' + (eventNames(event).length > 1 ? ' pickup-multiple' : ''));
      eventNames(event).forEach(name => {
        const figure = el('span', '', 'pickup-person'); const face = el('span', 'N', 'pickup-face'); const url = portraitUrl(byName.get(name));
        if (url) { const image = el('img'); image.src = url; image.alt = ''; image.loading = 'lazy'; image.onerror = () => image.remove(); face.append(image); }
        const code = byName.get(name)?.elementCode;
        if (code && elementIcons[code]) { const icon = el('img', '', 'pickup-element'); icon.src = elementIcons[code]!; icon.alt = code; icon.title = code; face.append(icon); }
        figure.append(face, el('span', name, 'pickup-name'));
        faces.append(figure);
      });
      const badges = el('span', '', 'pickup-badges'); [...labels(event), ...(event.start > today ? ['예정'] : []), ...(event.tags ?? [])].forEach(label => badges.append(el('span', label, `pickup-badge${label === '복각' ? ' pickup-rerun' : ''}`)));
      card.append(faces, badges); card.onclick = () => openDetails(event); grid.append(card);
    });
  };
  search.oninput = () => { state.query = search.value; draw(); };
  year.onchange = () => { state.year = year.value; draw(); }; kind.onchange = () => { state.kind = kind.value; draw(); }; order.onchange = () => { state.order = order.value as 'asc' | 'desc'; draw(); };
  element.onchange = () => { state.element = element.value; draw(); };
  reset.onclick = () => { search.value = year.value = kind.value = element.value = ''; order.value = 'asc'; Object.assign(state, { query: '', year: '', kind: '', element: '', order: 'asc' }); draw(); };
  theme.onclick = () => {
    dark = !dark; root.dataset.theme = dark ? 'dark' : 'light'; theme.setAttribute('aria-pressed', String(dark));
    try { localStorage.setItem('nikke-pickup-theme', dark ? 'dark' : 'light'); } catch { /* Still works for this visit. */ }
    draw();
  };
  download.onclick = async () => {
    exporting = true;
    const requestedRevision = revision;
    downloadUrls.forEach(url => URL.revokeObjectURL(url)); downloadUrls = [];
    download.disabled = true; status.textContent = '이미지를 만드는 중…';
    try {
      const blob = await exportPickupImage(filterPickupCards(data.events, state, catalog), byName, data.updatedAt, dark);
      if (requestedRevision !== revision) return;
      status.replaceChildren(document.createTextNode('전체 연표 이미지 준비 완료. '));
      const a = el('a', 'PNG 한 장 저장'); const url = URL.createObjectURL(blob); downloadUrls.push(url); a.href = url; a.download = `nikke-pickup-${data.updatedAt}.png`; status.append(a);
    } catch { if (requestedRevision === revision) status.textContent = '이미지 생성에 실패했습니다. 다시 시도해 주세요.'; }
    finally { exporting = false; download.disabled = !filterPickupCards(data.events, state, catalog).length; }
  };
  root.append(heading, controls, summary, el('p', data.coverageNote, 'pickup-coverage'), status, grid, dialog); host.replaceChildren(root); draw();
}

async function exportPickupImage(events: PickupCard[], catalog: Map<string, CharacterMeta>, updatedAt: string, dark: boolean): Promise<Blob> {
  const cache = new Map<string, HTMLImageElement | null>();
  await Promise.all([...new Set(events.flatMap(eventNames))].map(async name => {
    const url = portraitUrl(catalog.get(name)); if (!url) return;
    const image = new Image();
    await new Promise<void>(resolve => { const timer = setTimeout(() => { image.src = ''; resolve(); }, 5000); image.onload = () => { clearTimeout(timer); cache.set(name, image); resolve(); }; image.onerror = () => { clearTimeout(timer); resolve(); }; image.src = url; });
  }));
  const icons = new Map<string, HTMLImageElement>();
  await Promise.all(Object.entries(elementIcons).map(async ([code, url]) => {
    const icon = new Image();
    await new Promise<void>(resolve => { const timer = setTimeout(() => { icon.src = ''; resolve(); }, 5000); icon.onload = () => { clearTimeout(timer); icons.set(code, icon); resolve(); }; icon.onerror = () => { clearTimeout(timer); resolve(); }; icon.src = url; });
  }));
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
    const layout = pickupExportLayout(events);
    const canvas = document.createElement('canvas'); canvas.width = layout.pixelWidth; canvas.height = layout.pixelHeight;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('canvas');
    ctx.scale(layout.scale, layout.scale);
    ctx.fillStyle = dark ? '#101923' : '#fff'; ctx.fillRect(0, 0, 1200, layout.height); ctx.fillStyle = dark ? '#e4edf5' : '#172532'; ctx.font = 'bold 30px sans-serif'; ctx.fillText('NIKKE · 픽업 타임라인', 30, 48); ctx.font = '16px sans-serif'; ctx.fillText(`자료 확인 ${updatedAt} · 배포 포함 ${events.length}카드 / 날짜는 모집·배포 시작 기준일 (KST)`, 30, 80); ctx.fillText('★ 필그림/오버스펙 · ✦ 한정 특수 · 배포는 콜라보 첫날에 표시 (수령 조건은 상세 참고)', 30, 106);
    events.forEach((event, i) => {
      const row = layout.rows[Math.floor(i / 6)]!;
      const rowHeight = row.height;
      const x = 20 + (i % 6) * 196; const y = row.y;
      const honor = pickupHonor(event, catalog); const prestige = !!honor && event.limited;
      ctx.fillStyle = prestige ? (dark ? '#452135' : '#ffe6e7') : honor ? (dark ? '#342b18' : '#fff1c7') : (dark ? '#1b2938' : '#fff'); ctx.fillRect(x, y, 182, rowHeight - 16);
      ctx.lineWidth = prestige ? 4 : honor ? 3 : 1;
      ctx.strokeStyle = event.isGift ? '#57ad92' : prestige ? '#f078ac' : honor ? '#d5a62f' : event.limited ? '#d97878' : (dark ? '#455b71' : '#dfe5e9'); ctx.strokeRect(x, y, 182, rowHeight - 16);
      if (prestige) { ctx.lineWidth = 1; ctx.strokeStyle = '#efc655'; ctx.strokeRect(x + 5, y + 5, 172, rowHeight - 26); }
      ctx.fillStyle = dark ? '#edf3fa' : '#233a4e'; ctx.font = 'bold 17px sans-serif'; ctx.fillText(event.start.replaceAll('-', '.'), x + 12, y + 27);
      if (honor) { ctx.fillStyle = dark ? '#ffe08c' : '#86470d'; ctx.font = 'bold 13px sans-serif'; ctx.fillText(`${prestige ? '✦ 한정 ' : '★ '}${honor}`, x + 12, y + 51); }
      eventNames(event).forEach((name, j) => {
        const py = y + 65 + j * 68; const image = cache.get(name); ctx.fillStyle = dark ? '#35495c' : '#eef2f5'; ctx.fillRect(x + 10, py, 48, 54);
        if (image) { const scale = Math.max(48 / image.width, 54 / image.height); const sw = 48 / scale; const sh = 54 / scale; ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) * .2, sw, sh, x + 10, py, 48, 54); }
        const icon = icons.get(catalog.get(name)?.elementCode ?? '');
        if (icon) { ctx.fillStyle = '#14202bdd'; ctx.fillRect(x + 40, py + 36, 18, 18); ctx.drawImage(icon, x + 41, py + 37, 16, 16); }
        ctx.fillStyle = dark ? '#e4edf5' : '#172532'; ctx.font = 'bold 12px sans-serif'; let line = ''; let row = 0;
        for (const char of name) { if (ctx.measureText(line + char).width > 106) { ctx.fillText(line, x + 65, py + 15 + row * 15); row++; line = ''; } line += char; } ctx.fillText(line, x + 65, py + 15 + row * 15);
        if (event.gifts?.includes(name)) { ctx.fillStyle = dark ? '#87edce' : '#00674f'; ctx.font = 'bold 11px sans-serif'; ctx.fillText('배포', x + 65, py + 59); }
      });
      ctx.fillStyle = dark ? '#adc2d4' : '#5f7586'; ctx.font = '12px sans-serif'; ctx.fillText([...labels(event), ...(event.start > today ? ['예정'] : [])].join(' · '), x + 12, y + rowHeight - 28);
    });
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('png')), 'image/png'));
}
