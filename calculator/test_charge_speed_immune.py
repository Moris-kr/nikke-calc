"""차지 속도 «효과» 면역은 스킬로 걸린 것만 막는다.

리버렐리오의 `[차지 속도 증가 효과 면역]`이 **장비 오버로드·큐브까지** 막고 있었다.
대괄호의 «효과»는 버프 칸에 서는 상태 효과를 가리키고, 장비 옵션·큐브는 효과가 아니라
스탯이다 — 면역·해제의 대상이 아니다 (`context/GAMEPLAY.md` §차지 속도 증가·감소 효과 면역).

하네스가 리버렐리오에게 차지속도 9.26%를 입혀 두고도 딜이 한 번도 안 움직였던 것이
이 버그의 신호였다.
"""
import unittest

from calculator.timeline import simulate
from context.spec import build_config, build_squad

SQUAD = ["리버렐리오", "크라운", "리타", "노아"]


def _shots(chars=None) -> tuple[float, int]:
    squad = build_squad(SQUAD, chars=chars)
    cfg = build_config(squad, {"duration": 60, "rng_mode": "expected"})
    result = simulate(squad, config=cfg, enemy={"code": "", "core_px": 0})
    fired = sum(1 for hit in result.hits if hit.caster == "리버렐리오")
    return result.char_total["리버렐리오"], fired


class ChargeSpeedImmuneTest(unittest.TestCase):
    def test_gear_charge_speed_still_counts(self):
        none = {"리버렐리오": {"equip_skills": {"charge_speed_pct": 0.0}}}
        geared = {"리버렐리오": {"equip_skills": {"charge_speed_pct": 30.0}}}
        (slow_total, slow_shots) = _shots(none)
        (fast_total, fast_shots) = _shots(geared)
        # 차지가 빨라진 만큼 더 쏘고, 더 때린다.
        self.assertGreater(fast_shots, slow_shots)
        self.assertGreater(fast_total, slow_total)

    def test_cube_charge_speed_still_counts(self):
        """큐브 값도 살아 있다. 15레벨이 2.12%뿐이라 발수는 그대로일 수 있어 합계로 본다."""
        from calculator.buff_manager import BuffManager

        def charge_speed(cube: str) -> float:
            squad = build_squad(SQUAD, chars={
                "리버렐리오": {
                    "equip_skills": {"charge_speed_pct": 0.0},
                    "cube": {"name": cube, "level": 15},
                },
            })
            manager = BuffManager(squad)
            manager.battle_start(0.0)
            return manager.get_buffs("리버렐리오", "__enemy__", 1.0)["charge_speed_pct"]

        self.assertEqual(charge_speed("렐릭 베어 큐브"), 0.0)
        self.assertAlmostEqual(charge_speed("렐릭 부스트 큐브"), 2.12, places=4)

    def test_skill_charge_speed_is_still_blocked(self):
        """스킬로 걸리는 차지 속도는 여전히 막힌다 — 면역이 사라진 것이 아니다."""
        from calculator.buff_manager import BuffManager

        squad = build_squad(SQUAD)
        manager = BuffManager(squad)
        manager.battle_start(0.0)
        # 스킬로 건 차지 속도 +50%를 억지로 얹는다(출처 태그 없음 = 스킬).
        manager._activate({
            "type": "buff",
            "name": "시험용 차지 속도",
            "trigger": {"timing": ["battle_start"], "condition": []},
            "target": "self",
            "stat": "charge_speed_pct",
            "polarity": "beneficial",
            "fixed_value": 50.0,
            "duration": None,
        }, "리버렐리오", 0.0)

        buffs = manager.get_buffs("리버렐리오", "__enemy__", 1.0)
        self.assertTrue(buffs["charge_speed_buff_immune"])
        # 장비 9.26%는 남고 스킬 50%는 빠진다.
        self.assertLess(buffs["charge_speed_pct"], 50.0)


if __name__ == "__main__":
    unittest.main()
