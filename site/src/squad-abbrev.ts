/**
 * 「이름으로 편성 입력」 — 앞글자를 이어 친 약어를 편성으로 푼다.
 *
 * 커뮤니티에서 조합을 부르는 방식은 «리센홍모라»처럼 **각 니케의 앞글자를 이어 붙인
 * 한 덩어리**다. 칸을 다섯 번 눌러 고르는 것보다 이쪽이 훨씬 빠르므로, 친 글자를 그대로
 * 받아 편성으로 옮긴다.
 *
 * 어려운 점은 약어가 **비문학**이라는 것이다. 「클」은 이름 어디에도 없는 글자인데
 * 루드밀라 : 윈터 오너를 뜻하고(별칭 «클루드»), 「풍풍」은 같은 글자 둘이 서로 다른
 * 니케(아스카 : WILLE · 레이 (가칭))를 가리킨다. 그래서 규칙 하나로 풀 수 없고,
 * **사람이 등록한 뜻**을 이름·별칭 첫머리보다 앞에 두는 사전이 필요하다.
 *
 * 푸는 방법은 «어디서 끊을지»와 «각 토막이 누구인지»를 한꺼번에 고르는 것이다. 토막마다
 * 값을 매기고 전체 합이 가장 낮은 끊기를 고른다(동적 계획법) — 앞에서부터 욕심껏 끊으면
 * «라피레드»를 «라 + 피 + 레 + 드»로 부숴 놓고 되돌리지 못한다.
 *
 * 끊기가 끝나면 **함께 적힌 글자**를 한 번 더 본다. 「헬클일이 같이 있으면」 같은 뜻은
 * 글자가 붙어 있을 때만이 아니라 떨어져 있을 때도 성립한다 — 「헬리크클일」처럼 사이에
 * 다른 글자가 끼어도 그 셋은 여전히 그 셋이다. 그래서 이런 규칙은 자리가 아니라
 * **글자의 모임**으로 본다(§한데 묶이는 글자).
 */

import { squash } from './nikke-search';
import type { CharacterMeta } from './types';

/** 한 토막의 뜻. `names`가 둘 이상이면 그 글자 덩어리가 여러 명을 뜻한다(«풍풍»). */
export interface AbbrevRule {
  key: string;
  names: string[];
}

/** 매칭 대상. 이름과 별칭을 같은 무게로 본다 — 별칭도 사람이 정한 손잡이다. */
export interface AbbrevCandidate {
  name: string;
  keys: string[];
  /** 불러온 프로필에 있는 니케인가. 없는 쪽을 뒤로 미는 데만 쓴다. */
  owned: boolean;
}

export type AbbrevKind = 'rule' | 'exact' | 'prefix' | 'unknown';

export interface AbbrevSegment {
  /** 친 글자에서 이 토막이 차지한 부분 */
  key: string;
  /** 그 토막이 뜻하는 니케들. 못 알아보면 빈 목록 */
  names: string[];
  kind: AbbrevKind;
}

export interface AbbrevParse {
  segments: AbbrevSegment[];
  /** 편성에 넣을 이름들. 못 알아본 토막은 빠진다 */
  names: string[];
  /** 못 알아본 글자들 */
  unknown: string[];
}

/**
 * 값매김. 낮을수록 먼저다.
 *
 * - 사람이 등록한 뜻(`rule`)은 이견이 없으므로 0에서 시작한다.
 * - 통째로 맞은 이름·별칭(`exact`)이 첫머리만 맞은 것(`prefix`)보다 앞선다.
 * - **글자를 한 자 더 쓴 토막**은 그만큼 확실하다(`LONGER`). 이 값이 이름 길이 차이보다
 *   크므로 «라피레드»는 넷으로 부서지지 않고 한 덩어리로 남는다.
 * - 같은 등급에서는 **이름이 짧은 쪽**이 앞이다 — 「리」는 리버렐리오보다 리타다.
 */
