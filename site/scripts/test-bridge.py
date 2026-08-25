import json
import sys
import unittest
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SITE_DIR.parent
sys.path.insert(0, str(SITE_DIR))
sys.path.insert(0, str(REPO_ROOT))

from pybridge.bridge import run_request
from context.spec import is_preview
from context.spec import _nikke as parsed_nikke


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
        # 프리뷰(출시 전 카드) 캐릭터 명단은 출시될 때마다 비므로 이름을 박지 않는다.
        # 비어 있으면 위조를 시도할 대상 자체가 없는 정상 상태다.
        previews = [name for name in parsed_nikke() if is_preview(name)]
        if not previews:
            self.skipTest("등록된 프리뷰 캐릭터가 없다 (전원 정식 출시)")
        preview = previews[0]

        payload = {
            "squad": [preview],
            "characters": {
                preview: {
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
                    "cube": {"name": "렐릭 디스트로이 큐브", "level": 1},
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

    def test_custom_character_injection_simulates_like_the_real_one(self):
        import json as _json
        from pathlib import Path as _Path
        data = _Path(__file__).resolve().parent.parent.parent / "data"
        nikke = _json.loads((data / "parsed_nikke.json").read_text(encoding="utf-8"))
        skills = _json.loads((data / "parsed_skills.json").read_text(encoding="utf-8"))
        # 크라운은 char_defaults 레이어가 없어, 복제 커스텀과 실제가 정확히 같아야 한다.
        custom = {"커스텀크라운": {"nikke": nikke["크라운"], "skills": skills["크라운"]}}
        base = {
            "duration": 40, "enemyDef": 31_784, "enemyCode": "",
            "corePx": 0, "hasParts": False, "seed": 42,
        }
        custom_run = json.loads(run_request(json.dumps({
            **base,
            "squad": ["커스텀크라운", "목단", "라피 : 레드 후드", "앨리스", "나가"],
            "customCharacters": custom,
        }, ensure_ascii=False)))
        real_run = json.loads(run_request(json.dumps({
            **base,
            "squad": ["크라운", "목단", "라피 : 레드 후드", "앨리스", "나가"],
        }, ensure_ascii=False)))

        self.assertGreater(custom_run["charTotals"]["커스텀크라운"], 0)
        self.assertEqual(
            custom_run["charTotals"]["커스텀크라운"],
            real_run["charTotals"]["크라운"],
        )

    def test_custom_character_missing_stats_is_rejected(self):
        payload = {
            "squad": ["엉터리"],
            "customCharacters": {"엉터리": {"nikke": {"class": "화력형"}, "skills": []}},
            "duration": 10, "enemyDef": 31_784, "enemyCode": "",
            "corePx": 0, "hasParts": False, "seed": 42,
        }
        with self.assertRaisesRegex(ValueError, "누락된 스탯"):
            run_request(json.dumps(payload, ensure_ascii=False))

    def test_buff_targets_report_who_actually_received_the_buff(self):
        """「누가 이 버프를 받았나」는 추정이 아니라 실제 발동 로그에서 온다.

        대상이 공격력 순위로 갈려 편성만 보고는 알 수 없고, 미란다는 애장품
        2단계 이상이어야 발동한다 — 조건이 안 맞으면 빈 목록이어야 한다.
        """
        squad = ["아니스 : 스타", "나유타", "미란다", "리버렐리오", "홍련 : 흑영"]

        def run(favorite: int) -> dict:
            payload = {
                "squad": squad,
                "characters": {"미란다": {"collection": {"stage": "SR15",
                                                       "favorite": favorite}}},
                "duration": 60, "enemyDef": 31784, "enemyCode": "",
                "corePx": 52, "hasParts": False, "seed": 42,
            }
            return json.loads(run_request(json.dumps(payload,
                                                     ensure_ascii=False)))["buffTargets"]

        got = run(3)
        miranda = got["미란다"][0]
        self.assertEqual(miranda["label"], "크확 대상")
        self.assertGreater(miranda["count"], 0)
        # 자신 제외 공격력 1위에게 간다 — 스쿼드 안의 다른 캐릭터여야 한다.
        self.assertTrue(miranda["targets"])
        self.assertNotIn("미란다", miranda["targets"])
        for name in miranda["targets"]:
            self.assertIn(name, squad)

        rebellio = got["리버렐리오"][0]
        self.assertEqual(rebellio["label"], "차분한 수심 대상")
        self.assertTrue(rebellio["targets"])
        for name in rebellio["targets"]:
            self.assertIn(name, squad)

        # 애장품 1단계는 발동 조건(2단계)에 못 미친다 → 빈 목록.
        self.assertEqual(run(1)["미란다"][0]["targets"], [])
        self.assertEqual(run(1)["미란다"][0]["count"], 0)

    def test_buff_targets_left_out_for_squads_without_watched_casters(self):
        """감시 대상이 없는 편성이면 아무 것도 담기지 않는다."""
        payload = {
            "squad": ["라피", "앨리스"], "duration": 20, "enemyDef": 31784,
            "enemyCode": "", "corePx": 0, "hasParts": False, "seed": 42,
        }
        got = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        self.assertEqual(got["buffTargets"], {})

    def test_rejects_character_settings_outside_the_squad(self):
        payload = {
            "squad": ["리타"],
            "characters": {"라피": {"cube": {"name": "렐릭 베어 큐브", "level": 15}}},
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
