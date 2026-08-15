import json
import sys
import unittest
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SITE_DIR.parent
sys.path.insert(0, str(SITE_DIR))
sys.path.insert(0, str(REPO_ROOT))

from pybridge.bridge import run_request


class BrowserBridgeTest(unittest.TestCase):
    def test_growth_stage_changes_the_engine_result(self):
        payload = {
            "squad": ["리타"],
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }
        card = json.loads(run_request(json.dumps({
            **payload,
            "characters": {"리타": {"growthStage": 0}},
        }, ensure_ascii=False)))
        core_seven = json.loads(run_request(json.dumps({
            **payload,
            "characters": {"리타": {"growthStage": 10}},
        }, ensure_ascii=False)))

        self.assertGreater(core_seven["squadTotal"], card["squadTotal"])

    def test_rejects_forged_growth_stage_for_character_rarity(self):
        payload = {
            "squad": ["라피"],
            "characters": {"라피": {"growthStage": 3}},
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        with self.assertRaisesRegex(ValueError, "라피: 돌파 단계는 0~2"):
            run_request(json.dumps(payload, ensure_ascii=False))

    def test_rejects_null_growth_stage_in_forged_json(self):
        payload = {
            "squad": ["리타"],
            "characters": {"리타": {"growthStage": None}},
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        with self.assertRaisesRegex(ValueError, "돌파 단계는 정수"):
            run_request(json.dumps(payload, ensure_ascii=False))

    def test_released_skill_levels_change_the_engine_result(self):
        payload = {
            "squad": ["라피 : 레드 후드"],
            "characters": {
                "라피 : 레드 후드": {
                    "skillLevels": {"1": 10, "2": 1, "3": 10},
                },
            },
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }
        level_ten = json.loads(run_request(json.dumps({
            **payload,
            "characters": {
                "라피 : 레드 후드": {
                    "skillLevels": {"1": 10, "2": 10, "3": 10},
                },
            },
        }, ensure_ascii=False)))
        level_one = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))

        self.assertGreater(level_ten["squadTotal"], level_one["squadTotal"])

    def test_preview_skill_levels_cannot_be_forged_below_ten(self):
        payload = {
            "squad": ["아마기 유키코"],
            "characters": {
                "아마기 유키코": {
                    "skillLevels": {"1": 9, "2": 10, "3": 10},
                },
            },
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        with self.assertRaisesRegex(ValueError, "프리뷰 캐릭터는 스킬 레벨 10"):
            run_request(json.dumps(payload, ensure_ascii=False))

    def test_seeded_request_returns_compact_positive_result(self):
        payload = {
            "squad": ["리타"],
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        result = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))

        self.assertEqual(result["duration"], 10)
        self.assertGreater(result["squadTotal"], 0)
        self.assertGreater(result["hitCount"], 0)
        self.assertEqual(list(result["charTotals"]), ["리타"])

    def test_character_overrides_are_forwarded_to_the_engine(self):
        payload = {
            "squad": ["리타"],
            "characters": {
                "리타": {
                    "overload": {"atk_pct": 100},
                    "cube": {"name": "파츠", "level": 1},
                    "manualStats": {"normal_atk_dmg_pct": 20},
                },
            },
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": True,
            "seed": 42,
        }
        base = dict(payload)
        base.pop("characters")

        customized = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        baseline = json.loads(run_request(json.dumps(base, ensure_ascii=False)))

        self.assertGreater(customized["squadTotal"], baseline["squadTotal"])

    def test_timeline_is_bucketed_and_matches_char_totals(self):
        payload = {
            "squad": [
                "목단",
                "에이드 : 에이전트 바니",
                "아니스 : 스파클링 서머",
                "메이든 : 아이스 로즈",
                "프리바티",
            ],
            "duration": 30,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        result = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        timeline = result["timeline"]

        self.assertEqual(timeline["bucket"], 1)
        self.assertEqual(timeline["buckets"], 30)
        for name in payload["squad"]:
            row = timeline["damage"][name]
            self.assertEqual(len(row), 30)
            # 버킷 합은 전 구간 대미지와 일치해야 한다 (전투 30초 = 버킷 30개).
            self.assertEqual(sum(row), result["charTotals"][name])
        # 풀버스트 구간과 버스트 사용 시점이 로그에서 채워진다.
        self.assertTrue(timeline["fullBurst"])
        self.assertTrue(any(timeline["bursts"][name] for name in payload["squad"]))

    def test_burst_assignment_shifts_which_member_bursts(self):
        base = {
            "squad": ["라피 : 레드 후드", "앨리스", "목단", "크라운", "마스트 : 로망틱 메이드"],
            "duration": 90,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        def mast_bursts(payload):
            result = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
            return len(result["timeline"]["bursts"]["마스트 : 로망틱 메이드"])

        every1 = mast_bursts({**base, "characters": {
            "마스트 : 로망틱 메이드": {"burst": {"mode": "priority", "every": 1}},
        }})
        every3 = mast_bursts({**base, "characters": {
            "마스트 : 로망틱 메이드": {"burst": {"mode": "priority", "every": 3}},
        }})
        skip = mast_bursts({**base, "characters": {
            "마스트 : 로망틱 메이드": {"burst": {"mode": "skip"}},
        }})

        # 매 사이클 우선(every=1)은 3의 배수 우선보다 많거나 같고, skip은 0이 된다.
        self.assertGreaterEqual(every1, every3)
        self.assertGreater(every1, skip)
        self.assertEqual(skip, 0)

    def test_rejects_character_settings_outside_the_squad(self):
        payload = {
            "squad": ["리타"],
            "characters": {"라피": {"cube": {"name": "재장", "level": 15}}},
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        with self.assertRaisesRegex(ValueError, "스쿼드에 없는 캐릭터"):
            run_request(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()
