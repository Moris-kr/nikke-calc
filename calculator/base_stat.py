"""
Phase 2: 기본 스탯 계산기

공식:
  (레벨스탯 + (레벨스탯×0.02+20) × 돌파수 + 호감도스탯 + 콘솔스탯)
  × (1 + 0.02×코강수)
  + 장비스탯 + 큐브스탯 + 소장품스탯

캐릭터 인스턴스 구조:
  {
    "name": "라피",
    "level": 200,
    "breakthrough": 3,          # 0~3
    "core_enhancement": 7,      # 0~7 (돌파 3 이후 해금)
    "affinity": 30,             # 1~40
    "equipment": {
      # tier 생략 = 오버로드 장비(강화 0~5). 일반 장비는 tier: "T1"~"T9" (강화 없음)
      # tier + corp = T9 기업 장비 — 강화 0~5가 붙고 캐릭터 기업과 같으면 +30% (§_equip_stat)
      # 미장착은 tier: "없음" — 강화0과 다르다(그쪽도 플랫 스탯이 붙는다)
      "머리": { "level": 5, "skills": [{"id": "atk_pct", "lv": 10}, ...] },
      "몸통": { "level": 5, "skills": [...] },
      "팔":   { "tier": "T9", "corp": "테트라", "level": 3, "skills": [...] },
      "다리": { "tier": "T9", "skills": [...] }
    },
    "cube": { "name": "렐릭 베어 큐브", "level": 5 },
    # class_level·company_level은 숫자(전 역할군·전 기업 동일) 또는 역할군/기업별 dict.
    # 인게임 재활용 연구실은 역할군 3개·기업 5개가 따로 크므로 dict 쪽이 실제에 가깝다.
    "console": { "common_level": 10, "class_level": 10, "company_level": 10 },
    #   또는 "console": { "common_level": 250,
    #                     "class_level":   {"화력형": 138, "방어형": 138, "지원형": 138},
    #                     "company_level": {"엘리시온": 139, ..., "어브노말": 110} }
    "collection_stage": "SR15"   # "R0"~"SR15" 또는 "없음"(미장착)
  }
"""
import json
import os

_DATA_DIR  = os.path.join(os.path.dirname(__file__), "..", "data")
_TABLE_DIR = os.path.join(_DATA_DIR, "base_stat_tables")


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ── 테이블 (모듈 임포트 시 1회 로드) ─────────────────────────────────────
_NIKKE       = _load(os.path.join(_DATA_DIR, "parsed_nikke.json"))
_LEVEL_STATS = _load(os.path.join(_TABLE_DIR, "level_stats.json"))
_AFFINITY    = _load(os.path.join(_TABLE_DIR, "affinity.json"))
_CONSOLE     = _load(os.path.join(_TABLE_DIR, "console.json"))
_EQUIP_STATS = _load(os.path.join(_TABLE_DIR, "equipment_stats.json"))
_CUBE        = _load(os.path.join(_TABLE_DIR, "cube.json"))
_COLLECTION  = _load(os.path.join(_TABLE_DIR, "collection.json"))

# 미장착 표현. 장비 `tier`와 `collection_stage`가 공유한다.
# **기업 강화0·R0과 구분해야 한다** — 그쪽은 "가장 낮은 장착 상태"라 플랫 스탯이 붙는다
# (기업 머리 강화0 = 방어형 기준 +4010 atk). 실제 계정 스펙에는 빈 슬롯이 흔하다.
NO_ITEM = "없음"


# ── 내부 유틸 ─────────────────────────────────────────────────────────────

def _zero():
    return {"atk": 0.0, "def": 0.0, "hp": 0.0}


def _add(a, b):
    return {"atk": a["atk"] + b["atk"],
            "def": a["def"] + b["def"],
            "hp":  a["hp"]  + b["hp"]}


def _scale(s, k):
    return {"atk": s["atk"] * k, "def": s["def"] * k, "hp": s["hp"] * k}


