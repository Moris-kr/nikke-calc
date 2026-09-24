// py: calculator/test_sin_bunny.py
// Released Sin Lv10 contracts; not an in-game performance verification.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BuffManager } from '../buff_manager';
import { CharState, simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { almostEqual, loadEngineData, withinDelta } from './helpers';
import { truthy } from '../py';

const NAME = '신 : 스위프트 바니';
const GUILTY = '길티 : 마이티 바니';
const SQUAD = ['리틀 머메이드', '크라운', NAME, 'test_B3'];
const PAIR = ['리틀 머메이드', '크라운', NAME, GUILTY];

function run(mode = 'engage', duration = 60, extra: Record<string, any> | null = null): any {
  const chars = build_squad(SQUAD, { [NAME]: { control: { bunny_mode: mode }, ...(extra ?? {}) } });
  return simulate(chars, build_config(chars, { duration, rng_mode: 'expected' }),
    { def: 31784, code: '', core_px: 0 }, true);
}

beforeAll(loadEngineData);
afterEach(() => { vi.restoreAllMocks(); });

describe('SinBunnyTest', () => {
  it('test_full_charge_buff_applies_one_shot_and_excludes_carrot', () => {
    let bm: any = new BuffManager(build_squad([NAME]), { enemy: {} }); bm.battle_start();
    const before = bm.get_buffs(NAME, '', 0);
    bm.notify('full_charge', 1, NAME);
    const charged = bm.get_buffs(NAME, '', 1);
    expect(almostEqual(charged['normal_atk_dmg_pct'] - before['normal_atk_dmg_pct'], 100)).toBe(true);
    expect(almostEqual(charged['charge_dmg_pct'] - before['charge_dmg_pct'], 52.12)).toBe(true);
    bm.notify('burst_cast', 2, NAME);
    // Fresh manager avoids pretending a charged normal shot was never consumed.
    bm = new BuffManager(build_squad([NAME]), { enemy: {} }); bm.battle_start();
    bm.notify('burst_cast', 2, NAME); const baseline = bm.get_buffs(NAME, '', 2);
    bm.notify('full_charge', 2.5, NAME);
    expect(bm.get_buffs(NAME, '', 2.5)['normal_atk_dmg_pct']).toBe(baseline['normal_atk_dmg_pct']);
    const result = run('engage', 5);
    const buffs = result.log.buff_events.filter((e: any) => e.name === '바니 시프트 2');
    expect(buffs.filter((e: any) => e.kind === 'activate').length)
      .toBe(buffs.filter((e: any) => e.kind === 'expire').length);
  });

  it('test_modes_and_paired_propagation', () => {
    const bm: any = new BuffManager(build_squad(PAIR), { enemy: {} }); bm.battle_start();
    const before = bm.get_buffs(NAME, '', 0);
    bm.notify('charge_hold:1', 2, NAME);
    const after = bm.get_buffs(NAME, '', 2);
    expect(truthy(after['armor_break_enabled'])).toBe(true); expect(truthy(before['armor_break_enabled'])).toBe(false);
    expect(almostEqual(before['crit_rate'] - after['crit_rate'], 0.3514)).toBe(true);
    expect(almostEqual(before['crit_dmg'] - after['crit_dmg'], 75.12)).toBe(true);
    expect(bm.state['bunny_modes'][GUILTY]).toBe('engage');
    bm.notify('burst_cast', 3, NAME); bm.notify('charge_hold:1', 4.5, NAME);
    expect(bm.state['bunny_modes'][NAME]).toBe('stance'); // unlike Mighty Stomp, Carrot allows it
    expect(bm.state['bunny_modes'][GUILTY]).toBe('stance');
  });

  it('test_paired_default_controls_do_not_toggle_twice_in_same_frame', () => {
    for (const names of [PAIR, [...PAIR.slice(0, 2), GUILTY, NAME]]) {
      const chars = build_squad(names);
      const result = simulate(chars, build_config(chars, { duration: 60, rng_mode: 'expected' }),
        { def: 31784, code: '', core_px: 0 }, true);
      for (const name of [NAME, GUILTY]) {
        const modes = result.log!.buff_events.filter((e: any) => e.target === name
          && e.kind === 'activate' && e.name.startsWith('바니 모드 :')).map((e: any) => e.name);
        expect(modes).toEqual(['바니 모드 : 스탠스', '바니 모드 : 인게이지']);
      }
    }
  }, 120_000);

  it('test_two_bursts_fixed_charge_duration_and_mode_specific_damage', () => {
    for (const [mode, chosen, excluded] of [['engage', '스위프트 피어싱 5', '스위프트 피어싱 4'],
      ['stance', '스위프트 피어싱 4', '스위프트 피어싱 5']] as const) {
      // subTest(mode=mode)
      const shots: Array<[number, any]> = []; const original = CharState.prototype._tick_weapon_change;
      const spy = vi.spyOn(CharState.prototype, '_tick_weapon_change').mockImplementation(
        function (this: CharState, t: number, bm: any, enemy: any, cfg: any, effect: any) {
          const events = original.call(this, t, bm, enemy, cfg, effect);
          if (this.name === NAME && truthy(events)) shots.push([t, bm.get_buffs(NAME, '', t)]);
          return events;
        });
      let result: any;
      try {
        result = run(mode, 60, { equip_skills: { charge_speed_pct: 90 } });
      } finally {
        spy.mockRestore();
      }
      const bursts = result.log.burst_log.filter((e: any) => e.caster === NAME && e.event === 'stage:3 사용');
      expect(bursts.length, mode).toBeGreaterThanOrEqual(2);
      const hits = result.hits.filter((h: any) => h.caster === NAME);
      expect(hits.filter((h: any) => h.skill_name === chosen).length, mode).toBe(bursts.length);
      expect(hits.some((h: any) => h.skill_name === excluded), mode).toBe(false);
      expect(hits.filter((h: any) => h.skill_name === '스위프트 피어싱 3').length, mode).toBe(bursts.length);
      for (const burst of bursts) {
        const window = shots.filter(([t]) => burst.t <= t && t < burst.t + 5);
        expect(window.length, mode).toBeGreaterThan(1);
        // 첫 발은 전환 0.3초(영상 실측 start_delay) + 고정 차지 0.5초 뒤다.
        expect(withinDelta(window[0]![0] - burst.t, 0.8, 1 / 30), mode).toBe(true);
        for (const [, b] of window) {
          expect(truthy(b['charge_time_fixed']), mode).toBe(true);
          expect(b['charge_speed_pct'] == 0, mode).toBe(true);
        }
        expect(hits.some((h: any) => h.skill_name === '기본 공격' && burst.t + 5 < h.t && h.t < burst.t + 7), mode).toBe(true);
      }
      const timed = result.log.buff_events.filter((e: any) => e.name === '스위프트 피어싱 2' && e.kind === 'activate');
      expect(timed.every((e: any) => Math.abs(e.expires_at - e.t - 5) < 1e-8), mode).toBe(true);
    }
  }, 120_000);
});
