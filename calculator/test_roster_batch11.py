import json, unittest
from pathlib import Path
from calculator.timeline import simulate
from context.spec import build_config, build_squad

R = Path(__file__).resolve().parents[1]
B = ['트로니','A2','파스칼','렘','에밀리아','람','마리','미사토','사쿠라 (SR)','클레어']

def skills():
    return json.loads((R/'data/parsed_skills.json').read_text(encoding='utf-8'))

class Batch11(unittest.TestCase):
    def test_registered(self):
        data = skills()
        self.assertTrue(all(name in data for name in B))
        self.assertGreaterEqual(len([n for n in data if not n.startswith('test_')]), 196)

    def test_special_contracts(self):
        data = skills()
        bomb = next(e for e in data['트로니'] if e['stat'] == 'damage_accumulate')
        self.assertEqual(bomb['trigger']['timing'], ['full_charge_hit'])
        self.assertEqual(bomb['accumulate_ratio_pct'], 50)
        fixed = next(e for e in data['에밀리아'] if e['stat'] == 'fixed_damage_from_dealt_pct')
        self.assertEqual(fixed['trigger']['timing'], ['full_charge_hit'])
        mari = [e for e in data['마리'] if e['name'].startswith('정신 집중')]
        self.assertTrue(mari and all(e['trigger']['timing'] == ['every:10s'] for e in mari))

    def test_every_character_simulates(self):
        meta_all = json.loads((R/'data/parsed_nikke.json').read_text(encoding='utf-8'))
        for name in B:
            with self.subTest(name=name):
                stage = str(meta_all[name]['burst_stage'])
                if stage == '1': squad_names = [name, '크라운', 'test_B3']
                elif stage == '2': squad_names = ['리틀 머메이드', name, 'test_B3']
                else: squad_names = ['리틀 머메이드', '크라운', name]
                squad = build_squad(squad_names)
                result = simulate(squad, config=build_config(squad, {'first_burst_time': 1, 'duration': 15}), seed=1)
                self.assertTrue(any(h.caster == name for h in result.hits), name)

    def test_emilia_fixed_damage_is_emitted(self):
        squad = build_squad(['리틀 머메이드', '크라운', '에밀리아'])
        result = simulate(squad, config=build_config(squad, {'first_burst_time': 1, 'duration': 12}), seed=1)
        fixed = [h for h in result.hits if h.caster == '에밀리아' and h.hit_tag == 'fixed_damage_from_dealt_pct']
        self.assertTrue(fixed)
