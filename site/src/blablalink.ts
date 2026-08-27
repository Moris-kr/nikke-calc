import type {
  CharacterMeta,
  CharacterOverrides,
  EquipPart,
  EquipSetting,
  SettingsCatalog,
} from './types';

export const BLABLA_SERVERS = [
  { area: 83, label: '한국' },
  { area: 81, label: '일본' },
  { area: 84, label: '글로벌' },
  { area: 82, label: '북미' },
  { area: 85, label: '동남아' },
] as const;

export function blablaServerLabel(area: number): string {
  return BLABLA_SERVERS.find((server) => server.area === area)?.label ?? `서버 ${area}`;
}

// 블라블라링크 프로필 응답 → 캐릭터별 override.
//
// 응답은 프록시(`worker/`)가 그대로 넘겨준 원시 JSON이다. 여기서 우리 용어로 옮기며,
// 규칙은 렛츠도로 CSV 임포트(`csv-import.ts`)와 같은 자리에 떨어지도록 맞춘다 — 두
// 경로가 같은 계정에 대해 다른 스펙을 만들면 어느 쪽이 맞는지 알 수 없게 된다.
//
// CSV와 다른 점은 이쪽이 **큐브와 소장품 실물**까지 준다는 것이다. 대신 호감도는
// 계산기가 돌파 단계에서 끌어내므로(`context/growth.growth_options`) 응답의
// `attractive_lv`는 쓰지 않는다 — 그 축을 새로 만들면 CSV 쪽과 어긋난다.

/** 프록시가 돌려주는 지역 하나치 원시 응답. 필요한 필드만 좁게 적는다. */
export interface RawArea {
  area: number;
  characters: Array<{ name_code: number; grade?: number; core?: number; lv?: number }>;
  details: Array<Record<string, number>>;
  stateEffects: Array<{
    // 옵션 id는 여기서 **문자열**로 오고 장비 슬롯에서는 숫자로 온다(실측 2026-08-23).
    // 그대로 맞대면 하나도 안 맞아 오버로드가 통째로 0이 된다.
    id: number | string;
    function_details?: Array<{ function_type?: string; function_value?: number }>;
  }>;
  // 재활용 연구실 레벨 필드는 `lv`다(`level`이 아니다 — 실측 2026-08-23).
  outpost: { recycle_room_researches?: Array<{ tid: number; lv: number }> } | null;
}

export interface RawProfile {
  openid: string;
  areas: RawArea[];
}

export interface ProfileImport {
  overrides: Record<string, CharacterOverrides>;
  matched: string[];
  /** 사전에 없는 name_code — 계산기가 아직 안 다루는 캐릭터다. */
  unmatched: number[];
  /** 사람에게 보여 줄 주의사항. */
  notes: string[];
}

// 게임 내부 옵션 이름 → 우리 오버로드 키. `scraper/profile_fetch.py` FUNC_TO_EQUIP와
// 같은 표다. 저쪽이 정본이니 바뀌면 함께 고친다.
const FUNCTION_TO_OVERLOAD: Record<string, string> = {
  StatAtk: 'atk_pct',
  IncElementDmg: 'element_bonus',
  StatAmmoLoad: 'max_ammo_pct',
  StatCritical: 'crit_rate',
  StatCriticalDamage: 'crit_dmg',
  StatChargeTime: 'charge_speed_pct',
  StatChargeDamage: 'charge_dmg_pct',
  StatAccuracyCircle: 'accuracy_pct',
  IncHurtDef: 'def_pct',
  StatDef: 'def_pct',
};

// 응답의 부위 접두사 → 우리 부위명. 몸통이 `torso`, 장갑이 `arm`이다.
const PARTS: Array<[string, EquipPart]> = [
  ['head', '머리'],
  ['torso', '몸통'],
  ['arm', '팔'],
  ['leg', '다리'],
];

// equip_tier 10 = 기업 장비(강화 0~5). 1~9는 일반 T1~T9라 강화 자체가 없고, 0은 미장착이다.
// 우리 설정은 부위당 강화 레벨 하나만 받으므로 그 둘은 0으로 접힌다.
const CORP_TIER = 10;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** 붙여넣은 값이 블라블라링크 프로필 URL로 보이는가. 프록시가 최종 판단을 한다. */
export function looksLikeProfileUrl(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  if (/^\d{6,}$/.test(trimmed)) return true;
  if (/^\d+-\d{6,}$/.test(trimmed)) return true;
  try {
    return /(^|\.)blablalink\.com$/i.test(new URL(trimmed).hostname);
  } catch {
    return false;
  }
}

/** state_effects → {옵션 id: [오버로드 키, 퍼센트]}. */
function buildOptionMap(effects: RawArea['stateEffects']): Map<number, [string, number]> {
  const map = new Map<number, [string, number]>();
  for (const effect of effects) {
    const id = Number(effect.id);
    if (!Number.isFinite(id)) continue;
    // 상세를 배치로 나눠 받으므로 같은 옵션이 여러 번 온다. 먼저 온 것만 쓰면 된다.
    if (map.has(id)) continue;
    const detail = effect.function_details?.[0];
    const key = detail?.function_type ? FUNCTION_TO_OVERLOAD[detail.function_type] : undefined;
    if (!key) continue;
    // 차지 시간 감소만 음수로 오고 나머지는 양수다. 우리 표는 전부 양수 퍼센트다.
    map.set(id, [key, Math.abs(Number(detail?.function_value ?? 0)) / 100]);
  }
  return map;
}

