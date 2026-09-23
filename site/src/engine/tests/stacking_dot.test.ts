// py: calculator/test_stacking_dot.py
/*
 * 중첩형 지속 대미지의 계약.
 *
 * 원문 `[... 지속 대미지] [N초 간격] [N 중첩] ...`은 인스턴스가 **병존**한다
 * (`context/GAMEPLAY.md` §버프 스택 — `[N 중첩]` 표기가 *없는* DoT만 갱신된다).
 * 병존하면 한 틱에 들어가는 대미지는 계수 × 현재 중첩이다.
 *
 * 엔진은 그 곱을 `scaling: stack_count`가 붙은 DoT에만 적용한다
 * (`timeline.py` §`scaling:stack_count + dot_damage`). 그래서 `max_stack > 1`인
 * `dot_damage`에 그 표시가 빠지면, 중첩은 쌓이는데 대미지는 1중첩에 머문다 —
 * 조용히 틀리고 시뮬 로그에도 흔적이 남지 않는다.
 *
 * 실제로 레이븐 `쇼크웨이브`가 그 상태였다(제보 2026-08-23: "평타 비중이 70%로
 * 이상하다"). 같은 문장 형태인 사쿠라 : 블룸 인 서머 `화양연화 2`·미하라 : 본딩 체인
 * `사슬 감기`는 표시가 있었다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { get, int, or } from '../py';
import { loadEngineData, readJson } from './helpers';

function _skills(): Record<string, any> {
  return readJson('data/parsed_skills.json');
}

function _pyStr(v: any): string {
  // 파이썬 str() — 여기서는 startswith 판정에만 쓰므로 None → "None" 정도만 맞추면 된다.
  return v == null ? 'None' : String(v);
}

beforeAll(loadEngineData);

describe('StackingDotContractTest', () => {
  it('test_every_stacking_dot_scales_with_its_stacks', () => {
    // `max_stack > 1`인 지속 대미지는 전부 중첩만큼 곱해져야 한다.
    const missing: string[] = [];
    for (const [name, effects] of Object.entries(_skills())) {
      if (name.startsWith('test_') || !Array.isArray(effects)) {
        continue;
      }
      for (const eff of effects) {
        if (!(eff !== null && typeof eff === 'object' && !Array.isArray(eff))) {
          continue;
        }
        if (!_pyStr(get(eff, 'stat', '')).startsWith('dot_damage')) {
          continue;
        }
        if (int(or(get(eff, 'max_stack', 1), 1)) <= 1) {
          continue;
        }
        if (get(eff, 'scaling') !== 'stack_count') {
          missing.push(`${name} / ${_pyStr(get(eff, 'name'))}`);
        }
      }
    }
    expect(missing,
      '중첩형 지속 대미지에 scaling: stack_count 가 빠졌다 — '
      + '중첩이 쌓여도 틱 대미지가 1중첩에 머문다: ' + missing.join(', ')).toEqual([]);
  });

  it('test_raven_shockwave_ticks_grow_with_stacks', () => {
    // 레이븐 `쇼크웨이브`는 풀차지가 쌓일수록 틱이 세져야 한다.
    //
    // 풀차지 명중마다 한 중첩씩 붙으므로, 한 탄창 안에서 뒤쪽 틱이 앞쪽 틱보다
    // 커야 한다. 중첩이 대미지에 반영되지 않으면 모든 틱이 같은 값이다.
    const squad = build_squad(['레이븐', '크라운', 'test_B3']);
    const result = simulate(squad, build_config(squad, { first_burst_time: 1, duration: 20 }), null, false, 1);
    const ticks = result.hits.filter((h) => h.caster === '레이븐' && h.skill_name === '쇼크웨이브').map((h) => h.damage);
    expect(ticks.length, '쇼크웨이브 틱이 너무 적어 비교할 수 없다').toBeGreaterThanOrEqual(4);
    expect(Math.max(...ticks), '쇼크웨이브 틱이 전부 같은 크기다 — 중첩이 대미지에 반영되지 않았다')
      .toBeGreaterThan(Math.min(...ticks) * 1.5);
  }, 60_000);
});
