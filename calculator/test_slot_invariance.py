"""편성 자리를 바꿔도 결과가 같아야 한다(2026-09-23 제보: 같은 5명인데 자리만 바꾸면 딜이 달라짐).

원인이던 것 둘 — 기본 카메라가 3번 자리였고(차지 무기 풀차지 게이지 배율), 한 프레임 안의 처리 순서가
자리 순서였다. 이제 처리는 이름순, 카메라는 차지 무기 중 풀차지 게이지 최대 니케다.
자리가 여전히 의미 있는 것: 같은 단계 버스트 우선순위(앞자리 먼저), 후열 조건·양옆 아군 스킬.
"""
import itertools
import unittest

from calculator.timeline import simulate
from context.spec import build_config, build_squad

M, P, S, C, L = "미란다", "프리바티", "스노우 화이트 : 헤비암즈", "크라운", "리틀 머메이드"


def _run(members):
    squad = build_squad(members)
    cfg = build_config(squad, {"duration": 90, "rng_mode": "expected"})
    res = simulate(squad, config=cfg, enemy={"def": 31784, "code": "작열", "core_px": 11})
    return res.squad_total, dict(sorted(res.char_total.items()))


class SlotInvarianceTest(unittest.TestCase):
    def test_same_members_same_result_when_burst_priority_unchanged(self):
        # 같은 단계 버스트끼리의 앞뒤(미란다→머메이드, 프리바티→스노우)를 지키는 자리 바꿈 네 가지 — 제보 편성
        orders = [[M, P, S, C, L], [M, C, P, S, L], [M, L, P, C, S], [P, S, M, C, L]]
        results = [_run(o) for o in orders]
        for r in results[1:]:
            self.assertEqual(r, results[0])

    def test_single_stage_members_any_permutation(self):
        # 단계가 모두 다르면 어떤 순서로 두어도 같다
        members = ["리틀 머메이드", "크라운", "스노우 화이트 : 헤비암즈"]
        base = _run(members)
        for perm in itertools.permutations(members):
            self.assertEqual(_run(list(perm)), base)


if __name__ == "__main__":
    unittest.main()
