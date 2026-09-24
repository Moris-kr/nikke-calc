// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ammoAt, buffsOnAt, burstLogAt, burstStageAt, chargeAt, damageUntil, firingAt, fullBurstAt, gaugeAt, headBuffsAt,
  openBattleReplay, patternsAt, poseAt, SD_SPRITES, spriteFor, DEFAULT_SD,
} from './battle-replay';
import { SD_IDS } from './sd-ids';
import type { BattleTimeline, BuffTrack, ChargeRecord, DeckResultEntry, ShotTrack, SimulationRequest, SimulationResult, StateTrack } from './types';

const states: StateTrack = {
  bucket: 0.1, buckets: 50,
  chars: {
    라피: { ammo: Array.from({ length: 50 }, (_, i) => (i < 20 ? 20 - i : 999999)), reload: [[1.0, 1.5]], maxAmmo: 20 },
    크라운: { ammo: Array(50).fill(0), reload: [], maxAmmo: 0 },
  },
};
const zeros = () => Array<number>(50).fill(0);
const shots: ShotTrack = {
  bucket: 0.1, buckets: 50,
  chars: {
    라피: { normal: zeros().map((_, i) => (i === 3 || i === 30 ? 1 : 0)), skill: zeros(), core: zeros(), explode: zeros() },
    크라운: { normal: zeros(), skill: zeros(), core: zeros(), explode: zeros() },
  },
};
const timeline: BattleTimeline = {
  bucket: 1, buckets: 5,
  damage: { 라피: [100, 200, 300, 0, 0], 크라운: [0, 0, 0, 0, 0] },
  bursts: {
    라피: [{ t: 1.2, stage: '1', skill: '레드 울프' }, { t: 3.6, stage: '3', skill: '레드 울프' }],
    크라운: [{ t: 1.8, stage: '2', skill: '위드 로열티' }],
  },
  fullBurst: [[2.0, 3.0]],
  gaugePoints: [[0.5, 30], [1.0, 100], [1.017, 0], [4.0, 55]],
  buffs: [
    { name: '공격력 증가', caster: '크라운', targets: ['라피', '크라운'], stat: 'atk_pct', value: 20, maxStack: 1,
      spans: [[1.0, 2.5, 1]] },
    { name: '중첩 버프', caster: '라피', targets: ['라피', '크라운'], stat: 'crit_rate', value: 5, maxStack: 5,
      spans: [[0, 1.5, 2, [0]], [1.5, 4, 3, [0]]] },
    { name: '주목', caster: '크라운', targets: ['__enemy__'], stat: 'taunt', value: null, maxStack: 1, spans: [[1.0, 3.0, 1]] },
  ] as BuffTrack[],
};

