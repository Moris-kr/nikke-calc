# Character Loadouts and Multi-Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add canonical per-character overload, advanced numeric, core, and five-cube controls plus sequential five-deck calculation to the static GitHub Pages calculator.

**Architecture:** Python remains authoritative for layered character defaults and damage math. A generated settings catalog gives TypeScript the resolved defaults and supported registries; each browser request sends character overrides into `build_squad`, while five-deck mode sequences the existing one-squad worker protocol and aggregates results in the UI.

**Tech Stack:** Python 3 calculator engine, Pyodide bridge, TypeScript 7, Vite 8, Vitest/jsdom, GitHub Pages.

## Global Constraints

- The deployed site must remain browser-only with no AI, backend, login, or remote persistence.
- Cross-deck duplicate characters are allowed; duplicates inside one deck remain invalid.
- Overload values are final replacements for `element_bonus_pct`, `atk_pct`, `max_ammo_pct`, `crit_rate`, and `crit_dmg`.
- Core defaults to off; enabling it starts at 52px and allows editing.
- Only 재장, 탄충, 체력, 차속, and 파츠 cubes are selectable, at levels 1 through 15.
- Empty decks are skipped and every non-empty deck may contain one through five characters.
- Existing unrelated user changes must be preserved.

---

## File map

- `calculator/customization.py`: canonical supported overload/cube/manual-stat registries and validation helpers.
- `calculator/buff_manager.py`: cube trigger correction and advanced personal-effect registration.
- `context/spec.py`: pass validated per-character overrides through existing deep layering.
- `site/pybridge/bridge.py`: validate and forward browser character overrides.
- `site/scripts/export-settings.py`: export resolved character/cube/manual metadata from Python.
- `site/scripts/sync-runtime.mjs`: invoke the exporter and write `settings.json`.
- `site/src/types.ts`: request, loadout, settings catalog, deck, and batch-result contracts.
- `site/src/model.ts`: normalization, validation, enemy reset, cache keys, and batch aggregation.
- `site/src/character-settings.ts`: per-character settings DOM and state helpers.
- `site/src/ui.ts`: normal/five-deck orchestration, tabs, sequential runs, and result rendering.
- `site/src/styles.css`: responsive controls, tabs, advanced rows, and multi-deck results.
- Existing Python and Vitest files: focused regression and integration coverage.

### Task 1: Canonical customization registry and settings export

**Files:**
- Create: `calculator/customization.py`
- Create: `site/scripts/export-settings.py`
- Modify: `site/scripts/sync-runtime.mjs`
- Test: `calculator/customization.py`
- Test: `site/src/runtime-assets.test.ts`

**Interfaces:**
- Produces: `OVERLOAD_FIELDS`, `MANUAL_STATS`, `CUBE_NAMES`, `normalize_character_overrides(raw) -> dict`.
- Produces: `site/public/runtime/settings.json` containing `characters`, `cubes`, `overloadFields`, and `manualStats`.

- [ ] **Step 1: Write failing registry and runtime-asset tests**

Add a `__main__` self-test to `calculator/customization.py` expectations through a new temporary test scaffold and extend `runtime-assets.test.ts` to assert all five cubes, levels 1 and 15, Mihara's resolved ATK value, and the complete manual-stat metadata are exported.

- [ ] **Step 2: Run tests and confirm the settings artifact is missing**

Run: `cd site && npm test -- --run src/runtime-assets.test.ts`

Expected: FAIL because `/runtime/settings.json` is absent.

- [ ] **Step 3: Implement the registry, strict normalizer, and exporter**

Define finite numeric bounds and Korean labels/units once in `customization.py`. Resolve every character with `build_squad([name])[0]`; export the five equipment totals, cube selection, cube flat stat table, selected-effect tables, and the advanced registry as deterministic JSON.

- [ ] **Step 4: Generate assets and run focused tests**

Run: `python -m calculator.customization && cd site && npm run sync-runtime && npm test -- --run src/runtime-assets.test.ts`

Expected: all commands PASS and `settings.json` contains no NaN or Infinity values.

- [ ] **Step 5: Commit the canonical catalog**

```bash
git add calculator/customization.py site/scripts/export-settings.py site/scripts/sync-runtime.mjs site/src/runtime-assets.test.ts
git commit -m "feat: export canonical character settings"
```

### Task 2: Apply character overrides and correct cube effects

