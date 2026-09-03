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
  states: {
    bucket: 0.1, buckets: 1800,
    chars: {
      리타: { ammo: new Array(1800).fill(30), reload: [[5, 7]], maxAmmo: 60 },
      // 나유타처럼 버스트 동안만 무한인 니케 — 그 구간이 지나면 평범한 탄창으로 돌아온다.
      크라운: {
        ammo: Array.from({ length: 1800 }, (_, at) => (at < 100 ? 999_998 : 40)),
        reload: [], maxAmmo: 60,
      },
    },
  },
  timeline: { bucket: 1, buckets: 180, damage: {}, bursts: {}, fullBurst: [[10, 20]] },
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
    expect(bars[0]).toContain('10–15초');
    expect(bars[1]).toContain('10–15초');
  });

  it('속저 속성은 적 코드로 열리고, 띠 안에서 바꾼다', () => {
    // 철갑 보스의 속저는 철갑 속저다 — 매번 손으로 고르게 두면 그것부터 틀린다.
    applied = { ...battle(), enemyCode: '철갑' };
    const handle = mountBossMaker(host, {
      settings,
      catalog: [],
      simulate: async () => result(),
      currentSquad: () => ['리타'],
      currentCharacters: () => ({}),
      currentBattle: () => applied,
      applyBattle: (next) => { applied = next; },
      imageOf: () => undefined,
      storage: () => localStorage,
    });
    handle.open();

    const [, element] = [...host.querySelectorAll<HTMLButtonElement>('.bm-phase-head .bm-chip')];
    element!.click();
    expect(applied.elementWindows[0]!.code).toBe('철갑');

    const pick = host.querySelector<HTMLSelectElement>('.bm-bar-code')!;
    expect(pick.value).toBe('철갑');
    pick.value = '수냉';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    expect(applied.elementWindows[0]!.code).toBe('수냉');
  });

  it('도형을 돌리면 그림도 함께 돌아간다', () => {
    // 판정만 돌리고 그림을 그대로 두면 «눌러야 잡히는 자리»와 보이는 자리가 어긋난다.
    const handle = mount();
    handle.open();
    placeWith('rect');
    const rotation = [...host.querySelectorAll('.bm-row')]
      .find((row) => row.textContent?.startsWith('기울기'))!
      .querySelector<HTMLInputElement>('.bm-field')!;
    rotation.value = '30';
    rotation.dispatchEvent(new Event('change', { bubbles: true }));

    expect(host.querySelector('.bm-shape')!.getAttribute('transform')).toMatch(/^rotate\(30 /);
    // 기울기 고리도 함께 돈다 — 안 돌면 모서리와 손잡이가 따로 논다.
    expect(host.querySelector('[data-bm-spin]')).not.toBeNull();
  });

  it('도형에 적정거리를 걸면 그 무기군이 계산으로 넘어간다', async () => {
    const handle = mount();
    handle.open();
    placeWith('center');
    placeWith('circle');

    const chips = [...host.querySelectorAll<HTMLButtonElement>('.bm-chip.range')];
    chips.find((chip) => chip.textContent === 'SG')!.click();
    chips.find((chip) => chip.textContent === 'MG')!.click();

    host.querySelector<HTMLButtonElement>('[data-bm-run]')!.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    // 겹쳐도 합집합이지 덧셈이 아니다 — 무기군마다 한 번만 붙는다.
    expect((sent as Record<string, unknown>).optimalRangeWeapons).toEqual(['MG', 'SG']);
  });

  it('니케를 감추면 무대와 타임라인에서 함께 빠진다', async () => {
    const handle = mount();
    handle.open();
    placeWith('core');
    host.querySelector<HTMLButtonElement>('[data-bm-run]')!.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(host.querySelectorAll('canvas.bm-shot')).toHaveLength(2);
    expect(host.querySelectorAll('.bm-spread')).toHaveLength(2);

    const faces = [...host.querySelectorAll<HTMLButtonElement>('.bm-face')];
    expect(faces).toHaveLength(2);
    faces[0]!.click();

    expect(host.querySelectorAll('canvas.bm-shot')).toHaveLength(1);
    expect(host.querySelectorAll('.bm-spread')).toHaveLength(1);
    // 전부 되돌리는 단추는 감춘 사람이 있을 때만 나온다.
    host.querySelector<HTMLButtonElement>('.bm-face-all')!.click();
    expect(host.querySelectorAll('canvas.bm-shot')).toHaveLength(2);
    expect(host.querySelector('.bm-face-all')).toBeNull();
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

    // 공들여 그린 보스라 한 번으로는 안 지워진다 — 두 번 눌러야 터진다.
    host.querySelector<HTMLButtonElement>('[data-bm-drop]')!.click();
    expect(host.querySelector<HTMLSelectElement>('[data-bm-picker]')!.options).toHaveLength(2);
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

  it('시간 줄이 맨 위, 그다음이 조준·족자·속저다', () => {
    const handle = mount();
    handle.open();
    const names = [...host.querySelectorAll('.bm-track .bm-track-name')]
      .map((node) => node.textContent?.trim() ?? '');
    // 아래 줄들이 모두 이 시각을 기준으로 읽히므로 시간이 맨 위여야 한다.
    expect(names[0]).toContain('초');
    expect(names[1]).toContain('조준');
    expect(names[2]).toBe('족자');
    expect(names[3]).toBe('속저');
  });

  it('캐릭터별 탄환과 상태가 오른쪽 아래에 선다', async () => {
    const handle = mount();
    handle.open();
    host.querySelector<HTMLButtonElement>('[data-bm-run]')!.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    const rows = [...host.querySelectorAll('.bm-state-row')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('30');
    expect(rows[0]!.textContent).toContain('/60');
    // 무한 장탄은 숫자 대신 기호로 — 999,998발이라고 적으면 읽는 사람이 멈칫한다.
    expect(rows[1]!.textContent).toContain('∞');
    expect(rows[1]!.textContent).not.toContain('999');
  });

  it('무한 장탄이 버스트가 끝난 뒤까지 남지 않는다', async () => {
    // 「한 번이라도 무한이었나」로 보면 8초짜리 버스트(나유타 「기억 연소」)가 끝난
    // 뒤에도 판 내내 ∞로 남는다 — 그때그때의 값으로 갈라야 한다.
    const handle = mount();
    handle.open();
    host.querySelector<HTMLButtonElement>('[data-bm-run]')!.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    const ammo = () => host.querySelectorAll('.bm-state-row')[1]!.textContent ?? '';
    expect(ammo()).toContain('∞');

    // 무한 구간(0~10초) 뒤로 커서를 옮기면 평범한 탄창으로 돌아온다.
    const lane = host.querySelector<HTMLElement>('[data-bm-time-lane]')!;
    lane.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 999 }));
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(ammo()).not.toContain('∞');
    expect(ammo()).toContain('40');
    expect(ammo()).toContain('/60');
  });

  it('조준 키프레임을 찍고 타임라인에서 옮긴다', () => {
    const handle = mount();
    handle.open();
    // 「+」를 눌러 찍기 모드로 들어간 뒤 무대를 누른다.
    host.querySelector<HTMLButtonElement>('.bm-track-name.aim .bm-mini')!.click();
    host.querySelector('[data-bm-stage]')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));

    const saved = JSON.parse(localStorage.getItem('nikke-boss-library-v1')!) as
      { designs: Array<{ aimKeys?: Array<{ t: number }> }> };
    expect(saved.designs[0]!.aimKeys).toHaveLength(1);
    expect(saved.designs[0]!.aimKeys![0]!.t).toBe(0);
    // 타임라인에도 점으로 선다.
    expect(host.querySelectorAll('.bm-aim-mark')).toHaveLength(1);

    // 두 번 누르면 지운다.
    host.querySelector('.bm-aim-mark')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(host.querySelectorAll('.bm-aim-mark')).toHaveLength(0);
  });

  it('타임라인 묶음을 접었다 편다', async () => {
    const handle = mount();
    handle.open();
    placeWith('part');
    host.querySelector<HTMLButtonElement>('[data-bm-run]')!.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    const groups = () => [...host.querySelectorAll<HTMLButtonElement>('.bm-group')]
      .map((node) => node.textContent ?? '');
    expect(groups().some((text) => text.includes('보스 상태'))).toBe(true);
    expect(groups().some((text) => text.includes('파츠'))).toBe(true);
    expect(host.querySelectorAll('canvas.bm-shot')).toHaveLength(2);

    // 「니케 사격」을 접으면 그 줄들만 사라진다.
    const squadGroup = [...host.querySelectorAll<HTMLButtonElement>('.bm-group')]
      .find((node) => node.textContent?.includes('니케 사격'))!;
    squadGroup.click();
    expect(host.querySelectorAll('canvas.bm-shot')).toHaveLength(0);
    // 접어도 머리는 남아 다시 펼 수 있다.
    const again = [...host.querySelectorAll<HTMLButtonElement>('.bm-group')]
      .find((node) => node.textContent?.includes('니케 사격'))!;
    expect(again.getAttribute('aria-expanded')).toBe('false');
    again.click();
    expect(host.querySelectorAll('canvas.bm-shot')).toHaveLength(2);
  });

  it('파츠 구간을 여러 개 둔다', () => {
    const handle = mount();
    handle.open();
    placeWith('part');

    const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('.bm-when .bm-chip')];
    const savedPart = () => (JSON.parse(localStorage.getItem('nikke-boss-library-v1')!) as
      { designs: Array<{ parts: Array<{ windows?: Array<[number, number]> }> }> })
      .designs[0]!.parts[0]!;

    // 구간이 없으면 늘 보인다.
    expect(savedPart().windows).toBeUndefined();

    buttons().find((b) => b.textContent === '구간 추가')!.click();
    expect(savedPart().windows).toHaveLength(1);
    buttons().find((b) => b.textContent === '구간 추가')!.click();
    // 같은 자리에 또 더해도 줄이 하나 더 선다 — 겹쳐 적는 것을 막지 않는다.
    expect(savedPart().windows).toHaveLength(2);
    // 띠도 구간 수만큼 선다.
    expect(host.querySelectorAll('.bm-bar.is-part')).toHaveLength(2);

    buttons().find((b) => b.textContent === '전부 지우기')!.click();
    expect(savedPart().windows).toBeUndefined();
  });

  it('만드는 중이라는 안내와 피드백 길을 낸다', () => {
    // 쓰는 사람이 알려 주지 않으면 무엇이 불편한지 알 길이 없다.
    let opened = 0;
    const handle = mountBossMaker(host, {
      settings,
      catalog: [],
      simulate: async () => result(),
      currentSquad: () => ['리타'],
      currentCharacters: () => ({}),
      currentBattle: () => applied,
      applyBattle: (next) => { applied = next; },
      imageOf: () => undefined,
      storage: () => localStorage,
      openFeedback: () => { opened += 1; },
    });
    handle.open();

    const callout = host.querySelector('.bm-callout')!;
    expect(callout.textContent).toContain('한창 개발중이기에 많은 피드백이 필요합니다');
    expect(callout.textContent).toContain('피드백 기능을 활용해주세요');

    // 피드백 창은 이 화면 바깥이라, 누르면 창을 닫고 그쪽을 연다.
    host.querySelector<HTMLButtonElement>('[data-bm-feedback]')!.click();
    expect(opened).toBe(1);
    expect(host.hidden).toBe(true);
  });

  it('안내는 닫으면 다시 뜨지 않는다', () => {
    // 같은 말을 매번 읽히는 것은 안내가 아니라 소음이다.
    const first = mount();
    first.open();
    expect(host.querySelector<HTMLElement>('.bm-callout')!.hidden).toBe(false);
    host.querySelector<HTMLButtonElement>('[data-bm-callout-close]')!.click();
    expect(host.querySelector<HTMLElement>('.bm-callout')!.hidden).toBe(true);

    // 다시 열어도 닫힌 채다.
    host.replaceChildren();
    const again = mount();
    again.open();
    expect(host.querySelector<HTMLElement>('.bm-callout')!.hidden).toBe(true);
  });

  it('족자·속저 구간에는 무대에 무슨 구간인지 적는다', () => {
    // 족자에는 보스가 사라져 무대가 텅 빈다.
    const handle = mount();
    applied = { ...battle(), immuneWindows: [{ from: 0, to: 10 }] };
    handle.open();
    expect(host.querySelector('.bm-phase-mark')?.textContent).toBe('족자');
    expect(host.querySelector('.bm-phase-sub')?.textContent).toContain('평타가 빗나갑니다');

    applied = { ...battle(), elementWindows: [{ from: 0, to: 10, code: '철갑' }] };
    handle.open();
    expect(host.querySelector('.bm-phase-mark')?.textContent).toBe('속저 · 철갑');

    // 둘이 겹치면 둘 다 적는다 — 족자만 적으면 속저가 걸린 줄 모른다.
    applied = {
      ...battle(),
      immuneWindows: [{ from: 0, to: 10 }],
      elementWindows: [{ from: 0, to: 10, code: '철갑' }],
    };
    handle.open();
    expect(host.querySelector('.bm-phase-mark')?.textContent).toContain('족자');
    expect(host.querySelector('.bm-phase-mark')?.textContent).toContain('속저 · 철갑');
  });

  it('피드백 길이 없는 빌드에서는 단추를 안 낸다', () => {
    // 공유 서버 주소가 없으면 피드백 창 자체가 없다 — 누를 수 없는 단추를 남기지 않는다.
    const handle = mount();
    handle.open();
    expect(host.querySelector<HTMLElement>('[data-bm-feedback]')!.hidden).toBe(true);
    expect(host.querySelector('.bm-callout')!.textContent).toContain('피드백');
  });

  it('사용설명서를 i 단추로 연다', () => {
    const handle = mount();
    handle.open();
    const help = () => host.querySelector<HTMLElement>('[data-bm-help]')!;
    expect(help().hidden).toBe(true);

    host.querySelector<HTMLButtonElement>('[data-bm-help-open]')!.click();
    expect(help().hidden).toBe(false);
    // 실제로 쓰는 법이 적혀 있어야 한다 — 목차만 있으면 설명서가 아니다.
    expect(help().textContent).toContain('3번 칸');
    expect(help().textContent).toContain('Shift');
    expect(help().textContent).toContain('파괴 점수');

    host.querySelector<HTMLButtonElement>('[data-bm-help-close]')!.click();
    expect(help().hidden).toBe(true);
  });

  it('파츠는 깨진 뒤 회색으로 물러나고, 점수가 총합에 더해진다', async () => {
    const handle = mount();
    handle.open();
    placeWith('part');

    // 체력과 점수를 준다.
    const rows = [...host.querySelectorAll('.bm-row')];
    const field = (label: string) => rows.find((row) => row.textContent?.startsWith(label))!
      .querySelector<HTMLInputElement>('.bm-field')!;
    const setField = (label: string, value: string) => {
      const input = field(label);
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setField('파츠 체력', '1000000');
    setField('파괴 점수', '5000000');

    host.querySelector<HTMLButtonElement>('[data-bm-run]')!.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    // 스쿼드 딜 1.8억/180초 = 100만/초 → 100만 체력은 1초에 깨진다.
    expect(host.querySelector('[data-bm-run-note]')!.textContent).toContain('파괴 점수');
    // 커서가 0초면 아직 안 깨졌다.
    expect(host.querySelector('.bm-part')!.classList.contains('is-broken')).toBe(false);

    const lane = host.querySelector<HTMLElement>('[data-bm-time-lane]')!;
    lane.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 999 }));
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(host.querySelector('.bm-part')!.classList.contains('is-broken')).toBe(true);
    // 깨진 뒤에는 점수가 오른쪽 위 총합에 얹힌다.
    expect(host.querySelector('.bm-hud-row.is-score')).not.toBeNull();
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

  it('레이어 목록에서 짚어 고르고 차례를 바꾼다', () => {
    const handle = mount();
    handle.open();
    placeWith('circle');
    placeWith('rect');

    const rows = [...host.querySelectorAll<HTMLElement>('[data-bm-layer]')];
    // 목록은 «맨 위에 그려지는 것»이 맨 위다 — 나중에 놓은 네모가 위다.
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('네모');
    expect(rows[1]!.textContent).toContain('원');

    // 짚으면 그것이 고른 것이 된다(손잡이가 붙는다).
    rows[1]!.querySelector<HTMLButtonElement>('.bm-layer-pick')!.click();
    expect(host.querySelector('[data-bm-layer].is-on')?.textContent).toContain('원');

    // 위로 올리면 차례가 뒤집힌다.
    host.querySelectorAll<HTMLButtonElement>('[data-bm-layer] .bm-layer-move')[2]!.click();
    const after = [...host.querySelectorAll<HTMLElement>('[data-bm-layer]')];
    expect(after[0]!.textContent).toContain('원');
  });

  it('격자를 켜면 눈금이 무대에 깔린다', () => {
    const handle = mount();
    handle.open();
    expect(host.querySelectorAll('.bm-grid-line')).toHaveLength(0);

    const grid = host.querySelector<HTMLInputElement>('[data-bm-grid]')!;
    grid.checked = true;
    grid.dispatchEvent(new Event('change', { bubbles: true }));
    expect(host.querySelectorAll('.bm-grid-line').length).toBeGreaterThan(10);
    // 숫자도 함께 — 「구석에 기준이 될 만한 것」이 이것이다.
    expect(host.querySelectorAll('.bm-grid-mark').length).toBeGreaterThan(0);
  });

  it('확대하면 보는 창이 좁아지고, 맞춤이 되돌린다', () => {
    const handle = mount();
    handle.open();
    const stage = host.querySelector<SVGSVGElement>('[data-bm-stage]')!;
    const box = () => stage.getAttribute('viewBox')!.split(' ').map(Number);
    const [, , w0] = box();

    host.querySelector<HTMLButtonElement>('[data-bm-zoom="in"]')!.click();
    expect(box()[2]).toBeLessThan(w0!);
    expect(host.querySelector('[data-bm-zoom-label]')?.textContent).not.toBe('100%');

    host.querySelector<HTMLButtonElement>('[data-bm-zoom="reset"]')!.click();
    expect(box()[2]).toBe(w0);
    expect(host.querySelector('[data-bm-zoom-label]')?.textContent).toBe('100%');
  });
});
