// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyImage, loadPortraits, renderReport, reportFilename, type ReportMeta } from './report';
import type { BatchResult, DeckResultEntry, SimulationRequest, SimulationResult } from './types';

const request = (squad: string[]): SimulationRequest => ({
  squad,
  characters: {},
  duration: 30,
  enemyDef: 31_784,
  enemyCode: '',
  corePx: 0,
  hasParts: false,
  seed: 42,
});

const result = (squadTotal: number, charTotals: Record<string, number>): SimulationResult => ({
  squadTotal,
  duration: 30,
  hitCount: 4359,
  charTotals,
  previewNote: '',
  deviations: '기본 스펙(1층) 그대로',
});

const entry = (deckId: number, squad: string[], total: number): DeckResultEntry => ({
  deckId,
  request: request(squad),
  result: result(total, Object.fromEntries(squad.map((name, index) => [name, total / (index + 2)]))),
});

const meta: ReportMeta = {
  enemyDef: 31_784,
  enemyCode: '',
  corePx: 0,
  hasParts: false,
  siteUrl: 'moris-kr.github.io/nikke-calc',
};

const batchOf = (decks: DeckResultEntry[]): BatchResult => ({
  total: decks.reduce((sum, deck) => sum + deck.result.squadTotal, 0),
  decks,
});

describe('report image', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('names the file by deck count so saved reports stay distinguishable', () => {
    const single = batchOf([entry(1, ['리타'], 100)]);
    const five = batchOf([1, 2, 3, 4, 5].map((id) => entry(id, ['리타'], 100)));

    expect(reportFilename(single)).toMatch(/^nikke-squad-\d{8}-\d{4}\.png$/);
    expect(reportFilename(five)).toMatch(/^nikke-5deck-\d{8}-\d{4}\.png$/);
  });

  it('reports a readable error when the browser has no 2D canvas', () => {
    // jsdom은 getContext가 null이다 — 캔버스를 못 쓰는 브라우저와 같은 상황.
    const batch = batchOf([entry(1, ['리타', '크라운'], 1000)]);
    expect(() => renderReport(batch, meta, new Map()))
      .toThrowError('캔버스를 사용할 수 없는 브라우저입니다.');
  });

  it('gives up on portraits that never load so the report still renders', async () => {
    // jsdom은 이미지를 실제로 받지 않아 onload/onerror가 영영 오지 않는다 —
    // 느리거나 죽은 이미지와 같은 상황이다. 상한이 없으면 보고서가 영영 안 나온다.
    vi.useFakeTimers();
    const catalog = new Map([['리타', { name: '리타', image: 'characters/1.webp' } as never]]);
    const pending = loadPortraits(['리타'], catalog, '/base/', 50);
    await vi.advanceTimersByTimeAsync(60);
    await expect(pending).resolves.toEqual(new Map());
    vi.useRealTimers();
  });

  it('separates an unsupported browser from a blocked copy', async () => {
    // Firefox처럼 ClipboardItem이 아예 없는 브라우저 → 저장 말고는 길이 없다.
    vi.stubGlobal('ClipboardItem', undefined);
    await expect(copyImage(new Blob())).resolves.toBe('unsupported');
  });

  it('calls a rejected write blocked, not unsupported', async () => {
    // 지원은 하는데 그 순간 거부된 경우(창 포커스 없음·권한 거부) — 다시 누르면 된다.
    vi.stubGlobal('ClipboardItem', class { constructor(_items: unknown) {} });
    vi.stubGlobal('navigator', { clipboard: { write: () => Promise.reject(new Error('not focused')) } });
    await expect(copyImage(new Blob())).resolves.toBe('blocked');
  });

  it('reports success when the clipboard accepts the image', async () => {
    const write = vi.fn(() => Promise.resolve());
    vi.stubGlobal('ClipboardItem', class { constructor(_items: unknown) {} });
    vi.stubGlobal('navigator', { clipboard: { write } });

    await expect(copyImage(new Blob())).resolves.toBe('copied');
    expect(write).toHaveBeenCalledTimes(1);
  });
});
