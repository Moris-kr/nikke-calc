import json
import unittest
from pathlib import Path

from calculator.timeline import simulate
from context.spec import build_config, build_squad


ROOT = Path(__file__).resolve().parents[1]
BATCH = ["솔져 O.W.", "프로덕트 23", "iDoll 썬", "코코아", "소다",
         "마르차나", "차임", "마스트", "앵커", "킬로"]


def _skills():
    return json.loads((ROOT / "data" / "parsed_skills.json").read_text(encoding="utf-8"))


def _find(name, *, stat=None, effect_name=None):
    return [e for e in _skills()[name]
            if (stat is None or e.get("stat") == stat)
            and (effect_name is None or e.get("name") == effect_name)]


class RosterBatch08Test(unittest.TestCase):
    def test_all_ten_are_registered(self):
        skills = _skills()
        self.assertTrue(all(name in skills for name in BATCH))
        self.assertGreaterEqual(len([n for n in skills if not n.startswith("test_")]), 166)

    def test_hidden_active_cooldowns_are_explicit(self):
        expected = {
            ("솔져 O.W.", "오울 윈드"): "every:10s",
            ("프로덕트 23", "명령 : 응급 조치"): "every:15s",
            ("코코아", "프로 종이접기"): "every:15s",
            ("소다", "바닥 청소 메이드"): "every:12s",
        }
        for (name, effect_name), timing in expected.items():
            self.assertEqual([timing], _find(name, effect_name=effect_name)[0]["trigger"]["timing"])

    def test_chime_buffs_crown_only(self):
        for effect_name in ("일등 신하", "왕의 비서", "왕을 위해 3"):
            self.assertEqual("크라운", _find("차임", effect_name=effect_name)[0]["target"])

    def test_mast_and_kilo_special_contracts(self):
        sea = _find("마스트", effect_name="해풍")[0]
        self.assertEqual(50, sea["max_stack"])
        storm = _find("마스트", effect_name="비바람을 뚫고! 3")[0]
        self.assertEqual("stack_count", storm["scaling"])
        self.assertEqual("해풍", storm["scaling_ref"])
        kilo = _find("킬로", effect_name="우선 순위 지정")[0]
        self.assertEqual("max_hp_conversion", kilo["scaling"])
        self.assertEqual(5, kilo["scaling_hp_pct"])
        self.assertEqual(["self_state:나노 코팅"], kilo["trigger"]["condition"])
        stages = _find("킬로", stat="next_shield_hp_pct")
        self.assertEqual(3, len(stages))
        self.assertTrue(all(e.get("consume_next_shield") for e in stages))
        self.assertEqual(
            [f"conditional_burst_cast_count:킬로_보호막없음:{n}" for n in (1, 2, 3)],
            [e["trigger"]["timing"][0] for e in stages],
        )

    def test_all_ten_simulate_in_valid_squads(self):
        cases = [
            ("솔져 O.W.", ["솔져 O.W.", "크라운", "test_B3"]),
            ("프로덕트 23", ["리틀 머메이드", "프로덕트 23", "test_B3"]),
            ("iDoll 썬", ["리틀 머메이드", "크라운", "iDoll 썬"]),
            ("코코아", ["코코아", "크라운", "test_B3"]),
            ("소다", ["소다", "크라운", "test_B3"]),
            ("마르차나", ["리틀 머메이드", "마르차나", "test_B3"]),
            ("차임", ["리틀 머메이드", "차임", "test_B3", "크라운"]),
            ("마스트", ["리틀 머메이드", "마스트", "test_B3"]),
            ("앵커", ["앵커", "크라운", "test_B3"]),
            ("킬로", ["리틀 머메이드", "크라운", "킬로"]),
        ]
        for name, members in cases:
            with self.subTest(name=name):
                squad = build_squad(members)
                result = simulate(squad, config=build_config(squad, {"first_burst_time": 1, "duration": 8}), seed=1)
                self.assertTrue(any(hit.caster == name for hit in result.hits))


if __name__ == "__main__":
    unittest.main()
