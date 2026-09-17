// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { createSkillPlanner } from './skill-planner-ui';
import { PLANNER_KEY } from './skill-planner';
import type { CharacterMeta } from './types';

const names = ['신 : 스위프트 바니', '길티 : 마이티 바니'];
const catalog = names.map((name) => ({ name, aliases: [], image: null })) as unknown as CharacterMeta[];
let root: HTMLDivElement;
beforeEach(() => { localStorage.clear(); root = document.createElement('div'); document.body.replaceChildren(root); });
const click = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label)!.click();
const change = (label: string, value: string) => {
  const input = [...root.querySelectorAll('select')].find((el) => el.getAttribute('aria-label') === label)!;
  input.value = value; input.dispatchEvent(new Event('change'));
};
const mount = () => createSkillPlanner({ catalog: () => catalog, roster: () => ({ [names[0]!]: { skillLevels: { '1': 4, '2': 5, '3': 7 } } }), storage: () => localStorage, importProfile: vi.fn() });

it('loads current skills from the profile, calculates a target and preserves it across mounts', () => {
  mount().render(root); click('캐릭터 추가');
  expect(root.querySelector<HTMLSelectElement>('select[aria-label="신 : 스위프트 바니 스킬 1 현재"]')?.value).toBe('4');
  change('신 : 스위프트 바니 스킬 1 목표', '5');
  expect(root.querySelector('[data-material-result="7091001"]')!.textContent).toContain('42');
  const input = root.querySelector<HTMLInputElement>('[data-manual-inventory="7091001"]')!;
  input.value = '50'; input.dispatchEvent(new Event('input'));
  mount().render(root);
  expect(root.querySelector<HTMLInputElement>('[data-manual-inventory="7091001"]')!.value).toBe('50');
  expect(root.querySelector<HTMLSelectElement>('select[aria-label="신 : 스위프트 바니 스킬 1 목표"]')!.value).toBe('5');
  expect(localStorage.getItem(PLANNER_KEY)).not.toBeNull();
});

it('adds distinct characters, falls back to level 1 and removes rows from totals', () => {
  mount().render(root); click('캐릭터 추가'); click('캐릭터 추가');
  expect(root.querySelectorAll('.skill-plan-row')).toHaveLength(2);
  expect(root.querySelector<HTMLSelectElement>('select[aria-label="길티 : 마이티 바니 스킬 1 현재"]')!.value).toBe('1');
  change('길티 : 마이티 바니 스킬 1 목표', '2');
  expect(root.querySelector('[data-material-result="7091001"]')!.textContent).toContain('8');
  [...root.querySelectorAll('button')].filter((b) => b.textContent === '삭제')[1]!.click();
  expect(root.querySelector('[data-material-result="7091001"]')!.textContent).not.toContain('8');
});

it('does not show misleading totals for blank or negative inventory', () => {
  mount().render(root);
  const input = root.querySelector<HTMLInputElement>('[data-manual-inventory]')!;
  for (const value of ['', '-1', '1.5']) {
    input.value = value; input.dispatchEvent(new Event('input'));
    expect(root.querySelector('.skill-plan-result')!.textContent).toContain('0 이상의 정수');
    expect(root.querySelector('.skill-plan-result table')).toBeNull();
  }
});

it('reapplies only known profile levels, retaining manually entered unlinked characters', () => {
  mount().render(root); click('캐릭터 추가'); click('캐릭터 추가');
  change('신 : 스위프트 바니 스킬 1 현재', '6');
  change('길티 : 마이티 바니 스킬 1 현재', '4');
  click('프로필 레벨 다시 적용');
  expect(root.querySelector<HTMLSelectElement>('select[aria-label="신 : 스위프트 바니 스킬 1 현재"]')!.value).toBe('4');
  expect(root.querySelector<HTMLSelectElement>('select[aria-label="길티 : 마이티 바니 스킬 1 현재"]')!.value).toBe('4');
});
