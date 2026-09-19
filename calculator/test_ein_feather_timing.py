import unittest
from calculator.buff_manager import BuffManager
from calculator.timeline import simulate
from context.spec import build_squad

class EinFeatherTimingTest(unittest.TestCase):
    def test_four_feathers_first_attack_after_4_16_seconds(self):
        bm = BuffManager(build_squad(['아인']), {'enemy': {}})
        bm.battle_start()
        st = bm.state['feathers']['아인']['니어 페더']
        self.assertAlmostEqual(st['next_t'], 4.16)

    def test_six_feathers_attack_36_times_in_first_burst_window(self):
        r = simulate(build_squad(['리틀 머메이드','크라운','아인','test_B3']),
                     config={'duration':13.3,'first_burst_time':3,'rng_mode':'expected'},
                     enemy={'code':'수냉','core_px':52})
        hits = [h for h in r.hits if h.caster == '아인' and h.skill_name == '니어 페더 공격']
        self.assertEqual(len(hits), 36)
        times = sorted(set(h.t for h in hits))
        self.assertEqual(len(times), 6)
        for a,b in zip(times,times[1:]):
            self.assertAlmostEqual(b-a, 1.6, delta=1/60+.001)

if __name__ == '__main__': unittest.main()
