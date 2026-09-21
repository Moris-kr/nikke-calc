// @vitest-environment jsdom

/**
 * 계산기 레이드 (BETA) — 화면에서 서버까지.
 *
 * `ui.test.ts`가 아니라 파일을 따로 두는 이유는 `feedback-ui.test.ts`와 같다: 레이드 판은
 * **공유 서버 주소가 있을 때만** 살고(`VITE_SHARE_API`), 그 값은 모듈을 읽는 순간 굳는다.
 *
 * 여기서 보는 것은 셋이다 — 탭이 켜지면 카드가 **큐브만 남기고 잠기는가**, 이어 둔 계정으로
 * 돌려 올리면 **남에게는 익명·나에게는 «나»**로 보이는가, 어드민에게만 식별과 열기 단추가
 * 보이는가.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeBattleCode } from './share-code';
import type { CalculatorClientLike } from './ui';
import type {
  CharacterMeta, CombatPowerRequest, SettingsCatalog, SimulationRequest, SimulationResult,
} from './types';

vi.stubEnv('VITE_SHARE_API', 'https://share.test');

const meta = (name: string, image: string, preview = false): CharacterMeta => ({
  name, burstStage: '3', elementCode: '철갑', weaponType: 'AR', className: '화력형',
  manufacturer: '엘리시온', preview, image, nameCode: null, resourceId: null, aliases: [],
});
const catalog: CharacterMeta[] = [
  meta('리타', 'characters/1.webp'), meta('크라운', 'characters/2.webp'), meta('임시 니케', 'characters/3.webp', true),
];

const cubeLevels = { '15': { atk: 2780, def: 552, hp: 83400, effect: 10, commonElement: 19.09 } };
const characterSettings = () => ({
  weaponType: 'AR' as const,
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
});
const settings: SettingsCatalog = {
  characters: { 리타: characterSettings(), 크라운: characterSettings(), '임시 니케': characterSettings() },
  collectionStages: ['없음', 'SR15'],
  normalHitCoeff: { AR: 1, SMG: 1, SG: 0.9, MG: 1, SR: 1, RL: 1 },
  weaponTypes: ['AR', 'SMG', 'SG', 'MG', 'SR', 'RL'],
  optimalRangeWeapons: ['AR', 'SMG', 'SG', 'MG', 'SR'],
  buffTargetWatch: {},
  consoleClasses: ['화력형', '방어형', '지원형'],
  consoleCompanies: ['엘리시온', '테트라', '미실리스', '필그림', '어브노말'],
  cubes: {
    재장: { id: 0, label: '재장', stat: 'reload_speed_pct', template: '재장전 {0}%', levels: cubeLevels },
    탄충: { id: 1, label: '탄충', stat: 'ammo_charge_flat', template: '10발마다 {0}발', levels: cubeLevels },
  },
  overloadFields: { atk_pct: { label: '공격력', unit: '%', min: 0, max: 1000 } },
  manualStats: {},
  favoriteItems: {},
};

class FakeClient implements CalculatorClientLike {
  requests: SimulationRequest[] = [];
  async prepare(): Promise<void> {}
  async simulate(request: SimulationRequest): Promise<SimulationResult> {
    this.requests.push(request);
    return {
      squadTotal: 123_000_000, duration: 180, hitCount: 1, charTotals: { 리타: 1 },
      previewNote: '', deviations: '',
    };
  }
  async combatPower(_request: CombatPowerRequest): Promise<Record<string, number>> { return {}; }
  dispose(): void {}
}

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
};

/** 열려 있는 레이드 코드 — 실제 NK3 코드여야 화면이 푼다. */
const CODE = (() => {
  return encodeBattleCode({
    duration: 180, synchroLevel: 400, enemyDef: 31784, enemyCode: '전격', coreEnabled: true, corePx: 52,
    hasParts: false, seed: 42, optimalRangeWeapons: [], immuneWindows: [], elementWindows: [],
    rngMode: 'expected', immuneBlocksBurst: true, normalHitCoeff: {}, burstRegenTime: 2, burstReaction: 0.05,
    console: { common_level: 180, class_level: {}, company_level: {} },
  } as never, {});
})();