const KIND_COST = { rule: 0, exact: 300, prefix: 600 } as const;
const LONGER = 140;
const UNOWNED = 40;
/** 아무 데도 안 걸리는 글자. 값이 커서 다른 길이 있으면 절대 안 고른다. */
const UNKNOWN_COST = 5000;
/** 한 토막이 될 수 있는 최대 글자 수. 「라플라스얼티밋」쯤까지 받는다. */
const MAX_KEY = 8;

/** 친 글자를 맞춰 볼 형태로. 공백·구분자와 이름에 없는 기호를 턴다. */
export const normalizeAbbrev = (text: string): string =>
  squash(text).replace(/[^0-9a-z가-힣ㄱ-ㅎ()]/g, '');

/** 카탈로그 + 불러온 프로필 → 매칭 대상. */
export function buildCandidates(
  catalog: CharacterMeta[],
  owned: (name: string) => boolean,
): AbbrevCandidate[] {
  return catalog.map((char) => ({
    name: char.name,
    keys: [squash(char.name), ...(char.aliases ?? []).map(squash)].filter(Boolean),
    owned: owned(char.name),
  }));
}

interface Option {
  names: string[];
  kind: AbbrevKind;
  cost: number;
}

/** 이 글자 덩어리가 뜻할 수 있는 것들. 등급마다 가장 나은 하나씩만 남긴다. */
function optionsFor(
  key: string,
  ruleAt: Map<string, string[]>,
  candidates: AbbrevCandidate[],
): Option[] {
  const bonus = LONGER * (key.length - 1);
  const options: Option[] = [];
  const rule = ruleAt.get(key);
  if (rule) options.push({ names: rule, kind: 'rule', cost: KIND_COST.rule - bonus });

  let exact: Option | null = null;
  let prefix: Option | null = null;
  for (const candidate of candidates) {
    const extra = (candidate.owned ? 0 : UNOWNED) + candidate.name.length;
    for (const candidateKey of candidate.keys) {
      if (candidateKey === key) {
        const cost = KIND_COST.exact + extra - bonus;
        if (!exact || cost < exact.cost) exact = { names: [candidate.name], kind: 'exact', cost };
      } else if (candidateKey.startsWith(key)) {
        const cost = KIND_COST.prefix + extra - bonus;
        if (!prefix || cost < prefix.cost) prefix = { names: [candidate.name], kind: 'prefix', cost };
      }
    }
  }
  if (exact) options.push(exact);
  if (prefix) options.push(prefix);
  // 한 글자짜리는 «모르겠다»도 후보로 둔다 — 그래야 알아본 글자까지 통째로 버리지 않고
  // 「이 글자만 못 알아봤다」고 짚어 줄 수 있다.
  if (key.length === 1) options.push({ names: [], kind: 'unknown', cost: UNKNOWN_COST });
  return options;
}

interface State {
  cost: number;
  unknown: number;
  segment: AbbrevSegment;
  from: number;
  fromCount: number;
}

/**
 * 친 글자를 편성으로 푼다.
 *
 * `rules`는 **뒤에 온 것이 이긴다** — 씨앗, 모두가 모아 준 것, 내가 등록한 것 순으로
 * 넘기면 내 등록이 맨 앞에 선다.
 *
 * `slots`(보통 5)는 «몇 명을 치려 했는가»다. 못 알아본 글자가 없는 끊기들 중에서는
 * 인원수가 이 수와 맞는 쪽을 먼저 고른다 — 다섯 글자를 쳤으면 다섯 명일 확률이 높다.
 */
