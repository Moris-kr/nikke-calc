// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { buildSeries, createTimelineBlock, niceMax } from './timeline';
import type { BattleTimeline, DeckResultEntry } from './types';

const timeline: BattleTimeline = {
  bucket: 1,
  buckets: 4,
  damage: {
    라피: [0, 100, 200, 50],
    크라운: [0, 0, 0, 0],
  },
  bursts: {
    라피: [{ t: 1.5, stage: '1' }],
    크라운: [],
  },
  fullBurst: [[1, 3]],
};

const entry: DeckResultEntry = {
  deckId: 1,
  request: {
    squad: ['라피', '크라운'],
    duration: 4,
    enemyDef: 0,
    enemyCode: '',
    corePx: 0,
    hasParts: false,
    seed: 42,
  },
  result: {
    squadTotal: 350,
    duration: 4,
    hitCount: 4,
    charTotals: { 라피: 350, 크라운: 0 },
    previewNote: '',
    deviations: '',
    timeline,
  },
};

function clippingCanvas(): {
  context: CanvasRenderingContext2D;
  portraitCircles: Array<{ x: number; y: number; radius: number }>;
  visibleText: string[];
} {
  type ClipRect = { left: number; top: number; right: number; bottom: number };
  const portraitCircles: Array<{ x: number; y: number; radius: number }> = [];
  const visibleText: string[] = [];
  const stack: Array<ClipRect | null> = [];
  let clipRect: ClipRect | null = null;
  let pathRect: ClipRect | null = null;
  let pathArc: { x: number; y: number; radius: number } | null = null;
  const noop = () => undefined;
  const context = {
    arc: (x: number, y: number, radius: number) => {
      pathArc = { x, y, radius };
    },
    beginPath: () => { pathRect = null; pathArc = null; },
    clearRect: noop,
    clip: () => {
      if (!pathRect) return;
      clipRect = clipRect ? {
        left: Math.max(clipRect.left, pathRect.left),
        top: Math.max(clipRect.top, pathRect.top),
        right: Math.min(clipRect.right, pathRect.right),
        bottom: Math.min(clipRect.bottom, pathRect.bottom),
      } : { ...pathRect };
    },
    closePath: noop,
    drawImage: noop,
    fill: noop,
    fillRect: noop,
    fillText: (text: string, x: number, y: number) => {
      if (!clipRect || (
        x >= clipRect.left && x <= clipRect.right &&
        y >= clipRect.top && y <= clipRect.bottom
      )) visibleText.push(text);
    },
    lineTo: noop,
    moveTo: noop,
    rect: (x: number, y: number, width: number, height: number) => {
      pathRect = { left: x, top: y, right: x + width, bottom: y + height };
    },
    restore: () => { clipRect = stack.pop() ?? null; },
    save: () => { stack.push(clipRect ? { ...clipRect } : null); },
    setTransform: noop,
    stroke: () => { if (pathArc) portraitCircles.push(pathArc); },
  } as unknown as CanvasRenderingContext2D;
  return { context, portraitCircles, visibleText };
}

function renderOnClippingCanvas(target: DeckResultEntry) {
  vi.useFakeTimers();
  const surface = clippingCanvas();
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(surface.context);
  const getBoundingClientRect = vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 380,
      width: 800, height: 380, toJSON: () => ({}),
    });

  try {
    createTimelineBlock(target);
    vi.runAllTimers();
    return surface;
  } finally {
    getBoundingClientRect.mockRestore();
    getContext.mockRestore();
    vi.useRealTimers();
  }
}

describe('buildSeries', () => {
  it('collects per-character totals, colors, and the shared peak', () => {
    const series = buildSeries(timeline, ['라피', '크라운'], 4);
    expect(series).not.toBeNull();
    expect(series?.names).toEqual(['라피', '크라운']);
    expect(series?.totals).toEqual({ 라피: 350, 크라운: 0 });
    expect(series?.peak).toBe(200);
    expect(series?.colors['라피']).not.toEqual(series?.colors['크라운']);
  });

  it('returns null when there are no buckets or no matching members', () => {
    expect(buildSeries({ ...timeline, buckets: 0 }, ['라피'], 4)).toBeNull();
    expect(buildSeries(timeline, ['없는캐릭'], 4)).toBeNull();
  });
});

