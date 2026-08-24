// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { StorageLike } from './cache';
import { mountCalculator, type CalculatorClientLike } from './ui';
import './styles.css';
import type {
  CharacterMeta,
  SettingsCatalog,
  SimulationRequest,
  SimulationResult,
} from './types';

const names = ['리타', '크라운', '라피 : 레드 후드', '앨리스', '나가', '프리바티'];
const catalog: CharacterMeta[] = [
  { name: '리타', burstStage: '1', elementCode: '철갑', weaponType: 'SMG', className: '지원형', manufacturer: '미실리스', preview: false, image: 'characters/1.webp', nameCode: null, resourceId: null },
  { name: '크라운', burstStage: '2', elementCode: '철갑', weaponType: 'MG', className: '방어형', manufacturer: '필그림', preview: false, image: 'characters/2.webp', nameCode: null, resourceId: null },
  { name: '라피 : 레드 후드', burstStage: '3', elementCode: '작열', weaponType: 'MG', className: '화력형', manufacturer: '엘리시온', preview: false, image: 'characters/3.webp', nameCode: null, resourceId: null },
  { name: '앨리스', burstStage: '3', elementCode: '수냉', weaponType: 'SR', className: '화력형', manufacturer: '테트라', preview: false, image: 'characters/4.webp', nameCode: null, resourceId: null },
  { name: '나가', burstStage: '2', elementCode: '전격', weaponType: 'SG', className: '지원형', manufacturer: '미실리스', preview: false, image: 'characters/5.webp', nameCode: null, resourceId: null },
  { name: '프리바티', burstStage: '3', elementCode: '수냉', weaponType: 'AR', className: '화력형', manufacturer: '엘리시온', preview: false, image: 'characters/6.webp', nameCode: null, resourceId: null },
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

  it('exposes composition-only presets as a first-class squad action', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });

    const open = root.querySelector<HTMLButtonElement>('[data-preset-open]')!;
    expect(open).not.toBeNull();
    expect(open.textContent).toContain('프리셋');
    open.click();

    const modal = root.querySelector<HTMLElement>('[data-share-modal]')!;
    expect(modal.hidden).toBe(false);
    expect(root.querySelector<HTMLInputElement>('[data-preset-name]')).toBe(document.activeElement);
    expect(modal.textContent).toContain('개인 스펙과 전투 조건은 코드에 담기지 않습니다');

    const name = root.querySelector<HTMLInputElement>('[data-preset-name]')!;
    name.value = '솔레 1군';
    root.querySelector<HTMLButtonElement>('[data-preset-save]')!.click();
    const stored = JSON.parse(localStorage.getItem('nikke-presets-v1')!) as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]!).sort()).toEqual(['at', 'code', 'name']);
    expect(stored[0]?.name).toBe('솔레 1군');
  });

  afterEach(() => {
    root.remove();
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
    const boxes = [...root.querySelectorAll<HTMLInputElement>('[data-optimal-range-weapon]')];
    expect(boxes.map((box) => box.dataset.optimalRangeWeapon))
      .toEqual(['AR', 'SMG', 'SG', 'MG', 'SR', 'RL']);
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
    const legend = splits[0]!.querySelector<HTMLElement>('.split-legend')!.textContent!;
    expect(legend).toContain('75.0%');
    expect(legend).toContain('25.0%');
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
      nameCode: null, resourceId: null,
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
    expect(root.querySelectorAll('[data-deck-result]')).toHaveLength(2);
    expect(root.querySelector('[data-batch-total]')?.textContent).toContain('246,912');
    expect(root.querySelector('[data-status]')?.textContent).toContain('2개 덱 계산 완료');
  });
});
