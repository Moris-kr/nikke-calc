// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildCases, countCases, deckForCase, findBestCubes, runCases, type LabRun } from './deck-lab';
import { mountDeckLab, type DeckLabDeps } from './deck-lab-ui';
import type { CharacterMeta, DeckState, SettingsCatalog } from './types';

/** 큐브마다 정해 둔 배율로 총딜을 매기는 가짜 판 — 니케별 «좋아하는 큐브»가 있다. */
const BONUS: Record<string, Record<string, number>> = {
  A: { 어설트: 30, 베어: 10 },
  B: { 베어: 20, 어설트: 5 },
  C: {},
};
function fakeRun(log: DeckState[] = []) {
  return async (deck: DeckState): Promise<LabRun> => {
    log.push(structuredClone(deck));
    const charTotals: Record<string, number> = {};
    for (const name of deck.squad) {
      if (!name) continue;
      const cube = deck.characters[name]?.cube?.name ?? '없음';
      charTotals[name] = 100 + (BONUS[name]?.[cube] ?? 0) + (name === 'D' ? 50 : 0);
    }
    return { squadTotal: Object.values(charTotals).reduce((a, b) => a + b, 0), charTotals };
  };
}

const deckOf = (squad: string[]): DeckState => ({ id: 1, squad, characters: {} });

describe('최적큐브 찾기', () => {
  it('1번부터 차례로, 덱 총딜이 가장 높은 큐브를 끼운다', async () => {
    const log: DeckState[] = [];
    const result = await findBestCubes({
      deck: deckOf(['A', 'B', 'C', '', '']),
      cubes: ['베어', '어설트'],
      levelOf: () => 15,
      defaultCube: () => ({ name: '없음', level: 0 }),
      baseOverrides: () => ({}),
      run: fakeRun(log),
      limit: 1,
    });
    expect(result.steps.map((step) => [step.name, step.after?.name, step.changed])).toEqual([
      ['A', '어설트', true], ['B', '베어', true], ['C', '없음', false],
    ]);
    expect(result.baseTotal).toBe(300);
    expect(result.finalTotal).toBe(350);
    expect(result.deck.characters.A?.cube).toEqual({ name: '어설트', level: 15 });
    // 2번을 잴 때는 1번에 고른 큐브가 이미 끼워져 있다.
    const bTrial = log.find((deck) => deck.characters.B?.cube?.name === '베어');
    expect(bTrial?.characters.A?.cube?.name).toBe('어설트');
    // 기준 1판 + 니케 3명 × 큐브 2종.
    expect(log).toHaveLength(7);
  });

  it('지금 큐브와 같으면 다시 돌리지 않고, 같은 값이면 바꾸지 않는다', async () => {
    const log: DeckState[] = [];
    const deck = deckOf(['A', '', '', '', '']);
    deck.characters.A = { cube: { name: '어설트', level: 15 } };
    const result = await findBestCubes({
      deck, cubes: ['베어', '어설트'], levelOf: () => 15,
      defaultCube: () => undefined, baseOverrides: () => ({}), run: fakeRun(log),
    });
    expect(result.steps[0]!.changed).toBe(false);
    expect(log).toHaveLength(2); // 기준 + 베어
  });
});

describe('니케 경우의 수', () => {
  it('자리마다 지금 니케 + 후보를 곱하고, 겹치는 조합은 뺀다', () => {
    const cases = buildCases(['A', 'B', '', '', ''], [['C', 'B'], ['C'], [], [], []]);
    expect(cases[0]).toEqual(['A', 'B', '', '', '']);
    // 1번: A·C·B / 2번: B·C → 6 중 (C,C)·(B,B) 두 개가 빠진다.
    expect(cases).toHaveLength(4);
    expect(cases).not.toContainEqual(['C', 'C', '', '', '']);
    expect(countCases(['A', 'B', '', '', ''], [['C', 'B'], ['C'], [], [], []])).toBe(4);
  });

  it('남은 니케는 설정을 지키고, 새 니케는 받아 온 설정을 쓴다', () => {
    const deck = deckOf(['A', 'B', '', '', '']);
    deck.characters.A = { growthStage: 7 };
    deck.characters.B = { growthStage: 3 };
    const next = deckForCase(deck, ['A', 'D', '', '', ''], (name) => (name === 'D' ? { growthStage: 9 } : undefined));
    expect(next.characters).toEqual({ A: { growthStage: 7 }, D: { growthStage: 9 } });
  });

  it('모든 편성을 돌려 덱 총딜과 바뀐 자리를 돌려준다', async () => {
    const results = await runCases({
      deck: deckOf(['A', 'B', '', '', '']), alternatives: [[], ['D'], [], [], []],
      overridesFor: () => undefined, run: fakeRun(),
    });
    expect(results.map((entry) => [entry.squad[1], entry.total, entry.changed])).toEqual([
      ['B', 200, []], ['D', 250, [1]],
    ]);
  });
});

