"""Bounded structural checks, not a simulation or a proof of cycle performance.

``characters`` uses the public browser/MCP override schema. Explicit consent only
permits a user-fixed simulation; it never makes a missing-CDR recommendation pass.
This module is also copied beside the browser runtime's data/ directory.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from calculator.buff_manager import char_effects
from calculator.customization import normalize_character_overrides
from context.spec import build_char

_CDR = {'burst_cooldown', 'burst_cooldown_reduce'}
_SODA = '소다 : 트윙클링 바니'


@lru_cache(maxsize=1)
def _catalog():
    here = Path(__file__).resolve().parent
    root = here if (here / 'data').is_dir() else here.parent
    return json.loads((root / 'data/parsed_nikke.json').read_text(encoding='utf-8'))


def _value(effect, char):
    level = str(char['skill_levels'].get(effect.get('source', '')[-1:], 10))
    return effect.get('fixed_value', effect.get('values', {}).get(level))


def _build(name, overrides, members):
    return build_char(name, normalize_character_overrides(
        overrides.get(name), character_name=name), members=members)


def _skipped(char, overrides):
    # build_char deliberately strips runner-only _burst_assignment metadata.
    return ((overrides.get(char['name']) or {}).get('burst') or {}).get('mode') == 'skip'


def _condition(condition, name, members, chars, effects, seen=()):
    """Three-valued static evaluation. Unknown activation never becomes a guarantee."""
    meta = _catalog()
    if condition in ('no_burst1_ally', 'has_burst1_ally'):
        has = any(meta[n]['burst_stage'] == '1' for n in members if n != name)
        # Reentry repeats a stage; it does not change state['burst_stages'].
        # A no-B1 override cannot activate while a fixed native B1 (including
        # the queried caster) is present. This is the usual Anis + Rapi team.
        changing = {n: [e for e in effects[n]
                        if e.get('stat', '').startswith('burst_stage_override:')
                        and 'reenter' not in e['stat']] for n in members}
        fixed_b1 = {n for n in members if meta[n]['burst_stage'] == '1' and not changing[n]}
        if fixed_b1 - {name}:
            return condition == 'has_burst1_ally'
        dynamic = any(any(not (
            'no_burst1_ally' in e.get('trigger', {}).get('condition', [])
            and fixed_b1 - {n}) for e in changing[n]) for n in members if n != name)
        if dynamic:
            return None
        return not has if condition == 'no_burst1_ally' else has
    if condition.startswith('self_state:'):
        state = condition.split(':', 1)[1]
        if state in seen:
            return None
        sources = [e for e in effects[name] if e.get('name') == state and e.get('type') == 'buff']
        results = []
        for source in sources:
            timing = source.get('trigger', {}).get('timing', [])
            if not set(timing) & {'battle_start', 'event:enemy_spawn'} or source.get('duration') != -1:
                results.append(None)
                continue
            results.append(_conditions(source, name, members, chars, effects, (*seen, state)))
        return True if True in results else (None if None in results or not results else False)
    return None


def _conditions(effect, name, members, chars, effects, seen=()):
    results = [_condition(c, name, members, chars, effects, seen)
               for c in effect.get('trigger', {}).get('condition', [])]
    return False if False in results else (None if None in results else True)


def _rows(name, members, chars, effects, overrides):
    char = chars[name]
    rows = []
    for effect in effects[name]:
        if effect.get('stat') not in _CDR:
            continue
        value = _value(effect, char)
        conditions = effect.get('trigger', {}).get('condition', [])
        timings = effect.get('trigger', {}).get('timing', [])
        row = {'name': name, 'source': effect.get('source'), 'effect': effect.get('name'),
               'stat': effect['stat'], 'target': effect.get('target'), 'seconds': value,
               'favoriteStage': char['favorite_stage'], 'conditions': conditions,
               'timing': timings, 'status': 'inactive', 'reason': ''}
        if effect.get('target') != 'all_allies':
            row['reason'] = 'self_or_restricted_target_not_team_cdr'
        elif not isinstance(value, (int, float)) or value <= 0:
            row['reason'] = 'no_positive_reduction_at_selected_skill_level'
        else:
            condition = _conditions(effect, name, members, chars, effects)
            if condition is False:
                row['reason'] = 'composition_condition_unsatisfied'
            elif condition is None:
                row.update(status='conditional', reason='activation_condition_needs_verification')
            elif any(t.startswith('full_charge_count:') for t in timings) and char.get('control'):
                row.update(status='conditional', reason='full_charge_availability_with_manual_controls_needs_verification')
            elif 'last_bullet_fire' in timings and char.get('control'):
                row.update(status='conditional', reason='last_bullet_availability_with_manual_controls_needs_verification')
            elif any(t == 'burst_cast' for t in timings) and _skipped(char, overrides):
                row['reason'] = 'burst_is_skipped'
            elif not timings or any(not (t in {'battle_start', 'full_burst_start', 'full_burst_end', 'last_bullet_fire'}
                                        or t.startswith(('full_burst_start_count:', 'full_charge_count:')))
                                    for t in timings):
                row.update(status='conditional', reason='trigger_needs_verification')
            else:
                row.update(status='effective', reason='positive_team_cdr_with_satisfied_structural_conditions')
        rows.append(row)
    return rows


def query_squad_roles(names=None, characters=None):
    """Candidate metadata. Conditional entries must be rechecked in a full squad."""
    catalog = _catalog()
    names = list(names) if names is not None else sorted(n for n in catalog if not n.startswith('test_'))
    if len(names) > 500 or len(set(names)) != len(names) or any(n not in catalog for n in names):
        raise ValueError('정식 캐릭터 이름을 중복 없이 최대 500명 지정하세요.')
    overrides = characters or {}
    rows = []
    for name in names:
        try:
            char = _build(name, overrides, [name])
            effects = char_effects(name, char['favorite_stage'])
            reductions = [{**{key: e.get(key) for key in ('source', 'name', 'stat', 'target', 'trigger', 'favorite')},
                           'seconds': _value(e, char)} for e in effects if e.get('stat') in _CDR]
            team = [r for r in reductions if r['target'] == 'all_allies' and (r['seconds'] or 0) > 0]
            rows.append({'name': name, 'burstStage': catalog[name]['burst_stage'],
                         'burstCooldown': catalog[name]['burst_cooldown'], 'weaponType': catalog[name]['weapon_type'],
                         'favoriteStage': char['favorite_stage'], 'teamCdrCandidate': bool(team),
                         'cdrEffects': reductions, 'requiresSquadValidation': bool(team)})
        except ValueError as error:
            rows.append({'name': name, 'teamCdrCandidate': False, 'requiresVerification': True, 'warning': str(error)})
    return {'characters': rows, 'count': len(rows), 'source': 'parsed_nikke + char_effects(selected favorite/skill levels)'}


def inspect_squad_policy(squad: list[str], characters: dict | None = None,
                         purpose='recommendation', allow_no_cdr=False):
    """Check five-person composition before simulation/candidate ranking.

    purpose='user_fixed' honors explicit allow_no_cdr consent. Recommendations
    remain excluded without effective CDR, except the narrow shotgun exception.
    Dynamic/unknown effects are returned as conditional, never effective providers.
    """
    if purpose not in ('recommendation', 'user_fixed'):
        raise ValueError('purpose는 recommendation 또는 user_fixed입니다.')
    if type(allow_no_cdr) is not bool:
        raise ValueError('allow_no_cdr는 명시적인 bool이어야 합니다.')
    if not isinstance(squad, list) or len(squad) > 5 or any(not isinstance(n, str) for n in squad):
        raise ValueError('스쿼드는 정식 캐릭터 이름 최대 5명의 목록입니다.')
    catalog = _catalog()
    constraints = []
    if len(squad) != 5 or len(set(squad)) != 5:
        constraints.append('five_distinct_characters_required')
    if any(n not in catalog or n.startswith('test_') for n in squad):
        constraints.append('unknown_character')
    if characters is not None and not isinstance(characters, dict):
        raise ValueError('characters는 캐릭터별 설정 객체입니다.')
    chars, effects, warnings = {}, {}, []
    if not constraints:
        for name in squad:
            try:
                chars[name] = _build(name, characters or {}, squad)
                effects[name] = char_effects(name, chars[name]['favorite_stage'])
            except ValueError as error:
                constraints.append('character_settings_need_verification')
                warnings.append(str(error))
    reductions, stages = [], {s: [] for s in ('1', '2', '3')}
    exits = {s: [] for s in stages}
    if not constraints:
        for name in squad:
            reductions.extend(_rows(name, squad, chars, effects, characters or {}))
            stage = str(catalog[name]['burst_stage'])
            for effect in effects[name]:
                stat = effect.get('stat', '')
                if stat.startswith('burst_stage_override:') and stat.split(':')[1] in stages:
                    if _conditions(effect, name, squad, chars, effects) is True:
                        stage = stat.split(':')[1]
            if not _skipped(chars[name], characters or {}):
                for key in stages:
                    if stage in (key, 'A'):
                        stages[key].append(name)
                        repeats = [e for e in effects[name]
                                   if e.get('stat') == 'burst_stage_override:reenter' + key]
                        states = [_conditions(e, name, squad, chars, effects) for e in repeats]
                        if not any(state is not False for state in states):
                            exits[key].append(name)
        for stage, names in stages.items():
            if not names:
                constraints.append('missing_burst_stage_' + stage)
            elif not exits[stage]:
                constraints.append('missing_burst_stage_exit_' + stage)
    providers = sorted({r['name'] for r in reductions if r['status'] == 'effective'})
    conditional = [r for r in reductions if r['status'] == 'conditional']
    # A deliberately narrow documented shotgun archetype. Soda's mere presence
    # never exempts an arbitrary squad. Stacks/long-cycle performance still need simulation.
    exception = (not constraints and _SODA in squad and '토브' in squad
                 and '솔린 : 프로스트 티켓' not in squad
                 and sum(catalog[n]['weapon_type'] == 'SG' for n in squad) >= 3
                 and any(n != _SODA and catalog[n]['weapon_type'] == 'SG' for n in stages['3'])
                 and not _skipped(chars[_SODA], characters or {})
                 and any(e.get('stat') == 'fullburst_duration' and (_value(e, chars[_SODA]) or 0) > 0
                         for e in effects[_SODA]))
    if exception:
        warnings.append('소다 : 트윙클링 바니 샷건 풀버스트 연장 예외입니다. 골든 칩 유지와 실제 사이클은 시뮬레이션으로 확인하세요.')
    eligible = not constraints and bool(providers or exception)
    missing = not providers and not exception
    confirmed = purpose == 'user_fixed' and allow_no_cdr and not constraints
    needs_confirmation = not constraints and missing and purpose == 'user_fixed' and not confirmed
    status = ('invalid' if constraints else 'eligible' if eligible else 'confirmed_no_cdr' if confirmed
              else 'requires_confirmation' if needs_confirmation else 'excluded')
    if missing:
        warnings.append('유효한 아군 전체 버스트 쿨타임 감소가 확인되지 않았습니다. 조건부 효과는 제공자로 확정하지 않습니다.')
    return {'status': status, 'purpose': purpose, 'allowed': eligible or confirmed,
            'recommendedEligible': eligible, 'requiresConfirmation': needs_confirmation,
            'confirmationReason': 'no_effective_team_burst_cooldown_reduction' if needs_confirmation else None,
            'providers': providers, 'conditional': conditional, 'cdrEffects': reductions,
            'constraints': constraints, 'burstStageCoverage': stages,
            'burstStageExitCoverage': exits,
            'exception': 'soda_shotgun_fullburst_extension' if exception else None,
            'warnings': warnings, 'scope': 'structural_only_cycle_performance_requires_simulation'}
