import { describe, expect, it } from 'vitest';

import { ShareServer, summarizeBattle, summarizeSquad } from './share-server';
import type { BattleShare } from './share-code';

const battle: BattleShare = {
  duration: 180,
  enemyDef: 0,
  enemyCode: '',
  coreEnabled: false,
  corePx: 52,
  hasParts: false,
  seed: 1,
  optimalRangeWeapons: [],
  normalHitCoeff: {},
  immuneWindows: [],
  elementWindows: [],
  rngMode: 'random',
  immuneBlocksBurst: false,
  burstRegenTime: 0,
  burstReaction: 0.05,
};

/** 응답 하나짜리 가짜 fetch. 무엇을 보냈는지도 함께 들여다본다. */
function fakeFetch(reply: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe('share server client', () => {
  it('asks for one kind and fills in what the server left out', async () => {
    const { fetcher, calls } = fakeFetch({ items: [{ id: 'a1' }] });
    const result = await new ShareServer('https://share.example.com/', fetcher).list('boss');

    expect(calls[0]!.url).toBe('https://share.example.com/list?kind=boss');
    expect(result.items).toHaveLength(1);
    // 서버가 mine을 빠뜨려도 목록은 그려져야 한다.
    expect(result.mine).toEqual({});
  });

  it('sends the vote as JSON and returns the new counts', async () => {
    const { fetcher, calls } = fakeFetch({ id: 'a1', up: 3, down: 0, mine: 1 });
    const result = await new ShareServer('https://share.example.com', fetcher).vote('squad', 'a1', 1);

    expect(calls[0]!.url).toBe('https://share.example.com/vote');
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ kind: 'squad', id: 'a1', value: 1 });
    expect(result).toEqual({ id: 'a1', up: 3, down: 0, mine: 1 });
  });

  it('surfaces the server message instead of a bare status', async () => {
    const { fetcher } = fakeFetch({ error: '오늘 올릴 수 있는 개수를 넘었습니다.' }, 429);
    await expect(new ShareServer('https://share.example.com', fetcher)
      .upload({ kind: 'boss', name: 'x', by: '', auto: '', code: 'NK3-aa' }))
      .rejects.toThrow('오늘 올릴 수 있는 개수를 넘었습니다.');
  });

  it('falls back to a readable message when the body is not JSON', async () => {
    const fetcher = (async () => new Response('nope', { status: 502 })) as unknown as typeof fetch;
    await expect(new ShareServer('https://share.example.com', fetcher).list('boss'))
      .rejects.toThrow('서버가 응답하지 않았습니다 (502).');
  });
});

describe('auto summaries', () => {
  it('reads the battle back as one line', () => {
    expect(summarizeBattle(battle)).toBe('180초 · 무속성 · 코어 없음 · 난수');
    expect(summarizeBattle({
      ...battle,
      duration: 90,
      enemyCode: '수냉',
      coreEnabled: true,
      corePx: 60,
      hasParts: true,
      optimalRangeWeapons: ['AR', 'SMG'],
      immuneWindows: [{ from: 10, to: 20 }],
      elementWindows: [{ from: 30, to: 40, code: '작열' }],
      rngMode: 'expected',
    })).toBe('90초 · 적 수냉 · 코어 60px · 파츠 · 적정 AR·SMG · 족자 1 · 속저 1 · 기대값');
  });

  it('names the squad, and counts decks in five-deck mode', () => {
    const decks = [
      { squad: ['리타', '크라운', '', '', ''] },
      { squad: ['앨리스', '나가', '', '', ''] },
      { squad: ['', '', '', '', ''] },
    ];
    expect(summarizeSquad(decks, false)).toBe('리타/크라운');
    expect(summarizeSquad(decks, true)).toBe('2덱 · 4명');
    // 5덱 모드라도 실제로 한 덱만 찼으면 이름이 더 쓸모 있다.
    expect(summarizeSquad([decks[0]!], true)).toBe('리타/크라운');

    // 이름 안에 «:»가 든 캐릭터가 섞여도 한 명씩 끊어 읽힌다.
    expect(summarizeSquad(
      [{ squad: ['크라운', '아니스 : 스타', '라피 : 레드 후드', '미하라 : 본딩 체인', '마스트 : 로망틱 메이드'] }],
      false,
    )).toBe('크라운/아니스 : 스타/라피 : 레드 후드/미하라 : 본딩 체인/마스트 : 로망틱 메이드');
  });
});
