export type ElementCode = '' | '풍압' | '수냉' | '작열' | '전격' | '철갑';
export type CubeName = '재장' | '탄충' | '체력' | '차속' | '파츠';

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

export interface CharacterOverrides {
  growthStage?: number;
  skillLevels?: SkillLevels;
  overload?: Record<string, number>;
  cube?: CubeSelection;
  control?: CharacterControl;
  manualStats?: Record<string, number>;
  burst?: BurstAssignment;
  equipLevels?: Partial<Record<EquipPart, number>>;
}

export interface GrowthOption {
  value: number;
  label: string;
  affinity: number;
}

export interface SimulationRequest {
  squad: string[];
  characters?: Record<string, CharacterOverrides>;
  duration: number;
  enemyDef: number;
  enemyCode: ElementCode;
  corePx: number;
  hasParts: boolean;
  seed: number;
}

export interface BattleSettings {
  duration: number;
  enemyDef: number;
  enemyCode: ElementCode;
  coreEnabled: boolean;
  corePx: number;
  hasParts: boolean;
  seed: number;
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

export interface SimulationResult {
  squadTotal: number;
  duration: number;
  hitCount: number;
  charTotals: Record<string, number>;
  previewNote: string;
  deviations: string;
  timeline?: BattleTimeline;
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
  stat: string;
  template: string;
  levels: Record<string, CubeLevelMeta>;
}

export interface CharacterSettingsDefaults {
  weaponType: string;
  recommendedControl: CharacterControl;
  hasConditionalControl: boolean;
  favoriteItem?: { name: string; stage: 3 };
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
  overloadFields: Record<string, NumericFieldMeta>;
  manualStats: Record<string, NumericFieldMeta>;
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
