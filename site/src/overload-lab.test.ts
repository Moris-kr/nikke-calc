// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  JUNK_FILLER, LAB_LEVEL, MAX_LINES, emptySetup, labGain, labLines, labOverrides, labPerLine,
  labProblem, labSquad, mountOverloadLab, pickedLines,
} from './overload-lab';
import type { CharacterMeta, SettingsCatalog, SimulationResult } from './types';

const steps = {
  // 9단계가 아홉 번째 값이다 — 시험이 그 자리를 짚는다.
  element_bonus: [1, 2, 3, 4, 5, 6, 7, 8, 20.75, 22, 23, 24, 25, 26, 27],
  atk_pct: [1, 2, 3, 4, 5, 6, 7, 8, 10.4, 11, 12, 13, 14, 15, 16],
};

const catalog = ['앨리스', '리틀 머메이드', '그레이브', '라피', '크라운'].map((name) => ({
  name, burstStage: '3', elementCode: '철갑', weaponType: 'AR', className: '화력형',
  manufacturer: '엘리시온', preview: false, image: '', nameCode: null, resourceId: null,
  aliases: [],
})) as CharacterMeta[];

const settings = {
  overloadSteps: steps,
  overloadFields: {
    element_bonus: { label: '우월 코드 대미지', unit: '%', min: 0, max: 1000 },
    atk_pct: { label: '공격력', unit: '%', min: 0, max: 1000 },
  },
} as unknown as SettingsCatalog;

describe('줄 나누기', () => {
  it('고른 줄을 부위에 차곡차곡 채운다', () => {
    const lines = labLines([{ option: 'element_bonus', count: 4 }, { option: 'atk_pct', count: 2 }]);
    expect(lines.머리).toEqual([
      { option: 'element_bonus', level: LAB_LEVEL },
      { option: 'element_bonus', level: LAB_LEVEL },
      { option: 'element_bonus', level: LAB_LEVEL },
    ]);
    expect(lines.몸통).toEqual([
      { option: 'element_bonus', level: LAB_LEVEL },
      { option: 'atk_pct', level: LAB_LEVEL },
      { option: 'atk_pct', level: LAB_LEVEL },
    ]);
    // 남은 부위는 비운다 — 빈 줄을 만들어 두면 합계가 달라지지 않아도 화면이 헷갈린다.
    expect(lines.팔).toBeUndefined();
  });

  it('열두 줄을 넘는 몫은 버린다 — 자리 없는 줄이 합계에만 더해지면 안 된다', () => {
    const lines = labLines([{ option: 'atk_pct', count: 20 }]);
    const total = (['머리', '몸통', '팔', '다리'] as const)
      .reduce((sum, part) => sum + (lines[part]?.length ?? 0), 0);
    expect(total).toBe(MAX_LINES);
  });

  it('합계는 9단계 값으로 센다', () => {
    const value = labOverrides(undefined,
      [{ option: 'element_bonus', count: 4 }, { option: 'atk_pct', count: 2 }], steps);
    expect(value.overload).toEqual({ element_bonus: 83, atk_pct: 20.8 });
  });

  it('그 니케에 잡혀 있던 다른 설정은 그대로 둔다', () => {
    const value = labOverrides({ growthStage: 7, cube: { name: '재장', level: 15 } },
      [{ option: 'atk_pct', count: 1 }], steps);
    expect(value.growthStage).toBe(7);
    expect(value.cube).toEqual({ name: '재장', level: 15 });
  });

  it('빈 옵션은 줄로 세지 않는다', () => {
    expect(pickedLines([{ option: '', count: 5 }, { option: 'atk_pct', count: 2 }])).toBe(2);
  });
});

describe('편성 세우기', () => {
  it('짬통덱은 재는 니케와 겹치지 않게 채운다', () => {
    const setup = { ...emptySetup(), measured: ['라피'] };
    expect(labSquad(setup)).toEqual(['라피', '리틀 머메이드', '그레이브']);
    expect(labSquad({ ...emptySetup(), measured: ['앨리스'] }))
      .toEqual(['앨리스', ...JUNK_FILLER]);
  });

  it('커스텀덱은 고른 것만 세운다', () => {
    const setup = {
      ...emptySetup(), measured: ['앨리스'], filler: 'custom' as const,
      custom: ['크라운', '', '앨리스', '라피'],
    };
    // 빈 칸과 겹치는 이름은 떨어진다.
    expect(labSquad(setup)).toEqual(['앨리스', '크라운', '라피']);
  });

  it('세트로 둘을 재면 둘 다 앞에 선다', () => {
    expect(labSquad({ ...emptySetup(), measured: ['앨리스', '크라운'] }))
      .toEqual(['앨리스', '크라운', ...JUNK_FILLER]);
  });
});

