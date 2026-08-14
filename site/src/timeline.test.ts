// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

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
});
