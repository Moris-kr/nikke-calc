"""버스트 게이지 실누적(`burst_gauge_mode = "accumulate"`) — 원본 저장소 이식(2026-09-22).

정본: 원본 저장소 docs/mechanics/버스트 게이지.md. 규칙:
- 게이지는 스쿼드 공용 1개. 히트당 `burst_energy`(대상 기준, CDN /10000)를 쌓아 100%에
  1단계 진입하며 그때 0으로 소모된다. 초과분은 버려진다.
- 풀버스트가 끝나기 전(1단계 진입 ~ 풀버스트 종료)에는 안 찬다.
- 차지 무기의 풀차지 샷은 **카메라가 그 니케를 보고 있을 때만** `full_charge_mult`가 붙는다.
- 스킬 대미지 히트도 같은 히트당 값으로 채운다(풀차지 배율 없음).
- `burst_charge_pct`(즉시 N%)는 값 그대로 1회, `burst_charge_speed_pct`는 시전자 기준
  히트당 가산(발당→명중 뒤 대상 기준).
- 엔진 기본은 종전 "fixed"라 골든이 안 움직인다.
"""
import unittest

from calculator.buff_manager import BuffManager
from calculator.timeline import simulate
from context.spec import build_config, build_squad


def _run(names, mode="accumulate", chars=None, config=None, duration=60, enemy=None):
    squad = build_squad(names, chars=chars, no_layer=set(names))
    cfg = build_config(squad, {"duration": duration, "rng_mode": "expected",
                               "burst_gauge_mode": mode, **(config or {})})
    return simulate(squad, config=cfg, enemy={"code": "", "core_px": 0, **(enemy or {})}, verbose=True)


def _first_fb(result):
    return next((e.t for e in result.log.burst_log if e.event == "full_burst 시작"), None)


def _shots_before(result, name, t_end):
    return sum(1 for h in result.hits if h.caster == name and h.skill_name == "기본 공격" and h.t < t_end)


class AccumulateModeTest(unittest.TestCase):
    def test_gauge_fills_consumes_and_logs(self):
        res = _run(["크라운", "루주", "치사토"])
        log = res.log.gauge_log
        self.assertTrue(log, "게이지 로그가 비었다")
        self.assertTrue(all(0.0 <= e.gauge <= 100.0 + 1e-9 for e in log))
        # 만충 → 1단계 진입(소모) 줄이 버스트 로그에 남고, 그 뒤 게이지는 0에서 다시 오른다.
        fills = [e for e in res.log.burst_log if e.event.startswith("게이지 만충")]
        self.assertGreaterEqual(len(fills), 2)
        after = next(e for e in log if e.t > fills[0].t + 10.0)   # 풀버스트 10초가 끝난 뒤
        self.assertLess(after.gauge, 50.0)
        # 카메라 초점 로그 — 버충 담당·컨트롤이 없으면 자리가 아니라 풀차지 한 발 게이지가 가장 큰
        # 차지 무기 니케(여기서는 유일한 차지 무기인 루주)를 본다(2026-09-23, 자리와 무관한 결과).
        cam = next(e for e in res.log.burst_log if e.event.startswith("카메라 초점"))
        self.assertIn("루주", cam.event)

    def test_not_charging_between_stage1_and_full_burst_end(self):
        res = _run(["크라운", "루주", "치사토"])
        fb_start = _first_fb(res)
        fill = next(e.t for e in res.log.burst_log if e.event.startswith("게이지 만충"))
        # 1단계 진입 ~ 풀버스트 종료 사이에는 가산이 하나도 없다.
        blocked = [e for e in res.log.gauge_log if fill < e.t < fb_start + 10.0 - 1e-6]
        self.assertEqual(blocked, [])

    def test_fixed_default_ignores_gauge(self):
        fixed = _run(["크라운", "루주", "치사토"], mode="fixed", config={"first_burst_time": 3.0})
        # 고정 모드는 게이지와 무관하게 first_burst_time에 1단계다 — 로그는 남되 판정엔 안 쓴다.
        self.assertTrue(fixed.log.gauge_log)
        self.assertFalse([e for e in fixed.log.burst_log if e.event.startswith("게이지 만충")])
        self.assertAlmostEqual(_first_fb(fixed), 3.0 + 0.05 * 3 + 0.1 * 2 + 0.05, delta=0.2)

    def test_bad_mode_rejected(self):
        with self.assertRaises(ValueError):
            _run(["크라운"], mode="nope")


