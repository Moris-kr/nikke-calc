/**
 * calculator/test_burst_pattern_turn.py 이식.
 *
 * 이번 사이클이 «차례»인 사람이 있으면 그 사람이 그 단계를 가져간다.
 *
 * 미란다·토브·츠바이에게는 「전담」 패턴(`every:1`)이 붙어 있다 — 같은 단계에 다른
 * 멤버가 있을 때 그 단계를 도맡는다는 뜻이다(`data/char_defaults.json`).
 *
 * 그런데 패턴은 **뒤로 미는 것**이라, 차례인 사람이 0.2초 늦게 준비되면 동료가
 * 새치기했다. 180초에 딱 한 번 끼어드는 모습이라 눈에도 잘 안 띄었다. 사람은 그
 * 0.2초를 기다리므로, 차례인 사람이 있으면 그 사람만 후보로 둔다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { build_config, build_squad } from '../spec';
import { simulate } from '../timeline';
import { loadEngineData } from './helpers';

beforeAll(loadEngineData);

// 미란다(1버, 전담) + 리틀 머메이드(1버). 나머지는 2·3버를 채워 사이클이 돌게 한다.
const SQUAD = ['리틀 머메이드', '미란다', '크라운', '아인', '에이다'];

function _casts(name: string, duration = 120): number {
  const squad = build_squad(SQUAD);
  const cfg = build_config(squad, { duration, rng_mode: 'expected' });
  const result = simulate(squad, cfg, { code: '', core_px: 0 }, true);
  return result.log!.burst_log.filter((event) => event.caster === name && event.event.includes('사용')).length;
}

describe('BurstPatternTurnTest', () => {
  it('test_the_designated_member_keeps_the_stage', () => {
    // 전담이 걸린 미란다가 1버를 전부 가져간다.
    expect(_casts('미란다')).toBeGreaterThan(5);
    // 같은 단계의 동료는 한 번도 끼어들지 않는다.
    expect(_casts('리틀 머메이드')).toBe(0);
  });

  it('test_the_cycle_still_runs', () => {
    // 단계를 독차지한다고 사이클이 막히면 안 된다.
    //
    // 차례인 사람을 기다리는 것과 단계가 통째로 멈추는 것은 다르다 — 기다린 뒤
    // 그 사람이 쓰고, 풀버스트도 그대로 돈다.
    const squad = build_squad(SQUAD);
    const cfg = build_config(squad, { duration: 120, rng_mode: 'expected' });
    const result = simulate(squad, cfg, { code: '', core_px: 0 }, true);
    const full_bursts = result.log!.burst_log.filter((event) => event.event === 'full_burst 시작').length;
    expect(full_bursts).toBeGreaterThanOrEqual(8);
  });
});
