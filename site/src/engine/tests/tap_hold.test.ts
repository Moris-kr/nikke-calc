/**
 * py: calculator/test_tap_hold.py
 *
 * 톡톡이와 홀드를 함께 켰을 때의 계약.
 *
 * 둘은 **겹쳐 쓰는 컨트롤이다** — 평소에는 톡톡이로 쏘다가 본인 버스트 동안만
 * 풀차지를 들고 있는 조작이 실제로 쓰인다(`data/char_defaults.json`의 아인:
 * 「에이다와 함께면 … 톡톡이는 그대로 두므로 버스트 밖에서는 평소대로 쏜다」).
 *
 * 톡톡이가 늘 이기게 두면 홀드가 통째로 죽어, 홀드를 얹은 조합이 톡톡이만 켠 것과
 * 한 자리도 다르지 않았다 — 그 상태를 여기서 막는다.
 */
import { describe, expect, it } from 'vitest';
import { simulate } from '../timeline';
import { build_config, build_squad } from '../spec';
import { loadEngineData } from './helpers';

loadEngineData();

const TAP = { tap_fire: { rate: 3.6, release: 0.03 } };
const HOLD = { hold: { policy: 'own_full_burst', lead: 0.5 } };
const SQUAD = ['미란다', '에이다', '아인', '타키나', '홍련'];

/** 아인에게만 컨트롤을 지정하고 30초를 돌린다. 나머지는 레이어 기본 그대로. */
function _run(control: Record<string, any>): [number, number] {
  const squad = build_squad(SQUAD, { 아인: { control } }, null, new Set(['아인']));
  const cfg = build_config(squad, { duration: 30, rng_mode: 'expected' });
  const result = simulate(squad, cfg, { code: '', core_px: 0 });
  const shots = result.hits.filter((hit) => hit.caster === '아인').length;
  return [result.char_total['아인']!, shots];
}

describe('TapFireWithHoldTest', () => {
  it('test_hold_still_bites_while_tap_fire_is_on', () => {
    const [tap_total, tap_shots] = _run({ ...TAP });
    const [both_total, both_shots] = _run({ ...TAP, ...HOLD });
    // 홀드 구간에서는 톡톡이를 멈추고 풀차지를 들고 있다 — 그만큼 덜 쏜다.
    expect(both_shots).toBeLessThan(tap_shots);
    expect(both_total).not.toBe(tap_total);
  }, 60_000);

  it('test_tap_fire_returns_after_the_hold_window', () => {
    // 홀드만 켠 것과도 달라야 한다 — 버스트 밖에서는 여전히 톡톡이로 쏘므로
    // 발수가 늘어난다. (총딜의 대소는 조합·전투 길이에 따라 갈리므로 세지 않는다.)
    const [hold_total, hold_shots] = _run({ ...HOLD });
    const [both_total, both_shots] = _run({ ...TAP, ...HOLD });
    expect(both_shots).toBeGreaterThan(hold_shots);
    expect(both_total).not.toBe(hold_total);
  }, 60_000);
});