**Files:**
- Modify: `calculator/buff_manager.py`
- Modify: `site/pybridge/bridge.py`
- Modify: `site/scripts/test-bridge.py`
- Create: `calculator/test_customization.py`

**Interfaces:**
- Consumes: `normalize_character_overrides` from Task 1.
- Produces: request field `characters: dict[str, CharacterOverrides]` passed to `build_squad(names, characters)`.
- Produces: permanent personal advanced effects and `hit_count:10` 탄충 instant effects.

- [ ] **Step 1: Write failing engine and bridge tests**

Cover overload replacement without double counting, a +20 `split_dmg_pct` personal modifier that leaves a teammate unchanged, invalid cube/stat rejection, selected cube level effects, and 탄충 recovering its configured flat rounds on the tenth hit but not at battle start.

- [ ] **Step 2: Run focused Python tests and verify failures**

Run: `python -m unittest calculator.test_customization -v && python site/scripts/test-bridge.py`

Expected: FAIL on missing character override handling and incorrect 탄충 trigger type.

- [ ] **Step 3: Implement bridge normalization and engine effects**

Normalize overrides before `build_squad`. Register continuous manual statistics as permanent self effects, special-case personal outgoing enemy modifiers during buff aggregation, and register `ammo_charge_flat` as an instant `hit_count:10` effect. Change `_make_cube_effects` so only 탄충 uses that instant trigger.

- [ ] **Step 4: Run focused and existing calculator tests**

Run: `python -m unittest calculator.test_customization -v && python site/scripts/test-bridge.py && python -m calculator.damage && python -m calculator.buff_manager && python -m calculator.timeline`

Expected: all commands PASS.

- [ ] **Step 5: Commit engine support**

```bash
git add calculator/buff_manager.py calculator/test_customization.py site/pybridge/bridge.py site/scripts/test-bridge.py
git commit -m "feat: simulate per-character loadouts"
```

### Task 3: Browser data model and multi-deck validation

**Files:**
- Modify: `site/src/types.ts`
- Modify: `site/src/model.ts`
- Modify: `site/src/model.test.ts`
- Modify: `site/src/cache.test.ts`

**Interfaces:**
- Produces: `CharacterOverrides`, `DeckState`, `BatchResult`, and `SettingsCatalog` types.
- Produces: `requestForDeck(deck, battle)`, `validateDecks(decks, mode)`, `resetEnemy(battle)`, and `aggregateDeckResults(results)`.

- [ ] **Step 1: Write failing model tests**

Assert that duplicate names in one deck fail, the same name in separate decks passes, empty decks are skipped, all-empty batches fail, core off normalizes to 0, enemy reset restores 31,784/no-code/52px-reference/no-parts, and changing overload/cube/manual values changes the cache key.

- [ ] **Step 2: Run the focused Vitest file and verify failure**

Run: `cd site && npm test -- --run src/model.test.ts src/cache.test.ts`

Expected: FAIL because deck/loadout contracts do not exist.

- [ ] **Step 3: Implement immutable model helpers**

Normalize character-object keys in squad order, sort manual-stat keys for stable cache keys, keep each deck's duplicate check local, and aggregate successful deck totals and per-character records without merging equal names across decks.

- [ ] **Step 4: Run model tests**

Run: `cd site && npm test -- --run src/model.test.ts src/cache.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit browser model support**

```bash
git add site/src/types.ts site/src/model.ts site/src/model.test.ts site/src/cache.test.ts
git commit -m "feat: model five independent decks"
```

### Task 4: Per-character editor and battle controls

**Files:**
- Create: `site/src/character-settings.ts`
- Create: `site/src/character-settings.test.ts`
- Modify: `site/src/ui.ts`
- Modify: `site/src/ui.test.ts`
- Modify: `site/src/styles.css`

**Interfaces:**
- Consumes: `SettingsCatalog` and `CharacterOverrides` from Task 3.
- Produces: `renderCharacterSettings(container, character, catalog, state, onChange)` and accessible controls with stable `data-testid` attributes.

- [ ] **Step 1: Write failing jsdom interaction tests**

Test opening 개별 설정, resolved default labels, final overload edits, cube type/level changes and summaries, advanced search/add/edit/remove with duplicate prevention, core checkbox/52px edit behavior, and enemy-only reset.

- [ ] **Step 2: Run UI tests and verify failure**

Run: `cd site && npm test -- --run src/character-settings.test.ts src/ui.test.ts`

Expected: FAIL because the controls are absent.

- [ ] **Step 3: Implement the editor and responsive styles**

Keep editor state per occupied slot, discard stale overrides when a slot's character changes, use native labels and inputs for keyboard/screen-reader access, and show cube flat/effect/common summaries from the generated catalog.

- [ ] **Step 4: Run UI tests**

Run: `cd site && npm test -- --run src/character-settings.test.ts src/ui.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit character controls**

