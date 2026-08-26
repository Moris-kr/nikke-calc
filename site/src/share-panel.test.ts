// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { agoText, mountSharePanel, rankItems, squadPreview } from './share-panel';
import type { ShareItem, ShareListResult, ShareVoteResult } from './share-server';
import type { ShareServer } from './share-server';

const item = (over: Partial<ShareItem> = {}): ShareItem => ({
  id: 'a1', name: '솔레 3페', auto: '90초 · 적 수냉', by: '', at: '2026-08-20T00:00:00.000Z',
  up: 0, down: 0, uses: 0, code: 'NK3-aaa', ...over,
});

/** 서버 대역. 무엇을 물어봤는지 그대로 들고 있는다. */
class FakeServer {
  listCalls = 0;

  votes: Array<{ id: string; value: number }> = [];

  uploads: Array<Record<string, string>> = [];

  reply: ShareListResult = { items: [item()], mine: {}, applied: {} };

  failList: string | null = null;

  async list(): Promise<ShareListResult> {
    this.listCalls += 1;
    if (this.failList) throw new Error(this.failList);
    return structuredClone(this.reply);
  }

  async vote(_kind: string, id: string, value: number): Promise<ShareVoteResult> {
    this.votes.push({ id, value });
    const found = this.reply.items.find((entry) => entry.id === id)!;
    const up = found.up + (value === 1 ? 1 : 0);
    const down = found.down + (value === -1 ? 1 : 0);
    return { id, up, down, mine: value as 1 | -1 | 0 };
  }

  async upload(input: Record<string, string>): Promise<{ item: ShareItem; existed: boolean }> {
    this.uploads.push(input);
    return { item: item({ name: input.name! }), existed: false };
  }

  applies: string[] = [];

  async apply(_kind: string, id: string): Promise<{ id: string; uses: number; counted: boolean }> {
    this.applies.push(id);
    const found = this.reply.items.find((entry) => entry.id === id)!;
    return { id, uses: (found.uses ?? 0) + 1, counted: true };
  }
}

