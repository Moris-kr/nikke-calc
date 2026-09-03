import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildCandidates, mergeRules, normalizeAbbrev, parseAbbrev, SEED_RULES,
} from './squad-abbrev';
import type { CharacterMeta } from './types';

// 실제 카탈로그로 시험한다. 이름·별칭 첫머리에서 나오는 답이 사람들이 쓰는 약어와
// 맞는지가 이 기능의 전부라, 가짜 목록으로는 아무것도 확인되지 않는다.
const catalog = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'public', 'catalog.json'), 'utf8'),
) as CharacterMeta[];
const names = new Set(catalog.map((char) => char.name));
const candidates = buildCandidates(catalog, () => true);
const parse = (text: string, extra: Parameters<typeof mergeRules>[0] = []) =>
  parseAbbrev(text, mergeRules(SEED_RULES, extra), candidates).names;

describe('이름으로 편성 입력', () => {
  it('씨앗 규칙이 가리키는 니케가 모두 실제로 있다', () => {
    // 오타 하나면 그 약어가 조용히 죽는다 — 이름은 카탈로그가 정본이다.
    const stray = SEED_RULES.flatMap((rule) => rule.names).filter((name) => !names.has(name));
    expect(stray).toEqual([]);
  });

  it('앞글자 다섯을 편성으로 푼다', () => {
    expect(parse('리센홍모라')).toEqual(['리타', '센티', '홍련', '모더니아', '라푼젤']);
  });

  it('「애미」는 붙여 적었을 때만 미란다다', () => {
    // 「애/미」로 부서지면 애니스와 미하라가 튀어나온다.
    expect(parse('애미')).toEqual(['미란다']);
    expect(parse('애미하라')).toEqual(['미란다', '하란', '라푼젤']);
    // 글자 수와 니케 수가 다르니 §한데 묶이는 글자가 아니다 — 떨어져 적으면 안 걸린다.
    expect(parse('애리미')).not.toContain('미란다');
  });

  it('함께 적힌 글자는 그 조합의 뜻으로 읽는다', () => {
    expect(parse('리크헬클일')).toEqual([
      '리타', '크라운', '헬름', '루드밀라 : 윈터 오너', '일레그 : 붐 앤 쇼크',
    ]);
    expect(parse('세크풍풍프')).toEqual([
      '리틀 머메이드', '크라운', '아스카 : WILLE', '레이 (가칭)', '프리바티',
    ]);
  });

  it('모임은 떨어져 적혀도 성립한다', () => {
    // 「헬클일이 같이 있으면」은 붙여 적을 때만의 이야기가 아니다.
    expect(parse('헬리클크일')).toEqual([
      '헬름', '리타', '루드밀라 : 윈터 오너', '크라운', '일레그 : 붐 앤 쇼크',
    ]);
    // 같은 글자 둘은 적힌 차례대로 짝을 짓는다.
    expect(parse('풍리풍센모')).toEqual([
      '아스카 : WILLE', '리타', '레이 (가칭)', '센티', '모더니아',
    ]);
    expect(parse('크리메센모')).toEqual([
      '크라운', '리타', '마스트 : 로망틱 메이드', '센티', '모더니아',
    ]);
  });

  it('모임이 다 모이지 않으면 건드리지 않는다', () => {
    // 「풍」이 하나뿐이면 「풍풍」의 짝짓기는 성립하지 않는다 — 반만 바꾸면 더 헷갈린다.
    // 남은 한 자리는 별칭 첫머리(풍스카·풍레이·풍라플·풍스웰) 중에서 고를 뿐이다.
    const one = parse('풍리센모라');
    expect(one.slice(1)).toEqual(['리타', '센티', '모더니아', '라푼젤']);
    expect(['아스카 : WILLE', '레이 (가칭)', '라플라스 : 얼티밋 히어로', '맥스웰 : 오디너리 미케닉'])
      .toContain(one[0]);
    // 둘이 모이면 그때 뜻이 정해진다.
    expect(parse('풍풍리센모').slice(0, 2)).toEqual(['아스카 : WILLE', '레이 (가칭)']);
  });

  it('이름을 길게 쳐도 한 덩어리로 읽는다', () => {
    // 「라피레드」를 「라 + 피 + 레 + 드」로 부수면 되돌릴 길이 없다.
    expect(parse('라피레드')).toEqual(['라피 : 레드 후드']);
    expect(parse('크라운')).toEqual(['크라운']);
    expect(parse('리버렐리오')).toEqual(['리버렐리오']);
  });

  it('별칭도 이름과 같은 무게로 본다', () => {
    expect(parse('수니스')).toEqual(['아니스 : 스파클링 서머']);
    expect(parse('흑련')).toEqual(['홍련 : 흑영']);
  });

  it('띄어 써도 같은 답이 나온다', () => {
    expect(normalizeAbbrev('리 센 홍 모 라')).toBe('리센홍모라');
    expect(parse('리 센 홍 모 라')).toEqual(parse('리센홍모라'));
    expect(parse('리,센,홍,모,라')).toEqual(parse('리센홍모라'));
  });

  it('못 알아본 글자를 짚어 준다', () => {
    // 통째로 실패하지 않고 «이 글자만 모르겠다»고 말한다.
    const result = parseAbbrev('리센ㅋ모라', mergeRules(SEED_RULES), candidates);
    expect(result.unknown).toEqual(['ㅋ']);
    expect(result.names).toEqual(['리타', '센티', '모더니아', '라푼젤']);
    expect(result.segments.map((segment) => segment.key)).toEqual(['리', '센', 'ㅋ', '모', '라']);
  });

  it('등록한 예외가 씨앗을 이긴다', () => {
    expect(parse('리센홍모라', [{ key: '리', names: ['리버렐리오'] }])[0]).toBe('리버렐리오');
    // 새 모임도 같은 방식으로 등록된다.
    expect(parse('모라센', [{ key: '모라', names: ['모더니아', '라플라스'] }]))
      .toEqual(['모더니아', '라플라스', '센티']);
  });

  it('불러온 프로필에 있는 니케를 앞에 세운다', () => {
    // 같은 첫머리를 가진 니케가 여럿이면, 가진 쪽이 먼저다.
    const owned = buildCandidates(catalog, (name) => name === '메이든');
    const pick = (has: typeof owned) => parseAbbrev('메', [], has).names[0];
    expect(pick(owned)).toBe('메이든');
    expect(pick(buildCandidates(catalog, (name) => name === '메어리'))).toBe('메어리');
  });

  it('빈 글자에는 아무 답도 하지 않는다', () => {
    expect(parseAbbrev('', SEED_RULES, candidates)).toEqual({ segments: [], names: [], unknown: [] });
    expect(parseAbbrev('   ', SEED_RULES, candidates).names).toEqual([]);
  });

  it('사전은 뒤에 온 것이 이기고, 비우면 지운다', () => {
    const merged = mergeRules(
      [{ key: '리', names: ['리타'] }],
      [{ key: '리', names: ['리버렐리오'] }, { key: '센', names: ['센티'] }],
      [{ key: '센', names: [] }],
    );
    expect(merged).toEqual([{ key: '리', names: ['리버렐리오'] }]);
  });
});
