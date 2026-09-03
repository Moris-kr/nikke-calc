import type { BurstSequence } from './burst-order';
import type { HackSettings } from './hacks';

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
  /** 남은 시간이 `seconds`초 미만이면 누구보다 먼저 쓴다. 그 전에는 평소 순서. */
  | { mode: 'endgame'; seconds: number }
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

/**
 * 오버로드 옵션 한 줄 — 인게임과 같은 단위다. 옵션 키와 레벨(1~15) 둘로 끝난다.
 * 빈 줄은 `option: ''`로 둔다(줄 자리는 남기고 값만 비운 상태).
 */
export interface OverloadLine {
  option: string;
  level: number;
}

/**
 * 부위별 오버로드 옵션. **이 값이 있으면 `overload` 합계는 여기서 나온다** —
 * 사람이 고르는 것은 줄이고, 엔진이 받는 것은 옛날처럼 옵션별 합계다.
 */
export type OverloadLines = Partial<Record<EquipPart, OverloadLine[]>>;

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
  /**
   * 부위별 오버로드 옵션 줄. 있으면 `overload` 합계를 이 줄들에서 다시 세운다 —
   * 엔진이 받는 값은 그대로 합계라, 계산·저장·공유 코드는 하나도 바뀌지 않는다.
   */
  overloadLines?: OverloadLines;
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
  // 보스 페이즈 — 족자(평타 빗나감)와 속저(우월 코드만 통과).
  immuneWindows?: PhaseWindow[];
  elementWindows?: ElementWindow[];
  rngMode?: RngMode;
  /** 손으로 정한 버스트 순서. 안 주면 계산기가 평소 순서로 고른다. */
  burstSequence?: BurstSequence;
  /**
   * 「정밀 분석」 표(0.1초 칸)를 함께 받을지. 대미지는 원래부터 히트마다 정수로
   * 정확히 세므로 **수치가 정밀해지는 게 아니라** 보이는 칸이 잘아진다.
   * 늘 받으면 저장되는 결과가 열 배로 무거워져, 내보낼 때만 켠다.
   */
  fineTimeline?: boolean;
  /** 족자 중에는 버스트 게이지도 안 찬다고 볼지. */
  immuneBlocksBurst?: boolean;
  /**
   * 핵(`site/src/hacks.ts`). 하나라도 켰을 때만 실린다 — 안 켠 요청에는 이 키가
   * 아예 없어야 캐시 키가 옛 결과와 갈리지 않는다.
   */
  hacks?: HackSettings;
  // 무기군별 평타 계수. 실전에서 탄퍼짐으로 빗나가는 탄을 보정한다 — 평타에만 붙고
  // 스킬·버스트와 변신 모드 사격에는 붙지 않는다. 안 주면 데이터 기본값을 쓴다.
  normalHitCoeff?: Record<string, number>;
  console?: ConsoleLevels;
  /** 싱크로 레벨. 안 주면 엔진 기본 스펙 레벨(400)을 쓴다. */
  synchroLevel?: number;
  // 버스트 게이지 충전 시간(초). 게이지 누적 대신 쓰는 고정 시간이다.
  burstRegenTime?: number;
  /** 버스트 반응속도(초). 안 주면 엔진 기본값(0.05)을 쓴다. */
  burstReaction?: number;
  /**
   * 파츠 파괴 주기(초). 보스 메이커가 «파츠 체력 ÷ 예상 DPS»로 낸 값을 넘긴다 —
   * 엔진에는 적 체력이 없어 파괴는 **시각**으로만 들어간다. 0이나 미지정이면 무발동.
   */
  partBreakInterval?: number;
  /** 사격 밀도 트랙을 함께 받을지. 보스 메이커의 타임라인이 쓴다. */
  shotTrack?: boolean;
  /**
   * 관통 사격이 꿰뚫는 몸통·파츠 수. 보스 메이커가 겨냥한 자리에서 세어 보낸다 —
   * 안 주면 몸통 하나(한 발 = 한 히트)라 지금까지의 계산과 같다.
   */
  piercePass?: { shapes: number; parts: number };
}

