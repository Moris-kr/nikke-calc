// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  allocationKey, arrangeLines, countAllocations, countFor, enumerateAllocations, fastBudget, fastSearch,
  freeOptions, isChargeWeapon, neighborsOf, progressOf, totalsOf, type Allocation,
} from './overload-optimizer';
import { openOverloadOptimizer, RUN_LIMIT } from './overload-optimizer-ui';
import type { DeckState, SettingsCatalog } from './types';

const both = { fixElement: true, fixAtk: true };

describe('최적옵작 — 조합 세기', () => {
  it('4우·4공 고정이면 남은 4줄만 고른다 — 차지 무기 126개, 아니면 35개', () => {
    expect(freeOptions({ ...both, charge: true })).not.toContain('def_pct');
    expect(freeOptions({ ...both, charge: false })).not.toContain('charge_speed_pct');
    expect(countFor({ ...both, charge: true })).toBe(126);
    expect(countFor({ ...both, charge: false })).toBe(35);
  });

  it('고정을 풀면 늘어나는 수를 미리 안다', () => {
    expect(countFor({ fixElement: false, fixAtk: true, charge: true })).toBe(2415);
    expect(countFor({ fixElement: true, fixAtk: false, charge: true })).toBe(2415);
    expect(countFor({ fixElement: false, fixAtk: false, charge: true })).toBe(23940);
    expect(countFor({ fixElement: false, fixAtk: false, charge: false })).toBe(1751);
    expect(countFor({ fixElement: false, fixAtk: false, charge: true })).toBeGreaterThan(RUN_LIMIT);
    expect(countFor({ fixElement: false, fixAtk: true, charge: true })).toBeLessThanOrEqual(RUN_LIMIT);
  });

  it('세는 수와 실제로 만드는 조합이 같고, 모두 12줄·옵션당 4줄 이하다', () => {
    for (const setup of [
      { ...both, charge: true }, { fixElement: false, fixAtk: true, charge: false },
    ]) {
      const all = enumerateAllocations(setup);
      expect(all).toHaveLength(countFor(setup));
      expect(new Set(all.map((a) => JSON.stringify(a))).size).toBe(all.length);
      for (const allocation of all) {
        expect(Object.values(allocation).reduce((a, b) => a + b, 0)).toBe(12);
        expect(Math.max(...Object.values(allocation))).toBeLessThanOrEqual(4);
      }
    }
    expect(countAllocations(3, 13)).toBe(0);
  });

  it('차지 무기는 SR·RL이거나 무기 변경으로 SR·RL을 드는 니케다', () => {
    expect(isChargeWeapon('SR')).toBe(true);
    expect(isChargeWeapon('AR', ['RL'])).toBe(true);
    expect(isChargeWeapon('AR', ['SMG'])).toBe(false);
    expect(isChargeWeapon('MG')).toBe(false);
  });

  it('부위마다 같은 옵션이 두 번 들지 않게 나눈다', () => {
    const allocation: Allocation = { element_bonus: 4, atk_pct: 4, crit_dmg: 3, max_ammo_pct: 1 };
    const parts = arrangeLines(allocation);
    for (const lines of Object.values(parts)) {
      expect(lines).toHaveLength(3);
      expect(new Set(lines).size).toBe(3);
    }
  });

  it('합계는 줄 수 × 그 레벨 값이다', () => {
    const steps = { atk_pct: [1, 2, 3], crit_dmg: [10, 20, 30] };
    expect(totalsOf({ atk_pct: 4, crit_dmg: 2 }, steps, 2, ['atk_pct', 'crit_dmg', 'def_pct']))
      .toEqual({ atk_pct: 8, crit_dmg: 40, def_pct: 0 });
  });

  it('이웃은 한두 줄을 옮긴 조합이고, 고정 옵션·4줄 상한을 지킨다', () => {
    const start: Allocation = { element_bonus: 4, atk_pct: 4, crit_dmg: 4 };
    const options = freeOptions({ fixElement: false, fixAtk: true, charge: false });
    const around = neighborsOf(start, options);
    expect(around.length).toBeGreaterThan(0);
    for (const next of around) {
      expect(Object.values(next).reduce((a, b) => a + b, 0)).toBe(12);
      expect(next.atk_pct).toBe(4);
      expect(Math.max(...Object.values(next))).toBeLessThanOrEqual(4);
    }
    expect(around.map(allocationKey)).toContain(allocationKey({ element_bonus: 2, atk_pct: 4, crit_dmg: 4, max_ammo_pct: 2 }));
  });

  it('빠른 탐색은 1단계(4우·4공) 뒤 이웃으로 옮겨 가며, 두 줄이 모여야 느는 계단도 넘는다', async () => {
    // 우월은 줄마다 조금, 장탄은 두 줄부터 크게(계단) — 정답은 우월 2 · 장탄 4쪽이다.
    const score = (a: Allocation) => 100 + (a.element_bonus ?? 0) * 1 + (a.atk_pct ?? 0) * 3
      + ((a.max_ammo_pct ?? 0) >= 2 ? 10 : 0) + ((a.max_ammo_pct ?? 0) >= 4 ? 10 : 0) + (a.crit_dmg ?? 0) * 0.5;
    const setup = { fixElement: false, fixAtk: true, charge: false };
    let calls = 0;
    const result = await fastSearch(setup, async (batch) => { calls += batch.length; return batch.map(score); });
    const exact = enumerateAllocations(setup).map((a) => ({ a, total: score(a) })).sort((x, y) => y.total - x.total)[0]!;
    expect(result.ranked[0]!.total).toBe(exact.total);
    expect(result.converged).toBe(true);
    expect(calls).toBeLessThan(countFor(setup));
    expect(calls).toBeLessThanOrEqual(fastBudget(setup));
  });

  it('남은 시간은 처음 몇 판 뒤부터 잰다', () => {
    expect(progressOf(1, 100, 100).remainingSec).toBeNull();
    expect(progressOf(10, 100, 1000)).toEqual({ percent: 10, remainingSec: 9 });
  });
});

