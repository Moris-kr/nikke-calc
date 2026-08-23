# Complete Nikke Roster — Batch 01 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register, validate, and deploy the first 10 of 113 missing Nikkes.

**Architecture:** Follow the repository-native `char-add` pipeline independently for each character: source validation, scenario draft, parsed effects, enriched scenario, engine implementation, and regression verification. Shared engine changes must model a general mechanic rather than branch on a character name. A separate special-case index links to scenario truth and records follow-up verification status without duplicating rules.

**Tech Stack:** Python 3 calculator and context tooling, JSON data files, TypeScript/Vite site, Vitest, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-23-complete-nikke-roster-design.md`

## Global Constraints

- Batch 01 contains exactly: `루피 : 윈터 쇼퍼`, `메어리 : 베이 갓데스`, `베스티 : 택티컬 업`, `에이드`, `크러스트`, `티아`, `프리바티 : 언카인드 메이드`, `네온 : 블루 오션`, `시그널`, `폴리`.
- `scraper/nikke_scraped.json` remains the skill-text and numeric source of truth; BlablaLink is a required independent cross-check.
- Preserve character default → recommendation layer → manual override priority.
- Do not hardcode character names in shared calculation formulas.
- Production behavior changes require a failing test first.
- Special cases do not pause the batch; record `확인 완료`, `가정 적용`, or `추가 실측 필요` and continue.
- Do not stage or modify the existing untracked `HANDOFF.md`.

---

### Task 1: Establish the clean baseline and Batch 01 count

**Files:**
- Read: `scraper/nikke_scraped.json`
- Read: `data/parsed_skills.json`
- Read: `site/public/catalog.json`

**Interfaces:**
- Consumes: the current 86-character catalog and 199-character raw roster.
- Produces: baseline test evidence and an exact expected post-batch catalog count of 96.

- [ ] **Step 1: Confirm all 10 raw records exist and none are in the catalog**

```powershell
$env:PYTHONIOENCODING='utf-8'
python -c "import json; from pathlib import Path; r=Path('.'); names=['루피 : 윈터 쇼퍼','메어리 : 베이 갓데스','베스티 : 택티컬 업','에이드','크러스트','티아','프리바티 : 언카인드 메이드','네온 : 블루 오션','시그널','폴리']; raw=json.loads((r/'scraper/nikke_scraped.json').read_text(encoding='utf-8')); cat={x['name'] for x in json.loads((r/'site/public/catalog.json').read_text(encoding='utf-8'))}; assert all(n in raw for n in names); assert not (set(names)&cat); assert len(cat)==86; print('batch01 baseline OK')"
```

- [ ] **Step 2: Run the pre-change verification suite**

```powershell
Push-Location site
npx tsc --noEmit
npm test -- --run
Pop-Location
$env:PYTHONIOENCODING='utf-8'
python -m context.doclint
python -m unittest calculator.test_customization
python calculator/damage.py
```

Expected: every command exits 0; current Vitest count is at least 141.

### Task 2: Create the special-case test index

**Files:**
- Create: `context/CHAR-SPECIAL-CASES.md`

**Interfaces:**
- Consumes: links to the per-character scenario documents created in Task 3.
- Produces: one non-authoritative verification index with columns `배치`, `캐릭터`, `위험 유형`, `시나리오 정본`, `자동 테스트`, `상태`, `확인할 내용`.

- [ ] **Step 1: Create the index header and status definitions**

The document must state that values and mechanic rules are not copied into the index and that scenario documents are authoritative. Add an initially empty table using exactly these statuses: `확인 완료`, `가정 적용`, `추가 실측 필요`.

- [ ] **Step 2: Run documentation lint**

```powershell
$env:PYTHONIOENCODING='utf-8'
python -m context.doclint
```

Expected: `결과: OK`.

### Task 3: Complete char-add stage 1 for all 10 characters

**Files:**
- Read: `.agent/skills/char-add/SCENARIO.md`
- Read: `context/GAMEPLAY.md` sections `스쿼드 구성`, `트리거 발동 의미`, and `표준 테스트 스쿼드`
- Read: `scraper/nikke_scraped.json`
- Create: `context/scenarios/루피 _ 윈터 쇼퍼.md`
- Create: `context/scenarios/메어리 _ 베이 갓데스.md`
- Create: `context/scenarios/베스티 _ 택티컬 업.md`
- Create: `context/scenarios/에이드.md`
- Create: `context/scenarios/크러스트.md`
- Create: `context/scenarios/티아.md`
- Create: `context/scenarios/프리바티 _ 언카인드 메이드.md`
- Create: `context/scenarios/네온 _ 블루 오션.md`
- Create: `context/scenarios/시그널.md`
- Create: `context/scenarios/폴리.md`

**Interfaces:**
- Consumes: raw weapon/burst/skill data and BlablaLink detail pages.
- Produces: 10 `모드: 초안` scenario files containing basic info, effect-block summaries, validation squads, timelines, interaction graphs where applicable, explicit assumptions, and implementation checklists.

- [ ] **Step 1: Cross-check each character against BlablaLink**

For each name, open its visible detail card and compare weapon type, burst stage/cooldown, all three level-10 skill values, condition wording, targets, durations, and stack counts with `nikke_scraped.json`. Record any mismatch under `## 유저 확인 사항` as an explicit chosen source and impact.