class CameraFullChargeTest(unittest.TestCase):
    """루주 1인 실측: 카메라 有 7발 / 無 18발에 만충 (5.8 × 2.5 = 14.5 vs 5.8)."""

    def test_camera_multiplies_full_charge_gauge(self):
        with_cam = _run(["루주"], config={"camera": "루주"})
        no_cam = _run(["루주"], config={"camera": ""})
        # 1인 스쿼드는 2·3단계가 없어 풀버스트까지는 못 간다 — 만충 시각으로 잰다.
        full = lambda r: next(e.t for e in r.log.gauge_log if e.gauge >= 100.0 - 1e-9)
        t_with, t_no = full(with_cam), full(no_cam)
        self.assertEqual(_shots_before(with_cam, "루주", t_with + 1e-9), 7)
        self.assertEqual(_shots_before(no_cam, "루주", t_no + 1e-9), 18)
        srcs = {e.source for e in with_cam.log.gauge_log}
        self.assertIn("weapon:full_charge", srcs)

    def test_burst_charge_carrier_owns_camera(self):
        # 버충 톡톡이 담당이 있으면 카메라는 무조건 그 사람. 두 명이면 실패한다.
        tap = {"tap_fire": {"rate": 3.6, "release": 0.03, "policy": "burst_charge"}}
        res = _run(["크라운", "루주", "앨리스"], chars={"앨리스": {"control": tap}})
        cam = next(e for e in res.log.burst_log if e.event.startswith("카메라 초점"))
        self.assertIn("앨리스", cam.event)
        with self.assertRaises(ValueError):
            _run(["루주", "앨리스"], chars={"루주": {"control": tap}, "앨리스": {"control": tap}})


class SkillGaugeTest(unittest.TestCase):
    def test_burst_charge_pct_adds_once_per_trigger(self):
        # 헬름 `진두지휘 3`: 풀차지 명중마다 14.31%를 **1회** (all_allies여도 공용 게이지 1개).
        res = _run(["헬름", "크라운", "치사토"])
        adds = [e for e in res.log.gauge_log if e.source == "charge_pct:진두지휘 3"]
        self.assertTrue(adds)
        self.assertTrue(any(abs(e.amount - 14.31) < 1e-6 for e in adds))
        # 같은 시각에 두 번 들어가지 않는다.
        ts = [e.t for e in adds]
        self.assertEqual(len(ts), len(set(ts)))

    def test_charge_speed_is_flat_per_hit_from_caster_reference(self):
        # 수동 스탯으로 크라운에게 버충속 +50% — 크라운(MG, 0.1)의 히트마다 0.05가 더 붙는다.
        res = _run(["크라운", "루주", "치사토"], chars={"크라운": {"manual_stats": {"burst_charge_speed_pct": 50.0}}})
        crown = [e for e in res.log.gauge_log if e.caster == "크라운" and e.source == "weapon"]
        plain = _run(["크라운", "루주", "치사토"])
        crown0 = [e for e in plain.log.gauge_log if e.caster == "크라운" and e.source == "weapon"]
        self.assertTrue(crown and crown0)
        self.assertAlmostEqual(crown[0].amount / crown0[0].amount, 1.5, places=6)

    def test_skill_damage_hits_charge_gauge_without_full_charge_mult(self):
        # 앨리스 `원더랜드 바니`류 대신 헬름 스킬 대미지가 없으니 라피 : 레드 후드 예외표를 본다.
        res = _run(["라피 : 레드 후드", "크라운", "치사토"])
        skill = [e for e in res.log.gauge_log if e.caster == "라피 : 레드 후드" and e.source.startswith("skill:부착형 유탄 4")]
        self.assertTrue(skill, "부착형 유탄 4 게이지가 없다")
        # 예외표: 히트당 1.9
        self.assertTrue(all(abs(e.amount - 1.9 * round(e.amount / 1.9)) < 1e-6 for e in skill if e.gauge < 100 - 1e-9))


