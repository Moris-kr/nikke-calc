# Character Skill Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each released character independently select Skill 1, Skill 2, and Burst levels from 1 through 10, while preview characters remain visibly and authoritatively locked at level 10.

**Architecture:** Extend the existing per-character override payload with `skillLevels`, validate and translate it once in the Python browser boundary, then reuse `context.spec` and `BuffManager` as the only skill-value resolver. Generate each character's defaults and lock state from canonical Python data so the TypeScript UI never infers preview status from names.

**Tech Stack:** Python 3 calculator engine, Pyodide bridge, TypeScript 7, browser DOM APIs, Vitest 4/jsdom, Vite 8, GitHub Pages

## Global Constraints

- No interpolation or invented coefficients: released characters use parsed level tables; preview characters remain 10/10/10.
- Defaults are Skill 1 Lv10, Skill 2 Lv10, and Burst Lv10.
- Five decks keep independent overrides, including different levels for the same character in different decks.
- Existing overload, cube, advanced-stat, core, filtering, cache, and simulation behavior remains unchanged.
- No new dependency, backend, AI, login, or remote persistence.

---

### Task 1: Validate and forward skill levels at the Python boundary

**Files:**
- Modify: `calculator/test_customization.py`
- Modify: `calculator/customization.py`
- Modify: `site/scripts/test-bridge.py`

**Interfaces:**
- Consumes browser payload `skillLevels: {"1": number, "2": number, "3": number}`.
- Produces engine override `skill_levels: {"1": int, "2": int, "3": int}`.

- [x] **Step 1: Write failing normalization and engine tests**

Add tests that expect:

```python
normalize_character_overrides({
    "skillLevels": {"1": 1, "2": 5, "3": 10},
}) == {"skill_levels": {"1": 1, "2": 5, "3": 10}}
```

Reject unknown keys, booleans, fractions, zero, and 11. Build a released character at two levels and assert the engine resolves a known parsed effect to distinct level-1 and level-10 values. Assert preview characters accept 10/10/10 and reject any forged non-10 request through `build_squad()`.

- [x] **Step 2: Run the focused Python tests and confirm red**

Run: `python -m unittest calculator.test_customization -v && python site/scripts/test-bridge.py`

Expected: FAIL because `skillLevels` is currently an unsupported browser section.

- [x] **Step 3: Implement strict browser normalization**

Allow `skillLevels` in `normalize_character_overrides()`, require an object, permit only keys `"1"`, `"2"`, and `"3"`, and require every supplied value to be a non-boolean integer in the inclusive range 1–10. Copy valid values to `result["skill_levels"]`; leave preview enforcement to the existing `context.spec.build_char()` check.

- [x] **Step 4: Re-run the focused Python tests**

Run: `python -m unittest calculator.test_customization -v && python site/scripts/test-bridge.py`

Expected: all focused tests PASS.

- [x] **Step 5: Commit the Python boundary**

```bash
git add calculator/customization.py calculator/test_customization.py site/scripts/test-bridge.py
git commit -m "feat: accept per-character skill levels"
```

### Task 2: Export canonical defaults and lock metadata

**Files:**
- Modify: `site/scripts/export-settings.py`
- Modify: `site/src/types.ts`
- Modify: `site/src/runtime-assets.test.ts`

**Interfaces:**
- Produces `CharacterSettingsDefaults.skillLevels` with exact keys `"1"`, `"2"`, and `"3"`.
- Produces `CharacterSettingsDefaults.skillLevelsLocked`, derived from canonical `parsed_nikke.json` preview metadata.

- [x] **Step 1: Write a failing runtime asset test**

Assert that a released entry exports `{ "1": 10, "2": 10, "3": 10 }` with `skillLevelsLocked: false`, and that both current preview characters export the same levels with `skillLevelsLocked: true`.

- [x] **Step 2: Run the focused asset test and confirm red**

Run: `cd site && npm test -- --run src/runtime-assets.test.ts`

Expected: FAIL because the generated settings entries lack skill metadata.

- [x] **Step 3: Export and type the metadata**

Add:

```ts
export interface SkillLevels {
  '1': number;
  '2': number;
  '3': number;
}
```

Extend `CharacterOverrides` and `CharacterSettingsDefaults`. In the Python exporter, copy resolved `char["skill_levels"]` and set the lock flag from `nikke[name]["preview"]` without name-specific frontend logic.

- [x] **Step 4: Regenerate runtime files and re-run the asset test**

Run: `cd site && npm run sync-runtime && npm test -- --run src/runtime-assets.test.ts`

Expected: PASS and deterministic `settings.json` output.

- [x] **Step 5: Commit runtime metadata**

```bash
git add site/scripts/export-settings.py site/src/types.ts site/src/runtime-assets.test.ts
git commit -m "feat: export character skill metadata"
```

### Task 3: Add the per-character skill editor

