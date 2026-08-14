from __future__ import annotations

import unittest

from calculator.buff_manager import BuffManager
from calculator.customization import normalize_character_overrides
from context.spec import build_squad


class CharacterCustomizationTest(unittest.TestCase):
    def test_skill_levels_are_normalized_for_the_engine(self):
        self.assertEqual(
            normalize_character_overrides({
                "skillLevels": {"1": 1, "2": 5, "3": 10},
            }),
            {"skill_levels": {"1": 1, "2": 5, "3": 10}},
        )

    def test_skill_levels_reject_unknown_keys_and_invalid_values(self):
        invalid = (
            {"4": 10},
            {"1": True},
            {"1": 1.5},
            {"1": 0},
            {"1": 11},
        )
        for skill_levels in invalid:
            with self.subTest(skill_levels=skill_levels):
                with self.assertRaises(ValueError):
                    normalize_character_overrides({"skillLevels": skill_levels})

    def test_released_skill_level_selects_the_parsed_effect_value(self):
        values = []
        for level in (1, 10):
            squad = build_squad(["리타"], {
                "리타": {"skill_levels": {"1": level, "2": 10, "3": 10}},
            })
            manager = BuffManager(squad, {"enemy": {}})
            manager.notify("burst_cast", 0, "리타")
            values.append(manager.get_buffs("리타", "__enemy__", 0)["max_ammo_pct"])

        self.assertEqual(values, [7.05, 45.17])

    def test_preview_skill_levels_are_fixed_at_ten(self):
        preview = "아마기 유키코"
        allowed = build_squad([preview], {
            preview: {"skill_levels": {"1": 10, "2": 10, "3": 10}},
        })[0]
        self.assertEqual(allowed["skill_levels"], {"1": 10, "2": 10, "3": 10})

        with self.assertRaisesRegex(ValueError, "프리뷰 캐릭터는 스킬 레벨 10"):
            build_squad([preview], {
                preview: {"skill_levels": {"1": 9, "2": 10, "3": 10}},
            })

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
        self.assertEqual(rita["enemy_def_down_pct"], -7)
        self.assertEqual(rapi["received_dmg"], 0)
        self.assertEqual(rapi["enemy_def_down_pct"], 0)

    def test_part_cube_routes_its_value_to_part_damage(self):
        squad = build_squad(["리타"], {
            "리타": {"cube": {"name": "파츠", "level": 15}},
        })
        manager = BuffManager(squad, {"enemy": {}})
        manager.notify("battle_start", 0, "리타")

        self.assertEqual(
            manager.get_buffs("리타", "__enemy__", 0)["part_dmg_pct"],
            31.9,
        )

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
