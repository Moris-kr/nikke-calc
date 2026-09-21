// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  raidBattle, raidCharacters, raidDeckRow, raidProblems, raidRequest, raidTotal, RAID_ALGORITHM_NOTE,
} from './raid';
import type { BattleSettings, CharacterMeta, CharacterOverrides, DeckState, SimulationResult } from './types';

const meta = (name: string, preview = false): CharacterMeta => ({
  name, burstStage: '3', elementCode: '철갑', weaponType: 'AR', className: '화력형',
  manufacturer: '엘리시온', preview, image: '', nameCode: null, resourceId: null, aliases: [],
});
const catalog = new Map(['리타', '크라운', '이브', '토브', '민트'].map((name) => [name, meta(name)]));
catalog.set('임시 니케', meta('임시 니케', true));

const deck = (id: number, squad: string[], characters: DeckState['characters'] = {}): DeckState =>
  ({ id, squad: [...squad, '', '', '', ''].slice(0, 5), characters });

const battle: BattleSettings = {
  duration: 180, synchroLevel: 400, enemyDef: 31784, enemyCode: '', coreEnabled: false, corePx: 52,
  hasParts: false, seed: 42, optimalRangeWeapons: [], immuneWindows: [], elementWindows: [],
  rngMode: 'expected', immuneBlocksBurst: true, normalHitCoeff: {}, burstRegenTime: 2, burstReaction: 0.05,
  console: { common_level: 180, class_level: {}, company_level: {} },
  burstRegenPerDeck: { 1: 3 }, corePerDeck: { 1: true },
} as BattleSettings;

describe('레이드에 세울 수 있나', () => {
  it('계정을 안 이었으면 첫 줄이 그것이다', () => {
    const problems = raidProblems([deck(1, ['리타'])], catalog, false);
    expect(problems[0]).toContain('블라블라링크');
  });

  it('임시 니케와 두 덱에 선 니케를 짚는다', () => {
    const problems = raidProblems([deck(1, ['리타', '임시 니케']), deck(2, ['리타', '크라운'])], catalog, true);
    expect(problems.some((line) => line.includes('임시 니케'))).toBe(true);
    expect(problems.some((line) => line.includes('리타') && line.includes('덱 1') && line.includes('덱 2'))).toBe(true);
  });

  it('덱이 전부 비면 막는다 · 괜찮으면 아무 말도 없다', () => {
    expect(raidProblems([deck(1, [])], catalog, true)[0]).toContain('편성된 덱이 없습니다');
    expect(raidProblems([deck(1, ['리타', '크라운']), deck(2, ['이브'])], catalog, true)).toEqual([]);
  });

  it('로스터를 주면 안 가진 니케를 막는다 — 기본 스펙으로 세우면 내 계정이 아니다', () => {
    const roster = { 리타: { growthStage: 3 } };
    const problems = raidProblems([deck(1, ['리타', '크라운'])], catalog, true, roster);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('크라운');
    expect(problems[0]).toContain('로스터에 없습니다');
    // 안 이었으면 로스터 검사는 뜻이 없다 — 첫 줄(계정을 이어 달라)만 나온다.
    expect(raidProblems([deck(1, ['크라운'])], catalog, false, roster).some((line) => line.includes('로스터'))).toBe(false);
  });
});

describe('레이드용 설정', () => {
  const roster: Record<string, CharacterOverrides> = {
    리타: { growthStage: 7, overload: { atk_pct: 20 }, cube: { name: '재장', level: 15 },
      control: { reloadCancel: true } as CharacterOverrides['control'], burst: { mode: 'skip' } },
  };

  it('로스터를 밑에 깔고 큐브만 덱 것으로 갈아 끼운다 — 컨트롤·버스트 운용은 지운다', () => {
    const out = raidCharacters({
      id: 1, squad: ['리타', '크라운', ''], cubes: { 리타: { name: '탄충', level: 15 } }, burstSequence: undefined,
    }, roster);
    expect(out.리타).toEqual({ growthStage: 7, overload: { atk_pct: 20 }, cube: { name: '탄충', level: 15 } });
    // 안 키운 니케는 기본 스펙이다 — 그것도 내 계정의 상태다.
    expect(out.크라운).toBeUndefined();
  });

  it('덱에서 손으로 만진 수치는 안 본다 — 큐브만 본다', () => {
    const request = raidRequest({
      id: 1, squad: ['리타', '', '', '', ''], cubes: { 리타: { name: '체력', level: 10 } }, burstSequence: undefined,
    }, roster, battle);
    expect(request.characters?.리타?.overload).toEqual({ atk_pct: 20 });
    expect(request.characters?.리타?.cube).toEqual({ name: '체력', level: 10 });
    expect(request.characters?.리타?.control).toBeUndefined();
  });

  it('버스트 순서는 요청에 실린다', () => {
    const request = raidRequest({
      id: 1, squad: ['리타', '크라운', '', '', ''], cubes: {},
      burstSequence: [{ 1: ['리타'], 2: ['크라운'], 3: [] }],
    }, roster, battle);
    expect(request.burstSequence).toEqual([{ 1: ['리타'], 2: ['크라운'], 3: [] }]);
  });
});

