// 다른 사람이 만든 니케 도구들로 나가는 고리.
//
// **여기 적힌 곳은 우리가 운영하지 않는다.** 주소도 내용도 저쪽 사정으로 언제든 바뀌므로,
// 링크를 계산기 화면 곳곳에 흩뿌리지 않고 이 표 하나에 모아 둔다 — 고칠 곳이 한 군데다.
//
// 새 고리를 들일 때는 이 배열에 한 줄만 더하면 된다. `label`은 사람들이 실제로 부르는
// 이름을 그대로 쓴다(«렛츠도로»를 «Let's Doro»로 옮겨 적으면 아무도 못 알아본다).

export interface ExternalLink {
  /** 사람들이 부르는 이름. 화면에 그대로 나온다. */
  label: string;
  /** 무엇을 하는 곳인지 한 줄. 들어가 보기 전에 판단할 수 있어야 한다. */
  note: string;
  url: string;
}

export const EXTERNAL_LINKS: ExternalLink[] = [
  {
    label: '렛츠도로',
    note: '니케 마이너 갤러리 유저 대상 협동전 및 종합관리 시스템',
    url: 'https://letsdoro.com/',
  },
  {
    label: '딜도로',
    note: '또 다른 계산기 사이트',
    url: 'https://dildoro.com/',
  },
  {
    label: '솔레 금서고',
    note: '솔레 기록 보관소',
    url: 'https://soloraidhistory.vercel.app/',
  },
  {
    label: '도로파티',
    note: '유레 관제 보조 사이트',
    url: 'https://doroparty.com/',
  },
];

/** 주소에서 사람이 알아보는 부분만. 카드에 «letsdoro.com»으로 적어 어디로 가는지 보인다. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
