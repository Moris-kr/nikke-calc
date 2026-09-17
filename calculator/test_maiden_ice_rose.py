"""Feedback regression: MP hit count and max-HP stacks both affect Maiden's burst."""
import unittest
from unittest.mock import patch

from calculator.buff_manager import BuffManager
from calculator.damage import calc_damage
from calculator.timeline import simulate
from context.spec import build_squad

NAME = '메이든 : 아이스 로즈'


class MaidenIceRoseTest(unittest.TestCase):
    def test_mp_accumulates_caps_at_twelve_and_is_read_before_consumption(self):
        bm = BuffManager(build_squad([NAME]), {'enemy': {}})
        bm.battle_start()
        counts = []
        bm.register_damage_handler(lambda eff, caster, t: counts.append(bm.ref_count(caster, 'MP')))
        bm.notify('burst_enter:1', 0, NAME)
        for i in range(20):
            bm.notify('full_burst_start', i + 1, NAME)
        self.assertEqual(bm.ref_count(NAME, 'MP'), 12)
        bm.notify('burst_cast', 22, NAME)
        self.assertEqual(counts, [12])
        self.assertEqual(bm.ref_count(NAME, 'MP'), 0)

    def test_burst_adds_ten_percent_of_final_max_hp_without_scaling_it_by_attack_buffs(self):
        original_notify = BuffManager.notify
        expected, observed = [], []
        casting = False

        def notify(bm, event, t, caster, **ctx):
            nonlocal casting
            previous = casting
            if caster == NAME and event == 'burst_cast':
                casting = True
                buffs = bm.get_buffs(NAME, '__enemy__', t)
                expected.append((buffs['atk_flat'] + bm.effective_max_hp(NAME) * .1, bm.ref_count(NAME, 'MP')))
            try:
                return original_notify(bm, event, t, caster, **ctx)
            finally:
                casting = previous

        def damage(**kwargs):
            if casting and kwargs['hit_type'].get('is_sequential'):
                observed.append(kwargs['buffs']['atk_flat'])
            return calc_damage(**kwargs)

        squad = build_squad(['리타', '크라운', '신데렐라', NAME, '나가'])
        sequence = [{'1': ['리타'], '2': ['크라운'], '3': ['신데렐라']}] * 2
        sequence += [{'1': ['리타'], '2': ['크라운'], '3': [NAME]}]
        with patch.object(BuffManager, 'notify', notify), patch('calculator.timeline.calc_damage', damage):
            simulate(squad, config={'duration': 60, 'rng_mode': 'expected', 'burst_sequence': sequence}, seed=42)
        self.assertEqual(len(expected), 1)
        flat, mp = expected[0]
        self.assertEqual(mp, 3)
        self.assertEqual(len(observed), mp)
        for value in observed:
            self.assertAlmostEqual(value, flat)


if __name__ == '__main__':
    unittest.main()