describe('레이드 전투 조건', () => {
  it('어드민 코드가 조건을 정하고, 싱크로는 400으로 못 박고, 콘솔은 내 계정 값이며, 덱마다 다른 값은 지운다', () => {
    const share = { ...battle, duration: 60, enemyCode: '전격' as const, corePx: 60, coreEnabled: true };
    delete (share as { console?: unknown }).console;
    delete (share as { synchroLevel?: unknown }).synchroLevel;
    // 화면에 내 싱크로가 잡혀 있어도 새지 않는다.
    const screen = { ...battle, synchroLevel: 821, console: { common_level: 200, class_level: { 화력형: 30 }, company_level: {} } };
    const mine = { common_level: 460, class_level: { 화력형: 249 }, company_level: { 엘리시온: 460 } };
    const out = raidBattle(share, screen, mine);
    expect(out.duration).toBe(60);
    expect(out.enemyCode).toBe('전격');
    expect(out.synchroLevel).toBe(400);
    expect(out.console).toEqual(mine);
    expect(out.burstRegenPerDeck).toBeUndefined();
    expect(out.corePerDeck).toBeUndefined();
  });

  it('받아 둔 콘솔이 없으면 화면 값으로 물러난다', () => {
    const share = { ...battle };
    delete (share as { console?: unknown }).console;
    delete (share as { synchroLevel?: unknown }).synchroLevel;
    expect(raidBattle(share, battle, null).console?.common_level).toBe(180);
  });
});

describe('기록 모양', () => {
  const result: SimulationResult = { squadTotal: 123_456_789.6, duration: 180, hitCount: 1, charTotals: {}, previewNote: '', deviations: '' };

  it('덱 한 칸 — 이름·조합 코드·버스트 순서 한 줄·딜', () => {
    const row = raidDeckRow({
      id: 2, squad: ['리타', '크라운', '', '', ''], cubes: {},
      burstSequence: [{ 1: ['리타'], 2: ['크라운'], 3: [] }],
    }, result);
    expect(row.names).toEqual(['리타', '크라운']);
    expect(row.code.startsWith('NK2-')).toBe(true);
    expect(row.order).toBe('1버 리타 → 2버 크라운');
    expect(row.dmg).toBe(123_456_790);
  });

  it('실제로 계산에 들어간 큐브를 니케별로 싣는다 — 없으면 칸 자체를 안 만든다', () => {
    const row = raidDeckRow({ id: 1, squad: ['리타', '크라운', '', '', ''], cubes: {}, burstSequence: undefined }, result,
      { 리타: { name: '렐릭 베어 큐브', level: 15 }, 크라운: undefined });
    expect(row.cubes).toEqual({ 리타: { name: '렐릭 베어 큐브', level: 15 } });
    const bare = raidDeckRow({ id: 1, squad: ['리타', '', '', '', ''], cubes: {}, burstSequence: undefined }, result);
    expect(bare.cubes).toBeUndefined();
  });

  it('합산은 덱 딜의 합이다', () => {
    expect(raidTotal([{ names: [], code: '', order: '', dmg: 3 }, { names: [], code: '', order: '', dmg: 4 }])).toBe(7);
  });

  it('알고리즘 안내는 사용자가 정한 문장 그대로다', () => {
    expect(RAID_ALGORITHM_NOTE).toContain('새 시즌으로 다시 엽니다');
    expect(RAID_ALGORITHM_NOTE).toContain('상승되는 경우에는 그대로 진행합니다');
  });
});
