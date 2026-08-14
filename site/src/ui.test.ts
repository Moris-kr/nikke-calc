// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mountCalculator, type CalculatorClientLike } from './ui';
import type { CharacterMeta, SimulationRequest, SimulationResult } from './types';

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

  async prepare(): Promise<void> {
    this.prepareCalls += 1;
  }

  async simulate(request: SimulationRequest): Promise<SimulationResult> {
    this.simulateCalls += 1;
    this.lastRequest = request;
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
    mountCalculator(root, { catalog, version: 'v1', client: new FakeClient(), storage: localStorage });
    const slots = [...root.querySelectorAll<HTMLSelectElement>('[data-squad-slot]')];

    expect(slots).toHaveLength(5);
    expect(slots.map((slot) => slot.value)).toEqual(names.slice(0, 5));
    expect(slots[1]!.querySelector<HTMLOptionElement>('option[value="리타"]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLAnchorElement>('footer a')?.href).toBe('https://github.com/Moris-kr/nikke-calc');
  });

  it('shows validation errors without running the calculator', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, version: 'v1', client, storage: localStorage });
    const duration = root.querySelector<HTMLInputElement>('#duration')!;
    duration.value = '181';

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(root.querySelector('[data-errors]')?.textContent).toContain('전투 시간은 10~180초여야 합니다.');
    expect(client.simulateCalls).toBe(0);
  });

  it('renders totals and contribution rows after a successful calculation', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, version: 'v1', client, storage: localStorage });
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
    mountCalculator(root, { catalog, version: 'v1', client: firstClient, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    expect(firstClient.simulateCalls).toBe(1);

    root.replaceChildren();
    const secondClient = new FakeClient();
    mountCalculator(root, { catalog, version: 'v1', client: secondClient, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(secondClient.simulateCalls).toBe(0);
    expect(root.querySelector('[data-status]')?.textContent).toContain('저장된 결과');
  });
});
