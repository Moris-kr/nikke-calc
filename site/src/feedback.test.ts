import { describe, expect, it } from 'vitest';

import {
  countByStatus, doingPrompt, feedbackDate, feedbackFileName, sortFeedback,
} from './feedback';
import type { FeedbackItem, FeedbackStatus } from './share-server';

const item = (id: string, status: FeedbackStatus, at: string, text = '내용'): FeedbackItem => ({
  id, status, at, text, kind: 'bug', by: '', movedAt: '',
});

describe('피드백', () => {
  it('상태 차례로 세우고, 같은 상태에서는 새 글이 위다', () => {
    const sorted = sortFeedback([
      item('a', 'done', '2026-09-01T00:00:00.000Z'),
      item('b', 'new', '2026-08-30T00:00:00.000Z'),
      item('c', 'doing', '2026-09-02T00:00:00.000Z'),
      item('d', 'new', '2026-09-02T00:00:00.000Z'),
      item('e', 'wont', '2026-09-03T00:00:00.000Z'),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(['d', 'b', 'c', 'a', 'e']);
  });

  it('상태별 개수를 센다', () => {
    const counts = countByStatus([
      item('a', 'new', '2026-09-01T00:00:00.000Z'),
      item('b', 'new', '2026-09-01T00:00:00.000Z'),
      item('c', 'doing', '2026-09-01T00:00:00.000Z'),
    ]);
    expect(counts).toEqual({ new: 2, doing: 1, done: 0, wont: 0 });
  });

  it('날짜는 하루 단위로만 적는다', () => {
    expect(feedbackDate('2026-09-02T11:22:33.000Z')).toBe('2026-09-02');
    expect(feedbackDate('')).toBe('');
  });

  it('진행중만 모아 AI에게 넘길 글로 만든다', () => {
    const text = doingPrompt([
      item('a', 'doing', '2026-09-01T00:00:00.000Z', '덱 이름이 안 바뀝니다'),
      item('b', 'new', '2026-09-02T00:00:00.000Z', '이건 아직 접수만 됐다'),
      { ...item('c', 'doing', '2026-09-02T00:00:00.000Z', '여러 줄로\n적은 글'), kind: 'idea', by: '아무개' },
    ], new Date('2026-09-03T00:00:00.000Z'));

    expect(text).toContain('진행중 피드백 2건 (2026-09-03)');
    // 접수만 된 글은 들어가지 않는다 — 「진행중」만 내려받는 단추다.
    expect(text).not.toContain('아직 접수만');
    expect(text).toContain('## 1. [건의] 2026-09-02 · 아무개');
    expect(text).toContain('## 2. [버그] 2026-09-01');
    // 여러 줄로 쓴 글은 줄 그대로 실린다.
    expect(text).toContain('여러 줄로\n적은 글');
  });

  it('진행중이 없으면 없다고 적는다', () => {
    const text = doingPrompt([item('a', 'new', '2026-09-01T00:00:00.000Z')]);
    expect(text).toContain('진행중 피드백 0건');
    expect(text).toContain('(진행중으로 옮긴 항목이 없다.)');
  });

  it('파일 이름에 날짜를 붙인다', () => {
    expect(feedbackFileName(new Date(2026, 8, 2))).toBe('니케계산기_진행중_20260902.txt');
  });
});
