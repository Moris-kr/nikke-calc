import { describe, expect, it } from 'vitest';
import { formatEok, toPlayers, type EnikkRanking } from './enikk';

const NAMES = new Map([
  ['Liter', '리타'],
  ['Grave', '그레이브'],
  ['Alice', '앨리스'],
  ['Rei', '레이'],
  ['Modernia', '모더니아'],
  ['Moran', '목단'],
]);
const SUPPORTED = new Set([...NAMES.values()]);

const A = ['Liter', 'Grave', 'Alice', 'Rei', 'Modernia'];
const B = ['Liter', 'Moran', 'Alice', 'Rei', 'Modernia'];

const player = (
  over: Partial<EnikkRanking>,
  teams: Array<{ characters: string[]; damage?: number; cp?: number }>,
): EnikkRanking => ({
  rank: 1, playerid: 'p', server: 'KR', damage: 0, cp: 0, teams, ...over,
});

describe('formatEok', () => {
  it('억 단위로 읽는다 — enikk의 B 표기를 그대로 쓰지 않는다', () => {
    expect(formatEok(6_254_535_716)).toBe('62.5억');
    expect(formatEok(42_083_871_002)).toBe('420.8억');
    expect(formatEok(0)).toBe('0');
  });
});

describe('toPlayers', () => {
  it('사람마다 덱을 그대로 들고 있는다 — 조합으로 묶지 않는다', () => {
    const result = toPlayers([
      player({ playerid: 'x', damage: 900 }, [
        { characters: A, damage: 400 },
        { characters: B, damage: 500 },
      ]),
    ], NAMES, SUPPORTED);

    expect(result.players).toHaveLength(1);
    const [p] = result.players;
    expect(p!.decks).toHaveLength(2);
    expect(p!.decks[0]!.squad).toEqual(['리타', '그레이브', '앨리스', '레이', '모더니아']);
    expect(p!.decks[1]!.squad[1]).toBe('목단');
    expect(result.decks).toBe(2);
  });

  it('같은 조합을 둘이 써도 각자 남는다', () => {
    const result = toPlayers([
      player({ playerid: 'a', damage: 10 }, [{ characters: A, damage: 10 }]),
      player({ playerid: 'b', damage: 20 }, [{ characters: A, damage: 20 }]),
    ], NAMES, SUPPORTED);
    expect(result.players.map((p) => p.playerid)).toEqual(['b', 'a']);   // 총딜 내림차순
  });

  it('못 다루는 니케가 낀 덱은 가져올 수 없다고 표시하되 버리지 않는다', () => {
    const result = toPlayers([
      player({ damage: 1 }, [
        { characters: A, damage: 1 },
        { characters: ['Liter', 'Grave', 'Alice', 'Rei', 'NewGirl'], damage: 2 },
      ]),
    ], NAMES, SUPPORTED);

    const [p] = result.players;
    expect(p!.decks[0]!.usable).toBe(true);
    expect(p!.decks[1]!.usable).toBe(false);
    // 덱은 남는다 — 그 사람이 무엇을 썼는지는 보여 준다.
    expect(p!.decks).toHaveLength(2);
    expect(result.unknownNames).toEqual(['NewGirl']);
    expect(result.unsupported).toBe(1);
  });

  it('계산기에 없는 니케도 못 쓰는 덱으로 센다', () => {
    const result = toPlayers([
      player({ damage: 1 }, [{ characters: A, damage: 1 }]),
    ], NAMES, new Set(['리타', '그레이브', '앨리스', '레이']));   // 모더니아 빠짐
    expect(result.players[0]!.decks[0]!.usable).toBe(false);
    expect(result.unsupported).toBe(1);
  });

  it('덱이 하나도 없는 사람은 목록에 넣지 않는다', () => {
    const result = toPlayers([player({ damage: 1 }, [])], NAMES, SUPPORTED);
    expect(result.players).toHaveLength(0);
  });
});
