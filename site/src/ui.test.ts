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
  { name: '리타', burstStage: '1', elementCode: '철갑', weaponType: 'SMG', className: '지원형', manufacturer: '미실리스', preview: false, image: 'characters/1.webp' },
  { name: '크라운', burstStage: '2', elementCode: '철갑', weaponType: 'MG', className: '방어형', manufacturer: '필그림', preview: false, image: 'characters/2.webp' },
  { name: '라피 : 레드 후드', burstStage: '3', elementCode: '작열', weaponType: 'MG', className: '화력형', manufacturer: '엘리시온', preview: false, image: 'characters/3.webp' },
  { name: '앨리스', burstStage: '3', elementCode: '수냉', weaponType: 'SR', className: '화력형', manufacturer: '테트라', preview: false, image: 'characters/4.webp' },
  { name: '나가', burstStage: '2', elementCode: '전격', weaponType: 'SG', className: '지원형', manufacturer: '미실리스', preview: false, image: 'characters/5.webp' },
  { name: '프리바티', burstStage: '3', elementCode: '수냉', weaponType: 'AR', className: '화력형', manufacturer: '엘리시온', preview: false, image: 'characters/6.webp' },
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
  cubes: {
    재장: { label: '재장', stat: 'reload_speed_pct', template: '재장전 {0}%', levels: cubeLevels },
    탄충: { label: '탄충', stat: 'ammo_charge_flat', template: '10발마다 {0}발', levels: cubeLevels },
    체력: { label: '체력', stat: 'max_hp_pct', template: '체력 {0}%', levels: cubeLevels },
    차속: { label: '차속', stat: 'charge_speed_pct', template: '차속 {0}%', levels: cubeLevels },
    파츠: { label: '파츠', stat: 'part_dmg_pct', template: '파츠 {0}%', levels: cubeLevels },
    분배: { label: '분배', stat: 'split_dmg_pct', template: '분배 {0}%', levels: cubeLevels },
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

function filterCharacterSlot(root: HTMLElement, index: number, query: string): void {
  const filter = root.querySelector<HTMLInputElement>(`#squad-filter-${index}`)!;
  filter.value = query;
  filter.dispatchEvent(new Event('input', { bubbles: true }));
}

function chooseCharacter(root: HTMLElement, index: number, name: string): void {
  filterCharacterSlot(root, index, name);
  const select = root.querySelector<HTMLSelectElement>(`#squad-${index}`)!;
  expect(select.querySelector<HTMLOptionElement>(`option[value="${name}"]`)?.disabled).toBe(false);
  select.value = name;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function clearCharacterSlot(root: HTMLElement, index: number): void {
  const select = root.querySelector<HTMLSelectElement>(`#squad-${index}`)!;
  select.value = '';
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('calculator UI', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('main');
    document.body.append(root);
    localStorage.clear();
  });

  afterEach(() => {
    root.remove();
  });

  it('renders a local filter above each native dropdown and disables same-deck duplicates', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const filters = [...root.querySelectorAll<HTMLInputElement>('[data-character-filter]')];
    const slots = [...root.querySelectorAll<HTMLSelectElement>('[data-squad-slot]')];

    expect(filters).toHaveLength(5);
    expect(slots).toHaveLength(5);
    expect(slots.every((slot) => slot.tagName === 'SELECT')).toBe(true);
    expect(slots.map((slot) => slot.value)).toEqual(names.slice(0, 5));
    expect(slots[1]!.querySelector<HTMLOptionElement>('option[value="리타"]')?.disabled).toBe(true);
    expect(filters[0]!.compareDocumentPosition(slots[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(filters.map((filter) => filter.getAttribute('aria-label'))).toEqual([
      '스쿼드 슬롯 1 캐릭터 필터',
      '스쿼드 슬롯 2 캐릭터 필터',
      '스쿼드 슬롯 3 캐릭터 필터',
      '스쿼드 슬롯 4 캐릭터 필터',
      '스쿼드 슬롯 5 캐릭터 필터',
    ]);
    expect(root.querySelector('#character-search')).toBeNull();
    expect(root.querySelector<HTMLAnchorElement>('footer a')?.href).toBe('https://github.com/Moris-kr/nikke-calc');
  });

  it('filters only the matching slot while preserving its current selection', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    filterCharacterSlot(root, 0, '앨리스');

    const first = root.querySelector<HTMLSelectElement>('#squad-0')!;
    const second = root.querySelector<HTMLSelectElement>('#squad-1')!;
    expect([...first.options].map((option) => option.value)).toEqual(['', '리타', '앨리스']);
    expect(first.value).toBe('리타');
    expect([...second.options].map((option) => option.value)).toEqual(['', ...names]);
  });

  it.each([
    ['B2', ['', '리타', '크라운', '나가']],
    ['수냉', ['', '리타', '앨리스', '프리바티']],
    ['mg', ['', '리타', '크라운', '라피 : 레드 후드']],
    ['화력형', ['', '리타', '라피 : 레드 후드', '앨리스', '프리바티']],
    ['엘리시온', ['', '리타', '라피 : 레드 후드', '프리바티']],
    ['sR', ['', '리타', '앨리스']],
  ])('filters by character metadata query %s case-insensitively', (query, expected) => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    filterCharacterSlot(root, 0, query);

    const values = [...root.querySelector<HTMLSelectElement>('#squad-0')!.options]
      .map((option) => option.value);
    expect(values).toEqual(expected);
  });

  it('preserves independent filter text across selection rerenders, slots, and decks', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    chooseCharacter(root, 0, '프리바티');
    filterCharacterSlot(root, 1, '리타');

    const mode = root.querySelector<HTMLInputElement>('#squad-mode')!;
    mode.checked = true;
    mode.dispatchEvent(new Event('change'));
    root.querySelector<HTMLButtonElement>('[data-deck-tab="2"]')!.click();
    filterCharacterSlot(root, 0, '앨리스');

    root.querySelector<HTMLButtonElement>('[data-deck-tab="1"]')!.click();
    expect(root.querySelector<HTMLInputElement>('#squad-filter-0')!.value).toBe('프리바티');
    expect(root.querySelector<HTMLSelectElement>('#squad-0')!.value).toBe('프리바티');
    expect(root.querySelector<HTMLInputElement>('#squad-filter-1')!.value).toBe('리타');

    root.querySelector<HTMLButtonElement>('[data-deck-tab="2"]')!.click();
    expect(root.querySelector<HTMLInputElement>('#squad-filter-0')!.value).toBe('앨리스');
    expect(root.querySelector<HTMLInputElement>('#squad-filter-1')!.value).toBe('');
  });

  it('swaps a nikke with the neighbouring slot, carrying its filter text along', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const slots = () => [...root.querySelectorAll<HTMLSelectElement>('[data-squad-slot]')].map((s) => s.value);
    const before = slots();
    filterCharacterSlot(root, 0, '리타');

    // 0번을 오른쪽으로 → 1번과 자리를 맞바꾼다.
    root.querySelector<HTMLButtonElement>('[data-slot-move="0:1"]')!.click();

    const after = slots();
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    expect(after.slice(2)).toEqual(before.slice(2));
    // 슬롯에 매인 검색어도 같이 따라간다.
    expect(root.querySelector<HTMLInputElement>('#squad-filter-1')!.value).toBe('리타');
    expect(root.querySelector<HTMLInputElement>('#squad-filter-0')!.value).toBe('');

    // 되돌리면 원래대로.
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
    const moved = root.querySelector<HTMLSelectElement>('#squad-0')!.value;
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

  it('drops the AI/no-server badges and turns the supported count into a roster button', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const trust = root.querySelector<HTMLElement>('.trust-row')!;

    expect(trust.textContent).not.toContain('AI 없음');
    expect(trust.textContent).not.toContain('서버 전송 없음');
    const open = trust.querySelector<HTMLButtonElement>('[data-roster-open]')!;
    expect(open.textContent).toBe(`${catalog.length}명 지원`);
  });

  it('opens a searchable grid of every supported nikke', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const modal = root.querySelector<HTMLElement>('[data-roster-modal]')!;
    expect(modal.hidden).toBe(true);

    root.querySelector<HTMLButtonElement>('[data-roster-open]')!.click();
    expect(modal.hidden).toBe(false);
    expect(root.querySelectorAll('[data-roster-cell]')).toHaveLength(catalog.length);
    expect(root.querySelector('[data-roster-count]')!.textContent).toBe(`${catalog.length}명`);

    const search = root.querySelector<HTMLInputElement>('[data-roster-search]')!;
    search.value = '라피';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect([...root.querySelectorAll<HTMLElement>('[data-roster-cell] strong')].map((n) => n.textContent))
      .toEqual(['라피 : 레드 후드']);
    expect(root.querySelector('[data-roster-count]')!.textContent).toBe(`1 / ${catalog.length}명`);

    search.value = '없는이름';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelectorAll('[data-roster-cell]')).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('[data-roster-empty]')!.hidden).toBe(false);

    root.querySelector<HTMLButtonElement>('[data-roster-close]')!.click();
    expect(modal.hidden).toBe(true);
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
