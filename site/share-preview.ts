// dev 전용 미리보기. 실제 `share-panel` 모듈을 가짜 서버에 물려 눈으로 확인한다.
// 빌드 대상이 아니다(vite는 index.html만 빌드한다).
import { mountSharePanel } from './src/share-panel';
import type { ShareItem, ShareServer } from './src/share-server';

const items: ShareItem[] = [
  { id: 'a1', name: '솔로레이드 인디비리아 3페', auto: '90초 · 적 수냉 · 코어 60px · 난수', by: '모리스', at: '2026-08-23T00:00:00.000Z', up: 42, down: 3, code: 'NK3-aaa' },
  { id: 'a2', name: '유니온 레이드 표준 60초', auto: '60초 · 무속성 · 코어 없음 · 기대값', by: '', at: '2026-08-25T09:00:00.000Z', up: 18, down: 1, code: 'NK3-bbb' },
  { id: 'a3', name: '심층전 12번 방', auto: '150초 · 적 작열 · 코어 52px · 족자 2 · 속저 1 · 난수', by: '니케초보', at: '2026-08-26T01:30:00.000Z', up: 7, down: 0, code: 'NK3-ccc' },
  { id: 'a4', name: '캠페인 하드 32-15', auto: '180초 · 적 전격 · 코어 없음 · 파츠 · 난수', by: '', at: '2026-08-12T00:00:00.000Z', up: 4, down: 9, code: 'NK3-ddd' },
];

const mine: Record<string, 1 | -1> = { a2: 1 };
const wait = <T>(value: T) => new Promise<T>((resolve) => { setTimeout(() => resolve(value), 350); });

const fakeServer = {
  async list() { return wait({ items: structuredClone(items), mine: { ...mine } }); },
  async vote(_kind: string, id: string, value: 1 | -1 | 0) {
    const found = items.find((item) => item.id === id)!;
    return wait({ id, up: found.up + (value === 1 ? 1 : 0), down: found.down + (value === -1 ? 1 : 0), mine: value });
  },
  async upload(input: { name: string }) {
    return wait({ item: { ...items[0]!, id: 'new', name: input.name, up: 0, down: 0 }, existed: false });
  },
} as unknown as ShareServer;

const pick = <T extends HTMLElement>(selector: string): T =>
  document.querySelector<T>(selector)!;

const message = pick<HTMLElement>('[data-boss-msg]');

mountSharePanel(
  {
    tabs: pick('[data-boss-tabs]'),
    upload: pick('[data-boss-pane="upload"]'),
    list: pick('[data-boss-pane="list"]'),
    code: pick('[data-boss-pane="code"]'),
  },
  {
    kind: 'boss',
    server: fakeServer,
    current: () => ({ code: 'NK3-mine', auto: '180초 · 무속성 · 코어 없음 · 난수' }),
    apply: (item) => {
      message.hidden = false;
      message.className = 'custom-msg is-ok';
      message.textContent = `«${item.name}»을(를) 적용했습니다.`;
    },
    notify: (text, ok = false) => {
      message.hidden = false;
      message.className = ok ? 'custom-msg is-ok' : 'custom-msg';
      message.textContent = text;
    },
  },
).open();
