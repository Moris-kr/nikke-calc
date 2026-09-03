import { describe, expect, it } from 'vitest';

import {
  activeDesign, aimPoint, BOSS_PREFIX, breakTime, copyDesign, coreHitChance, decodeBossCode,
  derivedEnemy, derivedPartBreakInterval, distance, dropDesign, emptyDesign, emptyLibrary,
  aimAt, aimedPartBreaks, aimForNikke, derivedOptimalRange, encodeBossCode, hitTest,
  impactOffsets, inFullBurst, partHitFraction,
  mixRangeColor, outerRadius, parseDesign, parseLibrary, partBreaks, partsInBlast, pierceTargets,
  PLAYER_SLOT,
  phaseAt, putDesign, scoreUntil, spreadRadius, tidyWindows, visibleAt,
  type AccuracyTable, type BossPart, type BossShape,
  MIN_SIZE, resizeBox,
} from './boss-maker';

// 계산기 본체(`data/weapon_mechanics.json`)와 같은 표. 설정에서 그대로 받아 온다.
const table: AccuracyTable = {
  modelN: 2.55,
  weapons: {
    AR: { baseDiameter: 76, accSlope: 0.69 },
    SMG: { baseDiameter: 110, accSlope: 1 },
    SG: { baseDiameter: 240, accSlope: 2.18 },
    MG: { baseDiameter: 10, accSlope: 0 },
    SR: { baseDiameter: 10, accSlope: 0 },
    RL: { baseDiameter: 10, accSlope: 0 },
  },
};

const shape = (over: Partial<BossShape> = {}): BossShape => ({
  id: 's1', kind: 'circle', x: 100, y: 100, w: 80, h: 80, rotation: 0, color: '#fff', ...over,
});
const part = (over: Partial<BossPart> = {}): BossPart => ({
  ...shape(), name: '파츠', hp: 1_000_000, ...over,
});