describe('견줄 수 있나', () => {
  it('니케를 안 골랐으면 막는다', () => {
    expect(labProblem(emptySetup())).toContain('재는 니케');
  });

  it('양쪽이 다 비면 막는다 — 0줄과 0줄은 견줄 것이 없다', () => {
    expect(labProblem({ ...emptySetup(), measured: ['앨리스'] })).toContain('오버로드 옵션');
  });

  it('한 벌만 골라도 된다 — 0줄과 견준다', () => {
    expect(labProblem({
      ...emptySetup(), measured: ['앨리스'], setA: [{ option: 'atk_pct', count: 2 }],
    })).toBeNull();
  });

  it('열두 줄을 넘게 고르면 그 사실을 적는다', () => {
    const problem = labProblem({
      ...emptySetup(), measured: ['앨리스'], setA: [{ option: 'atk_pct', count: 13 }],
    });
    expect(problem).toContain('13줄');
  });
});

describe('차이 읽기', () => {
  const side = (damage: number, count: number) =>
    ({ picks: [{ option: 'atk_pct', count }], damage, squadTotal: damage * 2 });

  it('A가 몇 % 높은지', () => {
    expect(labGain({ a: side(110, 6), b: side(100, 6) })).toBeCloseTo(10, 6);
  });

  it('줄 수가 같으면 한 줄당 값을 내지 않는다', () => {
    expect(labPerLine({ a: side(110, 6), b: side(100, 6) })).toBeNull();
  });

  it('줄 수가 다르면 한 줄당으로 환산한다', () => {
    // 두 줄 더 써서 10% 올랐으면 한 줄당 5%다.
    expect(labPerLine({ a: side(110, 8), b: side(100, 6) })).toBeCloseTo(5, 6);
  });
});

describe('화면', () => {
  let host: HTMLElement;

  const result = (charTotals: Record<string, number>): SimulationResult => ({
    squadTotal: Object.values(charTotals).reduce((sum, value) => sum + value, 0),
    duration: 180, hitCount: 10, charTotals, previewNote: '', deviations: '',
  });

  beforeEach(() => {
    host = document.createElement('section');
    document.body.replaceChildren(host);
  });

  it('고른 대로 두 판을 돌리고 차이를 적는다', async () => {
    const runs: Array<{ squad: string[]; overload: Record<string, number> | undefined }> = [];
    const run = vi.fn(async (squad: string[], characters) => {
      runs.push({ squad, overload: characters['앨리스']?.overload });
      // 첫 판(A)이 더 세게 나오도록 준다.
      return result({ 앨리스: runs.length === 1 ? 120 : 100, 라피: 10 });
    });
    mountOverloadLab(host, { catalog, settings, run, baseOf: () => undefined });

    const pick = host.querySelector<HTMLSelectElement>('[data-lab-pick]')!;
    pick.value = '앨리스';
    pick.dispatchEvent(new Event('change', { bubbles: true }));

    host.querySelector<HTMLButtonElement>('[data-lab-set="A"] [data-lab-add]')!.click();
    const option = host.querySelector<HTMLSelectElement>('[data-lab-option="0"]')!;
    option.value = 'element_bonus';
    option.dispatchEvent(new Event('change', { bubbles: true }));
    const count = host.querySelector<HTMLInputElement>('[data-lab-count="0"]')!;
    count.value = '4';
    count.dispatchEvent(new Event('change', { bubbles: true }));

    host.querySelector<HTMLButtonElement>('[data-lab-run]')!.click();
    await vi.waitFor(() => expect(host.querySelector('[data-lab-verdict]')).not.toBeNull());

    expect(run).toHaveBeenCalledTimes(2);
    // 재는 니케가 맨 앞, 나머지는 짬통덱이다.
    expect(runs[0]!.squad).toEqual(['앨리스', ...JUNK_FILLER]);
    // A는 고른 옵션으로, B는 빈 묶음(0줄)으로 돈다.
    expect(runs[0]!.overload).toEqual({ element_bonus: 83 });
    expect(runs[1]!.overload).toEqual({});
    expect(host.querySelector('[data-lab-verdict]')!.textContent).toContain('A가 20.00% 높습니다');
  });

  it('고른 것이 모자라면 돌리지 않고 무엇이 모자란지 적는다', () => {
    const run = vi.fn();
    mountOverloadLab(host, { catalog, settings, run, baseOf: () => undefined });
    host.querySelector<HTMLButtonElement>('[data-lab-run]')!.click();
    expect(run).not.toHaveBeenCalled();
    expect(host.querySelector('[data-lab-message]')!.textContent).toContain('재는 니케');
  });
});
