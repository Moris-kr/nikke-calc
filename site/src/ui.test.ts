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
const catalog: CharacterMeta[] = names.map((name, index) => ({
  name,
  burstStage: String((index % 3) + 1),
  elementCode: '철갑',
  weaponType: 'AR',
  className: '지원형',
  manufacturer: '테트라',
  preview: false,
  image: `characters/${index + 1}.webp`,
}));

const cubeLevels = { '15': { atk: 2780, def: 552, hp: 83400, effect: 10, commonElement: 19.09 } };
const settings: SettingsCatalog = {
  characters: Object.fromEntries(names.map((name) => [name, {
    overload: {
      element_bonus: 88.6,
      atk_pct: 22.22,
      max_ammo_pct: 129.64,
      crit_rate: 0,
      crit_dmg: 0,
    },
    cube: { name: '재장', level: 15 },
  }])),
  cubes: {
    재장: { label: '재장', stat: 'reload_speed_pct', template: '재장전 {0}%', levels: cubeLevels },
    탄충: { label: '탄충', stat: 'ammo_charge_flat', template: '10발마다 {0}발', levels: cubeLevels },
    체력: { label: '체력', stat: 'max_hp_pct', template: '체력 {0}%', levels: cubeLevels },
    차속: { label: '차속', stat: 'charge_speed_pct', template: '차속 {0}%', levels: cubeLevels },
    파츠: { label: '파츠', stat: 'part_dmg_pct', template: '파츠 {0}%', levels: cubeLevels },
  },
  overloadFields: {
    element_bonus: { label: '우월 코드 대미지', unit: '%', min: 0, max: 1000 },
    atk_pct: { label: '공격력', unit: '%', min: 0, max: 1000 },
    max_ammo_pct: { label: '최대 장탄수', unit: '%', min: 0, max: 10000 },
    crit_rate: { label: '크리티컬 확률', unit: '%', min: 0, max: 100 },
    crit_dmg: { label: '크리티컬 대미지', unit: '%', min: 0, max: 1000 },
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

  it('renders five unique default squad slots', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const slots = [...root.querySelectorAll<HTMLSelectElement>('[data-squad-slot]')];

    expect(slots).toHaveLength(5);
    expect(slots.map((slot) => slot.value)).toEqual(names.slice(0, 5));
    expect(slots[1]!.querySelector<HTMLOptionElement>('option[value="리타"]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLAnchorElement>('footer a')?.href).toBe('https://github.com/Moris-kr/nikke-calc');
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
    const firstSlot = root.querySelector<HTMLSelectElement>('#squad-0')!;
    expect(firstCard.classList.contains('is-preview')).toBe(true);

    firstSlot.value = '';
    firstSlot.dispatchEvent(new Event('change'));

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

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(client.lastRequest?.characters?.리타?.overload?.atk_pct).toBe(40);
  });

  it('runs non-empty decks sequentially and allows cross-deck duplicates', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    const mode = root.querySelector<HTMLInputElement>('#squad-mode')!;
    mode.checked = true;
    mode.dispatchEvent(new Event('change'));
    root.querySelector<HTMLButtonElement>('[data-deck-tab="2"]')!.click();
    const secondDeckFirst = root.querySelector<HTMLSelectElement>('#squad-0')!;
    secondDeckFirst.value = '리타';
    secondDeckFirst.dispatchEvent(new Event('change'));
    for (let index = 1; index < 5; index += 1) {
      const slot = root.querySelector<HTMLSelectElement>(`#squad-${index}`)!;
      slot.value = '';
      slot.dispatchEvent(new Event('change'));
    }

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    await flush();

    expect(client.requests).toHaveLength(2);
    expect(client.requests[0]?.squad).toContain('리타');
    expect(client.requests[1]?.squad).toEqual(['리타']);
    expect(root.querySelectorAll('[data-deck-result]')).toHaveLength(2);
    expect(root.querySelector('[data-batch-total]')?.textContent).toContain('246,912');
    expect(root.querySelector('[data-status]')?.textContent).toContain('2개 덱 계산 완료');
  });
});
