"""전투력·육성 비교·추천·편성 정책의 기준 답 — 파이썬 3.12로 돌려 ref/extra/extra.json에 저장한다.

    uv run --python 3.12 --no-project python site/scripts/parity/extra_ref.py
    cd site && PARITY=1 npx vitest run scripts/parity/extra.parity.test.ts

요청(케이스)도 여기서 만든다 — TS 쪽은 ref/extra/extra.json의 케이스를 **같은 순서로** 돌려 비교한다
(커스텀 니케 주입이 엔진 전역에 남으므로 순서가 결과에 실린다).
"""
from __future__ import annotations

import json
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "site", "pybridge"))

import bridge  # noqa: E402
import growth_comparison  # noqa: E402
import recommendation  # noqa: E402
from nikke_mcp import squad_policy  # noqa: E402
from calculator import customization as cz  # noqa: E402
from context import snapshot  # noqa: E402
from context.growth import growth_profile  # noqa: E402

NIKKE = json.load(open(os.path.join(ROOT, "data", "parsed_nikke.json"), encoding="utf-8"))
SKILLS = json.load(open(os.path.join(ROOT, "data", "parsed_skills.json"), encoding="utf-8"))
EQUIP_SKILLS = json.load(open(os.path.join(ROOT, "data", "base_stat_tables", "equipment_skills.json"), encoding="utf-8"))
NAMES = sorted(n for n in NIKKE if not n.startswith("test_"))


def overload_total(rng: random.Random, option: str) -> float:
    values = EQUIP_SKILLS[option]["values"]
    lines = rng.randint(1, 4)
    return round(sum(values[rng.randint(1, 15) - 1] * 100 for _ in range(lines)), 2)


def rand_console(rng: random.Random) -> dict:
    out = {}
    for key, meta in cz.CONSOLE_FIELDS.items():
        if meta["buckets"]:
            out[key] = {b: rng.randint(0, 400) for b in meta["buckets"]}
        else:
            out[key] = rng.randint(0, 400)
    return out


def rand_growth(rng: random.Random, name: str, full: bool = False) -> dict:
    over: dict = {}
    if full or rng.random() < 0.6:
        over["skillLevels"] = {k: rng.randint(1, 10) for k in ("1", "2", "3")}
    if full or rng.random() < 0.6:
        opts = rng.sample(list(cz.OVERLOAD_FIELDS), rng.randint(1, 4))
        over["overload"] = {o: (overload_total(rng, o) if rng.random() < 0.8 else round(rng.uniform(0, 60), 2)) for o in opts}
    if full or rng.random() < 0.5:
        over["cube"] = rng.choice([{"name": "없음", "level": 0}] + [{"name": c, "level": rng.randint(1, 15)} for c in cz.CUBE_NAMES[:6]])
    if full or rng.random() < 0.5:
        fav = rng.choice([0, 0, 1, 2, 3]) if NIKKE[name].get("favorite_slots") else 0
        over["collection"] = {"stage": rng.choice(cz.COLLECTION_STAGES), "favorite": fav}
    if full or rng.random() < 0.5:
        over["equipLevels"] = {p: rng.choice([0, 1, 2, 3, 4, 5, "T9", "없음", "T5"]) for p in cz.EQUIP_PARTS}
    if full or rng.random() < 0.4:
        over["growthStage"] = rng.randint(0, growth_profile(name, NIKKE[name])["max_stage"])
    if rng.random() < 0.15:
        over["manualStats"] = {"atk_pct": 10}
    return over


def custom_characters() -> dict:
    return {
        "커스텀 크라운": {"nikke": dict(NIKKE["크라운"]), "skills": SKILLS["크라운"]},
        "커스텀 5": {"nikke": {**NIKKE["리틀 머메이드"], "burst_stage": 1}, "skills": SKILLS["리틀 머메이드"]},
    }


