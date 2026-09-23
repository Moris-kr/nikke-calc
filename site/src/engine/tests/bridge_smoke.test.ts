/**
 * site/scripts/test-bridge.py 이식 — 브리지(`run_request` · `run_combat_power`)가 payload를 엔진까지 잇는지.
 *
 * 파이썬은 `json.loads(run_request(json.dumps(payload)))`로 문자열을 오가므로 여기서도 문자열로 넘기고 받는다.
 * 파이썬 `assertRaises(ValueError)` → `expectValueError`(PyError, pyType === 'ValueError'),
 * `assertRaisesRegex(ValueError, "…")` → 메시지에 그 글이 들어 있는지까지 본다(`re.search`).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadEngineData, readJson, almostEqual, withinDelta } from './helpers';
import { run_combat_power, run_request } from '../bridge';
import { is_preview, _nikke as parsed_nikke } from '../spec';
import { BuffManager } from '../buff_manager';
import { PyError, sorted, sum, int } from '../py';

beforeAll(loadEngineData);
afterEach(() => {
  vi.restoreAllMocks();
});

const dumps = (payload: unknown): string => JSON.stringify(payload);
const req = (payload: unknown, include_effective = false): any =>
  JSON.parse(run_request(dumps(payload), include_effective));

/** 파이썬 `with self.assertRaises(ValueError)` / `assertRaisesRegex(ValueError, pattern)`. */
function expectValueError(fn: () => unknown, pattern?: string): void {
  let caught: unknown = null;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, 'ValueError가 나야 한다').toBeInstanceOf(PyError);
  expect((caught as PyError).pyType).toBe('ValueError');
  if (pattern !== undefined) {
    expect((caught as PyError).message).toMatch(new RegExp(pattern));
  }
}

describe('PelletBridgeTest', () => {
  it('test_spatial_model_and_validation', () => {
    const payload = { squad: ['드레이크'], duration: 10, enemyDef: 0, enemyCode: '', corePx: 0, hasParts: false, seed: 42, shotgunModel: 'spatial-v1', rngMode: 'expected' };
    const small = req({ ...payload, shotgunTargetDiameter: 80 });
    const large = req({ ...payload, shotgunTargetDiameter: 360 });
    expect(small['squadTotal']).toBeLessThan(large['squadTotal']);
    const windowed = req({ ...payload, shotgunSizeWindows: [{ from: 0, to: 10, diameter: 80 }] });
    expect(windowed['squadTotal']).toBe(small['squadTotal']);
    expectValueError(() => run_request(dumps({ ...payload, shotgunSizeWindows: [{ from: 3, to: 2, diameter: 80 }] })));
    for (const values of [{ shotgunModel: 'wrong' }, { shotgunTargetDiameter: -1 }]) {
      expectValueError(() => run_request(dumps({ ...payload, ...values })));
    }
  });

  it('test_probability_and_geometry_reach_engine', () => {
    const payload = { squad: ['드레이크'], duration: 10, enemyDef: 0, enemyCode: '', corePx: 0, hasParts: false, seed: 42 };
    // 파이썬 patch('calculator.buff_manager.char_effects', return_value=[]) — 그 모듈 함수는
    // BuffManager.char_effects 메서드에서만 불리므로 메서드를 갈아 끼우는 것과 같다.
    const spy = vi.spyOn(BuffManager.prototype, 'char_effects').mockReturnValue([]);
    const full = req(payload)['squadTotal'];
    const zero = req({ ...payload, shotgunHitRate: 0 })['squadTotal'];
    const geometry = { shapes: [], parts: [], center: { x: 0, y: 0 } };
    const missing = req({ ...payload, shotgunGeometry: geometry })['squadTotal'];
    spy.mockRestore();
    expect(full).toBeGreaterThan(0);
    expect(zero).toBe(0);
    expect(missing).toBe(0);
    expectValueError(() => run_request(dumps({ ...payload, shotgunHitRate: 1.01 })));
  });
});

describe('FirstBurstBridgeTest', () => {
  it('test_shotgun_report_is_opt_in_and_preserves_damage', () => {
    const payload = { squad: ['드레이크'], duration: 3, enemyDef: 0, enemyCode: '', corePx: 52, hasParts: false, seed: 42, shotgunModel: 'spatial-v1', shotgunTargetDiameter: 120 };
    const plain = req(payload);
    const report = req({ ...payload, shotgunReport: true });
    expect(plain).not.toHaveProperty('shotgunReport');
    expect(plain['squadTotal']).toBe(report['squadTotal']);
    expect(report['shotgunReport']['드레이크']['fired']).toBeGreaterThan(0);
  });

  it('test_first_burst_reaches_engine_and_defaults_to_zero', () => {
    // 첫 버스트 시간은 구 방식(고정 시간)의 값이다 — 신 방식은 게이지가 정하므로 이 값을 안 본다.
    const payload = { squad: ['리타', '크라운', '앨리스'], duration: 12, enemyDef: 0, enemyCode: '', corePx: 0, hasParts: false, seed: 42, detail: true, burstGaugeMode: 'legacy' };
    const dflt = req(payload);
    const immediate = req({ ...payload, firstBurstTime: 0 });
    const delayed = req({ ...payload, firstBurstTime: 5 });
    expect(dflt).toEqual(immediate);
    expect(delayed['timeline']['fullBurst'][0][0]).toBeGreaterThan(immediate['timeline']['fullBurst'][0][0] + 4.9);
    expectValueError(() => run_request(dumps({ ...payload, firstBurstTime: -1 })));
  });
});

/** 핵(`calculator/cheats.py`)이 payload에서 엔진까지 이어지는지. */
describe('HackBridgeTest', () => {
  const BASE = {
    squad: ['리타'],
    duration: 20,
    enemyDef: 31_784,
    enemyCode: '',
    corePx: 0,
    hasParts: false,
    seed: 42,
  };

  it('test_mcp_envelope_uses_same_result_and_effective_growth', () => {
    const payload = { ...BASE, synchroLevel: 350, characters: { 리타: { skillLevels: { '1': 4, '2': 5, '3': 6 } } } };
    const raw = dumps(payload);
    const ordinary = JSON.parse(run_request(raw));
    const envelope = JSON.parse(run_request(raw, true));
    expect(envelope['result']).toEqual(ordinary);
    expect(envelope['effectiveCharacters'][0]['level']).toBe(350);
  });

  const _total = (hacks?: Record<string, any>): number => {
    const payload = { ...BASE, ...(hacks !== undefined ? { hacks } : {}) };
    return req(payload)['squadTotal'];
  };

  it('test_damage_mult_reaches_the_engine', () => {
    const plain = _total();
    expect(almostEqual(_total({ damageMult: 7 }) / plain, 7.0, 3)).toBe(true);
  });

  it('test_all_off_is_the_same_as_no_hacks', () => {
    // 켠 것이 없으면 요청에 아예 안 실려야 한다 — 옛 결과와 한 톨도 달라지지 않는다.
    const plain = _total();
    expect(_total({})).toBe(plain);
    expect(_total({ alwaysCrit: false, damageMult: 1 })).toBe(plain);
  });

  it('test_always_crit_reaches_the_engine', () => {
    expect(_total({ alwaysCrit: true })).toBeGreaterThan(_total());
  });

  it('test_bad_multiplier_is_refused', () => {
    expectValueError(() => _total({ damageMult: 0 }));
  });
});

