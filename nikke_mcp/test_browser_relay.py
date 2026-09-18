import unittest
import json
from starlette.requests import Request
from nikke_mcp.browser_relay import BrowserRelay, install_routes
from unittest.mock import patch

from mcp import Client
from mcp.server.mcpserver.exceptions import ToolError
from nikke_mcp.server import create_server


class BrowserProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_browser_routes_cors_body_limits_and_validation(self):
        routes = {}
        class Routes:
            def custom_route(self, path, methods):
                def register(fn):
                    routes[path] = fn
                return register
        install_routes(Routes(), BrowserRelay())
        async def request(path, body=b'{}', origin='https://moris-kr.github.io', method='POST'):
            headers = [(b'content-type', b'application/json')]
            if origin:
                headers.append((b'origin', origin.encode()))
            async def receive():
                return {'type': 'http.request', 'body': body, 'more_body': False}
            return await routes[path](Request({'type': 'http', 'path': path, 'method': method,
                'headers': headers, 'scheme': 'http', 'server': ('localhost', 80), 'query_string': b''}, receive))
        response = await request('/browser/connect', origin=None)
        self.assertEqual(response.status_code, 403)
        response = await request('/browser/connect', method='OPTIONS')
        self.assertEqual(response.headers['access-control-allow-origin'], 'https://moris-kr.github.io')
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual((await request('/browser/connect', b'{"bad":1}')).status_code, 400)
        self.assertEqual((await request('/browser/connect', b' ' * 1048577)).status_code, 413)
        self.assertEqual((await request('/browser/result', b' ' * (4 * 1048576 + 1))).status_code, 413)
        response = await request('/browser/connect')
        self.assertEqual(response.status_code, 200)
        token = json.loads(response.body)['browserToken']
        response = await request('/browser/disconnect', json.dumps({'browserToken': token}).encode())
        self.assertEqual(json.loads(response.body), {'ok': True})

    async def test_remote_requires_browser_and_never_constructs_calculator(self):
        with patch('nikke_mcp.server.CalculatorService', side_effect=AssertionError('server compute')):
            server = create_server(browser_mode=True)
            async with Client(server) as client:
                result = await client.call_tool('simulate_squad', {'request': {'squad': ['리타']}})
                self.assertTrue(result.is_error)
                self.assertIn('CONNECTION_REQUIRED', str(result.content))

    async def test_remote_tools_queue_browser_work_and_comparison_validates_conditions(self):
        relay = BrowserRelay()
        connection = relay.connect()
        code, token = connection['connectionCode'], connection['browserToken']
        with patch('nikke_mcp.server.BrowserRelay', return_value=relay), patch('nikke_mcp.server.CalculatorService', side_effect=AssertionError('server compute')):
            async with Client(create_server(browser_mode=True)) as client:
                state = {'format': 'nikke-calc-mcp', 'version': 1, 'battle': {}, 'roster': {'리타': {}}, 'decks': []}
                for tool, args, kind in [
                    ('simulate_squad', {'request': {'squad': ['리타']}}, 'simulate'),
                    ('compare_setups', {'requests': [{'squad': ['리타']}, {'squad': ['리타']}]}, 'simulate'),
                    ('simulate_shared_state', {'state': state, 'squad': ['리타']}, 'shared'),
                    ('inspect_browser_state', {}, 'inspect'),
                    ('simulate_browser_state', {'squad': ['리타']}, 'shared'),
                ]:
                    response = await client.call_tool(tool, {**args, 'connection_code': code})
                    self.assertFalse(response.is_error, str(response.content))
                    self.assertEqual(response.structured_content['status'], 'queued')
                    job = relay.poll(token)['job']
                    self.assertEqual(job['kind'], kind)
                    relay.finish(token, job['id'], error='test cancellation')
                invalid = await client.call_tool('compare_setups', {'connection_code': code,
                    'requests': [{'squad': ['리타']}, {'squad': ['리타'], 'enemyDef': 1}]})
                self.assertTrue(invalid.is_error)
                self.assertIn('INVALID_SETTINGS', str(invalid.content))


