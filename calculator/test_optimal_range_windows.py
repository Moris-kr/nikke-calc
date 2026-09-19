import unittest
from unittest.mock import patch

from calculator.buff_manager import BuffManager
from calculator.timeline import simulate
from context.spec import build_config, build_squad


class OptimalRangeWindowsTest(unittest.TestCase):
    def run_sim(self, windows=None):
        squad = build_squad(["test_B3"])
        enemy = {"optimal_range_weapons": ["AR"]}
        if windows is not None:
            enemy["optimal_range_windows"] = windows
        return simulate(squad, config=build_config(squad, {
            "duration": 4, "rng_mode": "expected", "first_burst_time": 100,
        }), enemy=enemy)

    def test_legacy_and_empty_windows_match(self):
        self.assertEqual(self.run_sim().hits, self.run_sim([]).hits)

    def test_frame_boundaries_overlap_and_empty_override(self):
        states = {}
        tick = BuffManager.tick
        def observe(manager, t):
            states[round(t, 9)] = set(manager.state["enemy"]["optimal_range_weapons"])
            return tick(manager, t)
        with patch.object(BuffManager, "tick", observe):
            self.run_sim([
                {"from": 1, "to": 2, "weapons": ["SMG", "RL"]},
                {"from": 1.5, "to": 2.5, "weapons": ["SR"]},
                {"from": 3, "to": 3.5, "weapons": []},
            ])
        for t, expected in [(0, {"AR"}), (1, {"SMG"}), (1.5, {"SMG", "SR"}),
                            (2, {"SR"}), (2.5, {"AR"}), (3, set()), (3.5, {"AR"})]:
            self.assertEqual(states[t], expected, t)

    def test_validation(self):
        from calculator.customization import normalize_optimal_range_windows
        self.assertEqual(normalize_optimal_range_windows(None), [])
        good = {"from": 1, "to": 2, "weapons": ["SR", "RL", "AR", "SR"]}
        self.assertEqual(normalize_optimal_range_windows([good]), [
            {"from": 1., "to": 2., "weapons": ["AR", "SR"]}])
        for bad in [None, "AR", {}, ["invalid"], [None]]:
            with self.assertRaises(ValueError):
                normalize_optimal_range_windows([{**good, "weapons": bad}])
        for bad in [True, float("nan"), float("inf"), -1, 2, 181]:
            with self.assertRaises(ValueError):
                normalize_optimal_range_windows([{**good, "from": bad}])
        with self.assertRaises(ValueError):
            self.run_sim([{"from": 2, "to": 1, "weapons": []}])

    def test_normal_attack_damage_changes_only_inside_override(self):
        baseline = self.run_sim()
        changed = self.run_sim([{"from": 1, "to": 2, "weapons": []}])
        self.assertEqual(len(baseline.hits), len(changed.hits))
        affected = 0
        for before, after in zip(baseline.hits, changed.hits):
            self.assertEqual(before.t, after.t)
            if 1 <= round(after.t, 9) < 2:
                self.assertLess(after.damage, before.damage)
                affected += 1
            else:
                self.assertEqual(after.damage, before.damage)
        self.assertGreater(affected, 0)
