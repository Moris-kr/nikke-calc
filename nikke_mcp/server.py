"""MCP transport layer. No model API key is required."""
from __future__ import annotations

import argparse
import os
from typing import Any

from mcp.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from starlette.responses import JSONResponse

from calculator.customization import CUBE_NAMES, COLLECTION_STAGES, OVERLOAD_FIELDS, MANUAL_STATS
from context.spec import DEFAULT_CHAR
from nikke_mcp.models import CombatRequest
from nikke_mcp.shared_state import SharedState, inspect_shared, shared_request
from nikke_mcp.service import CalculatorService, engine_version, get_character as lookup_character, list_characters as search_characters
from nikke_mcp.errors import public_errors, InvalidSettingsError
from nikke_mcp.browser_relay import BrowserRelay, install_routes, fail


def create_server(timeout: int = 60, max_concurrent: int = 2, browser_mode: bool = False) -> MCPServer:
    server = MCPServer('NIKKE Calculator', version='1.0.0', instructions=(
        '니케 계산 도구입니다. 먼저 정식 이름과 설정을 조회하고 실제 simulate_squad/compare_setups 결과로 답하세요. '
        '수치를 추측하지 마세요. 입력한 육성이 없으면 기본 육성이며 사용자 실제 계정으로 표현하지 마세요. '
        '엔진 버전, 전투 조건, 기본 이탈과 프리뷰 경고를 명시하세요. 비교는 입력 후보만의 순위입니다. '
        '계산 호출은 반드시 순차 실행하세요. SERVER_BUSY는 기존 호출 완료 후 같은 입력으로 재시도하고, '
        'CALCULATION_TIMEOUT은 시간 제한입니다. 이 오류들을 특정 캐릭터의 계산 불가로 해석하지 마세요. '
        '공개 HTTP 계산은 연결된 사용자 브라우저에서만 실행됩니다. connection_code가 필요하며 반환된 jobId는 '
        'get_browser_result로 확인하세요. 탭을 열어 두세요. 결과는 5분간 보관됩니다. 로컬 stdio는 로컬에서 계산합니다.'),
        log_level='WARNING')
    service = None if browser_mode else CalculatorService(timeout=timeout, max_concurrent=max_concurrent)
    relay = BrowserRelay()
    if browser_mode:
        install_routes(server, relay)
    read_only = ToolAnnotations(read_only_hint=True, destructive_hint=False,
                                idempotent_hint=True, open_world_hint=False)

    calculation = ToolAnnotations(read_only_hint=True, destructive_hint=False,
                                  idempotent_hint=not browser_mode, open_world_hint=False)

    @server.tool(annotations=read_only)
    def list_characters(query: str = '') -> dict[str, Any]:
        """정식 캐릭터명·속성·무기·버스트를 검색합니다. 별칭을 추측하지 말고 이 목록의 이름을 사용하세요."""
        with public_errors():
            return search_characters(query)

    @server.tool(annotations=read_only)
    def get_character(name: str, skill_level: int = 10) -> dict[str, Any]:
        """캐릭터 스킬 원문을 지정 레벨(1~10)로 조회합니다. stats는 공통 육성 적용 전 데이터입니다."""
        with public_errors():
            return lookup_character(name, skill_level)

    @server.tool(annotations=read_only)
    def get_settings() -> dict[str, Any]:
        """지원 입력 스키마, 기본 육성, 큐브·소장품·오버로드 옵션을 조회합니다."""
        return {'requestSchema': CombatRequest.model_json_schema(), 'defaultCharacter': DEFAULT_CHAR,
                'cubeNames': ['없음', *CUBE_NAMES], 'collectionStages': list(COLLECTION_STAGES),
                'overloadFields': OVERLOAD_FIELDS,
                'manualStats': MANUAL_STATS,
                'characterExample': {'skillLevels': {'1': 10, '2': 10, '3': 10},
                                     'cube': {'name': '없음', 'level': 0}},
                'notes': ['큐브 없음은 Lv0, 착용 큐브는 Lv1~15입니다.',
                          '기본 스펙은 실제 계정 정보가 아닙니다. 캐릭터별 기본 설정도 추가됩니다.',
                          '지원: growthStage, skillLevels, overload, cube, collection, control, burst, equipLevels, manualStats, weaponModeSwapAt.',
                          '싱크로·콘솔·전투 조건과 웹 공유 JSON을 지원합니다. 공유는 inspect_shared_state로 먼저 검증하세요.',
                          '미지원: 일반 백업/계정 로그인, 커스텀 캐릭터, 핵 옵션.'],
                'sharedStateSchema': SharedState.model_json_schema(),
                'engineVersion': engine_version()}

    @server.tool(annotations=calculation)
    async def simulate_squad(request: CombatRequest, detail: bool = False, connection_code: str = '') -> dict[str, Any]:
        """웹과 같은 엔진으로 계산합니다(최대 180초). detail=true는 타임라인도 반환합니다."""
        with public_errors():
            if browser_mode:
                return relay.submit(connection_code, {'kind': 'simulate', 'requests': [request.model_dump(exclude_none=True)], 'detail': detail})
            return await service.simulate(request, detail)

    @server.tool(annotations=calculation)
    async def compare_setups(requests: list[CombatRequest], connection_code: str = '') -> dict[str, Any]:
        """동일 전투 조건의 2~5개 후보를 계산합니다. 후보별 실제 설정과 1번 대비 증감을 반환합니다."""
        with public_errors():
            if browser_mode:
                if not 2 <= len(requests) <= 5:
                    raise InvalidSettingsError('비교 후보는 2~5개입니다.')
                conditions = [r.model_dump(exclude={'squad', 'characters'}) for r in requests]
                if any(c != conditions[0] for c in conditions[1:]):
                    raise InvalidSettingsError('비교 후보의 전투 조건은 같아야 합니다.')
                return relay.submit(connection_code, {'kind': 'simulate', 'requests': [r.model_dump(exclude_none=True) for r in requests], 'detail': False})
            return await service.compare(requests)

    @server.tool(annotations=read_only)
    def inspect_shared_state(state: SharedState) -> dict[str, Any]:
        """웹의 편의 기능 → MCP에서 내보낸 JSON을 state에 전달해 전체 육성·덱·조건을 검증하고 조회합니다. 파일 경로나 URL이 아닌 JSON 객체를 전달하세요. 저장하지 않습니다."""
        return {**inspect_shared(state), 'engineVersion': engine_version()}

    @server.tool(annotations=calculation)
    async def simulate_shared_state(state: SharedState, deck_index: int = 1,
                                    squad: list[str] | None = None, detail: bool = False, connection_code: str = '') -> dict[str, Any]:
        """공유 JSON으로 계산합니다. 기본은 deck_index(1부터)의 설정 그대로. squad를 지정하면 공유 roster의 육성 + battle 조건으로 새 편성을 계산하며, 육성이 없는 캐릭터는 거절합니다. 매 호출에 state 전체를 전달하세요."""
        with public_errors():
            if browser_mode:
                shared_request(state, deck_index, squad)
                return relay.submit(connection_code, {'kind': 'shared', 'state': state.model_dump(exclude_none=True), 'deck_index': deck_index, 'squad': squad, 'detail': detail})
            return await service.simulate(shared_request(state, deck_index, squad), detail)

    @server.tool(annotations=calculation)
    def inspect_browser_state(connection_code: str) -> dict[str, Any]:
        """연결된 브라우저의 현재 공유 가능한 육성·덱·조건을 조회하는 작업을 요청합니다."""
        return relay.submit(connection_code, {'kind': 'inspect'})

    @server.tool(annotations=calculation)
    def simulate_browser_state(connection_code: str, deck_index: int = 1,
                               squad: list[str] | None = None, detail: bool = False) -> dict[str, Any]:
        """현재 브라우저 육성으로 계산합니다. squad 생략 시 지정 덱, 지정 시 보유 육성으로 새 편성을 계산합니다."""
        if deck_index < 1 or deck_index > 100 or (squad is not None and (not 1 <= len(squad) <= 5 or len(set(squad)) != len(squad))):
            fail('INVALID_SETTINGS', 'deck_index 또는 squad가 잘못되었습니다.')
        return relay.submit(connection_code, {'kind': 'shared', 'deck_index': deck_index, 'squad': squad, 'detail': detail})

    @server.tool(annotations=read_only)
    def get_browser_result(connection_code: str, job_id: str) -> dict[str, Any]:
        """브라우저 작업 상태와 결과를 조회합니다. queued/running이면 잠시 후 재조회하세요."""
        return relay.result(connection_code, job_id)

    @server.custom_route('/health', methods=['GET'])
    async def health(request):
        return JSONResponse({'status': 'ok', 'engineVersion': engine_version()})

    return server


