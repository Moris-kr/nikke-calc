// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mountBossMaker } from './boss-maker-view';
import type { BattleSettings, SettingsCatalog, SimulationResult } from './types';

const settings = {
  characters: {
    리타: { weaponType: 'SMG' },
    크라운: { weaponType: 'MG' },
  },
  weaponTypes: ['AR', 'SMG', 'SG', 'MG', 'SR', 'RL'],
  optimalRangeWeapons: ['AR', 'SMG', 'SG', 'MG', 'SR'],
  normalHitCoeff: {},
  accuracy: {
    modelN: 2.55,
    weapons: {
      SMG: { baseDiameter: 110, accSlope: 1 },
      MG: { baseDiameter: 10, accSlope: 0 },
    },
  },
} as unknown as SettingsCatalog;

const battle = (): BattleSettings => ({
  duration: 180, synchroLevel: 400, enemyDef: 31_784, enemyCode: '',
  coreEnabled: false, corePx: 52, hasParts: false, seed: 42,
  optimalRangeWeapons: [], normalHitCoeff: {}, immuneWindows: [], elementWindows: [],
  rngMode: 'expected', immuneBlocksBurst: true,
  console: { common_level: 180, class_level: {}, company_level: {} },
  burstRegenTime: 2, burstReaction: 0.05,
});

const result = (): SimulationResult => ({
  squadTotal: 1_800_000, duration: 180, hitCount: 120,
  charTotals: { 리타: 1_000_000, 크라운: 800_000 },
  previewNote: '', deviations: '',
  shots: {
    bucket: 0.1, buckets: 1800,
    chars: {
      리타: {
        normal: Array.from({ length: 1800 }, (_, i) => (i % 3 === 0 ? 1 : 0)),
        skill: new Array(1800).fill(0),
        core: new Array(1800).fill(0),
        explode: new Array(1800).fill(0),
      },
      크라운: {
        normal: new Array(1800).fill(1),
        skill: new Array(1800).fill(0),
        core: new Array(1800).fill(1),
        explode: new Array(1800).fill(0),
      },
    },
  },
} as unknown as SimulationResult);

let host: HTMLElement;
let applied: BattleSettings;
let sent: unknown = null;

const mount = () => {
  applied = battle();
  return mountBossMaker(host, {
    settings,
    catalog: [],
    simulate: async (request) => { sent = request; return result(); },
    currentSquad: () => ['리타', '크라운'],
    currentCharacters: () => ({}),
    currentBattle: () => applied,
    applyBattle: (next) => { applied = next; },
    imageOf: () => undefined,
    storage: () => localStorage,
  });
};

/** 도구를 고르고 무대를 눌러 하나 놓는다. jsdom에는 좌표가 없어 자리는 보지 않는다. */
const placeWith = (tool: string) => {
  host.querySelector<HTMLButtonElement>(`[data-bm-place="${tool}"]`)!.click();
  host.querySelector('[data-bm-stage]')!
    .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
};

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  host.remove();
  vi.unstubAllGlobals();
});

