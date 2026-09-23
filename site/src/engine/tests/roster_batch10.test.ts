// py: calculator/test_roster_batch10.py
import { beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { loadEngineData, readJson } from './helpers';

const B = ['소라', '베이', '클레이', '레이블', '모리', '백학', '마키마', '파워', '히메노', '2B'];
function S(): Record<string, any[]> { return readJson('data/parsed_skills.json'); }

beforeAll(loadEngineData);

describe('Batch10', () => {
  it('test_registered', () => {
    const s = S();
    expect(B.every((n) => n in s)).toBe(true);
    expect(Object.keys(s).filter((n) => !n.startsWith('test_')).length).toBeGreaterThanOrEqual(186);
  });

  it('test_specials', () => {
    const s = S();
    expect(s['2B']!.filter((e) => e.source === '스킬1').length).toBe(3);
    expect(s['2B']!.some((e) => e.stat === 'atk_from_hp_pct')).toBe(true);
    expect(s['베이']!.some((e) => e.favorite === 3)).toBe(true);
    expect(s['클레이']!.some((e) => e.stat === 'armor_break_enabled')).toBe(true);
  });

  it('test_simulate', () => {
    const cases: Array<[string, string[]]> = [
      ['소라', ['소라', '크라운', 'test_B3']], ['베이', ['리틀 머메이드', '베이', 'test_B3']],
      ['클레이', ['리틀 머메이드', '클레이', 'test_B3']], ['레이블', ['레이블', '크라운', 'test_B3']],
      ['모리', ['리틀 머메이드', '모리', 'test_B3']], ['백학', ['리틀 머메이드', '백학', 'test_B3']],
      ['마키마', ['리틀 머메이드', '마키마', 'test_B3']], ['파워', ['리틀 머메이드', '크라운', '파워']],
      ['히메노', ['리틀 머메이드', '히메노', 'test_B3']], ['2B', ['리틀 머메이드', '크라운', '2B']]];
    for (const [n, m] of cases) {
      const q = build_squad(m);
      const r = simulate(q, build_config(q, { first_burst_time: 1, duration: 8 }), null, false, 1);
      expect(r.hits.some((h) => h.caster === n), n).toBe(true);
    }
  }, 60_000);
});
