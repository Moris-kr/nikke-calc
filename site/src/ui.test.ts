// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { StorageLike } from './cache';
import { LATEST_NOTICE_ID } from './notices';
import { mountCalculator, type CalculatorClientLike } from './ui';
import { decodeBattleCode, encodeBattleCode } from './share-code';
import './styles.css';
import type {
  CharacterMeta,
  CombatPowerRequest,
  SettingsCatalog,
  SimulationRequest,
  SimulationResult,
} from './types';

const names = ['리타', '크라운', '라피 : 레드 후드', '앨리스', '나가', '프리바티'];
const catalog: CharacterMeta[] = [
  { name: '리타', burstStage: '1', elementCode: '철갑', weaponType: 'SMG', className: '지원형', manufacturer: '미실리스', preview: false, image: 'characters/1.webp', nameCode: null, resourceId: null, aliases: [] },
  { name: '크라운', burstStage: '2', elementCode: '철갑', weaponType: 'MG', className: '방어형', manufacturer: '필그림', preview: false, image: 'characters/2.webp', nameCode: null, resourceId: null, aliases: [] },
  { name: '라피 : 레드 후드', burstStage: '3', elementCode: '작열', weaponType: 'MG', className: '화력형', manufacturer: '엘리시온', preview: false, image: 'characters/3.webp', nameCode: null, resourceId: null, aliases: [] },
  { name: '앨리스', burstStage: '3', elementCode: '수냉', weaponType: 'SR', className: '화력형', manufacturer: '테트라', preview: false, image: 'characters/4.webp', nameCode: null, resourceId: null, aliases: [] },
  { name: '나가', burstStage: '2', elementCode: '전격', weaponType: 'SG', className: '지원형', manufacturer: '미실리스', preview: false, image: 'characters/5.webp', nameCode: null, resourceId: null, aliases: [] },
  { name: '프리바티', burstStage: '3', elementCode: '수냉', weaponType: 'AR', className: '화력형', manufacturer: '엘리시온', preview: false, image: 'characters/6.webp', nameCode: null, resourceId: null, aliases: [] },
];

const cubeLevels = { '15': { atk: 2780, def: 552, hp: 83400, effect: 10, commonElement: 19.09 } };
const settings: SettingsCatalog = {
  characters: Object.fromEntries(names.map((name) => [name, {
    weaponType: catalog.find((character) => character.name === name)?.weaponType ?? 'AR',
    recommendedControl: {},
    hasConditionalControl: false,
    growthStage: 3,
    rarity: 'SSR',
    maxGrowthStage: 10,
    growthOptions: Array.from({ length: 11 }, (_, value) => ({
      value,
      label: value === 0 ? '명함' : value <= 3 ? `${value}돌` : `코강 ${value - 3}`,
      affinity: value === 0 ? 10 : value === 1 ? 20 : 30,
    })),
    skillLevels: { '1': 10, '2': 10, '3': 10 },
    skillLevelsLocked: false,
    overload: {
      element_bonus: 88.6,
      atk_pct: 22.22,
      max_ammo_pct: 129.64,
      crit_rate: 0,
      crit_dmg: 0,
    },
    cube: { name: '재장', level: 15 },
    collection: { stage: 'SR15', favorite: 0 },
  }])),
  collectionStages: ['없음', 'SR0', 'SR5', 'SR15'],
  normalHitCoeff: { AR: 1, SMG: 1, SG: 0.9, MG: 1, SR: 1, RL: 1 },
  weaponTypes: ['AR', 'SMG', 'SG', 'MG', 'SR', 'RL'],
  optimalRangeWeapons: ['AR', 'SMG', 'SG', 'MG', 'SR'],
  buffTargetWatch: { 리타: [{ buff: '웨이크업! 4', label: '크확 대상' }] },
  consoleClasses: ['화력형', '방어형', '지원형'],
  consoleCompanies: ['엘리시온', '테트라', '미실리스', '필그림', '어브노말'],
  cubes: {
    재장: { id: 0, label: '재장', stat: 'reload_speed_pct', template: '재장전 {0}%', levels: cubeLevels },
    탄충: { id: 0, label: '탄충', stat: 'ammo_charge_flat', template: '10발마다 {0}발', levels: cubeLevels },
    체력: { id: 0, label: '체력', stat: 'max_hp_pct', template: '체력 {0}%', levels: cubeLevels },
    차속: { id: 0, label: '차속', stat: 'charge_speed_pct', template: '차속 {0}%', levels: cubeLevels },
    파츠: { id: 0, label: '파츠', stat: 'part_dmg_pct', template: '파츠 {0}%', levels: cubeLevels },
    분배: { id: 0, label: '분배', stat: 'split_dmg_pct', template: '분배 {0}%', levels: cubeLevels },
  },
  overloadFields: {
    element_bonus: { label: '우월 코드 대미지', unit: '%', min: 0, max: 1000 },
    atk_pct: { label: '공격력', unit: '%', min: 0, max: 1000 },
    max_ammo_pct: { label: '최대 장탄수', unit: '%', min: 0, max: 10000 },
    crit_rate: { label: '크리티컬 확률', unit: '%', min: 0, max: 100 },
    crit_dmg: { label: '크리티컬 대미지', unit: '%', min: 0, max: 1000 },
    def_pct: { label: '방어력', unit: '%', min: 0, max: 1000 },
    charge_speed_pct: { label: '차지 속도', unit: '%', min: 0, max: 1000 },
    charge_dmg_pct: { label: '차지 대미지', unit: '%', min: 0, max: 1000 },
    accuracy_pct: { label: '명중률', unit: '%', min: 0, max: 1000 },
  },
  manualStats: {
    split_dmg_pct: { label: '분배 대미지', unit: '%', min: -1000, max: 10000 },
  },
  favoriteItems: {},
};

const calculated: SimulationResult = {
  squadTotal: 123_456,
  duration: 10,
  hitCount: 87,
  charTotals: {
    리타: 60_000,
    크라운: 30_000,
    '라피 : 레드 후드': 20_000,
    앨리스: 10_000,
    나가: 3_456,
  },
  previewNote: '',
  deviations: '기본 스펙(1층) 그대로',
};

class FakeClient implements CalculatorClientLike {
  prepareCalls = 0;
  simulateCalls = 0;
  lastRequest: SimulationRequest | null = null;
  requests: SimulationRequest[] = [];

  async prepare(): Promise<void> {
    this.prepareCalls += 1;
  }

  async simulate(request: SimulationRequest): Promise<SimulationResult> {
    this.simulateCalls += 1;
    this.lastRequest = request;
    this.requests.push(request);
    return calculated;
  }

