"""편성 자리를 바꿔도 결과가 같아야 한다(2026-09-23 제보: 같은 5명인데 자리만 바꾸면 딜이 달라짐).

숨은 원인이던 한 프레임 안의 처리 순서·동률 정리는 이름순으로 바꿨다. 자리가 의미 있는 것은 게임과 같은
것만 남긴다: 카메라 = 3번 자리(사이트가 표시한다, 2026-09-23 사용자 결정), 같은 단계 버스트 우선순위(앞자리
먼저), 후열 조건·양옆 아군 스킬.
"""
import itertools
import unittest

from calculator.timeline import _resolve_cameras, simulate
from context.spec import build_config, build_squad

M, P, S, C, L = "미란다", "프리바티", "스노우 화이트 : 헤비암즈", "크라운", "리틀 머메이드"


def _run(members):
    squad = build_squad(members)
    cfg = build_config(squad, {"duration": 90, "rng_mode": "expected", "burst_gauge_mode": "accumulate"})
    res = simulate(squad, config=cfg, enemy={"def": 31784, "code": "작열", "core_px": 11})
    return res.squad_total, dict(sorted(res.char_total.items()))


class SlotInvarianceTest(unittest.TestCase):
    def test_same_result_when_slot3_and_burst_priority_unchanged(self):
        # 3번 자리(카메라)와 같은 단계 버스트의 앞뒤(미란다→머메이드, 프리바티→스노우)만 지키면 나머지 자리는 무관하다
        orders = [[M, P, S, C, L], [P, M, S, L, C], [M, P, S, L, C], [P, C, S, M, L]]
        results = [_run(o) for o in orders]
        for r in results[1:]:
            self.assertEqual(r, results[0])

    def test_camera_is_slot_three(self):
        # 버충 담당·명시 카메라·컨트롤 니케가 없으면 실제 편성 3번 자리가 카메라다(처리 순서는 이름순이어도)
        squad = [{"name": n} for n in sorted([M, C, S, P])]
        self.assertEqual(_resolve_cameras(squad, {"_slot_order": [M, C, S, P]}), frozenset({S}))
        self.assertEqual(_resolve_cameras(squad, {"_slot_order": [M, C, P, S]}), frozenset({P}))
        self.assertEqual(_resolve_cameras(squad[:2], {"_slot_order": [C, M]}), frozenset({C}))

    def test_other_slots_any_permutation(self):
        # 단계가 다른 니케끼리는 3번 자리만 고정하면 어떤 순서로 두어도 같다
        base = _run([L, C, S])
        self.assertEqual(_run([C, L, S]), base)


if __name__ == "__main__":
    unittest.main()
