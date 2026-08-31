"""Emit browser settings metadata derived from Python canonical data."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from calculator.customization import (  # noqa: E402
    BUFF_TARGET_WATCH, COLLECTION_STAGES, CONSOLE_CLASSES, CONSOLE_COMPANIES, CUBE_NAMES,
    OPTIMAL_RANGE_WEAPONS, WEAPON_TYPES,
    MANUAL_STATS, OVERLOAD_FIELDS,
)
from context.growth import growth_options, growth_profile  # noqa: E402
from context.spec import CHAR_DEFAULTS, build_squad  # noqa: E402


def main() -> None:
    nikke = json.loads((ROOT / "data" / "parsed_nikke.json").read_text(encoding="utf-8"))
    skills = json.loads((ROOT / "data" / "parsed_skills.json").read_text(encoding="utf-8"))
    raw = json.loads((ROOT / "scraper" / "nikke_scraped.json").read_text(encoding="utf-8"))
    mechanics = json.loads(
        (ROOT / "data" / "weapon_mechanics.json").read_text(encoding="utf-8")
    )
    cube_table = json.loads(
        (ROOT / "data" / "base_stat_tables" / "cube.json").read_text(encoding="utf-8")
    )

    characters = {}
    for name in sorted(
        (n for n in skills if not n.startswith("test_") and n in nikke),
        key=str.casefold,
    ):
        meta = nikke[name]
        profile = growth_profile(name, meta)
        # 조합 조건부 컨트롤 중 «누가 함께 있는가»만 보는 규칙은 화면이 스스로 판정할 수
        # 있다 — 스쿼드만 있으면 되기 때문이다. 그런 규칙만 내려보내, 카드가 «지금 이
        # 조합에서 실제로 걸리는 컨트롤»을 계산 전에도 적을 수 있게 한다.
        # 다른 조건(같은 단계·자리 번호)을 쓰는 규칙은 내려보내지 않는다. 화면이 판정할
        # 수 없는 것을 흉내 내면 틀린 값을 자신 있게 적게 되므로, 그쪽은 예전처럼
        # «조합에 따라 추가됩니다»라고만 알린다(`hasConditionalControl`).
        member_rules = [
            {"withMembers": list(rule["when"]["with_member"]),
             "control": rule.get("control") or {},
             # `_help`는 **화면에 그대로 보일 설명**이다. 같은 자리의 `_note`는
             # 유지보수용이라(문서 포인터·전제 조건) 내보내지 않는다.
             **({"help": rule["_help"]} if rule.get("_help") else {})}
            for rule in ((CHAR_DEFAULTS.get(name) or {}).get("_control_rules") or [])
            if set(rule.get("when") or {}) == {"with_member"} and rule.get("control")
        ]
        char = build_squad([name])[0]
        equip = char["equip_skills"]
        favorite = (raw.get(name) or {}).get("애장품")
        characters[name] = {
            "weaponType": meta["weapon_type"],
            "recommendedControl": char.get("control") or {},
            "hasConditionalControl": bool(
                (CHAR_DEFAULTS.get(name) or {}).get("_control_rules")
            ),
            **({"conditionalControl": member_rules} if member_rules else {}),
            **({
                "favoriteItem": {
                    "name": favorite["아이템명"],
                    "stage": 3,
                },
            } if favorite else {}),
            "skillLevels": {
                key: int(value) for key, value in char["skill_levels"].items()
            },
            "skillLevelsLocked": bool(nikke[name].get("preview")),
            "growthStage": profile["default_stage"],
            "rarity": profile["rarity"],
            "maxGrowthStage": profile["max_stage"],
            "growthOptions": growth_options(name, meta),
            "overload": {key: float(equip.get(key, 0.0)) for key in OVERLOAD_FIELDS},
            "cube": char["cube"],
            # 기본 스펙은 소장품 SR15이고, 애장품이 있는 캐릭터는 3단계로 본다
            # (`context/spec.py` §기본 육성 스펙). 실제 보유는 유저가 고른다.
            "collection": {
                "stage": str(char["collection_stage"]),
                "favorite": int(char["favorite_stage"]) if favorite else 0,
            },
        }

    cubes = {}
    common_values = cube_table["공통"]["values"]
    for name in CUBE_NAMES:
        entry = cube_table[name]
        levels = {}
        for level in range(1, 16):
            key = str(level)
            stats = cube_table["_stats"][key]
            # `공통`(우월 코드)은 큐브 레벨 1~4 구간에 스킬 레벨이 없어 키가 아예 빠져
            # 있다 (cube.json `_level_note`). 그 구간은 효과가 붙지 않으므로 0이다.
            common = common_values.get(key)
            levels[key] = {
                "atk": int(stats["atk"]),
                "def": int(stats["def"]),
                "hp": int(stats["hp"]),
                "effect": float(entry["values"][key][0]),
                "commonElement": float(common[0]) if common else 0.0,
            }
        cubes[name] = {
            "label": name,
            # 게임 내부 id. 블라블라링크 응답의 `harmony_cube_tid`가 이 값이라
            # 프로필 동기화가 큐브를 알아보려면 필요하다.
            "id": int(entry["id"]),
            "stat": entry["stat"],
            "template": entry["template"],
            "levels": levels,
            # 계산기가 스킬을 아직 처리하지 못하는 큐브. 공격력·방어력·체력과 공통
            # 우월 코드 효과는 그대로 붙고, 고유 스킬만 빠진다.
            **({"unsupported": entry["unsupported"]} if entry.get("unsupported") else {}),
        }

    payload = {
        "characters": characters,
        "cubes": cubes,
        "collectionStages": list(COLLECTION_STAGES),
        # 콘솔 소속. 엔진이 빠진 소속을 에러로 끊으므로 목록의 정본을 넘긴다.
        "weaponTypes": list(WEAPON_TYPES),
        # 적정거리를 가진 무기군. 런처는 인게임에 적정 사거리가 없어 빠진다 —
        # 화면이 체크박스를 그리지 않게 목록을 그대로 내려보낸다
        # (정본: `data/weapon_mechanics.json`의 `optimal_range`).
        "optimalRangeWeapons": list(OPTIMAL_RANGE_WEAPONS),
        "buffTargetWatch": {
            caster: [{"buff": b, "label": l} for b, l in rows]
            for caster, rows in BUFF_TARGET_WATCH.items()
        },
        # 무기군별 평타 계수 기본값. 값이 없는 무기군은 1.0(보정 없음)으로 채워
        # 브라우저가 무기군 목록만 보고 입력칸을 다 그릴 수 있게 한다.
        "normalHitCoeff": {
            weapon: float(mechanics.get("normal_hit_coeff", {}).get(weapon, 1.0))
            for weapon in WEAPON_TYPES
        },
        "consoleClasses": list(CONSOLE_CLASSES),
        "consoleCompanies": list(CONSOLE_COMPANIES),
        "overloadFields": OVERLOAD_FIELDS,
        "manualStats": MANUAL_STATS,
        # 소장품 id → 등급. 블라블라링크는 `favorite_item_lv`를 R·SR에서는 강화 레벨로,
        # SSR(애장품)에서는 단계로 쓰므로 등급을 알아야 그 숫자를 읽을 수 있다.
        "favoriteItems": json.loads(
            (ROOT / "data" / "favorite_items.json").read_text(encoding="utf-8")
        ),
    }
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2, allow_nan=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
