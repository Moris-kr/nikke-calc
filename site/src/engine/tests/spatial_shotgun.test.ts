// py: calculator/test_spatial_shotgun.py
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { probabilities, scene_at } from '../pellet_accuracy';
import { CharState, simulate } from '../timeline';
import { BuffManager } from '../buff_manager';
import { build_config, build_squad } from '../spec';
import { almostEqual, loadEngineData, readJson, withinDelta } from './helpers';

beforeAll(loadEngineData);
afterEach(() => { vi.restoreAllMocks(); });

describe('SpatialShotgunTest', () => {
  it('test_target_size_responds_to_spread_and_core_is_joint', () => {
    const enemy = { shotgun_model: 'spatial-v1', shotgun_target_diameter: 120, core_px: 52 };
    const broad = probabilities(enemy, 'test', 0, true, 120, .99);
    const narrow = probabilities(enemy, 'test', 0, true, 60, .99);
    expect(withinDelta(broad[0], .5 ** 2.55, .002)).toBe(true);
    expect(narrow[0]).toBeGreaterThan(broad[0]);
    expect(withinDelta(broad[0] * broad[1], (26 / 120) ** 2.55, .002)).toBe(true);
  });

  it('test_legacy_rollback_ignores_target_size', () => {
    expect(probabilities({ shotgun_hit_rate: .9, shotgun_target_diameter: 50 }, 'x', 0, true, 120, .2)).toEqual([.9, .2]);
  });

  it('test_weapon_convergence_is_opt_in_and_firing_changes_radius', () => {
    const state = new CharState(build_squad(['프리바티 : 언카인드 메이드'])[0]!, 10000, '');
    const bm: any = { state: {} }; // SimpleNamespace(state={})
    const enemy: Record<string, any> = { shotgun_model: 'spatial-v1', shotgun_target_diameter: 120, core_px: 0 };
    const fixed = state._pellet_probabilities(0, bm, enemy, {}, 0)[0];
    for (let t = 1; t < 14; t++) {
      expect(state._pellet_probabilities(t, bm, enemy, {}, 0)[0]).toBe(fixed);
    }
    enemy['shotgun_model'] = 'spatial-convergence-v1';
    const first = state._pellet_probabilities(20, bm, enemy, {}, 0)[0];
    let last = NaN;
    for (let t = 21; t < 34; t++) {
      last = state._pellet_probabilities(t, bm, enemy, {}, 0)[0];
    }
    expect(last).toBeGreaterThan(first);
  });

  it('test_raw_spread_is_preserved', () => {
    // 파이썬은 스크래퍼 함수 `scraper.parse_nikke.parse_fire_mechanics`를 직접 부른다 — 스크래퍼는 파이썬 전용이라
    // TS 이식이 없다. 대신 그 함수가 만든 결과(데이터 파일)로 같은 계약을 본다: 원문 `탄착군`이 그대로
    // (`dict(weapon["탄착군"])`) parsed_nikke.json의 `spread`에 남아 있어야 한다. 원문 end 75인 니케가 end 75로 남는다.
    const raw = readJson<Record<string, any>>('scraper/nikke_scraped.json');
    const parsed = readJson<Record<string, any>>('data/parsed_nikke.json');
    let checked = 0;
    for (const [name, char] of Object.entries(raw)) {
      const spread = (char['무기상세'] ?? {})['탄착군'];
      if (!spread) continue;
      checked++;
      expect(parsed[name]?.['spread'], name).toEqual(spread);
    }
    expect(checked).toBeGreaterThan(0);
    const pri = raw['프리바티 : 언카인드 메이드']['무기상세']['탄착군'];
    expect(pri).toEqual({ start: 250, end: 75, per_shot: 18, recovery: 105 });
    expect(parsed['프리바티 : 언카인드 메이드']['spread']['end']).toBe(75);
  });

  it('test_simulation_reports_fired_and_joint_expected_pellets', () => {
    const squad = build_squad(['드레이크']);
    const result = simulate(squad, build_config(squad, { duration: 5, first_burst_time: 100, rng_mode: 'expected' }),
      { shotgun_model: 'spatial-v1', shotgun_target_diameter: 120, core_px: 52 });
    const stats: any = result.shotgun_stats['드레이크'];
    expect(stats['fired']).toBeGreaterThan(stats['hit']);
    expect(stats['hit']).toBeGreaterThan(stats['core']);
    expect(stats['minDiameter']).toBeGreaterThan(0);
    expect(almostEqual(stats['hit'] + stats['miss'], stats['fired'])).toBe(true);
  });

  it('test_expected_damage_matches_repeated_random_trials_without_feedback', () => {
    const squad = build_squad(['드레이크']);
    const enemy = { shotgun_model: 'spatial-v1', shotgun_target_diameter: 120, core_px: 52 };
    const config = build_config(squad, { duration: 12, first_burst_time: 100, rng_mode: 'expected' });
    // patch('calculator.buff_manager.char_effects', return_value=[]) — 파이썬에서 그 모듈 함수를 부르는 곳은
    // BuffManager.char_effects 메서드뿐이다(timeline도 bm.char_effects로 부른다). 그 메서드를 같은 값으로 바꾼다.
    const empty: any[] = [];
    vi.spyOn(BuffManager.prototype, 'char_effects').mockReturnValue(empty);
    const expected = simulate(squad, config, enemy).squad_total;
    config['rng_mode'] = 'random';
    let total = 0;
    for (let i = 0; i < 120; i++) total += simulate(squad, config, enemy, false, i).squad_total;
    const sampled = total / 120;
    vi.restoreAllMocks();
    expect(withinDelta(sampled / expected, 1, .05)).toBe(true);
  }, 600_000);

  it('test_experimental_recovery_freezes_at_reload_end', () => {
    const state = new CharState(build_squad(['프리바티 : 언카인드 메이드'])[0]!, 10000, '');
    state._spread_scale = 75;
    state._spread_reload_at = 10;
    state._recover_spread(11);
    expect(state._spread_scale).toBe(180);
    state._recover_spread(12);
    expect(state._spread_scale).toBe(180);
  });

  it('test_weapon_change_does_not_inherit_base_weapon_convergence', () => {
    const state = new CharState(build_squad(['프리바티 : 언카인드 메이드'])[0]!, 10000, '');
    state._spread_scale = 75;
    state._in_weapon_change = true;
    const enemy = { shotgun_model: 'spatial-convergence-v1', shotgun_target_diameter: 120, core_px: 0 };
    const [ph] = state._pellet_probabilities(0, { state: {} } as any, enemy, {}, 0);
    expect(withinDelta(ph, .5 ** 2.55, .002)).toBe(true);
    expect(state._spread_scale).toBe(75);
  });
});

