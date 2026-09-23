/**
 * Validated, deterministic NK5/NK3 authoring; no browser or simulation required. (py: nikke_mcp/boss_code.py)
 *
 * Wire format is owned by site/src/boss-maker.ts and site/src/share-code.ts.
 * Only fields those decoders preserve are accepted here.
 */
import { ValueError } from '../../site/src/engine/py.ts';
import { DefenseRateWindow, ElementWindow, PhaseWindow, ShotgunSizeWindow } from './models.ts';
import { PyFloat, pyDumps, pyStrip } from './pyjson.ts';
import { Inst, Model, bool, dict, float, int, list, lit, nullable, ref, str } from './pydantic.ts';

const WEAPON = ['AR', 'SMG', 'SG', 'MG', 'SR'] as const;
const SHAPE_WEAPON = ['AR', 'SMG', 'SG', 'MG', 'SR', 'RL'] as const;
const coordinate = () => float({ ge: -2000, le: 4000 });
const KINDS = ['circle', 'rect', 'triangle'];
const CODES = ['', '풍압', '수냉', '작열', '전격', '철갑'];
const strict = { strict: true, forbid: true };

/** Match JavaScript Math.round, including negative half values. */
export function rounded(value: number, scale = 1): number {
  return Math.floor(value * scale + 0.5);
}

export const BossWindow = new Model('BossWindow', [
  { name: 'start', alias: 'from', type: float({ ge: 0, le: 1800 }) },
  { name: 'to', type: float({ ge: 0, le: 1800 }) },
], { ...strict, validators: [(self) => {
  if (rounded(self.v['start'], 10) >= rounded(self.v['to'], 10)) throw ValueError('구간 시작은 끝보다 앞서야 합니다(0.1초 단위).');
}] });

export const BossShape = new Model('BossShape', [
  { name: 'kind', type: lit('circle', 'rect', 'triangle') },
  { name: 'x', type: coordinate() },
  { name: 'y', type: coordinate() },
  { name: 'w', type: float({ ge: 4, le: 2000 }) },
  { name: 'h', type: float({ ge: 4, le: 2000 }) },
  { name: 'rotation', type: float({ ge: -180, le: 180 }), default: 0 },
  { name: 'windows', type: list(ref(BossWindow), { max: 12 }), factory: () => [],
    description: '표시 구간(초). 빈 배열이면 상시 표시. 0.1초 단위로 공유됩니다.' },
  { name: 'range', type: list(lit(...SHAPE_WEAPON), { max: 6 }), factory: () => [],
    description: '이 도형을 겨냥할 때 적정거리인 무기군. RL의 엔진 적용 여부는 계산기 지원 범위를 따릅니다.' },
], strict);

export const BossPart = BossShape.extend('BossPart', [
  { name: 'name', type: str({ min: 1, max: 16, pattern: '\\S' }) },
  { name: 'hp', type: int({ ge: 0, le: 10 ** 12 }), default: 0, description: '0이면 파괴되지 않는 파츠.' },
  { name: 'score', type: int({ ge: 0, le: 10 ** 12 }), default: 0 },
]);

export const BossPoint = new Model('BossPoint', [
  { name: 'x', type: coordinate() },
  { name: 'y', type: coordinate() },
], strict);

export const BossCore = BossPoint.extend('BossCore', [
  { name: 'd', type: float({ ge: 4, le: 400 }), description: '코어 지름(px).' },
]);

export const BossAimKey = BossPoint.extend('BossAimKey', [{ name: 't', type: float({ ge: 0, le: 1800 }) }]);

export const BossCanvas = new Model('BossCanvas', [
  { name: 'w', type: int({ ge: 200, le: 4000 }), default: 960 },
  { name: 'h', type: int({ ge: 200, le: 4000 }), default: 620 },
], strict);

export const BossRangeWindow = PhaseWindow.extend('BossRangeWindow', [
  { name: 'weapons', type: list(lit(...WEAPON), { max: 5 }) },
]);