describe('DefenseRateBridgeTest', () => {
  it('test_windows_reach_engine', () => {
    const base = { squad: ['리타'], duration: 4, enemyDef: 31784, seed: 42, rngMode: 'expected' };
    const total = (windows: any[]): number => req({ ...base, defenseRateWindows: windows })['squadTotal'];
    const ordinary = total([]);
    expect(ordinary).toBe(total([{ from: 10, to: 20, rate: 60 }]));
    expect(almostEqual(total([{ from: 0, to: 5, rate: 60 }]) / ordinary, 0.4, 4)).toBe(true);
    const partial = total([{ from: 0, to: 2, rate: 60 }]);
    expect(partial).toBeGreaterThan(ordinary * 0.4);
    expect(partial).toBeLessThan(ordinary);
  });

  it('test_invalid_rate_rejected', () => {
    expectValueError(() => run_request(dumps({
      squad: ['리타'], duration: 4, enemyDef: 31784,
      defenseRateWindows: [{ from: 0, to: 3, rate: 101 }],
    })));
  });
});

/**
 * 캐릭터마다 «쏜 탄 중 몇 발이 코어에 맞았나»를 결과에 실어 보낸다.
 *
 * 「코어를 켰는데 이 사람만 딜이 안 오른다」는 물음이 여러 번 올라왔다. 답은 무기군마다
 * 탄착군이 다르고 **변신 모드는 그 모드의 무기로 따진다**는 것인데, 화면에는 그 사실이
 * 어디에도 없었다. 이 수치가 그 자리를 맡는다.
 */
describe('CoreShareTest', () => {
  const BASE = {
    squad: ['루주', '블랑', '라플라스 : 얼티밋 히어로'],
    duration: 60,
    enemyDef: 31_784,
    enemyCode: '',
    corePx: 52,
    hasParts: false,
    seed: 42,
  };

  const _breakdown = (over: Record<string, any> = {}): Record<string, any> => {
    const raw = run_request(dumps({ ...BASE, ...over }));
    return JSON.parse(raw)['charBreakdown'];
  };

  it('test_core_share_is_per_weapon_and_per_mode', () => {
    const rows = _breakdown();
    const share: Record<string, number> = {};
    for (const [name, row] of Object.entries(rows)) share[name] = row['coreShots'] / row['shots'];
    // SR은 탄착군이 코어보다 작아 언제나 코어다.
    expect(almostEqual(share['루주']!, 1.0, 6)).toBe(true);
    // AR은 76px 탄착군이라 절반쯤 빗나간다.
    expect(almostEqual(share['블랑']!, 0.380, 3)).toBe(true);
    // 기본이 RL이어도 모드 중에는 그 모드의 탄착군으로 따진다. 이 모드는 좁아서
    // (유저 확인) 100%지만, 그 값은 무기군 기본값이 아니라 실측에서 온다.
    expect(almostEqual(share['라플라스 : 얼티밋 히어로']!, 1.0, 6)).toBe(true);
  });

  it('test_no_core_means_no_core_hits', () => {
    const rows = _breakdown({ corePx: 0 });
    for (const [name, row] of Object.entries(rows)) {
      expect(row['shots'], name).toBeGreaterThan(0);
      expect(row['coreShots'], name).toBe(0);
    }
  });

  it('test_core_windows_reach_engine_and_empty_keeps_existing_behavior', () => {
    const base = _breakdown({ duration: 4 });
    expect(base).toEqual(_breakdown({ duration: 4, coreWindows: [] }));
    const hidden = _breakdown({ duration: 4, coreWindows: [{ from: 10, to: 20 }] });
    for (const row of Object.values(hidden)) {
      expect(row['coreShots']).toBe(0);
    }
    const partial = _breakdown({ duration: 4, coreWindows: [{ from: 0, to: 2 }] });
    const coreSum = (rows: Record<string, any>): number => sum(Object.values(rows).map((row) => row['coreShots']));
    expect(coreSum(partial)).toBeGreaterThan(0);
    expect(coreSum(partial)).toBeLessThan(coreSum(base));
  });

  it('test_invalid_core_windows_are_rejected', () => {
    for (const windows of ['invalid', [{ from: 2, to: 1 }], [{ from: -1, to: 2 }]] as any[]) {
      // subTest(windows=windows)
      expectValueError(() => _breakdown({ coreWindows: windows }));
    }
  });

  it('test_skill_damage_is_not_counted_as_a_shot', () => {
    const rows = _breakdown({ duration: 120 });
    for (const row of Object.values(rows)) {
      const skill_hits = row['skillHits'];
      expect(row['shots']).toBeLessThanOrEqual(row['normalHits'] + skill_hits);
      // 스킬로만 나가는 딜은 조준 판정이 없어 분모에 들어가지 않는다.
      expect(row['coreShots']).toBeLessThanOrEqual(row['shots']);
    }
  });
});

