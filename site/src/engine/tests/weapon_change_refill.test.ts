/**
 * py: calculator/test_weapon_change_refill.py
 *
 * User-confirmed temporary SR magazine restoration contracts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharState, simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { loadEngineData, withinDelta } from './helpers';

loadEngineData();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WeaponChangeRefillTest', () => {
  it('test_full_magazine_without_reload_after_special_shots', () => {
    for (const name of ['길티 : 마이티 바니', '신 : 스위프트 바니', '맥스웰']) {
      for (const ammo_bonus of [0, 200]) {
        // subTest(name=name, ammo_bonus=ammo_bonus)
        const sub = `name=${name}, ammo_bonus=${ammo_bonus}`;
        const exits: Array<[number, number, number, boolean]> = [];
        const shots: number[] = [];
        const original = CharState.prototype._tick_weapon_change;
        // patch.object(CharState, '_tick_weapon_change', observe)
        const spy = vi.spyOn(CharState.prototype, '_tick_weapon_change').mockImplementation(
          function (this: CharState, t: number, bm: any, enemy: any, cfg: any, effect: any) {
            const cs = this;
            const events = original.call(cs, t, bm, enemy, cfg, effect);
            if (cs.name === name) {
              if (events.length > 0) shots.push(t);
              if (bm.get_weapon_change(name) == null) {
                exits.push([cs.ammo, cs._full_ammo(bm, t), cs.reloading_until, cs._pending_auto_reload]);
              }
            }
            return events;
          },
        );
        const chars = build_squad(['리틀 머메이드', '크라운', name, 'test_B3'],
          { [name]: { equip_skills: { max_ammo_pct: ammo_bonus } } });
        let result;
        try {
          result = simulate(chars, build_config(chars, { duration: 60, rng_mode: 'expected' }),
            { def: 31784, code: '', core_px: 0 }, true);
        } finally {
          spy.mockRestore();
        }
        const bursts = result.log!.burst_log
          .filter((e) => e.caster === name && e.event === 'stage:3 사용')
          .map((e) => e.t);
        expect(bursts.length, sub).toBeGreaterThanOrEqual(2);
        expect(exits.length, sub).toBe(bursts.length);
        for (const [ammo, capacity, reloading, pending] of exits) {
          expect(ammo, sub).toBe(capacity);
          expect(reloading, sub).toBeLessThanOrEqual(0);
          expect(pending, sub).toBe(false);
        }
        if (name === '신 : 스위프트 바니') {
          for (const start of bursts) {
            const window = shots.filter((t) => start <= t && t <= start + 5.02);
            expect(window.length, sub).toBe(10);
            expect(withinDelta(window[window.length - 1]! - start, 5, 1 / 60 + 1e-8), sub).toBe(true);
          }
        }
      }
    }
  }, 300_000);
});