- [ ] **Step 2: Write all 10 draft scenarios using the exact SCENARIO template**

Use one cycle for 20-second burst characters and two cycles for 40-second characters. Include extra squads for weapon/class/code conditions and for burst-stage availability conditions.

- [ ] **Step 3: Validate document structure**

```powershell
$env:PYTHONIOENCODING='utf-8'
python -m context.doclint
```

Expected: `결과: OK` and all 10 scenario paths exist.

### Task 4: Complete char-add stage 2 for all 10 characters

**Files:**
- Read: `.agent/skills/char-add/PARSE.md`
- Read: `context/PARSING.md` sections 1–8
- Read: `context/IMPL-STATUS.md`
- Modify: `data/parsed_skills.json`
- Modify: `context/PARSING-CHARS.md`
- Generate: `roster.html`

**Interfaces:**
- Consumes: the 10 draft scenarios and raw skill blocks.
- Produces: complete parsed effect arrays for all 10 characters plus a list of required general engine mechanics.

- [ ] **Step 1: Parse every source block in original execution order**

Represent timing, condition, target, values/fixed value, duration, stacking, scaling, and favorite-item variants using existing keys where semantically correct. Preserve named-effect references exactly across `target_effect`, `scaling_ref`, `same_target:`, and state conditions.

- [ ] **Step 2: Register newly required general keys before implementation**

Add each new stat to the `context/IMPL-STATUS.md` master table as unimplemented and document the raw phrase-to-key mapping only when it is not already covered by `context/PARSING.md`.

- [ ] **Step 3: Move all 10 names to the correct parsing status and regenerate the roster**

```powershell
$env:PYTHONIOENCODING='utf-8'
python -m context.roster
python -m context.doclint
```

Expected: roster generation succeeds and doclint reports `결과: OK`.

### Task 5: Complete char-add stage 3 for all 10 characters

**Files:**
- Modify: the 10 scenario files from Task 3
- Modify: `context/CHAR-SPECIAL-CASES.md`

**Interfaces:**
- Consumes: parsed effects from Task 4.
- Produces: 10 `모드: 보강` scenarios with effect-level timelines and an indexed set of special verification cases.

- [ ] **Step 1: Replace natural-language summaries with effect-level tables**

Every parsed effect receives an ID row with trigger, condition, stat/effect, target, duration, and expected activations. Resolve same-timestamp execution order explicitly.

- [ ] **Step 2: Fill every scenario's `## 해석 선언` and exact validation checklist**

List each damage magnitude, scaling dependency, mode/state transition, stack lifecycle, and execution-order interpretation. State the outcome difference for credible alternate readings.

- [ ] **Step 3: Index only non-routine mechanics**

Add special-case rows linking to scenario sections. Assign `가정 적용` or `추가 실측 필요` when external evidence is insufficient; otherwise assign `확인 완료` only after an automated test exists and passes.

- [ ] **Step 4: Run documentation lint**

```powershell
$env:PYTHONIOENCODING='utf-8'
python -m context.doclint
```

Expected: `결과: OK`.

### Task 6: Complete char-add stage 4 with TDD

**Files:**
- Read: `.agent/skills/char-add/IMPL.md`
- Read: `context/CALCULATOR.md`
- Modify when required: `calculator/buff_manager.py`, `calculator/timeline.py`, `calculator/damage.py`, or the existing focused calculator module that owns the general behavior
- Test: the existing focused `calculator/test_*.py` file for each changed behavior
- Modify: `context/IMPL-STATUS.md`