describe('최적옵작 창', () => {
  afterEach(() => { document.body.replaceChildren(); });
  const settings = {
    characters: {},
    overloadFields: Object.fromEntries(['element_bonus', 'atk_pct', 'crit_rate', 'crit_dmg', 'max_ammo_pct',
      'accuracy_pct', 'charge_speed_pct', 'charge_dmg_pct', 'def_pct'].map((key) => [key, { label: key }])),
    overloadSteps: Object.fromEntries(['element_bonus', 'atk_pct', 'crit_rate', 'crit_dmg', 'max_ammo_pct',
      'accuracy_pct', 'charge_speed_pct', 'charge_dmg_pct', 'def_pct'].map((key) => [key, Array.from({ length: 15 }, (_, i) => i + 1)])),
  } as unknown as SettingsCatalog;
  const deck: DeckState = { id: 1, squad: ['X', '', '', '', ''], characters: { X: { overload: {} } } };
  /** 크리티컬 대미지가 가장 값지고, 그다음이 장탄인 가짜 판. */
  const run = async (next: DeckState) => {
    const o = next.characters.X?.overload ?? {};
    const total = 1000 + 3 * (o.crit_dmg ?? 0) + 2 * (o.max_ammo_pct ?? 0) + (o.crit_rate ?? 0) + (o.element_bonus ?? 0);
    return { squadTotal: total, charTotals: { X: total } };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('창을 먼저 열어 조합 수를 보여 주고, 계산 시작을 눌러야 돈다', async () => {
    let calls = 0;
    openOverloadOptimizer({ settings, run: async (d) => { calls += 1; return run(d); }, parallel: () => 2 },
      { deck, deckLabel: '덱 1', name: 'X', weaponType: 'AR' });
    const modal = document.querySelector<HTMLElement>('[data-overload-best-modal]')!;
    await settle();
    expect(calls).toBe(1); // 지금 줄로 잰 기준 한 판(예상 시간)
    expect(modal.querySelector('[data-overload-best-count]')?.textContent).toContain('35');
    expect(modal.querySelector('[data-overload-best-more]')?.textContent).toContain('1,751');
    // 우월 고정을 풀면 수가 늘어난다.
    const fixElement = modal.querySelector<HTMLInputElement>('[data-overload-best-fix="element"]')!;
    fixElement.checked = false;
    fixElement.dispatchEvent(new Event('change'));
    expect(modal.querySelector('[data-overload-best-count]')?.textContent).toContain('320');
    fixElement.checked = true;
    fixElement.dispatchEvent(new Event('change'));

    modal.querySelector<HTMLButtonElement>('[data-overload-best-start]')!.click();
    for (let i = 0; i < 50 && !modal.querySelector('[data-overload-best-result]'); i += 1) await settle();
    expect(calls).toBe(1 + 35);
    const best = modal.querySelector('[data-overload-best-result]')!.textContent!;
    expect(best).toContain('crit_dmg 4');
    expect(best).toContain('element_bonus 4');
    expect(modal.querySelectorAll('[data-overload-best-row]')).toHaveLength(10);
    expect(modal.querySelector('[data-overload-best-status]')?.textContent).toContain('끝났습니다');
  });

  it('두 고정을 모두 풀면 전수는 막고 빠른 탐색으로 돌린다', async () => {
    let calls = 0;
    openOverloadOptimizer({ settings, run: async (d) => { calls += 1; return run(d); }, parallel: () => 2 },
      { deck, deckLabel: '덱 1', name: 'X', weaponType: 'SR' });
    const modal = document.querySelector<HTMLElement>('[data-overload-best-modal]')!;
    await settle();
    const mode = modal.querySelector<HTMLSelectElement>('[data-overload-best-mode]')!;
    // 둘 다 고정이면 방식을 고를 일이 없다.
    expect(mode.closest('label')!.hidden).toBe(true);
    for (const key of ['element', 'atk']) {
      const box = modal.querySelector<HTMLInputElement>(`[data-overload-best-fix="${key}"]`)!;
      box.checked = false;
      box.dispatchEvent(new Event('change'));
    }
    expect(mode.closest('label')!.hidden).toBe(false);
    expect(mode.value).toBe('fast');
    expect(mode.querySelector<HTMLOptionElement>('option[value="exact"]')!.disabled).toBe(true);
    expect(modal.querySelector('[data-overload-best-count]')?.textContent).toContain('23,940');
    const start = modal.querySelector<HTMLButtonElement>('[data-overload-best-start]')!;
    expect(start.disabled).toBe(false);
    start.click();
    for (let i = 0; i < 200 && !modal.querySelector('[data-overload-best-result]'); i += 1) await settle();
    expect(modal.querySelector('[data-overload-best-fast]')?.textContent).toContain('빠른 탐색');
    expect(calls - 1).toBeLessThan(1000);
    // 가짜 판에서는 크리티컬 대미지 4 · 장탄 4 · 크확 4가 최고다(공격력·우월은 거의 무가치).
    expect(modal.querySelector('.ob-best-label')?.textContent).toContain('crit_dmg 4');
  });
});
