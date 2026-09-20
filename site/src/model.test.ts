import { describe, expect, it } from 'vitest';

import {
  aggregateDeckResults,
  cacheKey,
  formatDamage,
  normalizeRequest,
  requestForDeck,
  resetEnemy,
  validateDecks,
  validateRequest,
} from './model';
import type { BattleSettings, DeckState, SimulationRequest, SimulationResult } from './types';

const valid: SimulationRequest = {
  squad: ['리타'],
  duration: 180,
  enemyDef: 31_784,
  enemyCode: '',
  corePx: 0,
  hasParts: false,
  seed: 42,
};

it('validates and separates first burst times in calculation caches', () => {
  expect(normalizeRequest(valid).firstBurstTime).toBe(0);
  expect(cacheKey({ ...valid, firstBurstTime: 0 }, 'v')).not.toBe(cacheKey({ ...valid, firstBurstTime: 5 }, 'v'));
  expect(validateRequest({ ...valid, firstBurstTime: -1 })).toContain('첫 버스트 시간은 0~3600초여야 합니다.');
  expect(requestForDeck({ id: 3, squad: ['리타'], characters: {} }, { ...battle, firstBurstTime: 1, firstBurstPerDeck: { 3: 5 } }).firstBurstTime).toBe(5);
});

const battle: BattleSettings = {
  synchroLevel: 400,
  burstRegenTime: 2,
  burstReaction: 0.05,
  optimalRangeWeapons: [],
  immuneWindows: [],
  elementWindows: [],
  rngMode: 'expected',
  immuneBlocksBurst: true,
  normalHitCoeff: {},
  console: { common_level: 180, class_level: { 화력형: 100, 방어형: 100, 지원형: 100 }, company_level: { 엘리시온: 100, 미실리스: 100, 테트라: 100, 필그림: 100, 어브노말: 100 } },
  duration: 180,
  enemyDef: 31_784,
  enemyCode: '',
  coreEnabled: false,
  corePx: 52,
  hasParts: false,
  seed: 42,
};

const deck = (id: number, squad: string[]): DeckState => ({
  id,
  squad,
  characters: {},
});

describe('validateRequest', () => {
  it.each([
    [[], '스쿼드에 캐릭터를 1명 이상 편성해 주세요.'],
    [['1', '2', '3', '4', '5', '6'], '스쿼드는 최대 5명까지 편성할 수 있습니다.'],
  ])('enforces the one-to-five member boundary', (squad, message) => {
    expect(validateRequest({ ...valid, squad })).toContain(message);
  });

  it('rejects duplicate squad members', () => {
    const errors = validateRequest({ ...valid, squad: ['리타', '리타'] });
    expect(errors).toContain('같은 캐릭터를 두 번 편성할 수 없습니다.');
  });

  it.each([
    ['전투 시간', { duration: 181 }, '전투 시간은 10~180초여야 합니다.'],
    ['적 방어력', { enemyDef: -1 }, '적 방어력은 0~999999여야 합니다.'],
    ['코어 직경', { corePx: 1001 }, '코어 직경은 0~1000px여야 합니다.'],
    ['난수 시드', { seed: -1 }, '시드는 0~2147483647 사이의 정수여야 합니다.'],
  ] as const)('%s 범위를 검증한다', (_label, over, message) => {
    expect(validateRequest({ ...valid, ...over })).toContain(message);
  });

  it('accepts a valid one-character request', () => {
    expect(validateRequest(valid)).toEqual([]);
  });
});

