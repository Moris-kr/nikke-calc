"""Validated, deterministic NK5/NK3 authoring; no browser or simulation required.

Wire format is owned by site/src/boss-maker.ts and site/src/share-code.ts.
Only fields those decoders preserve are accepted here.
"""
from __future__ import annotations

import base64
import json
import math
from typing import Annotated, Literal

from pydantic import Field, model_validator
from nikke_mcp.models import StrictModel, PhaseWindow, ElementWindow, DefenseRateWindow

Weapon = Literal['AR', 'SMG', 'SG', 'MG', 'SR']
ShapeWeapon = Literal['AR', 'SMG', 'SG', 'MG', 'SR', 'RL']
Coordinate = Annotated[float, Field(ge=-2000, le=4000)]
KINDS = ['circle', 'rect', 'triangle']
CODES = ['', '풍압', '수냉', '작열', '전격', '철갑']


def rounded(value: float, scale: int = 1) -> int:
    """Match JavaScript Math.round, including negative half values."""
    return math.floor(value * scale + 0.5)


class BossWindow(StrictModel):
    start: float = Field(alias='from', ge=0, le=1800)
    to: float = Field(ge=0, le=1800)

    @model_validator(mode='after')
    def valid_interval(self):
        if rounded(self.start, 10) >= rounded(self.to, 10):
            raise ValueError('구간 시작은 끝보다 앞서야 합니다(0.1초 단위).')
        return self


class BossShape(StrictModel):
    kind: Literal['circle', 'rect', 'triangle']
    x: Coordinate
    y: Coordinate
    w: float = Field(ge=4, le=2000)
    h: float = Field(ge=4, le=2000)
    rotation: float = Field(default=0, ge=-180, le=180)
    windows: list[BossWindow] = Field(default_factory=list, max_length=12,
        description='표시 구간(초). 빈 배열이면 상시 표시. 0.1초 단위로 공유됩니다.')
    range: list[ShapeWeapon] = Field(default_factory=list, max_length=6,
        description='이 도형을 겨냥할 때 적정거리인 무기군. RL의 엔진 적용 여부는 계산기 지원 범위를 따릅니다.')


class BossPart(BossShape):
    name: str = Field(min_length=1, max_length=16, pattern=r'\S')
    hp: int = Field(default=0, ge=0, le=10**12, description='0이면 파괴되지 않는 파츠.')
    score: int = Field(default=0, ge=0, le=10**12)


class BossPoint(StrictModel):
    x: Coordinate
    y: Coordinate


class BossCore(BossPoint):
    d: float = Field(ge=4, le=400, description='코어 지름(px).')


class BossAimKey(BossPoint):
    t: float = Field(ge=0, le=1800)


class BossCanvas(StrictModel):
    w: int = Field(default=960, ge=200, le=4000)
    h: int = Field(default=620, ge=200, le=4000)


class BossRangeWindow(PhaseWindow):
    weapons: list[Weapon] = Field(max_length=5)


class BossBattle(StrictModel):
    """Public battle share only; account growth and simulation-only fields excluded."""
    duration: int = Field(default=180, ge=10, le=180)
    enemyDef: int = Field(default=31784, ge=0, le=999999)
    enemyCode: Literal['', '풍압', '수냉', '작열', '전격', '철갑'] = ''
    coreEnabled: bool = False
    corePx: int = Field(default=52, ge=0, le=1000)
    hasParts: bool = False
    seed: int = Field(default=42, ge=0, le=2147483647)
    optimalRangeWeapons: list[Weapon] = Field(default_factory=list, max_length=5)
    normalHitCoeff: dict[ShapeWeapon, Annotated[float, Field(ge=0, le=2)]] = Field(default_factory=dict)
    coreWindows: list[PhaseWindow] = Field(default_factory=list, max_length=20)
    optimalRangeWindows: list[BossRangeWindow] = Field(default_factory=list, max_length=100)
    defenseRateWindows: list[DefenseRateWindow] = Field(default_factory=list, max_length=100)
    immuneWindows: list[PhaseWindow] = Field(default_factory=list, max_length=20)
    elementWindows: list[ElementWindow] = Field(default_factory=list, max_length=20)
    rngMode: Literal['expected', 'random'] = 'expected'
    immuneBlocksBurst: bool = True
    burstRegenTime: float = Field(default=2, ge=0, le=20)
    firstBurstTime: float = Field(default=0, ge=0, le=3600)
    burstReaction: float = Field(default=0.05, ge=0, le=3)

    @model_validator(mode='after')
    def shareable_windows(self):
        for field in ('coreWindows', 'optimalRangeWindows', 'defenseRateWindows', 'immuneWindows', 'elementWindows'):
            for window in getattr(self, field):
                if rounded(window.start, 10) >= rounded(window.to, 10):
                    raise ValueError('전투 구간은 공유 코드의 0.1초 단위에서도 길이가 있어야 합니다.')
        return self