# 레벨 스탯표는 20레벨이 한 «밴드»다. 밴드 안에서는 레벨당 증가분이 일정하고,
# 밴드가 바뀌는 자리(레벨 ≡ 1 mod 20)에서 한 번 크게 뛴다. 밴드 시작값의 비율은
# 클래스·무기·스탯과 **무관하게 같다**(레벨 881→901에서 셋 다 1.069251).
#
# 표는 1000레벨까지인데 인게임은 이미 그 위다. 1000으로 눌러 버리면 싱크로가 높은
# 사람의 공격력이 15% 넘게 깎여 «누가 더 세나»가 뒤집힌다. 그래서 표 밖은
# `level_beyond.json`의 **실측 비율**로 잇고, 실측이 닿지 않는 위쪽만 그 비율로 맞춘
# 꼬리로 연장한다.
_BEYOND = _load(os.path.join(_TABLE_DIR, "level_beyond.json"))
BAND = int(_BEYOND["band"])
_BAND_RATIOS = {int(k): float(v) for k, v in _BEYOND["ratios"].items()}
# 밴드 상승분 중 «고르게 오르는 몫»의 비중. 나머지는 밴드 경계에서 한 번에 뛴다.
# 비율과 마찬가지로 레벨이 오를수록 천천히 준다(0.221 → 0.168).
_BAND_SHARES = {int(k): float(v) for k, v in _BEYOND["shares"].items()}


def _power_fit(series: dict) -> tuple:
    """`ln(y) = i + s·ln(b)`를 맞춘다 — 실측이 끝난 뒤를 잇는 꼬리."""
    import math
    points = [(math.log(b), math.log(y)) for b, y in sorted(series.items()) if y > 0]
    n = len(points)
    mx = sum(x for x, _ in points) / n
    my = sum(y for _, y in points) / n
    denom = sum((x - mx) ** 2 for x, _ in points)
    slope = sum((x - mx) * (y - my) for x, y in points) / denom
    return slope, my - slope * mx


_RATIO_TAIL = _power_fit({b: r - 1 for b, r in _BAND_RATIOS.items()})
_SHARE_TAIL = _power_fit(_BAND_SHARES)


def _tail(fit: tuple, band: int) -> float:
    import math
    slope, inter = fit
    return math.exp(inter + slope * math.log(max(band, 1)))


def band_ratio(band: int) -> float:
    """밴드 하나의 상승 비율. 실측이 있으면 실측, 없으면 그 실측으로 맞춘 꼬리."""
    if band in _BAND_RATIOS:
        return _BAND_RATIOS[band]
    return 1 + _tail(_RATIO_TAIL, band)


def band_share(band: int) -> float:
    """밴드 안에서 고르게 오르는 몫의 비중."""
    if band in _BAND_SHARES:
        return _BAND_SHARES[band]
    return _tail(_SHARE_TAIL, band)


def _beyond_table(table: dict, keys: list, level: int) -> dict:
    """표 끝 위쪽을 잇는다. 밴드 모양(고르게 오르다 한 번 뛴다)까지 그대로 흉내 낸다."""
    top = int(keys[-1])
    start_level = top - (top - 1) % BAND          # 표 마지막 밴드의 시작 레벨 (1000이면 981)
    value = {k: float(v) for k, v in table[str(start_level)].items()}
    band = (start_level - 1) // BAND
    while True:
        ratio = band_ratio(band)
        gap = {k: v * (ratio - 1) for k, v in value.items()}
        band_start = band * BAND + 1
        if band_start <= level < band_start + BAND:
            offset = level - band_start
            if offset == 0:
                return {k: round(v) for k, v in value.items()}
            share = band_share(band)
            return {k: round(value[k] + gap[k] * share * offset / (BAND - 1))
                    for k in value}
        value = {k: value[k] + gap[k] for k in value}
        band += 1


