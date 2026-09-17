"""Published Lv10 bunny modes and SR-to-SR one-shot contracts."""
import unittest
from unittest.mock import patch
from calculator.buff_manager import BuffManager
from calculator.timeline import CharState, simulate
from context.spec import build_squad, build_config

NAME = '길티 : 마이티 바니'
SQUAD = ['리틀 머메이드', '크라운', NAME, 'test_B3']

def run(mode='engage', defense=31784, duration=12, squad=None, extra=None):
    override = {'control': {'bunny_mode': mode}, **(extra or {})}
    chars = build_squad(squad or [NAME], chars={NAME: override})
    return simulate(chars, config=build_config(chars, {'duration': duration, 'rng_mode': 'expected'}),
                    enemy={'def': defense, 'code': '', 'core_px': 0}, verbose=True)

class GuiltyBunnyTest(unittest.TestCase):
    def test_initial_stance_then_one_delayed_engage_transition(self):
        stance, engage = run('stance'), run()
        shots = lambda r: [h for h in r.hits if h.caster == NAME and h.skill_name == '기본 공격']
        self.assertAlmostEqual(shots(engage)[0].t-shots(stance)[0].t, 1, delta=1/30)
        transitions = [e for e in engage.log.buff_events if e.name == '바니 모드 : 인게이지' and e.kind == 'activate']
        self.assertEqual(len(transitions), 1)
        self.assertFalse(any(h.skill_name == '체인 인헨스 3' for h in engage.hits))
        self.assertFalse(any(h.skill_name == '체인 릴리즈 2' for h in stance.hits))

    def test_engage_ignores_defense_but_stance_does_not(self):
        self.assertEqual(run(defense=0).char_total[NAME], run(defense=100000).char_total[NAME])
        self.assertGreater(run('stance', defense=0).char_total[NAME], run('stance', defense=100000).char_total[NAME])

    def test_mode_effects_exclusive_and_only_mode_holders_propagate(self):
        bm = BuffManager(build_squad(SQUAD), {'enemy': {}}); bm.battle_start()
        before = bm.get_buffs(NAME, "", 0)
        bm.state['bunny_modes']['크라운'] = 'stance'
        bm.notify('charge_hold:1', 2, NAME)
        after = bm.get_buffs(NAME, "", 2)
        self.assertTrue(after['armor_break_enabled']); self.assertFalse(before['armor_break_enabled'])
        self.assertAlmostEqual(before['atk_dmg_pct'] - after['atk_dmg_pct'], 20.45)
        self.assertAlmostEqual(before['charge_dmg_pct'] - after['charge_dmg_pct'], 40)
        self.assertEqual(bm.state['bunny_modes']['크라운'], 'engage')
        self.assertNotIn('리틀 머메이드', bm.state['bunny_modes'])
        bm.notify('burst_cast', 3, NAME)
        bm.notify('charge_hold:1', 5, NAME)
        self.assertEqual(bm.state['bunny_modes'][NAME], 'engage')
        bm.end_weapon_change(NAME, 6)
        bm.notify('charge_hold:1', 7, NAME)
        self.assertEqual(bm.state['bunny_modes'][NAME], 'stance')
        self.assertEqual(bm.state['bunny_modes']['크라운'], 'stance')

    def test_burst_is_fixed_charge_one_sr_shot_even_with_ammo_and_speed(self):
        observed = []
        original = CharState._tick_weapon_change
        def spy(cs, t, bm, enemy, cfg, effect):
            events = original(cs, t, bm, enemy, cfg, effect)
            if cs.name == NAME and events:
                observed.append((t, effect['weapon_type'], bm.get_weapon_change(NAME)))
            return events
        with patch.object(CharState, '_tick_weapon_change', spy):
            result = run(duration=60, squad=SQUAD, extra={'equip_skills': {'charge_speed_pct': 90, 'max_ammo_pct': 500}})
        bursts = [e for e in result.log.burst_log if e.caster == NAME and e.event == 'stage:3 사용']
        self.assertGreaterEqual(len(bursts), 2)
        self.assertEqual(len(observed), len(bursts))
        for (time, weapon, active), burst in zip(observed, bursts):
            self.assertEqual(weapon, 'SR'); self.assertIsNone(active)
            self.assertAlmostEqual(time - burst.t, 1.5, delta=1/30)
            same = [h for h in result.hits if h.caster == NAME and abs(h.t-time)<1e-8]
            self.assertEqual(len(same), 2)  # one normal shot + one mode-specific full-charge proc
        first = bursts[0].t
        expirations = [e for e in result.log.buff_events if e.name == '드디어 풀려났어…!' and e.kind == 'expire']
        self.assertAlmostEqual(expirations[0].t, observed[0][0], delta=1/30)
        timed = [e for e in result.log.buff_events if e.name == '드디어 풀려났어…! 2' and e.kind == 'activate']
        self.assertAlmostEqual(timed[0].expires_at-first, 10)

    def test_tap_fire_still_performs_initial_mode_hold(self):
        result = run(extra={'control': {'bunny_mode': 'engage', 'tap_fire': {'rate':3.6}}})
        transition = [e for e in result.log.buff_events if e.name == '바니 모드 : 인게이지' and e.kind == 'activate']
        self.assertEqual(len(transition), 1)
        self.assertGreaterEqual(transition[0].t, 2)

if __name__ == '__main__': unittest.main()
