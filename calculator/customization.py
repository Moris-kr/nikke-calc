"""Browser-safe character customization schema and validation.

The web UI consumes the exported labels and bounds, while the Pyodide bridge
uses :func:`normalize_character_overrides` as the authoritative validator.
Only numeric mechanics that have an unambiguous personal interpretation are
listed here; state/trigger/weapon-change flags deliberately stay out.
"""

from __future__ import annotations

import math
from typing import Any


OVERLOAD_FIELDS: dict[str, dict[str, Any]] = {
    "element_bonus": {"label": "우월 코드 대미지", "unit": "%", "min": 0.0, "max": 1000.0},
    "atk_pct": {"label": "공격력", "unit": "%", "min": 0.0, "max": 1000.0},
    "max_ammo_pct": {"label": "최대 장탄수", "unit": "%", "min": 0.0, "max": 10000.0},
    "crit_rate": {"label": "크리티컬 확률", "unit": "%", "min": 0.0, "max": 100.0},
    "crit_dmg": {"label": "크리티컬 대미지", "unit": "%", "min": 0.0, "max": 1000.0},
}

CUBE_NAMES = ("재장", "탄충", "체력", "차속", "파츠")
SKILL_LEVEL_KEYS = {"1", "2", "3"}


def _stat(label: str, unit: str = "%", minimum: float = -1000.0,
          maximum: float = 10000.0) -> dict[str, Any]:
    return {"label": label, "unit": unit, "min": minimum, "max": maximum}


MANUAL_STATS: dict[str, dict[str, Any]] = {
    "atk_pct": _stat("공격력"),
    "atk_flat": _stat("고정 공격력", "", -10_000_000, 10_000_000),
    "def_ignore_pct": _stat("방어력 무시"),
    "enemy_def_down_pct": _stat("적 방어력 감소"),
    "def_pct": _stat("방어력"),
    "crit_rate": _stat("크리티컬 확률", "%", -100, 100),
    "crit_dmg": _stat("크리티컬 대미지"),
    "core_dmg_pct": _stat("코어 대미지"),
    "normal_atk_dmg_pct": _stat("일반 공격 대미지"),
    "atk_dmg_pct": _stat("공격 대미지"),
    "burst_dmg_pct": _stat("버스트 대미지"),
    "burst_dmg_aoe_pct": _stat("광역 버스트 대미지"),
    "pierce_dmg_pct": _stat("관통 대미지"),
    "dot_dmg_pct": _stat("지속 대미지"),
    "armor_break_dmg_pct": _stat("방어력 무시 대미지"),
    "projectile_explosion_dmg": _stat("투사체 폭발 대미지"),
    "projectile_attachment_dmg": _stat("투사체 부착 대미지"),
    "sequential_dmg_pct": _stat("순차 대미지"),
    "charge_dmg_pct": _stat("차지 대미지"),
    "charge_dmg_mag_pct": _stat("차지 대미지 배율"),
    "split_dmg_pct": _stat("분배 대미지"),
    "part_dmg_pct": _stat("파츠 대미지"),
    "received_dmg_pct": _stat("받는 대미지(개인 딜 적용)"),
    "element_bonus_pct": _stat("우월 코드 대미지"),
    "charge_speed_pct": _stat("차지 속도"),
    "charge_speed_overflow_conversion_pct": _stat("초과 차지 속도 변환"),
    "max_ammo_pct": _stat("최대 장탄수"),
    "max_ammo_flat": _stat("고정 최대 장탄수", "발", -10000, 10000),
    "ammo_charge_flat": _stat("10발마다 탄환 충전", "발", 0, 10000),
    "accuracy_pct": _stat("명중률"),
    "reload_speed_pct": _stat("재장전 속도"),
    "attack_speed_pct": _stat("공격 속도"),
    "mg_warmup_speed_pct": _stat("MG 예열 속도"),
    "burst_cooldown": _stat("버스트 쿨타임 감소", "초", -1000, 1000),
    "skill_cooldown_pct": _stat("스킬 쿨타임 변화", "%", -1000, 1000),
    "max_hp_pct": _stat("최대·현재 체력"),
    "max_hp_only_pct": _stat("최대 체력"),
    "lifesteal_pct": _stat("흡혈"),
    "def_caster_based_pct": _stat("시전자 기반 방어력"),
    "pellet_count": _stat("펠릿 수 추가", "개", -100, 100),
    "pellet_count_fixed": _stat("펠릿 수 고정", "개", 0, 100),
    "fullburst_duration": _stat("풀 버스트 지속시간", "초", -1000, 1000),
}