**Files:**
- Modify: `site/src/character-settings.test.ts`
- Modify: `site/src/character-settings.ts`
- Modify: `site/src/styles.css`

**Interfaces:**
- Produces three selects with `data-skill-level="1|2|3"` for released characters.
- Produces a non-editable `data-skill-levels-locked` notice for preview characters.

- [x] **Step 1: Write failing DOM interaction tests**

Test default 10/10/10 creation, always-visible compact summary text, independent Skill 1/Skill 2/Burst changes, and reset when `개별 설정` is disabled. Add a preview fixture and assert it shows `수치 미공개 · Lv10 고정`, renders no selects, and keeps 10/10/10.

- [x] **Step 2: Run the focused editor test and confirm red**

Run: `cd site && npm test -- --run src/character-settings.test.ts`

Expected: FAIL because no skill-level editor exists.

- [x] **Step 3: Implement editor state and controls**

Deep-clone `skillLevels`, include canonical levels in `defaultCharacterOverrides()`, and put skill copy in `summaryText()`. Render a `스킬 레벨` section before overload controls. Released characters receive three labeled Lv1–Lv10 native selects; locked characters receive only the canonical lock notice and explanation.

- [x] **Step 4: Add responsive styles and run editor tests**

Run: `cd site && npm test -- --run src/character-settings.test.ts`

Expected: PASS on desktop and narrow-grid DOM behavior.

- [x] **Step 5: Commit the editor**

```bash
git add site/src/character-settings.ts site/src/character-settings.test.ts site/src/styles.css
git commit -m "feat: edit character skill levels"
```

### Task 4: Normalize, validate, cache, and orchestrate skill overrides

**Files:**
- Modify: `site/src/model.test.ts`
- Modify: `site/src/model.ts`
- Modify: `site/src/ui.test.ts`
- Modify: `site/src/ui.ts`

**Interfaces:**
- Preserves `skillLevels` in `requestForDeck()` and its JSON cache key.
- Rejects non-integer/out-of-range values and any non-10 locked-character state before simulation.

- [x] **Step 1: Write failing model and UI tests**

Assert that request normalization retains exact levels, changing any one level changes the cache key, and the same character in separate decks can carry different values. In UI tests, change a select and confirm the worker request; inject invalid released and locked overrides and confirm simulation is blocked with a character-specific Korean error.

- [x] **Step 2: Run focused tests and confirm red**

Run: `cd site && npm test -- --run src/model.test.ts src/cache.test.ts src/ui.test.ts`

Expected: FAIL because normalization drops `skillLevels` and UI validation ignores it.

- [x] **Step 3: Implement immutable normalization and validation**

Copy all three skill keys without truncating invalid inputs away, so validation can report them. Validate exact keys and integer range 1–10 in the UI; additionally require 10/10/10 when `settings.characters[name].skillLevelsLocked` is true. Keep character objects isolated by deck and let the existing normalized request JSON provide cache separation.

- [x] **Step 4: Run focused and full frontend tests**

Run: `cd site && npm test -- --run src/model.test.ts src/cache.test.ts src/ui.test.ts`

Run: `cd site && npm test -- --run`

Expected: all frontend tests PASS.

- [x] **Step 5: Commit browser integration**

```bash
git add site/src/model.ts site/src/model.test.ts site/src/ui.ts site/src/ui.test.ts
git commit -m "feat: validate skill levels in browser"
```

### Task 5: Verify and deploy

**Files:**
- Verify only: Python suites, snapshots, frontend suite, runtime assets, `site/dist/`, GitHub Actions, public Pages site

**Interfaces:**
- Consumes the static browser build from Tasks 1–4.
- Produces a pushed `master` commit and verified public release at `https://moris-kr.github.io/nikke-calc/`.

- [x] **Step 1: Run the established repository verification suite**

Run the Python customization and bridge tests, damage/BuffManager/Timeline checks, document lint, 25 snapshots, all Vitest tests, runtime consistency, Pages checks, TypeScript validation, and the production Vite build. Every command must exit 0.

- [x] **Step 2: Review the completed implementation**

Inspect the diff for schema drift, invented preview values, stale fixtures, focus/rerender regressions, and unrelated changes. Apply valid review findings and re-run affected tests.

- [x] **Step 3: Verify the production build locally in Chrome**

Serve `site/dist/`; change a released character to non-default levels, run a calculation, confirm a preview character shows the locked notice and no editable controls, and verify two decks can retain different levels for the same character.

- [ ] **Step 4: Push and verify GitHub Pages**

Push `master`, wait for the Pages workflow to succeed, then repeat the released edit, preview lock, cross-deck independence, and calculation checks at the public URL.

- [ ] **Step 5: Confirm repository state**

Confirm `master` is synchronized with `origin/master`, the worktree is clean, and the published asset version matches the pushed commit.