const WINDOW_FIELDS = ['shotgunSizeWindows', 'coreWindows', 'optimalRangeWindows', 'defenseRateWindows', 'immuneWindows', 'elementWindows'];

export const BossBattle = new Model('BossBattle', [
  { name: 'duration', type: int({ ge: 10, le: 180 }), default: 180 },
  { name: 'enemyDef', type: int({ ge: 0, le: 999999 }), default: 31784 },
  { name: 'enemyCode', type: lit(...CODES), default: '' },
  { name: 'coreEnabled', type: bool(), default: false },
  { name: 'bossSize', type: lit('large', 'medium', 'small', 'custom'), default: 'large' },
  { name: 'shotgunModel', type: lit('legacy', 'spatial-v1', 'spatial-convergence-v1'), default: 'legacy' },
  { name: 'shotgunTargetDiameter', type: float({ ge: 1, le: 2000 }), default: 360 },
  { name: 'shotgunSizeWindows', type: list(ref(ShotgunSizeWindow), { max: 100 }), factory: () => [] },
  { name: 'shotgunHitRate', type: float({ ge: 0, le: 1 }), default: 1 },
  { name: 'corePx', type: int({ ge: 0, le: 1000 }), default: 52 },
  { name: 'hasParts', type: bool(), default: false },
  { name: 'seed', type: int({ ge: 0, le: 2147483647 }), default: 42 },
  { name: 'optimalRangeWeapons', type: list(lit(...WEAPON), { max: 5 }), factory: () => [] },
  { name: 'normalHitCoeff', type: dict(float({ ge: 0, le: 2 }), lit(...SHAPE_WEAPON)), factory: () => ({}) },
  { name: 'coreWindows', type: list(ref(PhaseWindow), { max: 20 }), factory: () => [] },
  { name: 'optimalRangeWindows', type: list(ref(BossRangeWindow), { max: 100 }), factory: () => [] },
  { name: 'defenseRateWindows', type: list(ref(DefenseRateWindow), { max: 100 }), factory: () => [] },
  { name: 'immuneWindows', type: list(ref(PhaseWindow), { max: 20 }), factory: () => [] },
  { name: 'elementWindows', type: list(ref(ElementWindow), { max: 20 }), factory: () => [] },
  { name: 'rngMode', type: lit('expected', 'random'), default: 'expected' },
  { name: 'immuneBlocksBurst', type: bool(), default: true },
  { name: 'burstRegenTime', type: float({ ge: 0, le: 20 }), default: 2 },
  { name: 'firstBurstTime', type: float({ ge: 0, le: 3600 }), default: 0 },
  { name: 'burstReaction', type: float({ ge: 0, le: 3 }), default: 0.05 },
], {
  ...strict,
  description: 'Public battle share only; account growth and simulation-only fields excluded.',
  validators: [(self) => {
    for (const field of WINDOW_FIELDS) {
      for (const window of self.v[field] as Inst[]) {
        if (rounded(window.v['start'], 10) >= rounded(window.v['to'], 10)) {
          throw ValueError('전투 구간은 공유 코드의 0.1초 단위에서도 길이가 있어야 합니다.');
        }
      }
    }
  }],
});

