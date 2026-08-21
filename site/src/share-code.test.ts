import { describe, expect, it } from 'vitest';

import { applyShareToDecks, decodeShareCode, encodeShareCode } from './share-code';
import type { DeckState } from './types';

const deck = (id: number, squad: string[], characters: DeckState['characters'] = {}): DeckState =>
  ({ id, squad, characters });

const emptyDecks = (): DeckState[] =>
  Array.from({ length: 5 }, (_, i) => deck(i + 1, ['', '', '', '', '']));

describe('share code round trip', () => {
  it('carries the squads of five decks', () => {
    const decks = emptyDecks();
    decks[0]!.squad = ['리타', '크라운', '', '', ''];
    decks[4]!.squad = ['앨리스', '', '', '', ''];

    const code = encodeShareCode(decks, true);
    expect(code.startsWith('NIKKE1-')).toBe(true);

    const payload = decodeShareCode(code);
    expect(payload.fiveDeckMode).toBe(true);
    expect(payload.decks).toHaveLength(5);
    expect(payload.decks[0]!.squad).toEqual(['리타', '크라운', '', '', '']);
    expect(payload.decks[4]!.squad[0]).toBe('앨리스');
  });

  it('never carries personal specs — only names', () => {
    const decks = emptyDecks();
    decks[0]!.squad = ['리타', '', '', '', ''];
    decks[0]!.characters = {
      리타: {
        growthStage: 10,
        overload: { atk_pct: 43.03, element_bonus: 88.6 },
        cube: { name: '재장', level: 15 },
      },
    };

    const code = encodeShareCode(decks, false);
    // 코드 본문(base64) 어디에도 스펙 키가 들어가면 안 된다.
    const decoded = atob(code.slice('NIKKE1-'.length).replace(/-/g, '+').replace(/_/g, '/'));
    for (const leak of ['overload', 'atk_pct', 'element_bonus', 'growthStage', 'cube', 'battle', 'console']) {
      expect(decoded).not.toContain(leak);
    }
    expect(decodeShareCode(code).decks[0]!.squad[0]).toBe('리타');
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
  it('applies the receiver own specs (CSV roster) to the shared squad', () => {
    const decks = emptyDecks();
    const payload = decodeShareCode(encodeShareCode([
      deck(1, ['리타', '크라운', '', '', '']),
    ], false));

    const known = new Set(['리타', '크라운']);
    // 받는 사람의 CSV 로스터 — 리타만 등록돼 있다
    const myRoster: Record<string, DeckState['characters'][string]> = {
      리타: { growthStage: 7, overload: { atk_pct: 11.81 } },
    };

    const { applied, skipped } = applyShareToDecks(
      payload, decks, (n) => known.has(n), (n) => myRoster[n],
    );

    expect(applied).toBe(1);
    expect(skipped).toEqual([]);
    expect(decks[0]!.squad).toEqual(['리타', '크라운', '', '', '']);
    // 내 로스터 스펙이 얹힌다
    expect(decks[0]!.characters['리타']?.growthStage).toBe(7);
    expect(decks[0]!.characters['리타']?.overload?.['atk_pct']).toBe(11.81);
    // 로스터에 없는 캐릭터는 개별 설정 없이 기본값으로 돈다
    expect(decks[0]!.characters['크라운']).toBeUndefined();
  });

  it('drops names the catalog does not know and clears decks past the code', () => {
    const decks = emptyDecks();
    decks[4]!.squad = ['앨리스', '', '', '', ''];
    const payload = decodeShareCode(encodeShareCode([
      deck(1, ['리타', '없는캐릭', '', '', '']),
      deck(2, ['크라운', '', '', '', '']),
    ], true));

    const known = new Set(['리타', '크라운']);
    const { applied, skipped } = applyShareToDecks(payload, decks, (n) => known.has(n));

    expect(applied).toBe(2);
    expect(skipped).toEqual(['없는캐릭']);
    expect(decks[0]!.squad).toEqual(['리타', '', '', '', '']);
    expect(decks[1]!.squad[0]).toBe('크라운');
    expect(decks[4]!.squad).toEqual(['', '', '', '', '']);
  });
});
