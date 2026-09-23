/**
 * context/growth.py — 한계돌파·코어 강화·호감도 규칙(정본).
 *
 * 파이썬의 `_NIKKE`(import 시 읽은 parsed_nikke.json 사본)는 `data().parsed_nikke`로 대신한다.
 * 커스텀 니케(`bridge._inject_custom_characters`)가 그 객체에 직접 얹으므로 여기서도 보인다
 * — 파이썬이 `_growth._NIKKE`에 얹는 것과 같다.
 */

import { data } from './data';
import { ValueError, get, has, or } from './py';
import { _py_repr, _py_str, _py_is_int } from './customization';

export const OVER_SPEC_NAMES: ReadonlySet<string> = new Set([
  '라피 : 레드 후드',
  '아니스 : 스타',
  '네온 : 비전 아이',
]);
export const MAX_STAGE_BY_RARITY: Record<string, number> = { R: 0, SR: 2, SSR: 10 };
export const ENGINE_GROWTH_FIELDS: ReadonlySet<string> = new Set(['breakthrough', 'core_enhancement', 'affinity']);

// py: context/growth.py:21
export function growth_profile(name: string, meta: Record<string, any>): Record<string, any> {
  const rarity = _py_str(or(get(meta, 'rarity'), ''));
  if (!has(MAX_STAGE_BY_RARITY, rarity)) {
    throw ValueError(`${name}: 지원하지 않는 레어도 ${_py_repr(rarity)}`);
  }
  const max_stage = MAX_STAGE_BY_RARITY[rarity]!;
  return {
    rarity: rarity,
    max_stage: max_stage,
    default_stage: Math.min(3, max_stage),
    bond_40: rarity === 'SSR' && (
      get(meta, 'manufacturer') === '필그림' || OVER_SPEC_NAMES.has(name)
    ),
  };
}

// py: context/growth.py:37
export function resolve_growth(name: string, meta: Record<string, any>, stage: any): Record<string, number> {
  const profile = growth_profile(name, meta);
  if (!_py_is_int(stage)) {
    throw ValueError(`${name}: 돌파 단계는 정수여야 한다`);
  }
  if (!(0 <= stage && stage <= profile['max_stage'])) {
    throw ValueError(
      `${name}: 돌파 단계는 0~${profile['max_stage']} 범위여야 한다 `
      + `(${profile['rarity']})`,
    );
  }

  const breakthrough = Math.min(stage, 3);
  const core_enhancement = Math.max(0, stage - 3);
  let affinity: number;
  if (profile['rarity'] === 'R') {
    affinity = 1;
  } else if (stage === 0) {
    affinity = 10;
  } else if (stage === 1) {
    affinity = 20;
  } else if (stage === 2) {
    affinity = 30;
  } else {
    affinity = profile['bond_40'] ? 40 : 30;
  }
  return {
    breakthrough: breakthrough,
    core_enhancement: core_enhancement,
    affinity: affinity,
  };
}

// py: context/growth.py:67
export function resolve_character_growth(name: string, stage: any): Record<string, number> {
  const meta = get(data().parsed_nikke, name);
  if (meta == null) {
    throw ValueError(`${name}: 캐릭터 메타데이터를 찾을 수 없다`);
  }
  return resolve_growth(name, meta, stage);
}

// py: context/growth.py:75
export function growth_stage_label(stage: number): string {
  if (stage === 0) {
    return '명함';
  }
  if (stage <= 3) {
    return `${stage}돌`;
  }
  return `코강 ${stage - 3}`;
}

// py: context/growth.py:84
export function growth_options(name: string, meta: Record<string, any>): Array<Record<string, any>> {
  const profile = growth_profile(name, meta);
  const out: Array<Record<string, any>> = [];
  for (let stage = 0; stage < profile['max_stage'] + 1; stage += 1) {
    out.push({
      value: stage,
      label: growth_stage_label(stage),
      affinity: resolve_growth(name, meta, stage)['affinity'],
    });
  }
  return out;
}
