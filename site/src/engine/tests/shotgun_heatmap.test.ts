// py: calculator/test_shotgun_heatmap.py
import { beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { sum, truthy } from '../py';
import { almostEqual, loadEngineData, withinDelta } from './helpers';

beforeAll(loadEngineData);

function run_case(report: boolean, mode = 'spatial-v1', extra: Record<string, any> | null = null) {
  const squad = build_squad(['드레이크']);
  return simulate(squad, build_config(squad, { duration: 4, rng_mode: 'expected' }),
    {
      shotgun_model: mode, shotgun_target_diameter: 120,
      core_px: 52, shotgun_report: report, ...(extra ?? {}),
    }, false, 42);
}

describe('ShotgunHeatmapTest', () => {
  it('test_diagnostics_preserve_damage_and_match_integrated_counts', () => {
    const plain = run_case(false);
    const detailed = run_case(true);
    expect(detailed.squad_total).toBe(plain.squad_total);
    expect(truthy(plain.shotgun_report)).toBe(false);
    const data = detailed.shotgun_report['드레이크'];
    const stats = detailed.shotgun_stats['드레이크']!;
    expect(withinDelta(sum(data.core), stats.core!, 0.01)).toBe(true);
    expect(withinDelta(sum(data.body) + sum(data.core), stats.hit!, 0.01)).toBe(true);
    expect(withinDelta(sum(data.miss), stats.miss!, 0.01)).toBe(true);
    expect(withinDelta(sum(data.density), stats.fired!, 0.01)).toBe(true);
  }, 60_000);

  it('test_legacy_never_invents_a_spatial_hit_mask', () => {
    const data = run_case(true, 'legacy', { shotgun_hit_rate: 0.8 }).shotgun_report['드레이크'];
    expect(truthy(data.spatial)).toBe(false);
    expect(sum(data.body) + sum(data.core) + sum(data.miss)).toBe(0);
    expect(almostEqual(data.hit / data.fired, 0.8)).toBe(true);
  }, 60_000);

  it('test_core_windows_are_captured_at_shot_time', () => {
    const data = run_case(true, 'spatial-v1', { core_windows: [[10, 11]] }).shotgun_report['드레이크'];
    expect(sum(data.core)).toBe(0);
  }, 60_000);

  it('test_drawing_uses_moving_aim_and_actual_shape', () => {
    const geometry = {
      shapes: [{ kind: 'rect', x: 0, y: 0, w: 120, h: 120 }],
      center: { x: 0, y: 0 }, playerName: '드레이크',
      aimKeys: [{ t: 0, x: 0, y: 0 }, { t: 3, x: 300, y: 0 }],
    };
    const result = run_case(true, 'spatial-v1', { shotgun_geometry: geometry });
    const data = result.shotgun_report['드레이크'];
    expect(data.sceneCount).toBeGreaterThan(1);
    expect(data.bounds[2]).toBeGreaterThan(300);
    expect(withinDelta(sum(data.miss), result.shotgun_stats['드레이크']!.miss!, 0.01)).toBe(true);
  }, 60_000);
});
