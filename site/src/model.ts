import type { SimulationRequest } from './types';

const integerInRange = (value: number, min: number, max: number): boolean =>
  Number.isInteger(value) && value >= min && value <= max;

export function normalizeRequest(request: SimulationRequest): SimulationRequest {
  return {
    squad: request.squad.map((name) => name.trim()).filter(Boolean),
    duration: Math.trunc(request.duration),
    enemyDef: Math.trunc(request.enemyDef),
    enemyCode: request.enemyCode,
    corePx: Math.trunc(request.corePx),
    hasParts: Boolean(request.hasParts),
    seed: Math.trunc(request.seed),
  };
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

  return errors;
}

export function cacheKey(request: SimulationRequest, version: string): string {
  const normalized = normalizeRequest(request);
  return JSON.stringify({ version, ...normalized });
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
