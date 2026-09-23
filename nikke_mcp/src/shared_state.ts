/** Versioned browser snapshots. Validated per call; never persisted or fetched by URL. (py: nikke_mcp/shared_state.py) */
import { normalize_character_overrides } from '../../site/src/engine/customization.ts';
import { ValueError } from '../../site/src/engine/py.ts';
import { character_names } from './engine.ts';
import { InvalidSettingsError } from './errors.ts';
import { BattleOptions, CharacterOverrides, CombatRequest, dumpJsonSize, sortedRepr } from './models.ts';
import { Inst, Model, dict, dump, list, lit, ref } from './pydantic.ts';

export const SharedState = new Model('SharedState', [
  { name: 'format', type: lit('nikke-calc-mcp') },
  { name: 'version', type: lit(1) },
  { name: 'battle', type: ref(BattleOptions) },
  { name: 'roster', type: dict(ref(CharacterOverrides), undefined, { max: 500 }) },
  { name: 'decks', type: list(ref(CombatRequest), { max: 20 }) },
], { strict: true, forbid: true, validators: [(self) => {
  if (dumpJsonSize(self) > 800000) throw ValueError('공유 데이터는 800KB 이하여야 합니다.');
  const known = new Set(character_names());
  const roster = self.v['roster'] as Record<string, Inst>;
  const unknown = Object.keys(roster).filter((name) => !known.has(name));
  if (unknown.length) throw ValueError(`등록되지 않은 캐릭터: ${sortedRepr(unknown)}`);
  for (const [name, value] of Object.entries(roster)) {
    normalize_character_overrides(dump(value, { excludeNone: true }), { character_name: name });
  }
}] });

export function shared_request(state: Inst, deck_index: number = 1, squad: string[] | null = null): Inst {
  const roster = state.v['roster'] as Record<string, Inst>;
  if (squad !== null) {
    const missing = squad.filter((name) => !Object.hasOwn(roster, name));
    if (missing.length) {
      throw new InvalidSettingsError(`공유 로스터에 육성이 없습니다: ${sortedRepr(missing)}. 기본 육성으로 대체하지 않습니다.`);
    }
    return CombatRequest.validate({
      ...dump(state.v['battle'], { excludeNone: true }),
      squad, characters: Object.fromEntries(squad.map((name) => [name, roster[name]])),
    });
  }
  const decks = state.v['decks'] as Inst[];
  if (!(deck_index >= 1 && deck_index <= decks.length)) {
    throw new InvalidSettingsError('deck_index는 공유 파일의 1부터 시작하는 덱 번호여야 합니다.');
  }
  return decks[deck_index - 1]!;
}

export function inspect_shared(state: Inst): Record<string, unknown> {
  const roster = state.v['roster'] as Record<string, Inst>;
  const decks = state.v['decks'] as Inst[];
  return {
    format: state.v['format'], version: state.v['version'],
    rosterCount: Object.keys(roster).length, deckCount: decks.length,
    roster: Object.fromEntries(Object.entries(roster).map(([name, value]) => [name, dump(value, { excludeNone: true, py: true })])),
    battle: dump(state.v['battle'], { excludeNone: true, py: true }),
    decks: decks.map((deck, i) => ({ deck_index: i + 1, request: dump(deck, { excludeNone: true, py: true }) })),
    notes: ['내보낸 시점의 설정입니다. 웹 변경 후 다시 공유하세요.',
      'roster는 불러온 육성, decks는 덱에서 수정한 설정입니다. 덱 계산은 decks를 그대로 사용합니다.',
      '빈 설정이나 생략된 필드는 계산기 기본값입니다. 실제 계정 육성으로 단정하지 마세요.',
      '서버는 공유 데이터를 저장하지 않습니다. 다음 도구 호출에도 state를 전달하세요.'],
  };
}