  dispose(): void {}
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 판의 검색칸에 친다. 슬롯마다 있던 검색은 없어지고 덱에 하나만 남았다. */
function searchRoster(root: HTMLElement, query: string): void {
  const search = root.querySelector<HTMLInputElement>('[data-roster-search]')!;
  search.value = query;
  search.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 판에 지금 보이는 니케 이름을 순서대로. */
function rosterNames(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLButtonElement>('[data-roster-cell]')]
    .map((cell) => cell.dataset.rosterCell!);
}

function focusSlot(root: HTMLElement, index: number): void {
  root.querySelector<HTMLButtonElement>(`[data-slot-choose="${index}"]`)!.click();
}

/** 칸을 겨냥하고 판에서 골라 넣는다 — 실제 사용 흐름 그대로다. */
function chooseCharacter(root: HTMLElement, index: number, name: string): void {
  focusSlot(root, index);
  searchRoster(root, name);
  const cell = root.querySelector<HTMLButtonElement>(`[data-roster-cell="${name}"]`)!;
  expect(cell.disabled).toBe(false);
  cell.click();
  searchRoster(root, '');
}

function clearCharacterSlot(root: HTMLElement, index: number): void {
  const card = root.querySelectorAll<HTMLElement>('[data-slot-card]')[index]!;
  card.querySelector<HTMLButtonElement>('.slot-clear')!.click();
}

describe('calculator UI', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('main');
    document.body.append(root);
    localStorage.clear();
  });

  /** jsdom에는 DragEvent가 없다 — 필요한 부분(dataTransfer)만 흉내 낸다. */
  const dragEvent = (type: string, data: Record<string, string>) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const store = new Map(Object.entries(data));
    Object.defineProperty(event, 'dataTransfer', {
      value: {
        types: [...store.keys()],
        getData: (key: string) => store.get(key) ?? '',
        setData: (key: string, value: string) => { store.set(key, value); },
        dropEffect: 'none',
        effectAllowed: 'none',
      },
    });
    return event;
  };

  /** 저장된 편성. 시험 카탈로그는 처음부터 다섯 칸이 차 있다. */
  const savedSquad = () => (JSON.parse(localStorage.getItem('nikke-state-v1')!) as
    { decks: Array<{ squad: string[] }> }).decks[0]!.squad;

  it('니케를 끌어다 칸에 놓는다', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const cell = root.querySelector<HTMLButtonElement>('[data-roster-cell="프리바티"]')!;
    expect(cell.draggable).toBe(true);

    // 4번 칸에 놓는다 — 고른 칸(activeSlot)이 아니라 **놓은 칸**에 들어가야 한다.
    const slot = root.querySelector<HTMLElement>('[data-slot-card="3"]')!;
    cell.dispatchEvent(dragEvent('dragstart', {}));
    slot.dispatchEvent(dragEvent('dragover', { 'application/x-nikke-name': '프리바티' }));
    expect(slot.classList.contains('is-drop')).toBe(true);
    slot.dispatchEvent(dragEvent('drop', { 'application/x-nikke-name': '프리바티' }));

    expect(savedSquad()[3]).toBe('프리바티');
    // 다시 그린 칸에는 끌던 표시가 남지 않는다.
    expect(root.querySelector<HTMLElement>('[data-slot-card="3"]')!.classList.contains('is-drop'))
      .toBe(false);
  });

  it('이미 그 덱에 있는 니케는 놓아도 안 들어가고 이유를 말한다', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    root.querySelector<HTMLElement>('[data-slot-card="4"]')!
      .dispatchEvent(dragEvent('drop', { 'application/x-nikke-name': '프리바티' }));
    const taken = savedSquad()[1]!;          // 2번 칸의 니케

    root.querySelector<HTMLElement>('[data-slot-card="4"]')!
      .dispatchEvent(dragEvent('drop', { 'application/x-nikke-name': taken }));

    expect(savedSquad()[4]).toBe('프리바티');   // 그대로다
    expect(root.querySelector('[data-errors]')!.textContent).toContain('이미 2번 칸에 있습니다');
  });

  it('칸끼리 끌면 자리가 맞바뀐다', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    root.querySelector<HTMLElement>('[data-slot-card="4"]')!
      .dispatchEvent(dragEvent('drop', { 'application/x-nikke-name': '프리바티' }));
    const before = savedSquad().slice(0, 3);

    // 1번을 3번 칸으로 끌어다 놓는다 — 이름에 걸린 설정은 그대로 두고 자리만 바뀐다.
    root.querySelector<HTMLElement>('[data-slot-card="2"]')!
      .dispatchEvent(dragEvent('drop', { 'application/x-nikke-slot': '0' }));

    expect(savedSquad().slice(0, 3)).toEqual([before[2], before[1], before[0]]);
  });

  it('exposes composition-only presets as a first-class squad action', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });

    // 프리셋과 공유는 같은 창이다 — 단추도 하나로 합쳤다.
    const open = root.querySelector<HTMLButtonElement>('[data-share-open]')!;
    expect(open).not.toBeNull();
    expect(open.textContent).toContain('프리셋');
    expect(open.textContent).toContain('조합 공유');
    expect(root.querySelector('[data-preset-open]')).toBeNull();
    open.click();

    const modal = root.querySelector<HTMLElement>('[data-share-modal]')!;
    expect(modal.hidden).toBe(false);
    // 창 하나가 저장(프리셋)과 주고받기(코드·링크)를 같이 맡는다.
    expect(root.querySelector('[data-preset-name]')).not.toBeNull();
    expect(root.querySelector('[data-share-out]')).not.toBeNull();
    expect(modal.textContent).toContain('개인 스펙과 전투 조건은 담기지 않습니다');

    const name = root.querySelector<HTMLInputElement>('[data-preset-name]')!;
    name.value = '솔레 1군';
    root.querySelector<HTMLButtonElement>('[data-preset-save]')!.click();
    const stored = JSON.parse(localStorage.getItem('nikke-presets-v1')!) as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]!).sort()).toEqual(['at', 'code', 'name']);
    expect(stored[0]?.name).toBe('솔레 1군');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    root.remove();
  });

  it('버스트 순서를 단축키로 걸어 덱에 남긴다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });

    root.querySelector<HTMLButtonElement>('[data-burst-order-open]')!.click();
    const modal = root.querySelector<HTMLElement>('[data-burst-order-modal]')!;
    expect(modal.hidden).toBe(false);

    // 첫 걸음은 1번째 풀버스트의 1버다.
    const now = root.querySelector<HTMLElement>('[data-burst-now]')!;
    expect(now.textContent).toContain('1번째 풀버스트');
    expect(now.textContent).toContain('1버');

    // 1버는 리타 하나뿐이라 A와 「자동」(0)만 붙는다.
    const keysOf = () => [...root.querySelectorAll<HTMLElement>('[data-burst-picks] .burst-pick-key')]
      .map((node) => node.textContent);
    expect(keysOf()).toEqual(['A', '0']);

    const firstName = root.querySelector<HTMLElement>('[data-burst-picks] .burst-pick-name')!
      .textContent!;
    expect(firstName).toBe('리타');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    // 한 칸 골랐으니 다음 걸음(2버)으로 넘어간다.
    expect(now.textContent).toContain('2버');
    // 2버는 둘이라 A·S가 편성 순서대로 붙는다.
    expect(keysOf()).toEqual(['A', 'S', '0']);
    expect([...root.querySelectorAll<HTMLElement>('[data-burst-picks] .burst-pick-name')]
      .map((node) => node.textContent).slice(0, 2)).toEqual(['크라운', '나가']);
    expect(root.querySelector('[data-burst-progress]')?.textContent).toContain('1 /');

    root.querySelector<HTMLButtonElement>('[data-burst-order-save]')!.click();
    expect(modal.hidden).toBe(true);

    const saved = JSON.parse(localStorage.getItem('nikke-state-v1')!) as
      { decks: Array<{ burstSequence?: Array<Record<string, string[]>> }> };
    expect(saved.decks[0]!.burstSequence![0]!['1']).toEqual([firstName]);
    // 덱 도구 줄의 배지가 걸려 있음을 알린다.
    expect(root.querySelector<HTMLElement>('[data-burst-order-badge]')!.hidden).toBe(false);
  });

  it('목록은 사이클마다 빈 칸 셋이고 고를 때마다 초상화가 채워진다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });
    root.querySelector<HTMLButtonElement>('[data-burst-order-open]')!.click();

    const firstRow = () => root.querySelector<HTMLElement>('[data-burst-list] .burst-row')!;
    const slots = () => [...firstRow().querySelectorAll<HTMLElement>('.burst-slot')];

    // 아무것도 안 골라도 칸은 셋이다 — 몇 칸이 남았는지가 보여야 한다.
    expect(slots()).toHaveLength(3);
    expect(slots().map((slot) => slot.querySelector('.burst-slot-stage')?.textContent))
      .toEqual(['1버', '2버', '3버']);
    expect(slots().every((slot) => !slot.classList.contains('is-filled'))).toBe(true);
    expect(firstRow().querySelectorAll('img')).toHaveLength(0);

    // 첫 칸을 고르면 그 칸만 채워지고 초상화가 들어간다.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(slots()[0]!.classList.contains('is-filled')).toBe(true);
    expect(slots()[1]!.classList.contains('is-filled')).toBe(false);
    expect(slots()[0]!.querySelector('img')?.getAttribute('alt')).toBe('리타');
  });

  it('목록의 칸을 누르면 그 걸음으로 바로 간다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });
    root.querySelector<HTMLButtonElement>('[data-burst-order-open]')!.click();
    const now = root.querySelector<HTMLElement>('[data-burst-now]')!;

    const rows = [...root.querySelectorAll<HTMLElement>('[data-burst-list] .burst-row')];
    // 3번째 사이클의 3버 칸.
    rows[2]!.querySelectorAll<HTMLButtonElement>('.burst-slot')[2]!.click();

    expect(now.textContent).toContain('3번째 풀버스트');
    expect(now.textContent).toContain('3버');
    // 지금 서 있는 칸에 표시가 붙는다.
    const here = root.querySelectorAll('[data-burst-list] .burst-slot.is-here');
    expect(here).toHaveLength(1);
  });

  it('버스트 순서 단추는 덱 비우기와 다른 옷을 입고, 걸어 두면 색이 바뀐다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });
    const open = root.querySelector<HTMLButtonElement>('[data-burst-order-open]')!;
    // 파괴 단추(덱 비우기)와 같은 옷을 입고 있어 눈에 안 띄던 것을 뗐다.
    expect(open.classList.contains('deck-clear')).toBe(false);
    expect(open.classList.contains('burst-order-open')).toBe(true);
    expect(open.classList.contains('is-on')).toBe(false);

    open.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    root.querySelector<HTMLButtonElement>('[data-burst-order-save]')!.click();
    expect(open.classList.contains('is-on')).toBe(true);
  });

  it('← 로 한 칸 되돌리고 0으로 자동으로 되돌린다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });
    root.querySelector<HTMLButtonElement>('[data-burst-order-open]')!.click();
    const now = root.querySelector<HTMLElement>('[data-burst-now]')!;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(now.textContent).toContain('2버');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(now.textContent).toContain('1버');
    expect(now.textContent).not.toContain('→ 자동');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(now.textContent).toContain('→ 자동');
  });

  it('순서를 지우면 덱에서 사라지고 배지도 내려간다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });
    root.querySelector<HTMLButtonElement>('[data-burst-order-open]')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    root.querySelector<HTMLButtonElement>('[data-burst-order-save]')!.click();

    root.querySelector<HTMLButtonElement>('[data-burst-order-open]')!.click();
    root.querySelector<HTMLButtonElement>('[data-burst-order-clear]')!.click();

    const saved = JSON.parse(localStorage.getItem('nikke-state-v1')!) as
      { decks: Array<{ burstSequence?: unknown }> };
    expect(saved.decks[0]!.burstSequence).toBeUndefined();
    expect(root.querySelector<HTMLElement>('[data-burst-order-badge]')!.hidden).toBe(true);
  });

  it('창이 닫혀 있으면 단축키를 가져가지 않는다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });
    // 창을 열지 않은 채 A를 눌러도 아무 일이 없어야 한다 — 검색칸과 부딪치면 안 된다.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    const saved = JSON.parse(localStorage.getItem('nikke-state-v1') ?? '{"decks":[{}]}') as
      { decks: Array<{ burstSequence?: unknown }> };
    expect(saved.decks[0]!.burstSequence).toBeUndefined();
  });

  it('외부고리 탭이 네 곳으로 새 탭에서 나간다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });

    const tab = root.querySelector<HTMLButtonElement>('[data-view-tab="links"]')!;
    expect(tab.textContent).toBe('외부고리');
    tab.click();

    const panel = root.querySelector<HTMLElement>('[data-view="links"]')!;
    expect(panel.hidden).toBe(false);
    // 계산기 판은 물러나 있어야 한다.
    expect(root.querySelector<HTMLElement>('form[data-view="calc"]')!.hidden).toBe(true);

    const cards = [...root.querySelectorAll<HTMLAnchorElement>('.link-card')];
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.querySelector('.link-name')?.textContent))
      .toEqual(['렛츠도로', '딜도로', '솔레 금서고', '도로파티']);
    for (const card of cards) {
      expect(card.target).toBe('_blank');
      // 남의 페이지에 우리 창을 넘기지 않는다.
      expect(card.rel).toContain('noopener');
      expect(card.rel).toContain('noreferrer');
      expect(card.href.startsWith('https://')).toBe(true);
    }
    // 우리가 운영하는 곳이 아니라는 사실이 화면에 적혀 있어야 한다.
    expect(panel.textContent).toContain('우리가 운영하지 않습니다');
  });

  it('적 수치를 초기화하면 조건 한 줄도 함께 바뀐다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });

    const summary = root.querySelector<HTMLElement>('[data-battle-summary]')!;
    const def = root.querySelector<HTMLInputElement>('#enemy-def')!;
    const code = root.querySelector<HTMLSelectElement>('#enemy-code')!;
    const parts = root.querySelector<HTMLInputElement>('#has-parts')!;

    def.value = '99999'; def.dispatchEvent(new Event('change', { bubbles: true }));
    code.value = '작열'; code.dispatchEvent(new Event('change', { bubbles: true }));
    parts.checked = true; parts.dispatchEvent(new Event('change', { bubbles: true }));
    expect(summary.textContent).toContain('작열');
    expect(summary.textContent).toContain('파츠');

    root.querySelector<HTMLButtonElement>('[data-reset-enemy]')!.click();

    expect(def.value).toBe('31784');
    expect(code.value).toBe('');
    expect(parts.checked).toBe(false);
    // 전투 조건이 창으로 들어간 뒤로 이 한 줄이 화면에 남는 유일한 표시다 —
    // 값만 되돌리고 줄을 그대로 두면 «초기화가 안 된다»로 보인다.
    expect(summary.textContent).not.toContain('작열');
    expect(summary.textContent).not.toContain('파츠');
    expect(summary.textContent).toContain('무속성');
  });

  it('받은 전투 조건 코드를 적용해도 조건 한 줄이 따라온다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });

    const summary = root.querySelector<HTMLElement>('[data-battle-summary]')!;
    expect(summary.textContent).toContain('무속성');

    root.querySelector<HTMLButtonElement>('[data-battle-share-open]')!.click();
    const input = root.querySelector<HTMLTextAreaElement>('[data-battle-share-in]')!;
    // 90초 · 적 전격
    input.value = encodeBattleCode(
      { ...decodeBattleCode('NK3-e30'), duration: 90, enemyCode: '전격' } as never,
    );
    root.querySelector<HTMLButtonElement>('[data-battle-share-apply]')!.click();

    expect(root.querySelector<HTMLInputElement>('#duration')!.value).toBe('90');
    expect(summary.textContent).toContain('전격');
    expect(summary.textContent).toContain('90초');
  });

  it('조합 공유는 「이 덱만」으로 열리고, 받은 덱 하나가 다른 덱을 지우지 않는다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });

    // 덱 1·3을 서로 다르게 채우고 5덱 모드를 켠다.
    const fill = (deckId: number, names: string[]) => {
      root.querySelector<HTMLInputElement>('#squad-mode')!.checked = true;
      const state = JSON.parse(localStorage.getItem('nikke-state-v1') ?? '{}');
      void state; void deckId; void names;
    };
    void fill;

    root.querySelector<HTMLButtonElement>('[data-share-open]')!.click();
    const scope = root.querySelector<HTMLElement>('[data-share-scope]')!;
    expect(scope).not.toBeNull();
    // 기본은 「이 덱만」이다 — 덱 하나를 옮기는 일이 판 전체를 옮기는 일보다 잦다.
    expect(scope.querySelector('.share-scope-pick.is-on')?.textContent).toBe('이 덱만');
    expect(root.querySelector('[data-share-scope-note]')?.textContent)
      .toContain('덱 1에만 들어갑니다');

    // 「5덱 전부」로 바꾸면 안내도 따라 바뀐다.
    root.querySelector<HTMLButtonElement>('[data-share-scope-pick="all"]')!.click();
    expect(scope.querySelector('.share-scope-pick.is-on')?.textContent).toBe('5덱 전부');
    expect(root.querySelector('[data-share-scope-note]')?.textContent)
      .toContain('판 전체가 바뀝니다');
  });

  it('프리셋은 어느 범위로 저장했는지 함께 알린다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });

    root.querySelector<HTMLButtonElement>('[data-share-open]')!.click();
    root.querySelector<HTMLInputElement>('[data-preset-name]')!.value = '한 덱짜리';
    root.querySelector<HTMLButtonElement>('[data-preset-save]')!.click();
    expect(root.querySelector('[data-share-msg]')?.textContent).toContain('덱 1만');

    root.querySelector<HTMLButtonElement>('[data-share-scope-pick="all"]')!.click();
    root.querySelector<HTMLInputElement>('[data-preset-name]')!.value = '판 전체';
    root.querySelector<HTMLButtonElement>('[data-preset-save]')!.click();
    expect(root.querySelector('[data-share-msg]')?.textContent).toContain('5덱 전부');

    const stored = JSON.parse(localStorage.getItem('nikke-presets-v1')!) as Array<{ name: string }>;
    expect(stored.map((item) => item.name).sort()).toEqual(['판 전체', '한 덱짜리']);
  });

  it('유니온 탭에는 판 전체를 한 코드로 주고받는 줄이 있다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
      blablaProxy: 'https://proxy.example',
    } as Parameters<typeof mountCalculator>[1] & { blablaProxy: string });

    expect(root.querySelector('[data-union-set-copy]')).not.toBeNull();
    expect(root.querySelector('[data-union-set-paste]')).not.toBeNull();
    expect(root.querySelector('[data-union-set-apply]')).not.toBeNull();
    // 명단이 담기지 않는다는 사실은 화면에 적혀 있어야 한다 — 남의 계정 정보다.
    const step = root.querySelector<HTMLElement>('[data-union-step="3"]')!;
    expect(step.textContent).toContain('유니온원 명단은 담기지 않습니다');
  });

  it('공유 서버 주소가 없으면 「공유에서 판 고르기」를 감춘다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
      blablaProxy: 'https://proxy.example',
    } as Parameters<typeof mountCalculator>[1] & { blablaProxy: string });

    // 시험 환경에는 VITE_SHARE_API가 없다 — 누를 수 없는 단추를 남기지 않는다.
    const button = root.querySelector<HTMLButtonElement>('[data-union-set-share]');
    expect(button?.hidden).toBe(true);
  });

  it('블라블라링크 연동 창은 자동을 기본값으로 공식 서버 다섯 곳을 보여 준다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
      blablaProxy: 'https://proxy.example',
    } as Parameters<typeof mountCalculator>[1] & { blablaProxy: string });

    root.querySelector<HTMLButtonElement>('[data-blabla-open]')!.click();
    const server = root.querySelector<HTMLSelectElement>('[data-blabla-server]');

    expect(server).not.toBeNull();
    expect(server!.value).toBe('');
    expect([...server!.options].map((option) => [option.value, option.textContent])).toEqual([
      ['', '자동 (보유 니케가 가장 많은 서버)'],
      ['83', '한국'],
      ['81', '일본'],
      ['84', '글로벌'],
      ['82', '북미'],
      ['85', '동남아'],
    ]);
  });

  it('선택한 서버를 Worker 요청과 완료 안내에 사용한다', async () => {
    let sentBody: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return Response.json({
        openid: '15361668407129878426',
        areas: [{
          area: 84,
          characters: [{ name_code: 5001, grade: 0, core: 0 }],
          details: [{ name_code: 5001 }],
          stateEffects: [],
          outpost: null,
        }],
      });
    });
    const blablaCatalog = catalog.map((entry) => ({
      ...entry,
      nameCode: entry.name === '리타' ? 5001 : null,
    }));
    mountCalculator(root, {
      catalog: blablaCatalog,
      settings,
      version: 'v1',
      client: new FakeClient(),
      storage: localStorage,
      blablaProxy: 'https://proxy.example',
    });

    root.querySelector<HTMLButtonElement>('[data-blabla-open]')!.click();
    const server = root.querySelector<HTMLSelectElement>('[data-blabla-server]')!;
    const url = root.querySelector<HTMLInputElement>('[data-blabla-url]')!;
    server.value = '84';
    url.value = 'https://www.blablalink.com/user?openid=15361668407129878426';
    root.querySelector<HTMLButtonElement>('[data-blabla-sync]')!.click();
    await flush();
    await flush();

    expect(sentBody).toEqual({ profileUrl: url.value, area: 84 });
    expect(root.querySelector<HTMLElement>('[data-blabla-status]')!.textContent)
      .toContain('글로벌 서버에서 1명을 불러왔습니다.');
  });

  it('sets breakthrough from the portrait star stepper and keeps the dropdown in sync', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const stepper = root.querySelector<HTMLElement>('[data-slot-card="0"] [data-growth-stepper]')!;
    const minus = stepper.querySelector<HTMLButtonElement>('[data-growth-step="minus"]')!;
    const plus = stepper.querySelector<HTMLButtonElement>('[data-growth-step="plus"]')!;
    const filled = () => stepper.querySelectorAll('.growth-star.is-on').length;
    const core = () => stepper.querySelector('.growth-core')?.textContent ?? null;

    // 기본값 3돌: 별 3개, 진화 0. 아직 오버라이드가 없어 드롭다운도 없다.
    expect(filled()).toBe(3);
    expect(core()).toBe('0');
    expect(root.querySelector('[data-slot-card="0"] [data-growth-stage]')).toBeNull();

    // + 한 번 → 코강 1. 별 3개 + 동그라미 "1", 개별 설정 드롭다운이 생겨 값이 맞는다.
    plus.click();
    expect(filled()).toBe(3);
    expect(core()).toBe('1');
    expect(root.querySelector<HTMLSelectElement>('[data-slot-card="0"] [data-growth-stage]')!.value).toBe('4');

    // 바닥까지 내리면 명함(0): 채워진 별 0개, − 비활성.
    // 진화 뱃지는 0으로 남는다 — 사라지면 별 줄 폭이 흔들린다.
    for (let i = 0; i < 6; i += 1) minus.click();
    expect(filled()).toBe(0);
    expect(core()).toBe('0');
    expect(minus.disabled).toBe(true);

    // 기본값(3돌)으로 되돌리면 오버라이드가 사라져 드롭다운도 없어진다.
    for (let i = 0; i < 3; i += 1) plus.click();
    expect(filled()).toBe(3);
    expect(root.querySelector('[data-slot-card="0"] [data-growth-stage]')).toBeNull();
  });

  it('keeps the star art from swallowing clicks on the stepper buttons', () => {
    // 별·진화 그림은 칸보다 크게 그려 −/+ 위로 넘친다. pointer-events를 놓치면
    // 버튼 한가운데가 안 눌린다 (유저 제보).
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const stepper = root.querySelector<HTMLElement>('[data-slot-card="0"] [data-growth-stepper]')!;
    for (const decoration of ['.growth-stars', '.growth-star', '.growth-core']) {
      expect(stepper.querySelector(decoration), decoration).not.toBeNull();
    }
    // jsdom은 pointer-events 캐스케이드를 계산하지 않는다 — 규칙 자체를 확인한다.
    const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');
    expect(css).toMatch(
      /\.growth-stars,\s*\.growth-star,\s*\.growth-core\s*\{\s*pointer-events:\s*none;/,
    );
  });

  it('shows the element code icon on squad cards and roster cells', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });

    // 편성 카드는 좌상단 — 슬롯 번호와 한 줄에 선다.
    const tags = root.querySelector<HTMLElement>('[data-slot-card="0"] .slot-tags')!;
    expect(tags.querySelector('.slot-number')!.textContent).toBe('01');
    // 리타는 철갑.
    expect(tags.querySelector('.slot-code')!.className).toContain('is-iron');

    // 고르기 판은 우상단. 전원에게 붙고 속성별로 갈린다.
    const cells = [...root.querySelectorAll<HTMLElement>('[data-roster-cell]')];
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((cell) => cell.querySelector('.roster-code'))).toBe(true);
    const iconOf = (name: string) => root
      .querySelector(`[data-roster-cell="${name}"] .roster-code`)!.className;
    expect(iconOf('라피 : 레드 후드')).toContain('is-fire');     // 작열
    expect(iconOf('앨리스')).toContain('is-water');              // 수냉
    expect(iconOf('나가')).toContain('is-electronic');           // 전격
  });

  it('sends the optimal-range weapon types and restores them on reload', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });

    // 기본은 아무 무기군도 적정거리가 아니다 — 요청에서 아예 빠진다.
    // 런처는 인게임에 적정 사거리가 없어 칸 자체가 없다.
    const boxes = [...root.querySelectorAll<HTMLInputElement>('[data-optimal-range-weapon]')];
    expect(boxes.map((box) => box.dataset.optimalRangeWeapon))
      .toEqual(['AR', 'SMG', 'SG', 'MG', 'SR']);
    expect(boxes.every((box) => !box.checked)).toBe(true);

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    expect(client.lastRequest?.optimalRangeWeapons).toBeUndefined();

    // 여러 개를 함께 켤 수 있다.
    const check = (weapon: string) => {
      const box = root.querySelector<HTMLInputElement>(`[data-optimal-range-weapon="${weapon}"]`)!;
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    };
    check('SG');
    check('AR');
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    // 고른 순서와 무관하게 정렬돼 실린다 — 같은 설정이 다른 캐시 키를 만들지 않게.
    expect(client.lastRequest?.optimalRangeWeapons).toEqual(['AR', 'SG']);

    // 새로고침해도 남는다.
    root.remove();
    root = document.createElement('main');
    document.body.append(root);
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const restored = [...root.querySelectorAll<HTMLInputElement>('[data-optimal-range-weapon]')]
      .filter((box) => box.checked)
      .map((box) => box.dataset.optimalRangeWeapon);
    expect(restored).toEqual(['AR', 'SG']);
  });

  it('keeps buff targets across a reload, and drops them when the squad changes', async () => {
    // 수령자는 실제 발동 로그에서 오므로 계산 전에는 알 수 없다. 새로고침할 때마다
    // 빈 괄호로 돌아가면 기능이 꺼진 것처럼 보이므로 저장했다가 되살린다.
    const withTargets: SimulationResult = {
      ...calculated,
      buffTargets: { 리타: [{ label: '크확 대상', buff: '웨이크업! 4', targets: ['크라운'], count: 3 }] },
    };
    class TargetClient extends FakeClient {
      override async simulate(request: SimulationRequest): Promise<SimulationResult> {
        await super.simulate(request);
        return withTargets;
      }
    }
    // 리타는 기본 편성 1번 칸에 있다 — 감시 대상으로 잡아 둔 캐릭터다.
    mountCalculator(root, { catalog, settings, version: 'v1', client: new TargetClient(), storage: localStorage });
    const shown = () => root.querySelector<HTMLElement>('[data-buff-target]')?.textContent;
    expect(shown()).toBe('크확 대상 : []');

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    await flush();
    expect(shown()).toBe('크확 대상 : [크라운]');

    // 새로 마운트해도(=새로고침) 남는다.
    root.remove();
    root = document.createElement('main');
    document.body.append(root);
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    expect(shown()).toBe('크확 대상 : [크라운]');

    // 편성을 바꾸면 지난 계산의 값이라 그대로 믿을 수 없다 — 비운다.
    chooseCharacter(root, 1, '프리바티');
    expect(shown()).toBe('크확 대상 : []');
  });

  const chip = (root: HTMLElement, key: string, value: string) =>
    root.querySelector<HTMLButtonElement>(`[data-filter-chip="${key}:${value}"]`)!;

  it('filters the picker down to SSR only', () => {
    // SR·R은 실전에서 거의 안 쓴다 — 목록에서 걷어낸다(유저 피드백).
    const withSR: SettingsCatalog = {
      ...settings,
      characters: { ...settings.characters, 나가: { ...settings.characters.나가!, rarity: 'SR' } },
    };
    mountCalculator(root, { catalog, settings: withSR, version: 'v1', client: new FakeClient(), storage: localStorage });
    expect(rosterNames(root)).toContain('나가');
    chip(root, 'rarity', 'SSR').click();
    expect(rosterNames(root)).not.toContain('나가');
    // 같은 칩을 다시 누르면 꺼진다 — 「전체」 칩이 따로 없다.
    chip(root, 'rarity', 'SSR').click();
    expect(rosterNames(root)).toContain('나가');
  });

  it('ORs within a filter group and ANDs across groups', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    // 무기 둘을 켜면 둘 중 하나면 통과한다(그룹 안 OR).
    chip(root, 'weapon', 'SR').click();
    chip(root, 'weapon', 'AR').click();
    expect(rosterNames(root).sort()).toEqual(['앨리스', '프리바티']);

    // 거기에 속성을 더하면 둘 다 만족해야 한다(그룹 사이 AND).
    chip(root, 'code', '수냉').click();
    expect(rosterNames(root).sort()).toEqual(['앨리스', '프리바티']);
    chip(root, 'code', '수냉').click();
    chip(root, 'code', '작열').click();
    expect(rosterNames(root)).toEqual([]);
  });

  it('counts the active filters and clears them all at once', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const badge = root.querySelector<HTMLElement>('[data-filter-badge]')!;
    const reset = root.querySelector<HTMLButtonElement>('[data-filter-reset]')!;
    expect(badge.hidden).toBe(true);
    expect(reset.hidden).toBe(true);

    chip(root, 'weapon', 'SR').click();
    chip(root, 'class', '화력형').click();
    expect(badge.textContent).toBe('2');
    expect(reset.hidden).toBe(false);

    reset.click();
    expect(badge.hidden).toBe(true);
    expect(rosterNames(root).length).toBe(catalog.length);
  });

  it('sorts by overload value, breaking ties by name', () => {
    // 우월코드·우공합은 «내 로스터에서 얼마나 굴려졌나»를 보는 척도다.
    const over = (element: number, atk: number) => ({
      element_bonus: element, atk_pct: atk, max_ammo_pct: 0, crit_rate: 0, crit_dmg: 0,
    });
    const tuned: SettingsCatalog = {
      ...settings,
      characters: {
        ...settings.characters,
        리타: { ...settings.characters.리타!, overload: over(10, 90) },
        앨리스: { ...settings.characters.앨리스!, overload: over(50, 0) },
        나가: { ...settings.characters.나가!, overload: over(30, 5) },
      },
    };
    mountCalculator(root, { catalog, settings: tuned, version: 'v1', client: new FakeClient(), storage: localStorage });

    // 기본은 이름순.
    expect(rosterNames(root)).toEqual([...rosterNames(root)].sort((a, b) => a.localeCompare(b, 'ko')));

    root.querySelector<HTMLButtonElement>('[data-sort="element"]')!.click();
    const byElement = rosterNames(root);
    expect(byElement.indexOf('앨리스')).toBeLessThan(byElement.indexOf('나가'));
    expect(byElement.indexOf('나가')).toBeLessThan(byElement.indexOf('리타'));

    // 우공합은 공증까지 더하므로 리타(10+90=100)가 앨리스(50)를 앞선다.
    root.querySelector<HTMLButtonElement>('[data-sort="elementAtk"]')!.click();
    const bySum = rosterNames(root);
    expect(bySum.indexOf('리타')).toBeLessThan(bySum.indexOf('앨리스'));
  });

  it('flips the sort when the same option is clicked again, and shows which way', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const sortChip = (key: string) =>
      root.querySelector<HTMLButtonElement>(`[data-sort="${key}"]`)!;

    // 이름은 오름차순으로 시작한다.
    sortChip('name').click();
    expect(sortChip('name').dataset.sortDir).toBe('asc');
    expect(sortChip('name').textContent).toContain('▲');
    const asc = rosterNames(root);

    // 같은 항목을 다시 누르면 뒤집힌다.
    sortChip('name').click();
    expect(sortChip('name').dataset.sortDir).toBe('desc');
    expect(sortChip('name').textContent).toContain('▼');
    expect(rosterNames(root)).toEqual([...asc].reverse());

    // 수치 항목은 «높은 순»으로 시작한다 — 항목마다 자연스러운 방향이 다르다.
    sortChip('element').click();
    expect(sortChip('element').dataset.sortDir).toBe('desc');
    // 켜지지 않은 항목에는 삼각형이 없다.
    expect(sortChip('name').textContent).not.toContain('▲');
    expect(sortChip('name').textContent).not.toContain('▼');
  });

  it('opens on combat power, standing by name until the engine answers', async () => {
    // 전투력은 엔진이 계산해 온다. 그 사이에도 목록은 쓸 수 있어야 한다.
    let answer!: (power: Record<string, number>) => void;
    class PowerClient extends FakeClient {
      names: string[] = [];
      async combatPower(request: CombatPowerRequest): Promise<Record<string, number>> {
        this.names = request.names;
        return new Promise((resolve) => { answer = resolve; });
      }
    }
    const client = new PowerClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    const summary = () => root.querySelector<HTMLElement>('[data-filter-summary]')!.textContent;

    expect(root.querySelector<HTMLButtonElement>('[data-sort="power"]')!.dataset.sortDir).toBe('desc');
    // 오는 동안은 이름순으로 서 있고, 요약이 기다리는 중임을 알린다.
    expect(summary()).toContain('전투력 계산중');
    expect(rosterNames(root)).toEqual([...rosterNames(root)].sort((a, b) => a.localeCompare(b, 'ko')));

    await flush();
    expect(client.names).toEqual(catalog.map((meta) => meta.name));
    answer({ 나가: 30, 리타: 10, 앨리스: 50 });
    await flush();

    expect(summary()).toContain('전투력 ▼');
    const byPower = rosterNames(root);
    expect(byPower.indexOf('앨리스')).toBeLessThan(byPower.indexOf('나가'));
    expect(byPower.indexOf('나가')).toBeLessThan(byPower.indexOf('리타'));
  });

  it('lays the filter panel over the list and closes it like a dropdown', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const open = root.querySelector<HTMLButtonElement>('[data-filter-open]')!;
    const panel = root.querySelector<HTMLElement>('[data-filter-panel]')!;
    const scroll = root.querySelector<HTMLElement>('.picker-scroll')!;

    // 판과 목록이 같은 자리 컨테이너에 나란히 있어야 판을 목록 «위에» 얹을 수 있다.
    expect(panel.parentElement).toBe(scroll.parentElement);
    expect(panel.parentElement!.classList.contains('picker-body')).toBe(true);

    expect(panel.hidden).toBe(true);
    open.click();
    expect(panel.hidden).toBe(false);

    // 판 안과 판을 여는 줄은 «바깥»이 아니다 — 눌러도 닫히지 않는다.
    panel.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    root.querySelector<HTMLElement>('.picker-bar')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(panel.hidden).toBe(false);

    // 바깥을 누르면 닫힌다.
    scroll.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(open.getAttribute('aria-expanded')).toBe('false');

    // Esc로도 닫힌다.
    open.click();
    expect(panel.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.hidden).toBe(true);
  });

  it('keeps burst chips outside the panel, next to the button that opens it', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const bar = root.querySelector<HTMLElement>('.picker-bar')!;
    const burst = [...bar.querySelectorAll<HTMLButtonElement>('[data-burst-group] .filter-chip')];
    expect(burst.map((chipEl) => chipEl.textContent)).toEqual(['B1', 'B2', 'B3', 'BA']);
    // 판 안에는 더 이상 버스트가 없다.
    expect(root.querySelector('[data-filter-groups] [data-filter-chip^="burst"]')).toBeNull();

    // 판을 펼치지 않고 바로 걸린다.
    expect(root.querySelector<HTMLElement>('[data-filter-panel]')!.hidden).toBe(true);
    const b3 = catalog.filter((meta) => meta.burstStage === '3').map((meta) => meta.name);
    chip(root, 'burst', '3').click();
    expect(rosterNames(root).sort()).toEqual([...b3].sort());
    expect(root.querySelector('[data-filter-badge]')!.textContent).toBe('1');
    expect(root.querySelector('[data-filter-summary]')!.textContent).toContain('B3');

    chip(root, 'burst', '3').click();
    expect(rosterNames(root).length).toBe(catalog.length);
  });

  it('drops the favorite-item filter', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    expect(root.querySelector('[data-filter-chip^="favorite"]')).toBeNull();
    const titles = [...root.querySelectorAll('[data-filter-groups] .filter-title')]
      .map((title) => title.textContent);
    expect(titles).toEqual(['등급', '클래스', '코드', '무기', '기업']);
  });

  it('sends the synchro level from the battle panel, and keeps it out of shared codes', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    const level = root.querySelector<HTMLInputElement>('#synchro-level')!;
    // 기본은 엔진 기본 스펙과 같은 400이다.
    expect(level.value).toBe('400');

    level.value = '250';
    level.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(client.lastRequest?.synchroLevel).toBe(250);

    // 공유 코드에는 담기지 않는다 — 콘솔과 같은 계정 육성 상태다.
    root.querySelector<HTMLButtonElement>('[data-battle-share-open]')!.click();
    const code = root.querySelector<HTMLTextAreaElement>('[data-battle-share-out]')!.value;
    root.querySelector<HTMLTextAreaElement>('[data-battle-share-in]')!.value = code;
    level.value = '700';
    root.querySelector<HTMLButtonElement>('[data-battle-share-apply]')!.click();
    // 남의 조건을 얹어도 내 레벨은 그대로다.
    expect(root.querySelector<HTMLInputElement>('#synchro-level')!.value).toBe('700');
  });

  it('shows the update notice once, and not again after it is closed', () => {
    // 처음 온 사람에게는 뜬다.
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const modal = () => root.querySelector<HTMLElement>('[data-notice-modal]')!;
    expect(modal().hidden).toBe(false);
    expect(root.querySelectorAll('[data-notice]').length).toBeGreaterThan(0);

    root.querySelector<HTMLButtonElement>('[data-notice-dismiss]')!.click();
    expect(modal().hidden).toBe(true);
    expect(localStorage.getItem('nikke-notice-seen')).toBe(LATEST_NOTICE_ID);

    // 다시 들어와도 뜨지 않는다.
    root.remove();
    root = document.createElement('main');
    document.body.append(root);
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    expect(root.querySelector<HTMLElement>('[data-notice-modal]')!.hidden).toBe(true);
    // 그래도 언제든 다시 열어 볼 수 있다.
    root.querySelector<HTMLButtonElement>('[data-notice-open]')!.click();
    expect(root.querySelector<HTMLElement>('[data-notice-modal]')!.hidden).toBe(false);
  });

  it('shows the notice again when a newer one is published', () => {
    // 옛 공지까지만 본 사람에게는 새 공지가 다시 뜬다.
    localStorage.setItem('nikke-notice-seen', '2000-01-01');
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    expect(root.querySelector<HTMLElement>('[data-notice-modal]')!.hidden).toBe(false);
  });

  it('자세히 보기를 켜면 대미지를 1의 자리까지 적는다', async () => {
    // 「1.24억」은 견주기에 좋지만 두 덱이 같은 글자로 보이는 일이 있다.
    // 줄여 쓰기는 백만이 넘어야 시작되므로, 그 위의 수치를 내는 대역으로 잰다.
    const big: SimulationResult = {
      ...calculated,
      squadTotal: 124_381_927,
      charTotals: {
        리타: 60_000_000, 크라운: 30_000_000, '라피 : 레드 후드': 20_000_000,
        앨리스: 10_000_000, 나가: 4_381_927,
      },
    };
    class BigClient extends FakeClient {
      override async simulate(request: SimulationRequest): Promise<SimulationResult> {
        await super.simulate(request);
        return big;
      }
    }
    mountCalculator(root, { catalog, settings, version: 'v1', client: new BigClient(), storage: localStorage });
    root.querySelector<HTMLButtonElement>('[data-notice-dismiss]')!.click();
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    await flush();

    // 이 대역의 총딜(123,456)은 줄여 쓰는 문턱 아래라 두 표기가 같다. 자세히 보기가
    // 실제로 갈리는 자리는 억 단위가 넘는 캐릭터별 수치이므로 그쪽을 본다.
    const rowTotal = () => root.querySelector<HTMLElement>('.result-row-total, .result-cards strong')?.textContent ?? '';
    const box = root.querySelector<HTMLInputElement>('[data-detail-damage]')!;
    expect(box.checked).toBe(false);
    const short = rowTotal();
    expect(short).toMatch(/억$/);                  // 켜기 전에는 줄여 쓴다
    box.click();
    const exact = rowTotal();
    expect(exact).not.toBe(short);
    expect(exact).toMatch(/^[\d,]+$/);            // 쉼표만 든 정수 — 「억」이 붙지 않는다
    expect(Number(exact.replace(/,/g, ''))).toBeGreaterThan(0);

    // 켠 상태는 남는다 — 다시 열어도 그 눈으로 본다.
    expect(localStorage.getItem('nikke-detail-damage-v1')).toBe('1');
    root.querySelector<HTMLInputElement>('[data-detail-damage]')!.click();
    expect(rowTotal()).toBe(short);
    expect(localStorage.getItem('nikke-detail-damage-v1')).toBe('0');
  });

  it('keeps the control fold open and live inside the card', async () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    root.querySelector<HTMLButtonElement>('[data-notice-dismiss]')!.click();
    const card = root.querySelector<HTMLElement>('[data-slot-card="0"]')!;
    card.querySelector<HTMLInputElement>('[data-custom-toggle]')!.click();
    card.querySelector<HTMLButtonElement>('[data-control-open]')!.click();

    // 컨트롤은 창으로 나가지 않는다 — 카드 안에서 펴진다.
    expect(root.querySelector('[data-char-panel-body] [data-control-mode]')).toBeNull();
    const inCard = (selector: string) =>
      root.querySelector<HTMLInputElement>(`[data-slot-card="0"] ${selector}`);
    expect(inCard('[data-control-panel]')!.hidden).toBe(false);
    // 처음엔 «추천 자동 적용»이라 체크박스가 잠겨 있다.
    expect(inCard('[data-control="reload"]')!.disabled).toBe(true);

    // «직접 설정»을 고르면 카드가 다시 그려진다 — 펴 둔 판은 그대로 살아 있어야 한다.
    inCard('[data-control-mode="manual"]')!.click();
    await Promise.resolve();
    expect(inCard('[data-control-panel]')!.hidden).toBe(false);
    expect(inCard('[data-control="reload"]')!.disabled).toBe(false);
    // 그리고 그 체크박스가 실제로 먹는다.
    inCard('[data-control="reload"]')!.click();
    await Promise.resolve();
    expect(inCard('[data-control="reload"]')!.checked).toBe(true);
  });

  it('does not yank the page back to the squad when results arrive', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    root.querySelector<HTMLButtonElement>('[data-notice-dismiss]')!.click();
    // jsdom에는 scrollIntoView가 없다 — 누가 불렀는지 보려고 심는다.
    const pulled: string[] = [];
    const proto = Element.prototype as unknown as { scrollIntoView?: () => void };
    proto.scrollIntoView = function record(this: HTMLElement) {
      if (this.dataset.slotChoose) pulled.push(this.dataset.slotChoose);
    };
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    try {
      // 칸을 직접 누르면 끌어온다 — 좁은 화면에서 겨냥한 칸이 밖에 있을 수 있다.
      root.querySelector<HTMLButtonElement>('[data-slot-choose="2"]')!.click();
      await frame();
      expect(pulled).toContain('2');

      // 결과가 도착해 편성이 다시 그려질 때는 끌어오지 않는다.
      pulled.length = 0;
      root.querySelector<HTMLFormElement>('form')!.requestSubmit();
      await flush();
      await frame();
      expect(root.querySelectorAll('[data-character-result]').length).toBeGreaterThan(0);
      expect(pulled).toEqual([]);
    } finally {
      delete proto.scrollIntoView;
    }
  });

  it('empties just the deck being viewed', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    expect(root.querySelectorAll('[data-slot-choose] strong')[0]!.textContent).toBe('리타');
    root.querySelector<HTMLButtonElement>('[data-deck-clear]')!.click();
    expect([...root.querySelectorAll('[data-slot-choose] strong')].map((e) => e.textContent))
      .toEqual(['빈 칸', '빈 칸', '빈 칸', '빈 칸', '빈 칸']);
  });

  it('brings the deck you were viewing to deck 1 when five-deck mode is turned off', () => {
    // 2~5덱 중 하나만 계산하려고 끄는 경우가 많다 — 그때마다 손으로 옮기지 않게 한다.
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const mode = root.querySelector<HTMLInputElement>('#squad-mode')!;
    mode.checked = true;
    mode.dispatchEvent(new Event('change'));
    root.querySelector<HTMLButtonElement>('[data-deck-tab="3"]')!.click();
    chooseCharacter(root, 0, '프리바티');
    const viewing = [...root.querySelectorAll('[data-slot-choose] strong')].map((e) => e.textContent);

    mode.checked = false;
    mode.dispatchEvent(new Event('change'));
    expect([...root.querySelectorAll('[data-slot-choose] strong')].map((e) => e.textContent))
      .toEqual(viewing);
  });

  it('swaps deck contents in place, keeping the numbers as fixed slots', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const mode = root.querySelector<HTMLInputElement>('#squad-mode')!;
    mode.checked = true;
    mode.dispatchEvent(new Event('change'));
    const shown = () => [...root.querySelectorAll('[data-slot-choose] strong')].map((e) => e.textContent);
    const deck1 = shown();

    // 1덱에서는 «앞으로»가 막혀 있다.
    expect(root.querySelector<HTMLButtonElement>('[data-deck-move="-1"]')!.disabled).toBe(true);

    root.querySelector<HTMLButtonElement>('[data-deck-tab="2"]')!.click();
    const deck2 = shown();
    root.querySelector<HTMLButtonElement>('[data-deck-move="-1"]')!.click();
    // 내용만 맞바뀌고, 보던 편성을 따라간다.
    expect(shown()).toEqual(deck2);
    root.querySelector<HTMLButtonElement>('[data-deck-tab="2"]')!.click();
    expect(shown()).toEqual(deck1);
  });

  it('gives each slot a target button instead of a dropdown, and one shared picker', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const choosers = [...root.querySelectorAll<HTMLButtonElement>('[data-slot-choose]')];

    expect(choosers).toHaveLength(5);
    expect(choosers.map((c) => c.querySelector('strong')!.textContent)).toEqual(names.slice(0, 5));
    // 슬롯마다 있던 검색·드롭다운·교체 버튼은 판으로 옮겨 갔다.
    expect(root.querySelectorAll('[data-character-filter]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-squad-slot]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-slot-pick]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-roster-search]')).toHaveLength(1);
    expect(root.querySelector<HTMLAnchorElement>('footer a')?.href).toBe('https://github.com/Moris-kr/nikke-calc');
  });

  it('marks the slot the picker is aiming at, and moves on after a pick', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const aimed = () => [...root.querySelectorAll<HTMLButtonElement>('[data-slot-choose]')]
      .findIndex((c) => c.getAttribute('aria-pressed') === 'true');

    clearCharacterSlot(root, 2);
    expect(aimed()).toBe(2);

    // 프리바티만 초기 편성 밖이라 눌린다 — 나머지는 중복이라 막혀 있다.
    searchRoster(root, '프리바티');
    root.querySelector<HTMLButtonElement>('[data-roster-cell="프리바티"]')!.click();

    const saved = JSON.parse(localStorage.getItem('nikke-state-v1')!);
    expect(saved.decks[0].squad[2]).toBe('프리바티');
    // 다 찼으므로 방금 넣은 칸에 머문다.
    expect(aimed()).toBe(2);
  });

  it('blocks a nikke already in this deck, except in the slot being replaced', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    focusSlot(root, 1);

    expect(root.querySelector<HTMLButtonElement>('[data-roster-cell="리타"]')!.disabled).toBe(true);

    // 리타가 앉아 있는 칸을 겨냥하면 그 칸에 한해 다시 고를 수 있다.
    focusSlot(root, 0);
    expect(root.querySelector<HTMLButtonElement>('[data-roster-cell="리타"]')!.disabled).toBe(false);
  });

  // 곁가지(속성·무기·클래스·기업)로 걸린 것끼리는 짧은 이름이 앞이다.
  it.each([
    ['B2', ['나가', '크라운']],
    ['수냉', ['앨리스', '프리바티']],
    ['mg', ['리타', '크라운', '라피 : 레드 후드']],
    ['화력형', ['앨리스', '프리바티', '라피 : 레드 후드']],
    ['엘리시온', ['프리바티', '라피 : 레드 후드']],
    ['sR', ['앨리스']],
  ])('narrows the picker by character metadata query %s case-insensitively', (query, expected) => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    searchRoster(root, query);
    expect(rosterNames(root)).toEqual(expected);
  });

  it('puts the typed name first, and reads 초성 and names without separators', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });

    searchRoster(root, 'ㄹㅍ');
    // 「라피 : 레드 후드」와 「리타」가 함께 걸려도 이름 첫머리가 앞선다.
    expect(rosterNames(root)[0]).toBe('라피 : 레드 후드');

    searchRoster(root, '라피레드');
    expect(rosterNames(root)).toEqual(['라피 : 레드 후드']);
  });

  it('keeps the aimed slot when the deck changes, and aims at that deck first empty', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const mode = root.querySelector<HTMLInputElement>('#squad-mode')!;
    mode.checked = true;
    mode.dispatchEvent(new Event('change'));

    root.querySelector<HTMLButtonElement>('[data-deck-tab="2"]')!.click();
    const aimed = [...root.querySelectorAll<HTMLButtonElement>('[data-slot-choose]')]
      .findIndex((c) => c.getAttribute('aria-pressed') === 'true');
    expect(aimed).toBe(0);   // 빈 덱이니 첫 칸
  });

  it('swaps a nikke with the neighbouring slot', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const slots = () => [...root.querySelectorAll<HTMLButtonElement>('[data-slot-choose]')]
      .map((c) => c.querySelector('strong')!.textContent);
    const before = slots();

    root.querySelector<HTMLButtonElement>('[data-slot-move="0:1"]')!.click();

    const after = slots();
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    expect(after.slice(2)).toEqual(before.slice(2));

    root.querySelector<HTMLButtonElement>('[data-slot-move="1:-1"]')!.click();
    expect(slots()).toEqual(before);
  });

  it('disables the move that would run past either end', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });

    expect(root.querySelector<HTMLButtonElement>('[data-slot-move="0:-1"]')!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-slot-move="0:1"]')!.disabled).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('[data-slot-move="4:1"]')!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-slot-move="4:-1"]')!.disabled).toBe(false);
  });

  it('keeps per-character settings with the nikke, not with the slot', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const moved = root.querySelector<HTMLButtonElement>('[data-slot-choose="0"]')!
      .querySelector('strong')!.textContent!;
    // 0번 캐릭터에 개별 설정을 준다.
    const toggle = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    root.querySelector<HTMLButtonElement>('[data-slot-move="0:1"]')!.click();

    // 설정은 이름에 매여 있으므로 자리를 옮겨도 그 캐릭터를 따라간다.
    const saved = JSON.parse(localStorage.getItem('nikke-state-v1')!);
    expect(saved.decks[0].squad[1]).toBe(moved);
    expect(saved.decks[0].characters[moved]).toBeDefined();
  });

  it('copies the active deck squad and settings into the chosen decks', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const mode = root.querySelector<HTMLInputElement>('#squad-mode')!;
    mode.checked = true;
    mode.dispatchEvent(new Event('change'));

    // 덱 2는 미리 채워 둔다 — 덮어쓰기 대상은 기본 선택되지 않아야 한다.
    root.querySelector<HTMLButtonElement>('[data-deck-tab="2"]')!.click();
    chooseCharacter(root, 0, '앨리스');
    root.querySelector<HTMLButtonElement>('[data-deck-tab="1"]')!.click();

    root.querySelector<HTMLButtonElement>('[data-deck-copy-open]')!.click();
    const targets = [...root.querySelectorAll<HTMLInputElement>('[data-deck-copy-target]')];
    expect(targets.map((box) => box.dataset.deckCopyTarget)).toEqual(['2', '3', '4', '5']);
    expect(targets[0]!.checked).toBe(false);
    expect(targets.slice(1).every((box) => box.checked)).toBe(true);

    // 이미 짜둔 덱 2까지 명시적으로 골라 덮어쓴다.
    targets[0]!.checked = true;
    const deckOne = [...root.querySelectorAll<HTMLSelectElement>('[data-squad-slot]')].map((slot) => slot.value);
    root.querySelector<HTMLButtonElement>('[data-deck-copy-apply]')!.click();

    for (const id of ['2', '3', '4', '5']) {
      root.querySelector<HTMLButtonElement>(`[data-deck-tab="${id}"]`)!.click();
      expect([...root.querySelectorAll<HTMLSelectElement>('[data-squad-slot]')].map((slot) => slot.value))
        .toEqual(deckOne);
    }
    expect(root.querySelector<HTMLElement>('[data-deck-copy-panel]')!.hidden).toBe(true);
  });

  it('refuses to copy a deck when no target is selected', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const mode = root.querySelector<HTMLInputElement>('#squad-mode')!;
    mode.checked = true;
    mode.dispatchEvent(new Event('change'));

    root.querySelector<HTMLButtonElement>('[data-deck-copy-open]')!.click();
    for (const box of root.querySelectorAll<HTMLInputElement>('[data-deck-copy-target]')) box.checked = false;
    root.querySelector<HTMLButtonElement>('[data-deck-copy-apply]')!.click();

    expect(root.querySelector<HTMLElement>('[data-errors]')!.textContent)
      .toContain('복사할 대상 덱을 하나 이상 선택하세요');
    expect(root.querySelector<HTMLElement>('[data-deck-copy-panel]')!.hidden).toBe(false);
  });

  it('breaks the enikk player list into pages of ten', () => {
    const players = Array.from({ length: 25 }, (_, i) => ({
      rank: i + 1, playerid: `p${i}`, server: 'KR', damage: 1000 - i, cp: 0,
      decks: [{ squad: names.slice(0, 5), damage: 100, cp: 0, usable: true }],
    }));
    localStorage.setItem('nikke-enikk-v2', JSON.stringify({
      season: { raid: 40, boss: 'Test', weakness: 'Fire' },
      players, decks: 25, unknownNames: [], unsupported: 0,
    }));

    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    root.querySelector<HTMLButtonElement>('[data-view-tab="enikk"]')!.click();

    // 25명이면 3쪽, 첫 쪽은 열 명.
    expect(root.querySelectorAll('.enikk-player')).toHaveLength(10);
    expect(root.querySelector('.enikk-page-info')!.textContent).toBe('3쪽 중 1쪽');

    // 마지막 쪽은 다섯 명만 남는다.
    const last = [...root.querySelectorAll<HTMLButtonElement>('.enikk-page')]
      .find((b) => b.textContent === '3')!;
    last.click();
    expect(root.querySelectorAll('.enikk-player')).toHaveLength(5);
    expect(root.querySelector('.enikk-page-info')!.textContent).toBe('3쪽 중 3쪽');
  });

  it('ignores an enikk cache left by an older shape instead of crashing', () => {
    // v1은 `players`가 숫자였다. 그 값을 새 코드가 배열로 읽으면 터진다.
    localStorage.setItem('nikke-enikk-v1', JSON.stringify({ players: 300, comps: [] }));
    localStorage.setItem('nikke-enikk-v2', JSON.stringify({ players: 300, comps: [] }));

    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    root.querySelector<HTMLButtonElement>('[data-view-tab="enikk"]')!.click();

    // 낡은 캐시를 무시하고 «가져오기» 버튼이 그대로 남는다.
    expect(root.querySelector<HTMLButtonElement>('[data-enikk-load]')!.hidden).toBe(false);
    expect(root.querySelectorAll('.enikk-player')).toHaveLength(0);
  });

  it('drops the AI/no-server badges and states the supported count plainly', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const trust = root.querySelector<HTMLElement>('.trust-row')!;

    expect(trust.textContent).not.toContain('AI 없음');
    expect(trust.textContent).not.toContain('서버 전송 없음');
    expect(trust.textContent).toContain(`${catalog.length}명 지원`);
    // 판이 늘 펼쳐져 있으니 열 버튼이 없다.
    expect(root.querySelector('[data-roster-open]')).toBeNull();
  });

  it('credits the upstream algorithm next to the supported count', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const credit = root.querySelector<HTMLAnchorElement>('.trust-row .credit-link')!;

    expect(credit.textContent).toBe('원본 알고리즘 개발자에게 무한한 감사를');
    expect(credit.href).toBe('https://github.com/Jgaram/nikke-calc');
    // 새 탭으로 열되 opener를 넘기지 않는다.
    expect(credit.target).toBe('_blank');
    expect(credit.rel).toContain('noopener');
  });

  it('keeps the picker grid open under the squad, with no modal to dismiss', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });

    expect(root.querySelector('[data-roster-modal]')).toBeNull();
    expect(root.querySelectorAll('[data-roster-cell]')).toHaveLength(catalog.length);
    expect(root.querySelector('[data-roster-count]')!.textContent).toBe(`${catalog.length}명`);

    searchRoster(root, '라피');
    expect(rosterNames(root)).toEqual(['라피 : 레드 후드']);
    expect(root.querySelector('[data-roster-count]')!.textContent).toBe(`1 / ${catalog.length}명`);

    searchRoster(root, '없는이름');
    expect(root.querySelectorAll('[data-roster-cell]')).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('[data-roster-empty]')!.hidden).toBe(false);

    searchRoster(root, '');
    expect(root.querySelectorAll('[data-roster-cell]')).toHaveLength(catalog.length);
  });

  it('wipes every stored key and reloads only after the reset is confirmed', () => {
    let reloads = 0;
    localStorage.setItem('nikke-roster-v1', '{"리타":{}}');
    localStorage.setItem('nikke-custom-v1', JSON.stringify({
      테스트니케: {
        name: '테스트니케',
        nikke: {
          rarity: 'SSR', element_code: '철갑', class: '화력형', weapon_type: 'AR',
          burst_stage: '3', burst_cooldown: 40, max_ammo: 60, reload_time: 1,
          fire_rate: 10, damage_coeff: 13.65, core_dmg_mult: 200,
        },
        skills: [],
      },
    }));
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
      reload: () => { reloads += 1; },
    });
    // 편성 상태를 남겨 초기화 대상이 실제로 존재하게 한다.
    chooseCharacter(root, 0, '프리바티');
    expect(localStorage.getItem('nikke-state-v1')).not.toBeNull();

    const modal = root.querySelector<HTMLElement>('[data-reset-modal]')!;
    root.querySelector<HTMLButtonElement>('[data-reset-all]')!.click();
    expect(modal.hidden).toBe(false);

    // 취소하면 아무것도 지우지 않는다.
    root.querySelector<HTMLButtonElement>('[data-reset-cancel]')!.click();
    expect(modal.hidden).toBe(true);
    expect(reloads).toBe(0);
    expect(localStorage.getItem('nikke-state-v1')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('[data-reset-all]')!.click();
    root.querySelector<HTMLButtonElement>('[data-reset-confirm]')!.click();

    expect(localStorage.getItem('nikke-state-v1')).toBeNull();
    expect(localStorage.getItem('nikke-roster-v1')).toBeNull();
    expect(localStorage.getItem('nikke-custom-v1')).toBeNull();
    expect(reloads).toBe(1);
    expect(modal.hidden).toBe(true);
  });

  it('keeps five-deck tabs visually hidden until the mode is enabled', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const tabs = root.querySelector<HTMLElement>('[data-deck-tabs]')!;
    expect(tabs.hidden).toBe(true);
    expect(getComputedStyle(tabs).display).toBe('none');
    const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  });

  it('sends the burst gauge charge time and restores it on reload', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });

    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    expect(client.lastRequest?.burstRegenTime).toBe(2);

    const regen = root.querySelector<HTMLInputElement>('#burst-regen')!;
    regen.value = '2.8';
    regen.dispatchEvent(new Event('change', { bubbles: true }));
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    expect(client.lastRequest?.burstRegenTime).toBe(2.8);

    root.remove();
    root = document.createElement('main');
    document.body.append(root);
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    expect(root.querySelector<HTMLInputElement>('#burst-regen')!.value).toBe('2.8');
  });

  it('lays the console out in the in-game order', () => {
    // 인게임·블라블라링크가 «공통 → 기업 → 클래스» 순으로 보여준다. 화면을 그대로
    // 훑으며 옮겨 적을 수 있어야 하므로 순서 자체가 뜻을 갖는다.
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const order = [...root.querySelectorAll<HTMLInputElement>('[data-console-bucket]')]
      .map((input) => input.dataset.consoleBucket);

    expect(order).toEqual([
      'company:엘리시온', 'company:테트라', 'company:미실리스', 'company:필그림', 'company:어브노말',
      'class:화력형', 'class:방어형', 'class:지원형',
    ]);
    // 공통은 맨 앞이다.
    const groups = [...root.querySelectorAll('.console-group h4')].map((h) => h.textContent);
    expect(groups).toEqual(['공통', '기업', '클래스']);
  });

  it('sends per-affiliation console levels and restores them on reload', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });

    // 클래스 3개 · 기업 5개가 각각 칸을 갖는다 — 엔진이 빠진 소속을 에러로 끊는다.
    const bucketInput = (axis: 'class' | 'company', bucket: string) =>
      root.querySelector<HTMLInputElement>(`[data-console-bucket="${axis}:${bucket}"]`)!;
    expect(root.querySelectorAll('[data-console-bucket^="class:"]')).toHaveLength(3);
    expect(root.querySelectorAll('[data-console-bucket^="company:"]')).toHaveLength(5);

    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    expect(client.lastRequest?.console?.common_level).toBe(180);
    expect(client.lastRequest?.console?.company_level).toEqual({
      엘리시온: 100, 미실리스: 100, 테트라: 100, 필그림: 100, 어브노말: 100,
    });

    // 한 소속만 올려도 그 소속만 바뀐다.
    const tetra = bucketInput('company', '테트라');
    tetra.value = '250';
    tetra.dispatchEvent(new Event('change', { bubbles: true }));
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    expect(client.lastRequest?.console?.company_level).toEqual({
      엘리시온: 100, 미실리스: 100, 테트라: 250, 필그림: 100, 어브노말: 100,
    });

    root.remove();
    root = document.createElement('main');
    document.body.append(root);
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    expect(bucketInput('company', '테트라').value).toBe('250');
    expect(bucketInput('company', '엘리시온').value).toBe('100');
  });

  it('shows validation errors without running the calculator', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    const duration = root.querySelector<HTMLInputElement>('#duration')!;
    duration.value = '181';

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(root.querySelector('[data-errors]')?.textContent).toContain('전투 시간은 10~180초여야 합니다.');
    expect(client.simulateCalls).toBe(0);
  });

  it('renders totals and contribution rows after a successful calculation', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(root.querySelector('[data-result-total]')?.textContent).toContain('123,456');
    expect(root.querySelectorAll('[data-character-result]')).toHaveLength(5);
    expect(root.querySelector('[data-status]')?.textContent).toContain('계산 완료');
    expect(client.lastRequest?.duration).toBe(10);
  });

  it('renders the normal-attack vs skill damage split per character', async () => {
    class BreakdownClient extends FakeClient {
      override async simulate(request: SimulationRequest): Promise<SimulationResult> {
        await super.simulate(request);
        return {
          ...calculated,
          charBreakdown: {
            리타: {
              normal: 45_000,
              normalHits: 300,
              skill: 15_000,
              skillHits: 12,
              skills: [{ name: '버스트', damage: 15_000, hits: 12 }],
            },
          },
        };
      }
    }
    const client = new BreakdownClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    const splits = [...root.querySelectorAll<HTMLElement>('[data-dmg-split]')];
    // 분해 정보를 준 캐릭터에만 붙는다.
    expect(splits).toHaveLength(1);
    // 접힌 줄에는 비율, 펼치면 실제 대미지가 보인다 — 카드가 좁아 둘을 나눠 담는다.
    expect(splits[0]!.querySelector<HTMLElement>('summary')!.textContent).toContain('평타 75%');
    expect(splits[0]!.querySelector<HTMLElement>('summary')!.textContent).toContain('스킬 25%');
    const legend = splits[0]!.querySelector<HTMLElement>('.split-legend')!.textContent!;
    expect(legend).toContain('45,000');
    expect(legend).toContain('15,000');
    expect(splits[0]!.querySelector<HTMLElement>('.split-normal')!.style.width).toBe('75%');
    expect(splits[0]!.querySelector<HTMLElement>('.split-skill')!.style.width).toBe('25%');
    expect(splits[0]!.querySelector('.skill-breakdown li')!.textContent).toContain('버스트');
  });

  it('omits the damage split when the result has no breakdown (older cached results)', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(root.querySelectorAll('[data-character-result]').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('[data-dmg-split]')).toHaveLength(0);
  });

  it('offers a report button once results exist and surfaces render failures', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    // 계산 전에는 결과가 없으니 보고서 버튼도 없다.
    expect(root.querySelector('[data-report-open]')).toBeNull();

    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    const open = root.querySelector<HTMLButtonElement>('[data-report-open]')!;
    expect(open).not.toBeNull();

    open.click();
    await flush();

    // 초상화를 받는 동안 모달이 먼저 열리고 진행 상태를 보여준다.
    // (그리기 실패 경로는 report.test.ts에서 직접 검증한다.)
    expect(root.querySelector<HTMLElement>('[data-report-modal]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-report-preview]')!.textContent)
      .toContain('보고서를 그리는 중');

    root.querySelector<HTMLButtonElement>('[data-report-close]')!.click();
    expect(root.querySelector<HTMLElement>('[data-report-modal]')!.hidden).toBe(true);
  });

  it('reuses a cached result instead of recalculating', async () => {
    const firstClient = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client: firstClient, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    expect(firstClient.simulateCalls).toBe(1);

    root.replaceChildren();
    const secondClient = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client: secondClient, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(secondClient.simulateCalls).toBe(0);
    expect(root.querySelector('[data-status]')?.textContent).toContain('저장된 결과');
  });

  it('renders a successful result when persistent storage rejects writes', async () => {
    const client = new FakeClient();
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => { throw new DOMException('full', 'QuotaExceededError'); },
      removeItem: () => undefined,
    };
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(root.querySelector('[data-result-total]')?.textContent).toContain('123,456');
    expect(root.querySelector('[data-status]')?.textContent).toContain('계산 완료');
  });

  it('removes the preview badge when a preview slot is cleared', () => {
    const previewCatalog = catalog.map((char, index) => ({ ...char, preview: index === 0 }));
    mountCalculator(root, {
      catalog: previewCatalog,
      settings,
      version: 'v1',
      client: new FakeClient(),
      storage: localStorage,
    });
    const firstCard = root.querySelector<HTMLElement>('[data-slot-card="0"]')!;
    expect(firstCard.classList.contains('is-preview')).toBe(true);

    clearCharacterSlot(root, 0);

    expect(root.querySelector<HTMLElement>('[data-slot-card="0"]')!
      .classList.contains('is-preview')).toBe(false);
  });

  it('uses a 52px editable core only while core is enabled and resets enemy fields only', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const duration = root.querySelector<HTMLInputElement>('#duration')!;
    const seed = root.querySelector<HTMLInputElement>('#seed')!;
    const coreToggle = root.querySelector<HTMLInputElement>('#has-core')!;
    const corePx = root.querySelector<HTMLInputElement>('#core-px')!;
    duration.value = '60';
    seed.value = '99';
    expect(corePx.disabled).toBe(true);
    expect(corePx.value).toBe('52');

    coreToggle.checked = true;
    coreToggle.dispatchEvent(new Event('change'));
    corePx.value = '77';
    root.querySelector<HTMLInputElement>('#enemy-def')!.value = '1';
    root.querySelector<HTMLSelectElement>('#enemy-code')!.value = '작열';
    root.querySelector<HTMLInputElement>('#has-parts')!.checked = true;
    root.querySelector<HTMLButtonElement>('[data-reset-enemy]')!.click();

    expect(duration.value).toBe('60');
    expect(seed.value).toBe('99');
    expect(root.querySelector<HTMLInputElement>('#enemy-def')!.value).toBe('31784');
    expect(coreToggle.checked).toBe(false);
    expect(corePx.value).toBe('52');
    expect(corePx.disabled).toBe(true);
  });

  it('forwards enabled per-character settings in the request', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    const toggle = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    const attack = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-overload-key="atk_pct"]')!;
    attack.value = '40';
    attack.dispatchEvent(new Event('input'));
    const skillOne = root.querySelector<HTMLSelectElement>('[data-slot-card="0"] [data-skill-level="1"]')!;
    skillOne.value = '4';
    skillOne.dispatchEvent(new Event('change'));

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(client.lastRequest?.characters?.리타?.overload?.atk_pct).toBe(40);
    expect(client.lastRequest?.characters?.리타?.growthStage).toBe(3);
    expect(client.lastRequest?.characters?.리타?.skillLevels).toEqual({ '1': 4, '2': 10, '3': 10 });
  });

  it.each([-1, 1.5, 11])('blocks a forged growth stage %s outside the character rarity range', async (growthStage) => {
    const client = new FakeClient();
    const invalidSettings: SettingsCatalog = {
      ...settings,
      characters: {
        ...settings.characters,
        리타: { ...settings.characters.리타!, growthStage },
      },
    };
    mountCalculator(root, { catalog, settings: invalidSettings, version: 'v1', client, storage: localStorage });
    const toggle = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(root.querySelector('[data-errors]')?.textContent)
      .toContain('덱 1 · 리타: 돌파 단계는 0~10 정수여야 합니다.');
    expect(client.simulateCalls).toBe(0);
  });

  it('blocks released skill levels outside the integer 1-to-10 range', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    const toggle = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    const skillOne = root.querySelector<HTMLSelectElement>('[data-slot-card="0"] [data-skill-level="1"]')!;
    skillOne.value = '0';
    skillOne.dispatchEvent(new Event('change'));

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(root.querySelector('[data-errors]')?.textContent)
      .toContain('덱 1 · 리타: 스킬 레벨은 1~10 정수여야 합니다.');
    expect(client.simulateCalls).toBe(0);
  });

  it('blocks forged non-ten levels for a locked preview character', async () => {
    const client = new FakeClient();
    const previewName = '아마기 유키코';
    const previewCatalog: CharacterMeta[] = [...catalog, {
      name: previewName,
      burstStage: '3',
      elementCode: '작열',
      weaponType: 'MG',
      className: '화력형',
      manufacturer: '미상',
      preview: true,
      image: null,
      nameCode: null, resourceId: null, aliases: [],
    }];
    const previewSettings: SettingsCatalog = {
      ...settings,
      characters: {
        ...settings.characters,
        [previewName]: {
          ...settings.characters.리타!,
          skillLevels: { '1': 9, '2': 10, '3': 10 },
          skillLevelsLocked: true,
        },
      },
    };
    mountCalculator(root, {
      catalog: previewCatalog,
      settings: previewSettings,
      version: 'v1',
      client,
      storage: localStorage,
    });
    chooseCharacter(root, 0, previewName);
    const toggle = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(root.querySelector('[data-errors]')?.textContent)
      .toContain(`덱 1 · ${previewName}: 수치 미공개 캐릭터는 스킬 Lv10만 사용할 수 있습니다.`);
    expect(client.simulateCalls).toBe(0);
  });

  it('runs non-empty decks sequentially and allows cross-deck duplicates', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    let toggle = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    let skillOne = root.querySelector<HTMLSelectElement>('[data-slot-card="0"] [data-skill-level="1"]')!;
    skillOne.value = '4';
    skillOne.dispatchEvent(new Event('change'));
    let growth = root.querySelector<HTMLSelectElement>('[data-slot-card="0"] [data-growth-stage]')!;
    growth.value = '1';
    growth.dispatchEvent(new Event('change'));
    const mode = root.querySelector<HTMLInputElement>('#squad-mode')!;
    mode.checked = true;
    mode.dispatchEvent(new Event('change'));
    root.querySelector<HTMLButtonElement>('[data-deck-tab="2"]')!.click();
    chooseCharacter(root, 0, '리타');
    toggle = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    skillOne = root.querySelector<HTMLSelectElement>('[data-slot-card="0"] [data-skill-level="1"]')!;
    skillOne.value = '7';
    skillOne.dispatchEvent(new Event('change'));
    growth = root.querySelector<HTMLSelectElement>('[data-slot-card="0"] [data-growth-stage]')!;
    growth.value = '7';
    growth.dispatchEvent(new Event('change'));

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    await flush();

    expect(client.requests).toHaveLength(2);
    expect(client.requests[0]?.squad).toContain('리타');
    expect(client.requests[1]?.squad).toEqual(['리타']);
    expect(client.requests[0]?.characters?.리타?.skillLevels?.['1']).toBe(4);
    expect(client.requests[1]?.characters?.리타?.skillLevels?.['1']).toBe(7);
    expect(client.requests[0]?.characters?.리타?.growthStage).toBe(1);
    expect(client.requests[1]?.characters?.리타?.growthStage).toBe(7);
    // 덱이 둘 이상이면 탭으로 갈라 한 번에 하나만 편다. 탭은 **덱 번호 순서 그대로**다.
    const deckTabs = [...root.querySelectorAll<HTMLButtonElement>('[data-deck-result-tab]')];
    expect(deckTabs.map((tab) => tab.dataset.deckResultTab)).toEqual(['1', '2']);
    expect(root.querySelectorAll('[data-deck-result]')).toHaveLength(1);
    expect(root.querySelector<HTMLElement>('[data-deck-result]')!.dataset.deckResult).toBe('1');
    // 딜 순위는 자리를 옮기지 않고 표시로만 붙는다.
    expect(deckTabs.map((tab) => tab.dataset.deckRank)).toEqual(['1', '2']);

    deckTabs[1]!.click();
    expect(root.querySelector<HTMLElement>('[data-deck-result]')!.dataset.deckResult).toBe('2');
    expect(root.querySelector('[data-batch-total]')?.textContent).toContain('246,912');
    expect(root.querySelector('[data-status]')?.textContent).toContain('2개 덱 계산 완료');
  });
});
