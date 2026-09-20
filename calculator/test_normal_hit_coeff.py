"""무기군 평타 계수의 계약.

사용자가 지정한 무기군 계수는 **평타에만** 붙고 스킬·버스트에는 붙지 않는다.
샷건 기본 계수는 1이며, 펠릿 빗나감은 별도 명중 판정으로 처리한다.

기본값 근거는 `data/weapon_mechanics.json` `normal_hit_coeff._source`
(2026-09-20 기본 계수 1 적용).
"""
import json
import unittest
from pathlib import Path

from calculator.timeline import normal_hit_coeff, simulate
from context.spec import build_config, build_squad

ROOT = Path(__file__).resolve().parents[1]


def _totals(squad_names, cfg_extra=None):
    squad = build_squad(squad_names)
    cfg = build_config(squad, {"duration": 30, "rng_mode": "expected", **(cfg_extra or {})})
    result = simulate(squad, config=cfg, enemy={"code": "", "core_px": 0})
    return result.char_total


class NormalHitCoeffTest(unittest.TestCase):
    def test_default_comes_from_the_mechanics_table(self):
        table = json.loads(
            (ROOT / "data" / "weapon_mechanics.json").read_text(encoding="utf-8")
        )["normal_hit_coeff"]
        self.assertEqual(1.0, table["SG"])
        self.assertEqual(1.0, normal_hit_coeff({}, "SG"))
        # 표에 없는 무기군은 보정 없음.
        self.assertEqual(1.0, normal_hit_coeff({}, "AR"))

    def test_config_overrides_the_default(self):
        self.assertEqual(0.5, normal_hit_coeff({"normal_hit_coeff": {"SG": 0.5}}, "SG"))
        # 덮지 않은 무기군은 표 기본값 그대로다.
        self.assertEqual(1.0, normal_hit_coeff({"normal_hit_coeff": {"SG": 0.5}}, "AR"))

    def test_coefficient_scales_shotgun_normal_attacks(self):
        """SG 평타는 계수만큼 줄어든다. 1.0으로 되돌리면 원래 값이다."""
        name = "드레이크"
        squad = [name, "크라운", "test_B3"]
        base = _totals(squad, {"normal_hit_coeff": {"SG": 1.0}})[name]
        halved = _totals(squad, {"normal_hit_coeff": {"SG": 0.5}})[name]
        self.assertLess(halved, base)
        # 드레이크는 평타 비중이 100%가 아니므로 정확히 절반은 아니다 —
        # 줄어든 폭이 평타 몫 안에 들어 있는지만 본다.
        self.assertGreater(halved / base, 0.5)
        self.assertLess(halved / base, 1.0)

    def test_non_shotgun_is_untouched_by_a_shotgun_coefficient(self):
        name = "리타"        # SMG — SG 계수와 무관해야 한다
        squad = [name, "크라운", "test_B3"]
        a = _totals(squad, {"normal_hit_coeff": {"SG": 1.0}})[name]
        b = _totals(squad, {"normal_hit_coeff": {"SG": 0.2}})[name]
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
