/**
 * nikke_mcp/squad_policy.py (브라우저 런타임 사본 site/public/runtime/squad_policy.py와 같은 파일)
 * — 편성 구조 검사. 시뮬레이션도, 사이클 성능 증명도 아니다.
 *
 * `characters`는 브라우저/MCP 공개 오버라이드 스키마다. 명시적 동의는 사용자가 고정한 시뮬레이션만
 * 허용하고, CDR이 빠진 추천을 통과시키지는 않는다.
 */
import { data, hasEngineData, onDataChange } from './data';
import { char_effects } from './buff_manager';
import { normalize_character_overrides, _py_is_dict, _py_str } from './customization';
import { build_char } from './spec';
import { PyError, ValueError, get, has, or, sorted, sum, truthy } from './py';

const _CDR = new Set(['burst_cooldown', 'burst_cooldown_reduce']);
const _SODA = '소다 : 트윙클링 바니';

// py: nikke_mcp/squad_policy.py:21
/**
 * 파이썬은 `data/parsed_nikke.json`을 **디스크에서** 읽어 둔다(`lru_cache`) — 커스텀 니케
 * (`_inject_custom_characters`)가 얹히지 않은 정본이다. 여기서는 데이터가 들어오는 즉시(커스텀 니케가
 * 얹히기 전에) 얕은 사본을 떠 둔다. 주입은 항목을 통째로 바꿔 넣을 뿐 기존 항목을 고치지 않는다.
 */
let _CATALOG: Record<string, any> | null = null;
function _snapshot(): void {
  _CATALOG = { ...data().parsed_nikke };
}
onDataChange.push(_snapshot);
if (hasEngineData()) _snapshot();

export function _catalog(): Record<string, any> {
  if (_CATALOG == null) _snapshot();
  return _CATALOG!;
}

type Tri = boolean | null;

/** 파이썬 `effect.get('trigger', {}).get(key, [])`. */
function _trigger(effect: Record<string, any>, key: string): any[] {
  return get(get(effect, 'trigger', {}), key, []);
}

// py: nikke_mcp/squad_policy.py:28
export function _value(effect: Record<string, any>, char: Record<string, any>): any {
  const src: string = get(effect, 'source', '');
  const level = _py_str(get(char['skill_levels'], src.slice(-1), 10));
  // 파이썬은 기본값 인자를 먼저 평가한다.
  const dflt = get(get(effect, 'values', {}), level, null);
  return get(effect, 'fixed_value', dflt);
}

// py: nikke_mcp/squad_policy.py:33
export function _build(name: string, overrides: Record<string, any>, members: string[]): Record<string, any> {
  return build_char(name, normalize_character_overrides(
    get(overrides, name, null), { character_name: name }), null, false, members);
}

// py: nikke_mcp/squad_policy.py:38
export function _skipped(char: Record<string, any>, overrides: Record<string, any>): boolean {
  // build_char deliberately strips runner-only _burst_assignment metadata.
  return get(or(get(or(get(overrides, char['name'], null), {}), 'burst', null), {}), 'mode', null) === 'skip';
}

function _minus(s: Set<string>, x: string): Set<string> {
  const out = new Set(s);
  out.delete(x);
  return out;
}

