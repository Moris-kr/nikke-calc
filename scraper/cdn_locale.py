"""영어·일본어·중국어 번체 이름 수집기.

계산기는 한국어로 만들어져 있고 데이터도 한국어로 파싱한다(엔진이 한국어 스킬문을
읽는다). 그런데 **화면에 뜨는 이름**까지 한국어일 이유는 없다 — 같은 CDN이 로케일별로
같은 자료를 주므로, 이름만 여러 벌 받아 두면 화면이 그 사람의 말로 부를 수 있다.

받는 것은 **이름뿐**이다. 스킬 설명문은 받지 않는다: 엔진이 읽는 것은 한국어 원문이고,
번역문을 섞어 두면 「이 계산이 어느 글을 읽고 나온 것인가」가 흐려진다.

받는 자리
---------
| 무엇        | 평문 경로                          | 쓰는 곳                     |
|-------------|-----------------------------------|-----------------------------|
| 캐릭터 이름 | `/roledata/{rid}-v2-{locale}.json` | 편성·목록·결과 어디에나     |
| 스킬 이름   | 같은 파일의 `skill1/2/ulti_detail` | 결과·타임라인의 딜 항목     |
| 큐브 이름   | `/equip/{locale}/cube_{cid}.json`  | 수치 설정의 큐브 고르개     |
| 애장품 이름 | `/equip/{locale}/favorite_{fid}.json` | 소장품 설명            |

내는 것: `data/locale_text.json`
```json
{"characters": {"라피 : 레드 후드": {"en": "Rapi: Red Hood", "ja": "ラピ：レッドフード", "zh-TW": "拉毗：小紅帽"}}, …}
```
한국어를 열쇠로 삼는 이유는 **우리 데이터의 정본이 한국어**이기 때문이다. 새 캐릭터가
들어와도 이 표에 없으면 화면은 한국어 이름을 그대로 쓴다 — 비어 있는 칸이 사고가
되지 않는다.

사용
----
```
python scraper/cdn_locale.py              # 전량 수집 → data/locale_text.json
python scraper/cdn_locale.py --check      # 무엇이 달라지는지만 보고 쓰지 않는다
```
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from cdn_path import CDN_BASE, obfuscate  # noqa: E402

# 다른 수집기(`cdn_fetch.py`)와 달리 표준 라이브러리만 쓴다 — 이름 한 벌 받자고
# 남의 기계에 의존 하나를 더 얹지 않으려는 것이다. 받을 것이 수백 개뿐이라
# 스레드 몇 개로 충분하다.

ROOT = Path(__file__).parent.parent
OUT_PATH = ROOT / "data" / "locale_text.json"

#: 한국어 말고 더 받을 말. 화면의 언어 고르개와 같은 이름을 쓴다.
LOCALES = ("en", "ja", "zh-TW")

#: JSON·화면 코드 → CDN 경로 코드. 번체만 하이픈 대소문자가 다르다.
CDN_LOCALE = {"ko": "ko", "en": "en", "ja": "ja", "zh-TW": "zh-tw"}

ROLEDATA_PATH = "/roledata/{rid}-v2-{locale}.json"
CUBE_MAP_PATH = "/equip/cube_rare_map.json"
CUBE_PATH = "/equip/{locale}/cube_{cid}.json"
FAVORITE_RARE_MAP_PATH = "/equip/favorite_rare_map.json"
FAVORITE_PATH = "/equip/{locale}/favorite_{fid}.json"


def cdn_locale(locale: str) -> str:
    return CDN_LOCALE[locale]

CONCURRENCY = 16


def fetch_json(path: str) -> dict:
    with urllib.request.urlopen(f"{CDN_BASE}/{obfuscate(path)}", timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def skill_names(role: dict) -> list[str]:
    """이 캐릭터의 스킬 이름 셋(스킬1·스킬2·버스트)."""
    out = []
    for key in ("skill1_detail", "skill2_detail", "ulti_skill_detail"):
        name = (role.get(key) or {}).get("name_localkey")
        if name:
            out.append(str(name))
    return out


def collect_roles(ids: list[int], locales: tuple[str, ...] = LOCALES) -> tuple[dict, dict]:
    """캐릭터 이름과 스킬 이름을 로케일별로 모은다."""
    characters: dict[str, dict[str, str]] = {}
    skills: dict[str, dict[str, str]] = {}

    def one(rid: int) -> None:
        try:
            pack = {
                locale: fetch_json(ROLEDATA_PATH.format(rid=rid, locale=cdn_locale(locale)))
                for locale in ("ko", *locales)
            }
        except (urllib.error.HTTPError, urllib.error.URLError):
            return
        korean = pack["ko"]
        ko_name = str(korean.get("name_localkey") or "").strip()
        if ko_name:
            characters.setdefault(ko_name, {}).update(
                {locale: str(pack[locale].get("name_localkey") or "") for locale in locales}
            )
        # 스킬은 «같은 자리»끼리 짝짓는다 — 이름으로 맞추면 번역문에서 짝을 잃는다.
        ko_skills = skill_names(korean)
        for locale in locales:
            other = skill_names(pack[locale])
            if len(other) != len(ko_skills):
                continue
            for ko_skill, translated in zip(ko_skills, other):
                if ko_skill and translated:
                    skills.setdefault(ko_skill, {})[locale] = translated

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        list(pool.map(one, ids))
    return characters, skills


def collect_equip(locales: tuple[str, ...] = LOCALES) -> tuple[dict, dict]:
    """큐브·애장품 이름."""
    cubes: dict[str, dict[str, str]] = {}
    favorites: dict[str, dict[str, str]] = {}

    cube_map = fetch_json(CUBE_MAP_PATH)
    for entry in cube_map:
        cid = entry["id"]
        try:
            pack = {
                locale: fetch_json(CUBE_PATH.format(locale=cdn_locale(locale), cid=cid))
                for locale in ("ko", *locales)
            }
        except (urllib.error.HTTPError, urllib.error.URLError):
            continue
        ko_name = str(pack["ko"].get("name_localkey") or "").strip()
        if ko_name:
            cubes.setdefault(ko_name, {}).update(
                {locale: str(pack[locale].get("name_localkey") or "") for locale in locales}
            )

    fav_map = fetch_json(FAVORITE_RARE_MAP_PATH)
    ids = [fid for grade in ("R", "SR") for fid in (fav_map.get(grade) or [])]

    def one(fid) -> None:
        try:
            pack = {
                locale: fetch_json(FAVORITE_PATH.format(locale=cdn_locale(locale), fid=fid))
                for locale in ("ko", *locales)
            }
        except (urllib.error.HTTPError, urllib.error.URLError):
            return
        ko_name = str(pack["ko"].get("name_localkey") or "").strip()
        if ko_name:
            favorites.setdefault(ko_name, {}).update(
                {locale: str(pack[locale].get("name_localkey") or "") for locale in locales}
            )

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        list(pool.map(one, ids))
    return cubes, favorites


def role_ids() -> list[int]:
    """수집 대상. 우리가 이미 가진 카탈로그의 `resource_id`를 그대로 쓴다."""
    catalog = json.loads((ROOT / "site" / "public" / "catalog.json").read_text("utf-8"))
    return sorted({int(row["resourceId"]) for row in catalog if row.get("resourceId")})


def existing() -> dict:
    if not OUT_PATH.exists():
        return {}
    return json.loads(OUT_PATH.read_text("utf-8"))


def merge_group(old: dict, new: dict) -> dict:
    """로케일 값을 덮어쓰되, 받아 오지 못한 칸은 예전 값을 지킨다."""
    out: dict[str, dict[str, str]] = {}
    for name in sorted(set(old) | set(new)):
        entry = dict(old.get(name) or {})
        for locale, value in (new.get(name) or {}).items():
            if value:
                entry[locale] = value
        out[name] = entry
    return out


def run(check: bool, locales: tuple[str, ...] = LOCALES) -> int:
    ids = role_ids()
    characters, skills = collect_roles(ids, locales)
    cubes, favorites = collect_equip(locales)
    old = existing()

    fresh = {
        "_comment": "영어·일본어·중국어 번체 이름. `scraper/cdn_locale.py`가 CDN에서 받아 적는다.",
        "_locales": list(LOCALES),
        "characters": merge_group(old.get("characters") or {}, characters),
        "skills": merge_group(old.get("skills") or {}, skills),
        "cubes": merge_group(old.get("cubes") or {}, cubes),
        "favorites": merge_group(old.get("favorites") or {}, favorites),
    }
    counts = " · ".join(
        f"{key} {len(fresh[key])}" for key in ("characters", "skills", "cubes", "favorites")
    )
    if check:
        old = json.loads(OUT_PATH.read_text("utf-8")) if OUT_PATH.exists() else {}
        added = {
            key: sorted(set(fresh[key]) - set(old.get(key) or {}))
            for key in ("characters", "skills", "cubes", "favorites")
        }
        print(f"수집: {counts}")
        for key, names in added.items():
            if names:
                print(f"  새로 생긴 {key} {len(names)}개: {', '.join(names[:8])}")
        return 0

    OUT_PATH.write_text(
        json.dumps(fresh, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"{OUT_PATH.relative_to(ROOT)} · {counts}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="영어·일본어·중국어 번체 이름 수집")
    parser.add_argument("--check", action="store_true", help="무엇이 달라지는지만 본다")
    parser.add_argument(
        "--only",
        metavar="LOCALE",
        action="append",
        choices=list(LOCALES),
        help="이 말만 받아 기존 표에 덧붙인다. 여러 번 쓸 수 있다.",
    )
    args = parser.parse_args()
    locales = tuple(args.only) if args.only else LOCALES
    return run(args.check, locales)


if __name__ == "__main__":
    raise SystemExit(main())