**Interfaces:**
- Consumes: the stage-3 interpretation declarations and checklists.
- Produces: supported general mechanics and passing behavioral regression tests for all damage-relevant effects.

- [ ] **Step 1: For each unsupported mechanic, write one minimal real-behavior test**

Name the production branch or missing handler that makes the test fail. Assert the scenario's expected trigger count, active interval, stack count, target set, or damage contribution rather than mocking an internal call.

- [ ] **Step 2: Run each focused test and verify RED**

```powershell
$env:PYTHONIOENCODING='utf-8'
python -m unittest discover -s calculator -p 'test_*.py'
```

Expected: assertion failure caused by the absent general mechanic, not an import/key/syntax error.

- [ ] **Step 3: Implement the minimal general behavior and verify GREEN**

```powershell
$env:PYTHONIOENCODING='utf-8'
python -m unittest discover -s calculator -p 'test_*.py'
```

Expected: the focused test passes. Repeat the RED/GREEN cycle independently for every new mechanic.

- [ ] **Step 4: Execute every scenario checklist and update statuses**

Mark `확인 완료` only for tests that passed. Keep uncertain real-game behavior as `가정 적용` or `추가 실측 필요` without removing the character.

### Task 7: Regenerate the web catalog and verify Batch 01 integration

**Files:**
- Generate: `site/public/catalog.json`
- Generate: `site/public/runtime/`
- Read: `site/scripts/sync-runtime.mjs`

**Interfaces:**
- Consumes: 10 parsed character definitions.
- Produces: a 96-character site catalog with unique names and BlablaLink `nameCode` mappings.

- [ ] **Step 1: Regenerate runtime assets**

```powershell
Push-Location site
npm run sync-runtime
Pop-Location
```

- [ ] **Step 2: Assert the exact catalog delta and field completeness**

```powershell
$env:PYTHONIOENCODING='utf-8'
python -c "import json; from pathlib import Path; names={'루피 : 윈터 쇼퍼','메어리 : 베이 갓데스','베스티 : 택티컬 업','에이드','크러스트','티아','프리바티 : 언카인드 메이드','네온 : 블루 오션','시그널','폴리'}; cat=json.loads(Path('site/public/catalog.json').read_text(encoding='utf-8')); by={x['name']:x for x in cat}; assert len(cat)==96; assert names<=by.keys(); assert len(by)==96; assert all(by[n].get('nameCode') is not None for n in names); print('batch01 catalog OK')"
```

Expected: `batch01 catalog OK`.

### Task 8: Run the complete release gate, commit, push, and verify deployment

**Files:**
- Modify: only files produced by Tasks 2–7
- Preserve: `HANDOFF.md`

**Interfaces:**
- Consumes: the completed Batch 01 tree.
- Produces: one pushed `master` commit and a verified GitHub Pages deployment.

- [ ] **Step 1: Run every required verification command**

```powershell
Push-Location site
npx tsc --noEmit
npm test -- --run
Pop-Location
$env:PYTHONIOENCODING='utf-8'
python -m context.doclint
python -m context.snapshot
Push-Location site
npm run build
Pop-Location
python -m unittest calculator.test_customization
python calculator/damage.py
```

Expected: all commands exit 0, doclint prints `결과: OK`, snapshot passes every case, and damage verification prints `모든 검산 통과.`

- [ ] **Step 2: Inspect and commit only Batch 01 files**

```powershell
git status --short
git diff --check
git diff --stat
git add -- data context calculator site/src site/public/catalog.json roster.html
git diff --cached --check
git commit -m "feat: add the first ten missing Nikkes"
```

- [ ] **Step 3: Push and verify Pages**

```powershell
git push origin master
```

Use the GitHub Actions REST endpoint to wait for the workflow associated with the pushed commit to conclude with `success`. Then load `https://moris-kr.github.io/nikke-calc/`, verify that all 10 names are present, and record the deployed commit hash.

- [ ] **Step 4: Report the deployment**

Report the 10 names, special-case statuses, full verification results, commit hash, and deployment address. Then create the Batch 02 execution plan from the fixed roster order in the design spec and continue without waiting for special-case clarification.