describe('request normalization', () => {
  it('trims names and integer-valued inputs', () => {
    expect(normalizeRequest({
      ...valid,
      squad: [' 리타 '],
      duration: 10.9,
      enemyDef: 31_784.9,
      corePx: 4.8,
      seed: 42.7,
    })).toEqual({
      ...valid,
      squad: ['리타'],
      duration: 10,
      enemyDef: 31_784,
      corePx: 4,
      seed: 42,
      // 난수 모드는 기본값이어도 언제나 실린다 — 브리지와 기본값이 어긋나지 않게.
      rngMode: 'expected',
      firstBurstTime: 0,
    });
  });

  it('creates a stable cache key from normalized input', () => {
    const raw = { ...valid, squad: [' 리타 '], duration: 180.9 };
    expect(cacheKey(raw, 'v1')).toBe(cacheKey(normalizeRequest(raw), 'v1'));
    expect(cacheKey(raw, 'v1')).not.toBe(cacheKey(raw, 'v2'));
  });

  it('includes growth, skill, overload, cube, and manual character settings in the cache key', () => {
    const base = {
      ...valid,
      characters: {
        리타: {
          growthStage: 3,
          skillLevels: { '1': 10, '2': 10, '3': 10 },
          overload: { atk_pct: 22.22 },
          cube: { name: '재장' as const, level: 15 },
          manualStats: { split_dmg_pct: 20 },
        },
      },
    };

    const growthChanged = {
      ...base,
      characters: {
        리타: { ...base.characters.리타, growthStage: 10 },
      },
    };
    expect(normalizeRequest(growthChanged).characters?.리타?.growthStage).toBe(10);
    expect(cacheKey(base, 'v1')).not.toBe(cacheKey(growthChanged, 'v1'));

    expect(cacheKey(base, 'v1')).not.toBe(cacheKey({
      ...base,
      characters: {
        리타: {
          ...base.characters.리타,
          skillLevels: { '1': 9, '2': 10, '3': 10 },
        },
      },
    }, 'v1'));
    expect(cacheKey(base, 'v1')).not.toBe(cacheKey({
      ...base,
      characters: {
        리타: {
          ...base.characters.리타,
          cube: { name: '탄충', level: 15 },
        },
      },
    }, 'v1'));
    expect(cacheKey(base, 'v1')).not.toBe(cacheKey({
      ...base,
      characters: {
        리타: {
          ...base.characters.리타,
          manualStats: { split_dmg_pct: 21 },
        },
      },
    }, 'v1'));
  });

  it('includes control, burst, and equip-level settings in the cache key', () => {
    const base = { ...valid, characters: { 리타: { growthStage: 3 } } };
    // 컨트롤을 바꾸면 캐시 키가 달라져야 한다 (전에는 누락돼 stale 결과를 불러왔다)
    const withControl = {
      ...base,
      characters: { 리타: { growthStage: 3, control: { tap_fire: { rate: 3.6 } } } },
    };
    expect(cacheKey(base, 'v1')).not.toBe(cacheKey(withControl, 'v1'));
    expect(normalizeRequest(withControl).characters?.리타?.control).toBeDefined();

    const burstChanged = {
      ...base,
      characters: { 리타: { growthStage: 3, burst: { mode: 'priority' as const, every: 2 } } },
    };
    expect(cacheKey(base, 'v1')).not.toBe(cacheKey(burstChanged, 'v1'));

    const equipChanged = {
      ...base,
      characters: { 리타: { growthStage: 3, equipLevels: { 머리: 3 } } },
    };
    expect(cacheKey(base, 'v1')).not.toBe(cacheKey(equipChanged, 'v1'));

    const modeSwapBase = { ...valid, squad: ['신데렐라 : 크리스탈 웨이브'] };
    const modeSwapChanged = {
      ...modeSwapBase,
      characters: { '신데렐라 : 크리스탈 웨이브': { growthStage: 3, weaponModeSwapAt: 6 } },
    };
    expect(normalizeRequest(modeSwapChanged).characters?.['신데렐라 : 크리스탈 웨이브']
      ?.weaponModeSwapAt).toBe(6);
    expect(cacheKey(modeSwapBase, 'v1')).not.toBe(cacheKey(modeSwapChanged, 'v1'));
  });
});

