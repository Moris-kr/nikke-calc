"""무기 변경 모드의 탄착군은 발사 무기군과 따로 정한다.

모드의 `weapon_type`은 **발사 방식**을 고르는 값이다 — 차지냐 연사냐, 주기가 얼마냐.
탄이 얼마나 퍼지는지(탄착군)까지 그 값을 따라갈 근거는 없는데, `_core_hit_prob`이
같은 값을 보는 바람에 한쪽을 정하면 다른 쪽이 딸려 왔다.

드레이크 : 그레이트 빌런의 「오버 오버 드라이브」가 그 자리다. 차지 발사를 쓰려고
무기군을 RL로 두었더니(시나리오 §해석 선언 — 「차징하는 샷건에 가깝지만 무기군은 RL로
둔다」) RL 탄착군 10px이 딸려 와, 코어가 20px만 돼도 **펠릿 15개가 전부 코어에 꽂혔다**.
코어 유무로 딜이 25% 뛰고 코어 크기는 거의 무의미해진다 — 피드백 2026-09-10이
「명중률 보정도 없는 샷건인데 전탄 코어 아니냐」로 짚은 것이 이것이다.

이제 탄착군은 `weapon_delays._weapon_change`의 `accuracy_weapon`이 정한다.
"""

from __future__ import annotations

import unittest

from calculator import timeline
from calculator.timeline import simulate
from context import spec as char_spec

NAME = "드레이크 : 그레이트 빌런"
#: 모드 한 발은 펠릿 15개로 갈라진다 — 같은 시각에 15히트가 선다.
MODE_PELLETS = 15


def _mode_core_share(core_px: int) -> float:
    """모드 사격(펠릿 15) 히트의 코어 몫 평균. 기본 무기 사격은 세지 않는다."""
    squad = char_spec.build_squad(["토브", "블랑", NAME, "민트", "루주"], {})
    result = simulate(squad, config={"duration": 60, "rng_mode": "expected"},
                      enemy={"def": 31784, "code": "", "core_px": core_px})
    at: dict[float, list] = {}
    for hit in result.hits:
        if hit.caster == NAME and hit.core_frac is not None:
            at.setdefault(round(hit.t, 3), []).append(hit)
    mode = [h for hits in at.values() if len(hits) == MODE_PELLETS for h in hits]
    assert mode, "모드 사격이 한 발도 없으면 이 시험은 의미가 없다"
    return sum(h.core_frac for h in mode) / len(mode)


class WeaponChangeSpreadTest(unittest.TestCase):
    def test_mode_pellets_spread_like_a_shotgun(self):
        """작은 코어에 펠릿이 다 꽂히지 않는다 — 샷건 탄착군(240px)으로 잰다."""
        # SG 240px · 코어 20px → (10/120)^2.55 ≈ 0.002. 사실상 안 맞는다.
        self.assertAlmostEqual(_mode_core_share(20), 0.002, places=3)
        # 코어가 커지면 그만큼 늘어난다 — 크기가 무의미하지 않다는 것이 요점이다.
        self.assertAlmostEqual(_mode_core_share(90), 0.082, places=3)

    def test_without_the_override_it_falls_back_to_the_mode_weapon(self):
        """값의 출처를 못 박는다 — 덮어쓰기를 빼면 RL 탄착군으로 되돌아간다."""
        delays = timeline._DELAYS["_weapon_change"][NAME]["오버 오버 드라이브"]
        kept = delays.pop("accuracy_weapon")
        try:
            # RL은 10px이라 20px 코어에도 전탄 명중이다 — 고치기 전의 그 값이다.
            self.assertEqual(_mode_core_share(20), 1.0)
        finally:
            delays["accuracy_weapon"] = kept

    def test_the_base_weapon_is_untouched(self):
        """기본 무기 사격은 종전 그대로 SG로 잰다 — 모드 밖은 건드리지 않았다."""
        squad = char_spec.build_squad([NAME], {})
        result = simulate(squad, config={"duration": 20, "rng_mode": "expected"},
                          enemy={"def": 31784, "code": "", "core_px": 90})
        shots = [h for h in result.hits if h.core_frac is not None]
        self.assertTrue(shots)
        # 혼자서는 풀 버스트가 없어 모드에 들지 않는다 — 전부 기본 SG 사격이다.
        self.assertTrue(all(abs(h.core_frac - 0.0821) < 0.001 for h in shots))


if __name__ == "__main__":
    unittest.main()