// py: nikke_mcp/squad_policy.py:43
/** Three-valued static evaluation. Unknown activation never becomes a guarantee. */
export function _condition(condition: string, name: string, members: string[], chars: Record<string, any>,
  effects: Record<string, any[]>, seen: string[] = []): Tri {
  const meta = _catalog();
  if (condition === 'no_burst1_ally' || condition === 'has_burst1_ally') {
    const has_ = members.some((n) => n !== name && meta[n]['burst_stage'] === '1');
    // Reentry repeats a stage; it does not change state['burst_stages'].
    // A no-B1 override cannot activate while a fixed native B1 (including
    // the queried caster) is present. This is the usual Anis + Rapi team.
    const changing: Record<string, any[]> = {};
    for (const n of members) {
      changing[n] = effects[n]!.filter((e) => (get(e, 'stat', '') as string).startsWith('burst_stage_override:')
        && !(e['stat'] as string).includes('reenter'));
    }
    const fixed_b1 = new Set(members.filter((n) => meta[n]['burst_stage'] === '1' && !truthy(changing[n])));
    if (_minus(fixed_b1, name).size) {
      return condition === 'has_burst1_ally';
    }
    const dynamic = members.filter((n) => n !== name).some((n) => changing[n]!.some((e) => !(
      _trigger(e, 'condition').includes('no_burst1_ally')
      && _minus(fixed_b1, n).size > 0)));
    if (dynamic) {
      return null;
    }
    return condition === 'no_burst1_ally' ? !has_ : has_;
  }
  if (condition.startsWith('self_state:')) {
    const state = condition.slice(condition.indexOf(':') + 1);
    if (seen.includes(state)) {
      return null;
    }
    const sources = effects[name]!.filter((e) => get(e, 'name', null) === state && get(e, 'type', null) === 'buff');
    const results: Tri[] = [];
    for (const source of sources) {
      const timing: string[] = _trigger(source, 'timing');
      if (!timing.some((t) => t === 'battle_start' || t === 'event:enemy_spawn')
        || get(source, 'duration', null) !== -1) {
        results.push(null);
        continue;
      }
      results.push(_conditions(source, name, members, chars, effects, [...seen, state]));
    }
    return results.includes(true) ? true : ((results.includes(null) || !results.length) ? null : false);
  }
  return null;
}

// py: nikke_mcp/squad_policy.py:78
export function _conditions(effect: Record<string, any>, name: string, members: string[], chars: Record<string, any>,
  effects: Record<string, any[]>, seen: string[] = []): Tri {
  const results = (_trigger(effect, 'condition') as string[])
    .map((c) => _condition(c, name, members, chars, effects, seen));
  return results.includes(false) ? false : (results.includes(null) ? null : true);
}

/** 파이썬 `isinstance(value, (int, float))` — bool도 int다. */
function _is_number(v: unknown): v is number | boolean {
  return typeof v === 'number' || typeof v === 'boolean';
}

// py: nikke_mcp/squad_policy.py:84
export function _rows(name: string, members: string[], chars: Record<string, any>, effects: Record<string, any[]>,
  overrides: Record<string, any>): Array<Record<string, any>> {
  const char = chars[name];
  const rows: Array<Record<string, any>> = [];
  for (const effect of effects[name]!) {
    if (!_CDR.has(get<any>(effect, 'stat', null))) {
      continue;
    }
    const value = _value(effect, char);
    const conditions = _trigger(effect, 'condition');
    const timings: string[] = _trigger(effect, 'timing');
    const row: Record<string, any> = {
      name: name, source: get(effect, 'source', null), effect: get(effect, 'name', null),
      stat: effect['stat'], target: get(effect, 'target', null), seconds: value,
      favoriteStage: char['favorite_stage'], conditions: conditions,
      timing: timings, status: 'inactive', reason: '',
    };
    if (get(effect, 'target', null) !== 'all_allies') {
      row['reason'] = 'self_or_restricted_target_not_team_cdr';
    } else if (!_is_number(value) || Number(value) <= 0) {
      row['reason'] = 'no_positive_reduction_at_selected_skill_level';
    } else {
      const condition = _conditions(effect, name, members, chars, effects);
      if (condition === false) {
        row['reason'] = 'composition_condition_unsatisfied';
      } else if (condition === null) {
        Object.assign(row, { status: 'conditional', reason: 'activation_condition_needs_verification' });
      } else if (timings.some((t) => t.startsWith('full_charge_count:')) && truthy(get(char, 'control', null))) {
        Object.assign(row, { status: 'conditional', reason: 'full_charge_availability_with_manual_controls_needs_verification' });
      } else if (timings.includes('last_bullet_fire') && truthy(get(char, 'control', null))) {
        Object.assign(row, { status: 'conditional', reason: 'last_bullet_availability_with_manual_controls_needs_verification' });
      } else if (timings.some((t) => t === 'burst_cast') && _skipped(char, overrides)) {
        row['reason'] = 'burst_is_skipped';
      } else if (!timings.length || timings.some((t) => !(
        ['battle_start', 'full_burst_start', 'full_burst_end', 'last_bullet_fire'].includes(t)
        || t.startsWith('full_burst_start_count:') || t.startsWith('full_charge_count:')))) {
        Object.assign(row, { status: 'conditional', reason: 'trigger_needs_verification' });
      } else {
        Object.assign(row, { status: 'effective', reason: 'positive_team_cdr_with_satisfied_structural_conditions' });
      }
    }
    rows.push(row);
  }
  return rows;
}

