"""Canonical character limit-break, core-enhancement, and bond rules."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


OVER_SPEC_NAMES = frozenset({
    "라피 : 레드 후드",
    "아니스 : 스타",
    "네온 : 비전 아이",
})
MAX_STAGE_BY_RARITY = {"R": 0, "SR": 2, "SSR": 10}
ENGINE_GROWTH_FIELDS = frozenset({"breakthrough", "core_enhancement", "affinity"})
_ROOT = Path(__file__).resolve().parent.parent
_NIKKE = json.loads((_ROOT / "data" / "parsed_nikke.json").read_text(encoding="utf-8"))


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


def resolve_character_growth(name: str, stage: int) -> dict[str, int]:
    """Resolve a named character through canonical parsed metadata."""
    meta = _NIKKE.get(name)
    if meta is None:
        raise ValueError(f"{name}: 캐릭터 메타데이터를 찾을 수 없다")
    return resolve_growth(name, meta, stage)


def growth_stage_label(stage: int) -> str:
    """Return the compact Korean label shown by the browser selector."""
    if stage == 0:
        return "명함"
    if stage <= 3:
        return f"{stage}돌"
    return f"코강 {stage - 3}"


def growth_options(name: str, meta: dict[str, Any]) -> list[dict[str, Any]]:
    """Return every legal selector option with its effective max bond rank."""
    profile = growth_profile(name, meta)
    return [
        {
            "value": stage,
            "label": growth_stage_label(stage),
            "affinity": resolve_growth(name, meta, stage)["affinity"],
        }
        for stage in range(profile["max_stage"] + 1)
    ]
