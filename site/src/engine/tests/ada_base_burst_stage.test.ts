/**
 * 에이다 「은밀한 지원」은 «직전에 버스트 스킬을 사용한 **기본** 버스트 단계가 Step 3인 아군»에게 간다.
 *
 * 라피 : 레드 후드는 기본 단계가 3이지만, 1버 아군이 없으면 1버로 쓴다(`burst_stage_override:1`).
 * 그때 엔진의 «지금 유효 단계»는 1이 되는데, 대상 판정이 그 값을 봐서 레드 후드가 빠졌다
 * (유저 피드백 2026-09-26: 「라피를 1버로 웡과 같이 쓸 때 웡 버프가 라피에게 적용이 안 된다」).
 * 원문은 «기본» 단계이므로 1버로 서도 받아야 한다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { build_config, build_squad } from '../spec';
import { simulate } from '../timeline';
import { loadEngineData } from './helpers';

beforeAll(loadEngineData);

const RRH = '라피 : 레드 후드';

function run(names: string[]) {
  const squad = build_squad(names);
  const cfg = build_config(squad, { duration: 90, rng_mode: 'expected' });
  return simulate(squad, cfg, { code: '', core_px: 0 }, true).log!;
}

describe('에이다 은밀한 지원 — 기본 버스트 단계', () => {
  it('1버로 쓴 라피 : 레드 후드도 버프를 받는다', () => {
    // 1버 아군이 없어 레드 후드가 1버를 맡는다.
    const log = run([RRH, '크라운', '에이다', 'test_B3']);
    const rrhAsB1 = log.burst_log.filter((event) => event.caster === RRH && event.event.includes('사용'));
    expect(rrhAsB1.length).toBeGreaterThan(0);
    const got = log.buff_events.filter((event) => event.name === '은밀한 지원' && event.target === RRH);
    expect(got.length).toBeGreaterThan(0);
  });

  it('버스트를 쓰지 않은 아군이나 기본 단계가 3이 아닌 아군은 받지 않는다', () => {
    const log = run([RRH, '크라운', '에이다', 'test_B3']);
    const targets = new Set(log.buff_events.filter((event) => event.name === '은밀한 지원').map((event) => event.target));
    // 버스트를 쓴 3버(에이다·test_B3)는 받는다 — 아무도 못 받아서 통과하는 일이 없게.
    expect([...targets].some((name) => name === '에이다' || name === 'test_B3')).toBe(true);
    expect(targets.has('크라운')).toBe(false);
  });
});
