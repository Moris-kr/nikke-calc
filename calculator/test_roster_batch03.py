import json
import unittest
from pathlib import Path

from calculator.buff_manager import BuffManager
from calculator.timeline import simulate
from context.spec import build_config, build_squad


ROOT = Path(__file__).resolve().parents[1]
BATCH = [
    "엠마 : 택티컬 업", "은화 : 택티컬 업", "크로우", "자칼", "바이퍼",
    "E.H.", "앤 : 미라클 페어리", "메어리", "페퍼", "밀크",
]


def _skills():
    return json.loads((ROOT / "data" / "parsed_skills.json").read_text(encoding="utf-8"))


def _find(name, *, stat=None, effect_name=None, favorite=None):
    return [
        effect for effect in _skills()[name]
        if (stat is None or effect.get("stat") == stat)
        and (effect_name is None or effect.get("name") == effect_name)
        and (favorite is None or effect.get("favorite") == favorite)
    ]


class RosterBatch03Test(unittest.TestCase):
    def test_all_ten_are_registered(self):
        skills = _skills()
        self.assertTrue(all(name in skills for name in BATCH))
        self.assertGreaterEqual(len([name for name in skills if not name.startswith("test_")]), 116)

    def test_tactical_formation_and_environment_contracts(self):
        same_squad = _find("엠마 : 택티컬 업", effect_name="포메이션 LT")[0]
        self.assertEqual("allies_same_squad", same_squad["target"])
        interval = _find("엠마 : 택티컬 업", stat="effect_interval")[0]
        self.assertEqual(-20.0, interval["fixed_value"])
        self.assertEqual("환경 조성", interval["target_effect"])
        self.assertTrue(_find("은화 : 택티컬 업", stat="armor_break_enabled"))

    def test_same_squad_target_selects_only_absolute_members(self):
        manager = BuffManager(
            build_squad(["엠마 : 택티컬 업", "은화 : 택티컬 업", "라피"]),
            {"enemy": {}},
        )
        manager.battle_start()
        self.assertGreater(manager.get_buffs("은화 : 택티컬 업", "__enemy__", 0)["crit_dmg"], 0)
        self.assertEqual(0, manager.get_buffs("라피", "__enemy__", 0)["crit_dmg"])

        paired = BuffManager(
            build_squad(["엠마 : 택티컬 업", "은화 : 택티컬 업"]), {"enemy": {}},
        )
        paired.battle_start()
        paired.tick(0.0)
        environment_intervals = [
            paired._next_fire[id(effect)][1]
            for effect, caster, timing in paired._every_effects
            if caster == "엠마 : 택티컬 업" and effect["name"] == "환경 조성"
        ]
        self.assertEqual([10.0, 10.0, 10.0], environment_intervals)

    def test_crow_jackal_and_viper_contracts(self):
        self.assertTrue(_find("크로우", stat="atk_pct", effect_name="킬링타임"))
        self.assertTrue(_find("자칼", stat="received_dmg_split"))
        self.assertTrue(_find("바이퍼", stat="burst_reentry", favorite=3))
        dot = _find("바이퍼", stat="dot_damage", favorite=2)[0]
        self.assertEqual(1.0, dot["tick_interval"])
        self.assertEqual(10.0, dot["duration"])

    def test_eh_scrap_magazine_and_dynamic_weapon_contracts(self):
        self.assertTrue(_find("E.H.", stat="gauge_charge", effect_name="폐품 수집"))
        self.assertTrue(_find("E.H.", stat="gauge_consume", effect_name="사제 탄창 제작 3"))
        weapon = [effect for effect in _skills()["E.H."] if effect.get("type") == "weapon_change"][0]
        self.assertEqual("사제 탄창", weapon["max_ammo_gauge_ref"])
        self.assertEqual(4, weapon["max_ammo"])

    def test_eh_weapon_uses_current_magazine_count_as_ammo(self):
        squad = build_squad(["리틀 머메이드", "크라운", "E.H."])
        result = simulate(
            squad,
            config=build_config(squad, {"first_burst_time": 1.0, "duration": 8.0}),
            seed=1,
        )
        eh_burst_hits = [
            hit for hit in result.hits
            if hit.caster == "E.H." and "full_charge" in hit.hit_tag and 1.0 <= hit.t <= 8.0
        ]
        self.assertEqual(1, len(eh_burst_hits))

        stocked = simulate(
            squad,
            config=build_config(squad, {
                "first_burst_time": 1.0, "duration": 8.0, "part_break_interval": 0.1,
            }),
            seed=1,
        )
        stocked_hits = [
            hit for hit in stocked.hits
            if hit.caster == "E.H." and "full_charge" in hit.hit_tag and 1.0 <= hit.t <= 8.0
        ]
        self.assertEqual(4, len(stocked_hits))

    def test_healers_and_milk_favorite_contracts(self):
        self.assertTrue(_find("앤 : 미라클 페어리", stat="revive"))
        self.assertTrue(_find("메어리", stat="heal_hp_pct", effect_name="백의의 천사"))
        pepper = _find("페퍼", effect_name="비타민파워")[0]
        self.assertEqual(["every:10s"], pepper["trigger"]["timing"])
        milk = _find("밀크", effect_name="밀크에겐 맡겨!", favorite=1)[0]
        self.assertEqual(["every:20s"], milk["trigger"]["timing"])
        self.assertTrue(_find("밀크", stat="burst_cooldown", favorite=1))

        manager = BuffManager(build_squad(["앤 : 미라클 페어리", "크로우", "라피"]), {"enemy": {}})
        manager.notify("burst_cast", 1.0, "앤 : 미라클 페어리")
        self.assertGreater(manager.get_buffs("라피", "__enemy__", 1.0)["atk_pct"], 0)
        self.assertEqual(manager.get_buffs("크로우", "__enemy__", 1.0)["atk_pct"], 0)

    def test_all_ten_run_in_valid_squads(self):
        cases = [
            ("엠마 : 택티컬 업", ["엠마 : 택티컬 업", "크라운", "test_B3"]),
            ("은화 : 택티컬 업", ["리틀 머메이드", "은화 : 택티컬 업", "test_B3"]),
            ("크로우", ["리틀 머메이드", "크라운", "크로우"]),
            ("자칼", ["자칼", "크라운", "test_B3"]),
            ("바이퍼", ["리틀 머메이드", "바이퍼", "test_B3"]),
            ("E.H.", ["리틀 머메이드", "크라운", "E.H."]),
            ("앤 : 미라클 페어리", ["앤 : 미라클 페어리", "크라운", "test_B3"]),
            ("메어리", ["메어리", "크라운", "test_B3"]),
            ("페퍼", ["페퍼", "크라운", "test_B3"]),
            ("밀크", ["밀크", "크라운", "test_B3"]),
        ]
        for name, members in cases:
            with self.subTest(name=name):
                squad = build_squad(members)
                result = simulate(squad, config=build_config(squad, {"first_burst_time": 1, "duration": 8}), seed=1)
                self.assertTrue(any(hit.caster == name for hit in result.hits))


if __name__ == "__main__":
    unittest.main()
