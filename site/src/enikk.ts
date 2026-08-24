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

/** 덱 하나. enikk 표기 순서를 그대로 둔다(= 버스트 우선순위로 읽힌다). */
export interface EnikkDeck {
  squad: string[];
  damage: number;
  cp: number;
  /** 우리가 못 다루는 니케가 껴 있으면 편성에 못 올린다. */
  usable: boolean;
}

/** 랭킹에 오른 플레이어 한 명과 그 사람의 덱들. */
export interface EnikkPlayer {
  rank: number | null;
  playerid: string;
  server: string;
  /** 5덱 합 — enikk의 플레이어 총딜이 정확히 이 합이다(실측 확인). */
  damage: number;
  cp: number;
  decks: EnikkDeck[];
}

export interface EnikkImport {
  season: EnikkSeason;
  players: EnikkPlayer[];
  /** 읽어들인 덱 수 (플레이어당 최대 5) */
  decks: number;
  /** 우리가 이름을 못 붙인 enikk 영문명 — 신캐가 나오면 여기 잡힌다. */
  unknownNames: string[];
  /** 계산기가 아직 못 도는 니케가 낀 덱 수 */
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

/**
 * 랭킹 원본 → 플레이어별 덱 목록.
 *
 * **조합으로 묶지 않는다.** 한 사람이 어떤 다섯 덱을 어떻게 짰는지가 그대로 남아야
 * 그 편성을 통째로 가져올 수 있다. 같은 조합을 여럿이 썼다는 사실은 여기서 세지 않는다.
 */
export function toPlayers(
  rankings: EnikkRanking[],
  nameMap: Map<string, string>,
  supported: Set<string>,
): Omit<EnikkImport, 'season'> {
  const unknown = new Set<string>();
  let decks = 0;
  let unsupported = 0;
  const players: EnikkPlayer[] = [];

  for (const row of rankings) {
    const list: EnikkDeck[] = [];
    for (const team of row.teams ?? []) {
      const raw = team.characters ?? [];
      if (raw.length === 0) continue;
      decks += 1;
      const squad: string[] = [];
      let usable = true;
      for (const english of raw) {
        const name = nameMap.get(english);
        if (!name) { unknown.add(english); usable = false; continue; }
        squad.push(name);
      }
      if (usable && !squad.every((name) => supported.has(name))) usable = false;
      if (!usable) unsupported += 1;
      list.push({
        squad,
        damage: typeof team.damage === 'number' ? team.damage : 0,
        cp: typeof team.cp === 'number' ? team.cp : 0,
        usable,
      });
    }
    if (list.length === 0) continue;
    players.push({
      rank: row.rank ?? null,
      playerid: row.playerid,
      server: row.server,
      damage: row.damage,
      cp: row.cp,
      decks: list,
    });
  }

  // 총딜 내림차순 — enikk 순위와 같은 줄 세우기다.
  players.sort((a, b) => b.damage - a.damage);
  return { players, decks, unknownNames: [...unknown], unsupported };
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

  onProgress?.('덱을 정리하는 중…');
  return { season, ...toPlayers(rankings, nameMap, supported) };
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