export function parseAbbrev(
  raw: string,
  rules: AbbrevRule[],
  candidates: AbbrevCandidate[],
  slots = 5,
): AbbrevParse {
  const text = normalizeAbbrev(raw);
  const empty: AbbrevParse = { segments: [], names: [], unknown: [] };
  if (text === '') return empty;

  const ruleAt = new Map<string, string[]>();
  for (const rule of rules) {
    const key = normalizeAbbrev(rule.key);
    const names = rule.names.filter(Boolean);
    if (key && names.length > 0) ruleAt.set(key, names);
  }

  // best[자리][인원수] = 거기까지 오는 가장 싼 길
  const best: Array<Map<number, State>> = Array.from({ length: text.length + 1 }, () => new Map());
  best[0]!.set(0, { cost: 0, unknown: 0, segment: { key: '', names: [], kind: 'rule' }, from: -1, fromCount: 0 });

  for (let at = 0; at < text.length; at += 1) {
    const here = best[at]!;
    if (here.size === 0) continue;
    for (let len = 1; len <= Math.min(MAX_KEY, text.length - at); len += 1) {
      const key = text.slice(at, at + len);
      const options = optionsFor(key, ruleAt, candidates);
      if (options.length === 0) continue;
      const target = best[at + len]!;
      for (const [count, state] of here) {
        for (const option of options) {
          const nextCount = count + Math.max(1, option.names.length);
          const cost = state.cost + option.cost;
          const unknown = state.unknown + (option.kind === 'unknown' ? 1 : 0);
          const seen = target.get(nextCount);
          if (seen && (seen.unknown < unknown || (seen.unknown === unknown && seen.cost <= cost))) continue;
          target.set(nextCount, {
            cost,
            unknown,
            segment: { key, names: option.names, kind: option.kind },
            from: at,
            fromCount: count,
          });
        }
      }
    }
  }

  const ends = [...best[text.length]!.entries()];
  if (ends.length === 0) return empty;

  // 못 알아본 글자가 적은 쪽 → 인원수가 맞는 쪽 → 값이 싼 쪽.
  ends.sort(([countA, a], [countB, b]) => a.unknown - b.unknown
    || (countA === slots ? 0 : 1) - (countB === slots ? 0 : 1)
    || a.cost - b.cost
    || countA - countB);

  const segments: AbbrevSegment[] = [];
  let state = ends[0]![1];
  while (state.from >= 0) {
    segments.unshift(state.segment);
    state = best[state.from]!.get(state.fromCount)!;
  }

  applyGroups(segments, [...ruleAt].map(([key, names]) => ({ key, names })));

  return {
    segments,
    names: segments.flatMap((segment) => segment.names),
    unknown: segments.filter((segment) => segment.kind === 'unknown').map((segment) => segment.key),
  };
}

/**
 * §한데 묶이는 글자 — 떨어져 적힌 모임을 잡는다.
 *
 * 「헬클일」·「크메」·「풍풍」처럼 **글자 수와 니케 수가 같은** 규칙은 자리를 지키지
 * 않는다. 붙여 적으면 위의 끊기에서 한 덩어리로 잡히지만, 사이에 다른 글자가 끼면
 * 그러지 못한다 — 여기서 한 글자짜리 토막들을 훑어 그 모임이 다 모였는지 보고, 모였으면
 * 각 글자의 뜻을 규칙대로 바꿔 준다.
 *
 * 같은 글자가 두 번 나오는 모임(「풍풍」)은 **적힌 차례대로** 짝을 짓는다. 이미 다른
 * 모임이 가져간 자리는 건드리지 않고, 글자가 긴 모임을 먼저 본다 — 더 구체적인 뜻이
 * 앞서야 하기 때문이다.
 */
