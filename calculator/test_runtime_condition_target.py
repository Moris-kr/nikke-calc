"""런타임 조건 재평가는 **버프를 받는 쪽**을 봐야 한다.

`get_buffs(caster, target, t)`의 `target`은 딜 계산 경로에서 대개 `"__enemy__"`
센티널이다. 조건 재평가에 그걸 그대로 넘기면 `ally_hp_below:N`처럼 «받는 아군의
상태»를 묻는 조건이 hp_pct 맵에 없는 키를 읽어 **영원히 거짓**이 된다.

지금 파싱된 캐릭터 중 이 조건을 지속 버프로 쓰는 경우가 없어 골든 스냅샷으로는
잡히지 않는다. 그래서 BuffManager를 직접 세워 고정한다.
"""
import unittest

from calculator.buff_manager import BuffManager
from context.spec import build_squad


class RuntimeConditionTargetTest(unittest.TestCase):
    def setUp(self):
        self.squad = build_squad(["리타", "크라운", "test_B3"])
        self.bm = BuffManager(self.squad)
        self.bm.state["hp_pct"] = {"리타": 100.0, "크라운": 30.0}

    def test_ally_hp_below_reads_the_recipient_not_the_enemy_sentinel(self):
        cond = ["ally_hp_below:50"]
        # 수령자를 넘기면 그 아군의 실제 체력을 본다.
        self.assertTrue(
            self.bm._runtime_condition_ok(cond, "리타", "리타", "크라운", 0.0),
            "체력 30%인 아군을 넘겼는데 조건이 거짓이다",
        )
        self.assertFalse(
            self.bm._runtime_condition_ok(cond, "리타", "리타", "리타", 0.0),
            "체력 100%인 아군을 넘겼는데 조건이 참이다",
        )

    def test_enemy_sentinel_is_never_what_the_condition_should_see(self):
        # 센티널은 hp_pct에 없어 기본 100%로 읽힌다 — 이걸 넘기던 것이 버그였다.
        self.assertFalse(
            self.bm._runtime_condition_ok(["ally_hp_below:50"], "리타", "리타", "__enemy__", 0.0)
        )


if __name__ == "__main__":
    unittest.main()
