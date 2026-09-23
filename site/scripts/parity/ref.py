"""파이썬 엔진의 기준 답 — corpus.json의 요청마다 run_request 응답과 히트 목록을 ref/에 저장한다.

사이트의 파이썬 엔진은 Pyodide(CPython 3.12)에서 돈다. 실수 합산(sum)이 3.12부터 달라졌으므로
기준 답도 3.12로 만든다:

    uv run --python 3.12 --no-project python site/scripts/parity/ref.py [id 접두사…]
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "site", "pybridge"))

import bridge  # noqa: E402

_captured: dict = {}
_orig_simulate = bridge.simulate


def _capture(*args, **kwargs):
    result = _orig_simulate(*args, **kwargs)
    _captured["result"] = result
    return result


bridge.simulate = _capture


def safe(name: str) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣_.-]+", "_", name)


def main() -> None:
    if sys.version_info[:2] != (3, 12):
        print(f"경고: 파이썬 {sys.version.split()[0]} — 사이트(Pyodide)는 3.12다. 합산 결과가 다를 수 있다.")
    corpus = json.load(open(os.path.join(HERE, "corpus.json"), encoding="utf-8"))
    prefixes = sys.argv[1:]
    out_dir = os.path.join(HERE, "ref")
    os.makedirs(out_dir, exist_ok=True)
    total_ms = 0.0
    for case in corpus:
        if prefixes and not any(case["id"].startswith(p) for p in prefixes):
            continue
        _captured.clear()
        t0 = time.perf_counter()
        record: dict = {"id": case["id"]}
        try:
            record["response"] = json.loads(bridge.run_request(json.dumps(case["request"], ensure_ascii=False)))
        except Exception as e:  # noqa: BLE001 — 오류 메시지도 대조한다
            record["error"] = f"{type(e).__name__}: {e}"
        ms = (time.perf_counter() - t0) * 1000
        total_ms += ms
        record["ms"] = round(ms, 1)
        res = _captured.get("result")
        if res is not None:
            record["hits"] = [[h.t, h.caster, h.damage, h.skill_name, h.hit_tag, bool(h.is_crit)] for h in res.hits]
        with open(os.path.join(out_dir, safe(case["id"]) + ".json"), "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False)
        status = "ERR " + record["error"][:60] if "error" in record else f"{len(record.get('hits', []))} hits"
        print(f"{case['id']:<34} {ms:8.0f} ms  {status}", flush=True)
    print(f"total {total_ms / 1000:.1f} s")


if __name__ == "__main__":
    main()
