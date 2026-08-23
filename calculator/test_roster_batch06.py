import json
import unittest
from pathlib import Path

from calculator.buff_manager import BuffManager
from calculator.timeline import simulate
from context.spec import build_config, build_squad


ROOT = Path(__file__).resolve().parents[1]
BATCH = ["엑시아", "노벨", "라푼젤", "스노우 화이트 : 이노센트 데이즈", "라푼젤 : 퓨어 그레이스",
         "하란", "노아", "도로시", "루마니", "에피넬"]


def _skills():
    return json.loads((ROOT / "data" / "parsed_skills.json").read_text(encoding="utf-8"))


def _find(name, *, stat=None, effect_name=None, favorite=None):
    return [e for e in _skills()[name]
            if (stat is None or e.get("stat") == stat)
            and (effect_name is None or e.get("name") == effect_name)
            and (favorite is None or e.get("favorite") == favorite)]


class RosterBatch06Test(unittest.TestCase):
    def test_all_ten_are_registered(self):
        skills = _skills()
        self.assertTrue(all(name in skills for name in BATCH))
        self.assertGreaterEqual(len([name for name in skills if not name.startswith("test_")]), 146)

    def test_hidden_active_cooldowns_are_explicit(self):
        expected = {
            ("노벨", "수상한 것입니다!"): "every:10s",
            ("라푼젤", "디바인 블레스"): "every:15s",
            ("도로시", "세례"): "every:20s",
        }
        for (name, effect_name), timing in expected.items():
            self.assertEqual([timing], _find(name, effect_name=effect_name)[0]["trigger"]["timing"])

    def test_exia_favorite_contracts(self):
        self.assertEqual(5, _find("엑시아", effect_name="해킹 코드 수집", favorite=1)[0]["max_stack"])
        self.assertTrue(_find("엑시아", stat="received_dmg_pct", favorite=2))
        fixed = _find("엑시아", stat="reload_time_fixed", favorite=3)[0]
        self.assertAlmostEqual(0.1, fixed["fixed_value"])

    def test_innocent_days_burst_reduces_skill2_threshold_and_enables_infinite_ammo(self):
        reduce = _find("스노우 화이트 : 이노센트 데이즈", stat="trigger_count_reduce")[0]
        self.assertEqual("세븐스 드워프 IV", reduce["target_effect"])
        self.assertEqual(20, reduce["fixed_value"])
        self.assertTrue(_find("스노우 화이트 : 이노센트 데이즈", stat="max_ammo_infinite"))

        squad = build_squad(["리틀 머메이드", "크라운", "스노우 화이트 : 이노센트 데이즈"])
        result = simulate(squad, config=build_config(squad, {"first_burst_time": 1, "duration": 8}),
                          verbose=True, seed=1)
        cast_t = next(e.t for e in result.log.burst_log
                      if e.caster == "스노우 화이트 : 이노센트 데이즈")
        reloads = [e for e in result.log.reload_log
                   if e.caster == "스노우 화이트 : 이노센트 데이즈" and cast_t <= e.t <= cast_t + 5]
        self.assertEqual([], reloads)

    def test_pure_grace_shield_and_dorothy_brand_are_preserved(self):
        self.assertEqual(2, len(_find("라푼젤 : 퓨어 그레이스", stat="shared_shield_from_max_hp_pct")))
        self.assertTrue(_find("라푼젤 : 퓨어 그레이스", stat="shield_heal_from_caster_max_hp_pct"))
        brand = _find("도로시", stat="damage_accumulate")[0]
        self.assertEqual(8900.83, brand["values"]["10"])
        self.assertEqual(10.0, brand["duration"])

    def test_dorothy_brand_releases_accumulated_damage_at_expiry(self):
        squad = build_squad(["도로시", "크라운", "test_B3"])
        result = simulate(squad, config=build_config(squad, {"first_burst_time": 1, "duration": 14}), seed=1)
        releases = [h for h in result.hits if h.caster == "도로시" and h.skill_name == "낙인"]
        self.assertEqual(1, len(releases))
        self.assertGreater(releases[0].damage, 0)
        self.assertGreaterEqual(releases[0].t, 11)

    def test_all_ten_simulate_in_valid_squads(self):
        cases = [
            ("엑시아", ["엑시아", "크라운", "test_B3"]),
            ("노벨", ["리틀 머메이드", "노벨", "test_B3"]),
            ("라푼젤", ["라푼젤", "크라운", "test_B3"]),
            ("스노우 화이트 : 이노센트 데이즈", ["리틀 머메이드", "크라운", "스노우 화이트 : 이노센트 데이즈"]),
            ("라푼젤 : 퓨어 그레이스", ["라푼젤 : 퓨어 그레이스", "크라운", "test_B3"]),
            ("하란", ["리틀 머메이드", "크라운", "하란"]),
            ("노아", ["리틀 머메이드", "노아", "test_B3"]),
            ("도로시", ["도로시", "크라운", "test_B3"]),
            ("루마니", ["루마니", "크라운", "test_B3"]),
            ("에피넬", ["리틀 머메이드", "크라운", "에피넬"]),
        ]
        for name, members in cases:
            with self.subTest(name=name):
                squad = build_squad(members)
                result = simulate(squad, config=build_config(squad, {"first_burst_time": 1, "duration": 8}), seed=1)
                self.assertTrue(any(hit.caster == name for hit in result.hits))


if __name__ == "__main__":
    unittest.main()
