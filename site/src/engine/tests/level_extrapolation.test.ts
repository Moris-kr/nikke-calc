// py: calculator/test_level_extrapolation.py
/*
표 밖(1000 초과) 레벨 회귀 — **실측 대조**.

인게임 캐릭터 레벨 상한은 우리 스탯표(1000)보다 높다. 유니온 레이드를 돌리면 싱크로가
1100을 넘는 사람을 실제로 만나는데, 표 끝값으로 눌러 버리면 공격력이 15% 넘게 깎여
«누가 더 기여하나»가 뒤집힌다.

아래 값은 블라블라링크 니케 도감의 **레벨업 미리보기**에서 잰 것이다 — 레벨을 올리면
스탯 옆에 파란 «+수치»가 붙고, 그게 그 레벨에서의 증가분이다. 「도로시 : 세렌디피티」
(화력형 SG)로 재고, 표 안(910·981)에서 얻은 배수 1.2084(= 3돌 1.06 × 코강7 1.14)로
나눠 순수 레벨 스탯을 유도했다 (2026-08-27).
*/
import { beforeAll, describe, expect, it } from 'vitest';
import { _level_stat, band_size, band_ratio, band_share } from '../base_stat';
import { SYNCHRO_MAX, SYNCHRO_MEASURED_MAX, normalize_synchro_level } from '../customization';
import { int, maxBy, minBy } from '../py';
import { loadEngineData, raisesPy, readJson } from './helpers';

beforeAll(loadEngineData);

// 레벨 → 도감이 보여 준 공격력 증가분(822레벨 기준)
const MEASURED_ATK_DELTA: Array<[number, number]> = [
  [1001, 571_133], [1002, 572_076], [1021, 653_719], [1041, 740_436], [1061, 832_211],
  [1081, 928_575], [1101, 1_030_480], [1118, 1_047_736], [1120, 1_049_767], [1121, 1_137_480],
  [1131, 1_147_994], [1140, 1_157_456], [1141, 1_250_556], [1151, 1_261_069], [1161, 1_369_282],
];
const MULTIPLIER = 1.2084;

function _table(): Record<string, any> {
  return readJson('data/base_stat_tables/level_stats.json');
}

describe('LevelBeyondTableTest', () => {
  it('test_matches_the_game_within_rounding', () => {
    // 실측과 붙여 본다. 어긋나면 «추정이 틀렸다»가 아니라 데이터가 바뀐 것이다.
    //
    // 실측은 SSR 화력형 SG로 쟀다 — 표가 등급별로 갈린 뒤에도 같은 곡선을 본다.
    const base = _table()['SSR_화력형_SG']['822']['atk'];
    let worst = 0.0;
    for (const [level, delta] of MEASURED_ATK_DELTA) {
      const real = base + delta / MULTIPLIER;
      const got = _level_stat('네온', 'SSR', '화력형', 'SG', level)['atk']!;
      worst = Math.max(worst, Math.abs(got / real - 1));
    }
    expect(worst, `최대 오차 ${(worst * 100).toFixed(4)}%`).toBeLessThan(0.0005);
  });

  it('test_band_shape_survives', () => {
    // 20레벨 밴드 안에서는 고르게 오르고, 밴드가 바뀔 때 한 번 뛴다.
    const atk = (lv: number) => _level_stat('네온', 'SSR', '화력형', 'SG', lv)['atk']!;
    const steps: number[] = [];
    for (let lv = 1122; lv < 1140; lv++) steps.push(atk(lv + 1) - atk(lv));
    expect(maxBy(steps) - minBy(steps), `${steps}`).toBeLessThanOrEqual(2);
    expect(atk(1141) - atk(1140)).toBeGreaterThan(maxBy(steps) * 10);
  });

  it('test_keeps_growing_to_the_cap', () => {
    // 상한까지 계속 오른다. 1000에서 눌리면 1021과 1131이 같은 값이 된다.
    const top = _level_stat('네온', 'SSR', '화력형', 'SG', 1000)['atk']!;
    const past = [1021, 1131, 1300, SYNCHRO_MAX].map((lv) => _level_stat('네온', 'SSR', '화력형', 'SG', lv)['atk']!);
    const prev = [top, ...past];
    expect(past.every((b, i) => prev[i]! < b), `${past}`).toBe(true);
    expect(past[1]! / top).toBeGreaterThan(1.15); // 싱크로 1131은 1000보다 15% 넘게 세다
  });

  it('test_every_table_reaches_the_cap', () => {
    // 클래스·무기 조합 전부가 상한까지 답을 낸다.
    for (const key of Object.keys(_table()).filter((k) => !k.startsWith('_'))) {
      // key.split("_", 2)
      const parts = key.split('_');
      const rarity = parts[0]!;
      const cls = parts[1]!;
      const weapon = parts.slice(2).join('_');
      expect(_level_stat('검사용', rarity, cls, weapon, SYNCHRO_MAX)['atk']!, key).toBeGreaterThan(0);
    }
  });

  it('test_measured_bands_are_used_as_measured', () => {
    // 실측이 있는 밴드는 추정으로 덮지 않는다.
    const beyond = readJson('data/base_stat_tables/level_beyond.json');
    for (const [band, ratio] of Object.entries<any>(beyond['ratios'])) {
      expect(band_ratio(int(band))).toBeCloseTo(Number(ratio), 6);
    }
    for (const [band, share] of Object.entries<any>(beyond['shares'])) {
      expect(band_share(int(band))).toBeCloseTo(Number(share), 4);
    }
    // 실측 밴드 밖은 꼬리가 잇되, 옆 밴드와 이어져야 한다.
    const last = maxBy(Object.keys(beyond['ratios']).map((b) => int(b)));
    expect(Math.abs(band_ratio(last + 1) - band_ratio(last))).toBeLessThan(0.002);
    // 파이썬 모듈 상수 BAND → band_size() (TS의 `BAND`는 첫 조회 전에는 0인 라이브 바인딩이다).
    expect(SYNCHRO_MEASURED_MAX).toBe((last + 1) * band_size() + 1);
  });

  it('test_cap_is_the_ingame_level_cap', () => {
    // 상한은 인게임 레벨 상한(1400)이지 표의 길이가 아니다.
    expect(normalize_synchro_level(SYNCHRO_MAX)).toBe(SYNCHRO_MAX);
    expect(normalize_synchro_level(1131)).toBe(1131);
    expect(raisesPy(() => normalize_synchro_level(SYNCHRO_MAX + 1), 'ValueError')).toBe(true);
  });
});
