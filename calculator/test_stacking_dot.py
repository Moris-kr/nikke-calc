"""중첩형 지속 대미지의 계약.

원문 `[... 지속 대미지] [N초 간격] [N 중첩] ...`은 인스턴스가 **병존**한다
(`context/GAMEPLAY.md` §버프 스택 — `[N 중첩]` 표기가 *없는* DoT만 갱신된다).
병존하면 한 틱에 들어가는 대미지는 계수 × 현재 중첩이다.

엔진은 그 곱을 `scaling: stack_count`가 붙은 DoT에만 적용한다
(`timeline.py` §`scaling:stack_count + dot_damage`). 그래서 `max_stack > 1`인
`dot_damage`에 그 표시가 빠지면, 중첩은 쌓이는데 대미지는 1중첩에 머문다 —
조용히 틀리고 시뮬 로그에도 흔적이 남지 않는다.

실제로 레이븐 `쇼크웨이브`가 그 상태였다(제보 2026-08-23: "평타 비중이 70%로
이상하다"). 같은 문장 형태인 사쿠라 : 블룸 인 서머 `화양연화 2`·미하라 : 본딩 체인
`사슬 감기`는 표시가 있었다.
"""
import json
import unittest
from pathlib import Path

from calculator.timeline import simulate
from context.spec import build_config, build_squad

ROOT = Path(__file__).resolve().parents[1]


def _skills() -> dict:
    return json.loads((ROOT / "data" / "parsed_skills.json").read_text(encoding="utf-8"))


class StackingDotContractTest(unittest.TestCase):
    def test_every_stacking_dot_scales_with_its_stacks(self):
        """`max_stack > 1`인 지속 대미지는 전부 중첩만큼 곱해져야 한다."""
        missing = []
        for name, effects in _skills().items():
            if name.startswith("test_") or not isinstance(effects, list):
                continue
            for eff in effects:
                if not isinstance(eff, dict):
                    continue
                if not str(eff.get("stat", "")).startswith("dot_damage"):
                    continue
                if int(eff.get("max_stack", 1) or 1) <= 1:
                    continue
                if eff.get("scaling") != "stack_count":
                    missing.append(f"{name} / {eff.get('name')}")
        self.assertEqual(
            [], missing,
            "중첩형 지속 대미지에 scaling: stack_count 가 빠졌다 — "
            "중첩이 쌓여도 틱 대미지가 1중첩에 머문다: " + ", ".join(missing),
        )

    def test_raven_shockwave_ticks_grow_with_stacks(self):
        """레이븐 `쇼크웨이브`는 풀차지가 쌓일수록 틱이 세져야 한다.

        풀차지 명중마다 한 중첩씩 붙으므로, 한 탄창 안에서 뒤쪽 틱이 앞쪽 틱보다
        커야 한다. 중첩이 대미지에 반영되지 않으면 모든 틱이 같은 값이다.
        """
        squad = build_squad(["레이븐", "크라운", "test_B3"])
        result = simulate(
            squad,
            config=build_config(squad, {"first_burst_time": 1, "duration": 20}),
            seed=1,
        )
        ticks = [h.damage for h in result.hits
                 if h.caster == "레이븐" and h.skill_name == "쇼크웨이브"]
        self.assertGreaterEqual(len(ticks), 4, "쇼크웨이브 틱이 너무 적어 비교할 수 없다")
        self.assertGreater(
            max(ticks), min(ticks) * 1.5,
            "쇼크웨이브 틱이 전부 같은 크기다 — 중첩이 대미지에 반영되지 않았다",
        )


if __name__ == "__main__":
    unittest.main()
