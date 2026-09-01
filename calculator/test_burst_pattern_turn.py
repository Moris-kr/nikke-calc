"""이번 사이클이 «차례»인 사람이 있으면 그 사람이 그 단계를 가져간다.

미란다·토브·츠바이에게는 「전담」 패턴(`every:1`)이 붙어 있다 — 같은 단계에 다른
멤버가 있을 때 그 단계를 도맡는다는 뜻이다(`data/char_defaults.json`).

그런데 패턴은 **뒤로 미는 것**이라, 차례인 사람이 0.2초 늦게 준비되면 동료가
새치기했다. 180초에 딱 한 번 끼어드는 모습이라 눈에도 잘 안 띄었다. 사람은 그
0.2초를 기다리므로, 차례인 사람이 있으면 그 사람만 후보로 둔다.
"""
import unittest

from calculator.timeline import simulate
from context.spec import build_config, build_squad

# 미란다(1버, 전담) + 리틀 머메이드(1버). 나머지는 2·3버를 채워 사이클이 돌게 한다.
SQUAD = ["리틀 머메이드", "미란다", "크라운", "아인", "에이다"]


def _casts(name: str, duration: int = 120) -> int:
    squad = build_squad(SQUAD)
    cfg = build_config(squad, {"duration": duration, "rng_mode": "expected"})
    result = simulate(squad, config=cfg, enemy={"code": "", "core_px": 0}, verbose=True)
    return sum(
        1 for event in result.log.burst_log
        if event.caster == name and "사용" in event.event
    )


class BurstPatternTurnTest(unittest.TestCase):
    def test_the_designated_member_keeps_the_stage(self):
        # 전담이 걸린 미란다가 1버를 전부 가져간다.
        self.assertGreater(_casts("미란다"), 5)
        # 같은 단계의 동료는 한 번도 끼어들지 않는다.
        self.assertEqual(_casts("리틀 머메이드"), 0)

    def test_the_cycle_still_runs(self):
        """단계를 독차지한다고 사이클이 막히면 안 된다.

        차례인 사람을 기다리는 것과 단계가 통째로 멈추는 것은 다르다 — 기다린 뒤
        그 사람이 쓰고, 풀버스트도 그대로 돈다.
        """
        squad = build_squad(SQUAD)
        cfg = build_config(squad, {"duration": 120, "rng_mode": "expected"})
        result = simulate(squad, config=cfg, enemy={"code": "", "core_px": 0}, verbose=True)
        full_bursts = sum(
            1 for event in result.log.burst_log if event.event == "full_burst 시작"
        )
        self.assertGreaterEqual(full_bursts, 8)


if __name__ == "__main__":
    unittest.main()
