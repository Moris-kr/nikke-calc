"""Verify the installed MCP over stdio or a supplied HTTP URL."""
import argparse
import asyncio
import json
import sys
import urllib.request
from pathlib import Path

from mcp import Client
from mcp.client.stdio import StdioServerParameters


async def exercise_browser_relay(client, url):
    """Pair a synthetic browser: validate relay transport without server computation."""
    base = url.rsplit('/mcp', 1)[0]
    async def post(action, body):
        def send():
            request = urllib.request.Request(base + '/browser/' + action,
                data=json.dumps(body).encode(), headers={'Content-Type': 'application/json',
                'Origin': 'https://moris-kr.github.io'})
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.load(response)
        return await asyncio.to_thread(send)
    connection = await post('connect', {})
    code, token = connection['connectionCode'], connection['browserToken']
    try:
        missing = await client.call_tool('simulate_squad', {'request': {'squad': ['리타'], 'duration': 2}})
        if not missing.is_error or 'CONNECTION_REQUIRED' not in str(missing.content):
            raise RuntimeError('HTTP must require a browser connection')
        queued = await client.call_tool('simulate_squad', {'connection_code': code,
            'request': {'squad': ['리타'], 'duration': 2}})
        if queued.is_error or queued.structured_content['status'] != 'queued':
            raise RuntimeError('Browser job was not queued')
        job_id = queued.structured_content['jobId']
        job = (await post('poll', {'browserToken': token}))['job']
        if job['id'] != job_id or job['kind'] != 'simulate' or job['requests'][0]['duration'] != 2:
            raise RuntimeError('Browser job payload mismatch')
        fixture = {'engineVersion': 'browser-relay-smoke', 'result': {'squadTotal': 123}, 'effectiveCharacters': []}
        await post('result', {'browserToken': token, 'jobId': job_id, 'result': fixture})
        result = await client.call_tool('get_browser_result', {'connection_code': code, 'job_id': job_id})
        if result.is_error or result.structured_content != {'status': 'complete', 'result': fixture}:
            raise RuntimeError('Browser result relay mismatch')
        return fixture
    finally:
        await post('disconnect', {'browserToken': token})


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', help='예: http://127.0.0.1:8000/mcp')
    args = parser.parse_args()
    server = args.url or StdioServerParameters(command=sys.executable,
        args=[str(Path(__file__).with_name('launch.py'))])
    async with Client(server) as client:
        tools = await client.list_tools()
        if args.url:
            result = await exercise_browser_relay(client, args.url)
            print(json.dumps({'status': 'OK', 'mode': 'browser-relay', 'tools': [tool.name for tool in tools.tools]}, ensure_ascii=False))
            return
        result = await client.call_tool('simulate_squad', {'request': {'squad': ['리타'], 'duration': 2}})
        if result.is_error or not result.structured_content:
            raise RuntimeError('MCP 계산 검증 실패')
        shared = await client.call_tool('simulate_shared_state', {'state': {
            'format': 'nikke-calc-mcp', 'version': 1, 'battle': {'duration': 2, 'synchroLevel': 321},
            'roster': {'리타': {'skillLevels': {'1': 4, '2': 5, '3': 6}}}, 'decks': []}, 'squad': ['리타']})
        if shared.is_error or shared.structured_content['effectiveCharacters'][0]['level'] != 321:
            raise RuntimeError('공유 육성 계산 검증 실패')
        print(json.dumps({'status': 'OK', 'tools': [tool.name for tool in tools.tools],
                          'engineVersion': result.structured_content['engineVersion']}, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