/**
 * 캐릭터별 사격 밀도. 히트를 낱개로 옮기면 180초 한 판이 수만 건이라(MG 하나가
 * 1만 발을 넘긴다) 칸마다 «몇 발»로 접어 보낸다. 그림에 필요한 것은 그 밀도뿐이다.
 *
 * `core`·`explode`는 그 칸의 평타·스킬 안에서 세는 **부분집합**이다. 기대값 모드에서
 * 코어는 확률로 태우므로, 여기 세는 것은 «확정 코어»뿐이다 — 조준 적중률은 화면이
 * 탄착군 공식으로 따로 낸다.
 */
/**
 * 캐릭터별 상태 — 그때 탄이 몇 발이었고 언제 재장전했나.
 *
 * 최대 장탄은 «본 값 중 가장 큰 것»이다. 재장전이 끝나면 가득 차므로 실전에서는 그
 * 값이 곧 탄창 크기다. 무한 장탄은 엔진이 센티널(999999)로 두므로 그대로 온다.
 */
export interface StateTrack {
  bucket: number;
  buckets: number;
  chars: Record<string, {
    ammo: number[];
    /** `[시작, 끝]` 재장전 구간(초) */
    reload: Array<[number, number]>;
    maxAmmo: number;
  }>;
}

export interface ShotTrack {
  bucket: number;
  buckets: number;
  chars: Record<string, {
    normal: number[];
    skill: number[];
    core: number[];
    explode: number[];
  }>;
}

/** 보스 페이즈 구간. `[from, to)` 반개구간이다. */
export interface PhaseWindow { from: number; to: number }
/** 속저 — 그 구간 동안 이 코드에 **우월한** 캐릭터의 딜만 들어간다. */
export interface ElementWindow extends PhaseWindow { code: ElementCode }
/** 난수 처리. random = 인게임과 같은 분산, expected = 기대값(결정론적). */
export type RngMode = 'random' | 'expected';

export interface BattleSettings {
  duration: number;
  /**
   * 싱크로 디바이스 레벨. 소대에 넣은 니케는 전원이 이 레벨이 되므로 캐릭터 설정이
   * 아니라 전투 조건에 둔다. 계정 육성 상태라 **공유 코드에는 담기지 않는다**(콘솔과 같다).
   */
  synchroLevel: number;
  enemyDef: number;
  enemyCode: ElementCode;
  coreEnabled: boolean;
  corePx: number;
  hasParts: boolean;
  seed: number;
  optimalRangeWeapons: string[];
  normalHitCoeff: Record<string, number>;
  /** 족자 — 그 구간 동안 평타가 적중하지 않는다. */
  immuneWindows: PhaseWindow[];
  /** 속저 — 그 구간 동안 우월 코드만 통과한다. */
  elementWindows: ElementWindow[];
  rngMode: RngMode;
  immuneBlocksBurst: boolean;
  console: ConsoleLevels;
  burstRegenTime: number;
  /**
   * 덱마다 다른 버스트 게이지 충전 시간(초). 덱 번호 → 초.
   * 비어 있으면 모든 덱이 `burstRegenTime` 하나를 함께 쓴다 — 버스트 쿨이 밀리는 덱만
   * 따로 잡으려고 두는 값이다.
   */
  burstRegenPerDeck?: Record<number, number>;
  /**
   * 버스트 반응속도(초). 조건이 갖춰진 뒤 실제로 누르기까지 걸리는 시간이며,
   * **버스트 하나하나마다** 더해진다 — 3단계까지 쓰면 그 세 배만큼 늦어진다.
   */
  burstReaction: number;
  /**
   * 켜 둔 핵. 인게임에 없는 값을 억지로 켜는 스위치라 **공유 코드에는 담기지 않는다** —
   * 남이 준 전투 조건을 적용했더니 몰래 핵이 켜져 있는 일은 없어야 한다.
   */
  hacks?: HackSettings;
}

