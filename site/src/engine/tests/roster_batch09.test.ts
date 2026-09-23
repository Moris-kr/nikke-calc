// py: calculator/test_roster_batch09.py
import { beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { loadEngineData, readJson } from './helpers';

const BATCH = ['네로', '비스킷', '라이', '길티', '신', '퀀시', '노이즈', '아리아', '아비스타', '일레그'];
function skills(): Record<string, any[]> { return readJson('data/parsed_skills.json'); }
function find(n: string, name: string): any {
  const e = (skills()[n] as any[]).find((x) => x.name === name);
  if (e === undefined) throw new Error('StopIteration');
  return e;
}

beforeAll(loadEngineData);

describe('Batch09', () => {
  it('test_registered', () => {
    const s = skills();
    expect(BATCH.every((n) => n in s)).toBe(true);
    expect(Object.keys(s).filter((n) => !n.startsWith('test_')).length).toBeGreaterThanOrEqual(176);
  });

  it('test_contracts', () => {
    expect(find('퀀시', '은밀한 공범자').trigger.timing).toEqual(['every:8s']);
    expect(find('아비스타', '애프터 쇼').target).toBe('allies_named:아니스 : 스타');
    expect(find('네로', '고양이 보은 2').max_stack).toBe(5);
    expect(find('길티', '빌려 갈게에….').stat).toBe('atk_copy');
    expect(find('일레그', '붐 인스톨').stat).toBe('split_dmg_pct');
  });

  it('test_simulate', () => {
    const cases: Array<[string, string[]]> = [
      ['네로', ['리틀 머메이드', '네로', 'test_B3']], ['비스킷', ['리틀 머메이드', '비스킷', 'test_B3']],
      ['라이', ['라이', '크라운', 'test_B3']], ['길티', ['리틀 머메이드', '길티', 'test_B3']],
      ['신', ['리틀 머메이드', '신', 'test_B3']], ['퀀시', ['리틀 머메이드', '퀀시', 'test_B3']],
      ['노이즈', ['노이즈', '크라운', 'test_B3']], ['아리아', ['리틀 머메이드', '아리아', 'test_B3']],
      ['아비스타', ['아비스타', '리틀 머메이드', 'test_B3', '아니스 : 스타']],
      ['일레그', ['리틀 머메이드', '일레그', 'test_B3']]];
    for (const [n, m] of cases) {
      // subTest(n=n)
      const q = build_squad(m);
      const r = simulate(q, build_config(q, { first_burst_time: 1, duration: 8 }), null, false, 1);
      expect(r.hits.some((h) => h.caster === n), n).toBe(true);
    }
  }, 60_000);
});
