import unittest
from types import SimpleNamespace
from calculator.pellet_accuracy import probabilities
from calculator.timeline import CharState
from context.spec import build_squad


class SpatialShotgunTest(unittest.TestCase):
    def test_target_size_responds_to_spread_and_core_is_joint(self):
        enemy = {'shotgun_model': 'spatial-v1', 'shotgun_target_diameter': 120, 'core_px': 52}
        broad = probabilities(enemy, 'test', 0, True, 120, .99)
        narrow = probabilities(enemy, 'test', 0, True, 60, .99)
        self.assertAlmostEqual(broad[0], .5**2.55, delta=.002)
        self.assertGreater(narrow[0], broad[0])
        self.assertAlmostEqual(broad[0]*broad[1], (26/120)**2.55, delta=.002)

    def test_legacy_rollback_ignores_target_size(self):
        self.assertEqual(probabilities({'shotgun_hit_rate': .9, 'shotgun_target_diameter': 50}, 'x', 0, True, 120, .2), (.9, .2))

    def test_weapon_convergence_is_opt_in_and_firing_changes_radius(self):
        state = CharState(build_squad(['프리바티 : 언카인드 메이드'])[0], 10000, '')
        bm = SimpleNamespace(state={})
        enemy = {'shotgun_model': 'spatial-v1', 'shotgun_target_diameter': 120, 'core_px': 0}
        fixed = state._pellet_probabilities(0, bm, enemy, {}, 0)[0]
        for t in range(1, 14):
            self.assertEqual(state._pellet_probabilities(t, bm, enemy, {}, 0)[0], fixed)
        enemy['shotgun_model'] = 'spatial-convergence-v1'
        first = state._pellet_probabilities(20, bm, enemy, {}, 0)[0]
        for t in range(21, 34):
            last = state._pellet_probabilities(t, bm, enemy, {}, 0)[0]
        self.assertGreater(last, first)

    def test_raw_spread_is_preserved(self):
        from scraper.parse_nikke import parse_fire_mechanics
        self.assertEqual(parse_fire_mechanics({'탄착군': {'start': 250, 'end': 75, 'per_shot': 18, 'recovery': 105}})['spread']['end'], 75)

    def test_simulation_reports_fired_and_joint_expected_pellets(self):
        from calculator.timeline import simulate
        from context.spec import build_config
        squad = build_squad(['드레이크'])
        result = simulate(squad, config=build_config(squad, {'duration': 5, 'first_burst_time': 100, 'rng_mode': 'expected'}),
                          enemy={'shotgun_model': 'spatial-v1', 'shotgun_target_diameter': 120, 'core_px': 52})
        stats = result.shotgun_stats['드레이크']
        self.assertGreater(stats['fired'], stats['hit'])
        self.assertGreater(stats['hit'], stats['core'])
        self.assertGreater(stats['minDiameter'], 0)
        self.assertAlmostEqual(stats['hit'] + stats['miss'], stats['fired'])

    def test_expected_damage_matches_repeated_random_trials_without_feedback(self):
        from unittest.mock import patch
        from statistics import mean
        from calculator.timeline import simulate
        from context.spec import build_config
        squad = build_squad(['드레이크'])
        enemy = {'shotgun_model': 'spatial-v1', 'shotgun_target_diameter': 120, 'core_px': 52}
        config = build_config(squad, {'duration': 12, 'first_burst_time': 100, 'rng_mode': 'expected'})
        with patch('calculator.buff_manager.char_effects', return_value=[]):
            expected = simulate(squad, config=config, enemy=enemy).squad_total
            config['rng_mode'] = 'random'
            sampled = mean(simulate(squad, config=config, enemy=enemy, seed=i).squad_total for i in range(120))
        self.assertAlmostEqual(sampled / expected, 1, delta=.05)

    def test_experimental_recovery_freezes_at_reload_end(self):
        state = CharState(build_squad(['프리바티 : 언카인드 메이드'])[0], 10000, '')
        state._spread_scale = 75
        state._spread_reload_at = 10
        state._recover_spread(11)
        self.assertEqual(state._spread_scale, 180)
        state._recover_spread(12)
        self.assertEqual(state._spread_scale, 180)

    def test_weapon_change_does_not_inherit_base_weapon_convergence(self):
        state = CharState(build_squad(['프리바티 : 언카인드 메이드'])[0], 10000, '')
        state._spread_scale = 75
        state._in_weapon_change = True
        enemy = {'shotgun_model': 'spatial-convergence-v1', 'shotgun_target_diameter': 120, 'core_px': 0}
        ph, _ = state._pellet_probabilities(0, SimpleNamespace(state={}), enemy, {}, 0)
        self.assertAlmostEqual(ph, .5**2.55, delta=.002)
        self.assertEqual(state._spread_scale, 75)


if __name__ == '__main__':
    unittest.main()


class SizeWindowTests(unittest.TestCase):
    def test_boundaries_and_fallback(self):
        enemy = {'shotgun_model': 'spatial-v1', 'shotgun_target_diameter': 360,
                 'shotgun_size_windows': [{'from': 3, 'to': 6, 'diameter': 80}]}
        def hit(t):
            return probabilities(enemy, 'x', t, True, 120, 0)[0]
        self.assertEqual(hit(2.999), 1)
        self.assertLess(hit(3), .2)
        self.assertEqual(hit(6), 1)

    def test_drawn_geometry_scales_only_in_window(self):
        from calculator.pellet_accuracy import scene_at
        enemy = {'shotgun_target_diameter': 360, 'core_px': 20,
                 'shotgun_geometry': {'center': {'x': 100, 'y': 100}, 'core': {'x': 110, 'y': 100, 'd': 20}, 'shapes': [{'kind': 'rect', 'x': 100, 'y': 100, 'w': 100, 'h': 80}]},
                 'shotgun_size_windows': [{'from': 3, 'to': 6, 'diameter': 180}]}
        before = scene_at(enemy, 'x', 0, True, 120)
        during = scene_at(enemy, 'x', 3, True, 120)
        self.assertEqual(during[0][0][3:5], (50, 40))
        self.assertEqual(during[1], (105, 100))
        self.assertEqual(during[2], before[2])
        self.assertEqual(during[3], (105, 100, 5))
        self.assertEqual(scene_at(enemy, 'x', 6, True, 120), before)