def combat_power_cases() -> list[dict]:
    rng = random.Random(11)
    cases = [{"id": "cp:all-default", "payload": {"names": sorted(NIKKE)}},
             {"id": "cp:all-characters-empty", "payload": {"characters": {n: {} for n in sorted(NIKKE)}}}]
    for i in range(20):
        names = rng.sample(NAMES, 8)
        payload: dict = {"names": names, "characters": {n: rand_growth(rng, n) for n in names[:6]}}
        if i % 3 == 0:
            payload["console"] = rand_console(rng)
        if i % 4 == 1:
            payload["synchroLevel"] = rng.choice([1, 200, 400, 700, 1000, 1161, 1400])
        if i % 5 == 2:
            payload["customCharacters"] = custom_characters()
            payload["names"] = names + ["커스텀 크라운", "커스텀 5"]
            payload["characters"]["커스텀 크라운"] = {"skillLevels": {"1": 3, "2": 4, "3": 5}}
        if i % 7 == 3:
            payload.pop("names")          # 이름은 characters 키에서
        cases.append({"id": f"cp:vary{i}", "payload": payload})
    # 오류·경계
    cases += [
        {"id": "cp:bad-override", "payload": {"names": ["크라운"], "characters": {"크라운": {"overloadLines": {}}}}},
        {"id": "cp:bad-skill", "payload": {"names": ["크라운"], "characters": {"크라운": {"skillLevels": {"1": 11}}}}},
        {"id": "cp:bad-console", "payload": {"names": ["크라운"], "console": {"nope": 1}}},
        {"id": "cp:bad-synchro", "payload": {"names": ["크라운"], "synchroLevel": 99999}},
        {"id": "cp:unknown-name", "payload": {"names": ["없는 니케", "크라운"]}},
        {"id": "cp:empty", "payload": {}},
        {"id": "cp:odd-overload", "payload": {"names": ["크라운", "토브"], "characters": {
            "크라운": {"overload": {"element_bonus": 12.3456, "atk_pct": 0.5, "crit_rate": 99}},
            "토브": {"overload": {"max_ammo_pct": 9999, "def_pct": 0}}}}},
        {"id": "cp:bad-custom", "payload": {"names": ["크라운"], "customCharacters": {"x": {"nikke": {}}}}},
    ]
    return cases


def growth_cases() -> list[dict]:
    rng = random.Random(23)
    cases = []
    for i in range(10):
        name = rng.choice(NAMES)
        baseline = rand_growth(rng, name, full=(i % 2 == 0))
        if not baseline:
            baseline = {"skillLevels": {"1": 5, "2": 5, "3": 5}}
        scenarios = []
        for j in range(rng.randint(2, 5)):
            changes = rand_growth(rng, name) or {"skillLevels": {"1": 10}}
            scenarios.append({"label": f"안 {j + 1}", "changes": changes})
        payload: dict = {"name": name, "baseline": baseline, "scenarios": scenarios}
        if i % 3 == 0:
            payload["synchroLevel"] = rng.choice([300, 800, 1161])
        if i % 4 == 1:
            payload["console"] = rand_console(rng)
        cases.append({"id": f"growth:{i}", "payload": payload})
    base = {"name": "크라운", "baseline": {"skillLevels": {"1": 4, "2": 4, "3": 4}},
            "scenarios": [{"label": "a", "changes": {"skillLevels": {"1": 10}}}]}
    errors = {
        "no-baseline": {**base, "baseline": None},
        "empty-baseline": {**base, "baseline": {}},
        "no-scenarios": {**base, "scenarios": []},
        "too-many": {**base, "scenarios": base["scenarios"] * 13},
        "scenarios-not-list": {**base, "scenarios": {"a": 1}},
        "no-changes": {**base, "scenarios": [{"label": "a"}]},
        "empty-changes": {**base, "scenarios": [{"label": "a", "changes": {}}]},
        "no-label": {**base, "scenarios": [{"changes": {"skillLevels": {"1": 9}}}]},
        "scenario-str": {**base, "scenarios": ["x"]},
        "bad-section": {**base, "scenarios": [{"label": "a", "changes": {"overloadLines": {}}}]},
        "unknown-name": {**base, "name": "없는 니케"},
        "no-name": {k: v for k, v in base.items() if k != "name"},
        "bad-synchro": {**base, "synchroLevel": -1},
        "zero-cube": {**base, "scenarios": [{"label": "c", "changes": {"cube": {"name": "없음", "level": 0}}},
                                              {"label": "d", "changes": {"cube": {"name": "렐릭 어설트 큐브", "level": 15}}}]},
    }
    cases += [{"id": f"growth-err:{k}", "payload": v} for k, v in errors.items()]
    cases.append({"id": "growth-err:list-payload", "payload": [1, 2]})
    return cases


