// py: calculator/test_maiden_ice_rose.py
// Feedback regression: MP hit count and max-HP stacks both affect Maiden's burst.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BuffManager } from '../buff_manager';
import { simulate } from '../timeline';
import { build_squad } from '../spec';
import { get } from '../py';
import { loadEngineData } from './helpers';

// 파이썬 `patch('calculator.timeline.calc_damage', damage)` — timeline이 `./damage`에서 가져다 쓰는
// calc_damage를 바꿔 끼운다. ESM에서는 모듈 경계 호출이라 vi.mock으로 같은 자리를 가로챌 수 있다.
// 평소(damageHook == null)에는 원래 함수를 그대로 부른다.
const hooks = vi.hoisted(() => ({ damageHook: null as null | ((...args: any[]) => any) }));
vi.mock('../damage', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../damage')>();
  return {
    ...mod,
    calc_damage: (...args: Parameters<typeof mod.calc_damage>) =>
      hooks.damageHook ? hooks.damageHook(mod.calc_damage, ...args) : mod.calc_damage(...args),
  };
});

beforeAll(loadEngineData);

const NAME = '메이든 : 아이스 로즈';

describe('MaidenIceRoseTest', () => {
  it('test_mp_charge_buffs_only_other_electric_allies', () => {
    const bm = new BuffManager(build_squad([NAME, '신데렐라', '리타']),
      { enemy: {}, base_stats: { [NAME]: { atk: 100000 } } });
    bm.battle_start();
    const before: Record<string, any> = {};
    for (const n of [NAME, '신데렐라', '리타']) before[n] = bm.get_buffs(n, '__enemy__', 0);
    bm.notify('burst_enter:1', 0, NAME);
    bm.notify('full_burst_start', 1, NAME);
    const after: Record<string, any> = {};
    for (const n of Object.keys(before)) after[n] = bm.get_buffs(n, '__enemy__', 1);
    expect(after['신데렐라']['element_bonus_pct'] - before['신데렐라']['element_bonus_pct']).toBeCloseTo(40.9, 7);
    expect(after['신데렐라']['atk_flat']).toBeGreaterThan(before['신데렐라']['atk_flat']);
    for (const name of [NAME, '리타']) {
      expect(after[name]['element_bonus_pct']).toBe(before[name]['element_bonus_pct']);
      expect(after[name]['atk_flat']).toBe(before[name]['atk_flat']);
    }
  });

  it('test_mp_accumulates_caps_at_twelve_and_is_read_before_consumption', () => {
    const bm = new BuffManager(build_squad([NAME]), { enemy: {} });
    bm.battle_start();
    const counts: Array<number | null> = [];
    bm.register_damage_handler((_eff: any, caster: string, _t: number) => { counts.push(bm.ref_count(caster, 'MP')); });
    bm.notify('burst_enter:1', 0, NAME);
    for (let i = 0; i < 20; i++) {
      bm.notify('full_burst_start', i + 1, NAME);
    }
    expect(bm.ref_count(NAME, 'MP')).toBe(12);
    bm.notify('burst_cast', 22, NAME);
    expect(counts).toEqual([12]);
    expect(bm.ref_count(NAME, 'MP')).toBe(0);
  });

  it('test_burst_adds_ten_percent_of_final_max_hp_without_scaling_it_by_attack_buffs', () => {
    // 파이썬 `patch.object(BuffManager, 'notify', notify)` → 클래스 프로토타입의 notify를 잠시 바꾼다.
    const original_notify = BuffManager.prototype.notify;
    const expected: Array<[number, number | null]> = [];
    const observed: number[] = [];
    let casting = false;

    function notify(this: BuffManager, event: string, t: number, caster: string, ctx?: Record<string, any>): void {
      const previous = casting;
      if (caster === NAME && event === 'burst_cast') {
        casting = true;
        const buffs = this.get_buffs(NAME, '__enemy__', t);
        expected.push([buffs['atk_flat'] + this.effective_max_hp(NAME) * 0.1, this.ref_count(NAME, 'MP')]);
      }
      try {
        return ctx === undefined ? original_notify.call(this, event, t, caster) : original_notify.call(this, event, t, caster, ctx);
      } finally {
        casting = previous;
      }
    }

    // calc_damage(base_atk, buffs, weapon, hit_type, enemy_def, expected) — 파이썬 kwargs['hit_type'] · kwargs['buffs'].
    function damage(orig: (...a: any[]) => any, ...args: any[]): any {
      const buffs = args[1];
      const hit_type = args[3];
      if (casting && get(hit_type, 'is_sequential')) {
        observed.push(buffs['atk_flat']);
      }
      return orig(...args);
    }

    const squad = build_squad(['리타', '크라운', '신데렐라', NAME, '나가']);
    // [{...}] * 2 — 같은 사전 두 번
    const cycle = { '1': ['리타'], '2': ['크라운'], '3': ['신데렐라'] };
    const sequence = [cycle, cycle, { '1': ['리타'], '2': ['크라운'], '3': [NAME] }];
    BuffManager.prototype.notify = notify;
    hooks.damageHook = damage;
    try {
      simulate(squad, { duration: 60, rng_mode: 'expected', burst_sequence: sequence }, null, false, 42);
    } finally {
      BuffManager.prototype.notify = original_notify;
      hooks.damageHook = null;
    }
    expect(expected.length).toBe(1);
    const [flat, mp] = expected[0]!;
    expect(mp).toBe(3);
    expect(observed.length).toBe(mp);
    for (const value of observed) {
      expect(value).toBeCloseTo(flat, 7);
    }
  });
});
