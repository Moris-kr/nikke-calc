# Searchable Character Combobox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace each native squad character select with an accessible, searchable, filterable visual combobox and deploy it to GitHub Pages.

**Architecture:** Add a focused DOM component that owns one combobox's query, burst filter, active option, accessibility attributes, and dismissal listeners. `ui.ts` continues to own deck composition and ensures that only one selector is open; the calculator engine and payload formats remain unchanged.

**Tech Stack:** TypeScript 7, browser DOM APIs, CSS, Vitest 4 with jsdom, Vite 8, GitHub Pages

## Global Constraints

- No new runtime dependency, backend, AI, or account state.
- Same-deck duplicates remain visible but disabled; cross-deck duplicates remain allowed.
- Character portrait URLs must continue to use `import.meta.env.BASE_URL`.
- Search matches name, `B{stage}`, element code, weapon type, class, and manufacturer.
- Keyboard support includes ArrowUp, ArrowDown, Home, End, Enter, and Escape with focus retained in the search input.
- The page-level “캐릭터 찾기” input is removed.

---

### Task 1: Standalone character combobox behavior

**Files:**
- Create: `site/src/character-combobox.ts`
- Create: `site/src/character-combobox.test.ts`

**Interfaces:**
- Consumes: `CharacterMeta` from `site/src/types.ts`.
- Produces: `createCharacterCombobox(options: CharacterComboboxOptions): CharacterCombobox`, where the controller exposes `element`, `open()`, `close({ restoreFocus? })`, and `destroy()`.
- Produces: `CharacterComboboxOptions` with `idPrefix`, `slotLabel`, `catalog`, `selectedName`, `takenNames`, `baseUrl`, `onOpen`, `onClose`, and `onSelect`.

- [ ] **Step 1: Write failing filtering and duplicate tests**

```ts
const combo = createCharacterCombobox(options({ takenNames: new Set(['크라운']) }));
document.body.append(combo.element);
combo.open();
const search = combo.element.querySelector<HTMLInputElement>('[data-character-search]')!;
search.value = '테트라';
search.dispatchEvent(new Event('input', { bubbles: true }));
expect(visibleNames(combo.element)).toEqual(['리타', '앨리스']);
expect(combo.element.querySelector('[data-character-option="크라운"]')?.getAttribute('aria-disabled')).toBe('true');
```

- [ ] **Step 2: Run the focused test and confirm red**

Run: `cd site && npm test -- --run src/character-combobox.test.ts`

Expected: FAIL because `./character-combobox` does not exist.

- [ ] **Step 3: Implement normalized metadata filtering and visual result rendering**

```ts
const haystack = [
  candidate.name,
  `B${candidate.burstStage}`,
  candidate.elementCode,
  candidate.weaponType,
  candidate.className,
  candidate.manufacturer,
].join(' ').toLocaleLowerCase('ko');
const matches = haystack.includes(query.toLocaleLowerCase('ko'))
  && (burst === 'all' || candidate.burstStage === burst);
```

Create a trigger button, hidden panel, labeled search input, 전체/B1/B2/B3 filters, persistent clear row, `role="listbox"` results, lazy portrait images, selected state, disabled “편성 중” rows, and a no-results message.

- [ ] **Step 4: Add failing keyboard and dismissal tests**

```ts
search.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
expect(onSelect).toHaveBeenCalledWith('앨리스');

combo.open();
document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
expect(trigger.getAttribute('aria-expanded')).toBe('false');
```

- [ ] **Step 5: Implement active-option navigation and lifecycle cleanup**

Keep DOM focus in the search input, update `aria-activedescendant`, skip disabled rows, scroll the active row into view, restore trigger focus after selection/Escape, and remove document listeners in `close()`/`destroy()`.

- [ ] **Step 6: Run the focused tests and confirm green**

Run: `cd site && npm test -- --run src/character-combobox.test.ts`

Expected: all combobox tests PASS.

- [ ] **Step 7: Commit the component**

```bash
git add site/src/character-combobox.ts site/src/character-combobox.test.ts
git commit -m "feat: add searchable character combobox"
```

### Task 2: Integrate selectors with squad and five-deck state

**Files:**
- Modify: `site/src/ui.ts`
- Modify: `site/src/ui.test.ts`

**Interfaces:**
- Consumes: `createCharacterCombobox()` and `CharacterCombobox` from Task 1.
- Preserves: `DeckState.squad`, `DeckState.characters`, `renderDeckTabs()`, and the existing simulation request protocol.

- [ ] **Step 1: Replace native-select assertions with failing combobox integration tests**

