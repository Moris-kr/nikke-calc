/** Small, explicit public API; unsupported browser options fail closed. (py: nikke_mcp/models.py) */
import {
  COLLECTION_STAGES, CUBE_NAMES, normalize_burst_sequence, normalize_character_overrides, normalize_console,
  normalize_normal_hit_coeff,
} from '../../site/src/engine/customization.ts';
import { ValueError } from '../../site/src/engine/py.ts';
import { character_names, pyStringCompare } from './engine.ts';
import { pyDumps, pyRepr, utf8Length } from './pyjson.ts';
import {
  Inst, Model, bool, dict, dump, float, int, list, lit, nullable, ref, str, tagged, union,
} from './pydantic.ts';

const strict = { strict: true, forbid: true };
const cubeEnum = () => ({ enum: ['없음', ...CUBE_NAMES] });
const WEAPONS = ['AR', 'SMG', 'SG', 'SR', 'RL', 'MG'] as const;
const ELEMENTS = ['풍압', '수냉', '작열', '전격', '철갑'] as const;

/** Python `sorted(set(xs))` rendered with `repr`. */
export function sortedRepr(values: Iterable<string>): string {
  return pyRepr([...new Set(values)].sort(pyStringCompare));
}

/** `len(model.model_dump_json(exclude_none=True).encode('utf-8'))`. */
export function dumpJsonSize(inst: Inst): number {
  return utf8Length(pyDumps(dump(inst, { excludeNone: true, py: true }), { ensureAscii: false, compact: true }));
}

export const Cube = new Model('Cube', [
  { name: 'name', type: str(), extra: cubeEnum },
  { name: 'level', type: int({ ge: 0, le: 15 }) },
], { ...strict, validators: [(self) => {
  if (self.v['name'] === '없음' && self.v['level'] !== 0) throw ValueError('큐브 없음은 level=0이어야 합니다.');
}] });

export const Collection = new Model('Collection', [
  { name: 'stage', type: str(), default: '없음', extra: () => ({ enum: [...COLLECTION_STAGES] }) },
  { name: 'favorite', type: int({ ge: 0, le: 3 }), default: 0, description: '애장품 단계. 1~3이면 stage는 SR15로 적용됩니다.' },
], strict);

export const BurstPriority = new Model('BurstPriority', [
  { name: 'mode', type: lit('priority') },
  { name: 'every', type: int({ ge: 1, le: 100 }), default: 1 },
], strict);

export const BurstSkip = new Model('BurstSkip', [{ name: 'mode', type: lit('skip') }], strict);

export const BurstEndgame = new Model('BurstEndgame', [
  { name: 'mode', type: lit('endgame') },
  { name: 'seconds', type: float({ gt: 0, le: 180 }), default: 20 },
], strict);

export const TapFire = new Model('TapFire', [
  { name: 'rate', type: float({ ge: 0.1, le: 20 }) },
  { name: 'release', type: nullable(float({ ge: 0, le: 1 })), default: null },
  { name: 'full_charge_interval', type: nullable(float({ ge: 0, le: 300 })), default: null },
], strict);

const range300 = () => nullable(float({ ge: 0, le: 300 }));

export const Reload = new Model('Reload', [
  { name: 'policy', type: lit('before_fb_end', 'into_fb') },
  { name: 'lead', type: range300(), default: null },
  { name: 'margin', type: range300(), default: null },
  { name: 'duration', type: range300(), default: null },
  { name: 'if_dry', type: nullable(bool()), default: null },
], strict);

export const Cover = new Model('Cover', [
  { name: 'policy', type: lit('own_full_burst') },
  { name: 'extend', type: range300(), default: null },
], strict);

export const Hold = new Model('Hold', [
  { name: 'policy', type: lit('own_full_burst', 'charge_hold_after_fb') },
  { name: 'lead', type: range300(), default: null },
], strict);

export const Control = new Model('Control', [
  { name: 'bunny_mode', type: nullable(lit('stance', 'engage')), default: null },
  { name: 'tap_fire', type: nullable(ref(TapFire)), default: null },
  { name: 'reload', type: nullable(ref(Reload)), default: null },
  { name: 'cover', type: nullable(ref(Cover)), default: null },
  { name: 'hold', type: nullable(ref(Hold)), default: null },
], strict);

