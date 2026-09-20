import unittest
from calculator.timeline import simulate
from context.spec import build_squad, build_config


class ShotgunHeatmapTest(unittest.TestCase):
    def run_case(self, report, mode='spatial-v1', extra=None):
        squad = build_squad(['드레이크'])
        return simulate(squad, config=build_config(squad, {'duration': 4, 'rng_mode': 'expected'}),
                        enemy={'shotgun_model': mode, 'shotgun_target_diameter': 120,
                               'core_px': 52, 'shotgun_report': report, **(extra or {})}, seed=42)

    def test_diagnostics_preserve_damage_and_match_integrated_counts(self):
        plain, detailed = self.run_case(False), self.run_case(True)
        self.assertEqual(plain.squad_total, detailed.squad_total)
        self.assertFalse(plain.shotgun_report)
        data = detailed.shotgun_report['드레이크']
        stats = detailed.shotgun_stats['드레이크']
        self.assertAlmostEqual(sum(data['core']), stats['core'], delta=.01)
        self.assertAlmostEqual(sum(data['body']) + sum(data['core']), stats['hit'], delta=.01)
        self.assertAlmostEqual(sum(data['miss']), stats['miss'], delta=.01)
        self.assertAlmostEqual(sum(data['density']), stats['fired'], delta=.01)

    def test_legacy_never_invents_a_spatial_hit_mask(self):
        data = self.run_case(True, 'legacy', {'shotgun_hit_rate': .8}).shotgun_report['드레이크']
        self.assertFalse(data['spatial'])
        self.assertEqual(sum(data['body']) + sum(data['core']) + sum(data['miss']), 0)
        self.assertAlmostEqual(data['hit'] / data['fired'], .8)

    def test_core_windows_are_captured_at_shot_time(self):
        data = self.run_case(True, extra={'core_windows': [(10, 11)]}).shotgun_report['드레이크']
        self.assertEqual(sum(data['core']), 0)

    def test_drawing_uses_moving_aim_and_actual_shape(self):
        geometry = {'shapes': [{'kind': 'rect', 'x': 0, 'y': 0, 'w': 120, 'h': 120}],
                    'center': {'x': 0, 'y': 0}, 'playerName': '드레이크',
                    'aimKeys': [{'t': 0, 'x': 0, 'y': 0}, {'t': 3, 'x': 300, 'y': 0}]}
        result = self.run_case(True, extra={'shotgun_geometry': geometry})
        data = result.shotgun_report['드레이크']
        self.assertGreater(data['sceneCount'], 1)
        self.assertGreater(data['bounds'][2], 300)
        self.assertAlmostEqual(sum(data['miss']), result.shotgun_stats['드레이크']['miss'], delta=.01)


if __name__ == '__main__':
    unittest.main()
