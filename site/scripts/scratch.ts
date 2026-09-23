/**
 * 단일 캐릭터 디버그 및 스쿼드 동작 수동 확인용 (`context/test.py`를 옮긴 것이다).
 * snapshot.ts(baseline 자동 비교)와 달리 탐색·검증 목적 — 아래 상수를 고쳐 가며 돌린다.
 *
 *     cd site && npx tsx scripts/scratch.ts
 *
 * 파일 수정 없이 임의 스쿼드를 돌리려면 → scripts/sim.ts (context/HARNESS.md)
 */
import { round } from '../src/engine/py';
import { simulate } from '../src/engine/timeline';
import { loadEngine } from './lib/engine';

function make_char(name: string, overrides: Record<string, any> = {}): Record<string, any> {
  return {
    name,
    level: 400, breakthrough: 3, core_enhancement: 0,
    affinity: 30, skill_levels: { 1: 10, 2: 10, 3: 10 },
    burst_regen_time: 2.0,
    equipment: Object.fromEntries(['머리', '몸통', '팔', '다리'].map((p) => [p, { level: 5, skills: [] }])),
    // 기본 스펙(src/engine/spec.ts DEFAULT_CHAR)과 같은 값 — 오버로드 레벨 10의 2줄·2줄
    equip_skills: { atk_pct: 22.22, max_ammo_pct: 129.64 },
    cube: { name: '렐릭 베어 큐브', level: 15 },
    console: { common_level: 180, class_level: 100, company_level: 100 },
    collection_stage: 'SR15',
    ...overrides,
  };
}

loadEngine();

/** 파이썬 `f"{x:.nf}"`. */
const f = (x: number, n: number): string => round(x, n).toFixed(n);

// ── 셀 1: 스쿼드 설정 ─────────────────────────────────────────────────────────
// 스쿼드 구성 템플릿 및 버스트 간격 확인 절차 → context/GAMEPLAY.md §표준 테스트 스쿼드 참고

const TARGET = '미란다';
const SEED: number | null = null;   // 정수를 주면 재현된다 (없으면 시드를 건드리지 않는다)

const squad = ['프리바티', '스노우 화이트 : 헤비암즈', '미란다', '리틀 머메이드', '나유타'].map((n) => make_char(n));

const r = simulate(squad, { no_burst_char: '리틀 머메이드' }, null, true, SEED);
console.log(r.summary());

// ── 셀 2: 버스트 사이클 확인 ───────────────────────────────────────────────────

const burst_times = r.log!.burst_log.filter((e) => e.event.includes('full_burst')).map((e) => e.t);
console.log(`풀버스트 횟수: ${burst_times.length}`);
if (burst_times.length > 1) {
  const gaps: string[] = [];
  for (let i = 0; i < Math.min(5, burst_times.length - 1); i += 1) {
    gaps.push(`${f(burst_times[i + 1]! - burst_times[i]!, 2)}s`);
  }
  console.log(`사이클 간격 (처음 5회): [${gaps.map((g) => `'${g}'`).join(', ')}]`);
}

// ── 셀 3: 특정 구간 상세 디버그 ───────────────────────────────────────────────

const DEBUG_BURST_IDX = 4;          // 몇 번째 버스트 구간을 볼지
const DEBUG_WINDOW = 2.0;           // 구간 길이(초)

const t0 = burst_times[DEBUG_BURST_IDX]!;
const t1 = t0 + DEBUG_WINDOW;
console.log(`검토 구간: ${f(t0, 3)}~${f(t1, 3)}s`);
simulate(squad, { _debug_char: TARGET, _debug_t0: t0, _debug_t1: t1 });

// ── 셀 4: 버프 스냅샷 요약 ────────────────────────────────────────────────────

console.log(r.log!.buff_summary([TARGET]));
