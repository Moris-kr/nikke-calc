"""블라블라링크 API가 쓰는 id → 우리 용어 사전을 CDN에서 받아 커밋 데이터로 굳힌다.

프로필 동기화 응답은 캐릭터를 `name_code`(5001 …)로, 소장품을 `favorite_item_tid`
(100602 …)로 부른다. 브라우저가 그걸 우리 캐릭명·소장품 등급에 붙이려면 사전이 필요한데,
CDN은 경로가 난독화돼 있어(`cdn_path.py`) 브라우저에서 직접 부를 수 없다. 그래서 여기서
한 번 굳힌다.

출력(커밋 대상):
    data/name_codes.json      {name_code: 우리 캐릭명}
    data/favorite_items.json  {소장품 id: "R"|"SR"|"SSR"}

사용법:
    python scraper/blabla_ids_fetch.py

새 캐릭터가 나오면 `parse_nikke.py`로 `nikke_scraped.json`을 갱신한 뒤 이걸 돌린다.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import cdn_path  # noqa: E402

ID_MAP_PATH = "/character/character_id_map.json"
FAVORITE_RARE_PATH = "/equip/favorite_rare_map.json"
DATA = os.path.join(ROOT, "data")


def _cdn_json(path: str):
    req = urllib.request.Request(cdn_path.url(path), headers={"User-Agent": "Mozilla/5.0"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))


def _write(filename: str, payload: dict) -> None:
    with open(os.path.join(DATA, filename), "w", encoding="utf-8", newline="\n") as fp:
        json.dump(payload, fp, ensure_ascii=False, indent=2, sort_keys=False)
        fp.write("\n")


def _name_codes() -> dict[str, str]:
    """`character_id_map.json`은 돌파·코강 단계마다 한 줄씩 낸다(1900줄 남짓).

    같은 resource_id의 첫 줄만 쓰면 캐릭터당 하나로 접힌다 — 우리가 필요한 건 "이 코드가
    누구냐"뿐이고, 단계는 API 응답의 `grade`·`core`가 따로 준다.
    """
    scraped = json.load(open(os.path.join(HERE, "nikke_scraped.json"), encoding="utf-8"))
    by_resource = {v["id"]: name for name, v in scraped.items()
                   if isinstance(v, dict) and "id" in v}

    mapping: dict[str, str] = {}
    unknown: set[int] = set()
    for row in _cdn_json(ID_MAP_PATH):
        name = by_resource.get(row["resource_id"])
        if name is None:
            unknown.add(row["resource_id"])
            continue
        mapping.setdefault(str(row["name_code"]), name)
    if unknown:
        print(f"[!] 이름을 모르는 resource_id {len(unknown)}개 — nikke_scraped.json이 "
              f"오래됐을 수 있다: {sorted(unknown)[:10]}")
    return {code: mapping[code] for code in sorted(mapping, key=int)}


def _favorite_items() -> dict[str, str]:
    """소장품 슬롯 하나를 소장품(R·SR)과 애장품(SSR)이 공유한다.

    등급만 있으면 충분하다 — 응답의 `favorite_item_lv`가 R·SR에서는 강화 레벨(0~15)이고
    SSR에서는 애장품 단계(0~2)라, 등급을 알아야 그 숫자를 어느 쪽으로 읽을지 정해진다.
    """
    rare = _cdn_json(FAVORITE_RARE_PATH)
    out: dict[str, str] = {}
    for grade in ("R", "SR", "SSR"):
        for item_id in rare.get(grade, []):
            out[str(item_id)] = grade
    return {key: out[key] for key in sorted(out, key=int)}


def main() -> None:
    codes = _name_codes()
    _write("name_codes.json", codes)
    print(f"[+] name_code {len(codes)}개 → data/name_codes.json")

    favorites = _favorite_items()
    _write("favorite_items.json", favorites)
    print(f"[+] 소장품 {len(favorites)}개 → data/favorite_items.json")


if __name__ == "__main__":
    main()
