// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderCharacterSettings } from './character-settings';
import type { CharacterOverrides, SettingsCatalog } from './types';

const settings: SettingsCatalog = {
  characters: {
    리타: {
      weaponType: 'SMG',
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
    },
    라피: {
      weaponType: 'RL',
      recommendedControl: { tap_fire: { rate: 3.6, release: 0.03 } },
      hasConditionalControl: true,
      favoriteItem: { name: '기념 열쇠고리', stage: 3 },
      growthStage: 2,
      rarity: 'SR',
      maxGrowthStage: 2,
      growthOptions: [
        { value: 0, label: '명함', affinity: 10 },
        { value: 1, label: '1돌', affinity: 20 },
        { value: 2, label: '2돌', affinity: 30 },
      ],
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
    },
    '아마기 유키코': {
      weaponType: 'AR',
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
      skillLevelsLocked: true,
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
    def_pct: { label: '방어력', unit: '%', min: 0, max: 1000 },
    charge_speed_pct: { label: '차지 속도', unit: '%', min: 0, max: 1000 },
    charge_dmg_pct: { label: '차지 대미지', unit: '%', min: 0, max: 1000 },
    accuracy_pct: { label: '명중률', unit: '%', min: 0, max: 1000 },
  },
  manualStats: {
    split_dmg_pct: { label: '분배 대미지', unit: '%', min: -1000, max: 10000 },
    attack_speed_pct: { label: '공격 속도', unit: '%', min: -1000, max: 10000 },
  },
};

describe('character settings editor', () => {
  let root: HTMLElement;
  let value: CharacterOverrides | undefined;
  let characterName: '리타' | '라피' | '아마기 유키코';

  const render = () => renderCharacterSettings(root, characterName, settings, value, (next) => {
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
    characterName = '리타';
    render();
  });

  afterEach(() => root.remove());

  it('shows resolved defaults and opens final-value inputs on demand', () => {
    expect(root.textContent).toContain('스킬 10 / 10 / 10');
    expect(root.textContent).toContain('3돌 · 호감도 30');
    expect(root.textContent).toContain('우코 88.60');
    expect(root.textContent).toContain('공증 22.22');
    expect(root.textContent).toContain('장탄 129.64');
    expect(root.querySelector('[data-character-settings-body]')).toBeNull();

    setToggle('[data-custom-toggle]', true);

    expect(value?.skillLevels).toEqual({ '1': 10, '2': 10, '3': 10 });
    expect(value?.growthStage).toBe(3);
    expect(value?.overload).toEqual(settings.characters.리타!.overload);
    expect(root.querySelector<HTMLInputElement>('[data-overload-key="atk_pct"]')?.value).toBe('22.22');
  });

  it('assigns and clears a burst-usage preference', () => {
    setToggle('[data-custom-toggle]', true);

    const burst = root.querySelector<HTMLSelectElement>('[data-burst-assignment]')!;
    expect([...burst.options].map((option) => option.value)).toEqual(['auto', 'solo', 'skip']);
    expect(burst.value).toBe('auto');

    burst.value = 'solo';
    burst.dispatchEvent(new Event('change'));
    expect(value?.burst).toBe('solo');

    const burstAgain = root.querySelector<HTMLSelectElement>('[data-burst-assignment]')!;
    burstAgain.value = 'auto';
    burstAgain.dispatchEvent(new Event('change'));
    expect(value?.burst).toBeUndefined();
  });

  it('selects a legal growth stage and applies its maximum bond rank', () => {
    setToggle('[data-custom-toggle]', true);

    const growth = root.querySelector<HTMLSelectElement>('[data-growth-stage]')!;
    expect([...growth.options].map((option) => option.text)).toEqual([
      '명함', '1돌', '2돌', '3돌', '코강 1', '코강 2', '코강 3', '코강 4',
      '코강 5', '코강 6', '코강 7',
    ]);
    expect(root.textContent).toContain('호감도는 돌파별 최대치로 적용합니다.');

    growth.value = '0';
    growth.dispatchEvent(new Event('change'));

    expect(value?.growthStage).toBe(0);
    expect(root.textContent).toContain('명함 · 호감도 10');
  });

  it('constrains an SR character to card through limit break two', () => {
    characterName = '라피';
    render();
    setToggle('[data-custom-toggle]', true);

    const growth = root.querySelector<HTMLSelectElement>('[data-growth-stage]')!;
    expect([...growth.options].map((option) => option.text)).toEqual(['명함', '1돌', '2돌']);
    expect(value?.growthStage).toBe(2);
  });

  it('changes skill 1, skill 2, and burst levels independently', () => {
    setToggle('[data-custom-toggle]', true);

    const skillOne = root.querySelector<HTMLSelectElement>('[data-skill-level="1"]')!;
    skillOne.value = '4';
    skillOne.dispatchEvent(new Event('change'));
    const skillTwo = root.querySelector<HTMLSelectElement>('[data-skill-level="2"]')!;
    skillTwo.value = '6';
    skillTwo.dispatchEvent(new Event('change'));
    const burst = root.querySelector<HTMLSelectElement>('[data-skill-level="3"]')!;
    burst.value = '8';
    burst.dispatchEvent(new Event('change'));

    expect(value?.skillLevels).toEqual({ '1': 4, '2': 6, '3': 8 });
    expect(root.textContent).toContain('스킬 4 / 6 / 8');
  });

  it('shows favorite item stage three and all nine overload options', () => {
    characterName = '라피';
    render();
    setToggle('[data-custom-toggle]', true);

    expect(root.textContent).toContain('기념 열쇠고리');
    expect(root.textContent).toContain('애장품 보유 캐릭터는 반드시 애장품 3단계로 적용합니다.');
    expect(root.querySelectorAll('[data-overload-key]')).toHaveLength(9);
    expect(root.textContent).toContain('차지형 무기가 아니면 차지 옵션은 효과가 없습니다.');
  });

  it('switches from recommended controls to exact per-character controls', () => {
    characterName = '라피';
    render();
    setToggle('[data-custom-toggle]', true);

    expect(root.querySelector<HTMLInputElement>('[data-control-mode="auto"]')?.checked).toBe(true);
    expect(root.querySelector('[data-control="tap_fire"]')).not.toBeNull();
    expect(root.querySelector('[data-control="hold"]')).not.toBeNull();
    expect(root.querySelector('[data-control="reload"]')).not.toBeNull();
    expect(root.querySelector('[data-control="cover"]')).not.toBeNull();

    setToggle('[data-control-mode="manual"]', true);
    expect(value?.control).toEqual({});
    setToggle('[data-control="tap_fire"]', true);
    expect(value?.control?.tap_fire).toEqual({ rate: 3.6, release: 0.03 });

    setToggle('[data-control-mode="auto"]', true);
    expect(value).not.toHaveProperty('control');
  });

  it('does not show charge-only controls for a non-charge weapon', () => {
    setToggle('[data-custom-toggle]', true);
    expect(root.querySelector('[data-control="tap_fire"]')).toBeNull();
    expect(root.querySelector('[data-control="hold"]')).toBeNull();
    expect(root.querySelector('[data-control="reload"]')).not.toBeNull();
    expect(root.querySelector('[data-control="cover"]')).not.toBeNull();
  });

  it('shows preview characters as level-ten-only without editable selects', () => {
    characterName = '아마기 유키코';
    render();

    expect(root.textContent).toContain('수치 미공개 · Lv10 고정');
    setToggle('[data-custom-toggle]', true);

    expect(value?.skillLevels).toEqual({ '1': 10, '2': 10, '3': 10 });
    expect(root.querySelectorAll('[data-skill-level]')).toHaveLength(0);
    expect(root.querySelector('[data-skill-levels-locked]')?.textContent)
      .toContain('수치 미공개 · Lv10 고정');
    expect(root.textContent).toContain('1~9레벨 계수가 공개되지 않아');
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
