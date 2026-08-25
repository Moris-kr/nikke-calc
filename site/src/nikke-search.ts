import type { CharacterMeta } from './types';

// 니케 이름 검색. 고르는 판이 늘 펼쳐져 있으므로 «친 이름이 맨 앞에 오는가»가
// 곧 검색의 품질이다. 걸러 내기만 하고 순서를 두지 않으면 「ㅋㄹㅇ」에 크라운이
// 아니라 아크레인저 블랙이 먼저 나온다 — 거른 보람이 없다.

const CHO = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];
const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const PER_CHO = 588;      // 중성 21 × 종성 28

/** 한글 음절을 초성으로 바꾼다. 한글이 아닌 글자는 그대로 둔다. */
export function initials(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code >= HANGUL_BASE && code <= HANGUL_LAST
      ? CHO[Math.floor((code - HANGUL_BASE) / PER_CHO)]
      : ch;
  }
  return out;
}

/**
 * 공백과 구분자를 지운다. 「라피레드」로 «라피 : 레드 후드»를 잡기 위한 것으로,
 * 지금은 콜론과 공백까지 정확히 맞춰야 걸린다.
 */
export const squash = (text: string): string =>
  text.toLocaleLowerCase('ko').replace(/[\s:·・]/g, '');

export interface SearchIndex {
  name: string;
  /** 구분자를 지운 이름 */
  key: string;
  /** 구분자를 지운 초성 */
  cho: string;
  /** 별칭(`수니스`)을 구분자 지운 형태로. 이름과 같은 무게로 친다 */
  aliasKeys: string[];
  /** 별칭의 초성 */
  aliasChos: string[];
  /** 속성·무기·클래스·기업 — 이름이 아닌 곁가지 */
  tags: string;
}

export function buildIndex(char: CharacterMeta): SearchIndex {
  const aliases = char.aliases ?? [];
  return {
    name: char.name,
    key: squash(char.name),
    cho: squash(initials(char.name)),
    aliasKeys: aliases.map(squash).filter(Boolean),
    aliasChos: aliases.map((alias) => squash(initials(alias))).filter(Boolean),
    tags: squash([
      char.elementCode, char.weaponType, char.className, char.manufacturer,
      `b${char.burstStage}`,
    ].join(' ')),
  };
}

/** 매치 등급. 낮을수록 앞이다. 안 걸리면 -1. */
export const NO_MATCH = -1;

export function rankOf(query: string, index: SearchIndex): number {
  const q = squash(query);
  if (!q) return 0;
  // 별칭은 유저가 일부러 정한 손잡이다 — 이름 첫머리와 같은 무게로 앞에 세운다.
  if (index.key.startsWith(q) || index.aliasKeys.some((a) => a.startsWith(q))) return 0;
  if (index.cho.startsWith(q) || index.aliasChos.some((a) => a.startsWith(q))) return 1;
  if (index.key.includes(q) || index.aliasKeys.some((a) => a.includes(q))) return 2;
  if (index.cho.includes(q) || index.aliasChos.some((a) => a.includes(q))) return 3;
  if (index.tags.includes(q)) return 4;
  return NO_MATCH;
}

/**
 * 검색어로 걸러 관련도 순으로 세운다. 검색어가 비면 걸러내지 않고 **원래 순서를
 * 지킨다** — 속성·버스트 칩만 걸었을 때 판이 통째로 재배열되면 눈이 길을 잃는다.
 */
export function filterByQuery<T>(
  items: T[],
  query: string,
  indexOf: (item: T) => SearchIndex,
): T[] {
  if (query.trim() === '') return items;
  const scored: Array<{ item: T; rank: number; length: number; name: string }> = [];
  for (const item of items) {
    const index = indexOf(item);
    const rank = rankOf(query, index);
    if (rank === NO_MATCH) continue;
    scored.push({ item, rank, length: index.name.length, name: index.name });
  }
  scored.sort((a, b) => a.rank - b.rank
    || a.length - b.length
    || a.name.localeCompare(b.name, 'ko'));
  return scored.map((entry) => entry.item);
}
