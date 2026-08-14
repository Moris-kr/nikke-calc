"""Emit browser settings metadata derived from Python canonical data."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from calculator.customization import CUBE_NAMES, MANUAL_STATS, OVERLOAD_FIELDS  # noqa: E402
from context.growth import growth_options, growth_profile  # noqa: E402
from context.spec import build_squad  # noqa: E402


def main() -> None:
    nikke = json.loads((ROOT / "data" / "parsed_nikke.json").read_text(encoding="utf-8"))
    skills = json.loads((ROOT / "data" / "parsed_skills.json").read_text(encoding="utf-8"))
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
        char = build_squad([name])[0]
        equip = char["equip_skills"]
        characters[name] = {
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
        }

    cubes = {}
    for name in CUBE_NAMES:
        entry = cube_table[name]
        levels = {}
        for level in range(1, 16):
            key = str(level)
            stats = cube_table["_stats"][key]
            levels[key] = {
                "atk": int(stats["atk"]),
                "def": int(stats["def"]),
                "hp": int(stats["hp"]),
                "effect": float(entry["values"][key][0]),
                "commonElement": float(cube_table["공통"]["values"][key][0]),
            }
        cubes[name] = {
            "label": name,
            "stat": entry["stat"],
            "template": entry["template"],
            "levels": levels,
        }

    payload = {
        "characters": characters,
        "cubes": cubes,
        "overloadFields": OVERLOAD_FIELDS,
        "manualStats": MANUAL_STATS,
    }
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2, allow_nan=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
