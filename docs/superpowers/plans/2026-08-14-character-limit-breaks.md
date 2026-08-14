# Character Limit Breaks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every character select a legal limit-break/core-enhancement stage and calculate with that stage's direct stat bonus and maximum allowed bond level.

**Architecture:** Carry canonical rarity into `parsed_nikke.json`, centralize rarity/Pilgrim/Over-Spec growth rules in a small Python module, and export the resolved options to the browser. The browser stores one `growthStage`; the Python boundary validates it by character and translates it to the existing `breakthrough`, `core_enhancement`, and `affinity` engine fields.

**Tech Stack:** Python 3.10 calculator engine, JSON canonical data, Pyodide bridge, TypeScript 7, Vitest 4/jsdom, Vite 8, GitHub Pages

## Global Constraints

- The selector uses one integer `growthStage`: 0=명함, 1~3=돌파, 4~10=코강 1~7.
- R permits stage 0, SR permits stages 0~2, and SSR permits stages 0~10.
- Bond is always the selected stage's maximum: R=1(no bonus), 명함=10, 1돌=20, 2돌=30, ordinary SSR 3돌+=30, Pilgrim/Over-Spec 3돌+=40.
- The current Over-Spec canonical list is exactly `라피 : 레드 후드`, `아니스 : 스타`, and `네온 : 비전 아이`.
- The direct limit-break and core formulas in `calculator/base_stat.py` remain unchanged.
- Existing direct Python overrides of `breakthrough`, `core_enhancement`, or `affinity` remain authoritative research inputs.
- No new dependency, backend, account, login, or remote persistence.

---

### Task 1: Add canonical rarity and growth rules

**Files:**
- Create: `scraper/test_parse_nikke.py`
- Modify: `scraper/parse_nikke.py`
- Create: `context/growth.py`
- Create: `context/test_growth.py`
- Modify: `context/spec.py`
- Modify: `context/test.py`
- Modify: `context/HARNESS.md`
- Modify: `context/CALCULATOR.md`
- Regenerate: `data/parsed_nikke.json`

**Interfaces:**
- Produces `parsed_nikke[name]["rarity"]: "R" | "SR" | "SSR"`.
- Produces `growth_profile(name, meta) -> dict` with `rarity`, `max_stage`, `default_stage`, and `bond_40`.
- Produces `resolve_growth(name, meta, stage) -> {"breakthrough": int, "core_enhancement": int, "affinity": int}`.
- Makes `build_char()` apply the profile default only when the caller did not directly override any engine growth field.

- [ ] **Step 1: Write failing parser and growth-rule tests**

Add parser coverage that invokes `parse_nikke.run()` with minimal R/SR/SSR fixtures and a patched temporary `OUT`, then expects the exact `rarity` field. Add table-driven growth tests:

```python
cases = [
    ("R", 0, 0, 0, 1),
    ("SR", 0, 0, 0, 10),
    ("SR", 2, 2, 0, 30),
    ("SSR", 0, 0, 0, 10),
    ("SSR", 3, 3, 0, 30),
    ("SSR", 10, 3, 7, 30),
]
```

Assert stage overflow, booleans, fractions, and unknown rarity fail. Assert `크라운` and all three Over-Spec names resolve stage 3 to affinity 40, while `리타` resolves to 30. In `context/test.py`, assert default characters use the profile maximum and direct legacy fields remain unchanged.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
python -m unittest scraper.test_parse_nikke context.test_growth context.test -v
```

Expected: FAIL because rarity is not exported and `context.growth` does not exist.

- [ ] **Step 3: Implement the minimal growth module and parser field**

Define:

```python
OVER_SPEC_NAMES = frozenset({
    "라피 : 레드 후드",
    "아니스 : 스타",
    "네온 : 비전 아이",
})
MAX_STAGE_BY_RARITY = {"R": 0, "SR": 2, "SSR": 10}
ENGINE_GROWTH_FIELDS = frozenset({"breakthrough", "core_enhancement", "affinity"})
```

`resolve_growth()` must reject non-integer stages (including booleans), map stages 4~10 to breakthrough 3/core 1~7, and derive bond from name/meta. `default_growth_stage()` returns `min(3, max_stage)`.

In `build_char()`, before character layers and caller overrides, replace the three engine growth fields with the resolved default unless `over` contains any `ENGINE_GROWTH_FIELDS`. Preserve the existing merge order after that. Copy `char.get("레어도", "")` into parser output and add `rarity: "SSR"` to dummy metadata.

- [ ] **Step 4: Regenerate canonical data and run focused tests GREEN**

Run:

```powershell
$env:PYTHONUTF8='1'
python scraper/parse_nikke.py
python -m unittest scraper.test_parse_nikke context.test_growth context.test -v
```

Expected: all focused tests PASS; released and preview entries include rarity; normal SSR defaults remain bond 30 and Pilgrim/Over-Spec defaults become bond 40.

- [ ] **Step 5: Update the two approved context documents and commit**

Document the profile-derived default, stage table, and direct-override escape hatch without duplicating raw character metadata.

```powershell
git add scraper/parse_nikke.py scraper/test_parse_nikke.py context/growth.py context/test_growth.py context/spec.py context/test.py context/HARNESS.md context/CALCULATOR.md data/parsed_nikke.json
git commit -m "feat: model character growth stages"
```

### Task 2: Validate and translate browser growth requests

**Files:**
- Modify: `calculator/test_customization.py`
- Modify: `calculator/customization.py`
- Modify: `site/pybridge/bridge.py`
- Modify: `site/scripts/test-bridge.py`

**Interfaces:**
- Consumes browser `growthStage: number` plus canonical character name.
- Produces the three engine fields from `context.growth.resolve_growth()`.
- Leaves requests without `growthStage` unchanged so `context.spec` supplies the canonical default.

- [ ] **Step 1: Write failing normalization and bridge tests**

Add assertions equivalent to:

```python
normalize_character_overrides({"growthStage": 6}, character_name="리타") == {
    "breakthrough": 3,
    "core_enhancement": 3,
    "affinity": 30,
}
normalize_character_overrides({"growthStage": 3}, character_name="크라운")["affinity"] == 40
```

Reject missing character context for a growth request, booleans, fractions, negative values, SSR stage 11, SR stage 3, and R stage 1. Bridge tests must prove the selected fields reach `build_squad()` and a forged stage fails before simulation.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
python -m unittest calculator.test_customization -v
python site/scripts/test-bridge.py
```

