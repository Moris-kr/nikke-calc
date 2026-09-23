// py: calculator/test_roster_batch11.py
import { beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { loadEngineData, readJson } from './helpers';

const B = ['트로니', 'A2', '파스칼', '렘', '에밀리아', '람', '마리', '미사토', '사쿠라 (SR)', '클레어'];

function skills(): Record<string, any[]> { return readJson('data/parsed_skills.json'); }

function next<T>(xs: T[], pred: (x: T) => boolean): T {
  const x = xs.find(pred);
  if (x === undefined) throw new Error('StopIteration');
  return x;
}

beforeAll(loadEngineData);

describe('Batch11', () => {
  it('test_registered', () => {
    const data = skills();
    expect(B.every((name) => name in data)).toBe(true);
    expect(Object.keys(data).filter((n) => !n.startsWith('test_')).length).toBeGreaterThanOrEqual(196);
  });

  it('test_special_contracts', () => {
    const data = skills();
    // python: e['stat'] — 키가 없으면 KeyError. parsed_skills의 모든 항목에 stat이 있다고 본다.
    const bomb = next(data['트로니']!, (e) => e.stat === 'damage_accumulate');
    expect(bomb.trigger.timing).toEqual(['full_charge_hit']);
    expect(bomb.accumulate_ratio_pct).toBe(50);
    const fixed = next(data['에밀리아']!, (e) => e.stat === 'fixed_damage_from_dealt_pct');
    expect(fixed.trigger.timing).toEqual(['full_charge_hit']);
    const mari = data['마리']!.filter((e) => (e.name as string).startsWith('정신 집중'));
    expect(mari.length > 0 && mari.every((e) => JSON.stringify(e.trigger.timing) === JSON.stringify(['every:10s']))).toBe(true);
  });

  it('test_every_character_simulates', () => {
    const meta_all: Record<string, any> = readJson('data/parsed_nikke.json');
    for (const name of B) {
      // subTest(name=name)
      const stage = String(meta_all[name].burst_stage);
      let squad_names: string[];
      if (stage === '1') squad_names = [name, '크라운', 'test_B3'];
      else if (stage === '2') squad_names = ['리틀 머메이드', name, 'test_B3'];
      else squad_names = ['리틀 머메이드', '크라운', name];
      const squad = build_squad(squad_names);
      const result = simulate(squad, build_config(squad, { first_burst_time: 1, duration: 15 }), null, false, 1);
      expect(result.hits.some((h) => h.caster === name), name).toBe(true);
    }
  }, 120_000);

  it('test_emilia_fixed_damage_is_emitted', () => {
    const squad = build_squad(['리틀 머메이드', '크라운', '에밀리아']);
    const result = simulate(squad, build_config(squad, { first_burst_time: 1, duration: 12 }), null, false, 1);
    const fixed = result.hits.filter((h) => h.caster === '에밀리아' && h.hit_tag === 'fixed_damage_from_dealt_pct');
    expect(fixed.length > 0).toBe(true);
  }, 60_000);
});
