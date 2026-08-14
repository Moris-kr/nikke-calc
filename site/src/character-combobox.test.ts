// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { createCharacterCombobox, type CharacterComboboxOptions } from './character-combobox';
import type { CharacterMeta } from './types';

const catalog: CharacterMeta[] = [
  { name: '리타', burstStage: '1', elementCode: '철갑', weaponType: 'SMG', className: '지원형', manufacturer: '미실리스', preview: false, image: 'characters/liter.webp' },
  { name: '크라운', burstStage: '2', elementCode: '철갑', weaponType: 'MG', className: '방어형', manufacturer: '필그림', preview: false, image: 'characters/crown.webp' },
  { name: '라피 : 레드 후드', burstStage: '3', elementCode: '작열', weaponType: 'AR', className: '화력형', manufacturer: '엘리시온', preview: false, image: 'characters/rapi.webp' },
  { name: '앨리스', burstStage: '3', elementCode: '작열', weaponType: 'SR', className: '화력형', manufacturer: '테트라', preview: false, image: 'characters/alice.webp' },
  { name: '나가', burstStage: '2', elementCode: '전격', weaponType: 'SG', className: '지원형', manufacturer: '미실리스', preview: false, image: null },
];

const mounted: Array<ReturnType<typeof createCharacterCombobox>> = [];

function mount(overrides: Partial<CharacterComboboxOptions> = {}) {
  const selections: string[] = [];
  const combo = createCharacterCombobox({
    idPrefix: 'deck-1-slot-0',
    slotLabel: '스쿼드 슬롯 1',
    catalog,
    selectedName: '리타',
    takenNames: new Set(),
    baseUrl: '/nikke-calc/',
    onOpen: () => undefined,
    onClose: () => undefined,
    onSelect: (name) => selections.push(name),
    ...overrides,
  });
  document.body.append(combo.element);
  mounted.push(combo);
  return { combo, selections };
}

function namesInResults(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('[data-character-option]')]
    .map((option) => option.dataset.characterOption ?? '');
}

afterEach(() => {
  for (const combo of mounted.splice(0)) combo.destroy();
  document.body.replaceChildren();
});

describe('character combobox', () => {
  it('focuses its local search and filters by every character metadata field', () => {
    const { combo } = mount();

    combo.open();
    const search = combo.element.querySelector<HTMLInputElement>('[data-character-search]')!;
    expect(document.activeElement).toBe(search);
    expect(combo.element.querySelector('[data-character-trigger]')?.getAttribute('aria-expanded')).toBe('true');

    search.value = '테트라';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(namesInResults(combo.element)).toEqual(['앨리스']);

    search.value = 'SR';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(namesInResults(combo.element)).toEqual(['앨리스']);
  });

  it('combines the burst filter with the query and reports an empty result', () => {
    const { combo } = mount();
    combo.open();
    const search = combo.element.querySelector<HTMLInputElement>('[data-character-search]')!;

    search.value = '작열';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    combo.element.querySelector<HTMLButtonElement>('[data-burst-filter="2"]')!.click();

    expect(namesInResults(combo.element)).toEqual([]);
    expect(combo.element.querySelector('[data-character-empty]')?.textContent).toContain('검색 결과가 없습니다');

    combo.element.querySelector<HTMLButtonElement>('[data-burst-filter="3"]')!.click();
    expect(namesInResults(combo.element)).toEqual(['라피 : 레드 후드', '앨리스']);
  });

  it('keeps same-deck duplicates visible but disabled', () => {
    const { combo, selections } = mount({ takenNames: new Set(['크라운']) });
    combo.open();

    const duplicate = combo.element.querySelector<HTMLElement>('[data-character-option="크라운"]')!;
    expect(duplicate.getAttribute('aria-disabled')).toBe('true');
    expect(duplicate.textContent).toContain('편성 중');
    duplicate.click();
    expect(selections).toEqual([]);
  });

  it('selects the first matching result with Enter and restores trigger focus', () => {
    const { combo, selections } = mount();
    combo.open();
    const search = combo.element.querySelector<HTMLInputElement>('[data-character-search]')!;
    const trigger = combo.element.querySelector<HTMLButtonElement>('[data-character-trigger]')!;

    search.value = '앨리스';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(search.getAttribute('aria-activedescendant')).toContain('option-');
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(selections).toEqual(['앨리스']);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('skips disabled rows with End and supports the persistent clear option with Home', () => {
    const { combo, selections } = mount({ takenNames: new Set(['나가']) });
    combo.open();
    const search = combo.element.querySelector<HTMLInputElement>('[data-character-search]')!;

    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(selections).toEqual(['앨리스']);

    combo.open();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(selections).toEqual(['앨리스', '']);
  });

  it('closes on Escape or an outside pointer without changing the selection', () => {
    const { combo, selections } = mount();
    const trigger = combo.element.querySelector<HTMLButtonElement>('[data-character-trigger]')!;

    combo.open();
    combo.element.querySelector<HTMLInputElement>('[data-character-search]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);

    combo.open();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(selections).toEqual([]);
  });

  it('exposes combobox, listbox, option, and selected-state semantics', () => {
    const { combo } = mount();
    combo.open();

    const search = combo.element.querySelector<HTMLInputElement>('[role="combobox"]')!;
    const listbox = combo.element.querySelector<HTMLElement>('[role="listbox"]')!;
    const selected = combo.element.querySelector<HTMLElement>('[data-character-option="리타"]')!;
    expect(search.getAttribute('aria-controls')).toBe(listbox.id);
    expect(search.getAttribute('aria-autocomplete')).toBe('list');
    expect(selected.getAttribute('role')).toBe('option');
    expect(selected.getAttribute('aria-selected')).toBe('true');
  });
});
