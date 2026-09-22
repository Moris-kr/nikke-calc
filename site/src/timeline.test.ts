// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { buildDeckComparisonSeries, createTimelineComparison, buildSeries, createTimelineBlock, formatSpan, niceMax, buffRuns, buffTextPlan } from './timeline';
import { spanTargets } from './types';
import type { BattleTimeline, BuffTrack, DeckResultEntry } from './types';

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
    const block = createTimelineBlock(target)!;
    vi.runAllTimers();
    return { ...surface, block };
  } finally {
    getBoundingClientRect.mockRestore();
    getContext.mockRestore();
    vi.useRealTimers();
  }
}

describe('버프 막대', () => {
  it('좁아지면 이름부터 접고 중첩 수를 남긴다', () => {
    // 스택형은 오른쪽 끝을 중첩 수에 내준다 — 이름보다 그쪽이 우선이다.
    const wide = buffTextPlan(160, true);
    expect(wide.stack).toBe(true);
    expect(wide.nameRoom).toBeGreaterThan(100);

    const narrow = buffTextPlan(24, true);
    expect(narrow.stack).toBe(true);        // 중첩 수는 끝까지 남는다
    expect(narrow.nameRoom).toBeLessThan(6); // 이름은 들어갈 자리가 없다

    // 스택형이 아니면 그 자리를 이름이 다 쓴다.
    expect(buffTextPlan(24, false).nameRoom).toBeGreaterThan(buffTextPlan(24, true).nameRoom);
  });

  it('붙어 있는 칸은 한 막대로 묶고, 끊긴 자리에서만 나눈다', () => {
    // 중첩이 잘게 오르내리는 버프를 칸마다 네모로 그리면 줄이 바코드가 된다.
    const part = (x0: number, x1: number, stack: number) =>
      ({ x0, x1, stack, span: [x0, x1, stack] as [number, number, number] });
    const runs = buffRuns([part(10, 20, 1), part(20, 30, 2), part(30, 40, 3), part(80, 90, 1)]);
    expect(runs).toHaveLength(2);
    expect([runs[0]!.x0, runs[0]!.x1]).toEqual([10, 40]);
    expect(runs[0]!.parts.map((p) => p.stack)).toEqual([1, 2, 3]);  // 눈금 자리는 그대로 남는다
    expect([runs[1]!.x0, runs[1]!.x1]).toEqual([80, 90]);
  });

  it('구간마다 대상이 갈리면 그 구간의 사람만 센다', () => {
    // 리버렐리오 「차분한 수심 4」는 발동마다 대상이 바뀐다 — 줄 전체의 목록을
    // 그대로 쓰면 «둘 다 받는다»로 읽힌다.
    const track = {
      name: '차분한 수심 4', caster: '리버렐리오', targets: ['아인', '에이다'],
      maxStack: 1, spans: [[3.4, 13.4, 1, [0]], [15.9, 25.9, 1, [1]]],
    } as unknown as BuffTrack;
    expect(spanTargets(track, track.spans[0]!)).toEqual(['아인']);
    expect(spanTargets(track, track.spans[1]!)).toEqual(['에이다']);
  });

  it('구간에 대상이 적혀 있지 않으면 줄 전체가 답이다', () => {
    const track = {
      name: '더블 부스트', caster: '리타', targets: ['리타', '크라운'],
      maxStack: 1, spans: [[0, 5, 1]],
    } as unknown as BuffTrack;
    expect(spanTargets(track, track.spans[0]!)).toEqual(['리타', '크라운']);
  });

  it('빈 줄에서는 막대를 만들지 않는다', () => {
    expect(buffRuns([])).toEqual([]);
  });

  const withBuffs = (buffs: Array<Record<string, unknown>>) => buildSeries(
    {
      bucket: 1, buckets: 3,
      damage: { 리타: [1, 2, 3], 크라운: [1, 1, 1] },
      bursts: { 리타: [], 크라운: [] }, fullBurst: [],
      buffs: buffs as never,
    } as never,
    ['리타', '크라운'], 3,
  );

  it('덱에 없는 사람이 건 버프는 뺀다 — 색을 줄 수 없다', () => {
    const series = withBuffs([
      { name: '있는버프', caster: '리타', targets: ['리타'], maxStack: 1, spans: [[0, 2, 1]] },
      { name: '없는사람', caster: '앨리스', targets: ['리타'], maxStack: 1, spans: [[0, 2, 1]] },
    ])!;
    expect(series.buffs.map((track) => track.name)).toEqual(['있는버프']);
  });

  it('한 줄에 여러 구간이 들어오고, 구간마다 중첩이 따로 적힌다', () => {
    const series = withBuffs([
      { name: '스택버프', caster: '크라운', targets: ['크라운', '리타'], maxStack: 20,
        spans: [[0, 1, 1], [1, 2, 2], [2, 3, 3]] },
    ])!;
    expect(series.buffs).toHaveLength(1);
    expect(series.buffs[0]!.spans.map((span) => span[2])).toEqual([1, 2, 3]);
    expect(series.buffs[0]!.targets).toEqual(['크라운', '리타']);
  });

  it('옛 결과(버프 목록이 없는 것)도 그대로 읽는다', () => {
    const series = buildSeries(
      { bucket: 1, buckets: 2, damage: { 리타: [1, 2] }, bursts: { 리타: [] }, fullBurst: [] } as never,
      ['리타'], 2,
    )!;
    expect(series.buffs).toEqual([]);
  });
});


