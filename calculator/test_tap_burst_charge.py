"""버충 톡톡이 — `tap_fire.policy = "burst_charge"`.

풀버스트 **밖**(버스트 게이지를 채우는 구간)에서만 톡톡이하고, 풀버스트 동안은 평소처럼
풀차지를 든다. 실제 조작은 «풀버스트가 끝나면 재장전 → 다음 풀버스트까지 톡톡이 →
풀버스트에는 풀차지»가 한 세트다(피드백 2026-09-22). 정본: context/CONTROL.md §톡톡이.
"""
import unittest

from calculator.timeline import simulate
from context.spec import build_config, build_squad

SQUAD = ["미란다", "에이다", "아인", "타키나", "홍련"]
TAP_ALWAYS = {"tap_fire": {"rate": 3.6, "release": 0.03}}
TAP_BURST = {"tap_fire": {"rate": 3.6, "release": 0.03, "policy": "burst_charge"}}


def _run(control, duration=45):
    squad = build_squad(SQUAD, chars={"아인": {"control": control}}, no_layer={"아인"})
    cfg = build_config(squad, {"duration": duration, "rng_mode": "expected"})
    return simulate(squad, config=cfg, enemy={"code": "", "core_px": 0}, verbose=True)


def _fb_windows(result):
    """풀버스트 [시작, 끝) 구간들 — 버스트 로그의 시작/종료 짝."""
    windows, start = [], None
    for e in result.log.burst_log:
        if e.event == "full_burst 시작":
            start = e.t
        elif e.event == "full_burst 종료" and start is not None:
            windows.append((start, e.t))
            start = None
    if start is not None:
        windows.append((start, float("inf")))
    return windows


def _basic_shots(result):
    return [h for h in result.hits if h.caster == "아인" and h.skill_name == "기본 공격"]


def _shots(result, inside_fb):
    """아인의 평타 발수를 풀버스트 안/밖으로 갈라 센다."""
    windows = _fb_windows(result)
    in_fb = lambda t: any(a <= t < b for a, b in windows)
    return sum(1 for h in _basic_shots(result) if in_fb(h.t) == inside_fb)


class TapBurstChargeTest(unittest.TestCase):
    def test_taps_outside_full_burst_but_charges_inside(self):
        always = _run(dict(TAP_ALWAYS))
        burst = _run(dict(TAP_BURST))
        # 풀버스트 밖에서는 둘 다 톡톡이 — 발수가 비슷하다(재장전 타이밍만 다르다).
        # 풀버스트 안에서는 버충 톡톡이가 풀차지를 들므로 «항상 톡톡이»보다 훨씬 덜 쏜다.
        self.assertLess(_shots(burst, inside_fb=True), _shots(always, inside_fb=True))
        self.assertGreater(_shots(burst, inside_fb=False), 0)
        self.assertNotEqual(burst.char_total["아인"], always.char_total["아인"])

    def test_taps_before_first_full_burst(self):
        """첫 풀버스트 **전**도 버충 구간이다 — 전투 시작부터 톡톡이한다(확인 2026-09-22).

        고정 게이지(fixed)와 실누적(accumulate) 어느 쪽이든 첫 풀버스트 전 발수가
        «항상 톡톡이»와 같고, 컨트롤 없음보다 많아야 한다.
        """
        for mode in ("fixed", "accumulate"):
            with self.subTest(mode=mode):
                def run(control):
                    squad = build_squad(SQUAD, chars={"아인": {"control": control}}, no_layer={"아인"})
                    cfg = build_config(squad, {"duration": 45, "rng_mode": "expected",
                                               "burst_gauge_mode": mode})
                    return simulate(squad, config=cfg, enemy={"code": "", "core_px": 0}, verbose=True)

                def before_first_fb(result):
                    windows = _fb_windows(result)
                    first = windows[0][0] if windows else float("inf")
                    return sum(1 for h in _basic_shots(result) if h.t < first)

                plain, always, burst = run({}), run(dict(TAP_ALWAYS)), run(dict(TAP_BURST))
                self.assertEqual(before_first_fb(burst), before_first_fb(always))
                self.assertGreater(before_first_fb(burst), before_first_fb(plain))

    def test_differs_from_no_control_too(self):
        plain = _run({})
        burst = _run(dict(TAP_BURST))
        # 컨트롤이 없으면 내내 풀차지라 발수가 훨씬 적다.
        self.assertGreater(len(_basic_shots(burst)), len(_basic_shots(plain)))

    def test_reloads_when_full_burst_ends(self):
        burst = _run(dict(TAP_BURST))
        labels = [e.event for e in burst.log.reload_log if e.caster == "아인"]
        self.assertIn("엄폐 시작(버충 톡톡이 재장전)", labels)
        # 끄면 그 엄폐는 없다.
        off = _run({"tap_fire": {**TAP_BURST["tap_fire"], "reload_at_end": False}})
        self.assertNotIn("엄폐 시작(버충 톡톡이 재장전)",
                         [e.event for e in off.log.reload_log if e.caster == "아인"])


if __name__ == "__main__":
    unittest.main()