```ts
expect(root.querySelectorAll<HTMLButtonElement>('[data-squad-slot]')).toHaveLength(5);
const first = root.querySelector<HTMLButtonElement>('#squad-0')!;
first.click();
expect(root.querySelector<HTMLInputElement>('[data-character-search]')).toBe(document.activeElement);
expect(root.querySelector('[data-character-option="크라운"]')?.getAttribute('aria-disabled')).toBe('true');
```

Add a `chooseCharacter(root, slot, name)` test helper that opens the slot, filters by exact name, and clicks its enabled option. Use it in preview-clear and five-deck duplicate tests.

- [ ] **Step 2: Run the UI tests and confirm red**

Run: `cd site && npm test -- --run src/ui.test.ts`

Expected: FAIL because the current UI still renders native selects and the page-level search.

- [ ] **Step 3: Integrate one-open-at-a-time controller ownership**

```ts
let openCombobox: CharacterCombobox | null = null;
const closeOpenCombobox = () => {
  openCombobox?.close();
  openCombobox = null;
};
```

Remove `#character-search`, its cached element, query filtering, and input listener. During `renderSquad()`, destroy the prior open controller, create one combobox per slot, and update `deck.squad[index]` in `onSelect`. Preserve obsolete override cleanup, error clearing, tab counts, preview badges, and loadout editors.

- [ ] **Step 4: Close transient selectors on deck and mode changes**

Call `closeOpenCombobox()` before changing `activeDeckId`, before toggling five-deck mode, and from the mount disposer. Verify that a character can be selected in deck 2 even when deck 1 contains the same name.

- [ ] **Step 5: Run the UI and complete frontend suite**

Run: `cd site && npm test -- --run src/ui.test.ts`

Expected: UI tests PASS.

Run: `cd site && npm test -- --run`

Expected: all frontend tests PASS.

- [ ] **Step 6: Commit integration**

```bash
git add site/src/ui.ts site/src/ui.test.ts
git commit -m "feat: search characters inside squad slots"
```

### Task 3: Responsive visual treatment

**Files:**
- Modify: `site/src/styles.css`
- Modify: `site/src/ui.test.ts`

**Interfaces:**
- Consumes: component class names `.character-combobox`, `.character-trigger`, `.character-panel`, `.character-results`, `.character-option`, and `.burst-filter`.
- Produces: desktop overlay and narrow-screen viewport-safe layout without changing DOM behavior.

- [ ] **Step 1: Add a failing stylesheet contract test**

```ts
const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');
expect(css).toMatch(/\.character-panel\s*\{[^}]*position:\s*absolute/s);
expect(css).toMatch(/\.character-option\s*\{[^}]*min-height:\s*44px/s);
expect(css).not.toContain('.search-field');
```

- [ ] **Step 2: Run the stylesheet contract and confirm red**

Run: `cd site && npm test -- --run src/ui.test.ts`

Expected: FAIL because selector styles are absent.

- [ ] **Step 3: Implement desktop and mobile styles**

Give the open slot a raised stacking context, render the panel absolutely below the trigger with a constrained scroll area, style active/selected/disabled options distinctly, keep all option hit targets at least 44px, and expand the panel to available width below 600px. Remove obsolete `.search-field` and `.squad-slot select` rules.

- [ ] **Step 4: Run tests and production build**

Run: `cd site && npm test -- --run && npm run build`

Expected: all tests PASS and Vite emits `dist/` successfully.

- [ ] **Step 5: Commit responsive styles**

```bash
git add site/src/styles.css site/src/ui.test.ts
git commit -m "style: add character browser dropdown"
```

### Task 4: Full verification and GitHub Pages deployment

**Files:**
- Verify only: calculator test scripts, `site/dist/`, Git history, GitHub Actions, deployed site

**Interfaces:**
- Consumes: the complete static site from Tasks 1–3.
- Produces: a passing pushed commit and verified public GitHub Pages release.

- [ ] **Step 1: Run repository verification from a clean build**

Run the established Python calculator tests, bridge smoke test, snapshot/doc checks, frontend tests, runtime consistency checks, Pages checks, and production build. Every command must exit 0.

- [ ] **Step 2: Run local browser smoke tests**

Serve `site/dist/`, open it in Chrome, select a character through slot-local Korean search, exercise a burst filter, clear a slot, and verify that the calculate button still produces a result.

- [ ] **Step 3: Inspect the final diff and status**

Run: `git diff --check && git status --short --branch && git log --oneline -5`

Expected: no unstaged files, no whitespace errors, and the feature commits on `master`.

- [ ] **Step 4: Push and wait for GitHub Pages**

Run: `git push origin master`

Confirm the corresponding GitHub Actions Pages workflow completes successfully.

- [ ] **Step 5: Verify the deployed URL**

Open `https://moris-kr.github.io/nikke-calc/` in the user's signed-in Chrome session. Repeat search, selection, cross-deck duplicate, and calculation smoke tests against the public origin.
