/**
 * 편성 자리를 바꿔도 결과가 같아야 한다(2026-09-23 제보). 파이썬 쪽은 calculator/test_slot_invariance.py.
 * 자리가 의미 있는 것: 카메라 = 3번 자리, 같은 단계 버스트 우선순위(앞자리 먼저), 후열·양옆 아군 스킬.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ENGINE_DATA_FILES, setEngineData } from './data';
import { run_request } from './bridge';

const ROOT = resolve(__dirname, '..', '..', '..');

describe('편성 자리와 무관한 결과', () => {
  it('3번 자리와 같은 단계 버스트의 앞뒤만 지키면 자리를 바꿔도 총딜·캐릭터별 딜이 같다', () => {
    setEngineData(Object.fromEntries(Object.keys(ENGINE_DATA_FILES)
      .map((p) => [p, JSON.parse(readFileSync(join(ROOT, p), 'utf-8'))])));
    const [M, P, S, C, L] = ['미란다', '프리바티', '스노우 화이트 : 헤비암즈', '크라운', '리틀 머메이드'];
    // 3번 자리(카메라)와 같은 단계 버스트의 앞뒤만 지키는 자리 바꿈
    const orders = [[M, P, S, C, L], [P, M, S, L, C], [M, P, S, L, C], [P, C, S, M, L]];
    const results = orders.map((squad) => JSON.parse(run_request(JSON.stringify({
      squad, duration: 60, enemyDef: 31784, enemyCode: '작열', corePx: 11, hasParts: false, seed: 42, rngMode: 'expected',
    }))));
    for (const [i, r] of results.entries()) {
      expect(r.squadTotal).toBe(results[0]!.squadTotal);
      // 캐릭터별 딜은 요청한 자리 순서로 나온다
      expect(Object.keys(r.charTotals)).toEqual(orders[i]);
      for (const name of orders[0]!) expect(r.charTotals[name]).toBe(results[0]!.charTotals[name]);
    }
  }, 60_000);
});
