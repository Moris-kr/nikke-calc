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

const battle: BattleSettings = {
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
    });
  });

  it('creates a stable cache key from normalized input', () => {
    const raw = { ...valid, squad: [' 리타 '], duration: 180.9 };
    expect(cacheKey(raw, 'v1')).toBe(cacheKey(normalizeRequest(raw), 'v1'));
    expect(cacheKey(raw, 'v1')).not.toBe(cacheKey(raw, 'v2'));
  });

  it('includes overload, cube, and manual character settings in the cache key', () => {
    const base = {
      ...valid,
      characters: {
        리타: {
          overload: { atk_pct: 22.22 },
          cube: { name: '재장' as const, level: 15 },
          manualStats: { split_dmg_pct: 20 },
        },
      },
    };

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

  it('resets enemy values without changing battle duration or seed', () => {
    expect(resetEnemy({
      ...battle,
      duration: 60,
      seed: 99,
      enemyDef: 1,
      enemyCode: '작열',
      coreEnabled: true,
      corePx: 77,
      hasParts: true,
    })).toEqual({
      ...battle,
      duration: 60,
      seed: 99,
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
});
