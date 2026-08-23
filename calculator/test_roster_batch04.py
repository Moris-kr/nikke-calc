import json
import unittest
from pathlib import Path

from calculator.buff_manager import BuffManager
from calculator.timeline import simulate
from context.spec import build_config, build_squad


ROOT = Path(__file__).resolve().parents[1]
BATCH = ["라피", "네온", "아니스", "델타", "벨로타", "미카", "N102", "프림", "유니", "미하라"]


def _skills():
    return json.loads((ROOT / "data" / "parsed_skills.json").read_text(encoding="utf-8"))


def _find(name, *, stat=None, effect_name=None, favorite=None):
    return [e for e in _skills()[name]
            if (stat is None or e.get("stat") == stat)
            and (effect_name is None or e.get("name") == effect_name)
            and (favorite is None or e.get("favorite") == favorite)]


class RosterBatch04Test(unittest.TestCase):
    def test_all_ten_are_registered(self):
        skills = _skills()
        self.assertTrue(all(name in skills for name in BATCH))
        self.assertGreaterEqual(len([name for name in skills if not name.startswith("test_")]), 126)

    def test_hidden_active_cooldowns_are_explicit(self):
        expected = {
            ("라피", "미사일"): "every:20s",
            ("아니스", "포메이션 C.H"): "every:10s",
            ("미카", "용감한 별님"): "every:20s",
            ("N102", "부상하는 기억"): "every:10s",
        }
        for (name, effect_name), timing in expected.items():
            with self.subTest(name=name):
                self.assertEqual([timing], _find(name, effect_name=effect_name)[0]["trigger"]["timing"])

    def test_core_data_contracts(self):
        self.assertEqual(2, _find("네온", stat="crit_rate", effect_name="화력 만세!")[0]["duration_bullets"])
        self.assertTrue(_find("아니스", stat="received_dmg_split"))
        self.assertTrue(_find("델타", stat="decoy"))
        self.assertTrue(_find("벨로타", stat="explosion_range"))
        self.assertTrue(_find("유니", stat="enemy_movement_disable"))
        self.assertTrue(_find("미하라", stat="fullburst_duration"))

    def test_frima_favorite_wakes_after_six_full_charge_hits(self):
        manager = BuffManager(build_squad(["프림"], {"프림": {"favorite_stage": 3}}), {"enemy": {}})
        manager.battle_start()
        for index in range(6):
            manager.notify("full_charge_hit", 1.0 + index, "프림")
        self.assertTrue(manager._has_self_state("프림", "일어남"))
        self.assertTrue(manager.get_buffs("프림", "__enemy__", 6.0)["armor_break_enabled"])

        interrupted = BuffManager(build_squad(["프림"], {"프림": {"favorite_stage": 3}}), {"enemy": {}})
        interrupted.battle_start()
        for index in range(3):
            interrupted.notify("full_charge_hit", 1.0 + index, "프림")
        interrupted._active = [ab for ab in interrupted._active if ab.effect.get("name") != "잠 옴"]
        interrupted._invalidate_buffs_cache()
        for index in range(3, 6):
            interrupted.notify("full_charge_hit", 1.0 + index, "프림")
        self.assertFalse(interrupted._has_self_state("프림", "일어남"))

    def test_mihara_first_and_second_burst_layers_stack(self):
        manager = BuffManager(build_squad(["미하라"]), {"enemy": {}})
        manager.notify("burst_cast", 1.0, "미하라")
        self.assertTrue(manager._has_self_state("미하라", "페인 로드 1"))
        self.assertFalse(manager._has_self_state("미하라", "페인 로드 2"))
        self.assertEqual(-5.0, manager.get_buffs("미하라", "__enemy__", 1.0)["fullburst_duration"])
        manager.notify("burst_cast", 2.0, "미하라")
        self.assertTrue(manager._has_self_state("미하라", "페인 로드 1"))
        self.assertTrue(manager._has_self_state("미하라", "페인 로드 2"))

    def test_all_ten_run_in_valid_squads(self):
        cases = [
            ("라피", ["리틀 머메이드", "크라운", "라피"]),
            ("네온", ["네온", "크라운", "test_B3"]),
            ("아니스", ["리틀 머메이드", "아니스", "test_B3"]),
            ("델타", ["리틀 머메이드", "델타", "test_B3"]),
            ("벨로타", ["리틀 머메이드", "벨로타", "test_B3"]),
            ("미카", ["미카", "크라운", "test_B3"]),
            ("N102", ["N102", "크라운", "test_B3"]),
            ("프림", ["프림", "크라운", "test_B3"]),
            ("유니", ["리틀 머메이드", "유니", "test_B3"]),
            ("미하라", ["리틀 머메이드", "크라운", "미하라"]),
        ]
        for name, members in cases:
            with self.subTest(name=name):
                squad = build_squad(members)
                result = simulate(squad, config=build_config(squad, {"first_burst_time": 1, "duration": 8}), seed=1)
                self.assertTrue(any(hit.caster == name for hit in result.hits))


if __name__ == "__main__":
    unittest.main()