```bash
git add site/src/character-settings.ts site/src/character-settings.test.ts site/src/ui.ts site/src/ui.test.ts site/src/styles.css
git commit -m "feat: edit character loadouts in browser"
```

### Task 5: Sequential five-deck execution and result view

**Files:**
- Modify: `site/src/ui.ts`
- Modify: `site/src/ui.test.ts`
- Modify: `site/src/styles.css`
- Modify: `site/src/worker-client.test.ts`

**Interfaces:**
- Consumes: existing `SimulationWorkerClient.simulate(request, onProgress)` once per non-empty deck.
- Produces: normal/five-deck toggle, five tab states, `덱 x/y` progress, total batch result, per-deck summaries, and per-deck character rows.

- [ ] **Step 1: Write failing orchestration tests**

Use a fake worker to prove three non-empty decks produce three sequential calls in tab order, two empty decks are skipped, cross-deck duplicates are retained, cached results are reused, progress includes deck position, and a labeled deck failure preserves earlier rendered successes.

- [ ] **Step 2: Run focused orchestration tests and verify failure**

Run: `cd site && npm test -- --run src/ui.test.ts src/worker-client.test.ts`

Expected: FAIL because only one squad is currently executed.

- [ ] **Step 3: Implement tabbed deck state and sequential execution**

Store five independent deck objects, render the active deck only, snapshot each request before awaiting the worker, update progress after every deck, and render aggregate plus per-deck results without combining same-named characters across decks.

- [ ] **Step 4: Run the full front-end suite and production build**

Run: `cd site && npm test -- --run && npm run build`

Expected: all Vitest tests PASS and Vite produces `dist/index.html` plus runtime assets.

- [ ] **Step 5: Commit five-deck UI**

```bash
git add site/src/ui.ts site/src/ui.test.ts site/src/styles.css site/src/worker-client.test.ts
git commit -m "feat: calculate five decks sequentially"
```

### Task 6: Regression verification, public QA, and deployment

**Files:**
- Modify only if a verification failure identifies a scoped defect.

**Interfaces:**
- Produces: a verified production build and deployed GitHub Pages URL.

- [ ] **Step 1: Run all repository checks from clean inputs**

Run:

```bash
python -m unittest calculator.test_customization -v
python -m calculator.damage
python -m calculator.buff_manager
python -m calculator.timeline
python site/scripts/test-bridge.py
python -m context.snapshot
python -m context.doclint
cd site
npm test -- --run
npm run build
npm run check-pages
```

Expected: every command exits 0, snapshot/doclint report no unexpected drift, and Pages asset checks pass.

- [ ] **Step 2: Inspect the complete diff**

Run: `git diff HEAD~5 --check && git status --short && git log --oneline -6`

Expected: no whitespace errors, only scoped files, and all implementation commits present.

- [ ] **Step 3: Run local browser smoke tests**

Start `npm run preview -- --host 127.0.0.1`, then verify normal mode, core toggle/edit/reset, character settings, every cube selector, advanced +20 split damage, five-deck tabs, cross-deck duplicate acceptance, and aggregate results at desktop and narrow viewport widths. Confirm the browser console has no errors.

- [ ] **Step 4: Push and wait for GitHub Pages**

```bash
git push origin master
gh run list --limit 5
gh run watch --exit-status
```

Expected: push succeeds and the Pages workflow completes successfully.

- [ ] **Step 5: Verify the public site**

Open `https://moris-kr.github.io/nikke-calc/`, hard refresh, repeat one normal-mode and one two-deck simulation, and confirm the deployed commit and runtime settings asset load without errors.

- [ ] **Step 6: Report completion**

Provide the public URL, concise formula-audit finding, delivered controls, duplicate-character rule, test/build/deployment evidence, and any remaining pre-existing formula limitation.
