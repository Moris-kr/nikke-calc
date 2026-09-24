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
  for (const skill of ['스킬 1', '스킬 2', '버스트 스킬']) {
    expect(root.querySelector<HTMLSelectElement>(`select[aria-label="신 : 스위프트 바니 ${skill} 목표"]`)!.value).toBe('10');
  }
  change('캐릭터 1', '길티 : 마이티 바니');
  expect(root.querySelector<HTMLSelectElement>('select[aria-label="길티 : 마이티 바니 스킬 1 목표"]')!.value).toBe('10');
  change('캐릭터 1', '신 : 스위프트 바니');
  change('신 : 스위프트 바니 스킬 2 목표', '5');
  change('신 : 스위프트 바니 버스트 스킬 목표', '7');
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
  for (const [name, current] of [[names[0]!, [4, 5, 7]], [names[1]!, [1, 1, 1]]] as const) {
    ['스킬 1', '스킬 2', '버스트 스킬'].forEach((skill, i) => change(`${name} ${skill} 목표`, String(current[i])));
  }
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

it('결과표의 재료와 코드 매뉴얼 목록에 아이템 아이콘을 붙인다', () => {
  mount().render(root); click('캐릭터 추가');
  const row = root.querySelector('[data-material-result="7091001"] th')!;
  expect(row.querySelector<HTMLImageElement>('img[data-item-icon="7091001"]')!.getAttribute('src')).toContain('manuals/7091001.png');
  // 이름은 글자가 말한다 — 아이콘은 장식이라 alt가 비어 있다.
  expect(row.querySelector('img')!.alt).toBe('');
  expect(row.textContent).toContain('스킬 매뉴얼 I');
  const codes = [...root.querySelectorAll<HTMLElement>('[data-code-manual]')];
  expect(codes.length).toBeGreaterThan(0);
  for (const item of codes) {
    expect(item.querySelector('img')!.getAttribute('src')).toContain(`items/${item.dataset.codeManual}.webp`);
  }
});

it('부족분을 채우는 30 DAY 성장 보급 상자 개수와 교환을 보여 준다', () => {
  mount().render(root); click('캐릭터 추가');
  const chest = root.querySelector<HTMLElement>('[data-chest-plan]')!;
  expect(chest.querySelector('img[data-item-icon="9201010"]')!.getAttribute('src')).toContain('items/9201010.webp');
  const rows = [...chest.querySelectorAll<HTMLElement>('[data-chest-row]')];
  expect(rows.length).toBeGreaterThan(0);
  // 스킬 매뉴얼 I은 상자 1개에 28개 — 부족분을 28로 나눠 올림한 만큼 연다.
  const shortage = Number(root.querySelector('[data-material-result="7091001"] .manual-shortage')!.textContent!.replace(/,/g, ''));
  const skill1 = chest.querySelector('[data-chest-row="7091001"]')!;
  expect(skill1.textContent).toContain(`28개로 교환 × ${Math.ceil(shortage / 28)}개`);
  const total = rows.reduce((sum, row) => sum + Number(/× ([\d,]+)개/.exec(row.textContent!)![1]!.replace(/,/g, '')), 0);
  expect(chest.querySelector('h3')!.textContent).toContain(`${total.toLocaleString()}개로 부족분을 채울 수 있습니다`);
});