describe('시각 → 상태', () => {
  it('게이지는 그 시각 이전 마지막 점의 값이고, 첫 점 전에는 0이다', () => {
    expect(gaugeAt(timeline.gaugePoints, 0.2)).toBe(0);
    expect(gaugeAt(timeline.gaugePoints, 0.99)).toBe(30);
    expect(gaugeAt(timeline.gaugePoints, 1.0)).toBe(100);
    expect(gaugeAt(timeline.gaugePoints, 1.02)).toBe(0);
    expect(gaugeAt(undefined, 3)).toBe(0);
  });

  it('버스트 단계 — 1버 뒤엔 II, 2버 뒤엔 III, 풀버스트는 FULL, 끝나면 다시 I', () => {
    expect(burstStageAt(timeline.bursts, timeline.fullBurst, 0.5)).toBe('I');
    expect(burstStageAt(timeline.bursts, timeline.fullBurst, 1.5)).toBe('II');
    expect(burstStageAt(timeline.bursts, timeline.fullBurst, 1.9)).toBe('III');
    expect(burstStageAt(timeline.bursts, timeline.fullBurst, 2.5)).toBe('FULL');
    expect(burstStageAt(timeline.bursts, timeline.fullBurst, 3.2)).toBe('I');
    expect(fullBurstAt(timeline.fullBurst, 3.0)).toBeNull();
  });

  it('재장전 구간이면 재장전 자세, 최근 사격이 있으면 사격 중', () => {
    expect(poseAt(states, '라피', 1.2)).toBe('reload');
    expect(poseAt(states, '라피', 1.5)).toBe('shoot');
    expect(firingAt(shots, '라피', 0.35)).toBe(true);
    expect(firingAt(shots, '라피', 1.0)).toBe(false);
    expect(firingAt(shots, '크라운', 0.35)).toBe(false);
  });

  it('장탄 — 무한 센티널은 null, 최대 장탄이 없으면 0', () => {
    expect(ammoAt(states, '라피', 0.55)).toEqual({ ammo: 15, max: 20 });
    expect(ammoAt(states, '라피', 3)).toEqual({ ammo: null, max: 20 });
    expect(ammoAt(states, '크라운', 3)).toEqual({ ammo: 0, max: 0 });
  });

  it('최대 장탄은 그 시각의 값 — 장탄 버프가 붙으면 분모도 커진다', () => {
    const track = { bucket: 1, buckets: 3, chars: { 슈가: { ammo: [9, 7, 20], reload: [], maxAmmo: 23, maxAmmoTrack: [9, 9, 23] } } } as any;
    expect(ammoAt(track, '슈가', 0)).toEqual({ ammo: 9, max: 9 });
    expect(ammoAt(track, '슈가', 2.5)).toEqual({ ammo: 20, max: 23 });
  });

  it('버스트 내역은 지금까지 쓴 것만, 시간순, 최근 N개', () => {
    const rows = burstLogAt(timeline.bursts, 2.0);
    expect(rows.map((row) => row.name)).toEqual(['라피', '크라운']);
    expect(rows[1]!.age).toBeCloseTo(0.2);
    expect(burstLogAt(timeline.bursts, 5, 2).map((row) => row.cast.t)).toEqual([1.8, 3.6]);
  });

  it('버프 — 그 시각에 그 니케가 받는 것만, 구간별 대상과 중첩을 따른다', () => {
    const lapi = buffsOnAt(timeline.buffs, '라피', 1.6);
    expect(lapi.map((row) => [row.name, row.stack])).toEqual([['공격력 증가', 1], ['중첩 버프', 3]]);
    expect(lapi[0]!.remaining).toBeCloseTo(0.9);
    // 중첩 버프는 구간 대상이 라피([0])뿐이다.
    expect(buffsOnAt(timeline.buffs, '크라운', 1.6).map((row) => row.name)).toEqual(['공격력 증가']);
    expect(buffsOnAt(timeline.buffs, '크라운', 2.6)).toEqual([]);
  });

  it('머리 위 칩 순서 — 시간 정해진 버프가 앞(기록 순서), 판 끝까지 가는 버프는 뒤', () => {
    const tracks = [
      { name: '영구', caster: '라피', targets: ['라피'], stat: null, value: null, maxStack: 1, spans: [[0, 10, 1]] },
      { name: '긴', caster: '라피', targets: ['라피'], stat: null, value: null, maxStack: 1, spans: [[0, 8, 1]] },
      { name: '짧은', caster: '크라운', targets: ['라피'], stat: null, value: null, maxStack: 3, spans: [[1, 3, 2]] },
    ] as unknown as BuffTrack[];
    expect(headBuffsAt(tracks, '라피', 2, 10).map((row) => row.name)).toEqual(['긴', '짧은', '영구']);
    // 버프 창은 여전히 남은 시간 순이다.
    expect(buffsOnAt(tracks, '라피', 2).map((row) => row.name)).toEqual(['짧은', '긴', '영구']);
  });

  it('누적 딜은 칸 안에서 고르게 들어간 것으로 본다', () => {
    expect(damageUntil(timeline, '라피', 1.5)).toBe(200);
    expect(damageUntil(timeline, '라피', 10)).toBe(600);
  });

  it('차징은 0에서 풀차지 배율(%)까지 오르고, 차지 중이 아니면 없다', () => {
    const records: ChargeRecord[] = [[1.0, 2.0, 2.4, 285, 1], [3.0, 4.0, 3.2, 285, 0]];
    expect(chargeAt(records, 0.5)).toBeNull();
    expect(chargeAt(records, 1.5)!.value).toBeCloseTo(142.5);
    expect(chargeAt(records, 2.2)).toEqual({ value: 285, full: true, max: 285 });
    expect(chargeAt(records, 2.6)).toBeNull();
    // 톡톡이 — 풀차지에 닿기 전에 쏜다.
    expect(chargeAt(records, 3.2)!.value).toBeCloseTo(57);
    expect(chargeAt(records, 3.2)!.full).toBe(false);
  });

  it('보스 패턴 — 족자·속성 저지·코어·방어력·적정거리·샷건 표적·파츠 파괴를 시각으로 읽는다', () => {
    const request: SimulationRequest = {
      squad: ['라피'], duration: 30, enemyDef: 0, enemyCode: '', corePx: 50, hasParts: false, seed: 1,
      immuneWindows: [{ from: 5, to: 8 }], elementWindows: [{ from: 10, to: 15, code: '수냉' }],
      coreWindows: [{ from: 0, to: 4 }], defenseRateWindows: [{ from: 20, to: 25, rate: 60 }],
      optimalRangeWindows: [{ from: 0, to: 30, weapons: ['AR', 'SMG'] }],
      shotgunSizeWindows: [{ from: 12, to: 13, diameter: 300 }], partBreakInterval: 10,
    };
    expect(patternsAt(request, 6)).toMatchObject({ immune: true, element: null, core: false, partBreakAge: null });
    expect(patternsAt(request, 12.5)).toMatchObject({ immune: false, element: '수냉', shotgunDiameter: 300 });
    expect(patternsAt(request, 12.5).partBreakAge).toBeCloseTo(2.5);
    expect(patternsAt(request, 2)).toMatchObject({ core: true, optimal: ['AR', 'SMG'], defenseRate: null });
    expect(patternsAt(request, 21).defenseRate).toBe(60);
    // 코어가 없는 판이면 코어는 null, 구간 없이 코어가 있으면 늘 노출.
    expect(patternsAt({ ...request, corePx: 0 }, 2).core).toBeNull();
    expect(patternsAt({ ...request, coreWindows: [] }, 20).core).toBe(true);
    // 구식은 거리가 없고 크기도 그대로다.
    expect(patternsAt(request, 2)).toMatchObject({ distance: null, scale: 1 });
  });

  it('신식 적정거리 — 거리(구간)가 적정 무기군과 보이는 크기를 정한다', () => {
    const table = {
      reference: 30, min: 5, max: 100, presets: { near: 22, mid: 30, far: 52 },
      ranges: { SG: [0, 25], SMG: [15, 35], AR: [25, 45], MG: [35, 55], SR: [45, 100] } as Record<string, [number, number]>,
    };
    const request: SimulationRequest = {
      squad: ['라피'], duration: 30, enemyDef: 0, enemyCode: '', corePx: 50, hasParts: false, seed: 1,
      rangeModel: 'distance', distance: 30, distanceWindows: [{ from: 10, to: 20, distance: 52 }],
      // 신식에서는 유효 사거리 구간을 보지 않는다.
      optimalRangeWindows: [{ from: 0, to: 30, weapons: ['RL'] }],
    };
    expect(patternsAt(request, 5, table)).toMatchObject({ distance: 30, optimal: ['SMG', 'AR'], scale: 1 });
    const far = patternsAt(request, 15, table);
    expect(far).toMatchObject({ distance: 52, optimal: ['MG', 'SR'] });
    expect(far.scale).toBeCloseTo(30 / 52);
  });

  it('이름표에 올린 니케는 전부 사격·재장전 그림 두 장을 갖는다', () => {
    for (const name of Object.keys(SD_IDS)) {
      expect(SD_SPRITES[name], name).toBeDefined();
      expect(spriteFor(name, 'shoot')).not.toBe(DEFAULT_SD.shoot);
      expect(spriteFor(name, 'reload')).not.toBe(DEFAULT_SD.reload);
    }
    expect(Object.keys(SD_IDS)).toEqual(expect.arrayContaining(['라피 : 레드 후드', '홍련 : 흑영', '렘', '아인', '스노우 화이트 : 헤비암즈', '크라운', '나유타']));
  });

  it('캐릭터별 SD가 있으면 그걸, 없으면 회색 자리표시자', () => {
    expect(spriteFor('라피 : 레드 후드', 'shoot')).not.toBe(DEFAULT_SD.shoot);
    expect(spriteFor('라피 : 레드 후드', 'reload')).not.toBe(DEFAULT_SD.reload);
    expect(spriteFor('라피', 'reload')).toBe(DEFAULT_SD.reload);
    SD_SPRITES['라피'] = { shoot: 'a.webp', reload: 'b.webp' };
    expect(spriteFor('라피', 'reload')).toBe('b.webp');
    delete SD_SPRITES['라피'];
  });
});

