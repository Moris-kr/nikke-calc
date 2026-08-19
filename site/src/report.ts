// 계산 결과를 한 장짜리 PNG 보고서로 그린다.
//
// 커뮤니티에 그대로 붙여넣는 게 목적이라 외부 라이브러리(html2canvas 등) 없이
// Canvas 2D로 직접 그린다. 초상화는 같은 오리진에서 오므로 캔버스가 오염되지
// 않아 `toBlob`으로 뽑아낼 수 있다.
//
// 레이아웃은 두 가지다.
//   1덱  → 세로 카드: 총딜을 머리에 세우고 캐릭터별 기여도와 평타/스킬 분해
//   5덱  → 합계 헤드라인 + 덱 5열: 전체 합계가 주인공이고 25명 개별딜을 모두 싣는다

import { formatDamage, formatDps } from './model';
import type { BatchResult, CharacterMeta, DeckResultEntry } from './types';

const FONT = 'Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';

const COLOR = {
  bg: '#070d15',
  panel: '#0b1420',
  line: 'rgba(146,176,201,.18)',
  lineSoft: 'rgba(146,176,201,.09)',
  ink: '#eaf2f8',
  dim: '#b9c7d3',
  muted: '#8394a6',
  cyan: '#45d6d0',
  amber: '#ffbf3c',
  track: 'rgba(146,176,201,.13)',
} as const;

// 내보내기 배율. 2배로 그려야 커뮤니티에서 축소돼도 글자가 뭉개지지 않는다.
const SCALE = 2;

export interface ReportMeta {
  enemyDef: number;
  enemyCode: string;
  corePx: number;
  hasParts: boolean;
  siteUrl: string;
}

/** 캐릭터 한 명의 보고서용 집계값. */
export interface ReportRow {
  name: string;
  damage: number;
  share: number;
  normal: number;
  skill: number;
  portrait: HTMLImageElement | null;
}

/**
 * 보고서에 실을 캐릭터 줄을 만든다.
 *
 * **편성 순서(좌→우)를 그대로 위→아래로 쓴다.** 니케는 배치 순서 자체가 전투에
 * 영향을 주므로 딜 순으로 재정렬하면 실제 편성과 다른 그림이 된다. 화면의 결과
 * 목록도 같은 순서다. 빈 슬롯은 뺀다.
 */
export const reportRows = (
  entry: DeckResultEntry,
  portraits: Map<string, HTMLImageElement>,
): ReportRow[] => entry.request.squad
  .filter(Boolean)
  .map((name) => {
    const damage = entry.result.charTotals[name] ?? 0;
    const breakdown = entry.result.charBreakdown?.[name];
    return {
      name,
      damage,
      share: entry.result.squadTotal > 0 ? damage / entry.result.squadTotal * 100 : 0,
      normal: breakdown?.normal ?? 0,
      skill: breakdown?.skill ?? 0,
      portrait: portraits.get(name) ?? null,
    };
  });

/**
 * 스쿼드에 등장하는 캐릭터의 초상화를 미리 받아 둔다.
 *
 * 실패한 이미지는 조용히 빼고 자리만 비운다 — 초상화 하나 때문에 보고서 전체가
 * 안 나오는 편보다 낫다. 같은 이유로 기다리는 시간에 상한을 둔다. 느리거나
 * 영영 응답하지 않는 이미지가 하나라도 있으면 보고서가 끝내 안 나오기 때문이다.
 */
export async function loadPortraits(
  names: string[],
  catalog: Map<string, CharacterMeta>,
  baseUrl: string,
  timeoutMs = 5_000,
): Promise<Map<string, HTMLImageElement>> {
  const unique = [...new Set(names.filter(Boolean))];
  const loaded = new Map<string, HTMLImageElement>();
  await Promise.all(unique.map((name) => new Promise<void>((resolve) => {
    const src = catalog.get(name)?.image;
    if (!src) { resolve(); return; }
    const image = new Image();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) loaded.set(name, image);
      resolve();
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    image.onload = () => done(true);
    image.onerror = () => done(false);
    image.src = `${baseUrl}${src}`;
  })));
  return loaded;
}

