export type ElementCode = '' | '풍압' | '수냉' | '작열' | '전격' | '철갑';

export interface SimulationRequest {
  squad: string[];
  duration: number;
  enemyDef: number;
  enemyCode: ElementCode;
  corePx: number;
  hasParts: boolean;
  seed: number;
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
