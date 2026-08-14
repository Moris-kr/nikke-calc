import { formatDamage } from './model';
import type { BattleTimeline, DeckResultEntry } from './types';

const LANE_COLORS = ['#45d6d0', '#ffbf3c', '#9b8cff', '#5fd08a', '#ff7db0'];

const W = 720;
const L = 108;
const R = 16;
const AXIS_H = 20;
const LANE_H = 34;
const LANE_GAP = 6;
const AREA_H = 22;
const PLOT_W = W - L - R;

const escapeText = (value: string): string =>
  value.replace(/[<>&"]/g, (char) => (
    char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '&' ? '&amp;' : '&quot;'
  ));

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * 캐릭터별 초당 대미지를 작은 배수(small multiples) SVG로 그린다.
 * 각 레인의 세로 높이는 그 캐릭터 자신의 최고 초당 대미지로 정규화해 모양(발사·스톨·버스트
 * 스파이크)이 드러나게 한다. 절대 크기는 위쪽 캐릭터별 기여 행이 이미 보여준다.
 */
export function buildTimelineSvg(
  timeline: BattleTimeline,
  squad: string[],
  duration: number,
): string {
  const names = squad.filter((name) => timeline.damage[name]);
  if (names.length === 0 || timeline.buckets <= 0 || duration <= 0) return '';

  const x = (t: number): number => L + Math.max(0, Math.min(1, t / duration)) * PLOT_W;
  const height = AXIS_H + names.length * LANE_H + (names.length - 1) * LANE_GAP + 6;
  const lanesTop = AXIS_H;
  const lanesBottom = height - 6;

  const parts: string[] = [];
  parts.push(
    `<svg viewBox="0 0 ${W} ${height}" width="100%" role="img" preserveAspectRatio="xMidYMid meet" ` +
    `aria-label="캐릭터별 초당 대미지 타임라인. 세로선은 풀버스트 구간, 삼각형은 버스트 사용 시점.">`,
  );

  for (const [start, end] of timeline.fullBurst) {
    const bx = x(start);
    const bw = Math.max(1, x(end) - bx);
    parts.push(
      `<rect x="${round1(bx)}" y="${lanesTop}" width="${round1(bw)}" height="${lanesBottom - lanesTop}" ` +
      `fill="rgba(255,191,60,0.09)"><title>풀버스트 ${round1(start)}~${round1(end)}s</title></rect>`,
    );
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  for (const frac of ticks) {
    const t = frac * duration;
    const gx = x(t);
    parts.push(
      `<line x1="${round1(gx)}" y1="${lanesTop}" x2="${round1(gx)}" y2="${lanesBottom}" ` +
      `stroke="rgba(146,176,201,0.12)" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${round1(gx)}" y="13" fill="#8394a6" font-size="10" ` +
      `text-anchor="${frac === 0 ? 'start' : frac === 1 ? 'end' : 'middle'}">${Math.round(t)}s</text>`,
    );
  }

  names.forEach((name, lane) => {
    const color = LANE_COLORS[lane % LANE_COLORS.length];
    const laneTop = AXIS_H + lane * (LANE_H + LANE_GAP);
    const base = laneTop + LANE_H - 6;
    const values = timeline.damage[name] ?? [];
    const peak = values.reduce((max, value) => Math.max(max, value), 0);
    const total = values.reduce((sum, value) => sum + value, 0);

    parts.push(
      `<text x="6" y="${round1(laneTop + LANE_H / 2)}" fill="#eaf2f8" font-size="11" ` +
      `dominant-baseline="middle">${escapeText(name)}</text>`,
    );
    parts.push(
      `<line x1="${L}" y1="${base}" x2="${L + PLOT_W}" y2="${base}" ` +
      `stroke="rgba(146,176,201,0.14)" stroke-width="1"/>`,
    );

    if (peak > 0) {
      const y = (value: number): number => base - (value / peak) * AREA_H;
      const path: string[] = [`M ${round1(x(0))} ${base}`];
      values.forEach((value, index) => {
        path.push(`L ${round1(x(index))} ${round1(y(value))}`);
        path.push(`L ${round1(x(index + 1))} ${round1(y(value))}`);
      });
      path.push(`L ${round1(x(values.length))} ${base} Z`);
      parts.push(
        `<path d="${path.join(' ')}" fill="${color}" fill-opacity="0.24" stroke="${color}" ` +
        `stroke-width="1.25" stroke-linejoin="round"><title>${escapeText(name)} · 총 ${formatDamage(total)}</title></path>`,
      );
    }

    for (const cast of timeline.bursts[name] ?? []) {
      const mx = x(cast.t);
      parts.push(
        `<path d="M ${round1(mx - 3.5)} ${base + 6} L ${round1(mx)} ${base} L ${round1(mx + 3.5)} ${base + 6} Z" ` +
        `fill="${color}"><title>${round1(cast.t)}s · ${cast.stage || '?'}버스트</title></path>`,
      );
    }
  });

  parts.push('</svg>');
  return parts.join('');
}

/** 덱 결과에 붙일 타임라인 블록을 만든다. 타임라인이 없으면 null. */
export function createTimelineBlock(entry: DeckResultEntry): HTMLElement | null {
  const timeline = entry.result.timeline;
  if (!timeline) return null;
  const squad = entry.request.squad.filter(Boolean);
  const svg = buildTimelineSvg(timeline, squad, entry.result.duration);
  if (!svg) return null;

  const block = document.createElement('div');
  block.className = 'timeline-block';
  block.dataset.timeline = String(entry.deckId);

  const heading = document.createElement('p');
  heading.className = 'timeline-heading';
  heading.textContent = '전투 타임라인 · 초당 대미지';
  block.append(heading);

  const figure = document.createElement('div');
  figure.className = 'timeline-figure';
  figure.innerHTML = svg;
  block.append(figure);

  const legend = document.createElement('p');
  legend.className = 'timeline-legend';
  legend.textContent = '세로 밴드 = 풀버스트 구간 · 삼각형 = 버스트 사용 · 세로 높이는 캐릭터별 최고치로 정규화';
  block.append(legend);

  return block;
}
