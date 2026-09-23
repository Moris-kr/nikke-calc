/**
 * 전투 결과 재생 — 계산 결과를 가로 전투 화면처럼 흘려 본다.
 *
 * 저장된 요청을 **사격·상태 트랙을 켜고** 한 번 더 계산한다(샷건 히트맵과 같은 방식). 화면은
 * 전부 그 결과에서 «커서 시각»으로 되짚어 그린다 — 보스 메이커의 버스트 알림과 같은 원칙이다.
 * 이벤트로 쏘지 않으므로 멈춰도, 뒤로 끌어도, 배속을 바꿔도 같은 시각은 늘 같은 그림이다.
 *
 * 화면:
 * * 가운데 적 한 마리와 동그란 피격 범위. 사격 칸마다 그 안에 탄흔이 튀고(표시용 표본) 적이 살짝
 *   번쩍인다. 무대 아래 탄착 필터로 니케별·종류별(평타·코어·스킬) 탄흔만 골라 본다.
 * * 아래 SD 다섯 — 재장전 구간이면 재장전 자세, 아니면 사격 자세. 머리 위에 받는 버프 칩(시전자
 *   얼굴·중첩), 누르면 그때 걸린 버프 창.
 * * 오른쪽 가운데 버스트 게이지, 왼쪽에는 버스트 사용 내역이 아래에서 위로 쌓인다.
 *
 * SD는 지금 모두 같은 회색 자리표시자다. 캐릭터별 SD는 `SD_SPRITES`에 이름으로 넣으면 된다.
 */

import sdShootUrl from './assets/replay/sd-shoot.webp';
import sdReloadUrl from './assets/replay/sd-reload.webp';
import enemyUrl from './assets/replay/enemy.webp';
import battleBgUrl from './assets/replay/battle-bg.webp';
import { SD_IDS } from './sd-ids';
import { inlineCodeIcon, superiorCode } from './element-inline';
import './battle-replay.css';
import { formatDamage } from './model';
import { statText } from './stat-names';
import { t } from './i18n';
import type {
  BattleTimeline, BuffTrack, BurstCast, ChargeRecord, DeckResultEntry, ShotTrack, SimulationRequest, SimulationResult,
  StateTrack,
} from './types';
import { spanTargets } from './types';

export type ReplayPose = 'shoot' | 'reload';

/**
 * 캐릭터별 SD. 없으면 회색 자리표시자를 쓴다. 사격은 뒷모습, 재장전은 **이쪽(화면)을 보는** 앞모습이다.
 *
 * 그림은 `assets/replay/sd/<게임 ID>-shoot.webp`·`-reload.webp` 두 장이고(ID는 스크랩 데이터의 `id`),
 * `sd-ids.ts`가 정식 명칭 → ID를 적는다. 두 장이 다 있어야 쓴다.
 */
const SD_FILES = import.meta.glob('./assets/replay/sd/*.webp', { eager: true, import: 'default' }) as Record<string, string>;
const sdFile = (id: number, pose: ReplayPose): string | undefined => SD_FILES[`./assets/replay/sd/${id}-${pose}.webp`];

export const SD_SPRITES: Record<string, { shoot: string; reload: string }> = Object.fromEntries(
  Object.entries(SD_IDS).flatMap(([name, id]) => {
    const shoot = sdFile(id, 'shoot');
    const reload = sdFile(id, 'reload');
    return shoot && reload ? [[name, { shoot, reload }]] : [];
  }),
);
export const DEFAULT_SD = { shoot: sdShootUrl, reload: sdReloadUrl };

export function spriteFor(name: string, pose: ReplayPose): string {
  return (SD_SPRITES[name] ?? DEFAULT_SD)[pose];
}

/** 무한 장탄의 센티널. 엔진이 999999로 둔다(`timeline.py`). */
const AMMO_INFINITE = 99_999;
/** 이만큼 안에 평타를 쐈으면 «사격 중»으로 본다. SR·RL은 발 사이가 길어 칸 하나로 보면 깜빡인다. */
const SHOOT_WINDOW = 0.45;
/** 탄흔이 남아 있는 시간(초). */
const SPARK_SECONDS = 0.35;
/** 머리 위 버프 칩 최대 개수. 넘치면 앞의 몇 개와 `+N`. */
const HEAD_BUFFS = 8;

/** 탄흔 종류 — 탄착 필터의 단위. 코어는 평타 가운데 코어에 맞은 것이다. */
export type ImpactKind = 'normal' | 'core' | 'skill';
const IMPACT_KINDS: ImpactKind[] = ['normal', 'core', 'skill'];
const IMPACT_LABEL: Record<ImpactKind, string> = { normal: '평타', core: '코어', skill: '스킬' };

// ── 순수 계산 (시각 → 그 순간의 상태) ─────────────────────────────────────

/** 그 시각의 버스트 게이지(%). 점열은 프레임 단위이고 값은 다음 점까지 그대로다. */
export function gaugeAt(points: Array<[number, number]> | undefined, time: number): number {
  if (!points || points.length === 0) return 0;
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid]![0] <= time) lo = mid + 1; else hi = mid;
  }
  return lo === 0 ? 0 : points[lo - 1]![1];
}

/** 그 시각이 든 풀버스트 구간. `[시작, 끝)`. */
export function fullBurstAt(windows: Array<[number, number]> | undefined, time: number): [number, number] | null {
  for (const window of windows ?? []) if (time >= window[0] && time < window[1]) return window;
  return null;
}

/**
 * 게이지 옆에 적을 단계 — 다음에 쓸 버스트 단계, 풀버스트 중이면 FULL.
 *
 * 마지막 풀버스트가 끝난 뒤(없으면 전투 시작부터) 가장 최근에 쓴 버스트의 다음 단계다.
 */
