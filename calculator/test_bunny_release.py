"""Released bunny skill levels must reach buffs and transformed weapons."""
import unittest

from calculator.buff_manager import BuffManager
from context.spec import build_squad


class BunnyReleaseTest(unittest.TestCase):
    def manager(self, name, levels):
        chars = build_squad([name], chars={name: {"skill_levels": levels}})
        bm = BuffManager(chars, {"enemy": {}})
        bm.battle_start()
        return bm

    def test_sin_independent_skill_levels_and_released_weapon_state(self):
        name = "신 : 스위프트 바니"
        bm = self.manager(name, {"1": 1, "2": 5, "3": 9})
        before = bm.get_buffs(name, "", 0)
        bm.notify("full_charge", 1, name)
        charged = bm.get_buffs(name, "", 1)
        self.assertAlmostEqual(charged["normal_atk_dmg_pct"] - before["normal_atk_dmg_pct"], 59.09)
        self.assertAlmostEqual(charged["charge_dmg_pct"] - before["charge_dmg_pct"], 30.8)
        bm = self.manager(name, {"1": 1, "2": 5, "3": 9})
        before = bm.get_buffs(name, "", 0)
        bm.notify("burst_cast", 2, name)
        self.assertEqual(bm.weapon_change_name(name), "스위프트 피어싱")
        weapon = bm.get_weapon_change(name)
        self.assertEqual(weapon["damage_coeff"]["5"], 56.58)
        after = bm.get_buffs(name, "", 2)
        self.assertAlmostEqual(after["atk_pct"] - before["atk_pct"], 105)
        bm.notify("full_charge", 2.5, name)
        self.assertEqual(bm.get_buffs(name, "", 2.5)["normal_atk_dmg_pct"], after["normal_atk_dmg_pct"])

    def test_guilty_independent_skill_levels(self):
        name = "길티 : 마이티 바니"
        bm = self.manager(name, {"1": 1, "2": 5, "3": 9})
        before = bm.get_buffs(name, "", 0)
        bm.notify("burst_cast", 2, name)
        self.assertEqual(bm.get_weapon_change(name)["damage_coeff"]["9"], 96.86)
        after = bm.get_buffs(name, "", 2)
        self.assertAlmostEqual(after["charge_dmg_pct"] - before["charge_dmg_pct"], 1336.36)
        self.assertAlmostEqual(after["atk_dmg_pct"] - before["atk_dmg_pct"], 73.83)


if __name__ == "__main__":
    unittest.main()