def policy_cases() -> list[dict]:
    rng = random.Random(31)
    cases = []
    for name, info in snapshot.SQUADS.items():
        cases.append({"id": f"policy:golden:{name}", "fn": "inspect", "args": {"squad": info["members"]}})
    shuffled = NAMES[:]
    rng.shuffle(shuffled)
    for i in range(0, len(shuffled) - 4, 5):
        cases.append({"id": f"policy:cover:{i // 5}", "fn": "inspect", "args": {"squad": shuffled[i:i + 5]}})
    for i in range(30):
        squad = rng.sample(NAMES, 5)
        chars = {n: rand_growth(rng, n) for n in squad if rng.random() < 0.6}
        for n in squad:
            if rng.random() < 0.15:
                chars.setdefault(n, {})["burst"] = {"mode": "skip"}
        args = {"squad": squad, "characters": chars,
                "purpose": rng.choice(["recommendation", "user_fixed"]), "allow_no_cdr": rng.random() < 0.5}
        cases.append({"id": f"policy:rand:{i}", "fn": "inspect", "args": args})
    soda = ["소다 : 트윙클링 바니", "토브", "도로시 : 세렌디피티", "드레이크", "나유타"]
    cases += [
        {"id": "policy:soda", "fn": "inspect", "args": {"squad": soda}},
        {"id": "policy:soda-skip", "fn": "inspect", "args": {"squad": soda, "characters": {"소다 : 트윙클링 바니": {"burst": {"mode": "skip"}}}}},
        {"id": "policy:soda-fav0", "fn": "inspect", "args": {"squad": soda, "characters": {"소다 : 트윙클링 바니": {"collection": {"stage": "없음", "favorite": 0}}}}},
        {"id": "policy:skill1", "fn": "inspect", "args": {"squad": snapshot.SQUADS["스쿼드1"]["members"], "characters": {n: {"skillLevels": {"1": 1, "2": 1, "3": 1}} for n in snapshot.SQUADS["스쿼드1"]["members"]}}},
        {"id": "policy:four", "fn": "inspect", "args": {"squad": ["크라운", "토브", "나유타", "헬름"]}},
        {"id": "policy:dup", "fn": "inspect", "args": {"squad": ["크라운", "크라운", "토브", "나유타", "헬름"]}},
        {"id": "policy:test-name", "fn": "inspect", "args": {"squad": ["test_B1", "크라운", "토브", "나유타", "헬름"]}},
        {"id": "policy:unknown", "fn": "inspect", "args": {"squad": ["없는 니케", "크라운", "토브", "나유타", "헬름"]}},
        {"id": "policy:user-fixed-consent", "fn": "inspect", "args": {"squad": ["리타", "그레이브", "레이", "앨리스", "모더니아"], "purpose": "user_fixed", "allow_no_cdr": True}},
        {"id": "policy:user-fixed-no", "fn": "inspect", "args": {"squad": ["리타", "그레이브", "레이", "앨리스", "모더니아"], "purpose": "user_fixed"}},
        {"id": "policy:bad-settings", "fn": "inspect", "args": {"squad": ["크라운", "토브", "나유타", "헬름", "리타"], "characters": {"크라운": {"skillLevels": {"1": 0}}}}},
        {"id": "policy:err-purpose", "fn": "inspect", "args": {"squad": soda, "purpose": "x"}},
        {"id": "policy:err-consent", "fn": "inspect", "args": {"squad": soda, "allow_no_cdr": 1}},
        {"id": "policy:err-squad", "fn": "inspect", "args": {"squad": "크라운"}},
        {"id": "policy:err-six", "fn": "inspect", "args": {"squad": NAMES[:6]}},
        {"id": "policy:err-chars", "fn": "inspect", "args": {"squad": soda, "characters": [1]}},
        {"id": "roles:all", "fn": "roles", "args": {}},
        {"id": "roles:some", "fn": "roles", "args": {"names": ["크라운", "리틀 머메이드", "소다 : 트윙클링 바니", "헬름"],
                                                   "characters": {"크라운": {"skillLevels": {"1": 1, "2": 1, "3": 1}}, "헬름": {"collection": {"stage": "없음", "favorite": 0}}}}},
        {"id": "roles:bad-setting", "fn": "roles", "args": {"names": ["크라운"], "characters": {"크라운": {"skillLevels": {"1": 0}}}}},
        {"id": "roles:err-dup", "fn": "roles", "args": {"names": ["크라운", "크라운"]}},
        {"id": "roles:err-unknown", "fn": "roles", "args": {"names": ["없는 니케"]}},
    ]
    return cases


