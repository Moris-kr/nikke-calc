// py: calculator/test_roster_batch12.py
import { beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { loadEngineData, readJson } from './helpers';

const B = ['릴리', '쿠루미', '아이기스'];

function data(): Record<string, any[]> { return readJson('data/parsed_skills.json'); }

beforeAll(loadEngineData);

describe('Batch12', () => {
  it('test_registered', () => {
    const skills = data();
    expect(B.every((n) => n in skills)).toBe(true);
    // 정식 199 + 프리뷰 1(드레이크 : 그레이트 빌런 — 스킬 창작, PARSING-CHARS §프리뷰)
    expect(Object.keys(skills).filter((n) => !n.startsWith('test_')).length).toBe(202);
  });

  it('test_lily_and_aigis_contracts', () => {
    const skills = data();
    const lily = skills['릴리']!;
    expect(lily[0].trigger.timing).toEqual(['every:15s']);
    expect(lily[lily.length - 1].trigger.condition).toContain('no_allies_cover_destroyed');
    const removals = skills['아이기스']!.filter((e) => e.stat === 'remove_named_buff');
    expect(removals.length).toBe(2);
    expect(removals.every((e) => JSON.stringify(e.trigger.timing) === JSON.stringify(['full_burst_end']))).toBe(true);
  });

  it('test_kurumi_conditional_counter_emits_bonus', () => {
    const skills = data();
    const payload = skills['쿠루미']!.find((e) => e.name === '페이로드 확산');
    if (payload === undefined) throw new Error('StopIteration');
    expect(payload.trigger.timing).toEqual(['conditional_hit_count:페이로드 확산:36']);
    const squad = build_squad(['쿠루미', '크라운', 'test_B3']);
    const result = simulate(squad, build_config(squad, { first_burst_time: 1, duration: 12 }), null, false, 1);
    expect(result.hits.some((h) => h.skill_name === '페이로드 확산')).toBe(true);
  }, 60_000);

  it('test_all_simulate', () => {
    const cases: Array<[string, string[]]> = [
      ['릴리', ['리틀 머메이드', '릴리', 'test_B3']],
      ['쿠루미', ['쿠루미', '크라운', 'test_B3']],
      ['아이기스', ['리틀 머메이드', '아이기스', 'test_B3']],
    ];
    for (const [name, names] of cases) {
      // subTest(name=name)
      const squad = build_squad(names);
      const result = simulate(squad, build_config(squad, { first_burst_time: 1, duration: 16 }), null, false, 1);
      expect(result.hits.some((h) => h.caster === name), name).toBe(true);
    }
  }, 60_000);
});