export function burstStageAt(
  bursts: Record<string, BurstCast[]> | undefined, windows: Array<[number, number]> | undefined, time: number,
): 'I' | 'II' | 'III' | 'FULL' {
  if (fullBurstAt(windows, time)) return 'FULL';
  let since = 0;
  for (const [, end] of windows ?? []) if (end <= time && end > since) since = end;
  let latest: BurstCast | null = null;
  for (const list of Object.values(bursts ?? {})) {
    for (const cast of list) {
      if (cast.t < since || cast.t > time) continue;
      if (!latest || cast.t >= latest.t) latest = cast;
    }
  }
  if (!latest) return 'I';
  if (latest.stage === '1') return 'II';
  if (latest.stage === '2') return 'III';
  return 'I';
}

/** 그 칸 번호. 트랙 끝을 넘지 않는다. */
const indexAt = (track: { bucket: number; buckets: number }, time: number): number =>
  Math.max(0, Math.min(track.buckets - 1, Math.floor(time / track.bucket + 1e-9)));

/** 재장전 구간이면 재장전 자세, 아니면 사격 자세. */
export function poseAt(states: StateTrack | undefined, name: string, time: number): ReplayPose {
  const row = states?.chars[name];
  if (row && row.reload.some(([from, to]) => time >= from && time < to)) return 'reload';
  return 'shoot';
}

/** 최근 `SHOOT_WINDOW`초 안에 평타·스킬 사격이 있었나. */
export function firingAt(shots: ShotTrack | undefined, name: string, time: number): boolean {
  const row = shots?.chars[name];
  if (!row || !shots) return false;
  const last = indexAt(shots, time);
  const first = Math.max(0, Math.floor((time - SHOOT_WINDOW) / shots.bucket));
  for (let i = first; i <= last; i += 1) if ((row.normal[i] ?? 0) + (row.skill[i] ?? 0) > 0) return true;
  return false;
}

/** 그 시각의 남은 탄. 무한이면 null. */
export function ammoAt(states: StateTrack | undefined, name: string, time: number): { ammo: number | null; max: number } {
  const row = states?.chars[name];
  if (!row || !states) return { ammo: 0, max: 0 };
  const index = indexAt(states, time);
  const ammo = row.ammo[index] ?? 0;
  // 최대 장탄은 그 시각의 값(장탄 버프가 붙고 빠지는 대로). 예전 결과는 판 전체의 최댓값뿐이다.
  const max = row.maxAmmoTrack?.[index] ?? row.maxAmmo;
  return { ammo: ammo >= AMMO_INFINITE ? null : ammo, max: max >= AMMO_INFINITE ? 0 : max };
}

export interface BurstLogRow { name: string; cast: BurstCast; age: number }

/** 지금까지 쓴 버스트 중 최근 `limit`개. 오래된 것이 앞이다(아래에서 위로 밀려 올라간다). */
export function burstLogAt(bursts: Record<string, BurstCast[]> | undefined, time: number, limit = 6): BurstLogRow[] {
  const rows: BurstLogRow[] = [];
  for (const [name, list] of Object.entries(bursts ?? {})) {
    for (const cast of list) if (cast.t <= time) rows.push({ name, cast, age: time - cast.t });
  }
  rows.sort((a, b) => a.cast.t - b.cast.t);
  return rows.slice(-limit);
}

export interface ActiveBuffRow {
  name: string;
  caster: string;
  stack: number;
  maxStack: number;
  remaining: number;
  stat: string | null;
  value: number | null;
}

/** 그 시각에 `target`이 받고 있는 버프 — 기록 순서대로, 구간 끝(`to`)과 함께. */
function activeBuffs(tracks: BuffTrack[] | undefined, target: string, time: number): Array<{ row: ActiveBuffRow; to: number }> {
  const rows: Array<{ row: ActiveBuffRow; to: number }> = [];
  for (const track of tracks ?? []) {
    for (const span of track.spans) {
      const [from, to, stack] = span;
      if (time < from || time >= to) continue;
      if (!spanTargets(track, span).includes(target)) continue;
      rows.push({
        row: {
          name: track.name, caster: track.caster, stack, maxStack: track.maxStack,
          remaining: to - time, stat: track.stat ?? null, value: track.value ?? null,
        },
        to,
      });
      break;
    }
  }
  return rows;
}

/** 그 시각에 `target`이 받고 있는 버프. 남은 시간이 짧은 것부터. */
export function buffsOnAt(tracks: BuffTrack[] | undefined, target: string, time: number): ActiveBuffRow[] {
  return activeBuffs(tracks, target, time).map(({ row }) => row)
    .sort((a, b) => a.remaining - b.remaining || a.name.localeCompare(b.name, 'ko'));
}

/**
 * 머리 위 버프 칩의 순서 — 시간이 정해진 버프가 앞, 판 끝(`duration`)까지 가는 버프는 뒤.
 * 같은 무리 안에서는 기록 순서라 버프가 갱신돼도 칩이 자리를 바꾸지 않는다.
 */
export function headBuffsAt(tracks: BuffTrack[] | undefined, target: string, time: number, duration: number): ActiveBuffRow[] {
  const rows = activeBuffs(tracks, target, time);
  const lasting = (to: number) => (to >= duration - 1e-6 ? 1 : 0);
  return rows.sort((a, b) => lasting(a.to) - lasting(b.to)).map(({ row }) => row);
}

/** 그 시각까지 넣은 딜. 칸 안에서는 고르게 들어갔다고 본다. */
export function damageUntil(timeline: BattleTimeline | undefined, name: string, time: number): number {
  const row = timeline?.damage[name];
  if (!row || !timeline) return 0;
  const bucket = timeline.bucket || 1;
  const whole = Math.min(row.length, Math.floor(time / bucket));
  let sum = 0;
  for (let i = 0; i < whole; i += 1) sum += row[i] ?? 0;
  if (whole < row.length) sum += (row[whole] ?? 0) * ((time - whole * bucket) / bucket);
  return sum;
}

/**
 * 그 시각의 차징 표시(%). 인게임처럼 0 → 풀차지 배율까지 오른다 — 풀차지 배율은
 * `기본 배율 × (1 + 차지 대미지 배율%) + 차지 대미지%`(엔진이 발마다 기록한 값)다.
 * 차지 중이 아니면 null. `full`은 풀차지에 닿았나.
 */
