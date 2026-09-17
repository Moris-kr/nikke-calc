import { normalizeRequest } from './model';
import { hacksOn } from './hacks';
import type { CharacterOverrides, SimulationRequest } from './types';

export interface McpShare {
  format: 'nikke-calc-mcp';
  version: 1;
  battle: Omit<SimulationRequest, 'squad' | 'characters'>;
  roster: Record<string, CharacterOverrides>;
  decks: SimulationRequest[];
}

/** Only calculation input is exported. Never read localStorage wholesale. */
export function buildMcpShare(
  roster: Record<string, CharacterOverrides>, battle: SimulationRequest, decks: SimulationRequest[],
): McpShare {
  if (decks.length > 20) throw new Error('MCP 공유는 편성 20개까지 지원합니다. 편성을 줄인 뒤 다시 내보내세요.');
  if (Object.keys(roster).length > 500) throw new Error('MCP 공유는 로스터 500명까지 지원합니다.');
  const clean = (input: SimulationRequest): SimulationRequest => {
    if (input.customCharacters && Object.keys(input.customCharacters).length) {
      throw new Error('커스텀 캐릭터는 MCP 공유를 지원하지 않습니다. 일반 캐릭터로 편성해 주세요.');
    }
    if (hacksOn(input.hacks)) {
      throw new Error('핵 옵션은 MCP 공유를 지원하지 않습니다. 옵션을 끄고 다시 내보내세요.');
    }
    return normalizeRequest(input);
  };
  const { squad: _squad, characters: _characters, burstSequence: _sequence,
    stateTrack: _state, shotTrack: _shot, fineTimeline: _fine, ...conditions } = clean(battle);
  const rosterSettings: Record<string, CharacterOverrides> = {};
  for (const [name, value] of Object.entries(roster)) {
    // The web engine uses summed overload values, not screen-only line metadata.
    rosterSettings[name] = normalizeRequest({ ...battle, squad: [name], characters: { [name]: value } }).characters?.[name] ?? {};
  }
  const result: McpShare = { format: 'nikke-calc-mcp', version: 1,
    battle: conditions, roster: rosterSettings, decks: decks.map(clean) };
  const json = JSON.stringify(result);
  if (new TextEncoder().encode(json).length > 800000) throw new Error('공유 데이터는 800KB 이하여야 합니다.');
  return JSON.parse(json) as McpShare;
}
