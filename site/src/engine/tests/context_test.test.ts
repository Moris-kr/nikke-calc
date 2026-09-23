/**
 * context/test.py 이식 — 단일 캐릭터 디버그 및 스쿼드 동작 수동 확인용.
 * snapshot.py(baseline 자동 비교)와 달리 탐색·검증 목적이다. 파이썬 쪽은 단언 없이 출력만 하는 셀 스크립트라,
 * 여기서는 각 셀이 예외 없이 돌고(셀 3은 버스트가 DEBUG_BURST_IDX번째까지 있어야 인덱스가 선다) 출력이 비지 않는지만 본다.
 * 출력은 `DEBUG_CONTEXT_TEST=1`일 때만 콘솔에 찍는다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '../timeline';
import { loadEngineData } from './helpers';

beforeAll(loadEngineData);

const print = (...args: unknown[]): void => {
  if (process.env.DEBUG_CONTEXT_TEST === '1') console.log(...args);
};

function make_char(name: string, overrides: Record<string, any> = {}): Record<string, any> {
  const char: Record<string, any> = {
    name: name,
    level: 400, breakthrough: 3, core_enhancement: 0,
    affinity: 30, skill_levels: { '1': 10, '2': 10, '3': 10 },
    burst_regen_time: 2.0,
    equipment: Object.fromEntries(['머리', '몸통', '팔', '다리'].map((p) => [p, { level: 5, skills: [] }])),
    // 기본 스펙(context/spec.py DEFAULT_CHAR)과 같은 값 — 오버로드 레벨 10의 2줄·2줄
    equip_skills: { atk_pct: 22.22, max_ammo_pct: 129.64 },
    cube: { name: '렐릭 베어 큐브', level: 15 },
    console: { common_level: 180, class_level: 100, company_level: 100 },
    collection_stage: 'SR15',
  };
  Object.assign(char, overrides);
  return char;
}

describe('context/test.py (수동 확인 셀)', () => {
  it('셀 1~4: 스쿼드 설정 → 버스트 사이클 → 구간 상세 디버그 → 버프 스냅샷 요약', () => {
    // ── 셀 1: 스쿼드 설정 ─────────────────────────────────────────────────────────
    // 스쿼드 구성 템플릿 및 버스트 간격 확인 절차 → context/GAMEPLAY.md §표준 테스트 스쿼드 참고
    const TARGET = '미란다';
    const squad = ['프리바티', '스노우 화이트 : 헤비암즈', '미란다', '리틀 머메이드', '나유타'].map((n) => make_char(n));
    const r = simulate(squad, { no_burst_char: '리틀 머메이드' }, null, true);
    const summary = r.summary();
    expect(summary.length).toBeGreaterThan(0);
    print(summary);

    // ── 셀 2: 버스트 사이클 확인 ───────────────────────────────────────────────────
    // (파이썬 3.12 출력: 풀버스트 횟수 29, 처음 5회 간격 10.00s·2.53s·10.00s·2.53s·10.00s)
    const burst_times = r.log!.burst_log.filter((e) => e.event.includes('full_burst')).map((e) => e.t);
    print(`풀버스트 횟수: ${burst_times.length}`);
    if (burst_times.length > 1) {
      const gaps = [];
      for (let i = 0; i < Math.min(5, burst_times.length - 1); i += 1) gaps.push(`${(burst_times[i + 1]! - burst_times[i]!).toFixed(2)}s`);
      print(`사이클 간격 (처음 5회): ${gaps.join(', ')}`);
    }

    // ── 셀 3: 특정 구간 상세 디버그 ───────────────────────────────────────────────
    const DEBUG_BURST_IDX = 4; // 몇 번째 버스트 구간을 볼지
    const DEBUG_WINDOW = 2.0;  // 구간 길이(초)
    // 파이썬은 burst_times[DEBUG_BURST_IDX]가 없으면 IndexError로 죽는다.
    expect(burst_times.length).toBeGreaterThan(DEBUG_BURST_IDX);
    const t0 = burst_times[DEBUG_BURST_IDX]!;
    const t1 = t0 + DEBUG_WINDOW;
    print(`검토 구간: ${t0.toFixed(3)}~${t1.toFixed(3)}s`);
    simulate(squad, { _debug_char: TARGET, _debug_t0: t0, _debug_t1: t1 });

    // ── 셀 4: 버프 스냅샷 요약 ────────────────────────────────────────────────────
    const buffs = r.log!.buff_summary([TARGET]);
    expect(typeof buffs).toBe('string');
    print(buffs);
  }, 60_000);
});
