"""Verify the installed MCP over stdio or a supplied HTTP URL."""
import argparse
import asyncio
import json
import sys
from pathlib import Path

from mcp import Client
from mcp.client.stdio import StdioServerParameters


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', help='예: http://127.0.0.1:8000/mcp')
    args = parser.parse_args()
    server = args.url or StdioServerParameters(command=sys.executable,
        args=[str(Path(__file__).with_name('launch.py'))])
    async with Client(server) as client:
        tools = await client.list_tools()
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
