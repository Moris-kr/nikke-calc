// py: calculator/test_state_conditions.py
/*
 * `self_state:` 조건이 가리키는 이름이 실제로 존재하는가.
 *
 * 원문 「자신이 X 상태라면」은 파싱할 때 `self_state:X`가 되는데, 이 X가 **효과 이름과
 * 맞지 않으면 조건이 영원히 거짓**이 된다. 조용히 죽으므로 딜만 낮게 나오고 아무도
 * 모른다 — 실제로 목단 애장품 「다 덤벼!」의 5타 추가 대미지가 그렇게 죽어 있었다.
 *
 * `buff_manager._has_self_state`가 이름을 푸는 경로:
 *
 *   1. `_by_name(X)` — **누가 걸었든** 이름이 X인 활성 효과에 이 캐릭터가 들어 있나.
 *      아군이 걸어 주는 상태도 여기서 풀리므로, 자기 효과 목록에 없어도 된다.
 *   2. `weapon_change_name(caster) == X` — 무기 변경 모드 이름.
 *   3. `bunny_modes` — 바니 모드 전환 효과가 관리하는 영속 상태.
 *
 * 그래서 X는 **데이터 어딘가에 효과 이름으로 존재해야** 한다. 원문의 대괄호 이름
 * (`[평정심 : …]`)을 그대로 쓰면 안 되고, 그 상태를 **거는 효과의 이름**을 써야 한다.
 */
import { describe, expect, it } from 'vitest';
import { get, or, truthy } from '../py';
import { readJson } from './helpers';

const _SKILLS: Record<string, any[]> = readJson('data/parsed_skills.json');

const _PREFIXES = ['self_state:', 'not_self_state:'];

/** 파이썬 str() — None → "None". */
function _pyStr(v: any): string {
  return v == null ? 'None' : String(v);
}

/** `condition.split(":", 1)[1]` */
function _afterColon(s: string): string {
  return s.slice(s.indexOf(':') + 1);
}

/** 데이터 전체의 효과 이름. 아군이 거는 상태도 조건에 쓰이므로 캐릭터별로 안 나눈다. */
function _all_effect_names(): Set<string> {
  const names = new Set<string>();
  for (const entries of Object.values(_SKILLS)) {
    for (const effect of entries) {
      const name = get(effect, 'name');
      if (truthy(name)) {
        names.add(name);
      }
      if (get(effect, 'stat') === 'bunny_mode_switch') {
        names.add('바니 모드 : 스탠스');
        names.add('바니 모드 : 인게이지');
      }
    }
  }
  return names;
}

/** (캐릭터, 효과, 조건) — 가리키는 이름이 어디에도 없는 것들. */
function _dangling(): Array<[string, string, string]> {
  const known = _all_effect_names();
  const out: Array<[string, string, string]> = [];
  for (const [character, entries] of Object.entries(_SKILLS)) {
    for (const effect of entries) {
      const trigger = or(get(effect, 'trigger'), {});
      for (const condition of (or(get(trigger, 'condition', []), []) as string[])) {
        if (!_PREFIXES.some((p) => condition.startsWith(p))) {
          continue;
        }
        const state = _afterColon(condition);
        if (!known.has(state)) {
          out.push([character, get(effect, 'name', '?'), condition]);
        }
      }
    }
  }
  return out;
}

/** 적에게 붙는 효과의 `target`. `_resolve_target`이 `"__enemy__"`로 푸는 것들이다. */
const _ENEMY_TARGETS = new Set(['target', 'same_target', 'enemy', 'all_enemies', 'enemies_in_range',
  'enemies_random']);

function _is_enemy_target(target: any): boolean {
  const value = truthy(target) ? String(target) : '';
  return _ENEMY_TARGETS.has(value) || value.startsWith('enemies_');
}

/** 이름 → [(캐릭터, 효과)]. 같은 이름이 여러 캐릭터에 있을 수 있다. */
function _effects_by_name(): Map<string, Array<[string, any]>> {
  const out = new Map<string, Array<[string, any]>>();
  for (const [character, entries] of Object.entries(_SKILLS)) {
    for (const effect of entries) {
      const name = get(effect, 'name');
      if (truthy(name)) {
        if (!out.has(name)) out.set(name, []);
        out.get(name)!.push([character, effect]);
      }
    }
  }
  return out;
}

/**
 * 이 효과가 **상태로 남는가**.
 *
 * `_active`에 등록되는 것만 `self_state:`/`target_state:`로 조회된다. `instant`는
 * `_dispatch_instant` 뒤 곧바로 반환되어 등록되지 않으므로 상태를 만들지 못한다 —
 * `event:state_end:`도 나오지 않는다(만료 정리는 `_active`만 훑는다).
 */
function _can_carry_state(effect: any): boolean {
  const kind = get(effect, 'type');
  if (kind === 'buff' || kind === 'weapon_change') {
    return true;
  }
  // DoT(`tick_interval` 있는 damage)는 target_state 조회를 위해 _active에도 등록된다.
  return kind === 'damage' && get(effect, 'tick_interval') != null;
}