class FirstCyclePredictionTest(unittest.TestCase):
    """B — 첫 사이클에도 `next_fb_start_pred`가 있다(쿨타임 사슬). 장전컨 `into_fb`가 첫 사이클부터 건다."""

    def test_into_fb_reload_fires_in_first_cycle(self):
        ctrl = {"reload": {"policy": "into_fb", "margin": 0.43}}
        res = _run(["리타", "그레이브", "레이", "앨리스", "모더니아"], mode="fixed",
                   chars={"앨리스": {"control": ctrl}}, config={"first_burst_time": 3.0}, duration=60)
        fbs = [e.t for e in res.log.burst_log if e.event == "full_burst 시작"]
        self.assertGreaterEqual(len(fbs), 2)
        reloads = [e for e in res.log.reload_log if e.caster == "앨리스" and "장전컨" in e.event]
        # 두 번째 풀버스트 **전에** 걸린 장전컨이 있다 — 종전에는 관측치가 없어 세 번째부터였다.
        self.assertTrue(any(fbs[0] < e.t < fbs[1] for e in reloads), [(e.t, e.event) for e in reloads][:5])


class CondFinitePassiveTest(unittest.TestCase):
    def test_chisato_finite_passive_reactivates_each_time_condition_holds(self):
        res = _run(["치사토", "목단", "타키나"], mode="fixed", duration=90)
        acts = [e for e in res.log.buff_events if e.name == "사격 간파" and e.kind == "activate"]
        self.assertGreater(len(acts), 1)
        # 조건(게이지 100)이 깨진 뒤에는 2초 안에 만료한다.
        self.assertTrue(all(e.expires_at - e.t <= 2.0 + 1e-6 for e in acts))


def _bm(names, state_extra=None):
    squad = build_squad(names, no_layer=set(names))
    state = {"enemy": {}, "hp": {c["name"]: 1000.0 for c in squad},
             "hp_pct": {c["name"]: 100.0 for c in squad},
             "base_stats": {c["name"]: {"hp": 1000.0, "atk": 100.0, "def": 10.0} for c in squad},
             "burst_gauge": 0.0, "burst_gauge_charging": True, "normal_attack_landed": set(),
             **(state_extra or {})}
    bm = BuffManager(squad, state)
    return bm