describe('난수 모드는 언제나 실린다', () => {
  // 「기본값이니 빼도 된다」고 뺐다가, 빠지면 난수로 읽는 브리지와 기본값이 어긋나
  // 기대값으로 둔 사람들이 내내 난수 모드로 계산하고 있었다. 경계를 넘는 값은
  // 양쪽이 같은 기본값을 안다고 믿지 않는다.
  it('기대값도 요청에 적어 보낸다', () => {
    const request = requestForDeck(deck(1, ['리타']), { ...battle, rngMode: 'expected' }, {});
    expect(normalizeRequest(request).rngMode).toBe('expected');
  });

  it('난수도 그대로 실린다', () => {
    const request = requestForDeck(deck(1, ['리타']), { ...battle, rngMode: 'random' }, {});
    expect(normalizeRequest(request).rngMode).toBe('random');
  });

  it('없으면 화면 기본값(기대값)으로 채운다 — 브리지와 같은 값이다', () => {
    const request = requestForDeck(deck(1, ['리타']), { ...battle }, {});
    delete (request as { rngMode?: string }).rngMode;
    expect(normalizeRequest(request).rngMode).toBe('expected');
  });

  it('기대값과 난수는 캐시 키가 갈린다 — 서로의 결과를 물려받으면 안 된다', () => {
    const expectedKey = cacheKey(
      requestForDeck(deck(1, ['리타']), { ...battle, rngMode: 'expected' }, {}), 'v1');
    const randomKey = cacheKey(
      requestForDeck(deck(1, ['리타']), { ...battle, rngMode: 'random' }, {}), 'v1');
    expect(expectedKey).not.toBe(randomKey);
  });
});

describe('multi-deck model', () => {
  it('allows the same character in separate decks', () => {
    expect(validateDecks([deck(1, ['리타']), deck(2, ['리타'])])).toEqual([]);
  });

  it('rejects a duplicate only within its own deck', () => {
    expect(validateDecks([deck(1, ['리타', '리타']), deck(2, ['리타'])]))
      .toContain('덱 1: 같은 캐릭터를 두 번 편성할 수 없습니다.');
  });

  it('skips empty decks but rejects an all-empty batch', () => {
    expect(validateDecks([deck(1, []), deck(2, ['리타'])])).toEqual([]);
    expect(validateDecks([deck(1, []), deck(2, [])]))
      .toContain('캐릭터가 편성된 덱이 하나 이상 필요합니다.');
  });

  it('keeps a 52px core reference while sending zero when core is disabled', () => {
    expect(requestForDeck(deck(1, ['리타']), battle)).toMatchObject({
      squad: ['리타'],
      corePx: 0,
    });
    expect(requestForDeck(deck(1, ['리타']), { ...battle, coreEnabled: true })).toMatchObject({
      corePx: 52,
    });
  });

  it('sends the synchro level only when it differs from the engine default', () => {
    // 기본값(400)은 싣지 않는다 — 엔진이 같은 값을 쓰므로 옛 캐시 키와 갈리면 손해다.
    expect(requestForDeck(deck(1, ['리타']), battle)).not.toHaveProperty('synchroLevel');
    expect(requestForDeck(deck(1, ['리타']), { ...battle, synchroLevel: 250 }))
      .toMatchObject({ synchroLevel: 250 });
    // 값이 다르면 캐시 키도 갈려야 한다 — 레벨이 다른 결과가 섞이면 안 된다.
    expect(cacheKey(requestForDeck(deck(1, ['리타']), { ...battle, synchroLevel: 250 }), 'v1'))
      .not.toBe(cacheKey(requestForDeck(deck(1, ['리타']), battle), 'v1'));
  });

  it('keeps an overload-0 equipment level in the request', () => {
    // 0은 흔히 falsy로 걸러진다 — 요청까지 살아 오는지 못 박는다.
    const withZero = deck(1, ['리타']);
    withZero.characters.리타 = { equipLevels: { 머리: 0, 몸통: 0, 팔: 0, 다리: 0 } };
    expect(requestForDeck(withZero, battle).characters?.리타?.equipLevels)
      .toEqual({ 머리: 0, 몸통: 0, 팔: 0, 다리: 0 });
  });

  it('rejects a synchro level outside the in-game cap', () => {
    // 상한은 표가 아니라 **인게임 레벨 상한**(1400)이다. 표는 1000까지지만 그 위는
    // 엔진이 이어 붙인다 — 유니온에는 싱크로 1131이 실제로 있고, 1000으로 눌러 버리면
    // 그 사람 공격력이 15% 넘게 깎인다.
    expect(validateRequest({ ...valid, synchroLevel: 0 }))
      .toContain('싱크로 레벨은 1~1400이어야 합니다.');
    expect(validateRequest({ ...valid, synchroLevel: 1_401 }))
      .toContain('싱크로 레벨은 1~1400이어야 합니다.');
    expect(validateRequest({ ...valid, synchroLevel: 1_131 })).toEqual([]);
    expect(validateRequest({ ...valid, synchroLevel: 400 })).toEqual([]);
  });

  it('preserves independent character skill levels in each deck request', () => {
    const first = deck(1, ['리타']);
    first.characters.리타 = { skillLevels: { '1': 4, '2': 6, '3': 8 } };
    const second = deck(2, ['리타']);
    second.characters.리타 = { skillLevels: { '1': 7, '2': 9, '3': 10 } };

    expect(requestForDeck(first, battle).characters?.리타?.skillLevels)
      .toEqual({ '1': 4, '2': 6, '3': 8 });
    expect(requestForDeck(second, battle).characters?.리타?.skillLevels)
      .toEqual({ '1': 7, '2': 9, '3': 10 });
  });

  it('resets enemy values and phases without changing battle duration or seed', () => {
    expect(resetEnemy({
      ...battle,
      duration: 60,
      seed: 99,
      enemyDef: 1,
      enemyCode: '작열',
      coreEnabled: true,
      corePx: 77,
      hasParts: true,
      corePerDeck: { 1: true },
      coreWindows: [{ from: 10, to: 20 }],
      defenseRateWindows: [{ from: 0, to: 20, rate: 60 }],
      immuneWindows: [{ from: 20, to: 30 }],
      elementWindows: [{ from: 30, to: 40, code: '작열' }],
      optimalRangeWeapons: ['AR'],
      optimalRangeWindows: [{ from: 0, to: 40, weapons: ['SR'] }],
    })).toEqual({
      ...battle,
      duration: 60,
      seed: 99,
      bossSize: 'large', shotgunHitRate: 1,
      corePerDeck: {}, optimalRangeWeapons: [], optimalRangeWindows: [], shotgunSizeWindows: [], coreWindows: [], defenseRateWindows: [], immuneWindows: [], elementWindows: [],
    });
  });

  it('aggregates deck totals without merging duplicate character names', () => {
    const result = (value: number): SimulationResult => ({
      squadTotal: value,
      duration: 10,
      hitCount: 1,
      charTotals: { 리타: value },
      previewNote: '',
      deviations: '',
    });
    const entries = [
      { deckId: 1, request: { ...valid, squad: ['리타'] }, result: result(10) },
      { deckId: 2, request: { ...valid, squad: ['리타'] }, result: result(20) },
    ];

    expect(aggregateDeckResults(entries)).toEqual({ total: 30, decks: entries });
  });
});

