"""Regression cases adapted from Jgaram/nikke-calc engine fixes.

Upstream commits: 927a613 (bullet lifetime), 786b2ce (core-hit alias),
be5cfb9 (defender ally), ffb1a6e (one reentry per stage/cycle).
"""
import unittest

from calculator.buff_manager import BuffManager
from calculator.timeline import simulate
from context.spec import build_config, build_squad


class UpstreamRegressionTest(unittest.TestCase):
    def test_missile_guide_lasts_three_shots(self):
        name = '베스티 : 택티컬 업'
        bm = BuffManager(build_squad([name]))
        bm.battle_start()
        bm.notify('full_charge_hit', 1.0, name)
        for shot in range(3):
            self.assertGreaterEqual(bm.get_buffs(name, '__enemy__', 2.0 + shot).get('charge_speed_pct', 0), 100)
            bm.consume_bullet_buffs(name, 2.0 + shot)
        self.assertFalse(bm._has_self_state(name, '미사일 가이드'))

    def test_bullet_buff_does_not_log_expiry_when_condition_ends(self):
        name = '리타'
        bm = BuffManager(build_squad([name]))
        events = []
        bm.register_buff_event_handler(lambda *args: events.append(args))
        effect = {
            'source': '스킬1', 'type': 'buff', 'name': 'bullet lifetime regression',
            'trigger': {'timing': ['on_attack'], 'condition': ['during_full_burst']},
            'target': 'self', 'stat': 'atk_pct', 'fixed_value': 10,
            'duration': -1, 'duration_bullets': 3, 'max_stack': 1,
        }
        bm.state['full_burst'] = True
        bm._activate(effect, name, 1)
        bm.tick(1.1)
        bm.state['full_burst'] = False
        bm.tick(1.2)
        self.assertFalse([e for e in events if e[0] == 'expire'])
        self.assertEqual(10, bm.get_buffs(name, '__enemy__', 1.2)['atk_pct'])
        for t in (2, 3, 4):
            bm.consume_bullet_buffs(name, t)
        expired = [e for e in events if e[0] == 'expire']
        self.assertEqual(1, len(expired))
        self.assertEqual(4, expired[0][4])

    def test_defender_caster_does_not_count_as_ally(self):
        bm = BuffManager(build_squad(['크라운']))
        self.assertFalse(bm._condition_ok(['has_defender_ally'], '크라운', 0))
        self.assertTrue(bm._condition_ok(['no_defender_ally'], '크라운', 0))

    def test_core_hit_count_triggers_at_threshold_and_repeats(self):
        name = '길로틴 : 윈터 슬레이어'
        bm = BuffManager(build_squad([name]))
        bm.battle_start()
        for count in range(1, 7):
            bm.notify('core_hit', float(count), name)
            stacks = sum(ab.stack for ab in bm._active if ab.effect.get('name') == '경험치')
            self.assertEqual(count // 3, stacks)

    def test_defender_ally_selects_exclusive_delta_passive(self):
        name = '델타 : 닌자 시프'
        for ally, defender in [('리타', False), ('크라운', True)]:
            with self.subTest(ally=ally):
                bm = BuffManager(build_squad([name, ally]))
                bm.battle_start()
                self.assertEqual(not defender, bm._has_self_state(name, '주목'))
                self.assertEqual(defender, bm._has_self_state(name, '인법 인젝션'))

    def test_second_reentry_character_advances_to_full_burst(self):
        pair = ['아니스 : 스타', '티아']
        for first in (pair, pair[::-1]):
            with self.subTest(first=first[0]):
                squad = build_squad(first + ['크라운', 'test_B3'])
                result = simulate(squad, config=build_config(squad, {'first_burst_time': 1, 'duration': 8}), seed=1, verbose=True)
                full = [e for e in result.log.burst_log if e.event == 'full_burst 시작']
                self.assertEqual(1, len(full))
                self.assertLess(full[0].t, 3)


if __name__ == '__main__':
    unittest.main()
