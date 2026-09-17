"""Read-only catalog and bounded, isolated calculator execution."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import sys
from functools import lru_cache
from typing import Any

from nikke_mcp.models import ROOT, CombatRequest, character_names, data
from nikke_mcp.errors import ServerBusyError, EngineProcessError, InvalidSettingsError


@lru_cache(maxsize=1)
def engine_version() -> str:
    digest = hashlib.sha256()
    files = [*(ROOT / 'calculator').glob('*.py'), *(ROOT / 'context').glob('*.py'),
             *(ROOT / 'data').rglob('*.json'), ROOT / 'site/pybridge/bridge.py',
             ROOT / 'scraper/preview_skills.json', ROOT / 'scraper/nikke_scraped.json',
             *(ROOT / 'nikke_mcp').glob('*.py')]
    for path in sorted(files):
        if path.name.startswith('test_'):
            continue
        digest.update(path.relative_to(ROOT).as_posix().encode())
        # Git checkouts may use CRLF or LF; version represents the same text.
        digest.update(path.read_text(encoding='utf-8').replace('\r\n', '\n').encode())
    return digest.hexdigest()[:20]


def list_characters(query: str = '') -> dict[str, Any]:
    if len(query) > 100:
        raise InvalidSettingsError('검색어는 100자 이하입니다.')
    catalog = data('data/parsed_nikke.json')
    rows = [{'name': name, **{k: catalog[name].get(k) for k in
             ('element_code', 'weapon_type', 'burst_stage', 'burst_cooldown')}}
            for name in character_names() if query.replace(' ', '') in name.replace(' ', '')]
    return {'characters': rows, 'count': len(rows), 'engineVersion': engine_version()}


def get_character(name: str, skill_level: int = 10) -> dict[str, Any]:
    if name not in character_names():
        raise InvalidSettingsError('정식 이름을 list_characters로 확인하세요.')
    if isinstance(skill_level, bool) or not 1 <= skill_level <= 10:
        raise InvalidSettingsError('스킬 레벨은 1~10입니다.')
    raw = data('scraper/nikke_scraped.json').get(name)
    preview = raw is None
    if raw is None:
        raw = data('scraper/preview_skills.json').get(name, {})
    skills = []
    for title, skill in raw.get('스킬', {}).items():
        values = skill.get('values', {}).get(str(skill_level))
        if values is None:
            raise InvalidSettingsError('요청 레벨의 원문 수치가 없습니다. 프리뷰는 Lv10만 지원합니다.')
        text = re.sub(r'\{(\d+)\}', lambda m: str(values[int(m[1])]), skill.get('template', ''))
        skills.append({'name': title, 'description': text, 'cooldown': skill.get('쿨타임')})
    return {'name': name, 'skillLevel': skill_level, 'skills': skills,
            'stats': data('data/parsed_nikke.json')[name],
            'previewNote': '[프리뷰 · 미검증]' if preview else '',
            'source': 'scraper/nikke_scraped.json' if not preview else 'scraper/preview_skills.json',
            'engineVersion': engine_version()}


class CalculatorService:
    def __init__(self, timeout: float = 60, max_concurrent: int = 2):
        self.timeout = timeout
        self.slots = asyncio.Semaphore(max_concurrent)

    async def simulate(self, request: CombatRequest, detail: bool = False) -> dict:
        try:
            await asyncio.wait_for(self.slots.acquire(), timeout=2)
        except asyncio.TimeoutError as error:
            raise ServerBusyError('다른 계산이 실행 중입니다. 동시 요청하지 말고 앞선 계산이 끝난 뒤 순서대로 다시 호출하세요. 육성이나 편성을 바꿀 필요는 없습니다.') from error
        try:
            child = await asyncio.create_subprocess_exec(
                sys.executable, '-m', 'nikke_mcp.worker', cwd=str(ROOT),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ, 'PYTHONUTF8': '1'},
            )
            try:
                stdout, _ = await asyncio.wait_for(
                    child.communicate(request.model_dump_json(exclude_none=True).encode('utf-8')), self.timeout)
            except BaseException as error:
                if child.returncode is None:
                    child.kill()
                await child.communicate()
                if isinstance(error, asyncio.TimeoutError):
                    raise TimeoutError('계산 시간 제한을 초과했습니다. 전투 시간을 줄여 다시 시도하세요.') from error
                raise
            if child.returncode:
                raise EngineProcessError('계산 프로세스 실행에 실패했습니다. 설치 및 서버 로그를 확인하세요.')
            try:
                output = json.loads(stdout)
            except (ValueError, UnicodeError) as error:
                raise EngineProcessError('계산 프로세스가 올바른 결과를 반환하지 않았습니다.') from error
            if not isinstance(output, dict) or 'error' in output:
                # Worker messages may originate in unexpected engine exceptions.
                # Do not publish their raw strings as user-input errors.
                raise EngineProcessError('검증된 요청을 계산하는 중 내부 오류가 발생했습니다. 호출 입력과 엔진 버전을 운영자에게 전달해 주세요.')
        finally:
            self.slots.release()
        if not detail:
            for key in ('timeline', 'buffTargets'):
                output['result'].pop(key, None)
        return {'engineVersion': engine_version(), 'request': request.model_dump(exclude_none=True), **output,
                'limitations': ['시뮬레이터 결과이며 실게임 측정값이 아닙니다.',
                                'random 모드는 지정 seed의 단일 시행입니다. 통계적 신뢰구간을 제공하지 않습니다.',
                                '생략한 육성은 공통 기본 스펙과 캐릭터별 기본 설정을 사용합니다.',
                                '전투 조건은 request, 적용 육성은 effectiveCharacters, 기본 이탈은 result.deviations를 확인하세요.']}

    async def compare(self, requests: list[CombatRequest]) -> dict:
        if not 2 <= len(requests) <= 5:
            raise InvalidSettingsError('비교 후보는 2~5개입니다.')
        def battle(req):
            return req.model_dump(exclude={'squad', 'characters'})
        if any(battle(req) != battle(requests[0]) for req in requests[1:]):
            raise InvalidSettingsError('비교 후보의 전투 시간·보스·난수 모드·seed는 같아야 합니다.')
        candidates = []
        for index, request in enumerate(requests):
            result = await self.simulate(request)
            total = result['result']['squadTotal']
            first = candidates[0]['result']['squadTotal'] if candidates else total
            candidates.append({**result, 'candidate': index + 1, 'deltaFromFirst': total - first,
                               'percentFromFirst': (total / first - 1) * 100 if first else None})
        return {'candidates': candidates, 'testedCandidates': len(candidates),
                'ranking': [row['candidate'] for row in sorted(candidates,
                    key=lambda row: row['result']['squadTotal'], reverse=True)],
                'scope': '입력한 후보만 비교했습니다. 전체 조합의 최적해를 보장하지 않습니다.'}
