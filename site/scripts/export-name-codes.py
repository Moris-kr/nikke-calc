"""blablalink name_code → 우리 캐릭터명 표를 만든다 (site/public/nikke-name-codes.json).

북마클릿이 CDN 난독화 경로를 재현하지 않아도 되도록 **빌드 때 미리 구워 둔다**.
blablalink 응답은 캐릭터를 `name_code`로만 주므로, 이 표가 없으면 누가 누군지 모른다.

경로: name_code → resource_id (CDN character_id_map.json) → 우리 캐릭명 (nikke_scraped.json)
계산기가 지원하는 캐릭터만 남긴다 — 나머지는 어차피 시뮬에 넣을 수 없다.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
import cdn_path  # noqa: E402


def main() -> None:
    req = urllib.request.Request(
        cdn_path.url("/character/character_id_map.json"),
        headers={"User-Agent": "Mozilla/5.0"},
    )
    rows = json.load(urllib.request.urlopen(req, timeout=30))

    scraped = json.loads((ROOT / "scraper" / "nikke_scraped.json").read_text(encoding="utf-8"))
    res_name = {v["id"]: n for n, v in scraped.items()
                if isinstance(v, dict) and "id" in v}
    supported = set(json.loads(
        (ROOT / "data" / "parsed_skills.json").read_text(encoding="utf-8")
    ))

    out: dict[str, str] = {}
    for row in rows:
        name = res_name.get(row.get("resource_id"))
        if name and name in supported and not name.startswith("test_"):
            out.setdefault(str(row["name_code"]), name)

    target = ROOT / "site" / "public" / "nikke-name-codes.json"
    target.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"name_code 표 {len(out)}개 → {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