def _level_stat(cls: str, weapon: str, level: int) -> dict:
    """level_stats.json 조회. 키 없는 레벨은 인접 두 키로 선형 보간.

    표 끝(1000)을 넘는 레벨은 `_beyond_table()`이 잇는다 — **추정치다**.
    """
    table = _LEVEL_STATS[f"{cls}_{weapon}"]
    key = str(level)
    if key in table:
        return dict(table[key])

    keys   = sorted(table.keys(), key=int)
    levels = [int(k) for k in keys]
    if level <= levels[0]:
        return dict(table[keys[0]])
    if level > levels[-1]:
        return _beyond_table(table, keys, level)

    for i in range(len(levels) - 1):
        lo, hi = levels[i], levels[i + 1]
        if lo < level < hi:
            t = (level - lo) / (hi - lo)
            lo_s, hi_s = table[str(lo)], table[str(hi)]
            return {
                "atk": lo_s["atk"] + t * (hi_s["atk"] - lo_s["atk"]),
                "def": lo_s["def"] + t * (hi_s["def"] - lo_s["def"]),
                "hp":  lo_s["hp"]  + t * (hi_s["hp"]  - lo_s["hp"]),
            }


# T9 기업 장비의 배수. 인게임 식은 `기본값 × (1 + 0.3×기업일치 + 0.1×강화단계)`이고
# 두 항은 **곱이 아니라 합**이다 (blablalink 프론트 `getEquipAttr`).
# 오버로드 장비는 제조사가 없어 일치 보너스를 못 받고, 강화분은 `equipment_stats.json`의
# `기업` 표(인게임 관측)에 이미 들어 있으므로 이 상수를 쓰지 않는다.
CORP_MATCH_BONUS = 0.3
GEAR_LEVEL_BONUS = 0.1


def _equip_stat(cls: str, part: str, part_data: dict, corp: str | None = None) -> dict:
    """부위 하나의 플랫 스탯. `tier` 없으면 오버로드 장비(강화 `level` 단계)다.

    갈래 셋:
      `tier` 없음      오버로드 — `기업` 표를 `level`로 조회한다 (관측값)
      `tier` + `corp`  T9 기업 — 같은 등급의 일반 표를 기본값으로 쓰고 위 식을 곱한다.
                       `corp`(장비 제조사)가 캐릭터 기업 `corp` 인자와 같아야 +30%가 붙는다
      `tier`만         일반 T1~T9 — 강화가 없으므로 `level`을 보지 않는다
    `tier: "없음"`은 미장착 — 0이다.

    인게임은 부위마다 반올림한 뒤 합치므로 여기서도 부위 단위로 반올림한다.
    """
    tier = part_data.get("tier")
    if tier == NO_ITEM:
        return _zero()
    if tier in (None, "기업"):
        return _EQUIP_STATS["기업"][cls][part][str(part_data["level"])]
    base = _EQUIP_STATS["일반"][tier][cls][part]
    gear_corp = part_data.get("corp")
    if not gear_corp:
        return base
    mult = 1 + GEAR_LEVEL_BONUS * part_data.get("level", 0)
    if gear_corp == corp:
        mult += CORP_MATCH_BONUS
    return {k: float(round(v * mult)) for k, v in base.items()}


def console_level(console: dict, key: str, bucket: str, name: str) -> int:
    """콘솔 레벨 하나를 뽑는다. 값이 dict면 `bucket`(역할군 또는 기업)으로 고른다.

    인게임 재활용 연구실은 역할군 3개·기업 5개가 **따로** 큰다. 숫자 하나로 적으면
    전부 같다는 뜻이고, 실제로 갈렸으면 dict로 적어 소속별로 맞춘다 — 뒤처진 연구실
    소속 캐릭터가 조용히 과대평가되는 걸 막는 자리다.
    """
    val = console[key]
    if not isinstance(val, dict):
        return val
    if bucket not in val:
        raise KeyError(
            f"[{name}] console.{key}에 {bucket!r}이 없다 (있는 키: {sorted(val)}). "
            f"역할군/기업별로 적었으면 전부 적어야 한다 — 빠진 소속이 조용히 0이 되면 안 된다.")
    return val[bucket]


def collection_stat(stage: str) -> dict:
    """소장품 단계의 플랫 스탯. `"없음"`(미장착)은 0.

    SSR 애장품은 플랫 스탯·소장품 스킬 레벨이 SR15와 완전히 동일하므로 `"SR15"`로 적는다
    (CDN `favorite_{id}.json`: atk·hp·def 배열이 단계와 무관하게 SR15 값, `level1`=4).
    """
    if stage == NO_ITEM:
        return _zero()
    entry = _COLLECTION["_stat_table"].get(stage)
    if entry is None:
        raise KeyError(
            f"알 수 없는 소장품 단계 {stage!r} — 'R0'~'R15' · 'SR0'~'SR15' 또는 '없음'(미장착)")
    return {"atk": entry["atk"], "def": entry["def"], "hp": entry["hp"]}