def _number(value: Any, field: str, meta: dict[str, Any]) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field}: 숫자여야 한다")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{field}: 유한한 숫자여야 한다")
    if number < meta["min"] or number > meta["max"]:
        raise ValueError(f"{field}: {meta['min']}~{meta['max']} 범위여야 한다")
    return number


def normalize_character_overrides(raw: Any) -> dict[str, Any]:
    """Validate one browser character payload and convert it to spec overrides."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("캐릭터 설정은 객체여야 한다")
    unknown_sections = set(raw) - {"overload", "cube", "manualStats", "skillLevels"}
    if unknown_sections:
        raise ValueError(f"지원하지 않는 캐릭터 설정: {sorted(unknown_sections)}")

    result: dict[str, Any] = {}
    skill_levels = raw.get("skillLevels")
    if skill_levels is not None:
        if not isinstance(skill_levels, dict):
            raise ValueError("스킬 레벨 설정은 객체여야 한다")
        unknown = set(skill_levels) - SKILL_LEVEL_KEYS
        if unknown:
            raise ValueError(f"지원하지 않는 스킬 키: {sorted(unknown)}")
        normalized_levels = {}
        for key, value in skill_levels.items():
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 10:
                raise ValueError(f"스킬 {key} 레벨은 1~10 정수여야 한다")
            normalized_levels[key] = value
        result["skill_levels"] = normalized_levels

    overload = raw.get("overload")
    if overload is not None:
        if not isinstance(overload, dict):
            raise ValueError("오버로드 설정은 객체여야 한다")
        unknown = set(overload) - set(OVERLOAD_FIELDS)
        if unknown:
            raise ValueError(f"지원하지 않는 오버로드 옵션: {sorted(unknown)}")
        result["equip_skills"] = {
            key: _number(value, key, OVERLOAD_FIELDS[key])
            for key, value in overload.items()
        }

    cube = raw.get("cube")
    if cube is not None:
        if not isinstance(cube, dict) or set(cube) - {"name", "level"}:
            raise ValueError("큐브 설정은 name과 level만 포함해야 한다")
        name = cube.get("name")
        level = cube.get("level")
        if name not in CUBE_NAMES:
            raise ValueError(f"큐브는 {', '.join(CUBE_NAMES)} 중 하나여야 한다")
        if isinstance(level, bool) or not isinstance(level, int) or not 1 <= level <= 15:
            raise ValueError("큐브 레벨은 1~15 정수여야 한다")
        result["cube"] = {"name": name, "level": level}

    manual = raw.get("manualStats")
    if manual is not None:
        if not isinstance(manual, dict):
            raise ValueError("고급 수치 설정은 객체여야 한다")
        unknown = set(manual) - set(MANUAL_STATS)
        if unknown:
            raise ValueError(f"지원하지 않는 고급 수치: {sorted(unknown)}")
        result["manual_stats"] = {
            key: _number(value, key, MANUAL_STATS[key])
            for key, value in manual.items()
        }

    return result


def _self_test() -> None:
    assert normalize_character_overrides({
        "skillLevels": {"1": 8, "2": 9, "3": 10},
        "overload": {"atk_pct": 22.22},
        "cube": {"name": "탄충", "level": 15},
        "manualStats": {"split_dmg_pct": 20},
    }) == {
        "skill_levels": {"1": 8, "2": 9, "3": 10},
        "equip_skills": {"atk_pct": 22.22},
        "cube": {"name": "탄충", "level": 15},
        "manual_stats": {"split_dmg_pct": 20.0},
    }
    try:
        normalize_character_overrides({"cube": {"name": "지원 안 함", "level": 15}})
    except ValueError:
        pass
    else:
        raise AssertionError("unsupported cube was accepted")
    print("customization self-test OK")


if __name__ == "__main__":
    _self_test()
