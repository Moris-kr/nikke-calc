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
    ...(request.burstRegenTime !== undefined
      ? { burstRegenTime: request.burstRegenTime } : {}),
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
    enemyDef: battle.enemyDef,
    enemyCode: battle.enemyCode,
    corePx: battle.coreEnabled ? battle.corePx : 0,
    hasParts: battle.hasParts,
    seed: battle.seed,
    console: battle.console,
    burstRegenTime: battle.burstRegenTime,
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
