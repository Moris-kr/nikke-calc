"""Versioned browser snapshots. Validated per call; never persisted or fetched by URL."""
from typing import Literal

from pydantic import Field, model_validator

from calculator.customization import normalize_character_overrides
from nikke_mcp.models import BattleOptions, CharacterOverrides, CombatRequest, StrictModel, character_names
from nikke_mcp.errors import InvalidSettingsError


class SharedState(StrictModel):
    format: Literal['nikke-calc-mcp']
    version: Literal[1]
    battle: BattleOptions
    roster: dict[str, CharacterOverrides] = Field(max_length=500)
    decks: list[CombatRequest] = Field(max_length=20)

    @model_validator(mode='after')
    def validate_shared(self):
        if len(self.model_dump_json(exclude_none=True).encode('utf-8')) > 800000:
            raise ValueError('공유 데이터는 800KB 이하여야 합니다.')
        unknown = set(self.roster) - set(character_names())
        if unknown:
            raise ValueError(f'등록되지 않은 캐릭터: {sorted(unknown)}')
        for name, value in self.roster.items():
            normalize_character_overrides(value.model_dump(exclude_none=True), character_name=name)
        return self


def shared_request(state: SharedState, deck_index: int = 1, squad: list[str] | None = None) -> CombatRequest:
    if squad is not None:
        missing = set(squad) - set(state.roster)
        if missing:
            raise InvalidSettingsError(f'공유 로스터에 육성이 없습니다: {sorted(missing)}. 기본 육성으로 대체하지 않습니다.')
        return CombatRequest.model_validate({**state.battle.model_dump(exclude_none=True),
            'squad': squad, 'characters': {name: state.roster[name] for name in squad}})
    if isinstance(deck_index, bool) or not 1 <= deck_index <= len(state.decks):
        raise InvalidSettingsError('deck_index는 공유 파일의 1부터 시작하는 덱 번호여야 합니다.')
    return state.decks[deck_index - 1]


def inspect_shared(state: SharedState) -> dict:
    return {'format': state.format, 'version': state.version,
            'rosterCount': len(state.roster), 'deckCount': len(state.decks),
            'roster': {name: value.model_dump(exclude_none=True) for name, value in state.roster.items()},
            'battle': state.battle.model_dump(exclude_none=True),
            'decks': [{'deck_index': i, 'request': deck.model_dump(exclude_none=True)}
                      for i, deck in enumerate(state.decks, 1)],
            'notes': ['내보낸 시점의 설정입니다. 웹 변경 후 다시 공유하세요.',
                      'roster는 불러온 육성, decks는 덱에서 수정한 설정입니다. 덱 계산은 decks를 그대로 사용합니다.',
                      '빈 설정이나 생략된 필드는 계산기 기본값입니다. 실제 계정 육성으로 단정하지 마세요.',
                      '서버는 공유 데이터를 저장하지 않습니다. 다음 도구 호출에도 state를 전달하세요.']}