describe('formatDamage', () => {
  it('formats hundred-millions with two decimal places', () => {
    expect(formatDamage(3_207_003_887)).toBe('32.07억');
  });

  it('keeps smaller numbers readable', () => {
    expect(formatDamage(999_999)).toBe('999,999');
  });

  it('carries the collection choice into the request and the cache key', () => {
    // normalizeCharacters는 필드를 하나씩 옮겨 담는 화이트리스트다. 빠뜨리면 설정이
    // 요청 직전에 조용히 사라지고 결과가 기본값으로 나온다 — 실제로 그랬다.
    const base = {
      ...valid,
      characters: {
        리타: { collection: { stage: 'SR15', favorite: 0 } },
      },
    };
    expect(normalizeRequest(base).characters?.리타?.collection)
      .toEqual({ stage: 'SR15', favorite: 0 });

    const owned = {
      ...valid,
      characters: {
        리타: { collection: { stage: 'SR0', favorite: 0 } },
      },
    };
    expect(normalizeRequest(owned).characters?.리타?.collection)
      .toEqual({ stage: 'SR0', favorite: 0 });
    // 소장품이 다르면 결과도 달라지므로 캐시가 섞이면 안 된다.
    expect(cacheKey(base, 'v1')).not.toBe(cacheKey(owned, 'v1'));
  });

  it('carries the account console into the request and the cache key', () => {
    // 콘솔은 계정 속성이라 캐릭터가 아니라 요청 최상위에 실린다.
    const base = { ...valid, console: { common_level: 180, class_level: { 화력형: 100, 방어형: 100, 지원형: 100 }, company_level: { 엘리시온: 100, 미실리스: 100, 테트라: 100, 필그림: 100, 어브노말: 100 } } };
    const grown = { ...valid, console: { common_level: 360, class_level: { 화력형: 200, 방어형: 200, 지원형: 200 }, company_level: { 엘리시온: 200, 미실리스: 200, 테트라: 200, 필그림: 200, 어브노말: 200 } } };

    expect(normalizeRequest(base).console).toEqual({
      common_level: 180, class_level: { 화력형: 100, 방어형: 100, 지원형: 100 }, company_level: { 엘리시온: 100, 미실리스: 100, 테트라: 100, 필그림: 100, 어브노말: 100 },
    });
    // 콘솔이 다르면 결과도 다르므로 캐시가 섞이면 안 된다.
    expect(cacheKey(base, 'v1')).not.toBe(cacheKey(grown, 'v1'));
  });

  it('rejects console levels outside the allowed range', () => {
    // 기업만 딜에 직결되지만 공통·클래스도 체력 계수 캐릭터(신데렐라 등)를 통해
    // 딜에 들어오므로 셋 다 검사한다.
    expect(validateRequest({ ...valid, console: { common_level: -1, class_level: { 화력형: 100, 방어형: 100, 지원형: 100 }, company_level: { 엘리시온: 100, 미실리스: 100, 테트라: 100, 필그림: 100, 어브노말: 100 } } }))
      .toContain('공통 콘솔 레벨은 0~1000 사이의 정수여야 합니다.');
    expect(validateRequest({ ...valid, console: { common_level: 180, class_level: { ...{ 화력형: 100, 방어형: 100, 지원형: 100 }, 화력형: 1001 }, company_level: { 엘리시온: 100, 미실리스: 100, 테트라: 100, 필그림: 100, 어브노말: 100 } } }))
      .toContain('클래스(화력형) 콘솔 레벨은 0~1000 사이의 정수여야 합니다.');
    expect(validateRequest({ ...valid, console: { common_level: 180, class_level: { 화력형: 100, 방어형: 100, 지원형: 100 }, company_level: { ...{ 엘리시온: 100, 미실리스: 100, 테트라: 100, 필그림: 100, 어브노말: 100 }, 테트라: 1.5 } } }))
      .toContain('기업(테트라) 콘솔 레벨은 0~1000 사이의 정수여야 합니다.');
    expect(validateRequest({ ...valid, console: { common_level: 0, class_level: { 화력형: 0, 방어형: 0, 지원형: 0 }, company_level: { 엘리시온: 0, 미실리스: 0, 테트라: 0, 필그림: 0, 어브노말: 0 } } }))
      .toEqual([]);
  });

  it('carries the burst gauge charge time and keeps caches apart', () => {
    const fast = { ...valid, burstRegenTime: 2 };
    const slow = { ...valid, burstRegenTime: 2.8 };
    expect(normalizeRequest(slow).burstRegenTime).toBe(2.8);
    // 충전 시간이 다르면 사이클이 달라져 결과도 달라진다.
    expect(cacheKey(fast, 'v1')).not.toBe(cacheKey(slow, 'v1'));

    expect(validateRequest({ ...valid, burstRegenTime: -1 }))
      .toContain('버스트 게이지 충전 시간은 0~20초여야 합니다.');
    expect(validateRequest({ ...valid, burstRegenTime: 21 }))
      .toContain('버스트 게이지 충전 시간은 0~20초여야 합니다.');
    expect(validateRequest({ ...valid, burstRegenTime: 2.8 })).toEqual([]);
  });
});