describe('BrowserBridgeTest', () => {
  it('test_growth_stage_changes_the_engine_result', () => {
    const payload = {
      squad: ['리타'],
      duration: 10,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
    };
    const card = req({ ...payload, characters: { 리타: { growthStage: 0 } } });
    const core_seven = req({ ...payload, characters: { 리타: { growthStage: 10 } } });

    expect(core_seven['squadTotal']).toBeGreaterThan(card['squadTotal']);
  });

  it('test_rejects_forged_growth_stage_for_character_rarity', () => {
    const payload = {
      squad: ['라피'],
      characters: { 라피: { growthStage: 3 } },
      duration: 10,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
    };

    expectValueError(() => run_request(dumps(payload)), '라피: 돌파 단계는 0~2');
  });

  it('test_rejects_null_growth_stage_in_forged_json', () => {
    const payload = {
      squad: ['리타'],
      characters: { 리타: { growthStage: null } },
      duration: 10,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
    };

    expectValueError(() => run_request(dumps(payload)), '돌파 단계는 정수');
  });

  it('test_released_skill_levels_change_the_engine_result', () => {
    const payload = {
      squad: ['라피 : 레드 후드'],
      characters: {
        '라피 : 레드 후드': {
          skillLevels: { '1': 10, '2': 1, '3': 10 },
        },
      },
      duration: 10,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
    };
    const level_ten = req({
      ...payload,
      characters: {
        '라피 : 레드 후드': {
          skillLevels: { '1': 10, '2': 10, '3': 10 },
        },
      },
    });
    const level_one = req(payload);

    expect(level_ten['squadTotal']).toBeGreaterThan(level_one['squadTotal']);
  });

  /** 같은 설정에 시드만 달리 준 결과들. */
  const _totals_by_seed = (seeds: number[], extra: Record<string, any> = {}): number[] => {
    const out: number[] = [];
    for (const seed of seeds) {
      const payload = {
        squad: ['리타', '크라운', '홍련'],
        duration: 20,
        enemyDef: 31_784,
        enemyCode: '',
        corePx: 0,
        hasParts: false,
        seed,
        ...extra,
      };
      out.push(req(payload)['squadTotal']);
    }
    return out;
  };

  it('test_expected_mode_ignores_the_seed', () => {
    // 기대값은 결정론적이다 — 시드를 바꿔도 한 푼도 달라지면 안 된다.
    const totals = _totals_by_seed([42, 7, 12345], { rngMode: 'expected' });
    expect(new Set(totals).size, `기대값인데 시드마다 다르다: ${totals}`).toBe(1);
  });

  it('test_random_mode_actually_uses_the_seed', () => {
    // 난수 모드는 반대로 시드를 타야 한다 — 위 시험이 «둘 다 안 움직여서» 통과하는 것을 막는다.
    const totals = _totals_by_seed([42, 7, 12345], { rngMode: 'random' });
    expect(new Set(totals).size, `난수인데 시드를 안 탄다: ${totals}`).toBeGreaterThan(1);
  });

  it('test_missing_rng_mode_is_the_site_default_expected', () => {
    // `rngMode`가 안 오면 **화면 기본값(기대값)**으로 친다.
    //
    // 이 기본값이 브리지와 화면에서 서로 달랐던 것이 실제 결함이었다 — `model.ts`가
    // 「기본값이니 빼도 된다」며 `expected`를 안 실었는데 브리지는 빠지면 `random`으로
    // 읽어, 기대값으로 두고 쓴 사람들이 내내 난수 모드로 계산하고 있었다.
    const totals = _totals_by_seed([42, 7, 12345]);
    expect(new Set(totals).size, `안 주면 난수로 돈다: ${totals}`).toBe(1);
  });

  /** 버스트가 시간순으로 누가 몇 단계를 썼는지. */
  const _burst_casts = (sequence: any[] | null = null): Array<[number, string, string]> => {
    const payload: Record<string, any> = {
      squad: ['리타', '크라운', '홍련', '앨리스', '나가'],
      duration: 60,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
      rngMode: 'expected',
      timeline: true,
    };
    if (sequence !== null) {
      payload['burstSequence'] = sequence;
    }
    const result = req(payload);
    const casts: Array<[number, string, string]> = [];
    const bursts = (result['timeline'] ?? {})['bursts'] || {};
    for (const [name, entries] of Object.entries(bursts) as Array<[string, any[]]>) {
      for (const entry of entries) {
        casts.push([entry['t'], entry['stage'], name]);
      }
    }
    return sorted(casts);
  };

  it('test_burst_sequence_decides_who_bursts', () => {
    // 적어 둔 사이클에서는 그 사람이 그 단계를 쓴다.
    const auto = _burst_casts();
    expect(auto.length > 0, '버스트가 하나도 안 나갔다 — 시험 전제가 깨졌다').toBe(true);

    // 3버는 앨리스·나가 둘 다 가능하다. 첫 사이클만 나가로 못 박는다.
    const forced = _burst_casts([{ '1': ['리타'], '2': ['크라운'], '3': ['나가'] }]);
    const first_third = forced.find(([, stage]) => stage === '3')?.[2] ?? null;
    expect(first_third).toBe('나가');
  });

  it('test_burst_sequence_only_binds_the_cycles_it_names', () => {
    // 적어 둔 사이클을 넘어가면 평소 순서로 돌아간다 — 우선순위지 절대 규칙이 아니다.
    const forced = _burst_casts([{ '1': ['리타'], '2': ['크라운'], '3': ['나가'] }]);
    const thirds = forced.filter(([, stage]) => stage === '3').map(([, , name]) => name);
    expect(thirds.length, '60초면 3버가 여러 번 나가야 한다').toBeGreaterThan(1);
    expect(thirds[0]).toBe('나가');
    // 두 번째부터는 계산기가 알아서 고른다 — 나가로 고정돼 있지 않다.
    expect(thirds.slice(1).some((name) => name !== '나가'), `적어 두지 않은 사이클까지 묶였다: ${thirds}`).toBe(true);
  });

  it('test_burst_sequence_rejects_a_name_outside_the_squad', () => {
    // 편성에 없는 이름은 조용히 떨구지 않고 거절한다.
    expectValueError(() => _burst_casts([{ '1': ['도로시'], '2': [], '3': [] }]), '편성에 없는 니케');
  });

  it('test_empty_burst_sequence_is_the_same_as_not_giving_one', () => {
    // 빈 사이클만 늘어놓으면 안 준 것과 같다 — 버스트가 막히면 안 된다.
    const empty = _burst_casts([{ '1': [], '2': [], '3': [] }, { '1': [], '2': [], '3': [] }]);
    expect(empty).toEqual(_burst_casts());
  });

  it('test_seeded_request_returns_compact_positive_result', () => {
    const payload = {
      squad: ['리타'],
      duration: 10,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
    };

    const result = req(payload);

    expect(result['duration']).toBe(10);
    expect(result['squadTotal']).toBeGreaterThan(0);
    expect(result['hitCount']).toBeGreaterThan(0);
    expect(Object.keys(result['charTotals'])).toEqual(['리타']);
  });

  it('test_synchro_level_applies_to_everyone_and_changes_the_result', () => {
    // 싱크로 레벨은 계정 속성이라 스쿼드 전원에게 같은 값으로 얹힌다.
    const payload = {
      squad: ['리타', '크라운'],
      duration: 10,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
    };

    const dflt = req(payload);
    // 기본 스펙 레벨이 400이므로 400을 명시해도 결과가 같아야 한다.
    const same = req({ ...payload, synchroLevel: 400 });
    const lower = req({ ...payload, synchroLevel: 200 });

    expect(same['squadTotal']).toBe(dflt['squadTotal']);
    expect(lower['squadTotal']).toBeLessThan(dflt['squadTotal']);
    // 한 명만이 아니라 전원이 낮아진다.
    for (const name of ['리타', '크라운']) {
      expect(lower['charTotals'][name]).toBeLessThan(dflt['charTotals'][name]);
    }
  });

  it('test_endgame_burst_waits_for_the_last_seconds', () => {
    // 막바지 최우선 — 남은 시간이 N초 미만일 때 그 캐릭터가 먼저 나간다.
    const base = {
      squad: ['리타', '크라운', '라피 : 레드 후드', '앨리스', '나가'],
      duration: 60,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
    };
    const auto = req(base);
    const endgame = req({
      ...base,
      // 나가와 크라운이 같은 2단계 후보다 — 순서가 갈릴 자리가 있어야
      // 이 설정이 뜻을 갖는다.
      characters: { 나가: { burst: { mode: 'endgame', seconds: 20 } } },
    });

    // 순서가 실제로 달라져야 한다 — 안 달라지면 설정이 흘러가 버린 것이다.
    expect(endgame['squadTotal']).not.toBe(auto['squadTotal']);
  });

  it('test_burst_reaction_delays_every_burst', () => {
    // 반응속도는 버스트 하나하나마다 더해진다 — 느리게 잡으면 결과가 달라진다.
    const base = {
      squad: ['리타', '크라운', '라피 : 레드 후드', '앨리스', '나가'],
      duration: 60,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
    };
    const dflt = req(base);
    const same = req({ ...base, burstReaction: 0.05 });
    const slow = req({ ...base, burstReaction: 0.5 });
    const instant = req({ ...base, burstReaction: 0 });

    // 기본값은 0.05초다 — 명시해도 결과가 같아야 한다.
    expect(same['squadTotal']).toBe(dflt['squadTotal']);
    // 늦게 누를수록 버스트가 밀려 총딜이 준다.
    expect(slow['squadTotal']).toBeLessThan(dflt['squadTotal']);
    expect(instant['squadTotal']).toBeGreaterThan(slow['squadTotal']);
  });

  it('test_skip_means_never_bursting_at_all', () => {
    // 「안 씀」은 뒤로 미는 게 아니라 후보에서 빼는 것이다.
    const base = {
      squad: ['리타', '크라운', '라피 : 레드 후드', '앨리스', '나가'],
      duration: 90,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
    };
    const auto = req(base);
    // 크라운과 나가가 같은 2단계 후보다 — 크라운을 빼도 나가가 그 단계를 맡는다.
    const skipped = req({
      ...base, characters: { 크라운: { burst: { mode: 'skip' } } },
    });

    expect(skipped['squadTotal']).not.toBe(auto['squadTotal']);
    // 버스트를 아예 안 썼으므로 크라운의 버스트 시각이 하나도 없어야 한다.
    expect(auto['timeline']['bursts']['크라운'].length > 0).toBe(true);
    expect(skipped['timeline']['bursts']['크라운']).toEqual([]);
    // 그래도 전투는 돌아간다 — 다른 캐릭터는 계속 버스트를 쓴다.
    expect(skipped['timeline']['bursts']['나가'].length > 0).toBe(true);
  });

  it('test_no_cube_drops_both_its_stats_and_its_effect', () => {
    // 「없음」은 큐브를 안 낀 상태다 — 스탯도, 우월 코드 효과도 붙지 않는다.
    const base = {
      squad: ['리타'],
      duration: 20,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
    };
    const withCube = req(base);
    const without = req({
      ...base, characters: { 리타: { cube: { name: '없음', level: 0 } } },
    });

    expect(without['squadTotal']).toBeLessThan(withCube['squadTotal']);
  });

  it('test_rejects_an_unknown_cube_name', () => {
    const payload = {
      squad: ['리타'],
      duration: 10,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
      characters: { 리타: { cube: { name: '없는큐브', level: 5 } } },
    };

    expectValueError(() => run_request(dumps(payload)), '큐브는');
  });

  it('test_overload_zero_is_its_own_equipment_state', () => {
    // 오버로드 0강은 미장착도 T9도 아니다 — 셋이 서로 다른 값을 내야 한다.
    const base = {
      squad: ['리타'],
      duration: 20,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
    };

    const run = (level: string | number): number => {
      const payload = {
        ...base, characters: { 리타: { equipLevels: {
          머리: level, 몸통: level, 팔: level, 다리: level,
        } } },
      };
      return req(payload)['squadTotal'];
    };

    const none_ = run('없음'), tier9 = run('T9'), over0 = run(0), over1 = run(1);
    // 0은 흔히 falsy로 걸러진다 — 걸러지면 미장착이나 기본값과 같아져 조용히 틀린다.
    expect(none_).toBeLessThan(tier9);
    expect(tier9).toBeLessThan(over0);
    expect(over0).toBeLessThan(over1);
  });

  it('test_rejects_a_bad_burst_reaction', () => {
    const payload = {
      squad: ['리타'],
      duration: 10,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
      burstReaction: 9,
    };

    expectValueError(() => run_request(dumps(payload)), '버스트 반응속도');
  });

  it('test_rejects_a_bad_endgame_burst_window', () => {
    const payload = {
      squad: ['리타'],
      duration: 10,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
      characters: { 리타: { burst: { mode: 'endgame', seconds: 0 } } },
    };

    expectValueError(() => run_request(dumps(payload)), '막바지 최우선');
  });

  it('test_rejects_synchro_level_outside_the_ingame_cap', () => {
    // 상한은 표가 아니라 인게임 레벨 상한(1400)이다.
    //
    // 표는 1000까지지만 그 위는 엔진이 이어 붙인다 — 유니온 레이드에서 싱크로 1131인
    // 유니온원을 실제로 만나고, 1000으로 눌러 버리면 그 사람 공격력이 15% 넘게 깎인다.
    const payload = (level: number) => ({
      squad: ['리타'],
      duration: 10,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
      synchroLevel: level,
    });

    // 표 밖이어도 인게임 상한 안이면 계산한다.
    run_request(dumps(payload(1_131)));

    expectValueError(() => run_request(dumps(payload(1_401))), '싱크로 레벨');
  });

  it('test_character_overrides_are_forwarded_to_the_engine', () => {
    const payload: Record<string, any> = {
      squad: ['리타'],
      characters: {
        리타: {
          overload: { atk_pct: 100 },
          cube: { name: '렐릭 디스트로이 큐브', level: 1 },
          manualStats: { normal_atk_dmg_pct: 20 },
        },
      },
      duration: 10,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: true,
      seed: 42,
    };
    const base = { ...payload };
    delete base['characters'];

    const customized = req(payload);
    const baseline = req(base);

    expect(customized['squadTotal']).toBeGreaterThan(baseline['squadTotal']);
  });

  it('test_timeline_is_bucketed_and_matches_char_totals', () => {
    const payload = {
      squad: [
        '목단',
        '에이드 : 에이전트 바니',
        '아니스 : 스파클링 서머',
        '메이든 : 아이스 로즈',
        '프리바티',
      ],
      duration: 30,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
    };

    const result = req(payload);
    const timeline = result['timeline'];

    expect(timeline['bucket']).toBe(1);
    expect(timeline['buckets']).toBe(30);
    for (const name of payload.squad) {
      const row = timeline['damage'][name];
      expect(row.length).toBe(30);
      // 버킷 합은 전 구간 대미지와 일치해야 한다 — 잘게 쪼개도 히트가 새지 않는다
      // (부동소수 나눗셈이 앞 칸으로 흘리기 쉬운 자리다).
      expect(sum(row)).toBe(result['charTotals'][name]);
    }
    // 전투 마지막 순간(t가 duration에 붙은 값)의 히트도 마지막 칸에 들어간다 —
    // 잘게 쪼갤수록 이 경계에서 새기 쉬운데, 새면 위 합계가 곧바로 어긋난다.
    expect(sum(payload.squad.map((name) => timeline['damage'][name].at(-1)))).toBeGreaterThan(0);
    // 풀버스트 구간과 버스트 사용 시점이 로그에서 채워진다.
    expect(timeline['fullBurst'].length > 0).toBe(true);
    expect(payload.squad.some((name) => timeline['bursts'][name].length > 0)).toBe(true);
  });

  it('test_burst_assignment_shifts_which_member_bursts', () => {
    const base = {
      squad: ['라피 : 레드 후드', '앨리스', '목단', '크라운', '마스트 : 로망틱 메이드'],
      duration: 90,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
    };

    const mast_bursts = (payload: unknown): number => {
      const result = req(payload);
      return result['timeline']['bursts']['마스트 : 로망틱 메이드'].length;
    };

    const every1 = mast_bursts({ ...base, characters: {
      '마스트 : 로망틱 메이드': { burst: { mode: 'priority', every: 1 } },
    } });
    const every3 = mast_bursts({ ...base, characters: {
      '마스트 : 로망틱 메이드': { burst: { mode: 'priority', every: 3 } },
    } });
    const skip = mast_bursts({ ...base, characters: {
      '마스트 : 로망틱 메이드': { burst: { mode: 'skip' } },
    } });

    // 매 사이클 우선(every=1)은 3의 배수 우선보다 많거나 같고, skip은 0이 된다.
    expect(every1).toBeGreaterThanOrEqual(every3);
    expect(every1).toBeGreaterThan(skip);
    expect(skip).toBe(0);
  });

  it('test_custom_character_injection_simulates_like_the_real_one', () => {
    const nikke = readJson('data/parsed_nikke.json');
    const skills = readJson('data/parsed_skills.json');
    // 크라운은 char_defaults 레이어가 없어, 복제 커스텀과 실제가 정확히 같아야 한다.
    const custom = { 커스텀크라운: { nikke: nikke['크라운'], skills: skills['크라운'] } };
    const base = {
      duration: 40, enemyDef: 31_784, enemyCode: '',
      corePx: 0, hasParts: false, seed: 42,
    };
    const custom_run = req({
      ...base,
      squad: ['커스텀크라운', '목단', '라피 : 레드 후드', '앨리스', '나가'],
      customCharacters: custom,
    });
    const real_run = req({
      ...base,
      squad: ['크라운', '목단', '라피 : 레드 후드', '앨리스', '나가'],
    });

    expect(custom_run['charTotals']['커스텀크라운']).toBeGreaterThan(0);
    expect(custom_run['charTotals']['커스텀크라운']).toBe(real_run['charTotals']['크라운']);
  });

  it('test_bundled_temporary_characters_simulate_with_fiction_warning', () => {
    const entries = [readJson('site/src/fixtures/fictional-character.json')];
    const names: string[] = entries.map((entry) => entry['name']);
    const custom: Record<string, any> = {};
    for (const entry of entries) custom[entry['name']] = { nikke: entry['nikke'], skills: entry['skills'] };
    const payload: Record<string, any> = {
      squad: ['리타', '크라운', ...names, 'test_B3'], customCharacters: custom,
      duration: 60, enemyDef: 31_784, enemyCode: '',
      corePx: 0, hasParts: false, seed: 42,
    };
    const result = req(payload);
    expect(result['timeline']['fullBurst'].length > 0).toBe(true);
    expect(result['previewNote']).toContain('[임시 · 창작]');
    for (const name of names) {
      expect(result['previewNote']).toContain(name);
      expect(result['timeline']['bursts'][name].length > 0).toBe(true);
      expect(result['timeline']['bursts'][name][0]['stage']).toBe('3');
      expect(result['timeline']['bursts'][name][0]['skill']).toContain('[창작]');
      expect(result['charTotals'][name]).toBeGreaterThan(0);
    }
    payload['characters'] = { [names[0]!]: { skillLevels: { '1': 1, '2': 10, '3': 10 } } };
    expectValueError(() => run_request(dumps(payload)));
  });

  // 순서 주의: 파이썬 unittest는 메서드를 이름순으로 돌려 test_bundled_… 가 이 시험보다 먼저 돈다.
  // 그때 주입된 임시 창작 니케(`preview: true`)가 _nikke()에 남아 있어 파이썬에서는 이 시험이 건너뛰지 않고
  // 그 캐릭터로 돈다(현재 데이터에는 정식 프리뷰가 없다). 같은 경로를 타도록 test_bundled_… 바로 뒤에 둔다.
  it('test_preview_skill_levels_cannot_be_forged_below_ten', (ctx) => {
    // 프리뷰(출시 전 카드) 캐릭터 명단은 출시될 때마다 비므로 이름을 박지 않는다.
    // 비어 있으면 위조를 시도할 대상 자체가 없는 정상 상태다.
    const previews = Object.keys(parsed_nikke()).filter((name) => is_preview(name));
    if (!previews.length) {
      ctx.skip('등록된 프리뷰 캐릭터가 없다 (전원 정식 출시)');
      return;
    }
    const preview = previews[0]!;

    const payload = {
      squad: [preview],
      characters: {
        [preview]: {
          skillLevels: { '1': 9, '2': 10, '3': 10 },
        },
      },
      duration: 10,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
    };

    expectValueError(() => run_request(dumps(payload)), '프리뷰 캐릭터는 스킬 레벨 10');
  });

  it('test_custom_character_missing_stats_is_rejected', () => {
    const payload = {
      squad: ['엉터리'],
      customCharacters: { 엉터리: { nikke: { class: '화력형' }, skills: [] } },
      duration: 10, enemyDef: 31_784, enemyCode: '',
      corePx: 0, hasParts: false, seed: 42,
    };
    expectValueError(() => run_request(dumps(payload)), '누락된 스탯');
  });

  it('test_buff_targets_report_who_actually_received_the_buff', () => {
    // 「누가 이 버프를 받았나」는 추정이 아니라 실제 발동 로그에서 온다.
    //
    // 대상이 공격력 순위로 갈려 편성만 보고는 알 수 없고, 미란다는 애장품
    // 2단계 이상이어야 발동한다 — 조건이 안 맞으면 빈 목록이어야 한다.
    const squad = ['아니스 : 스타', '나유타', '미란다', '리버렐리오', '홍련 : 흑영'];

    const run = (favorite: number): Record<string, any> => {
      const payload = {
        squad,
        characters: { 미란다: { collection: { stage: 'SR15', favorite } } },
        duration: 60, enemyDef: 31784, enemyCode: '',
        corePx: 52, hasParts: false, seed: 42,
      };
      return req(payload)['buffTargets'];
    };

    const got = run(3);
    const miranda = got['미란다'][0];
    expect(miranda['label']).toBe('크확 대상');
    expect(miranda['count']).toBeGreaterThan(0);
    // 자신 제외 공격력 1위에게 간다 — 스쿼드 안의 다른 캐릭터여야 한다.
    expect(miranda['targets'].length > 0).toBe(true);
    expect(miranda['targets']).not.toContain('미란다');
    for (const name of miranda['targets']) {
      expect(squad).toContain(name);
    }

    const rebellio = got['리버렐리오'][0];
    expect(rebellio['label']).toBe('차분한 수심 대상');
    expect(rebellio['targets'].length > 0).toBe(true);
    for (const name of rebellio['targets']) {
      expect(squad).toContain(name);
    }

    // 순서는 발동 시각순으로 담기고, `targets`는 그 순서에서 중복만 지운 것이다.
    for (const row of [miranda, rebellio]) {
      expect(row['sequence'].length).toBe(row['count']);
      expect([...new Set(row['sequence'].map((step: any) => step['target']))]).toEqual(row['targets']);
      const times: number[] = row['sequence'].map((step: any) => step['t']);
      expect(times).toEqual(sorted(times));
    }

    // 애장품 1단계는 발동 조건(2단계)에 못 미친다 → 빈 목록.
    expect(run(1)['미란다'][0]['targets']).toEqual([]);
    expect(run(1)['미란다'][0]['count']).toBe(0);
  });

  it('test_buff_targets_left_out_for_squads_without_watched_casters', () => {
    // 감시 대상이 없는 편성이면 아무 것도 담기지 않는다.
    const payload = {
      squad: ['라피', '앨리스'], duration: 20, enemyDef: 31784,
      enemyCode: '', corePx: 0, hasParts: false, seed: 42,
    };
    const got = req(payload);
    expect(got['buffTargets']).toEqual({});
  });

  it('test_fine_timeline_splits_the_same_damage_into_smaller_slots', () => {
    // 정밀 분석 표는 «더 정확한» 값이 아니라 «더 잘게 나눈» 값이다.
    //
    // 엔진은 히트마다 정수로 정확히 센다 — 칸을 잘게 해도 총합은 한 자리도
    // 달라지지 않아야 한다. 달라진다면 칸 나누기에서 히트를 흘린 것이다.
    const payload = {
      squad: ['리타', '크라운'], duration: 20, enemyDef: 31_784,
      enemyCode: '', corePx: 0, hasParts: false, seed: 42,
      rngMode: 'expected', fineTimeline: true,
    };
    const got = req(payload);
    const coarse = got['timeline'], fine = got['fineTimeline'];
    expect(coarse['bucket']).toBe(1);
    expect(fine['bucket']).toBe(0.1);
    expect(fine['buckets']).toBe(coarse['buckets'] * 10);
    for (const name of ['리타', '크라운']) {
      expect(sum(fine['damage'][name])).toBe(sum(coarse['damage'][name]));
      expect(sum(fine['damage'][name])).toBe(int(got['charTotals'][name]));
    }
  });

  it('test_fine_timeline_is_left_out_unless_asked', () => {
    // 늘 실어 보내면 저장되는 결과가 열 배로 무거워진다 — 내보낼 때만 만든다.
    const payload = {
      squad: ['리타'], duration: 10, enemyDef: 31_784, enemyCode: '',
      corePx: 0, hasParts: false, seed: 42,
    };
    const got = req(payload);
    expect(got).not.toHaveProperty('fineTimeline');
  });

  it('test_shot_track_counts_every_hit_once', () => {
    // 보스 메이커의 사격 트랙 — 낱개 히트를 칸마다 접어 보낸다.
    //
    // 180초 한 판이 수만 건이라 낱개로는 못 옮긴다. 접는 과정에서 히트를 흘리면
    // 화면의 밀도가 실제와 어긋나므로, 평타+스킬 합이 총 히트 수와 같아야 한다.
    const payload = {
      squad: ['리타', '크라운', '레이븐'], duration: 20, enemyDef: 31_784,
      enemyCode: '', corePx: 52, hasParts: true, seed: 42,
      rngMode: 'expected', shotTrack: true,
    };
    const got = req(payload);
    const shots = got['shots'];
    expect(shots['bucket']).toBe(0.1);
    expect(shots['buckets']).toBe(200);
    let counted = 0;
    for (const name of ['리타', '크라운', '레이븐']) {
      const row = shots['chars'][name];
      expect(row['normal'].length).toBe(200);
      counted += sum(row['normal']) + sum(row['skill']);
      // 코어·폭발은 그 칸의 평타·스킬 안에서 세는 부분집합이다.
      expect(sum(row['core'])).toBeLessThanOrEqual(sum(row['normal']) + sum(row['skill']));
    }
    expect(counted).toBe(got['hitCount']);
  });

  it('test_burst_casts_carry_the_burst_skill_name', () => {
    // 버스트를 쓸 때 띄울 이름 — 스킬3의 이름이다.
    //
    // 한 스킬이 효과 여럿으로 쪼개져 들어오고 뒤엣것에는 「템페스트 2」처럼 일련번호가
    // 붙는다. 맨 앞 효과의 이름이 곧 스킬 이름이다.
    const payload = {
      squad: ['홍련 : 흑영', '크라운', '리타'], duration: 40, enemyDef: 31_784,
      enemyCode: '', corePx: 0, hasParts: false, seed: 42, rngMode: 'expected',
    };
    const got = req(payload);
    const casts = got['timeline']['bursts'];
    expect(casts['홍련 : 흑영'][0]['skill']).toBe('화무십일홍 · 만개');
    expect(casts['크라운'][0]['skill']).toBe('라스트 킹덤');
    expect(casts['리타'][0]['skill']).toBe('더블 부스트');
    // 단계도 그대로 실린다 — 이름이 없는 옛 결과는 이것만으로 보여 준다.
    expect(casts['홍련 : 흑영'][0]['stage']).toBe('3');
  });

  it('test_shot_track_is_left_out_unless_asked', () => {
    const payload = {
      squad: ['리타'], duration: 10, enemyDef: 31_784, enemyCode: '',
      corePx: 0, hasParts: false, seed: 42,
    };
    const got = req(payload);
    expect(got).not.toHaveProperty('shots');
  });

  it('test_part_break_interval_reaches_the_engine', () => {
    // 파츠 파괴 주기 — 보스 메이커가 «파츠 체력 ÷ DPS»로 낸 시각을 넘긴다.
    //
    // 엔진에는 적 체력이 없어 파괴는 시각으로만 들어간다. 주기를 주면 파괴에
    // 반응하는 스킬이 걸리므로 총딜이 달라져야 한다.
    const base = {
      squad: ['레이븐', '크라운', '리타'], duration: 60, enemyDef: 31_784,
      enemyCode: '', corePx: 0, hasParts: true, seed: 42,
      rngMode: 'expected',
    };
    const without = req(base);
    // 파이썬 json.dumps는 8.0을 "8.0"으로 쓴다 — 같은 글자를 넘긴다.
    const with_break = JSON.parse(run_request(dumps(base).slice(0, -1) + ',"partBreakInterval":8.0}'));
    // 레이븐 「일점 공격」은 파츠 파괴에 반응한다 — 파괴가 없으면 영원히 안 걸린다.
    expect(with_break['charTotals']['레이븐']).toBeGreaterThan(without['charTotals']['레이븐']);
  });

  it('test_infinite_ammo_does_not_leak_past_the_burst', () => {
    // 무한 장탄은 그 구간만이다.
    //
    // 엔진은 무한을 센티널(999999)로 두는데, 그것까지 «최대 장탄»으로 잡으면 8초짜리
    // 버스트가 끝난 뒤에도 탄창이 무한으로 남는다. 나유타 「기억 연소」가 그랬다.
    const payload = {
      squad: ['나유타', '크라운', '리타'], duration: 60, enemyDef: 31_784,
      enemyCode: '', corePx: 0, hasParts: false, seed: 42,
      rngMode: 'expected', shotTrack: true,
    };
    const got = req(payload);
    const row = got['states']['chars']['나유타'];

    // 최대 장탄은 실제 탄창이다 — 센티널이 아니다.
    expect(row['maxAmmo']).toBeLessThan(99_999);
    expect(row['maxAmmo']).toBeGreaterThan(0);
    // 무한인 칸은 있지만 판 전체는 아니다.
    const infinite: number[] = [];
    (row['ammo'] as number[]).forEach((ammo, at) => {
      if (ammo >= 99_999) infinite.push(at);
    });
    expect(infinite.length).toBeGreaterThan(0);
    expect(infinite.length).toBeLessThan(Math.floor(row['ammo'].length / 2));
    // 무한 구간은 한 덩어리로 이어진다(버스트 한 번).
    expect(infinite.at(-1)! - infinite[0]! + 1).toBe(infinite.length);
  });

  it('test_pierce_passes_through_shapes_and_parts', () => {
    // 관통은 꿰뚫은 만큼 때린다 — 파츠에 든 히트는 파츠 판정을 받는다.
    //
    // 안 주면 몸통 하나(한 발 = 한 히트)라 지금까지의 계산과 같아야 한다.
    // 그레이브는 버스트 중에 관통이 걸린다.
    const base = {
      squad: ['그레이브', '크라운', '리타'], duration: 120, enemyDef: 31_784,
      enemyCode: '', corePx: 0, hasParts: true, seed: 42, rngMode: 'expected',
    };
    const plain = req(base);
    const through = req({ ...base, piercePass: { shapes: 1, parts: 2 } });
    const twice = req({ ...base, piercePass: { shapes: 2, parts: 0 } });

    // 파츠 둘을 더 꿰뚫으면 그만큼 히트가 늘고 딜도 오른다.
    expect(through['charTotals']['그레이브']).toBeGreaterThan(plain['charTotals']['그레이브']);
    expect(through['hitCount']).toBeGreaterThan(plain['hitCount']);
    // 몸통 둘보다 «몸통 하나 + 파츠 둘»이 더 많이 때린다(히트가 하나 더 많다).
    expect(through['charTotals']['그레이브']).toBeGreaterThan(twice['charTotals']['그레이브']);
    // 관통이 없는 동료는 한 자리도 안 바뀐다.
    expect(through['charTotals']['크라운']).toBe(plain['charTotals']['크라운']);
  });

  it('test_rejects_a_bad_pierce_pass', () => {
    const payload = {
      squad: ['리타'], duration: 10, enemyDef: 31_784, enemyCode: '',
      corePx: 0, hasParts: true, seed: 42,
      piercePass: { shapes: 0, parts: 0 },
    };
    expectValueError(() => run_request(dumps(payload)));
  });

  it('test_rejects_a_negative_part_break_interval', () => {
    const payload = {
      squad: ['리타'], duration: 10, enemyDef: 31_784, enemyCode: '',
      corePx: 0, hasParts: true, seed: 42, partBreakInterval: -1,
    };
    expectValueError(() => run_request(dumps(payload)));
  });

  it('test_buff_span_carries_who_actually_got_it_when_the_target_shifts', () => {
    // 대상이 발동마다 갈리는 버프는 **구간마다** 누가 받았는지 적는다.
    //
    // 리버렐리오 `차분한 수심 4`는 공격력 순위로 대상이 갈려 발동마다 사람이
    // 바뀐다. 줄 하나에 뭉쳐 두면 «둘 다 받는다»로 읽힌다.
    const payload = {
      squad: ['리틀 머메이드', '나유타', '에이다', '아인', '리버렐리오'],
      duration: 60, enemyDef: 31_784, enemyCode: '', corePx: 0,
      hasParts: false, seed: 42, rngMode: 'expected',
    };
    const got = req(payload);
    const tracks: any[] = got['timeline']['buffs'];
    const shifting = tracks.find((t) => t['name'] === '차분한 수심 4');
    expect(shifting, 'StopIteration').toBeDefined();
    expect(sorted(shifting['targets'])).toEqual(['아인', '에이다']);

    // 구간마다 대상이 하나씩 붙고, 이웃한 두 구간은 서로 다른 사람이다.
    const picked: string[][] = (shifting['spans'] as any[][])
      .filter((span) => span.length > 3)
      .map((span) => (span[3] as number[]).map((i) => shifting['targets'][i]));
    expect(picked.length).toBe(shifting['spans'].length);
    expect(picked.every((who) => who.length === 1), JSON.stringify(picked)).toBe(true);
    expect(picked[0]).not.toEqual(picked[1]);

    // 대상이 늘 같은 줄에는 구간에 붙이지 않는다 — 그쪽까지 실으면 결과가 무거워진다.
    const steady = tracks.filter((t) => (t['spans'] as any[][]).every((s) => s.length === 3));
    expect(steady.length > 0, '대상이 고정인 줄이 하나도 없다').toBe(true);
  });

  it('test_combat_power_follows_synchro_and_console', () => {
    // 전투력은 계정 육성 상태(싱크로·콘솔)에 따라 통째로 달라진다.
    //
    // 딜 계산과 **같은 값**을 받아야 화면의 두 숫자가 서로 어긋나지 않는다.
    // 안 주면 예전처럼 엔진 기본 스펙(레벨 400)으로 잰다.
    const base = { names: ['리타'] };
    const dflt = JSON.parse(run_combat_power(dumps(base)));
    const low = JSON.parse(run_combat_power(dumps({ ...base, synchroLevel: 200 })));
    const high = JSON.parse(run_combat_power(dumps({ ...base, synchroLevel: 800 })));
    expect(low['리타']).toBeLessThan(dflt['리타']);
    expect(high['리타']).toBeGreaterThan(dflt['리타']);

    // 콘솔도 기본 스탯을 올리므로 전투력이 따라 오른다.
    const boosted = JSON.parse(run_combat_power(dumps({
      ...base, synchroLevel: 200,
      console: { common_level: 300, class_level: 200, company_level: 200 },
    })));
    expect(boosted['리타']).toBeGreaterThan(low['리타']);
  });

  it('test_rejects_character_settings_outside_the_squad', () => {
    const payload = {
      squad: ['리타'],
      characters: { 라피: { cube: { name: '렐릭 베어 큐브', level: 15 } } },
      duration: 10,
      enemyDef: 31_784,
      enemyCode: '',
      corePx: 0,
      hasParts: false,
      seed: 42,
    };

    expectValueError(() => run_request(dumps(payload)), '스쿼드에 없는 캐릭터');
  });
});

