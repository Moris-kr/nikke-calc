import { describe, expect, it } from 'vitest';

import { applyShareToDecks, decodeShareCode, encodeShareCode, nameHash } from './share-code';
import type { DeckState } from './types';

const deck = (id: number, squad: string[], characters: DeckState['characters'] = {}): DeckState =>
  ({ id, squad, characters });

const emptyDecks = (): DeckState[] =>
  Array.from({ length: 5 }, (_, i) => deck(i + 1, ['', '', '', '', '']));

const FIVE_DECKS = [
  ['리타', '크라운', '라피 : 레드 후드', '앨리스', '나가'],
  ['리타 : 몸메이드', '마스트 : 로망틱 메이드', '로산나 : 시크 오션', '로산나', '라플라스 : 얼티밋 히어로'],
  ['리타', '레드 후드', '로산나 : 시크 오션', '로산나', '라플라스'],
  ['레이 (가칭)', '맥스웰 : 오디너리 미케닉', '브래디', '레이븐', '홍련'],
  ['나가', 'D : 킬러 와이프', '레이 (가칭)', '앨리스', '로산나 : 시크 오션'],
];

const allNames = [...new Set(FIVE_DECKS.flat())];

describe('share code round trip', () => {
  it('carries the squads of five decks', () => {
    const decks = emptyDecks();
    decks[0]!.squad = ['리타', '크라운', '', '', ''];
    decks[4]!.squad = ['앨리스', '', '', '', ''];

    const code = encodeShareCode(decks, true);
    expect(code.startsWith('NK2-')).toBe(true);

    const payload = decodeShareCode(code, ['리타', '크라운', '앨리스']);
    expect(payload.fiveDeckMode).toBe(true);
    expect(payload.decks).toHaveLength(5);
    expect(payload.decks[0]!.squad).toEqual(['리타', '크라운', '', '', '']);
    expect(payload.decks[4]!.squad[0]).toBe('앨리스');
  });

  it('keeps a full five-deck code short enough to paste anywhere', () => {
    const decks = FIVE_DECKS.map((squad, i) => deck(i + 1, squad));
    const code = encodeShareCode(decks, true);

    // 이름을 그대로 담던 옛 형식은 700자를 넘어 붙여넣는 곳에서 잘렸다.
    expect(code.length).toBeLessThan(130);
    expect(decodeShareCode(code, allNames).decks.map((d) => d.squad)).toEqual(FIVE_DECKS);
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
    // 바이너리라 이름조차 문자열로 남지 않는다 — 스펙은 더더욱 들어갈 자리가 없다.
    expect(code).not.toContain('리타');
    expect(code.length).toBeLessThan(20);
    expect(decodeShareCode(code, ['리타']).decks[0]!.squad[0]).toBe('리타');
  });

  it('survives new characters being added to the catalog (hash, not index)', () => {
    const code = encodeShareCode([deck(1, ['앨리스', '', '', '', ''])], false);
    // 목록 앞뒤에 신캐가 끼어들어도 해시는 이름에서만 나오므로 그대로 읽힌다.
    const laterCatalog = ['가나다 신캐', '앨리스', '힣힣 신캐'];
    expect(decodeShareCode(code, laterCatalog).decks[0]!.squad[0]).toBe('앨리스');
  });

  it('still reads the old NIKKE1 codes, names only', () => {
    const legacy = 'NIKKE1-' + btoa(unescape(encodeURIComponent(JSON.stringify({
      fiveDeckMode: false,
      decks: [{ squad: ['리타', '', '', '', ''], characters: { 리타: { growthStage: 10 } } }],
    })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const payload = decodeShareCode(legacy, ['리타']);
    expect(payload.decks[0]!.squad[0]).toBe('리타');
    expect((payload.decks[0] as { characters?: unknown }).characters).toBeUndefined();
  });

  it('trims trailing empty decks to keep the code short', () => {
    const decks = emptyDecks();
    decks[0]!.squad = ['리타', '', '', '', ''];
    expect(decodeShareCode(encodeShareCode(decks, false), ['리타']).decks).toHaveLength(1);
  });

  it('rejects malformed codes with a readable message', () => {
    expect(() => decodeShareCode('')).toThrow(/입력/);
    expect(() => decodeShareCode('NK2-A')).toThrow(/짧|해석/);
    expect(() => decodeShareCode('NIKKE1-!!!not-base64!!!')).toThrow(/해석/);
  });

  it('tells the user when a code was cut off mid-paste', () => {
    const decks = FIVE_DECKS.map((squad, i) => deck(i + 1, squad));
    const full = encodeShareCode(decks, true);
    const cut = full.slice(0, Math.floor(full.length * 0.6));
    expect(() => decodeShareCode(cut, allNames)).toThrow(/잘렸|해석/);
  });
});

describe('nameHash', () => {
  it('is stable per name and collision-free across a realistic roster', () => {
    expect(nameHash('앨리스')).toBe(nameHash('앨리스'));
    expect(nameHash('앨리스')).not.toBe(nameHash('리타'));
    const names = [...allNames, '도로시 : 세렌디피티', '아니스 : 스파클링 서머', '헬름 : 아쿠아마린'];
    expect(new Set(names.map(nameHash)).size).toBe(names.length);
  });
});

describe('applyShareToDecks', () => {
  it('applies the receiver own specs (CSV roster) to the shared squad', () => {
    const payload = decodeShareCode(
      encodeShareCode([deck(1, ['리타', '크라운', '', '', ''])], false),
      ['리타', '크라운'],
    );
    const decks = emptyDecks();
    const known = new Set(['리타', '크라운']);
    const myRoster: Record<string, DeckState['characters'][string]> = {
      리타: { growthStage: 7, overload: { atk_pct: 11.81 } },
    };

    const { applied, skipped } = applyShareToDecks(
      payload, decks, (n) => known.has(n), (n) => myRoster[n],
    );

    expect(applied).toBe(1);
    expect(skipped).toEqual([]);
    expect(decks[0]!.squad).toEqual(['리타', '크라운', '', '', '']);
    expect(decks[0]!.characters['리타']?.growthStage).toBe(7);
    expect(decks[0]!.characters['리타']?.overload?.['atk_pct']).toBe(11.81);
    // 로스터에 없는 캐릭터는 개별 설정 없이 기본값으로 돈다
    expect(decks[0]!.characters['크라운']).toBeUndefined();
  });

  it('drops characters the receiver catalog does not have', () => {
    // 보낸 쪽에는 있지만 받는 쪽 목록에 없는 니케(상대의 커스텀 등)
    const payload = decodeShareCode(
      encodeShareCode([deck(1, ['리타', '남의커스텀', '', '', ''])], false),
      ['리타'], // 받는 쪽 카탈로그에는 리타뿐
    );
    const decks = emptyDecks();
    const { applied, skipped } = applyShareToDecks(payload, decks, (n) => n === '리타');

    expect(applied).toBe(1);
    expect(skipped).toEqual(['알 수 없는 니케']);
    expect(decks[0]!.squad).toEqual(['리타', '', '', '', '']);
  });

  it('clears decks the code does not cover', () => {
    const decks = emptyDecks();
    decks[4]!.squad = ['앨리스', '', '', '', ''];
    const payload = decodeShareCode(
      encodeShareCode([deck(1, ['리타', '', '', '', ''])], false),
      ['리타', '앨리스'],
    );
    applyShareToDecks(payload, decks, () => true);
    expect(decks[4]!.squad).toEqual(['', '', '', '', '']);
  });
});
