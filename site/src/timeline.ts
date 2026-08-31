import { formatDamage } from './model';
import { statText } from './stat-names';
import { spanTargets } from './types';
import type { BattleTimeline, BuffSpan, BuffTrack, DeckResultEntry } from './types';

const LINE_COLORS = ['#45d6d0', '#ffbf3c', '#9b8cff', '#5fd08a', '#ff7db0'];
const MIN_SPAN = 4; // 최대 확대: 화면에 4초까지

// 버스트 표기 — 시각에 **얼굴을 꽂는다**. 색을 범례와 대조할 필요가 없어 누가 썼는지
// 바로 읽힌다. 같은 시각에 여러 명이 쓰면(B1→B2→B3는 늘 그렇다) 계단식으로 어긋내
// 서로 가리지 않게 한다.
const PIN_R = 11;          // 초상화 원 반지름
const PIN_GAP = 4;         // 원과 원 사이 최소 여백
const PIN_STEPS = 3;       // 핀 행 수 — 이보다 동시에 많을 때만 가장 오래 빈 행을 재사용한다
const PIN_STEP = PIN_R * 2 + PIN_GAP;
const PIN_LANE = PIN_R * 2 * PIN_STEPS + PIN_GAP * (PIN_STEPS - 1) + 14;

// 버프 막대 — 그래프 **위쪽**에 쌓는다. 겹치는 버프는 아래 줄로 밀어 서로 가리지 않게 하고,
// 줄 수가 많아지면 그래프가 남지 않으므로 상한을 둔다(넘치는 것은 그리지 않고 그 수를 적는다).
const BUFF_H = 15;          // 막대 높이
const BUFF_GAP = 3;         // 줄 간격
const BUFF_ROWS_MAX = 12;   // 최대 줄 수 — 넘으면 «+n줄 더»만 적는다
const BUFF_PAD = 8;         // 레인과 그래프 사이 여백
const BUFF_STACK_W = 20;    // 막대 오른쪽 «중첩 수» 자리 — 이름보다 이쪽이 우선이다
const BUFF_MIN_W = 6;       // 이보다 좁으면 글자를 넣지 않는다
const BASE_H = 424;         // 그래프만 있을 때 높이(CSS와 같은 값) — 레인은 이 위로 더 붙는다

export interface TimelineSeries {
  names: string[];
  colors: Record<string, string>;
  damage: Record<string, number[]>;
  totals: Record<string, number>;
  bursts: Record<string, { t: number; stage: string }[]>;
  fullBurst: [number, number][];
  /** 족자 — 평타가 빗나가는 구간. 타임라인에 붉은 밴드로 깐다. */
  immuneWindows: Array<{ from: number; to: number }>;
  /** 속저 — 우월 코드만 통과하는 구간. 푸른 밴드로 깐다. */
  elementWindows: Array<{ from: number; to: number; code: string }>;
  /** 버프가 걸려 있던 구간. 「버프 표시」를 켰을 때만 그린다. */
  buffs: BuffTrack[];
  peak: number;
  buckets: number;
  /**
   * 버킷 한 칸의 길이(초). «몇 번째 칸이 몇 초인지»는 전부 이 값으로 환산한다 —
   * 1초 버킷으로 저장된 옛 결과도 같은 셈으로 그려진다.
   */
  bucket: number;
  duration: number;
}

/** 화면에 놓인 한 구간 — 픽셀 자리와 중첩 수. */
export interface BuffPart { x0: number; x1: number; stack: number; span: BuffSpan; }

/** 붙어 있는 구간들을 한 막대로 묶은 것. 안쪽 경계는 눈금으로만 긋는다. */
export interface BuffRun { x0: number; x1: number; parts: BuffPart[]; }

/**
 * 붙어 있는 구간을 한 막대로 묶는다.
 *
 * 중첩이 잘게 오르내리는 버프(예: 릴렉스는 231구간)를 구간마다 둥근 네모로 그리면
 * 줄 전체가 바코드가 된다. **끊긴 자리에서만** 막대를 나누고, 중첩이 바뀐 자리는
 * 막대 안쪽 눈금으로 표시한다 — 확대하면 칸이 넓어져 숫자가 다시 드러난다.
 */
export function buffRuns(parts: BuffPart[]): BuffRun[] {
  const runs: BuffRun[] = [];
  for (const part of parts) {
    const last = runs[runs.length - 1];
    if (last && part.x0 - last.x1 <= 1) {
      last.x1 = Math.max(last.x1, part.x1);
      last.parts.push(part);
    } else {
      runs.push({ x0: part.x0, x1: part.x1, parts: [part] });
    }
  }
  return runs;
}

