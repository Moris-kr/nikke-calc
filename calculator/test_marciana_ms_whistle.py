"""마르차나 : 마린 스터디 — `[중첩량 N개 ▲]`는 상한이 아니라 중첩이다.

원문은 이렇게 생겼다.

    ■ 전투 시작 시 자신에게
    [휘슬 : 공격력 32.73% ▲] [5 중첩] [지속]
    [휘슬 중첩량 4개 ▲]

「5 중첩」이 **상한**이고, 아래 줄의 `[휘슬 중첩량 4개 ▲]`는 **중첩을** 4 더한다 —
그래서 전투 시작과 동시에 상한 5에 닿는다. 종전에는 아래 줄을 「상한 +4」로 읽어
`max_stack: 9`로 두었고, 공격력 32.73%짜리 중첩이 넷 더 붙는 바람에 이 캐릭터 딜이
**실측의 1.29배**로 부풀었다(피드백 2026-09-07 — 유저 사격장 실측 60.31억 vs 계산 77.96억).

같은 표기의 ▼쪽(`펭군 긴급 출동`의 `[휘슬 중첩량 1개 ▼]`, 원문 「소모하여」)을 데이터가
이미 중첩 제거로 읽고 있었다 — ▲만 상한으로 읽던 것이 애초에 앞뒤가 안 맞았다.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from calculator.timeline import simulate
from context import spec as char_spec

ROOT = Path(__file__).resolve().parents[1]
NAME = "마르차나 : 마린 스터디"
SQUAD = ["리틀 머메이드", "크라운", "신데렐라 : 크리스탈 웨이브", NAME, "마스트 : 로망틱 메이드"]


def _whistle() -> dict:
    skills = json.loads((ROOT / "data" / "parsed_skills.json").read_text(encoding="utf-8"))
    return next(e for e in skills[NAME] if e.get("name") == "휘슬")


class MarcianaMarineStudyWhistleTest(unittest.TestCase):
    def test_the_cap_is_five(self):
        """상한 5. 「중첩량 4개 ▲」를 캡으로 읽으면 9가 되고, 그 차이가 딜 29%다."""
        self.assertEqual(_whistle()["max_stack"], 5)

    def test_the_opening_stack_fills_the_cap(self):
        """전투 시작 1중첩 + 중첩량 4 = 5 — 시작하자마자 상한이다."""
        skills = json.loads((ROOT / "data" / "parsed_skills.json").read_text(encoding="utf-8"))
        opening = next(e for e in skills[NAME] if e.get("name") == "휘슬 초기 중첩")
        self.assertEqual(opening["stat"], "buff_stack_add")
        self.assertEqual(opening["target_effect"], "휘슬")
        self.assertEqual(opening["fixed_value"], 4)
        self.assertEqual(1 + opening["fixed_value"], _whistle()["max_stack"])

    def test_the_stack_amount_notation_reads_the_same_both_ways(self):
        """▲와 ▼가 같은 것을 가리킨다 — 한쪽만 상한으로 읽으면 앞뒤가 안 맞는다."""
        skills = json.loads((ROOT / "data" / "parsed_skills.json").read_text(encoding="utf-8"))
        spend = next(e for e in skills[NAME] if e.get("name") == "휘슬 소모")
        self.assertEqual(spend["stat"], "buff_stack_remove")
        self.assertEqual(spend["target_effect"], "휘슬")

    def test_the_cap_actually_binds_the_damage(self):
        """상한을 9로 되돌리면 딜이 그만큼 뛴다 — 시험이 보는 것이 실제로 딜에 닿는다."""
        def total(cap: int) -> int:
            squad = char_spec.build_squad(SQUAD, {})
            # 스쿼드를 세운 뒤 그 판본의 상한만 바꾼다 — 파일은 건드리지 않는다.
            import calculator.buff_manager as buff_manager
            whistle = next(e for e in buff_manager._PARSED_SKILLS[NAME] if e.get("name") == "휘슬")
            before = whistle["max_stack"]
            whistle["max_stack"] = cap
            try:
                result = simulate(squad, config={"duration": 60, "rng_mode": "expected"},
                                  enemy={"def": 31784, "code": "전격", "core_px": 52})
            finally:
                whistle["max_stack"] = before
            return sum(h.damage for h in result.hits if h.caster == NAME)

        five, nine = total(5), total(9)
        self.assertGreater(nine, five)
        # 실측 대비 1.29배로 부풀던 그 폭이다 — 대략 1.2~1.4배 사이.
        self.assertGreater(nine / five, 1.2)
        self.assertLess(nine / five, 1.4)


if __name__ == "__main__":
    unittest.main()
