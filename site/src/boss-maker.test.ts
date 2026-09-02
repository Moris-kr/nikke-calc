import { describe, expect, it } from 'vitest';

import {
  aimPoint, breakTime, coreHitChance, derivedEnemy, derivedPartBreakInterval, distance,
  emptyDesign, hitTest, outerRadius, parseDesign, partBreaks, partsInBlast, phaseAt,
  spreadRadius, visibleAt, type AccuracyTable, type BossPart, type BossShape,
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
    const items = [shape({ id: 'always' }), shape({ id: '2단계', from: 60 })];
    expect(visibleAt(items, 10).map((s) => s.id)).toEqual(['always']);
    expect(visibleAt(items, 60).map((s) => s.id)).toEqual(['always', '2단계']);
  });

  it('저장본이 깨져 있으면 화면을 끌고 가지 않는다', () => {
    expect(parseDesign(null)).toBeNull();
    expect(parseDesign('{{')).toBeNull();
    expect(parseDesign('{"version":2,"shapes":[]}')).toBeNull();
    const saved = parseDesign('{"version":1,"name":"1페이즈","shapes":[]}');
    expect(saved?.name).toBe('1페이즈');
    // 빠진 칸은 빈 판의 값으로 채운다 — 옛 저장본에도 새 칸이 생긴다.
    expect(saved?.parts).toEqual([]);
    expect(saved?.canvas).toEqual({ w: 960, h: 620 });
  });
});
