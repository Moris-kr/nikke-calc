import { describe, expect, it } from 'vitest';

import { csvCell, csvFileName, csvText, damageCsv, perSecondRows, totalRows } from './export-csv';
import type { BattleTimeline, SimulationResult } from './types';

const timeline = (bucket: number): BattleTimeline => ({
  bucket, buckets: 3, duration: 3,
  damage: { 리타: [10, 20, 30], 크라운: [1, 2, 3] },
  bursts: { 리타: [], 크라운: [] },
  fullBurst: [],
} as unknown as BattleTimeline);

const result = (extra: Partial<SimulationResult> = {}): SimulationResult => ({
  squadTotal: 66, duration: 3, hitCount: 6,
  charTotals: { 리타: 60, 크라운: 6 },
  charBreakdown: {
    리타: { normal: 40, normalHits: 4, skill: 20, skillHits: 1, skills: [] },
    크라운: { normal: 6, normalHits: 2, skill: 0, skillHits: 0, skills: [] },
  },
  previewNote: '', deviations: '', timeline: timeline(1), ...extra,
});

describe('정밀 수치 내보내기', () => {
  it('쉼표와 따옴표가 든 칸만 감싼다', () => {
    expect(csvCell('리타')).toBe('리타');
    expect(csvCell(1234)).toBe('1234');
    expect(csvCell('라피 : 레드 후드, 3돌')).toBe('"라피 : 레드 후드, 3돌"');
    expect(csvCell('그는 "톡톡이"라 불렀다')).toBe('"그는 ""톡톡이""라 불렀다"');
  });

  it('줄 끝은 CRLF다', () => {
    expect(csvText([['a', 'b'], [1, 2]])).toBe('a,b\r\n1,2');
  });

  it('구간마다 합계와 누적을 함께 적는다', () => {
    const rows = perSecondRows(timeline(1), ['리타', '크라운']);
    expect(rows[0]).toEqual(['시작(초)', '끝(초)', '리타', '크라운', '합계', '누적']);
    expect(rows[1]).toEqual(['0', '1', 10, 1, 11, 11]);
    expect(rows[2]).toEqual(['1', '2', 20, 2, 22, 33]);
    expect(rows[3]).toEqual(['2', '3', 30, 3, 33, 66]);
  });

  it('잘게 쪼갠 결과는 구간 표기도 잘게 적는다', () => {
    // 칸 크기는 결과가 들고 온다 — 0.1초 결과가 와도 같은 함수가 그린다.
    const rows = perSecondRows(timeline(0.1), ['리타']);
    expect(rows[1]!.slice(0, 2)).toEqual(['0.0', '0.1']);
    expect(rows[3]!.slice(0, 2)).toEqual(['0.2', '0.3']);
  });

  it('없는 캐릭터 칸은 0으로 채운다', () => {
    // 편성에는 있는데 한 발도 못 쏜 사람이 있으면 열이 어긋나면 안 된다.
    const rows = perSecondRows(timeline(1), ['리타', '없는사람']);
    expect(rows[1]).toEqual(['0', '1', 10, 0, 10, 10]);
  });

  it('최종 표에 지분과 스쿼드 합계를 담는다', () => {
    const rows = totalRows(result(), ['리타', '크라운']);
    expect(rows[1]).toEqual(['리타', 60, 40, 4, 20, 1, '90.91']);
    expect(rows[3]).toEqual(['스쿼드 합계', 66, '', '', '', '', '100.00']);
  });

  it('옛 결과(나눔 없음)도 열을 비운 채 내보낸다', () => {
    const rows = totalRows(result({ charBreakdown: undefined }), ['리타']);
    expect(rows[1]).toEqual(['리타', 60, '', '', '', '', '90.91']);
  });

  it('한 장에 최종과 구간을 잇는다', () => {
    const text = damageCsv(result(), ['리타', '크라운'], '3돌 · 싱크로 400');
    expect(text).toContain('조건,3돌 · 싱크로 400');
    expect(text).toContain('캐릭터,총 대미지');
    expect(text).toContain('구간별 대미지 (1초 단위)');
    // 숫자는 줄이지 않고 1의 자리까지 그대로 적는다.
    expect(text).toContain('스쿼드 합계,66');
  });

  it('타임라인이 없는 결과도 최종만으로 내보낸다', () => {
    const text = damageCsv(result({ timeline: undefined }), ['리타']);
    expect(text).toContain('캐릭터,총 대미지');
    expect(text).not.toContain('구간별 대미지');
  });

  it('파일 이름에서 못 쓰는 글자를 턴다', () => {
    expect(csvFileName('덱 1', new Date(2026, 7, 31))).toBe('니케계산기_덱 1_20260831.csv');
    expect(csvFileName('a/b:c*', new Date(2026, 11, 5))).toBe('니케계산기_abc_20261205.csv');
    expect(csvFileName('   ', new Date(2026, 0, 9))).toBe('니케계산기_계산_20260109.csv');
  });
});