/** GuiltyBunnyReleasedBridgeTest · 그것을 물려받은 SinBunnyReleasedBridgeTest(NAME만 다르다). */
function releasedBunnySuite(suiteName: string, NAME: string): void {
  describe(suiteName, () => {
    const payload = (mode: string | null = null): Record<string, any> => {
      const result: Record<string, any> = {
        squad: [NAME], duration: 8, enemyDef: 31_784,
        enemyCode: '', corePx: 0, hasParts: false, seed: 42,
      };
      if (mode !== null) {
        result['characters'] = { [NAME]: { control: { bunny_mode: mode } } };
      }
      return result;
    };

    it('test_default_engage_and_selected_stance_use_released_data', () => {
      const dflt = req(payload());
      const stance = req(payload('stance'));
      const engage = req(payload('engage'));
      expect(dflt['charTotals']).toEqual(engage['charTotals']);
      expect(engage['charTotals'][NAME]).toBeGreaterThan(0);
      expect(stance['charTotals']).not.toEqual(engage['charTotals']);
      expect(Boolean(engage['previewNote'])).toBe(false);
    });

    it('test_invalid_mode_is_rejected', () => {
      expectValueError(() => run_request(dumps(payload('both'))));
    });

    it('test_all_released_skill_levels_run_and_change_damage', () => {
      const totals: number[] = [];
      for (let level = 1; level < 11; level++) {
        const p = payload('stance');
        p['characters'][NAME]['skillLevels'] = { '1': level, '2': level, '3': level };
        const result = req(p);
        expect(Boolean(result['previewNote'])).toBe(false);
        totals.push(result['charTotals'][NAME]);
      }
      expect(totals.slice(1).every((b, i) => b > totals[i]! && totals[i]! > 0)).toBe(true);
    });
  });
}

