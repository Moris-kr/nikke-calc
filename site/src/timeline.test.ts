// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { buildTimelineSvg, createTimelineBlock } from './timeline';
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

describe('buildTimelineSvg', () => {
  it('draws a lane label and burst marker for each squad member', () => {
    const svg = buildTimelineSvg(timeline, ['라피', '크라운'], 4);
    expect(svg).toContain('<svg');
    expect(svg).toContain('라피');
    expect(svg).toContain('크라운');
    // 풀버스트 밴드 1개
    expect(svg).toContain('풀버스트 1~3s');
    // 라피는 대미지가 있어 area path가 그려지고, 버스트 마커 title이 붙는다
    expect(svg).toContain('1.5s · 1버스트');
    // 크라운은 전 구간 0이라 area 없이 baseline만
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty string when there are no buckets', () => {
    expect(buildTimelineSvg({ ...timeline, buckets: 0 }, ['라피'], 4)).toBe('');
  });

  it('ignores squad names without timeline damage data', () => {
    const svg = buildTimelineSvg(timeline, ['없는캐릭'], 4);
    expect(svg).toBe('');
  });
});

describe('createTimelineBlock', () => {
  it('builds a timeline block element from a deck result', () => {
    const block = createTimelineBlock(entry);
    expect(block).not.toBeNull();
    expect(block?.querySelector('svg')).not.toBeNull();
    expect(block?.querySelector('.timeline-heading')?.textContent).toContain('초당 대미지');
  });

  it('returns null when the result has no timeline', () => {
    const noTimeline: DeckResultEntry = {
      ...entry,
      result: { ...entry.result, timeline: undefined },
    };
    expect(createTimelineBlock(noTimeline)).toBeNull();
  });
});
