"""Published Sin Lv10 preview contracts; not an in-game performance verification."""
import unittest
from unittest.mock import patch
from calculator.buff_manager import BuffManager
from calculator.timeline import CharState, simulate
from context.spec import build_squad, build_config

NAME = '신 : 스위프트 바니'
GUILTY = '길티 : 마이티 바니'
SQUAD = ['리틀 머메이드', '크라운', NAME, 'test_B3']
PAIR = ['리틀 머메이드', '크라운', NAME, GUILTY]

def run(mode='engage', duration=60, extra=None):
    chars = build_squad(SQUAD, chars={NAME: {'control': {'bunny_mode': mode}, **(extra or {})}})
    return simulate(chars, config=build_config(chars, {'duration': duration, 'rng_mode': 'expected'}),
                    enemy={'def':31784,'code':'','core_px':0}, verbose=True)

class SinBunnyTest(unittest.TestCase):
    def test_full_charge_buff_applies_one_shot_and_excludes_carrot(self):
        bm = BuffManager(build_squad([NAME]), {'enemy': {}}); bm.battle_start()
        before = bm.get_buffs(NAME, '', 0)
        bm.notify('full_charge', 1, NAME)
        charged = bm.get_buffs(NAME, '', 1)
        self.assertAlmostEqual(charged['normal_atk_dmg_pct']-before['normal_atk_dmg_pct'], 100)
        self.assertAlmostEqual(charged['charge_dmg_pct']-before['charge_dmg_pct'], 52.12)
        bm.notify('burst_cast', 2, NAME)
        # Fresh manager avoids pretending a charged normal shot was never consumed.
        bm = BuffManager(build_squad([NAME]), {'enemy': {}}); bm.battle_start()
        bm.notify('burst_cast', 2, NAME); baseline=bm.get_buffs(NAME,'',2)
        bm.notify('full_charge', 2.5, NAME)
        self.assertEqual(bm.get_buffs(NAME,'',2.5)['normal_atk_dmg_pct'],baseline['normal_atk_dmg_pct'])
        result=run(duration=5)
        buffs=[e for e in result.log.buff_events if e.name=='바니 시프트 2']
        self.assertEqual(sum(e.kind=='activate' for e in buffs),sum(e.kind=='expire' for e in buffs))

    def test_modes_and_paired_propagation(self):
        bm=BuffManager(build_squad(PAIR), {'enemy':{}}); bm.battle_start()
        before=bm.get_buffs(NAME,'',0)
        bm.notify('charge_hold:1',2,NAME)
        after=bm.get_buffs(NAME,'',2)
        self.assertTrue(after['armor_break_enabled']); self.assertFalse(before['armor_break_enabled'])
        self.assertAlmostEqual(before['crit_rate']-after['crit_rate'],0.3514)
        self.assertAlmostEqual(before['crit_dmg']-after['crit_dmg'],75.12)
        self.assertEqual(bm.state['bunny_modes'][GUILTY],'engage')
        bm.notify('burst_cast',3,NAME); bm.notify('charge_hold:1',4.5,NAME)
        self.assertEqual(bm.state['bunny_modes'][NAME],'stance')  # unlike Mighty Stomp, Carrot allows it
        self.assertEqual(bm.state['bunny_modes'][GUILTY],'stance')

    def test_paired_default_controls_do_not_toggle_twice_in_same_frame(self):
        for names in (PAIR, [*PAIR[:2], GUILTY, NAME]):
            chars=build_squad(names)
            result=simulate(chars,config=build_config(chars,{'duration':60,'rng_mode':'expected'}),
                            enemy={'def':31784,'code':'','core_px':0},verbose=True)
            for name in (NAME,GUILTY):
                modes=[e.name for e in result.log.buff_events if e.target==name and
                       e.kind=='activate' and e.name.startswith('바니 모드 :')]
                self.assertEqual(modes,['바니 모드 : 스탠스','바니 모드 : 인게이지'])

    def test_two_bursts_fixed_charge_duration_and_mode_specific_damage(self):
        for mode,chosen,excluded in [('engage','스위프트 피어싱 4','스위프트 피어싱 3'),('stance','스위프트 피어싱 3','스위프트 피어싱 4')]:
            with self.subTest(mode=mode):
                shots=[];original=CharState._tick_weapon_change
                def spy(cs,t,bm,enemy,cfg,effect):
                    events=original(cs,t,bm,enemy,cfg,effect)
                    if cs.name==NAME and events:shots.append((t,bm.get_buffs(NAME,'',t)))
                    return events
                with patch.object(CharState,'_tick_weapon_change',spy):
                    result=run(mode,extra={'equip_skills':{'charge_speed_pct':90}})
                bursts=[e for e in result.log.burst_log if e.caster==NAME and e.event=='stage:3 사용']
                self.assertGreaterEqual(len(bursts),2)
                hits=[h for h in result.hits if h.caster==NAME]
                self.assertEqual(sum(h.skill_name==chosen for h in hits),len(bursts))
                self.assertFalse(any(h.skill_name==excluded for h in hits))
                self.assertEqual(sum(h.skill_name=='스위프트 피어싱 2' for h in hits),len(bursts))
                for burst in bursts:
                    window=[(t,b) for t,b in shots if burst.t<=t<burst.t+5]
                    self.assertGreater(len(window),1)
                    self.assertAlmostEqual(window[0][0]-burst.t,0.5,delta=1/30)
                    for t,b in window:
                        self.assertTrue(b['charge_time_fixed'])
                        self.assertEqual(b['charge_speed_pct'],0)
                    self.assertTrue(any(h.skill_name=='기본 공격' and burst.t+5<h.t<burst.t+7 for h in hits))
                timed=[e for e in result.log.buff_events if e.name=='스위프트 피어싱' and e.kind=='activate']
                self.assertTrue(all(abs(e.expires_at-e.t-5)<1e-8 for e in timed))

if __name__=='__main__': unittest.main()
