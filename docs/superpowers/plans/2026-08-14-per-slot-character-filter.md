# Per-Slot Character Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent filter input above each native squad character dropdown and deploy it to GitHub Pages.

**Architecture:** Keep deck composition in `ui.ts` and store only transient filter strings in a five-by-five in-memory matrix. Each slot repopulates its own native select from the catalog while preserving the empty option, current selection, and same-deck disabled states.

**Tech Stack:** TypeScript 7, browser DOM APIs, CSS, Vitest 4 with jsdom, Vite 8, GitHub Pages

## Global Constraints

- No new runtime dependency, backend, AI, or account state.
- Native character selects and existing calculator payloads remain unchanged.
- Same-deck duplicates are disabled; cross-deck duplicates are allowed.
- Search matches name, burst label, element code, weapon type, class, and manufacturer.

---

### Task 1: Slot-local filtering

**Files:**
- Modify: `site/src/ui.test.ts`
- Modify: `site/src/ui.ts`
- Modify: `site/src/styles.css`

**Interfaces:**
- Consumes: `CharacterMeta[]` and `DeckState` already owned by `mountCalculator()`.
- Produces: five `[data-character-filter]` inputs and five `[data-squad-slot]` native selects.

- [ ] **Step 1: Write failing DOM tests**

```ts
expect(root.querySelectorAll('[data-character-filter]')).toHaveLength(5);
filterCharacterSlot(root, 0, '앨리스');
expect([...first.options].map((option) => option.value)).toEqual(['', '리타', '앨리스']);
expect([...second.options].map((option) => option.value)).toEqual(['', ...names]);
```

- [ ] **Step 2: Run the focused test and confirm red**

Run: `cd site && npm test -- --run src/ui.test.ts`

Expected: FAIL because per-slot filter inputs do not exist.

- [ ] **Step 3: Implement filtering and styling**

Create `characterFilters` as five arrays of five strings. Render a labeled search input before each select, build searchable metadata from the catalog fields, retain the current character on a non-matching query, and update only that select on input.

- [ ] **Step 4: Run focused and full frontend tests**

Run: `cd site && npm test -- --run src/ui.test.ts`

Run: `cd site && npm test -- --run`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/ui.ts site/src/ui.test.ts site/src/styles.css
git commit -m "feat: add filters above character dropdowns"
```

### Task 2: Verify and deploy

**Files:**
- Verify only: calculator tests, bridge, snapshots, `site/dist/`, GitHub Actions, public Pages site

**Interfaces:**
- Consumes: the static site from Task 1.
- Produces: a passing pushed commit and verified public release.

- [ ] **Step 1: Run the established repository verification commands**

Run Python calculator tests, bridge smoke test, snapshot/doc checks, frontend tests, runtime consistency, Pages checks, and the Vite production build. Every command must exit 0.

- [ ] **Step 2: Verify locally in Chrome**

Serve `site/dist/`, filter and select a character in one slot, confirm another slot is unaffected, and run a calculation.

- [ ] **Step 3: Push and verify GitHub Pages**

Push `master`, wait for the Pages workflow, then repeat filtering, cross-deck duplicate, and calculation checks at `https://moris-kr.github.io/nikke-calc/`.
