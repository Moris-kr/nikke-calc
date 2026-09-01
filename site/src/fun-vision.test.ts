import { describe, expect, it } from 'vitest';

import {
  metricValue, packBounds, packCircles, visionRows, visionSize, visionSummary,
} from './fun-vision';
import type { CharacterOverrides } from './types';

const over = (element: number, atk = 0): CharacterOverrides =>
  ({ overload: { element_bonus: element, atk_pct: atk } });
const all = () => true;

describe('오버옵 시각화', () => {
  it('두 기준이 서로 다른 값을 본다', () => {
    const value = over(88.6, 22.22);
    expect(metricValue(value, 'element')).toBe(88.6);
    expect(metricValue(value, 'element_atk')).toBeCloseTo(110.82, 5);
    // 오버로드가 아예 없는 니케도 0으로 답한다 — 빠뜨리면 목록이 통째로 죽는다.
    expect(metricValue(undefined, 'element_atk')).toBe(0);
    expect(metricValue({}, 'element')).toBe(0);
  });

  it('큰 순서로 세우고 1등을 1로 둔 비율을 붙인다', () => {
    const rows = visionRows({
      리타: over(44.3), 크라운: over(88.6), 앨리스: over(66.45),
    }, 'element', all);
    expect(rows.map((row) => row.name)).toEqual(['크라운', '앨리스', '리타']);
    expect(rows[0]!.share).toBe(1);
    expect(rows[2]!.share).toBeCloseTo(0.5, 5);
  });

  it('기준을 바꾸면 순서도 바뀐다', () => {
    const roster = { 리타: over(20, 40), 크라운: over(30, 5) };
    expect(visionRows(roster, 'element', all).map((row) => row.name)).toEqual(['크라운', '리타']);
    expect(visionRows(roster, 'element_atk', all).map((row) => row.name)).toEqual(['리타', '크라운']);
  });

  it('값이 0인 니케는 세우지 않는다', () => {
    // 안 키운 니케까지 세우면 「가진 것 전부」가 되어 정작 볼 것이 묻힌다.
    const rows = visionRows({ 리타: over(10), 크라운: over(0), 앨리스: {} }, 'element', all);
    expect(rows.map((row) => row.name)).toEqual(['리타']);
  });

  it('계산기가 모르는 이름은 뺀다', () => {
    // 옛 프로필에 남은 이름이 목록에 서면 초상화가 빈칸으로 뜬다.
    const rows = visionRows({ 리타: over(10), 사라진니케: over(99) }, 'element',
      (name) => name === '리타');
    expect(rows.map((row) => row.name)).toEqual(['리타']);
  });

  it('같은 값이면 이름 순서로 갈라 매번 같은 자리에 선다', () => {
    const rows = visionRows({ 나가: over(10), 가나: over(10) }, 'element', all);
    expect(rows.map((row) => row.name)).toEqual(['가나', '나가']);
  });

  it('크기는 한 변에 비례하고 바닥이 있다', () => {
    expect(visionSize(1)).toBe(132);
    expect(visionSize(0)).toBe(44);
    expect(visionSize(0.5)).toBe(88);
    // 범위 밖 값이 와도 칸을 벗어나지 않는다.
    expect(visionSize(9)).toBe(132);
    expect(visionSize(-3)).toBe(44);
  });

  it('요약 한 줄에 몇 명·합계·1등을 담는다', () => {
    const rows = visionRows({ 리타: over(44.3), 크라운: over(88.6) }, 'element', all);
    expect(visionSummary(rows, 'element')).toBe('2명 · 우월 코드 합계 132.9% · 1등 크라운 88.6%');
    expect(visionSummary([], 'element')).toBe('');
  });

  it('큰 것이 가운데, 나머지가 그 둘레에 붙는다', () => {
    const rows = visionRows({
      리타: over(100), 크라운: over(80), 앨리스: over(60), 나가: over(40), 네온: over(20),
    }, 'element', all);
    const circles = packCircles(rows);
    expect(circles).toHaveLength(5);
    // 값 순서 그대로 크기가 줄어든다.
    expect(circles.map((c) => c.name)).toEqual(['리타', '크라운', '앨리스', '나가', '네온']);
    for (let i = 1; i < circles.length; i += 1) {
      expect(circles[i]!.r).toBeLessThan(circles[i - 1]!.r);
    }
  });

  it('어느 둘도 겹치지 않는다', () => {
    const roster: Record<string, ReturnType<typeof over>> = {};
    for (let i = 0; i < 24; i += 1) roster[`니케${i}`] = over(100 - i * 3);
    const circles = packCircles(visionRows(roster, 'element', all));
    for (let i = 0; i < circles.length; i += 1) {
      for (let j = i + 1; j < circles.length; j += 1) {
        const a = circles[i]!;
        const b = circles[j]!;
        // 맞닿는 것은 겹침이 아니다 — 부동소수 여유만 준다.
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r - 0.01);
      }
    }
  });

  it('좌표가 상자 안에 들어온다', () => {
    const circles = packCircles(visionRows({
      리타: over(90), 크라운: over(50), 앨리스: over(30),
    }, 'element', all));
    const box = packBounds(circles);
    for (const c of circles) {
      expect(c.x - c.r).toBeGreaterThanOrEqual(-0.01);
      expect(c.y - c.r).toBeGreaterThanOrEqual(-0.01);
      expect(c.x + c.r).toBeLessThanOrEqual(box.width + 0.01);
      expect(c.y + c.r).toBeLessThanOrEqual(box.height + 0.01);
    }
  });

  it('한 명이나 빈 목록에서도 답을 낸다', () => {
    expect(packCircles([])).toEqual([]);
    expect(packBounds([])).toEqual({ width: 1, height: 1 });
    const one = packCircles(visionRows({ 리타: over(10) }, 'element', all));
    expect(one).toHaveLength(1);
    expect(one[0]!.x).toBe(one[0]!.r);
  });

  it('같은 입력이면 같은 배치가 나온다', () => {
    const rows = visionRows({ 리타: over(70), 크라운: over(50), 앨리스: over(30), 나가: over(10) },
      'element', all);
    expect(packCircles(rows)).toEqual(packCircles(rows));
  });
});