def _core_formula(lv_val: float, bt: int) -> float:
    """레벨스탯 단일 값에 DealForm ② b 공식 적용."""
    return lv_val + (lv_val * 0.02 + 20) * bt


# ── 메인 계산 함수 ────────────────────────────────────────────────────────

def calc_base_stats(char: dict) -> dict:
    """
    캐릭터 인스턴스 → 기본 ATK / DEF / HP 반환.
    반환: {"atk": int, "def": int, "hp": int}
    """
    name       = char["name"]
    level      = char["level"]
    bt         = char["breakthrough"]
    core_enh   = char["core_enhancement"]
    affinity   = char["affinity"]
    equip_inst = char["equipment"]
    cube_inst  = char["cube"]
    console    = char["console"]
    coll_stage = char["collection_stage"]

    # 캐릭터 메타
    meta   = _NIKKE[name]
    cls    = meta["class"]
    weapon = meta["weapon_type"]

    # 레벨스탯
    lv_s = _level_stat(cls, weapon, level)

    # 코어공식 (atk/def/hp 각각)
    core = {
        "atk": _core_formula(lv_s["atk"], bt),
        "def": _core_formula(lv_s["def"], bt),
        "hp":  _core_formula(lv_s["hp"],  bt),
    }

    # 호감도 스탯
    aff_s = _AFFINITY[cls][str(affinity)]

    # 콘솔 스탯 (공통 + 역할군 + 기업). 역할군·기업은 소속별로 레벨이 다를 수 있다.
    con_s = _zero()
    for con_type, level_key, bucket in (
        ("공통",   "common_level",  ""),
        ("클래스", "class_level",   cls),
        ("기업",   "company_level", meta["manufacturer"]),
    ):
        per = _CONSOLE[con_type]["per_level"]
        con_s = _add(con_s, _scale(per, console_level(console, level_key, bucket, name)))

    # 코강 적용 전 합계 → 코강 반영
    pre_scaled = _scale(
        _add(_add(core, aff_s), con_s),
        1 + 0.02 * core_enh,
    )

    # 장비 플랫 스탯 (4부위 합산)
    equip_s = _zero()
    for part, part_data in equip_inst.items():
        equip_s = _add(equip_s, _equip_stat(cls, part, part_data, meta["manufacturer"]))

    # 큐브 플랫 스탯. 「없음」은 큐브를 아예 안 낀 상태라 스탯도 붙지 않는다
    # (미란다처럼 큐브 효과가 오히려 손해인 조합을 재려고 둔 선택지다).
    cube_s = _zero() if cube_inst.get("name") == "없음" else _CUBE["_stats"][str(cube_inst["level"])]

    # 소장품 플랫 스탯
    coll_s = collection_stat(coll_stage)

    # 최종 합산
    total = _add(_add(_add(pre_scaled, equip_s), cube_s), coll_s)
    return {"atk": round(total["atk"]),
            "def": round(total["def"]),
            "hp":  round(total["hp"])}


def hp_to_atk(hp: float, ratio: float) -> float:
    """
    HP → ATK 전환. 스킬 텍스트 '최대 HP의 N%를 공격력으로' 대응.
    ratio: 소수 (5% → 0.05)
    """
    return hp * ratio


# ── 빠른 테스트 ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")

    sample = {
        "name": "라피",
        "level": 200,
        "breakthrough": 0,
        "core_enhancement": 0,
        "affinity": 1,
        "equipment": {
            "머리": {"level": 0, "skills": []},
            "몸통": {"level": 0, "skills": []},
            "팔":   {"level": 0, "skills": []},
            "다리": {"level": 0, "skills": []},
        },
        "cube": {"name": "렐릭 베어 큐브", "level": 1},
        "console": {"common_level": 0, "class_level": 0, "company_level": 0},
        "collection_stage": "R0",
    }

    result = calc_base_stats(sample)
    print("라피 lv200 bt0 최소 조건:", result)
