// @vitest-environment jsdom

/**
 * 피드백 판의 운영자 코멘트 — 화면에서 서버까지.
 *
 * `ui.test.ts`가 아니라 파일을 따로 두는 이유: 피드백 판은 **공유 서버 주소가 있을 때만**
 * 그려지고(`import.meta.env.VITE_SHARE_API`), 그 값은 모듈을 읽는 순간 굳는다. 큰 시험
 * 파일 안에서 모듈을 다시 읽으면 계산기가 한 벌 더 떠서 뒤따르는 시험이 전부 느려진다 —
 * 여기서는 파일 하나가 통째로 «주소가 있는 세상»이라 그럴 일이 없다.
 *
 * 카탈로그는 한 명뿐이다. 이 시험이 보는 것은 편성이 아니라 게시판이다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CalculatorClientLike } from './ui';
import type {
  CharacterMeta, CombatPowerRequest, SettingsCatalog, SimulationRequest, SimulationResult,
} from './types';

vi.stubEnv('VITE_SHARE_API', 'https://share.test');

const catalog: CharacterMeta[] = [{
  name: '리타', burstStage: '1', elementCode: '철갑', weaponType: 'SMG', className: '지원형',
  manufacturer: '미실리스', preview: false, image: 'characters/1.webp',
  nameCode: null, resourceId: null, aliases: [],
}];

const cubeLevels = { '15': { atk: 2780, def: 552, hp: 83400, effect: 10, commonElement: 19.09 } };
const settings: SettingsCatalog = {
  characters: {
    리타: {
      weaponType: 'SMG',
      recommendedControl: {},
      hasConditionalControl: false,
      growthStage: 3,
      rarity: 'SSR',
      maxGrowthStage: 10,
      growthOptions: [{ value: 3, label: '3돌', affinity: 30 }],
      skillLevels: { '1': 10, '2': 10, '3': 10 },
      skillLevelsLocked: false,
      overload: { atk_pct: 0 },
      cube: { name: '재장', level: 15 },
      collection: { stage: 'SR15', favorite: 0 },
    },
  },
  collectionStages: ['없음', 'SR15'],
  normalHitCoeff: { AR: 1, SMG: 1, SG: 0.9, MG: 1, SR: 1, RL: 1 },
  weaponTypes: ['AR', 'SMG', 'SG', 'MG', 'SR', 'RL'],
  optimalRangeWeapons: ['AR', 'SMG', 'SG', 'MG', 'SR'],
  buffTargetWatch: {},
  consoleClasses: ['화력형', '방어형', '지원형'],
  consoleCompanies: ['엘리시온', '테트라', '미실리스', '필그림', '어브노말'],
  cubes: {
    재장: { id: 0, label: '재장', stat: 'reload_speed_pct', template: '재장전 {0}%', levels: cubeLevels },
  },
  overloadFields: { atk_pct: { label: '공격력', unit: '%', min: 0, max: 1000 } },
  manualStats: {},
  favoriteItems: {},
};

class FakeClient implements CalculatorClientLike {
  async prepare(): Promise<void> {}

  async simulate(_request: SimulationRequest): Promise<SimulationResult> {
    return {
      squadTotal: 1, duration: 10, hitCount: 1, charTotals: { 리타: 1 },
      previewNote: '', deviations: '',
    };
  }

  async combatPower(_request: CombatPowerRequest): Promise<Record<string, number>> {
    return {};
  }

  dispose(): void {}
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** 서버 흉내. 코멘트를 올리면 그 판에 그대로 남아 다음 목록에 함께 나온다. */
function fakeServer() {
  const board = [{
    id: 'f1', kind: 'bug', text: '풍라플 코어가 안 먹혀요', by: '',
    at: '2026-09-03T01:00:00Z', status: 'new', movedAt: '', reply: '', replyAt: '',
  }];
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    sent.push({ url, body });
    if (url.endsWith('/admin/check')) return new Response(JSON.stringify({ ok: true }));
    if (url.endsWith('/feedback/reply')) {
      board[0] = { ...board[0]!, reply: String(body.reply), replyAt: '2026-09-04T02:00:00Z' };
      return new Response(JSON.stringify({ item: board[0] }));
    }
    if (url.endsWith('/feedback')) return new Response(JSON.stringify({ items: board }));
    return new Response(JSON.stringify({ error: '없는 경로입니다.' }), { status: 404 });
  }) as unknown as typeof fetch;
  return { board, sent, fetcher };
}

