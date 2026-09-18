"""Bounded, ephemeral browser capability relay. No calculation runs here."""
from __future__ import annotations

import json
import secrets
import time
from threading import RLock

from mcp.server.mcpserver.exceptions import ToolError
from starlette.responses import JSONResponse
from nikke_mcp.shared_state import SharedState

ALLOWED_ORIGINS = {'https://moris-kr.github.io', 'http://localhost:5173',
                   'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'}
REQUEST_LIMIT = 1024 * 1024
RESULT_LIMIT = 4 * REQUEST_LIMIT


def fail(code, message):
    raise ToolError(f'[{code}] {message}')


class BrowserRelay:
    def __init__(self, clock=time.monotonic, max_sessions=32):
        self.clock = clock
        self.max_sessions = max_sessions
        self.max_result_bytes = 32 * REQUEST_LIMIT
        self.sessions = {}
        self.lock = RLock()

    def _prune(self):
        now = self.clock()
        for code, session in list(self.sessions.items()):
            if now >= session['expires'] or now - session['heartbeat'] > 45:
                del self.sessions[code]
                continue
            for key, job in list(session['jobs'].items()):
                if job['status'] in ('queued', 'running') and now - job['started'] >= 300:
                    job.update(status='failed', error='[JOB_TIMEOUT] 브라우저 작업이 5분 안에 완료되지 않았습니다. 다시 연결하고 재시도하세요.', finished=now)
                    job.pop('payload', None)
                if job.get('finished') is not None and now - job['finished'] >= 300:
                    del session['jobs'][key]

    def _session(self, key, browser=False):
        self._prune()
        if not isinstance(key, str) or not key:
            fail('CONNECTION_REQUIRED', '계산기에서 AI 연결을 켜고 연결 코드를 전달하세요.')
        session = next((s for s in self.sessions.values() if secrets.compare_digest(s['token'], key)), None) if browser else self.sessions.get(key)
        if session is None:
            fail('BROWSER_OFFLINE', '연결이 만료되었거나 브라우저가 오프라인입니다. 계산기에서 다시 연결하세요.')
        return session

    def connect(self):
        with self.lock:
            self._prune()
            if len(self.sessions) >= self.max_sessions:
                fail('SERVER_BUSY', '연결 한도입니다. 잠시 후 다시 연결하세요.')
            code, token = secrets.token_urlsafe(16), secrets.token_urlsafe(32)
            self.sessions[code] = {'token': token, 'expires': self.clock() + 7200,
                                   'heartbeat': self.clock(), 'jobs': {}}
            return {'connectionCode': code, 'browserToken': token, 'expiresIn': 7200}

    def submit(self, code, payload):
        with self.lock:
            session = self._session(code)
            if len(json.dumps(payload, ensure_ascii=False).encode()) > REQUEST_LIMIT:
                fail('INVALID_SETTINGS', '요청이 너무 큽니다.')
            jobs = session['jobs']
            if any(j['status'] in ('queued', 'running') for j in jobs.values()):
                fail('BROWSER_BUSY', '기존 작업 결과를 확인한 뒤 순서대로 실행하세요.')
            if len(jobs) >= 8:
                del jobs[next(iter(jobs))]
            job_id = secrets.token_urlsafe(16)
            jobs[job_id] = {'payload': {'id': job_id, **payload}, 'status': 'queued', 'started': self.clock()}
            return {'status': 'queued', 'jobId': job_id,
                    'instruction': '계산기 탭을 열어 두고 get_browser_result(connection_code, job_id)로 결과를 확인하세요.'}

    def poll(self, token, ready=True):
        with self.lock:
            session = self._session(token, True)
            session['heartbeat'] = self.clock()
            if not ready:
                return {'job': None}
            for job in session['jobs'].values():
                if job['status'] == 'queued':
                    job['status'] = 'running'
                    return {'job': job['payload']}
            return {'job': None}

    def finish(self, token, job_id, result=None, error=None):
        with self.lock:
            session = self._session(token, True)
            job = session['jobs'].get(job_id)
            if job is None or job['status'] != 'running':
                fail('JOB_NOT_FOUND', '실행 중인 작업이 아닙니다.')
            if (result is None) == (error is None):
                fail('INVALID_RESULT', 'result 또는 error 중 하나가 필요합니다.')
            if error is not None:
                if not isinstance(error, str) or not 1 <= len(error) <= 2000:
                    fail('INVALID_RESULT', '오류 메시지 형식이 잘못되었습니다.')
                job.update(status='failed', error=error)
            else:
                self._validate_result(job['payload'], result)
                encoded = json.dumps(result, ensure_ascii=False, allow_nan=False).encode()
                retained = sum(len(j.get('result_json', b'')) for s in self.sessions.values() for j in s['jobs'].values())
                if retained + len(encoded) > self.max_result_bytes:
                    fail('SERVER_BUSY', '결과 보관 한도입니다. 잠시 후 다시 실행하세요.')
                job.update(status='complete', result_json=encoded)
            job['finished'] = self.clock()
            job.pop('payload')
            return {'ok': True}

    def _validate_result(self, payload, result):
        try:
            if len(json.dumps(result, allow_nan=False, ensure_ascii=False).encode()) > RESULT_LIMIT:
                raise ValueError()
            if not isinstance(result, dict):
                raise ValueError()
            if payload['kind'] == 'inspect':
                SharedState.model_validate(result)
            else:
                candidates = result.get('candidates') if len(payload.get('requests', [])) > 1 else [result]
                if not isinstance(candidates, list) or len(candidates) != max(1, len(payload.get('requests', []))):
                    raise ValueError()
                if len(candidates) > 1:
                    count = len(candidates)
                    ranking = result.get('ranking')
                    if type(result.get('testedCandidates')) is not int or result['testedCandidates'] != count or not isinstance(ranking, list) or any(type(rank) is not int for rank in ranking) or sorted(ranking) != list(range(1, count + 1)):
                        raise ValueError()
                for item in candidates:
                    if not isinstance(item, dict) or not isinstance(item.get('engineVersion'), str) or not isinstance(item.get('result'), dict) or not isinstance(item.get('effectiveCharacters'), list):
                        raise ValueError()
        except (ValueError, TypeError, RecursionError):
            fail('INVALID_RESULT', '브라우저 결과 형식 또는 크기가 잘못되었습니다.')

    def result(self, code, job_id):
        with self.lock:
            job = self._session(code)['jobs'].get(job_id)
            if job is None:
                fail('JOB_NOT_FOUND', '작업이 없거나 결과 보관 시간(5분)이 지났습니다.')
            output = {key: value for key, value in job.items() if key in ('status', 'error')}
            if 'result_json' in job:
                output['result'] = json.loads(job['result_json'])
            return output

    def disconnect(self, token):
        with self.lock:
            session = self._session(token, True)
            for code, candidate in list(self.sessions.items()):
                if candidate is session:
                    del self.sessions[code]
            return {'ok': True}


