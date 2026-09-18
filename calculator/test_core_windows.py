"""Core exposure applies before attacks, timed skills, and battle-start skills."""
import unittest
from unittest.mock import patch

from calculator.buff_manager import BuffManager
from calculator.timeline import simulate
from context.spec import build_config, build_squad


class CoreWindowsTest(unittest.TestCase):
    def run_sim(self, windows=None, core_px=1000, effects=()):
        squad = build_squad(["test_B3"])
        enemy = {"core_px": core_px}
        if windows is not None:
            enemy["core_windows"] = windows
        with patch("calculator.buff_manager.char_effects", return_value=list(effects)):
            return simulate(squad, config=build_config(squad, {
                "duration": 4, "rng_mode": "expected", "first_burst_time": 100,
            }), enemy=enemy)

    def test_empty_and_absent_windows_preserve_always_core(self):
        self.assertEqual(self.run_sim().hits, self.run_sim([]).hits)

    def test_two_windows_gate_normal_hits_and_preserve_no_core_toggle(self):
        windows = [[1, 2], [3, 3.5]]
        result = self.run_sim(windows)
        regions = set()
        for hit in result.hits:
            t = round(hit.t, 9)
            exposed = any(a <= t < b for a, b in windows)
            self.assertEqual(hit.core_frac > 0, exposed, hit)
            regions.add(0 if t < 1 else 1 if t < 2 else 2 if t < 3 else 3 if t < 3.5 else 4)
        self.assertEqual(regions, set(range(5)))
        self.assertTrue(all(hit.core_frac == 0 for hit in self.run_sim(windows, core_px=0).hits))

    def test_core_condition_is_set_before_battle_start_and_timed_skills(self):
        effect = {
            "name": "exposure probe", "type": "damage", "stat": "core_damage",
            "target": "target", "fixed_value": 100,
            "trigger": {"timing": ["battle_start", "every:0.5s"], "condition": ["core_hit"]},
        }
        result = self.run_sim([[1, 2], [3, 3.5]], effects=[effect])
        times = [round(h.t, 9) for h in result.hits if h.skill_name == "exposure probe"]
        self.assertEqual(len(times), 3)
        self.assertTrue(all(any(a <= t < b for a, b in [[1, 2], [3, 3.5]]) for t in times))
        self.assertTrue(any(h.t == 0 for h in self.run_sim([[0, 1]], effects=[effect]).hits
                            if h.skill_name == "exposure probe"))

    def test_frame_boundaries_are_start_inclusive_and_end_exclusive(self):
        states = {}
        tick = BuffManager.tick

        def observe(manager, t):
            states[round(t, 9)] = manager.state["enemy"]["core_px"]
            return tick(manager, t)

        with patch.object(BuffManager, "tick", observe):
            self.run_sim([[1, 2], [3, 3.5]])
        for t, exposed in [(0, False), (1, True), (2, False), (3, True), (3.5, False)]:
            self.assertEqual(states[t] > 0, exposed, t)

    def test_normal_formula_skills_use_current_exposure(self):
        effect = {
            "name": "normal formula probe", "type": "damage", "stat": "damage",
            "damage_formula": "normal_attack", "target": "target", "fixed_value": 100,
            "trigger": {"timing": ["battle_start", "every:0.5s"], "condition": []},
        }
        plain = self.run_sim(core_px=0, effects=[effect])
        exposed = self.run_sim([[1, 2], [3, 3.5]], effects=[effect])
        body_damage = {h.t: h.damage for h in plain.hits if h.skill_name == effect["name"]}
        for h in exposed.hits:
            if h.skill_name == effect["name"]:
                inside = any(a <= round(h.t, 9) < b for a, b in [[1, 2], [3, 3.5]])
                self.assertEqual(h.damage > body_damage[h.t], inside, h)

    def test_core_hit_trigger_only_fires_during_exposure(self):
        effect = {
            "name": "core hit probe", "type": "damage", "stat": "damage",
            "target": "target", "fixed_value": 100,
            "trigger": {"timing": ["core_hit:1"], "condition": []},
        }
        result = self.run_sim([[1, 2], [3, 3.5]], effects=[effect])
        times = [round(h.t, 9) for h in result.hits if h.skill_name == effect["name"]]
        self.assertTrue(times)
        self.assertTrue(all(any(a <= t < b for a, b in [[1, 2], [3, 3.5]]) for t in times))


if __name__ == "__main__":
    unittest.main()
