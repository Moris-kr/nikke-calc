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

    def _totals_by_seed(self, seeds, **extra):
        """같은 설정에 시드만 달리 준 결과들."""
        out = []
        for seed in seeds:
            payload = {
                "squad": ["리타", "크라운", "홍련"],
                "duration": 20,
                "enemyDef": 31_784,
                "enemyCode": "",
                "corePx": 0,
                "hasParts": False,
                "seed": seed,
                **extra,
            }
            out.append(json.loads(run_request(json.dumps(payload, ensure_ascii=False)))["squadTotal"])
        return out

    def test_expected_mode_ignores_the_seed(self):
        """기대값은 결정론적이다 — 시드를 바꿔도 한 푼도 달라지면 안 된다."""
        totals = self._totals_by_seed([42, 7, 12345], rngMode="expected")
        self.assertEqual(len(set(totals)), 1, f"기대값인데 시드마다 다르다: {totals}")

    def test_random_mode_actually_uses_the_seed(self):
        """난수 모드는 반대로 시드를 타야 한다 — 위 시험이 «둘 다 안 움직여서» 통과하는 것을 막는다."""
        totals = self._totals_by_seed([42, 7, 12345], rngMode="random")
        self.assertGreater(len(set(totals)), 1, f"난수인데 시드를 안 탄다: {totals}")

    def test_missing_rng_mode_is_the_site_default_expected(self):
        """`rngMode`가 안 오면 **화면 기본값(기대값)**으로 친다.

        이 기본값이 브리지와 화면에서 서로 달랐던 것이 실제 결함이었다 — `model.ts`가
        「기본값이니 빼도 된다」며 `expected`를 안 실었는데 브리지는 빠지면 `random`으로
        읽어, 기대값으로 두고 쓴 사람들이 내내 난수 모드로 계산하고 있었다.
        """
        totals = self._totals_by_seed([42, 7, 12345])
        self.assertEqual(len(set(totals)), 1, f"안 주면 난수로 돈다: {totals}")

    def _burst_casts(self, sequence=None):
        """버스트가 시간순으로 누가 몇 단계를 썼는지."""
        payload = {
            "squad": ["리타", "크라운", "홍련", "앨리스", "나가"],
            "duration": 60,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
            "rngMode": "expected",
            "timeline": True,
        }
        if sequence is not None:
            payload["burstSequence"] = sequence
        result = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        casts = []
        for name, entries in (result.get("timeline", {}).get("bursts") or {}).items():
            for entry in entries:
                casts.append((entry["t"], entry["stage"], name))
        casts.sort()
        return casts

    def test_burst_sequence_decides_who_bursts(self):
        """적어 둔 사이클에서는 그 사람이 그 단계를 쓴다."""
        auto = self._burst_casts()
        self.assertTrue(auto, "버스트가 하나도 안 나갔다 — 시험 전제가 깨졌다")

        # 3버는 앨리스·나가 둘 다 가능하다. 첫 사이클만 나가로 못 박는다.
        forced = self._burst_casts([{"1": ["리타"], "2": ["크라운"], "3": ["나가"]}])
        first_third = next((name for _, stage, name in forced if stage == "3"), None)
        self.assertEqual(first_third, "나가")

    def test_burst_sequence_only_binds_the_cycles_it_names(self):
        """적어 둔 사이클을 넘어가면 평소 순서로 돌아간다 — 우선순위지 절대 규칙이 아니다."""
        forced = self._burst_casts([{"1": ["리타"], "2": ["크라운"], "3": ["나가"]}])
        thirds = [name for _, stage, name in forced if stage == "3"]
        self.assertGreater(len(thirds), 1, "60초면 3버가 여러 번 나가야 한다")
        self.assertEqual(thirds[0], "나가")
        # 두 번째부터는 계산기가 알아서 고른다 — 나가로 고정돼 있지 않다.
        self.assertTrue(any(name != "나가" for name in thirds[1:]),
                        f"적어 두지 않은 사이클까지 묶였다: {thirds}")

    def test_burst_sequence_rejects_a_name_outside_the_squad(self):
        """편성에 없는 이름은 조용히 떨구지 않고 거절한다."""
        with self.assertRaisesRegex(ValueError, "편성에 없는 니케"):
            self._burst_casts([{"1": ["도로시"], "2": [], "3": []}])

    def test_empty_burst_sequence_is_the_same_as_not_giving_one(self):
        """빈 사이클만 늘어놓으면 안 준 것과 같다 — 버스트가 막히면 안 된다."""
        empty = self._burst_casts([{"1": [], "2": [], "3": []}, {"1": [], "2": [], "3": []}])
        self.assertEqual(empty, self._burst_casts())

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

    def test_synchro_level_applies_to_everyone_and_changes_the_result(self):
        """싱크로 레벨은 계정 속성이라 스쿼드 전원에게 같은 값으로 얹힌다."""
        payload = {
            "squad": ["리타", "크라운"],
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        default = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        # 기본 스펙 레벨이 400이므로 400을 명시해도 결과가 같아야 한다.
        same = json.loads(run_request(json.dumps(
            {**payload, "synchroLevel": 400}, ensure_ascii=False)))
        lower = json.loads(run_request(json.dumps(
            {**payload, "synchroLevel": 200}, ensure_ascii=False)))

        self.assertEqual(same["squadTotal"], default["squadTotal"])
        self.assertLess(lower["squadTotal"], default["squadTotal"])
        # 한 명만이 아니라 전원이 낮아진다.
        for name in ("리타", "크라운"):
            self.assertLess(lower["charTotals"][name], default["charTotals"][name])

    def test_endgame_burst_waits_for_the_last_seconds(self):
        """막바지 최우선 — 남은 시간이 N초 미만일 때 그 캐릭터가 먼저 나간다."""
        base = {
            "squad": ["리타", "크라운", "라피 : 레드 후드", "앨리스", "나가"],
            "duration": 60,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }
        auto = json.loads(run_request(json.dumps(base, ensure_ascii=False)))
        endgame = json.loads(run_request(json.dumps({
            **base,
            # 나가와 크라운이 같은 2단계 후보다 — 순서가 갈릴 자리가 있어야
            # 이 설정이 뜻을 갖는다.
            "characters": {"나가": {"burst": {"mode": "endgame", "seconds": 20}}},
        }, ensure_ascii=False)))

        # 순서가 실제로 달라져야 한다 — 안 달라지면 설정이 흘러가 버린 것이다.
        self.assertNotEqual(endgame["squadTotal"], auto["squadTotal"])

    def test_burst_reaction_delays_every_burst(self):
        """반응속도는 버스트 하나하나마다 더해진다 — 느리게 잡으면 결과가 달라진다."""
        base = {
            "squad": ["리타", "크라운", "라피 : 레드 후드", "앨리스", "나가"],
            "duration": 60,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }
        default = json.loads(run_request(json.dumps(base, ensure_ascii=False)))
        same = json.loads(run_request(json.dumps(
            {**base, "burstReaction": 0.05}, ensure_ascii=False)))
        slow = json.loads(run_request(json.dumps(
            {**base, "burstReaction": 0.5}, ensure_ascii=False)))
        instant = json.loads(run_request(json.dumps(
            {**base, "burstReaction": 0}, ensure_ascii=False)))

        # 기본값은 0.05초다 — 명시해도 결과가 같아야 한다.
        self.assertEqual(same["squadTotal"], default["squadTotal"])
        # 늦게 누를수록 버스트가 밀려 총딜이 준다.
        self.assertLess(slow["squadTotal"], default["squadTotal"])
        self.assertGreater(instant["squadTotal"], slow["squadTotal"])

    def test_skip_means_never_bursting_at_all(self):
        """「안 씀」은 뒤로 미는 게 아니라 후보에서 빼는 것이다."""
        base = {
            "squad": ["리타", "크라운", "라피 : 레드 후드", "앨리스", "나가"],
            "duration": 90,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }
        auto = json.loads(run_request(json.dumps(base, ensure_ascii=False)))
        # 크라운과 나가가 같은 2단계 후보다 — 크라운을 빼도 나가가 그 단계를 맡는다.
        skipped = json.loads(run_request(json.dumps({
            **base, "characters": {"크라운": {"burst": {"mode": "skip"}}},
        }, ensure_ascii=False)))

        self.assertNotEqual(skipped["squadTotal"], auto["squadTotal"])
        # 버스트를 아예 안 썼으므로 크라운의 버스트 시각이 하나도 없어야 한다.
        self.assertTrue(auto["timeline"]["bursts"]["크라운"])
        self.assertEqual(skipped["timeline"]["bursts"]["크라운"], [])
        # 그래도 전투는 돌아간다 — 다른 캐릭터는 계속 버스트를 쓴다.
        self.assertTrue(skipped["timeline"]["bursts"]["나가"])

    def test_no_cube_drops_both_its_stats_and_its_effect(self):
        """「없음」은 큐브를 안 낀 상태다 — 스탯도, 우월 코드 효과도 붙지 않는다."""
        base = {
            "squad": ["리타"],
            "duration": 20,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }
        withCube = json.loads(run_request(json.dumps(base, ensure_ascii=False)))
        without = json.loads(run_request(json.dumps({
            **base, "characters": {"리타": {"cube": {"name": "없음", "level": 0}}},
        }, ensure_ascii=False)))

        self.assertLess(without["squadTotal"], withCube["squadTotal"])

    def test_rejects_an_unknown_cube_name(self):
        payload = {
            "squad": ["리타"],
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
            "characters": {"리타": {"cube": {"name": "없는큐브", "level": 5}}},
        }

        with self.assertRaisesRegex(ValueError, "큐브는"):
            run_request(json.dumps(payload, ensure_ascii=False))

    def test_overload_zero_is_its_own_equipment_state(self):
        """오버로드 0강은 미장착도 T9도 아니다 — 셋이 서로 다른 값을 내야 한다."""
        base = {
            "squad": ["리타"],
            "duration": 20,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        def run(level):
            payload = {**base, "characters": {"리타": {"equipLevels": {
                "머리": level, "몸통": level, "팔": level, "다리": level,
            }}}}
            return json.loads(run_request(json.dumps(payload, ensure_ascii=False)))["squadTotal"]

        none_, tier9, over0, over1 = run("없음"), run("T9"), run(0), run(1)
        # 0은 흔히 falsy로 걸러진다 — 걸러지면 미장착이나 기본값과 같아져 조용히 틀린다.
        self.assertLess(none_, tier9)
        self.assertLess(tier9, over0)
        self.assertLess(over0, over1)

    def test_rejects_a_bad_burst_reaction(self):
        payload = {
            "squad": ["리타"],
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
            "burstReaction": 9,
        }

        with self.assertRaisesRegex(ValueError, "버스트 반응속도"):
            run_request(json.dumps(payload, ensure_ascii=False))

    def test_rejects_a_bad_endgame_burst_window(self):
        payload = {
            "squad": ["리타"],
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
            "characters": {"리타": {"burst": {"mode": "endgame", "seconds": 0}}},
        }

        with self.assertRaisesRegex(ValueError, "막바지 최우선"):
            run_request(json.dumps(payload, ensure_ascii=False))

    def test_rejects_synchro_level_outside_the_ingame_cap(self):
        """상한은 표가 아니라 인게임 레벨 상한(1400)이다.

        표는 1000까지지만 그 위는 엔진이 이어 붙인다 — 유니온 레이드에서 싱크로 1131인
        유니온원을 실제로 만나고, 1000으로 눌러 버리면 그 사람 공격력이 15% 넘게 깎인다.
        """
        def payload(level):
            return {
                "squad": ["리타"],
                "duration": 10,
                "enemyDef": 31_784,
                "enemyCode": "",
                "corePx": 0,
                "hasParts": False,
                "seed": 42,
                "synchroLevel": level,
            }

        # 표 밖이어도 인게임 상한 안이면 계산한다.
        run_request(json.dumps(payload(1_131), ensure_ascii=False))

        with self.assertRaisesRegex(ValueError, "싱크로 레벨"):
            run_request(json.dumps(payload(1_401), ensure_ascii=False))

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
            # 버킷 합은 전 구간 대미지와 일치해야 한다 — 잘게 쪼개도 히트가 새지 않는다
            # (부동소수 나눗셈이 앞 칸으로 흘리기 쉬운 자리다).
            self.assertEqual(sum(row), result["charTotals"][name])
        # 전투 마지막 순간(t가 duration에 붙은 값)의 히트도 마지막 칸에 들어간다 —
        # 잘게 쪼갤수록 이 경계에서 새기 쉬운데, 새면 위 합계가 곧바로 어긋난다.
        self.assertGreater(sum(timeline["damage"][name][-1] for name in payload["squad"]), 0)
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

        # 순서는 발동 시각순으로 담기고, `targets`는 그 순서에서 중복만 지운 것이다.
        for row in (miranda, rebellio):
            self.assertEqual(len(row["sequence"]), row["count"])
            self.assertEqual(
                list(dict.fromkeys(step["target"] for step in row["sequence"])),
                row["targets"],
            )
            times = [step["t"] for step in row["sequence"]]
            self.assertEqual(times, sorted(times))

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

    def test_fine_timeline_splits_the_same_damage_into_smaller_slots(self):
        """정밀 분석 표는 «더 정확한» 값이 아니라 «더 잘게 나눈» 값이다.

        엔진은 히트마다 정수로 정확히 센다 — 칸을 잘게 해도 총합은 한 자리도
        달라지지 않아야 한다. 달라진다면 칸 나누기에서 히트를 흘린 것이다.
        """
        payload = {
            "squad": ["리타", "크라운"], "duration": 20, "enemyDef": 31_784,
            "enemyCode": "", "corePx": 0, "hasParts": False, "seed": 42,
            "rngMode": "expected", "fineTimeline": True,
        }
        got = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        coarse, fine = got["timeline"], got["fineTimeline"]
        self.assertEqual(coarse["bucket"], 1)
        self.assertEqual(fine["bucket"], 0.1)
        self.assertEqual(fine["buckets"], coarse["buckets"] * 10)
        for name in ("리타", "크라운"):
            self.assertEqual(sum(fine["damage"][name]), sum(coarse["damage"][name]))
            self.assertEqual(sum(fine["damage"][name]), int(got["charTotals"][name]))

    def test_fine_timeline_is_left_out_unless_asked(self):
        # 늘 실어 보내면 저장되는 결과가 열 배로 무거워진다 — 내보낼 때만 만든다.
        payload = {
            "squad": ["리타"], "duration": 10, "enemyDef": 31_784, "enemyCode": "",
            "corePx": 0, "hasParts": False, "seed": 42,
        }
        got = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        self.assertNotIn("fineTimeline", got)

    def test_buff_span_carries_who_actually_got_it_when_the_target_shifts(self):
        """대상이 발동마다 갈리는 버프는 **구간마다** 누가 받았는지 적는다.

        리버렐리오 `차분한 수심 4`는 공격력 순위로 대상이 갈려 발동마다 사람이
        바뀐다. 줄 하나에 뭉쳐 두면 «둘 다 받는다»로 읽힌다.
        """
        payload = {
            "squad": ["리틀 머메이드", "나유타", "에이다", "아인", "리버렐리오"],
            "duration": 60, "enemyDef": 31_784, "enemyCode": "", "corePx": 0,
            "hasParts": False, "seed": 42, "rngMode": "expected",
        }
        got = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        tracks = got["timeline"]["buffs"]
        shifting = next(t for t in tracks if t["name"] == "차분한 수심 4")
        self.assertEqual(sorted(shifting["targets"]), ["아인", "에이다"])

        # 구간마다 대상이 하나씩 붙고, 이웃한 두 구간은 서로 다른 사람이다.
        picked = [
            [shifting["targets"][i] for i in span[3]]
            for span in shifting["spans"] if len(span) > 3
        ]
        self.assertEqual(len(picked), len(shifting["spans"]))
        self.assertTrue(all(len(who) == 1 for who in picked), picked)
        self.assertNotEqual(picked[0], picked[1])

        # 대상이 늘 같은 줄에는 구간에 붙이지 않는다 — 그쪽까지 실으면 결과가 무거워진다.
        steady = [t for t in tracks if all(len(s) == 3 for s in t["spans"])]
        self.assertTrue(steady, "대상이 고정인 줄이 하나도 없다")

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
