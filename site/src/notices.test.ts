import { describe, expect, it } from 'vitest';

import { LATEST_NOTICE_ID, NOTICES, noticeToShow } from './notices';

describe('업데이트 공지', () => {
  it('본 적 없는 최신 공지만 띄운다', () => {
    // 처음 온 사람에게는 띄운다 — 무엇을 하는 곳인지 먼저 알린다.
    expect(noticeToShow(null)?.id).toBe(LATEST_NOTICE_ID);
    // 최신을 이미 봤으면 띄우지 않는다.
    expect(noticeToShow(LATEST_NOTICE_ID)).toBeNull();
    // 옛 공지까지만 본 사람에게는 다시 띄운다.
    expect(noticeToShow('2026-01-01')?.id).toBe(LATEST_NOTICE_ID);
  });

  it('최신이 맨 앞이고 날짜가 내림차순이다', () => {
    const dates = NOTICES.map((notice) => notice.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(NOTICES[0]!.id).toBe(LATEST_NOTICE_ID);
  });

  it('모든 항목에 갈래와 내용이 있다', () => {
    for (const notice of NOTICES) {
      expect(notice.items.length).toBeGreaterThan(0);
      for (const item of notice.items) {
        expect(['새 기능', '개선', '고침']).toContain(item.tag);
        expect(item.text.length).toBeGreaterThan(10);
      }
    }
  });
});
