// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderCharacterSettings } from './character-settings';
import type { CharacterOverrides, SettingsCatalog } from './types';

const settings: SettingsCatalog = {
  characters: {
    리타: {
      overload: {
        element_bonus: 88.6,
        atk_pct: 22.22,
        max_ammo_pct: 129.64,
        crit_rate: 0,
        crit_dmg: 0,
      },
      cube: { name: '재장', level: 15 },
    },
  },
  cubes: {
    재장: { label: '재장', stat: 'reload_speed_pct', template: '재장전 속도 {0} ▲%', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 29.69, commonElement: 19.09 } } },
    탄충: { label: '탄충', stat: 'ammo_charge_flat', template: '10발 사격 시 탄환 충전 {0}발 ▲', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 3, commonElement: 19.09 } } },
    체력: { label: '체력', stat: 'max_hp_pct', template: '최대 체력 {0} ▲%', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 9.69, commonElement: 19.09 } } },
    차속: { label: '차속', stat: 'charge_speed_pct', template: '차지 속도 {0} ▲%', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 2.12, commonElement: 19.09 } } },
    파츠: { label: '파츠', stat: 'part_dmg_pct', template: '파츠 대미지 {0} ▲%', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 31.9, commonElement: 19.09 } } },
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
    attack_speed_pct: { label: '공격 속도', unit: '%', min: -1000, max: 10000 },
  },
};

describe('character settings editor', () => {
  let root: HTMLElement;
  let value: CharacterOverrides | undefined;

  const render = () => renderCharacterSettings(root, '리타', settings, value, (next) => {
    value = next;
  });

  const setToggle = (selector: string, checked: boolean) => {
    const input = root.querySelector<HTMLInputElement>(selector)!;
    input.checked = checked;
    input.dispatchEvent(new Event('change'));
  };

  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    value = undefined;
    render();
  });

  afterEach(() => root.remove());

  it('shows resolved defaults and opens final-value inputs on demand', () => {
    expect(root.textContent).toContain('우코 88.60');
    expect(root.textContent).toContain('공증 22.22');
    expect(root.textContent).toContain('장탄 129.64');
    expect(root.querySelector('[data-character-settings-body]')).toBeNull();

    setToggle('[data-custom-toggle]', true);

    expect(value?.overload).toEqual(settings.characters.리타!.overload);
    expect(root.querySelector<HTMLInputElement>('[data-overload-key="atk_pct"]')?.value).toBe('22.22');
  });

  it('updates cube type and renders its selected-level stats and effects', () => {
    setToggle('[data-custom-toggle]', true);
    const cube = root.querySelector<HTMLSelectElement>('[data-cube-name]')!;
    cube.value = '탄충';
    cube.dispatchEvent(new Event('change'));

    expect(value?.cube).toEqual({ name: '탄충', level: 15 });
    expect(root.textContent).toContain('공격 2,780');
    expect(root.textContent).toContain('10발 사격 시 탄환 충전 3발 ▲');
    expect(root.textContent).toContain('우월 코드 19.09%');
  });

  it('searches, adds, edits, deduplicates, and removes advanced stats', () => {
    setToggle('[data-custom-toggle]', true);
    setToggle('[data-advanced-toggle]', true);
    const search = root.querySelector<HTMLInputElement>('[data-manual-search]')!;
    search.value = '분배';
    search.dispatchEvent(new Event('input'));
    const select = root.querySelector<HTMLSelectElement>('[data-manual-select]')!;
    expect([...select.options].map((option) => option.text)).toContain('분배 대미지');

    select.value = 'split_dmg_pct';
    root.querySelector<HTMLButtonElement>('[data-add-stat]')!.click();
    expect(root.querySelectorAll('[data-manual-row]')).toHaveLength(1);
    const input = root.querySelector<HTMLInputElement>('[data-manual-stat="split_dmg_pct"]')!;
    input.value = '20';
    input.dispatchEvent(new Event('input'));
    expect(value?.manualStats).toEqual({ split_dmg_pct: 20 });

    expect([...root.querySelectorAll<HTMLOptionElement>('[data-manual-select] option')]
      .some((option) => option.value === 'split_dmg_pct')).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-remove-stat="split_dmg_pct"]')!.click();
    expect(value?.manualStats).toEqual({});
  });

  it('disabling custom settings returns to canonical defaults', () => {
    setToggle('[data-custom-toggle]', true);
    root.querySelector<HTMLInputElement>('[data-overload-key="atk_pct"]')!.value = '40';
    root.querySelector<HTMLInputElement>('[data-overload-key="atk_pct"]')!
      .dispatchEvent(new Event('input'));
    setToggle('[data-custom-toggle]', false);

    expect(value).toBeUndefined();
    expect(root.textContent).toContain('기본값');
  });

  it('keeps numeric input focused while consecutive digits are entered', () => {
    setToggle('[data-custom-toggle]', true);
    const input = root.querySelector<HTMLInputElement>('[data-overload-key="atk_pct"]')!;
    input.focus();
    input.value = '4';
    input.dispatchEvent(new Event('input'));

    expect(root.contains(input)).toBe(true);
    expect(document.activeElement).toBe(input);
    input.value = '40';
    input.dispatchEvent(new Event('input'));
    expect(value?.overload?.atk_pct).toBe(40);
  });
});
