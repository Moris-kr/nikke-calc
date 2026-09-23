/**
 * Cross-cutting regression probes: shot lifecycle, cover healing and gauge model.
 * 파이썬: calculator/test_mechanics_audit.py
 *
 * 파이썬의 `patch.object(CharState, '<메서드>', trace)`는 `CharState.prototype`의 메서드를
 * 잠시 바꿔 끼우는 것으로 옮겼다(호출이 `this.<메서드>(…)`로 가므로 그대로 가로챈다).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineData } from './helpers';
import { CharState, simulate } from '../timeline';
import { BuffManager } from '../buff_manager';
import { build_config, build_squad } from '../spec';
import type { SimResult } from '../sim_result';

beforeAll(loadEngineData);

function run(names: string[], duration = 60, config: Record<string, any> | null = null): SimResult {
  const squad = build_squad(names);
  const cfg = build_config(squad, { duration, rng_mode: 'expected', ...(config ?? {}) });
  return simulate(squad, cfg, { def: 31784, code: '', core_px: 0 }, true);
}

/** `patch.object(CharState, key, replacement)` — fn 동안만 바꿔 끼운다. */
function patchCharState<K extends keyof CharState>(key: K, make: (original: CharState[K]) => CharState[K], fn: () => void): void {
  const proto = CharState.prototype as any;
  const original = proto[key];
  proto[key] = make(original);
  try {
    fn();
  } finally {
    proto[key] = original;
  }
}

describe('MechanicsAuditTest', () => {
  it('test_special_exit_preserves_scheduled_post_shot_delay', () => {
    for (const name of ['길티 : 마이티 바니', '맥스웰']) {
      const observed: Array<[string, number]> = [];
      patchCharState('_tick_weapon_change', (original) => function (this: CharState, t, bm, enemy, cfg, effect) {
        const events = original.call(this, t, bm, enemy, cfg, effect);
        if (this.name === name && events.length > 0 && bm.get_weapon_change(name) == null) {
          observed.push([this._charge_phase, this._post_delay_end_t - t]);
        }
        return events;
      }, () => {
        run(['리틀 머메이드', '크라운', name, 'test_B3']);
      });
      expect(observed.length > 0).toBe(true);
      for (const [phase, delay] of observed) {
        expect(delay).toBeGreaterThan(0);
        expect(phase, name).toBe('post_delay');
      }
    }
  });

  it('test_one_bullet_buffs_end_on_first_special_shot', () => {
    for (const name of ['길티 : 마이티 바니', '신 : 스위프트 바니']) {
      const observed: Array<[Record<string, any>, Record<string, any>]> = [];
      patchCharState('_charge_fire', (original) => function (this: CharState, t, bm, enemy, cfg, is_full) {
        const before = { ...bm.get_buffs(this.name, '__enemy__', t) };
        const special = this._in_weapon_change;
        const events = original.call(this, t, bm, enemy, cfg, is_full);
        const after = { ...bm.get_buffs(this.name, '__enemy__', t) };
        if (this.name === name && special && events.length > 0) {
          observed.push([before, after]);
        }
        return events;
      }, () => {
        run(['미란다', '크라운', name, 'test_B3'], 15);
      });
      expect(observed.length > 0).toBe(true);
      const [before, after] = observed[0]!;
      expect(before['crit_rate']).toBeGreaterThan(after['crit_rate']);
      if (name === '길티 : 마이티 바니') {
        expect(before['charge_dmg_pct'] - after['charge_dmg_pct']).toBeCloseTo(1400, 7);
      } else {
        expect(observed.length).toBe(10);
        for (const [b] of observed.slice(1)) {
          expect(b['crit_rate']).toBeLessThan(observed[0]![0]['crit_rate']);
        }
      }
    }
  });

  it('test_cover_heal_sources_activate_tia', () => {
    for (const healer of ['나가', '츠바이']) {
      const result = run(['티아', healer, '크라운', 'test_B3'], 35, { no_burst_chars: ['티아'] });
      const buffs = result.log!.buff_events.filter((e) => e.caster === '티아' && e.kind === 'activate');
      expect(buffs.some((e) => e.name === '파충류 애호가 2'), healer).toBe(true);
    }
    const squad = build_squad(['티아', 'test_B3']);
    const bm = new BuffManager(squad);
    bm.notify('event:cover_healed', 1, '티아');
    expect(bm.get_buffs('test_B3', '__enemy__', 1)['atk_dmg_pct']).toBeCloseTo(32.11, 7);
    bm.notify('event:cover_healed', 2, '티아');
    expect(bm.get_buffs('티아', '__enemy__', 2)['burst_cooldown']).toBeCloseTo(26, 7);
    expect(bm.get_buffs('test_B3', '__enemy__', 13)['atk_dmg_pct']).toBe(0);
  });

  it('test_mg_warmup_and_reload_preservation', () => {
    const squad = build_squad(['크라운']);
    const cs = new CharState(squad[0]!, 100000, '');
    const bm = new BuffManager(squad);
    bm.state['rng_acc'] = {};
    const rates: number[] = [];
    for (let i = 0; i < 43; i += 1) {
      rates.push(cs._current_fire_rate(bm, i / 60));
      cs._fire(i / 60, bm, { core_px: 0 }, { rng_mode: 'expected' });
    }
    expect(rates[0]).toBeCloseTo(1, 7);
    expect(rates[1]).toBeCloseTo(1 + 100 / 60, 4);
    expect(rates[rates.length - 1]).toBeCloseTo(70, 7);
    cs.last_fire_t = 0;
    cs._last_inter = 1 / 60;
    cs._cool_warmup(0.5, bm);
    expect(cs.warmup_shots).toBeCloseTo(cs.warmup_bullets / 2, 7);
    cs._cool_warmup(2, bm);
    expect(cs.warmup_shots).toBe(0);
  });

  it('test_shotgun_coefficient_does_not_change_fixed_gauge_schedule', () => {
    const results = [1, 0.5].map((c) => run(['리타', '크라운', '슈가', 'test_B3'], 60, { normal_hit_coeff: { SG: c } }));
    const starts = results.map((r) => r.log!.burst_log.filter((e) => e.event === 'full_burst 시작').map((e) => e.t));
    expect(starts[0]).toEqual(starts[1]);
    expect(results[1]!.char_total['슈가']).toBeLessThan(results[0]!.char_total['슈가']!);
  });
});