/** 오버로드 12슬롯 합산. state_effects는 중복 제거돼 오므로 슬롯을 직접 순회한다. */
function overloadOf(
  detail: Record<string, number>,
  options: Map<number, [string, number]>,
  fields: string[],
): Record<string, number> {
  const total: Record<string, number> = {};
  for (const field of fields) total[field] = 0;
  for (const [prefix] of PARTS) {
    for (const slot of [1, 2, 3]) {
      const id = Number(detail[`${prefix}_equip_option${slot}_id`] ?? 0);
      const hit = id ? options.get(id) : undefined;
      if (!hit) continue;
      const [key, value] = hit;
      if (key in total) total[key] = Number((total[key]! + value).toFixed(4));
    }
  }
  return total;
}

function equipLevelsOf(detail: Record<string, number>): Partial<Record<EquipPart, EquipSetting>> {
  const levels: Partial<Record<EquipPart, EquipSetting>> = {};
  for (const [prefix, part] of PARTS) {
    const tier = detail[`${prefix}_equip_tier`] ?? 0;
    // 셋을 구분해 넘긴다. 예전에는 기업이 아니면 전부 «강화 0»으로 적었는데,
    // 강화 0에도 플랫 스탯이 붙어 미장착·일반 장비가 공격력을 그냥 얻었다
    // (4부위 미장착 기준 약 1만). `scraper/profile_fetch.py`가 하는 구분과 같다.
    levels[part] = tier >= CORP_TIER
      ? clamp(detail[`${prefix}_equip_lv`] ?? 0, 0, 5)
      : tier >= 1 ? (`T${tier}` as EquipSetting) : '없음';
  }
  return levels;
}

/**
 * 소장품 슬롯 → 우리 설정. 슬롯 하나를 소장품(R·SR)과 애장품(SSR)이 나눠 쓴다.
 *
 * 애장품은 스탯이 SR15와 같으므로 등급은 SR15로 적고, 단계만 따로 넘긴다 — 단계가
 * 바꾸는 것은 스탯이 아니라 스킬 판본이다.
 */
function collectionOf(
  detail: Record<string, number>,
  grades: Record<string, string>,
): { stage: string; favorite: number } | null {
  const tid = detail.favorite_item_tid ?? 0;
  if (!tid) return { stage: '없음', favorite: 0 };
  const grade = grades[String(tid)];
  if (!grade) return null;            // 모르는 소장품은 기본값을 남기는 편이 낫다
  const level = detail.favorite_item_lv ?? 0;
  if (grade === 'SSR') return { stage: 'SR15', favorite: clamp(level + 1, 1, 3) };
  return { stage: `${grade}${clamp(level, 0, 15)}`, favorite: 0 };
}

function cubeOf(
  detail: Record<string, number>,
  cubes: SettingsCatalog['cubes'],
): { name: string; level: number } | null {
  const tid = detail.harmony_cube_tid ?? 0;
  if (!tid) return null;              // 큐브를 안 낀 상태 — 기본값을 그대로 둔다
  for (const [name, meta] of Object.entries(cubes)) {
    if (meta.id === tid) return { name, level: clamp(detail.harmony_cube_lv ?? 0, 1, 15) };
  }
  return null;
}

/**
 * 지역 하나치 원시 응답을 캐릭터별 override로 옮긴다.
 *
 * `characters`(보유 목록)와 `details`(육성 상세)는 서로 다른 것을 준다. 돌파·코강은
 * 동기화가 반영된 보유 목록 쪽이 맞고, 스킬·장비·소장품은 상세 쪽에만 있다.
 */
