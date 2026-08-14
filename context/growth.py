"""Canonical character limit-break, core-enhancement, and bond rules."""

from __future__ import annotations

from typing import Any


OVER_SPEC_NAMES = frozenset({
    "라피 : 레드 후드",
    "아니스 : 스타",
    "네온 : 비전 아이",
})
MAX_STAGE_BY_RARITY = {"R": 0, "SR": 2, "SSR": 10}
ENGINE_GROWTH_FIELDS = frozenset({"breakthrough", "core_enhancement", "affinity"})


def growth_profile(name: str, meta: dict[str, Any]) -> dict[str, Any]:
    """Return the legal growth range and bond category for one character."""
    rarity = str(meta.get("rarity") or "")
    if rarity not in MAX_STAGE_BY_RARITY:
        raise ValueError(f"{name}: 지원하지 않는 레어도 {rarity!r}")
    max_stage = MAX_STAGE_BY_RARITY[rarity]
    return {
        "rarity": rarity,
        "max_stage": max_stage,
        "default_stage": min(3, max_stage),
        "bond_40": rarity == "SSR" and (
            meta.get("manufacturer") == "필그림" or name in OVER_SPEC_NAMES
        ),
    }


def resolve_growth(name: str, meta: dict[str, Any], stage: int) -> dict[str, int]:
    """Translate one browser growth stage into calculator engine fields."""
    profile = growth_profile(name, meta)
    if isinstance(stage, bool) or not isinstance(stage, int):
        raise ValueError(f"{name}: 돌파 단계는 정수여야 한다")
    if not 0 <= stage <= profile["max_stage"]:
        raise ValueError(
            f"{name}: 돌파 단계는 0~{profile['max_stage']} 범위여야 한다 "
            f"({profile['rarity']})"
        )

    breakthrough = min(stage, 3)
    core_enhancement = max(0, stage - 3)
    if profile["rarity"] == "R":
        affinity = 1
    elif stage == 0:
        affinity = 10
    elif stage == 1:
        affinity = 20
    elif stage == 2:
        affinity = 30
    else:
        affinity = 40 if profile["bond_40"] else 30
    return {
        "breakthrough": breakthrough,
        "core_enhancement": core_enhancement,
        "affinity": affinity,
    }
