import { describe, expect, it } from 'vitest';

import {
  applyShareToDecks, decodeBattleCode, decodeShareCode, decodeUnionCode,
  encodeBattleCode, encodeShareCode, encodeUnionCode, nameHash,
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
    rngMode: 'expected' as const, immuneBlocksBurst: true, burstRegenTime: 2, burstReaction: 0.05,
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

  it('버스트 반응속도는 담고, 없던 시절 코드는 기본값으로 읽는다', () => {
    const code = encodeBattleCode({ ...base, burstReaction: 0.12 }, COEFF);
    expect(decodeBattleCode(code).burstReaction).toBeCloseTo(0.12, 5);
    // 기본값이면 싣지 않는다 — 코드가 짧아야 붙여넣는 곳에서 안 잘린다.
    expect(encodeBattleCode(base, COEFF)).toBe(encodeBattleCode({ ...base }, COEFF));
    expect(decodeBattleCode(encodeBattleCode(base, COEFF)).burstReaction).toBe(0.05);
    // 이 항목이 생기기 전에 만들어진 코드(키 자체가 없다)도 0.05로 읽힌다.
    const legacy = 'NK3-' + btoa(JSON.stringify({ d: 90 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeBattleCode(legacy)).toMatchObject({ duration: 90, burstReaction: 0.05 });
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

describe('덱 한 칸만 주고받기', () => {
  it('한 칸에 넣으면 나머지 덱은 그대로 남는다', () => {
    const decks = emptyDecks();
    decks[0]!.squad = ['리타', '', '', '', ''];
    decks[1]!.squad = ['앨리스', '', '', '', ''];
    decks[4]!.squad = ['나가', '', '', '', ''];

    const one = encodeShareCode([deck(1, ['크라운', '레이븐', '', '', ''])], false);
    const result = applyShareToDecks(
      decodeShareCode(one, allNames), decks, () => true, undefined, 2,
    );

    expect(result.applied).toBe(1);
    expect(decks[2]!.squad).toEqual(['크라운', '레이븐', '', '', '']);
    // 예전에는 이 자리에서 2·5덱이 통째로 지워졌다.
    expect(decks[0]!.squad[0]).toBe('리타');
    expect(decks[1]!.squad[0]).toBe('앨리스');
    expect(decks[4]!.squad[0]).toBe('나가');
  });

  it('5덱짜리 코드를 한 칸에 떨어뜨리면 첫 덱만 들어간다', () => {
    const decks = emptyDecks();
    decks[3]!.squad = ['나가', '', '', '', ''];
    const five = emptyDecks();
    FIVE_DECKS.forEach((squad, i) => { five[i]!.squad = [...squad]; });

    applyShareToDecks(
      decodeShareCode(encodeShareCode(five, true), allNames), decks, () => true, undefined, 0,
    );

    expect(decks[0]!.squad).toEqual(FIVE_DECKS[0]);
    expect(decks[1]!.squad.every((n) => n === '')).toBe(true);
    expect(decks[3]!.squad[0]).toBe('나가');   // 건드리지 않은 칸
  });

  it("'all'은 예전 그대로 판을 갈아 끼운다", () => {
    const decks = emptyDecks();
    decks[2]!.squad = ['나가', '', '', '', ''];
    applyShareToDecks(
      decodeShareCode(encodeShareCode([deck(1, ['리타', '', '', '', ''])], false), allNames),
      decks, () => true,
    );
    expect(decks[0]!.squad[0]).toBe('리타');
    expect(decks[2]!.squad.every((n) => n === '')).toBe(true);
  });

  it('없는 칸을 겨냥하면 아무 일도 일어나지 않는다', () => {
    const decks = emptyDecks();
    decks[0]!.squad = ['리타', '', '', '', ''];
    const result = applyShareToDecks(
      decodeShareCode(encodeShareCode([deck(1, ['크라운', '', '', '', ''])], false), allNames),
      decks, () => true, undefined, 9,
    );
    expect(result.applied).toBe(0);
    expect(decks[0]!.squad[0]).toBe('리타');
  });
});

describe('유니온 레이드 판 코드 (NK4)', () => {
  // 기본값 전부에서 출발한다. 손으로 몇 개만 채운 객체를 넘기면 나머지가 undefined라
  // «기본값과 다르다»고 판정돼 코드가 실제보다 세 배쯤 길어진다 — 길이를 재는 시험이
  // 무의미해진다.
  const baseBattle = decodeBattleCode('NK3-e30');
  const battle = (duration: number, code: string) =>
    encodeBattleCode({ ...baseBattle, duration, enemyCode: code } as never);

  const sampleShare = () => ({
    bosses: [
      {
        name: '작열 글러트니',
        enabled: true,
        battleCode: battle(150, '작열'),
        deckCodes: [
          encodeShareCode([deck(1, FIVE_DECKS[0]!)], false),
          encodeShareCode([deck(1, FIVE_DECKS[1]!)], false),
          '',
        ],
      },
      {
        name: '수냉 니힐',
        enabled: false,
        battleCode: battle(180, '수냉'),
        deckCodes: [encodeShareCode([deck(1, FIVE_DECKS[2]!)], false)],
      },
    ],
  });

  it('보스 이름·켬끔·조건·덱을 한 코드에 담고 그대로 돌려준다', () => {
    const code = encodeUnionCode(sampleShare());
    expect(code.startsWith('NK4-')).toBe(true);

    const back = decodeUnionCode(code);
    expect(back.bosses).toHaveLength(2);
    expect(back.bosses[0]!.name).toBe('작열 글러트니');
    expect(back.bosses[0]!.enabled).toBe(true);
    expect(back.bosses[1]!.name).toBe('수냉 니힐');
    expect(back.bosses[1]!.enabled).toBe(false);
  });

  it('안에 든 NK3·NK2가 원래 코드 그대로 나온다', () => {
    const share = sampleShare();
    const back = decodeUnionCode(encodeUnionCode(share));

    expect(back.bosses[0]!.battleCode).toBe(share.bosses[0]!.battleCode);
    expect(decodeBattleCode(back.bosses[0]!.battleCode).duration).toBe(150);
    expect(decodeBattleCode(back.bosses[0]!.battleCode).enemyCode).toBe('작열');

    expect(back.bosses[0]!.deckCodes[0]).toBe(share.bosses[0]!.deckCodes[0]);
    expect(decodeShareCode(back.bosses[0]!.deckCodes[1]!, allNames).decks[0]!.squad)
      .toEqual(FIVE_DECKS[1]);
  });

  it('빈 덱 칸은 자리를 지키고 뒤쪽 빈 것만 잘라 낸다', () => {
    const back = decodeUnionCode(encodeUnionCode({
      bosses: [{
        name: '전격 기차',
        enabled: true,
        battleCode: battle(180, '전격'),
        deckCodes: ['', encodeShareCode([deck(1, FIVE_DECKS[0]!)], false), ''],
      }],
    }));
    expect(back.bosses[0]!.deckCodes).toHaveLength(2);   // 뒤쪽 빈 칸은 잘린다
    expect(back.bosses[0]!.deckCodes[0]).toBe('');       // 가운데 빈 칸은 남는다
    expect(back.bosses[0]!.deckCodes[1]!.startsWith('NK2-')).toBe(true);
  });

  it('아무것도 안 채운 판은 보스가 0개인 코드가 된다', () => {
    const empty = { bosses: Array.from({ length: 5 }, () => ({
      name: '', enabled: true, battleCode: '', deckCodes: ['', '', ''],
    })) };
    expect(decodeUnionCode(encodeUnionCode(empty)).bosses).toHaveLength(0);
  });

  it('보스 다섯에 덱 셋을 꽉 채워도 붙여넣을 만한 길이다', () => {
    const full = { bosses: Array.from({ length: 5 }, (_, i) => ({
      name: `${['작열', '수냉', '전격', '풍압', '철갑'][i]} 글러트니`,
      enabled: true,
      battleCode: battle(150 + i, '작열'),
      deckCodes: FIVE_DECKS.slice(0, 3).map((squad) => encodeShareCode([deck(1, squad)], false)),
    })) };
    const code = encodeUnionCode(full);
    expect(decodeUnionCode(code).bosses).toHaveLength(5);
    // 실측 620자 안팎. 조건 5개 + 덱 15개를 손으로 붙여넣으면 스무 번인 것을 한 번으로
    // 줄인 값이라 이 정도는 받아들인다. 더 짧게 주고받고 싶으면 공유 목록을 쓴다.
    expect(code.length).toBeLessThan(700);
  });

  it('다른 종류의 코드는 어느 칸에 넣을지 알려 주며 거절한다', () => {
    expect(() => decodeUnionCode(battle(180, '작열'))).toThrow(/NK4/);
    expect(() => decodeUnionCode('')).toThrow(/입력/);
  });

  it('중간에 잘린 코드는 끊겼다고 알린다', () => {
    const code = encodeUnionCode(sampleShare());
    expect(() => decodeUnionCode(code.slice(0, code.length - 12))).toThrow(/끊겼|해석/);
  });
});
