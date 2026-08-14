from __future__ import annotations

import unittest

from calculator.buff_manager import BuffManager
from calculator.customization import normalize_character_overrides
from context.spec import build_squad


class CharacterCustomizationTest(unittest.TestCase):
    def test_overload_values_replace_resolved_defaults(self):
        over = normalize_character_overrides({
            "overload": {
                "element_bonus": 10,
                "atk_pct": 3,
                "max_ammo_pct": 4,
                "crit_rate": 5,
                "crit_dmg": 6,
            }
        })

        char = build_squad(["미하라 : 본딩 체인"], {
            "미하라 : 본딩 체인": over,
        })[0]

        self.assertEqual(char["equip_skills"]["element_bonus"], 10)
        self.assertEqual(char["equip_skills"]["atk_pct"], 3)
        self.assertEqual(char["equip_skills"]["max_ammo_pct"], 4)
        self.assertEqual(char["equip_skills"]["crit_rate"], 5)
        self.assertEqual(char["equip_skills"]["crit_dmg"], 6)

    def test_manual_damage_stat_applies_only_to_its_character(self):
        squad = build_squad(["리타", "라피"], {
            "리타": {"manual_stats": {"split_dmg_pct": 20}},
        })
        manager = BuffManager(squad, {"enemy": {}})
        manager.notify("battle_start", 0, "리타")
        manager.notify("battle_start", 0, "라피")

        self.assertEqual(manager.get_buffs("리타", "__enemy__", 0)["split_dmg_pct"], 20)
        self.assertEqual(manager.get_buffs("라피", "__enemy__", 0)["split_dmg_pct"], 0)

    def test_personal_enemy_modifiers_do_not_leak_to_teammates(self):
        squad = build_squad(["리타", "라피"], {
            "리타": {"manual_stats": {
                "received_dmg_pct": 12,
                "enemy_def_down_pct": 7,
            }},
        })
        manager = BuffManager(squad, {"enemy": {}})
        manager.notify("battle_start", 0, "리타")
        manager.notify("battle_start", 0, "라피")

        rita = manager.get_buffs("리타", "__enemy__", 0)
        rapi = manager.get_buffs("라피", "__enemy__", 0)
        self.assertEqual(rita["received_dmg"], 12)
        self.assertEqual(rita["enemy_def_down_pct"], 7)
        self.assertEqual(rapi["received_dmg"], 0)
        self.assertEqual(rapi["enemy_def_down_pct"], 0)

    def test_ammo_cube_triggers_every_tenth_hit_not_at_battle_start(self):
        squad = build_squad(["리타"], {
            "리타": {"cube": {"name": "탄충", "level": 15}},
        })
        manager = BuffManager(squad, {"enemy": {}})
        events: list[tuple[str, float]] = []
        manager.register_instant_handler(
            "ammo_charge_flat",
            lambda _eff, caster, _t, value: events.append((caster, value)),
        )

        manager.notify("battle_start", 0, "리타")
        self.assertEqual(events, [])
        for hit in range(1, 10):
            manager.notify("hit_count", hit / 10, "리타")
        self.assertEqual(events, [])
        manager.notify("hit_count", 1, "리타")
        self.assertEqual(events, [("리타", 3.0)])

    def test_manual_ammo_recovery_uses_the_same_tenth_hit_semantics(self):
        squad = build_squad(["리타"], {
            "리타": {"manual_stats": {"ammo_charge_flat": 8}},
        })
        manager = BuffManager(squad, {"enemy": {}})
        events: list[float] = []
        manager.register_instant_handler(
            "ammo_charge_flat",
            lambda _eff, _caster, _t, value: events.append(value),
        )

        manager.notify("battle_start", 0, "리타")
        for hit in range(10):
            manager.notify("hit_count", hit / 10, "리타")
        self.assertEqual(events, [8.0])


if __name__ == "__main__":
    unittest.main()
