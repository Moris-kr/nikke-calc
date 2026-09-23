/**
 * Released bunny skill levels must reach buffs and transformed weapons.
 * 파이썬: calculator/test_bunny_release.py
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineData } from './helpers';
import { BuffManager } from '../buff_manager';
import { build_squad } from '../spec';

beforeAll(loadEngineData);

function manager(name: string, levels: Record<string, number>): BuffManager {
  const chars = build_squad([name], { [name]: { skill_levels: levels } });
  const bm = new BuffManager(chars, { enemy: {} });
  bm.battle_start();
  return bm;
}

describe('BunnyReleaseTest', () => {
  it('test_sin_independent_skill_levels_and_released_weapon_state', () => {
    const name = '신 : 스위프트 바니';
    let bm = manager(name, { 1: 1, 2: 5, 3: 9 });
    let before = bm.get_buffs(name, '', 0);
    bm.notify('full_charge', 1, name);
    const charged = bm.get_buffs(name, '', 1);
    expect(charged['normal_atk_dmg_pct'] - before['normal_atk_dmg_pct']).toBeCloseTo(59.09, 7);
    expect(charged['charge_dmg_pct'] - before['charge_dmg_pct']).toBeCloseTo(30.8, 7);
    bm = manager(name, { 1: 1, 2: 5, 3: 9 });
    before = bm.get_buffs(name, '', 0);
    bm.notify('burst_cast', 2, name);
    expect(bm.weapon_change_name(name)).toBe('스위프트 피어싱');
    const weapon = bm.get_weapon_change(name)!;
    expect(weapon['damage_coeff']['5']).toBe(56.58);
    const after = bm.get_buffs(name, '', 2);
    expect(after['atk_pct'] - before['atk_pct']).toBeCloseTo(105, 7);
    bm.notify('full_charge', 2.5, name);
    expect(bm.get_buffs(name, '', 2.5)['normal_atk_dmg_pct']).toBe(after['normal_atk_dmg_pct']);
  });

  it('test_guilty_independent_skill_levels', () => {
    const name = '길티 : 마이티 바니';
    const bm = manager(name, { 1: 1, 2: 5, 3: 9 });
    const before = bm.get_buffs(name, '', 0);
    bm.notify('burst_cast', 2, name);
    expect(bm.get_weapon_change(name)!['damage_coeff']['9']).toBe(96.86);
    const after = bm.get_buffs(name, '', 2);
    expect(after['charge_dmg_pct'] - before['charge_dmg_pct']).toBeCloseTo(1336.36, 7);
    expect(after['atk_dmg_pct'] - before['atk_dmg_pct']).toBeCloseTo(73.83, 7);
  });
});