describe('재생 창', () => {
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

  const entry: DeckResultEntry = {
    deckId: 1,
    request: { squad: ['라피', '크라운'], duration: 5, enemyDef: 0, enemyCode: '', corePx: 0, hasParts: false, seed: 42 },
    result: { squadTotal: 600, duration: 5, hitCount: 2, charTotals: { 라피: 600, 크라운: 0 }, previewNote: '', deviations: '' },
  };
  const full: SimulationResult = { ...entry.result, timeline, shots, states };

  it('사격 기록을 켜서 다시 계산하고, SD를 누르면 그 순간의 버프 창이 열린다', async () => {
    const simulate = vi.fn().mockResolvedValue(full);
    const close = openBattleReplay(entry, '덱 1', simulate, { imageOf: () => undefined });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(simulate).toHaveBeenCalledWith({ ...entry.request, shotTrack: true });
    expect(document.querySelector<HTMLElement>('[data-replay-stage]')!.hidden).toBe(false);
    expect(document.querySelectorAll('[data-replay-slot]')).toHaveLength(2);
    // 준비되면 바로 재생한다.
    expect(document.querySelector('[data-replay-play]')!.textContent).toBe('❚❚');
    const stageEl = document.querySelector<HTMLElement>('[data-replay-stage]')!;
    expect(stageEl.classList.contains('is-paused')).toBe(false);
    // 멈추면 사격 반동 같은 반복 애니메이션도 멈춘다(is-paused), 다시 누르면 풀린다.
    document.querySelector<HTMLButtonElement>('[data-replay-play]')!.click();
    expect(stageEl.classList.contains('is-paused')).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-replay-play]')!.click();
    expect(stageEl.classList.contains('is-paused')).toBe(false);

    // 1.6초로 옮긴다.
    const scrub = document.querySelector<HTMLInputElement>('[data-replay-scrub]')!;
    scrub.value = '1.6';
    scrub.dispatchEvent(new Event('input'));
    // 1.2초에 1버만 썼다 — 다음은 2버(II).
    expect(document.querySelector('[data-replay-gauge]')!.textContent).toContain('II');
    expect(document.querySelectorAll('[data-replay-log] li')).toHaveLength(1);

    // 초상화 카드 아래 — 그때까지의 캐릭터 딜(1초 칸 안에서는 고르게).
    expect(document.querySelector('[data-replay-dealt="라피"]')!.textContent).toBe('220');
    // 적 위에 걸린 디버프 아이콘, 적을 누르면 디버프 창.
    expect([...document.querySelectorAll<HTMLElement>('[data-replay-enemy-buff]')].map((n) => n.dataset.replayEnemyBuff)).toEqual(['주목']);
    document.querySelector<HTMLButtonElement>('[data-replay-enemy]')!.click();
    const enemyPanel = document.querySelector<HTMLElement>('[data-replay-buffs]')!;
    expect(enemyPanel.classList.contains('is-enemy')).toBe(true);
    expect([...enemyPanel.querySelectorAll<HTMLElement>('[data-replay-buff]')].map((li) => li.dataset.replayBuff)).toEqual(['주목']);

    const slot = document.querySelector<HTMLButtonElement>('[data-replay-slot="라피"]')!;
    slot.click();
    const panel = document.querySelector<HTMLElement>('[data-replay-buffs]')!;
    expect(panel.hidden).toBe(false);
    expect([...panel.querySelectorAll<HTMLElement>('[data-replay-buff]')].map((li) => li.dataset.replayBuff))
      .toEqual(['공격력 증가', '중첩 버프']);

    // 재장전 구간이면 재장전 자세 그림으로 바뀐다.
    scrub.value = '1.2';
    scrub.dispatchEvent(new Event('input'));
    expect(slot.classList.contains('is-reload')).toBe(true);
    expect(slot.querySelector('img')!.getAttribute('src')).toBe(DEFAULT_SD.reload);

    // 풀버스트 구간 — 배너와 FULL.
    scrub.value = '2.2';
    scrub.dispatchEvent(new Event('input'));
    expect(document.querySelector<HTMLElement>('[data-replay-banner]')!.hidden).toBe(false);
    expect(document.querySelector('[data-replay-gauge]')!.textContent).toContain('FULL');

    // Esc는 버프 창부터 닫고, 한 번 더 누르면 재생 창을 닫는다.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.hidden).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.replay-modal')).toBeNull();

    // 다시 열면 받은 결과를 다시 쓴다.
    openBattleReplay(entry, '덱 1', simulate, { imageOf: () => undefined });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(simulate).toHaveBeenCalledTimes(1);
    close();
  });

  it('재생은 프레임마다 흐른 시간 × 배속만큼 나아가고, 끝에서 멈춘다', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.push(cb); return frames.length; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const other = { ...entry, deckId: 3 };
    openBattleReplay(other, '덱 3', vi.fn().mockResolvedValue(full), { imageOf: () => undefined });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const play = document.querySelector<HTMLButtonElement>('[data-replay-play]')!;
    const scrub = document.querySelector<HTMLInputElement>('[data-replay-scrub]')!;
    // 준비되자마자 재생이 걸려 있다 — 첫 프레임부터 흐른다.
    expect(play.textContent).toBe('❚❚');
    now += 200;
    frames.shift()!(now);
    expect(Number(scrub.value)).toBeCloseTo(0.2);
    // 배속 ×2 — 0.2초가 흐르면 0.4초 나아간다.
    document.querySelector<HTMLButtonElement>('[data-replay-speed]')!.click();
    expect(document.querySelector('[data-replay-speed]')!.textContent).toBe('×2');
    now += 200;
    frames.shift()!(now);
    expect(Number(scrub.value)).toBeCloseTo(0.6);
    // 다른 탭에 다녀와 10초가 비어도 한 프레임 몫(0.25초 × 배속)만 간다.
    now += 10_000;
    frames.shift()!(now);
    expect(Number(scrub.value)).toBeCloseTo(1.1);
    // 끝에 닿으면 멈춘다.
    scrub.value = '4.9';
    scrub.dispatchEvent(new Event('input'));
    play.click();
    now += 200;
    frames.shift()!(now);
    expect(Number(scrub.value)).toBe(5);
    expect(play.textContent).toBe('▶');
  });

  it('버프 창 ✕는 다시 그려도 같은 단추라 누르면 닫힌다 — 캐릭터 창·보스 창 모두', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    openBattleReplay({ ...entry, deckId: 4 }, '덱 4', vi.fn().mockResolvedValue(full), { imageOf: () => undefined });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const scrub = document.querySelector<HTMLInputElement>('[data-replay-scrub]')!;
    const seekTo = (time: number) => { scrub.value = String(time); scrub.dispatchEvent(new Event('input')); };
    seekTo(1.6);
    const panel = document.querySelector<HTMLElement>('[data-replay-buffs]')!;
    document.querySelector<HTMLButtonElement>('[data-replay-slot="라피"]')!.click();
    expect(panel.hidden).toBe(false);
    const x = panel.querySelector<HTMLButtonElement>('[data-replay-buffs-close]')!;
    // 재생 중처럼 한 번 더 그린다 — ✕가 새 단추로 바뀌면 누르는 사이에 클릭이 사라진다(제보).
    seekTo(1.7);
    expect(panel.querySelector('[data-replay-buffs-close]')).toBe(x);
    x.click();
    expect(panel.hidden).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-replay-enemy]')!.click();
    expect(panel.hidden).toBe(false);
    seekTo(1.8);
    panel.querySelector<HTMLButtonElement>('[data-replay-buffs-close]')!.click();
    expect(panel.hidden).toBe(true);
  });

  it('머리 위 버프 칩(중첩 수) · 탄착 필터 · 적 피격 효과', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    openBattleReplay({ ...entry, deckId: 5 }, '덱 5', vi.fn().mockResolvedValue(full), { imageOf: () => undefined });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const scrub = document.querySelector<HTMLInputElement>('[data-replay-scrub]')!;
    const seekTo = (time: number) => { scrub.value = String(time); scrub.dispatchEvent(new Event('input')); };

    // 1.6초 — 라피는 공격력 증가와 중첩 버프 ×3, 크라운은 공격력 증가만.
    seekTo(1.6);
    const chips = [...document.querySelectorAll<HTMLElement>('[data-replay-slot-buffs="라피"] [data-replay-slot-buff]')];
    expect(chips.map((chip) => [chip.dataset.replaySlotBuff, chip.querySelector('b')?.textContent ?? null]))
      .toEqual([['공격력 증가', null], ['중첩 버프', '3']]);
    expect(document.querySelectorAll('[data-replay-slot-buffs="크라운"] [data-replay-slot-buff]')).toHaveLength(1);

    // 0.35초 — 라피 평타가 맞는 칸. 피격 범위가 번쩍이고 적도 피격 상태다.
    expect(document.querySelector<HTMLElement>('[data-replay-filter]')!.hidden).toBe(false);
    seekTo(0.35);
    const hitbox = document.querySelector('.br-hitbox')!;
    const enemyImage = document.querySelector('.br-enemy')!;
    expect(hitbox.classList.contains('is-hit')).toBe(true);
    expect(enemyImage.classList.contains('is-hit')).toBe(true);
    // 라피 탄착을 끄면 보이는 탄이 없다 — 번쩍이지 않는다.
    const lapi = document.querySelector<HTMLButtonElement>('[data-replay-filter-char="라피"]')!;
    const all = document.querySelector<HTMLButtonElement>('[data-replay-filter-all]')!;
    lapi.click();
    expect(lapi.getAttribute('aria-pressed')).toBe('false');
    expect(all.getAttribute('aria-pressed')).toBe('false');
    expect(hitbox.classList.contains('is-hit')).toBe(false);
    expect(enemyImage.classList.contains('is-hit')).toBe(false);
    // 전체로 다시 켠다. 평타 종류를 끄면 역시 없다(라피는 코어 아닌 평타만 쐈다), 코어만 꺼서는 그대로다.
    all.click();
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect(hitbox.classList.contains('is-hit')).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-replay-filter-kind="core"]')!.click();
    expect(hitbox.classList.contains('is-hit')).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-replay-filter-kind="normal"]')!.click();
    expect(hitbox.classList.contains('is-hit')).toBe(false);
  });

  it('계산이 실패하면 무대 대신 사유를 적는다', async () => {
    const other = { ...entry, deckId: 2 };
    openBattleReplay(other, '덱 2', vi.fn().mockRejectedValue(new Error('워커 오류')), { imageOf: () => undefined });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-replay-status]')!.textContent).toContain('워커 오류');
    expect(document.querySelector<HTMLElement>('[data-replay-stage]')!.hidden).toBe(true);
  });
});
