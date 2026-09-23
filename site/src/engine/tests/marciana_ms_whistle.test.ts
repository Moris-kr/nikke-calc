// py: calculator/test_marciana_ms_whistle.py
/*
마르차나 : 마린 스터디 — `[중첩량 N개 ▲]`는 상한이 아니라 중첩이다.

원문은 이렇게 생겼다.

    ■ 전투 시작 시 자신에게
    [휘슬 : 공격력 32.73% ▲] [5 중첩] [지속]
    [휘슬 중첩량 4개 ▲]

「5 중첩」이 **상한**이고, 아래 줄의 `[휘슬 중첩량 4개 ▲]`는 **중첩을** 4 더한다 —
그래서 전투 시작과 동시에 상한 5에 닿는다. 종전에는 아래 줄을 「상한 +4」로 읽어
`max_stack: 9`로 두었고, 공격력 32.73%짜리 중첩이 넷 더 붙는 바람에 이 캐릭터 딜이
**실측의 1.29배**로 부풀었다(피드백 2026-09-07 — 유저 사격장 실측 60.31억 vs 계산 77.96억).

같은 표기의 ▼쪽(`펭군 긴급 출동`의 `[휘슬 중첩량 1개 ▼]`, 원문 「소모하여」)을 데이터가
이미 중첩 제거로 읽고 있었다 — ▲만 상한으로 읽던 것이 애초에 앞뒤가 안 맞았다.
*/
import { beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '../timeline';
import * as char_spec from '../spec';
import * as buff_manager from '../buff_manager';
import { get, sum } from '../py';
import { loadEngineData, readJson } from './helpers';

beforeAll(loadEngineData);

const NAME = '마르차나 : 마린 스터디';
const SQUAD = ['리틀 머메이드', '크라운', '신데렐라 : 크리스탈 웨이브', NAME, '마스트 : 로망틱 메이드'];

function _whistle(): Record<string, any> {
  const skills = readJson('data/parsed_skills.json');
  return (skills[NAME] as any[]).find((e) => get(e, 'name') === '휘슬');
}

describe('MarcianaMarineStudyWhistleTest', () => {
  it('test_the_cap_is_five', () => {
    // 상한 5. 「중첩량 4개 ▲」를 캡으로 읽으면 9가 되고, 그 차이가 딜 29%다.
    expect(_whistle()['max_stack']).toBe(5);
  });

  it('test_the_opening_stack_fills_the_cap', () => {
    // 전투 시작 1중첩 + 중첩량 4 = 5 — 시작하자마자 상한이다.
    const skills = readJson('data/parsed_skills.json');
    const opening = (skills[NAME] as any[]).find((e) => get(e, 'name') === '휘슬 초기 중첩');
    expect(opening['stat']).toBe('buff_stack_add');
    expect(opening['target_effect']).toBe('휘슬');
    expect(opening['fixed_value']).toBe(4);
    expect(1 + opening['fixed_value']).toBe(_whistle()['max_stack']);
  });

  it('test_the_stack_amount_notation_reads_the_same_both_ways', () => {
    // ▲와 ▼가 같은 것을 가리킨다 — 한쪽만 상한으로 읽으면 앞뒤가 안 맞는다.
    const skills = readJson('data/parsed_skills.json');
    const spend = (skills[NAME] as any[]).find((e) => get(e, 'name') === '휘슬 소모');
    expect(spend['stat']).toBe('buff_stack_remove');
    expect(spend['target_effect']).toBe('휘슬');
  });

  it('test_the_cap_actually_binds_the_damage', () => {
    // 상한을 9로 되돌리면 딜이 그만큼 뛴다 — 시험이 보는 것이 실제로 딜에 닿는다.
    function total(cap: number): number {
      const squad = char_spec.build_squad(SQUAD, {});
      // 스쿼드를 세운 뒤 그 판본의 상한만 바꾼다 — 파일은 건드리지 않는다.
      const whistle = (buff_manager._PARSED_SKILLS()[NAME] as any[]).find((e) => get(e, 'name') === '휘슬');
      const before = whistle['max_stack'];
      whistle['max_stack'] = cap;
      try {
        const result = simulate(squad, { duration: 60, rng_mode: 'expected' },
          { def: 31784, code: '전격', core_px: 52 });
        return sum(result.hits.filter((h) => h.caster === NAME).map((h) => h.damage));
      } finally {
        whistle['max_stack'] = before;
      }
    }

    const five = total(5);
    const nine = total(9);
    expect(nine).toBeGreaterThan(five);
    // 실측 대비 1.29배로 부풀던 그 폭이다 — 대략 1.2~1.4배 사이.
    expect(nine / five).toBeGreaterThan(1.2);
    expect(nine / five).toBeLessThan(1.4);
  });
});
