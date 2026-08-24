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
      collection: { stage: 'SR15', favorite: 0 },
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
      collection: { stage: 'SR15', favorite: 3 },
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
      collection: { stage: 'SR15', favorite: 0 },
    },
    '신데렐라 : 크리스탈 웨이브': {
      weaponType: 'MG',
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
    },
  },
  collectionStages: ['없음', 'SR0', 'SR5', 'SR15'],
  weaponTypes: ['AR', 'SMG', 'SG', 'MG', 'SR', 'RL'],
  consoleClasses: ['화력형', '방어형', '지원형'],
  consoleCompanies: ['엘리시온', '미실리스', '테트라', '필그림', '어브노말'],
  cubes: {
    재장: { id: 0, label: '재장', stat: 'reload_speed_pct', template: '재장전 속도 {0} ▲%', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 29.69, commonElement: 19.09 } } },
    탄충: { id: 0, label: '탄충', stat: 'ammo_charge_flat', template: '10발 사격 시 탄환 충전 {0}발 ▲', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 3, commonElement: 19.09 } } },
    체력: { id: 0, label: '체력', stat: 'max_hp_pct', template: '최대 체력 {0} ▲%', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 9.69, commonElement: 19.09 } } },
    차속: { id: 0, label: '차속', stat: 'charge_speed_pct', template: '차지 속도 {0} ▲%', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 2.12, commonElement: 19.09 } } },
    파츠: { id: 0, label: '파츠', stat: 'part_dmg_pct', template: '파츠 대미지 {0} ▲%', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 31.9, commonElement: 19.09 } } },
    분배: { id: 0, label: '분배', stat: 'split_dmg_pct', template: '분배 대미지 {0} ▲%', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 17.69, commonElement: 19.09 } } },
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
  favoriteItems: {},
};

