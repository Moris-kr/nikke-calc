// py: calculator/test_guillotine_winter_exp.py
// Winter Slayer experience belongs to her and shares one stack pool.
import { beforeAll, describe, expect, it } from 'vitest';
import { BuffManager } from '../buff_manager';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { floordiv, get, maxBy } from '../py';
import { loadEngineData } from './helpers';

beforeAll(loadEngineData);

const NAME = '길로틴 : 윈터 슬레이어';

function manager(): BuffManager {
  const bm = new BuffManager(build_squad([NAME, '팬텀']), { enemy: {} });
  bm.battle_start();
  return bm;
}

describe('WinterExperienceTest', () => {
  it('test_other_shooters_never_receive_or_supply_experience', () => {
    const bm = manager();
    for (let i = 0; i < 60; i++) {
      bm.notify_team_hit('squad_body_hit', i / 12, '팬텀');
      bm.notify('hit_count', i / 12, '팬텀', { core_frac: 0.0 });
    }
    expect(bm.ref_count('팬텀', '경험치')).toBeNull();
    expect(bm.ref_count(NAME, '경험치')).toBeNull();
  });

  it('test_core_and_non_core_share_one_pool_and_one_cap', () => {
    const bm = manager();
    for (let i = 0; i < 30; i++) {
      bm.notify('hit_count', i / 12, NAME, { core_frac: 0.0 });
    }
    for (let i = 0; i < 15; i++) {
      bm.notify('core_hit', 3 + i / 12, NAME);
    }
    expect(bm.ref_count(NAME, '경험치')).toBe(10);
    expect(bm.ref_count(NAME, '용사 레벨')).toBe(2);
    for (let i = 0; i < 600; i++) {
      bm.notify('hit_count', 5 + i / 12, NAME, { core_frac: 0.0 });
      bm.notify('core_hit', 5 + i / 12, NAME);
    }
    const buffs = bm._active.filter((a) => get(a.effect, 'name') === '경험치');
    expect(buffs.length).toBe(1);
    expect(buffs[0]!.stack).toBe(100);
    expect(bm.ref_count(NAME, '용사 레벨')).toBe(11);
  });

  it('test_sixth_hit_checks_core_without_pausing_normal_hit_count', () => {
    const bm = manager();
    for (let i = 0; i < 5; i++) {
      bm.notify('hit_count', i / 12, NAME, { core_frac: 1.0 });
    }
    bm.notify('hit_count', 5 / 12, NAME, { core_frac: 0.0 });
    expect(bm.ref_count(NAME, '경험치')).toBe(1);
    for (let i = 0; i < 5; i++) {
      bm.notify('hit_count', 1 + i / 12, NAME, { core_frac: 0.0 });
    }
    bm.notify('hit_count', 1.5, NAME, { core_frac: 1.0 });
    expect(bm.ref_count(NAME, '경험치')).toBe(1);
  });

  it('test_expected_core_fraction_is_sampled_only_on_sixth_hits', () => {
    const bm = manager();
    for (let i = 0; i < 24; i++) {
      bm.notify('hit_count', i / 12, NAME, { core_frac: 0.5 });
    }
    expect(bm.ref_count(NAME, '경험치')).toBe(2);
  });

  it('test_real_non_core_shots_award_experience_only_to_owner', () => {
    const squad = build_squad([NAME, '팬텀']);
    const result = simulate(squad, build_config(squad, { duration: 10, rng_mode: 'expected' }),
      { core_px: 0 }, true);
    const exp = result.log!.buff_events.filter((e) => e.name === '경험치' && e.kind === 'activate');
    expect(exp.length > 0).toBe(true);
    expect(new Set(exp.map((e) => e.target))).toEqual(new Set([NAME]));
    expect(maxBy(exp.map((e) => e.stack!))).toBe(
      floordiv(result.hits.filter((h) => h.caster === NAME).length, 6));
  });

  it('test_parts_do_not_disable_owner_non_core_experience', () => {
    const squad = build_squad([NAME]);
    const result = simulate(squad, { duration: 10, rng_mode: 'expected' },
      { core_px: 0, has_parts: true }, true);
    const exp = result.log!.buff_events.filter((e) => e.name === '경험치' && e.kind === 'activate');
    expect(exp.length > 0).toBe(true);
    expect(maxBy(exp.map((e) => e.stack!))).toBe(floordiv(result.hits.length, 6));
  });
});
