import { formatDamage } from './model';
import type { BattleTimeline, DeckResultEntry } from './types';

const LINE_COLORS = ['#45d6d0', '#ffbf3c', '#9b8cff', '#5fd08a', '#ff7db0'];
const MIN_SPAN = 4; // 최대 확대: 화면에 4초까지

export interface TimelineSeries {
  names: string[];
  colors: Record<string, string>;
  damage: Record<string, number[]>;
  totals: Record<string, number>;
  bursts: Record<string, { t: number; stage: string }[]>;
  fullBurst: [number, number][];
  peak: number;
  buckets: number;
  duration: number;
}

/** 초당 대미지 시리즈를 한 그래프에 겹쳐 그리기 좋은 형태로 정리한다 (순수 함수). */
export function buildSeries(
  timeline: BattleTimeline,
  squad: string[],
  duration: number,
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
    peak,
    buckets: timeline.buckets,
    duration,
  };
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
  private plot: Rect = { left: 0, top: 0, width: 0, height: 0 };
  private dragging = false;
  private lastX = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private tooltip: HTMLElement,
    private series: TimelineSeries,
  ) {
    this.ctx = canvas.getContext('2d');
    this.view0 = 0;
    this.view1 = series.duration;
    this.bindEvents();
  }

  setHidden(name: string, hidden: boolean): void {
    if (hidden) this.hidden.add(name); else this.hidden.delete(name);
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

  private layout(): Rect {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || this.canvas.width;
    const height = rect.height || this.canvas.height;
    return { left: 58, top: 12, width: Math.max(1, width - 58 - 14), height: Math.max(1, height - 12 - 34) };
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

  draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
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
        const t = i + 0.5;
        if (t < this.view0 - step || t > this.view1 + step) continue;
        const x = this.xFor(t);
        const y = yFor(row[i]!);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // 버스트 마커 (플롯 하단 살짝 위)
    for (const name of this.series.names) {
      if (this.hidden.has(name)) continue;
      ctx.fillStyle = this.series.colors[name]!;
      for (const cast of this.series.bursts[name] ?? []) {
        if (cast.t < this.view0 || cast.t > this.view1) continue;
        const x = this.xFor(cast.t);
        const y = top + height - 2;
        ctx.beginPath();
        ctx.moveTo(x - 3, y);
        ctx.lineTo(x, y - 5);
        ctx.lineTo(x + 3, y);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();

    // 호버 크로스헤어 + 포인트
    if (this.hoverIndex !== null) {
      const t = this.hoverIndex + 0.5;
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
      `<div class="tl-tip-time">${index}–${index + 1}초</div>${lines}` +
      `<div class="tl-tip-total"><span>합계</span><span>${formatDamage(total)}</span></div>`;
    const host = this.canvas.parentElement!.getBoundingClientRect();
    let px = clientX - host.left + 14;
    if (px + 180 > host.width) px = clientX - host.left - 194;
    this.tooltip.style.left = `${Math.max(4, px)}px`;
    this.tooltip.style.top = `${Math.max(4, clientY - host.top + 12)}px`;
    this.tooltip.style.display = 'block';
  }

  private bindEvents(): void {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.lastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      const rect = canvas.getBoundingClientRect();
      if (this.dragging) {
        const dx = event.clientX - this.lastX;
        this.lastX = event.clientX;
        const dt = (dx / this.plot.width) * (this.view1 - this.view0);
        this.setView(this.view0 - dt, this.view1 - dt);
        return;
      }
      const t = this.tFor(event.clientX - rect.left);
      const index = Math.round(t - 0.5);
      this.hoverIndex = index >= 0 && index < this.series.buckets ? index : null;
      this.draw();
      this.showTooltip(event.clientX, event.clientY);
    });
    const end = (event: PointerEvent) => {
      this.dragging = false;
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* noop */ }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => {
      this.hoverIndex = null;
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
export function createTimelineBlock(entry: DeckResultEntry): HTMLElement | null {
  const timeline = entry.result.timeline;
  if (!timeline) return null;
  const squad = entry.request.squad.filter(Boolean);
  const series = buildSeries(timeline, squad, entry.result.duration);
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
  note.textContent = '드래그 이동 · 휠/버튼 확대·축소 · 세로 밴드 = 풀버스트 · 삼각형 = 버스트 사용 · 마우스를 올리면 초별 수치';
  block.append(note);

  const chart = new TimelineChart(canvas, tooltip, series);
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
