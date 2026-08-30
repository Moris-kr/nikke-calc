import { describe, expect, it } from 'vitest';
import {
  candidatesFor, cycleLine, cyclesFromTimeline, estimateCycles, picksFrom,
  progressOf, pruneToSquad, sequenceFrom, stepKey, stepsFor, trimSequence,
  type BurstSequence,
} from './burst-order';
import type { BattleTimeline, CharacterMeta } from './types';

const meta = (name: string, burstStage: string): CharacterMeta => ({
  name, burstStage, elementCode: '전격', weaponType: 'AR', className: '화력형',
  manufacturer: '엘리시온', preview: false, image: null, nameCode: null,
  resourceId: null, aliases: [],
});

const CATALOG = new Map([
  ['리타', meta('리타', '1')],
  ['돌치', meta('돌치', '1')],
  ['크라운', meta('크라운', '2')],
  ['앨리스', meta('앨리스', '3')],
  ['모더니아', meta('모더니아', '3')],
  ['레드 후드', meta('레드 후드', 'A')],
]);
const metaOf = (name: string) => CATALOG.get(name);

describe('사이클 수 어림', () => {
  it('전투 시간을 20초 사이클로 나눈다', () => {
    expect(estimateCycles(180)).toBe(9);
    expect(estimateCycles(90)).toBe(5);
    expect(estimateCycles(20)).toBe(1);
  });

  it('말이 안 되는 시간에도 최소 하나는 준다', () => {
    expect(estimateCycles(0)).toBe(1);
    expect(estimateCycles(-5)).toBe(1);
    expect(estimateCycles(Number.NaN)).toBe(1);
  });

  it('아무리 길어도 상한에서 멈춘다', () => {
    expect(estimateCycles(100_000)).toBe(30);
  });
});

describe('지난 계산에서 실제 횟수 읽기', () => {
  const timelineWith = (windows: number[][]): BattleTimeline =>
    ({ fullBurst: windows } as unknown as BattleTimeline);

  it('풀버스트 창 수가 곧 사이클 수다', () => {
    expect(cyclesFromTimeline(timelineWith([[10, 20], [30, 40], [50, 60]]))).toBe(3);
  });

  it('타임라인이 없거나 비면 null — 어림값으로 물러난다', () => {
    expect(cyclesFromTimeline(undefined)).toBeNull();
    expect(cyclesFromTimeline(timelineWith([]))).toBeNull();
  });
});

describe('걸음 만들기', () => {
  it('사이클마다 1버 → 2버 → 3버', () => {
    expect(stepsFor(2).map(stepKey)).toEqual(['1:1', '1:2', '1:3', '2:1', '2:2', '2:3']);
  });

  it('0이면 걸음이 없다', () => {
    expect(stepsFor(0)).toEqual([]);
  });
});

describe('단계별 후보', () => {
  const squad = ['리타', '크라운', '앨리스', '레드 후드', '돌치'];

  it('그 단계인 니케만, 편성 순서 그대로', () => {
    // 단축키가 자리를 바꾸면 손이 외운 위치가 무너진다 — 순서를 지킨다.
    expect(candidatesFor('1', { squad, metaOf })).toEqual(['리타', '레드 후드', '돌치']);
    expect(candidatesFor('2', { squad, metaOf })).toEqual(['크라운', '레드 후드']);
    expect(candidatesFor('3', { squad, metaOf })).toEqual(['앨리스', '레드 후드']);
  });

  it('「버스트 안 씀」으로 잡아 둔 사람은 후보에서 뺀다', () => {
    expect(candidatesFor('1', { squad, metaOf, skipped: new Set(['리타']) }))
      .toEqual(['레드 후드', '돌치']);
  });

  it('빈 칸과 모르는 이름은 건너뛰고, 같은 이름을 두 번 세지 않는다', () => {
    expect(candidatesFor('1', { squad: ['리타', '', '없는애', '리타'], metaOf }))
      .toEqual(['리타']);
  });

  it('그 단계를 채울 사람이 없으면 빈 목록', () => {
    expect(candidatesFor('2', { squad: ['리타', '앨리스'], metaOf })).toEqual([]);
  });
});