describe('핵', () => {
  const deck: DeckState = { id: 1, squad: ['리타'], characters: {} };

  it('안 켰으면 요청에 아예 없다', () => {
    // 켠 적 없는 사람의 캐시 키가 갈리면 예전 결과가 통째로 버려진다.
    expect(requestForDeck(deck, battle)).not.toHaveProperty('hacks');
    expect(requestForDeck(deck, {
      ...battle,
      hacks: { burstCharge: false, infiniteAmmo: false, alwaysCrit: false, damageMult: 1 },
    })).not.toHaveProperty('hacks');
  });

  it('켠 것이 있으면 정규화해 싣는다', () => {
    const request = requestForDeck(deck, {
      ...battle,
      hacks: { burstCharge: true, infiniteAmmo: false, alwaysCrit: false, damageMult: 0 },
    });
    // 말이 안 되는 배수(0)는 1로 돌아가고, 켠 스위치는 그대로 실린다.
    expect(request.hacks)
      .toEqual({ burstCharge: true, infiniteAmmo: false, alwaysCrit: false, damageMult: 1 });
  });

  it('핵이 다르면 캐시 키도 다르다', () => {
    const plain = requestForDeck(deck, battle);
    const hacked = requestForDeck(deck, {
      ...battle,
      hacks: { burstCharge: false, infiniteAmmo: false, alwaysCrit: true, damageMult: 1 },
    });
    expect(cacheKey(hacked, 'v1')).not.toBe(cacheKey(plain, 'v1'));
  });
});


