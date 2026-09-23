"""고속 엔진 대조용 요청 묶음을 만든다 → corpus.json.

    python site/scripts/parity/make_corpus.py

- 골든 편성 29개(context/snapshot.py SQUADS의 멤버)를 사이트 요청 모양으로.
- 전체 니케를 섞어 다섯씩 묶은 편성(모든 니케가 한 번 이상 들어간다).
- 그 일부에 전투 조건·육성 변형을 얹는다(족자·속성 저지·코어·방어력·적정거리·난수·구 방식 게이지·
  사격 트랙·정밀 타임라인·스킬 레벨·오버로드·돌파·싱크로·첫 버스트·파츠).
"""
from __future__ import annotations

import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)

from context import snapshot  # noqa: E402


def base(squad, **extra):
    req = {"squad": list(squad), "duration": 60, "enemyDef": 0, "enemyCode": "", "corePx": 0,
           "hasParts": False, "seed": 42, "rngMode": "expected"}
    req.update(extra)
    return req


def main() -> None:
    corpus: list[dict] = []
    # 1) 골든 편성
    for name, info in snapshot.SQUADS.items():
        corpus.append({"id": f"golden:{name}", "request": base(info["members"])})

    # 2) 전원 덮기
    nikke = json.load(open(os.path.join(ROOT, "data", "parsed_nikke.json"), encoding="utf-8"))
    names = sorted(nikke)
    rng = random.Random(7)
    rng.shuffle(names)
    groups = [names[i:i + 5] for i in range(0, len(names), 5)]
    for i, group in enumerate(groups):
        corpus.append({"id": f"cover:{i}", "request": base(group)})

    # 3) 변형 — 덮기 편성 앞쪽에 하나씩 얹는다
    variants = [
        ("rng", {"rngMode": "random", "seed": 1234}),
        ("immune", {"immuneWindows": [{"from": 10, "to": 16}], "immuneBlocksBurst": True}),
        ("element", {"enemyCode": "수냉", "elementWindows": [{"from": 20, "to": 30, "code": "수냉"}]}),
        ("core", {"corePx": 40, "coreWindows": [{"from": 0, "to": 25}]}),
        ("def", {"enemyDef": 6000, "defenseRateWindows": [{"from": 5, "to": 40, "rate": 60}]}),
        ("optimal", {"optimalRangeWeapons": ["AR", "SMG"], "optimalRangeWindows": [{"from": 0, "to": 30, "weapons": ["SR"]}]}),
        ("legacy_gauge", {"burstGaugeMode": "legacy", "burstRegenTime": 5, "firstBurstTime": 3}),
        ("shot_track", {"shotTrack": True}),
        ("state_track", {"stateTrack": True}),
        ("fine", {"fineTimeline": True}),
        ("first0", {"firstBurstTime": 0, "burstReaction": 0.2}),
        ("synchro", {"synchroLevel": 300}),
        ("parts", {"hasParts": True, "partBreakInterval": 12}),
        ("element_code", {"enemyCode": "작열"}),
    ]
    for i, (vname, extra) in enumerate(variants):
        group = groups[i % len(groups)]
        corpus.append({"id": f"variant:{vname}", "request": base(group, **extra)})

    # 4) 육성 변형
    for i, group in enumerate(groups[:6]):
        chars = {}
        for j, n in enumerate(group):
            chars[n] = [
                {"skillLevels": {"1": 4, "2": 7, "3": 10}},
                {"overload": {"atk_pct": 20.0, "element_bonus": 30.5, "crit_rate": 5.0}},
                {"growthStage": 3},
                {"skillLevels": {"1": 1, "2": 1, "3": 1}},
                {"overload": {"max_ammo_pct": 40.0, "charge_speed_pct": 6.0}},
            ][j % 5]
        corpus.append({"id": f"growth:{i}", "request": base(group, characters=chars)})

    # 5) 긴 전투 몇 개
    for i, name in enumerate(list(snapshot.SQUADS)[:3]):
        corpus.append({"id": f"long:{name}", "request": base(snapshot.SQUADS[name]["members"], duration=180)})

    out = os.path.join(HERE, "corpus.json")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(corpus, f, ensure_ascii=False, indent=1)
    print(f"{len(corpus)} requests -> {out}")


if __name__ == "__main__":
    main()
