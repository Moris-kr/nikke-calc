import { describe, expect, it } from 'vitest';
import { formatEok, toComps, type EnikkRanking } from './enikk';

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

const player = (teams: Array<{ characters: string[]; damage?: number }>): EnikkRanking => ({
  rank: 1, playerid: 'p', server: 'KR', damage: 0, cp: 0, teams,
});

describe('formatEok', () => {
  it('억 단위로 읽는다 — enikk의 B 표기를 그대로 쓰지 않는다', () => {
    expect(formatEok(6_254_535_716)).toBe('62.5억');
    expect(formatEok(42_083_871_002)).toBe('420.8억');
    expect(formatEok(0)).toBe('0');
  });
});

describe('toComps', () => {
  it('같은 조합을 묶고 사용 횟수·평균·최고를 낸다', () => {
    const result = toComps([
      player([{ characters: A, damage: 100_000_000 }, { characters: B, damage: 500_000_000 }]),
      player([{ characters: A, damage: 300_000_000 }]),
    ], NAMES, SUPPORTED);

    expect(result.decks).toBe(3);
    expect(result.comps).toHaveLength(2);
    const [top] = result.comps;
    expect(top!.squad).toEqual(['리타', '그레이브', '앨리스', '레이', '모더니아']);
    expect(top!.uses).toBe(2);
    expect(top!.averageDamage).toBe(200_000_000);
    expect(top!.maxDamage).toBe(300_000_000);
  });

  it('사용 횟수 순으로 세우고, 같으면 평균 딜이 높은 쪽이 앞이다', () => {
    const result = toComps([
      player([{ characters: A, damage: 100_000_000 }]),
      player([{ characters: B, damage: 900_000_000 }]),
    ], NAMES, SUPPORTED);
    expect(result.comps[0]!.squad[1]).toBe('목단');   // 같은 1회 — 평균이 높은 B
  });

  it('순서가 다르면 다른 조합이다 — enikk 표기 순서가 버스트 우선순위다', () => {
    const swapped = [A[1]!, A[0]!, A[2]!, A[3]!, A[4]!];
    const result = toComps([
      player([{ characters: A, damage: 1 }, { characters: swapped, damage: 1 }]),
    ], NAMES, SUPPORTED);
    expect(result.comps).toHaveLength(2);
  });

  it('모르는 영문명은 조합을 버리고 이름을 보고한다', () => {
    const result = toComps([
      player([{ characters: ['Liter', 'Grave', 'Alice', 'Rei', 'NewGirl'], damage: 1 }]),
    ], NAMES, SUPPORTED);
    expect(result.comps).toHaveLength(0);
    expect(result.unknownNames).toEqual(['NewGirl']);
  });

  it('계산기가 못 도는 니케가 끼면 세어서 알린다', () => {
    const result = toComps([
      player([{ characters: A, damage: 1 }]),
    ], NAMES, new Set(['리타', '그레이브', '앨리스', '레이']));   // 모더니아 빠짐
    expect(result.comps).toHaveLength(0);
    expect(result.unsupported).toBe(1);
  });

  it('딜이 안 실려 온 덱은 횟수만 세고 평균을 흐리지 않는다', () => {
    const result = toComps([
      player([{ characters: A }, { characters: A, damage: 400_000_000 }]),
    ], NAMES, SUPPORTED);
    expect(result.comps[0]!.uses).toBe(2);
    expect(result.comps[0]!.averageDamage).toBe(400_000_000);
  });
});
