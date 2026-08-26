"""버스트 사용 패턴의 우선순위 등급.

`_pattern_rank`는 «누가 이 단계 버스트를 먼저 쓰는가»를 정하는 자리다. 시뮬 전체를
돌려서는 등급 하나가 뒤집혀도 총딜 차이로만 드러나 무엇이 틀렸는지 알 수 없어,
등급 자체를 직접 본다.
"""

import unittest

from calculator.timeline import BurstController


def _ranker(pattern: dict, duration: float = 60.0) -> BurstController:
    """등급 판정에 필요한 두 가지만 심은 컨트롤러. 전투를 만들지 않는다."""
    ctrl = object.__new__(BurstController)
    ctrl._burst_pattern = pattern
    ctrl._sim_duration = duration
    return ctrl


class BurstPatternRankTest(unittest.TestCase):
    def test_endgame_pattern_leads_only_in_the_last_seconds(self):
        ctrl = _ranker({"막바지": "last:15"})

        # 아직 20초 남았다 — 평소 순서다(후보에서 빼지 않는다).
        self.assertEqual(ctrl._pattern_rank("막바지", 1, 40.0), 1)
        # 14초 남았다 — 누구보다 먼저.
        self.assertEqual(ctrl._pattern_rank("막바지", 1, 46.0), -1)
        # 경계(정확히 15초 남음)는 아직 아니다.
        self.assertEqual(ctrl._pattern_rank("막바지", 1, 45.0), 1)
        # 사이클과는 무관하다 — 몇 번째 버스트인지가 아니라 남은 시간만 본다.
        self.assertEqual(ctrl._pattern_rank("막바지", 7, 50.0), -1)

    def test_endgame_beats_a_due_cycle_pattern(self):
        ctrl = _ranker({"막바지": "last:15", "주기": "every:2"})
        cycle, t = 2, 50.0   # 주기 쪽도 «이번 차례»인 순간

        self.assertEqual(ctrl._pattern_rank("주기", cycle, t), 0)
        self.assertLess(
            ctrl._pattern_rank("막바지", cycle, t),
            ctrl._pattern_rank("주기", cycle, t),
        )

    def test_other_patterns_keep_their_meaning(self):
        ctrl = _ranker({"주기": "every:3", "안씀": [], "지정": [1, 4]})

        self.assertEqual(ctrl._pattern_rank("주기", 3, 0.0), 0)
        self.assertEqual(ctrl._pattern_rank("주기", 4, 0.0), 2)
        self.assertEqual(ctrl._pattern_rank("안씀", 1, 0.0), 2)
        self.assertEqual(ctrl._pattern_rank("지정", 4, 0.0), 0)
        # 패턴이 없는 캐릭터는 평소 순서.
        self.assertEqual(ctrl._pattern_rank("아무개", 1, 0.0), 1)


if __name__ == "__main__":
    unittest.main()
