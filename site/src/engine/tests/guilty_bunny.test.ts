// py: calculator/test_guilty_bunny.py
// Published Lv10 bunny modes and SR-to-SR one-shot contracts.
import { beforeAll, describe, expect, it } from 'vitest';
import { BuffManager } from '../buff_manager';
import { CharState, simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { has } from '../py';
import type { SimResult } from '../sim_result';
import { loadEngineData, withinDelta } from './helpers';

beforeAll(loadEngineData);

const NAME = '길티 : 마이티 바니';
const SQUAD = ['리틀 머메이드', '크라운', NAME, 'test_B3'];

function run(mode = 'engage', defense = 31784, duration = 12, squad: string[] | null = null,
  extra: Record<string, any> | null = null): SimResult {
  const override = { control: { bunny_mode: mode }, ...(extra ?? {}) };
  const chars = build_squad(squad ?? [NAME], { [NAME]: override });
  return simulate(chars, build_config(chars, { duration, rng_mode: 'expected' }),
    { def: defense, code: '', core_px: 0 }, true);
}

describe('GuiltyBunnyTest', () => {
  it('test_initial_stance_then_one_delayed_engage_transition', () => {
    const stance = run('stance');
    const engage = run();
    const shots = (r: SimResult) => r.hits.filter((h) => h.caster === NAME && h.skill_name === '기본 공격');
    expect(withinDelta(shots(engage)[0]!.t - shots(stance)[0]!.t, 1, 1 / 30)).toBe(true);
    const transitions = engage.log!.buff_events.filter((e) => e.name === '바니 모드 : 인게이지' && e.kind === 'activate');
    expect(transitions.length).toBe(1);
    expect(engage.hits.some((h) => h.skill_name === '체인 인헨스 3')).toBe(false);
    expect(stance.hits.some((h) => h.skill_name === '체인 릴리즈 2')).toBe(false);
  });

  it('test_engage_ignores_defense_but_stance_does_not', () => {
    expect(run('engage', 0).char_total[NAME]).toBe(run('engage', 100000).char_total[NAME]);
    expect(run('stance', 0).char_total[NAME]!).toBeGreaterThan(run('stance', 100000).char_total[NAME]!);
  });

  it('test_mode_effects_exclusive_and_only_mode_holders_propagate', () => {
    const bm = new BuffManager(build_squad(SQUAD), { enemy: {} }); bm.battle_start();
    const before = bm.get_buffs(NAME, '', 0);
    bm.state['bunny_modes']['크라운'] = 'stance';
    bm.notify('charge_hold:1', 2, NAME);
    const after = bm.get_buffs(NAME, '', 2);
    expect(after['armor_break_enabled']).toBeTruthy(); expect(before['armor_break_enabled']).toBeFalsy();
    expect(before['atk_dmg_pct'] - after['atk_dmg_pct']).toBeCloseTo(20.45, 7);
    expect(before['charge_dmg_pct'] - after['charge_dmg_pct']).toBeCloseTo(40, 7);
    expect(bm.state['bunny_modes']['크라운']).toBe('engage');
    expect(has(bm.state['bunny_modes'], '리틀 머메이드')).toBe(false);
    bm.notify('burst_cast', 3, NAME);
    bm.notify('charge_hold:1', 5, NAME);
    expect(bm.state['bunny_modes'][NAME]).toBe('engage');
    bm.end_weapon_change(NAME, 6);
    bm.notify('charge_hold:1', 7, NAME);
    expect(bm.state['bunny_modes'][NAME]).toBe('stance');
    expect(bm.state['bunny_modes']['크라운']).toBe('stance');
  });

  it('test_burst_is_fixed_charge_one_sr_shot_even_with_ammo_and_speed', () => {
    // 파이썬 `patch.object(CharState, '_tick_weapon_change', spy)` → 같은 자리(클래스 프로토타입)를 잠시 바꾼다.
    // 메서드는 인스턴스로 불리므로(`this._tick_weapon_change(...)`) ESM에서도 그대로 가로채진다.
    const observed: Array<[number, any, any]> = [];
    const original = CharState.prototype._tick_weapon_change;
    function spy(this: CharState, t: number, bm: any, enemy: any, cfg: any, effect: any) {
      const events = original.call(this, t, bm, enemy, cfg, effect);
      if (this.name === NAME && events.length > 0) {
        observed.push([t, effect['weapon_type'], bm.get_weapon_change(NAME)]);
      }
      return events;
    }
    let result: SimResult;
    CharState.prototype._tick_weapon_change = spy;
    try {
      result = run('engage', 31784, 60, SQUAD, { equip_skills: { charge_speed_pct: 90, max_ammo_pct: 500 } });
    } finally {
      CharState.prototype._tick_weapon_change = original;
    }
    const bursts = result.log!.burst_log.filter((e) => e.caster === NAME && e.event === 'stage:3 사용');
    expect(bursts.length).toBeGreaterThanOrEqual(2);
    expect(observed.length).toBe(bursts.length);
    for (let i = 0; i < Math.min(observed.length, bursts.length); i++) {
      const [time, weapon, active] = observed[i]!;
      const burst = bursts[i]!;
      expect(weapon).toBe('SR'); expect(active).toBeNull();
      expect(withinDelta(time - burst.t, 1.5, 1 / 30), `${time - burst.t}`).toBe(true);
      const same = result.hits.filter((h) => h.caster === NAME && Math.abs(h.t - time) < 1e-8);
      expect(same.length).toBe(2); // one normal shot + one mode-specific full-charge proc
    }
    const first = bursts[0]!.t;
    const expirations = result.log!.buff_events.filter((e) => e.name === '드디어 풀려났어…!' && e.kind === 'expire');
    expect(withinDelta(expirations[0]!.t, observed[0]![0], 1 / 30)).toBe(true);
    const timed = result.log!.buff_events.filter((e) => e.name === '드디어 풀려났어…! 2' && e.kind === 'activate');
    expect(timed[0]!.expires_at - first).toBeCloseTo(10, 7);
  });

  it('test_tap_fire_still_performs_initial_mode_hold', () => {
    const result = run('engage', 31784, 12, null, { control: { bunny_mode: 'engage', tap_fire: { rate: 3.6 } } });
    const transition = result.log!.buff_events.filter((e) => e.name === '바니 모드 : 인게이지' && e.kind === 'activate');
    expect(transition.length).toBe(1);
    expect(transition[0]!.t).toBeGreaterThanOrEqual(2);
  });
});
