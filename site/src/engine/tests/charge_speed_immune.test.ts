/**
 * calculator/test_charge_speed_immune.py 이식.
 *
 * 차지 속도 «효과» 면역은 스킬로 걸린 것만 막는다.
 *
 * 리버렐리오의 `[차지 속도 증가 효과 면역]`이 **장비 오버로드·큐브까지** 막고 있었다.
 * 대괄호의 «효과»는 버프 칸에 서는 상태 효과를 가리키고, 장비 옵션·큐브는 효과가 아니라
 * 스탯이다 — 면역·해제의 대상이 아니다 (`context/GAMEPLAY.md` §차지 속도 증가·감소 효과 면역).
 *
 * 하네스가 리버렐리오에게 차지속도 9.26%를 입혀 두고도 딜이 한 번도 안 움직였던 것이
 * 이 버그의 신호였다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { BuffManager } from '../buff_manager';
import { build_config, build_squad } from '../spec';
import { simulate } from '../timeline';
import { loadEngineData } from './helpers';

beforeAll(loadEngineData);

const SQUAD = ['리버렐리오', '크라운', '리타', '노아'];

function _shots(chars: Record<string, any> | null = null): [number, number] {
  const squad = build_squad(SQUAD, chars);
  const cfg = build_config(squad, { duration: 60, rng_mode: 'expected' });
  const result = simulate(squad, cfg, { code: '', core_px: 0 });
  const fired = result.hits.filter((hit) => hit.caster === '리버렐리오').length;
  return [result.char_total['리버렐리오']!, fired];
}

describe('ChargeSpeedImmuneTest', () => {
  it('test_gear_charge_speed_still_counts', () => {
    const none = { 리버렐리오: { equip_skills: { charge_speed_pct: 0.0 } } };
    const geared = { 리버렐리오: { equip_skills: { charge_speed_pct: 30.0 } } };
    const [slow_total, slow_shots] = _shots(none);
    const [fast_total, fast_shots] = _shots(geared);
    // 차지가 빨라진 만큼 더 쏘고, 더 때린다.
    expect(fast_shots).toBeGreaterThan(slow_shots);
    expect(fast_total).toBeGreaterThan(slow_total);
  });

  it('test_cube_charge_speed_still_counts', () => {
    // 큐브 값도 살아 있다. 15레벨이 2.12%뿐이라 발수는 그대로일 수 있어 합계로 본다.
    function charge_speed(cube: string): number {
      const squad = build_squad(SQUAD, {
        리버렐리오: {
          equip_skills: { charge_speed_pct: 0.0 },
          cube: { name: cube, level: 15 },
        },
      });
      const manager = new BuffManager(squad);
      manager.battle_start(0.0);
      return manager.get_buffs('리버렐리오', '__enemy__', 1.0)['charge_speed_pct'];
    }

    expect(charge_speed('렐릭 베어 큐브')).toBe(0.0);
    expect(charge_speed('렐릭 부스트 큐브')).toBeCloseTo(2.12, 4);
  });

  it('test_skill_charge_speed_is_still_blocked', () => {
    // 스킬로 걸리는 차지 속도는 여전히 막힌다 — 면역이 사라진 것이 아니다.
    const squad = build_squad(SQUAD);
    const manager = new BuffManager(squad);
    manager.battle_start(0.0);
    // 스킬로 건 차지 속도 +50%를 억지로 얹는다(출처 태그 없음 = 스킬).
    manager._activate({
      type: 'buff',
      name: '시험용 차지 속도',
      trigger: { timing: ['battle_start'], condition: [] },
      target: 'self',
      stat: 'charge_speed_pct',
      polarity: 'beneficial',
      fixed_value: 50.0,
      duration: null,
    }, '리버렐리오', 0.0);

    const buffs = manager.get_buffs('리버렐리오', '__enemy__', 1.0);
    expect(buffs['charge_speed_buff_immune']).toBeTruthy();
    // 장비 9.26%는 남고 스킬 50%는 빠진다.
    expect(buffs['charge_speed_pct']).toBeLessThan(50.0);
  });
});
