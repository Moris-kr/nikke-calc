"""라플라스 : 얼티밋 히어로 — 「투사체 폭발 대미지」는 예열 구간에서만 받는다.

「투사체 폭발 대미지 ▲」는 **기본 무기**가 RL인지로 따진다(유저 확인, 2026-08-25 —
나유타는 SMG가 기본이라 RL 모드로 바뀌어도 못 받는다). 그 규칙만 읽으면 기본이 RL인
이 캐릭터는 SMG 모드 중에도 계속 받을 것처럼 보인다.

실제로는 그렇지 않고, 그게 맞다(유저 확인, 2026-09-02): 예열을 쌓는 **RL 풀차지 5발
동안만** 받고 SMG 모드에서는 안 받는다.

계산기가 이미 그렇게 돈다. 다만 **의도해서라기보다 발사 경로가 갈려 있어서**다 —
투사체 폭발 플래그는 `_charge_fire`에서만 세우고, 모드 중 SMG 연사는 그 길을 지나지
않는다. 경로를 손대면 조용히 깨질 수 있어 여기서 못 박는다.
"""

from __future__ import annotations

import unittest

from calculator.timeline import simulate
from context import spec as char_spec

NAME = "라플라스 : 얼티밋 히어로"
#: 예열 5중첩이 차는 시각. 이 앞이 RL 풀차지, 뒤가 SMG 연사다.
_MODE_START = 4.15


class LaplaceUltimateHeroModeTest(unittest.TestCase):
    def _split(self, projectile_pct: float) -> tuple[list, list]:
        """(RL 차지 히트, SMG 모드 히트). 투사체 폭발 수치를 밖에서 얹어 준다."""
        squad = char_spec.build_squad([NAME], {})
        # 아군을 더 세우지 않고 이 항만 켜서 본다 — 다른 버프가 섞이면 배수를 못 읽는다.
        squad[0].setdefault("manual_stats", {})["projectile_explosion_dmg"] = projectile_pct
        result = simulate(squad, config={
            "duration": 12, "rng_mode": "expected",
            "enemy": {"def": 31784, "code": "", "core_px": 0},
        })
        hits = sorted(result.hits, key=lambda h: h.t)
        charge = [h for h in hits if h.t < _MODE_START - 0.01]
        smg = [h for h in hits if _MODE_START + 0.01 < h.t < 10.0]
        self.assertEqual(len(charge), 5, "예열은 풀차지 5발로 찬다")
        self.assertGreater(len(smg), 50, "모드에 들어가면 연사가 이어져야 한다")
        return charge, smg

    def test_projectile_explosion_lifts_the_charge_shots_only(self):
        """RL 풀차지만 정확히 배수만큼 오르고, SMG 모드 히트는 한 푼도 안 오른다."""
        base_charge, base_smg = self._split(0.0)
        up_charge, up_smg = self._split(50.0)

        avg = lambda hits: sum(h.damage for h in hits) / len(hits)  # noqa: E731

        # 투사체 폭발은 ③의 가산 항이라 50%면 딱 1.5배다.
        self.assertAlmostEqual(avg(up_charge) / avg(base_charge), 1.5, places=4)
        # SMG 모드는 이 항을 아예 안 탄다.
        self.assertAlmostEqual(avg(up_smg) / avg(base_smg), 1.0, places=9)

    def test_mode_fires_as_smg_and_ends_after_its_bullets(self):
        """모드 자체가 성립하는지도 함께 잡아 둔다 — 위 시험의 전제다."""
        _, smg = self._split(0.0)
        gaps = [round(b.t - a.t, 3) for a, b in zip(smg, smg[1:])]
        # SMG 20발/초 (유저 확인 — `parsed_skills.json`의 모드 note).
        self.assertEqual(set(gaps), {0.05}, f"연사 간격이 고르지 않다: {sorted(set(gaps))}")


if __name__ == "__main__":
    unittest.main()
