import { sequenceForDeck, trimSequence } from './burst-order';
import type {
  BatchResult,
  BattleSettings,
  CharacterOverrides,
  DeckResultEntry,
  DeckState,
  SimulationRequest,
} from './types';

const integerInRange = (value: number, min: number, max: number): boolean =>
  Number.isInteger(value) && value >= min && value <= max;

/** 엔진 기본 스펙과 같은 값. 이것과 같으면 요청에 싣지 않는다(캐시 키가 갈리지 않게). */
export const DEFAULT_SYNCHRO_LEVEL = 400;

/**
 * 싱크로 레벨 상한 — **인게임 캐릭터 레벨 상한**이다(블라블라링크 CDN
 * `/character/CharacterLevelTable.json`이 1~1400을 담는다).
 */
export const SYNCHRO_MAX = 1400;
/**
 * 실측이 닿는 곳. 1000까지는 스탯표(`level_stats.json`)이고, 1161까지는
 * 블라블라링크 도감의 레벨업 미리보기에서 잰 값(`level_beyond.json`)이다.
 * 이 위만 추정이라, 화면이 그때만 «추정»이라고 적는다.
 */
export const SYNCHRO_MEASURED_MAX = 1161;
/** 버스트 반응속도 기본값(초). 엔진 `DEFAULT_CONFIG`와 같은 값이다. */
export const DEFAULT_BURST_REACTION = 0.05;

export function normalizeRequest(request: SimulationRequest): SimulationRequest {
  const squad = request.squad.map((name) => name.trim()).filter(Boolean);
  const characters = normalizeCharacters(request.characters, squad);
  const customForSquad = pickCustomForSquad(request.customCharacters, squad);
  return {
    squad,
    ...(Object.keys(characters).length > 0 ? { characters } : {}),
    ...(customForSquad ? { customCharacters: customForSquad } : {}),
    duration: Math.trunc(request.duration),
    enemyDef: Math.trunc(request.enemyDef),
    enemyCode: request.enemyCode,
    corePx: Math.trunc(request.corePx),
    hasParts: Boolean(request.hasParts),
    seed: Math.trunc(request.seed),
    // 고른 순서가 달라도 같은 설정이다 — 정렬해 캐시 키가 갈리지 않게 한다.
    ...(request.optimalRangeWeapons?.length
      ? { optimalRangeWeapons: [...request.optimalRangeWeapons].sort() } : {}),
    // 보스 페이즈는 시작 시각순으로 세운다 — 넣은 순서가 달라도 같은 설정이다.
    ...(request.immuneWindows?.length ? { immuneWindows:
      [...request.immuneWindows].sort((a, b) => a.from - b.from || a.to - b.to) } : {}),
    ...(request.elementWindows?.length ? { elementWindows:
      [...request.elementWindows].sort((a, b) => a.from - b.from || a.to - b.to) } : {}),
    // **언제나 싣는다.** 「기본값이니 빼도 된다」고 뺐다가, 빠지면 난수로 읽는 브리지와
    // 기본값이 어긋나 기대값으로 둔 사람들이 내내 난수 모드로 계산하고 있었다. 경계를
    // 넘는 값은 양쪽이 같은 기본값을 안다고 믿지 말고 그냥 적어 보낸다.
    rngMode: request.rngMode ?? 'expected',
    // 손으로 정한 버스트 순서. 안 정했으면 아예 안 싣는다 — 옛 캐시 키와 갈리지 않게.
    ...(trimSequence(request.burstSequence)
      ? { burstSequence: trimSequence(request.burstSequence)! } : {}),
    // 기본값(켜짐)은 요청·캐시 키에서 뺀다.
    ...(request.immuneBlocksBurst === false ? { immuneBlocksBurst: false } : {}),
    // 평타 계수도 캐시 키에 실린다 — 값이 다른 결과가 섞이면 안 된다. 키 순서가
    // 흔들려도 같은 설정이므로 정렬해 싣는다.
    ...(normalizeRecord(request.normalHitCoeff)
      ? { normalHitCoeff: normalizeRecord(request.normalHitCoeff)! } : {}),
    ...(request.burstRegenTime !== undefined
      ? { burstRegenTime: request.burstRegenTime } : {}),
    // 기본값(0.05초)은 요청에서 뺀다 — 엔진이 같은 값을 쓰므로 옛 캐시 키와 갈리지 않는다.
    ...(request.burstReaction !== undefined && request.burstReaction !== DEFAULT_BURST_REACTION
      ? { burstReaction: request.burstReaction } : {}),
    // 기본 레벨(400)은 요청에서 뺀다 — 엔진이 같은 값을 쓰므로 옛 캐시 키와 갈리지 않는다.
    ...(request.synchroLevel !== undefined && request.synchroLevel !== DEFAULT_SYNCHRO_LEVEL
      ? { synchroLevel: Math.trunc(request.synchroLevel) } : {}),
    ...(request.console ? { console: {
      common_level: Math.trunc(request.console.common_level),
      class_level: normalizeBuckets(request.console.class_level),
      company_level: normalizeBuckets(request.console.company_level),
    } } : {}),
  };
}