// ── 그리기 도우미 ──────────────────────────────────────────────────────────

const text = (
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = 400,
  align: CanvasTextAlign = 'left',
) => {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, x, y);
};

/** 폭을 넘으면 말줄임표로 자른다 (이름이 긴 캐릭터가 열을 밀어내지 않게). */
const ellipsis = (ctx: CanvasRenderingContext2D, value: string, size: number, weight: number, max: number): string => {
  ctx.font = `${weight} ${size}px ${FONT}`;
  if (ctx.measureText(value).width <= max) return value;
  let cut = value;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut}…`;
};

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const line = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, color: string = COLOR.line) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, 1);
};

/** 초상화를 정사각형으로 잘라 그린다. 없으면 자리만 어둡게 채운다. */
const portrait = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  x: number,
  y: number,
  size: number,
  radius: number,
) => {
  ctx.save();
  roundRect(ctx, x, y, size, size, radius);
  ctx.clip();
  ctx.fillStyle = 'rgba(146,176,201,.10)';
  ctx.fillRect(x, y, size, size);
  if (image && image.naturalWidth > 0) {
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.drawImage(
      image,
      (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side,
      x, y, size, size,
    );
  }
  ctx.restore();
};

const factChips = (ctx: CanvasRenderingContext2D, chips: string[], x: number, y: number): number => {
  let cursor = x;
  const height = 22;
  for (const chip of chips) {
    ctx.font = `500 11px ${FONT}`;
    const width = ctx.measureText(chip).width + 18;
    ctx.strokeStyle = COLOR.line;
    ctx.lineWidth = 1;
    roundRect(ctx, cursor, y, width, height, 4);
    ctx.stroke();
    text(ctx, chip, cursor + 9, y + 15, 11, COLOR.muted, 500);
    cursor += width + 6;
  }
  return y + height;
};

const conditionChips = (meta: ReportMeta, entry: DeckResultEntry): string[] => {
  const chips = [
    `${entry.result.duration}초 전투`,
    `방어력 ${meta.enemyDef.toLocaleString('en-US')}`,
    meta.enemyCode ? `${meta.enemyCode} 코드` : '코드 없음',
    meta.corePx > 0 ? `코어 ${meta.corePx}px` : '코어 없음',
  ];
  if (meta.hasParts) chips.push('파괴 가능 파츠');
  chips.push(`시드 ${entry.request.seed}`);
  return chips;
};

// ── A · 1덱 세로 카드 ──────────────────────────────────────────────────────

const CARD_W = 760;
const PAD = 34;

function drawSingle(
  ctx: CanvasRenderingContext2D,
  entry: DeckResultEntry,
  meta: ReportMeta,
  portraits: Map<string, HTMLImageElement>,
): number {
  const rows = reportRows(entry, portraits);
  let y = PAD + 16;

  text(ctx, `NIKKE SQUAD SIM · ${entry.result.duration}s`, PAD, y, 11, COLOR.cyan, 800);
  y += 26;
  ctx.font = `800 26px ${FONT}`;
  ctx.fillStyle = COLOR.ink;
  ctx.textAlign = 'left';
  ctx.fillText('전투 결과 ', PAD, y);
  const titleWidth = ctx.measureText('전투 결과 ').width;
  text(ctx, '리포트', PAD + titleWidth, y, 26, COLOR.amber, 800);

  y += 22;
  line(ctx, PAD, y, CARD_W - PAD * 2);
  y += 30;

  text(ctx, '스쿼드 총 대미지', PAD, y, 12, COLOR.muted, 500);
  text(ctx, formatDamage(entry.result.squadTotal), CARD_W - PAD, y + 4, 40, COLOR.ink, 800, 'right');
  y += 26;
  text(ctx, formatDps(entry.result.squadTotal / entry.result.duration), CARD_W - PAD, y, 12, COLOR.muted, 500, 'right');

  y += 20;
  line(ctx, PAD, y, CARD_W - PAD * 2);
  y += 24;

  for (const row of rows) {
    portrait(ctx, row.portrait, PAD, y, 40, 7);
    const nameX = PAD + 52;
    text(ctx, ellipsis(ctx, row.name, 15, 700, 300), nameX, y + 17, 15, COLOR.ink, 700);
    text(ctx, `${row.share.toFixed(1)}% 기여`, nameX, y + 34, 11, COLOR.muted, 500);
    text(ctx, formatDamage(row.damage), CARD_W - PAD, y + 18, 19, COLOR.cyan, 800, 'right');
    text(ctx, formatDps(row.damage / entry.result.duration), CARD_W - PAD, y + 34, 11, COLOR.muted, 500, 'right');

    // 평타/스킬 2색 막대. 분해 정보가 없으면(구버전 캐시) 기여도 단색 막대로 둔다.
    const barY = y + 46;
    const barW = CARD_W - PAD * 2;
    ctx.fillStyle = COLOR.track;
    ctx.fillRect(PAD, barY, barW, 4);
    const split = row.normal + row.skill;
    if (split > 0) {
      const normalW = barW * (row.normal / split) * (row.share / 100);
      const skillW = barW * (row.skill / split) * (row.share / 100);
      ctx.fillStyle = COLOR.cyan;
      ctx.fillRect(PAD, barY, normalW, 4);
      ctx.fillStyle = COLOR.amber;
      ctx.fillRect(PAD + normalW, barY, skillW, 4);
      const pct = (part: number) => (part / split * 100).toFixed(1);
      text(ctx, `평타 ${formatDamage(row.normal)} (${pct(row.normal)}%)`, PAD, barY + 20, 11, COLOR.cyan, 600);
      text(ctx, `스킬 ${formatDamage(row.skill)} (${pct(row.skill)}%)`, PAD + 172, barY + 20, 11, COLOR.amber, 600);
      y = barY + 34;
    } else {
      ctx.fillStyle = COLOR.cyan;
      ctx.fillRect(PAD, barY, barW * (row.share / 100), 4);
      y = barY + 18;
    }
    line(ctx, PAD, y, barW, COLOR.lineSoft);
    y += 18;
  }

  y += 2;
  y = factChips(ctx, conditionChips(meta, entry), PAD, y);
  y += 26;
  text(ctx, meta.siteUrl, PAD, y, 11, COLOR.muted, 500);
  text(ctx, `${entry.result.hitCount.toLocaleString('en-US')} 히트`, CARD_W - PAD, y, 11, COLOR.muted, 500, 'right');
  return y + PAD - 6;
}

// ── K · 5덱 합계 헤드라인 + 덱 5열 ─────────────────────────────────────────

const COL_GAP = 16;

function drawBatch(
  ctx: CanvasRenderingContext2D,
  batch: BatchResult,
  meta: ReportMeta,
  portraits: Map<string, HTMLImageElement>,
  width: number,
): number {
  const decks = batch.decks;
  const duration = decks[0]?.result.duration ?? 1;
  let y = PAD + 16;

  text(ctx, `NIKKE SQUAD SIM · ${decks.length} DECK · ${duration}s`, PAD, y, 11, COLOR.cyan, 800);
  text(ctx, '전체 덱 총 대미지', width - PAD, y, 12, COLOR.muted, 500, 'right');
  y += 30;
  ctx.font = `800 26px ${FONT}`;
  ctx.fillStyle = COLOR.ink;
  ctx.textAlign = 'left';
  ctx.fillText(`${decks.length}덱 전투 `, PAD, y);
  const titleWidth = ctx.measureText(`${decks.length}덱 전투 `).width;
  text(ctx, '결과', PAD + titleWidth, y, 26, COLOR.amber, 800);
  text(ctx, formatDamage(batch.total), width - PAD, y + 8, 44, COLOR.ink, 800, 'right');

  y += 30;
  text(ctx, formatDps(batch.total / duration), width - PAD, y, 12, COLOR.muted, 500, 'right');
  y += 16;
  line(ctx, PAD, y, width - PAD * 2);
  y += 26;

  const colW = (width - PAD * 2 - COL_GAP * (decks.length - 1)) / decks.length;
  const top = y;
  let bottom = y;

  decks.forEach((entry, index) => {
    const x = PAD + index * (colW + COL_GAP);
    let cy = top;

    text(ctx, `덱 ${entry.deckId}`, x, cy, 13, COLOR.ink, 700);
    text(ctx, formatDamage(entry.result.squadTotal), x + colW, cy, 15, COLOR.cyan, 800, 'right');
    cy += 10;
    line(ctx, x, cy, colW);
    cy += 16;

    for (const row of reportRows(entry, portraits)) {
      portrait(ctx, row.portrait, x, cy - 12, 26, 5);
      const nameX = x + 34;
      const damageLabel = formatDamage(row.damage);
      ctx.font = `700 12px ${FONT}`;
      const damageW = ctx.measureText(damageLabel).width;
      text(ctx, ellipsis(ctx, row.name, 12, 600, colW - 40 - damageW - 6), nameX, cy, 12, COLOR.dim, 600);
      text(ctx, damageLabel, x + colW, cy, 12, COLOR.ink, 700, 'right');
      text(ctx, `${row.share.toFixed(1)}%`, nameX, cy + 13, 10, COLOR.muted, 500);
      cy += 32;
    }
    bottom = Math.max(bottom, cy);
  });

  y = bottom + 6;
  line(ctx, PAD, y, width - PAD * 2);
  y += 22;

  const first = decks[0];
  y = factChips(ctx, first ? conditionChips(meta, first) : [`${duration}초 전투`], PAD, y);
  y += 26;
  const hits = decks.reduce((sum, entry) => sum + entry.result.hitCount, 0);
  text(ctx, meta.siteUrl, PAD, y, 11, COLOR.muted, 500);
  text(ctx, `${decks.length}덱 · ${hits.toLocaleString('en-US')} 히트`, width - PAD, y, 11, COLOR.muted, 500, 'right');
  return y + PAD - 6;
}

// ── 진입점 ────────────────────────────────────────────────────────────────

/**
 * 보고서를 그려 캔버스를 돌려준다.
 *
 * 높이는 내용에 따라 달라지므로 한 번 재보고(측정용 캔버스) 실제 캔버스를 다시
 * 그린다. 캔버스는 `SCALE`배로 만들어 축소 표시돼도 글자가 선명하다.
 */
export function renderReport(
  batch: BatchResult,
  meta: ReportMeta,
  portraits: Map<string, HTMLImageElement>,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): HTMLCanvasElement {
  const multi = batch.decks.length > 1;
  const width = multi ? Math.max(980, 240 * batch.decks.length) : CARD_W;

  const measure = createCanvas();
  const measureCtx = measure.getContext('2d');
  if (!measureCtx) throw new Error('캔버스를 사용할 수 없는 브라우저입니다.');
  const single = batch.decks[0];
  const height = multi
    ? drawBatch(measureCtx, batch, meta, portraits, width)
    : (single ? drawSingle(measureCtx, single, meta, portraits) : PAD * 2);

  const canvas = createCanvas();
  canvas.width = Math.round(width * SCALE);
  canvas.height = Math.round(height * SCALE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 사용할 수 없는 브라우저입니다.');
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  if (multi) drawBatch(ctx, batch, meta, portraits, width);
  else if (single) drawSingle(ctx, single, meta, portraits);

  return canvas;
}

export const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('이미지를 만들지 못했습니다.'));
  }, 'image/png');
});

/**
 * PNG를 클립보드에 넣는다.
 *
 * 실패 사유를 구분해서 돌려준다. 아예 지원하지 않는 브라우저(주로 Firefox)와,
 * 지원하지만 그 순간 거부된 경우(창에 포커스가 없거나 권한이 막힘)는 사용자가
 * 할 일이 다르기 때문이다 — 전자는 저장뿐이고 후자는 다시 누르면 된다.
 */
export type CopyOutcome = 'copied' | 'unsupported' | 'blocked';

export async function copyImage(blob: Blob): Promise<CopyOutcome> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return 'unsupported';
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'copied';
  } catch {
    return 'blocked';
  }
}

export function downloadImage(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // 즉시 회수하면 일부 브라우저에서 저장이 끊긴다.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const reportFilename = (batch: BatchResult): string => {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return `nikke-${batch.decks.length > 1 ? `${batch.decks.length}deck` : 'squad'}-${stamp}.png`;
};