type Entry = {
  eid: string; openid: string; name: string; area: number; decks: unknown[]; total: number; engine: string; at: string;
};

/** 서버 흉내. 레이드 하나가 열려 있고, 남의 기록이 하나 올라와 있다. */
function fakeServer() {
  const raids = [{
    id: 'r1', title: '9월 3주 솔레', auto: '180초 · 전격 · 코어 52px', code: CODE, status: 'open',
    openedAt: '2026-09-21T00:00:00Z', closedAt: '', count: 1,
  }];
  const entries: Entry[] = [{
    eid: 'e0', openid: '99999999999', name: '남의닉', area: 81, total: 900_000_000, engine: 'v1', at: '2026-09-21T01:00:00Z',
    decks: [{ names: ['크라운'], code: 'NK2-x', order: '', dmg: 900_000_000 }],
  }];
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const publicEntry = (entry: Entry, admin: boolean) => ({
    eid: entry.eid, decks: entry.decks, total: entry.total, engine: entry.engine, at: entry.at,
    ...(admin ? { name: entry.name, area: entry.area, tail: entry.openid.slice(-4) } : {}),
  });
  const board = (admin: boolean) => ({
    raid: { ...raids[0]!, count: entries.length },
    entries: [...entries].sort((a, b) => b.total - a.total).map((entry) => publicEntry(entry, admin)),
  });
  const fetcher = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    sent.push({ url, body });
    const ok = (payload: unknown) => new Response(JSON.stringify(payload));
    if (url.endsWith('/admin/check')) return ok({ ok: true });
    if (url.endsWith('/feedback')) return ok({ items: [] });
    if (url.includes('/list?kind=boss')) {
      return ok({ items: [{ id: 'b1', name: '솔로 레이드 전격', auto: '180초 · 전격', by: '', at: '2026-09-20T00:00:00Z', up: 0, down: 0, uses: 0, code: CODE }] });
    }
    if (url.includes('/list?kind=')) return ok({ items: [] });
    if (url.endsWith('/raid')) return ok({ raids: raids.map((raid) => ({ ...raid, count: entries.length })) });
    if (url.includes('/raid/board')) return ok(board(init?.method === 'POST' && body.password === 'let-me-in'));
    if (url.endsWith('/raid/entry')) {
      const entry: Entry = {
        eid: `e${entries.length}`, openid: String(body.openid), name: String(body.name ?? ''), area: Number(body.area ?? 0),
        decks: body.decks as unknown[], total: Number(body.total), engine: String(body.engine), at: '2026-09-21T02:00:00Z',
      };
      entries.push(entry);
      return ok({ entry: publicEntry(entry, false), kept: false, replaced: false });
    }
    if (url.endsWith('/raid/open')) {
      const raid = { id: `r${raids.length + 1}`, title: String(body.title), auto: String(body.auto), code: String(body.code),
        status: 'open', openedAt: '2026-09-21T03:00:00Z', closedAt: '', count: 0 };
      raids.push(raid);
      return ok({ raid });
    }
    return new Response(JSON.stringify({ error: `없는 경로입니다: ${url}` }), { status: 404 });
  }) as unknown as typeof fetch;
  return { raids, entries, sent, fetcher };
}

/** 블라블라링크로 이어 둔 계정 — 프로필 주소(base64 openid)·로스터·출처. */
const linkAccount = () => {
  const openid = btoa('29080-15361668407129878426');
  localStorage.setItem('nikke-blabla-profile-v1', JSON.stringify({ url: `https://www.blablalink.com/user?openid=${openid}`, area: 81 }));
  localStorage.setItem('nikke-roster-v1', JSON.stringify({ 리타: { growthStage: 3, overload: { atk_pct: 20 } } }));
  localStorage.setItem('nikke-roster-source-v1', 'blabla');
  localStorage.setItem('nikke-account-synchro-v1', JSON.stringify({ level: 821, enabled: true }));
};

