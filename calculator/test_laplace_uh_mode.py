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

from calculator import timeline
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

    def test_the_mode_keeps_hitting_the_core(self):
        """SMG 모드도 코어를 그대로 맞힌다 — 탄착군이 매우 좁기 때문이다.

        코어 명중은 **지금 들고 있는 무기**의 탄착군으로 따지므로, 무기군 기본값을
        그대로 쓰면 이 모드는 SMG 110px이 되어 코어 52px 명중률이 15%로 떨어진다.
        그러면 코어를 켜고 꺼도 이 캐릭터만 딜이 거의 안 움직인다(피드백 2026-09-03).
        실제로는 모드의 탄착군이 매우 좁아 **명중 100%로 본다**(유저 확인, 2026-09-04) —
        실측은 `weapon_delays._weapon_change`에 적고 엔진은 명중률 하한으로 받는다.
        """
        squad = char_spec.build_squad([NAME], {})
        result = simulate(squad, config={"duration": 12, "rng_mode": "expected"},
                          enemy={"def": 31784, "code": "", "core_px": 52})
        hits = sorted((h for h in result.hits if h.core_frac is not None), key=lambda h: h.t)
        charge = [h for h in hits if h.t < _MODE_START - 0.01]
        smg = [h for h in hits if _MODE_START + 0.01 < h.t < 10.0]
        self.assertEqual([h.core_frac for h in charge], [1.0] * 5)
        self.assertEqual([h.core_frac for h in smg], [1.0] * len(smg))

    def test_the_narrow_spread_is_data_not_a_weapon_class_default(self):
        """하한을 빼면 SMG 무기군 기본 탄착군으로 되돌아간다 — 값의 출처를 못 박는다."""
        squad = char_spec.build_squad([NAME], {})
        delays = timeline._DELAYS["_weapon_change"][NAME]["일렉트릭 파워 풀 풀 차지"]
        floor = delays.pop("accuracy_pct")
        try:
            result = simulate(squad, config={"duration": 12, "rng_mode": "expected"},
                              enemy={"def": 31784, "code": "", "core_px": 52})
        finally:
            delays["accuracy_pct"] = floor
        smg = [h for h in result.hits
               if h.core_frac is not None and _MODE_START + 0.01 < h.t < 10.0]
        # SMG 탄착군 110px · 코어 52px → (26/55)^2.55 ≈ 0.148.
        self.assertAlmostEqual(smg[0].core_frac, 0.148, places=3)

    def test_mode_fires_as_smg_and_ends_after_its_bullets(self):
        """모드 자체가 성립하는지도 함께 잡아 둔다 — 위 시험의 전제다."""
        _, smg = self._split(0.0)
        gaps = [round(b.t - a.t, 3) for a, b in zip(smg, smg[1:])]
        # SMG 20발/초 (유저 확인 — `parsed_skills.json`의 모드 note).
        self.assertEqual(set(gaps), {0.05}, f"연사 간격이 고르지 않다: {sorted(set(gaps))}")


if __name__ == "__main__":
    unittest.main()