releasedBunnySuite('GuiltyBunnyReleasedBridgeTest', '길티 : 마이티 바니');
releasedBunnySuite('SinBunnyReleasedBridgeTest', '신 : 스위프트 바니');

/** 버스트 게이지 방식 — 안 주면 신 방식(실누적), legacy면 종전 고정 시간. 타임라인에 게이지가 실린다. */
describe('BurstGaugeBridgeTest', () => {
  const PAYLOAD = {
    squad: ['크라운', '루주', '치사토'], duration: 40, enemyDef: 0, enemyCode: '',
    corePx: 0, hasParts: false, seed: 42, rngMode: 'expected', firstBurstTime: 3,
  };

  it('test_new_is_default_and_legacy_keeps_fixed_timing', () => {
    const neu = req(PAYLOAD);
    const explicit = req({ ...PAYLOAD, burstGaugeMode: 'new' });
    const legacy = req({ ...PAYLOAD, burstGaugeMode: 'legacy' });
    expect(neu['squadTotal']).toBe(explicit['squadTotal']);
    // 구 방식은 첫 버스트 시간(3초) + 반응·전환 딜레이에 시작한다. 신 방식은 게이지가 정한다.
    expect(withinDelta(legacy['timeline']['fullBurst'][0][0], 3.4, 0.3)).toBe(true);
    expect(Math.abs(neu['timeline']['fullBurst'][0][0] - legacy['timeline']['fullBurst'][0][0])).toBeGreaterThan(0.5);
    for (const result of [neu, legacy]) {
      const gauge: number[] = result['timeline']['gauge'];
      expect(gauge.length).toBe(result['timeline']['buckets']);
      expect(gauge.every((v) => v >= 0 && v <= 100)).toBe(true);
    }
    // 신 방식은 만충(100)에 닿아야 1단계다 — 칸 끝 값이라 같은 칸에서 차고 비면 100 아래로 보이지만,
    // 높이 올랐다가 **뚝 떨어지는 칸**(소모)이 있어야 한다. 구 방식은 고정 시간에 진입해 소모하므로
    // 그만큼 못 오른다.
    const gauge: number[] = neu['timeline']['gauge'];
    expect(Math.max(...gauge)).toBeGreaterThanOrEqual(80);
    expect(gauge.some((g, i) => i >= 1 && g < gauge[i - 1]! - 50), JSON.stringify(gauge)).toBe(true);
    expect(Math.max(...legacy['timeline']['gauge'])).toBeLessThan(Math.max(...gauge));
    // 점열은 프레임 단위라 만충(100)이 그대로 실리고, 바로 다음 점이 소모(0)다.
    const points: number[][] = neu['timeline']['gaugePoints'];
    expect(points.every((p) => p.length === 2 && p[1]! >= 0 && p[1]! <= 100)).toBe(true);
    expect(points.map((p) => p[0])).toEqual(sorted(points.map((p) => p[0]!)));
    const full = points.flatMap((p, i) => (p[1] === 100 ? [i] : []));
    expect(full.length > 0, JSON.stringify(points.slice(0, 20))).toBe(true);
    expect(points[full[0]! + 1]![1]).toBe(0);
    expect(points[full[0]! + 1]![0]! - points[full[0]!]![0]!).toBeLessThan(0.1);
    expect(points.length).toBeLessThanOrEqual(20_000);
    expectValueError(() => run_request(dumps({ ...PAYLOAD, burstGaugeMode: 'old' })));
  });
});