export const BossCodeRequest = new Model('BossCodeRequest', [
  { name: 'name', type: str({ min: 1, max: 24, pattern: '\\S' }) },
  { name: 'canvas', type: ref(BossCanvas), factory: () => BossCanvas.create() },
  { name: 'shapes', type: list(ref(BossShape), { max: 60 }), factory: () => [] },
  { name: 'parts', type: list(ref(BossPart), { max: 24 }), factory: () => [] },
  { name: 'core', type: nullable(ref(BossCore)), default: null },
  { name: 'center', type: nullable(ref(BossPoint)), default: null },
  { name: 'aimKeys', type: list(ref(BossAimKey), { max: 60 }), factory: () => [] },
  { name: 'settingsSource', type: lit('drawing', 'battle'), default: 'drawing',
    description: 'drawing: 그림에서 코어·파츠·사거리 계산. battle: 함께 제공한 전투 수치를 사용.' },
  { name: 'battle', type: nullable(ref(BossBattle)), default: null },
], { ...strict, validators: [(self) => {
  if (self.v['settingsSource'] === 'battle' && self.v['battle'] === null) {
    throw ValueError('settingsSource=battle이면 battle 조건이 필요합니다.');
  }
  const times = (self.v['aimKeys'] as Inst[]).map((key) => rounded(key.v['t'], 10));
  if (times.some((left, i) => i + 1 < times.length && left >= times[i + 1]!)) {
    throw ValueError('aimKeys는 0.1초 단위에서 중복 없이 시각순이어야 합니다.');
  }
  // JavaScript limits strings by UTF-16 units, not Python code points.
  const names: Array<[string, number]> = [[self.v['name'], 24], ...(self.v['parts'] as Inst[]).map((p): [string, number] => [p.v['name'], 16])];
  for (const [name, limit] of names) {
    if (name.length > limit) throw ValueError(`이름은 UTF-16 기준 ${limit}자 이하여야 합니다.`);
  }
}] });

function code(prefix: string, raw: unknown): string {
  return prefix + Buffer.from(pyDumps(raw, { ensureAscii: false, compact: true }), 'utf8').toString('base64url');
}

/** A validated float keeps its Python type in the shared JSON (`1.0`, not `1`). */
function pyFloat(inst: Inst, field: string): unknown {
  const value = inst.v[field];
  return inst.set.has(field) && typeof value === 'number' ? new PyFloat(value) : value;
}

const BATTLE_FIELDS: Array<[string, string]> = [['duration', 'd'], ['enemyDef', 'ed'], ['enemyCode', 'ec'],
  ['coreEnabled', 'ce'], ['corePx', 'cp'], ['hasParts', 'hp'], ['seed', 's'],
  ['optimalRangeWeapons', 'or'], ['rngMode', 'rm'], ['immuneBlocksBurst', 'ib'],
  ['bossSize', 'bs'], ['shotgunHitRate', 'sh'], ['shotgunModel', 'sm'], ['shotgunTargetDiameter', 'sd'],
  ['burstRegenTime', 'br'], ['burstReaction', 'rt'], ['firstBurstTime', 'fb']];

