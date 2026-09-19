"""User-confirmed temporary SR magazine restoration contracts."""
import unittest
from unittest.mock import patch
from calculator.timeline import CharState, simulate
from context.spec import build_squad, build_config

class WeaponChangeRefillTest(unittest.TestCase):
    def test_full_magazine_without_reload_after_special_shots(self):
        for name in ['길티 : 마이티 바니', '신 : 스위프트 바니', '맥스웰']:
            for ammo_bonus in [0, 200]:
                with self.subTest(name=name, ammo_bonus=ammo_bonus):
                    exits=[]; shots=[]
                    original=CharState._tick_weapon_change
                    def observe(cs,t,bm,enemy,cfg,effect):
                        events=original(cs,t,bm,enemy,cfg,effect)
                        if cs.name==name:
                            if events: shots.append(t)
                            if bm.get_weapon_change(name) is None:
                                exits.append((cs.ammo,cs._full_ammo(bm,t),cs.reloading_until,cs._pending_auto_reload))
                        return events
                    chars=build_squad(['리틀 머메이드','크라운',name,'test_B3'],chars={name:{'equip_skills':{'max_ammo_pct':ammo_bonus}}})
                    with patch.object(CharState,'_tick_weapon_change',observe):
                        result=simulate(chars,config=build_config(chars,{'duration':60,'rng_mode':'expected'}),enemy={'def':31784,'code':'','core_px':0},verbose=True)
                    bursts=[e.t for e in result.log.burst_log if e.caster==name and e.event=='stage:3 사용']
                    self.assertGreaterEqual(len(bursts),2)
                    self.assertEqual(len(exits),len(bursts))
                    for ammo,capacity,reloading,pending in exits:
                        self.assertEqual(ammo,capacity)
                        self.assertLessEqual(reloading,0)
                        self.assertFalse(pending)
                    if name=='신 : 스위프트 바니':
                        for start in bursts:
                            window=[t for t in shots if start<=t<=start+5.02]
                            self.assertEqual(len(window),10)
                            self.assertAlmostEqual(window[-1]-start,5,delta=1/60+1e-8)

if __name__=='__main__': unittest.main()
