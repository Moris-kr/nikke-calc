"""Winter Slayer experience belongs to her and shares one stack pool."""
import unittest

from calculator.buff_manager import BuffManager
from calculator.timeline import simulate
from context.spec import build_squad, build_config

NAME = "길로틴 : 윈터 슬레이어"


class WinterExperienceTest(unittest.TestCase):
    def manager(self):
        bm = BuffManager(build_squad([NAME, "팬텀"]), {"enemy": {}})
        bm.battle_start()
        return bm

    def test_other_shooters_never_receive_or_supply_experience(self):
        bm = self.manager()
        for i in range(60):
            bm.notify_team_hit("squad_body_hit", i / 12, "팬텀")
            bm.notify("hit_count", i / 12, "팬텀", core_frac=0.0)
        self.assertIsNone(bm.ref_count("팬텀", "경험치"))
        self.assertIsNone(bm.ref_count(NAME, "경험치"))

    def test_core_and_non_core_share_one_pool_and_one_cap(self):
        bm = self.manager()
        for i in range(30):
            bm.notify("hit_count", i / 12, NAME, core_frac=0.0)
        for i in range(15):
            bm.notify("core_hit", 3 + i / 12, NAME)
        self.assertEqual(bm.ref_count(NAME, "경험치"), 10)
        self.assertEqual(bm.ref_count(NAME, "용사 레벨"), 2)
        for i in range(600):
            bm.notify("hit_count", 5 + i / 12, NAME, core_frac=0.0)
            bm.notify("core_hit", 5 + i / 12, NAME)
        buffs = [a for a in bm._active if a.effect.get("name") == "경험치"]
        self.assertEqual(len(buffs), 1)
        self.assertEqual(buffs[0].stack, 100)
        self.assertEqual(bm.ref_count(NAME, "용사 레벨"), 11)

    def test_sixth_hit_checks_core_without_pausing_normal_hit_count(self):
        bm = self.manager()
        for i in range(5):
            bm.notify("hit_count", i / 12, NAME, core_frac=1.0)
        bm.notify("hit_count", 5 / 12, NAME, core_frac=0.0)
        self.assertEqual(bm.ref_count(NAME, "경험치"), 1)
        for i in range(5):
            bm.notify("hit_count", 1 + i / 12, NAME, core_frac=0.0)
        bm.notify("hit_count", 1.5, NAME, core_frac=1.0)
        self.assertEqual(bm.ref_count(NAME, "경험치"), 1)

    def test_expected_core_fraction_is_sampled_only_on_sixth_hits(self):
        bm = self.manager()
        for i in range(24):
            bm.notify("hit_count", i / 12, NAME, core_frac=0.5)
        self.assertEqual(bm.ref_count(NAME, "경험치"), 2)

    def test_real_non_core_shots_award_experience_only_to_owner(self):
        squad = build_squad([NAME, "팬텀"])
        result = simulate(squad, config=build_config(squad, {"duration": 10, "rng_mode": "expected"}),
                          enemy={"core_px": 0}, verbose=True)
        exp = [e for e in result.log.buff_events if e.name == "경험치" and e.kind == "activate"]
        self.assertTrue(exp)
        self.assertEqual({e.target for e in exp}, {NAME})
        self.assertEqual(max(e.stack for e in exp), sum(h.caster == NAME for h in result.hits) // 6)

    def test_parts_do_not_disable_owner_non_core_experience(self):
        squad = build_squad([NAME])
        result = simulate(squad, config={"duration": 10, "rng_mode": "expected"},
                          enemy={"core_px": 0, "has_parts": True}, verbose=True)
        exp = [e for e in result.log.buff_events if e.name == "경험치" and e.kind == "activate"]
        self.assertTrue(exp)
        self.assertEqual(max(e.stack for e in exp), len(result.hits) // 6)


if __name__ == "__main__":
    unittest.main()