Expected: FAIL because `growthStage` is unsupported.

- [ ] **Step 3: Implement name-aware normalization**

Allow `growthStage` in the exact section whitelist. Extend the function signature to:

```python
def normalize_character_overrides(raw: Any, *, character_name: str | None = None) -> dict[str, Any]:
```

When present, require `character_name`, load its metadata through the growth helper, resolve the stage, and merge the resulting three engine fields. Update the bridge comprehension to pass each canonical name.

- [ ] **Step 4: Run focused tests GREEN and commit**

Run the two focused commands from Step 2 and expect all tests PASS.

```powershell
git add calculator/customization.py calculator/test_customization.py site/pybridge/bridge.py site/scripts/test-bridge.py
git commit -m "feat: accept character growth stages"
```

### Task 3: Export browser growth metadata

**Files:**
- Modify: `site/scripts/export-settings.py`
- Modify: `site/scripts/sync-runtime.mjs`
- Modify: `site/scripts/check-runtime.mjs`
- Modify: `site/src/types.ts`
- Modify: `site/src/runtime-assets.test.ts`

**Interfaces:**
- Extends each `CharacterSettingsDefaults` with `growthStage`, `rarity`, `maxGrowthStage`, and `growthOptions`.
- Each option is `{ value: number, label: string, affinity: number }` and is generated by Python.
- Ships `context/growth.py` in the Pyodide runtime manifest.

- [ ] **Step 1: Write a failing runtime asset test**

Expect an ordinary SSR to export stage 3/bond 30, `크라운` and all three Over-Spec names to export stage 3/bond 40, an SSR to expose exactly values 0~10, and the manifest to include `context/growth.py`. Assert a preview character exports canonical SSR growth metadata.

- [ ] **Step 2: Run the focused asset test and verify RED**

Run:

```powershell
cd site
$env:PYTHONUTF8='1'
npm test -- --run src/runtime-assets.test.ts
```

Expected: FAIL because growth metadata and the runtime module are absent.

- [ ] **Step 3: Export and type canonical options**

Add:

```ts
export interface GrowthOption {
  value: number;
  label: string;
  affinity: number;
}
```

Extend `CharacterOverrides` with optional `growthStage` and defaults with exact growth fields. Generate labels `명함`, `1돌`…`3돌`, `코강 1`…`코강 7` from stage numbers in Python. Add the module to `runtimeFiles` and runtime consistency checks.

- [ ] **Step 4: Regenerate runtime assets, run GREEN, and commit**

Run:

```powershell
npm run sync-runtime
npm test -- --run src/runtime-assets.test.ts
npm run check-runtime
```

Expected: all commands exit 0 and generated metadata is deterministic.

```powershell
git add site/scripts/export-settings.py site/scripts/sync-runtime.mjs site/scripts/check-runtime.mjs site/src/types.ts site/src/runtime-assets.test.ts
git commit -m "feat: export character growth metadata"
```

### Task 4: Add the limit-break editor

**Files:**
- Modify: `site/src/character-settings.test.ts`
- Modify: `site/src/character-settings.ts`
- Modify: `site/src/styles.css`

**Interfaces:**
- Produces one select with `data-growth-stage` before skill levels.
- Displays `호감도는 돌파별 최대치로 적용합니다.` and current stage/bond in the summary.
- Uses only exported `growthOptions`; the DOM does not infer rarity or special character type.

- [ ] **Step 1: Write failing DOM tests**

