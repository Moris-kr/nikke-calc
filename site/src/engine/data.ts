/**
 * 고속 엔진의 데이터 — 파이썬 엔진과 **같은 JSON 파일**을 읽는다(사이트 런타임 `runtime/data/…`).
 *
 * 파이썬 모듈은 불러올 때 파일을 읽지만, 여기서는 워커가 받은 JSON을 `setEngineData`로 한 번 넣고
 * 각 모듈이 `data()`로 꺼낸다. 모듈을 import하는 시점에는 읽지 않는다(아직 없을 수 있다).
 *
 * 사용자 정의 니케(`customCharacters`)는 파이썬처럼 이 사전들을 직접 고친다 — 모든 모듈이 같은
 * 객체를 보므로 한 번 넣으면 전부에 반영된다.
 */

export interface EngineData {
  parsed_nikke: Record<string, any>;
  parsed_skills: Record<string, any>;
  char_defaults: Record<string, any>;
  weapon_delays: Record<string, any>;
  weapon_mechanics: Record<string, any>;
  burst_gauge: Record<string, any>;
  tables: {
    affinity: any;
    collection: any;
    console: any;
    cube: any;
    equipment_skills: any;
    equipment_stats: any;
    level_beyond: any;
    level_stats: any;
  };
}

/** 런타임 파일 경로(사이트 `runtime/` 아래) → 키. 워커가 이 목록대로 받는다. */
export const ENGINE_DATA_FILES: Record<string, string> = {
  'data/parsed_nikke.json': 'parsed_nikke',
  'data/parsed_skills.json': 'parsed_skills',
  'data/char_defaults.json': 'char_defaults',
  'data/weapon_delays.json': 'weapon_delays',
  'data/weapon_mechanics.json': 'weapon_mechanics',
  'data/burst_gauge.json': 'burst_gauge',
  'data/base_stat_tables/affinity.json': 'tables.affinity',
  'data/base_stat_tables/collection.json': 'tables.collection',
  'data/base_stat_tables/console.json': 'tables.console',
  'data/base_stat_tables/cube.json': 'tables.cube',
  'data/base_stat_tables/equipment_skills.json': 'tables.equipment_skills',
  'data/base_stat_tables/equipment_stats.json': 'tables.equipment_stats',
  'data/base_stat_tables/level_beyond.json': 'tables.level_beyond',
  'data/base_stat_tables/level_stats.json': 'tables.level_stats',
};

let current: EngineData | null = null;

/** 경로 → 파싱된 JSON 사전으로 엔진 데이터를 넣는다. 빠진 파일이 있으면 바로 실패한다. */
export function setEngineData(files: Record<string, unknown>): void {
  const out: any = { tables: {} };
  for (const [path, key] of Object.entries(ENGINE_DATA_FILES)) {
    if (!(path in files)) throw new Error(`고속 엔진 데이터가 빠졌습니다: ${path}`);
    const value = files[path];
    if (key.startsWith('tables.')) out.tables[key.slice(7)] = value;
    else out[key] = value;
  }
  current = out as EngineData;
  onDataChange.forEach((fn) => fn());
}

/** 데이터가 바뀌면(다시 넣으면) 모듈 캐시를 비우도록 부르는 훅. */
export const onDataChange: Array<() => void> = [];

export function data(): EngineData {
  if (!current) throw new Error('고속 엔진 데이터가 아직 준비되지 않았습니다.');
  return current;
}

export function hasEngineData(): boolean {
  return current !== null;
}
