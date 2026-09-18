import json
import sys
import unittest

from nikke_mcp.models import ROOT
from nikke_mcp.shared_state import SharedState, shared_request
from nikke_mcp.service import CalculatorService
from calculator.customization import CONSOLE_CLASSES, CONSOLE_COMPANIES


def snapshot():
    return {'format': 'nikke-calc-mcp', 'version': 1,
            'battle': {'duration': 10, 'synchroLevel': 321},
            'roster': {'리타': {'skillLevels': {'1': 4, '2': 5, '3': 6}}},
            'decks': [{'squad': ['리타'], 'duration': 10, 'synchroLevel': 456,
                       'characters': {'리타': {'skillLevels': {'1': 7, '2': 8, '3': 9}}}}]}


class SharedTests(unittest.IsolatedAsyncioTestCase):
    def test_deck_and_roster_remain_separate(self):
        state = SharedState.model_validate(snapshot())
        self.assertEqual(shared_request(state).synchroLevel, 456)
        req = shared_request(state, squad=['리타'])
        self.assertEqual(req.synchroLevel, 321)
        self.assertEqual(req.characters['리타'].skillLevels['1'], 4)
        with self.assertRaises(ValueError):
            shared_request(state, squad=['크라운'])
        for index in [0, -1, 2]:
            with self.assertRaises(ValueError):
                shared_request(state, deck_index=index)

    def test_rejects_version_private_metadata_and_unknown_settings(self):
        for patch in [{'version': 2}, {'nickname': 'private'}, {'format': 'backup'},
                      {'roster': {'missing': {}}}, {'battle': {'console': {'common_level': -1}}},
                      {'battle': {'hacks': {}}}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                SharedState.model_validate({**snapshot(), **patch})

    async def test_account_growth_matches_web_and_effective_characters(self):
        data = snapshot()
        data['decks'][0].update({
            'console': {'common_level': 90,
                        'class_level': {name: 30 for name in CONSOLE_CLASSES},
                        'company_level': {name: 50 for name in CONSOLE_COMPANIES}},
            'burstRegenTime': 3, 'burstReaction': .2,
            'immuneWindows': [{'from': 2, 'to': 3}],
            'defenseRateWindows': [{'from': 6, 'to': 8, 'rate': 60}],
            'elementWindows': [{'from': 4, 'to': 5, 'code': '철갑'}],
            'normalHitCoeff': {'SMG': .8}, 'optimalRangeWeapons': ['SMG'],
            'burstSequence': [{'1': ['리타']}],
            'characters': {'리타': {'growthStage': 2, 'skillLevels': {'1': 7, '2': 8, '3': 9},
                                    'cube': {'name': '없음', 'level': 0},
                                    'collection': {'stage': 'SR5', 'favorite': 0},
                                    'equipLevels': {'머리': 3, '몸통': 2, '팔': 1, '다리': 0},
                                    'overload': {'atk_pct': 12}, 'control': {}}}})
        request = shared_request(SharedState.model_validate(data))
        out = await CalculatorService().simulate(request, detail=True)
        sys.path.insert(0, str(ROOT / 'site'))
        from pybridge.bridge import run_request
        self.assertEqual(out['result'], json.loads(run_request(request.model_dump_json(exclude_none=True))))
        self.assertEqual(out['effectiveCharacters'][0]['level'], 456)
        self.assertEqual(out['effectiveCharacters'][0]['console']['common_level'], 90)
        self.assertEqual(out['effectiveCharacters'][0]['burst_regen_time'], 3)
        self.assertEqual(out['request']['immuneWindows'], [{'from': 2, 'to': 3}])
        self.assertEqual(out['request']['defenseRateWindows'], [{'from': 6, 'to': 8, 'rate': 60}])


if __name__ == '__main__':
    unittest.main()
