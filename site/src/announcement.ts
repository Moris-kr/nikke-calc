// 커뮤니티 안내 띠.
//
// 업데이트 공지(`notices.ts`)와 **다른 것**이다. 그쪽은 «이 계산기가 무엇이 달라졌나»를
// 적는 자리라 갈래가 새 기능·개선·고침 셋뿐이고, 화면도 한국어로만 나온다. 여기 붙는 것은
// 계산기 밖에서 벌어지는 일 — 서명·모집·공지 같은 것이라 갈래가 맞지 않고, 한국어만
// 읽히면 뜻이 없다.
//
// 그래서 따로 둔다: **머리에 한 줄로 늘 보이고**, 닫으면 그 사람에게만 안 보이고,
// 사전을 지나 각 나라 말로 나온다.
//
// 안내가 끝나면 `ANNOUNCEMENTS`를 빈 배열로 두면 된다 — 띠가 통째로 사라진다.

export interface Announcement {
  /** 닫은 것을 적어 두는 열쇠. **새 안내면 반드시 새 id** — 같으면 예전에 닫은 사람에게 안 뜬다. */
  id: string;
  /** 한국어 정본. 이 문장이 그대로 사전의 열쇠가 된다(`i18n.ts` §열쇠를 따로 짓지 않은 이유). */
  text: string;
  /** 링크에 적히는 글. 이것도 사전 열쇠다. */
  linkLabel: string;
  href: string;
}

/** 지금 띄울 안내. 하나만 띄운다 — 머리에 두 줄이 쌓이면 둘 다 안 읽힌다. */
export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: '2026-09-05-gov-statement',
    text: '니케 마이너 갤러리에서 경쟁 콘텐츠 공정성 회복을 위한 이용자 공동성명을 모집중입니다. 많은 참여 부탁드립니다.',
    linkLabel: '성명 보러 가기 →',
    href: 'https://gall.dcinside.com/mgallery/board/view/?id=gov&no=6116829&exception_mode=recommend&page=1',
  },
];

/** 닫은 id를 적어 두는 자리. 브라우저마다 따로 기억한다. */
export const ANNOUNCEMENT_KEY = 'nikke-announcement-seen';

/**
 * 띄울 안내. 닫아 둔 것과 id가 같으면 null.
 *
 * 업데이트 공지와 달리 **닫을 때까지 올 때마다 보인다** — 한 번 스쳐 지나가면 그만인
 * 안내가 아니라 기한이 있는 일이라, 지나쳤다고 다시 못 보게 되면 곤란하다.
 */
export function announcementToShow(dismissed: string | null): Announcement | null {
  const first = ANNOUNCEMENTS[0];
  if (!first) return null;
  return dismissed === first.id ? null : first;
}