function mount(server: FakeServer, over: Partial<Parameters<typeof mountSharePanel>[1]> = {}) {
  const host = document.createElement('div');
  host.innerHTML = `<div data-tabs></div><div data-upload hidden></div>
    <div data-list hidden></div><div data-code>코드 자리</div>`;
  document.body.append(host);
  const applied: string[] = [];
  const messages: Array<{ text: string; ok: boolean }> = [];
  const panel = mountSharePanel(
    {
      tabs: host.querySelector('[data-tabs]')!,
      upload: host.querySelector('[data-upload]')!,
      list: host.querySelector('[data-list]')!,
      code: host.querySelector('[data-code]')!,
    },
    {
      kind: 'boss',
      server: server as unknown as ShareServer,
      current: () => ({ code: 'NK3-mine', auto: '180초 · 무속성' }),
      apply: (picked) => { applied.push(picked.code); },
      notify: (text, ok = false) => { messages.push({ text, ok }); },
      ...over,
    },
  );
  return { host, panel, applied, messages };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const tab = (host: HTMLElement, key: string) =>
  host.querySelector<HTMLButtonElement>(`[data-share-tab="${key}"]`)!;

describe('share panel', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('does not touch the server until the modal opens', async () => {
    const server = new FakeServer();
    const { host, panel } = mount(server);
    expect(server.listCalls).toBe(0);

    panel.open();
    await flush();
    expect(server.listCalls).toBe(1);
    expect(host.querySelectorAll('[data-share-item]')).toHaveLength(1);

    // 다시 열어도 이미 받아 둔 목록을 쓴다.
    panel.open();
    await flush();
    expect(server.listCalls).toBe(1);
  });

  it('shows the code blocks untouched under their own tab', async () => {
    const { host, panel } = mount(new FakeServer());
    panel.open();
    await flush();
    const code = host.querySelector<HTMLElement>('[data-code]')!;
    expect(code.hidden).toBe(true);
    tab(host, 'code').click();
    expect(code.hidden).toBe(false);
    expect(code.textContent).toBe('코드 자리');
  });

  it('votes once per item, cancelling on a second press and swapping sides', async () => {
    const server = new FakeServer();
    server.reply = { items: [item({ up: 5, down: 1 })], mine: {}, applied: {} };
    const { host, panel } = mount(server);
    panel.open();
    await flush();

    const up = () => host.querySelector<HTMLButtonElement>('[data-vote="a1:1"]')!;
    const down = () => host.querySelector<HTMLButtonElement>('[data-vote="a1:-1"]')!;
    expect(up().textContent).toContain('5');

    up().click();
    // 서버를 기다리지 않고 먼저 눌린 티를 낸다.
    expect(up().textContent).toContain('6');
    expect(up().getAttribute('aria-pressed')).toBe('true');
    await flush();
    expect(server.votes.at(-1)).toEqual({ id: 'a1', value: 1 });

    // 같은 걸 다시 누르면 취소다.
    up().click();
    expect(up().textContent).toContain('5');
    await flush();
    expect(server.votes.at(-1)).toEqual({ id: 'a1', value: 0 });

    // 반대쪽을 누르면 갈아탄다 — 위가 줄고 아래가 는다.
    up().click();
    await flush();
    down().click();
    expect(down().textContent).toContain('2');
    await flush();
    expect(server.votes.at(-1)).toEqual({ id: 'a1', value: -1 });
  });

  it('puts the count back when the server refuses the vote', async () => {
    const server = new FakeServer();
    server.reply = { items: [item({ up: 5 })], mine: {}, applied: {} };
    server.vote = async () => { throw new Error('너무 자주 눌렀습니다.'); };
    const { host, panel, messages } = mount(server);
    panel.open();
    await flush();

    host.querySelector<HTMLButtonElement>('[data-vote="a1:1"]')!.click();
    await flush();
    expect(host.querySelector('[data-vote="a1:1"]')!.textContent).toContain('5');
    expect(messages.at(-1)!.text).toBe('너무 자주 눌렀습니다.');
  });

  it('marks what this browser already voted for', async () => {
    const server = new FakeServer();
    server.reply = { items: [item({ up: 3 })], mine: { a1: 1 }, applied: {} };
    const { host, panel } = mount(server);
    panel.open();
    await flush();
    expect(host.querySelector('[data-vote="a1:1"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[data-vote="a1:-1"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('applies the picked code', async () => {
    const server = new FakeServer();
    const { host, panel, applied } = mount(server);
    panel.open();
    await flush();
    host.querySelector<HTMLButtonElement>('[data-share-apply="a1"]')!.click();
    expect(applied).toEqual(['NK3-aaa']);
  });

  it('counts an apply once per browser and shows it in the row', async () => {
    const server = new FakeServer();
    server.reply = { items: [item({ uses: 4 })], mine: {}, applied: {} };
    const { host, panel } = mount(server);
    panel.open();
    await flush();
    expect(host.querySelector('[data-share-item]')!.textContent).toContain('적용 4');

    host.querySelector<HTMLButtonElement>('[data-share-apply="a1"]')!.click();
    // 서버를 기다리지 않고 먼저 올린다.
    expect(host.querySelector('[data-share-item]')!.textContent).toContain('적용 5');
    await flush();
    expect(server.applies).toEqual(['a1']);

    // 같은 브라우저가 또 적용해도 숫자는 그대로다.
    host.querySelector<HTMLButtonElement>('[data-share-apply="a1"]')!.click();
    await flush();
    expect(host.querySelector('[data-share-item]')!.textContent).toContain('적용 5');
  });

  it('does not count an apply that failed, and stays quiet when only counting fails', async () => {
    const server = new FakeServer();
    server.reply = { items: [item({ uses: 2 })], mine: {}, applied: {} };
    const { host, panel, messages } = mount(server, {
      apply: () => { throw new Error('코드를 해석하지 못했습니다.'); },
    });
    panel.open();
    await flush();
    host.querySelector<HTMLButtonElement>('[data-share-apply="a1"]')!.click();
    await flush();
    // 못 얹었으면 «쓰인 것»이 아니다.
    expect(server.applies).toEqual([]);
    expect(messages.at(-1)!.text).toBe('코드를 해석하지 못했습니다.');

    // 반대로 적용은 됐는데 세는 데만 실패하면 숫자만 되돌리고 조용히 넘어간다.
    const quiet = new FakeServer();
    quiet.reply = { items: [item({ uses: 2 })], mine: {}, applied: {} };
    quiet.apply = async () => { throw new Error('서버가 응답하지 않았습니다.'); };
    const second = mount(quiet);
    second.panel.open();
    await flush();
    const before = second.messages.length;
    second.host.querySelector<HTMLButtonElement>('[data-share-apply="a1"]')!.click();
    await flush();
    expect(second.host.querySelector('[data-share-item]')!.textContent).toContain('적용 2');
    expect(second.messages.length).toBe(before);
  });

  it('does not count again for an item this browser already applied', async () => {
    const server = new FakeServer();
    server.reply = { items: [item({ uses: 7 })], mine: {}, applied: { a1: 1 } };
    const { host, panel } = mount(server);
    panel.open();
    await flush();
    host.querySelector<HTMLButtonElement>('[data-share-apply="a1"]')!.click();
    await flush();
    // 서버에는 알리되(집계는 서버가 판단한다) 화면 숫자를 미리 올리지는 않는다.
    expect(host.querySelector('[data-share-item]')!.textContent).toContain('적용 8');
    expect(server.applies).toEqual(['a1']);
  });

  it('filters the list by name, uploader, or description', async () => {
    const server = new FakeServer();
    server.reply = {
      items: [
        item({ id: 'a1', name: '솔레 3페', by: '모리스', auto: '90초 · 적 수냉' }),
        item({ id: 'a2', name: '유니온 레이드', by: '', auto: '60초 · 무속성' }),
        item({ id: 'a3', name: '심층전', by: '니케초보', auto: '150초 · 적 작열' }),
      ],
      mine: {},
      applied: {},
    };
    const { host, panel } = mount(server);
    panel.open();
    await flush();

    const rows = () => [...host.querySelectorAll<HTMLElement>('[data-share-item]')]
      .map((row) => row.dataset.shareItem);
    const search = host.querySelector<HTMLInputElement>('[data-share-search]')!;
    expect(rows()).toHaveLength(3);

    const type = (text: string) => {
      search.value = text;
      search.dispatchEvent(new Event('input', { bubbles: true }));
    };
    // 이름으로.
    type('심층');
    expect(rows()).toEqual(['a3']);
    // 업로더로.
    type('모리스');
    expect(rows()).toEqual(['a1']);
    // 설명으로.
    type('무속성');
    expect(rows()).toEqual(['a2']);
    // 없으면 그렇다고 적는다.
    type('없는이름');
    expect(rows()).toEqual([]);
    expect(host.querySelector('[data-share-rows]')!.textContent).toContain('검색과 일치하는');
    // 비우면 다 돌아온다.
    type('');
    expect(rows()).toHaveLength(3);
  });

  it('keeps the search box alive while the list redraws', async () => {
    const server = new FakeServer();
    server.reply = { items: [item({ up: 5 })], mine: {}, applied: {} };
    const { host, panel } = mount(server);
    panel.open();
    await flush();
    const search = host.querySelector<HTMLInputElement>('[data-share-search]')!;
    search.value = '솔레';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    // 엄지를 눌러 목록이 다시 그려져도 같은 입력칸이고 친 글자도 그대로다.
    host.querySelector<HTMLButtonElement>('[data-vote="a1:1"]')!.click();
    await flush();
    expect(host.querySelector('[data-share-search]')).toBe(search);
    expect(search.value).toBe('솔레');
  });

  it('requires a name, sends the auto summary, and never sends before the button', async () => {
    const server = new FakeServer();
    const { host, panel } = mount(server);
    panel.open();
    tab(host, 'upload').click();

    const submit = host.querySelector<HTMLButtonElement>('[data-share-upload]')!;
    const name = host.querySelector<HTMLInputElement>('[data-share-name]')!;
    expect(submit.disabled).toBe(true);
    // 설명은 입력칸이 아니라 지금 설정에서 만들어 보여 준다.
    expect(host.querySelector('[data-share-auto]')!.textContent).toBe('180초 · 무속성');
    expect(server.uploads).toHaveLength(0);

    name.value = '  솔레 3페  ';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    expect(submit.disabled).toBe(false);
    submit.click();
    await flush();

    expect(server.uploads).toEqual([{
      kind: 'boss', name: '  솔레 3페  ', by: '', auto: '180초 · 무속성', code: 'NK3-mine',
    }]);
  });

  it('lands on the list after uploading, and says so', async () => {
    const server = new FakeServer();
    const { host, panel, messages } = mount(server);
    panel.open();
    await flush();
    tab(host, 'upload').click();
    const name = host.querySelector<HTMLInputElement>('[data-share-name]')!;
    name.value = '새 설정';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    host.querySelector<HTMLButtonElement>('[data-share-upload]')!.click();
    await flush();
    await flush();

    expect(host.querySelector<HTMLElement>('[data-list]')!.hidden).toBe(false);
    expect(messages.at(-1)).toEqual({ text: '«새 설정»을(를) 올렸습니다.', ok: true });
  });

  it('keeps the modal usable when the server is down, and can retry', async () => {
    const server = new FakeServer();
    server.failList = '서버가 응답하지 않았습니다 (502).';
    const { host, panel } = mount(server);
    panel.open();
    await flush();
    expect(host.querySelector('[data-list]')!.textContent).toContain('502');

    server.failList = null;
    host.querySelector<HTMLButtonElement>('[data-share-retry]')!.click();
    await flush();
    expect(host.querySelectorAll('[data-share-item]')).toHaveLength(1);
  });
});

describe('squad preview', () => {
  it('draws one row per deck, labelled only when there is more than one', () => {
    const image = (name: string) => (name === '나가' ? undefined : `img/${name}.webp`);
    const one = squadPreview([['리타', '크라운']], image);
    expect(one.querySelectorAll('[data-share-deck]')).toHaveLength(1);
    // 덱이 하나면 «1덱» 딱지는 붙이지 않는다 — 셀 것이 없다.
    expect(one.querySelector('.share-deck-label')).toBeNull();
    expect([...one.querySelectorAll('img')].map((node) => node.getAttribute('alt')))
      .toEqual(['리타', '크라운']);

    const many = squadPreview([['리타'], ['앨리스', '나가']], image);
    expect([...many.querySelectorAll('.share-deck-label')].map((node) => node.textContent))
      .toEqual(['1덱', '2덱']);
    // 초상화가 없는 니케는 이름 조각으로 자리를 지킨다.
    const chip = many.querySelector('.share-portrait-empty')!;
    expect(chip.textContent).toBe('나가');
    expect(chip.getAttribute('title')).toBe('나가');
  });

  it('replaces the summary line in the list when a preview is given', async () => {
    const server = new FakeServer();
    const { host, panel } = mount(server, {
      preview: () => {
        const node = document.createElement('div');
        node.className = 'share-decks';
        return node;
      },
    });
    panel.open();
    await flush();
    const row = host.querySelector('[data-share-item]')!;
    expect(row.querySelector('.share-decks')).not.toBeNull();
    expect(row.querySelector('.share-auto')).toBeNull();
    // 그림을 못 만들면 설명 줄로 물러난다.
    const plain = mount(new FakeServer(), { preview: () => null });
    plain.panel.open();
    await flush();
    expect(plain.host.querySelector('.share-auto')!.textContent).toBe('90초 · 적 수냉');
  });
});

describe('list helpers', () => {
  it('ranks by thumbs difference, newest first on a tie', () => {
    const older = item({ id: 'old', up: 5, down: 2, at: '2026-08-01T00:00:00.000Z' });
    const newer = item({ id: 'new', up: 4, down: 1, at: '2026-08-20T00:00:00.000Z' });
    const best = item({ id: 'best', up: 9, down: 1, at: '2026-07-01T00:00:00.000Z' });
    expect(rankItems([older, newer, best]).map((entry) => entry.id)).toEqual(['best', 'new', 'old']);
  });

  it('reads times as how long ago', () => {
    const now = Date.parse('2026-08-26T12:00:00.000Z');
    expect(agoText('2026-08-26T11:59:30.000Z', now)).toBe('방금');
    expect(agoText('2026-08-26T11:01:00.000Z', now)).toBe('59분 전');
    expect(agoText('2026-08-26T11:00:00.000Z', now)).toBe('1시간 전');
    expect(agoText('2026-08-26T02:00:00.000Z', now)).toBe('10시간 전');
    expect(agoText('2026-08-20T12:00:00.000Z', now)).toBe('6일 전');
    expect(agoText('not a date', now)).toBe('');
  });
});