describe('core exposure windows', () => {
  const coreWindows = [{ from: 30, to: 60 }, { from: 90, to: 120 }];
  it('validates windows and makes their order irrelevant to cache identity', () => {
    expect(validateRequest({ ...valid, coreWindows })).toEqual([]);
    expect(validateRequest({ ...valid, coreWindows: [{ from: 60, to: 30 }] })).toContain(
      '코어 노출 구간은 시작이 끝보다 앞서야 합니다 (60~30).');
    expect(validateRequest({ ...valid, coreWindows: [{ from: 0, to: Infinity }] })).toContain(
      '코어 노출 구간은 0~180초여야 합니다.');
    expect(cacheKey({ ...valid, coreWindows }, 'v1')).toBe(cacheKey({ ...valid, coreWindows: [...coreWindows].reverse() }, 'v1'));
    expect(cacheKey({ ...valid, coreWindows }, 'v1')).not.toBe(cacheKey(valid, 'v1'));
    expect(cacheKey({ ...valid, coreWindows: [] }, 'v1')).toBe(cacheKey(valid, 'v1'));
  });
  it('carries intervals while preserving disabled core and per-deck overrides', () => {
    const settings = { ...battle, coreWindows, coreEnabled: true };
    expect(requestForDeck(deck(1, ['리타']), settings)).toMatchObject({ coreWindows, corePx: 52 });
    expect(requestForDeck(deck(1, ['리타']), { ...settings, coreEnabled: false }).corePx).toBe(0);
    expect(requestForDeck(deck(1, ['리타']), { ...settings, corePerDeck: { 1: false } }).corePx).toBe(0);
  });
});


describe('body defense rate windows', () => {
  const defenseRateWindows = [{ from: 30, to: 60, rate: 60 }, { from: 40, to: 70, rate: 75 }];
  it('validates times and finite percentages, preserving overlapping windows', () => {
    expect(validateRequest({ ...valid, defenseRateWindows })).toEqual([]);
    for (const rate of [-1, 101, Infinity, NaN]) {
      expect(validateRequest({ ...valid, defenseRateWindows: [{ from: 0, to: 30, rate }] }))
        .toContain('바디 방어율은 0~100%여야 합니다.');
    }
    expect(validateRequest({ ...valid, defenseRateWindows: [{ from: 60, to: 30, rate: 60 }] }))
      .toContain('바디 방어율 구간은 시작이 끝보다 앞서야 합니다 (60~30).');
    expect(validateRequest({ ...valid, defenseRateWindows: [{ from: 0, to: Infinity, rate: 60 }] }))
      .toContain('바디 방어율 구간은 0~180초여야 합니다.');
  });
  it('includes rates in cache identity, ignoring order and empty windows', () => {
    const key = cacheKey({ ...valid, defenseRateWindows }, 'v1');
    expect(key).toBe(cacheKey({ ...valid, defenseRateWindows: [...defenseRateWindows].reverse() }, 'v1'));
    expect(key).not.toBe(cacheKey(valid, 'v1'));
    expect(key).not.toBe(cacheKey({ ...valid, defenseRateWindows: [{ ...defenseRateWindows[0]!, rate: 50 }, defenseRateWindows[1]!] }, 'v1'));
    expect(cacheKey({ ...valid, defenseRateWindows: [] }, 'v1')).toBe(cacheKey(valid, 'v1'));
    expect(requestForDeck(deck(1, ['리타']), { ...battle, defenseRateWindows })).toMatchObject({ defenseRateWindows });
  });
});


