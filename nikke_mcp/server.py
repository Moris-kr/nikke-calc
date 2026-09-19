"""MCP transport layer. No model API key is required."""
from __future__ import annotations

import argparse
import os
from typing import Any, Literal

from mcp.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from starlette.responses import JSONResponse

from calculator.customization import CUBE_NAMES, COLLECTION_STAGES, OVERLOAD_FIELDS, MANUAL_STATS
from context.spec import DEFAULT_CHAR
from nikke_mcp.models import CombatRequest, GrowthScenario, CharacterOverrides, RecommendationCandidate, RecommendationScenario, character_names
from nikke_mcp.squad_policy import inspect_squad_policy, query_squad_roles
from nikke_mcp.shared_state import SharedState, inspect_shared, shared_request
from nikke_mcp.service import CalculatorService, engine_version, get_character as lookup_character, list_characters as search_characters
from nikke_mcp.errors import public_errors, InvalidSettingsError
from nikke_mcp.browser_relay import BrowserRelay, install_routes, fail
from nikke_mcp.enikk_guide import GuideMode, recommendation_guide
from nikke_mcp.boss_code import BossCodeRequest, create_boss_code as build_boss_code


def create_server(timeout: int = 60, max_concurrent: int = 2, browser_mode: bool = False) -> MCPServer:
    server = MCPServer('NIKKE Calculator', version='1.0.0', instructions=(
        '니케 계산 도구입니다. 덱/조합 추천 요청(Campaign 스테이지, 속성별 솔로레이드, 유니온레이드 보스 등)은 '
        '반드시 먼저 get_recommendation_guide를 호출해 해당 콘텐츠의 ENIKK 검색·근거 검증 지침을 읽으세요. '
        '추천하는 각 덱에는 실제 발동 가능한 아군 버스트 쿨타임 감소 캐릭터를 반드시 포함하세요. '
        'validate_squad_policy로 검사하고, 사용자 지정 덱에 쿨감이 없으면 의도를 한 번 확인하세요. '
        '예외는 솔린 대신 바니 소다를 쓰는 실제 샷건 편성뿐입니다. 자기 쿨감은 아군 쿨감이 아닙니다. '
        'get_recommendation_evidence의 날짜가 붙은 관측 조합으로 후보를 찾고 recommend_browser_squads로 실제 육성의 후보를 비교하세요. '
        '지침 조회 자체는 최신 기록 조회가 아닙니다. 웹/브라우저 접근이 없으면 ENIKK를 확인했다고 말하지 마세요. '
        '먼저 정식 이름과 설정을 조회하고 실제 simulate_squad/compare_setups 결과로 답하세요. '
        '수치를 추측하지 마세요. 입력한 육성이 없으면 기본 육성이며 사용자 실제 계정으로 표현하지 마세요. '
        '오버로드 모듈 분석을 외부에 맡기려면 export_overload_plan의 코드를 AI의 Node.js·Python 실행 도구로 실행하고 import_overload_plan_result로 반환하세요. 실행 없이 추측하지 마세요. '
        '육성 전후 예상 전투력은 compare_browser_growth로 비교하세요. 전용 MCP 도구가 없는 기능은 '
        'get_settings.browserFallback 지침에 따라 실제 계산기 UI를 확인하세요. 브라우저 접근 없이 조작했다고 말하지 마세요. '
        '보스 만들기 요청은 create_boss_code로 검증된 NK5 코드를 만들어 전달하세요. 도형은 실측 근거와 가정을 구분하고, '
        'settingsSource는 기본 drawing이며 전투 수치를 직접 쓸 때만 battle과 조건을 지정하세요. 코드 생성에는 브라우저 연결이 필요 없습니다. '
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
    def create_boss_code(request: BossCodeRequest) -> dict[str, Any]:
        """보스 도형·파츠·코어·조준점과 선택적 전투 조건을 검증해 가져오기용 NK5 공유 코드를 만듭니다. 브라우저나 시뮬레이션 없이 동작합니다. 좌표/크기는 px, 구간/aimKeys.t는 초. windows는 {from,to} 목록이며 비면 상시 표시. settingsSource=drawing(기본)은 그림에서 코어·파츠·사거리를 적용하고 battle은 제공한 battle 수치를 사용합니다. 실측 근거 없이 도형을 실측이라고 표현하지 말고 가정을 설명하세요. 이미지·계정 육성·캐릭터별 폭발 반경/탄착군은 지원하지 않습니다. 반환된 코드를 계산기 → 보스 메이커 → 공유 → 받은 코드 넣기 → 새 보스로 받기에 붙여넣고 검토하도록 안내하세요."""
        return build_boss_code(request)

    @server.tool(annotations=read_only)
    def get_recommendation_guide(mode: GuideMode = 'overview') -> dict[str, Any]:
        """덱 추천 전에 읽는 ENIKK 검색 지침. mode: overview/meta/campaign/soloraid/unionraid. 캠페인·수냉 솔레·핑거즈 등 콘텐츠별 실제 기록 탐색, 표본/최신성, 사용자 브라우저 육성 적용 절차를 제공합니다. 최신 기록 자체를 수집하는 도구는 아닙니다."""
        return recommendation_guide(mode)

    @server.tool(annotations=read_only)
    def list_characters(query: str = '') -> dict[str, Any]:
        """정식 캐릭터명·속성·무기·버스트를 검색합니다. 별칭을 추측하지 말고 이 목록의 이름을 사용하세요."""
        with public_errors():
            return search_characters(query)

    @server.tool(annotations=read_only)
    def get_squad_roles(names: list[str] | None = None, characters: dict[str, CharacterOverrides] | None = None) -> dict[str, Any]:
        """스킬 데이터에서 아군 버스트 쿨감과 발동 조건을 조회합니다. 자기 쿨감/음수 효과와 구분합니다. 실제 육성이 없으면 기본 스킬 기준이며 팀 조건은 validate_squad_policy로 검사하세요."""
        with public_errors():
            try:
                return query_squad_roles(names, {n: c.model_dump(exclude_unset=True) for n, c in (characters or {}).items()})
            except ValueError as error:
                raise InvalidSettingsError(str(error)) from error

    @server.tool(annotations=read_only)
    def validate_squad_policy(squad: list[str], characters: dict[str, CharacterOverrides] | None = None,
                              purpose: Literal['recommendation', 'user_fixed'] = 'recommendation',
                              allow_no_cdr: bool = False) -> dict[str, Any]:
        """덱의 아군 쿨감·조건부 발동·버스트 구조를 검사합니다. requiresConfirmation이면 쿨감 없는 편성이 원래 의도인지 한 번 물으세요. allow_no_cdr는 사용자 지정 편성에서 사용자가 확인한 뒤에만 true; 새 추천의 필수 조건을 우회하지 않습니다."""
        with public_errors():
            try:
                return inspect_squad_policy(squad, {n: c.model_dump(exclude_unset=True) for n, c in (characters or {}).items()}, purpose, allow_no_cdr)
            except ValueError as error:
                raise InvalidSettingsError(str(error)) from error

    @server.tool(annotations=read_only)
    def get_recommendation_evidence(mode: Literal['all', 'campaign', 'soloraid'] = 'all') -> dict[str, Any]:
        """2026-09-18에 직접 확인한 ENIKK 조합·표본·해석의 연구 스냅샷입니다. 최신 검색 결과가 아니며 사용률은 성능/승률이 아닙니다. 실제 요청 조건은 ENIKK에서 재확인하세요."""
        from nikke_mcp.recommendation_evidence import evidence
        return evidence(mode)

    @server.tool(annotations=calculation)
    def recommend_browser_squads(connection_code: str, candidates: list[RecommendationCandidate],
                                  squad_count: int = 1, include: list[str] | None = None,
                                  exclude: list[str] | None = None,
                                  scenarios: list[RecommendationScenario] | None = None) -> dict[str, Any]:
        """ENIKK 등에서 구성한 1~20개 후보를 현재 브라우저 육성·전투 조건으로 계산하고 중복 없는 1~5덱을 선택합니다. 쿨감 필수 검사 후 expected 계산. 추가 전투 조건 최대2개에서 최대 상대 손실을 최소화합니다. include는 선택된 모든 덱의 합집합에 필수, exclude는 모든 덱에서 금지. 입력 후보 내 최적화이며 전체 최적해/클리어 보장 아님. 저장값은 변경하지 않습니다. get_browser_result로 완료까지 조회하세요."""
        if not browser_mode:
            fail('BROWSER_CONNECTION_REQUIRED', '공개 HTTP MCP와 연결한 사용자 브라우저에서 지원합니다.')
        if not 1 <= len(candidates) <= 20 or not 1 <= squad_count <= 5 or len(scenarios or []) > 2:
            fail('INVALID_SETTINGS', '후보 1~20개, 덱 수 1~5, 추가 조건 최대2개입니다.')
        required, forbidden = include or [], exclude or []
        if set(required) & set(forbidden) or (set(required) | set(forbidden)) - set(character_names()):
            fail('INVALID_SETTINGS', '필수·제외 캐릭터의 충돌 또는 정식 이름을 확인하세요.')
        return relay.submit(connection_code, {'kind': 'recommend', 'options': {
            'candidates': [c.model_dump(exclude_none=True) for c in candidates], 'squadCount': squad_count,
            'include': required, 'exclude': forbidden,
            'scenarios': [s.model_dump() for s in (scenarios or [])]}})

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
                          '현재 브라우저 육성은 inspect_browser_state와 get_browser_result로 확인합니다. 파일 공유는 필요 없습니다.',
                          '미지원: 일반 백업/계정 로그인, 커스텀 캐릭터, 핵 옵션.'],
                  'sharedStateSchema': SharedState.model_json_schema(),
                  'defenseRateGuide': {
                      'source': 'https://arca.live/b/nikketgv/183364010',
                      'example': {'defenseRateWindows': [{'from': 30, 'to': 60, 'rate': 60}, {'from': 90, 'to': 120, 'rate': 60}]},
                      'notes': ['리버렐리오 바디 심해의 장막: 일반 최종 대미지 ×0.4, 방어력 무시 대미지는 그대로인 커뮤니티 실험을 모델링합니다.',
                                '장막의 실제 시작·종료 시각은 자동 추정하지 않습니다. 사용자 관측 구간을 입력하세요.',
                                '방어력 증가나 받는 대미지 증가와 상쇄하는 항이 아닙니다. 방어력 무시 대미지 증가 버프만으로 공격 유형이 바뀌지는 않습니다.',
                                '방어력 감소와 장막의 상호작용은 원문에서도 미검증입니다. 현재는 방깎 계산 후 독립 배율로 적용합니다. 겹치는 장막은 가장 높은 감소율 하나만 적용합니다.'],
                  },
                'browserFallback': {
                    'url': 'https://moris-kr.github.io/nikke-calc/',
                    'steps': [
                        '전용 MCP 도구가 없으면 사용 가능한 웹/브라우저 도구로 계산기 페이지의 메뉴와 기능을 확인합니다. MCP가 임의의 브라우저 제어 기능을 제공하는 것은 아닙니다.',
                        '사용자 육성 작업은 AI 연결이 켜진 실제 사용자 탭인지 확인합니다. 새 탭·다른 프로필·원격 브라우저의 육성값을 사용자 계정으로 간주하지 않습니다. 정보가 없다면 육성을 불러오도록 안내합니다.',
                        '읽기 전용 웹 검색은 메뉴를 찾는 용도입니다. 입력·클릭은 실제 조작 가능한 브라우저 도구가 있을 때만 하며, 화면에 존재하는 컨트롤과 도움말을 근거로 진행합니다.',
                        '요청 범위의 계산·조회는 진행하되, 원래 설정을 보존하고 비교용 임시 변경은 복구합니다. 저장·계정 연동·공개 공유·삭제 등 별도 영향을 주는 작업은 사용자 요청과 권한 범위를 확인합니다.',
                        '결과가 실제 표시됐는지 확인하고 조건·수치를 보고합니다. 브라우저가 없거나 기능이 없거나 접근이 막히면 구체적인 제한과 사용자가 따라 할 메뉴/입력 순서를 안내합니다. 미실행 결과를 만들지 않습니다.',
                    ],
                },
                'engineVersion': engine_version()}

    @server.tool(annotations=calculation)
    def compare_browser_growth(connection_code: str, name: str, scenarios: list[GrowthScenario]) -> dict[str, Any]:
        """현재 브라우저 육성에서 변경안별 예상 전투력·증가량을 비교합니다(1~12개). 사용자 PC에서 계산하며 저장 육성은 변경하지 않습니다. 각 변경안은 현재 기준 독립 비교입니다. 장비 4310은 머리4/팔3/몸통1/다리0 목표 단계이며 증가 단계가 아닙니다. 소장품 R15→SR5/SR15는 각각 별도 changes.collection.stage로 지정하세요. 결과는 get_browser_result로 조회합니다."""
        if not browser_mode:
            fail('BROWSER_CONNECTION_REQUIRED', '이 도구는 공개 HTTP MCP와 연결된 계산기 브라우저에서 지원합니다. get_settings.browserFallback을 확인하세요.')
        if name not in character_names() or not 1 <= len(scenarios) <= 12:
            fail('INVALID_SETTINGS', '정식 캐릭터 이름과 변경안 1~12개를 지정하세요.')
        return relay.submit(connection_code, {'kind': 'growth', 'name': name,
            'scenarios': [s.model_dump(exclude_none=True, exclude_unset=True) for s in scenarios]})

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
        """기존 공유 형식의 JSON 객체를 검증하는 호환 도구입니다. 현재 웹 육성은 inspect_browser_state로 조회하세요. 파일 경로나 URL은 받지 않습니다."""
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
    def export_overload_plan(connection_code: str) -> dict[str, Any]:
        """육성효율 창의 목표·현재 장비·잠금과 실행 가능한 모듈 계산 코드를 내보냅니다. get_browser_result로 packet/prompt를 받으세요. AI의 Node.js·Python 코드 실행 환경에서 수행하며 도구가 없으면 추측하지 마세요. 대화·계정 ID·프로필 사진은 포함하지 않습니다. 모듈 탐색과 기본 육성 비교 전투를 외부에서 계산합니다. 별도로 요청하는 덱 내 우선순위는 브라우저 계산입니다. 결과는 import_overload_plan_result로 반환합니다."""
        return relay.submit(connection_code, {'kind': 'module-export'})

    @server.tool(annotations=ToolAnnotations(read_only_hint=False, destructive_hint=False,
                                           idempotent_hint=False, open_world_hint=False))
    def import_overload_plan_result(connection_code: str, result_json: str) -> dict[str, Any]:
        """외부 코드 실행의 결과 JSON을 육성효율 창으로 가져옵니다. 요청 식별자·목표·합계·표본 수를 검증하지만 실제 실행은 증명하지 않습니다. 저장 육성을 덮어쓰지 않고 외부 계산으로 표시합니다. get_browser_result로 완료를 확인하세요. 입력 코드는 실행하지 않습니다."""
        if len(result_json) > 2_000_000:
            fail('INVALID_SETTINGS', '결과 JSON은 2MB 이하로 전달하세요.')
        return relay.submit(connection_code, {'kind': 'module-import', 'moduleResult': result_json})

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
