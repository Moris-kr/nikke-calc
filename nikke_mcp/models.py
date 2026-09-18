"""Small, explicit public API; unsupported browser options fail closed."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from calculator.customization import (CUBE_NAMES, COLLECTION_STAGES, normalize_character_overrides,
    normalize_console, normalize_burst_sequence, normalize_normal_hit_coeff)

ROOT = Path(__file__).resolve().parents[1]


@lru_cache(maxsize=8)
def data(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding='utf-8'))


def character_names() -> list[str]:
    return sorted(name for name in data('data/parsed_nikke.json')
                  if name in data('data/parsed_skills.json') and not name.startswith('test_'))


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False, serialize_by_alias=True)


class Cube(StrictModel):
    name: str = Field(json_schema_extra={'enum': ['없음', *CUBE_NAMES]})
    level: int = Field(ge=0, le=15)

    @model_validator(mode='after')
    def no_cube_level(self):
        if self.name == '없음' and self.level != 0:
            raise ValueError('큐브 없음은 level=0이어야 합니다.')
        return self


class Collection(StrictModel):
    stage: str = Field(default='없음', json_schema_extra={'enum': list(COLLECTION_STAGES)})
    favorite: int = Field(default=0, ge=0, le=3, description='애장품 단계. 1~3이면 stage는 SR15로 적용됩니다.')


class BurstPriority(StrictModel):
    mode: Literal['priority']
    every: int = Field(default=1, ge=1, le=100)


class BurstSkip(StrictModel):
    mode: Literal['skip']


class BurstEndgame(StrictModel):
    mode: Literal['endgame']
    seconds: float = Field(default=20, gt=0, le=180)


class TapFire(StrictModel):
    rate: float = Field(ge=.1, le=20)
    release: float | None = Field(default=None, ge=0, le=1)
    full_charge_interval: float | None = Field(default=None, ge=0, le=300)


class Reload(StrictModel):
    policy: Literal['before_fb_end', 'into_fb']
    lead: float | None = Field(default=None, ge=0, le=300)
    margin: float | None = Field(default=None, ge=0, le=300)
    duration: float | None = Field(default=None, ge=0, le=300)
    if_dry: bool | None = None


class Cover(StrictModel):
    policy: Literal['own_full_burst']
    extend: float | None = Field(default=None, ge=0, le=300)


class Hold(StrictModel):
    policy: Literal['own_full_burst', 'charge_hold_after_fb']
    lead: float | None = Field(default=None, ge=0, le=300)


class Control(StrictModel):
    bunny_mode: Literal['stance', 'engage'] | None = None
    tap_fire: TapFire | None = None
    reload: Reload | None = None
    cover: Cover | None = None
    hold: Hold | None = None


class CharacterOverrides(StrictModel):
    growthStage: int | None = Field(default=None, ge=0, le=10,
        description='R=0, SR=0~2, SSR=0~10. 0~3은 돌파, 4~10은 코어 강화.')
    skillLevels: dict[Literal['1', '2', '3'], Annotated[int, Field(ge=1, le=10)]] | None = None
    cube: Cube | None = None
    collection: Collection | None = None
    overload: dict[str, float] | None = Field(default=None, description='get_settings.overloadFields의 키와 범위를 사용. 백분율 수치.')
    manualStats: dict[str, float] | None = Field(default=None, description='get_settings.manualStats의 키와 범위를 사용.')
    equipLevels: dict[Literal['머리', '몸통', '팔', '다리'],
        Annotated[int, Field(ge=0, le=5)] | Literal['없음', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9']] | None = None
    burst: Annotated[BurstPriority | BurstSkip | BurstEndgame, Field(discriminator='mode')] | None = None
    control: Control | None = None
    weaponModeSwapAt: float | None = Field(default=None, ge=0, le=180,
        description='신데렐라 : 크리스탈 웨이브의 저격 모드 변경 시점(초).')


class ConsoleLevels(StrictModel):
    common_level: int = Field(ge=0, le=1000)
    class_level: dict[str, Annotated[int, Field(ge=0, le=1000)]]
    company_level: dict[str, Annotated[int, Field(ge=0, le=1000)]]

    @model_validator(mode='after')
    def validate_console(self):
        normalize_console(self.model_dump())
        return self


class GrowthCube(StrictModel):
    name: str | None = Field(default=None, json_schema_extra={'enum': ['없음', *CUBE_NAMES]})
    level: int | None = Field(default=None, ge=0, le=15)


class GrowthChanges(CharacterOverrides):
    cube: GrowthCube | None = None


class GrowthScenario(StrictModel):
    label: str = Field(min_length=1, max_length=100)
    changes: GrowthChanges = Field(description='현재 육성에 덮어쓸 변경만 지정. 각 변경안은 독립 비교. 장비 4310=머리4·팔3·몸통1·다리0이며, equipLevels 정수는 오버로드 강화 목표 단계.')

    @model_validator(mode='after')
    def validate_changes(self):
        changes = self.changes.model_dump(exclude_unset=True, exclude_none=True)
        if not changes or set(changes) - {'growthStage', 'skillLevels', 'cube', 'collection', 'overload', 'equipLevels'}:
            raise ValueError('전투력 비교는 돌파·스킬·큐브·소장품·오버로드·장비 변경만 지원합니다.')
        return self


class PhaseWindow(StrictModel):
    start: float = Field(alias='from', ge=0, le=180)
    to: float = Field(ge=0, le=180)

    @model_validator(mode='after')
    def validate_interval(self):
        if self.start >= self.to:
            raise ValueError('구간 시작은 끝보다 앞서야 합니다.')
        return self


class ElementWindow(PhaseWindow):
    code: Literal['풍압', '수냉', '작열', '전격', '철갑']


class DefenseRateWindow(PhaseWindow):
    rate: float = Field(default=60, ge=0, le=100)


class PiercePass(StrictModel):
    shapes: int = Field(ge=1, le=20)
    parts: int = Field(ge=0, le=20)


class BattleOptions(StrictModel):
    duration: int = Field(default=180, ge=1, le=180)
    enemyDef: int = Field(default=31784, ge=0, le=10000000)
    enemyCode: Literal['', '풍압', '수냉', '작열', '전격', '철갑'] = ''
    corePx: float = Field(default=0, ge=0, le=1000)
    defenseRateWindows: list[DefenseRateWindow] = Field(default_factory=list, max_length=100,
        description='리버렐리오 바디 심해의 장막 방어율 구간. from/to는 전투 시작 기준 초, rate는 감소율%(기본60). 일반 최종 대미지에 (1-rate/100), 방어력 무시 대미지는 우회. 단순 방무 대미지 증가 버프는 우회 불가. 시작 포함·끝 제외, 겹치면 최대 rate만 적용. 커뮤니티 실험 기반이며 방깎 상호작용 미검증.')
    coreWindows: list[PhaseWindow] = Field(default_factory=list, max_length=100,
        description='코어 노출 구간(전투 시작 기준 초). 빈 배열이면 상시 노출. corePx=0이면 구간과 무관하게 코어 없음. 시작 포함·끝 제외.')
    hasParts: bool = False
    seed: int = Field(default=42, ge=0, le=2147483647)
    rngMode: Literal['expected', 'random'] = 'expected'
    synchroLevel: int = Field(default=400, ge=1, le=1400)
    console: ConsoleLevels | None = None
    burstRegenTime: float | None = Field(default=None, ge=0, le=20)
    burstReaction: float | None = Field(default=None, ge=0, le=3)
    optimalRangeWeapons: list[Literal['AR', 'SMG', 'SG', 'SR', 'RL', 'MG']] = Field(default_factory=list, max_length=6)
    immuneWindows: list[PhaseWindow] = Field(default_factory=list, max_length=100)
    elementWindows: list[ElementWindow] = Field(default_factory=list, max_length=100)
    immuneBlocksBurst: bool = True
    normalHitCoeff: dict[str, float] = Field(default_factory=dict)
    partBreakInterval: float | None = Field(default=None, ge=0, le=100000)
    piercePass: PiercePass | None = None

    @model_validator(mode='after')
    def validate_coefficients(self):
        normalize_normal_hit_coeff(self.normalHitCoeff)
        return self


class CombatRequest(BattleOptions):
    squad: list[str] = Field(min_length=1, max_length=5, description='등록된 정식 캐릭터명. 왼쪽부터 편성 순서.')
    burstSequence: list[dict[Literal['1', '2', '3'], list[str]]] | None = Field(default=None, max_length=60)
    stateTrack: bool = False
    shotTrack: bool = False
    fineTimeline: bool = False
    characters: dict[str, CharacterOverrides] = Field(default_factory=dict,
        description='정식 이름별 웹 계산기 CharacterOverrides. get_settings로 옵션과 형식을 조회하세요.')

    @model_validator(mode='after')
    def validate_roster(self):
        normalize_burst_sequence(self.burstSequence, self.squad)
        if len(set(self.squad)) != len(self.squad):
            raise ValueError('같은 캐릭터를 중복 편성할 수 없습니다.')
        unknown = set(self.squad) - set(character_names())
        if unknown:
            raise ValueError(f'등록되지 않은 정식 이름: {sorted(unknown)}. list_characters로 확인하세요.')
        if set(self.characters) - set(self.squad):
            raise ValueError('편성에 없는 캐릭터의 설정입니다.')
        if len(self.model_dump_json(exclude_none=True).encode('utf-8')) > 32000:
            raise ValueError('캐릭터 설정이 너무 큽니다.')
        for name, overrides in self.characters.items():
            normalize_character_overrides(overrides.model_dump(exclude_none=True), character_name=name)
        return self
