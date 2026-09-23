/**
 * py: calculator/test_upstream_regressions.py
 *
 * Regression cases adapted from Jgaram/nikke-calc engine fixes.
 *
 * Upstream commits: 927a613 (bullet lifetime), 786b2ce (core-hit alias),
 * be5cfb9 (defender ally), ffb1a6e (one reentry per stage/cycle).
 */
import { describe, expect, it } from 'vitest';
import { BuffManager } from '../buff_manager';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { get, sum } from '../py';
import { loadEngineData } from './helpers';

loadEngineData();

describe('UpstreamRegressionTest', () => {
  it('test_missile_guide_lasts_three_shots', () => {
    const name = '베스티 : 택티컬 업';
    const bm = new BuffManager(build_squad([name]));
    bm.battle_start();
    bm.notify('full_charge_hit', 1.0, name);
    for (let shot = 0; shot < 3; shot++) {
      expect(get(bm.get_buffs(name, '__enemy__', 2.0 + shot), 'charge_speed_pct', 0)).toBeGreaterThanOrEqual(100);
      bm.consume_bullet_buffs(name, 2.0 + shot);
    }
    expect(bm._has_self_state(name, '미사일 가이드')).toBe(false);
  });

  it('test_bullet_buff_does_not_log_expiry_when_condition_ends', () => {
    const name = '리타';
    const bm = new BuffManager(build_squad([name]));
    const events: any[][] = [];
    bm.register_buff_event_handler((...args: any[]) => events.push(args));
    const effect = {
      source: '스킬1', type: 'buff', name: 'bullet lifetime regression',
      trigger: { timing: ['on_attack'], condition: ['during_full_burst'] },
      target: 'self', stat: 'atk_pct', fixed_value: 10,
      duration: -1, duration_bullets: 3, max_stack: 1,
    };
    bm.state['full_burst'] = true;
    bm._activate(effect, name, 1);
    bm.tick(1.1);
    bm.state['full_burst'] = false;
    bm.tick(1.2);
    expect(events.filter((e) => e[0] === 'expire')).toEqual([]);
    expect(bm.get_buffs(name, '__enemy__', 1.2)['atk_pct']).toBe(10);
    for (const t of [2, 3, 4]) {
      bm.consume_bullet_buffs(name, t);
    }
    const expired = events.filter((e) => e[0] === 'expire');
    expect(expired.length).toBe(1);
    expect(expired[0]![4]).toBe(4);
  });

  it('test_defender_caster_does_not_count_as_ally', () => {
    const bm = new BuffManager(build_squad(['크라운']));
    expect(bm._condition_ok(['has_defender_ally'], '크라운', 0)).toBe(false);
    expect(bm._condition_ok(['no_defender_ally'], '크라운', 0)).toBe(true);
  });

  it('test_core_hit_count_triggers_at_threshold_and_repeats', () => {
    const name = '길로틴 : 윈터 슬레이어';
    const bm = new BuffManager(build_squad([name]));
    bm.battle_start();
    for (let count = 1; count < 7; count++) {
      bm.notify('core_hit', count, name);
      const stacks = sum(bm._active.filter((ab) => get(ab.effect, 'name') === '경험치').map((ab) => ab.stack));
      expect(stacks).toBe(Math.floor(count / 3));
    }
  });

  it('test_defender_ally_selects_exclusive_delta_passive', () => {
    const name = '델타 : 닌자 시프';
    for (const [ally, defender] of [['리타', false], ['크라운', true]] as Array<[string, boolean]>) {
      // subTest(ally=ally)
      const bm = new BuffManager(build_squad([name, ally]));
      bm.battle_start();
      expect(bm._has_self_state(name, '주목'), `ally=${ally}`).toBe(!defender);
      expect(bm._has_self_state(name, '인법 인젝션'), `ally=${ally}`).toBe(defender);
    }
  });

  it('test_second_reentry_character_advances_to_full_burst', () => {
    const pair = ['아니스 : 스타', '티아'];
    for (const first of [pair, [...pair].reverse()]) {
      // subTest(first=first[0])
      const squad = build_squad([...first, '크라운', 'test_B3']);
      const result = simulate(squad, build_config(squad, { first_burst_time: 1, duration: 8 }), null, true, 1);
      const full = result.log!.burst_log.filter((e) => e.event === 'full_burst 시작');
      expect(full.length, `first=${first[0]}`).toBe(1);
      expect(full[0]!.t, `first=${first[0]}`).toBeLessThan(3);
    }
  }, 60_000);
});