def main():
    parser = argparse.ArgumentParser(description='NIKKE MCP · stdio 또는 Streamable HTTP')
    parser.add_argument('--transport', choices=['stdio', 'streamable-http'], default='stdio')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=os.environ.get('PORT', '8000'))
    parser.add_argument('--public', action='store_true', help='인증 없는 공개 계산 서버 실행에 동의')
    parser.add_argument('--allowed-host', action='append', default=[], help='HTTPS 도메인 또는 host:port. 반복 가능')
    args = parser.parse_args()
    try:
        timeout = int(os.environ.get('NIKKE_MCP_TIMEOUT', '60'))
        max_concurrent = int(os.environ.get('NIKKE_MCP_MAX_CONCURRENT', '2'))
        if not 1 <= timeout <= 300 or not 1 <= max_concurrent <= 8:
            raise ValueError()
    except ValueError:
        parser.error('NIKKE_MCP_TIMEOUT은 1~300, NIKKE_MCP_MAX_CONCURRENT는 1~8 정수여야 합니다.')
    server = create_server(timeout=timeout, max_concurrent=max_concurrent, browser_mode=args.transport == 'streamable-http')
    if args.transport == 'stdio':
        server.run()
        return
    hosts = args.allowed_host or [h.strip() for h in os.environ.get('NIKKE_MCP_ALLOWED_HOSTS', '').split(',') if h.strip()]
    # Render injects this exact hostname; never allow every onrender.com tenant.
    render_host = os.environ.get('RENDER_EXTERNAL_HOSTNAME', '').strip()
    if render_host:
        hosts.append(render_host)
    if args.host not in ('127.0.0.1', 'localhost', '::1') and (not args.public or not hosts):
        parser.error('외부 바인딩에는 --public 및 --allowed-host 또는 NIKKE_MCP_ALLOWED_HOSTS가 필요합니다.')
    hosts = ['127.0.0.1:*', 'localhost:*', '[::1]:*', *hosts]
    security = TransportSecuritySettings(allowed_hosts=hosts,
        allowed_origins=['http://127.0.0.1:*', 'http://localhost:*',
                         *['https://' + h for h in hosts if not h.endswith(':*')]])
    server.run(transport='streamable-http', host=args.host, port=args.port,
               stateless_http=True, json_response=True, max_request_body_size=1048576,
               transport_security=security)
