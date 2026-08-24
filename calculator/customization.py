"""Browser-safe character customization schema and validation.

The web UI consumes the exported labels and bounds, while the Pyodide bridge
uses :func:`normalize_character_overrides` as the authoritative validator.
Only numeric mechanics that have an unambiguous personal interpretation are
listed here; state/trigger/weapon-change flags deliberately stay out.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from calculator.base_stat import NO_ITEM
from calculator.buff_manager import FAVORITE_MAX_STAGE
from context.growth import resolve_character_growth


# 순서는 **인게임 오버로드 표기 순서**다 — 우코·공증·장탄·차속·차댐·명중·크확·크댐·방어.
# 브라우저가 이 dict 순서를 그대로 입력 칸 순서로 쓰므로(export-settings → UI),
# 게임 화면을 보고 그대로 옮겨 적을 수 있게 맞춘다. 값 조회는 전부 키 기준이라
# 순서를 바꿔도 계산에는 영향이 없다.
OVERLOAD_FIELDS: dict[str, dict[str, Any]] = {
    "element_bonus": {"label": "우월 코드 대미지", "unit": "%", "min": 0.0, "max": 1000.0},
    "atk_pct": {"label": "공격력", "unit": "%", "min": 0.0, "max": 1000.0},
    "max_ammo_pct": {"label": "최대 장탄수", "unit": "%", "min": 0.0, "max": 10000.0},
    "charge_speed_pct": {"label": "차지 속도", "unit": "%", "min": 0.0, "max": 1000.0},
    "charge_dmg_pct": {"label": "차지 대미지", "unit": "%", "min": 0.0, "max": 1000.0},
    "accuracy_pct": {"label": "명중률", "unit": "%", "min": 0.0, "max": 1000.0},
    "crit_rate": {"label": "크리티컬 확률", "unit": "%", "min": 0.0, "max": 100.0},
    "crit_dmg": {"label": "크리티컬 대미지", "unit": "%", "min": 0.0, "max": 1000.0},
    "def_pct": {"label": "방어력", "unit": "%", "min": 0.0, "max": 1000.0},
}

def _load_cube_names() -> tuple[str, ...]:
    """선택 가능한 하모니 큐브 이름. 정본은 `data/base_stat_tables/cube.json`이다.

    `_`로 시작하는 키는 주석·공용 표이고, `공통`은 종류가 아니라 어떤 큐브를 끼든
    항상 붙는 두 번째 스킬이라 선택지에서 뺀다. 나머지는 계산기가 스킬을 아직
    처리하지 못하는 큐브(`unsupported`)까지 모두 넣는다 — 스킬이 빠져도 큐브의
    공격력·방어력·체력과 `공통` 우월 코드 효과는 그대로 붙기 때문에, 목록에서
    빼면 실제로 그 큐브를 낀 유저의 스펙이 과소평가된다.
    """
    root = Path(__file__).resolve().parent.parent
    table = json.loads(
        (root / "data" / "base_stat_tables" / "cube.json").read_text(encoding="utf-8")
    )
    return tuple(k for k in table if not k.startswith("_") and k != "공통")


CUBE_NAMES = _load_cube_names()
def _load_collection_stages() -> tuple[str, ...]:
    """선택 가능한 소장품 단계. 정본은 `data/base_stat_tables/collection.json`이다.

    `없음`(미장착)을 맨 앞에 둔다 — 엔진이 이미 아는 값이고(`base_stat.NO_ITEM`),
    실제로 소장품을 안 낀 캐릭터가 적지 않다.
    """
    root = Path(__file__).resolve().parent.parent
    table = json.loads(
        (root / "data" / "base_stat_tables" / "collection.json").read_text(encoding="utf-8")
    )
    return (NO_ITEM, *table["_stat_table"].keys())


COLLECTION_STAGES = _load_collection_stages()

# 애장품은 소장품 슬롯을 공유한다 — 끼면 스탯이 SR15와 같고 그 위에 단계별 스킬이
# 붙는다(`context/spec.py` §기본 육성 스펙). 그래서 둘을 한 설정으로 받는다.
FAVORITE_COLLECTION_STAGE = "SR15"

SKILL_LEVEL_KEYS = {"1", "2", "3"}
EQUIP_PARTS = ("머리", "몸통", "팔", "다리")
EQUIP_LEVEL_MAX = 5  # data/base_stat_tables/equipment_stats.json 은 부위별 LV0~5


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


def _control_number(value: Any, field: str, minimum: float, maximum: float) -> float:
    return _number(value, field, {"min": minimum, "max": maximum})


def _normalize_control(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("컨트롤 설정은 객체여야 합니다")
    unknown = set(raw) - {"tap_fire", "reload", "cover", "hold"}
    if unknown:
        raise ValueError(f"지원하지 않는 컨트롤: {sorted(unknown)}")
    result: dict[str, Any] = {}

    tap = raw.get("tap_fire")
    if tap is not None:
        if not isinstance(tap, dict) or set(tap) - {
            "rate", "release", "full_charge_interval"
        } or "rate" not in tap:
            raise ValueError("톡톡이는 rate와 선택 release/full_charge_interval만 지원합니다")
        normalized_tap = {
            "rate": _control_number(tap["rate"], "tap_fire.rate", 0.1, 20.0),
        }
        if "release" in tap:
            normalized_tap["release"] = _control_number(
                tap["release"], "tap_fire.release", 0.0, 1.0
            )
        if "full_charge_interval" in tap:
            normalized_tap["full_charge_interval"] = _control_number(
                tap["full_charge_interval"], "tap_fire.full_charge_interval", 0.0, 300.0
            )
        result["tap_fire"] = normalized_tap

    reload = raw.get("reload")
    if reload is not None:
        if not isinstance(reload, dict) or set(reload) - {
            "policy", "lead", "margin", "if_dry", "duration"
        }:
            raise ValueError("지원하지 않는 재장전 컨트롤 설정입니다")
        policy = reload.get("policy")
        if policy not in {"before_fb_end", "into_fb"}:
            raise ValueError("재장전 정책은 before_fb_end 또는 into_fb여야 합니다")
        normalized_reload: dict[str, Any] = {"policy": policy}
        for key in ("lead", "margin", "duration"):
            if key in reload:
                normalized_reload[key] = _control_number(
                    reload[key], f"reload.{key}", 0.0, 300.0
                )
        if "if_dry" in reload:
            if not isinstance(reload["if_dry"], bool):
                raise ValueError("reload.if_dry는 참/거짓이어야 합니다")
            normalized_reload["if_dry"] = reload["if_dry"]
        result["reload"] = normalized_reload

    cover = raw.get("cover")
    if cover is not None:
        if not isinstance(cover, dict) or set(cover) - {"policy", "extend"}:
            raise ValueError("지원하지 않는 엄폐 컨트롤 설정입니다")
        if cover.get("policy") != "own_full_burst":
            raise ValueError("엄폐 정책은 own_full_burst여야 합니다")
        normalized_cover: dict[str, Any] = {"policy": "own_full_burst"}
        if "extend" in cover:
            normalized_cover["extend"] = _control_number(
                cover["extend"], "cover.extend", 0.0, 300.0
            )
        result["cover"] = normalized_cover

    hold = raw.get("hold")
    if hold is not None:
        if not isinstance(hold, dict) or set(hold) - {"policy", "lead"}:
            raise ValueError("지원하지 않는 홀드 컨트롤 설정입니다")
        policy = hold.get("policy")
        if policy not in {"own_full_burst", "charge_hold_after_fb"}:
            raise ValueError("지원하지 않는 홀드 정책입니다")
        normalized_hold: dict[str, Any] = {"policy": policy}
        if "lead" in hold:
            normalized_hold["lead"] = _control_number(
                hold["lead"], "hold.lead", 0.0, 300.0
            )
        result["hold"] = normalized_hold

    return result


# 인게임·블라블라링크의 표기 순서. 입력할 때 화면을 그대로 훑을 수 있도록 맞춘다.
# 목록에 없는 소속이 로스터에 새로 생기면 뒤에 붙는다 — 빠뜨리지 않는 게 우선이다.
_OFFICIAL_ORDER = {
    "manufacturer": ("엘리시온", "테트라", "미실리스", "필그림", "어브노말"),
    "class": ("화력형", "방어형", "지원형"),
}


def _roster_buckets(field: str) -> tuple[str, ...]:
    """로스터에 실제로 존재하는 소속 목록. 정본은 `data/parsed_nikke.json`이다.

    엔진은 소속별 콘솔 dict에서 **빠진 소속을 KeyError로 끊는다**
    (`base_stat.console_level`) — 조용히 0이 되지 않게 하려는 자리다. 그래서
    있는 소속은 로스터에서 뽑고, 순서만 공식 표기를 따른다.
    """
    root = Path(__file__).resolve().parent.parent
    nikke = json.loads((root / "data" / "parsed_nikke.json").read_text(encoding="utf-8"))
    seen = {
        meta.get(field) for name, meta in nikke.items()
        if not name.startswith("test_") and meta.get(field)
    }
    official = _OFFICIAL_ORDER[field]
    ordered = [bucket for bucket in official if bucket in seen]
    ordered += sorted(seen - set(official))
    return tuple(ordered)


CONSOLE_CLASSES = _roster_buckets("class")
CONSOLE_COMPANIES = _roster_buckets("manufacturer")

CONSOLE_MAX_LEVEL = 1000

# 콘솔 세 축. `공통`은 전체 하나지만 `클래스`·`기업`은 인게임 재활용 연구실이
# 소속별로 따로 크므로 소속마다 레벨을 받는다 (`base_stat.py` §콘솔 스탯).
CONSOLE_FIELDS: dict[str, dict[str, Any]] = {
    "common_level": {"label": "공통 콘솔", "buckets": ()},
    "class_level": {"label": "클래스 콘솔", "buckets": CONSOLE_CLASSES},
    "company_level": {"label": "기업 콘솔", "buckets": CONSOLE_COMPANIES},
}


def _console_number(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) \
            or not 0 <= value <= CONSOLE_MAX_LEVEL:
        raise ValueError(f"{label} 레벨은 0~{CONSOLE_MAX_LEVEL} 정수여야 한다")
    return value


# 버스트 게이지 충전 시간(초). 계산기는 게이지 누적을 실제로 세지 않고 고정 시간으로
# 모델링한다(`context/GAMEPLAY.md` §사이클 주기의 구성). 기본 2.0초에 단계 전환 0.3초와
# 쿨 여유가 더해져 실측 공백은 2.9초 안팎이 된다.
BURST_REGEN_DEFAULT = 2.0
BURST_REGEN_MIN = 0.0
BURST_REGEN_MAX = 20.0


def normalize_burst_regen(raw: Any) -> float | None:
    """버스트 게이지 충전 시간 → 엔진 `burst_regen_time`. 안 주면 기본값을 쓴다."""
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ValueError("버스트 게이지 충전 시간은 숫자여야 한다")
    value = float(raw)
    if not BURST_REGEN_MIN <= value <= BURST_REGEN_MAX:
        raise ValueError(
            f"버스트 게이지 충전 시간은 {BURST_REGEN_MIN}~{BURST_REGEN_MAX}초여야 한다")
    return value


def normalize_console(raw: Any) -> dict[str, Any]:
    """계정 콘솔(전초기지 재활용 연구실) 레벨 → 엔진 `console` dict.

    콘솔은 계정 속성이라 캐릭터마다 다를 수 없다. 그래서 캐릭터 설정이 아니라
    전투 조건과 같은 층에서 받아 스쿼드 전원에게 똑같이 얹는다.

    `클래스`·`기업`은 소속별 dict로 받는다. 숫자 하나로 와도 받아주고 전 소속
    같은 값으로 편다 — 소속별로 나누기 전에 저장된 설정이 그대로 돌아야 한다.
    """
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("콘솔 설정은 객체여야 한다")
    unknown = set(raw) - set(CONSOLE_FIELDS)
    if unknown:
        raise ValueError(f"지원하지 않는 콘솔 항목: {sorted(unknown)}")

    result: dict[str, Any] = {}
    for key, meta in CONSOLE_FIELDS.items():
        if key not in raw:
            continue
        value = raw[key]
        label = meta["label"]
        buckets: tuple[str, ...] = meta["buckets"]
        if not buckets:
            result[key] = _console_number(value, label)
            continue
        if not isinstance(value, dict):
            # 구버전 표기(숫자 하나) — 전 소속 동일이라는 뜻으로 편다.
            result[key] = dict.fromkeys(buckets, _console_number(value, label))
            continue
        missing = set(buckets) - set(value)
        if missing:
            raise ValueError(f"{label}에 빠진 소속이 있다: {sorted(missing)}")
        extra = set(value) - set(buckets)
        if extra:
            raise ValueError(f"{label}에 모르는 소속이 있다: {sorted(extra)}")
        result[key] = {
            bucket: _console_number(value[bucket], f"{label}({bucket})")
            for bucket in buckets
        }
    return result


def normalize_character_overrides(
    raw: Any, *, character_name: str | None = None
) -> dict[str, Any]:
    """Validate one browser character payload and convert it to spec overrides."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("캐릭터 설정은 객체여야 한다")
    unknown_sections = set(raw) - {
        "growthStage", "overload", "cube", "manualStats", "skillLevels", "control",
        "burst", "equipLevels", "collection", "weaponModeSwapAt",
    }
    if unknown_sections:
        raise ValueError(f"지원하지 않는 캐릭터 설정: {sorted(unknown_sections)}")

    result: dict[str, Any] = {}
    if "weaponModeSwapAt" in raw:
        if character_name is not None and character_name != "신데렐라 : 크리스탈 웨이브":
            raise ValueError("저격 모드 변경은 신데렐라 : 크리스탈 웨이브만 지원합니다")
        swap_at = raw["weaponModeSwapAt"]
        if isinstance(swap_at, bool) or not isinstance(swap_at, (int, float)) \
                or not math.isfinite(swap_at) or not 0 <= swap_at <= 180:
            raise ValueError("저격 모드 변경 시점은 0~180초 숫자여야 합니다")
        result["weapon_mode_swap"] = True
        result["weapon_mode_swap_at"] = float(swap_at)
    if "control" in raw:
        result["_control_override"] = _normalize_control(raw["control"])
    burst = raw.get("burst")
    if burst is not None:
        # 버스트 운용 배정: 같은 단계 후보가 여럿일 때 누가 그 단계 버스트를 쓰는지.
        # priority = n의 배수 사이클마다 우선 사용, skip = 가급적 안 씀.
        # 러너(pybridge.bridge)가 config["burst_pattern"]으로 옮긴다.
        if not isinstance(burst, dict):
            raise ValueError("버스트 운용 설정은 객체여야 합니다")
        mode = burst.get("mode")
        if mode == "skip":
            result["_burst_assignment"] = {"mode": "skip"}
        elif mode == "priority":
            every = burst.get("every", 1)
            if isinstance(every, bool) or not isinstance(every, int) or every < 1:
                raise ValueError("버스트 우선 사용 주기(n)는 1 이상 정수여야 합니다")
            result["_burst_assignment"] = {"mode": "priority", "every": every}
        else:
            raise ValueError("버스트 운용 mode는 priority 또는 skip이어야 합니다")
    if "growthStage" in raw:
        growth_stage = raw["growthStage"]
        if character_name is None:
            raise ValueError("돌파 단계 설정에는 캐릭터 이름이 필요하다")
        result.update(resolve_character_growth(character_name, growth_stage))

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

    # 소장품 / 애장품. 둘은 같은 슬롯이라 한 설정으로 받는다 —
    # `favorite`가 1~3이면 애장품을 낀 것이고 소장품 단계는 SR15로 고정된다.
    collection = raw.get("collection")
    if collection is not None:
        if not isinstance(collection, dict) or set(collection) - {"stage", "favorite"}:
            raise ValueError("소장품 설정은 stage와 favorite만 포함해야 한다")
        favorite = collection.get("favorite", 0)
        if isinstance(favorite, bool) or not isinstance(favorite, int) \
                or not 0 <= favorite <= FAVORITE_MAX_STAGE:
            raise ValueError(f"애장품 단계는 0~{FAVORITE_MAX_STAGE} 정수여야 한다")
        if favorite > 0:
            result["collection_stage"] = FAVORITE_COLLECTION_STAGE
        else:
            stage = collection.get("stage", NO_ITEM)
            if stage not in COLLECTION_STAGES:
                raise ValueError(
                    f"소장품 단계는 {NO_ITEM} 또는 R0~R15 · SR0~SR15 중 하나여야 한다 ({stage!r})")
            result["collection_stage"] = stage
        result["favorite_stage"] = favorite

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

    equip_levels = raw.get("equipLevels")
    if equip_levels is not None:
        if not isinstance(equip_levels, dict):
            raise ValueError("장비 레벨 설정은 객체여야 한다")
        unknown = set(equip_levels) - set(EQUIP_PARTS)
        if unknown:
            raise ValueError(f"지원하지 않는 장비 부위: {sorted(unknown)}")
        equipment: dict[str, Any] = {}
        for part, level in equip_levels.items():
            if isinstance(level, bool) or not isinstance(level, int) \
                    or not 0 <= level <= EQUIP_LEVEL_MAX:
                raise ValueError(f"장비 레벨({part})은 0~{EQUIP_LEVEL_MAX} 정수여야 한다")
            equipment[part] = {"level": level}
        if equipment:
            result["equipment"] = equipment

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
        "cube": {"name": "택티컬 베어 큐브", "level": 15},
        "manualStats": {"split_dmg_pct": 20},
    }) == {
        "skill_levels": {"1": 8, "2": 9, "3": 10},
        "equip_skills": {"atk_pct": 22.22},
        "cube": {"name": "택티컬 베어 큐브", "level": 15},
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
