import { describe, expect, it } from 'vitest';

import {
  buildAddPrompt,
  customToMeta,
  customToSettings,
  parseCustomInput,
  unsupportedEffects,
} from './custom-nikke';

const validJson = JSON.stringify({
  name: '테스트 : 신캐',
  nikke: {
    rarity: 'SSR', element_code: '전격', class: '화력형', manufacturer: '테트라',
    weapon_type: 'AR', burst_stage: 3, burst_cooldown: 40, max_ammo: 60,
    reload_time: 1.0, fire_rate: 12.0, damage_coeff: 13.65,
  },
  skills: [
    { source: '스킬1', type: 'buff', name: 'x', trigger: { timing: ['full_burst_start'], condition: [] }, target: 'self', stat: 'atk_pct', values: { '1': 10, '10': 20 }, duration: 10 },
  ],
});

describe('parseCustomInput', () => {
  it('parses a valid custom character and fills defaults', () => {
    const custom = parseCustomInput(validJson);
    expect(custom.name).toBe('테스트 : 신캐');
    expect(custom.nikke.weapon_type).toBe('AR');
    expect(custom.nikke.pellets).toBe(1); // 누락 시 기본값
    expect(custom.nikke.muzzles).toBe(1);
    expect(custom.skills).toHaveLength(1);
  });

  it('fills charge_time and full_charge_mult for SR/RL weapons', () => {
    const rl = JSON.parse(validJson);
    rl.nikke.weapon_type = 'RL';
    delete rl.nikke.charge_time;
    delete rl.nikke.full_charge_mult;
    const custom = parseCustomInput(JSON.stringify(rl));
    expect(custom.nikke.charge_time).toBe(1.0);
    expect(custom.nikke.full_charge_mult).toBe(250.0);
    // 연사형에는 차지 필드를 넣지 않는다
    const ar = parseCustomInput(validJson);
    expect(ar.nikke.charge_time).toBeUndefined();
  });

  it('rejects malformed or incomplete input with readable errors', () => {
    expect(() => parseCustomInput('not json')).toThrow(/JSON/);
    expect(() => parseCustomInput('{}')).toThrow(/name/);
    expect(() => parseCustomInput(JSON.stringify({ name: 'a', skills: [] })))
      .toThrow(/nikke/);
    const badWeapon = JSON.parse(validJson);
    badWeapon.nikke.weapon_type = 'XX';
    expect(() => parseCustomInput(JSON.stringify(badWeapon))).toThrow(/weapon_type/);
    const missing = JSON.parse(validJson);
    delete missing.nikke.max_ammo;
    expect(() => parseCustomInput(JSON.stringify(missing))).toThrow(/누락/);
  });
});

describe('customToMeta / customToSettings', () => {
  it('derives selector metadata and settings defaults', () => {
    const custom = parseCustomInput(validJson);
    const meta = customToMeta(custom);
    expect(meta).toMatchObject({
      name: '테스트 : 신캐', burstStage: '3', elementCode: '전격',
      weaponType: 'AR', className: '화력형', preview: false,
    });
    const settings = customToSettings(custom);
    expect(settings.rarity).toBe('SSR');
    expect(settings.maxGrowthStage).toBe(10);
    expect(settings.growthOptions).toHaveLength(11);
    expect(settings.overload.max_ammo_pct).toBe(129.64);
  });

  it('scales growth options down for lower rarities', () => {
    const sr = JSON.parse(validJson);
    sr.nikke.rarity = 'SR';
    expect(customToSettings(parseCustomInput(JSON.stringify(sr))).maxGrowthStage).toBe(2);
  });
});

describe('unsupportedEffects', () => {
  it('flags effects with stat/timing/target the engine does not recognize', () => {
    const flagged = unsupportedEffects([
      { name: 'ok', type: 'buff', stat: 'atk_pct', trigger: { timing: ['full_burst_start'] }, target: 'self' },
      { name: 'ok-suffix', type: 'buff', stat: 'atk_pct', trigger: { timing: ['hit_count:5'] }, target: 'allies_code:전격' },
      { name: 'bad-stat', type: 'buff', stat: 'received_dmg_pct', trigger: { timing: ['burst_cast'] }, target: 'self' },
      { name: 'bad-timing', type: 'buff', stat: 'atk_pct', trigger: { timing: ['full_charge_attack'] }, target: 'self' },
      { name: 'bad-target', type: 'buff', stat: 'atk_pct', trigger: { timing: ['burst_cast'] }, target: 'all_enemies_in_range' },
      { name: 'ok-dmg', type: 'damage', stat: 'burst_damage', trigger: { timing: ['burst_cast'] }, target: 'all_enemies' },
    ]);
    expect(flagged).toEqual(['bad-stat', 'bad-timing', 'bad-target']);
  });
});

describe('buildAddPrompt', () => {
  it('includes the schema and a worked example', () => {
    const prompt = buildAddPrompt();
    expect(prompt).toContain('"skills"');
    expect(prompt).toContain('프리바티');
    expect(prompt).toContain('[여기에 니케 이름과 스킬 설명을 붙여넣으세요]');
  });
});
