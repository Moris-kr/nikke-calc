"""Serialize browser requests into the existing calculator API."""

from __future__ import annotations

import json

from calculator.timeline import simulate
from context import spec as char_spec


def run_request(raw: str) -> str:
    payload = json.loads(raw)
    names = [str(name).strip() for name in payload["squad"]]
    squad = char_spec.build_squad(names)
    config = char_spec.build_config(squad, {
        "duration": int(payload["duration"]),
    })
    enemy = {
        "def": int(payload["enemyDef"]),
        "code": str(payload.get("enemyCode") or ""),
        "core_px": float(payload.get("corePx") or 0),
        "has_parts": bool(payload.get("hasParts")),
    }
    result = simulate(
        squad,
        config=config,
        enemy=enemy,
        seed=int(payload["seed"]),
    )
    response = {
        "squadTotal": result.squad_total,
        "duration": result.duration,
        "hitCount": len(result.hits),
        "charTotals": result.char_total,
        "previewNote": char_spec.preview_note(names),
        "deviations": char_spec.format_deviations(squad),
    }
    return json.dumps(response, ensure_ascii=False, separators=(",", ":"))