Test default stage creation, exact selector options, the Korean explanation, summary updates, reset on disabling `개별 설정`, SSR ordinary bond 30, Pilgrim/Over-Spec bond 40, and a constrained SR fixture with only 0~2 options.

- [ ] **Step 2: Run the editor test and verify RED**

Run:

```powershell
cd site
npm test -- --run src/character-settings.test.ts
```

Expected: FAIL because no growth editor exists.

- [ ] **Step 3: Implement the selector and immutable state**

Clone `growthStage`, include canonical growth in `defaultCharacterOverrides()`, add the stage/bond summary, and render a compact section before skill levels. On change, copy the current override and emit the selected integer. Add narrow-screen styles consistent with the existing skill/cube grids.

- [ ] **Step 4: Run editor tests GREEN and commit**

```powershell
npm test -- --run src/character-settings.test.ts
git add site/src/character-settings.ts site/src/character-settings.test.ts site/src/styles.css
git commit -m "feat: edit character limit breaks"
```

### Task 5: Preserve, validate, and cache growth per deck

**Files:**
- Modify: `site/src/model.test.ts`
- Modify: `site/src/model.ts`
- Modify: `site/src/cache.test.ts`
- Modify: `site/src/ui.test.ts`
- Modify: `site/src/ui.ts`

**Interfaces:**
- Preserves exact `growthStage` in `requestForDeck()` and the normalized JSON cache key.
- Validates integer range against `settings.characters[name].maxGrowthStage` before worker submission.
- Keeps the same character's stage independent across decks.

- [ ] **Step 1: Write failing model, cache, and UI tests**

Assert normalization preserves stage 0 and stage 10 without truncating invalid fractions, changing only growth changes the cache key, two decks retain different stages, UI submission forwards the selection, and forged negative/fraction/above-max values produce character-specific Korean errors without calling the worker.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
cd site
npm test -- --run src/model.test.ts src/cache.test.ts src/ui.test.ts
```

Expected: FAIL because normalization drops growth and UI does not validate it.

- [ ] **Step 3: Implement immutable preservation and canonical validation**

Copy `growthStage` without `Math.trunc()` so malformed state remains observable to validation. In `validateCharacterValues()`, require an integer from 0 through the character's exported maximum and include deck/name/range in the error. The existing normalized request JSON remains the cache-key source.

- [ ] **Step 4: Run focused and full frontend tests GREEN and commit**

```powershell
npm test -- --run src/model.test.ts src/cache.test.ts src/ui.test.ts
npm test -- --run
git add site/src/model.ts site/src/model.test.ts site/src/cache.test.ts site/src/ui.ts site/src/ui.test.ts
git commit -m "feat: validate growth stages in browser"
```

### Task 6: Regenerate regressions, verify, publish, and inspect production

**Files:**
- Regenerate: `context/baseline/*.json`
- Verify only: all Python, frontend, runtime, build, Git, GitHub Pages, and public UI state

**Interfaces:**
- Produces reviewed golden snapshots for profile-derived bond 40.
- Produces a pushed `master` and verified public calculator.

- [ ] **Step 1: Run snapshots once to observe the expected RED diff**

Run:

```powershell
$env:PYTHONUTF8='1'
python -m context.snapshot
```

Expected: only snapshots containing Pilgrim/Over-Spec characters fail because affinity increased; inspect every changed squad for that cause.

- [ ] **Step 2: Regenerate snapshots through the canonical command**

Run `python -m context.snapshot --update`; never hand-edit `context/baseline`. Re-run `python -m context.snapshot` and require 25/25 PASS. Commit only reviewed snapshot changes:

```powershell
git add context/baseline
git commit -m "test: update growth profile snapshots"
```

- [ ] **Step 3: Run the complete fresh verification suite**

Run every command independently and require exit 0:

```powershell
$env:PYTHONUTF8='1'
python -m unittest scraper.test_parse_nikke context.test_growth calculator.test_customization -v
python site/scripts/test-bridge.py
python calculator/damage.py
python -m context.doclint
python -m context.snapshot
cd site
npm test -- --run
npm run check-pages
npm run check-runtime
npm run build
```

- [ ] **Step 4: Review repository state and commit any verified generated/documentation residue**

Run `git diff --check`, inspect `git diff --stat`, confirm no generated runtime directory is tracked, and commit only intentional files. Require a clean feature branch afterward.

- [ ] **Step 5: Integrate to master and push**

Merge the feature branch into local `master` without rewriting user history, re-run the fast frontend suite and focused Python tests after merge, then push `master` to `origin`. Confirm local HEAD equals `origin/master`.

- [ ] **Step 6: Verify GitHub Pages and the public UI**

Wait for the Pages workflow to complete. Open `https://moris-kr.github.io/nikke-calc/`, confirm a normal SSR shows 3돌/호감도 30, a Pilgrim or Over-Spec shows 3돌/호감도 40, change one character to 명함 and run a calculation, and confirm a second deck retains an independent stage. Report the deployed commit and any environment-only caveats.