function applyGroups(segments: AbbrevSegment[], rules: AbbrevRule[]): void {
  const groups = rules
    .filter((rule) => rule.key.length >= 2 && rule.names.length === rule.key.length)
    .sort((a, b) => b.key.length - a.key.length || a.key.localeCompare(b.key, 'ko'));
  const claimed = new Set<number>();

  for (const rule of groups) {
    const tokens = [...rule.key];
    const pool = new Map<string, number[]>();
    for (const [at, segment] of segments.entries()) {
      if (claimed.has(at) || segment.key.length !== 1) continue;
      const seats = pool.get(segment.key) ?? [];
      seats.push(at);
      pool.set(segment.key, seats);
    }
    const need = new Map<string, number>();
    for (const token of tokens) need.set(token, (need.get(token) ?? 0) + 1);
    // 하나라도 모자라면 이 모임은 성립하지 않는다 — 반만 바꾸면 더 헷갈린다.
    if ([...need].some(([token, count]) => (pool.get(token)?.length ?? 0) < count)) continue;

    const used = new Map<string, number>();
    for (const [index, token] of tokens.entries()) {
      const nth = used.get(token) ?? 0;
      used.set(token, nth + 1);
      const at = pool.get(token)![nth]!;
      segments[at] = { key: token, names: [rule.names[index]!], kind: 'rule' };
      claimed.add(at);
    }
  }
}

/**
 * 씨앗 사전. 유저가 알려 준 실제 용례(2026-09-02)를 그대로 옮긴 것으로, 이름·별칭
 * 첫머리만으로는 절대 나오지 않는 뜻들이다.
 *
 * - 「리」는 리버렐리오·리틀 머메이드도 되지만 실제로는 리타를 뜻한다.
 * - 「라」는 라피·라플라스도 되지만 라푼젤이다.
 * - 「클」·「세」는 이름에 아예 없는 글자다(별칭 «클루드», 세이렌 쪽 통칭).
 * - 「헬클일」·「풍풍」·「크메」는 **함께 적혔을 때** 뜻이 정해지는 모임이다 — 「풍」
 *   하나로는 풍스카·풍레이·풍라플·풍스웰을 가를 수 없다. 붙여 적든 떨어져 적든 같다
 *   (§한데 묶이는 글자).
 *
 * 여기 없는 약어는 사람들이 등록해 채운다(`/abbrev`).
 */
export const SEED_RULES: AbbrevRule[] = [
  { key: '리', names: ['리타'] },
  { key: '센', names: ['센티'] },
  { key: '홍', names: ['홍련'] },
  { key: '모', names: ['모더니아'] },
  { key: '라', names: ['라푼젤'] },
  { key: '크', names: ['크라운'] },
  { key: '헬', names: ['헬름'] },
  { key: '클', names: ['루드밀라 : 윈터 오너'] },
  { key: '일', names: ['일레그 : 붐 앤 쇼크'] },
  { key: '세', names: ['리틀 머메이드'] },
  { key: '프', names: ['프리바티'] },
  { key: '헬클일', names: ['헬름', '루드밀라 : 윈터 오너', '일레그 : 붐 앤 쇼크'] },
  { key: '풍풍', names: ['아스카 : WILLE', '레이 (가칭)'] },
  { key: '크메', names: ['크라운', '마스트 : 로망틱 메이드'] },
  // 「애미」는 미란다 한 사람이다. 글자 수와 니케 수가 달라 §한데 묶이는 글자가 아니라
  // **붙여 적었을 때만** 잡힌다 — 「애미하라」는 애미 + 하 + 라로 끊긴다.
  { key: '애미', names: ['미란다'] },
];

/** 규칙을 사전에 넣을 때 쓰는 열쇠. 같은 글자면 같은 규칙이다. */
export const ruleKey = (rule: AbbrevRule): string => normalizeAbbrev(rule.key);

/**
 * 사전 여럿을 겹친다. 뒤에 온 것이 이긴다 — 씨앗 < 모두의 등록 < 내 등록.
 * 이름이 하나도 없는 규칙은 «지운 것»으로 보고 뺀다.
 */
export function mergeRules(...layers: AbbrevRule[][]): AbbrevRule[] {
  const merged = new Map<string, AbbrevRule>();
  for (const layer of layers) {
    for (const rule of layer) {
      const key = ruleKey(rule);
      if (!key) continue;
      if (rule.names.filter(Boolean).length === 0) merged.delete(key);
      else merged.set(key, { key, names: rule.names.filter(Boolean) });
    }
  }
  return [...merged.values()];
}
