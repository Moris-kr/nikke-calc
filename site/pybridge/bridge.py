"""Serialize browser requests into the existing calculator API."""

from __future__ import annotations

import json
import math

from calculator.customization import normalize_character_overrides
# `_is_normal`은 히트 태그로 일반공격을 가려내는 엔진 정본이다. 포크에서 다시
# 구현하면 태그가 늘어날 때 조용히 어긋나므로 그대로 빌려 쓴다 (이름이 바뀌면
# ImportError로 즉시 드러난다).
from calculator.sim_result import _is_normal
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


def _build_breakdown(result, names: list[str]) -> dict:
    """캐릭터별 일반공격/스킬 딜 분해와 스킬별 내역.

    `SimResult.dmg_breakdown()`이 콘솔용으로 하는 집계와 같은 기준이며, 브라우저가
    비율을 그릴 수 있도록 수치만 구조화해 넘긴다.
    """
    breakdown = {}
    for name in names:
        hits = [hit for hit in result.hits if hit.caster == name]
        normal_damage = skill_damage = 0
        normal_hits = skill_hits = 0
        per_skill: dict[str, dict[str, int]] = {}
        for hit in hits:
            if _is_normal(hit):
                normal_damage += hit.damage
                normal_hits += 1
                continue
            skill_damage += hit.damage
            skill_hits += 1
            entry = per_skill.setdefault(hit.skill_name, {"damage": 0, "hits": 0})
            entry["damage"] += hit.damage
            entry["hits"] += 1
        breakdown[name] = {
            "normal": int(normal_damage),
            "normalHits": normal_hits,
            "skill": int(skill_damage),
            "skillHits": skill_hits,
            "skills": sorted(
                (
                    {"name": skill, "damage": int(v["damage"]), "hits": v["hits"]}
                    for skill, v in per_skill.items()
                ),
                key=lambda item: -item["damage"],
            ),
        }
    return breakdown


_REQUIRED_NIKKE_FIELDS = (
    "rarity", "element_code", "class", "weapon_type", "burst_stage",
    "burst_cooldown", "max_ammo", "reload_time", "fire_rate", "damage_coeff",
)


def _inject_custom_characters(custom: dict) -> None:
    """브라우저에서 넘어온 커스텀 니케를 엔진 전역에 병합한다.

    서버·정본 데이터는 건드리지 않는다 — Pyodide 워커 프로세스의 인메모리
    전역(parsed_nikke·parsed_skills 사본)에만 얹으며, 새로고침하면 사라진다.
    """
    if not custom:
        return
    import calculator.timeline as _tl
    import calculator.base_stat as _bs
    import calculator.buff_manager as _bm
    from context import growth as _growth

    char_spec._nikke()  # spec의 지연 캐시를 먼저 로드
    # parsed_nikke·parsed_skills 사본은 여러 모듈이 각자 들고 있다. 전부에 얹는다.
    nikke_stores = (_tl._NIKKE, _bs._NIKKE, _bm._NIKKE, _growth._NIKKE, char_spec._NIKKE_CACHE)
    skill_stores = (_tl._PARSED_SKILLS, _bm._PARSED_SKILLS)
    for name, data in custom.items():
        if not isinstance(data, dict) or "nikke" not in data or "skills" not in data:
            raise ValueError(f"커스텀 니케 '{name}': nikke와 skills가 필요합니다")
        nikke = data["nikke"]
        skills = data["skills"]
        missing = [f for f in _REQUIRED_NIKKE_FIELDS if f not in nikke]
        if missing:
            raise ValueError(f"커스텀 니케 '{name}': 누락된 스탯 {missing}")
        if not isinstance(skills, list):
            raise ValueError(f"커스텀 니케 '{name}': skills는 배열이어야 합니다")
        for store in nikke_stores:
            store[name] = nikke
        for store in skill_stores:
            store[name] = skills


def run_request(raw: str) -> str:
    payload = json.loads(raw)
    _inject_custom_characters(payload.get("customCharacters") or {})
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
    config_in: dict = {"duration": int(payload["duration"])}
    # 버스트 운용 배정 → config["burst_pattern"]. solo는 매 사이클 우선(전담),
    # skip은 가급적 안 씀. build_config는 여기서 준 값을 그대로 살린다(caller 우선).
    burst_pattern: dict = {}
    for name, overrides in characters.items():
        assignment = overrides.get("_burst_assignment")
        if not isinstance(assignment, dict):
            continue
        if assignment.get("mode") == "priority":
            burst_pattern[name] = f"every:{int(assignment.get('every', 1))}"
        elif assignment.get("mode") == "skip":
            burst_pattern[name] = []
    if burst_pattern:
        config_in["burst_pattern"] = burst_pattern
    config = char_spec.build_config(squad, config_in)
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
        "charBreakdown": _build_breakdown(result, names),
        "previewNote": char_spec.preview_note(names),
        "deviations": char_spec.format_deviations(squad),
        "timeline": _build_timeline(result, names),
    }
    return json.dumps(response, ensure_ascii=False, separators=(",", ":"))
