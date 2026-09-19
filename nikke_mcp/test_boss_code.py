import base64
import json
import unittest
from pathlib import Path

from pydantic import ValidationError
from nikke_mcp.boss_code import BossCodeRequest, create_boss_code
from mcp import Client
from nikke_mcp.server import create_server


def unpack(code):
    body = code[4:]
    return json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))


class BossCodeTests(unittest.TestCase):
    def test_frontend_compatibility_fixture_stays_current(self):
        fixture = json.loads((Path(__file__).resolve().parents[1] / 'site/src/fixtures/mcp-boss-code.json').read_text(encoding='utf-8'))
        result = create_boss_code(BossCodeRequest.model_validate(fixture['request']))
        self.assertEqual(result['code'], fixture['code'])

    def test_geometry_and_embedded_battle(self):
        request = BossCodeRequest.model_validate({
            'name': '시험 보스', 'settingsSource': 'battle',
            'shapes': [{'kind': 'rect', 'x': -0.5, 'y': 310, 'w': 200, 'h': 100,
                        'windows': [{'from': 0, 'to': 15.5}], 'range': ['SR', 'AR']}],
            'parts': [{'name': '왼팔', 'kind': 'circle', 'x': 100, 'y': 200, 'w': 40, 'h': 40, 'hp': 1234, 'score': 50}],
            'core': {'x': 480, 'y': 310, 'd': 52}, 'center': {'x': 480, 'y': 320},
            'aimKeys': [{'t': 0, 'x': 480, 'y': 310}, {'t': 10.5, 'x': 100, 'y': 200}],
            'battle': {'enemyDef': 100, 'enemyCode': '수냉', 'coreEnabled': True,
                       'burstReaction': 0.15, 'coreWindows': [{'from': 0, 'to': 10.5}]},
        })
        result = create_boss_code(request)
        raw = unpack(result['code'])
        self.assertEqual(raw['s'], [{'k': 1, 'x': 0, 'y': 310, 'w': 200, 'h': 100, 'v': [[0, 155]], 'g': ['AR', 'SR']}])
        self.assertEqual(raw['p'][0]['hp'], 1234)
        self.assertEqual(raw['a'][1], [105, 100, 200])
        self.assertEqual(raw['bs'], 'battle')
        self.assertEqual(unpack(raw['b']), {'ed': 100, 'ec': 2, 'ce': 1, 'rt': 15, 'cw': [[0, 105]]})

    def test_default_is_geometry_only_and_deterministic(self):
        request = BossCodeRequest(name='빈 보스')
        self.assertEqual(unpack(create_boss_code(request)['code']), {'n': '빈 보스'})
        self.assertEqual(create_boss_code(request), create_boss_code(request))

    def test_rl_normal_hit_coefficient_is_shared(self):
        request = BossCodeRequest.model_validate({'name': 'RL 계수', 'battle': {'normalHitCoeff': {'RL': 0.75}}})
        self.assertEqual(unpack(unpack(create_boss_code(request)['code'])['b']), {'hc': {'RL': 0.75}})

    def test_explicit_sg_one_is_not_lost_to_site_defaults(self):
        request = BossCodeRequest.model_validate({'name': 'SG 계수', 'battle': {'normalHitCoeff': {'SG': 1}}})
        self.assertEqual(unpack(unpack(create_boss_code(request)['code'])['b']), {'hc': {'SG': 1}})

    def test_rejects_unsupported_or_lossy_inputs(self):
        invalid = [
            {'settingsSource': 'battle'}, {'name': ' '}, {'image': 'url'},
            {'battle': {'synchroLevel': 400}}, {'battle': {'duration': 5}},
            {'battle': {'enemyDef': 1000000}}, {'core': {'x': 0, 'y': 0, 'd': 3}},
            {'aimKeys': [{'t': 2, 'x': 0, 'y': 0}, {'t': 1, 'x': 0, 'y': 0}]},
            {'shapes': [{'kind': 'rect', 'x': 0, 'y': 0, 'w': 4, 'h': 4, 'windows': [{'from': 1, 'to': 1.01}]}]},
            {'shapes': [{'kind': 'rect', 'x': float('nan'), 'y': 0, 'w': 4, 'h': 4}]},
        ]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValidationError):
                BossCodeRequest.model_validate({'name': '보스', **value})


class BossCodeProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_available_without_browser_and_invalid_input_fails(self):
        async with Client(create_server(browser_mode=True)) as client:
            tools = await client.list_tools()
            tool = next(t for t in tools.tools if t.name == 'create_boss_code')
            self.assertTrue(tool.annotations.read_only_hint)
            self.assertTrue(tool.annotations.idempotent_hint)
            result = await client.call_tool('create_boss_code', {'request': {'name': '시험'}})
            self.assertFalse(result.is_error)
            self.assertEqual(unpack(result.structured_content['code']), {'n': '시험'})
            invalid = await client.call_tool('create_boss_code', {'request': {'name': '시험', 'settingsSource': 'battle'}})
            self.assertTrue(invalid.is_error)
