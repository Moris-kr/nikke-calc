import type { CharacterMeta } from './types';

// enikk.app 솔로레이드 랭킹에서 실사용 조합을 가져온다.
//
// enikk은 GraphQL 하나로 도는 앱이고 CORS가 우리 오리진을 그대로 허용한다 —
// 프록시 없이 브라우저에서 바로 부른다(실측 2026-08-24).
//
// **페이지를 넘길 필요가 없다.** Ranks 탭이 화면에서는 페이지로 나뉘어 보이지만
// `SRRankings`는 한 번에 다 준다: 기본값이 서버당 50명 × 6개 서버 = 300명이다.

const ENDPOINT = 'https://enikk.app/api/graphql';

/** enikk 서버 코드. 기본 300명은 여기 여섯이 정확히 50명씩이다. */
export const SERVERS = ['KR', 'JP', 'GLOBAL', 'NA', 'TW-HK', 'SEA'] as const;

export interface EnikkSeason {
  raid: number;
  boss: string;
  /** 보스의 **약점** 속성(영문). 보스 자신의 속성이 아니다. */
  weakness: string;
}

export interface EnikkTeam {
  characters: string[];
  cores?: number[];
  damage?: number;
  cp?: number;
}

export interface EnikkRanking {
  rank: number | null;
  playerid: string;
  server: string;
  damage: number;
  cp: number;
  teams: EnikkTeam[];
}

/** 조합 하나 — 같은 5인 편성을 쓴 덱들을 묶은 것. */
export interface EnikkComp {
  /** 우리 캐릭명 5개. enikk 표기 순서를 그대로 둔다(= 버스트 우선순위로 읽힌다). */
  squad: string[];
  /** 이 조합을 쓴 덱 수 */
  uses: number;
  /** 그 덱들의 평균 딜 */
  averageDamage: number;
  /** 그 덱들의 최고 딜 */
  maxDamage: number;
}

export interface EnikkImport {
  season: EnikkSeason;
  /** 랭킹에 오른 플레이어 수 */
  players: number;
  /** 읽어들인 덱 수 (플레이어당 최대 5) */
  decks: number;
  comps: EnikkComp[];
  /** 우리가 이름을 못 붙인 enikk 영문명 — 신캐가 나오면 여기 잡힌다. */
  unknownNames: string[];
  /** 계산기가 아직 못 도는 니케가 낀 조합 수 */
  unsupported: number;
}

async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`enikk이 ${response.status}를 돌려줬습니다. 잠시 뒤 다시 시도해 주세요.`);
  }
  const payload = await response.json() as { data?: T; errors?: Array<{ message: string }> };
  if (payload.errors?.length) {
    throw new Error(`enikk 응답 오류: ${payload.errors[0]!.message}`);
  }
  if (!payload.data) throw new Error('enikk이 빈 응답을 돌려줬습니다.');
  return payload.data;
}

/** 가장 최근 시즌. 목록의 `weakness`는 보스의 **약점**이다(보스 속성이 아니다). */
export async function fetchLatestSeason(): Promise<EnikkSeason> {
  const data = await graphql<{
    soloRaidSummaries: Array<{ raid_number: number; wave_name: string; weakness: string }>;
  }>('{ soloRaidSummaries { raid_number wave_name weakness } }');
  const latest = [...data.soloRaidSummaries].sort((a, b) => b.raid_number - a.raid_number)[0];
  if (!latest) throw new Error('시즌 목록이 비어 있습니다.');
  return { raid: latest.raid_number, boss: latest.wave_name, weakness: latest.weakness };
}

/**
 * enikk 영문 표기 → 우리 캐릭명.
 *
 * **이름을 글자로 맞추면 반드시 틀린다** — 한국 서버가 음차하지 않는 캐릭터가 있다
 * (`Liter`=리타, `Moran`=목단, `Rouge`=루주). enikk의 `resource_id`가 우리
 * `nikke_scraped.json`의 `id`와 같은 체계라 그걸로 잇는다.
 */
export async function fetchNameMap(catalog: CharacterMeta[]): Promise<Map<string, string>> {
  const data = await graphql<{
    characters: Array<{ resource_id: number; name_localkey: string }>;
  }>('{ characters { resource_id name_localkey } }');
  const byResource = new Map<number, string>();
  for (const char of catalog) {
    if (char.resourceId !== null && char.resourceId !== undefined) {
      byResource.set(char.resourceId, char.name);
    }
  }
  const map = new Map<string, string>();
  for (const entry of data.characters) {
    const name = byResource.get(entry.resource_id);
    if (name) map.set(entry.name_localkey, name);
  }
  return map;
}

