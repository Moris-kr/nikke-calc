"""핵(`calculator/cheats.py`)이 켠 만큼만 바꾸는지.

핵은 계산기의 약속을 일부러 깨뜨리는 물건이라, **끄면 흔적이 없어야** 한다는 것이
가장 중요한 성질이다. 켰을 때 얼마나 세지는지보다 그쪽을 먼저 지킨다.
"""
import unittest

from calculator.cheats import DMG_MULT_MAX, from_config
from calculator.timeline import simulate
from context.spec import build_config, build_squad

# 리틀 머메이드가 있어야 「아군 탄 소비 N발마다」가 걸린다 — 무한 장탄이 그 카운터를
# 멈추지 않는지 보려면 이 사람이 필요하다.
SQUAD = ["리틀 머메이드", "나유타", "마스트 : 로망틱 메이드", "홍련 : 흑영", "리버렐리오"]


def _run(cheats: dict | None = None, duration: float = 60.0):
    squad = build_squad(SQUAD)
    extra = {"cheats": cheats} if cheats else {}
    cfg = build_config(squad, {"duration": duration, "rng_mode": "expected", **extra})
    return simulate(squad, config=cfg, enemy={"code": "", "core_px": 0}, verbose=True)


class CheatsOffTest(unittest.TestCase):
    def test_nothing_changes_when_nothing_is_on(self):
        plain = _run().squad_total
        for empty in ({}, {"damage_mult": 1.0}, {"always_crit": False}):
            self.assertEqual(_run(empty).squad_total, plain, empty)


class CheatsOnTest(unittest.TestCase):
    def test_damage_mult_multiplies(self):
        plain = _run().squad_total
        # 배수는 히트마다 곱해지고 히트마다 정수로 떨어지므로, 합계는 «거의» 열 배다
        # (마지막 자리의 반올림 차이까지 같기를 요구하면 시험이 거짓말이 된다).
        self.assertAlmostEqual(_run({"damage_mult": 10.0}).squad_total / plain, 10.0, places=4)

    def test_always_crit_raises_damage(self):
        plain = _run().squad_total
        self.assertGreater(_run({"always_crit": True}).squad_total, plain * 1.1)

    def test_infinite_ammo_removes_reloads_but_keeps_consumption(self):
        plain, hacked = _run(), _run({"infinite_ammo": True})
        self.assertGreater(len(plain.log.reload_log), 0)
        self.assertEqual(len(hacked.log.reload_log), 0)
        # 탄창이 안 비는 것이지 «탄을 안 쓰는» 것이 아니다. 「아군 탄 소비 500발마다」로
        # 사는 리틀 머메이드의 `거품 난사`가 멈추면 그 구분이 무너진 것이다.
        def bubbles(result):
            return sum(1 for h in result.hits if getattr(h, "skill_name", "") == "거품 난사")
        self.assertGreater(bubbles(plain), 0)
        self.assertGreaterEqual(bubbles(hacked), bubbles(plain))
        # 아무도 손해 보지 않는다 — 「핵인데 딜이 줄었다」는 화면에서 고장으로 읽힌다.
        for name, before in plain.char_total.items():
            self.assertGreaterEqual(hacked.char_total[name], before, name)

    def test_burst_charge_fires_more_full_bursts(self):
        """게이지도 쿨도 0 — 풀버스트 사이클 자체가 늘어난다.

        게이지만 0으로 두면 사이클 수는 그대로이고 전체가 몇 초 당겨질 뿐이다.
        그건 핵이라 부를 만한 것이 아니라서 쿨타임까지 함께 없앤다.
        """
        def cycles(result):
            return sum(1 for e in result.log.burst_log if "full_burst 종료" in e.event)
        plain, hacked = _run(duration=180.0), _run({"burst_charge": True}, duration=180.0)
        self.assertGreater(cycles(hacked), cycles(plain))
        self.assertGreater(hacked.squad_total, plain.squad_total * 1.2)

    def test_first_burst_comes_at_once(self):
        """충전 시간 0이면 첫 버스트도 기다리지 않는다."""
        def first(result):
            return min(e.t for e in result.log.burst_log if "사용" in e.event)
        self.assertLess(first(_run({"burst_charge": True})), first(_run()))


class CheatsConfigTest(unittest.TestCase):
    def test_reads_config(self):
        cheats = from_config({"cheats": {"always_crit": True, "damage_mult": 2.5}})
        self.assertTrue(cheats.on)
        self.assertTrue(cheats.always_crit)
        self.assertEqual(cheats.damage_mult, 2.5)
        self.assertFalse(cheats.burst_charge)

    def test_no_config_is_no_cheats(self):
        for empty in (None, {}, {"cheats": None}, {"cheats": {}}):
            self.assertFalse(from_config(empty).on, empty)

    def test_bad_multiplier_is_refused(self):
        for bad in (0.0, -1.0, DMG_MULT_MAX + 1, float("inf")):
            with self.assertRaises(ValueError):
                from_config({"cheats": {"damage_mult": bad}})


if __name__ == "__main__":
    unittest.main()
