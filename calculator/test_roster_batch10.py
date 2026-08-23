import json,unittest
from pathlib import Path
from calculator.timeline import simulate
from context.spec import build_config,build_squad
R=Path(__file__).resolve().parents[1];B=['소라','베이','클레이','레이블','모리','백학','마키마','파워','히메노','2B']
def S():return json.loads((R/'data/parsed_skills.json').read_text(encoding='utf-8'))
class Batch10(unittest.TestCase):
 def test_registered(self):
  s=S();self.assertTrue(all(n in s for n in B));self.assertGreaterEqual(len([n for n in s if not n.startswith('test_')]),186)
 def test_specials(self):
  s=S();self.assertEqual(3,len([e for e in s['2B'] if e['source']=='스킬1']));self.assertTrue(any(e.get('stat')=='atk_from_hp_pct' for e in s['2B']));self.assertTrue(any(e.get('favorite')==3 for e in s['베이']));self.assertTrue(any(e.get('stat')=='armor_break_enabled' for e in s['클레이']))
 def test_simulate(self):
  cases=[('소라',['소라','크라운','test_B3']),('베이',['리틀 머메이드','베이','test_B3']),('클레이',['리틀 머메이드','클레이','test_B3']),('레이블',['레이블','크라운','test_B3']),('모리',['리틀 머메이드','모리','test_B3']),('백학',['리틀 머메이드','백학','test_B3']),('마키마',['리틀 머메이드','마키마','test_B3']),('파워',['리틀 머메이드','크라운','파워']),('히메노',['리틀 머메이드','히메노','test_B3']),('2B',['리틀 머메이드','크라운','2B'])]
  for n,m in cases:
   q=build_squad(m);r=simulate(q,config=build_config(q,{'first_burst_time':1,'duration':8}),seed=1);self.assertTrue(any(h.caster==n for h in r.hits),n)