def install_routes(server, relay):
    async def endpoint(request):
        origin = request.headers.get('origin')
        headers = {'Cache-Control': 'no-store', 'Vary': 'Origin'}
        if origin not in ALLOWED_ORIGINS:
            return JSONResponse({'error': '[ORIGIN_DENIED] 허용되지 않은 Origin입니다.'}, status_code=403, headers=headers)
        headers.update({'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type'})
        if request.method == 'OPTIONS':
            return JSONResponse({}, headers=headers)
        action = request.url.path.rsplit('/', 1)[-1]
        limit = RESULT_LIMIT if action == 'result' else REQUEST_LIMIT
        try:
            if request.headers.get('content-type', '').split(';')[0].strip() != 'application/json':
                fail('INVALID_REQUEST', 'Content-Type application/json이 필요합니다.')
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > limit:
                    message = ('[REQUEST_TOO_LARGE] 결과 전체가 4MB를 넘었습니다. detail=false 또는 짧은 전투 시간으로 다시 계산하세요.'
                               if action == 'result' else '[REQUEST_TOO_LARGE] 요청이 1MB를 넘었습니다.')
                    return JSONResponse({'error': message}, status_code=413, headers=headers)
            data = json.loads(body)
            expected = {'connect': set(), 'poll': {'browserToken', 'ready'}, 'disconnect': {'browserToken'},
                        'result': {'browserToken', 'jobId', 'result', 'error'}}[action]
            if not isinstance(data, dict) or set(data) - expected:
                fail('INVALID_REQUEST', '요청 필드가 잘못되었습니다.')
            if action != 'connect' and (not isinstance(data.get('browserToken'), str) or len(data['browserToken']) > 128):
                fail('INVALID_REQUEST', 'browserToken이 필요합니다.')
            if action == 'connect':
                output = relay.connect()
            elif action == 'poll':
                if type(data.get('ready', True)) is not bool:
                    fail('INVALID_REQUEST', 'ready는 boolean이어야 합니다.')
                output = relay.poll(data['browserToken'], data.get('ready', True))
            elif action == 'disconnect':
                output = relay.disconnect(data['browserToken'])
            else:
                if not isinstance(data.get('jobId'), str) or len(data['jobId']) > 128:
                    fail('INVALID_REQUEST', 'jobId가 필요합니다.')
                output = relay.finish(data['browserToken'], data['jobId'], data.get('result'), data.get('error'))
            return JSONResponse(output, headers=headers)
        except ToolError as error:
            return JSONResponse({'error': str(error)}, status_code=400, headers=headers)
        except (ValueError, TypeError, RecursionError):
            return JSONResponse({'error': '[INVALID_REQUEST] 잘못된 JSON 요청입니다.'}, status_code=400, headers=headers)

    for action in ('connect', 'poll', 'result', 'disconnect'):
        server.custom_route('/browser/' + action, methods=['POST', 'OPTIONS'])(endpoint)