/** 랭킹 원본. 서버당 50명씩 6개 서버 = 300명이 한 번에 온다. */
export async function fetchRankings(raid: number): Promise<EnikkRanking[]> {
  const data = await graphql<{ SRRankings: EnikkRanking[] }>(
    'query($raid: Float!) { SRRankings(raid: $raid) '
    + '{ rank playerid server damage cp teams } }',
    { raid },
  );
  return data.SRRankings ?? [];
}

/** 랭킹을 조합 단위로 접는다. 사용 횟수가 많은 순, 같으면 평균 딜이 높은 순. */
export function toComps(
  rankings: EnikkRanking[],
  nameMap: Map<string, string>,
  supported: Set<string>,
): Omit<EnikkImport, 'season'> {
  const buckets = new Map<string, { squad: string[]; uses: number; damages: number[] }>();
  const unknown = new Set<string>();
  let decks = 0;
  let unsupported = 0;

  for (const row of rankings) {
    for (const team of row.teams ?? []) {
      const raw = team.characters ?? [];
      if (raw.length === 0) continue;
      decks += 1;
      const squad: string[] = [];
      let ok = true;
      for (const english of raw) {
        const name = nameMap.get(english);
        if (!name) { unknown.add(english); ok = false; break; }
        squad.push(name);
      }
      if (!ok) continue;
      if (!squad.every((name) => supported.has(name))) { unsupported += 1; continue; }
      // 순서를 지킨 채로 묶는다 — enikk 표기 순서가 곧 버스트 우선순위다.
      const key = JSON.stringify(squad);
      const bucket = buckets.get(key) ?? { squad, uses: 0, damages: [] };
      bucket.uses += 1;
      // 딜이 안 실려 온 덱은 사용 횟수에만 넣는다 — 0을 평균에 섞으면 평균이 무너진다.
      if (typeof team.damage === 'number' && team.damage > 0) bucket.damages.push(team.damage);
      buckets.set(key, bucket);
    }
  }

  const comps: EnikkComp[] = [...buckets.values()].map(({ squad, uses, damages }) => ({
    squad,
    uses,
    averageDamage: damages.length
      ? damages.reduce((sum, d) => sum + d, 0) / damages.length : 0,
    maxDamage: damages.reduce((max, d) => Math.max(max, d), 0),
  }));
  comps.sort((a, b) => b.uses - a.uses || b.averageDamage - a.averageDamage);

  return {
    players: rankings.length,
    decks,
    comps,
    unknownNames: [...unknown],
    unsupported,
  };
}

/** 전체 흐름. 진행 상황을 단계마다 알린다 — 몇 초 걸리는 일이라 침묵하면 멈춘 줄 안다. */
export async function loadEnikkComps(
  catalog: CharacterMeta[],
  supported: Set<string>,
  onProgress?: (message: string) => void,
): Promise<EnikkImport> {
  onProgress?.('시즌 정보를 확인하는 중…');
  const season = await fetchLatestSeason();

  onProgress?.('니케 이름표를 맞추는 중…');
  const nameMap = await fetchNameMap(catalog);

  onProgress?.(`시즌 ${season.raid} 랭킹 300명을 받는 중… 5초쯤 걸립니다`);
  const rankings = await fetchRankings(season.raid);

  onProgress?.('조합을 세는 중…');
  return { season, ...toComps(rankings, nameMap, supported) };
}

/** 억 단위 표기. enikk은 `42B`로 쓰지만 우리는 억으로 읽는다. */
export function formatEok(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  return `${(value / 100_000_000).toFixed(1)}억`;
}

/** enikk 약점 표기(영문) → 우리 속성 이름. 랩쳐 코드에는 **보스 속성**을 넣어야 하므로
 *  약점을 그대로 코드에 넣으면 특효가 반대로 걸린다 — 안내에만 쓴다. */
export const WEAKNESS_KO: Record<string, string> = {
  Fire: '작열',
  Water: '수냉',
  Wind: '풍압',
  Electronic: '전격',
  Iron: '철갑',
};
