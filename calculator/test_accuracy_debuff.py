"""Negative accuracy must reach both automatic and charged shot core calculations."""
import unittest
from collections import defaultdict
from unittest.mock import patch
from calculator.buff_manager import BuffManager
from calculator.timeline import CharState, _core_hit_prob, simulate
from context.spec import build_squad


class AccuracyDebuffTest(unittest.TestCase):
    def test_mast_intoxication_stacks_reach_accuracy_model(self):
        name = '마스트 : 로망틱 메이드'
        squad = build_squad([name])
        bm = BuffManager(squad, {'enemy': {}})
        bm.battle_start()
        bm.state['rng_acc'] = defaultdict(float)
        state = CharState(squad[0], 100000, '')
        enemy = {'def': 0, 'code': '', 'core_px': 90}
        for stacks in range(1, 4):
            bm.notify('burst_enter:1', stacks, name)
            accuracy = bm.get_buffs(name, '__enemy__', stacks)['accuracy_pct']
            self.assertLess(accuracy, 0)
            with patch('calculator.timeline._core_hit_prob', wraps=_core_hit_prob) as model:
                state._fire(stacks, bm, enemy, {'rng_mode': 'expected'})
            self.assertEqual(model.call_args.args[1], accuracy)

    def test_charged_shots_preserve_negative_accuracy(self):
        def core_share(accuracy):
            squad = build_squad(['메이든 : 아이스 로즈'])
            squad[0].setdefault('manual_stats', {})['accuracy_pct'] = accuracy
            with patch('calculator.timeline._core_hit_prob', wraps=_core_hit_prob) as model:
                simulate(squad, config={'duration': 3, 'rng_mode': 'expected'},
                         enemy={'def': 0, 'code': '', 'core_px': 5})
            return model.call_args.args[1]
        self.assertEqual(core_share(-60), -60)