describe('고른 것 → 엔진이 받는 순서', () => {
  it('사이클마다 단계별 후보 하나씩', () => {
    const seq = sequenceFrom({ '1:1': '리타', '1:2': '크라운', '1:3': '앨리스' }, 1);
    expect(seq).toEqual([{ 1: ['리타'], 2: ['크라운'], 3: ['앨리스'] }]);
  });

  it('안 고른 자리는 빈 목록 — 그 단계만 평소 순서로 돈다', () => {
    const seq = sequenceFrom({ '1:1': '리타', '2:3': '모더니아' }, 2);
    expect(seq[0]).toEqual({ 1: ['리타'], 2: [], 3: [] });
    expect(seq[1]).toEqual({ 1: [], 2: [], 3: ['모더니아'] });
  });
});

describe('요청에 실을 모양으로 다듬기', () => {
  it('아무것도 안 골랐으면 null — 평소 순서 그대로 돈다', () => {
    expect(trimSequence(sequenceFrom({}, 5))).toBeNull();
    expect(trimSequence([])).toBeNull();
    expect(trimSequence(undefined)).toBeNull();
  });

  it('뒤쪽 빈 사이클은 잘라 낸다 — 남기면 그 사이클에서 버스트가 막힌다', () => {
    const seq = sequenceFrom({ '1:1': '리타' }, 5);
    expect(trimSequence(seq)).toHaveLength(1);
  });

  it('가운데 빈 사이클은 남긴다 — 자리를 옮기면 다른 순서가 된다', () => {
    const seq = sequenceFrom({ '1:1': '리타', '3:1': '돌치' }, 3);
    const trimmed = trimSequence(seq)!;
    expect(trimmed).toHaveLength(3);
    expect(trimmed[1]).toEqual({ 1: [], 2: [], 3: [] });
  });
});

describe('편성이 바뀌면 걸러 낸다', () => {
  it('편성에 없는 이름은 떨군다 — 조용히 틀린 순서로 돌지 않게', () => {
    const seq: BurstSequence = [{ 1: ['리타'], 2: ['크라운'], 3: ['앨리스'] }];
    expect(pruneToSquad(seq, ['리타', '앨리스'])).toEqual([{ 1: ['리타'], 2: [], 3: ['앨리스'] }]);
  });

  it('편성을 통째로 바꿔 남는 게 없으면 null', () => {
    const seq: BurstSequence = [{ 1: ['리타'], 2: [], 3: [] }];
    expect(pruneToSquad(seq, ['모더니아'])).toBeNull();
  });
});

describe('창을 다시 열면 하던 자리가 남는다', () => {
  it('순서 → 걸음별 선택으로 되돌린다', () => {
    const picks = { '1:1': '리타', '1:3': '앨리스', '2:2': '크라운' };
    expect(picksFrom(sequenceFrom(picks, 2))).toEqual(picks);
  });
});

describe('진행 표시', () => {
  it('몇 칸을 채웠나 센다', () => {
    const steps = stepsFor(2);
    expect(progressOf({ '1:1': '리타', '2:3': '앨리스' }, steps)).toEqual({ done: 2, total: 6 });
    expect(progressOf({}, steps)).toEqual({ done: 0, total: 6 });
  });
});

describe('한 줄 요약', () => {
  it('고른 단계만 화살표로 잇는다', () => {
    expect(cycleLine({ 1: ['리타'], 2: ['크라운'], 3: ['앨리스'] }))
      .toBe('1버 리타 → 2버 크라운 → 3버 앨리스');
    expect(cycleLine({ 1: [], 2: ['크라운'], 3: [] })).toBe('2버 크라운');
  });

  it('빈 사이클은 「자동」이라 적는다', () => {
    expect(cycleLine({ 1: [], 2: [], 3: [] })).toBe('자동');
    expect(cycleLine(undefined)).toBe('자동');
  });
});