const seedDecks = () => {
  localStorage.setItem('nikke-state-v1', JSON.stringify({
    decks: [
      { id: 1, squad: ['리타', '', '', '', ''], characters: {} },
      { id: 2, squad: ['크라운', '', '', '', ''], characters: {} },
    ],
    fiveDeckMode: true, activeDeckId: 1, carryOverSettings: false,
  }));
};

describe('계산기 레이드 (BETA)', () => {
  let root: HTMLElement;
  let client: FakeClient;

  const mount = async (server: ReturnType<typeof fakeServer>) => {
    vi.stubGlobal('fetch', server.fetcher);
    vi.stubGlobal('prompt', () => 'let-me-in');
    client = new FakeClient();
    const { mountCalculator } = await import('./ui');
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    await flush();
  };
  const raidTab = () => root.querySelector<HTMLButtonElement>('[data-settings-tab="raid"]')!;
  const openRaidTab = async () => { raidTab().click(); await flush(); };

  beforeEach(() => {
    root = document.createElement('main');
    document.body.replaceChildren(root);
    localStorage.clear();
    sessionStorage.clear();
  });

  it('탭에 BETA 딱지가 붙고, 열린 레이드가 있으면 머리 띠와 점이 켜진다', async () => {
    await mount(fakeServer());
    expect(raidTab().querySelector('.tab-beta')?.textContent).toBe('BETA');
    expect(root.querySelector<HTMLElement>('[data-raid-dot]')!.hidden).toBe(false);
    const band = root.querySelector<HTMLElement>('[data-raid-band]')!;
    expect(band.hidden).toBe(false);
    expect(band.textContent).toContain('계산기 레이드 진행중');
    expect(band.textContent).toContain('9월 3주 솔레');
    // 아직 탭을 안 열었으니 전투 조건 뭉치가 보이고 레이드 판은 숨어 있다.
    expect(root.querySelector<HTMLElement>('[data-battle-home]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-raid-pane]')!.hidden).toBe(true);
  });

  it('참가하기를 누르면 레이드 탭으로 간다 · 전투 조건 뭉치가 숨고 규칙과 안내문이 선다', async () => {
    await mount(fakeServer());
    root.querySelector<HTMLButtonElement>('[data-raid-band-go]')!.click();
    await flush();
    expect(raidTab().classList.contains('is-on')).toBe(true);
    expect(root.querySelector<HTMLElement>('[data-battle-home]')!.hidden).toBe(true);
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    expect(pane.hidden).toBe(false);
    expect(pane.querySelector('[data-raid-pick="r1"]')?.classList.contains('is-on')).toBe(true);
    expect(pane.textContent).toContain('새 시즌으로 다시 엽니다');
    expect(pane.textContent).toContain('컨트롤(톡톡이·장전컨) 불가');
    // 전투 조건 탭으로 돌아오면 원래대로.
    root.querySelector<HTMLButtonElement>('[data-settings-tab="battle"]')!.click();
    await flush();
    expect(root.querySelector<HTMLElement>('[data-battle-home]')!.hidden).toBe(false);
    expect(pane.hidden).toBe(true);
  });

  it('레이드 중에는 카드가 큐브만 남기고 잠긴다 — 베껴오기·되돌리기 문도 없다', async () => {
    seedDecks();
    linkAccount();
    await mount(fakeServer());
    const card = () => root.querySelector<HTMLElement>('[data-slot-card="0"]')!;
    // 평소: 큐브 드롭다운이 카드에, 「수치 설정」과 컨트롤 칩 사이에 있다.
    const field = card().querySelector<HTMLElement>('[data-cube-field]')!;
    expect(field.previousElementSibling?.matches('[data-char-panel="settings"]')).toBe(true);
    expect(field.nextElementSibling?.matches('.control-editor')).toBe(true);
    expect(card().querySelector('[data-copy-from]')).not.toBeNull();
    expect(root.querySelector<HTMLElement>('[data-raid-lock]')!.hidden).toBe(true);

    await openRaidTab();
    expect(root.classList.contains('is-raid')).toBe(true);
    expect(root.querySelector<HTMLElement>('[data-raid-lock]')!.hidden).toBe(false);
    expect(card().querySelector<HTMLButtonElement>('[data-char-panel-open="settings"]')!.disabled).toBe(true);
    expect(card().querySelector<HTMLButtonElement>('[data-control-open]')!.disabled).toBe(true);
    expect(card().querySelector<HTMLButtonElement>('[data-growth-step="plus"]')!.disabled).toBe(true);
    expect(card().querySelector('[data-copy-from]')).toBeNull();
    expect(card().querySelector('[data-restore-one]')).toBeNull();
    const cube = card().querySelector<HTMLSelectElement>('[data-cube-name]')!;
    expect(cube.disabled).toBe(false);
    // 큐브를 바꾸면 덱에 남고, 다시 그려진 카드도 그대로 잠겨 있다.
    cube.value = '탄충';
    cube.dispatchEvent(new Event('change'));
    await flush();
    const saved = JSON.parse(localStorage.getItem('nikke-state-v1')!) as { decks: Array<{ characters: Record<string, { cube?: { name: string } }> }> };
    expect(saved.decks[0]!.characters['리타']?.cube?.name).toBe('탄충');
    expect(card().querySelector<HTMLButtonElement>('[data-char-panel-open="settings"]')!.disabled).toBe(true);
    expect(card().querySelector<HTMLSelectElement>('[data-cube-name]')!.disabled).toBe(false);

    root.querySelector<HTMLButtonElement>('[data-settings-tab="battle"]')!.click();
    await flush();
    expect(card().querySelector<HTMLButtonElement>('[data-char-panel-open="settings"]')!.disabled).toBe(false);
    expect(card().querySelector('[data-copy-from]')).not.toBeNull();
  });

  it('계정을 안 이었으면 보기만 된다 — 남의 기록은 «참가자»로만 보인다', async () => {
    seedDecks();
    await mount(fakeServer());
    await openRaidTab();
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    expect(pane.querySelector<HTMLButtonElement>('[data-raid-run]')!.disabled).toBe(true);
    expect(pane.textContent).toContain('블라블라링크로 계정을 이어야');
    const row = pane.querySelector<HTMLElement>('[data-raid-row="e0"]')!;
    expect(row.textContent).toContain('참가자');
    expect(row.textContent).not.toContain('남의닉');
    expect(pane.textContent).not.toContain('99999999999');
    // 자기 기록을 지우는 길은 어디에도 없다.
    expect(pane.querySelector('[data-raid-remove]')).toBeNull();
  });

  it('이어 둔 계정으로 5덱을 돌려 올리면 내 줄만 «나»로 보이고, 요청은 로스터 값·큐브·계정 싱크로로 간다', async () => {
    seedDecks();
    linkAccount();
    const server = fakeServer();
    await mount(server);
    await openRaidTab();
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    const run = pane.querySelector<HTMLButtonElement>('[data-raid-run]')!;
    expect(run.disabled).toBe(false);
    run.click();
    await flush();
    // 덱 둘 = 요청 둘. 로스터의 오버로드가 실리고, 싱크로는 계정 값, 적 코드는 어드민 것.
    expect(client.requests).toHaveLength(2);
    const first = client.requests[0]!;
    expect(first.characters?.리타?.overload).toEqual({ atk_pct: 20 });
    expect(first.synchroLevel).toBe(821);
    expect(first.enemyCode).toBe('전격');
    expect(first.duration).toBe(180);
    expect(pane.querySelector('[data-raid-result]')!.textContent).toContain('2.46억');

    const name = pane.querySelector<HTMLInputElement>('[data-raid-name]')!;
    name.value = '모리스';
    name.dispatchEvent(new Event('input'));
    pane.querySelector<HTMLButtonElement>('[data-raid-submit]')!.click();
    await flush();
    const posted = server.sent.find((call) => call.url.endsWith('/raid/entry'))!;
    expect(posted.body.openid).toBe('15361668407129878426');
    expect(posted.body.name).toBe('모리스');
    expect(posted.body.total).toBe(246_000_000);
    expect((posted.body.spec as { requests: unknown[] }).requests).toHaveLength(2);
    // 랭킹: 남이 1위(9억), 내가 2위. 내 줄은 «나», 남은 «참가자».
    const rows = [...pane.querySelectorAll<HTMLElement>('[data-raid-row]')];
    expect(rows.map((row) => row.dataset.raidRow)).toEqual(['e0', 'e1']);
    expect(rows[1]!.classList.contains('is-me')).toBe(true);
    expect(rows[1]!.textContent).toContain('모리스');
    expect(rows[0]!.textContent).toContain('참가자');
    expect(rows[0]!.textContent).not.toContain('남의닉');
    expect(pane.querySelector('[data-raid-message]')!.textContent).toContain('2위');
  });

  it('임시 니케나 두 덱에 겹친 니케가 있으면 한 판도 안 돌린다', async () => {
    localStorage.setItem('nikke-state-v1', JSON.stringify({
      decks: [
        { id: 1, squad: ['리타', '임시 니케', '', '', ''], characters: {} },
        { id: 2, squad: ['리타', '', '', '', ''], characters: {} },
      ],
      fiveDeckMode: true, activeDeckId: 1, carryOverSettings: false,
    }));
    linkAccount();
    await mount(fakeServer());
    await openRaidTab();
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    pane.querySelector<HTMLButtonElement>('[data-raid-run]')!.click();
    await flush();
    expect(client.requests).toHaveLength(0);
    expect(pane.querySelector('[data-raid-message]')!.textContent).toMatch(/임시 니케|한 덱에만/);
  });

  it('어드민은 제출자 식별을 보고, 전투 조건 공유 목록에서 레이드를 연다', async () => {
    seedDecks();
    const server = fakeServer();
    await mount(server);
    // 피드백 창에서 비밀번호를 확인한 어드민 — 그 세션 값이 레이드에도 쓰인다.
    root.querySelector<HTMLButtonElement>('[data-feedback-open]')!.click();
    await flush();
    root.querySelector<HTMLButtonElement>('[data-feedback-admin]')!.click();
    await flush();
    expect(sessionStorage.getItem('nikke-feedback-admin')).toBe('let-me-in');

    await openRaidTab();
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    const boardCall = server.sent.filter((call) => call.url.includes('/raid/board')).at(-1)!;
    expect(boardCall.body.password).toBe('let-me-in');
    const row = pane.querySelector<HTMLElement>('[data-raid-row="e0"]')!;
    expect(row.textContent).toContain('남의닉');
    expect(pane.querySelector('[data-raid-close]')).not.toBeNull();
    expect(pane.querySelector('[data-raid-verify="e0"]')).not.toBeNull();
    expect(pane.querySelector('[data-raid-remove="e0"]')).not.toBeNull();

    // 전투 조건 공유 창의 목록에는 어드민에게만 «계산기 레이드로 올리기»가 붙는다.
    root.querySelector<HTMLButtonElement>('[data-battle-share-open]')!.click();
    await flush();
    const open = root.querySelector<HTMLButtonElement>('[data-share-raid-open="b1"]')!;
    expect(open).not.toBeNull();
    vi.stubGlobal('prompt', () => '9월 4주 솔레');
    open.click();
    await flush();
    const opened = server.sent.find((call) => call.url.endsWith('/raid/open'))!;
    expect(opened.body).toMatchObject({ title: '9월 4주 솔레', code: CODE, password: 'let-me-in' });
    expect(server.raids).toHaveLength(2);
    expect(root.querySelector<HTMLElement>('[data-raid-band-list]')!.textContent).toContain('9월 4주 솔레');
    expect(pane.querySelectorAll('[data-raid-pick]')).toHaveLength(2);
  });
});
