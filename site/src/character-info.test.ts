// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customSkillInfo, openCharacterInfo, skillDescription, skillsForFavorite, type InfoSkill } from './character-info';
import type { CharacterMeta } from './types';

const skill: InfoSkill = { key: '1', name: '시험 스킬', template: '공격력 {0}% 증가\n{1}초 유지', values: { '1': ['10', '5'], '10': ['30', '10'] } };
const char = { name: '시험 캐릭터', burstStage: '3', manufacturer: '미실리스', className: '화력형', elementCode: '수냉', weaponType: 'SR' } as CharacterMeta;
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); } });
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
describe('character information', () => {
  it('uses only favorite replacements unlocked at the configured stage', () => {
    const info = { skills: [skill], favorite: { name: '애장품', skills: [{ ...skill, stage: 1, template: '1단계 {0}' }, { ...skill, stage: 3, template: '3단계 {0}' }] } };
    expect(skillsForFavorite(info, 0)[0]!.template).toBe(skill.template);
    expect(skillsForFavorite(info, 2)[0]!.template).toBe('1단계 {0}');
    expect(skillsForFavorite(info, 3)[0]!.template).toBe('3단계 {0}');
  });
  it('uses exact level values and does not invent missing levels', () => {
    expect(skillDescription(skill, 1)).toBe('공격력 10% 증가\n5초 유지');
    expect(skillDescription(skill, 10)).toBe('공격력 30% 증가\n10초 유지');
    expect(skillDescription(skill, 5)).toContain('데이터가 없습니다');
  });
  it('updates descriptions and current deck levels, and closes cleanly', () => {
    const onChange = vi.fn(), onClose = vi.fn();
    openCharacterInfo({ host: document.body, char, info: { skills: [skill] }, levels: { '1': 10, '2': 8, '3': 7 }, locked: false, inDeck: true, onChange, onClose });
    const select = document.querySelector('select')!;
    select.value = '1'; select.dispatchEvent(new Event('change'));
    expect(document.body.textContent).toContain('공격력 10% 증가');
    expect(onChange).toHaveBeenCalledWith({ '1': 1, '2': 8, '3': 7 });
    document.querySelector('button')!.click();
    expect(document.querySelector('dialog')).toBeNull(); expect(onClose).toHaveBeenCalledOnce();
  });
  it('lets unselected characters preview levels without changing a deck', () => {
    const onChange = vi.fn();
    openCharacterInfo({ host: document.body, char, info: { skills: [skill] }, levels: { '1': 10, '2': 10, '3': 10 }, locked: false, inDeck: false, onChange, onClose: vi.fn() });
    const select = document.querySelector('select')!; select.value = '1'; select.dispatchEvent(new Event('change'));
    expect(document.body.textContent).toContain('공격력 10% 증가'); expect(onChange).not.toHaveBeenCalled();
  });
  it('locks preview skills to level ten', () => {
    openCharacterInfo({ host: document.body, char: { ...char, preview: true }, info: { skills: [skill] }, levels: { '1': 1, '2': 1, '3': 1 }, locked: true, inDeck: true, onChange: vi.fn(), onClose: vi.fn() });
    expect(document.querySelector('select')!.disabled).toBe(true);
    expect(document.querySelector('select')!.value).toBe('10');
    expect(document.body.textContent).toContain('레벨 10 데이터만');
  });
  it('groups custom effects by skill and only exposes fully known levels', () => {
    const info = customSkillInfo([{ source: '버스트스킬', name: '연속 사격', stat: 'atk_pct', target: 'self', trigger: { timing: ['burst_cast'] }, values: { '10': 80 }, duration: 10 }, { source: '버스트스킬', name: '연속 사격', stat: 'charge_speed_pct', target: 'self', trigger: { timing: ['burst_cast'] }, values: { '10': 50 }, duration: 10 }]);
    expect(info.skills).toHaveLength(1); expect(info.skills[0]!.key).toBe('3');
    expect(skillDescription(info.skills[0]!, 10)).toContain('공격력 증가 (%): 80');
    expect(skillDescription(info.skills[0]!, 10)).toContain('차지 속도 증가 (%): 50');
    expect(Object.keys(info.skills[0]!.values)).toEqual(['10']);
  });
});
