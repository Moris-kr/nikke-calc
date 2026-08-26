import { describe, expect, it } from 'vitest';

import {
  applyShareToDecks, decodeBattleCode, decodeShareCode, encodeBattleCode, encodeShareCode, nameHash,
} from './share-code';
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


describe('전투 조건 공유 코드 (NK3)', () => {
  const COEFF = { AR: 1, SMG: 1, SG: 0.9, MG: 1, SR: 1, RL: 1 };
  const base = {
    duration: 180, synchroLevel: 400, enemyDef: 31_784, enemyCode: '' as const, coreEnabled: false,
    corePx: 52, hasParts: false, seed: 42, optimalRangeWeapons: [],
    normalHitCoeff: { ...COEFF }, immuneWindows: [], elementWindows: [],
    rngMode: 'expected' as const, immuneBlocksBurst: true, burstRegenTime: 2,
    console: { common_level: 390, class_level: { 화력형: 257 }, company_level: { 필그림: 386 } },
  };

  it('기본값은 아예 싣지 않아 코드가 아주 짧다', () => {
    // 붙여넣는 곳이 400자쯤에서 잘린다는 제보 — 기본값 생략이 가장 큰 절약이다.
    const code = encodeBattleCode(base, COEFF);
    expect(code.startsWith('NK3-')).toBe(true);
    expect(code.length).toBeLessThan(16);
  });

  it('바꾼 것만 실어도 왕복이 성립한다', () => {
    const battle = {
      ...base, duration: 120, enemyCode: '철갑' as const, coreEnabled: true,
      optimalRangeWeapons: ['SG', 'SMG'], rngMode: 'random' as const,
      immuneBlocksBurst: false, burstRegenTime: 2.8,
      immuneWindows: [{ from: 10, to: 30 }, { from: 90.5, to: 95 }],
      elementWindows: [{ from: 100, to: 102, code: '풍압' as const }],
    };
    const code = encodeBattleCode(battle, COEFF);
    expect(code.length).toBeLessThan(200);   // 붙여넣기 한도(약 400자)의 절반 아래
    const { console: _drop, synchroLevel: _level, ...expected } = battle;
    expect(decodeBattleCode(code)).toEqual({ ...expected, normalHitCoeff: {} });
  });

  it('평타 계수는 기본값과 다른 무기군만 싣는다', () => {
    const code = encodeBattleCode(
      { ...base, normalHitCoeff: { ...COEFF, SG: 0.8 } }, COEFF);
    expect(decodeBattleCode(code).normalHitCoeff).toEqual({ SG: 0.8 });
    // 여섯 개를 다 실었다면 훨씬 길어진다.
    expect(code.length).toBeLessThan(50);
  });

  it('콘솔은 담지 않는다 — 남의 계정 육성 상태가 딸려 오면 안 된다', () => {
    const code = encodeBattleCode(base, COEFF);
    expect(decodeBattleCode(code)).not.toHaveProperty('console');
    const body = atob(code.slice(4).replace(/-/g, '+').replace(/_/g, '/'));
    expect(body).not.toContain('common_level');
    expect(body).not.toContain('390');
  });

  it('싱크로 레벨도 담지 않는다 — 콘솔과 같은 계정 육성 상태다', () => {
    const code = encodeBattleCode({ ...base, synchroLevel: 777 }, COEFF);
    expect(decodeBattleCode(code)).not.toHaveProperty('synchroLevel');
    const body = atob(code.slice(4).replace(/-/g, '+').replace(/_/g, '/'));
    expect(body).not.toContain('777');
    // 레벨이 달라도 같은 전투 조건이면 코드가 같다.
    expect(encodeBattleCode({ ...base, synchroLevel: 100 }, COEFF)).toBe(code);
  });

  it('족자 중 버스트 충전 정지는 기본이 켜짐이다', () => {
    // 안 실린 코드를 읽으면 켜진 것으로 본다.
    expect(decodeBattleCode(encodeBattleCode(base, COEFF)).immuneBlocksBurst).toBe(true);
    const off = encodeBattleCode({ ...base, immuneBlocksBurst: false }, COEFF);
    expect(decodeBattleCode(off).immuneBlocksBurst).toBe(false);
  });

  it('범위를 벗어난 값과 못 쓰는 구간은 기본값으로 되돌린다', () => {
    const raw = JSON.stringify({
      d: 9999, ed: -5, s: 'x', ec: 99,
      iw: [[300, 100], [50, 90]],
      ew: [[10, 20, 0]],
    });
    let binary = '';
    for (const byte of new TextEncoder().encode(raw)) binary += String.fromCharCode(byte);
    const bad = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const got = decodeBattleCode(`NK3-${bad}`);
    expect(got.duration).toBe(180);
    expect(got.enemyDef).toBe(31_784);
    expect(got.seed).toBe(42);
    expect(got.enemyCode).toBe('');
    // 뒤집힌 구간은 버리고 쓸 수 있는 것만 남는다(0.1초 단위로 담긴다).
    expect(got.immuneWindows).toEqual([{ from: 5, to: 9 }]);
    // 속저 코드 0(없음)은 못 쓴다.
    expect(got.elementWindows).toEqual([]);
  });

  it('빈 코드와 깨진 코드는 사람이 읽을 메시지로 막는다', () => {
    expect(() => decodeBattleCode('   ')).toThrow(/입력해 주세요/);
    expect(() => decodeBattleCode('NK3-@@@')).toThrow(/해석하지 못했습니다|올바르지 않습니다/);
  });
});