describe('SizeWindowTests', () => {
  it('test_boundaries_and_fallback', () => {
    const enemy = {
      shotgun_model: 'spatial-v1', shotgun_target_diameter: 360,
      shotgun_size_windows: [{ from: 3, to: 6, diameter: 80 }],
    };
    const hit = (t: number) => probabilities(enemy, 'x', t, true, 120, 0)[0];
    expect(hit(2.999)).toBe(1);
    expect(hit(3)).toBeLessThan(.2);
    expect(hit(6)).toBe(1);
  });

  it('test_drawn_geometry_scales_only_in_window', () => {
    const enemy = {
      shotgun_target_diameter: 360, core_px: 20,
      shotgun_geometry: {
        center: { x: 100, y: 100 }, core: { x: 110, y: 100, d: 20 },
        shapes: [{ kind: 'rect', x: 100, y: 100, w: 100, h: 80 }],
      },
      shotgun_size_windows: [{ from: 3, to: 6, diameter: 180 }],
    };
    const before = scene_at(enemy, 'x', 0, true, 120)!;
    const during = scene_at(enemy, 'x', 3, true, 120)!;
    expect(during[0][0]!.slice(3, 5)).toEqual([50, 40]);
    expect(during[1]).toEqual([105, 100]);
    expect(during[2]).toEqual(before[2]);
    expect(during[3]).toEqual([105, 100, 5]);
    expect(scene_at(enemy, 'x', 6, true, 120)).toEqual(before);
  });
});
