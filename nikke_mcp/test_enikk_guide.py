import unittest
from mcp import Client
from nikke_mcp.server import create_server


class RecommendationGuideTests(unittest.IsolatedAsyncioTestCase):
    async def test_guide_is_available_without_browser_or_network(self):
        async with Client(create_server(browser_mode=True)) as client:
            tools = await client.list_tools()
            self.assertIn('get_recommendation_guide', [t.name for t in tools.tools])
            response = await client.call_tool('get_recommendation_guide', {'mode': 'soloraid'})
            self.assertFalse(response.is_error)
            guide = response.structured_content
            self.assertEqual(guide['dataAccess'], 'guidance_only')
            self.assertEqual(list(guide['modes']), ['soloraid'])
            self.assertEqual(guide['weaknessToEnemyCode']['Water'], '작열')
            self.assertIn('compare_setups', str(guide['workflow']))
            catalog = await client.call_tool('list_characters', {'query': '리타'})
            self.assertTrue(all(isinstance(row['resourceId'], int) for row in catalog.structured_content['characters']))

    async def test_overview_covers_modes_and_rejects_unknown_mode(self):
        async with Client(create_server()) as client:
            response = await client.call_tool('get_recommendation_guide', {})
            self.assertEqual(set(response.structured_content['modes']), {'meta', 'campaign', 'soloraid', 'unionraid'})
            bad = await client.call_tool('get_recommendation_guide', {'mode': 'unknown'})
            self.assertTrue(bad.is_error)