class BossCodeRequest(StrictModel):
    name: str = Field(min_length=1, max_length=24, pattern=r'\S')
    canvas: BossCanvas = Field(default_factory=BossCanvas)
    shapes: list[BossShape] = Field(default_factory=list, max_length=60)
    parts: list[BossPart] = Field(default_factory=list, max_length=24)
    core: BossCore | None = None
    center: BossPoint | None = None
    aimKeys: list[BossAimKey] = Field(default_factory=list, max_length=60)
    settingsSource: Literal['drawing', 'battle'] = Field(default='drawing',
        description='drawing: 그림에서 코어·파츠·사거리 계산. battle: 함께 제공한 전투 수치를 사용.')
    battle: BossBattle | None = None

    @model_validator(mode='after')
    def coherent_design(self):
        if self.settingsSource == 'battle' and self.battle is None:
            raise ValueError('settingsSource=battle이면 battle 조건이 필요합니다.')
        times = [rounded(key.t, 10) for key in self.aimKeys]
        if any(left >= right for left, right in zip(times, times[1:])):
            raise ValueError('aimKeys는 0.1초 단위에서 중복 없이 시각순이어야 합니다.')
        # JavaScript limits strings by UTF-16 units, not Python code points.
        for name, limit in [(self.name, 24), *((p.name, 16) for p in self.parts)]:
            if len(name.encode('utf-16-le')) // 2 > limit:
                raise ValueError(f'이름은 UTF-16 기준 {limit}자 이하여야 합니다.')
        return self


def _code(prefix: str, raw: dict) -> str:
    data = json.dumps(raw, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
    return prefix + base64.urlsafe_b64encode(data).decode('ascii').rstrip('=')


def encode_battle(battle: BossBattle) -> str:
    raw = {}
    defaults = BossBattle()
    fields = [('duration', 'd'), ('enemyDef', 'ed'), ('enemyCode', 'ec'),
              ('coreEnabled', 'ce'), ('corePx', 'cp'), ('hasParts', 'hp'), ('seed', 's'),
              ('optimalRangeWeapons', 'or'), ('rngMode', 'rm'), ('immuneBlocksBurst', 'ib'),
              ('burstRegenTime', 'br'), ('burstReaction', 'rt'), ('firstBurstTime', 'fb')]
    def compact(field, value):
        if field == 'enemyCode': return CODES.index(value)
        if field in ('coreEnabled', 'hasParts', 'immuneBlocksBurst'): return int(value)
        if field == 'rngMode': return int(value == 'random')
        if field == 'optimalRangeWeapons': return sorted(value)
        if field in ('burstRegenTime', 'firstBurstTime'): return rounded(value, 10)
        if field == 'burstReaction': return rounded(value, 100)
        return value
    for field, key in fields:
        value = compact(field, getattr(battle, field))
        if value != compact(field, getattr(defaults, field)):
            raw[key] = value
    # Browser weapon defaults are not universally 1 (e.g. SG). Preserve every
    # explicitly supplied coefficient, so import cannot restore a different default.
    coeff = dict(battle.normalHitCoeff)
    if coeff: raw['hc'] = coeff
    for field, key, extra in [('defenseRateWindows', 'dw', 'rate'), ('optimalRangeWindows', 'rw', 'weapons'),
                              ('coreWindows', 'cw', None), ('immuneWindows', 'iw', None),
                              ('elementWindows', 'ew', 'code')]:
        entries = []
        for window in getattr(battle, field):
            entry = [rounded(window.start, 10), rounded(window.to, 10)]
            if extra:
                value = getattr(window, extra)
                entry.append(CODES.index(value) if extra == 'code' else value)
            entries.append(entry)
        if entries: raw[key] = entries
    return _code('NK3-', raw)


def _shape(shape: BossShape) -> dict:
    raw = {'k': KINDS.index(shape.kind), **{k: rounded(getattr(shape, k)) for k in ('x', 'y', 'w', 'h')}}
    if shape.rotation: raw['r'] = rounded(shape.rotation)
    if shape.windows: raw['v'] = [[rounded(w.start, 10), rounded(w.to, 10)] for w in shape.windows]
    if shape.range: raw['g'] = sorted(set(shape.range))
    return raw


def create_boss_code(request: BossCodeRequest) -> dict:
    raw = {'n': request.name.strip()}
    if request.canvas != BossCanvas(): raw['c'] = [request.canvas.w, request.canvas.h]
    if request.shapes: raw['s'] = [_shape(shape) for shape in request.shapes]
    if request.parts:
        raw['p'] = [{**_shape(p), 'n': p.name.strip(), 'hp': p.hp, **({'s': p.score} if p.score else {})} for p in request.parts]
    if request.aimKeys: raw['a'] = [[rounded(k.t, 10), rounded(k.x), rounded(k.y)] for k in request.aimKeys]
    if request.core: raw['k'] = [rounded(request.core.x), rounded(request.core.y), rounded(request.core.d)]
    if request.center: raw['m'] = [rounded(request.center.x), rounded(request.center.y)]
    if request.battle is not None: raw['b'] = encode_battle(request.battle)
    if request.settingsSource == 'battle': raw['bs'] = 'battle'
    return {
        'code': _code('NK5-', raw), 'format': 'NK5', 'settingsSource': request.settingsSource,
        'importInstructions': '계산기 → 보스 메이커 → 공유 → 받은 코드 넣기 → 새 보스로 받기에서 NK5 코드 전체를 붙여넣으세요. 도형과 조건을 확인한 뒤 전투에 적용하세요.',
        'warnings': [
            '코드 생성만 수행했습니다. 브라우저 조작이나 전투 시뮬레이션 결과가 아닙니다.',
            '좌표·크기는 px 정수, 구간은 0.1초 단위로 반올림됩니다. 실측 근거 없는 도형은 가정이며 실측값으로 표현하지 마세요.',
            '밑그림, 캐릭터별 탄착군·폭발 반경, 계정 육성은 이 도구가 담지 않습니다.',
            'drawing은 도형에서 코어·파츠·사거리를 적용하고, battle은 함께 담은 전투 조건 수치를 사용합니다.',
        ],
    }