BATTLE = {"duration": 30, "enemyDef": 0, "enemyCode": "", "corePx": 0, "hasParts": False}
GROWTH = {"skillLevels": {"1": 10, "2": 10, "3": 10}}


def roster_for(squads) -> dict:
    out = {}
    for s in squads:
        for n in s:
            out[n] = dict(GROWTH)
    return out


def recommend_cases() -> list[dict]:
    S = {k: v["members"] for k, v in snapshot.SQUADS.items()}
    pool1 = [S["스쿼드1"], S["레이드_네온벨벳"], S["레이드_소다"], S["스쿼드4"]]
    pool2 = [S["스쿼드1"], S["레이드_헬름아쿠아스노우"], S["레이드_이브레이븐"], S["레이드_앨리스브래디"], S["레이드_작열짬"]]
    cases = [
        {"id": "rec:basic", "payload": {
            "candidates": [{"label": f"c{i}", "squad": s, "sourceUrl": "https://example.com", "reason": "r"} for i, s in enumerate(pool1)],
            "roster": roster_for(pool1), "battle": dict(BATTLE)}},
        {"id": "rec:two-squads", "payload": {
            "candidates": [{"label": f"c{i}", "squad": s} for i, s in enumerate(pool2)],
            "squadCount": 2, "roster": roster_for(pool2), "battle": {**BATTLE, "enemyCode": "수냉"},
            "scenarios": [{"label": "코어", "battle": {"corePx": 40, "coreWindows": [{"from": 0, "to": 20}]}},
                          {"battle": {"enemyDef": 5000}}]}},
        {"id": "rec:include-exclude", "payload": {
            "candidates": [{"label": f"c{i}", "squad": s} for i, s in enumerate(pool2)],
            "squadCount": 2, "include": ["에이다"], "exclude": ["리타"], "roster": roster_for(pool2),
            "battle": dict(BATTLE), "scenarios": [{"label": "파츠", "battle": {"hasParts": True}}]}},
        {"id": "rec:mixed-rejects", "payload": {
            "candidates": [{"label": "ok", "squad": S["스쿼드1"]},
                           {"label": "four", "squad": S["스쿼드1"][:4]},
                           {"label": "unknown", "squad": S["스쿼드1"][:4] + ["없는 니케"]},
                           "not-a-dict",
                           {"squad": S["스쿼드3"]},
                           {"label": "no-roster", "squad": S["스쿼드5"]},
                           {"label": "nocdr", "squad": ["리타", "그레이브", "레이", "앨리스", "모더니아"]},
                           {"label": "bad-growth", "squad": S["레이드_네온벨벳"]},
                           {"label": None, "squad": [" 크라운 ", "", "a", "b", "c"]},
                           {"label": "custom", "squad": ["커스텀 크라운"] + [n for n in S["스쿼드1"] if n != "크라운"]}],
            "roster": {**roster_for([S["스쿼드1"], S["스쿼드3"], ["리타", "그레이브", "레이", "앨리스", "모더니아"]]),
                       **{n: {"skillLevels": {"1": 10}} for n in S["레이드_네온벨벳"]},
                       "리틀 머메이드": {"skillLevels": {"1": 10, "2": 10, "3": 10}, "overload": {}},
                       "벨벳": {"cube": {"name": "지원 안 함", "level": 3}},
                       "커스텀 크라운": dict(GROWTH)},
            "battle": {**BATTLE, "seed": 7}}},
        {"id": "rec:none-feasible", "payload": {
            "candidates": [{"label": "a", "squad": S["스쿼드1"]}, {"label": "b", "squad": S["레이드_라피앨리스"]}],
            "squadCount": 2, "roster": roster_for([S["스쿼드1"], S["레이드_라피앨리스"]]), "battle": dict(BATTLE)}},
    ]
    good = cases[0]["payload"]
    errors = {
        "no-candidates": {**good, "candidates": []},
        "too-many": {**good, "candidates": good["candidates"] * 6},
        "count-bool": {**good, "squadCount": True},
        "count-6": {**good, "squadCount": 6},
        "no-roster": {**good, "roster": None},
        "battle-squad": {**good, "battle": {**BATTLE, "squad": ["크라운"]}},
        "include-bad": {**good, "include": ["크라운", 3]},
        "exclude-blank": {**good, "exclude": ["  "]},
        "conflict": {**good, "include": ["크라운"], "exclude": ["크라운"]},
        "three-scenarios": {**good, "scenarios": [{"battle": {}}] * 3},
        "scenario-no-battle": {**good, "scenarios": [{"label": "x"}]},
        "scenario-forbidden": {**good, "scenarios": [{"battle": {"seed": 3, "duration": 10, "enemyDef": 1}}]},
        "scenarios-null": {**good, "scenarios": None},
    }
    cases += [{"id": f"rec-err:{k}", "payload": v} for k, v in errors.items()]
    return cases