export interface DeckState {
  id: number;
  /**
   * 덱에 붙인 이름. 「0장 · 1장 · 2장」처럼 무엇을 바꿔 본 판인지 적어 두는 자리다 —
   * 비어 있으면 화면은 「덱 N」으로 부른다. 보고서 이미지에도 그대로 실린다.
   */
  name?: string;
  squad: string[];
  characters: Record<string, CharacterOverrides>;
  /**
   * 손으로 정한 버스트 순서. 사이클마다 단계별로 누구를 쓸지 적는다.
   * **덱마다 따로다** — 편성이 다르면 쓸 수 있는 사람도 다르다.
   */
  burstSequence?: BurstSequence;
}

export interface CharacterMeta {
  name: string;
  burstStage: string;
  /**
   * 그 단계의 **다른 아군이 없을 때만** 설 수 있는 자리(라피 : 레드 후드의 1버).
   * 엔진은 `burst_stage_override:N`으로 이미 그렇게 굴린다 — 화면의 버스트 순서 표가
   * 같은 사실을 알아야 그 칸에 세울 수 있다. 없으면 null이다.
   */
  altBurstStage?: string | null;
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
  // 유저가 부르는 별칭(`수니스`·`세이렌`). 정본은 `context/ALIASES.md`의 별칭 표다.
  // **찾을 때만 쓴다** — 화면에 나오는 이름은 언제나 정식 명칭이다.
  aliases: string[];
}

export interface BurstCast {
  t: number;
  stage: string;
  /** 버스트 스킬 이름(스킬3). 옛 결과에는 없다 — 없으면 단계 숫자만 보여 준다. */
  skill?: string;
}

export interface BattleTimeline {
  bucket: number;
  buckets: number;
  damage: Record<string, number[]>;
  bursts: Record<string, BurstCast[]>;
  fullBurst: [number, number][];
  /** 버프가 걸려 있던 구간. 구버전 캐시에는 없다. */
  buffs?: BuffTrack[];
}

/**
 * 버프 한 줄 — «누가 건 무슨 버프»가 하나. 받는 사람이 여럿이면 한 줄에 모은다.
 * 같은 버프가 여러 번 걸리면 `spans`에 그만큼 쌓이고, **중첩이 바뀔 때마다 끊긴다**
 * (언제부터 몇 겹이었는지가 타임라인의 핵심이다).
 */
/**
 * 한 구간 — `[시작(초), 끝(초), 중첩]`, 그리고 **대상이 구간마다 갈릴 때만** 네 번째로
 * 그 구간을 받은 사람들(`targets` 안의 자리 번호).
 *
 * 리버렐리오 「차분한 수심 4」처럼 발동마다 공격력 순위로 대상이 갈리는 버프가 있다.
 * 줄 하나에 뭉쳐 두면 «둘 다 받는다»로 읽히므로 그런 줄만 구간에 대상을 붙인다 —
 * 늘 붙이면 다섯 명짜리 버프에서 결과가 몇 배로 무거워진다.
 */
export type BuffSpan = [number, number, number] | [number, number, number, number[]];

/** 이 구간을 실제로 받은 사람들. 구간에 적혀 있지 않으면 줄 전체의 대상이 곧 답이다. */
export const spanTargets = (track: BuffTrack, span: BuffSpan): string[] => {
  const picked = span[3];
  return picked ? picked.map((index) => track.targets[index] ?? '').filter(Boolean) : track.targets;
};

export interface BuffTrack {
  name: string;
  /** 건 사람 — 막대 색이 이 사람의 색이다. */
  caster: string;
  /** 받는 사람들. */
  targets: string[];
  stat?: string | null;
  value?: number | null;
  /** 그 버프가 쌓을 수 있는 최대 중첩. 1이면 스택형이 아니다. */
  maxStack: number;
  /** `[시작, 끝, 그 구간의 중첩]`. */
  spans: BuffSpan[];
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
  /** 보스 메이커의 사격 트랙. `shotTrack`을 켠 요청에만 실린다. */
  shots?: ShotTrack;
  /** 캐릭터별 탄환·재장전. 사격 트랙과 함께 온다. */
  states?: StateTrack;
  /** 감시 대상 버프의 실제 수령자 — `{시전자: [...]}`. 구버전 캐시에는 없다. */
  buffTargets?: Record<string, BuffTargetRow[]>;
  /** 0.1초 칸으로 나눈 같은 결과. `fineTimeline`을 켠 요청에만 실려 온다. */
  fineTimeline?: BattleTimeline;
}

