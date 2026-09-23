// py: calculator/test_laplace_uh_mode.py
/*
라플라스 : 얼티밋 히어로 — 「투사체 폭발 대미지」는 예열 구간에서만 받는다.

「투사체 폭발 대미지 ▲」는 **기본 무기**가 RL인지로 따진다(유저 확인, 2026-08-25 —
나유타는 SMG가 기본이라 RL 모드로 바뀌어도 못 받는다). 그 규칙만 읽으면 기본이 RL인
이 캐릭터는 SMG 모드 중에도 계속 받을 것처럼 보인다.

실제로는 그렇지 않고, 그게 맞다(유저 확인, 2026-09-02): 예열을 쌓는 **RL 풀차지 5발
동안만** 받고 SMG 모드에서는 안 받는다.

계산기가 이미 그렇게 돈다. 다만 **의도해서라기보다 발사 경로가 갈려 있어서**다 —
투사체 폭발 플래그는 `_charge_fire`에서만 세우고, 모드 중 SMG 연사는 그 길을 지나지
않는다. 경로를 손대면 조용히 깨질 수 있어 여기서 못 박는다.
*/
import { beforeAll, describe, expect, it } from 'vitest';
import * as timeline from '../timeline';
import { simulate } from '../timeline';
import * as char_spec from '../spec';
import { pop, round, setdefault, sorted, sum } from '../py';
import type { HitEvent } from '../sim_result';
import { loadEngineData } from './helpers';

beforeAll(loadEngineData);

const NAME = '라플라스 : 얼티밋 히어로';
//: 예열 5중첩이 차는 시각. 이 앞이 RL 풀차지, 뒤가 SMG 연사다.
const _MODE_START = 4.15;

describe('LaplaceUltimateHeroModeTest', () => {
  /** (RL 차지 히트, SMG 모드 히트). 투사체 폭발 수치를 밖에서 얹어 준다. */
  function _split(projectile_pct: number): [HitEvent[], HitEvent[]] {
    const squad = char_spec.build_squad([NAME], {});
    // 아군을 더 세우지 않고 이 항만 켜서 본다 — 다른 버프가 섞이면 배수를 못 읽는다.
    setdefault<Record<string, any>>(squad[0]!, 'manual_stats', {})['projectile_explosion_dmg'] = projectile_pct;
    const result = simulate(squad, {
      duration: 12, rng_mode: 'expected',
      enemy: { def: 31784, code: '', core_px: 0 },
    });
    const hits = sorted(result.hits, (h) => h.t);
    const charge = hits.filter((h) => h.t < _MODE_START - 0.01);
    const smg = hits.filter((h) => _MODE_START + 0.01 < h.t && h.t < 10.0);
    expect(charge.length, '예열은 풀차지 5발로 찬다').toBe(5);
    expect(smg.length, '모드에 들어가면 연사가 이어져야 한다').toBeGreaterThan(50);
    return [charge, smg];
  }

  it('test_projectile_explosion_lifts_the_charge_shots_only', () => {
    // RL 풀차지만 정확히 배수만큼 오르고, SMG 모드 히트는 한 푼도 안 오른다.
    const [base_charge, base_smg] = _split(0.0);
    const [up_charge, up_smg] = _split(50.0);

    const avg = (hits: HitEvent[]) => sum(hits.map((h) => h.damage)) / hits.length;

    // 투사체 폭발은 ③의 가산 항이라 50%면 딱 1.5배다.
    expect(avg(up_charge) / avg(base_charge)).toBeCloseTo(1.5, 4);
    // SMG 모드는 이 항을 아예 안 탄다.
    expect(avg(up_smg) / avg(base_smg)).toBeCloseTo(1.0, 9);
  });

  it('test_the_mode_keeps_hitting_the_core', () => {
    /*
    SMG 모드도 코어를 그대로 맞힌다 — 탄착군이 매우 좁기 때문이다.

    코어 명중은 **지금 들고 있는 무기**의 탄착군으로 따지므로, 무기군 기본값을
    그대로 쓰면 이 모드는 SMG 110px이 되어 코어 52px 명중률이 15%로 떨어진다.
    그러면 코어를 켜고 꺼도 이 캐릭터만 딜이 거의 안 움직인다(피드백 2026-09-03).
    실제로는 모드의 탄착군이 매우 좁아 **명중 100%로 본다**(유저 확인, 2026-09-04) —
    실측은 `weapon_delays._weapon_change`에 적고 엔진은 명중률 하한으로 받는다.
    */
    const squad = char_spec.build_squad([NAME], {});
    const result = simulate(squad, { duration: 12, rng_mode: 'expected' },
      { def: 31784, code: '', core_px: 52 });
    const hits = sorted(result.hits.filter((h) => h.core_frac != null), (h) => h.t);
    const charge = hits.filter((h) => h.t < _MODE_START - 0.01);
    const smg = hits.filter((h) => _MODE_START + 0.01 < h.t && h.t < 10.0);
    expect(charge.map((h) => h.core_frac)).toEqual(Array(5).fill(1.0));
    expect(smg.map((h) => h.core_frac)).toEqual(Array(smg.length).fill(1.0));
  });

  it('test_the_narrow_spread_is_data_not_a_weapon_class_default', () => {
    // 하한을 빼면 SMG 무기군 기본 탄착군으로 되돌아간다 — 값의 출처를 못 박는다.
    const squad = char_spec.build_squad([NAME], {});
    const delays = timeline._DELAYS()['_weapon_change'][NAME]['일렉트릭 파워 풀 풀 차지'];
    const floor = pop(delays, 'accuracy_pct');
    let result: ReturnType<typeof simulate>;
    try {
      result = simulate(squad, { duration: 12, rng_mode: 'expected' },
        { def: 31784, code: '', core_px: 52 });
    } finally {
      delays['accuracy_pct'] = floor;
    }
    const smg = result.hits.filter((h) => h.core_frac != null && _MODE_START + 0.01 < h.t && h.t < 10.0);
    // SMG 탄착군 110px · 코어 52px → (26/55)^2.55 ≈ 0.148.
    expect(smg[0]!.core_frac!).toBeCloseTo(0.148, 3);
  });

  it('test_mode_fires_as_smg_and_ends_after_its_bullets', () => {
    // 모드 자체가 성립하는지도 함께 잡아 둔다 — 위 시험의 전제다.
    const [, smg] = _split(0.0);
    const gaps = smg.slice(1).map((b, i) => round(b.t - smg[i]!.t, 3));
    // SMG 20발/초 (유저 확인 — `parsed_skills.json`의 모드 note).
    expect(new Set(gaps), `연사 간격이 고르지 않다: ${sorted(new Set(gaps))}`).toEqual(new Set([0.05]));
  });
});