/**
 * 막대 하나에 무엇을 적을지. **중첩 수가 이름보다 우선이다** — 좁아지면 이름부터 잘리고,
 * 그래도 모자라면 이름을 아예 안 적는다. 중첩 수는 오른쪽 끝에 자리를 따로 받는다.
 */
export function buffTextPlan(width: number, stacked: boolean):
  { stack: boolean; nameRoom: number } {
  const stack = stacked && width >= BUFF_MIN_W;
  const right = width - 4 - (stack ? BUFF_STACK_W : 0);
  return { stack, nameRoom: right - 5 };
}

/** 둥근 네모. 옛 사파리에도 있는 길로 그린다(`roundRect`가 없는 판이 있다). */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number,
  w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** 주어진 폭에 맞게 자른다. 다 안 들어가면 «…»를 붙인다. */
function fitText(ctx: CanvasRenderingContext2D, text: string, room: number): string {
  if (ctx.measureText(text).width <= room) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > room) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** 초당 대미지 시리즈를 한 그래프에 겹쳐 그리기 좋은 형태로 정리한다 (순수 함수). */
export function buildSeries(
  timeline: BattleTimeline,
  squad: string[],
  duration: number,
  phases: {
    immuneWindows?: Array<{ from: number; to: number }>;
    elementWindows?: Array<{ from: number; to: number; code: string }>;
  } = {},
): TimelineSeries | null {
  const names = squad.filter((name) => timeline.damage[name]);
  if (names.length === 0 || timeline.buckets <= 0 || duration <= 0) return null;

  const colors: Record<string, string> = {};
  const totals: Record<string, number> = {};
  let peak = 0;
  names.forEach((name, index) => {
    colors[name] = LINE_COLORS[index % LINE_COLORS.length]!;
    const row = timeline.damage[name] ?? [];
    totals[name] = row.reduce((sum, value) => sum + value, 0);
    for (const value of row) if (value > peak) peak = value;
  });

  return {
    names,
    colors,
    damage: timeline.damage,
    totals,
    bursts: timeline.bursts,
    fullBurst: timeline.fullBurst,
    immuneWindows: phases.immuneWindows ?? [],
    elementWindows: phases.elementWindows ?? [],
    // 이 덱에 없는 사람이 건 버프는 색을 줄 수 없으니 뺀다(옛 결과에는 목록 자체가 없다).
    buffs: (timeline.buffs ?? []).filter((track) => names.includes(track.caster)),
    peak,
    buckets: timeline.buckets,
    // 옛 결과에는 이 값이 없을 수 있다 — 그때는 1초 버킷이었다.
    bucket: timeline.bucket > 0 ? timeline.bucket : 1,
    duration,
  };
}

/**
 * 툴팁에 적을 구간. 버킷이 1초면 «12–13초», 0.1초면 «12.3–12.4초»로 적는다 —
 * 소수 자리는 버킷 크기에서 뽑아, 칸이 더 잘게 쪼개져도 그대로 맞는다.
 */
export function formatSpan(index: number, bucket: number): string {
  // 소수 자리는 버킷 값에서 그대로 센다 — 0.1은 한 자리, 0.25는 두 자리다.
  const digits = Number.isInteger(bucket)
    ? 0 : Math.min(3, (String(bucket).split('.')[1] ?? '').length);
  const from = index * bucket;
  return `${from.toFixed(digits)}–${(from + bucket).toFixed(digits)}초`;
}

