/**
 * site/scripts/test-mechanics-audit.py 이식 — 풀버스트 요약(_build_timeline)과 부분 편집 시 기본 육성 보존(run_request).
 * (calculator/test_mechanics_audit.py 이식인 mechanics_audit.test.ts와 이름이 겹쳐 site_ 접두를 붙였다.)
 */
import { describe, expect, it } from 'vitest';
import { _build_timeline, run_request } from '../bridge';
import { BurstLogEntry, SimLog } from '../sim_result';
import { loadEngineData } from './helpers';

loadEngineData();

describe('FullBurstSummaryTest', () => {
  // 파이썬 SimpleNamespace(duration=..., hits=[], log=SimLog(burst_log=events)) 가짜 결과.
  function timeline(duration: number, events: BurstLogEntry[]): Record<string, any> {
    return _build_timeline({ duration: duration, hits: [], log: new SimLog({ burst_log: events }) } as any, []);
  }

  it('test_final_open_interval_is_counted_and_clipped', () => {
    const t = timeline(12, [new BurstLogEntry({ t: 8, event: 'full_burst 시작', caster: '', planned_end: 18 })]);
    expect(t['fullBurst']).toEqual([[8, 12]]);
    expect(t['fullBurstSummary']).toEqual({
      count: 1, lastStart: 8, lastDuration: 4,
      lastPlannedDuration: 10, lastTruncated: true,
    });
  });

  it('test_shortened_full_burst_is_not_truncation', () => {
    const t = timeline(12, [new BurstLogEntry({ t: 2, event: 'full_burst 시작', caster: '', planned_end: 7 }),
      new BurstLogEntry({ t: 7, event: 'full_burst 종료', caster: '' })]);
    expect(t['fullBurstSummary']['lastDuration']).toBe(5);
    expect(t['fullBurstSummary']['lastTruncated']).toBe(false);
  });

  it('test_no_burst_and_exact_end', () => {
    expect(timeline(12, [])['fullBurstSummary']['count']).toBe(0);
    const t = timeline(12, [new BurstLogEntry({ t: 2, event: 'full_burst 시작', caster: '', planned_end: 12 })]);
    expect(t['fullBurstSummary']['lastTruncated']).toBe(false);
  });

  it('test_partial_edit_preserves_default_growth_and_cube_override', () => {
    const base = {
      squad: ['신 : 스위프트 바니'], duration: 2, enemyDef: 31784,
      enemyCode: '', corePx: 0, hasParts: false, seed: 42,
    };
    const effective = (characters: Record<string, any>): Record<string, any> =>
      JSON.parse(run_request(JSON.stringify({ ...base, characters: characters }), true))['effectiveCharacters'][0];
    const original = effective({});
    let changed = effective({ '신 : 스위프트 바니': { growthStage: 0 } });
    for (const key of ['skill_levels', 'equipment', 'cube', 'collection_stage']) {
      expect(changed[key], key).toEqual(original[key]);
    }
    changed = effective({ '신 : 스위프트 바니': { cube: { name: '없음', level: 0 } } });
    expect(changed['cube']['name']).toBe('없음');
    expect(changed['equipment']).toEqual(original['equipment']);
  });
});