def err(e: Exception) -> str:
    return f"{type(e).__name__}: {e}"


def main() -> None:
    if sys.version_info[:2] != (3, 12):
        print(f"경고: 파이썬 {sys.version.split()[0]} — 사이트(Pyodide)는 3.12다.")
    out = []

    def run(kind, case, fn):
        t0 = time.perf_counter()
        rec = {"kind": kind, **case}
        try:
            rec["response"] = fn()
        except Exception as e:  # noqa: BLE001
            rec["error"] = err(e)
        rec["ms"] = round((time.perf_counter() - t0) * 1000, 1)
        out.append(rec)
        print(f"{case['id']:<40} {rec['ms']:8.0f} ms  {rec.get('error', 'ok')[:70]}", flush=True)

    for case in combat_power_cases():
        run("combatPower", case, lambda: json.loads(bridge.run_combat_power(json.dumps(case["payload"], ensure_ascii=False))))
    for case in growth_cases():
        run("compareGrowth", case, lambda: json.loads(growth_comparison.run_growth_comparison(json.dumps(case["payload"], ensure_ascii=False))))
    for case in policy_cases():
        if case["fn"] == "inspect":
            run("policy", case, lambda: squad_policy.inspect_squad_policy(**case["args"]))
        else:
            run("policy", case, lambda: squad_policy.query_squad_roles(**case["args"]))
    for case in recommend_cases():
        run("recommend", case, lambda: json.loads(recommendation.run_recommendation(json.dumps(case["payload"], ensure_ascii=False))))

    os.makedirs(os.path.join(HERE, "ref", "extra"), exist_ok=True)
    with open(os.path.join(HERE, "ref", "extra", "extra.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"{len(out)} cases -> ref/extra/extra.json")


if __name__ == "__main__":
    main()