describe('보스 메이커', () => {
  it('빈 판은 아무것도 없는 상태로 시작한다', () => {
    const design = emptyDesign();
    expect(design.shapes).toEqual([]);
    expect(design.core).toBeNull();
    // 코어도 중앙도 없으면 겨냥할 자리가 없다 — 화면이 「중앙을 찍어 주세요」라고 말한다.
    expect(aimPoint(design)).toBeNull();
  });

  it('코어가 먼저고, 없으면 보스 중앙을 겨냥한다', () => {
    const design = emptyDesign();
    design.center = { x: 50, y: 60 };
    expect(aimPoint(design)).toEqual({ x: 50, y: 60, on: 'center' });
    design.core = { x: 120, y: 140, d: 52 };
    expect(aimPoint(design)).toEqual({ x: 120, y: 140, on: 'core' });
  });

  it('도형 안을 눌렀는지 가려낸다', () => {
    const circle = shape();
    expect(hitTest(circle, 100, 100)).toBe(true);
    expect(hitTest(circle, 100, 139)).toBe(true);
    expect(hitTest(circle, 100, 145)).toBe(false);

    const rect = shape({ kind: 'rect', w: 60, h: 20 });
    expect(hitTest(rect, 128, 108)).toBe(true);
    expect(hitTest(rect, 132, 100)).toBe(false);

    // 삼각형은 위로 갈수록 좁아진다 — 꼭짓점 옆은 바깥이다.
    const tri = shape({ kind: 'triangle', w: 80, h: 80 });
    expect(hitTest(tri, 100, 135)).toBe(true);
    expect(hitTest(tri, 130, 70)).toBe(false);
  });

  it('세워 둔 네모도 돌린 채로 판정한다', () => {
    const tilted = shape({ kind: 'rect', w: 100, h: 20, rotation: 90 });
    // 90° 돌렸으니 위아래로 길다.
    expect(hitTest(tilted, 100, 140)).toBe(true);
    expect(hitTest(tilted, 140, 100)).toBe(false);
  });

  it('폭발 원이 덮는 파츠를 센다', () => {
    const parts = [
      part({ id: 'a', x: 100, y: 100, w: 40, h: 40 }),
      part({ id: 'b', x: 200, y: 100, w: 40, h: 40 }),
      part({ id: 'c', x: 400, y: 100, w: 40, h: 40 }),
    ];
    // 두 파츠 한가운데서 터지면 반경 30이면 둘 다 닿는다(외접원 20씩).
    expect(partsInBlast(parts, { x: 150, y: 100 }, 30).map((p) => p.id)).toEqual(['a', 'b']);
    expect(partsInBlast(parts, { x: 150, y: 100 }, 10).map((p) => p.id)).toEqual([]);
    expect(partsInBlast(parts, { x: 150, y: 100 }, 0)).toEqual([]);
    expect(distance(parts[0]!, parts[1]!)).toBe(100);
    expect(outerRadius(parts[0]!)).toBe(20);
  });

  it('탄착군과 코어 명중률이 계산기 본체와 같은 식이다', () => {
    // D = 76 − 0.69 × 20 = 62.2 → 반지름 31.1
    expect(spreadRadius(table, 'AR', 20)).toBeCloseTo(31.1, 5);
    // 명중률이 아무리 높아도 지름은 1px 아래로 내려가지 않는다.
    expect(spreadRadius(table, 'SG', 500)).toBe(0.5);
    // MG·SR·RL은 명중률과 무관하게 10px이라 52px 코어를 늘 덮는다.
    expect(coreHitChance(table, 'MG', 52)).toBe(1);
    // SMG(110px)로 52px 코어 → (26/55)^2.55
    expect(coreHitChance(table, 'SMG', 52)).toBeCloseTo((26 / 55) ** 2.55, 6);
    // 코어가 없으면 확률도 없다.
    expect(coreHitChance(table, 'AR', 0)).toBe(0);
    // 표를 못 받은 옛 설정에서도 답은 나온다(10px 가정).
    expect(spreadRadius(undefined, 'AR')).toBe(5);
  });

  it('조준 키프레임 사이를 곧게 이어 따라간다', () => {
    const design = emptyDesign();
    design.center = { x: 0, y: 0 };
    // 키가 없으면 코어(없으면 중앙)를 계속 겨냥한다.
    expect(aimAt(design, 30)).toEqual({ x: 0, y: 0, on: 'center' });

    design.aimKeys = [{ t: 10, x: 100, y: 100 }, { t: 20, x: 300, y: 200 }];
    // 첫 키 앞과 마지막 키 뒤에서는 가만히 있는다 — 손으로 겨냥하는 모습에 가깝다.
    expect(aimAt(design, 0)).toEqual({ x: 100, y: 100 });
    expect(aimAt(design, 99)).toEqual({ x: 300, y: 200 });
    // 사이는 곧게 잇는다.
    expect(aimAt(design, 15)).toEqual({ x: 200, y: 150 });
  });

  it('풀버스트가 아니면 3번 칸만 겨냥한 자리를 때린다', () => {
    // 손은 하나뿐이다 — 플레이어가 잡은 니케만 조준을 따라가고 나머지는 자동 사격이다.
    const design = emptyDesign();
    design.center = { x: 50, y: 50 };
    design.aimKeys = [{ t: 0, x: 400, y: 300 }];

    expect(aimForNikke(design, 10, PLAYER_SLOT, false)).toEqual({ x: 400, y: 300 });
    expect(aimForNikke(design, 10, 0, false)).toEqual({ x: 50, y: 50 });
    expect(aimForNikke(design, 10, 4, false)).toEqual({ x: 50, y: 50 });
    // 풀버스트에 들어가면 다 같이 겨냥한 곳으로 몰린다.
    expect(aimForNikke(design, 10, 0, true)).toEqual({ x: 400, y: 300 });

    // 중앙을 안 찍어 두었으면 없는 점을 만들지 않고 겨냥한 자리를 쓴다.
    const noCenter = emptyDesign();
    noCenter.aimKeys = [{ t: 0, x: 7, y: 8 }];
    expect(aimForNikke(noCenter, 3, 0, false)).toEqual({ x: 7, y: 8 });
  });

  it('풀버스트 구간은 반개구간이다', () => {
    const windows: Array<[number, number]> = [[10, 20]];
    expect(inFullBurst(windows, 9.9)).toBe(false);
    expect(inFullBurst(windows, 10)).toBe(true);
    expect(inFullBurst(windows, 20)).toBe(false);
  });

  it('관통은 몸통과 파츠를 따로 세고, 파츠가 여럿이면 그만큼 늘어난다', () => {
    const design = emptyDesign();
    design.shapes.push(shape({ id: 'body', x: 100, y: 100, w: 300, h: 300 }));
    // 파츠 둘이 몸통 위에 겹쳐 있다.
    design.parts.push(part({ id: 'p1', x: 100, y: 100, w: 60, h: 60 }));
    design.parts.push(part({ id: 'p2', x: 100, y: 100, w: 40, h: 40 }));

    expect(pierceTargets(design, { x: 100, y: 100 })).toEqual({ shapes: 1, parts: 2, total: 3 });
    // 파츠를 비껴 몸통만 지나면 하나다.
    expect(pierceTargets(design, { x: 200, y: 100 })).toEqual({ shapes: 1, parts: 0, total: 1 });
    // 아무것도 없는 자리는 0이다.
    expect(pierceTargets(design, { x: 900, y: 900 })).toEqual({ shapes: 0, parts: 0, total: 0 });
    // 그 시각에 안 보이는 도형은 세지 않는다.
    design.parts[1]!.windows = [[60, 999]];
    expect(pierceTargets(design, { x: 100, y: 100 }, 0).total).toBe(2);
    expect(pierceTargets(design, { x: 100, y: 100 }, 60).total).toBe(3);
  });

  it('니케별 탄착군 지름을 손으로 덮는다', () => {
    // 표는 기본값이다 — 「이 니케는 실제로 이만큼 흩어지더라」를 적을 자리를 둔다.
    expect(spreadRadius(table, 'SMG', 0)).toBe(55);
    expect(spreadRadius(table, 'SMG', 0, 200)).toBe(100);
    // 0이나 음수는 덮은 것으로 치지 않는다.
    expect(spreadRadius(table, 'SMG', 0, 0)).toBe(55);
  });

  it('탄착점이 엔진의 코어 명중률과 같은 분포로 박힌다', () => {
    // 계산기는 P(코어 명중) = (코어반경/탄착군반경)^n으로 본다. 점을 뿌려 세었을 때
    // 그 비율이 안 나오면 화면과 계산이 서로 다른 말을 하는 것이다.
    const radius = 55;      // SMG 탄착군 지름 110px
    const core = 26;        // 코어 지름 52px
    const points = impactOffsets('리타:0', 20_000, radius, 2.55);
    expect(points).toHaveLength(20_000);

    const inside = points.filter((p) => Math.hypot(p.x, p.y) <= core).length / points.length;
    expect(inside).toBeCloseTo((core / radius) ** 2.55, 2);
    // 탄착군 밖으로는 한 발도 안 나간다.
    expect(points.every((p) => Math.hypot(p.x, p.y) <= radius + 1e-9)).toBe(true);
  });

  it('같은 사격은 다시 그려도 같은 자리에 박힌다', () => {
    // 프레임마다 새로 뽑으면 재생할 때 점들이 부글거린다.
    expect(impactOffsets('리타:12', 8, 30)).toEqual(impactOffsets('리타:12', 8, 30));
    expect(impactOffsets('리타:12', 8, 30)).not.toEqual(impactOffsets('리타:13', 8, 30));
    // 쏘지 않았거나 탄착군이 없으면 찍을 것도 없다.
    expect(impactOffsets('리타:0', 0, 30)).toEqual([]);
    expect(impactOffsets('리타:0', 5, 0)).toEqual([]);
  });

  it('파츠 체력을 파괴 시각으로 바꾼다', () => {
    expect(breakTime(1000, 500)).toBe(2);
    expect(breakTime(0, 500)).toBeNull();
    expect(breakTime(1000, 0)).toBeNull();

    const parts = [
      part({ id: 'a', name: '왼팔', hp: 3000 }),
      part({ id: 'b', name: '오른팔', hp: 1000 }),
      part({ id: 'c', name: '등껍질', hp: 999_999 }),
    ];
    const breaks = partBreaks(parts, 500, 20);
    expect(breaks.map((entry) => entry.name)).toEqual(['오른팔', '왼팔', '등껍질']);
    expect(breaks[0]!.at).toBe(2);
    // 전투가 끝나도록 못 깨는 파츠는 시각이 없다.
    expect(breaks[2]!.at).toBeNull();
    // 엔진에는 주기 하나만 넘긴다 — 가장 먼저 깨지는 시각이다.
    expect(derivedPartBreakInterval(parts, 500, 20)).toBe(2);
    expect(derivedPartBreakInterval([], 500, 20)).toBe(0);
  });

  it('파츠를 깨면 점수가 붙고, 깬 시각부터 쌓인다', () => {
    // 시뮬이 때려서 낸 값이 아니라 «깨면 준다»는 규칙이라 총딜과 출처가 다르다.
    const parts = [
      part({ id: 'a', name: '왼팔', hp: 1000, score: 5_000_000 }),
      part({ id: 'b', name: '오른팔', hp: 3000, score: 7_000_000 }),
      part({ id: 'c', name: '등껍질', hp: 999_999 }),
    ];
    const breaks = partBreaks(parts, 500, 20);
    expect(breaks.map((entry) => [entry.name, entry.at, entry.score]))
      .toEqual([['왼팔', 2, 5_000_000], ['오른팔', 6, 7_000_000], ['등껍질', null, 0]]);

    expect(scoreUntil(breaks, 0)).toBe(0);
    expect(scoreUntil(breaks, 2)).toBe(5_000_000);
    expect(scoreUntil(breaks, 5.9)).toBe(5_000_000);
    expect(scoreUntil(breaks, 6)).toBe(12_000_000);
    // 전투 안에 못 깨는 파츠의 점수는 영영 안 붙는다.
    expect(scoreUntil(breaks, 999)).toBe(12_000_000);
  });

  it('겨냥하지 않은 파츠에는 탄이 들지 않는다', () => {
    const target = part({ id: 'p', x: 100, y: 100, w: 60, h: 60 });
    // 조준점이 파츠 한가운데면 탄착군이 작을수록 거의 다 든다.
    expect(partHitFraction(target, { x: 100, y: 100 }, 10)).toBe(1);
    // 멀찍이 겨냥하면 한 발도 안 든다 — 탄착군이 닿지도 않는다.
    expect(partHitFraction(target, { x: 400, y: 100 }, 55)).toBe(0);
    // 걸치면 그 사이 값이다.
    const edge = partHitFraction(target, { x: 130, y: 100 }, 55);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
  });

  it('파괴 시각은 겨냥한 자리로 정해진다', () => {
    // 「스쿼드 총딜 ÷ 체력」으로만 세면 어디를 겨냥하든 시작하자마자 터진다.
    const near = part({ id: 'near', x: 100, y: 100, w: 60, h: 60, hp: 1000 });
    const far = part({ id: 'far', x: 900, y: 100, w: 60, h: 60, hp: 1000 });
    const damage = { 리타: new Array(100).fill(200) };

    const breaks = aimedPartBreaks({
      parts: [near, far],
      bucket: 0.1,
      buckets: 100,
      normalDamage: damage,
      aimOf: () => ({ x: 100, y: 100 }),
      spreadOf: () => 10,
    });
    const at = (id: string) => breaks.find((entry) => entry.id === id)!.at;
    // 겨냥한 파츠는 깨지고,
    expect(at('near')).not.toBeNull();
    expect(at('near')).toBeLessThan(1);
    // 멀리 있는 파츠는 영영 안 깨진다.
    expect(at('far')).toBeNull();
  });

  it('사라진 구간에는 파츠가 맞지 않는다', () => {
    const blink = part({ id: 'blink', x: 100, y: 100, w: 60, h: 60, hp: 1000,
      windows: [[5, 10]] });
    const breaks = aimedPartBreaks({
      parts: [blink],
      bucket: 0.1,
      buckets: 100,
      normalDamage: { 리타: new Array(100).fill(200) },
      aimOf: () => ({ x: 100, y: 100 }),
      spreadOf: () => 10,
    });
    // 5초 전에는 없는 파츠라 맞지 않는다 — 나타난 뒤에야 깎인다.
    expect(breaks[0]!.at).toBeGreaterThanOrEqual(5);
  });

  it('그림에서 엔진이 아는 숫자만 뽑는다', () => {
    const design = emptyDesign();
    design.core = { x: 10, y: 10, d: 52.4 };
    design.parts = [part({ hp: 2000 })];
    expect(derivedEnemy(design, 1000, 60)).toEqual({
      corePx: 52, hasParts: true, partBreakInterval: 2,
    });
    // 코어를 안 찍으면 코어 없는 보스다.
    expect(derivedEnemy(emptyDesign(), 1000, 60))
      .toEqual({ corePx: 0, hasParts: false, partBreakInterval: 0 });
  });

  it('시간에 따라 보스 상태가 바뀐다', () => {
    const immune = [{ from: 10, to: 20 }];
    const element = [{ from: 30, to: 40, code: '풍압' as const }];
    expect(phaseAt(5, immune, element)).toEqual({ immune: false, shield: null });
    expect(phaseAt(10, immune, element)).toEqual({ immune: true, shield: null });
    // 끝 시각은 구간 밖이다 — 엔진과 같은 반개구간이다.
    expect(phaseAt(20, immune, element)).toEqual({ immune: false, shield: null });
    expect(phaseAt(35, immune, element)).toEqual({ immune: false, shield: '풍압' });
  });

  it('구간을 적어 둔 도형은 그때만 보인다', () => {
    const items = [shape({ id: 'always' }), shape({ id: '2단계', windows: [[60, 120]] })];
    expect(visibleAt(items, 10).map((s) => s.id)).toEqual(['always']);
    expect(visibleAt(items, 60).map((s) => s.id)).toEqual(['always', '2단계']);
    // 끝 시각은 구간 밖이다 — 다른 구간과 같은 반개구간이다.
    expect(visibleAt(items, 120).map((s) => s.id)).toEqual(['always']);
  });

  it('저장본을 여러 벌 두고 오간다', () => {
    const library = emptyLibrary();
    expect(library.designs).toHaveLength(1);
    expect(activeDesign(library).id).toBe(library.activeId);

    const second = emptyDesign('2페이즈');
    const two = putDesign(library, second);
    expect(two.designs).toHaveLength(2);
    // 넣은 것을 곧바로 펴 준다 — 만들자마자 그리려는 것이기 때문이다.
    expect(activeDesign(two).name).toBe('2페이즈');

    // 같은 id로 다시 넣으면 덮어쓴다(뒤에 또 붙지 않는다).
    const edited = { ...second, name: '2페이즈 고침' };
    const still = putDesign(two, edited);
    expect(still.designs).toHaveLength(2);
    expect(activeDesign(still).name).toBe('2페이즈 고침');
  });

  it('베끼면 이름에 사본을 붙이고, 마지막 하나는 지워도 빈 판이 남는다', () => {
    const first = emptyDesign('1페이즈');
    first.parts.push(part({ name: '왼팔' }));
    const library = putDesign(emptyLibrary(), first);

    const copied = copyDesign(library, first.id);
    expect(copied.designs).toHaveLength(3);
    expect(activeDesign(copied).name).toBe('1페이즈 사본');
    // 베낀 것은 원본과 남남이다 — 한쪽을 고쳐도 다른 쪽이 안 따라간다.
    expect(activeDesign(copied).parts[0]!.name).toBe('왼팔');
    expect(activeDesign(copied).id).not.toBe(first.id);

    let left = dropDesign(copied, copied.designs[0]!.id);
    left = dropDesign(left, left.designs[0]!.id);
    left = dropDesign(left, left.designs[0]!.id);
    expect(left.designs).toHaveLength(1);
    expect(left.designs[0]!.shapes).toEqual([]);
  });

  it('보스 하나만 두던 옛 저장본도 저장함으로 받아 준다', () => {
    // 그려 둔 것이 사라지면 안 된다 — 한 벌짜리 저장함으로 감싼다.
    const old = JSON.stringify({ ...emptyDesign('옛 보스'), id: undefined });
    const library = parseLibrary(old)!;
    expect(library.designs).toHaveLength(1);
    expect(library.designs[0]!.name).toBe('옛 보스');
    expect(library.activeId).toBe(library.designs[0]!.id);

    expect(parseLibrary(null)).toBeNull();
    expect(parseLibrary('{{')).toBeNull();
    expect(parseLibrary('{"designs":[]}')).toBeNull();
  });

  it('도형별 적정거리는 겨냥한 도형의 것이 걸리고, 겹치면 합집합이다', () => {
    const design = emptyDesign();
    // 어느 도형에도 안 걸어 두면 전투 조건을 건드리지 않는다(null).
    expect(derivedOptimalRange(design)).toBeNull();

    design.center = { x: 100, y: 100 };
    design.shapes.push(shape({ id: 'a', x: 100, y: 100, w: 200, h: 200, range: ['SG'] }));
    design.shapes.push(shape({ id: 'b', x: 100, y: 100, w: 120, h: 120, range: ['SG', 'MG'] }));
    design.shapes.push(shape({ id: 'far', x: 900, y: 900, w: 80, h: 80, range: ['RL'] }));
    // 겹친 둘을 겨냥하면 합집합이다 — 보너스가 두 번 붙지 않는다(관통이라도 같다).
    expect(derivedOptimalRange(design)).toEqual(['MG', 'SG']);

    // 겨냥한 자리에 걸린 도형이 없으면 적정거리도 없다.
    design.center = { x: 500, y: 500 };
    expect(derivedOptimalRange(design)).toEqual([]);
  });

  it('적정거리 색은 여럿이면 섞인다', () => {
    expect(mixRangeColor(['SG'])).toBe('#ffd166');
    expect(mixRangeColor([])).toBeNull();
    expect(mixRangeColor(undefined)).toBeNull();
    // 두 색의 평균 — 「둘 다 걸린 자리」가 한눈에 갈린다.
    // SG(255,209,102) + MG(255,143,107) → (255,176,105)
    expect(mixRangeColor(['SG', 'MG'])).toBe('#ffb069');
  });

  it('보스를 코드 한 줄로 주고받는다', () => {
    const design = emptyDesign('그레이브디거');
    design.shapes.push(shape({ kind: 'triangle', x: 300, y: 200, w: 120, h: 90, rotation: 30 }));
    design.shapes.push(shape({ id: 's2', kind: 'rect', windows: [[60, 120]], range: ['SG', 'MG'] }));
    design.parts.push(part({ name: '왼팔', x: 500, y: 300, hp: 1_200_000, score: 9_000_000 }));
    design.core = { x: 480, y: 260, d: 64 };
    design.center = { x: 480, y: 320 };
    design.explosion['리타'] = 90;
    design.spread = { 리타: 180 };
    design.aimKeys = [{ t: 0, x: 100, y: 120 }, { t: 12.5, x: 400, y: 260 }];

    const code = encodeBossCode(design);
    expect(code.startsWith(BOSS_PREFIX)).toBe(true);
    const back = decodeBossCode(code, ['리타', '크라운']);

    expect(back.name).toBe('그레이브디거');
    expect(back.shapes.map((s) => s.kind)).toEqual(['triangle', 'rect']);
    expect(back.shapes[0]!.rotation).toBe(30);
    expect(back.shapes[1]!.windows).toEqual([[60, 120]]);
    expect(back.shapes[1]!.range).toEqual(['MG', 'SG']);
    expect(back.parts[0]).toMatchObject({
      name: '왼팔', hp: 1_200_000, x: 500, y: 300, score: 9_000_000,
    });
    expect(back.core).toEqual({ x: 480, y: 260, d: 64 });
    expect(back.center).toEqual({ x: 480, y: 320 });
    // 폭발 반경은 이름 해시로 실어 보내고, 받는 쪽 목록에서 이름을 되찾는다.
    expect(back.explosion).toEqual({ 리타: 90 });
    expect(back.spread).toEqual({ 리타: 180 });
    expect(back.aimKeys).toEqual([{ t: 0, x: 100, y: 120 }, { t: 12.5, x: 400, y: 260 }]);
    // 받은 것은 남의 저장본이 아니라 내 새 저장본이다.
    expect(back.id).not.toBe(design.id);
  });

  it('밑그림은 코드에 담기지 않는다', () => {
    // 데이터 URL이라 그림 하나로 코드가 수십 KB가 된다 — 붙여넣는 자리에서 잘린다.
    const design = emptyDesign('밑그림 있음');
    design.image = { src: `data:image/png;base64,${'A'.repeat(5000)}`, x: 0, y: 0, w: 960, h: 620, opacity: 0.5 };
    const code = encodeBossCode(design);
    expect(code.length).toBeLessThan(200);
    expect(decodeBossCode(code).image).toBeNull();
  });

  it('남이 만든 코드가 화면을 깨뜨리지 않는다', () => {
    expect(() => decodeBossCode('')).toThrow('보스 코드를 입력해 주세요');
    expect(() => decodeBossCode('NK3-abc')).toThrow('«NK5-»로 시작');
    expect(() => decodeBossCode('NK5-!!!!')).toThrow('읽지 못했습니다');

    // 말이 안 되는 값은 조용히 잘라 낸다.
    const wild = `${BOSS_PREFIX}${btoa(JSON.stringify({
      n: 'x'.repeat(200),
      s: [{ k: 99, x: 1e9, y: -1e9, w: -5, h: 0 }, { k: 0, x: 10, y: 10, w: 40, h: 40, r: 9999 }],
      p: new Array(100).fill({ k: 1, x: 0, y: 0, w: 10, h: 10, hp: -3 }),
      k: [0, 0, 99_999],
    })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    const back = decodeBossCode(wild);
    expect(back.name).toHaveLength(24);
    // 크기가 0인 도형은 버리고, 말도 안 되는 기울기는 -180~180으로 자른다.
    expect(back.shapes).toHaveLength(1);
    expect(back.shapes[0]!.rotation).toBe(180);
    expect(back.parts.length).toBeLessThanOrEqual(24);
    expect(back.parts[0]!.hp).toBe(0);
    // 400px를 넘는 코어는 안 받는다.
    expect(back.core).toBeNull();
  });

  it('보이는 구간을 여럿 둔다', () => {
    // 깨졌다 되살아나기를 반복하는 파츠가 흔하다 — 한 쌍으로는 못 적는다.
    const twice = shape({ id: 'blink', windows: [[0, 20], [60, 90]] });
    expect(visibleAt([twice], 10)).toHaveLength(1);
    expect(visibleAt([twice], 30)).toHaveLength(0);
    expect(visibleAt([twice], 70)).toHaveLength(1);
    expect(visibleAt([twice], 95)).toHaveLength(0);

    // 다듬기 — 뒤집힌 구간은 버리고 시각순으로 세운다. 겹치는 것은 말없이 뭉개지 않는다.
    expect(tidyWindows([[60, 90], [0, 20], [50, 40], [10, 30]]))
      .toEqual([[0, 20], [10, 30], [60, 90]]);
  });

  it('코드도 구간을 여럿 싣고, 옛 한 쌍은 목록으로 옮긴다', () => {
    const design = emptyDesign('깜빡이');
    design.shapes.push(shape({ windows: [[0, 20], [60, 90]] }));
    const back = decodeBossCode(encodeBossCode(design));
    expect(back.shapes[0]!.windows).toEqual([[0, 20], [60, 90]]);

    // 옛 코드(`f`/`t` 한 쌍)도 그대로 읽어 목록으로 만든다.
    const legacy = `${BOSS_PREFIX}${btoa(unescape(encodeURIComponent(JSON.stringify({
      n: '옛 보스', s: [{ k: 0, x: 10, y: 10, w: 40, h: 40, f: 600, t: 1200 }],
    })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    expect(decodeBossCode(legacy).shapes[0]!.windows).toEqual([[60, 120]]);
  });

  it('옛 저장본의 나타남·사라짐도 구간 목록으로 옮긴다', () => {
    const old = JSON.stringify({
      ...emptyDesign('옛 보스'),
      shapes: [{ ...shape(), from: 30, to: 90 }],
    });
    const library = parseLibrary(old)!;
    const revived = library.designs[0]!.shapes[0]!;
    expect(revived.windows).toEqual([[30, 90]]);
    // 옛 칸은 남기지 않는다 — 두 표현이 함께 있으면 어느 쪽이 진짜인지 알 수 없다.
    expect('from' in revived).toBe(false);
    expect('to' in revived).toBe(false);
  });

  it('저장본이 깨져 있으면 화면을 끌고 가지 않는다', () => {
    expect(parseDesign(null)).toBeNull();
    expect(parseDesign('{{')).toBeNull();
    expect(parseDesign('{"version":2,"shapes":[]}')).toBeNull();
    const saved = parseDesign('{"version":1,"name":"1페이즈","shapes":[]}');
    expect(saved?.name).toBe('1페이즈');
    // id가 없던 시절의 저장본에는 새로 붙여 준다 — 저장함이 그것으로 판을 가른다.
    expect(saved?.id).toMatch(/^boss_/);
    // 빠진 칸은 빈 판의 값으로 채운다 — 옛 저장본에도 새 칸이 생긴다.
    expect(saved?.parts).toEqual([]);
    expect(saved?.canvas).toEqual({ w: 960, h: 620 });
  });
});

describe('크기 손잡이', () => {
  const box = { x: 100, y: 100, w: 40, h: 20 };

  it('잡은 쪽만 움직이고 반대편은 제자리에 선다', () => {
    // 오른쪽 변을 x=160까지 끈다. 왼쪽 변(x=80)은 그대로여야 한다.
    const next = resizeBox(box, 'e', { x: 160, y: 100 });
    expect(next.w).toBe(80);
    expect(next.h).toBe(20);                 // 세로는 안 건드린다
    expect(next.x - next.w / 2).toBeCloseTo(80, 6);
    expect(next.y).toBe(100);
  });

  it('모서리를 잡으면 두 축이 함께 간다', () => {
    const next = resizeBox(box, 'se', { x: 140, y: 130 });
    expect(next.w).toBeCloseTo(60, 6);       // 왼쪽 80 → 140
    expect(next.h).toBeCloseTo(40, 6);       // 위 90 → 130
    expect(next.x - next.w / 2).toBeCloseTo(80, 6);
    expect(next.y - next.h / 2).toBeCloseTo(90, 6);
  });

  it('북서쪽을 잡으면 남동쪽이 제자리다', () => {
    const next = resizeBox(box, 'nw', { x: 60, y: 80 });
    expect(next.x + next.w / 2).toBeCloseTo(120, 6);
    expect(next.y + next.h / 2).toBeCloseTo(110, 6);
  });

  it('Alt를 누르면 중심 대칭으로 커진다', () => {
    const next = resizeBox(box, 'e', { x: 160, y: 100 }, { symmetric: true });
    expect(next.x).toBe(100);                // 중심은 안 움직인다
    expect(next.w).toBe(120);                // 중심에서 60px씩 양쪽
  });

  it('아무리 줄여도 잡을 만큼은 남는다', () => {
    const next = resizeBox(box, 'e', { x: 80, y: 100 });
    expect(next.w).toBe(MIN_SIZE);
    // 왼쪽 변은 여전히 제자리다 — 최소 크기에 걸려도 반대편이 밀리면 안 된다.
    expect(next.x - next.w / 2).toBeCloseTo(80, 6);
  });

  it('기울어진 도형은 제 축에서 잰다', () => {
    // 90° 돌아간 상자의 «오른쪽»은 화면에서 아래다.
    const turned = { x: 100, y: 100, w: 40, h: 20, rotation: 90 };
    const next = resizeBox(turned, 'e', { x: 100, y: 160 });
    expect(next.w).toBeCloseTo(80, 6);
    expect(next.h).toBeCloseTo(20, 6);
    // 반대편 변(화면에서 위, y=80)은 그대로 선다.
    expect(next.y - next.w / 2).toBeCloseTo(80, 6);
  });
});
