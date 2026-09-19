import unittest
from unittest.mock import patch
from mcp import Client
from nikke_mcp.server import create_server

class OverloadExchangeTests(unittest.IsolatedAsyncioTestCase):
    async def test_export_and_import_only_relay_data(self):
        with patch('nikke_mcp.server.BrowserRelay') as relay_type:
            relay = relay_type.return_value
            relay.submit.return_value = {'status': 'queued', 'jobId': 'job'}
            async with Client(create_server(browser_mode=True)) as client:
                response = await client.call_tool('export_overload_plan', {'connection_code': 'example'})
                self.assertFalse(response.is_error)
                relay.submit.assert_called_with('example', {'kind': 'module-export'})
                response = await client.call_tool('import_overload_plan_result', {'connection_code': 'example', 'result_json': '{"format":"test"}'})
                self.assertFalse(response.is_error)
                relay.submit.assert_called_with('example', {'kind': 'module-import', 'moduleResult': '{"format":"test"}'})
                listing = await client.list_tools()
                tool = next(t for t in listing.tools if t.name == 'import_overload_plan_result')
                self.assertFalse(tool.annotations.read_only_hint)
