import json, unittest
from pathlib import Path
from calculator.timeline import simulate
from context.spec import build_config, build_squad

ROOT=Path(__file__).resolve().parents[1]
BATCH=['네로','비스킷','라이','길티','신','퀀시','노이즈','아리아','아비스타','일레그']
def skills(): return json.loads((ROOT/'data/parsed_skills.json').read_text(encoding='utf-8'))
def find(n, name): return next(e for e in skills()[n] if e.get('name')==name)

class Batch09(unittest.TestCase):
 def test_registered(self):
  s=skills(); self.assertTrue(all(n in s for n in BATCH)); self.assertGreaterEqual(len([n for n in s if not n.startswith('test_')]),176)
 def test_contracts(self):
  self.assertEqual(['every:8s'],find('퀀시','은밀한 공범자')['trigger']['timing'])
  self.assertEqual('allies_named:아니스 : 스타',find('아비스타','애프터 쇼')['target'])
  self.assertEqual(5,find('네로','고양이 보은 2')['max_stack'])
  self.assertEqual('atk_copy',find('길티','빌려 갈게에….')['stat'])
  self.assertEqual('split_dmg_pct',find('일레그','붐 인스톨')['stat'])
 def test_simulate(self):
  cases=[('네로',['리틀 머메이드','네로','test_B3']),('비스킷',['리틀 머메이드','비스킷','test_B3']),('라이',['라이','크라운','test_B3']),('길티',['리틀 머메이드','길티','test_B3']),('신',['리틀 머메이드','신','test_B3']),('퀀시',['리틀 머메이드','퀀시','test_B3']),('노이즈',['노이즈','크라운','test_B3']),('아리아',['리틀 머메이드','아리아','test_B3']),('아비스타',['아비스타','리틀 머메이드','test_B3','아니스 : 스타']),('일레그',['리틀 머메이드','일레그','test_B3'])]
  for n,m in cases:
   with self.subTest(n=n):
    q=build_squad(m); r=simulate(q,config=build_config(q,{'first_burst_time':1,'duration':8}),seed=1); self.assertTrue(any(h.caster==n for h in r.hits))