describe('optimal range windows', () => {
  const optimalRangeWindows = [{ from: 30, to: 60, weapons: ['AR', 'SR'] }, { from: 90, to: 100, weapons: [] }];
  it('validates and forwards time-based range overrides including no bonus windows', () => {
    expect(validateRequest({ ...valid, optimalRangeWindows })).toEqual([]);
    expect(validateRequest({ ...valid, optimalRangeWindows: [{ from: 30, to: 10, weapons: [] }] })).toContain('유효 사거리 구간은 시작이 끝보다 앞서야 합니다 (30~10).');
    expect(validateRequest({ ...valid, optimalRangeWindows: [{ from: 0, to: 10, weapons: ['BAD'] }] })).toContain('유효 사거리 구간의 무기군을 확인해 주세요.');
    expect(requestForDeck(deck(1, ['리타']), { ...battle, optimalRangeWindows }).optimalRangeWindows).toEqual(optimalRangeWindows);
    expect(cacheKey({ ...valid, optimalRangeWindows }, 'v1')).not.toBe(cacheKey(valid, 'v1'));
    expect(cacheKey({ ...valid, optimalRangeWindows }, 'v1')).toBe(cacheKey({ ...valid, optimalRangeWindows: [...optimalRangeWindows].reverse() }, 'v1'));
  });
});

it('passes shotgun probability through cache and deck requests', () => {
  expect(normalizeRequest({ ...valid, shotgunHitRate: .8 }).shotgunHitRate).toBe(.8);
  expect(cacheKey({ ...valid, shotgunHitRate: .8 }, 'v')).not.toBe(cacheKey(valid, 'v'));
  expect(requestForDeck({ id: 1, squad: ['리타'], characters: {} }, { ...battle, shotgunHitRate: .9 }).shotgunHitRate).toBe(.9);
  expect(validateRequest({ ...valid, shotgunHitRate: 1.1 }).length).toBeGreaterThan(0);
  expect(resetEnemy({ ...battle, shotgunHitRate: .8 }).shotgunHitRate).toBe(1);
});

it('preserves spatial shotgun settings and separates cached models', () => {
  const changed = { ...valid, shotgunModel: 'spatial-v1' as const, shotgunTargetDiameter: 120 };
  expect(normalizeRequest(changed)).toMatchObject({ shotgunModel: 'spatial-v1', shotgunTargetDiameter: 120 });
  expect(cacheKey(changed, 'v')).not.toBe(cacheKey(valid, 'v'));
  expect(requestForDeck({ id: 1, squad: ['리타'], characters: {} }, { ...battle, shotgunModel: 'spatial-v1', shotgunTargetDiameter: 120 })).toMatchObject({ shotgunModel: 'spatial-v1', shotgunTargetDiameter: 120 });
  expect(validateRequest({ ...changed, shotgunTargetDiameter: -1 }).length).toBeGreaterThan(0);
});

it('passes and validates size intervals without altering old defaults', () => {
  const shotgunSizeWindows = [{ from: 3, to: 6, diameter: 120 }];
  const request = { ...valid, shotgunSizeWindows };
  expect(normalizeRequest(request).shotgunSizeWindows).toEqual(shotgunSizeWindows);
  expect(requestForDeck({ id: 1, squad: ['리타'], characters: {} }, { ...battle, shotgunSizeWindows }).shotgunSizeWindows).toEqual(shotgunSizeWindows);
  expect(resetEnemy({ ...battle, shotgunSizeWindows }).shotgunSizeWindows).toEqual([]);
  expect(validateRequest({ ...request, shotgunSizeWindows: [...shotgunSizeWindows, ...shotgunSizeWindows] })).toContain('보스 크기 구간은 서로 겹칠 수 없습니다.');
  expect(cacheKey(request, 'v')).not.toBe(cacheKey(valid, 'v'));
});
