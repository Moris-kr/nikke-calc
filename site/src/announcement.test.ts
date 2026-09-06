import { describe, expect, it } from 'vitest';

import { ANNOUNCEMENTS, announcementToShow } from './announcement';
import { EN } from './locale/en';
import { JA } from './locale/ja';
import { ZH_TW } from './locale/zh-tw';

describe('커뮤니티 안내 띠', () => {
  it('닫기 전에는 올 때마다 보이고, 닫으면 안 보인다', () => {
    const first = ANNOUNCEMENTS[0]!;
    expect(announcementToShow(null)?.id).toBe(first.id);
    expect(announcementToShow('옛-안내')?.id).toBe(first.id);
    expect(announcementToShow(first.id)).toBeNull();
  });

  it('안내가 없으면 아무것도 안 띄운다 — 띠를 걷는 길이 있다', () => {
    // `ANNOUNCEMENTS`를 비우는 것이 안내를 내리는 방법이다. 그때 터지면 안 된다.
    const kept = ANNOUNCEMENTS.splice(0, ANNOUNCEMENTS.length);
    try {
      expect(announcementToShow(null)).toBeNull();
    } finally {
      ANNOUNCEMENTS.push(...kept);
    }
  });

  it('링크는 https다 — 머리에 붙는 줄이라 더 조심한다', () => {
    for (const notice of ANNOUNCEMENTS) {
      expect(notice.href.startsWith('https://')).toBe(true);
    }
  });

  it('각 나라 말이 다 있다', () => {
    // 계산기 밖의 일을 알리는 자리라 한국어만 읽히면 뜻이 없다. 업데이트 공지와
    // 갈라 둔 까닭이 이것이므로, 사전이 비면 시험이 막는다.
    for (const notice of ANNOUNCEMENTS) {
      for (const [name, dict] of [['en', EN], ['ja', JA], ['zh-TW', ZH_TW]] as const) {
        expect(dict[notice.text], `${name}: ${notice.id} 본문`).toBeTruthy();
        expect(dict[notice.linkLabel], `${name}: ${notice.id} 링크`).toBeTruthy();
      }
    }
  });
});
