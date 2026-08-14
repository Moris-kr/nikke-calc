export type ElementCode = '' | '풍압' | '수냉' | '작열' | '전격' | '철갑';
export type CubeName = '재장' | '탄충' | '체력' | '차속' | '파츠';

export interface CubeSelection {
  name: CubeName;
  level: number;
}

export interface CharacterOverrides {
  overload?: Record<string, number>;
  cube?: CubeSelection;
  manualStats?: Record<string, number>;
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

export interface SimulationResult {
  squadTotal: number;
  duration: number;
  hitCount: number;
  charTotals: Record<string, number>;
  previewNote: string;
  deviations: string;
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
