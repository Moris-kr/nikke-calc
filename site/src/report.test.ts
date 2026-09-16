// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  conditionChips, copyImage, loadPortraits, renderReport, reportFilename, reportRows,
  type ReportMeta,
} from './report';
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
  siteUrl: 'moris-kr.github.io/nikke-calc',
};

const batchOf = (decks: DeckResultEntry[]): BatchResult => ({
  total: decks.reduce((sum, deck) => sum + deck.result.squadTotal, 0),
  decks,
});

describe('report image', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('keeps the temporary character warning in exported images', () => {
    const drawn: string[] = [];
    const ctx = new Proxy({ measureText: () => ({ width: 30 }),
      fillText: (value: string) => drawn.push(value) },
      { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
    const createCanvas = () => ({ width: 0, height: 0, getContext: () => ctx }) as unknown as HTMLCanvasElement;
    const deck = entry(1, ['신 : 스위프트 바니'], 1000);
    deck.result.previewNote = '[임시 · 창작] 신 : 스위프트 바니';
    renderReport(batchOf([deck]), meta, new Map(), createCanvas);
    expect(drawn.some(s => s.includes('[임시 · 창작]'))).toBe(true);
  });

  it('1덱과 5덱은 같은 크기로 내보내고 1덱 초상화를 크게 그린다', () => {
    const portraitsDrawn: number[] = [];
    const ctx = new Proxy({ measureText: () => ({ width: 30 }),
      drawImage: (...args: number[]) => { portraitsDrawn.push(args[7]!); } },
      { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
    const createCanvas = () => ({ width: 0, height: 0, getContext: () => ctx }) as unknown as HTMLCanvasElement;
    const squad = ['리타', '크라운', '라피 : 레드 후드', '앨리스', '나가'];
    const portraits = new Map(squad.map(name => [name, { naturalWidth: 100, naturalHeight: 100 } as HTMLImageElement]));
    const single = renderReport(batchOf([entry(1, squad, 1000)]), meta, portraits, createCanvas);
    const largePortrait = Math.max(...portraitsDrawn);
    portraitsDrawn.length = 0;
    const five = renderReport(batchOf([1, 2, 3, 4, 5].map(id => entry(id, squad, 1000))), meta, portraits, createCanvas);
    expect([single.width, single.height]).toEqual([five.width, five.height]);
    expect([single.width, single.height]).toEqual([2400, 884]);
    expect(largePortrait).toBeGreaterThanOrEqual(80);
    expect(largePortrait).toBeGreaterThan(Math.max(...portraitsDrawn));
  });

  it.each([6, 10, 11, 17])('wraps %i decks after five columns and keeps every deck inside the canvas', (count) => {
    const labels: { value: string; x: number; y: number }[][] = [];
    const createCanvas = () => {
      const drawn: typeof labels[number] = [];
      labels.push(drawn);
      const ctx = new Proxy({
        measureText: () => ({ width: 30 }),
        fillText: (value: string, x: number, y: number) => drawn.push({ value, x, y }),
      }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
      return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    };
    const decks = Array.from({ length: count }, (_, index) => entry(index + 1, ['slot-a', 'slot-b', 'slot-c', 'slot-d', 'slot-e'], 1000));
    const canvas = renderReport(batchOf(decks), meta, new Map(), createCanvas);
    const headings = labels[1]!.filter(({ value }) => /^덱 \d+$/.test(value));
    expect(canvas.width).toBe(2400);
    expect(headings).toHaveLength(count);
    expect(new Set(headings.map(({ x }) => x)).size).toBe(5);
    expect(new Set(headings.map(({ y }) => y)).size).toBe(Math.ceil(count / 5));
    expect(headings[5]!.x).toBe(headings[0]!.x);
    expect(headings[5]!.y).toBeGreaterThan(headings[0]!.y + 160);
    for (const { x, y } of labels[1]!) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(canvas.width / 2);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(canvas.height / 2);
    }
  });

  it('keeps the squad slot order instead of ranking by damage', () => {
    // 니케는 배치 순서가 전투에 영향을 준다. 딜 순으로 재정렬하면 보고서가 실제
    // 편성과 다른 그림이 되므로, 좌→우 편성을 위→아래로 그대로 옮겨야 한다.
    const squad = ['리타', '크라운', '라피 : 레드 후드', '앨리스', '나가'];
    const deck: DeckResultEntry = {
      deckId: 1,
      request: request(squad),
      result: result(1000, { 리타: 100, 크라운: 200, '라피 : 레드 후드': 500, 앨리스: 150, 나가: 50 }),
    };

    expect(reportRows(deck, new Map()).map((row) => row.name)).toEqual(squad);
  });

  it('drops empty slots from the report', () => {
    const deck: DeckResultEntry = {
      deckId: 1,
      request: request(['리타', '', '크라운', '', '']),
      result: result(300, { 리타: 100, 크라운: 200 }),
    };

    expect(reportRows(deck, new Map()).map((row) => row.name)).toEqual(['리타', '크라운']);
  });

  it('조건은 화면이 아니라 그 판을 잰 요청에서 읽는다', () => {
    // 조건을 바꿔 놓고 다시 계산하지 않은 채 보고서를 뽑으면, 대미지는 옛것인데
    // 조건만 새것으로 찍혀 나갔다 (피드백 2026-09-10). 이제 둘 다 요청에서 온다.
    const measured: DeckResultEntry = {
      deckId: 1,
      request: {
        ...request(['리타']), enemyCode: '작열', corePx: 52, hasParts: true, seed: 7,
      },
      result: result(1000, { 리타: 1000 }),
    };

    expect(conditionChips(measured)).toEqual([
      '30초 전투', '방어력 31,784', '작열 코드', '코어 52px', '파괴 가능 파츠', '시드 7',
    ]);
    // 코어를 끈 판은 끈 대로 적힌다 — 요청에 0이면 「코어 없음」이다.
    expect(conditionChips(entry(1, ['리타'], 100))).toContain('코어 없음');
  });

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