describe('피드백 · 운영자 코멘트', () => {
  let root: HTMLElement;

  const mount = async (server: ReturnType<typeof fakeServer>) => {
    vi.stubGlobal('fetch', server.fetcher);
    vi.stubGlobal('prompt', () => 'let-me-in');
    const { mountCalculator } = await import('./ui');
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });
    root.querySelector<HTMLButtonElement>('[data-feedback-open]')!.click();
    await flush();
  };

  const beAdmin = async () => {
    root.querySelector<HTMLButtonElement>('[data-feedback-admin]')!.click();
    await flush();
  };

  beforeEach(() => {
    root = document.createElement('main');
    document.body.replaceChildren(root);
    localStorage.clear();
    sessionStorage.clear();
  });

  it('관리자만 코멘트 칸을 본다', async () => {
    await mount(fakeServer());
    expect(root.querySelector('[data-feedback-item="f1"]')).not.toBeNull();
    // 손님에게는 상태를 옮기는 단추도, 코멘트 단추도 없다.
    expect(root.querySelector('[data-feedback-comment="f1"]')).toBeNull();
    await beAdmin();
    expect(root.querySelector('[data-feedback-comment="f1"]')).not.toBeNull();
  });

  it('코멘트를 달면 그 글 아래에 「운영자」로 붙는다', async () => {
    const server = fakeServer();
    await mount(server);
    await beAdmin();

    root.querySelector<HTMLButtonElement>('[data-feedback-comment="f1"]')!.click();
    const area = root.querySelector<HTMLTextAreaElement>('[data-feedback-reply-text="f1"]')!;
    area.value = '고쳤습니다 — 모드 탄착군이 원인이었습니다.';
    root.querySelector<HTMLButtonElement>('[data-feedback-reply-save="f1"]')!.click();
    await flush();

    expect(server.sent.at(-1)).toMatchObject({
      url: 'https://share.test/feedback/reply',
      body: { id: 'f1', reply: '고쳤습니다 — 모드 탄착군이 원인이었습니다.', password: 'let-me-in' },
    });
    const shown = root.querySelector<HTMLElement>('[data-feedback-reply="f1"]')!;
    expect(shown.textContent).toContain('운영자');
    expect(shown.textContent).toContain('모드 탄착군이 원인이었습니다');
    // 올리고 나면 쓰던 칸은 접히고, 단추는 «고치기»가 된다.
    expect(root.querySelector('[data-feedback-reply-text="f1"]')).toBeNull();
    expect(root.querySelector<HTMLElement>('[data-feedback-comment="f1"]')!.textContent)
      .toBe('코멘트 고치기');
  });

  it('빈 글로 올리면 코멘트를 뗀다', async () => {
    const server = fakeServer();
    await mount(server);
    await beAdmin();

    root.querySelector<HTMLButtonElement>('[data-feedback-comment="f1"]')!.click();
    const area = root.querySelector<HTMLTextAreaElement>('[data-feedback-reply-text="f1"]')!;
    area.value = '검토하겠습니다.';
    root.querySelector<HTMLButtonElement>('[data-feedback-reply-save="f1"]')!.click();
    await flush();
    expect(root.querySelector('[data-feedback-reply="f1"]')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('[data-feedback-comment="f1"]')!.click();
    const again = root.querySelector<HTMLTextAreaElement>('[data-feedback-reply-text="f1"]')!;
    // 고치려고 열면 지금 달린 코멘트가 그대로 들어 있다.
    expect(again.value).toBe('검토하겠습니다.');
    again.value = '   ';
    root.querySelector<HTMLButtonElement>('[data-feedback-reply-save="f1"]')!.click();
    await flush();

    expect(server.sent.at(-1)!.body).toMatchObject({ reply: '' });
    expect(root.querySelector('[data-feedback-reply="f1"]')).toBeNull();
  });
});
