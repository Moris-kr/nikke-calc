import { describe, expect, it } from 'vitest';
import { buildIndex, filterByQuery, initials, NO_MATCH, rankOf, squash } from './nikke-search';
import type { CharacterMeta } from './types';

const meta = (name: string, over: Partial<CharacterMeta> = {}): CharacterMeta => ({
  name,
  burstStage: '3',
  elementCode: '전격',
  weaponType: 'AR',
  className: '화력형',
  manufacturer: '엘리시온',
  preview: false,
  image: null,
  nameCode: null, resourceId: null, aliases: [],
  ...over,
});

const 세이렌 = meta('리틀 머메이드', { aliases: ['세이렌'] });
const 수니스 = meta('아니스 : 스파클링 서머', { aliases: ['수니스'] });

const CHARS = [
  세이렌,
  수니스,
  meta('2B'),
  meta('아크레인저 블랙'),
  meta('크라운', { elementCode: '수냉' }),
  meta('크로우'),
  meta('라피 : 레드 후드', { elementCode: '작열' }),
  meta('라플라스'),
  meta('라피'),
  meta('목단', { weaponType: 'SR' }),
];

const pick = (query: string): string[] =>
  filterByQuery(CHARS, query, buildIndex).map((c) => c.name);

describe('initials', () => {
  it('한글 음절을 초성으로 바꾼다', () => {
    expect(initials('라피')).toBe('ㄹㅍ');
    expect(initials('크라운')).toBe('ㅋㄹㅇ');
    expect(initials('빨강')).toBe('ㅃㄱ');
  });

  it('한글이 아닌 글자는 그대로 둔다', () => {
    expect(initials('2B')).toBe('2B');
    expect(initials('라피 : 레드')).toBe('ㄹㅍ : ㄹㄷ');
  });
});

describe('squash', () => {
  it('공백과 구분자를 지운다', () => {
    expect(squash('라피 : 레드 후드')).toBe('라피레드후드');
    expect(squash('2B')).toBe('2b');
  });
});

describe('rankOf', () => {
  const crown = buildIndex(meta('크라운', { elementCode: '수냉' }));

  it('이름 첫머리가 가장 앞이고 곁가지가 가장 뒤다', () => {
    expect(rankOf('크라', crown)).toBe(0);
    expect(rankOf('ㅋㄹ', crown)).toBe(1);
    expect(rankOf('라운', crown)).toBe(2);
    expect(rankOf('ㄹㅇ', crown)).toBe(3);
    expect(rankOf('수냉', crown)).toBe(4);
  });

  it('걸리지 않으면 NO_MATCH', () => {
    expect(rankOf('앨리스', crown)).toBe(NO_MATCH);
  });
});

describe('filterByQuery', () => {
  it('초성으로 친 이름이 맨 앞에 온다', () => {
    // 이 순서가 뒤집히는 것이 판을 늘 펼쳐 두기 전의 실제 결함이었다:
    // 「ㅋㄹㅇ」에 아크레인저 블랙(초성 안에 ㅋㄹㅇ이 들어 있다)이 먼저 나왔다.
    expect(pick('ㅋㄹㅇ')[0]).toBe('크라운');
    expect(pick('ㅋㄹㅇ')).toContain('아크레인저 블랙');
  });

  it('짧고 정확한 이름을 긴 이름보다 앞에 둔다', () => {
    expect(pick('ㄹㅍ')[0]).toBe('라피');
  });

  it('구분자를 무시해 「라피레드」가 «라피 : 레드 후드»를 잡는다', () => {
    expect(pick('라피레드')).toEqual(['라피 : 레드 후드']);
  });

  it('속성·무기로도 걸리지만 이름보다 뒤로 밀린다', () => {
    expect(pick('SR')).toEqual(['목단']);
    expect(pick('작열')).toEqual(['라피 : 레드 후드']);
  });

  it('검색어가 비면 원래 순서를 그대로 지킨다', () => {
    expect(pick('')).toEqual(CHARS.map((c) => c.name));
    expect(pick('   ')).toEqual(CHARS.map((c) => c.name));
  });

  it('걸리는 게 없으면 빈 목록', () => {
    expect(pick('없는이름')).toEqual([]);
  });
});

describe('별칭 검색', () => {
  it('별칭으로 쳐도 찾아지고, 나오는 이름은 정식 명칭이다', () => {
    expect(pick('세이렌')).toEqual(['리틀 머메이드']);
    expect(pick('수니스')).toEqual(['아니스 : 스파클링 서머']);
  });

  it('별칭 초성으로도 찾아진다', () => {
    expect(pick('ㅅㅇㄹ')).toContain('리틀 머메이드');
    expect(pick('ㅅㄴㅅ')).toContain('아니스 : 스파클링 서머');
  });

  it('별칭은 이름 첫머리와 같은 무게다', () => {
    const index = buildIndex(세이렌);
    expect(rankOf('세이렌', index)).toBe(0);
    expect(rankOf('리틀', index)).toBe(0);
    // 별칭 안쪽만 걸리면 그만큼 뒤로 밀린다.
    expect(rankOf('이렌', index)).toBe(2);
  });

  it('별칭이 없는 캐릭터는 종전 그대로다', () => {
    expect(rankOf('세이렌', buildIndex(meta('크라운')))).toBe(NO_MATCH);
  });
});