// py: nikke_mcp/squad_policy.py:125
/** Candidate metadata. Conditional entries must be rechecked in a full squad. */
export function query_squad_roles(names: string[] | null = null, characters: Record<string, any> | null = null): Record<string, any> {
  const catalog = _catalog();
  const names_ = names != null ? [...names]
    : sorted(Object.keys(catalog).filter((n) => !n.startsWith('test_')));
  if (names_.length > 500 || new Set(names_).size !== names_.length || names_.some((n) => !has(catalog, n))) {
    throw ValueError('정식 캐릭터 이름을 중복 없이 최대 500명 지정하세요.');
  }
  const overrides = or(characters, {} as Record<string, any>) as Record<string, any>;
  const rows: Array<Record<string, any>> = [];
  for (const name of names_) {
    try {
      const char = _build(name, overrides, [name]);
      const effects = char_effects(name, char['favorite_stage']);
      const reductions = effects.filter((e) => _CDR.has(get<any>(e, 'stat', null))).map((e) => ({
        ...Object.fromEntries(['source', 'name', 'stat', 'target', 'trigger', 'favorite'].map((key) => [key, get(e, key, null)])),
        seconds: _value(e, char),
      })) as Array<Record<string, any>>;
      const team = reductions.filter((r) => r['target'] === 'all_allies' && Number(or(r['seconds'], 0)) > 0);
      rows.push({
        name: name, burstStage: catalog[name]['burst_stage'],
        burstCooldown: catalog[name]['burst_cooldown'], weaponType: catalog[name]['weapon_type'],
        favoriteStage: char['favorite_stage'], teamCdrCandidate: team.length > 0,
        cdrEffects: reductions, requiresSquadValidation: team.length > 0,
      });
    } catch (error) {
      if (!(error instanceof PyError && error.pyType === 'ValueError')) throw error;
      rows.push({ name: name, teamCdrCandidate: false, requiresVerification: true, warning: error.message });
    }
  }
  return { characters: rows, count: rows.length, source: 'parsed_nikke + char_effects(selected favorite/skill levels)' };
}

// py: nikke_mcp/squad_policy.py:150
/**
 * Check five-person composition before simulation/candidate ranking.
 *
 * purpose='user_fixed' honors explicit allow_no_cdr consent. Recommendations
 * remain excluded without effective CDR, except the narrow shotgun exception.
 * Dynamic/unknown effects are returned as conditional, never effective providers.
 */