function compact(field: string, value: any): unknown {
  if (field === 'shotgunHitRate') return rounded(value, 10000);
  if (field === 'enemyCode') return CODES.indexOf(value);
  if (field === 'coreEnabled' || field === 'hasParts' || field === 'immuneBlocksBurst') return value ? 1 : 0;
  if (field === 'rngMode') return value === 'random' ? 1 : 0;
  if (field === 'optimalRangeWeapons') return [...value].sort();
  if (field === 'burstRegenTime' || field === 'firstBurstTime') return rounded(value, 10);
  if (field === 'burstReaction') return rounded(value, 100);
  return value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function encode_battle(battle: Inst): string {
  const raw: Record<string, unknown> = {};
  const defaults = BossBattle.create();
  for (const [field, key] of BATTLE_FIELDS) {
    const value = compact(field, battle.v[field]);
    if (!same(value, compact(field, defaults.v[field]))) {
      raw[key] = field === 'shotgunTargetDiameter' ? pyFloat(battle, field) : value;
    }
  }
  // Browser weapon defaults are not universally 1 (e.g. SG). Preserve every
  // explicitly supplied coefficient, so import cannot restore a different default.
  const coeff = battle.v['normalHitCoeff'] as Record<string, number>;
  if (Object.keys(coeff).length) {
    raw['hc'] = Object.fromEntries(Object.entries(coeff).map(([k, v]) => [k, new PyFloat(v)]));
  }
  const windows: Array<[string, string, string | null]> = [['shotgunSizeWindows', 'sw', 'diameter'], ['defenseRateWindows', 'dw', 'rate'],
    ['optimalRangeWindows', 'rw', 'weapons'], ['coreWindows', 'cw', null], ['immuneWindows', 'iw', null], ['elementWindows', 'ew', 'code']];
  for (const [field, key, extra] of windows) {
    const entries = (battle.v[field] as Inst[]).map((window) => {
      const entry: unknown[] = [rounded(window.v['start'], 10), rounded(window.v['to'], 10)];
      if (extra) entry.push(extra === 'code' ? CODES.indexOf(window.v[extra]) : extra === 'weapons' ? window.v[extra] : pyFloat(window, extra));
      return entry;
    });
    if (entries.length) raw[key] = entries;
  }
  return code('NK3-', raw);
}

function shape(s: Inst): Record<string, unknown> {
  const raw: Record<string, unknown> = { k: KINDS.indexOf(s.v['kind']) };
  for (const k of ['x', 'y', 'w', 'h']) raw[k] = rounded(s.v[k]);
  if (s.v['rotation']) raw['r'] = rounded(s.v['rotation']);
  const windows = s.v['windows'] as Inst[];
  if (windows.length) raw['v'] = windows.map((w) => [rounded(w.v['start'], 10), rounded(w.v['to'], 10)]);
  const range = s.v['range'] as string[];
  if (range.length) raw['g'] = [...new Set(range)].sort();
  return raw;
}

export function create_boss_code(request: Inst): Record<string, unknown> {
  const v = request.v;
  const raw: Record<string, unknown> = { n: pyStrip(v['name']) };
  const canvas = v['canvas'] as Inst;
  if (canvas.v['w'] !== 960 || canvas.v['h'] !== 620) raw['c'] = [canvas.v['w'], canvas.v['h']];
  if ((v['shapes'] as Inst[]).length) raw['s'] = (v['shapes'] as Inst[]).map(shape);
  if ((v['parts'] as Inst[]).length) {
    raw['p'] = (v['parts'] as Inst[]).map((p) => ({ ...shape(p), n: pyStrip(p.v['name']), hp: p.v['hp'], ...(p.v['score'] ? { s: p.v['score'] } : {}) }));
  }
  if ((v['aimKeys'] as Inst[]).length) raw['a'] = (v['aimKeys'] as Inst[]).map((k) => [rounded(k.v['t'], 10), rounded(k.v['x']), rounded(k.v['y'])]);
  if (v['core']) raw['k'] = [rounded(v['core'].v['x']), rounded(v['core'].v['y']), rounded(v['core'].v['d'])];
  if (v['center']) raw['m'] = [rounded(v['center'].v['x']), rounded(v['center'].v['y'])];
  if (v['battle'] !== null) raw['b'] = encode_battle(v['battle']);
  if (v['settingsSource'] === 'battle') raw['bs'] = 'battle';
  return {
    code: code('NK5-', raw), format: 'NK5', settingsSource: v['settingsSource'],
    importInstructions: '계산기 → 보스 메이커 → 공유 → 받은 코드 넣기 → 새 보스로 받기에서 NK5 코드 전체를 붙여넣으세요. 도형과 조건을 확인한 뒤 전투에 적용하세요.',
    warnings: [
      '코드 생성만 수행했습니다. 브라우저 조작이나 전투 시뮬레이션 결과가 아닙니다.',
      '좌표·크기는 px 정수, 구간은 0.1초 단위로 반올림됩니다. 실측 근거 없는 도형은 가정이며 실측값으로 표현하지 마세요.',
      '밑그림, 캐릭터별 탄착군·폭발 반경, 계정 육성은 이 도구가 담지 않습니다.',
      'drawing은 도형에서 코어·파츠·사거리를 적용하고, battle은 함께 담은 전투 조건 수치를 사용합니다.',
    ],
  };
}
