"""Cross-cutting regression probes: shot lifecycle, cover healing and gauge model."""
import unittest
from unittest.mock import patch
from calculator.timeline import CharState, simulate
from calculator.buff_manager import BuffManager
from context.spec import build_squad, build_config


def run(names, duration=60, config=None):
    squad = build_squad(names)
    cfg = build_config(squad, {'duration': duration, 'rng_mode': 'expected', **(config or {})})
    return simulate(squad, config=cfg, enemy={'def': 31784, 'code': '', 'core_px': 0}, verbose=True)


class MechanicsAuditTest(unittest.TestCase):
    def test_special_exit_preserves_scheduled_post_shot_delay(self):
        for name in ['길티 : 마이티 바니', '맥스웰']:
            observed = []
            original = CharState._tick_weapon_change
            def trace(cs, t, bm, enemy, cfg, effect):
                events = original(cs, t, bm, enemy, cfg, effect)
                if cs.name == name and events and bm.get_weapon_change(name) is None:
                    observed.append((cs._charge_phase, cs._post_delay_end_t - t))
                return events
            with patch.object(CharState, '_tick_weapon_change', trace):
                run(['리틀 머메이드', '크라운', name, 'test_B3'])
            self.assertTrue(observed)
            for phase, delay in observed:
                self.assertGreater(delay, 0)
                self.assertEqual(phase, 'post_delay', name)

    def test_one_bullet_buffs_end_on_first_special_shot(self):
        for name in ['길티 : 마이티 바니', '신 : 스위프트 바니']:
            observed = []
            original = CharState._charge_fire
            def trace(cs, t, bm, enemy, cfg, *args, **kwargs):
                before = bm.get_buffs(cs.name, '__enemy__', t).copy()
                special = cs._in_weapon_change
                events = original(cs, t, bm, enemy, cfg, *args, **kwargs)
                after = bm.get_buffs(cs.name, '__enemy__', t).copy()
                if cs.name == name and special and events:
                    observed.append((before, after))
                return events
            with patch.object(CharState, '_charge_fire', trace):
                run(['미란다', '크라운', name, 'test_B3'], duration=15)
            self.assertTrue(observed)
            before, after = observed[0]
            self.assertGreater(before['crit_rate'], after['crit_rate'])
            if name == '길티 : 마이티 바니':
                self.assertAlmostEqual(before['charge_dmg_pct'] - after['charge_dmg_pct'], 1400)
            else:
                self.assertEqual(len(observed), 10)
                for before, after in observed[1:]:
                    self.assertLess(before['crit_rate'], observed[0][0]['crit_rate'])

    def test_cover_heal_sources_activate_tia(self):
        for healer in ['나가', '츠바이']:
            result = run(['티아', healer, '크라운', 'test_B3'], duration=35, config={'no_burst_chars': ['티아']})
            buffs = [e for e in result.log.buff_events if e.caster == '티아' and e.kind == 'activate']
            self.assertTrue(any(e.name == '파충류 애호가 2' for e in buffs), healer)
        squad = build_squad(['티아', 'test_B3'])
        bm = BuffManager(squad)
        bm.notify('event:cover_healed', 1, '티아')
        self.assertAlmostEqual(bm.get_buffs('test_B3', '__enemy__', 1)['atk_dmg_pct'], 32.11)
        bm.notify('event:cover_healed', 2, '티아')
        self.assertAlmostEqual(bm.get_buffs('티아', '__enemy__', 2)['burst_cooldown'], 26)
        self.assertEqual(bm.get_buffs('test_B3', '__enemy__', 13)['atk_dmg_pct'], 0)

    def test_mg_warmup_and_reload_preservation(self):
        squad = build_squad(['크라운'])
        cs = CharState(squad[0], 100000, '')
        bm = BuffManager(squad)
        bm.state['rng_acc'] = {}
        rates = []
        for i in range(43):
            rates.append(cs._current_fire_rate(bm, i / 60))
            cs._fire(i / 60, bm, {'core_px': 0}, {'rng_mode': 'expected'})
        self.assertAlmostEqual(rates[0], 1)
        self.assertAlmostEqual(rates[1], 1 + 100 / 60, places=4)
        self.assertAlmostEqual(rates[-1], 70)
        cs.last_fire_t = 0
        cs._last_inter = 1 / 60
        cs._cool_warmup(.5, bm)
        self.assertAlmostEqual(cs.warmup_shots, cs.warmup_bullets / 2)
        cs._cool_warmup(2, bm)
        self.assertEqual(cs.warmup_shots, 0)

    def test_shotgun_coefficient_does_not_change_fixed_gauge_schedule(self):
        results = [run(['리타', '크라운', '슈가', 'test_B3'], config={'normal_hit_coeff': {'SG': c}})
                   for c in [1, .5]]
        starts = [[e.t for e in r.log.burst_log if e.event == 'full_burst 시작'] for r in results]
        self.assertEqual(starts[0], starts[1])
        self.assertLess(results[1].char_total['슈가'], results[0].char_total['슈가'])


if __name__ == '__main__':
    unittest.main()
