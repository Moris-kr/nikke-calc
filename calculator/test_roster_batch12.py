import json, unittest
from pathlib import Path
from calculator.timeline import simulate
from context.spec import build_config, build_squad

R = Path(__file__).resolve().parents[1]
B = ['릴리', '쿠루미', '아이기스']

def data():
    return json.loads((R/'data/parsed_skills.json').read_text(encoding='utf-8'))

class Batch12(unittest.TestCase):
    def test_registered(self):
        skills = data()
        self.assertTrue(all(n in skills for n in B))
        # 정식 199 + 프리뷰 1(드레이크 : 그레이트 빌런 — 스킬 창작, PARSING-CHARS §프리뷰)
        self.assertEqual(len([n for n in skills if not n.startswith('test_')]), 200)

    def test_lily_and_aigis_contracts(self):
        skills = data()
        self.assertEqual(['every:15s'], skills['릴리'][0]['trigger']['timing'])
        self.assertIn('no_allies_cover_destroyed', skills['릴리'][-1]['trigger']['condition'])
        removals = [e for e in skills['아이기스'] if e['stat'] == 'remove_named_buff']
        self.assertEqual(2, len(removals))
        self.assertTrue(all(e['trigger']['timing'] == ['full_burst_end'] for e in removals))

    def test_kurumi_conditional_counter_emits_bonus(self):
        skills = data()
        payload = next(e for e in skills['쿠루미'] if e['name'] == '페이로드 확산')
        self.assertEqual(['conditional_hit_count:페이로드 확산:36'], payload['trigger']['timing'])
        squad = build_squad(['쿠루미', '크라운', 'test_B3'])
        result = simulate(squad, config=build_config(squad, {'first_burst_time': 1, 'duration': 12}), seed=1)
        self.assertTrue(any(h.skill_name == '페이로드 확산' for h in result.hits))

    def test_all_simulate(self):
        for name, names in [
            ('릴리', ['리틀 머메이드', '릴리', 'test_B3']),
            ('쿠루미', ['쿠루미', '크라운', 'test_B3']),
            ('아이기스', ['리틀 머메이드', '아이기스', 'test_B3']),
        ]:
            with self.subTest(name=name):
                squad = build_squad(names)
                result = simulate(squad, config=build_config(squad, {'first_burst_time': 1, 'duration': 16}), seed=1)
                self.assertTrue(any(h.caster == name for h in result.hits))
