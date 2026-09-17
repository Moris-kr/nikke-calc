import asyncio
import json
import sys
import unittest
from pathlib import Path

from pydantic import ValidationError

from nikke_mcp.models import CombatRequest
from nikke_mcp.service import CalculatorService, get_character, list_characters


BASE = {'squad': ['리타'], 'duration': 10}


class ValidationTests(unittest.TestCase):
    def test_invalid_or_ignored_inputs_are_rejected(self):
        for fields in [dict(duration=181), dict(duration=True), dict(duration=0),
                       dict(squad=['없는 캐릭터']), dict(squad=['리타', '리타']),
                       dict(customCharacters={}), dict(hacks={}), dict(corePx=float('nan')),
                       dict(characters={'크라운': {}}), dict(characters={'리타': {'skillLevels': {'1': 11}}})]:
            with self.subTest(fields=fields), self.assertRaises((ValidationError, ValueError)):
                CombatRequest.model_validate({**BASE, **fields})

    def test_nested_typos_and_unused_burst_fields_are_rejected(self):
        for burst in [{'mode': 'priority', 'evry': 2}, {'mode': 'skip', 'every': 2},
                      {'mode': 'endgame', 'seconds': True}]:
            with self.subTest(burst=burst), self.assertRaises(ValueError):
                CombatRequest.model_validate({**BASE, 'characters': {'리타': {'burst': burst}}})

    def test_character_schema_exposes_nested_options(self):
        schema = CombatRequest.model_json_schema()
        self.assertIn('CharacterOverrides', schema['$defs'])
        self.assertIn('control', schema['$defs']['CharacterOverrides']['properties'])

    def test_catalog_uses_real_characters_and_level_values(self):
        self.assertTrue(list_characters('리타')['characters'])
        self.assertFalse(any(row['name'].startswith('test_') for row in list_characters()['characters']))
        low = get_character('리타', 1)
        high = get_character('리타', 10)
        self.assertNotEqual(low['skills'], high['skills'])


class SimulationTests(unittest.IsolatedAsyncioTestCase):
    async def test_matches_web_bridge_and_reports_conditions(self):
        request = CombatRequest.model_validate({**BASE, 'characters': {'리타': {'cube': {'name': '없음', 'level': 0}}}})
        output = await CalculatorService().simulate(request, detail=True)
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'site'))
        from pybridge.bridge import run_request
        expected = json.loads(run_request(request.model_dump_json(exclude_none=True)))
        self.assertEqual(output['result'], expected)
        self.assertEqual(output['request']['characters']['리타']['cube']['name'], '없음')
        self.assertTrue(output['engineVersion'])
        self.assertIn('effectiveCharacters', output)

    async def test_compares_only_equal_battle_conditions(self):
        service = CalculatorService()
        a = CombatRequest.model_validate(BASE)
        b = CombatRequest.model_validate({**BASE, 'enemyDef': 1})
        with self.assertRaises(ValueError):
            await service.compare([a, b])
        result = await service.compare([a, a])
        self.assertEqual(result['candidates'][1]['deltaFromFirst'], 0)
        self.assertEqual(result['testedCandidates'], 2)

    async def test_concurrent_requests_do_not_share_equipment_and_five_member_result_matches(self):
        service = CalculatorService()
        base = {'squad': ['리타', '크라운', '신데렐라', '모더니아', '나가'], 'duration': 30}
        normal = CombatRequest.model_validate(base)
        changed = CombatRequest.model_validate({**base,
            'characters': {'신데렐라': {'cube': {'name': '없음', 'level': 0}}}})
        first, second = await asyncio.gather(service.simulate(normal, True), service.simulate(changed, True))
        again = await service.simulate(normal, True)
        self.assertEqual(first, again)
        self.assertNotEqual(first['result']['squadTotal'], second['result']['squadTotal'])
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'site'))
        from pybridge.bridge import run_request
        self.assertEqual(first['result'], json.loads(run_request(normal.model_dump_json(exclude_none=True))))

    async def test_timeout_is_reported_and_child_is_reaped(self):
        service = CalculatorService(timeout=.001)
        with self.assertRaises(TimeoutError):
            await service.simulate(CombatRequest.model_validate(BASE))


if __name__ == '__main__':
    unittest.main()