/*
최대 장탄 수 버프가 SMG 모드에 닿는가 (`max_ammo_buff_applies`).

스킬 원문의 `(사용 무기 변경 시 최대 장탄 수 효과 갱신)`이 이 캐릭터를 장탄
빌드로 만든다 — 모드의 장탄이 늘면 「모든 탄환 발사 = 모드 종료」인 지속도 같이
늘어, 장탄 한 줄이 곧 딜이다. 시나리오 문서의 실측이 **120발 → 168발**이다.

피드백(2026-09-06): 장탄 오버로드를 0·60·120·180·240으로 바꿔도 딜이 한 자리도
안 움직인다는 제보. `_full_ammo`가 모드 중이면 표기 장탄을 그대로 돌려주고 끝나
이 플래그를 지나치고 있었다.
*/
describe('LaplaceUltimateHeroAmmoBuffTest', () => {
  /** 첫 SMG 모드가 쏜 발수. 모드는 0.05초 간격이라 그 간격이 곧 모드 구간이다. */
  function _mode_shots(ammo_pct: number): number {
    const chars = { [NAME]: { equip_skills: { ...char_spec.DEFAULT_CHAR['equip_skills'], max_ammo_pct: ammo_pct } } };
    const squad = char_spec.build_squad([NAME], chars);
    const result = simulate(squad, {
      duration: 90, rng_mode: 'expected',
      enemy: { def: 31784, code: '', core_px: 0 },
    });
    const hits = sorted(result.hits.filter((h) => h.caster === NAME && h.hit_tag !== 'skill'), (h) => h.t);
    let run = 1;
    for (let i = 0; i + 1 < hits.length; i++) {
      const before = hits[i]!;
      const after = hits[i + 1]!;
      if (Math.abs((after.t - before.t) - 0.05) < 1e-6) {
        run += 1;
      } else if (run > 10) {
        return run;
      } else {
        run = 1;
      }
    }
    return run;
  }

  it('test_the_ammo_buff_lengthens_the_mode', () => {
    // 장탄 0%면 표기 120발, +40%면 실측 168발.
    expect(_mode_shots(0.0)).toBe(120);
    expect(_mode_shots(40.0), '시나리오 실측 120 → 168').toBe(168);
  });

  it('test_more_ammo_is_more_damage', () => {
    // 장탄을 올릴수록 딜이 오른다 — 제보가 「전부 같다」고 한 그 자리다.
    const totals: number[] = [];
    for (const ammo_pct of [0.0, 60.0, 120.0, 180.0, 240.0]) {
      const chars = { [NAME]: { equip_skills: { ...char_spec.DEFAULT_CHAR['equip_skills'], max_ammo_pct: ammo_pct } } };
      const squad = char_spec.build_squad([NAME], chars);
      const result = simulate(squad, {
        duration: 180, rng_mode: 'expected',
        enemy: { def: 31784, code: '', core_px: 0 },
      });
      totals.push(sum(result.hits.map((h) => h.damage)));
    }
    expect(sorted(totals), `장탄이 늘어도 딜이 안 는다: ${totals}`).toEqual(totals);
    expect(new Set(totals).size, `장탄을 바꿔도 딜이 같다: ${totals}`).toBe(totals.length);
  });
});
