"""Independent timed veil reduction and explicit armor-break bypass."""
import unittest
from unittest.mock import patch

from calculator.damage import calc_damage, calc_damage_avg, default_hit_type
from calculator.timeline import simulate, _NIKKE
from context.spec import build_config, build_squad


def effect(stat, name=None, kind="damage", **extra):
    return {"name": name or stat, "type": kind, "stat": stat,
            "target": "self" if kind == "buff" else "target", "fixed_value": 100,
            "duration": 99, "trigger": {"timing": ["battle_start"], "condition": []}, **extra}


class DefenseRateTest(unittest.TestCase):
    def sim(self, windows=None, effects=()):
        squad = build_squad(["test_B3"])
        enemy = {"core_px": 0, "def": 0}
        if windows is not None:
            enemy["defense_rate_windows"] = windows
        with patch("calculator.buff_manager.char_effects", return_value=list(effects)):
            return simulate(squad, config=build_config(squad, {
                "duration": 4, "rng_mode": "expected", "first_burst_time": 100,
            }), enemy=enemy)

    def test_formula_independence_and_explicit_type(self):
        for received in (0, 50, 100):
            for extra in ({}, {"armor_break_dmg_pct": 100}, {"def_ignore_pct": 100},
                          {"enemy_def_down_pct": -50}):
                buffs = {"crit_rate": 0, "received_dmg": received, **extra}
                for ht in (default_hit_type(), default_hit_type(is_normal_atk=False, is_dot=True)):
                    args = dict(base_atk=10000, buffs=buffs, weapon={"damage_coeff": 100}, hit_type=ht, enemy_def=1000)
                    base = calc_damage(**args)["damage"]
                    args["buffs"] = {**buffs, "enemy_defense_rate_pct": 60}
                    self.assertEqual(calc_damage(**args)["damage"], round(base * .4))
                    self.assertAlmostEqual(calc_damage_avg(**args), base * .4)
                ht = default_hit_type(is_armor_break_damage=True)
                args["hit_type"] = ht
                self.assertEqual(calc_damage(**args)["damage"], calc_damage(**{**args, "buffs": buffs})["damage"])

    def test_reported_sixty_percent_samples(self):
        for before, after in ((381769, 152708), (560845, 224338), (35049, 14020), (24290, 9716)):
            self.assertEqual(calc_damage(
                base_atk=before, buffs={"crit_rate": 0, "enemy_defense_rate_pct": 60},
                weapon={"damage_coeff": 100}, enemy_def=0,
            )["damage"], after)

    def test_dot_ticks_use_current_window_not_application_time(self):
        dot = effect("dot_damage", duration=3, tick_interval=.5)
        plain = [h for h in self.sim(effects=[dot]).hits if h.hit_tag == "dot_damage"]
        reduced = [h for h in self.sim([[1, 2, 60]], [dot]).hits if h.hit_tag == "dot_damage"]
        self.assertGreater(len(plain), 2)
        self.assertEqual(len(plain), len(reduced))
        for a, b in zip(plain, reduced):
            factor = .4 if 1 <= round(b.t, 9) < 2 else 1
            self.assertAlmostEqual(b.damage, a.damage * factor, delta=1)

    def test_timed_overlap_boundaries_and_empty_baseline(self):
        self.assertEqual(self.sim().hits, self.sim([]).hits)
        probe = effect("damage", trigger={"timing": ["battle_start", "every:0.5s"], "condition": []})
        plain = self.sim(effects=[probe])
        windows = [[0, 1, 60], [1, 2, 20], [1.5, 3, 60]]
        reduced = self.sim(windows, [probe])
        self.assertEqual(len(plain.hits), len(reduced.hits))
        for a, b in zip(plain.hits, reduced.hits):
            rate = max((r for lo, hi, r in windows if lo <= round(b.t, 9) < hi), default=0)
            self.assertAlmostEqual(b.damage, a.damage * (1-rate/100), delta=1)

    def test_normal_conversion_and_skill_bypass(self):
        for buffs in ([], [effect("armor_break_enabled", kind="buff")]):
            effects = buffs + [effect("armor_break_damage")]
            plain, reduced = self.sim(effects=effects), self.sim([[0, 4, 60]], effects)
            for a, b in zip(plain.hits, reduced.hits):
                bypass = bool(buffs) or a.skill_name == "armor_break_damage"
                self.assertAlmostEqual(b.damage, a.damage * (1 if bypass else .4), delta=1)

    def test_copied_dealt_damage_not_reduced_twice(self):
        copy = effect("fixed_damage_from_dealt_pct", trigger={"timing": ["hit_count:1"], "condition": []})
        with patch.dict(_NIKKE["test_B3"], {"weapon_type": "SR", "charge_time": 1.0}):
            plain, reduced = self.sim(effects=[copy]), self.sim([[0, 4, 60]], [copy])
        copied = 0
        for a, b in zip(plain.hits, reduced.hits):
            self.assertAlmostEqual(b.damage, a.damage * .4, delta=1)
            copied += a.hit_tag == "fixed_damage_from_dealt_pct"
        self.assertGreater(copied, 0)

    def test_full_veil_blocks_ordinary_but_not_armor_break(self):
        for attack in (0, 10000):
            for armor in (False, True):
                args = dict(base_atk=attack, buffs={"enemy_defense_rate_pct": 100},
                            weapon={"damage_coeff": 100}, enemy_def=0,
                            hit_type=default_hit_type(is_armor_break_damage=armor))
                self.assertEqual(calc_damage(**args)["damage"] > 0, armor)
                self.assertEqual(calc_damage_avg(**args) > 0, armor)

    def test_accumulated_damage_not_reduced_twice(self):
        acc = effect("damage_accumulate", kind="buff", duration=2, fixed_value=100000)
        plain, reduced = self.sim(effects=[acc]), self.sim([[0, 4, 60]], [acc])
        released = [(a, b) for a, b in zip(plain.hits, reduced.hits) if a.skill_name == acc["name"]]
        self.assertTrue(released)
        for a, b in released:
            self.assertAlmostEqual(b.damage, a.damage * .4, delta=10)


class DefenseRateValidationTest(unittest.TestCase):
    def test_defaults_and_bounds(self):
        from calculator.customization import normalize_defense_rate_windows as normalize
        self.assertEqual(normalize(None), [])
        self.assertEqual(normalize([{ "from": 0, "to": 180}]), [[0., 180., 60.]])
        self.assertEqual(normalize([[0, 1, 0], [1, 180, 100]]), [[0., 1., 0.], [1., 180., 100.]])
        for raw in ({}, [None], [{"from": 1, "to": 1}], [{"from": -1, "to": 1}],
                    [{"from": 0, "to": 181}], [{"from": True, "to": 1}],
                    [{"from": float("nan"), "to": 1}], [{"from": 0, "to": float("inf")}]):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                normalize(raw)
        for r in (-1, 101, float("nan"), float("inf"), True, None):
            with self.subTest(rate=r), self.assertRaises(ValueError):
                normalize([{ "from": 0, "to": 1, "rate": r}])
        with self.assertRaises(ValueError):
            normalize([{ "from": 0, "to": 1}] * 101)


if __name__ == "__main__":
    unittest.main()