describe('보스 메이커 화면', () => {
  it('닫힌 채로 붙고, 열면 무대와 도구가 선다', () => {
    const handle = mount();
    expect(host.hidden).toBe(true);
    handle.open();
    expect(host.hidden).toBe(false);
    expect(host.querySelectorAll('[data-bm-place]')).toHaveLength(6);
    expect(host.querySelector('[data-bm-stage]')).not.toBeNull();
    handle.close();
    expect(host.hidden).toBe(true);
  });

  it('코어와 파츠를 놓으면 전투 조건에 그 값이 실린다', () => {
    const handle = mount();
    handle.open();
    // 코어도 중앙도 없을 때는 겨냥할 자리가 없다고 알린다.
    expect(host.querySelector<HTMLElement>('[data-bm-center-warn]')!.hidden).toBe(false);

    placeWith('core');
    placeWith('part');
    expect(host.querySelector<HTMLElement>('[data-bm-center-warn]')!.hidden).toBe(true);

    host.querySelector<HTMLButtonElement>('[data-bm-apply]')!.click();
    // 그림에서 뽑아 낸 것만 넘어간다 — 코어 직경과 파츠 유무다.
    expect(applied.coreEnabled).toBe(true);
    expect(applied.corePx).toBe(52);
    expect(applied.hasParts).toBe(true);
  });

  it('타임라인을 구성하면 그림에서 뽑은 값으로 계산을 부른다', async () => {
    const handle = mount();
    handle.open();
    placeWith('core');
    placeWith('part');

    host.querySelector<HTMLButtonElement>('[data-bm-run]')!.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    const request = sent as Record<string, unknown>;
    expect(request.squad).toEqual(['리타', '크라운']);
    expect(request.corePx).toBe(52);
    expect(request.hasParts).toBe(true);
    // 사격 트랙을 켜야 «누가 언제 쏘는지»가 온다.
    expect(request.shotTrack).toBe(true);
    // 니케마다 한 줄씩 선다.
    expect(host.querySelectorAll('canvas.bm-shot')).toHaveLength(2);
    expect(host.querySelector('[data-bm-run-note]')!.textContent).toContain('2명');
  });

  it('구간을 더하면 타임라인에 끌 수 있는 띠로 선다', () => {
    const handle = mount();
    handle.open();
    const [immune, element] = [...host.querySelectorAll<HTMLButtonElement>('.bm-phase-head .bm-chip')];
    immune!.click();
    element!.click();

    expect(applied.immuneWindows).toHaveLength(1);
    expect(applied.elementWindows).toHaveLength(1);
    const bars = [...host.querySelectorAll('.bm-bar')].map((bar) => bar.textContent);
    expect(bars[0]).toContain('족자');
    expect(bars[1]).toContain('풍압');
  });

  it('좁은 화면에서는 구성이 안 된다고 먼저 말한다', () => {
    // 계산은 어디서든 되지만 구성은 무대와 판이 나란히 서야 한다.
    vi.stubGlobal('innerWidth', 800);
    const handle = mount();
    handle.open();
    expect(host.querySelector<HTMLElement>('[data-bm-narrow]')!.hidden).toBe(false);
    expect(host.querySelector('[data-bm-narrow]')!.textContent).toContain('계산은 모바일에서도');
  });

  it('저장본을 여러 벌 두고 목록에서 오간다', () => {
    const handle = mount();
    handle.open();
    placeWith('circle');

    const picker = () => host.querySelector<HTMLSelectElement>('[data-bm-picker]')!;
    expect(picker().options).toHaveLength(1);

    host.querySelector<HTMLButtonElement>('[data-bm-new]')!.click();
    expect(picker().options).toHaveLength(2);
    // 새 판은 비어 있다 — 앞 보스의 도형이 따라오지 않는다.
    expect(host.querySelectorAll('.bm-shape')).toHaveLength(0);

    // 목록에서 첫 보스로 돌아가면 그려 둔 것이 그대로 있다.
    const first = picker().options[0]!.value;
    picker().value = first;
    picker().dispatchEvent(new Event('change', { bubbles: true }));
    expect(host.querySelectorAll('.bm-shape')).toHaveLength(1);
  });

  it('복제는 통째로 베끼고, 지우면 목록에서 빠진다', () => {
    const handle = mount();
    handle.open();
    placeWith('part');
    host.querySelector<HTMLButtonElement>('[data-bm-copy]')!.click();

    const picker = host.querySelector<HTMLSelectElement>('[data-bm-picker]')!;
    expect(picker.options).toHaveLength(2);
    expect([...picker.options].map((o) => o.textContent)).toContain('새 보스 사본');
    expect(host.querySelectorAll('.bm-part')).toHaveLength(1);

    host.querySelector<HTMLButtonElement>('[data-bm-drop]')!.click();
    expect(host.querySelector<HTMLSelectElement>('[data-bm-picker]')!.options).toHaveLength(1);
  });

  it('코드로 내보내고, 받은 코드는 새 저장본으로 들어온다', () => {
    const handle = mount();
    handle.open();
    placeWith('core');
    placeWith('part');

    const share = host.querySelector<HTMLElement>('[data-bm-share]')!;
    expect(share.hidden).toBe(true);
    host.querySelector<HTMLButtonElement>('[data-bm-share-open]')!.click();
    expect(share.hidden).toBe(false);

    const code = host.querySelector<HTMLTextAreaElement>('[data-bm-share-out]')!.value;
    expect(code.startsWith('NK5-')).toBe(true);

    host.querySelector<HTMLTextAreaElement>('[data-bm-share-in]')!.value = code;
    host.querySelector<HTMLButtonElement>('[data-bm-share-apply]')!.click();

    // 받은 것은 새 저장본이라 원래 보스가 그대로 남는다.
    expect(host.querySelector<HTMLSelectElement>('[data-bm-picker]')!.options).toHaveLength(2);
    expect(host.querySelector('[data-bm-share-msg]')!.textContent).toContain('새 저장본으로 받았습니다');
    expect(host.querySelectorAll('.bm-part')).toHaveLength(1);
    expect(host.querySelector('.bm-core')).not.toBeNull();
  });

  it('잘못된 코드는 그 줄에서 알리고 그리던 것을 건드리지 않는다', () => {
    const handle = mount();
    handle.open();
    placeWith('circle');

    host.querySelector<HTMLButtonElement>('[data-bm-share-open]')!.click();
    host.querySelector<HTMLTextAreaElement>('[data-bm-share-in]')!.value = 'NK3-abcd';
    host.querySelector<HTMLButtonElement>('[data-bm-share-apply]')!.click();

    expect(host.querySelector('[data-bm-share-msg]')!.textContent).toContain('«NK5-»로 시작');
    expect(host.querySelector<HTMLSelectElement>('[data-bm-picker]')!.options).toHaveLength(1);
    expect(host.querySelectorAll('.bm-shape')).toHaveLength(1);
  });

  it('재생 단추가 커서를 실제 시간대로 흘린다', async () => {
    // 프레임은 시험이 손으로 돌린다 — jsdom에는 화면이 없어 rAF가 오지 않는다.
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => { frame = null; });
    let now = 0;
    vi.stubGlobal('performance', { now: () => now });

    const handle = mount();
    handle.open();
    // 돌려 본 적이 없으면 흘릴 시간이 없다 — 단추가 잠겨 있다.
    expect(host.querySelector<HTMLButtonElement>('[data-bm-play]')!.disabled).toBe(true);

    host.querySelector<HTMLButtonElement>('[data-bm-run]')!.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    const play = () => host.querySelector<HTMLButtonElement>('[data-bm-play]')!;
    const clock = () => host.querySelector('[data-bm-clock]')!.textContent;
    expect(play().disabled).toBe(false);
    play().click();
    expect(play().textContent).toBe('❚❚');

    // 0.2초가 흐르면 ×2 속도로 0.4초를 간다.
    now = 200;
    frame!(now);
    expect(clock()).toBe('0.4초');

    // 탭을 오래 비웠다 돌아와도 한 프레임 몫(0.25초 × 2배 = 0.5초)만 흐른다 —
    // 안 자르면 돌아오는 순간 재생 헤드가 몇십 초를 건너뛴다.
    now = 60_000;
    frame!(now);
    expect(clock()).toBe('0.9초');

    play().click();
    expect(play().textContent).toBe('▶');
    // 멈춘 뒤에는 프레임이 와도 움직이지 않는다.
    expect(frame).toBeNull();
  });

  it('시간 줄이 족자보다 위에 선다', () => {
    const handle = mount();
    handle.open();
    const names = [...host.querySelectorAll('.bm-track .bm-track-name')]
      .map((node) => node.textContent?.trim() ?? '');
    // 아래 줄들이 모두 이 시각을 기준으로 읽히므로 맨 위여야 한다.
    expect(names[0]).toContain('초');
    expect(names[1]).toBe('족자');
    expect(names[2]).toBe('속저');
  });

  it('그린 것은 저장돼 다시 열어도 남는다', () => {
    const first = mount();
    first.open();
    placeWith('circle');
    placeWith('part');
    first.close();

    host.replaceChildren();
    const again = mount();
    again.open();
    expect(host.querySelectorAll('.bm-shape')).toHaveLength(1);
    expect(host.querySelectorAll('.bm-part')).toHaveLength(1);
  });
});
