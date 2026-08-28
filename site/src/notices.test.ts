// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { LATEST_NOTICE_ID, NOTICES, noticeFragment, noticeToShow } from './notices';

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

  it('강조 표시를 글자가 아니라 태그로 세운다', () => {
    // 예전에는 textContent로만 넣어 «<b>기본은…</b>»이 글자 그대로 보였다.
    const holder = document.createElement('p');
    holder.append(noticeFragment('<b>기본은 이 덱만</b>입니다 · <code>atk_dmg_pct</code> 대신'));
    expect(holder.querySelector('b')!.textContent).toBe('기본은 이 덱만');
    expect(holder.querySelector('code')!.textContent).toBe('atk_dmg_pct');
    expect(holder.textContent).toBe('기본은 이 덱만입니다 · atk_dmg_pct 대신');
  });

  it('허용하지 않은 태그는 글자 그대로 남긴다', () => {
    const holder = document.createElement('p');
    holder.append(noticeFragment('<img src=x onerror=y> 그리고 <i>기울임</i>'));
    expect(holder.querySelector('img')).toBeNull();
    expect(holder.querySelector('i')).toBeNull();
    expect(holder.textContent).toBe('<img src=x onerror=y> 그리고 <i>기울임</i>');
  });

  it('공지 문구에는 아는 표시만 쓴다', () => {
    // 새 태그를 쓰고 싶으면 noticeFragment의 목록부터 늘려야 한다 — 안 그러면 글자로 샌다.
    for (const notice of NOTICES) {
      for (const item of notice.items) {
        const unknown = [...item.text.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g)]
          .map((match) => match[1]!.toLowerCase())
          .filter((tag) => tag !== 'b' && tag !== 'code');
        expect(unknown, `${notice.id}: ${item.text.slice(0, 40)}`).toEqual([]);
      }
    }
  });
});
