/**
 * 신식 적정거리 — 보스까지의 거리 d가 적정거리 무기군과 코어·보스의 보이는 크기를 정한다.
 *
 * 표의 정본은 엔진과 같은 `data/weapon_mechanics.json`의 `distance`·`accuracy_distance`이고,
 * 설정(`settings.json`)으로 내려온 것을 그대로 받아 쓴다 — 화면이 따로 값을 들고 있지 않는다.
 * 엔진 쪽 계산은 `engine/timeline.ts`의 `distance_weapons`·`distance_scale`·`_spread_diameter`다.
 */
import type { SettingsCatalog, SimulationRequest } from './types';

export type DistanceTable = NonNullable<SettingsCatalog['distance']>;
export type SpreadTable = NonNullable<SettingsCatalog['accuracyDistance']>;

/** 거리 d에서 적정거리인 무기군 — 무기군별 [가까운 끝, 먼 끝] 안(양 끝 포함). 런처는 표에 없다. */
export function distanceWeapons(table: DistanceTable | undefined, d: number): string[] {
  if (!table) return [];
  return Object.entries(table.ranges).filter(([, [lo, hi]]) => lo <= d && d <= hi).map(([weapon]) => weapon);
}

/** 거리 d에서 보이는 크기 배율 — 기준 거리 ÷ d. 코어 직경 입력은 기준 거리(중거리)의 크기다. */
export function distanceScale(table: DistanceTable | undefined, d: number): number {
  return table && d > 0 ? table.reference / d : 1;
}

/** 요청이 신식이면 그 시각의 거리 d(구간이 있으면 구간 값), 구식이면 null. */
export function distanceAt(request: SimulationRequest, time: number, table?: DistanceTable): number | null {
  if (request.rangeModel !== 'distance') return null;
  const window = (request.distanceWindows ?? []).find((w) => time >= w.from && time < w.to);
  return window ? window.distance : (request.distance ?? table?.reference ?? 30);
}

/** 거리 프리셋 이름. */
export const DISTANCE_PRESET_LABEL: Record<string, string> = { near: '근거리', mid: '중거리', far: '원거리' };
