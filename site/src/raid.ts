/**
 * 계산기 레이드 (BETA) — 어드민이 올린 전투 조건 하나로 모두가 다섯 덱을 돌려 겨룬다.
 *
 * 무엇이 고정이고 무엇이 내 것인가
 * ------------------------------
 * * **전투 조건**은 어드민의 코드(NK3) 그대로다. 싱크로는 코드에 없는 값이라 **400으로
 *   못 박는다** — 계정 레벨이 아니라 덱과 육성을 겨루는 판이다. **콘솔은 내 계정 값**을
 *   쓴다(블라블라링크로 받아 둔 것) — 콘솔은 육성의 일부라 로스터와 같은 편에 선다.
 * * **육성**은 블라블라링크로 받은 로스터 그대로다. 덱에서 손으로 만진 수치 설정은
 *   **안 본다** — 그래야 같은 계정이면 어디서 돌려도 같은 값이 나온다. 로스터에 없는
 *   니케(안 가진 니케)는 세울 수 없다 — 기본 스펙으로 세우면 «내 계정»이 아니다.
 * * 예외는 **큐브**와 **버스트 순서**다. 둘은 육성이 아니라 «운용»이라 내 것으로 둔다.
 *   컨트롤(톡톡이·장전컨·버스트 운용)은 뺀다 — 조건이 늘수록 어드민 재검증이 무거워진다.
 * * 임시(프리뷰) 니케는 못 세운다. 창작 수치로 겨루는 것은 겨루는 것이 아니다.
 *
 * 남에게 보이는 것은 순위·덱·딜뿐이다. 누구인지는 서버가 애초에 내보내지 않는다(어드민만
 * 본다). 기록은 계정당 하나, 더 높을 때만 갈아 끼운다. 자기 기록을 지우는 길은 없다.
 */

import { emptyConsole } from './blablalink';
import { cubeLine } from './cube-names';
import { cycleLine, sequenceForDeck } from './burst-order';
import { t } from './i18n';
import { DEFAULT_SYNCHRO_LEVEL, requestForDeck } from './model';
import { isCancelled } from './worker-client';
import type {
  RaidBoard, RaidControl, RaidDeck, RaidEntry, RaidEntryInput, RaidMigrateEntry, RaidRecalcEntry, RaidSummary, ShareServer,
} from './share-server';
import { decodeBattleCode, encodeBattleCode, encodeShareCode, type BattleShare } from './share-code';
import type {
  BattleSettings, CharacterMeta, CharacterOverrides, DeckResultEntry, DeckState, SimulationRequest, SimulationResult,
} from './types';

export type { RaidControl } from './share-server';

/**
 * 알고리즘이 바뀌면 딜이 함께 움직인다. 그때 어떻게 하는지를 판에 적어 둔다 — 랭킹이
 * 갑자기 내려갔을 때 「내가 뭘 잘못했나」가 아니라 「엔진이 바뀌었구나」로 읽히게.
 */
export const RAID_ALGORITHM_NOTE = '계산기 알고리즘 변경 등으로 딜이 하락하는 것이 확인될 경우, 기존 레이드는 닫으며 새 시즌으로 다시 엽니다. 알고리즘 변경으로 딜이 상승되는 경우에는 그대로 진행합니다.';

/**
 * 콘솔을 못 받은 계정에 주는 말. 블라블라링크는 전초기지(콘솔)를 비공개로 두면 안 내준다 —
 * 그때 화면의 콘솔 값으로 대신 돌리면 그 기록은 그 계정의 것이 아니다. 올리지 않는다.
 */
export const RAID_CONSOLE_MISSING = '블라블라링크에서 콘솔(전초기지) 정보를 받지 못했습니다 — 콘솔 없이는 기록을 올릴 수 없습니다. 블라블라링크 프로필의 보안 설정에서 전초기지를 공개로 바꾼 뒤 「블라블라링크 연동」을 다시 눌러 주세요.';

/** 편성 카드에 붙는 잠금 안내. 레이드 탭이 켜져 있는 동안만 보인다. */
export const RAID_LOCK_NOTE = '🏁 계산기 레이드 중 — 수치 설정은 블라블라링크 값으로 잠깁니다. 큐브·버스트 순서·컨트롤(톡톡이는 3.6발/s 고정)은 내 것입니다.';

/**
 * 블라블라링크 프로필 주소에서 계정 식별자(intl_open_id)를 꺼낸다. 프록시(`worker/`)의
 * `openidFrom`과 같은 규칙이다 — 주소창의 값은 base64로 감싸여 있고("MjkwODAt…" →
 * "29080-1536…"), 그 뒤 숫자만이 식별자다. 못 읽으면 null.
 *
 * 이 값은 **서버로만** 간다. 화면에는 어디에도 안 적는다 — 남에게 보이면 안 되는 값이다.
 */
export function openidFromProfileUrl(input: string): string | null {
  const text = String(input ?? '').trim();
  if (!text) return null;
  const candidates: string[] = [];
  try {
    const url = new URL(text);
    if (!/(^|\.)blablalink\.com$/i.test(url.hostname)) return null;
    for (const key of ['openid', 'uid', 'intl_open_id', 'open_id']) {
      const value = url.searchParams.get(key);
      if (value) candidates.push(value);
    }
  } catch {
    candidates.push(text);
  }
  for (const raw of candidates) {
    let decoded = raw;
    try {
      const unpadded = raw.replace(/-/g, '+').replace(/_/g, '/');
      const guess = atob(unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '='));
      if (/^[\x20-\x7e]+$/.test(guess)) decoded = guess;
    } catch { /* base64가 아니면 원문 그대로 */ }
    const match = decoded.match(/(\d{6,})\s*$/);
    if (match) return match[1]!;
  }
  return null;
}

/** 레이드 중에도 살아 있는 카드 조작 — 큐브 고르기, «개별값» 접기, 개별 설정 켜기, 컨트롤 판 열기. */
export const RAID_CARD_KEEP = '[data-cube-name], [data-cube-level], [data-loadout-open], [data-custom-toggle], [data-control-open]';
/** 레이드 규칙 — 톡톡이 발사 속도. 사람마다 다른 손을 한 값으로 못 박아 겨룬다. */
export const RAID_TAP_RATE = 3.6;

/**
 * 편성 카드를 레이드용으로 잠근다. 설정 창을 여는 단추·돌파 계단은 잠긴다 — 육성은
 * 블라블라링크 값으로 돈다는 규칙을 화면이 먼저 지킨다. 큐브와 **컨트롤·버스트 판**
 * (`[data-control-panel]`)은 산다. 그 안에서 톡톡이 발사 속도만 3.6으로 못 박는다
 * (값도 그렇게 보여 준다 — 요청은 `raidControlOf`가 같은 값으로 맞춘다).
 */
export function lockCardForRaid(...hosts: HTMLElement[]): void {
  for (const host of hosts) {
    for (const node of host.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'button, input, select, textarea',
    )) {
      if (node.matches(RAID_CARD_KEEP)) continue;
      if (node.closest('[data-control-panel]')) {
        if (!node.matches('[data-tap-rate]')) continue;
        (node as HTMLInputElement).value = String(RAID_TAP_RATE);
        node.title = t('계산기 레이드에서는 톡톡이 3.6발/s로 고정됩니다.');
      }
      node.disabled = true;
      node.dataset.raidLocked = '';
    }
  }
}

/**
 * 모의전 카드는 풀려 있지만 톡톡이 발사 속도만은 레이드 규칙(3.6)이다 — 실전과 모의전이
 * 발사 속도 차이로 갈리면 «이대로라면 몇 등»이 거짓이 된다(피드백 2026-09-22).
 */
export function lockTapRateForRaid(...hosts: HTMLElement[]): void {
  for (const host of hosts) {
    for (const node of host.querySelectorAll<HTMLInputElement>('[data-tap-rate]')) {
      node.value = String(RAID_TAP_RATE);
      node.title = t('계산기 레이드에서는 톡톡이 3.6발/s로 고정됩니다.');
      node.disabled = true;
      node.dataset.raidLocked = '';
    }
  }
}

/** 요청에 실린 모든 톡톡이 발사 속도를 3.6으로 — 모의전 요청도 이 규칙을 지난다. */
export function enforceRaidTapRate(request: SimulationRequest): SimulationRequest {
  const characters = request.characters;
  if (!characters) return request;
  const next: Record<string, CharacterOverrides> = {};
  for (const [name, over] of Object.entries(characters)) {
    next[name] = over.control?.tap_fire
      ? { ...over, control: { ...over.control, tap_fire: { ...over.control.tap_fire, rate: RAID_TAP_RATE } } }
      : over;
  }
  return { ...request, characters: next };
}

