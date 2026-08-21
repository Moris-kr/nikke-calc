import { describe, expect, it } from 'vitest';

import { applyShareToDecks, decodeShareCode, encodeShareCode } from './share-code';
import type { BattleSettings, DeckState } from './types';

const deck = (id: number, squad: string[], characters: DeckState['characters'] = {}): DeckState =>
  ({ id, squad, characters });

const emptyDecks = (): DeckState[] =>
  Array.from({ length: 5 }, (_, i) => deck(i + 1, ['', '', '', '', '']));

const battle: BattleSettings = {
  duration: 180, enemyDef: 31_784, enemyCode: '풍압',
  coreEnabled: true, corePx: 52, hasParts: false, seed: 7,
  console: { common_level: 180, class_level: { 화력형: 100 }, company_level: { 테트라: 100 } },
};

describe('share code round trip', () => {
  it('carries five decks, per-character settings, and battle conditions', () => {
    const decks = emptyDecks();
    decks[0]!.squad = ['리타', '크라운', '', '', ''];
    decks[0]!.characters = { 리타: { growthStage: 10, cube: { name: '재장', level: 15 } } };
    decks[4]!.squad = ['앨리스', '', '', '', ''];

    const code = encodeShareCode(decks, true, battle);
    expect(code.startsWith('NIKKE1-')).toBe(true);

    const payload = decodeShareCode(code);
    expect(payload.fiveDeckMode).toBe(true);
    expect(payload.decks).toHaveLength(5);
    expect(payload.decks[0]!.squad).toEqual(['리타', '크라운', '', '', '']);
    expect(payload.decks[0]!.characters['리타']?.growthStage).toBe(10);
    expect(payload.decks[4]!.squad[0]).toBe('앨리스');
    expect(payload.battle?.enemyCode).toBe('풍압');
    expect(payload.battle?.seed).toBe(7);
    // 계정 콘솔도 딜에 영향을 주므로 함께 실린다
    expect(payload.battle?.console?.common_level).toBe(180);
    expect(payload.battle?.console?.class_level['화력형']).toBe(100);
  });

  it('trims trailing empty decks to keep the code short', () => {
    const decks = emptyDecks();
    decks[0]!.squad = ['리타', '', '', '', ''];
    const payload = decodeShareCode(encodeShareCode(decks, false));
    expect(payload.decks).toHaveLength(1);
  });

  it('rejects malformed codes with a readable message', () => {
    expect(() => decodeShareCode('')).toThrow(/입력/);
    expect(() => decodeShareCode('NIKKE1-!!!not-base64!!!')).toThrow(/해석/);
    expect(() => decodeShareCode(encodeShareCode([], false))).toThrow(/편성 정보/);
  });
});

describe('applyShareToDecks', () => {
  it('applies squads and drops names the catalog does not know', () => {
    const decks = emptyDecks();
    const payload = decodeShareCode(encodeShareCode([
      deck(1, ['리타', '없는캐릭', '', '', ''], { 리타: { growthStage: 3 }, 없는캐릭: { growthStage: 3 } }),
      deck(2, ['크라운', '', '', '', '']),
    ], true));

    const known = new Set(['리타', '크라운']);
    const { applied, skipped } = applyShareToDecks(payload, decks, (n) => known.has(n));

    expect(applied).toBe(2);
    expect(skipped).toEqual(['없는캐릭']);
    expect(decks[0]!.squad).toEqual(['리타', '', '', '', '']);
    expect(decks[0]!.characters['리타']?.growthStage).toBe(3);
    // 편성에서 빠진 캐릭터 설정은 함께 사라진다
    expect(decks[0]!.characters['없는캐릭']).toBeUndefined();
    expect(decks[1]!.squad[0]).toBe('크라운');
    // 코드에 없는 뒤쪽 덱은 비워진다
    expect(decks[4]!.squad).toEqual(['', '', '', '', '']);
  });
});
