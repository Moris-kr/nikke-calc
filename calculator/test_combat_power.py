"""전투력 공식 회귀. 정본은 유저가 준 공식과 그 예시다(2026-08-26 확인)."""

import unittest

from calculator.combat_power import (
    collection_coeff, combat_power, cube_coeff, stage_sum,
)
from context.spec import build_squad


class CombatPowerTest(unittest.TestCase):
    def test_matches_the_reference_example(self):
        """유저가 준 예시를 소수점까지 재현한다.

        체력 1,693,423 · 공격 54,353 · 방어 11,035 · 스킬 10/7 · 버스트 7 ·
        우코 단계합 22 · 비우코 단계합 66 · 큐브 Lv5 · 소장품 R4
        → ④ 2.383237, 전투력 71,725.34 (인게임 실측 71,727)
        """
        base = 0.7 * 1_693_423 + 19.35 * 54_353 + 70 * 11_035
        self.assertAlmostEqual(base, 3_009_576.65, places=2)

        mult = (1.3 + 0.01 * 10 + 0.01 * 7 + 0.02 * 7
                + 0.00828 * 22 + 0.0069 * 66
                + 0.0092 * cube_coeff({"level": 5})
                + 0.0069 * collection_coeff("R4"))
        self.assertAlmostEqual(mult, 2.383237, places=6)
        self.assertAlmostEqual(base * mult / 100, 71_725.3442662, places=4)

        # 인게임 실측과 0.01% 안쪽이어야 한다.
        self.assertLess(abs(base * mult / 100 - 71_727) / 71_727, 0.0001)

    def test_cube_coefficient_follows_the_level_steps(self):
        """큐브 계수는 `cube.json`의 값 계단(= 스킬 레벨)에서 나온다."""
        # 4레벨 이하는 고유 스킬만 센다 (1스킬 + 1).
        self.assertEqual(cube_coeff({"level": 1}), 2)   # 1스킬 1
        self.assertEqual(cube_coeff({"level": 3}), 3)   # 1스킬 2
        # 5레벨부터 공통 스킬이 붙는다 (1스킬 + 2스킬 + 4).
        self.assertEqual(cube_coeff({"level": 5}), 7)   # 2 + 1 + 4 — 예시와 같은 값
        self.assertEqual(cube_coeff({"level": 15}), 13)  # 3 + 6 + 4
        # 안 끼면 0이다.
        self.assertEqual(cube_coeff(None), 0.0)
        self.assertEqual(cube_coeff({"level": 0}), 0.0)

    def test_collection_coefficient_by_grade(self):
        """소장품 계수 — R은 1스킬 + 6.33, SR은 1스킬 + 2스킬 + 10.66."""
        self.assertAlmostEqual(collection_coeff("R4"), 10.33, places=2)
        self.assertAlmostEqual(collection_coeff("SR15"), 40.66, places=2)
        self.assertEqual(collection_coeff("없음"), 0.0)
        self.assertEqual(collection_coeff(None), 0.0)

    def test_stage_sum_inverts_the_percentage(self):
        """합계 퍼센트 → 단계 합.

        우리는 옵션별 퍼센트만 들고 있는데, 단계표가 등차라 합을 되돌릴 수 있다.
        전투력에 필요한 것도 개별 단계가 아니라 합이다.
        """
        # 기본 스펙 값들 — 후보가 하나씩만 나온다.
        self.assertEqual(stage_sum("element_bonus", 88.6), 40)
        self.assertEqual(stage_sum("atk_pct", 22.22), 20)
        self.assertEqual(stage_sum("max_ammo_pct", 129.64), 20)
        # 안 붙은 옵션은 0.
        self.assertEqual(stage_sum("crit_rate", 0), 0)
        # 단계 조합으로 만들 수 없는 수는 조용히 0으로 둔다(손입력 방어).
        self.assertEqual(stage_sum("atk_pct", 0.01), 0)

    def test_investment_raises_combat_power(self):
        """더 굴린 캐릭터가 더 높은 전투력을 낸다 — 정렬이 뒤집히면 안 된다."""
        plain = build_squad(["라피"], {"라피": {
            "level": 200, "skill_levels": {"1": 1, "2": 1, "3": 1},
            "cube": {"name": "렐릭 베어 큐브", "level": 1},
            "collection_stage": "없음", "favorite_stage": 0,
        }})[0]
        invested = build_squad(["라피"])[0]   # 기본 스펙(만렙·풀강)
        self.assertGreater(combat_power(invested), combat_power(plain))
        self.assertGreater(combat_power(plain), 0)


if __name__ == "__main__":
    unittest.main()
