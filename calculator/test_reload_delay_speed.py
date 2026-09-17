"""재장전 앞뒤 딜레이는 재장전 «동작»의 일부다 — 속도 버프를 같이 탄다.

`reload_start_delay`(탄 소진 → 장전 시작)와 `post_reload_delay`(장전 완료 → 첫 발)는
60fps 영상에서 **버프 없는 상태로** 잰 값이다(`data/weapon_delays.json`). 그 값을 고정으로
두면 재장전 속도를 크게 받은 캐릭터가 손해를 두 번 본다 — 특히 장탄이 1발까지 줄어
매 발마다 재장전하는 경우 딜이 무너진다.

제보(2026-08-24): 아니스 : 스파클링 서머의 딜이 비정상적으로 낮다. 그는 버스트로
자기 최대 장탄을 73.92% 깎아 «마지막 탄환» 스킬을 자주 터뜨리는 설계라, 1발 상태에서
매 발 재장전한다. 고정 딜레이 0.4초를 매 발 물어 스쿼드 비중이 실측 42.1% → 시뮬
31.9%로 내려앉았다.
"""
import unittest

from calculator.timeline import simulate
from context.spec import build_config, build_squad

SQUAD = ['목단', '에이드 : 에이전트 바니', '아니스 : 스파클링 서머',
         '메이든 : 아이스 로즈', '프리바티']


def _run():
    squad = build_squad(SQUAD)
    cfg = build_config(squad, {'duration': 180, 'rng_mode': 'expected'})
    return simulate(squad, config=cfg, enemy={'code': '수냉', 'core_px': 52})


class ReloadDelayScalesWithSpeedTest(unittest.TestCase):
    def test_delay_shrinks_when_reload_is_buffed(self):
        """버프가 없으면 실측값 그대로, 버프를 받으면 그만큼 줄어든다."""
        from calculator.buff_manager import BuffManager
        from calculator.timeline import CharState

        squad = build_squad(['드레이크', '크라운', 'test_B3'])
        drake = next(c for c in squad if c['name'] == '드레이크')
        state = CharState(drake, 100000.0, '')
        bm = BuffManager(squad)

        # 버프 없음 → 실측값 그대로 (배수 1)
        self.assertEqual(1.0, state._reload_speed_factor(bm, 0.0))
        self.assertEqual(0.2, state.post_reload_delay)     # SG 실측값

        # 재장전 속도 +75% → 시간이 1/4로 줄고 앞뒤 딜레이도 같이 줄어든다
        bm.get_buffs = lambda *a, **k: {'reload_speed_pct': 75.0}
        self.assertAlmostEqual(0.25, state._reload_speed_factor(bm, 0.0))

    def test_one_round_reload_scales_both_delays_on_every_cycle(self):
        """1발 재장전의 앞뒤 지연을 실제 완료 시각으로 검증한다.

        제보의 아니스 42.1% · 메이든 35.2%는 동일 육성 자료 없이 순위 기준으로
        쓸 수 없다. 메이든의 누락된 HP 합산 피해를 복구해도 이 회귀 검증은 유효하다.
        """
        from calculator.buff_manager import BuffManager
        from calculator.timeline import CharState

        squad = build_squad(['아니스 : 스파클링 서머'])
        state = CharState(squad[0], 100000.0, '')
        bm = BuffManager(squad)
        bm.get_buffs = lambda *a, **k: {'reload_speed_pct': 75.0, 'max_ammo_pct': -100.0}
        self.assertGreater(state.reload_start_delay, 0)
        self.assertGreater(state.post_reload_delay, 0)
        start = 10.0
        for _ in range(2):
            state.ammo = 0
            state._start_reload(start, bm, from_empty=True)
            finish = start + (state.reload_start_delay + state.weapon['reload_time']) * .25
            self.assertAlmostEqual(state.reloading_until, finish)
            state._finish_reload(finish, bm)
            self.assertEqual(state.ammo, 1)
            self.assertAlmostEqual(state._post_reload_end_t, finish + state.post_reload_delay * .25)
            start = state._post_reload_end_t

    def test_last_bullet_skill_fires_often_at_one_round(self):
        """장탄이 1발로 줄면 «마지막 탄환»이 매 발 터진다 — 그게 이 캐릭터의 설계다."""
        result = _run()
        missiles = [h for h in result.hits
                    if h.caster == '아니스 : 스파클링 서머' and h.skill_name == '스파클링 미사일']
        self.assertGreater(len(missiles), 100, '스파클링 미사일 발동이 너무 적다')


if __name__ == '__main__':
    unittest.main()
