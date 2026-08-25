export type ElementCode = '' | '풍압' | '수냉' | '작열' | '전격' | '철갑';
// 큐브 종류의 정본은 `data/base_stat_tables/cube.json`이며 게임 업데이트로 계속
// 늘어난다. 목록을 여기 박아두면 데이터가 앞서갈 때 조용히 어긋나므로, 이름은
// 문자열로 두고 실제 선택지는 `SettingsCatalog.cubes`의 키에서 얻는다.
export type CubeName = string;

export interface CubeSelection {
  name: CubeName;
  level: number;
}

export interface SkillLevels {
  '1': number;
  '2': number;
  '3': number;
}

export interface CharacterControl {
  tap_fire?: { rate: number; release?: number; full_charge_interval?: number };
  reload?: {
    policy: 'before_fb_end' | 'into_fb';
    lead?: number;
    margin?: number;
    if_dry?: boolean;
    duration?: number;
  };
  cover?: { policy: 'own_full_burst'; extend?: number };
  hold?: {
    policy: 'own_full_burst' | 'charge_hold_after_fb';
    lead?: number;
  };
}

// 버스트 운용 배정. auto는 이 필드 자체를 두지 않는다(엔진 기본 순서).
// priority = n의 배수 사이클마다 우선 사용(every=n), skip = 가급적 안 씀.
export type BurstAssignment =
  | { mode: 'priority'; every: number }
  | { mode: 'skip' };
export type EquipPart = '머리' | '몸통' | '팔' | '다리';
export type EquipTier = '없음' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9';
export type EquipSetting = number | EquipTier;

// 소장품과 애장품은 같은 슬롯이다. favorite이 1~3이면 애장품을 낀 것이고
// 그때 stage는 SR15로 고정된다(스탯이 SR15와 같다).
export interface CollectionSelection {
  stage: string;
  favorite: number;
}

export interface CharacterOverrides {
  growthStage?: number;
  skillLevels?: SkillLevels;
  overload?: Record<string, number>;
  cube?: CubeSelection;
  collection?: CollectionSelection;
  control?: CharacterControl;
  manualStats?: Record<string, number>;
  burst?: BurstAssignment;
  /** 부위별 장비. 숫자 0~5 = 기업·오버로드 강화 단계, 문자열 = 등급('없음' · 'T1'~'T9'). */
  equipLevels?: Partial<Record<EquipPart, EquipSetting>>;
  /** 전투 시작 후 이 시각부터 수동 재장전 기반 무기 모드 전환을 시도한다. */
  weaponModeSwapAt?: number;
}

export interface GrowthOption {
  value: number;
  label: string;
  affinity: number;
}

export interface CustomCharacter {
  name: string;
  nikke: Record<string, unknown>;
  skills: unknown[];
}

// 계정 콘솔(전초기지 재활용 연구실). 캐릭터가 아니라 계정 속성이라 요청 최상위에
// 두고 스쿼드 전원에게 같이 적용된다.
// `공통`은 전체 하나, `클래스`·`기업`은 소속별로 따로 큰다 — 인게임 재활용
// 연구실이 그렇게 생겼고, 엔진도 빠진 소속을 에러로 끊는다.
export interface ConsoleLevels {
  common_level: number;
  class_level: Record<string, number>;
  company_level: Record<string, number>;
}

export interface SimulationRequest {
  squad: string[];
  characters?: Record<string, CharacterOverrides>;
  customCharacters?: Record<string, { nikke: Record<string, unknown>; skills: unknown[] }>;
  duration: number;
  enemyDef: number;
  enemyCode: ElementCode;
  corePx: number;
  hasParts: boolean;
  seed: number;
  // 적정거리로 둘 무기군. 그 무기군의 **일반 공격**에만 ③ 보너스 +30%.
  optimalRangeWeapons?: string[];
  // 무기군별 평타 계수. 실전에서 탄퍼짐으로 빗나가는 탄을 보정한다 — 평타에만 붙고
  // 스킬·버스트와 변신 모드 사격에는 붙지 않는다. 안 주면 데이터 기본값을 쓴다.
  normalHitCoeff?: Record<string, number>;
  console?: ConsoleLevels;
  // 버스트 게이지 충전 시간(초). 게이지 누적 대신 쓰는 고정 시간이다.
  burstRegenTime?: number;
}

export interface BattleSettings {
  duration: number;
  enemyDef: number;
  enemyCode: ElementCode;
  coreEnabled: boolean;
  corePx: number;
  hasParts: boolean;
  seed: number;
  optimalRangeWeapons: string[];
  normalHitCoeff: Record<string, number>;
  console: ConsoleLevels;
  burstRegenTime: number;
}