/** 「누가 이 버프를 받았나」 한 줄. 대상이 공격력 순위로 갈려 편성만으로는 알 수 없다. */
export interface BuffTargetRow {
  label: string;
  buff: string;
  /** 처음 받은 순서대로 중복 없이. 둘 이상이면 전투 중 대상이 갈린 특이케이스다. */
  targets: string[];
  /** 발동마다 누가 받았는지 시간순. 「순서보기」가 이걸 그린다. */
  sequence?: Array<{ t: number; target: string }>;
  count: number;
  /** 배경에서 대상을 계산하는 중 — 화면에는 `[계산중]`으로 나온다. */
  pending?: boolean;
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
  /**
   * 조합 조건부 컨트롤 중 «누가 함께 있는가»만 보는 규칙. 스쿼드만 있으면 화면이
   * 스스로 판정할 수 있어, 계산 전에도 지금 걸리는 컨트롤을 적을 수 있다.
   * 다른 조건을 쓰는 규칙은 내려오지 않는다 — `hasConditionalControl`로만 알린다.
   */
  conditionalControl?: Array<{
    withMembers: string[];
    control: CharacterControl;
    /** 왜 이 컨트롤이 붙는지 — 화면에 그대로 보인다. */
    help?: string;
  }>;
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
  /**
   * 적정거리를 가진 무기군. 런처는 인게임에 적정 사거리가 없어 빠진다 —
   * 정본은 `data/weapon_mechanics.json`의 `optimal_range`다. 옛 설정에는 없을 수
   * 있어, 없으면 무기군 전부로 본다(예전 화면과 같게).
   */
  optimalRangeWeapons?: string[];
  /** 「누가 이 버프를 받았나」를 카드에 띄울 버프 — 정본은 `calculator.customization`. */
  buffTargetWatch: Record<string, Array<{ buff: string; label: string }>>;
  // 무기군별 평타 계수 기본값 (`data/weapon_mechanics.json`).
  normalHitCoeff: Record<string, number>;
  /**
   * 탄착군 — 보스 메이커가 사격 원을 그리는 표. 계산기 본체와 **같은 값**이라
   * 화면의 원과 실제 코어 명중률이 어긋나지 않는다. 옛 설정에는 없을 수 있다.
   */
  accuracy?: {
    modelN: number;
    weapons: Record<string, { baseDiameter: number; accSlope: number }>;
  };
  consoleClasses: string[];
  consoleCompanies: string[];
  overloadFields: Record<string, NumericFieldMeta>;
  /**
   * 오버로드 옵션의 레벨별 값(9종 × 1~15, 퍼센트). 정본은 엔진과 같은
   * `data/base_stat_tables/equipment_skills.json`이다. 옛 설정에는 없을 수 있어,
   * 없으면 부위 3줄 입력을 아예 그리지 않고 직접 입력만 남긴다.
   */
  overloadSteps?: Record<string, number[]>;
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

/** 전투력은 목록 정렬용이라 딜 계산과 별개로 돈다 — 훨씬 가볍다. */
export interface CombatPowerRequest {
  names: string[];
  characters?: Record<string, CharacterOverrides>;
  customCharacters?: SimulationRequest['customCharacters'];
  /**
   * 싱크로와 콘솔. 계정 육성 상태라 전투력이 통째로 달라진다 — 딜 계산과 같은 값을
   * 넘겨야 화면의 두 숫자가 서로 어긋나지 않는다. 안 주면 엔진 기본 스펙으로 잰다.
   */
  synchroLevel?: number;
  console?: ConsoleLevels;
}

export interface WorkerRequest {
  id: number;
  type: 'prepare' | 'simulate' | 'combatPower';
  payload?: SimulationRequest | CombatPowerRequest;
}

export interface WorkerResponse {
  id: number;
  type: 'ready' | 'progress' | 'result' | 'error';
  payload?: SimulationResult | string;
}