describe('niceMax', () => {
  it('rounds a peak up to a clean axis maximum', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(200)).toBe(200);
    expect(niceMax(230)).toBe(250);
    expect(niceMax(1_800_000)).toBe(2_000_000);
  });
});

describe('createTimelineBlock', () => {
  it('builds an interactive block with canvas, zoom controls, and legend', () => {
    const block = createTimelineBlock(entry);
    expect(block).not.toBeNull();
    expect(block?.querySelector('canvas.timeline-canvas')).not.toBeNull();
    expect(block?.querySelectorAll('.timeline-btn').length).toBe(3);
    expect(block?.querySelectorAll('.timeline-legend-item').length).toBe(2);
    expect(block?.querySelector('.timeline-heading')?.textContent).toContain('초당 대미지');
  });

  it('toggles a series off when its legend item is clicked', () => {
    const block = createTimelineBlock(entry)!;
    const item = block.querySelector<HTMLButtonElement>('.timeline-legend-item')!;
    expect(item.classList.contains('is-off')).toBe(false);
    item.click();
    expect(item.classList.contains('is-off')).toBe(true);
  });

  it('returns null when the result has no timeline', () => {
    const noTimeline: DeckResultEntry = {
      ...entry,
      result: { ...entry.result, timeline: undefined },
    };
    expect(createTimelineBlock(noTimeline)).toBeNull();
  });

  it('renders the burst portrait fallback and stage in the lane below the plot', () => {
    const { visibleText } = renderOnClippingCanvas(entry);
    expect(visibleText).toContain('라');
    expect(visibleText).toContain('1');
  });

  it('keeps three simultaneous burst portraits at least four pixels apart', () => {
    const crowded: DeckResultEntry = {
      ...entry,
      request: { ...entry.request, squad: ['라피', '크라운', '앨리스'] },
      result: {
        ...entry.result,
        charTotals: { 라피: 350, 크라운: 0, 앨리스: 0 },
        timeline: {
          ...timeline,
          damage: {
            ...timeline.damage,
            앨리스: [0, 0, 0, 0],
          },
          bursts: {
            라피: [{ t: 1.5, stage: '1' }],
            크라운: [{ t: 1.5, stage: '2' }],
            앨리스: [{ t: 1.5, stage: '3' }],
          },
        },
      },
    };

    const { portraitCircles } = renderOnClippingCanvas(crowded);

    expect(portraitCircles).toHaveLength(3);
    for (let i = 0; i < portraitCircles.length; i += 1) {
      for (let j = i + 1; j < portraitCircles.length; j += 1) {
        const a = portraitCircles[i]!;
        const b = portraitCircles[j]!;
        const edgeGap = Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius;
        expect(edgeGap).toBeGreaterThanOrEqual(4);
      }
    }
  });
});


describe('보스 페이즈 밴드', () => {
  it('족자·속저 구간을 시리즈에 싣는다', () => {
    const series = buildSeries({
      bucket: 1, buckets: 3,
      damage: { 리타: [1, 2, 3] },
      bursts: { 리타: [{ t: 1.5, stage: '1' }] },
      fullBurst: [[1, 2]] as [number, number][],
    }, ['리타'], 3, {
      immuneWindows: [{ from: 0, to: 1 }],
      elementWindows: [{ from: 2, to: 3, code: '풍압' }],
    })!;
    expect(series.immuneWindows).toEqual([{ from: 0, to: 1 }]);
    expect(series.elementWindows).toEqual([{ from: 2, to: 3, code: '풍압' }]);
  });

  it('구간을 안 주면 빈 배열이다 — 옛 결과에도 안전하다', () => {
    const series = buildSeries({
      bucket: 1, buckets: 2, damage: { 리타: [1, 2] },
      bursts: {}, fullBurst: [],
    }, ['리타'], 2)!;
    expect(series.immuneWindows).toEqual([]);
    expect(series.elementWindows).toEqual([]);
  });
});
