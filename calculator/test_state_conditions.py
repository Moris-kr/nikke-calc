"""`self_state:` 조건이 가리키는 이름이 실제로 존재하는가.

원문 「자신이 X 상태라면」은 파싱할 때 `self_state:X`가 되는데, 이 X가 **효과 이름과
맞지 않으면 조건이 영원히 거짓**이 된다. 조용히 죽으므로 딜만 낮게 나오고 아무도
모른다 — 실제로 목단 애장품 「다 덤벼!」의 5타 추가 대미지가 그렇게 죽어 있었다.

`buff_manager._has_self_state`가 이름을 푸는 길은 둘뿐이다:

  1. `_by_name(X)` — **누가 걸었든** 이름이 X인 활성 효과에 이 캐릭터가 들어 있나.
     아군이 걸어 주는 상태도 여기서 풀리므로, 자기 효과 목록에 없어도 된다.
  2. `weapon_change_name(caster) == X` — 무기 변경 모드 이름.

그래서 X는 **데이터 어딘가에 효과 이름으로 존재해야** 한다. 원문의 대괄호 이름
(`[평정심 : …]`)을 그대로 쓰면 안 되고, 그 상태를 **거는 효과의 이름**을 써야 한다.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_SKILLS = json.loads((_ROOT / "data" / "parsed_skills.json").read_text(encoding="utf-8"))

_PREFIXES = ("self_state:", "not_self_state:")


def _all_effect_names() -> set[str]:
    """데이터 전체의 효과 이름. 아군이 거는 상태도 조건에 쓰이므로 캐릭터별로 안 나눈다."""
    names: set[str] = set()
    for entries in _SKILLS.values():
        for effect in entries:
            name = effect.get("name")
            if name:
                names.add(name)
    return names


def _dangling() -> list[tuple[str, str, str]]:
    """(캐릭터, 효과, 조건) — 가리키는 이름이 어디에도 없는 것들."""
    known = _all_effect_names()
    out: list[tuple[str, str, str]] = []
    for character, entries in _SKILLS.items():
        for effect in entries:
            trigger = effect.get("trigger") or {}
            for condition in trigger.get("condition", []) or []:
                if not condition.startswith(_PREFIXES):
                    continue
                state = condition.split(":", 1)[1]
                if state not in known:
                    out.append((character, effect.get("name", "?"), condition))
    return out


#: 적에게 붙는 효과의 `target`. `_resolve_target`이 `"__enemy__"`로 푸는 것들이다.
_ENEMY_TARGETS = {"target", "same_target", "enemy", "all_enemies", "enemies_in_range",
                  "enemies_random"}


def _is_enemy_target(target) -> bool:
    value = str(target or "")
    return value in _ENEMY_TARGETS or value.startswith("enemies_")


def _effects_by_name() -> dict[str, list[tuple[str, dict]]]:
    """이름 → [(캐릭터, 효과)]. 같은 이름이 여러 캐릭터에 있을 수 있다."""
    out: dict[str, list[tuple[str, dict]]] = {}
    for character, entries in _SKILLS.items():
        for effect in entries:
            name = effect.get("name")
            if name:
                out.setdefault(name, []).append((character, effect))
    return out


def _can_carry_state(effect: dict) -> bool:
    """이 효과가 **상태로 남는가**.

    `_active`에 등록되는 것만 `self_state:`/`target_state:`로 조회된다. `instant`는
    `_dispatch_instant` 뒤 곧바로 반환되어 등록되지 않으므로 상태를 만들지 못한다 —
    `event:state_end:`도 나오지 않는다(만료 정리는 `_active`만 훑는다).
    """
    kind = effect.get("type")
    if kind in ("buff", "weapon_change"):
        return True
    # DoT(`tick_interval` 있는 damage)는 target_state 조회를 위해 _active에도 등록된다.
    return kind == "damage" and effect.get("tick_interval") is not None


class StateConditionTest(unittest.TestCase):
    def test_every_self_state_points_at_a_real_effect(self):
        """가리키는 이름이 없으면 그 조건은 영원히 거짓이다 — 조용히 죽는다."""
        dangling = _dangling()
        if dangling:
            lines = "\n".join(
                f"  [{who}] {effect} — {cond}" for who, effect, cond in dangling)
            self.fail(
                "가리키는 효과가 없는 self_state 조건이 있다. 원문 대괄호 이름이 아니라\n"
                "그 상태를 **거는 효과의 이름**을 써야 한다:\n" + lines)

    def test_state_references_point_at_something_that_stays(self):
        """`instant`는 상태를 만들지 못한다 — 가리키면 조건이 영원히 거짓이다."""
        by_name = _effects_by_name()
        bad: list[str] = []
        for character, entries in _SKILLS.items():
            for effect in entries:
                trigger = effect.get("trigger") or {}
                for condition in trigger.get("condition", []) or []:
                    if not condition.startswith(
                            ("self_state:", "not_self_state:",
                             "target_state:", "not_target_state:")):
                        continue
                    state = condition.split(":", 1)[1]
                    holders = by_name.get(state, [])
                    if holders and not any(_can_carry_state(e) for _, e in holders):
                        kinds = sorted({str(e.get("type")) for _, e in holders})
                        bad.append(
                            f"  [{character}] {effect.get('name')} — {condition}"
                            f"  (가리키는 «{state}»는 {'/'.join(kinds)}라 상태로 안 남는다)")
        if bad:
            self.fail(
                "상태로 남지 않는 효과를 상태로 참조한다. 상태를 만들려면 `buff`여야 하고,\n"
                "수치 없이 이름만 필요하면 `stat` 없는 중립 마커 버프로 둔다:\n" + "\n".join(bad))

    def test_target_state_points_at_something_on_the_enemy(self):
        """`target_state:`는 **적에게 붙은 것**만 본다 — 아군 버프를 가리키면 늘 거짓이다."""
        by_name = _effects_by_name()
        bad: list[str] = []
        for character, entries in _SKILLS.items():
            for effect in entries:
                trigger = effect.get("trigger") or {}
                for condition in trigger.get("condition", []) or []:
                    if not condition.startswith(("target_state:", "not_target_state:")):
                        continue
                    state = condition.split(":", 1)[1]
                    holders = by_name.get(state, [])
                    if holders and not any(_is_enemy_target(e.get("target"))
                                           for _, e in holders):
                        targets = sorted({str(e.get("target")) for _, e in holders})
                        bad.append(
                            f"  [{character}] {effect.get('name')} — {condition}"
                            f"  («{state}»는 {'/'.join(targets)}에 붙는다)")
        if bad:
            self.fail(
                "적 상태가 아닌 것을 `target_state:`로 본다. 아군 상태라면 `self_state:`나\n"
                "`allies_with_buff:` 대상 선택을 쓴다:\n" + "\n".join(bad))

    def test_moran_weapon_change_bonus_points_at_her_mode(self):
        """목단 「다 덤벼!」 5타 추가 대미지 — 원문은 「자신이 무기 변경 상태라면」이다.

        일반명을 그대로 쓰면 어떤 이름과도 안 맞아 죽는다. 무기 변경 모드의 실제
        이름(`정정당당 승부다!`)을 가리켜야 `weapon_change_name`으로 풀린다.
        """
        entries = _SKILLS["목단"]
        mode = next(e["name"] for e in entries if e.get("type") == "weapon_change")
        self.assertEqual(mode, "정정당당 승부다!")

        bonus = [e for e in entries if e.get("name") == "다 덤벼! 2"]
        # 기본 판본과 애장품 판본 둘 다 있다.
        self.assertEqual(len(bonus), 2)
        for effect in bonus:
            self.assertEqual(effect["trigger"]["timing"], ["hit_count:5"])
            self.assertEqual(effect["trigger"]["condition"], [f"self_state:{mode}"])


if __name__ == "__main__":
    unittest.main()
