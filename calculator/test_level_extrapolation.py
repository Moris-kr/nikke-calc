"""표 밖(1000 초과) 레벨 잇기 회귀.

인게임 캐릭터 레벨 상한은 이미 우리 스탯표보다 높다 — 유니온 레이드에서 싱크로 1131인
유니온원을 실제로 만난다. 표 마지막 값으로 눌러 버리면 공격력이 15% 넘게 깎인다.
"""

import json
import math
import unittest

from calculator.base_stat import _beyond_table, _level_stat, BAND
from calculator.customization import SYNCHRO_MAX, SYNCHRO_MEASURED_MAX, normalize_synchro_level


class LevelExtrapolationTest(unittest.TestCase):
    def test_predicts_held_out_levels_within_one_percent(self):
        """표를 800에서 끊고 1000을 맞혀 본다 — 추정이 얼마나 틀리는지 실제로 잰다."""
        table = json.loads(
            __import__("pathlib").Path("data/base_stat_tables/level_stats.json").read_text(encoding="utf-8")
        )["화력형_AR"]
        cut = {k: v for k, v in table.items() if int(k) <= 800}
        keys = sorted(cut, key=int)
        for level in (901, 1000):
            got = _beyond_table(cut, keys, level)["atk"]
            real = table[str(level)]["atk"]
            self.assertLess(abs(got / real - 1), 0.01,
                            f"레벨 {level}: 추정 {got:,} vs 실제 {real:,}")

    def test_keeps_growing_past_the_table(self):
        """표 끝에서 멈추지 않는다. 1000에서 눌리면 1021과 1131이 같은 값이 된다."""
        top = _level_stat("화력형", "AR", SYNCHRO_MEASURED_MAX)["atk"]
        past = [_level_stat("화력형", "AR", lv)["atk"] for lv in (1021, 1082, 1131, SYNCHRO_MAX)]
        self.assertTrue(all(a < b for a, b in zip([top] + past, past)), past)
        # 싱크로 1131은 1000보다 한참 세다 — 눌러 버리면 15% 넘게 깎인다.
        self.assertGreater(past[2] / top, 1.15)

    def test_band_shape_survives(self):
        """20레벨 밴드 안에서는 고르게 오르고, 밴드가 바뀔 때 한 번 뛴다."""
        steps = [_level_stat("화력형", "AR", lv + 1)["atk"] - _level_stat("화력형", "AR", lv)["atk"]
                 for lv in range(1002, 1020)]
        self.assertLessEqual(max(steps) - min(steps), 2, steps)   # 밴드 안: 거의 일정
        jump = _level_stat("화력형", "AR", 1021)["atk"] - _level_stat("화력형", "AR", 1020)["atk"]
        self.assertGreater(jump, max(steps) * 10)                 # 밴드 경계: 크게 뛴다

    def test_every_table_reaches_the_cap(self):
        """클래스·무기 조합 전부가 상한까지 답을 낸다 — 하나라도 죽으면 그 조합만 계산이 멈춘다."""
        tables = json.loads(
            __import__("pathlib").Path("data/base_stat_tables/level_stats.json").read_text(encoding="utf-8")
        )
        for key in (k for k in tables if not k.startswith("_")):
            cls, weapon = key.split("_", 1)
            stat = _level_stat(cls, weapon, SYNCHRO_MAX)
            self.assertGreater(stat["atk"], 0, key)

    def test_cap_is_the_ingame_level_cap(self):
        """상한은 인게임 레벨 상한(1400)이다. 표가 1000까지인 것과는 다른 이야기다."""
        self.assertEqual(normalize_synchro_level(SYNCHRO_MAX), SYNCHRO_MAX)
        self.assertEqual(normalize_synchro_level(1131), 1131)
        with self.assertRaises(ValueError):
            normalize_synchro_level(SYNCHRO_MAX + 1)


if __name__ == "__main__":
    unittest.main()
