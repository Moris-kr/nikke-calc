import sys
import unittest
import asyncio
import socket
import urllib.request
import urllib.error

from mcp import Client
from mcp.client.stdio import StdioServerParameters

from nikke_mcp.models import ROOT
from nikke_mcp.server import create_server
from nikke_mcp.service import CalculatorService
from unittest.mock import patch, AsyncMock


class ProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_busy_service_returns_actionable_error(self):
        service = CalculatorService(max_concurrent=1)
        await service.slots.acquire()
        try:
            with patch('nikke_mcp.server.CalculatorService', return_value=service):
                server = create_server()
            async with Client(server) as client:
                result = await client.call_tool('simulate_squad', {'request': {'squad': ['리타']}})
                self.assertTrue(result.is_error)
                self.assertIn('[SERVER_BUSY]', str(result.content))
                self.assertIn('순서대로', str(result.content))
        finally:
            service.slots.release()

    async def test_expected_failures_reach_client_without_masking(self):
        async with Client(create_server()) as client:
            for tool, args in [
                ('compare_setups', {'requests': [{'squad': ['리타']}, {'squad': ['리타'], 'enemyDef': 1}]}),
                ('get_character', {'name': 'unknown'}),
            ]:
                result = await client.call_tool(tool, args)
                self.assertTrue(result.is_error)
                self.assertIn('[INVALID_SETTINGS]', str(result.content))
            with patch('nikke_mcp.service.CalculatorService.simulate', new=AsyncMock(side_effect=TimeoutError('계산 시간 제한'))):
                result = await client.call_tool('simulate_squad', {'request': {'squad': ['리타']}})
                self.assertTrue(result.is_error)
                self.assertIn('[CALCULATION_TIMEOUT]', str(result.content))

    async def test_unexpected_exception_stays_private(self):
        async with Client(create_server()) as client:
            for exception in [RuntimeError, ValueError, KeyError, TypeError]:
                with patch('nikke_mcp.service.CalculatorService.simulate', new=AsyncMock(side_effect=exception('PRIVATE_INTERNAL_DETAIL'))):
                    result = await client.call_tool('simulate_squad', {'request': {'squad': ['리타']}})
                    self.assertTrue(result.is_error)
                    self.assertNotIn('PRIVATE_INTERNAL_DETAIL', str(result.content))

    async def test_worker_error_details_are_not_published(self):
        async with Client(create_server()) as client:
            for output in [b'{"error":"PRIVATE_INTERNAL_DETAIL"}', b'PRIVATE_INTERNAL_DETAIL']:
                child = AsyncMock()
                child.returncode = 0
                child.communicate.return_value = (output, b'')
                with patch('nikke_mcp.service.asyncio.create_subprocess_exec', new=AsyncMock(return_value=child)):
                    result = await client.call_tool('simulate_squad', {'request': {'squad': ['리타']}})
                    self.assertTrue(result.is_error)
                    self.assertIn('[ENGINE_PROCESS_FAILED]', str(result.content))
                    self.assertNotIn('PRIVATE_INTERNAL_DETAIL', str(result.content))

    async def exercise(self, client):
        tools = await client.list_tools()
        names = {tool.name for tool in tools.tools}
        self.assertTrue({'get_character', 'get_settings', 'simulate_squad', 'compare_setups'} <= names)
        result = await client.call_tool('simulate_squad', {'request': {'squad': ['리타'], 'duration': 2}})
        self.assertFalse(result.is_error)
        self.assertGreater(result.structured_content['result']['squadTotal'], 0)
        invalid = await client.call_tool('simulate_squad', {'request': {'squad': ['리타'], 'duration': 999}})
        self.assertTrue(invalid.is_error)
        state = {'format': 'nikke-calc-mcp', 'version': 1,
                 'battle': {'duration': 2, 'synchroLevel': 321},
                 'roster': {'리타': {'skillLevels': {'1': 4, '2': 5, '3': 6}}}, 'decks': []}
        inspected = await client.call_tool('inspect_shared_state', {'state': state})
        self.assertFalse(inspected.is_error)
        self.assertEqual(inspected.structured_content['rosterCount'], 1)
        shared = await client.call_tool('simulate_shared_state', {'state': state, 'squad': ['리타']})
        self.assertFalse(shared.is_error)
        self.assertEqual(shared.structured_content['effectiveCharacters'][0]['level'], 321)

    async def test_in_memory_protocol(self):
        async with Client(create_server()) as client:
            await self.exercise(client)

    async def test_stdio_from_unrelated_working_directory(self):
        params = StdioServerParameters(command=sys.executable,
            args=[str(ROOT / 'nikke_mcp/launch.py')], cwd=str(ROOT.parent))
        async with Client(params) as client:
            await self.exercise(client)

    async def test_http_transport_and_host_validation(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        process = await asyncio.create_subprocess_exec(sys.executable, str(ROOT / 'nikke_mcp/launch.py'),
            '--transport', 'streamable-http', '--port', str(port),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        url = f'http://127.0.0.1:{port}'
        def ready():
            try:
                with urllib.request.urlopen(url + '/health', timeout=1) as response:
                    return response.status == 200
            except OSError:
                return False
        try:
            for _ in range(60):
                if await asyncio.to_thread(ready):
                    break
                await asyncio.sleep(.1)
            else:
                self.fail('HTTP server did not start')
            async with Client(url + '/mcp') as client:
                from nikke_mcp.smoke import exercise_browser_relay
                await exercise_browser_relay(client, url + '/mcp')
            def bad_host():
                request = urllib.request.Request(url + '/mcp', data=b'{}',
                    headers={'Host': 'untrusted.example', 'Content-Type': 'application/json'})
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request, timeout=3)
                self.assertEqual(error.exception.code, 421)
            await asyncio.to_thread(bad_host)
        finally:
            if process.returncode is None:
                process.kill()
            await process.wait()


if __name__ == '__main__':
    unittest.main()
