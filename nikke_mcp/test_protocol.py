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


class ProtocolTests(unittest.IsolatedAsyncioTestCase):
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
                await self.exercise(client)
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