/** 파이썬 `sorted({...})` 문자열 정렬(코드 포인트 순). */
function _sortedStrs(xs: Iterable<string>): string[] {
  return [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

describe('StateConditionTest', () => {
  it('test_every_self_state_points_at_a_real_effect', () => {
    // 가리키는 이름이 없으면 그 조건은 영원히 거짓이다 — 조용히 죽는다.
    const dangling = _dangling();
    if (dangling.length > 0) {
      const lines = dangling.map(([who, effect, cond]) => `  [${who}] ${effect} — ${cond}`).join('\n');
      expect.fail(
        '가리키는 효과가 없는 self_state 조건이 있다. 원문 대괄호 이름이 아니라\n'
        + '그 상태를 **거는 효과의 이름**을 써야 한다:\n' + lines);
    }
  });

  it('test_state_references_point_at_something_that_stays', () => {
    // `instant`는 상태를 만들지 못한다 — 가리키면 조건이 영원히 거짓이다.
    const by_name = _effects_by_name();
    const bad: string[] = [];
    for (const [character, entries] of Object.entries(_SKILLS)) {
      for (const effect of entries) {
        const trigger = or(get(effect, 'trigger'), {});
        for (const condition of (or(get(trigger, 'condition', []), []) as string[])) {
          if (!['self_state:', 'not_self_state:', 'target_state:', 'not_target_state:']
            .some((p) => condition.startsWith(p))) {
            continue;
          }
          const state = _afterColon(condition);
          const holders = by_name.get(state) ?? [];
          if (holders.length > 0 && !holders.some(([, e]) => _can_carry_state(e))) {
            const kinds = _sortedStrs(holders.map(([, e]) => _pyStr(get(e, 'type'))));
            bad.push(
              `  [${character}] ${_pyStr(get(effect, 'name'))} — ${condition}`
              + `  (가리키는 «${state}»는 ${kinds.join('/')}라 상태로 안 남는다)`);
          }
        }
      }
    }
    if (bad.length > 0) {
      expect.fail(
        '상태로 남지 않는 효과를 상태로 참조한다. 상태를 만들려면 `buff`여야 하고,\n'
        + '수치 없이 이름만 필요하면 `stat` 없는 중립 마커 버프로 둔다:\n' + bad.join('\n'));
    }
  });

  it('test_target_state_points_at_something_on_the_enemy', () => {
    // `target_state:`는 **적에게 붙은 것**만 본다 — 아군 버프를 가리키면 늘 거짓이다.
    const by_name = _effects_by_name();
    const bad: string[] = [];
    for (const [character, entries] of Object.entries(_SKILLS)) {
      for (const effect of entries) {
        const trigger = or(get(effect, 'trigger'), {});
        for (const condition of (or(get(trigger, 'condition', []), []) as string[])) {
          if (!['target_state:', 'not_target_state:'].some((p) => condition.startsWith(p))) {
            continue;
          }
          const state = _afterColon(condition);
          const holders = by_name.get(state) ?? [];
          if (holders.length > 0 && !holders.some(([, e]) => _is_enemy_target(get(e, 'target')))) {
            const targets = _sortedStrs(holders.map(([, e]) => _pyStr(get(e, 'target'))));
            bad.push(
              `  [${character}] ${_pyStr(get(effect, 'name'))} — ${condition}`
              + `  («${state}»는 ${targets.join('/')}에 붙는다)`);
          }
        }
      }
    }
    if (bad.length > 0) {
      expect.fail(
        '적 상태가 아닌 것을 `target_state:`로 본다. 아군 상태라면 `self_state:`나\n'
        + '`allies_with_buff:` 대상 선택을 쓴다:\n' + bad.join('\n'));
    }
  });

  it('test_moran_weapon_change_bonus_points_at_her_mode', () => {
    // 목단 「다 덤벼!」 5타 추가 대미지 — 원문은 「자신이 무기 변경 상태라면」이다.
    //
    // 일반명을 그대로 쓰면 어떤 이름과도 안 맞아 죽는다. 무기 변경 모드의 실제
    // 이름(`정정당당 승부다!`)을 가리켜야 `weapon_change_name`으로 풀린다.
    const entries = _SKILLS['목단']!;
    const modeEntry = entries.find((e) => get(e, 'type') === 'weapon_change');
    if (modeEntry === undefined) throw new Error('StopIteration');
    const mode = modeEntry['name'];
    expect(mode).toBe('정정당당 승부다!');

    const bonus = entries.filter((e) => get(e, 'name') === '다 덤벼! 2');
    // 기본 판본과 애장품 판본 둘 다 있다.
    expect(bonus.length).toBe(2);
    for (const effect of bonus) {
      expect(effect['trigger']['timing']).toEqual(['hit_count:5']);
      expect(effect['trigger']['condition']).toEqual([`self_state:${mode}`]);
    }
  });
});