/** 레이드 규칙에 맞춘 컨트롤 묶음 — 톡톡이 발사 속도는 3.6으로 못 박는다. 아무것도 없으면 undefined. */
export function raidControlOf(over: CharacterOverrides | undefined): RaidControl | undefined {
  if (!over) return undefined;
  const out: RaidControl = {};
  if (over.control) {
    const control = structuredClone(over.control);
    if (control.tap_fire) control.tap_fire = { ...control.tap_fire, rate: RAID_TAP_RATE };
    out.control = control;
  }
  if (over.burst) out.burst = structuredClone(over.burst);
  if (over.weaponModeSwapAt !== undefined) out.weaponModeSwapAt = over.weaponModeSwapAt;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 요청에 실린 캐릭터 설정에서 니케별 컨트롤 묶음을 뽑는다(없는 사람은 뺀다). */
export function raidControlsOf(
  squad: string[], characters: Record<string, CharacterOverrides> | undefined,
): Record<string, RaidControl> {
  const out: Record<string, RaidControl> = {};
  for (const name of squad) {
    if (!name) continue;
    const ctl = raidControlOf(characters?.[name]);
    if (ctl) out[name] = ctl;
  }
  return out;
}

/**
 * 컨트롤 한 줄 — 「컨트롤 보기」가 니케마다 적는 요약. 정책은 코드가 아니라 **컨트롤 편집기와
 * 같은 말**로 적는다 — «장전컨 into_fb»는 만든 사람만 읽는다(피드백 2026-09-22).
 */
export function controlLine(ctl: RaidControl | undefined): string {
  if (!ctl) return t('컨트롤 없음(자동)');
  const parts: string[] = [];
  const c = ctl.control;
  if (c) {
    if (c.tap_fire) {
      parts.push(t('톡톡이 {rate}발/s', { rate: c.tap_fire.rate })
        + (c.tap_fire.policy === 'burst_charge' ? ` · ${t('버충 구간만')}` : ''));
    }
    if (c.reload) {
      parts.push(c.reload.policy === 'into_fb'
        ? t('장전컨 · 풀버스트 진입 재장전') : t('장전컨 · 풀버스트 끝 직전 재장전'));
    }
    if (c.hold) parts.push(c.hold.policy === 'own_full_burst' ? t('본인 풀버스트 홀드') : t('풀버스트 후 홀드'));
    if (c.cover) parts.push(t('엄폐컨'));
    if (c.bunny_mode) parts.push(c.bunny_mode === 'stance' ? t('바니 모드 · 스탠스') : t('바니 모드 · 인게이지'));
    if (parts.length === 0) parts.push(t('직접 설정 (컨트롤 없음)'));
  }
  if (ctl.burst) {
    parts.push(ctl.burst.mode === 'priority' ? t('버스트 {n}의 배수 우선 사용', { n: ctl.burst.every })
      : ctl.burst.mode === 'endgame' ? t('버스트 막바지 {n}초 최우선', { n: ctl.burst.seconds })
        : t('버스트 안 씀'));
  }
  if (ctl.weaponModeSwapAt !== undefined) parts.push(t('무기 모드 전환 {t}초', { t: ctl.weaponModeSwapAt }));
  return parts.length > 0 ? parts.join(' · ') : t('컨트롤 없음(자동)');
}

/** 덱에서 레이드가 가져가는 것 — 편성·큐브·컨트롤·버스트 순서. 나머지는 로스터가 정한다. */
export interface RaidDeckInput {
  id: number;
  squad: string[];
  /** 큐브만 본다. 덱에 잡힌 다른 수치는 무시한다. */
  cubes: Record<string, CharacterOverrides['cube']>;
  /** 니케별 컨트롤·버스트 운용·무기 모드 전환 — 이미 레이드 규칙(톡톡이 3.6)에 맞춘 것(`raidControlOf`). */
  controls?: Record<string, RaidControl | undefined>;
  burstSequence: DeckState['burstSequence'];
}

/** 이 편성으로 레이드를 돌릴 수 있나. 아니면 무엇이 막는지 — 첫 줄이 이유다. */
export function raidProblems(
  decks: DeckState[],
  catalog: Map<string, CharacterMeta>,
  linked: boolean,
  /** 블라블라링크 로스터. 여기 없는 니케는 안 가진 니케다 — 주면 그것도 막는다. */
  roster?: Record<string, CharacterOverrides>,
): string[] {
  const problems: string[] = [];
  if (!linked) problems.push(t('블라블라링크로 계정을 먼저 이어 주세요 — 레이드는 그 육성으로만 돕니다.'));
  const filled = decks.filter((deck) => deck.squad.some(Boolean));
  if (filled.length === 0) problems.push(t('편성된 덱이 없습니다.'));
  const seen = new Map<string, number>();
  for (const deck of decks) {
    for (const name of deck.squad) {
      if (!name) continue;
      const meta = catalog.get(name);
      if (!meta) { problems.push(t('{name}은(는) 계산기가 모르는 니케입니다.', { name })); continue; }
      if (meta.preview) problems.push(t('{name}은(는) 임시 니케라 레이드에 세울 수 없습니다.', { name }));
      else if (linked && roster && !roster[name]) {
        problems.push(t('{name}은(는) 블라블라링크 로스터에 없습니다 — 가진 니케만 세울 수 있습니다.', { name }));
      }
      const before = seen.get(name);
      if (before !== undefined && before !== deck.id) {
        problems.push(t('{name}이(가) 덱 {a}와 덱 {b}에 함께 있습니다 — 한 니케는 한 덱에만 설 수 있습니다.',
          { name, a: before, b: deck.id }));
      }
      seen.set(name, deck.id);
    }
  }
  return [...new Set(problems)];
}

/**
 * 레이드용 캐릭터 설정. 로스터(블라블라링크) 값을 밑에 깔고 큐브와 컨트롤(톡톡이 3.6 고정)만
 * 덱 것으로 갈아 끼운다. 로스터에 남아 있던 컨트롤·버스트 운용은 지운다 — 그건 덱이 정한다.
 * 로스터에 없는 니케(안 키운 니케)는 기본 스펙으로 선다 — 그것도 «내 계정의 상태»다.
 */
export function raidCharacters(
  deck: RaidDeckInput,
  roster: Record<string, CharacterOverrides>,
): Record<string, CharacterOverrides> {
  const out: Record<string, CharacterOverrides> = {};
  for (const name of deck.squad) {
    if (!name) continue;
    const base = roster[name] ? structuredClone(roster[name]) : {};
    delete base.control;
    delete base.burst;
    delete base.weaponModeSwapAt;
    const cube = deck.cubes[name];
    if (cube) base.cube = { ...cube };
    const ctl = deck.controls?.[name];
    if (ctl?.control) base.control = structuredClone(ctl.control);
    if (ctl?.burst) base.burst = structuredClone(ctl.burst);
    if (ctl?.weaponModeSwapAt !== undefined) base.weaponModeSwapAt = ctl.weaponModeSwapAt;
    if (Object.keys(base).length > 0) out[name] = base;
  }
  return out;
}

/**
 * 어드민 코드의 조건 + 싱크로 400 + 내 계정 콘솔. 덱마다 다른 값은 전부 지운다.
 * 화면의 전투 조건(`fallback`)은 코드에 안 실리는 자잘한 값을 채우는 데만 쓴다 —
 * 싱크로·핵은 거기서 새지 않는다. 콘솔은 블라블라링크에서 받은 것이 없으면(전초기지
 * 비공개) 화면 값으로 물러난다.
 */
export function raidBattle(
  share: BattleShare,
  fallback: BattleSettings,
  console?: BattleSettings['console'] | null,
): BattleSettings {
  const battle: BattleSettings = {
    ...fallback,
    ...share,
    synchroLevel: DEFAULT_SYNCHRO_LEVEL,
    console: console ? structuredClone(console) : (fallback.console ?? emptyConsole()),
  };
  delete battle.burstRegenPerDeck;
  delete battle.corePerDeck;
  delete (battle as { firstBurstPerDeck?: unknown }).firstBurstPerDeck;
  // 핵은 레이드에서 언제나 꺼진다 — 코드에 안 실리지만 화면 값이 새지 않게 못 박는다.
  delete (battle as { hacks?: unknown }).hacks;
  return battle;
}

/** 덱 하나의 계산 요청. 편성·큐브·버스트 순서만 덱에서, 나머지는 로스터와 어드민 조건에서. */
export function raidRequest(
  deck: RaidDeckInput,
  roster: Record<string, CharacterOverrides>,
  battle: BattleSettings,
): SimulationRequest {
  const shaped: DeckState = {
    id: deck.id,
    squad: [...deck.squad],
    characters: raidCharacters(deck, roster),
    ...(deck.burstSequence ? { burstSequence: deck.burstSequence } : {}),
  };
  return requestForDeck(shaped, battle);
}

/**
 * 제출에 실을 덱 한 칸 — 이름·조합 코드·버스트 순서 한 줄·딜·니케별 큐브.
 * 큐브는 **실제로 계산에 들어간 것**을 싣는다(덱 것 → 로스터 것 → 기본값 순으로 정해진
 * 값). 남이 「큐브 보기」를 눌렀을 때 읽는 것이 바로 이것이다.
 */
export function raidDeckRow(
  deck: RaidDeckInput,
  result: SimulationResult,
  cubes: Record<string, { name: string; level: number } | undefined> = {},
): RaidDeck {
  const squad = deck.squad.filter(Boolean);
  const shaped: DeckState = { id: deck.id, squad: [...deck.squad], characters: {},
    ...(deck.burstSequence ? { burstSequence: deck.burstSequence } : {}) };
  const sequence = sequenceForDeck(shaped);
  const worn: Record<string, { name: string; level: number }> = {};
  for (const name of squad) {
    const cube = cubes[name];
    if (cube) worn[name] = { name: cube.name, level: cube.level };
  }
  const controls: Record<string, RaidControl> = {};
  for (const name of squad) {
    const ctl = deck.controls?.[name];
    if (ctl) controls[name] = ctl;
  }
  return {
    names: squad,
    code: encodeShareCode([{ id: 1, squad: [...deck.squad], characters: {} }], false),
    order: sequence ? cycleLine(sequence[0]) : '',
    dmg: Math.round(result.squadTotal),
    ...(Object.keys(worn).length > 0 ? { cubes: worn } : {}),
    ...(Object.keys(controls).length > 0 ? { controls } : {}),
  };
}

/** 여러 덱의 합. 빈 덱은 애초에 돌리지 않았으니 여기 안 온다. */
export const raidTotal = (rows: RaidDeck[]): number =>
  rows.reduce((sum, row) => sum + row.dmg, 0);

/** 억 단위로 접어 읽기 쉽게. 결과 판과 같은 규칙이다. */
export const raidDamageText = (value: number): string =>
  (value >= 100_000_000 ? `${(value / 100_000_000).toFixed(2)}억` : new Intl.NumberFormat('ko-KR').format(Math.round(value)));

// ── 화면 ───────────────────────────────────────────────────────────────────

export interface RaidDeps {
  server: ShareServer;
  catalog: Map<string, CharacterMeta>;
  decks: () => DeckState[];
  /** 블라블라링크로 받은 로스터. 비어 있으면 아직 안 이은 것이다. */
  roster: () => Record<string, CharacterOverrides>;
  /** 이어 둔 계정. 없으면 null — 기록은 못 올리고 보기만 된다. 콘솔은 받아 둔 계정 값. */
  account: () => { openid: string; area: number; console?: BattleSettings['console'] | null } | null;
  /** 코드에 없는 값을 채울 밑바탕(지금 화면의 전투 조건). */
  battleFallback: () => BattleSettings;
  simulate: (request: SimulationRequest) => Promise<SimulationResult>;
  /**
   * 남의 덱 다섯을 내 판에 얹는다. 편성만 — `cubes`를 주면 니케별 큐브까지, `controls`를 주면
   * 컨트롤·버스트 운용까지 함께. 나머지 스펙은 언제나 내 것이다.
   */
  applyDecks: (
    codes: string[],
    cubes?: Array<Record<string, { name: string; level: number }> | undefined>,
    controls?: Array<Record<string, RaidControl> | undefined>,
  ) => void;
  /** 어드민 비밀번호. 확인 안 했으면 빈 문자열. */
  adminPass: () => string;
  /** 엔진 판본 — 기록에 함께 적는다. */
  engineVersion: string;
  /**
   * 덱별 결과를 평소의 «전투 결과» 판에 세운다. 레이드도 계산이다 — 합계 숫자 하나만
   * 보여 주면 어느 니케가 얼마를 넣었는지 볼 길이 없다. 덱이 끝날 때마다 부른다.
   */
  showResults?: (entries: DeckResultEntry[]) => void;
  /** 카탈로그의 기본 큐브. 로스터에도 덱에도 큐브가 없는 니케가 실제로 끼는 것이다. */
  defaultCube?: (name: string) => { name: string; level: number } | undefined;
  /**
   * 모의전용 요청 — 평소 계산기와 똑같이 덱의 수치 설정·컨트롤을 그대로 싣는다.
   * 없으면 모의전 토글을 안 낸다.
   */
  mockRequest?: (deck: DeckState, battle: BattleSettings) => SimulationRequest;
  /** 모의전 토글이 바뀌면 알린다 — 편성 카드의 잠금을 풀거나 다시 건다. */
  onMock?: (on: boolean) => void;
  /** 돌고 있는 계산을 끊는다. 없으면 취소 단추를 안 낸다. */
  cancel?: () => void;
  imageOf: (name: string) => string | undefined;
  /** 열린 레이드 수가 바뀌면 알린다(머리의 안내 띠·탭의 점). */
  onRaids?: (raids: RaidSummary[]) => void;
}

export interface RaidHandle {
  /** 서버에서 레이드 목록을 다시 받는다. 탭을 열 때·머리 띠를 그릴 때 부른다. */
  refresh(): Promise<void>;
  /** 어드민이 전투 조건 공유 목록에서 레이드를 열 때. */
  openRaid(input: { title: string; code: string; auto: string }): Promise<void>;
  /** 지금 열린 레이드들. */
  openRaids(): RaidSummary[];
  /** 마지막 레이드 계산의 덱별 결과를 결과 판에 다시 세운다. 탭으로 돌아올 때 부른다. */
  showLast(): void;
  /** 모의전이 켜져 있나. */
  mock(): boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className = '', text = '',
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/** 표시 이름 — 본인과 어드민에게만 보인다. 브라우저에 남겨 다음에 또 안 묻는다. */
const NAME_KEY = 'nikke-raid-name-v1';
/** 내가 올린 기록의 자리(레이드별 eid). 목록에서 «내 줄»을 찾는 유일한 열쇠다. */
const MINE_KEY = 'nikke-raid-mine-v1';

export function mountRaid(host: HTMLElement, deps: RaidDeps): RaidHandle {
  let raids: RaidSummary[] = [];
  let selectedId: string | null = null;
  let board: RaidBoard | null = null;
  let loading = false;
  let running = false;
  let message = '';
  let messageOk = false;
  /** 마지막 계산. 덱별 줄과 합계. 제출할 때 그대로 싣는다. */
  let computed: {
    rows: RaidDeck[]; requests: SimulationRequest[]; total: number; raidId: string; submitted: boolean;
    /** 모의전 결과다 — 올리지 않는다. */
    mock: boolean;
  } | null = null;
  /** 마지막 계산의 덱별 결과. 탭을 떠났다 와도 결과 판에 다시 세울 수 있게 둔다. */
  let lastEntries: DeckResultEntry[] = [];
  /**
   * 모의전 — 수치 설정·컨트롤을 자유롭게 만져 «이대로라면 몇 등»을 본다. 기록은 안
   * 올라간다. 기본은 꺼짐: 켜 두고 잊으면 진짜 기록이 안 올라가는 사고가 난다.
   */
  let mock = false;
  let mine: Record<string, string> = {};
  try { mine = JSON.parse(localStorage.getItem(MINE_KEY) ?? '{}'); } catch { mine = {}; }
  const rememberMine = (raidId: string, eid: string) => {
    mine[raidId] = eid;
    try { localStorage.setItem(MINE_KEY, JSON.stringify(mine)); } catch { /* 무시 */ }
  };
  let displayName = '';
  try { displayName = localStorage.getItem(NAME_KEY) ?? ''; } catch { displayName = ''; }

  const say = (text: string, ok = false) => { message = text; messageOk = ok; render(); };
  const selected = (): RaidSummary | null => raids.find((raid) => raid.id === selectedId) ?? null;

  async function refresh(): Promise<void> {
    loading = true;
    render();
    try {
      raids = await deps.server.raidList();
      if (!selectedId || !raids.some((raid) => raid.id === selectedId)) {
        selectedId = raids.find((raid) => raid.status === 'open')?.id ?? raids[0]?.id ?? null;
      }
      deps.onRaids?.(raids);
      await loadBoard();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      messageOk = false;
    } finally {
      loading = false;
      render();
    }
  }

  async function loadBoard(): Promise<void> {
    if (!selectedId) { board = null; return; }
    board = await deps.server.raidBoard(selectedId, deps.adminPass());
  }

  async function pick(id: string): Promise<void> {
    selectedId = id;
    computed = null;
    message = '';
    render();
    try { await loadBoard(); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    render();
  }

  let cancelRequested = false;

  /** 다섯 덱을 어드민 조건으로 돌린다. 하나라도 막히면 한 판도 안 돌린다. */
  async function run(): Promise<void> {
    const raid = selected();
    if (!raid || raid.status !== 'open') return;
    const account = deps.account();
    const roster = deps.roster();
    const mocking = mock && deps.mockRequest !== undefined;
    // 모의전은 계정·로스터·임시 니케를 안 따진다 — «이 설정이면 몇 등»을 재는 자리다.
    const problems = mocking
      ? raidProblems(deps.decks(), deps.catalog, true).filter((line) => !line.includes(t('임시 니케')))
      : raidProblems(deps.decks(), deps.catalog, account !== null, roster);
    if (problems.length > 0) { say(problems[0]!); return; }
    // 콘솔은 계정 육성의 일부다. 못 받았으면(전초기지 비공개) 화면 값으로 대신 돌리지 않는다 —
    // 그 기록은 그 계정의 것이 아니다. 모의전은 기록을 안 올리니 화면 값으로 돌려도 된다.
    if (!mocking && account && !account.console) { say(RAID_CONSOLE_MISSING); return; }
    running = true;
    cancelRequested = false;
    computed = null;
    say(t('덱 {n}/5 계산 중…', { n: 1 }));
    try {
      const share = decodeBattleCode(raid.code);
      const battle = raidBattle(share, deps.battleFallback(), account?.console);
      const rows: RaidDeck[] = [];
      const requests: SimulationRequest[] = [];
      const entries: DeckResultEntry[] = [];
      const decks = deps.decks().filter((deck) => deck.squad.some(Boolean));
      for (const [index, deck] of decks.entries()) {
        message = t('덱 {n}/5 계산 중…', { n: index + 1 });
        render();
        const input: RaidDeckInput = {
          id: deck.id,
          squad: deck.squad,
          cubes: Object.fromEntries(Object.entries(deck.characters).map(([name, value]) => [name, value.cube])),
          controls: raidControlsOf(deck.squad, deck.characters),
          burstSequence: deck.burstSequence,
        };
        // 모의전도 톡톡이만은 3.6이다 — 실전과 같은 규칙으로 재야 «몇 등»이 맞는다.
        const request = mocking ? enforceRaidTapRate(deps.mockRequest!(deck, battle)) : raidRequest(input, roster, battle);
        const result = await deps.simulate(request);
        if (cancelRequested) throw new Error(t('계산을 취소했습니다 — 결과는 남기지 않았습니다.'));
        // 실제로 계산에 들어간 큐브 — 요청에 실린 것이 없으면 카탈로그 기본값이다.
        const worn = Object.fromEntries(deck.squad.filter(Boolean).map((name) =>
          [name, request.characters?.[name]?.cube ?? deps.defaultCube?.(name)]));
        rows.push(raidDeckRow(input, result, worn));
        requests.push(request);
        entries.push({ deckId: deck.id, request, result });
        deps.showResults?.(entries);
      }
      lastEntries = entries;
      computed = { rows, requests, total: raidTotal(rows), raidId: raid.id, submitted: false, mock: mocking };
      message = '';
      if (mocking) {
        // 올리지 않는다. 지금 판에서 몇 등인지만 센다 — 내 진짜 기록도 남처럼 센다.
        const above = (board?.entries ?? []).filter((entry) => entry.total > computed!.total).length;
        message = t('모의전 결과 {n} — 이대로라면 {rank}등입니다 (참가 {m}명 중). 기록은 올라가지 않습니다.',
          { n: raidDamageText(computed.total), rank: above + 1, m: board?.entries.length ?? 0 });
        messageOk = true;
        return;
      }
      // 내 최고 딜이면 묻지 않고 올린다 — 위에서 미리 알렸다. 서버도 더 높을 때만 갈아
      // 끼우므로, 여기서 낮은 것을 걸러 두면 «그대로 둡니다»만 돌아오는 요청을 안 보낸다.
      const best = myRecord();
      if (!best || computed.total > best.total) {
        running = false;
        await submit(true);
        return;
      }
      message = t('내 기록({m})보다 낮아 올리지 않았습니다 — 더 높은 결과만 자동으로 올라갑니다.', { m: raidDamageText(best.total) });
      messageOk = false;
    } catch (error) {
      // 사람이 끊은 것은 실패가 아니다 — 여기까지 나온 덱 결과는 결과 판에 남고 랭킹에는 안 올린다.
      message = cancelRequested || isCancelled(error)
        ? t('계산을 취소했습니다 — 결과는 남기지 않았습니다.')
        : error instanceof Error ? error.message : String(error);
      messageOk = false;
      computed = null;
    } finally {
      running = false;
      cancelRequested = false;
      render();
    }
  }

  /** 이 레이드에 올라가 있는 내 기록. 없으면 null — 첫 계산이 곧 첫 기록이다. */
  const myRecord = (): RaidEntry | null => {
    const eid = selectedId ? mine[selectedId] : undefined;
    return (eid && board?.entries.find((entry) => entry.eid === eid)) || null;
  };

  async function submit(auto = false): Promise<void> {
    const raid = selected();
    const account = deps.account();
    if (!raid || !computed || computed.raidId !== raid.id || !account || computed.mock) return;
    const input: RaidEntryInput = {
      id: raid.id,
      openid: account.openid,
      name: displayName,
      area: account.area,
      decks: computed.rows,
      total: computed.total,
      engine: deps.engineVersion,
      spec: { requests: computed.requests },
    };
    try {
      const result = await deps.server.submitRaidEntry(input);
      rememberMine(raid.id, result.entry.eid);
      computed.submitted = true;
      await loadBoard();
      if (result.kept) {
        say(t('이미 올린 기록({n})이 더 높습니다 — 그대로 둡니다.', { n: raidDamageText(result.entry.total) }), true);
      } else {
        const rank = (board?.entries ?? []).findIndex((entry) => entry.eid === result.entry.eid) + 1;
        say(auto
          ? t('내 최고 딜이라 바로 올렸습니다 · 지금 {rank}위.', { rank })
          : t('올렸습니다 · 지금 {rank}위. 같은 계정으로 다시 올리면 더 높은 기록만 남습니다.', { rank }), true);
      }
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
    }
  }

  async function openRaid(input: { title: string; code: string; auto: string }): Promise<void> {
    const raid = await deps.server.openRaid(input, deps.adminPass());
    selectedId = raid.id;
    await refresh();
  }

  async function closeRaid(): Promise<void> {
    const raid = selected();
    if (!raid) return;
    try {
      await deps.server.closeRaid(raid.id, deps.adminPass());
      await refresh();
      say(t('레이드를 닫았습니다 — 랭킹은 지난 레이드로 남고 제출만 막힙니다.'), true);
    } catch (error) { say(error instanceof Error ? error.message : String(error)); }
  }

  async function reopenRaid(): Promise<void> {
    const raid = selected();
    if (!raid) return;
    try {
      await deps.server.reopenRaid(raid.id, deps.adminPass());
      await refresh();
      say(t('레이드를 다시 열었습니다 — 기록은 그대로고 제출을 다시 받습니다.'), true);
    } catch (error) { say(error instanceof Error ? error.message : String(error)); }
  }

  async function deleteRaid(): Promise<void> {
    const raid = selected();
    if (!raid) return;
    try {
      await deps.server.deleteRaid(raid.id, deps.adminPass());
      selectedId = null;
      computed = null;
      await refresh();
      say(t('레이드를 지웠습니다 — 랭킹과 보관된 스펙까지 사라졌습니다.'), true);
    } catch (error) { say(error instanceof Error ? error.message : String(error)); }
  }

  /**
   * 다른 레이드의 기록을 이 레이드로 옮긴다. 보관된 스펙(그 사람의 편성·육성·큐브·버스트
   * 순서)을 **이 레이드의 조건**으로 내 브라우저에서 다시 돌려 그 결과를 올린다. 이미
   * 이 레이드에 직접 올린 사람(동일 계정)은 건너뛴다 — 서버도 같은 규칙으로 막는다.
   */
  async function migrate(fromId: string, out: HTMLElement): Promise<void> {
    const target = selected();
    if (!target || target.status !== 'open' || !fromId || fromId === target.id) return;
    const pass = deps.adminPass();
    try {
      const source = await deps.server.raidBoard(fromId, pass);
      const here = await deps.server.raidBoard(target.id, pass);
      const taken = new Set(here.entries.map((entry) => entry.owner).filter(Boolean));
      const share = decodeBattleCode(target.code);
      const moved: RaidMigrateEntry[] = [];
      let skipped = 0;
      let broken = 0;
      for (const [index, entry] of source.entries.entries()) {
        out.textContent = t('옮기는 중 {n}/{m}…', { n: index + 1, m: source.entries.length });
        if (!entry.owner || taken.has(entry.owner)) { skipped += 1; continue; }
        let requests: SimulationRequest[] = [];
        try {
          const spec = await deps.server.raidSpec<{ requests?: SimulationRequest[] }>(fromId, entry.eid, pass);
          requests = spec.requests ?? [];
        } catch { requests = []; }
        if (requests.length === 0) { broken += 1; continue; }
        const rows: RaidDeck[] = [];
        const rebased: SimulationRequest[] = [];
        for (const [i, old] of requests.entries()) {
          // 그 사람의 콘솔은 그대로, 조건만 이 레이드 것으로.
          const battle = raidBattle(share, deps.battleFallback(), old.console);
          const deck: DeckState = {
            id: i + 1, squad: [...old.squad], characters: old.characters ?? {},
            ...(old.burstSequence ? { burstSequence: old.burstSequence } : {}),
          };
          const request = requestForDeck(deck, battle, old.customCharacters);
          const result = await deps.simulate(request);
          const worn = Object.fromEntries(deck.squad.filter(Boolean).map((name) =>
            [name, request.characters?.[name]?.cube ?? deps.defaultCube?.(name)]));
          rows.push(raidDeckRow({
            id: deck.id, squad: deck.squad, cubes: {}, controls: raidControlsOf(deck.squad, request.characters),
            burstSequence: deck.burstSequence,
          }, result, worn));
          rebased.push(request);
        }
        moved.push({
          owner: entry.owner, name: entry.name ?? '', area: entry.area ?? 0, tail: entry.tail ?? '',
          decks: rows, total: raidTotal(rows), engine: deps.engineVersion, spec: { requests: rebased },
        });
      }
      const sent = moved.length > 0
        ? await deps.server.migrateRaidEntries(target.id, fromId, moved, pass)
        : { moved: 0, skipped: 0 };
      await refresh();
      say(t('{n}개를 옮겼습니다 · 이미 기록이 있어 건너뛴 {s}개 · 보관된 스펙이 없어 못 옮긴 {b}개',
        { n: sent.moved, s: skipped + sent.skipped, b: broken }), true);
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 이 레이드의 기록 전부를 보관된 스펙으로 **자리 그대로** 다시 돌려 갱신한다 — 엔진 알고리즘이
   * 바뀌었을 때(버스트 게이지 실누적). 조건은 이 레이드 것이되 버스트 게이지는 신 방식으로 두고,
   * 코드가 구 방식을 명시하고 있었으면 레이드의 조건 코드도 신 방식으로 다시 적는다.
   * 보관된 스펙이 없는 기록은 손대지 않는다. 사람의 콘솔·육성은 스펙에 든 그대로다.
   */
  async function recalc(raid: RaidSummary, out: HTMLElement): Promise<{ updated: number; broken: number }> {
    const pass = deps.adminPass();
    const here = await deps.server.raidBoard(raid.id, pass);
    const decoded = decodeBattleCode(raid.code);
    const share: BattleShare = { ...decoded, burstGaugeMode: 'new' };
    const code = decoded.burstGaugeMode === 'legacy' ? encodeBattleCode(raidBattle(share, deps.battleFallback())) : '';
    const rows: RaidRecalcEntry[] = [];
    let broken = 0;
    for (const [index, entry] of here.entries.entries()) {
      out.textContent = t('다시 계산하는 중 {n}/{m}…', { n: index + 1, m: here.entries.length });
      let requests: SimulationRequest[] = [];
      try {
        const spec = await deps.server.raidSpec<{ requests?: SimulationRequest[] }>(raid.id, entry.eid, pass);
        requests = spec.requests ?? [];
      } catch { requests = []; }
      if (requests.length === 0) { broken += 1; continue; }
      const decks: RaidDeck[] = [];
      const rebased: SimulationRequest[] = [];
      for (const [i, old] of requests.entries()) {
        const battle = raidBattle(share, deps.battleFallback(), old.console);
        const deck: DeckState = {
          id: i + 1, squad: [...old.squad], characters: old.characters ?? {},
          ...(old.burstSequence ? { burstSequence: old.burstSequence } : {}),
        };
        const request = requestForDeck(deck, battle, old.customCharacters);
        const result = await deps.simulate(request);
        const worn = Object.fromEntries(deck.squad.filter(Boolean).map((name) =>
          [name, request.characters?.[name]?.cube ?? deps.defaultCube?.(name)]));
        decks.push(raidDeckRow({
          id: deck.id, squad: deck.squad, cubes: {}, controls: raidControlsOf(deck.squad, request.characters),
          burstSequence: deck.burstSequence,
        }, result, worn));
        rebased.push(request);
      }
      rows.push({ eid: entry.eid, decks, total: raidTotal(decks), engine: deps.engineVersion, spec: { requests: rebased } });
    }
    const sent = rows.length > 0
      ? await deps.server.recalcRaidEntries(raid.id, code, rows, pass)
      : { updated: 0, missing: 0 };
    return { updated: sent.updated, broken: broken + sent.missing };
  }

  async function recalcRaids(targets: RaidSummary[], out: HTMLElement): Promise<void> {
    const lines: string[] = [];
    try {
      for (const raid of targets) {
        const done = await recalc(raid, out);
        lines.push(t('「{title}」 {n}개를 다시 계산했습니다 · 보관된 스펙이 없어 못 한 {b}개',
          { title: raid.title, n: done.updated, b: done.broken }));
      }
      await refresh();
      say(lines.join(' / '), true);
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
    }
  }

  async function removeEntry(entry: RaidEntry): Promise<void> {
    const raid = selected();
    if (!raid) return;
    try {
      await deps.server.removeRaidEntry(raid.id, entry.eid, deps.adminPass());
      await loadBoard();
      say(t('기록을 지웠습니다.'), true);
    } catch (error) { say(error instanceof Error ? error.message : String(error)); }
  }

  /** 어드민 재검증 — 보관된 요청 그대로 내 브라우저에서 다시 돌려 합계를 맞춰 본다. */
  async function verify(entry: RaidEntry, out: HTMLElement): Promise<void> {
    const raid = selected();
    if (!raid) return;
    out.textContent = t('계산 중…');
    try {
      const spec = await deps.server.raidSpec<{ requests?: SimulationRequest[] }>(raid.id, entry.eid, deps.adminPass());
      const requests = spec.requests ?? [];
      let total = 0;
      for (const request of requests) total += (await deps.simulate(request)).squadTotal;
      const same = Math.abs(total - entry.total) <= Math.max(1, entry.total * 0.001);
      out.textContent = same
        ? t('일치 ✓ {n}', { n: raidDamageText(total) })
        : t('불일치 — 다시 돌리니 {n} (기록 {m})', { n: raidDamageText(total), m: raidDamageText(entry.total) });
    } catch (error) {
      out.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  const face = (name: string): HTMLElement => {
    const src = deps.imageOf(name);
    const node = el('span', 'raid-face');
    node.title = name;
    if (src) {
      const img = document.createElement('img');
      img.src = src; img.alt = name; img.loading = 'lazy';
      node.append(img);
    } else {
      node.textContent = name.slice(0, 1);
    }
    return node;
  };

  function renderPicker(): HTMLElement {
    const box = el('div', 'raid-picker');
    const open = raids.filter((raid) => raid.status === 'open');
    const closed = raids.filter((raid) => raid.status !== 'open');
    if (raids.length === 0) {
      box.append(el('p', 'field-note', loading ? t('레이드 목록을 받는 중…') : t('지금 열린 계산기 레이드가 없습니다.')));
      return box;
    }
    const list = el('div', 'raid-list');
    list.dataset.raidList = '';
    const admin = deps.adminPass() !== '';
    const ordered = [...open, ...closed];
    // 어드민은 끌어다 놓아 순서를 바꾼다(손가락은 끌기가 안 되므로 ▲▼도 둔다). 열린 것과 닫힌
    // 것은 무리가 갈라져 있어 서로의 자리로는 못 간다 — 무리 안에서만 옮긴다.
    let dragging: string | null = null;
    const move = (id: string, to: number) => {
      const group = raids.find((raid) => raid.id === id)?.status === 'open' ? open : closed;
      const from = group.findIndex((raid) => raid.id === id);
      if (from < 0 || to < 0 || to >= group.length || from === to) return;
      const [item] = group.splice(from, 1);
      group.splice(to, 0, item!);
      raids = [...open, ...closed];
      render();
      void deps.server.reorderRaids(raids.map((raid) => raid.id), deps.adminPass())
        .then((fresh) => { raids = fresh; deps.onRaids?.(raids); render(); })
        .catch((error) => { say(error instanceof Error ? error.message : String(error)); void refresh(); });
    };
    for (const raid of ordered) {
      const button = el('button', raid.id === selectedId ? 'raid-pick is-on' : 'raid-pick');
      button.type = 'button';
      button.dataset.raidPick = raid.id;
      if (raid.status !== 'open') button.classList.add('is-closed');
      button.append(el('b', '', raid.title));
      button.append(el('span', 'raid-pick-auto', raid.auto));
      button.append(el('small', '', raid.status === 'open'
        ? t('진행중 · 참가 {n}명', { n: raid.count })
        : t('마감 · 참가 {n}명', { n: raid.count })));
      button.addEventListener('click', () => { void pick(raid.id); });
      if (admin) {
        const group = raid.status === 'open' ? open : closed;
        const at = group.findIndex((other) => other.id === raid.id);
        button.draggable = true;
        button.classList.add('is-sortable');
        button.title = t('끌어다 놓아 순서를 바꿉니다');
        button.addEventListener('dragstart', (event) => {
          dragging = raid.id;
          button.classList.add('is-dragging');
          event.dataTransfer?.setData('text/plain', raid.id);
        });
        button.addEventListener('dragend', () => { dragging = null; button.classList.remove('is-dragging'); });
        button.addEventListener('dragover', (event) => {
          if (!dragging || dragging === raid.id) return;
          const same = raids.find((other) => other.id === dragging)?.status === raid.status;
          if (!same) return;
          event.preventDefault();
          button.classList.add('is-drop');
        });
        button.addEventListener('dragleave', () => button.classList.remove('is-drop'));
        button.addEventListener('drop', (event) => {
          event.preventDefault();
          button.classList.remove('is-drop');
          if (dragging && dragging !== raid.id) move(dragging, at);
          dragging = null;
        });
        const handle = el('span', 'raid-sort');
        const up = el('button', 'raid-sort-btn', '▲');
        up.type = 'button';
        up.dataset.raidUp = raid.id;
        up.disabled = at === 0;
        up.setAttribute('aria-label', t('위로'));
        up.addEventListener('click', (event) => { event.stopPropagation(); move(raid.id, at - 1); });
        const down = el('button', 'raid-sort-btn', '▼');
        down.type = 'button';
        down.dataset.raidDown = raid.id;
        down.disabled = at === group.length - 1;
        down.setAttribute('aria-label', t('아래로'));
        down.addEventListener('click', (event) => { event.stopPropagation(); move(raid.id, at + 1); });
        handle.append(up, down);
        button.append(handle);
      }
      list.append(button);
    }
    box.append(list);
    return box;
  }

  function renderRules(): HTMLElement {
    const list = el('ul', 'raid-rules');
    const rules: Array<[string, string]> = [
      ['ok', t('5덱 합산 — 니케는 한 덱에만')],
      ['ok', t('블라블라링크로 받은 내 육성 그대로 (수치 설정 잠김)')],
      ['ok', t('싱크로 400 고정 · 콘솔은 내 계정 값')],
      ['ok', t('큐브는 바꿀 수 있음')],
      ['ok', t('버스트 순서는 내 것')],
      ['ok', t('컨트롤(톡톡이·장전컨·홀드·버스트 운용)은 내 것 — 톡톡이는 3.6발/s 고정')],
      ['no', t('임시 · 미구현 니케 불가')],
      ['no', t('안 가진 니케 불가')],
      ['ok', t('한 계정 한 기록 · 최고 기록만')],
      ['ok', t('내 최고 딜이면 계산 즉시 자동 등록')],
      ['ok', t('다른 참가자는 익명')],
    ];
    for (const [kind, text] of rules) list.append(el('li', kind, text));
    return list;
  }

  function renderMyDecks(): HTMLElement {
    const box = el('div', 'raid-decks');
    box.dataset.raidMyDecks = '';
    const decks = deps.decks();
    for (const deck of decks) {
      if (!deck.squad.some(Boolean)) continue;
      const line = el('div', 'raid-deck-line');
      line.append(el('b', '', t('덱 {n}', { n: deck.id })));
      const faces = el('span', 'raid-faces');
      for (const name of deck.squad) if (name) faces.append(face(name));
      line.append(faces);
      const sequence = sequenceForDeck(deck);
      line.append(el('span', 'raid-order', sequence ? cycleLine(sequence[0]) : t('버스트 순서 자동')));
      const row = computed?.rows.find((entry) => entry.names.join('|') === deck.squad.filter(Boolean).join('|'));
      line.append(el('span', row ? 'raid-dmg' : 'raid-dmg dim', row ? raidDamageText(row.dmg) : '—'));
      box.append(line);
    }
    if (box.childElementCount === 0) box.append(el('p', 'field-note', t('편성된 덱이 없습니다.')));
    return box;
  }

  function renderEntryDetail(entry: RaidEntry, admin: boolean): HTMLElement {
    const box = el('div', 'raid-detail');
    const decks = el('div', 'raid-decks');
    for (const [index, deck] of entry.decks.entries()) {
      const line = el('div', 'raid-deck-line');
      line.append(el('b', '', t('덱 {n}', { n: index + 1 })));
      const faces = el('span', 'raid-faces');
      for (const name of deck.names) faces.append(face(name));
      line.append(faces);
      line.append(el('span', 'raid-order', deck.order || t('버스트 순서 자동')));
      line.append(el('span', 'raid-dmg', raidDamageText(deck.dmg)));
      decks.append(line);
      // 「큐브 보기」·「컨트롤 보기」는 한 칸에 모아 둔다 — 단추가 둘이 되면서 줄의 마지막
      // 칸을 뚫고 나왔다(피드백 2026-09-22). 좁으면 칸 안에서 줄을 바꾼다.
      const openers = el('span', 'raid-openers');
      // 큐브 보기 — 니케마다 무슨 큐브 몇 레벨인지. 옛 기록에는 없어 단추도 안 낸다.
      if (deck.cubes && Object.keys(deck.cubes).length > 0) {
        const cubes = deck.cubes;
        const open = el('button', 'raid-ghost raid-cubes-open', t('큐브 보기'));
        open.type = 'button';
        open.dataset.raidCubes = `${entry.eid}:${index}`;
        const list = el('ul', 'raid-cubes');
        list.hidden = true;
        for (const name of deck.names) {
          const item = el('li');
          item.append(el('b', '', name), el('span', '', cubeLine(cubes[name])));
          list.append(item);
        }
        open.addEventListener('click', () => {
          list.hidden = !list.hidden;
          open.textContent = list.hidden ? t('큐브 보기') : t('큐브 접기');
        });
        openers.append(open);
        decks.append(list);
      }
      // 컨트롤 보기 — 니케마다 톡톡이·장전컨·홀드·버스트 운용. 이 패치 전 기록에는 없다.
      if (deck.controls && Object.keys(deck.controls).length > 0) {
        const controls = deck.controls;
        const open = el('button', 'raid-ghost raid-cubes-open', t('컨트롤 보기'));
        open.type = 'button';
        open.dataset.raidControls = `${entry.eid}:${index}`;
        const list = el('ul', 'raid-cubes');
        list.hidden = true;
        for (const name of deck.names) {
          const item = el('li');
          item.append(el('b', '', name), el('span', '', controlLine(controls[name])));
          list.append(item);
        }
        open.addEventListener('click', () => {
          list.hidden = !list.hidden;
          open.textContent = list.hidden ? t('컨트롤 보기') : t('컨트롤 접기');
        });
        openers.append(open);
        decks.append(list);
      }
      if (openers.childElementCount > 0) line.append(openers);
    }
    box.append(decks);
    const actions = el('div', 'raid-actions');
    const take = el('button', 'raid-ghost', t('덱 {n}개 가져오기 (편성만)', { n: entry.decks.length }));
    take.type = 'button';
    take.dataset.raidTake = entry.eid;
    take.addEventListener('click', () => {
      try {
        deps.applyDecks(entry.decks.map((deck) => deck.code));
        say(t('덱 {n}개의 편성만 가져왔습니다 — 스펙은 내 블라블라링크 값으로 돕니다.', { n: entry.decks.length }), true);
      } catch (error) {
        say(error instanceof Error ? error.message : String(error));
      }
    });
    actions.append(take);
    // 큐브까지 — 기록에 큐브가 실려 있을 때만(이 패치 전 기록에는 없다).
    if (entry.decks.some((deck) => deck.cubes && Object.keys(deck.cubes).length > 0)) {
      const takeCubes = el('button', 'raid-ghost', t('덱 {n}개 가져오기 (큐브도)', { n: entry.decks.length }));
      takeCubes.type = 'button';
      takeCubes.dataset.raidTakeCubes = entry.eid;
      takeCubes.addEventListener('click', () => {
        try {
          deps.applyDecks(entry.decks.map((deck) => deck.code), entry.decks.map((deck) => deck.cubes));
          say(t('덱 {n}개의 편성과 큐브를 가져왔습니다 — 나머지 스펙은 내 블라블라링크 값으로 돕니다.', { n: entry.decks.length }), true);
        } catch (error) {
          say(error instanceof Error ? error.message : String(error));
        }
      });
      actions.append(takeCubes);
    }
    // 컨트롤까지 — 기록에 컨트롤이 실려 있을 때만. 큐브가 있으면 큐브도 같이 간다.
    if (entry.decks.some((deck) => deck.controls && Object.keys(deck.controls).length > 0)) {
      const takeAll = el('button', 'raid-ghost', t('덱 {n}개 가져오기 (편성·큐브·컨트롤)', { n: entry.decks.length }));
      takeAll.type = 'button';
      takeAll.dataset.raidTakeControls = entry.eid;
      takeAll.addEventListener('click', () => {
        try {
          deps.applyDecks(
            entry.decks.map((deck) => deck.code),
            entry.decks.map((deck) => deck.cubes),
            entry.decks.map((deck) => deck.controls),
          );
          say(t('덱 {n}개의 편성·큐브·컨트롤을 가져왔습니다 — 나머지 스펙은 내 블라블라링크 값으로 돕니다.', { n: entry.decks.length }), true);
        } catch (error) {
          say(error instanceof Error ? error.message : String(error));
        }
      });
      actions.append(takeAll);
    }
    if (admin) {
      const verifyButton = el('button', 'raid-ghost', t('재검증 (보관된 스펙으로 다시 계산)'));
      verifyButton.type = 'button';
      verifyButton.dataset.raidVerify = entry.eid;
      const out = el('span', 'raid-verify-out');
      verifyButton.addEventListener('click', () => { void verify(entry, out); });
      const remove = el('button', 'raid-ghost is-danger', t('기록 삭제'));
      remove.type = 'button';
      remove.dataset.raidRemove = entry.eid;
      remove.addEventListener('click', () => { void removeEntry(entry); });
      actions.append(verifyButton, out, remove);
    }
    box.append(actions);
    box.append(el('p', 'raid-fine', t('컨트롤 기록됨(톡톡이 3.6 고정) · 엔진 {engine} · 스펙은 제출 때 함께 보관되며 어드민 재검증에만 쓰입니다', { engine: entry.engine || '?' })));
    if (entry.from) box.append(el('p', 'raid-fine raid-from', t('다른 레이드의 기록을 이 조건으로 다시 계산해 옮긴 것입니다.')));
    if (entry.recalculatedAt) {
      box.append(el('p', 'raid-fine raid-from', t('엔진이 바뀐 뒤 어드민이 보관된 스펙으로 다시 계산한 기록입니다 ({date}).', { date: entry.recalculatedAt.slice(0, 10) })));
    }
    return box;
  }

  /**
   * 랭킹판 — 한 표다. 상위 열 줄만 도드라지게 입힌다: 1·2·3위는 금·은·동 메달과 그 색의
   * 왼쪽 띠, 4~10위는 테두리 배지. 열 번째 아래에 금을 긋는다. 카드로 세우는 시상대는
   * 써 봤지만 «판»이 아니라 «전시»가 되어 되돌렸다 — 랭킹은 훑어 내려가는 목록이다.
   */
  function renderBoard(): HTMLElement {
    const box = el('div', 'raid-board');
    box.dataset.raidBoard = '';
    const entries = board?.entries ?? [];
    const admin = deps.adminPass() !== '';
    const myEid = selectedId ? mine[selectedId] : undefined;
    if (entries.length === 0) {
      box.append(el('p', 'field-note', loading ? t('랭킹을 받는 중…') : t('아직 올라온 기록이 없습니다.')));
      return box;
    }

    const whoOf = (entry: RaidEntry): HTMLElement => {
      const who = el('span', 'raid-who');
      if (entry.eid === myEid) {
        who.append(el('span', '', displayName || t('나')));
        who.append(el('small', '', t('나')));
      } else {
        who.append(el('span', 'anon', t('참가자')));
        // 꼬리표 — 누구인지는 몰라도 «저 사람이 올라왔다»는 보인다.
        if (entry.tag) who.append(el('code', 'raid-tag', `#${entry.tag}`));
      }
      if (admin && entry.name !== undefined) {
        who.append(el('span', 'raid-ident', `${entry.name || '(이름 없음)'} · ${entry.area || '?'} · …${entry.tail ?? ''}`));
      }
      return who;
    };

    // 펼친 것은 하나만 — 두 개가 열리면 무엇을 보고 있는지 흐려진다.
    let opened: { detail: HTMLElement; host: HTMLElement } | null = null;
    const toggle = (detail: HTMLElement, host: HTMLElement) => {
      const open = !detail.hidden;
      if (opened && opened.detail !== detail) {
        opened.detail.hidden = true;
        opened.host.classList.remove('is-open');
      }
      detail.hidden = open;
      host.classList.toggle('is-open', !open);
      opened = open ? null : { detail, host };
    };

    const table = el('table', 'raid-table');
    const head = el('thead');
    const hr = el('tr');
    for (const label of [t('순위'), t('참가자'), t('덱'), t('5덱 합산'), '']) hr.append(el('th', '', label));
    head.append(hr);
    table.append(head);
    const body = el('tbody');
    entries.forEach((entry, index) => {
      const rank = index + 1;
      const row = el('tr', entry.eid === myEid ? 'raid-row is-me' : 'raid-row');
      row.dataset.raidRow = entry.eid;
      const top = rank <= 10;
      row.classList.toggle('is-top', top);
      row.classList.toggle('is-podium', rank <= 3);
      if (rank <= 3) row.classList.add(`rank-${rank}`);
      const rankCell = el('td', 'raid-rank');
      if (top) {
        const medal = el('span', `raid-medal m${Math.min(rank, 4)}`, String(rank));
        medal.setAttribute('aria-label', t('{rank}위', { rank }));
        rankCell.append(medal);
      } else {
        rankCell.textContent = String(rank);
      }
      row.append(rankCell);
      const who = el('td');
      who.append(whoOf(entry));
      row.append(who);
      const deckCell = el('td', 'raid-deckcell');
      const faces = el('span', 'raid-faces');
      for (const name of entry.decks[0]?.names ?? []) faces.append(face(name));
      deckCell.append(faces);
      if (entry.decks.length > 1) deckCell.append(el('span', 'raid-more', t('+ {n}덱', { n: entry.decks.length - 1 })));
      // 재계산됨 — 엔진이 바뀐 뒤 어드민이 자리 그대로 다시 돌린 기록. 직접 돌린 기록과 다르다.
      if (entry.recalculatedAt) {
        const badge = el('span', 'raid-recalc', t('재계산됨'));
        badge.title = entry.recalculatedAt.slice(0, 10);
        deckCell.append(badge);
      }
      row.append(deckCell);
      row.append(el('td', 'raid-total', raidDamageText(entry.total)));
      row.append(el('td', 'raid-chev', '▾'));
      const detail = el('tr', 'raid-detail-row');
      detail.hidden = true;
      const cell = el('td');
      cell.colSpan = 5;
      cell.append(renderEntryDetail(entry, admin));
      detail.append(cell);
      row.addEventListener('click', () => toggle(detail, row));
      body.append(row, detail);
      // 열 번째 아래에 금을 긋는다 — 어디까지가 «상위»인지 한눈에.
      if (rank === 10 && entries.length > 10) {
        const cut = el('tr', 'raid-cut');
        const cutCell = el('td');
        cutCell.colSpan = 5;
        cutCell.append(el('span', '', t('11위부터')));
        cut.append(cutCell);
        body.append(cut);
      }
    });
    table.append(body);
    const scroll = el('div', 'raid-scroll');
    scroll.append(table);
    box.append(scroll);
    return box;
  }

  function render(): void {
    host.replaceChildren();
    const raid = selected();
    const account = deps.account();
    const admin = deps.adminPass() !== '';

    host.append(el('p', 'raid-lede', t('어드민이 올린 전투 조건 하나로 모두가 다섯 덱을 돌려 합산 딜을 겨룹니다. 육성은 블라블라링크로 받은 값 그대로이고, 큐브와 버스트 순서만 내 것입니다.')));
    host.append(renderPicker());
    if (!raid) return;

    if (admin) {
      const bar = el('div', 'raid-admin');
      bar.append(el('b', '', t('어드민')));
      bar.append(el('span', '', t('{date}에 열림 · 참가 {n}명 · 제출자 식별은 어드민에게만 보입니다',
        { date: raid.openedAt.slice(0, 10), n: raid.count })));
      if (raid.status === 'open') {
        const close = el('button', 'raid-ghost', t('레이드 종료 (랭킹 고정)'));
        close.type = 'button';
        close.dataset.raidClose = '';
        close.addEventListener('click', () => { void closeRaid(); });
        bar.append(close);
        // 엔진이 바뀌면 기록을 자리 그대로 다시 돌린다 — 이 레이드만, 또는 열린 것 전부.
        const recalcRow = el('div', 'raid-migrate');
        const recalcOne = el('button', 'raid-ghost', t('이 레이드 전체 재계산 (새 엔진 · 버충 신 방식)'));
        recalcOne.type = 'button';
        recalcOne.dataset.raidRecalc = '';
        const recalcAll = el('button', 'raid-ghost', t('열린 레이드 전부 재계산'));
        recalcAll.type = 'button';
        recalcAll.dataset.raidRecalcAll = '';
        const recalcOut = el('span', 'raid-verify-out');
        recalcOne.addEventListener('click', () => {
          recalcOne.disabled = recalcAll.disabled = true;
          void recalcRaids([raid], recalcOut).finally(() => { recalcOne.disabled = recalcAll.disabled = false; });
        });
        recalcAll.addEventListener('click', () => {
          recalcOne.disabled = recalcAll.disabled = true;
          void recalcRaids(raids.filter((other) => other.status === 'open'), recalcOut)
            .finally(() => { recalcOne.disabled = recalcAll.disabled = false; });
        });
        recalcRow.append(recalcOne, recalcAll, recalcOut);
        bar.append(recalcRow);
        // 다른 레이드의 기록을 이 조건으로 다시 돌려 옮겨 온다 — 시즌이 바뀌었을 때.
        const others = raids.filter((other) => other.id !== raid.id);
        if (others.length > 0) {
          const row = el('div', 'raid-migrate');
          const from = document.createElement('select');
          from.dataset.raidMigrateFrom = '';
          for (const other of others) {
            const option = document.createElement('option');
            option.value = other.id;
            option.textContent = t('{title} ({n}명)', { title: other.title, n: other.count });
            from.append(option);
          }
          // 방향은 언제나 «고른 레이드 → 지금 보는 레이드»다. 글에도 그렇게 적는다.
          const go = el('button', 'raid-ghost', t('→ 「{title}」로 재계산해서 옮기기', { title: raid.title }));
          go.type = 'button';
          go.dataset.raidMigrate = '';
          const out = el('span', 'raid-verify-out');
          go.addEventListener('click', () => {
            go.disabled = true;
            void migrate(from.value, out).finally(() => { go.disabled = false; });
          });
          row.append(el('span', 'raid-migrate-label', t('기록 옮겨오기 — 어디에서:')), from, go, out);
          bar.append(row);
        }
      } else {
        const reopen = el('button', 'raid-ghost', t('다시 열기 (제출 재개)'));
        reopen.type = 'button';
        reopen.dataset.raidReopen = '';
        reopen.addEventListener('click', () => { void reopenRaid(); });
        // 지우기는 두 번 누른다 — 랭킹·스펙까지 통째로 사라지는 일이라 한 번에 안 된다.
        const remove = el('button', 'raid-ghost is-danger', t('완전히 삭제'));
        remove.type = 'button';
        remove.dataset.raidDelete = '';
        remove.addEventListener('click', () => {
          if (remove.dataset.armed === undefined) {
            remove.dataset.armed = '';
            remove.textContent = t('정말 지웁니다 — 한 번 더 누르기');
            return;
          }
          void deleteRaid();
        });
        bar.append(reopen, remove);
      }
      host.append(bar);
    }

    const boss = el('div', 'raid-boss');
    boss.append(el('h3', '', raid.title));
    boss.append(el('p', 'raid-boss-auto', raid.auto));
    boss.append(el('p', 'field-note', raid.status === 'open'
      ? t('어드민이 올린 전투 조건입니다. 바꿀 수 없고, 싱크로는 400 고정 · 콘솔은 내 블라블라링크 계정 값입니다.')
      : t('마감된 레이드입니다. 기록을 더 받지 않고 랭킹만 남습니다.')));
    host.append(boss);
    host.append(renderRules());
    host.append(el('p', 'raid-note', RAID_ALGORITHM_NOTE));

    const mySection = el('section', 'raid-section');
    mySection.append(el('h4', '', t('내 5덱')));
    mySection.append(renderMyDecks());
    host.append(mySection);

    const bar = el('div', 'raid-run');
    // 표시 이름은 계산 **전에** 받는다 — 내 최고 딜이면 결과가 나오는 순간 올라간다.
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 16;
    nameInput.placeholder = t('표시 이름 (나와 어드민만 봄)');
    nameInput.value = displayName;
    nameInput.dataset.raidName = '';
    nameInput.addEventListener('input', () => {
      displayName = nameInput.value.trim();
      try { localStorage.setItem(NAME_KEY, displayName); } catch { /* 무시 */ }
    });
    const go = el('button', 'calculate-button raid-go');
    go.type = 'button';
    go.dataset.raidRun = '';
    go.disabled = running || raid.status !== 'open' || !account;
    go.append(el('span', '', raid.status !== 'open' ? t('마감된 레이드') : running ? t('계산 중…') : t('5덱 레이드 계산')));
    go.addEventListener('click', () => { void run(); });
    const mocking = mock && deps.mockRequest !== undefined;
    const consoleMissing = account !== null && !account.console;
    // 모의전이면 계정이 없어도 돌린다 — 올리지 않으니까. 콘솔을 못 받은 계정도 진짜 계산은 못 돌린다.
    go.disabled = running || raid.status !== 'open' || (!mocking && (!account || consoleMissing));
    bar.append(nameInput, go);
    // 계산 취소 — 도는 동안만. 끊으면 작업 스레드를 새로 세우므로 다음 계산은 준비부터다(본 계산기와 같다).
    if (running && deps.cancel) {
      const cancel = el('button', 'calc-cancel raid-cancel', t('계산 취소'));
      cancel.type = 'button';
      cancel.dataset.raidCancel = '';
      cancel.addEventListener('click', () => {
        if (cancelRequested) return;
        cancelRequested = true;
        cancel.disabled = true;
        deps.cancel?.();
      });
      bar.append(cancel);
    }
    const best = myRecord();
    const note = el('span', 'raid-run-note');
    note.dataset.raidRunNote = '';
    if (!mocking && consoleMissing) note.classList.add('is-warn');
    note.textContent = mocking
      ? t('모의전 — 수치 설정·컨트롤을 자유롭게 바꿔 계산합니다(톡톡이만 3.6발/s 고정). 결과는 랭킹에 올라가지 않고 «이대로라면 몇 등»만 알려 줍니다.')
      : !account
        ? t('블라블라링크로 계정을 이어야 돌릴 수 있습니다. 보는 것은 누구나 됩니다.')
        : consoleMissing
          ? RAID_CONSOLE_MISSING
          : best
            ? t('계산 결과가 내 기록({m})보다 높으면 묻지 않고 바로 랭킹에 올립니다.', { m: raidDamageText(best.total) })
            : t('계산 결과는 묻지 않고 바로 랭킹에 올라갑니다 — 계정당 하나, 더 높을 때만 갱신됩니다.');
    bar.append(note);
    if (deps.mockRequest) {
      const mockLabel = el('label', 'raid-mock');
      const mockBox = document.createElement('input');
      mockBox.type = 'checkbox';
      mockBox.checked = mock;
      mockBox.dataset.raidMock = '';
      mockBox.disabled = running || raid.status !== 'open';
      mockBox.addEventListener('change', () => {
        mock = mockBox.checked;
        computed = null;
        message = '';
        deps.onMock?.(mock);
        render();
      });
      mockLabel.append(mockBox, el('span', '', t('모의전 (수치 설정 자유 · 기록 안 올림)')));
      bar.append(mockLabel);
    }
    host.append(bar);

    if (computed && computed.raidId === raid.id) {
      const result = el('div', 'raid-result');
      result.dataset.raidResult = '';
      result.append(el('b', 'raid-big', raidDamageText(computed.total)));
      result.append(el('span', 'raid-sub', t('{n}덱 합산 · {title} · 덱별 결과는 아래 전투 결과 판에', { n: computed.rows.length, title: raid.title })));
      // 자동으로 안 올라갔을 때만(올리다 실패했거나 내 기록보다 낮을 때) 손으로 올리는 문을 낸다.
      if (computed.mock) {
        result.append(el('span', 'raid-mock-badge', t('모의전 — 기록 안 올림')));
      } else if (!computed.submitted) {
        const who = el('div', 'raid-submit-row');
        const submitButton = el('button', 'raid-submit', t('랭킹에 올리기'));
        submitButton.type = 'button';
        submitButton.dataset.raidSubmit = '';
        submitButton.disabled = !account || raid.status !== 'open';
        submitButton.addEventListener('click', () => { void submit(); });
        who.append(submitButton);
        result.append(who);
      }
      host.append(result);
    }

    if (message) {
      const note = el('p', messageOk ? 'raid-msg is-ok' : 'raid-msg');
      note.dataset.raidMessage = '';
      note.textContent = message;
      host.append(note);
    }

    const boardSection = el('section', 'raid-section');
    const head = el('div', 'raid-board-head');
    head.append(el('h4', '', t('랭킹')));
    const reload = el('button', 'raid-ghost raid-refresh', t('⟳ 새로고침'));
    reload.type = 'button';
    reload.dataset.raidRefresh = '';
    reload.disabled = loading;
    reload.addEventListener('click', () => { void refresh(); });
    head.append(reload);
    // 내 순위로 — 참가자가 수십 명이면 내 줄을 찾아 내려가야 한다. 눌러서 그 줄로 가고 잠깐 밝힌다.
    const mineNow = myRecord();
    if (mineNow) {
      const rank = (board?.entries ?? []).findIndex((entry) => entry.eid === mineNow.eid) + 1;
      const toMine = el('button', 'raid-ghost raid-to-mine', t('내 순위({rank}위)로', { rank }));
      toMine.type = 'button';
      toMine.dataset.raidToMine = '';
      toMine.addEventListener('click', () => {
        const row = host.querySelector<HTMLElement>(`[data-raid-row="${mineNow.eid}"]`);
        if (!row) return;
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        row.classList.remove('is-flash');
        void row.offsetWidth;
        row.classList.add('is-flash');
      });
      head.append(toMine);
    }
    head.append(el('span', '', t('참가 {n}명 · 다른 참가자는 익명입니다 · 줄을 누르면 덱이 펼쳐집니다', { n: board?.entries.length ?? 0 })));
    boardSection.append(head, renderBoard());
    host.append(boardSection);
  }

  render();
  return {
    refresh,
    openRaid,
    openRaids: () => raids.filter((raid) => raid.status === 'open'),
    showLast: () => { if (lastEntries.length > 0) deps.showResults?.(lastEntries); },
    mock: () => mock,
  };
}