export interface DeckState {
  id: number;
  squad: string[];
  characters: Record<string, CharacterOverrides>;
}

export interface CharacterMeta {
  name: string;
  burstStage: string;
  elementCode: string;
  weaponType: string;
  className: string;
  manufacturer: string;
  preview: boolean;
  image: string | null;
  // 블라블라링크 API가 이 캐릭터를 부르는 번호. 사전에 없으면 null이고, 그러면
  // 프로필 동기화가 이 캐릭터를 알아보지 못한다(`data/name_codes.json`).
  nameCode: number | null;
  // enikk이 캐릭터를 부르는 번호(`resource_id`). 우리 스크랩 데이터의 `id`와 같다.
  resourceId: number | null;
}

export interface BurstCast {
  t: number;
  stage: string;
}

export interface BattleTimeline {
  bucket: number;
  buckets: number;
  damage: Record<string, number[]>;
  bursts: Record<string, BurstCast[]>;
  fullBurst: [number, number][];
}

// 캐릭터 한 명의 딜을 일반공격(평타)과 스킬로 나눈 내역.
export interface CharacterDamageBreakdown {
  normal: number;
  normalHits: number;
  skill: number;
  skillHits: number;
  skills: Array<{ name: string; damage: number; hits: number }>;
}

export interface SimulationResult {
  squadTotal: number;
  duration: number;
  hitCount: number;
  charTotals: Record<string, number>;
  // 구버전 캐시에 저장된 결과에는 없을 수 있다.
  charBreakdown?: Record<string, CharacterDamageBreakdown>;
  previewNote: string;
  deviations: string;
  timeline?: BattleTimeline;
  /** 감시 대상 버프의 실제 수령자 — `{시전자: [...]}`. 구버전 캐시에는 없다. */
  buffTargets?: Record<string, BuffTargetRow[]>;
}

/** 「누가 이 버프를 받았나」 한 줄. 대상이 공격력 순위로 갈려 편성만으로는 알 수 없다. */
export interface BuffTargetRow {
  label: string;
  buff: string;
  targets: string[];
  count: number;
}

export interface RuntimeManifest {
  version: string;
  files: string[];
}

export interface NumericFieldMeta {
  label: string;
  unit: string;
  min: number;
  max: number;
}

export interface CubeLevelMeta {
  atk: number;
  def: number;
  hp: number;
  effect: number;
  commonElement: number;
}

export interface CubeMeta {
  label: string;
  // 게임 내부 id — 블라블라링크 응답의 `harmony_cube_tid`와 맞춘다.
  id: number;
  stat: string;
  template: string;
  levels: Record<string, CubeLevelMeta>;
  // 계산기가 이 큐브의 고유 스킬을 아직 처리하지 못할 때의 사유. 공격력·방어력·
  // 체력과 공통 우월 코드 효과는 그대로 붙고 고유 스킬만 빠진다.
  unsupported?: string;
}

export interface CharacterSettingsDefaults {
  weaponType: string;
  recommendedControl: CharacterControl;
  hasConditionalControl: boolean;
  favoriteItem?: { name: string; stage: 3 };
  collection: CollectionSelection;
  growthStage: number;
  rarity: string;
  maxGrowthStage: number;
  growthOptions: GrowthOption[];
  skillLevels: SkillLevels;
  skillLevelsLocked: boolean;
  overload: Record<string, number>;
  cube: CubeSelection;
}

export interface SettingsCatalog {
  characters: Record<string, CharacterSettingsDefaults>;
  cubes: Record<CubeName, CubeMeta>;
  collectionStages: string[];
  weaponTypes: string[];
  /** 「누가 이 버프를 받았나」를 카드에 띄울 버프 — 정본은 `calculator.customization`. */
  buffTargetWatch: Record<string, Array<{ buff: string; label: string }>>;
  // 무기군별 평타 계수 기본값 (`data/weapon_mechanics.json`).
  normalHitCoeff: Record<string, number>;
  consoleClasses: string[];
  consoleCompanies: string[];
  overloadFields: Record<string, NumericFieldMeta>;
  manualStats: Record<string, NumericFieldMeta>;
  // 소장품 id → 등급('R'|'SR'|'SSR'). SSR이면 애장품이라 레벨을 단계로 읽는다.
  favoriteItems: Record<string, string>;
}

export interface DeckResultEntry {
  deckId: number;
  request: SimulationRequest;
  result: SimulationResult;
}

export interface BatchResult {
  total: number;
  decks: DeckResultEntry[];
}

export interface WorkerRequest {
  id: number;
  type: 'prepare' | 'simulate';
  payload?: SimulationRequest;
}

export interface WorkerResponse {
  id: number;
  type: 'ready' | 'progress' | 'result' | 'error';
  payload?: SimulationResult | string;
}
