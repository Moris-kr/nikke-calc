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

import { encodeBattleCode, encodeShareCode } from './share-code';
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
  /** 켜면 계산이 멈춰 선다 — 취소 시험용. `cancel()`이 멈춘 것을 풀어 준다. */
  hold = false;
  private waiting: Array<() => void> = [];
  cancelled = 0;
  async prepare(): Promise<void> {}
  cancel(): void { this.cancelled += 1; this.hold = false; for (const wake of this.waiting.splice(0)) wake(); }
  async simulate(request: SimulationRequest): Promise<SimulationResult> {
    this.requests.push(request);
    if (this.hold) await new Promise<void>((resolve) => { this.waiting.push(resolve); });
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
  recalculatedAt?: string;
};

/** 서버 흉내. 레이드 하나가 열려 있고, 남의 기록이 하나 올라와 있다. */
function fakeServer() {
  const raids = [{
    id: 'r1', title: '9월 3주 솔레', auto: '180초 · 전격 · 코어 52px', code: CODE, status: 'open',
    openedAt: '2026-09-21T00:00:00Z', closedAt: '', count: 1,
  }];
  const entries: Entry[] = [{
    eid: 'e0', openid: '99999999999', name: '남의닉', area: 81, total: 900_000_000, engine: 'v1', at: '2026-09-21T01:00:00Z',
    decks: [{ names: ['크라운'], code: encodeShareCode([{ id: 1, squad: ['크라운', '', '', '', ''], characters: {} }], false), order: '', dmg: 900_000_000, cubes: { 크라운: { name: '탄충', level: 15 } }, controls: { 크라운: { burst: { mode: 'skip' } } } }],
  }];
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const reordered: string[][] = [];
  const publicEntry = (entry: Entry, admin: boolean) => ({
    eid: entry.eid, tag: entry.openid.slice(0, 4), decks: entry.decks, total: entry.total, engine: entry.engine, at: entry.at,
    ...(entry.recalculatedAt ? { recalculatedAt: entry.recalculatedAt } : {}),
    ...(admin ? { name: entry.name, area: entry.area, tail: entry.openid.slice(-4), owner: 'h' + entry.openid } : {}),
  });
  /** 지난 시즌 — 닫혀 있고, 남의 기록 하나(스펙 보관)와 «남의닉»과 같은 계정의 기록 하나. */
  const oldRaid = { id: 'r0', title: '지난 시즌', auto: '180초 · 철갑', code: CODE, status: 'closed',
    openedAt: '2026-09-01T00:00:00Z', closedAt: '2026-09-10T00:00:00Z', count: 2 };
  const oldEntries: Entry[] = [
    { eid: 'o1', openid: '77777777777', name: '옛사람', area: 81, total: 500_000_000, engine: 'v0', at: '2026-09-02T00:00:00Z',
      decks: [{ names: ['리타'], code: 'NK2-x', order: '', dmg: 500_000_000 }] },
    { eid: 'o2', openid: '99999999999', name: '남의닉', area: 81, total: 400_000_000, engine: 'v0', at: '2026-09-02T00:00:00Z',
      decks: [{ names: ['크라운'], code: 'NK2-x', order: '', dmg: 400_000_000 }] },
  ];
  const specs: Record<string, unknown> = {
    'r0:o1': { requests: [{ squad: ['리타', '', '', '', ''], characters: { 리타: { overload: { atk_pct: 33 }, cube: { name: '탄충', level: 15 } } }, duration: 180, enemyCode: '철갑', console: { common_level: 300, class_level: {}, company_level: {} } }] },
    'r0:o2': { requests: [{ squad: ['크라운', '', '', '', ''], characters: {}, duration: 180, enemyCode: '철갑' }] },
    'r1:e0': { requests: [{ squad: ['크라운', '', '', '', ''], characters: { 크라운: { burst: { mode: 'skip' }, cube: { name: '탄충', level: 15 } } }, duration: 180, enemyCode: '전격', console: { common_level: 300, class_level: {}, company_level: {} } }] },
  };
  const board = (admin: boolean, id = 'r1') => id === 'r0'
    ? { raid: oldRaid, entries: oldEntries.map((entry) => publicEntry(entry, admin)) }
    : { raid: { ...raids[0]!, count: entries.length }, entries: [...entries].sort((a, b) => b.total - a.total).map((entry) => publicEntry(entry, admin)) };
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
    if (url.endsWith('/raid')) return ok({ raids: [...raids.map((raid) => ({ ...raid, count: entries.length })), oldRaid] });
    if (url.includes('/raid/board')) {
      const id = init?.method === 'POST' ? String(body.id) : new URL(url).searchParams.get('id') ?? 'r1';
      return ok(board(init?.method === 'POST' && body.password === 'let-me-in', id));
    }
    if (url.endsWith('/raid/spec')) {
      const spec = specs[`${body.id}:${body.eid}`];
      return spec ? ok({ spec }) : new Response(JSON.stringify({ error: '보관된 스펙이 없습니다.' }), { status: 404 });
    }
    if (url.endsWith('/raid/reorder')) {
      const ids = body.ids as string[];
      const all = [...raids.map((raid) => ({ ...raid, count: entries.length })), oldRaid];
      const sorted = ids.map((id) => all.find((raid) => raid.id === id)!);
      reordered.push(ids);
      return ok({ raids: sorted });
    }
    if (url.endsWith('/raid/recalc')) {
      const items = body.entries as Array<{ eid: string; decks: unknown[]; total: number; engine: string }>;
      let updated = 0; let missing = 0;
      for (const item of items) {
        const entry = entries.find((row) => row.eid === item.eid);
        if (!entry) { missing += 1; continue; }
        entry.decks = item.decks; entry.total = item.total; entry.engine = item.engine; entry.recalculatedAt = '2026-09-22T05:00:00Z';
        updated += 1;
      }
      return ok({ updated, missing });
    }
    if (url.endsWith('/raid/migrate')) {
      const items = body.entries as Array<{ owner: string; name: string; decks: unknown[]; total: number }>;
      let moved = 0; let skipped = 0;
      for (const item of items) {
        if (entries.some((entry) => 'h' + entry.openid === item.owner)) { skipped += 1; continue; }
        entries.push({ eid: `m${entries.length}`, openid: item.owner.slice(1), name: item.name, area: 81, decks: item.decks, total: item.total, engine: 'v1', at: '2026-09-21T04:00:00Z' });
        moved += 1;
      }
      return ok({ moved, skipped });
    }
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
    if (url.endsWith('/raid/close') || url.endsWith('/raid/reopen')) {
      const raid = raids.find((item) => item.id === body.id)!;
      raid.status = url.endsWith('/raid/close') ? 'closed' : 'open';
      return ok({ raid });
    }
    if (url.endsWith('/raid/delete')) {
      const at = raids.findIndex((item) => item.id === body.id);
      if (at >= 0) raids.splice(at, 1);
      return ok({ id: body.id });
    }
    return new Response(JSON.stringify({ error: `없는 경로입니다: ${url}` }), { status: 404 });
  }) as unknown as typeof fetch;
  return { raids, entries, sent, reordered, fetcher };
}

