# Searchable Character Combobox Design

## Goal

Make character selection fast without leaving the squad slot. Replace each native character `<select>` with an accessible searchable combobox that supports visual browsing, keyboard navigation, and the calculator's existing same-deck duplicate rule.

## Chosen approach

Use one custom combobox per squad slot. A compact trigger replaces the native select and shows the selected character name or “캐릭터 선택”. Activating the trigger opens a panel anchored to that slot with a focused search field, burst-stage filters, and a scrollable visual result list.

The current page-level “캐릭터 찾기” input is removed. It filters all five native selects at once and creates an indirect flow; search belongs to the slot currently being edited. Five-deck tabs and all character loadout editors keep their existing behavior.

A native select plus a separate search field was rejected because browsers cannot render arbitrary search, metadata, or portrait UI inside `<option>` elements. A full-screen modal was rejected as the default because it adds unnecessary navigation on desktop. On narrow screens the anchored panel may expand to the available viewport width while keeping the same combobox interaction model.

## Trigger and panel

Every slot contains a button with `aria-haspopup="listbox"`, `aria-expanded`, and `aria-controls`. It displays:

- selected character name, or “캐릭터 선택” for an empty slot;
- a short secondary label containing burst stage, element code, and weapon type;
- a disclosure mark indicating that the selector opens.

Opening a combobox closes any other open slot and focuses its search field. The panel contains:

1. an input labeled “캐릭터 검색”;
2. filter buttons for 전체, B1, B2, and B3;
3. a scrollable listbox;
4. a “슬롯 비우기” row that remains available regardless of the query.

Each character row shows its portrait, name, burst stage, element code, weapon type, and manufacturer. Filtering is case-insensitive and matches name, burst label, element code, weapon type, class, and manufacturer. The burst filter and text query combine with AND semantics. If no character matches, the panel shows a non-selectable “검색 결과가 없습니다” message.

## Selection rules

Selecting a character updates the same in-memory deck state used today, clears an obsolete settings override when a slot changes away from its previous character, clears validation messages, rerenders deck counts and slots, and closes the panel.

The same character may still appear in different decks. Within the active deck, a character already occupying another slot remains visible but disabled and carries a “편성 중” badge. The current slot's selected character remains selectable while editing that slot. “슬롯 비우기” removes the selection and its obsolete per-character overrides.

## Keyboard and dismissal behavior

- `Enter` or `Space` on the trigger opens the panel.
- `ArrowDown` and `ArrowUp` move an active option through enabled visible rows.
- `Enter` selects the active option.
- `Escape` closes the panel and restores focus to its trigger.
- `Home` and `End` move to the first and last enabled visible rows.
- Clicking outside the open slot closes the panel without changing the selection.
- Selecting an option closes the panel and restores focus to the trigger.

The search input uses `role="combobox"`, `aria-autocomplete="list"`, `aria-controls`, and `aria-activedescendant`. Results use `role="listbox"`; selectable rows use `role="option"`, `aria-selected`, and `aria-disabled` where applicable. Focus remains in the search field while the active option changes, which avoids DOM focus loss when filtering rerenders the list.

## Rendering and state

Only one combobox is open at a time. UI state consists of the open slot index, its query, its burst filter, and its active enabled option. Deck composition remains the source of truth and is not duplicated into a form control.

`renderSquad()` recreates cards as it does today, then restores the open combobox state for the active slot. A small selector component encapsulates trigger, panel, filtering, keyboard handling, and selection callbacks so the slot renderer does not own listbox details. Changing decks, toggling five-deck mode, or selecting a character closes the open panel and resets the transient query/filter.

Portrait paths continue to use `import.meta.env.BASE_URL`, preserving GitHub Pages subpath hosting. Images use lazy loading and an empty fallback tile when catalog artwork is unavailable.

## Responsive layout

On desktop, the panel is positioned below the trigger, overlays adjacent content, and is wide enough to display metadata without changing the height of other squad cards. The open slot receives a raised stacking context and does not move upward on hover.

On screens below the existing mobile breakpoint, the panel spans the slot width with a viewport-aware maximum height. Result rows use at least a 44px hit target, filter buttons remain horizontally usable, and long names truncate without hiding burst/duplicate status.

## Testing

TypeScript DOM tests cover:

- five combobox triggers rendering with the initial squad;
- opening a selector and autofocus of the search input;
- Korean name search and metadata search;
- combined burst-stage filtering;
- same-deck duplicate rows remaining visible but disabled;
- cross-deck duplicate allowance after switching decks;
- selection and slot clearing state updates;
- Arrow/Home/End/Enter/Escape keyboard behavior;
- outside-click dismissal;
- empty-result messaging and accessible roles/attributes.

Existing calculation, preview-badge, reset, cache, and multi-deck tests must be adapted from native-select events to the new selection helper without weakening their assertions. Production build and public browser smoke testing must verify selection by search in normal mode and reuse of the same character in another deck in five-deck mode.

## Deployment

No dependency or backend is added. After all unit, bridge, snapshot, build, and browser checks pass, commit and push to the configured GitHub repository, wait for the GitHub Pages workflow, and verify the deployed URL in the signed-in Chrome session.
