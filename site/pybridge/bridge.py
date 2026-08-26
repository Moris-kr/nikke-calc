"""Serialize browser requests into the existing calculator API."""

from __future__ import annotations

import json
import math

from calculator.combat_power import combat_power
from calculator.customization import (
    BUFF_TARGET_WATCH,
    normalize_burst_regen,
    normalize_character_overrides,
    normalize_console,
    normalize_element_windows,
    normalize_immune_windows,
    normalize_normal_hit_coeff,
    normalize_optimal_range,
    normalize_synchro_level,
)
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


def _build_buff_targets(result, names: list[str]) -> dict:
    """편성된 캐릭터 중 감시 대상 버프의 실제 수령자.

    `{시전자: [{"label": ..., "buff": ..., "targets": [이름...], "count": N}]}`.
    수령자가 전투 중 갈리면 여러 명이 담긴다 — 그대로 보여 주는 게 맞다.
    """
    log = getattr(result, "log", None)
    if log is None:
        return {}
    out: dict[str, list[dict]] = {}
    for caster in names:
        watches = BUFF_TARGET_WATCH.get(caster)
        if not watches:
            continue
        rows = []
        for buff_name, label in watches:
            sequence: list[dict] = []
            for ev in log.buff_events:
                if ev.kind != "activate" or ev.caster != caster:
                    continue
                # 같은 스킬의 판본(애장품 등)이 이름 뒤에 붙어 오는 경우가 있다.
                if ev.name != buff_name and not ev.name.startswith(f"{buff_name} ("):
                    continue
                if ev.target in names:
                    sequence.append({"t": round(ev.t, 2), "target": ev.target})
            # 처음 받은 순서대로 중복을 없앤다. 둘 이상이면 대상이 전투 중 갈린
            # **특이케이스**이고, 그때는 순서 자체가 정보라 그대로 넘긴다.
            order: list[str] = []
            for item in sequence:
                if item["target"] not in order:
                    order.append(item["target"])
            rows.append({
                "label": label,
                "buff": buff_name,
                "targets": order,
                "sequence": sequence,
                "count": len(sequence),
            })
        if rows:
            out[caster] = rows
    return out


def run_combat_power(raw: str) -> str:
    """캐릭터별 인게임 전투력. 목록 정렬에만 쓰고 딜 계산과는 무관하다.

    `{"characters": {이름: 오버라이드}}` 를 받아 `{이름: 전투력}` 을 준다.
    오버라이드가 없는 캐릭터는 기본 스펙으로 잰다 — 안 가진 니케도 목록에는 있어야
    하고, 그때는 «만렙이면 이 정도»가 가장 덜 틀린 값이다.
    """
    payload = json.loads(raw)
    _inject_custom_characters(payload.get("customCharacters") or {})
    raw_characters = payload.get("characters") or {}
    names = [str(n) for n in (payload.get("names") or raw_characters)]

    overrides = {
        name: normalize_character_overrides(raw_characters.get(name), character_name=name)
        for name in names
        if name in raw_characters
    }
    out: dict[str, float] = {}
    for name in names:
        try:
            char = char_spec.build_squad([name], overrides)[0]
            out[name] = round(combat_power(char), 2)
        except Exception:
            # 한 명이 걸려도 목록 전체가 죽으면 안 된다 — 그 캐릭터만 뺀다.
            continue
    return json.dumps(out, ensure_ascii=False, separators=(",", ":"))


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
    # 콘솔은 계정 속성이라 요청 최상위로 온다 — 스쿼드 전원에게 똑같이 얹는다.
    # 기본 스펙에 이미 콘솔이 있으므로, 준 항목만 덮어쓴다.
    console = normalize_console(payload.get("console"))
    if console:
        for name in names:
            overrides = characters.setdefault(name, {})
            overrides["console"] = {
                **char_spec.DEFAULT_CHAR["console"], **console,
            }
    # 싱크로 레벨도 계정 속성이다 — 소대에 넣은 니케는 전원이 같은 레벨이 된다.
    # 공유 코드에는 담기지 않으므로 남의 조건을 받아도 내 레벨 그대로 계산한다.
    synchro = normalize_synchro_level(payload.get("synchroLevel"))
    if synchro is not None:
        for name in names:
            characters.setdefault(name, {})["level"] = synchro
    # 버스트 게이지 충전 시간도 계정/전투 단위다 — 전원에게 같은 값을 얹는다.
    burst_regen = normalize_burst_regen(payload.get("burstRegenTime"))
    if burst_regen is not None:
        for name in names:
            characters.setdefault(name, {})["burst_regen_time"] = burst_regen
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
        elif assignment.get("mode") == "endgame":
            # 남은 시간이 N초 미만이면 최우선. 그 전에는 평소 순서다.
            burst_pattern[name] = f"last:{float(assignment.get('seconds', 20.0))}"
        elif assignment.get("mode") == "skip":
            burst_pattern[name] = []
    if burst_pattern:
        config_in["burst_pattern"] = burst_pattern
    # 난수 처리: "random"(인게임과 같은 분산) / "expected"(기대값, 결정론적).
    rng_mode = str(payload.get("rngMode") or "random")
    if rng_mode not in ("random", "expected"):
        raise ValueError('난수 모드는 random 또는 expected여야 합니다')
    config_in["rng_mode"] = rng_mode
    # 족자 중 버스트 게이지 정지 여부. 안 주면 켠 것으로 본다(인게임 기준).
    blocks = payload.get("immuneBlocksBurst")
    config_in["immune_blocks_burst"] = True if blocks is None else bool(blocks)
    config = char_spec.build_config(squad, config_in)
    # 평타 계수는 적이 아니라 **우리 쪽 명중**의 문제라 config에 둔다.
    hit_coeff = normalize_normal_hit_coeff(payload.get("normalHitCoeff"))
    if hit_coeff:
        config["normal_hit_coeff"] = hit_coeff

    enemy = {
        "def": int(payload["enemyDef"]),
        "code": str(payload.get("enemyCode") or ""),
        "core_px": float(payload.get("corePx") or 0),
        "has_parts": bool(payload.get("hasParts")),
        # 적정거리는 무기군 단위로 켜진다 — 그 무기군의 일반 공격에만 ③ +30%.
        "optimal_range_weapons": normalize_optimal_range(
            payload.get("optimalRangeWeapons")
        ),
        # 보스 페이즈 — 족자(딜 차단)와 속저(우월 코드만 통과).
        "immune_windows": normalize_immune_windows(payload.get("immuneWindows")),
        "element_windows": normalize_element_windows(payload.get("elementWindows")),
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
        "buffTargets": _build_buff_targets(result, names),
    }
    return json.dumps(response, ensure_ascii=False, separators=(",", ":"))
