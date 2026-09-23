// py: calculator/test_slot_invariance.py
/*
 * 편성 자리를 바꿔도 결과가 같아야 한다(2026-09-23 제보: 같은 5명인데 자리만 바꾸면 딜이 달라짐).
 *
 * 숨은 원인이던 한 프레임 안의 처리 순서·동률 정리는 이름순으로 바꿨다. 자리가 의미 있는 것은 게임과 같은
 * 것만 남긴다: 카메라 = 3번 자리(사이트가 표시한다, 2026-09-23 사용자 결정), 같은 단계 버스트 우선순위(앞자리
 * 먼저), 후열 조건·양옆 아군 스킬.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { _resolve_cameras, simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { loadEngineData } from './helpers';

const [M, P, S, C, L] = ['미란다', '프리바티', '스노우 화이트 : 헤비암즈', '크라운', '리틀 머메이드'] as const;

function _run(members: string[]): [number, Record<string, number>] {
  const squad = build_squad(members);
  const cfg = build_config(squad, { duration: 90, rng_mode: 'expected', burst_gauge_mode: 'accumulate' });
  const res = simulate(squad, cfg, { def: 31784, code: '작열', core_px: 11 });
  const sortedTotals = Object.fromEntries(Object.entries(res.char_total).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return [res.squad_total, sortedTotals];
}

beforeAll(loadEngineData);

describe('SlotInvarianceTest', () => {
  it('test_same_result_when_slot3_and_burst_priority_unchanged', () => {
    // 3번 자리(카메라)와 같은 단계 버스트의 앞뒤(미란다→머메이드, 프리바티→스노우)만 지키면 나머지 자리는 무관하다
    const orders = [[M, P, S, C, L], [P, M, S, L, C], [M, P, S, L, C], [P, C, S, M, L]];
    const results = orders.map((o) => _run(o));
    for (const r of results.slice(1)) {
      expect(r).toEqual(results[0]);
    }
  }, 180_000);

  it('test_camera_is_slot_three', () => {
    // 버충 담당·명시 카메라·컨트롤 니케가 없으면 실제 편성 3번 자리가 카메라다(처리 순서는 이름순이어도)
    const squad = [M, C, S, P].sort().map((n) => ({ name: n }));
    expect(_resolve_cameras(squad, { _slot_order: [M, C, S, P] })).toEqual(new Set([S]));
    expect(_resolve_cameras(squad, { _slot_order: [M, C, P, S] })).toEqual(new Set([P]));
    expect(_resolve_cameras(squad.slice(0, 2), { _slot_order: [C, M] })).toEqual(new Set([C]));
  });

  it('test_other_slots_any_permutation', () => {
    // 단계가 다른 니케끼리는 3번 자리만 고정하면 어떤 순서로 두어도 같다
    const base = _run([L, C, S]);
    expect(_run([C, L, S])).toEqual(base);
  }, 120_000);
});