export function chargeAt(
  records: ChargeRecord[] | undefined, time: number,
): { value: number; full: boolean; max: number } | null {
  if (!records || records.length === 0) return null;
  let lo = 0;
  let hi = records.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (records[mid]![0] <= time) lo = mid + 1; else hi = mid;
  }
  const record = records[lo - 1];
  if (!record) return null;
  const [start, fullAt, fire, max] = record;
  if (time > fire) return null;
  const span = fullAt - start;
  const progress = span > 0 ? Math.min(1, Math.max(0, (time - start) / span)) : 1;
  return { value: progress * max, full: progress >= 1, max };
}

export interface BossPatterns {
  /** 족자 — 평타가 빗나간다(보스가 사라진다). */
  immune: boolean;
  /** 속성 저지 코드. 이 코드에 **우월한** 코드(작열이면 수냉)만 통과한다. */
  element: string | null;
  /** 코어가 드러나 있나. 코어가 없는 판이면 null. */
  core: boolean | null;
  /** 방어력 배율(%). 없으면 null. */
  defenseRate: number | null;
  /** 적정거리 무기군. 없으면 null. */
  optimal: string[] | null;
  /** 샷건 표적 크기(시간별 조건). 없으면 null. */
  shotgunDiameter: number | null;
  /** 마지막 파츠 파괴로부터 흐른 시간(초). 파괴 주기가 없거나 아직이면 null. */
  partBreakAge: number | null;
}

const within = <T extends { from: number; to: number }>(windows: T[] | undefined, time: number): T | undefined =>
  (windows ?? []).find((window) => time >= window.from && time < window.to);

/** 그 시각에 켜져 있는 보스 패턴. 전투 조건(요청)에서 바로 읽는다. */
export function patternsAt(request: SimulationRequest, time: number): BossPatterns {
  const element = within(request.elementWindows, time);
  const defense = within(request.defenseRateWindows, time);
  const optimal = within(request.optimalRangeWindows, time);
  const size = within(request.shotgunSizeWindows, time);
  const coreWindows = request.coreWindows ?? [];
  const core = request.corePx > 0 ? (coreWindows.length === 0 || Boolean(within(coreWindows, time))) : null;
  const interval = request.partBreakInterval ?? 0;
  const breaks = interval > 0 ? Math.floor(time / interval) : 0;
  return {
    immune: Boolean(within(request.immuneWindows, time)),
    element: element ? element.code : null,
    core,
    defenseRate: defense ? defense.rate : null,
    optimal: optimal ? optimal.weapons : null,
    shotgunDiameter: size ? size.diameter : null,
    partBreakAge: breaks > 0 ? time - breaks * interval : null,
  };
}

/** 적에게 걸린 버프·디버프의 대상 이름(엔진 센티널). */
export const ENEMY = '__enemy__';