class RelayTests(unittest.TestCase):
    def setUp(self):
        from nikke_mcp.browser_relay import BrowserRelay
        self.now = 100.0
        self.relay = BrowserRelay(clock=lambda: self.now, max_sessions=2)
        self.session = self.relay.connect()
        self.code = self.session['connectionCode']
        self.token = self.session['browserToken']

    def test_token_isolation_and_one_active_job(self):
        self.assertGreaterEqual(len(self.code), 22)
        self.assertGreaterEqual(len(self.token), 43)
        with self.assertRaises(ToolError):
            self.relay.poll(self.code)
        job = self.relay.submit(self.code, {'kind': 'inspect'})
        with self.assertRaisesRegex(ToolError, 'BROWSER_BUSY'):
            self.relay.submit(self.code, {'kind': 'inspect'})
        self.assertEqual(self.relay.poll(self.token)['job']['id'], job['jobId'])
        self.assertIsNone(self.relay.poll(self.token)['job'])
        with self.assertRaisesRegex(ToolError, 'JOB_NOT_FOUND'):
            other = self.relay.connect()
            self.relay.result(other['connectionCode'], job['jobId'])
        self.relay.finish(self.token, job['jobId'], error='worker failed')
        self.assertEqual(self.relay.result(self.code, job['jobId'])['status'], 'failed')

    def test_offline_and_expired_results(self):
        job = self.relay.submit(self.code, {'kind': 'inspect'})
        self.now += 46
        with self.assertRaisesRegex(ToolError, 'BROWSER_OFFLINE'):
            self.relay.result(self.code, job['jobId'])
        with self.assertRaises(ToolError):
            self.relay.poll(self.token)

    def test_result_validation_and_retention(self):
        job = self.relay.submit(self.code, {'kind': 'inspect'})
        with self.assertRaises(ToolError):
            self.relay.finish(self.token, job['jobId'], result={})
        self.relay.poll(self.token)
        state = {'format': 'nikke-calc-mcp', 'version': 1, 'battle': {}, 'roster': {}, 'decks': []}
        self.relay.finish(self.token, job['jobId'], result=state)
        self.assertEqual(self.relay.result(self.code, job['jobId'])['result'], state)
        with self.assertRaises(ToolError):
            self.relay.finish(self.token, job['jobId'], result=state)
        for _ in range(8):
            self.now += 40
            self.relay.poll(self.token)
        with self.assertRaisesRegex(ToolError, 'JOB_NOT_FOUND'):
            self.relay.result(self.code, job['jobId'])

    def test_session_capacity(self):
        self.relay.connect()
        with self.assertRaisesRegex(ToolError, 'SERVER_BUSY'):
            self.relay.connect()

    def test_retained_results_have_global_memory_budget(self):
        self.relay.max_result_bytes = 1
        job = self.relay.submit(self.code, {'kind': 'inspect'})
        self.relay.poll(self.token)
        state = {'format': 'nikke-calc-mcp', 'version': 1, 'battle': {}, 'roster': {}, 'decks': []}
        with self.assertRaisesRegex(ToolError, 'SERVER_BUSY'):
            self.relay.finish(self.token, job['jobId'], result=state)

    def test_oldest_completed_job_is_evicted_when_session_is_full(self):
        ids = []
        for _ in range(9):
            job = self.relay.submit(self.code, {'kind': 'inspect'})
            ids.append(job['jobId'])
            self.relay.poll(self.token)
            self.relay.finish(self.token, job['jobId'], error='cancelled')
        with self.assertRaisesRegex(ToolError, 'JOB_NOT_FOUND'):
            self.relay.result(self.code, ids[0])
        self.assertEqual(self.relay.result(self.code, ids[-1])['status'], 'failed')

    def test_comparison_requires_ranking_and_candidate_count(self):
        job = self.relay.submit(self.code, {'kind': 'simulate', 'requests': [{}, {}]})
        self.relay.poll(self.token)
        candidate = {'engineVersion': 'test', 'result': {}, 'effectiveCharacters': []}
        with self.assertRaisesRegex(ToolError, 'INVALID_RESULT'):
            self.relay.finish(self.token, job['jobId'], result={'candidates': [candidate, candidate]})
        result = {'candidates': [candidate, candidate], 'testedCandidates': 2, 'ranking': [2, 1]}
        self.relay.finish(self.token, job['jobId'], result=result)
        self.assertEqual(self.relay.result(self.code, job['jobId'])['result'], result)

    def test_absolute_expiry_despite_heartbeat(self):
        for _ in range(179):
            self.now += 40
            self.relay.poll(self.token)
        self.now += 40
        with self.assertRaisesRegex(ToolError, 'BROWSER_OFFLINE'):
            self.relay.poll(self.token)

    def test_busy_heartbeat_does_not_dequeue_next_job(self):
        job = self.relay.submit(self.code, {'kind': 'inspect'})
        for _ in range(2):
            self.now += 40
            self.assertIsNone(self.relay.poll(self.token, ready=False)['job'])
        self.assertEqual(self.relay.result(self.code, job['jobId'])['status'], 'queued')
        self.assertEqual(self.relay.poll(self.token)['job']['id'], job['jobId'])

    def test_active_job_times_out_despite_live_heartbeats(self):
        job = self.relay.submit(self.code, {'kind': 'inspect'})
        self.relay.poll(self.token)
        for _ in range(8):
            self.now += 40
            self.relay.poll(self.token, ready=False)
        result = self.relay.result(self.code, job['jobId'])
        self.assertEqual(result['status'], 'failed')
        self.assertIn('JOB_TIMEOUT', result['error'])
        with self.assertRaisesRegex(ToolError, 'JOB_NOT_FOUND'):
            self.relay.finish(self.token, job['jobId'], error='late result')
        self.relay.submit(self.code, {'kind': 'inspect'})
