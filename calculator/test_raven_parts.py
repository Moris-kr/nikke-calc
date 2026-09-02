"""레이븐의 버스트는 파츠에도 맞는다.

「템페스트」 원문은 `■ 적 전체에게(파츠 포함)`이다. 대상에 파츠를 명시한 damage 효과는
`hits_parts: true`를 달고, 그 히트만 파츠 판정을 받아 `part_dmg_pct`가 실린다
(`context/PARSING.md` §hits_parts). 레이븐만 이 표시가 빠져 있어, 파츠를 켠 보스에서도
자기 「급소 공략」(파츠 대미지 ▲)을 자기 버스트가 못 받고 있었다.
"""
import unittest

from calculator.timeline import simulate
from context.spec import build_config, build_squad

SQUAD = ["레이븐", "크라운", "리타", "노아"]


def _total(has_parts: bool) -> float:
    squad = build_squad(SQUAD)
    cfg = build_config(squad, {"duration": 180, "rng_mode": "expected"})
    result = simulate(
        squad, config=cfg, enemy={"code": "", "core_px": 0, "has_parts": has_parts},
    )
    return result.char_total["레이븐"]


class RavenPartsTest(unittest.TestCase):
    def test_burst_takes_part_damage_on_a_parts_boss(self):
        # 파츠가 있는 보스에서만 오른다 — 없으면 파츠 판정 자체가 성립하지 않는다.
        self.assertGreater(_total(True), _total(False))

    def test_the_burst_effect_is_marked(self):
        from calculator.buff_manager import _PARSED_SKILLS

        tempest = [
            eff for eff in _PARSED_SKILLS["레이븐"]
            if eff.get("name") == "템페스트" and eff.get("stat") == "burst_damage"
        ]
        self.assertEqual(len(tempest), 1)
        self.assertTrue(tempest[0].get("hits_parts"))


if __name__ == "__main__":
    unittest.main()