/** 표시용 난수 — 같은 (캐릭터, 칸)은 늘 같은 자리에 튄다. */
function hash(a: number, b: number): number {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── 화면 ──────────────────────────────────────────────────────────────────

export interface ReplayDeps {
  imageOf: (name: string) => string | undefined;
}

const cache = new WeakMap<DeckResultEntry, SimulationResult>();
let dismissActive: (() => void) | undefined;

const SPEEDS = [0.5, 1, 2, 4, 8];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const faceNode = (name: string, deps: ReplayDeps, className = 'br-face'): HTMLElement => {
  const face = el('i', className);
  const image = deps.imageOf(name);
  if (image) face.style.backgroundImage = `url(${image})`;
  else face.textContent = name.slice(0, 1);
  return face;
};

const secondsText = (value: number): string => `${value.toFixed(1)}${t('초')}`;

export function openBattleReplay(
  entry: DeckResultEntry,
  deckName: string,
  simulate: (request: SimulationRequest) => Promise<SimulationResult>,
  deps: ReplayDeps,
): () => void {
  dismissActive?.();
  const previousFocus = document.activeElement as HTMLElement | null;
  const squad = entry.request.squad.filter(Boolean);
  const duration = entry.request.duration;

  const overlay = el('div', 'custom-modal replay-modal');
  const card = el('section', 'custom-card replay-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', t('전투 결과 재생'));
  const head = el('div', 'custom-head');
  const title = el('div');
  title.append(el('small', '', 'BATTLE REPLAY'), el('h2', '', `${t('전투 결과 재생')} · ${deckName}`));
  const closeButton = el('button', '', '✕');
  closeButton.type = 'button';
  closeButton.dataset.replayClose = '';
  closeButton.setAttribute('aria-label', t('재생 닫기'));
  head.append(title, closeButton);
  const status = el('p', 'replay-status', t('재생할 전투를 다시 계산하는 중…'));
  status.setAttribute('role', 'status');
  status.dataset.replayStatus = '';

  // 무대 — 16:9. 안쪽 자리는 전부 %·cqw라 폭에 따라 통째로 커지고 줄어든다.
  const stage = el('div', 'br-stage');
  stage.dataset.replayStage = '';
  stage.hidden = true;
  const bg = el('img', 'br-bg');
  bg.src = battleBgUrl;
  bg.alt = '';
  const enemy = el('img', 'br-enemy');
  enemy.src = enemyUrl;
  enemy.alt = '';
  const hitbox = el('div', 'br-hitbox');
  hitbox.title = t('피격 범위');
  const fx = el('canvas', 'br-fx');
  fx.setAttribute('aria-hidden', 'true');

  const topBar = el('div', 'br-top');
  const total = el('div', 'br-total');
  total.dataset.replayTotal = '';
  const progress = el('div', 'br-progress');
  const progressFill = el('i', 'br-progress-fill');
  const progressMarks = el('div', 'br-progress-marks');
  progress.append(progressMarks, progressFill);
  const clock = el('div', 'br-clock');
  clock.dataset.replayClock = '';
  topBar.append(total, progress, clock);

  const gauge = el('div', 'br-gauge');
  gauge.dataset.replayGauge = '';
  const gaugeStage = el('b', 'br-gauge-stage', 'I');
  const gaugeBar = el('div', 'br-gauge-bar');
  const gaugeFill = el('i', 'br-gauge-fill');
  gaugeBar.append(gaugeFill);
  const gaugeText = el('span', 'br-gauge-text');
  gauge.append(gaugeStage, gaugeBar, gaugeText);

  const log = el('ol', 'br-log');
  log.dataset.replayLog = '';
  log.setAttribute('aria-label', t('버스트 사용 내역'));

  const banner = el('div', 'br-banner', 'FULL BURST');
  banner.dataset.replayBanner = '';
  banner.hidden = true;

  const squadRow = el('div', 'br-squad');
  const slots: Array<{
    name: string; root: HTMLButtonElement; sprite: HTMLImageElement; ammo: HTMLElement; ammoFill: HTMLElement;
    mark: HTMLElement; charge: HTMLElement; chargeFill: HTMLElement; chargeText: HTMLElement; dealt: HTMLElement;
    buffs: HTMLElement; buffKey: string;
  }> = [];
  squad.forEach((name, index) => {
    const root = el('button', 'br-slot');
    root.type = 'button';
    root.dataset.replaySlot = name;
    root.style.setProperty('--slot', String(index));
    root.title = `${name} · ${t('눌러서 지금 걸린 버프 보기')}`;
    root.setAttribute('aria-label', `${name} ${t('버프 보기')}`);
    const sprite = el('img', 'br-sprite');
    sprite.src = spriteFor(name, 'shoot');
    sprite.alt = '';
    sprite.draggable = false;
    const mark = el('span', 'br-mark');
    // 머리 위 버프 — 적 디버프 칩처럼 시전자 얼굴과 중첩 수. 누르는 건 자리 단추가 받는다.
    const buffs = el('span', 'br-slot-buffs');
    buffs.dataset.replaySlotBuffs = name;
    // 차징 — 머리 위 막대와 %. 풀차지 배율(예: 285%)까지 오른다.
    const charge = el('span', 'br-charge');
    charge.dataset.replayCharge = name;
    charge.hidden = true;
    const chargeBar = el('span', 'br-charge-bar');
    const chargeFill = el('i', 'br-charge-fill');
    chargeBar.append(chargeFill);
    const chargeText = el('b', 'br-charge-text');
    charge.append(chargeText, chargeBar);
    const cardRow = el('span', 'br-card');
    const ammo = el('span', 'br-ammo');
    const ammoBar = el('span', 'br-ammo-bar');
    const ammoFill = el('i', 'br-ammo-fill');
    ammoBar.append(ammoFill);
    const dealt = el('span', 'br-dealt');
    dealt.dataset.replayDealt = name;
    cardRow.append(faceNode(name, deps, 'br-card-face'), ammo, ammoBar, dealt);
    // 버프 칩은 머리 바로 위 — RELOAD·차징은 그 위에 뜬다.
    root.append(charge, mark, buffs, sprite, cardRow);
    squadRow.append(root);
    slots.push({ name, root, sprite, ammo, ammoFill, mark, charge, chargeFill, chargeText, dealt, buffs, buffKey: '' });
  });

  const buffPanel = el('div', 'br-buffs');
  buffPanel.dataset.replayBuffs = '';
  buffPanel.hidden = true;
  buffPanel.setAttribute('role', 'dialog');
  // 머리줄과 ✕는 한 번만 만든다. 재생 중에는 프레임마다 다시 그리는데, ✕까지 새로 만들면
  // 누르는 사이(pointerdown → pointerup)에 단추가 바뀌어 클릭이 사라진다(제보 2026-09-23).
  const buffHead = el('div', 'br-buffs-head');
  const buffTime = el('span');
  const buffClose = el('button', 'br-buffs-close', '✕');
  buffClose.type = 'button';
  buffClose.dataset.replayBuffsClose = '';
  buffClose.setAttribute('aria-label', t('버프 창 닫기'));
  const buffBody = el('div', 'br-buffs-body');
  buffPanel.append(buffHead, buffBody);
  let buffHeadFor: string | null = null;

  // 적 — 누르면 걸린 버프·디버프 창. 그림과 피격 범위 어디를 눌러도 된다.
  const enemyHit = el('button', 'br-enemy-hit');
  enemyHit.type = 'button';
  enemyHit.dataset.replayEnemy = '';
  enemyHit.title = t('눌러서 보스에게 걸린 버프·디버프 보기');
  enemyHit.setAttribute('aria-label', t('보스 버프·디버프 보기'));
  const core = el('i', 'br-core');
  core.hidden = true;
  const enemyBuffs = el('div', 'br-enemy-buffs');
  enemyBuffs.dataset.replayEnemyBuffs = '';
  const patterns = el('div', 'br-patterns');
  patterns.dataset.replayPatterns = '';
  const vanish = el('div', 'br-vanish', t('사라짐'));
  vanish.hidden = true;

  stage.append(bg, enemy, vanish, hitbox, core, fx, enemyHit, enemyBuffs, patterns, topBar, gauge, log, banner, squadRow, buffPanel);

  const controls = el('div', 'br-controls');
  controls.hidden = true;
  const play = el('button', 'br-play', '▶');
  play.type = 'button';
  play.dataset.replayPlay = '';
  play.setAttribute('aria-label', t('재생'));
  const speedButton = el('button', 'br-speed', '×1');
  speedButton.type = 'button';
  speedButton.dataset.replaySpeed = '';
  speedButton.title = t('재생 속도');
  const scrub = el('input', 'br-scrub');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.max = String(duration);
  scrub.step = '0.05';
  scrub.value = '0';
  scrub.dataset.replayScrub = '';
  scrub.setAttribute('aria-label', t('전투 시각'));
  const timeText = el('output', 'br-time');
  controls.append(play, speedButton, scrub, timeText);

  // 탄착 필터 — 니케별·종류별로 탄흔을 켜고 끈다. 피격 번쩍임도 보이는 탄만 따른다.
  const shownChars = new Set(squad);
  const shownKinds = new Set<ImpactKind>(IMPACT_KINDS);
  const filterBar = el('div', 'br-filter');
  filterBar.dataset.replayFilter = '';
  filterBar.hidden = true;
  filterBar.setAttribute('role', 'group');
  filterBar.setAttribute('aria-label', t('탄착 필터'));
  const filterChip = (className: string, title: string): HTMLButtonElement => {
    const chip = el('button', `br-filter-chip${className ? ` ${className}` : ''}`);
    chip.type = 'button';
    chip.title = title;
    return chip;
  };
  const allChip = filterChip('is-all', t('모든 탄착 다시 보기'));
  allChip.textContent = t('전체');
  allChip.dataset.replayFilterAll = '';
  const charChips = squad.map((name) => {
    const chip = filterChip('', `${name} · ${t('눌러서 이 니케의 탄착 켜기·끄기')}`);
    chip.dataset.replayFilterChar = name;
    chip.append(faceNode(name, deps, 'br-filter-face'), el('span', '', name));
    return chip;
  });
  const kindChips = IMPACT_KINDS.map((kind) => {
    const chip = filterChip(`is-${kind}`, t('눌러서 이 종류의 탄착 켜기·끄기'));
    chip.dataset.replayFilterKind = kind;
    chip.append(el('i', 'br-filter-dot'), el('span', '', t(IMPACT_LABEL[kind])));
    return chip;
  });
  filterBar.append(el('span', 'br-filter-label', t('탄착점')), allChip, ...charChips, el('span', 'br-filter-sep'), ...kindChips);
  const syncFilter = () => {
    charChips.forEach((chip, index) => chip.setAttribute('aria-pressed', String(shownChars.has(squad[index]!))));
    kindChips.forEach((chip, index) => chip.setAttribute('aria-pressed', String(shownKinds.has(IMPACT_KINDS[index]!))));
    allChip.setAttribute('aria-pressed', String(shownChars.size === squad.length && shownKinds.size === IMPACT_KINDS.length));
  };
  syncFilter();

  const note = el('p', 'replay-note', t('SD 캐릭터와 적은 모든 니케에 공통인 자리표시 그림입니다. 탄흔 위치는 표시용 표본이며 계산에는 쓰이지 않습니다. 가로 화면에서 크게 볼 수 있습니다.'));
  card.append(head, status, stage, controls, filterBar, note);
  overlay.append(card);
  document.body.append(overlay);

  let closed = false;
  let playing = false;
  let raf = 0;
  let last = 0;
  let cursor = 0;
  let speed = 1;
  let result: SimulationResult | null = null;
  let openBuffs: string | null = null;
  const ctx = fx.getContext?.('2d') ?? null;

  const close = () => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey, true);
    resizeObserver?.disconnect();
    overlay.remove();
    previousFocus?.focus();
    if (dismissActive === close) dismissActive = undefined;
  };
  dismissActive = close;

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (openBuffs) { openBuffs = null; draw(); return; }
      close();
      return;
    }
    if (event.key === ' ' && result && !(event.target instanceof HTMLInputElement && event.target.type !== 'range')) {
      if ((event.target as HTMLElement | null)?.tagName === 'BUTTON') return;
      event.preventDefault();
      setPlaying(!playing);
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [...overlay.querySelectorAll<HTMLElement>('button:not(:disabled),input')].filter((node) => node.getClientRects().length);
      const first = focusable[0];
      const end = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); end?.focus(); }
      else if (!event.shiftKey && document.activeElement === end) { event.preventDefault(); first?.focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  closeButton.addEventListener('click', close);
  closeButton.focus();
  let backdropPress = false;
  overlay.addEventListener('pointerdown', (event) => { backdropPress = event.target === overlay; });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay && backdropPress) close();
    backdropPress = false;
  });

  // ── 그리기 ────────────────────────────────────────────────────────────
  const sizeCanvas = () => {
    if (!ctx) return;
    const box = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    fx.width = Math.max(1, Math.round(box.width * dpr));
    fx.height = Math.max(1, Math.round(box.height * dpr));
  };
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { sizeCanvas(); draw(); });
  resizeObserver?.observe(stage);

  /** 피격 범위 — 무대 좌표(0~1). 적 그림 가운데에 동그랗게. */
  const HIT = { x: 0.5, y: 0.37, r: 0.085 };

  function drawEffects(res: SimulationResult) {
    if (!ctx) return;
    const width = fx.width;
    const height = fx.height;
    ctx.clearRect(0, 0, width, height);
    const shots = res.shots;
    if (!shots) return;
    const cx = HIT.x * width;
    const cy = HIT.y * height;
    const radius = HIT.r * width;
    const lastIndex = indexAt(shots, cursor);
    const firstIndex = Math.max(0, Math.floor((cursor - SPARK_SECONDS) / shots.bucket));
    squad.forEach((name, slot) => {
      const row = shots.chars[name];
      if (!row || !shownChars.has(name)) return;
      // 총구 — 자리 가운데에서 조금 오른쪽 위(회색 SD가 총을 오른쪽으로 겨눈다).
      const muzzleX = (0.14 + slot * 0.18 + 0.035) * width;
      const muzzleY = 0.63 * height;
      for (let i = firstIndex; i <= lastIndex; i += 1) {
        const normal = row.normal[i] ?? 0;
        const skill = row.skill[i] ?? 0;
        const core = Math.min(normal, row.core[i] ?? 0);
        if (normal + skill === 0) continue;
        const age = cursor - i * shots.bucket;
        if (age < 0) continue;
        const alpha = Math.max(0, 1 - age / SPARK_SECONDS);
        // 족자 중 평타는 빗나간다 — 회색으로 흩어진다. 스킬은 그대로 맞는다.
        const immune = patternsAt(entry.request, i * shots.bucket).immune;
        // 칸마다 최대 6발. k는 필터 전 순서(코어 → 평타 → 스킬)라 필터를 바꿔도 탄흔 자리가 그대로다.
        let drawn = 0;
        for (let k = 0; k < normal + skill && drawn < 6; k += 1) {
          const kind: ImpactKind = k >= normal ? 'skill' : k < core ? 'core' : 'normal';
          if (!shownKinds.has(kind)) continue;
          const angle = hash(slot * 131 + k, i) * Math.PI * 2;
          const dist = Math.sqrt(hash(i, slot * 17 + k + 5)) * radius * 0.92;
          const x = cx + Math.cos(angle) * dist;
          const y = cy + Math.sin(angle) * dist;
          // 사선 — 쏜 직후 아주 잠깐만.
          if (age < 0.08 && drawn === 0) {
            ctx.strokeStyle = `rgba(255,236,190,${(0.55 * (1 - age / 0.08)).toFixed(3)})`;
            ctx.lineWidth = Math.max(1, width / 900);
            ctx.beginPath();
            ctx.moveTo(muzzleX, muzzleY);
            ctx.lineTo(x, y);
            ctx.stroke();
          }
          drawn += 1;
          const size = (kind === 'skill' ? 7 : 4) * (width / 1280) * (0.6 + 0.4 * alpha);
          ctx.fillStyle = kind === 'skill' ? `rgba(196,140,255,${alpha.toFixed(3)})`
            : immune ? `rgba(170,178,186,${(alpha * 0.8).toFixed(3)})`
            : kind === 'core' ? `rgba(255,208,97,${alpha.toFixed(3)})` : `rgba(255,120,90,${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  }

  /** 칸 i에 필터를 통과해 **맞은** 탄 수. 족자 중(`immune`)에는 평타가 빗나가니 스킬만 센다. */
  function shownHitsAt(shots: ShotTrack, i: number, immune: boolean): number {
    let hits = 0;
    for (const name of squad) {
      const row = shots.chars[name];
      if (!row || !shownChars.has(name)) continue;
      if (!immune) {
        const normal = row.normal[i] ?? 0;
        const core = Math.min(normal, row.core[i] ?? 0);
        if (shownKinds.has('core')) hits += core;
        if (shownKinds.has('normal')) hits += normal - core;
      }
      if (shownKinds.has('skill')) hits += row.skill[i] ?? 0;
    }
    return hits;
  }

  function renderBuffPanel(res: SimulationResult) {
    if (!openBuffs) { buffPanel.hidden = true; return; }
    const name = openBuffs;
    const isEnemy = name === ENEMY;
    const index = squad.indexOf(name);
    buffPanel.hidden = false;
    buffPanel.classList.toggle('is-enemy', isEnemy);
    buffPanel.style.setProperty('--slot', String(Math.max(0, index)));
    buffPanel.setAttribute('aria-label', isEnemy ? t('보스 버프·디버프') : `${name} ${t('버프')}`);
    // 머리줄은 대상이 바뀔 때만 다시 짠다 — ✕는 늘 같은 단추다.
    if (buffHeadFor !== name) {
      buffHeadFor = name;
      if (isEnemy) {
        const face = el('i', 'br-face br-enemy-face');
        face.style.backgroundImage = `url(${enemyUrl})`;
        buffHead.replaceChildren(face, el('b', '', t('보스')), buffTime, buffClose);
      } else buffHead.replaceChildren(faceNode(name, deps), el('b', '', name), buffTime, buffClose);
    }
    buffTime.textContent = secondsText(cursor);
    buffBody.replaceChildren();
    const rows = buffsOnAt(res.timeline?.buffs, name, cursor);
    if (rows.length === 0) {
      buffBody.append(el('p', 'br-buffs-empty', !res.timeline?.buffs ? t('이 결과에는 버프 기록이 없습니다.')
        : isEnemy ? t('지금 보스에게 걸린 버프·디버프가 없습니다.') : t('지금 걸린 버프가 없습니다.')));
      return;
    }
    const list = el('ul', 'br-buffs-list');
    for (const row of rows) {
      const item = el('li');
      item.dataset.replayBuff = row.name;
      item.append(faceNode(row.caster, deps, 'br-buff-caster'));
      const body = el('span', 'br-buff-body');
      body.append(el('b', '', row.name));
      if (row.stat) body.append(el('small', '', statText(row.stat, row.value)));
      item.append(body);
      if (row.maxStack > 1 || row.stack > 1) item.append(el('em', 'br-buff-stack', `×${row.stack}`));
      item.append(el('span', 'br-buff-left', Number.isFinite(row.remaining) && row.remaining < duration ? secondsText(row.remaining) : '∞'));
      list.append(item);
    }
    buffBody.append(list);
  }

  function draw() {
    if (!result) return;
    const res = result;
    const timeline = res.timeline;
    // 위 — 누적 딜 · 진행 · 시계
    const dealt = squad.reduce((sum, name) => sum + damageUntil(timeline, name, cursor), 0);
    total.replaceChildren(el('b', '', formatDamage(dealt)), el('span', '', t('누적 딜')));
    progressFill.style.width = `${(cursor / duration) * 100}%`;
    clock.textContent = `${secondsText(cursor)} / ${secondsText(duration)}`;
    scrub.value = String(cursor);
    timeText.textContent = `${cursor.toFixed(1)} / ${duration}${t('초')}`;

    // 게이지
    const fb = fullBurstAt(timeline?.fullBurst, cursor);
    const stageName = burstStageAt(timeline?.bursts, timeline?.fullBurst, cursor);
    const value = fb ? 100 * (1 - (cursor - fb[0]) / Math.max(0.01, fb[1] - fb[0])) : gaugeAt(timeline?.gaugePoints, cursor);
    gaugeStage.textContent = stageName;
    gaugeFill.style.width = `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
    gauge.classList.toggle('is-full', Boolean(fb));
    gauge.classList.toggle('is-ready', !fb && value >= 99.95);
    gaugeText.textContent = fb ? secondsText(Math.max(0, fb[1] - cursor)) : timeline?.gaugePoints ? `${Math.floor(value)}%` : '';
    stage.classList.toggle('is-full-burst', Boolean(fb));
    banner.hidden = !fb || cursor - fb[0] > 1.6;

    // 버스트 사용 내역 — 새 것이 아래로 들어오고 오래된 것은 위로 밀려 흐려진다.
    log.replaceChildren();
    const rows = burstLogAt(timeline?.bursts, cursor, 6);
    rows.forEach((row, index) => {
      const item = el('li', row.age < 1.2 ? 'br-log-row is-new' : 'br-log-row');
      const rise = Math.min(1, row.age / 0.2);
      item.style.opacity = (0.35 + 0.65 * ((index + 1) / rows.length)).toFixed(2);
      item.style.transform = `translateX(${((1 - rise) * -18).toFixed(1)}px)`;
      item.append(faceNode(row.name, deps));
      if (row.cast.stage) item.append(el('b', 'br-log-stage', row.cast.stage === 'A' ? 'A' : `${row.cast.stage}`));
      item.append(el('span', 'br-log-name', row.cast.skill || row.name));
      item.title = `${row.cast.t.toFixed(2)}${t('초')} · ${row.name}`;
      log.append(item);
    });

    // 보스 패턴 — 족자(사라짐)·속성 저지·코어 노출·방어력·적정거리·샷건 표적·파츠 파괴
    const pat = patternsAt(entry.request, cursor);
    stage.classList.toggle('is-immune', pat.immune);
    vanish.hidden = !pat.immune;
    hitbox.classList.toggle('is-immune', pat.immune);
    hitbox.classList.toggle('is-shielded', pat.element !== null);
    hitbox.dataset.element = pat.element ?? '';
    core.hidden = pat.core !== true || pat.immune;
    patterns.replaceChildren();
    const badge = (text: string, kind: string, icon?: HTMLElement) => {
      const chip = el('span', `br-pattern is-${kind}`);
      chip.dataset.replayPattern = kind;
      if (icon) chip.append(icon);
      chip.append(document.createTextNode(text));
      patterns.append(chip);
    };
    if (pat.immune) badge(t('족자 · 평타 빗나감'), 'immune');
    if (pat.element) {
      // 저지 코드가 아니라 **그 코드에 우월한** 코드가 통과한다 — 작열 저지면 수냉만.
      const pass = superiorCode(pat.element) || pat.element;
      badge(t('속성 저지 {code} · {pass}만 통과', { code: pat.element, pass }), 'element', inlineCodeIcon(pass));
    }
    if (pat.core === true && !pat.immune && (entry.request.coreWindows?.length ?? 0) > 0) badge(t('코어 노출'), 'core');
    if (pat.defenseRate !== null) badge(t('방어력 {rate}%', { rate: pat.defenseRate }), 'defense');
    if (pat.optimal) badge(t('적정거리 · {weapons}', { weapons: pat.optimal.join('·') }), 'optimal');
    if (pat.shotgunDiameter !== null) badge(t('샷건 표적 ⌀{d}', { d: pat.shotgunDiameter }), 'shotgun');
    if (pat.partBreakAge !== null && pat.partBreakAge < 1.4) badge(t('파츠 파괴!'), 'parts');

    // 적에게 걸린 버프·디버프 — 적 위에 시전자 얼굴 아이콘으로
    enemyBuffs.replaceChildren();
    for (const row of buffsOnAt(timeline?.buffs, ENEMY, cursor).slice(0, 10)) {
      const chip = el('span', 'br-enemy-buff');
      chip.dataset.replayEnemyBuff = row.name;
      chip.append(faceNode(row.caster, deps, 'br-enemy-buff-face'));
      if (row.stack > 1) chip.append(el('b', '', String(row.stack)));
      chip.title = `${row.name} · ${row.caster}${row.stat ? ` · ${statText(row.stat, row.value)}` : ''}`;
      enemyBuffs.append(chip);
    }
    enemyHit.classList.toggle('is-open', openBuffs === ENEMY);

    // SD
    for (const slot of slots) {
      const pose = poseAt(res.states, slot.name, cursor);
      const firing = pose === 'shoot' && firingAt(res.shots, slot.name, cursor);
      const src = spriteFor(slot.name, pose);
      if (slot.sprite.getAttribute('src') !== src) slot.sprite.src = src;
      slot.root.classList.toggle('is-reload', pose === 'reload');
      slot.root.classList.toggle('is-firing', firing);
      slot.root.classList.toggle('is-open', openBuffs === slot.name);
      const casting = (timeline?.bursts[slot.name] ?? []).some((cast) => cursor >= cast.t && cursor - cast.t < 1.2);
      slot.root.classList.toggle('is-bursting', casting);
      slot.mark.textContent = pose === 'reload' ? 'RELOAD' : '';
      const { ammo, max } = ammoAt(res.states, slot.name, cursor);
      slot.ammo.textContent = ammo === null ? '∞' : max > 0 ? `${ammo}/${max}` : String(ammo);
      slot.ammoFill.style.width = ammo === null ? '100%' : max > 0 ? `${Math.min(100, (ammo / max) * 100).toFixed(1)}%` : '0%';
      slot.root.classList.toggle('is-empty', ammo === 0);
      // 차징 — 재장전 중에는 감춘다.
      const charging = pose === 'reload' ? null : chargeAt(res.charges?.[slot.name], cursor);
      slot.charge.hidden = charging === null;
      if (charging) {
        slot.chargeText.textContent = `${Math.round(charging.value)}%`;
        slot.chargeFill.style.width = `${Math.min(100, (charging.value / Math.max(1, charging.max)) * 100).toFixed(1)}%`;
        slot.charge.classList.toggle('is-full', charging.full);
      }
      slot.dealt.textContent = formatDamage(damageUntil(timeline, slot.name, cursor));
      // 머리 위 버프 칩 — 걸린 것이 바뀔 때만 다시 만든다.
      const onMe = headBuffsAt(timeline?.buffs, slot.name, cursor, duration);
      const buffKey = JSON.stringify(onMe.map((row) => [row.name, row.caster, row.stack]));
      if (buffKey !== slot.buffKey) {
        slot.buffKey = buffKey;
        const shown = onMe.length > HEAD_BUFFS ? onMe.slice(0, HEAD_BUFFS - 1) : onMe;
        slot.buffs.replaceChildren(...shown.map((row) => {
          const chip = el('span', 'br-slot-buff');
          chip.dataset.replaySlotBuff = row.name;
          chip.append(faceNode(row.caster, deps, 'br-slot-buff-face'));
          if (row.stack > 1) chip.append(el('b', '', String(row.stack)));
          return chip;
        }));
        if (shown.length < onMe.length) slot.buffs.append(el('span', 'br-slot-buff is-more', `+${onMe.length - shown.length}`));
      }
    }

    // 피격 — 이번 칸에 (보이는 탄이) 맞았으면 피격 범위 테두리가 번쩍이고, 적이 살짝 밝아지며 떨린다.
    // 세기는 맞은 수로 정하고 칸 안에서 사그라든다. 시각으로 정하니 멈추면 그 모습 그대로 선다.
    let hitPower = 0;
    let hitIndex = 0;
    if (res.shots) {
      hitIndex = indexAt(res.shots, cursor);
      const hits = shownHitsAt(res.shots, hitIndex, pat.immune);
      const phase = Math.min(1, Math.max(0, cursor / res.shots.bucket - hitIndex));
      hitPower = hits > 0 ? Math.min(1, 0.45 + hits / 10) * (1 - 0.5 * phase) : 0;
    }
    hitbox.classList.toggle('is-hit', hitPower > 0);
    enemy.classList.toggle('is-hit', hitPower > 0);
    enemy.style.setProperty('--hit', hitPower.toFixed(3));
    enemy.style.setProperty('translate', hitPower > 0
      ? `${((hash(hitIndex, 7919) - 0.5) * 0.3 * hitPower).toFixed(3)}cqw ${((hash(7919, hitIndex) - 0.5) * 0.16 * hitPower).toFixed(3)}cqw`
      : '');

    renderBuffPanel(res);
    drawEffects(res);
  }

  // ── 재생 ────────────────────────────────────────────────────────────
  const seek = (time: number) => {
    cursor = Math.max(0, Math.min(duration, time));
    draw();
  };
  function setPlaying(on: boolean) {
    if (on && !result) return;
    playing = on;
    // 멈춤이면 화면의 반복 애니메이션(사격 반동·흔들림·깜빡임)도 같이 멈춘다(제보 2026-09-23).
    stage.classList.toggle('is-paused', !playing);
    play.textContent = playing ? '❚❚' : '▶';
    play.setAttribute('aria-label', playing ? t('멈춤') : t('재생'));
    if (!playing) { cancelAnimationFrame(raf); return; }
    if (cursor >= duration) seek(0);
    last = performance.now();
    raf = requestAnimationFrame(step);
  }
  function step(now: number) {
    if (!playing || closed) return;
    // 다른 탭에 다녀오면 프레임이 멈췄다 한꺼번에 온다 — 한 프레임 몫으로 자른다.
    const elapsed = Math.min(0.25, (now - last) / 1000);
    last = now;
    seek(cursor + elapsed * speed);
    if (cursor >= duration) { setPlaying(false); return; }
    raf = requestAnimationFrame(step);
  }
  play.addEventListener('click', () => setPlaying(!playing));
  speedButton.addEventListener('click', () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
    speedButton.textContent = `×${speed}`;
  });
  scrub.addEventListener('input', () => { setPlaying(false); seek(Number(scrub.value)); });
  progress.addEventListener('pointerdown', (event) => {
    const box = progress.getBoundingClientRect();
    if (box.width <= 0) return;
    setPlaying(false);
    seek(((event.clientX - box.left) / box.width) * duration);
  });
  for (const slot of slots) {
    slot.root.addEventListener('click', () => {
      openBuffs = openBuffs === slot.name ? null : slot.name;
      draw();
    });
  }
  enemyHit.addEventListener('click', () => {
    openBuffs = openBuffs === ENEMY ? null : ENEMY;
    draw();
  });
  buffClose.addEventListener('click', (event) => {
    event.stopPropagation();
    openBuffs = null;
    draw();
  });
  allChip.addEventListener('click', () => {
    for (const name of squad) shownChars.add(name);
    for (const kind of IMPACT_KINDS) shownKinds.add(kind);
    syncFilter();
    draw();
  });
  charChips.forEach((chip, index) => chip.addEventListener('click', () => {
    const name = squad[index]!;
    if (!shownChars.delete(name)) shownChars.add(name);
    syncFilter();
    draw();
  }));
  kindChips.forEach((chip, index) => chip.addEventListener('click', () => {
    const kind = IMPACT_KINDS[index]!;
    if (!shownKinds.delete(kind)) shownKinds.add(kind);
    syncFilter();
    draw();
  }));

  void (async () => {
    try {
      const res = cache.get(entry) ?? await simulate({ ...entry.request, shotTrack: true });
      cache.set(entry, res);
      if (closed) return;
      result = res;
      // 진행 바에 풀버스트 구간을 깔아 둔다 — 어디서 몰아치는지가 바에서 읽힌다.
      // 족자·속성 저지 구간도 함께 — 보스가 언제 무엇을 하는지가 바에서 읽힌다.
      const mark = (from: number, to: number, kind: string) => {
        const node = el('i', `is-${kind}`);
        node.style.left = `${(from / duration) * 100}%`;
        node.style.width = `${(Math.max(0, to - from) / duration) * 100}%`;
        return node;
      };
      progressMarks.replaceChildren(
        ...(entry.request.immuneWindows ?? []).map((w) => mark(w.from, w.to, 'immune')),
        ...(entry.request.elementWindows ?? []).map((w) => mark(w.from, w.to, 'element')),
        ...(res.timeline?.fullBurst ?? []).map(([from, to]) => mark(from, to, 'burst')),
      );
      const drift = Math.abs(res.squadTotal - entry.result.squadTotal) > 0.5;
      status.textContent = drift
        ? t('현재 엔진으로 다시 계산한 재생입니다. 저장된 결과와 총 대미지가 조금 다릅니다.')
        : t('준비되는 대로 재생합니다. 스페이스로 멈추고, SD 캐릭터나 보스를 누르면 그 순간 걸린 버프가 보입니다.');
      stage.hidden = false;
      controls.hidden = false;
      filterBar.hidden = false;
      sizeCanvas();
      draw();
      play.focus();
      // 준비되면 바로 재생한다.
      setPlaying(true);
    } catch (error) {
      if (!closed) status.textContent = `${t('재생을 준비하지 못했습니다')}: ${(error as Error).message}`;
    }
  })();

  return close;
}
