"""Flora's 100 attacks add current stacks to electric allies, not stack caps."""
import unittest
from unittest.mock import patch
from calculator.timeline import simulate
from calculator import buff_manager as module
from context.spec import build_config
from calculator.buff_manager import BuffManager
from context.spec import build_squad

SQUAD=['리타','플로라','신데렐라','메이든 : 아이스 로즈','크라운']

class FloraStacksTest(unittest.TestCase):
    def manager(self, favorite=0):
        bm=BuffManager(build_squad(SQUAD,chars={'플로라':{'favorite_stage':favorite}}), {'enemy':{}})
        bm.battle_start()
        for name, buff in [('신데렐라','아름다움'),('메이든 : 아이스 로즈','메디테이션 3')]:
            effect=next(e for e,c in bm._effects if c==name and e.get('name')==buff)
            bm._activate(effect,name,0)
        return bm

    def fire(self,bm,start=0,count=100):
        for i in range(start+1,start+count+1):bm.notify('hit_count',i/100,'플로라')

    def test_every_100_attacks_adds_actual_stacks_in_all_favorite_variants(self):
        for favorite in range(4):
            with self.subTest(favorite=favorite):
                bm=self.manager(favorite)
                self.fire(bm,count=99)
                self.assertEqual(bm.ref_count('신데렐라','아름다움'),1)
                self.assertEqual(bm.ref_count('메이든 : 아이스 로즈','메디테이션 3'),1)
                self.fire(bm,start=99,count=1)
                self.assertEqual(bm.ref_count('신데렐라','아름다움'),2)
                self.assertEqual(bm.ref_count('메이든 : 아이스 로즈','메디테이션 3'),2)
                self.fire(bm,start=100)
                self.assertEqual(bm.ref_count('신데렐라','아름다움'),3)
                for n,buff,cap in [('신데렐라','아름다움',12),('메이든 : 아이스 로즈','메디테이션 3',10)]:
                    e=next(e for e,c in bm._effects if c==n and e.get('name')==buff)
                    self.assertEqual(bm._effective_stack_cap(e,n,2),cap)

    def test_partial_electric_targets_do_not_boost_other_recipients(self):
        bm=self.manager()
        ab=next(a for a in bm._active if a.caster=='플로라' and a.effect.get('name')=='피튜니아 2')
        before={n:bm._get_value(ab.effect,ab,n) for n in SQUAD[:3]}
        self.fire(bm)
        after={n:bm._get_value(ab.effect,ab,n) for n in SQUAD[:3]}
        self.assertEqual(after['리타'],before['리타'])
        for n in ['플로라','신데렐라']:self.assertAlmostEqual(after[n]-before[n],4)
        e=next(e for e,c in bm._effects if c=='플로라' and e.get('name')=='피튜니아 2')
        bm._activate(e,'플로라',2)
        self.assertAlmostEqual(bm._get_value(ab.effect,ab,'리타')-before['리타'],4)
        self.assertAlmostEqual(bm._get_value(ab.effect,ab,'신데렐라')-before['신데렐라'],8)

    def test_real_battle_reaches_stacks_faster_and_changes_damage(self):
        def simulate_case(enabled):
            chars=build_squad(SQUAD)
            effects=module._PARSED_SKILLS['플로라']
            chosen=effects if enabled else [e for e in effects if e.get('stat')!='buff_stack_add']
            with patch.dict(module._PARSED_SKILLS, {'플로라':chosen}):
                return simulate(chars,config=build_config(chars,{'duration':60,'rng_mode':'expected'}),
                                enemy={'def':31784,'code':'','core_px':0},verbose=True)
        enabled,disabled=simulate_case(True),simulate_case(False)
        for name in ['신데렐라','메이든 : 아이스 로즈']:
            self.assertGreater(enabled.char_total[name],disabled.char_total[name])
        for name,buff in [('신데렐라','아름다움'),('메이든 : 아이스 로즈','메디테이션 3')]:
            def first_two(result):
                return min(e.t for e in result.log.buff_events if e.target==name and e.name==buff
                           and e.kind=='activate' and e.stack>=2)
            self.assertLess(first_two(enabled),first_two(disabled))

    def test_caps_and_missing_or_expired_stacks(self):
        bm=self.manager();self.fire(bm,count=2000)
        self.assertEqual(bm.ref_count('신데렐라','아름다움'),12)
        # Timed buff expired at t=15; the instant must not revive it without its own trigger.
        self.assertLessEqual(bm.ref_count('메이든 : 아이스 로즈','메디테이션 3'),10)
        bm.tick(21)
        self.fire(bm,start=2100)
        self.assertIsNone(bm.ref_count('메이든 : 아이스 로즈','메디테이션 3'))
        clean=BuffManager(build_squad(SQUAD),{'enemy':{}});clean.battle_start();self.fire(clean)
        self.assertIsNone(clean.ref_count('신데렐라','아름다움'))

if __name__=='__main__':unittest.main()
