import { expect, it } from 'vitest';
import { buildMcpShare } from './mcp-share';
import type { CharacterOverrides, SimulationRequest } from './types';

const request: SimulationRequest = { squad: ['리타'], duration: 10, enemyDef: 31784,
  enemyCode: '', corePx: 0, hasParts: false, seed: 42, synchroLevel: 321 };

it('전체 로스터와 덱 수정값을 구분하고 계정 식별 메타데이터를 제외한다', () => {
  const roster = { 리타: { skillLevels: { '1': 4, '2': 5, '3': 6 }, nickname: 'PRIVATE' } as CharacterOverrides };
  const result = buildMcpShare(roster, request, [{ ...request,
    characters: { 리타: { skillLevels: { '1': 10, '2': 10, '3': 10 } } } }]);
  expect(result.roster['리타']!.skillLevels!['1']).toBe(4);
  expect(result.decks[0]!.characters!['리타']!.skillLevels!['1']).toBe(10);
  expect(result.battle.synchroLevel).toBe(321);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(result).toMatchObject({ format: 'nikke-calc-mcp', version: 1 });
});

it('지원하지 않는 설정을 조용히 빠뜨리지 않는다', () => {
  expect(() => buildMcpShare({}, request, [{ ...request, customCharacters: { X: { nikke: {}, skills: [] } } }])).toThrow('커스텀');
  expect(() => buildMcpShare({}, { ...request, hacks: { infiniteAmmo: true } } as SimulationRequest, [])).toThrow('핵');
});

it('공유 파일은 이후 화면 수정에 영향받지 않는 스냅샷이다', () => {
  const roster = { 리타: { cube: { name: '없음', level: 0 } } };
  const result = buildMcpShare(roster, request, [request]);
  roster.리타.cube.level = 9;
  expect(result.roster.리타!.cube!.level).toBe(0);
});

it('서버의 편성 개수 제한을 내보내기 전에 안내한다', () => {
  expect(() => buildMcpShare({}, request, Array(21).fill(request))).toThrow('20개');
});