describe('buildSeries', () => {
  it('collects per-character totals, colors, and the shared peak', () => {
    const series = buildSeries(timeline, ['라피', '크라운'], 4);
    expect(series).not.toBeNull();
    expect(series?.names).toEqual(['라피', '크라운']);
    expect(series?.totals).toEqual({ 라피: 350, 크라운: 0 });
    expect(series?.peak).toBe(200);
    expect(series?.colors['라피']).not.toEqual(series?.colors['크라운']);
  });

  it('carries the bucket size, and falls back to one second for older results', () => {
    // 화면이 «몇 번째 칸이 몇 초인지»를 이 값으로 환산한다.
    expect(buildSeries({ ...timeline, bucket: 0.1 }, ['라피'], 4)?.bucket).toBe(0.1);
    // 이 값이 없던 시절에 저장된 결과는 1초 버킷이었다.
    expect(buildSeries({ ...timeline, bucket: 0 }, ['라피'], 4)?.bucket).toBe(1);
  });

  it('writes the hovered span from the bucket size', () => {
    // 1초 버킷은 정수로, 0.1초 버킷은 소수 한 자리로 적는다.
    expect(formatSpan(12, 1)).toBe('12–13초');
    expect(formatSpan(123, 0.1)).toBe('12.3–12.4초');
    expect(formatSpan(0, 0.25)).toBe('0.00–0.25초');
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
    expect(block?.querySelector('[aria-label="확대"]')).not.toBeNull();
    expect(block?.querySelector('[aria-label="축소"]')).not.toBeNull();
    expect(block?.querySelector('[aria-label="전체 보기"]')).not.toBeNull();
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

describe('장탄 레인', () => {
  // 엔진은 이미 「그때 탄이 몇 발이었나」를 세고 있었다(`result.states`) — 화면만 없었다.
  const entryWith = (states: unknown): DeckResultEntry => ({
    deckId: 1,
    request: { squad: ['리타'], duration: 10 } as DeckResultEntry['request'],
    result: {
      squadTotal: 100, duration: 10, hitCount: 1, charTotals: { 리타: 100 },
      previewNote: '', deviations: '',
      timeline: {
        bucket: 1, buckets: 10, damage: { 리타: Array.from({ length: 10 }, () => 10) },
        bursts: {}, fullBurst: [],
      },
      ...(states ? { states } : {}),
    } as DeckResultEntry['result'],
  });

  it('기록이 없으면 「장탄 표시」 단추를 아예 안 낸다', () => {
    const block = createTimelineBlock(entryWith(null));
    expect(block).not.toBeNull();
    expect(block!.querySelector('[data-timeline-ammo]')).toBeNull();
  });

  it('기록이 있으면 단추가 서고, 눌러야 켜진다', () => {
    const block = createTimelineBlock(entryWith({
      bucket: 1, buckets: 10,
      chars: { 리타: { ammo: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], reload: [[9, 10]], maxAmmo: 9 } },
    }))!;
    const toggle = block.querySelector<HTMLButtonElement>('[data-timeline-ammo]')!;
    expect(toggle).not.toBeNull();
    // 기본은 꺼짐 — 켜 두면 줄이 다섯 늘어 무엇을 보는 화면인지 흐려진다.
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    toggle.click();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.classList.contains('is-on')).toBe(true);
  });
});


describe('타임라인 Y축', () => {
  it('자동 조절을 끄면 지정 상한을 유지하고 잘못된 값은 무시한다', () => {
    const view = renderOnClippingCanvas(entry);
    try {
      const toggle = view.block.querySelector<HTMLButtonElement>('[data-timeline-auto-y]')!;
      expect(toggle).not.toBeNull();
      const input = view.block.querySelector<HTMLInputElement>('[data-timeline-y-max]')!;
      expect(input.disabled).toBe(true);
      toggle.click();
      input.value = '1000';
      input.dispatchEvent(new Event('change'));
      expect(view.visibleText).toContain('1,000');
      input.value = '0';
      input.dispatchEvent(new Event('change'));
      expect(input.value).toBe('1000');
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
    } finally { vi.restoreAllMocks(); }
  });
});

describe('deck timeline comparison', () => {
  it('adds squad damage on a common time axis and keeps deck identities', () => {
    const second: DeckResultEntry = { ...entry, deckId: 3, result: { ...entry.result, duration: 2,
      timeline: { bucket: 0.5, buckets: 4, damage: { 라피: [10, 20, 30, 40], 크라운: [1, 2, 3, 4] }, bursts: {}, fullBurst: [] } } };
    const series = buildDeckComparisonSeries([entry, second])!;
    expect(series.names).toEqual(['덱 1', '덱 3']);
    expect(series.bucket).toBe(1);
    expect(series.damage['덱 1']).toEqual([0, 100, 200, 50]);
    expect(series.damage['덱 3']).toEqual([33, 77, 0, 0]);
    expect(series.totals['덱 3']).toBe(110);
    expect(series.duration).toBe(4);
    expect(series.fullBurst).toEqual([]);
  });

  it('preserves damage across overlapping bins and a partial final interval', () => {
    const second: DeckResultEntry = { ...entry, deckId: 2, result: { ...entry.result, duration: 1.3,
      timeline: { bucket: 0.6, buckets: 3, damage: { 라피: [60, 60, 10] }, bursts: {}, fullBurst: [] } } };
    const series = buildDeckComparisonSeries([entry, second])!;
    expect(series.damage['덱 2']![0]).toBeCloseTo(100);
    expect(series.damage['덱 2']![1]).toBeCloseTo(30);
    expect(series.totals['덱 2']).toBeCloseTo(130);
  });

  it('assigns distinct comparison colors after the fifth deck', () => {
    const series = buildDeckComparisonSeries(Array.from({ length: 8 }, (_, index) => ({ ...entry, deckId: index + 1 })))!;
    expect(new Set(Object.values(series.colors)).size).toBe(8);
  });

  it('requires two decks with usable timelines', () => {
    expect(createTimelineComparison([entry])).toBeNull();
    expect(createTimelineComparison([entry, { ...entry, deckId: 2, result: { ...entry.result, timeline: undefined } }])).toBeNull();
  });

  it('offers deck toggles, shared Y controls and zoom without character-only controls', () => {
    const block = createTimelineComparison([entry, { ...entry, deckId: 2 }])!;
    expect(block.dataset.timelineComparison).toBe('');
    expect(block.querySelector('.timeline-heading')?.textContent).toContain('덱끼리 견주기');
    const toggle = block.querySelector<HTMLButtonElement>('[data-series="덱 2"]')!;
    toggle.click();
    expect(toggle.classList.contains('is-off')).toBe(true);
    expect(block.querySelector('[data-timeline-y-max]')).not.toBeNull();
    expect(block.querySelector('[data-timeline-buffs]')).toBeNull();
    expect(block.querySelector('[data-timeline-ammo]')).toBeNull();
  });
});


it('preserves defense rate bands without requiring an exposed core', () => {
  const defenseRateWindows = [{ from: 0, to: 2, rate: 60 }, { from: 1, to: 3, rate: 75 }];
  expect(buildSeries(timeline, ['라피'], 4, { defenseRateWindows })?.defenseRateWindows).toEqual(defenseRateWindows);
  expect(buildSeries(timeline, ['라피'], 4)?.defenseRateWindows).toEqual([]);
});

describe('버스트 게이지', () => {
  const base = { bucket: 1, buckets: 3, damage: { a: [1, 2, 3] }, bursts: {}, fullBurst: [] as [number, number][] };
  it('칸 수가 맞을 때만 시리즈에 싣는다 — 옛 결과(없음)와 다른 버킷은 null', () => {
    expect(buildSeries({ ...base, gauge: [10, 55, 100] }, ['a'], 3)!.gauge).toEqual([10, 55, 100]);
    expect(buildSeries(base, ['a'], 3)!.gauge).toBeNull();
    expect(buildSeries({ ...base, gauge: [10, 55] }, ['a'], 3)!.gauge).toBeNull();
  });

  it('점열 [t, %]는 프레임 단위 그대로 싣고, 모양이 어긋나면 통째로 버린다', () => {
    const points: Array<[number, number]> = [[0.017, 0.2], [1.5, 60], [2.433, 100], [2.45, 0]];
    const series = buildSeries({ ...base, gaugePoints: points }, ['a'], 3)!;
    expect(series.gaugePoints).toEqual(points);
    // 칸 배열이 없어도 점열만으로 그린다.
    expect(series.gauge).toBeNull();
    expect(buildSeries(base, ['a'], 3)!.gaugePoints).toBeNull();
    expect(buildSeries({ ...base, gaugePoints: [] }, ['a'], 3)!.gaugePoints).toBeNull();
    expect(buildSeries({ ...base, gaugePoints: [[1, 2], [3]] as unknown as Array<[number, number]> }, ['a'], 3)!.gaugePoints).toBeNull();
  });

  it('점열을 켜면 만충(100) 자리에 점을 찍고, 바로 다음 점(소모 0)으로 뚝 떨어진다', () => {
    // 기록용 캔버스 — 점선 구간의 lineTo와 채운 원(arc→fill)만 모은다.
    const lines: Array<[number, number]> = [];
    const dots: Array<[number, number, number]> = [];
    let dashed = false;
    let pendingArc: [number, number, number] | null = null;
    const noop = () => undefined;
    const context = new Proxy({} as Record<string, unknown>, {
      get: (_target, key: string) => {
        if (key === 'setLineDash') return (seg: number[]) => { dashed = seg.length > 0; };
        if (key === 'lineTo') return (x: number, y: number) => { if (dashed) lines.push([x, y]); };
        if (key === 'arc') return (x: number, y: number, r: number) => { pendingArc = [x, y, r]; };
        if (key === 'fill') return () => { if (pendingArc) { dots.push(pendingArc); pendingArc = null; } };
        if (key === 'beginPath') return () => { pendingArc = null; };
        if (key === 'measureText') return () => ({ width: 10 });
        return noop;
      },
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    vi.useFakeTimers();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const rect = vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 380, width: 800, height: 380, toJSON: () => ({}),
    });
    try {
      const points: Array<[number, number]> = [[0.5, 30], [1.2, 100], [1.217, 0], [3, 40]];
      const withPoints = { ...entry, result: { ...entry.result, timeline: { ...entry.result.timeline!, gaugePoints: points } } } as DeckResultEntry;
      const block = createTimelineBlock(withPoints)!;
      vi.runAllTimers();
      // 버스트 핀의 얼굴 원(반지름 6)은 게이지와 무관하다 — 만충 점은 반지름 2.6이다.
      const fullDots = () => dots.filter(([, , r]) => Math.abs(r - 2.6) < 1e-6);
      expect(fullDots()).toEqual([]);
      block.querySelector<HTMLButtonElement>('[data-timeline-gauge]')!.click();
      vi.runAllTimers();
      // 만충 점 하나 — 1.2초 자리.
      expect(fullDots().length).toBe(1);
      const [dotX, dotY] = fullDots()[0]!;
      // 점선은 네 점을 차례로 잇고, 만충(100) 바로 다음이 소모(0)라 x는 거의 같고 y만 바닥으로 간다.
      const full = lines.findIndex(([x, y]) => Math.abs(x - dotX) < 1e-6 && Math.abs(y - dotY) < 1e-6);
      expect(full).toBeGreaterThanOrEqual(0);
      const [nextX, nextY] = lines[full + 1]!;
      expect(nextX - dotX).toBeGreaterThan(0);
      expect(nextX - dotX).toBeLessThan(5);
      expect(nextY).toBeGreaterThan(dotY + 50);
      // 100%의 y가 30%·40%보다 위(작은 값)에 있다.
      for (const [, y] of lines) expect(y).toBeGreaterThanOrEqual(dotY - 1e-6);
    } finally {
      vi.useRealTimers();
      getContext.mockRestore();
      rect.mockRestore();
    }
  });

  it('점열만 있어도 「버충 표시」 토글이 선다', () => {
    const withPoints = { ...entry, result: { ...entry.result, timeline: { ...entry.result.timeline!, gaugePoints: [[0.5, 30], [1.2, 100], [1.22, 0]] } } } as DeckResultEntry;
    const block = createTimelineBlock(withPoints)!;
    const toggle = block.querySelector<HTMLButtonElement>('[data-timeline-gauge]')!;
    expect(toggle).not.toBeNull();
    toggle.click();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('게이지가 있으면 「버충 표시」 토글이 서고, 누르면 켜진다', () => {
    const withGauge = { ...entry, result: { ...entry.result, timeline: { ...entry.result.timeline!, gauge: entry.result.timeline!.damage[Object.keys(entry.result.timeline!.damage)[0]!]!.map((_, i) => Math.min(100, i * 10)) } } } as DeckResultEntry;
    const block = createTimelineBlock(withGauge)!;
    const toggle = block.querySelector<HTMLButtonElement>('[data-timeline-gauge]')!;
    expect(toggle).not.toBeNull();
    toggle.click();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(createTimelineBlock(entry)!.querySelector('[data-timeline-gauge]')).toBeNull();
  });
});