/** 블라블라링크로 이어 둔 계정 — 프로필 주소(base64 openid)·로스터·출처. */
const linkAccount = () => {
  const openid = btoa('29080-15361668407129878426');
  localStorage.setItem('nikke-blabla-profile-v1', JSON.stringify({ url: `https://www.blablalink.com/user?openid=${openid}`, area: 81 }));
  localStorage.setItem('nikke-roster-v1', JSON.stringify({ 리타: { growthStage: 3, overload: { atk_pct: 20 } }, 크라운: { growthStage: 3 } }));
  localStorage.setItem('nikke-roster-source-v1', 'blabla');
  localStorage.setItem('nikke-account-synchro-v1', JSON.stringify({ level: 821, enabled: true }));
  localStorage.setItem('nikke-imported-console-v1', JSON.stringify({ common_level: 460, class_level: { 화력형: 249, 방어형: 259, 지원형: 240 }, company_level: { 엘리시온: 460, 테트라: 278, 미실리스: 435, 필그림: 354, 어브노말: 246 } }));
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
    expect(pane.textContent).toContain('컨트롤(톡톡이·장전컨·홀드·버스트 운용)은 내 것 — 톡톡이는 3.6발/s 고정');
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
    // 컨트롤 판은 산다 — 레이드에서도 컨트롤은 내 것이다(톡톡이 발사 속도만 3.6 고정).
    expect(card().querySelector<HTMLButtonElement>('[data-control-open]')!.disabled).toBe(false);
    expect(card().querySelector<HTMLInputElement>('[data-control-mode="manual"]')!.disabled).toBe(false);
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
    // 꼬리표로 «같은 사람»은 구분된다 — 계정 번호 전체는 어디에도 없다.
    expect(row.querySelector('.raid-tag')!.textContent).toBe('#9999');
    expect(row.textContent).not.toContain('남의닉');
    expect(pane.textContent).not.toContain('99999999999');
    // 자기 기록을 지우는 길은 어디에도 없다.
    expect(pane.querySelector('[data-raid-remove]')).toBeNull();
    // 줄을 펼치면 덱마다 「큐브 보기」 — 정식 이름 (별명) Lv.
    row.click();
    const cubes = pane.querySelector<HTMLButtonElement>('[data-raid-cubes="e0:0"]')!;
    expect(cubes).not.toBeNull();
    const list = cubes.closest('.raid-decks')!.querySelector<HTMLElement>('.raid-cubes')!;
    expect(list.hidden).toBe(true);
    cubes.click();
    expect(list.hidden).toBe(false);
    expect(list.textContent).toContain('크라운');
    expect(list.textContent).toContain('탄충 Lv15');
    // 큐브가 실린 기록에만 「큐브도」 단추가 있고, 누르면 편성과 함께 큐브가 덱에 잡힌다.
    expect(pane.querySelector('[data-raid-take-cubes="e0"]')).not.toBeNull();
    pane.querySelector<HTMLButtonElement>('[data-raid-take-cubes="e0"]')!.click();
    await flush();
    const saved = JSON.parse(localStorage.getItem('nikke-state-v1')!) as { decks: Array<{ squad: string[]; characters: Record<string, { cube?: { name: string; level: number } }> }> };
    expect(saved.decks[0]!.squad[0]).toBe('크라운');
    expect(saved.decks[0]!.characters['크라운']?.cube).toEqual({ name: '탄충', level: 15 });
    expect(pane.querySelector('[data-raid-message]')!.textContent).toContain('편성과 큐브를 가져왔습니다');
  });

  it('이어 둔 계정으로 5덱을 돌리면 내 최고 딜은 바로 올라가고, 내 줄만 «나»로 보이며, 요청은 로스터 값·400·내 콘솔로 간다', async () => {
    seedDecks();
    linkAccount();
    const server = fakeServer();
    await mount(server);
    await openRaidTab();
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    const run = pane.querySelector<HTMLButtonElement>('[data-raid-run]')!;
    expect(run.disabled).toBe(false);
    // 사전 안내 — 첫 계산은 묻지 않고 올라간다고 미리 적혀 있다.
    expect(pane.querySelector('[data-raid-run-note]')!.textContent).toContain('묻지 않고 바로 랭킹에 올라갑니다');
    // 표시 이름은 계산 전에 받는다.
    const name = pane.querySelector<HTMLInputElement>('[data-raid-name]')!;
    name.value = '모리스';
    name.dispatchEvent(new Event('input'));
    run.click();
    await flush();
    // 덱 둘 = 요청 둘. 로스터의 오버로드가 실리고, 싱크로는 계정(821)이 아니라 400 고정,
    // 콘솔은 받아 둔 내 계정 값, 적 코드는 어드민 것.
    expect(client.requests).toHaveLength(2);
    const first = client.requests[0]!;
    expect(first.characters?.리타?.overload).toEqual({ atk_pct: 20 });
    expect(first.synchroLevel ?? 400).toBe(400);
    expect(first.console?.common_level).toBe(460);
    expect(first.console?.class_level?.화력형).toBe(249);
    expect(first.enemyCode).toBe('전격');
    expect(first.duration).toBe(180);
    expect(pane.querySelector('[data-raid-result]')!.textContent).toContain('2.46억');
    // 덱별 결과는 평소의 전투 결과 판에 선다.
    expect(root.querySelector('[data-result-panel]')!.textContent).toContain('2덱 전투 결과');
    expect(root.querySelector('[data-result-panel] [data-batch-total]')!.textContent).toContain('2.46억');

    // 내 기록이 없었으니 묻지 않고 바로 올라갔다 — 손으로 올리는 단추는 없다.
    const posted = server.sent.find((call) => call.url.endsWith('/raid/entry'))!;
    expect(pane.querySelector('[data-raid-submit]')).toBeNull();
    // 니케별로 실제 낀 큐브가 실린다 — 로스터·덱에 없으면 카탈로그 기본값(재장 Lv15).
    const decks = posted.body.decks as Array<{ cubes?: Record<string, { name: string; level: number }> }>;
    expect(decks[0]!.cubes).toEqual({ 리타: { name: '재장', level: 15 } });
    expect(posted.body.openid).toBe('15361668407129878426');
    expect(posted.body.name).toBe('모리스');
    expect(posted.body.total).toBe(246_000_000);
    expect((posted.body.spec as { requests: unknown[] }).requests).toHaveLength(2);
    // 랭킹: 남이 1위(9억), 내가 2위. 내 줄은 «나», 남은 «참가자».
    const rows = [...pane.querySelectorAll<HTMLElement>('[data-raid-row]')];
    expect(rows.map((row) => row.dataset.raidRow)).toEqual(['e0', 'e1']);
    expect(rows[1]!.classList.contains('is-me')).toBe(true);
    // 상위 열 줄은 메달 배지 — 1위 금, 2위 은.
    expect(rows[0]!.classList.contains('is-podium')).toBe(true);
    expect(rows[0]!.querySelector('.raid-medal.m1')!.textContent).toBe('1');
    expect(rows[1]!.querySelector('.raid-medal.m2')!.textContent).toBe('2');
    expect(rows[1]!.textContent).toContain('모리스');
    expect(rows[0]!.textContent).toContain('참가자');
    expect(rows[0]!.textContent).not.toContain('남의닉');
    expect(pane.querySelector('[data-raid-message]')!.textContent).toContain('바로 올렸습니다');
    expect(pane.querySelector('[data-raid-message]')!.textContent).toContain('2위');
    // 이제 안내는 «내 기록보다 높으면»으로 바뀐다.
    expect(pane.querySelector('[data-raid-run-note]')!.textContent).toContain('내 기록(2.46억)보다 높으면');

    // 같은 결과를 다시 돌리면(더 높지 않다) 올리지 않는다 — 요청도 안 나간다.
    pane.querySelector<HTMLButtonElement>('[data-raid-run]')!.click();
    await flush();
    expect(server.sent.filter((call) => call.url.endsWith('/raid/entry'))).toHaveLength(1);
    expect(pane.querySelector('[data-raid-message]')!.textContent).toContain('낮아 올리지 않았습니다');
    // 그때는 손으로 올리는 문이 남는다(서버가 어차피 더 높은 것만 받는다).
    expect(pane.querySelector('[data-raid-submit]')).not.toBeNull();
  });

  it('모의전을 켜면 카드가 풀리고, 계산해도 올리지 않고 «이대로라면 n등»만 알려 준다', async () => {
    seedDecks();
    linkAccount();
    const server = fakeServer();
    await mount(server);
    await openRaidTab();
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    const card = () => root.querySelector<HTMLElement>('[data-slot-card="0"]')!;
    expect(card().querySelector<HTMLButtonElement>('[data-char-panel-open="settings"]')!.disabled).toBe(true);
    const mockBox = pane.querySelector<HTMLInputElement>('[data-raid-mock]')!;
    expect(mockBox.checked).toBe(false);
    mockBox.checked = true;
    mockBox.dispatchEvent(new Event('change'));
    await flush();
    // 잠금이 풀린다 — 베껴오기 문도 돌아온다. 안내도 모의전으로 바뀐다.
    expect(card().querySelector<HTMLButtonElement>('[data-char-panel-open="settings"]')!.disabled).toBe(false);
    expect(card().querySelector('[data-copy-from]')).not.toBeNull();
    expect(root.querySelector('[data-raid-lock]')!.textContent).toContain('모의전');
    expect(pane.querySelector('[data-raid-run-note]')!.textContent).toContain('모의전');
    // 덱에 손으로 잡은 수치가 그대로 실린다(로스터 값이 아니라).
    const saved = JSON.parse(localStorage.getItem('nikke-state-v1')!) as { decks: Array<{ characters: Record<string, unknown> }> };
    saved.decks[0]!.characters['리타'] = { overload: { atk_pct: 77 } };
    localStorage.setItem('nikke-state-v1', JSON.stringify(saved));
    // 다시 그려서 덱 상태를 읽게 하는 대신, 화면의 덱을 직접 만진다 — 카드의 개별 설정 토글.
    pane.querySelector<HTMLButtonElement>('[data-raid-run]')!.click();
    await flush();
    expect(client.requests.length).toBeGreaterThan(0);
    // 남의 9억 하나뿐이니 2.46억은 2등.
    expect(pane.querySelector('[data-raid-message]')!.textContent).toContain('2등입니다');
    expect(server.sent.some((call) => call.url.endsWith('/raid/entry'))).toBe(false);
    expect(pane.querySelector('[data-raid-submit]')).toBeNull();
    expect(pane.querySelector('.raid-mock-badge')).not.toBeNull();
    // 결과 판에도 선다. 전투 조건 탭으로 갔다 와도 결과 판은 다시 그려진다.
    expect(root.querySelector('[data-result-panel]')!.textContent).toContain('2덱 전투 결과');
    root.querySelector<HTMLElement>('[data-result-panel]')!.replaceChildren();
    root.querySelector<HTMLButtonElement>('[data-settings-tab="battle"]')!.click();
    await flush();
    await openRaidTab();
    expect(root.querySelector('[data-result-panel]')!.textContent).toContain('2덱 전투 결과');
    // 끄면 다시 잠긴다.
    pane.querySelector<HTMLInputElement>('[data-raid-mock]')!.checked = false;
    pane.querySelector<HTMLInputElement>('[data-raid-mock]')!.dispatchEvent(new Event('change'));
    await flush();
    expect(card().querySelector<HTMLButtonElement>('[data-char-panel-open="settings"]')!.disabled).toBe(true);
  });

  it('모의전도 톡톡이는 3.6이다 — 덱에 4.4로 잡아 두어도 요청은 3.6으로 간다', async () => {
    localStorage.setItem('nikke-state-v1', JSON.stringify({
      decks: [
        { id: 1, squad: ['리타', '', '', '', ''], characters: { 리타: { control: { tap_fire: { rate: 4.4, release: 0.03 } } } } },
        { id: 2, squad: ['크라운', '', '', '', ''], characters: {} },
      ],
      fiveDeckMode: true, activeDeckId: 1, carryOverSettings: false,
    }));
    linkAccount();
    await mount(fakeServer());
    await openRaidTab();
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    const mockBox = pane.querySelector<HTMLInputElement>('[data-raid-mock]')!;
    mockBox.checked = true;
    mockBox.dispatchEvent(new Event('change'));
    await flush();
    expect(pane.querySelector('[data-raid-run-note]')!.textContent).toContain('톡톡이만 3.6발/s 고정');
    expect(root.querySelector('[data-raid-lock]')!.textContent).toContain('톡톡이만 3.6발/s 고정');
    pane.querySelector<HTMLButtonElement>('[data-raid-run]')!.click();
    await flush();
    expect(client.requests[0]!.characters?.리타?.control?.tap_fire?.rate).toBe(3.6);
    // 모의전의 다른 수치는 덱 것 그대로다(release도 살아 있다).
    expect(client.requests[0]!.characters?.리타?.control?.tap_fire?.release).toBe(0.03);
  });

  it('레이드 계산도 취소할 수 있다 — 도는 동안만 단추가 서고, 끊으면 올리지 않는다', async () => {
    seedDecks();
    linkAccount();
    const server = fakeServer();
    await mount(server);
    await openRaidTab();
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    expect(pane.querySelector('[data-raid-cancel]')).toBeNull();
    client.hold = true;
    pane.querySelector<HTMLButtonElement>('[data-raid-run]')!.click();
    await flush();
    const cancel = pane.querySelector<HTMLButtonElement>('[data-raid-cancel]')!;
    expect(cancel).not.toBeNull();
    expect(pane.querySelector<HTMLButtonElement>('[data-raid-run]')!.disabled).toBe(true);
    cancel.click();
    await flush();
    expect(client.cancelled).toBe(1);
    expect(pane.querySelector('[data-raid-message]')!.textContent).toContain('계산을 취소했습니다');
    expect(server.sent.some((call) => call.url.endsWith('/raid/entry'))).toBe(false);
    expect(pane.querySelector('[data-raid-cancel]')).toBeNull();
    expect(pane.querySelector<HTMLButtonElement>('[data-raid-run]')!.disabled).toBe(false);
    expect(pane.querySelector('[data-raid-result]')).toBeNull();
  });

  it('콘솔(전초기지)을 못 받은 계정은 진짜 계산을 못 돌리고, 공개로 바꾸라는 안내가 뜬다 — 모의전은 된다', async () => {
    seedDecks();
    linkAccount();
    localStorage.removeItem('nikke-imported-console-v1');
    const server = fakeServer();
    await mount(server);
    await openRaidTab();
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    expect(pane.querySelector<HTMLButtonElement>('[data-raid-run]')!.disabled).toBe(true);
    const note = pane.querySelector<HTMLElement>('[data-raid-run-note]')!;
    expect(note.textContent).toContain('전초기지');
    expect(note.textContent).toContain('기록을 올릴 수 없습니다');
    expect(note.classList.contains('is-warn')).toBe(true);
    // 모의전은 올리지 않으니 돌아간다.
    const mockBox = pane.querySelector<HTMLInputElement>('[data-raid-mock]')!;
    mockBox.checked = true;
    mockBox.dispatchEvent(new Event('change'));
    await flush();
    expect(pane.querySelector<HTMLButtonElement>('[data-raid-run]')!.disabled).toBe(false);
    pane.querySelector<HTMLButtonElement>('[data-raid-run]')!.click();
    await flush();
    expect(client.requests.length).toBeGreaterThan(0);
    expect(server.sent.some((call) => call.url.endsWith('/raid/entry'))).toBe(false);
  });

  it('로스터에 없는(안 가진) 니케가 있으면 한 판도 안 돌린다', async () => {
    seedDecks();
    linkAccount();
    // 크라운을 안 가진 계정 — 덱 2가 크라운이다.
    localStorage.setItem('nikke-roster-v1', JSON.stringify({ 리타: { growthStage: 3 } }));
    await mount(fakeServer());
    await openRaidTab();
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    pane.querySelector<HTMLButtonElement>('[data-raid-run]')!.click();
    await flush();
    expect(client.requests).toHaveLength(0);
    expect(pane.querySelector('[data-raid-message]')!.textContent).toContain('크라운');
    expect(pane.querySelector('[data-raid-message]')!.textContent).toContain('로스터에 없습니다');
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
    // 누르면 제목·설명을 고치는 칸이 그 자리에서 열린다 — 설명은 요약이 미리 들어가 있다.
    root.querySelector<HTMLButtonElement>('[data-battle-share-open]')!.click();
    await flush();
    const open = root.querySelector<HTMLButtonElement>('[data-share-raid-open="b1"]')!;
    expect(open).not.toBeNull();
    const form = root.querySelector<HTMLElement>('[data-share-raid-form="b1"]')!;
    expect(form.hidden).toBe(true);
    open.click();
    expect(form.hidden).toBe(false);
    const title = form.querySelector<HTMLInputElement>('[data-share-raid-title]')!;
    const auto = form.querySelector<HTMLTextAreaElement>('[data-share-raid-auto]')!;
    expect(title.value).toBe('솔로 레이드 전격');
    expect(auto.value).toContain('180초');
    expect(auto.value).toContain('전격');
    title.value = '9월 4주 솔레';
    auto.value = '180초 · 전격 · 코어 있음';
    auto.dispatchEvent(new Event('input'));
    expect(form.querySelector('.share-raid-count')!.textContent).toBe('17/400');
    form.querySelector<HTMLButtonElement>('[data-share-raid-go]')!.click();
    await flush();
    const opened = server.sent.find((call) => call.url.endsWith('/raid/open'))!;
    expect(opened.body).toMatchObject({ title: '9월 4주 솔레', auto: '180초 · 전격 · 코어 있음', code: CODE, password: 'let-me-in' });
    expect(form.hidden).toBe(true);
    expect(server.raids).toHaveLength(2);
    expect(root.querySelector<HTMLElement>('[data-raid-band-list]')!.textContent).toContain('9월 4주 솔레');
    expect(pane.querySelectorAll('[data-raid-pick]')).toHaveLength(3);
  });

  it('랭킹 옆 새로고침을 누르면 목록과 랭킹을 다시 받는다', async () => {
    seedDecks();
    const server = fakeServer();
    await mount(server);
    await openRaidTab();
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    const before = server.sent.filter((call) => call.url.includes('/raid/board')).length;
    pane.querySelector<HTMLButtonElement>('[data-raid-refresh]')!.click();
    await flush();
    expect(server.sent.filter((call) => call.url.includes('/raid/board')).length).toBe(before + 1);
    expect(pane.querySelector('[data-raid-row="e0"]')).not.toBeNull();
  });

  it('어드민이 지난 레이드의 기록을 이 조건으로 재계산해 옮긴다 — 동일인이 이미 있으면 건너뛴다', async () => {
    seedDecks();
    const server = fakeServer();
    await mount(server);
    root.querySelector<HTMLButtonElement>('[data-feedback-open]')!.click();
    await flush();
    root.querySelector<HTMLButtonElement>('[data-feedback-admin]')!.click();
    await flush();
    await openRaidTab();
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    const from = pane.querySelector<HTMLSelectElement>('[data-raid-migrate-from]')!;
    expect([...from.options].map((option) => option.value)).toEqual(['r0']);
    pane.querySelector<HTMLButtonElement>('[data-raid-migrate]')!.click();
    await flush();
    await flush();
    // 옛사람(o1)만 옮겨진다 — 남의닉은 이 레이드에 이미 있다(e0). 요청은 이 레이드 조건(전격)으로,
    // 스펙의 육성·큐브·그 사람의 콘솔은 그대로.
    const rebased = client.requests.find((request) => request.squad[0] === '리타')!;
    expect(rebased.enemyCode).toBe('전격');
    expect(rebased.characters?.리타?.overload).toEqual({ atk_pct: 33 });
    expect(rebased.console?.common_level).toBe(300);
    expect(client.requests.some((request) => request.squad[0] === '크라운')).toBe(false);
    const posted = server.sent.find((call) => call.url.endsWith('/raid/migrate'))!;
    const items = posted.body.entries as Array<{ owner: string; name: string; total: number; decks: Array<{ cubes?: Record<string, { name: string }> }> }>;
    expect(items).toHaveLength(1);
    expect(items[0]!.owner).toBe('h77777777777');
    expect(items[0]!.name).toBe('옛사람');
    expect(items[0]!.total).toBe(123_000_000);
    expect(items[0]!.decks[0]!.cubes?.리타?.name).toBe('탄충');
    expect(posted.body.to).toBe('r1');
    expect(posted.body.from).toBe('r0');
    expect(server.entries.some((entry) => entry.name === '옛사람')).toBe(true);
    expect(pane.querySelector('[data-raid-message]')!.textContent).toContain('1개를 옮겼습니다');
    expect(pane.querySelector('[data-raid-message]')!.textContent).toContain('건너뛴 1개');
  });

  it('레이드 중 컨트롤은 내 것 — 톡톡이만 3.6으로 못 박히고, 요청과 기록에 컨트롤이 실린다', async () => {
    localStorage.setItem('nikke-state-v1', JSON.stringify({
      decks: [
        { id: 1, squad: ['리타', '', '', '', ''], characters: { 리타: { control: { tap_fire: { rate: 4.4, release: 0.03, policy: 'burst_charge' }, reload: { policy: 'into_fb', margin: 0.3 } }, burst: { mode: 'priority', every: 2 } } } },
        { id: 2, squad: ['크라운', '', '', '', ''], characters: {} },
      ],
      fiveDeckMode: true, activeDeckId: 1, carryOverSettings: false,
    }));
    linkAccount();
    const server = fakeServer();
    await mount(server);
    await openRaidTab();
    const card = root.querySelector<HTMLElement>('[data-slot-card="0"]')!;
    // 규칙 줄이 바뀌었다 — 컨트롤은 내 것, 톡톡이 3.6 고정.
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    expect(pane.querySelector('.raid-rules')!.textContent).toContain('톡톡이는 3.6발/s 고정');
    expect(root.querySelector('[data-raid-lock]')!.textContent).toContain('컨트롤(톡톡이는 3.6발/s 고정)은 내 것');
    // 컨트롤 판 안의 것들은 살아 있다 — 정책·장전컨 선택은 되고, 발사 속도 칸만 3.6으로 잠긴다.
    const policy = card.querySelector<HTMLSelectElement>('[data-control-policy="reload"]');
    if (policy) expect(policy.disabled).toBe(false);
    const rate = card.querySelector<HTMLInputElement>('[data-tap-rate]');
    if (rate) { expect(rate.disabled).toBe(true); expect(rate.value).toBe('3.6'); }
    pane.querySelector<HTMLButtonElement>('[data-raid-run]')!.click();
    await flush();
    const first = client.requests[0]!;
    expect(first.characters?.리타?.control?.tap_fire).toMatchObject({ rate: 3.6, policy: 'burst_charge' });
    expect(first.characters?.리타?.control?.reload).toMatchObject({ policy: 'into_fb' });
    expect(first.characters?.리타?.burst).toEqual({ mode: 'priority', every: 2 });
    const posted = server.sent.find((call) => call.url.endsWith('/raid/entry'))!;
    const decks = posted.body.decks as Array<{ controls?: Record<string, { control?: { tap_fire?: { rate: number } }; burst?: unknown }> }>;
    expect(decks[0]!.controls?.리타?.control?.tap_fire?.rate).toBe(3.6);
    expect(decks[0]!.controls?.리타?.burst).toEqual({ mode: 'priority', every: 2 });
    expect(decks[1]!.controls).toBeUndefined();
    // 내 줄이 생겼으니 「내 순위로」가 서고, 누르면 그 줄이 밝혀진다.
    const toMine = pane.querySelector<HTMLButtonElement>('[data-raid-to-mine]')!;
    expect(toMine.textContent).toContain('내 순위(2위)로');
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function () { scrolled.push((this as HTMLElement).dataset.raidRow ?? ''); };
    toMine.click();
    expect(scrolled).toEqual(['e1']);
    expect(pane.querySelector('[data-raid-row="e1"]')!.classList.contains('is-flash')).toBe(true);
  });

  it('기록에 컨트롤이 실려 있으면 「컨트롤 보기」와 「편성·큐브·컨트롤 가져오기」가 선다', async () => {
    seedDecks();
    linkAccount();
    await mount(fakeServer());
    await openRaidTab();
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    pane.querySelector<HTMLElement>('[data-raid-row="e0"]')!.click();
    await flush();
    const open = pane.querySelector<HTMLButtonElement>('[data-raid-controls="e0:0"]')!;
    expect(open).not.toBeNull();
    const list = open.closest('.raid-decks')!.querySelectorAll<HTMLElement>('.raid-cubes')[1]!;
    open.click();
    expect(list.hidden).toBe(false);
    expect(list.textContent).toContain('버스트 안 씀');
    // 「큐브 보기」와 「컨트롤 보기」는 한 칸에 모여 있다 — 줄을 뚫고 나오지 않는다.
    expect(open.parentElement!.className).toBe('raid-openers');
    expect(open.parentElement!.querySelectorAll('button').length).toBe(2);
    pane.querySelector<HTMLButtonElement>('[data-raid-take-controls="e0"]')!.click();
    await flush();
    const saved = JSON.parse(localStorage.getItem('nikke-state-v1')!) as { decks: Array<{ squad: string[]; characters: Record<string, { burst?: { mode: string }; cube?: { name: string } }> }> };
    expect(saved.decks[0]!.squad[0]).toBe('크라운');
    expect(saved.decks[0]!.characters['크라운']?.burst).toEqual({ mode: 'skip' });
    expect(saved.decks[0]!.characters['크라운']?.cube?.name).toBe('탄충');
  });

  it('어드민이 열린 레이드를 새 엔진으로 자리 그대로 재계산하면 「재계산됨」이 붙는다', async () => {
    seedDecks();
    const server = fakeServer();
    await mount(server);
    root.querySelector<HTMLButtonElement>('[data-feedback-open]')!.click();
    await flush();
    root.querySelector<HTMLButtonElement>('[data-feedback-admin]')!.click();
    await flush();
    await openRaidTab();
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    expect(pane.querySelector('[data-raid-recalc]')).not.toBeNull();
    expect(pane.querySelector('[data-raid-recalc-all]')).not.toBeNull();
    pane.querySelector<HTMLButtonElement>('[data-raid-recalc-all]')!.click();
    await flush();
    await flush();
    // 보관된 스펙(r1:e0)으로 다시 돌려 자리 그대로 보냈다 — 버스트 게이지는 신 방식, 그 사람의 콘솔 그대로.
    const request = client.requests.at(-1)!;
    expect(request.squad[0]).toBe('크라운');
    expect(request.burstGaugeMode).toBe('new');
    expect(request.console?.common_level).toBe(300);
    expect(request.characters?.크라운?.burst).toEqual({ mode: 'skip' });
    const posted = server.sent.find((call) => call.url.endsWith('/raid/recalc'))!;
    expect(posted.body.id).toBe('r1');
    const items = posted.body.entries as Array<{ eid: string; total: number; decks: Array<{ controls?: Record<string, unknown> }> }>;
    expect(items).toHaveLength(1);
    expect(items[0]!.eid).toBe('e0');
    expect(items[0]!.total).toBe(123_000_000);
    expect(items[0]!.decks[0]!.controls?.크라운).toEqual({ burst: { mode: 'skip' } });
    expect(pane.querySelector('[data-raid-message]')!.textContent).toContain('1개를 다시 계산했습니다');
    // 새로 받은 랭킹에는 «재계산됨»이 붙는다.
    const row = pane.querySelector<HTMLElement>('[data-raid-row="e0"]')!;
    expect(row.querySelector('.raid-recalc')!.textContent).toBe('재계산됨');
  });

  it('어드민은 레이드 목록을 끌어다 놓거나 ▲▼로 옮긴다 — 열린 것과 닫힌 것은 무리를 넘지 않는다', async () => {
    seedDecks();
    const server = fakeServer();
    // 열린 레이드를 하나 더 — 옮길 상대가 있어야 한다.
    server.raids.push({ id: 'r2', title: '9월 4주 솔레', auto: '180초 · 철갑', code: CODE, status: 'open',
      openedAt: '2026-09-22T00:00:00Z', closedAt: '', count: 0 });
    await mount(server);
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    await openRaidTab();
    // 어드민이 아니면 손잡이도 끌기도 없다.
    expect(pane.querySelector('[data-raid-up]')).toBeNull();
    expect(pane.querySelector<HTMLButtonElement>('[data-raid-pick="r1"]')!.draggable).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-feedback-open]')!.click();
    await flush();
    root.querySelector<HTMLButtonElement>('[data-feedback-admin]')!.click();
    await flush();
    await openRaidTab();
    const order = () => [...pane.querySelectorAll<HTMLElement>('[data-raid-pick]')].map((node) => node.dataset.raidPick);
    expect(order()).toEqual(['r1', 'r2', 'r0']);
    expect(pane.querySelector<HTMLButtonElement>('[data-raid-pick="r1"]')!.draggable).toBe(true);
    // ▼ — r1이 r2 아래로. 서버에는 전체 순서가 간다.
    pane.querySelector<HTMLButtonElement>('[data-raid-down="r1"]')!.click();
    await flush();
    expect(order()).toEqual(['r2', 'r1', 'r0']);
    expect(server.reordered.at(-1)).toEqual(['r2', 'r1', 'r0']);
    // 끌어다 놓기 — r1을 r2 위에 놓는다.
    pane.querySelector<HTMLButtonElement>('[data-raid-pick="r1"]')!.dispatchEvent(new Event('dragstart', { bubbles: true }));
    pane.querySelector<HTMLButtonElement>('[data-raid-pick="r2"]')!.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await flush();
    expect(order()).toEqual(['r1', 'r2', 'r0']);
    expect(server.reordered.at(-1)).toEqual(['r1', 'r2', 'r0']);
    // 닫힌 r0은 열린 무리 위로 못 간다 — ▲가 죽어 있다.
    expect(pane.querySelector<HTMLButtonElement>('[data-raid-up="r0"]')!.disabled).toBe(true);
    expect(pane.querySelector<HTMLButtonElement>('[data-raid-down="r2"]')!.disabled).toBe(true);
  });

  it('어드민은 닫은 레이드를 다시 열거나 두 번 눌러 통째로 지운다', async () => {
    seedDecks();
    const server = fakeServer();
    await mount(server);
    root.querySelector<HTMLButtonElement>('[data-feedback-open]')!.click();
    await flush();
    root.querySelector<HTMLButtonElement>('[data-feedback-admin]')!.click();
    await flush();
    await openRaidTab();
    const pane = root.querySelector<HTMLElement>('[data-raid-pane]')!;
    // 진행 중: 종료만 있다.
    expect(pane.querySelector('[data-raid-reopen]')).toBeNull();
    pane.querySelector<HTMLButtonElement>('[data-raid-close]')!.click();
    await flush();
    // 닫힘: 다시 열기 · 완전히 삭제.
    expect(pane.querySelector('[data-raid-close]')).toBeNull();
    expect(pane.querySelector('[data-raid-reopen]')).not.toBeNull();
    const remove = pane.querySelector<HTMLButtonElement>('[data-raid-delete]')!;
    remove.click();
    await flush();
    // 한 번으로는 안 지워진다 — 단추 글이 바뀌고 두 번째에 지운다.
    expect(server.sent.some((call) => call.url.endsWith('/raid/delete'))).toBe(false);
    expect(server.raids).toHaveLength(1);
    pane.querySelector<HTMLButtonElement>('[data-raid-delete]')!.click();
    await flush();
    expect(server.sent.some((call) => call.url.endsWith('/raid/delete') && call.body.password === 'let-me-in')).toBe(true);
    expect(server.raids).toHaveLength(0);
    // 지워진 레이드는 목록에서 사라지고, 남은 것은 지난 시즌(r0)뿐이다.
    expect(pane.querySelector('[data-raid-pick="r1"]')).toBeNull();
    expect(pane.querySelectorAll('[data-raid-pick]')).toHaveLength(1);
  });
});
