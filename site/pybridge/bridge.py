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
    normalize_burst_reaction,
    normalize_burst_sequence,
    normalize_optimal_range,
    normalize_synchro_level,
)
# `_is_normal`은 히트 태그로 일반공격을 가려내는 엔진 정본이다. 포크에서 다시
# 구현하면 태그가 늘어날 때 조용히 어긋나므로 그대로 빌려 쓴다 (이름이 바뀌면
# ImportError로 즉시 드러난다).
from calculator.sim_result import _is_normal
from calculator.timeline import simulate
from context import spec as char_spec


# 타임라인 버킷 크기(초). 0.1초까지 쪼개 봤지만 선이 잘게 떨려 오히려 읽기 어려웠다 —
# 1초로 되돌린다. 이 값은 응답에 실려 나가고 화면이 그것으로 «몇 번째 칸이 몇 초인지»를
# 환산하므로, 여기만 바꾸면 그림·눈금·툴팁이 모두 따라온다.
TIMELINE_BUCKET = 1

# 「정밀 분석」에서 쓰는 칸 크기(초). 대미지는 원래부터 히트마다 정수로 정확히 세므로
# 이 값이 **정확도를 바꾸지는 않는다** — 얼마나 잘게 나눠 보여 줄지만 정한다.
FINE_BUCKET = 0.1


def _build_timeline(result, names: list[str], bucket: float = TIMELINE_BUCKET) -> dict:
    """캐릭터별 대미지 · 버스트 시각 · 풀버스트 구간을 `TIMELINE_BUCKET` 단위로 요약한다.

    브라우저 타임라인 시각화용. 대미지는 result.hits(항상 채워짐)에서,
    버스트·풀버스트 구간은 verbose 로그(result.log)에서 만든다.
    버킷 크기는 응답에 함께 실어 보낸다 — 화면이 «몇 번째 칸이 몇 초인지»를
    그 값으로 환산하므로, 1초 버킷으로 저장된 옛 결과도 그대로 그려진다.
    """
    buckets = int(math.ceil(result.duration / bucket)) if result.duration > 0 else 0
    damage = {name: [0] * buckets for name in names}
    for hit in result.hits:
        # 부동소수 나눗셈이 0.3/0.1 = 2.9999…로 떨어져 앞 칸에 붙는 일이 있다 — 보정한다.
        index = int((hit.t + 1e-9) / bucket)
        # 그 보정 때문에 마지막 순간(t = 29.999999999999577처럼 duration에 붙은 값)의
        # 히트가 칸 밖으로 밀려난다. 버리면 버킷 합이 캐릭터 총딜과 어긋나므로
        # 마지막 칸에 넣는다 — 실제로 그 칸에서 일어난 히트다.
        if index == buckets:
            index = buckets - 1
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
        "bucket": bucket,
        "buckets": buckets,
        "damage": damage,
        "bursts": bursts,
        "fullBurst": full_burst,
        "buffs": _build_buff_spans(result, names),
    }


# 늘 걸려 있는 것들 — 소장품·큐브·장비 옵션은 전투 내내 그대로라 타임라인에 그려도
# 「언제 무엇이 걸렸나」를 말해 주지 않는다. 막대만 차지하므로 뺀다.
ALWAYS_ON_PREFIXES = ("소장품", "큐브", "장비 옵션")


def _is_always_on(name: str) -> bool:
    return any(name.startswith(prefix) for prefix in ALWAYS_ON_PREFIXES)


# 화면에 실어 보낼 버프 줄 상한. 5인 180초에서 실측 22줄이라 넉넉하다.
BUFF_TRACK_LIMIT = 60
# 이보다 짧은 버프는 막대로 그려도 한 픽셀이라 뺀다 (즉시 발동에 가까운 것들).
BUFF_MIN_SPAN = 0.2


