import copy
import unittest

import importlib.util
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'site/pybridge/growth_comparison.py'
spec = importlib.util.spec_from_file_location('growth_comparison', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GrowthComparisonTests(unittest.TestCase):
    def test_partial_cube_changes_preserve_the_equipped_cube(self):
        from nikke_mcp.models import GrowthScenario
        scenario = GrowthScenario.model_validate({'label': '큐브 10', 'changes': {'cube': {'level': 10}}})
        result = module.compare_growth({'name': '민트',
            'baseline': {'cube': {'name': '렐릭 베어 큐브', 'level': 5}},
            'scenarios': [scenario.model_dump(exclude_unset=True, exclude_none=True)]})
        cube = result['scenarios'][0]['effectiveCharacter']['cube']
        self.assertEqual(cube['name'], '렐릭 베어 큐브')
        self.assertEqual(cube['level'], 10)

    def test_real_growth_result_passes_relay_roundtrip(self):
        from nikke_mcp.browser_relay import BrowserRelay
        relay = BrowserRelay()
        session = relay.connect()
        scenarios = [{'label': 'SR5', 'changes': {'collection': {'stage': 'SR5'}}}]
        job = relay.submit(session['connectionCode'], {'kind': 'growth', 'name': '민트', 'scenarios': scenarios})
        relay.poll(session['browserToken'])
        result = module.compare_growth({'name': '민트', 'baseline': {'collection': {'stage': 'R15'}}, 'scenarios': scenarios})
        result['engineVersion'] = 'test'
        relay.finish(session['browserToken'], job['jobId'], result=result)
        self.assertEqual(relay.result(session['connectionCode'], job['jobId'])['status'], 'complete')

    def test_independent_scenarios_preserve_current_growth(self):
        request = {'name': '민트', 'synchroLevel': 250,
                   'baseline': {'growthStage': 0, 'equipLevels': {'머리': 0, '팔': 0, '몸통': 0, '다리': 0},
                                'collection': {'stage': 'R15', 'favorite': 0},
                                'skillLevels': {'1': 4, '2': 5, '3': 6}},
                   'scenarios': [{'label': '장비 4310', 'changes': {'equipLevels': {'머리': 4, '팔': 3, '몸통': 1, '다리': 0}}},
                                 {'label': 'SR5', 'changes': {'collection': {'stage': 'SR5'}}},
                                 {'label': 'SR15', 'changes': {'collection': {'stage': 'SR15'}}}]}
        original = copy.deepcopy(request)
        result = module.compare_growth(request)
        self.assertEqual(request, original)
        self.assertGreater(result['scenarios'][0]['delta'], 0)
        # R15 -> SR5 can decrease CP: grade alone does not guarantee a gain.
        self.assertLess(result['scenarios'][1]['delta'], 0)
        self.assertGreater(result['scenarios'][2]['combatPower'], result['scenarios'][1]['combatPower'])
        self.assertEqual(result['scenarios'][1]['effectiveCharacter']['equipment']['머리']['level'], 0)
        self.assertEqual(result['scenarios'][0]['effectiveCharacter']['collection_stage'], 'R15')
        self.assertEqual(result['scenarios'][0]['effectiveCharacter']['level'], 250)
        self.assertEqual(result['baseline']['effectiveCharacter']['skill_levels']['1'], 4)
        self.assertAlmostEqual(result['scenarios'][0]['delta'],
                               result['scenarios'][0]['combatPower'] - result['baseline']['combatPower'], places=2)

    def test_invalid_and_missing_baselines_do_not_silently_default(self):
        for request in [ {'name': '민트', 'baseline': {}, 'scenarios': []},
                         {'name': '민트', 'baseline': {'growthStage': 0}, 'scenarios': [
                             {'label': 'bad', 'changes': {'equipLevels': {'머리': 6}}}]} ]:
            with self.assertRaises(ValueError):
                module.compare_growth(request)
