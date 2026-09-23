// py: calculator/test_flora_stacks.py
// Flora's 100 attacks add current stacks to electric allies, not stack caps.
import { beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '../timeline';
import { BuffManager } from '../buff_manager';
import { build_config, build_squad } from '../spec';
import { data } from '../data';
import { get, minBy } from '../py';
import type { SimResult } from '../sim_result';
import { loadEngineData } from './helpers';

beforeAll(loadEngineData);

const SQUAD = ['리타', '플로라', '신데렐라', '메이든 : 아이스 로즈', '크라운'];

function findEffect(bm: BuffManager, name: string, buff: string): any {
  const found = bm._effects.find(([e, c]) => c === name && get(e, 'name') === buff);
  if (!found) throw new Error(`StopIteration: ${name} / ${buff}`);
  return found[0];
}

function manager(favorite = 0): BuffManager {
  const bm = new BuffManager(build_squad(SQUAD, { '플로라': { favorite_stage: favorite } }), { enemy: {} });
  bm.battle_start();
  for (const [name, buff] of [['신데렐라', '아름다움'], ['메이든 : 아이스 로즈', '메디테이션 3']] as const) {
    const effect = findEffect(bm, name, buff);
    bm._activate(effect, name, 0);
  }
  return bm;
}

function fire(bm: BuffManager, start = 0, count = 100): void {
  for (let i = start + 1; i < start + count + 1; i++) bm.notify('hit_count', i / 100, '플로라');
}

describe('FloraStacksTest', () => {
  it('test_every_100_attacks_adds_actual_stacks_in_all_favorite_variants', () => {
    for (let favorite = 0; favorite < 4; favorite++) {
      // subTest(favorite=favorite)
      const bm = manager(favorite);
      fire(bm, 0, 99);
      expect(bm.ref_count('신데렐라', '아름다움'), `favorite=${favorite}`).toBe(1);
      expect(bm.ref_count('메이든 : 아이스 로즈', '메디테이션 3'), `favorite=${favorite}`).toBe(1);
      fire(bm, 99, 1);
      expect(bm.ref_count('신데렐라', '아름다움'), `favorite=${favorite}`).toBe(2);
      expect(bm.ref_count('메이든 : 아이스 로즈', '메디테이션 3'), `favorite=${favorite}`).toBe(2);
      fire(bm, 100);
      expect(bm.ref_count('신데렐라', '아름다움'), `favorite=${favorite}`).toBe(3);
      for (const [n, buff, cap] of [['신데렐라', '아름다움', 12], ['메이든 : 아이스 로즈', '메디테이션 3', 10]] as const) {
        const e = findEffect(bm, n, buff);
        expect(bm._effective_stack_cap(e, n, 2), `favorite=${favorite} ${n}`).toBe(cap);
      }
    }
  });

  it('test_partial_electric_targets_do_not_boost_other_recipients', () => {
    const bm = manager();
    const ab = bm._active.find((a) => a.caster === '플로라' && get(a.effect, 'name') === '피튜니아 2');
    if (!ab) throw new Error('StopIteration');
    const before: Record<string, number> = {};
    for (const n of SQUAD.slice(0, 3)) before[n] = bm._get_value(ab.effect, ab, n)!;
    fire(bm);
    const after: Record<string, number> = {};
    for (const n of SQUAD.slice(0, 3)) after[n] = bm._get_value(ab.effect, ab, n)!;
    expect(after['리타']).toBe(before['리타']);
    for (const n of ['플로라', '신데렐라']) expect(after[n]! - before[n]!).toBeCloseTo(4, 7);
    const e = findEffect(bm, '플로라', '피튜니아 2');
    bm._activate(e, '플로라', 2);
    expect(bm._get_value(ab.effect, ab, '리타')! - before['리타']!).toBeCloseTo(4, 7);
    expect(bm._get_value(ab.effect, ab, '신데렐라')! - before['신데렐라']!).toBeCloseTo(8, 7);
  });

  it('test_real_battle_reaches_stacks_faster_and_changes_damage', () => {
    // 파이썬은 `patch.dict(module._PARSED_SKILLS, {'플로라': chosen})`로 플로라 효과 목록을 잠시 바꾼다.
    // 여기서는 같은 데이터 사전(data().parsed_skills)의 항목을 try/finally로 바꿨다가 되돌린다.
    function simulate_case(enabled: boolean): SimResult {
      const chars = build_squad(SQUAD);
      const skills = data().parsed_skills;
      const effects: any[] = skills['플로라'];
      const chosen = enabled ? effects : effects.filter((e) => get(e, 'stat') !== 'buff_stack_add');
      skills['플로라'] = chosen;
      try {
        return simulate(chars, build_config(chars, { duration: 60, rng_mode: 'expected' }),
          { def: 31784, code: '', core_px: 0 }, true);
      } finally {
        skills['플로라'] = effects;
      }
    }
    const enabled = simulate_case(true);
    const disabled = simulate_case(false);
    for (const name of ['신데렐라', '메이든 : 아이스 로즈']) {
      expect(enabled.char_total[name]!).toBeGreaterThan(disabled.char_total[name]!);
    }
    for (const [name, buff] of [['신데렐라', '아름다움'], ['메이든 : 아이스 로즈', '메디테이션 3']] as const) {
      const first_two = (result: SimResult): number =>
        minBy(result.log!.buff_events
          .filter((e) => e.target === name && e.name === buff && e.kind === 'activate' && e.stack! >= 2)
          .map((e) => e.t));
      expect(first_two(enabled)).toBeLessThan(first_two(disabled));
    }
  });

  it('test_caps_and_missing_or_expired_stacks', () => {
    const bm = manager(); fire(bm, 0, 2000);
    expect(bm.ref_count('신데렐라', '아름다움')).toBe(12);
    // Timed buff expired at t=15; the instant must not revive it without its own trigger.
    expect(bm.ref_count('메이든 : 아이스 로즈', '메디테이션 3')!).toBeLessThanOrEqual(10);
    bm.tick(21);
    fire(bm, 2100);
    expect(bm.ref_count('메이든 : 아이스 로즈', '메디테이션 3')).toBeNull();
    const clean = new BuffManager(build_squad(SQUAD), { enemy: {} }); clean.battle_start(); fire(clean);
    expect(clean.ref_count('신데렐라', '아름다움')).toBeNull();
  });
});
