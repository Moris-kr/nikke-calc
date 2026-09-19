import unittest
from unittest.mock import patch
from mcp import Client
from nikke_mcp.server import create_server

class BrowserGrowthTests(unittest.IsolatedAsyncioTestCase):
    async def test_goals_and_calculation_relay_without_engine_exchange(self):
        with patch('nikke_mcp.server.BrowserRelay') as relay_type:
            relay = relay_type.return_value
            relay.submit.return_value = {'status': 'queued', 'jobId': 'job'}
            async with Client(create_server(browser_mode=True)) as client:
                names = {tool.name for tool in (await client.list_tools()).tools}
                self.assertNotIn('import_overload_plan_result', names)
                self.assertIn('export_overload_plan', names)
                self.assertIn('calculate_overload_plan', names)
                self.assertIn('simulate_browser_state', names)
                await client.call_tool('export_overload_plan', {'connection_code': 'example'})
                relay.submit.assert_called_with('example', {'kind': 'module-export'})
                await client.call_tool('calculate_overload_plan', {'connection_code': 'example'})
                relay.submit.assert_called_with('example', {'kind': 'module-calculate'})

    async def test_real_relay_accepts_browser_goal_and_calculation_results(self):
        from nikke_mcp.browser_relay import BrowserRelay
        relay = BrowserRelay()
        session = relay.connect()
        for kind, result in [
            ('module-export', {'execution': 'user-browser', 'busy': False, 'lockCurrency': 'keys', 'decks': [{'characters': []}]}),
            ('module-calculate', {'execution': 'user-browser', 'decks': [{'before': 100, 'after': 120}], 'modules': []}),
        ]:
            submitted = relay.submit(session['connectionCode'], {'kind': kind})
            relay.poll(session['browserToken'])
            relay.finish(session['browserToken'], submitted['jobId'], result=result)
            self.assertEqual(relay.result(session['connectionCode'], submitted['jobId'])['result'], result)