export const CharacterOverrides = new Model('CharacterOverrides', [
  { name: 'growthStage', type: nullable(int({ ge: 0, le: 10 })), default: null,
    description: 'R=0, SR=0~2, SSR=0~10. 0~3은 돌파, 4~10은 코어 강화.' },
  { name: 'skillLevels', type: nullable(dict(int({ ge: 1, le: 10 }), lit('1', '2', '3'))), default: null },
  { name: 'cube', type: nullable(ref(Cube)), default: null },
  { name: 'collection', type: nullable(ref(Collection)), default: null },
  { name: 'overload', type: nullable(dict(float())), default: null, description: 'get_settings.overloadFields의 키와 범위를 사용. 백분율 수치.' },
  { name: 'manualStats', type: nullable(dict(float())), default: null, description: 'get_settings.manualStats의 키와 범위를 사용.' },
  { name: 'equipLevels', type: nullable(dict(
    union(int({ ge: 0, le: 5 }), lit('없음', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9')),
    lit('머리', '몸통', '팔', '다리'))), default: null },
  { name: 'burst', type: nullable(tagged('mode', BurstPriority, BurstSkip, BurstEndgame)), default: null },
  { name: 'control', type: nullable(ref(Control)), default: null },
  { name: 'weaponModeSwapAt', type: nullable(float({ ge: 0, le: 180 })), default: null,
    description: '신데렐라 : 크리스탈 웨이브의 저격 모드 변경 시점(초).' },
], strict);

export const ConsoleLevels = new Model('ConsoleLevels', [
  { name: 'common_level', type: int({ ge: 0, le: 1000 }) },
  { name: 'class_level', type: dict(int({ ge: 0, le: 1000 })) },
  { name: 'company_level', type: dict(int({ ge: 0, le: 1000 })) },
], { ...strict, validators: [(self) => { normalize_console(dump(self)); }] });

export const GrowthCube = new Model('GrowthCube', [
  { name: 'name', type: nullable(str()), default: null, extra: cubeEnum },
  { name: 'level', type: nullable(int({ ge: 0, le: 15 })), default: null },
], strict);

export const GrowthChanges = CharacterOverrides.extend('GrowthChanges', [
  { name: 'cube', type: nullable(ref(GrowthCube)), default: null },
]);

const GROWTH_CHANGE_KEYS = new Set(['growthStage', 'skillLevels', 'cube', 'collection', 'overload', 'equipLevels']);

export const GrowthScenario = new Model('GrowthScenario', [
  { name: 'label', type: str({ min: 1, max: 100 }) },
  { name: 'changes', type: ref(GrowthChanges),
    description: '현재 육성에 덮어쓸 변경만 지정. 각 변경안은 독립 비교. 장비 4310=머리4·팔3·몸통1·다리0이며, equipLevels 정수는 오버로드 강화 목표 단계.' },
], { ...strict, validators: [(self) => {
  const changes = Object.keys(dump(self.v['changes'], { excludeUnset: true, excludeNone: true }));
  if (!changes.length || changes.some((key) => !GROWTH_CHANGE_KEYS.has(key))) {
    throw ValueError('전투력 비교는 돌파·스킬·큐브·소장품·오버로드·장비 변경만 지원합니다.');
  }
}] });

const intervalValidator = (self: Inst) => {
  if (self.v['start'] >= self.v['to']) throw ValueError('구간 시작은 끝보다 앞서야 합니다.');
};

export const PhaseWindow = new Model('PhaseWindow', [
  { name: 'start', alias: 'from', type: float({ ge: 0, le: 180 }) },
  { name: 'to', type: float({ ge: 0, le: 180 }) },
], { ...strict, validators: [intervalValidator] });

export const ElementWindow = PhaseWindow.extend('ElementWindow', [{ name: 'code', type: lit(...ELEMENTS) }]);
export const DefenseRateWindow = PhaseWindow.extend('DefenseRateWindow', [
  { name: 'rate', type: float({ ge: 0, le: 100 }), default: 60 },
]);
export const ShotgunSizeWindow = PhaseWindow.extend('ShotgunSizeWindow', [
  { name: 'diameter', type: float({ ge: 1, le: 2000 }) },
]);
export const OptimalRangeWindow = PhaseWindow.extend('OptimalRangeWindow', [
  { name: 'weapons', type: list(lit(...WEAPONS), { max: 6 }) },
]);

export const PiercePass = new Model('PiercePass', [
  { name: 'shapes', type: int({ ge: 1, le: 20 }) },
  { name: 'parts', type: int({ ge: 0, le: 20 }) },
], strict);

export const BattleOptions = new Model('BattleOptions', [
  { name: 'duration', type: int({ ge: 1, le: 180 }), default: 180 },
  { name: 'enemyDef', type: int({ ge: 0, le: 10000000 }), default: 31784 },
  { name: 'enemyCode', type: lit('', ...ELEMENTS), default: '' },
  { name: 'shotgunModel', type: lit('legacy', 'spatial-v1', 'spatial-convergence-v1'), default: 'legacy',
    description: 'legacy는 기존 고정 명중률. spatial-v1은 명중 버프와 표적 직경을 함께 판정. spatial-convergence-v1은 미검증 무기 수렴 시간 가정도 적용. 새 방식의 크기·분포는 실측 확정값이 아닙니다.' },
  { name: 'shotgunTargetDiameter', type: float({ ge: 1, le: 2000 }), default: 360 },
  { name: 'shotgunSizeWindows', type: list(ref(ShotgunSizeWindow), { max: 100 }), factory: () => [] },
  { name: 'shotgunHitRate', type: float({ ge: 0, le: 1 }), default: 1,
    description: 'legacy 모드의 샷건 펠릿 명중 확률. spatial 모드에서는 사용하지 않고 shotgunTargetDiameter로 판정.' },
  { name: 'corePx', type: float({ ge: 0, le: 1000 }), default: 0 },
  { name: 'defenseRateWindows', type: list(ref(DefenseRateWindow), { max: 100 }), factory: () => [],
    description: '리버렐리오 바디 심해의 장막 방어율 구간. from/to는 전투 시작 기준 초, rate는 감소율%(기본60). 일반 최종 대미지에 (1-rate/100), 방어력 무시 대미지는 우회. 단순 방무 대미지 증가 버프는 우회 불가. 시작 포함·끝 제외, 겹치면 최대 rate만 적용. 커뮤니티 실험 기반이며 방깎 상호작용 미검증.' },
  { name: 'coreWindows', type: list(ref(PhaseWindow), { max: 100 }), factory: () => [],
    description: '코어 노출 구간(전투 시작 기준 초). 빈 배열이면 상시 노출. corePx=0이면 구간과 무관하게 코어 없음. 시작 포함·끝 제외.' },
  { name: 'hasParts', type: bool(), default: false },
  { name: 'seed', type: int({ ge: 0, le: 2147483647 }), default: 42 },
  { name: 'rngMode', type: lit('expected', 'random'), default: 'expected' },
  { name: 'synchroLevel', type: int({ ge: 1, le: 1400 }), default: 400 },
  { name: 'console', type: nullable(ref(ConsoleLevels)), default: null },
  { name: 'burstRegenTime', type: nullable(float({ ge: 0, le: 20 })), default: null },
  { name: 'firstBurstTime', type: float({ ge: 0, le: 3600 }), default: 0 },
  { name: 'burstReaction', type: nullable(float({ ge: 0, le: 3 })), default: null },
  { name: 'optimalRangeWeapons', type: list(lit(...WEAPONS), { max: 6 }), factory: () => [] },
  { name: 'optimalRangeWindows', type: list(ref(OptimalRangeWindow), { max: 100 }), factory: () => [],
    description: '적정 사거리 변경 구간. 시작 포함·끝 제외, 중첩 구간은 무기군 합집합. 구간 밖은 optimalRangeWeapons 적용. weapons=[]는 해당 구간 적정거리 없음. RL은 무시.' },
  { name: 'immuneWindows', type: list(ref(PhaseWindow), { max: 100 }), factory: () => [] },
  { name: 'elementWindows', type: list(ref(ElementWindow), { max: 100 }), factory: () => [] },
  { name: 'immuneBlocksBurst', type: bool(), default: true },
  { name: 'normalHitCoeff', type: dict(float()), factory: () => ({}) },
  { name: 'partBreakInterval', type: nullable(float({ ge: 0, le: 100000 })), default: null },
  { name: 'piercePass', type: nullable(ref(PiercePass)), default: null },
], { ...strict, validators: [(self) => { normalize_normal_hit_coeff(self.v['normalHitCoeff']); }] });

export const RecommendationCandidate = new Model('RecommendationCandidate', [
  { name: 'label', type: str({ min: 1, max: 100 }) },
  { name: 'squad', type: list(str(), { min: 5, max: 5 }) },
  { name: 'sourceUrl', type: nullable(str({ max: 500 })), default: null },
  { name: 'reason', type: nullable(str({ max: 1000 })), default: null },
], { ...strict, validators: [(self) => {
  const squad: string[] = self.v['squad'];
  const known = new Set(character_names());
  if (new Set(squad).size !== 5 || squad.some((n) => !known.has(n))) throw ValueError('후보는 중복 없는 정식 이름 5명이어야 합니다.');
}] });

const SCENARIO_KEYS = new Set(['enemyDef', 'corePx', 'coreWindows', 'hasParts', 'defenseRateWindows',
  'elementWindows', 'immuneWindows', 'firstBurstTime', 'burstRegenTime', 'optimalRangeWeapons', 'optimalRangeWindows']);

export const RecommendationScenario = new Model('RecommendationScenario', [
  { name: 'label', type: str({ min: 1, max: 100 }) },
  { name: 'battle', type: dict() },
], { ...strict, validators: [(self) => {
  if (Object.keys(self.v['battle']).some((key) => !SCENARIO_KEYS.has(key))) {
    throw ValueError('민감도 비교에서는 방어력·코어·파츠·구간·버스트 충전 시간·적정 사거리만 바꿀 수 있습니다.');
  }
  BattleOptions.validate(self.v['battle']);
}] });

export const CombatRequest = BattleOptions.extend('CombatRequest', [
  { name: 'squad', type: list(str(), { min: 1, max: 5 }), description: '등록된 정식 캐릭터명. 왼쪽부터 편성 순서.' },
  { name: 'burstSequence', type: nullable(list(dict(list(str()), lit('1', '2', '3')), { max: 60 })), default: null },
  { name: 'stateTrack', type: bool(), default: false },
  { name: 'shotTrack', type: bool(), default: false },
  { name: 'fineTimeline', type: bool(), default: false },
  { name: 'characters', type: dict(ref(CharacterOverrides)), factory: () => ({}),
    description: '정식 이름별 웹 계산기 CharacterOverrides. get_settings로 옵션과 형식을 조회하세요.' },
], { validators: [(self) => {
  const squad: string[] = self.v['squad'];
  normalize_burst_sequence(self.v['burstSequence'], squad);
  if (new Set(squad).size !== squad.length) throw ValueError('같은 캐릭터를 중복 편성할 수 없습니다.');
  const known = new Set(character_names());
  const unknown = squad.filter((n) => !known.has(n));
  if (unknown.length) throw ValueError(`등록되지 않은 정식 이름: ${sortedRepr(unknown)}. list_characters로 확인하세요.`);
  const members = new Set(squad);
  if (Object.keys(self.v['characters']).some((n) => !members.has(n))) throw ValueError('편성에 없는 캐릭터의 설정입니다.');
  if (dumpJsonSize(self) > 32000) throw ValueError('캐릭터 설정이 너무 큽니다.');
  for (const [name, overrides] of Object.entries(self.v['characters'] as Record<string, Inst>)) {
    normalize_character_overrides(dump(overrides, { excludeNone: true }), { character_name: name });
  }
}] });

