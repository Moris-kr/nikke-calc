import json
import unittest
from pathlib import Path

from calculator.timeline import simulate
from context.spec import build_config, build_squad


ROOT = Path(__file__).resolve().parents[1]
BATCH = ["폴크방", "니힐리스타", "사쿠라", "에테르", "솔져 E.G.", "솔져 F.A.",
         "프로덕트 08", "프로덕트 12", "iDoll 플라워", "iDoll 오션"]


def _skills():
    return json.loads((ROOT / "data" / "parsed_skills.json").read_text(encoding="utf-8"))


def _find(name, *, stat=None, effect_name=None):
    return [e for e in _skills()[name]
            if (stat is None or e.get("stat") == stat)
            and (effect_name is None or e.get("name") == effect_name)]


class RosterBatch07Test(unittest.TestCase):
    def test_all_ten_are_registered(self):
        skills = _skills()
        self.assertTrue(all(name in skills for name in BATCH))
        self.assertGreaterEqual(len([n for n in skills if not n.startswith("test_")]), 156)

    def test_hidden_active_cooldowns_are_explicit(self):
        expected = {
            ("폴크방", "스타팅 휘슬"): "every:30s", ("폴크방", "페이스 다운"): "every:20s",
            ("니힐리스타", "메기도 플레임"): "every:10s", ("에테르", "부식물질 탑재탄환"): "every:15s",
            ("에테르", "예후 반응 실험"): "every:13s", ("솔져 E.G.", "이글 택틱"): "every:9s",
            ("솔져 F.A.", "팔콘 네스트"): "every:15s", ("프로덕트 08", "전술 : 정밀 사격"): "every:17s",
            ("프로덕트 12", "행동 : 화력 집중"): "every:10s", ("iDoll 플라워", "플라워 컬러"): "every:15s",
            ("iDoll 오션", "오션 클렌징"): "every:15s",
        }
        for (name, effect_name), timing in expected.items():
            self.assertEqual([timing], _find(name, effect_name=effect_name)[0]["trigger"]["timing"])

    def test_special_contracts(self):
        self.assertTrue(_find("폴크방", stat="shield_from_max_hp_pct"))
        self.assertTrue(_find("폴크방", stat="lifesteal_pct"))
        burn = _find("니힐리스타", stat="dot_damage")[0]
        self.assertEqual(1, burn["tick_interval"])
        self.assertEqual(10, burn["duration"])
        tea = _find("사쿠라", effect_name="벚꽃차")[0]
        self.assertEqual(10, tea["max_stack"])
        self.assertEqual(["hit_count:3"], tea["trigger"]["timing"])
        self.assertTrue(_find("사쿠라", stat="intercept_dmg_pct"))

    def test_all_ten_simulate_in_valid_squads(self):
        cases = [
            ("폴크방", ["리틀 머메이드", "폴크방", "test_B3"]),
            ("니힐리스타", ["리틀 머메이드", "니힐리스타", "test_B3"]),
            ("사쿠라", ["사쿠라", "크라운", "test_B3"]),
            ("에테르", ["에테르", "크라운", "test_B3"]),
            ("솔져 E.G.", ["리틀 머메이드", "크라운", "솔져 E.G."]),
            ("솔져 F.A.", ["리틀 머메이드", "솔져 F.A.", "test_B3"]),
            ("프로덕트 08", ["프로덕트 08", "크라운", "test_B3"]),
            ("프로덕트 12", ["리틀 머메이드", "크라운", "프로덕트 12"]),
            ("iDoll 플라워", ["iDoll 플라워", "크라운", "test_B3"]),
            ("iDoll 오션", ["iDoll 오션", "크라운", "test_B3"]),
        ]
        for name, members in cases:
            with self.subTest(name=name):
                squad = build_squad(members)
                result = simulate(squad, config=build_config(squad, {"first_burst_time": 1, "duration": 8}), seed=1)
                self.assertTrue(any(hit.caster == name for hit in result.hits))


if __name__ == "__main__":
    unittest.main()
