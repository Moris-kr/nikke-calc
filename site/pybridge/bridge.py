"""Serialize browser requests into the existing calculator API."""

from __future__ import annotations

import json
import math

from calculator.customization import normalize_character_overrides
from calculator.timeline import simulate
from context import spec as char_spec


def _build_timeline(result, names: list[str]) -> dict:
    """캐릭터별 초당 대미지 · 버스트 시각 · 풀버스트 구간을 1초 버킷으로 요약한다.

    브라우저 타임라인 시각화용. 대미지는 result.hits(항상 채워짐)에서,
    버스트·풀버스트 구간은 verbose 로그(result.log)에서 만든다.
    """
    buckets = int(math.ceil(result.duration)) if result.duration > 0 else 0
    damage = {name: [0] * buckets for name in names}
    for hit in result.hits:
        index = int(hit.t)
        if 0 <= index < buckets:
            row = damage.get(hit.caster)
            if row is not None:
                row[index] += int(hit.damage)

    bursts = {name: [] for name in names}
    full_burst: list[list[float]] = []
    if result.log is not None:
        pending_start: float | None = None
        for event in result.log.burst_log:
            if event.caster and event.caster in bursts and "사용" in event.event:
                stage = ""
                if ":" in event.event:
                    stage = event.event.split(":", 1)[1].split(" ", 1)[0]
                bursts[event.caster].append({"t": round(event.t, 2), "stage": stage})
            elif event.event == "full_burst 시작":
                pending_start = event.t
            elif event.event == "full_burst 종료" and pending_start is not None:
                full_burst.append([round(pending_start, 2), round(event.t, 2)])
                pending_start = None

    return {
        "bucket": 1,
        "buckets": buckets,
        "damage": damage,
        "bursts": bursts,
        "fullBurst": full_burst,
    }


def run_request(raw: str) -> str:
    payload = json.loads(raw)
    names = [str(name).strip() for name in payload["squad"]]
    raw_characters = payload.get("characters") or {}
    if not isinstance(raw_characters, dict):
        raise ValueError("캐릭터 설정은 객체여야 합니다.")
    outside = sorted(set(raw_characters) - set(names))
    if outside:
        raise ValueError(f"스쿼드에 없는 캐릭터 설정: {outside}")
    characters = {
        name: normalize_character_overrides(
            raw_characters.get(name), character_name=name
        )
        for name in names
        if name in raw_characters
    }
    squad = char_spec.build_squad(names, characters)
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
        verbose=True,
    )
    response = {
        "squadTotal": result.squad_total,
        "duration": result.duration,
        "hitCount": len(result.hits),
        "charTotals": result.char_total,
        "previewNote": char_spec.preview_note(names),
        "deviations": char_spec.format_deviations(squad),
        "timeline": _build_timeline(result, names),
    }
    return json.dumps(response, ensure_ascii=False, separators=(",", ":"))
