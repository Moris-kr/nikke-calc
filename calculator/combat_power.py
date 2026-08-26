"""인게임 전투력(투력) 계산.

    전투력 = (① + ② + ③) × ④ / 100
      ① 0.7  × 체력
      ② 19.35 × 공격력
      ③ 70   × 방어력
      ④ 1.3 + 0.01×1스킬 + 0.01×2스킬 + 0.02×버스트
          + 0.00828×(우코 오버로드 단계합)
          + 0.0069 ×(비우코 오버로드 단계합)
          + 0.0092 ×(큐브 계수)
          + 0.0069 ×(소장품 계수)

**딜 계산과는 무관하다.** 전투력은 인게임 표기값을 재현하는 별도 지표이고, 목록을
정렬하는 데만 쓴다 — `damage.py`의 DealForm과 섞이지 않게 파일을 나눠 둔다.

유저가 준 공식·예시로 검산했다(`test_combat_power.py`): 예시 스펙에서 71,725.34가
나오고 인게임 실측 71,727과 0.0023% 차이다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from calculator.base_stat import calc_base_stats

_ROOT = Path(__file__).resolve().parent.parent


def _table(name: str) -> dict:
    return json.loads(
        (_ROOT / "data" / "base_stat_tables" / name).read_text(encoding="utf-8"))


_EQUIP_SKILLS = _table("equipment_skills.json")
_CUBE = _table("cube.json")

# 오버로드에서 «우월 코드» 옵션은 이것 하나다. 나머지는 전부 비우코로 친다.
ELEMENT_OPTION = "element_bonus"


def _stage_steps(option: str) -> tuple[float, float]:
    """단계표의 (1단계 값, 단계당 증가폭). 표가 등차라서 이 둘이면 충분하다."""
    values = [v * 100 for v in _EQUIP_SKILLS[option]["values"]]
    return values[0], (values[-1] - values[0]) / (len(values) - 1)


def stage_sum(option: str, total_pct: float) -> int:
    """옵션 합계 퍼센트 → **단계 합**.

    우리는 오버로드를 옵션별 «합계 퍼센트» 하나로만 들고 있어 개별 단계를 모른다.
    그런데 단계표가 등차수열이라

        합계 = n×(base − step) + (단계합)×step

    이고, n(옵션 개수)과 단계합이 둘 다 정수·범위 제한을 받으므로 실제 값에서는
    답이 하나로 떨어진다. 전투력에 필요한 것도 개별 단계가 아니라 **합**이라
    이 역산으로 충분하다.

    풀리지 않으면 0을 준다 — 손으로 넣은 값이 단계 조합으로 만들 수 없는 수일 때다.
    """
    if total_pct <= 0:
        return 0
    base, step = _stage_steps(option)
    for count in range(1, 13):          # 오버로드는 4부위 × 3옵션 = 최대 12개
        raw = (total_pct - count * (base - step)) / step
        rounded = round(raw)
        if count <= rounded <= 15 * count and abs(raw - rounded) < 0.03:
            return rounded
    return 0


def _cube_skill_levels(level: int) -> tuple[int, int]:
    """큐브 레벨 → (고유 스킬 레벨, 공통 스킬 레벨).

    `cube.json`의 레벨별 값이 계단식이라, 계단 번호가 곧 스킬 레벨이다.
    표에서 직접 읽으므로 게임이 값을 고쳐도 따라간다.
    """
    def steps(entry: dict) -> dict[int, int]:
        seen: dict[str, int] = {}
        out: dict[int, int] = {}
        for key in sorted(entry["values"], key=int):
            value = entry["values"][key][0]
            seen.setdefault(value, len(seen) + 1)
            out[int(key)] = seen[value]
        return out

    # 고유 스킬의 계단은 큐브 종류와 무관하게 같다 — 아무거나 하나로 읽는다.
    own = next(v for k, v in _CUBE.items() if not k.startswith("_") and k != "공통")
    first = steps(own).get(level, 0)
    second = steps(_CUBE["공통"]).get(level, 0)
    return first, second


def cube_coeff(cube: dict[str, Any] | None) -> float:
    """큐브 계수. 4레벨 이하 = 1스킬 + 1, 5레벨 이상 = 1스킬 + 2스킬 + 4."""
    if not cube:
        return 0.0
    level = int(cube.get("level") or 0)
    if level <= 0:
        return 0.0
    first, second = _cube_skill_levels(level)
    return (first + 1) if level <= 4 else (first + second + 4)


def collection_coeff(stage: str | None) -> float:
    """소장품 계수. R = 1스킬 + 6.33, SR = 1스킬 + 2스킬 + 10.66.

    소장품 스킬 레벨은 소장품 레벨과 같다(`collection.json` §배열 인덱스 = skill_lv − 1).
    """
    if not stage or stage == "없음":
        return 0.0
    grade = "SR" if stage.upper().startswith("SR") else "R"
    digits = "".join(ch for ch in stage if ch.isdigit())
    level = int(digits) if digits else 0
    if level <= 0:
        return 0.0
    return (level + 6.33) if grade == "R" else (level * 2 + 10.66)


def combat_power(char: dict[str, Any]) -> float:
    """캐릭터 인스턴스(`context.spec` 형식) → 인게임 전투력."""
    stats = calc_base_stats(char)
    base = 0.7 * stats["hp"] + 19.35 * stats["atk"] + 70 * stats["def"]

    skills = char.get("skill_levels") or {}
    over = char.get("equip_skills") or {}
    element = stage_sum(ELEMENT_OPTION, float(over.get(ELEMENT_OPTION, 0) or 0))
    other = sum(
        stage_sum(option, float(value or 0))
        for option, value in over.items()
        if option != ELEMENT_OPTION and option in _EQUIP_SKILLS
    )

    mult = (
        1.3
        + 0.01 * int(skills.get("1", 0) or 0)
        + 0.01 * int(skills.get("2", 0) or 0)
        + 0.02 * int(skills.get("3", 0) or 0)
        + 0.00828 * element
        + 0.0069 * other
        + 0.0092 * cube_coeff(char.get("cube"))
        + 0.0069 * collection_coeff(char.get("collection_stage"))
    )
    return base * mult / 100