export function areaToOverrides(
  area: RawArea,
  settings: SettingsCatalog,
  catalog: CharacterMeta[],
): ProfileImport {
  const nameByCode = new Map<number, string>();
  for (const entry of catalog) {
    if (entry.nameCode !== null) nameByCode.set(entry.nameCode, entry.name);
  }

  const options = buildOptionMap(area.stateEffects ?? []);
  const overloadFields = Object.keys(settings.overloadFields);
  const rosterByCode = new Map(area.characters.map((entry) => [entry.name_code, entry]));

  const overrides: Record<string, CharacterOverrides> = {};
  const matched: string[] = [];
  const unmatched: number[] = [];
  const notes: string[] = [];
  let unknownCollection = 0;
  let noCube = 0;

  for (const detail of area.details ?? []) {
    const code = Number(detail.name_code);
    const name = nameByCode.get(code);
    if (!name) { unmatched.push(code); continue; }
    const defaults = settings.characters[name];
    if (!defaults) { unmatched.push(code); continue; }

    const override: CharacterOverrides = {};
    override.overload = overloadOf(detail, options, overloadFields);

    const roster = rosterByCode.get(code);
    const breakthrough = Number(roster?.grade ?? 0);
    const core = Number(roster?.core ?? 0);
    override.growthStage = clamp(breakthrough + core, 0, defaults.maxGrowthStage);

    if (!defaults.skillLevelsLocked) {
      const s1 = Number(detail.skill1_lv ?? 0);
      const s2 = Number(detail.skill2_lv ?? 0);
      const s3 = Number(detail.ulti_skill_lv ?? 0);
      if (s1 && s2 && s3) {
        override.skillLevels = {
          '1': clamp(s1, 1, 10), '2': clamp(s2, 1, 10), '3': clamp(s3, 1, 10),
        };
      }
    }

    const collection = collectionOf(detail, settings.favoriteItems);
    if (collection) override.collection = collection;
    else unknownCollection += 1;

    const cube = cubeOf(detail, settings.cubes);
    if (cube) override.cube = cube;
    else if (!detail.harmony_cube_tid) noCube += 1;

    override.equipLevels = equipLevelsOf(detail);

    overrides[name] = override;
    matched.push(name);
  }

  if (unknownCollection > 0) {
    notes.push(`소장품을 알아보지 못한 니케 ${unknownCollection}종 — 그 니케만 기본 소장품으로 계산합니다.`);
  }
  if (noCube > 0) {
    notes.push(`큐브를 끼지 않은 니케 ${noCube}종 — 그 니케만 기본 큐브로 계산합니다.`);
  }
  if (unmatched.length > 0) {
    notes.push(`계산기가 아직 다루지 않는 니케 ${unmatched.length}종은 건너뛰었습니다.`);
  }

  return { overrides, matched, unmatched, notes };
}

/**
 * 지역이 여럿이면 니케를 가장 많이 가진 지역을 쓴다.
 *
 * 한 계정에 한섭·일섭이 같이 걸리기도 하는데, 둘을 합치면 같은 니케의 육성 상태가
 * 뒤섞인다. 주로 쓰는 계정이 니케가 더 많다는 게 가장 덜 틀리는 추정이다.
 */
export function pickArea(profile: RawProfile, preferredArea?: number): RawArea | null {
  if (preferredArea !== undefined) {
    return profile.areas?.find((area) => area.area === preferredArea) ?? null;
  }
  let best: RawArea | null = null;
  for (const area of profile.areas ?? []) {
    if (!best || (area.characters?.length ?? 0) > (best.characters?.length ?? 0)) best = area;
  }
  return best;
}

/** 콘솔(재활용 연구실) tid → 계산기 콘솔 설정 자리. `profile_fetch.py` CONSOLE_TIDS와 같다. */
const CONSOLE_TIDS: Record<number, ['common' | 'class' | 'company', string]> = {
  1001: ['common', ''],
  1101: ['class', '화력형'], 1102: ['class', '방어형'], 1103: ['class', '지원형'],
  1201: ['company', '엘리시온'], 1202: ['company', '미실리스'], 1203: ['company', '테트라'],
  1204: ['company', '필그림'], 1205: ['company', '어브노말'],
};

export interface ConsoleImport {
  common_level: number;
  class_level: Record<string, number>;
  company_level: Record<string, number>;
}

/**
 * 아무것도 안 올린 콘솔. **자리는 다 있고 값만 0**이다 — 엔진은 빠진 소속을 거절하므로
 * «모른다»를 «0으로 친다»로 바꿔 적어야 계산이 돈다(전초기지가 비공개일 때 쓴다).
 */
export function emptyConsole(): ConsoleImport {
  const out: ConsoleImport = { common_level: 0, class_level: {}, company_level: {} };
  for (const [kind, bucket] of Object.values(CONSOLE_TIDS)) {
    if (kind === 'class') out.class_level[bucket] = 0;
    else if (kind === 'company') out.company_level[bucket] = 0;
  }
  return out;
}

/**
 * 전초기지 응답 → 콘솔 레벨. 전초기지가 비공개면 안 오므로 null이 정상이다.
 *
 * 안 올린 연구실은 응답에 아예 **없다**. 그 자리를 비운 채 넘기면 엔진이
 * «클래스 콘솔에 빠진 소속이 있다»로 거절한다(빠진 소속이 조용히 0이 되는 걸
 * 막는 장치다). 여기서 0으로 채워 «안 올렸다»는 뜻을 분명히 적어 보낸다.
 */
export function consoleFrom(area: RawArea): ConsoleImport | null {
  const researches = area.outpost?.recycle_room_researches;
  if (!researches || researches.length === 0) return null;
  const result = emptyConsole();
  let seen = false;
  for (const entry of researches) {
    const slot = CONSOLE_TIDS[Number(entry.tid)];
    if (!slot) continue;
    seen = true;
    const level = Math.max(0, Math.trunc(Number(entry.lv) || 0));
    if (slot[0] === 'common') result.common_level = level;
    else if (slot[0] === 'class') result.class_level[slot[1]] = level;
    else result.company_level[slot[1]] = level;
  }
  return seen ? result : null;
}
