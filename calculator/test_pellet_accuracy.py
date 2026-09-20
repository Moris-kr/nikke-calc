import unittest
from unittest.mock import patch

from calculator.timeline import simulate, normal_hit_coeff
from context.spec import build_squad, build_config


class PelletAccuracyTest(unittest.TestCase):
    def run_case(self, probability=1, geometry=None, mode='expected', effects=()):
        squad = build_squad(['드레이크'])
        with patch('calculator.buff_manager.char_effects', return_value=list(effects)):
            return simulate(squad, config=build_config(squad, {
                'duration': 8, 'first_burst_time': 100, 'rng_mode': mode,
            }), enemy={'core_px': 0, 'shotgun_hit_rate': probability,
                       **({'shotgun_geometry': geometry} if geometry is not None else {})}, seed=42)

    def test_default_coefficient_is_unscaled(self):
        self.assertEqual(normal_hit_coeff({}, 'SG'), 1)

    def test_probability_changes_damage_and_zero_disables_hit_triggers(self):
        full = self.run_case().squad_total
        self.assertAlmostEqual(self.run_case(.8).squad_total / full, .8, delta=.0001)
        effect = {'name': 'pellet probe', 'type': 'damage', 'stat': 'damage',
                  'target': 'target', 'fixed_value': 100,
                  'trigger': {'timing': ['pellet_hit_count:1'], 'condition': []}}
        self.assertEqual(self.run_case(0, effects=[effect]).squad_total, 0)
        a = self.run_case(1, effects=[effect])
        b = self.run_case(.8, effects=[effect])
        self.assertLess(sum(h.skill_name == 'pellet probe' for h in b.hits),
                        sum(h.skill_name == 'pellet probe' for h in a.hits))

    def test_geometry_overrides_preset_and_respects_visibility_and_aim(self):
        box = {'kind': 'rect', 'x': 0, 'y': 0, 'w': 1000, 'h': 1000, 'rotation': 0}
        geometry = {'shapes': [box], 'parts': [], 'center': {'x': 0, 'y': 0}}
        self.assertEqual(self.run_case(0, geometry).squad_total, self.run_case().squad_total)
        self.assertEqual(self.run_case(1, {**geometry, 'shapes': []}).squad_total, 0)
        limited = {**geometry, 'shapes': [{**box, 'windows': [[0, 2]]}]}
        self.assertTrue(all(h.t < 2 for h in self.run_case(1, limited).hits))
        away = {**geometry, 'center': {'x': 2000, 'y': 0}}
        self.assertEqual(self.run_case(1, away).squad_total, 0)

    def test_multi_hit_threshold_uses_binomial_probability(self):
        effect = {'name': 'multi probe', 'type': 'damage', 'stat': 'damage',
                  'target': 'target', 'fixed_value': 100,
                  'trigger': {'timing': ['multi_hit:10'], 'condition': []}}
        full = self.run_case(1, effects=[effect])
        partial = self.run_case(.8, effects=[effect])
        count = lambda result: sum(h.skill_name == 'multi probe' for h in result.hits)
        self.assertGreater(count(full), 0)
        self.assertEqual(count(partial), int(count(full) * .8 ** 10))

    def test_shapes_overlap_and_rotation_and_distribution(self):
        from calculator.pellet_accuracy import contains, integrate, aim_at, at_least
        self.assertTrue(contains(('rect', 0, 0, 40, 4, 90), 0, 15))
        self.assertFalse(contains(('rect', 0, 0, 40, 4, 90), 15, 0))
        self.assertTrue(contains(('triangle', 0, 0, 40, 40, 0), 0, -19))
        self.assertFalse(contains(('triangle', 0, 0, 40, 40, 0), 15, -19))
        circle = ('circle', 0, 0, 100, 100, 0)
        hit, core = integrate((circle,), (0, 0), 100, (0, 0, 25), 2.55)
        self.assertAlmostEqual(hit, .5 ** 2.55, delta=.002)
        self.assertAlmostEqual(hit * core, .25 ** 2.55, delta=.002)
        self.assertEqual(integrate((circle, circle), (0, 0), 100, None, 2.55)[0], hit)
        self.assertEqual(aim_at({'aimKeys': [{'t': 0, 'x': 0, 'y': 0}, {'t': 10, 'x': 100, 'y': 20}]}, 5), {'x': 50, 'y': 10})
        self.assertAlmostEqual(at_least(10, .8, 10), .8 ** 10)

    def test_non_shotgun_unaffected(self):
        squad = build_squad(['test_B3'])
        config = build_config(squad, {'duration': 4, 'first_burst_time': 100, 'rng_mode': 'expected'})
        self.assertEqual(simulate(squad, config=config, enemy={'shotgun_hit_rate': 0}).hits,
                         simulate(squad, config=config, enemy={'shotgun_hit_rate': 1}).hits)

    def test_weapon_change_uses_shotgun_accuracy_and_all_miss_charge_is_safe(self):
        from calculator.timeline import CharState, _NIKKE
        from types import SimpleNamespace
        squad = build_squad(['드레이크'])
        state = CharState(squad[0], 10000, '')
        state.weapon_type = 'RL'
        state.accuracy_weapon = 'SG'
        self.assertEqual(state._pellet_probabilities(0, SimpleNamespace(state={}),
                         {'shotgun_hit_rate': 0}, {}, .3), (0, .3))
        config = build_config(squad, {'duration': 4, 'first_burst_time': 100, 'rng_mode': 'random'})
        with patch.object(CharState, '_pellet_probabilities', return_value=(0, 0)), \
             patch.dict(_NIKKE['test_B3'], {'weapon_type': 'SR', 'charge_time': 1, 'charge_mult': 2.5}):
            charged = build_squad(['test_B3'])
            self.assertEqual(simulate(charged, config=config).squad_total, 0)

    def test_random_reproducibility_and_partial_misses(self):
        a = self.run_case(.8, mode='random')
        self.assertEqual(a.hits, self.run_case(.8, mode='random').hits)
        self.assertLess(len(a.hits), len(self.run_case(1, mode='random').hits))


if __name__ == '__main__':
    unittest.main()