describe('character settings editor', () => {
  let root: HTMLElement;
  let value: CharacterOverrides | undefined;
  let characterName: '리타' | '라피' | '아마기 유키코' | '신데렐라 : 크리스탈 웨이브';

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

  it('assigns priority-every-n burst usage and reveals the n input', () => {
    setToggle('[data-custom-toggle]', true);

    const burst = root.querySelector<HTMLSelectElement>('[data-burst-assignment]')!;
    expect([...burst.options].map((option) => option.value)).toEqual(['auto', 'priority', 'skip']);
    expect(burst.value).toBe('auto');
    expect(root.querySelector<HTMLElement>('.burst-every')?.hidden).toBe(true);

    burst.value = 'priority';
    burst.dispatchEvent(new Event('change'));
    expect(value?.burst).toEqual({ mode: 'priority', every: 1 });
    expect(root.querySelector<HTMLElement>('.burst-every')?.hidden).toBe(false);

    const every = root.querySelector<HTMLInputElement>('[data-burst-every]')!;
    every.value = '3';
    every.dispatchEvent(new Event('input'));
    expect(value?.burst).toEqual({ mode: 'priority', every: 3 });

    const burstAgain = root.querySelector<HTMLSelectElement>('[data-burst-assignment]')!;
    burstAgain.value = 'auto';
    burstAgain.dispatchEvent(new Event('change'));
    expect(value?.burst).toBeUndefined();
  });

  it('sets equipment level per part (head, body, arm, leg)', () => {
    setToggle('[data-custom-toggle]', true);

    const head = root.querySelector<HTMLSelectElement>('[data-equip-level="머리"]')!;
    const arm = root.querySelector<HTMLSelectElement>('[data-equip-level="팔"]')!;
    // 스킬 레벨과 같은 방향(오름차순)으로 통일했다.
    expect([...head.options].map((option) => option.value)).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(head.value).toBe('5');
    expect(root.querySelectorAll('[data-equip-level]').length).toBe(4);

    arm.value = '2';
    arm.dispatchEvent(new Event('change'));
    expect(value?.equipLevels).toEqual({ 머리: 5, 몸통: 5, 팔: 2, 다리: 5 });
  });

  it('offers Crystal Wave sniper mode with a six-second default delay', () => {
    characterName = '신데렐라 : 크리스탈 웨이브';
    render();
    setToggle('[data-custom-toggle]', true);

    const checkbox = root.querySelector<HTMLInputElement>('[data-weapon-mode-swap]')!;
    const delay = root.querySelector<HTMLInputElement>('[data-weapon-mode-swap-at]')!;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
    expect(delay.value).toBe('6');
    expect(delay.disabled).toBe(true);
    expect(delay.parentElement?.querySelector('em')?.textContent).toBe('초');
    expect(delay.closest('.weapon-mode-swap')?.textContent).toContain('후부터 전환 시도');

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(value?.weaponModeSwapAt).toBe(6);

    const enabledDelay = root.querySelector<HTMLInputElement>('[data-weapon-mode-swap-at]')!;
    expect(enabledDelay.disabled).toBe(false);
    enabledDelay.focus();
    enabledDelay.value = '8';
    enabledDelay.dispatchEvent(new Event('input'));
    expect(document.activeElement).toBe(enabledDelay);
    enabledDelay.value = '8.5';
    enabledDelay.dispatchEvent(new Event('input'));
    expect(value?.weaponModeSwapAt).toBe(8.5);

    setToggle('[data-weapon-mode-swap]', false);
    expect(value?.weaponModeSwapAt).toBeUndefined();
  });

  it('does not show the sniper mode control for other characters', () => {
    setToggle('[data-custom-toggle]', true);
    expect(root.querySelector('[data-weapon-mode-swap]')).toBeNull();
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

  it('lets a favorite-item character pick the stage actually owned', () => {
    characterName = '라피';
    render();
    setToggle('[data-custom-toggle]', true);

    expect(root.textContent).toContain('기념 열쇠고리');
    const select = root.querySelector<HTMLSelectElement>('[data-collection]')!;
    // 애장품 단계가 먼저 오고, 그 뒤로 소장품 단계가 이어진다.
    expect([...select.options].slice(0, 3).map((option) => option.textContent))
      .toEqual(['애장품 ★★★', '애장품 ★★☆', '애장품 ★☆☆']);
    expect(select.value).toBe('favorite:3');

    // 실제로는 애장품이 없고 소장품 SR5만 낀 경우.
    select.value = 'stage:SR5';
    select.dispatchEvent(new Event('change'));
    expect(value?.collection).toEqual({ stage: 'SR5', favorite: 0 });

    expect(root.querySelectorAll('[data-overload-key]')).toHaveLength(9);
    expect(root.textContent).toContain('차지형 무기가 아니면 차지 옵션은 효과가 없습니다.');
  });

  it('offers only collection stages when the character has no favorite item', () => {
    characterName = '리타';
    render();
    setToggle('[data-custom-toggle]', true);

    const select = root.querySelector<HTMLSelectElement>('[data-collection]')!;
    expect([...select.options].every((option) => !option.value.startsWith('favorite:'))).toBe(true);

    select.value = 'stage:없음';
    select.dispatchEvent(new Event('change'));
    expect(value?.collection).toEqual({ stage: '없음', favorite: 0 });
  });

  it('keeps 컨트롤 beside the stat settings, both folded, not one inside the other', () => {
    characterName = '라피';
    render();
    setToggle('[data-custom-toggle]', true);

    const stats = root.querySelector<HTMLElement>('[data-settings-open]')!;
    const control = root.querySelector<HTMLElement>('[data-control-open]')!;

    // 둘 다 접힌 채로 시작한다 — 개별 설정을 켜는 것과 펼치는 것은 별개다.
    expect(stats.getAttribute('aria-expanded')).toBe('false');
    expect(control.getAttribute('aria-expanded')).toBe('false');

    // 컨트롤은 수치 뭉치 **안**에 있으면 안 된다. 만지는 이유가 다른 두 뭉치다.
    const statsPanel = stats.nextElementSibling!;
    expect(statsPanel.contains(control)).toBe(false);
    // 그리고 그 아래에 온다.
    expect(statsPanel.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // 각자 따로 펼쳐진다.
    control.click();
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(stats.getAttribute('aria-expanded')).toBe('false');
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
    // 직접 켤 때 채워지는 출발값. 엔진의 «추천 자동»(3.6)과는 별개다.
    expect(value?.control?.tap_fire).toEqual({ rate: 4.4, release: 0.03 });

    setToggle('[data-control-mode="auto"]', true);
    expect(value).not.toHaveProperty('control');
  });

  it('lets the tap-fire rate be typed in and shows the 톡톡이 equivalent', () => {
    characterName = '라피';
    render();
    setToggle('[data-custom-toggle]', true);
    setToggle('[data-control-mode="manual"]', true);

    // 켜기 전에는 속도를 만질 수 없다.
    expect(root.querySelector<HTMLInputElement>('[data-tap-rate]')?.disabled).toBe(true);
    setToggle('[data-control="tap_fire"]', true);

    const rate = root.querySelector<HTMLInputElement>('[data-tap-rate]')!;
    expect(rate.disabled).toBe(false);
    expect(rate.value).toBe('4.4');
    expect(root.querySelector('[data-tap-hint]')?.textContent).toContain('44톡톡이');

    rate.value = '4';
    rate.dispatchEvent(new Event('input', { bubbles: true }));
    expect(value?.control?.tap_fire).toEqual({ rate: 4, release: 0.03 });
    expect(root.querySelector('[data-tap-hint]')?.textContent).toContain('40톡톡이');

    // 게임이 강제하는 하한(220ms ≈ 4.5발/초)을 넘으면 그 사실을 알린다.
    rate.value = '6';
    rate.dispatchEvent(new Event('input', { bubbles: true }));
    expect(value?.control?.tap_fire?.rate).toBe(6);
    expect(root.querySelector('[data-tap-hint]')?.textContent).toContain('게임 하한');
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