/**
 * 재생 화면의 차징 게이지 — 사격 트랙을 켜면 차지 무기의 발마다 [시작, 풀차지, 발사, 배율%, 풀차지] 기록.
 *
 * 주의: 파이썬 파일에서는 이 클래스가 `if __name__ == "__main__": unittest.main()` **뒤에** 정의돼 있어
 * 스크립트로 돌리면 한 번도 실행되지 않는다(unittest.main()이 먼저 끝낸다). 여기서는 그대로 옮겨 돌린다.
 */
describe('ChargeTrackBridgeTest', () => {
  it('test_charge_records_only_with_shot_track', () => {
    const payload = {
      squad: ['앨리스', '크라운'], duration: 20, enemyDef: 0, enemyCode: '',
      corePx: 0, hasParts: false, seed: 42, rngMode: 'expected',
    };
    const plain = req(payload);
    expect(plain).not.toHaveProperty('charges');
    const tracked = req({ ...payload, shotTrack: true });
    expect(plain['squadTotal']).toBe(tracked['squadTotal']);
    const rows: number[][] = tracked['charges']['앨리스'];
    expect(tracked['charges']).not.toHaveProperty('크라운'); // MG는 차지 무기가 아니다
    expect(rows.length > 0).toBe(true);
    for (const [start, full_at, fire, value, full] of rows as Array<[number, number, number, number, number]>) {
      expect(start).toBeLessThanOrEqual(fire);
      expect(start).toBeLessThanOrEqual(full_at);
      expect([0, 1]).toContain(full);
      // 풀차지 배율은 SR 기본 250%에 차지 대미지가 더해진 값이다.
      expect(value).toBeGreaterThanOrEqual(250);
    }
  });
});
