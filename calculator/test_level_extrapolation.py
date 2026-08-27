"""표 밖(1000 초과) 레벨 회귀 — **실측 대조**.

인게임 캐릭터 레벨 상한은 우리 스탯표(1000)보다 높다. 유니온 레이드를 돌리면 싱크로가
1100을 넘는 사람을 실제로 만나는데, 표 끝값으로 눌러 버리면 공격력이 15% 넘게 깎여
«누가 더 기여하나»가 뒤집힌다.

아래 값은 블라블라링크 니케 도감의 **레벨업 미리보기**에서 잰 것이다 — 레벨을 올리면
스탯 옆에 파란 «+수치»가 붙고, 그게 그 레벨에서의 증가분이다. 「도로시 : 세렌디피티」
(화력형 SG)로 재고, 표 안(910·981)에서 얻은 배수 1.2084(= 3돌 1.06 × 코강7 1.14)로
나눠 순수 레벨 스탯을 유도했다 (2026-08-27).
"""

import json
import pathlib
import unittest

from calculator.base_stat import _level_stat, BAND, band_ratio, band_share
from calculator.customization import (
    SYNCHRO_MAX, SYNCHRO_MEASURED_MAX, normalize_synchro_level,
)

# 레벨 → 도감이 보여 준 공격력 증가분(822레벨 기준)
MEASURED_ATK_DELTA = {
    1001: 571_133, 1002: 572_076, 1021: 653_719, 1041: 740_436, 1061: 832_211,
    1081: 928_575, 1101: 1_030_480, 1118: 1_047_736, 1120: 1_049_767, 1121: 1_137_480,
    1131: 1_147_994, 1140: 1_157_456, 1141: 1_250_556, 1151: 1_261_069, 1161: 1_369_282,
}
MULTIPLIER = 1.2084


def _table() -> dict:
    return json.loads(
        (pathlib.Path(__file__).resolve().parent.parent
         / "data" / "base_stat_tables" / "level_stats.json").read_text(encoding="utf-8")
    )


class LevelBeyondTableTest(unittest.TestCase):
    def test_matches_the_game_within_rounding(self):
        """실측과 붙여 본다. 어긋나면 «추정이 틀렸다»가 아니라 데이터가 바뀐 것이다."""
        base = _table()["화력형_SG"]["822"]["atk"]
        worst = 0.0
        for level, delta in MEASURED_ATK_DELTA.items():
            real = base + delta / MULTIPLIER
            got = _level_stat("화력형", "SG", level)["atk"]
            worst = max(worst, abs(got / real - 1))
        self.assertLess(worst, 0.0005, f"최대 오차 {worst:.4%}")

    def test_band_shape_survives(self):
        """20레벨 밴드 안에서는 고르게 오르고, 밴드가 바뀔 때 한 번 뛴다."""
        atk = lambda lv: _level_stat("화력형", "SG", lv)["atk"]
        steps = [atk(lv + 1) - atk(lv) for lv in range(1122, 1140)]
        self.assertLessEqual(max(steps) - min(steps), 2, steps)
        self.assertGreater(atk(1141) - atk(1140), max(steps) * 10)

    def test_keeps_growing_to_the_cap(self):
        """상한까지 계속 오른다. 1000에서 눌리면 1021과 1131이 같은 값이 된다."""
        top = _level_stat("화력형", "SG", 1000)["atk"]
        past = [_level_stat("화력형", "SG", lv)["atk"] for lv in (1021, 1131, 1300, SYNCHRO_MAX)]
        self.assertTrue(all(a < b for a, b in zip([top] + past, past)), past)
        self.assertGreater(past[1] / top, 1.15)   # 싱크로 1131은 1000보다 15% 넘게 세다

    def test_every_table_reaches_the_cap(self):
        """클래스·무기 조합 전부가 상한까지 답을 낸다."""
        for key in (k for k in _table() if not k.startswith("_")):
            cls, weapon = key.split("_", 1)
            self.assertGreater(_level_stat(cls, weapon, SYNCHRO_MAX)["atk"], 0, key)

    def test_measured_bands_are_used_as_measured(self):
        """실측이 있는 밴드는 추정으로 덮지 않는다."""
        beyond = json.loads(
            (pathlib.Path(__file__).resolve().parent.parent
             / "data" / "base_stat_tables" / "level_beyond.json").read_text(encoding="utf-8"))
        for band, ratio in beyond["ratios"].items():
            self.assertAlmostEqual(band_ratio(int(band)), float(ratio), places=6)
        for band, share in beyond["shares"].items():
            self.assertAlmostEqual(band_share(int(band)), float(share), places=4)
        # 실측 밴드 밖은 꼬리가 잇되, 옆 밴드와 이어져야 한다.
        last = max(int(b) for b in beyond["ratios"])
        self.assertLess(abs(band_ratio(last + 1) - band_ratio(last)), 0.002)
        self.assertEqual(SYNCHRO_MEASURED_MAX, (last + 1) * BAND + 1)

    def test_cap_is_the_ingame_level_cap(self):
        """상한은 인게임 레벨 상한(1400)이지 표의 길이가 아니다."""
        self.assertEqual(normalize_synchro_level(SYNCHRO_MAX), SYNCHRO_MAX)
        self.assertEqual(normalize_synchro_level(1131), 1131)
        with self.assertRaises(ValueError):
            normalize_synchro_level(SYNCHRO_MAX + 1)


if __name__ == "__main__":
    unittest.main()