// 스쿼드에 실제로 편성된 커스텀 니케만 요청·캐시키에 싣는다.
function pickCustomForSquad(
  custom: SimulationRequest['customCharacters'],
  squad: string[],
): SimulationRequest['customCharacters'] | undefined {
  if (!custom) return undefined;
  const picked: NonNullable<SimulationRequest['customCharacters']> = {};
  for (const name of squad) if (custom[name]) picked[name] = custom[name]!;
  return Object.keys(picked).length > 0 ? picked : undefined;
}

// 소속별 콘솔은 키 순서가 흔들려도 같은 설정이다 — 캐시 키가 갈리지 않게 정렬한다.
function normalizeBuckets(values: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values)
      .map(([bucket, level]) => [bucket, Math.trunc(level)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizeRecord(values: Record<string, number> | undefined): Record<string, number> | undefined {
  if (!values) return undefined;
  const entries = Object.entries(values)
    .filter(([, value]) => Number.isFinite(value))
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeCharacters(
  raw: Record<string, CharacterOverrides> | undefined,
  squad: string[],
): Record<string, CharacterOverrides> {
  const result: Record<string, CharacterOverrides> = {};
  for (const name of squad) {
    const value = raw?.[name];
    if (!value) continue;
    const skillLevels = value.skillLevels ? { ...value.skillLevels } : undefined;
    const overload = normalizeRecord(value.overload);
    const manualStats = normalizeRecord(value.manualStats);
    const normalized: CharacterOverrides = {
      ...(value.growthStage !== undefined ? { growthStage: value.growthStage } : {}),
      ...(skillLevels ? { skillLevels } : {}),
      ...(overload ? { overload } : {}),
      ...(value.cube ? {
        cube: { name: value.cube.name, level: Math.trunc(value.cube.level) },
      } : {}),
      ...(value.collection ? {
        collection: {
          stage: value.collection.stage,
          favorite: Math.trunc(value.collection.favorite),
        },
      } : {}),
      ...(manualStats ? { manualStats } : {}),
      ...(value.burst ? { burst: value.burst } : {}),
      ...(value.equipLevels && Object.keys(value.equipLevels).length > 0
        ? { equipLevels: { ...value.equipLevels } } : {}),
      ...(value.control !== undefined ? { control: value.control } : {}),
      ...(value.weaponModeSwapAt !== undefined
        ? { weaponModeSwapAt: value.weaponModeSwapAt } : {}),
    };
    if (Object.keys(normalized).length > 0) result[name] = normalized;
  }
  return result;
}

export function validateRequest(request: SimulationRequest): string[] {
  const errors: string[] = [];
  const squad = request.squad.map((name) => name.trim()).filter(Boolean);

  if (squad.length === 0) {
    errors.push('스쿼드에 캐릭터를 1명 이상 편성해 주세요.');
  } else if (squad.length > 5) {
    errors.push('스쿼드는 최대 5명까지 편성할 수 있습니다.');
  }
  if (new Set(squad).size !== squad.length) {
    errors.push('같은 캐릭터를 두 번 편성할 수 없습니다.');
  }
  if (!integerInRange(request.duration, 10, 180)) {
    errors.push('전투 시간은 10~180초여야 합니다.');
  }
  if (request.synchroLevel !== undefined && !integerInRange(request.synchroLevel, 1, SYNCHRO_MAX)) {
    errors.push(`싱크로 레벨은 1~${SYNCHRO_MAX}이어야 합니다.`);
  }
  if (!integerInRange(request.enemyDef, 0, 999_999)) {
    errors.push('적 방어력은 0~999999여야 합니다.');
  }
  if (!integerInRange(request.corePx, 0, 1_000)) {
    errors.push('코어 직경은 0~1000px여야 합니다.');
  }
  if (!integerInRange(request.seed, 0, 2_147_483_647)) {
    errors.push('시드는 0~2147483647 사이의 정수여야 합니다.');
  }
  if (request.burstRegenTime !== undefined
      && !(Number.isFinite(request.burstRegenTime)
        && request.burstRegenTime >= 0 && request.burstRegenTime <= 20)) {
    errors.push('버스트 게이지 충전 시간은 0~20초여야 합니다.');
  }
  if (request.burstReaction !== undefined
      && !(Number.isFinite(request.burstReaction)
        && request.burstReaction >= 0 && request.burstReaction <= 3)) {
    errors.push('버스트 반응속도는 0~3초여야 합니다.');
  }
  // 보스 페이즈 — 시작이 끝보다 뒤면 조용히 뒤집지 않고 막는다. 엔진도 같은 규칙이다.
  const windows: Array<[{ from: number; to: number }, string]> = [
    ...(request.immuneWindows ?? []).map((w) => [w, '족자'] as [typeof w, string]),
    ...(request.elementWindows ?? []).map((w) => [w, '속저'] as [typeof w, string]),
  ];
  for (const [w, label] of windows) {
    if (!Number.isFinite(w.from) || !Number.isFinite(w.to)
        || w.from < 0 || w.to > 180 || w.from < 0) {
      errors.push(`${label} 구간은 0~180초여야 합니다.`);
    } else if (w.from >= w.to) {
      errors.push(`${label} 구간은 시작이 끝보다 앞서야 합니다 (${w.from}~${w.to}).`);
    }
  }

  if (request.console) {
    const levels: Array<[number, string]> = [
      [request.console.common_level, '공통'],
      ...Object.entries(request.console.class_level)
        .map(([bucket, level]) => [level, `클래스(${bucket})`] as [number, string]),
      ...Object.entries(request.console.company_level)
        .map(([bucket, level]) => [level, `기업(${bucket})`] as [number, string]),
    ];
    for (const [level, label] of levels) {
      if (!integerInRange(level, 0, 1_000)) {
        errors.push(`${label} 콘솔 레벨은 0~1000 사이의 정수여야 합니다.`);
      }
    }
  }

  return errors;
}

export function cacheKey(request: SimulationRequest, version: string): string {
  const normalized = normalizeRequest(request);
  return JSON.stringify({ version, ...normalized });
}

export function validateDecks(decks: DeckState[]): string[] {
  const errors: string[] = [];
  const nonEmpty = decks.filter((deck) => deck.squad.some((name) => name.trim()));
  if (nonEmpty.length === 0) {
    errors.push('캐릭터가 편성된 덱이 하나 이상 필요합니다.');
    return errors;
  }
  for (const deck of nonEmpty) {
    const names = deck.squad.map((name) => name.trim()).filter(Boolean);
    if (names.length > 5) {
      errors.push(`덱 ${deck.id}: 캐릭터는 최대 5명까지 편성할 수 있습니다.`);
    }
    if (new Set(names).size !== names.length) {
      errors.push(`덱 ${deck.id}: 같은 캐릭터를 두 번 편성할 수 없습니다.`);
    }
  }
  return errors;
}

export function requestForDeck(
  deck: DeckState,
  battle: BattleSettings,
  customCharacters?: SimulationRequest['customCharacters'],
): SimulationRequest {
  return normalizeRequest({
    squad: deck.squad,
    characters: deck.characters,
    ...(customCharacters ? { customCharacters } : {}),
    duration: battle.duration,
    synchroLevel: battle.synchroLevel,
    enemyDef: battle.enemyDef,
    enemyCode: battle.enemyCode,
    corePx: battle.coreEnabled ? battle.corePx : 0,
    hasParts: battle.hasParts,
    seed: battle.seed,
    optimalRangeWeapons: battle.optimalRangeWeapons,
    immuneWindows: battle.immuneWindows,
    elementWindows: battle.elementWindows,
    rngMode: battle.rngMode,
    immuneBlocksBurst: battle.immuneBlocksBurst,
    normalHitCoeff: battle.normalHitCoeff,
    console: battle.console,
    // 덱마다 따로 잡아 뒀으면 그 값이 이긴다 — 버스트 쿨이 밀리는 덱만 달리 잰다.
    burstRegenTime: battle.burstRegenPerDeck?.[deck.id] ?? battle.burstRegenTime,
    burstReaction: battle.burstReaction,
    // 편성이 바뀌었으면 없는 이름을 떨궈서 싣는다 — 조용히 틀린 순서로 돌지 않게.
    ...(sequenceForDeck(deck) ? { burstSequence: sequenceForDeck(deck)! } : {}),
  });
}

export function resetEnemy(battle: BattleSettings): BattleSettings {
  return {
    ...battle,
    enemyDef: 31_784,
    enemyCode: '',
    coreEnabled: false,
    corePx: 52,
    hasParts: false,
  };
}

export function aggregateDeckResults(decks: DeckResultEntry[]): BatchResult {
  return {
    total: decks.reduce((sum, entry) => sum + entry.result.squadTotal, 0),
    decks,
  };
}

export function formatDamage(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 100_000_000).toFixed(2)}억`;
  }
  return Math.round(value).toLocaleString('en-US');
}

export function formatDps(value: number): string {
  return `${formatDamage(value)}/초`;
}

/**
 * 줄이지 않은 대미지 — 1의 자리까지.
 *
 * 「1.24억」은 한눈에 견주기 좋지만 두 덱이 소수점 둘째 자리까지 같게 보이는 일이
 * 생긴다. 「자세히 보기」를 켜면 이쪽으로 적는다. 엔진은 처음부터 정수로 세므로
 * 여기서 정밀해지는 것은 없다 — 있던 자리를 그대로 보일 뿐이다.
 */
export const formatExactDamage = (value: number): string =>
  Math.round(value).toLocaleString('en-US');

/** 줄이지 않은 초당 대미지. 소수점 한 자리까지 — 정수로 자르면 덱 간 차이가 묻힌다. */
export const formatExactDps = (value: number): string =>
  `${(Math.round(value * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1 })}/초`;