describe('덱 실험실 창', () => {
  const settings = {
    cubes: {
      어설트: { label: '어설트', id: 1, stat: '', template: '', levels: { '15': { atk: 0, def: 0, effect: 0 } } },
      베어: { label: '베어', id: 2, stat: '', template: '', levels: { '15': { atk: 0, def: 0, effect: 0 } } },
    },
    characters: {},
  } as unknown as SettingsCatalog;
  const catalog = ['A', 'B', 'C', 'D'].map((name) => ({ name, aliases: [] })) as unknown as CharacterMeta[];
  const mount = (deck: DeckState) => {
    const root = document.createElement('div');
    document.body.append(root);
    const applied: DeckState[] = [];
    const deps: DeckLabDeps = {
      settings, catalog, activeDeck: () => deck, deckLabel: () => '덱 1', run: fakeRun(),
      overridesFor: () => undefined, knownCubeLevels: () => ({}),
      applyDeck: (next) => { applied.push(next); deck.squad = next.squad; deck.characters = next.characters; return null; },
    };
    return { root, applied, lab: mountDeckLab(root, deps) };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('최적큐브 찾기는 창을 먼저 열고, 계산 시작을 눌러야 돌린 뒤 끼운다', async () => {
    const deck = deckOf(['A', 'B', '', '', '']);
    const { root, applied, lab } = mount(deck);
    lab.openCubeFinder();
    const modal = root.querySelector<HTMLElement>('[data-cube-finder-modal]')!;
    expect(modal.hidden).toBe(false);
    expect(modal.textContent).toContain('1번 자리 니케에 큐브를 하나씩');
    expect(applied).toHaveLength(0);
    modal.querySelector<HTMLButtonElement>('[data-cube-finder-start]')!.click();
    for (let i = 0; i < 20 && !applied.length; i += 1) await settle();
    expect(applied).toHaveLength(1);
    expect(deck.characters.A?.cube?.name).toBe('어설트');
    expect(deck.characters.B?.cube?.name).toBe('베어');
    expect(modal.querySelector('[data-cube-finder-summary]')?.textContent).toContain('+');
    // 되돌리기
    modal.querySelector<HTMLButtonElement>('[data-cube-finder-undo]')!.click();
    expect(deck.characters).toEqual({});
    lab.dispose();
    root.remove();
  });

  it('니케 경우의 수는 후보를 고른 뒤 돌리고, 순위대로 보여 주며 적용할 수 있다', async () => {
    const deck = deckOf(['A', 'B', '', '', '']);
    const { root, lab } = mount(deck);
    lab.openNikkeCases();
    const modal = root.querySelector<HTMLElement>('[data-nikke-cases-modal]')!;
    const start = modal.querySelector<HTMLButtonElement>('[data-nikke-cases-start]')!;
    expect(start.disabled).toBe(true);
    const search = modal.querySelector<HTMLInputElement>('[data-case-search="2"]')!;
    search.value = 'D';
    search.dispatchEvent(new Event('input'));
    modal.querySelector<HTMLButtonElement>('[data-case-hit="D"]')!.click();
    expect(modal.querySelector('[data-nikke-cases-count]')?.textContent).toContain('2개');
    expect(start.disabled).toBe(false);
    start.click();
    for (let i = 0; i < 20 && !modal.querySelector('[data-case-row]'); i += 1) await settle();
    const rows = [...modal.querySelectorAll<HTMLElement>('[data-case-row]')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('D');
    rows[0]!.querySelector<HTMLButtonElement>('[data-case-apply]')!.click();
    expect(deck.squad).toEqual(['A', 'D', '', '', '']);
    expect(modal.hidden).toBe(true);
    lab.dispose();
    root.remove();
  });
});
