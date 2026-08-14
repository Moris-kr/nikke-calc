from __future__ import annotations

import json
import unittest
from pathlib import Path

from context.growth import growth_profile, resolve_growth
from context.spec import build_char


class CharacterGrowthTest(unittest.TestCase):
    def test_bond_rank_ten_has_canonical_stats_for_each_class(self):
        table = json.loads(
            (Path(__file__).parent.parent / "data" / "base_stat_tables" / "affinity.json")
            .read_text(encoding="utf-8")
        )
        self.assertEqual(table["화력형"]["10"], {"hp": 9062, "atk": 403, "def": 60})
        self.assertEqual(table["방어형"]["10"], {"hp": 11076, "atk": 269, "def": 74})
        self.assertEqual(table["지원형"]["10"], {"hp": 10069, "atk": 336, "def": 67})

    def test_resolves_rarity_stage_table(self):
        cases = (
            ("R", 0, 0, 0, 1),
            ("SR", 0, 0, 0, 10),
            ("SR", 2, 2, 0, 30),
            ("SSR", 0, 0, 0, 10),
            ("SSR", 3, 3, 0, 30),
            ("SSR", 10, 3, 7, 30),
        )
        for rarity, stage, breakthrough, core, affinity in cases:
            with self.subTest(rarity=rarity, stage=stage):
                self.assertEqual(
                    resolve_growth("테스트", {"rarity": rarity, "manufacturer": "엘리시온"}, stage),
                    {
                        "breakthrough": breakthrough,
                        "core_enhancement": core,
                        "affinity": affinity,
                    },
                )

    def test_rejects_invalid_stages_and_unknown_rarity(self):
        cases = (
            ({"rarity": "SSR", "manufacturer": "엘리시온"}, True),
            ({"rarity": "SSR", "manufacturer": "엘리시온"}, 1.5),
            ({"rarity": "SSR", "manufacturer": "엘리시온"}, -1),
            ({"rarity": "SSR", "manufacturer": "엘리시온"}, 11),
            ({"rarity": "SR", "manufacturer": "엘리시온"}, 3),
            ({"rarity": "R", "manufacturer": "엘리시온"}, 1),
            ({"rarity": "UR", "manufacturer": "엘리시온"}, 0),
        )
        for meta, stage in cases:
            with self.subTest(meta=meta, stage=stage):
                with self.assertRaises(ValueError):
                    resolve_growth("테스트", meta, stage)

    def test_pilgrim_and_over_spec_unlock_bond_forty(self):
        pilgrim = {"rarity": "SSR", "manufacturer": "필그림"}
        ordinary = {"rarity": "SSR", "manufacturer": "엘리시온"}
        self.assertEqual(resolve_growth("크라운", pilgrim, 3)["affinity"], 40)
        self.assertEqual(resolve_growth("리타", ordinary, 3)["affinity"], 30)
        for name in ("라피 : 레드 후드", "아니스 : 스타", "네온 : 비전 아이"):
            with self.subTest(name=name):
                self.assertEqual(resolve_growth(name, ordinary, 3)["affinity"], 40)

    def test_profile_exposes_maximum_and_default_stage(self):
        self.assertEqual(
            growth_profile("테스트", {"rarity": "SR", "manufacturer": "엘리시온"}),
            {"rarity": "SR", "max_stage": 2, "default_stage": 2, "bond_40": False},
        )
        self.assertEqual(
            growth_profile("크라운", {"rarity": "SSR", "manufacturer": "필그림"}),
            {"rarity": "SSR", "max_stage": 10, "default_stage": 3, "bond_40": True},
        )

    def test_build_char_uses_profile_default_but_preserves_direct_overrides(self):
        self.assertEqual(build_char("리타")["affinity"], 30)
        self.assertEqual(build_char("크라운")["affinity"], 40)

        direct = build_char("크라운", {"affinity": 12})
        self.assertEqual(
            (direct["breakthrough"], direct["core_enhancement"], direct["affinity"]),
            (3, 0, 12),
        )


if __name__ == "__main__":
    unittest.main()
