"""차지형 무기 변경은 **들어올 때마다** 그 모드의 탄창을 받는다.

나유타 `기억 연소`는 버스트마다 10초짜리 RL 모드로 바꾸고 그 모드는 무한 장탄이다
(`max_ammo: -1` → 센티널 999999). 그런데 탄창을 싣는 조건이 «차지가 ready인가»뿐이라
**첫 버스트에만** 실렸다 — 모드가 duration으로 끝날 때 `_charge_phase`가 "ready"로
되돌지 않아(그 초기화는 `duration_bullets` 종료 경로에만 있다) 두 번째 진입부터는
전부 «차지 중»으로 읽혔기 때문이다.

증상은 화면에서 먼저 보였다: 보스 메이커의 탄창 표시가 첫 버스트에만 ∞였다.
"""
import unittest

from calculator.timeline import simulate
from context.spec import build_config, build_squad

# 1·2·3버가 다 있어야 사이클이 돌고 나유타가 여러 번 버스트한다.
SQUAD = ["리틀 머메이드", "나유타", "마스트 : 로망틱 메이드", "홍련 : 흑영", "리버렐리오"]
# 무한 장탄 모드의 센티널(999999) 언저리. 진짜 탄창은 이만큼 클 수 없다.
SENTINEL = 99_999


def _ammo_log():
    squad = build_squad(SQUAD)
    cfg = build_config(squad, {"duration": 180, "rng_mode": "expected"})
    result = simulate(squad, config=cfg, enemy={"code": "", "core_px": 0}, verbose=True)
    log = [entry for entry in result.log.ammo_log if entry.caster == "나유타"]
    bursts = [
        event.t for event in result.log.burst_log
        if event.caster == "나유타" and "사용" in event.event
    ]
    return log, bursts


class WeaponChangeRepeatTest(unittest.TestCase):
    def test_every_burst_enters_the_mode_with_its_own_magazine(self):
        (log, bursts) = _ammo_log()
        self.assertGreater(len(bursts), 3, "버스트가 여러 번 나와야 시험이 성립한다")

        # 센티널이 찍힌 시각들을 버스트별로 묶는다 — 버스트마다 한 덩어리여야 한다.
        infinite = [entry.t for entry in log if entry.ammo >= SENTINEL]
        self.assertGreater(len(infinite), 0)
        covered = {
            max((at for at in bursts if at <= t), default=None)
            for t in infinite
        }
        covered.discard(None)
        # 첫 버스트에만 걸리던 것이 이 시험이 잡는 회귀다.
        self.assertEqual(len(covered), len(bursts))

    def test_the_mode_does_not_eat_the_normal_magazine(self):
        """모드 안에서는 원래 무기의 탄창이 줄지 않는다.

        탄창을 못 받으면 RL 모드가 SMG 탄을 대신 깎는다 — 모드가 끝난 뒤 탄이 모자라
        엉뚱한 자리에서 재장전이 걸린다.
        """
        (log, bursts) = _ammo_log()
        second = bursts[1]
        # 두 번째 버스트 뒤 10초(모드 지속) 안에서 찍힌 값은 전부 센티널이어야 한다.
        during = [entry.ammo for entry in log if second + 2 <= entry.t <= second + 9]
        self.assertGreater(len(during), 0)
        self.assertTrue(all(ammo >= SENTINEL for ammo in during), during[:5])


if __name__ == "__main__":
    unittest.main()