/** peak 이상이면서 축 눈금으로 깔끔한 상한값. */
export function niceMax(peak: number): number {
  if (peak <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (peak <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

const X_STEPS = [1, 2, 5, 10, 15, 20, 30, 60, 120];

function xTickStep(span: number): number {
  for (const step of X_STEPS) {
    if (span / step <= 8) return step;
  }
  return X_STEPS[X_STEPS.length - 1]!;
}

interface Rect { left: number; top: number; width: number; height: number; }

class TimelineChart {
  private ctx: CanvasRenderingContext2D | null;
  private view0: number;
  private view1: number;
  private hidden = new Set<string>();
  private hoverIndex: number | null = null;
  /** 「버프 표시」를 켰는가. 껐을 때는 레인을 아예 만들지 않는다(그래프가 그만큼 넓어진다). */
  private showBuffs = false;
  /** 화면에 그린 막대와 그 자리 — 마우스가 어느 버프 위인지 이걸로 찾는다. */
  private buffHits: Array<{
    track: BuffTrack; span: BuffSpan; x0: number; x1: number; y: number;
  }> = [];
  private hoverSpan: BuffSpan | null = null;
  /** 그릴 줄. 한 줄이 버프 하나다 — 켤 때와 범례가 바뀔 때 다시 고른다. */
  private buffRows: BuffTrack[] = [];
  private buffHidden = 0;
  /** 「+n줄 더」를 눌러 전부 편 상태인가. 펴면 레인이 길어지고 그래프가 그만큼 낮아진다. */
  private buffExpanded = false;
  /** 「+n줄 더」 글자의 자리 — 여기를 누르면 편다. */
  private buffMoreHit: { x0: number; x1: number; y0: number; y1: number } | null = null;
  private plot: Rect = { left: 0, top: 0, width: 0, height: 0 };
  private dragging = false;
  /** 누른 뒤 실제로 끌었는가. 끌지 않았으면 «누른 것»으로 친다. */
  private dragMoved = false;
  private lastX = 0;

  private portraits = new Map<string, HTMLImageElement>();

  constructor(
    private canvas: HTMLCanvasElement,
    private tooltip: HTMLElement,
    private series: TimelineSeries,
    portraitUrls: Record<string, string> = {},
  ) {
    this.ctx = canvas.getContext('2d');
    this.view0 = 0;
    this.view1 = series.duration;
    // 캔버스는 이미지가 준비돼야 그릴 수 있다 — 도착할 때마다 다시 그린다.
    // 못 받아도(오프라인·404) 이름 첫 글자로 대신 그리므로 화면이 비지 않는다.
    for (const [name, url] of Object.entries(portraitUrls)) {
      const img = new Image();
      img.decoding = 'async';
      img.addEventListener('load', () => this.draw());
      img.src = url;
      this.portraits.set(name, img);
    }
    this.bindEvents();
  }

  setHidden(name: string, hidden: boolean): void {
    if (hidden) this.hidden.add(name); else this.hidden.delete(name);
    // 버프 줄은 «보이는 캐릭터»만 담는다 — 범례로 한 사람만 남기면 그 사람 버프가 다 보인다.
    if (this.showBuffs) this.packBuffs();
    this.draw();
  }

  zoomBy(factor: number, centerT?: number): void {
    const span = this.view1 - this.view0;
    const center = centerT ?? (this.view0 + span / 2);
    let newSpan = Math.min(this.series.duration, Math.max(MIN_SPAN, span * factor));
    const ratio = (center - this.view0) / span;
    let v0 = center - ratio * newSpan;
    this.setView(v0, v0 + newSpan);
  }

  reset(): void {
    this.setView(0, this.series.duration);
  }

  private setView(v0: number, v1: number): void {
    let span = Math.min(this.series.duration, Math.max(MIN_SPAN, v1 - v0));
    let start = Math.max(0, Math.min(v0, this.series.duration - span));
    this.view0 = start;
    this.view1 = start + span;
    this.draw();
  }

  /** 버프 레인이 차지하는 높이. 꺼져 있거나 그릴 게 없으면 0이다. */
  private buffLaneHeight(): number {
    if (!this.showBuffs || this.buffRows.length === 0) return 0;
    return this.buffRows.length * (BUFF_H + BUFF_GAP) + BUFF_PAD;
  }

  private layout(): Rect {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || this.canvas.width;
    const height = rect.height || this.canvas.height;
    // 위쪽에 버프 레인, 아래쪽에 축(34) + 핀 레인을 비워 둔다.
    const lane = this.buffLaneHeight();
    return { left: 58, top: 12 + lane, width: Math.max(1, width - 58 - 14),
             height: Math.max(1, height - 12 - lane - 34 - PIN_LANE) };
  }

  /**
   * 버프를 줄로 나눈다. **한 줄은 «버프 하나»다** — 같은 버프가 스무 번 다시 걸려도
   * 한 줄에 나란히 눕는다. 시각 겹침만 보고 아무 줄에나 얹으면 같은 버프가 줄마다
   * 흩어져 무엇이 몇 번 걸렸는지가 안 읽힌다(실측: 5인 180초에서 400칸/47버프).
   *
   * 범례에서 끈 캐릭터의 버프는 아예 빼므로, 한 사람만 켜면 7~14줄로 떨어진다.
   * 그래도 상한을 넘으면 더 얹지 않고 몇 줄을 못 그렸는지만 적는다.
   */
  private packBuffs(): void {
    const order = new Map(this.series.names.map((name, index) => [name, index]));
    const rows = this.series.buffs
      .filter((track) => !this.hidden.has(track.caster) && track.spans.length > 0)
      .sort((a, b) => {
        const byCaster = (order.get(a.caster) ?? 99) - (order.get(b.caster) ?? 99);
        return byCaster !== 0 ? byCaster : a.spans[0]![0] - b.spans[0]![0];
      });
    const cap = this.buffExpanded ? rows.length : BUFF_ROWS_MAX;
    this.buffRows = rows.slice(0, cap);
    this.buffHidden = Math.max(0, rows.length - cap);
  }

  /** 「버프 표시」 켜기·끄기. */
  setShowBuffs(on: boolean): void {
    this.showBuffs = on && this.series.buffs.length > 0;
    if (this.showBuffs) this.packBuffs();
    this.hoverSpan = null;
    this.draw();
  }

  get hasBuffs(): boolean {
    return this.series.buffs.length > 0;
  }

  private xFor(t: number): number {
    return this.plot.left + ((t - this.view0) / (this.view1 - this.view0)) * this.plot.width;
  }

  private tFor(px: number): number {
    return this.view0 + ((px - this.plot.left) / this.plot.width) * (this.view1 - this.view0);
  }

  resize(): void {
    if (!this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  /**
   * 버프 레인이 붙은 만큼 판을 키운다.
   *
   * 레인을 그래프 안에서 나눠 쓰면 줄이 늘수록 그래프가 납작해진다 — 그래서 판이
   * 아래로 자란다. 「+n줄 더 보기」로 전부 펴면 그만큼 더 길어진다.
   * 높이를 바꿨으면 `true`를 준다(그 판에 맞춰 다시 그려야 한다).
   */
  private syncHeight(): boolean {
    const wrap = this.canvas.parentElement;
    if (!wrap) return false;
    const want = `${BASE_H + this.buffLaneHeight()}px`;
    if (wrap.style.height === want) return false;
    wrap.style.height = want;
    return true;
  }

  draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.syncHeight()) { this.resize(); return; }
    this.plot = this.layout();
    const { left, top, width, height } = this.plot;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);

    const yMax = niceMax(this.series.peak);
    const yFor = (v: number) => top + height - (v / yMax) * height;

    // 풀버스트 밴드
    for (const [s, e] of this.series.fullBurst) {
      if (e < this.view0 || s > this.view1) continue;
      const x0 = Math.max(left, this.xFor(s));
      const x1 = Math.min(left + width, this.xFor(e));
      ctx.fillStyle = 'rgba(255,191,60,0.09)';
      ctx.fillRect(x0, top, Math.max(0, x1 - x0), height);
    }

    // 보스 페이즈 밴드 — 족자는 붉게(평타가 빗나감), 속저는 푸르게
    // (우월 코드만 통과). 풀버스트 밴드와 같은 방식이라 함께 읽힌다.
    const band = (from: number, to: number, fill: string, label: string) => {
      if (to < this.view0 || from > this.view1) return;
      const x0 = Math.max(left, this.xFor(from));
      const x1 = Math.min(left + width, this.xFor(to));
      const w = Math.max(0, x1 - x0);
      if (w <= 0) return;
      ctx.fillStyle = fill;
      ctx.fillRect(x0, top, w, height);
      // 좁은 구간에 글씨를 욱여넣으면 오히려 안 읽힌다.
      if (w >= 26) {
        ctx.fillStyle = 'rgba(234,242,248,0.72)';
        ctx.font = '700 9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, x0 + w / 2, top + 3);
      }
    };
    for (const w of this.series.immuneWindows) {
      band(w.from, w.to, 'rgba(255,119,135,0.16)', '족자');
    }
    for (const w of this.series.elementWindows) {
      band(w.from, w.to, 'rgba(96,165,250,0.16)', `속저 ${w.code}`);
    }
    ctx.textAlign = 'left';

    // y 그리드 + 라벨
    ctx.font = '10px Pretendard, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i += 1) {
      const value = (yMax / 4) * i;
      const y = yFor(value);
      ctx.strokeStyle = 'rgba(146,176,201,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + width, y);
      ctx.stroke();
      ctx.fillStyle = '#8394a6';
      ctx.textAlign = 'right';
      ctx.fillText(formatDamage(value), left - 6, y);
    }

    // x 눈금 + 라벨
    const span = this.view1 - this.view0;
    const step = xTickStep(span);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const first = Math.ceil(this.view0 / step) * step;
    for (let t = first; t <= this.view1 + 1e-6; t += step) {
      const x = this.xFor(t);
      ctx.strokeStyle = 'rgba(146,176,201,0.08)';
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + height);
      ctx.stroke();
      ctx.fillStyle = '#8394a6';
      ctx.fillText(`${Math.round(t)}s`, x, top + height + 8);
    }

    // 버프 막대 — 그래프 위쪽 레인. 색은 «건 사람»의 색이다.
    this.buffHits = [];
    if (this.showBuffs && this.buffRows.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, 12, width, this.buffLaneHeight());
      ctx.clip();
      ctx.textBaseline = 'middle';
      this.buffRows.forEach((track, rowIndex) => {
        const y = 12 + rowIndex * (BUFF_H + BUFF_GAP);
        const color = this.series.colors[track.caster] ?? '#8394a6';
        const parts: BuffPart[] = [];
        for (const span of track.spans) {
          const [from, to, stack] = span;
          if (to < this.view0 || from > this.view1) continue;
          const x0 = Math.max(left, this.xFor(from));
          const x1 = Math.max(x0 + 2, Math.min(left + width, this.xFor(to)));
          parts.push({ x0, x1, stack, span });
        }
        for (const run of buffRuns(parts)) {
          const runW = run.x1 - run.x0;
          const hot = run.parts.some((part) => this.hoverSpan === part.span);
          ctx.fillStyle = hot ? `${color}66` : `${color}33`;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          roundRect(ctx, run.x0, y, runW, BUFF_H, 4);
          ctx.fill();
          ctx.stroke();

          // 중첩이 바뀐 자리는 눈금만 긋는다 — 칸마다 네모를 그리면 바코드가 된다.
          // 숫자를 적을 수 없을 만큼 좁은 칸은 눈금도 접는다(확대하면 다시 드러난다).
          for (const part of run.parts) {
            this.buffHits.push({ track, span: part.span, x0: part.x0, x1: part.x1, y });
            if (part === run.parts[0] || part.x1 - part.x0 < BUFF_MIN_W) continue;
            ctx.strokeStyle = `${color}88`;
            ctx.beginPath();
            ctx.moveTo(part.x0, y + 2);
            ctx.lineTo(part.x0, y + BUFF_H - 2);
            ctx.stroke();
          }

          // 이름은 막대 하나에 한 번만 적는다 — 잘게 나뉜 칸마다 적으면 읽히지 않는다.
          const stacked = track.maxStack > 1;
          const nameRoom = buffTextPlan(runW, stacked).nameRoom;
          let nameEnd = run.x0;
          if (nameRoom >= BUFF_MIN_W) {
            ctx.fillStyle = hot ? '#eaf6ff' : '#cfe3f2';
            ctx.font = '600 10px system-ui, sans-serif';
            ctx.textAlign = 'left';
            const label = fitText(ctx, track.name, nameRoom);
            ctx.fillText(label, run.x0 + 5, y + BUFF_H / 2);
            nameEnd = run.x0 + 5 + ctx.measureText(label).width + 4;
          }
          // 중첩 수가 이름보다 우선이다 — 다만 이름 글자를 덮어쓰지는 않는다.
          if (stacked) {
            ctx.font = '700 10px ui-monospace, monospace';
            ctx.textAlign = 'right';
            for (const part of run.parts) {
              if (!buffTextPlan(part.x1 - part.x0, true).stack) continue;
              if (part.x1 - 4 < nameEnd) continue;
              ctx.fillStyle = this.hoverSpan === part.span ? '#eaf6ff' : color;
              ctx.fillText(String(part.stack), part.x1 - 4, y + BUFF_H / 2);
            }
          }
        }
      });
      ctx.restore();
      this.buffMoreHit = null;
      if (this.buffHidden > 0 || this.buffExpanded) {
        const label = this.buffExpanded ? '접기' : `+${this.buffHidden}줄 더 보기`;
        ctx.fillStyle = '#cfe3f2';
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        const ty = 12 + this.buffLaneHeight() - BUFF_PAD;
        ctx.fillText(label, left + width, ty);
        const tw = ctx.measureText(label).width;
        this.buffMoreHit = { x0: left + width - tw - 6, x1: left + width + 4, y0: ty - 3, y1: ty + 13 };
      }
    }

    // 각 캐릭터 라인
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    for (const name of this.series.names) {
      if (this.hidden.has(name)) continue;
      const row = this.series.damage[name] ?? [];
      ctx.strokeStyle = this.series.colors[name]!;
      ctx.lineWidth = 1.75;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < row.length; i += 1) {
        const t = (i + 0.5) * this.series.bucket;
        if (t < this.view0 - step || t > this.view1 + step) continue;
        const x = this.xFor(t);
        const y = yFor(row[i]!);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // 버스트 핀 — 플롯 아래 레인에 **얼굴**을 꽂는다.
    // 시각순으로 모아 두고, 서로 가까우면 계단식으로 어긋내 겹치지 않게 한다.
    const pins: Array<{ t: number; name: string; stage: string }> = [];
    for (const name of this.series.names) {
      if (this.hidden.has(name)) continue;
      for (const cast of this.series.bursts[name] ?? []) {
        if (cast.t < this.view0 || cast.t > this.view1) continue;
        pins.push({ t: cast.t, name, stage: cast.stage });
      }
    }
    pins.sort((a, b) => a.t - b.t);

    const laneTop = top + height + 8;
    const tierLastX = Array<number>(PIN_STEPS).fill(-Infinity);
    for (const pin of pins) {
      const x = this.xFor(pin.t);
      // 같은 행의 앞 핀과 지름+여백만큼 떨어지는 첫 행을 고른다. 세 행이 모두
      // 차 있으면 가장 오래 비어 있던 행을 재사용해 겹침을 최소화한다.
      let tier = tierLastX.findIndex((lastX) => x - lastX >= PIN_STEP);
      if (tier < 0) tier = tierLastX.indexOf(Math.min(...tierLastX));
      tierLastX[tier] = x;
      const cy = laneTop + PIN_R + tier * PIN_STEP;
      const color = this.series.colors[pin.name]!;

      // 그래프에서 내려오는 줄기 — 어느 시각인지 눈으로 잇는다.
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(x, top + height);
      ctx.lineTo(x, cy - PIN_R);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 얼굴 (원형으로 잘라 넣는다). 아직 안 왔으면 이름 첫 글자로 대신한다.
      const img = this.portraits.get(pin.name);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, cy, PIN_R, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      if (img?.complete && img.naturalWidth > 0) {
        const side = PIN_R * 2;
        ctx.drawImage(img, x - PIN_R, cy - PIN_R - PIN_R * 0.25, side, side * 1.25);
      } else {
        ctx.fillStyle = 'rgba(6,14,23,.95)';
        ctx.fillRect(x - PIN_R, cy - PIN_R, PIN_R * 2, PIN_R * 2);
        ctx.fillStyle = color;
        ctx.font = '700 10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pin.name.slice(0, 1), x, cy);
      }
      ctx.restore();

      // 캐릭터 색 테두리 — 그래프 선과 같은 색이라 어느 줄의 주인인지도 이어진다.
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.arc(x, cy, PIN_R, 0, Math.PI * 2);
      ctx.stroke();

      // 버스트 단계 — 우하단 작은 배지.
      if (pin.stage) {
        const bx = x + PIN_R * 0.72;
        const by = cy + PIN_R * 0.72;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(bx, by, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#04101a';
        ctx.font = '900 8px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pin.stage, bx, by);
      }
    }

    // 호버 크로스헤어 + 포인트
    if (this.hoverIndex !== null) {
      const t = (this.hoverIndex + 0.5) * this.series.bucket;
      if (t >= this.view0 && t <= this.view1) {
        const x = this.xFor(t);
        ctx.strokeStyle = 'rgba(234,242,248,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + height);
        ctx.stroke();
        for (const name of this.series.names) {
          if (this.hidden.has(name)) continue;
          const value = this.series.damage[name]?.[this.hoverIndex] ?? 0;
          ctx.fillStyle = this.series.colors[name]!;
          ctx.beginPath();
          ctx.arc(x, yFor(value), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private showTooltip(clientX: number, clientY: number): void {
    if (this.hoverIndex === null) { this.tooltip.style.display = 'none'; return; }
    const index = this.hoverIndex;
    const rows = this.series.names
      .filter((name) => !this.hidden.has(name))
      .map((name) => ({ name, value: this.series.damage[name]?.[index] ?? 0, color: this.series.colors[name]! }))
      .sort((a, b) => b.value - a.value);
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    const lines = rows.map((row) =>
      `<div class="tl-tip-row"><span class="tl-dot" style="background:${row.color}"></span>` +
      `<span class="tl-name">${row.name}</span><span class="tl-val">${formatDamage(row.value)}</span></div>`,
    ).join('');
    this.tooltip.innerHTML =
      `<div class="tl-tip-time">${formatSpan(index, this.series.bucket)}</div>${lines}` +
      `<div class="tl-tip-total"><span>합계</span><span>${formatDamage(total)}</span></div>`;
    const host = this.canvas.parentElement!.getBoundingClientRect();
    let px = clientX - host.left + 14;
    if (px + 180 > host.width) px = clientX - host.left - 194;
    this.tooltip.style.left = `${Math.max(4, px)}px`;
    this.tooltip.style.top = `${Math.max(4, clientY - host.top + 12)}px`;
    this.tooltip.style.display = 'block';
  }

  /** 버프 막대 하나의 상세. 「무엇을·누가·누구에게·언제부터 언제까지·몇 겹」을 적는다. */
  private showBuffTip(track: BuffTrack, span: BuffSpan,
    clientX: number, clientY: number): void {
    const color = this.series.colors[track.caster] ?? '#8394a6';
    const seconds = (value: number) => `${value.toFixed(1)}초`;
    const [from, to, stack] = span;
    // 대상이 발동마다 갈리는 버프가 있다 — 이 구간을 실제로 받은 사람만 보인다.
    const faces = spanTargets(track, span).map((name) => {
      const url = this.portraits.get(name)?.src;
      const dot = `<span class="tl-dot" style="background:${this.series.colors[name] ?? '#8394a6'}"></span>`;
      return url
        ? `<img class="tl-face" src="${url}" alt="${name}" title="${name}" />`
        : `<span class="tl-face tl-face-none" title="${name}">${dot}</span>`;
    }).join('');
    const rows: string[] = [
      `<div class="tl-tip-row"><span class="tl-name">지속</span>` +
      `<span class="tl-val">${seconds(from)} → ${seconds(to)} (${seconds(to - from)})</span></div>`,
      `<div class="tl-tip-row"><span class="tl-name">건 사람</span><span class="tl-val">${track.caster}</span></div>`,
    ];
    if (track.stat) {
      // 엔진 키는 영어다 — 화면에는 한글로 적고, 원래 키는 마우스를 올리면 나온다.
      rows.push(`<div class="tl-tip-row"><span class="tl-name">효과</span>`
        + `<span class="tl-val" title="${track.stat}">${statText(track.stat, track.value)}</span></div>`);
    }
    if (track.maxStack > 1) {
      rows.push(`<div class="tl-tip-row"><span class="tl-name">중첩</span>` +
        `<span class="tl-val">${stack} / ${track.maxStack}</span></div>`);
    }
    // 받는 사람은 얼굴로 보인다 — 다섯 명한테 걸리는 버프를 이름으로 늘어놓으면 길기만 하다.
    const targets = faces
      ? `<div class="tl-tip-faces"><span class="tl-name">받는 사람</span><span>${faces}</span></div>`
      : '';
    this.tooltip.innerHTML =
      `<div class="tl-tip-time" style="color:${color}">${track.name}</div>${rows.join('')}${targets}`;
    const host = this.canvas.parentElement!.getBoundingClientRect();
    let px = clientX - host.left + 14;
    if (px + 220 > host.width) px = clientX - host.left - 234;
    this.tooltip.style.left = `${Math.max(4, px)}px`;
    this.tooltip.style.top = `${Math.max(4, clientY - host.top + 12)}px`;
    this.tooltip.style.display = 'block';
  }

  private bindEvents(): void {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.dragMoved = false;
      this.lastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      const rect = canvas.getBoundingClientRect();
      if (this.dragging) {
        const dx = event.clientX - this.lastX;
        this.lastX = event.clientX;
        if (Math.abs(dx) > 2) this.dragMoved = true;
        const dt = (dx / this.plot.width) * (this.view1 - this.view0);
        this.setView(this.view0 - dt, this.view1 - dt);
        return;
      }
      // 버프 레인 위에서는 그 막대를 잡는다 — 그래프 호버와 섞이면 둘 다 안 읽힌다.
      const y = event.clientY - rect.top;
      const overBuff = this.buffHits.find((hit) =>
        y >= hit.y && y <= hit.y + BUFF_H
        && event.clientX - rect.left >= hit.x0 && event.clientX - rect.left <= hit.x1);
      if (this.showBuffs && overBuff) {
        this.hoverSpan = overBuff.span;
        this.hoverIndex = null;
        this.draw();
        this.showBuffTip(overBuff.track, overBuff.span, event.clientX, event.clientY);
        return;
      }
      this.hoverSpan = null;
      const more = this.buffMoreHit;
      canvas.style.cursor = this.showBuffs && more
        && event.clientX - rect.left >= more.x0 && event.clientX - rect.left <= more.x1
        && y >= more.y0 && y <= more.y1 ? 'pointer' : 'crosshair';
      const t = this.tFor(event.clientX - rect.left);
      const index = Math.floor(t / this.series.bucket);
      this.hoverIndex = index >= 0 && index < this.series.buckets ? index : null;
      this.draw();
      this.showTooltip(event.clientX, event.clientY);
    });
    const end = (event: PointerEvent) => {
      // 끌었으면 그림을 옮긴 것이고, 그대로 뗐으면 누른 것이다 —
      // 둘을 가르지 않으면 «+n줄 더 보기»는 영영 눌리지 않는다.
      const wasDrag = this.dragging && this.dragMoved;
      this.dragging = false;
      this.dragMoved = false;
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* noop */ }
      if (wasDrag || !this.showBuffs || !this.buffMoreHit) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hit = this.buffMoreHit;
      if (x >= hit.x0 && x <= hit.x1 && y >= hit.y0 && y <= hit.y1) {
        this.buffExpanded = !this.buffExpanded;
        this.packBuffs();
        this.draw();
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => {
      this.hoverIndex = null;
      this.hoverSpan = null;
      this.tooltip.style.display = 'none';
      this.draw();
    });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const centerT = this.tFor(event.clientX - rect.left);
      this.zoomBy(event.deltaY > 0 ? 1.2 : 0.8, centerT);
    }, { passive: false });
  }
}

/** 덱 결과에 붙일 인터랙티브 타임라인 블록을 만든다. 타임라인이 없으면 null. */
export function createTimelineBlock(
  entry: DeckResultEntry,
  portraitUrls: Record<string, string> = {},
): HTMLElement | null {
  const timeline = entry.result.timeline;
  if (!timeline) return null;
  const squad = entry.request.squad.filter(Boolean);
  const series = buildSeries(timeline, squad, entry.result.duration, {
    immuneWindows: entry.request.immuneWindows,
    elementWindows: entry.request.elementWindows,
  });
  if (!series) return null;

  const block = document.createElement('div');
  block.className = 'timeline-block';
  block.dataset.timeline = String(entry.deckId);

  const head = document.createElement('div');
  head.className = 'timeline-head';
  const heading = document.createElement('p');
  heading.className = 'timeline-heading';
  heading.textContent = '전투 타임라인 · 초당 대미지';
  const controls = document.createElement('div');
  controls.className = 'timeline-controls';
  const zoomOut = button('−', '축소');
  const zoomIn = button('+', '확대');
  const reset = button('전체', '전체 보기');
  controls.append(zoomOut, zoomIn, reset);
  head.append(heading, controls);
  block.append(head);

  const legend = document.createElement('div');
  legend.className = 'timeline-legend-row';
  block.append(legend);

  const figure = document.createElement('div');
  figure.className = 'timeline-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'timeline-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '캐릭터별 초당 대미지를 한 그래프에 겹쳐 그린 인터랙티브 타임라인. 드래그로 이동, 휠·버튼으로 확대·축소.');
  const tooltip = document.createElement('div');
  tooltip.className = 'timeline-tip';
  tooltip.style.display = 'none';
  figure.append(canvas, tooltip);
  block.append(figure);

  const note = document.createElement('p');
  note.className = 'timeline-legend';
  note.textContent = '드래그 이동 · 휠/버튼 확대·축소 · 노란 밴드 = 풀버스트 · 붉은 밴드 = 족자 · 푸른 밴드 = 속저 · 아래 초상화 = 버스트 사용(배지는 단계)';
  block.append(note);

  const chart = new TimelineChart(canvas, tooltip, series, portraitUrls);
  // 버프 표시 — 켜면 그래프 위에 막대가 쌓이고 그만큼 그래프가 낮아진다. 기본은 끔이다
  // (막대가 수십 개라 처음부터 켜 두면 무엇을 보는 화면인지 흐려진다).
  if (chart.hasBuffs) {
    // 확대·축소 단추와 같은 생김새의 «켜고 끄는 단추»다. 기본 체크박스를 그대로 두면
    // 옆 단추들과 크기·정렬이 어긋나 화면이 흐트러진다.
    const buffToggle = document.createElement('button');
    buffToggle.type = 'button';
    buffToggle.className = 'timeline-buff-toggle';
    buffToggle.dataset.timelineBuffs = '';
    buffToggle.setAttribute('aria-pressed', 'false');
    buffToggle.title = '버프가 걸려 있던 구간을 그래프 위에 막대로 보여 줍니다. 막대에 마우스를 올리면 자세히 나옵니다';
    const mark = textSpan('', 'tl-buff-mark');
    mark.setAttribute('aria-hidden', 'true');
    buffToggle.append(mark, textSpan('버프 표시', ''));
    buffToggle.addEventListener('click', () => {
      const on = buffToggle.getAttribute('aria-pressed') !== 'true';
      buffToggle.setAttribute('aria-pressed', String(on));
      buffToggle.classList.toggle('is-on', on);
      chart.setShowBuffs(on);
    });
    controls.prepend(buffToggle);
  }
  zoomIn.addEventListener('click', () => chart.zoomBy(0.6));
  zoomOut.addEventListener('click', () => chart.zoomBy(1.8));
  reset.addEventListener('click', () => chart.reset());

  for (const name of series.names) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'timeline-legend-item';
    item.dataset.series = name;
    const dot = document.createElement('span');
    dot.className = 'tl-dot';
    dot.style.background = series.colors[name]!;
    item.append(dot, textSpan(name, 'tl-name'), textSpan(formatDamage(series.totals[name] ?? 0), 'tl-total'));
    item.addEventListener('click', () => {
      const off = item.classList.toggle('is-off');
      chart.setHidden(name, off);
    });
    legend.append(item);
  }

  // 레이아웃이 잡힌 뒤 크기를 재고 그린다. setTimeout은 rAF와 달리 숨겨진 탭에서도
  // 실행돼 백그라운드에서 결과가 도착해도 초기 그리기가 보장된다. jsdom(ctx 없음)에서는
  // resize가 조용히 무시된다.
  setTimeout(() => chart.resize(), 0);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => chart.resize()).observe(figure);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => chart.resize());
  }

  return block;
}

function button(text: string, label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'timeline-btn';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.textContent = text;
  return btn;
}

function textSpan(text: string, className: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}
