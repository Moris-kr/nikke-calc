import { describe, expect, it } from 'vitest';

import {
  ANNOUNCEMENTS, COUNTDOWNS, announcementToShow, countdownClock, countdownDone, countdownToShow,
} from './announcement';
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

describe('초읽기', () => {
  it('남은 시간을 hh:mm:ss로 적는다', () => {
    expect(countdownClock(0)).toBe('00:00:00');
    expect(countdownClock(1_000)).toBe('00:00:01');
    expect(countdownClock(61_000)).toBe('00:01:01');
    expect(countdownClock(3_600_000)).toBe('01:00:00');
  });

  it('시는 넘겨 세지 않는다 — 사흘이 71시간으로 나온다', () => {
    // 「2일 23시간」보다 「71:59:59」가 급한 정도를 한눈에 준다.
    expect(countdownClock(71 * 3_600_000 + 59 * 60_000 + 59_000)).toBe('71:59:59');
  });

  it('지난 시각은 00:00:00에서 멈춘다 — 음수 시계는 읽는 사람을 헷갈리게 한다', () => {
    expect(countdownClock(-1)).toBe('00:00:00');
    expect(countdownClock(-999_999)).toBe('00:00:00');
    expect(countdownClock(Number.NaN)).toBe('00:00:00');
    expect(countdownDone(-1)).toBe(true);
    expect(countdownDone(Number.NaN)).toBe(true);
    expect(countdownDone(1)).toBe(false);
  });

  it('목표 시각은 시간대를 못 박는다 — 보는 사람이 어디 있든 같은 순간이다', () => {
    for (const entry of COUNTDOWNS) {
      const at = Date.parse(entry.target);
      expect(Number.isFinite(at), entry.target).toBe(true);
      // 시간대 표기가 없으면 브라우저의 지역 시간으로 읽혀 나라마다 다른 순간이 된다.
      expect(entry.target, entry.target).toMatch(/(Z|[+-]\d{2}:\d{2})$/);
    }
  });

  it('칠무해 석방은 한국 시간 9월 9일 18시 30분이다', () => {
    expect(countdownToShow()!.target).toBe('2026-09-09T18:30:00+09:00');
    expect(Date.parse(countdownToShow()!.target)).toBe(Date.parse('2026-09-09T09:30:00Z'));
  });

  it('셈할 것이 없으면 아무것도 안 띄운다 — 시계를 걷는 길이 있다', () => {
    const kept = COUNTDOWNS.splice(0, COUNTDOWNS.length);
    try {
      expect(countdownToShow()).toBeNull();
    } finally {
      COUNTDOWNS.push(...kept);
    }
  });

  it('시계 앞에 적을 말이 각 나라 말로 있다', () => {
    for (const entry of COUNTDOWNS) {
      for (const [name, dict] of [['en', EN], ['ja', JA], ['zh-TW', ZH_TW]] as const) {
        expect(dict[entry.label], `${name}: ${entry.label}`).toBeTruthy();
      }
    }
  });
});