def _build_buff_spans(result, names: list[str]) -> list[dict]:
    """버프 활성/만료 이벤트 → 화면에 그릴 «버프별 구간 묶음».

    한 버프(이름·시전자·대상)가 한 줄이고, 그 안에 걸려 있던 구간들이 들어간다. 같은
    버프가 200번 다시 걸려도 이름·대상·stat을 한 번만 싣는다 — 구간마다 다 실으면
    5인 180초에서 140KB가 넘어 결과 저장이 감당하지 못한다(실측).

    **중첩이 바뀌면 구간을 끊는다.** 언제부터 몇 겹이었는지가 타임라인의 핵심이라
    한 막대에 최대치만 적으면 그 정보가 사라진다.

    만료 이벤트가 없는 버프(전투가 끝날 때까지 살아 있던 것)는 전투 끝에서 닫는다.
    """
    if result.log is None:
        return []
    duration = float(result.duration or 0.0)
    open_spans: dict[tuple, dict] = {}
    tracks: dict[tuple, dict] = {}

    def track_for(event) -> dict:
        # 한 줄은 «누가 건 무슨 버프»다. 받는 사람이 여럿이면 한 줄에 모으고 대상만
        # 늘린다 — 대상마다 줄을 따로 내면 같은 버프가 다섯 줄로 흩어진다.
        key = (event.name, event.caster)
        found = tracks.get(key)
        if found is None:
            found = tracks[key] = {
                "name": event.name, "caster": event.caster, "targets": [],
                "stat": event.stat, "value": event.value,
                "maxStack": int(event.max_stack) if event.max_stack else 1,
                # 구간 → 그 구간을 받은 사람들. 같은 구간이 사람 수만큼 들어오므로
                # 시각으로 묶는다 — 목록이 아니라 사전이라 중복이 저절로 합쳐진다.
                "_spans": {},
            }
        if event.target and event.target not in found["targets"]:
            found["targets"].append(event.target)
        return found

    def close(key: tuple, at: float) -> None:
        span = open_spans.pop(key, None)
        if span is None:
            return
        start = span["from"]
        if at - start < BUFF_MIN_SPAN:
            return
        row = (round(start, 2), round(at, 2), span["stack"])
        # **누가 받았는지는 구간마다 다를 수 있다.** 리버렐리오 `차분한 수심 4`는
        # 발동마다 공격력 순위로 대상이 갈려, 한 줄에 뭉치면 «둘 다 받는다»로 보인다.
        who = span["track"]["_spans"].setdefault(row, [])
        if span["target"] and span["target"] not in who:
            who.append(span["target"])

    for event in result.log.buff_events:
        if event.target not in names and event.caster not in names:
            continue
        if _is_always_on(event.name):
            continue
        key = (event.name, event.caster, event.target)
        if event.kind == "activate":
            stack = int(event.stack) if event.stack else 1
            open_span = open_spans.get(key)
            if open_span is not None and open_span["stack"] != stack:
                close(key, event.t)
                open_span = None
            track = track_for(event)
            if event.value is not None:
                track["value"] = event.value
            if open_span is None:
                open_spans[key] = {"from": event.t, "stack": stack, "target": event.target,
                                   "track": track, "expires": event.expires_at}
            else:
                open_span["expires"] = event.expires_at
        else:
            close(key, event.t)

    for key, span in list(open_spans.items()):
        expires = span["expires"]
        end = duration if expires in (None, math.inf) or expires > duration else float(expires)
        close(key, end)

    kept = []
    for track in tracks.values():
        rows = sorted(track.pop("_spans").items())
        if not rows:
            continue
        # 구간마다 대상이 같으면 줄 하나에 한 번만 적는다. 갈릴 때만 구간에 붙인다 —
        # 다섯 명에게 걸리는 버프까지 구간마다 이름을 실으면 결과가 몇 배로 무거워진다.
        sets = [frozenset(who) for _, who in rows]
        varies = len(set(sets)) > 1
        spans = []
        for (start, end, stack), who in rows:
            if varies:
                spans.append([start, end, stack,
                              [track["targets"].index(name) for name in who]])
            else:
                spans.append([start, end, stack])
        track["spans"] = spans
        kept.append(track)
    # 처음 걸린 순서대로 세운다 — 화면이 위에서 아래로 그 순서로 읽는다.
    kept.sort(key=lambda track: (track["spans"][0][0], track["name"]))
    return kept[:BUFF_TRACK_LIMIT]


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
    no_burst: list[str] = []
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
            # 「안 씀」은 뒤로 미는 게 아니라 후보에서 빼는 것이다 — 앞사람이 전부
            # 쿨이어도 나가지 않는다.
            no_burst.append(name)
    if burst_pattern:
        config_in["burst_pattern"] = burst_pattern
    if no_burst:
        config_in["no_burst_chars"] = no_burst
    # 손으로 정한 버스트 순서 → config["burst_sequence"]. 적어 둔 사이클까지만 따르고,
    # 전투가 더 길면 그 뒤는 평소 순서로 돌아간다.
    sequence = normalize_burst_sequence(payload.get("burstSequence"), names)
    if sequence is not None:
        config_in["burst_sequence"] = sequence
    # 버스트 반응속도 — 조건이 갖춰진 뒤 누르기까지. 전투 조건이라 config에 둔다.
    reaction = normalize_burst_reaction(payload.get("burstReaction"))
    if reaction is not None:
        config_in["burst_reaction"] = reaction
    # 난수 처리: "random"(인게임과 같은 분산) / "expected"(기대값, 결정론적).
    #
    # 안 주면 **기대값**이다 — 이 브리지가 받드는 화면의 기본값이다. 엔진 라이브러리
    # 기본값(`timeline.DEFAULT_CONFIG`)은 난수지만 그것을 여기까지 끌고 오면 안 된다:
    # 화면은 기대값을 뜻하고 여기서는 난수로 읽어, 기대값으로 둔 사람들이 내내 난수로
    # 계산하고 시드를 바꿀 때마다 결과가 흔들리고 있었다.
    rng_mode = str(payload.get("rngMode") or "expected")
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
    # 「정밀 분석」 — 같은 결과를 더 잘게 나눈 표를 하나 더 싣는다. 대미지는 원래부터
    # 히트마다 정수로 정확히 세므로 **수치가 정밀해지는 게 아니라** 보이는 칸이 잘아진다.
    # 그림은 1초 칸 그대로 쓴다(잘게 떨면 읽기 어렵다) — 이건 내보내기용이다.
    if bool(payload.get("fineTimeline")):
        response["fineTimeline"] = _build_timeline(result, names, FINE_BUCKET)
    return json.dumps(response, ensure_ascii=False, separators=(",", ":"))