class BuffManagerUnitTest(unittest.TestCase):
    def test_on_attack_count_counts_shots(self):
        bm = _bm(["크라운", "루주"])
        eff = {"type": "buff", "name": "발사 카운터", "trigger": {"timing": ["on_attack_count:3"], "condition": []},
               "target": "self", "stat": "atk_pct", "polarity": "beneficial", "fixed_value": 10.0, "duration": 5}
        bm._effects.append((eff, "크라운"))
        bm._build_notify_index()
        for i in range(1, 7):
            bm.notify("on_attack", 0.1 * i, "크라운")
        acts = [ab for ab in bm._active if ab.effect is eff]
        self.assertEqual(len(acts), 1)   # 3발·6발 — 같은 버프는 갱신된다
        self.assertEqual(bm._event_counts["크라운"]["on_attack"], 6)

    def test_optimal_range_condition_reads_enemy_weapons(self):
        bm = _bm(["크라운", "루주"], {"enemy": {"optimal_range_weapons": ["SR"]}})
        eff = {"trigger": {"timing": ["passive"], "condition": ["optimal_range"]}}
        self.assertTrue(bm._condition_ok(["optimal_range"], "루주", 0.0, eff))
        self.assertFalse(bm._condition_ok(["optimal_range"], "크라운", 0.0, eff))
        bm.state["enemy"]["optimal_range_weapons"] = []
        self.assertFalse(bm._condition_ok(["optimal_range"], "루주", 0.0, eff))

    def test_add_burst_gauge_caps_and_respects_window(self):
        bm = _bm(["크라운"])
        self.assertAlmostEqual(bm.add_burst_gauge(60.0, 0.0, "크라운", "weapon"), 60.0)
        self.assertAlmostEqual(bm.add_burst_gauge(60.0, 0.1, "크라운", "weapon"), 40.0)   # 초과분 폐기
        self.assertAlmostEqual(bm.state["burst_gauge"], 100.0)
        bm.state["burst_gauge"] = 0.0
        bm.state["burst_gauge_charging"] = False
        self.assertEqual(bm.add_burst_gauge(10.0, 0.2, "크라운", "weapon"), 0.0)

    def test_charge_speed_reference_switches_after_first_landing(self):
        bm = _bm(["크라운"])
        eff = {"type": "buff", "name": "버충", "trigger": {"timing": ["passive"], "condition": []},
               "target": "self", "stat": "burst_charge_speed_pct", "polarity": "beneficial",
               "fixed_value": 100.0, "duration": -1}
        bm._effects.append((eff, "크라운"))
        bm._build_notify_index()
        bm.battle_start()
        # 명중 전: 발당(0.05) 기준 → 0.05. 명중 뒤: 대상(0.1) 기준 → 0.1
        self.assertAlmostEqual(bm.get_buffs("크라운", "__enemy__", 0.0)["burst_charge_speed_flat"], 0.05)
        bm.mark_normal_attack_landed("크라운")
        self.assertAlmostEqual(bm.get_buffs("크라운", "__enemy__", 0.1)["burst_charge_speed_flat"], 0.1)

    def test_pellet_in_shot_thresholds(self):
        bm = _bm(["크라운"])
        eff = {"type": "buff", "name": "펠릿", "trigger": {"timing": ["pellet_hit_in_shot:7"], "condition": []},
               "target": "self", "stat": "atk_pct", "polarity": "beneficial", "fixed_value": 1.0, "duration": 1}
        bm._effects.append((eff, "크라운"))
        bm._build_notify_index()
        self.assertEqual(bm.pellet_in_shot_thresholds("크라운"), [(7, "7")])
        self.assertEqual(bm.pellet_in_shot_thresholds("없는사람"), [])

    def test_debuff_immune_count_consumes_charges(self):
        bm = _bm(["크라운", "루주"])
        immune = {"type": "buff", "name": "면역 2회", "trigger": {"timing": ["passive"], "condition": []},
                  "target": "self", "stat": "debuff_immune_count", "polarity": "beneficial",
                  "fixed_value": 2.0, "duration": -1}
        harm = {"type": "buff", "name": "약화", "trigger": {"timing": ["battle_start"], "condition": []},
                "target": "all_allies", "stat": "atk_pct", "polarity": "harmful", "fixed_value": -10.0, "duration": 30}
        bm._effects.append((immune, "크라운"))
        bm._build_notify_index()
        bm.battle_start()
        for i in range(3):
            bm._activate(harm, "루주", 0.1 * (i + 1))
        harmed = [ab for ab in bm._active if ab.effect is harm]
        # 3번 걸었다: 크라운은 2번 막고 3번째에 맞는다(그때 대상 묶음이 달라져 항목이 하나 더 생긴다).
        self.assertEqual(sum(1 for ab in harmed if "크라운" in ab.target_chars), 1)
        self.assertTrue(all("루주" in ab.target_chars for ab in harmed))
        self.assertEqual(bm._immune_used[("크라운", "면역 2회")], 2.0)

    def test_max_hp_from_max_hp_pct_snapshots_caster_hp(self):
        bm = _bm(["크라운", "루주"])
        eff = {"type": "buff", "name": "체력 나눔", "trigger": {"timing": ["battle_start"], "condition": []},
               "target": "all_allies", "stat": "max_hp_from_max_hp_pct", "polarity": "beneficial",
               "fixed_value": 20.0, "duration": 10}
        bm._effects.append((eff, "크라운"))
        bm._build_notify_index()
        before = bm.effective_max_hp("루주")
        bm.battle_start()
        crown_hp = bm.state["base_stats"]["크라운"]["hp"]
        self.assertAlmostEqual(bm.effective_max_hp("루주") - before, crown_hp * 0.2, places=3)
        # 시전자 자신이 대상이어도 재귀 없이 같은 가산이다.
        self.assertAlmostEqual(bm.effective_max_hp("크라운"), crown_hp * 1.2, places=3)


if __name__ == "__main__":
    unittest.main()