export function inspect_squad_policy(squad: any, characters: any = null,
  purpose: any = 'recommendation', allow_no_cdr: any = false): Record<string, any> {
  if (!(purpose === 'recommendation' || purpose === 'user_fixed')) {
    throw ValueError('purpose는 recommendation 또는 user_fixed입니다.');
  }
  if (typeof allow_no_cdr !== 'boolean') {
    throw ValueError('allow_no_cdr는 명시적인 bool이어야 합니다.');
  }
  if (!Array.isArray(squad) || squad.length > 5 || squad.some((n) => typeof n !== 'string')) {
    throw ValueError('스쿼드는 정식 캐릭터 이름 최대 5명의 목록입니다.');
  }
  const members = squad as string[];
  const catalog = _catalog();
  const constraints: string[] = [];
  if (members.length !== 5 || new Set(members).size !== 5) {
    constraints.push('five_distinct_characters_required');
  }
  if (members.some((n) => !has(catalog, n) || n.startsWith('test_'))) {
    constraints.push('unknown_character');
  }
  if (characters != null && !_py_is_dict(characters)) {
    throw ValueError('characters는 캐릭터별 설정 객체입니다.');
  }
  const overrides = or(characters, {} as Record<string, any>) as Record<string, any>;
  const chars: Record<string, any> = {};
  const effects: Record<string, any[]> = {};
  const warnings: string[] = [];
  if (!constraints.length) {
    for (const name of members) {
      try {
        chars[name] = _build(name, overrides, members);
        effects[name] = char_effects(name, chars[name]['favorite_stage']);
      } catch (error) {
        if (!(error instanceof PyError && error.pyType === 'ValueError')) throw error;
        constraints.push('character_settings_need_verification');
        warnings.push(error.message);
      }
    }
  }
  const reductions: Array<Record<string, any>> = [];
  // 키 '1'·'2'·'3' — JS 객체도 정수 모양 키를 오름차순으로 돌므로 파이썬 삽입 순서와 같다.
  const stages: Record<string, string[]> = { '1': [], '2': [], '3': [] };
  const exits: Record<string, string[]> = { '1': [], '2': [], '3': [] };
  if (!constraints.length) {
    for (const name of members) {
      reductions.push(..._rows(name, members, chars, effects, overrides));
      let stage = _py_str(catalog[name]['burst_stage']);
      for (const effect of effects[name]!) {
        const stat: string = get(effect, 'stat', '');
        if (stat.startsWith('burst_stage_override:') && has(stages, stat.split(':')[1]!)) {
          if (_conditions(effect, name, members, chars, effects) === true) {
            stage = stat.split(':')[1]!;
          }
        }
      }
      if (!_skipped(chars[name], overrides)) {
        for (const key of Object.keys(stages)) {
          if (stage === key || stage === 'A') {
            stages[key]!.push(name);
            const repeats = effects[name]!.filter((e) => get(e, 'stat', null) === 'burst_stage_override:reenter' + key);
            const states = repeats.map((e) => _conditions(e, name, members, chars, effects));
            if (!states.some((state) => state !== false)) {
              exits[key]!.push(name);
            }
          }
        }
      }
    }
    for (const [stage, names] of Object.entries(stages)) {
      if (!names.length) {
        constraints.push('missing_burst_stage_' + stage);
      } else if (!exits[stage]!.length) {
        constraints.push('missing_burst_stage_exit_' + stage);
      }
    }
  }
  const providers = sorted(new Set(reductions.filter((r) => r['status'] === 'effective').map((r) => r['name'] as string)));
  const conditional = reductions.filter((r) => r['status'] === 'conditional');
  // A deliberately narrow documented shotgun archetype. Soda's mere presence
  // never exempts an arbitrary squad. Stacks/long-cycle performance still need simulation.
  const exception = (!constraints.length && members.includes(_SODA) && members.includes('토브')
    && !members.includes('솔린 : 프로스트 티켓')
    && sum(members.map((n) => (catalog[n]['weapon_type'] === 'SG' ? 1 : 0))) >= 3
    && stages['3']!.some((n) => n !== _SODA && catalog[n]['weapon_type'] === 'SG')
    && !_skipped(chars[_SODA], overrides)
    && effects[_SODA]!.some((e) => get(e, 'stat', null) === 'fullburst_duration'
      && Number(or(_value(e, chars[_SODA]), 0)) > 0));
  if (exception) {
    warnings.push('소다 : 트윙클링 바니 샷건 풀버스트 연장 예외입니다. 골든 칩 유지와 실제 사이클은 시뮬레이션으로 확인하세요.');
  }
  const eligible = !constraints.length && (providers.length > 0 || exception);
  const missing = !providers.length && !exception;
  const confirmed = purpose === 'user_fixed' && allow_no_cdr && !constraints.length;
  const needs_confirmation = !constraints.length && missing && purpose === 'user_fixed' && !confirmed;
  const status = (constraints.length ? 'invalid' : eligible ? 'eligible' : confirmed ? 'confirmed_no_cdr'
    : needs_confirmation ? 'requires_confirmation' : 'excluded');
  if (missing) {
    warnings.push('유효한 아군 전체 버스트 쿨타임 감소가 확인되지 않았습니다. 조건부 효과는 제공자로 확정하지 않습니다.');
  }
  return {
    status: status, purpose: purpose, allowed: eligible || confirmed,
    recommendedEligible: eligible, requiresConfirmation: needs_confirmation,
    confirmationReason: needs_confirmation ? 'no_effective_team_burst_cooldown_reduction' : null,
    providers: providers, conditional: conditional, cdrEffects: reductions,
    constraints: constraints, burstStageCoverage: stages,
    burstStageExitCoverage: exits,
    exception: exception ? 'soda_shotgun_fullburst_extension' : null,
    warnings: warnings, scope: 'structural_only_cycle_performance_requires_simulation',
  };
}
