# Per-Slot Character Filter Design

## Goal

Make characters easier to find while preserving the browser's familiar native dropdown. Each squad slot gets its own compact `필터` search input immediately above its character select.

## Confirmed behavior

- The page-level character search is removed.
- Every one of the five visible squad slots renders `필터 [이름 검색]` above its native select.
- Typing filters only that slot's options; the other four selects are unchanged.
- Search is case-insensitive and matches character name, burst label, element code, weapon type, class, and manufacturer.
- The empty option and the slot's current character remain visible even when they do not match the query, preventing an in-progress selection from being lost.
- Characters used by another slot in the same deck remain disabled.
- The same character remains available in another deck.
- Filter text is stored independently for every slot in every deck while the page is open.
- Changing a selection preserves existing preview-badge, character override cleanup, deck count, calculation, and validation behavior.

## Accessibility and layout

The filter is a labeled `type="search"` input and each select retains its slot-specific accessible label. Native select keyboard and assistive-technology behavior is not reimplemented. The compact filter row uses the existing card width and continues to work inside the horizontally scrollable squad layout.

## Testing and deployment

DOM tests verify five input/select pairs, filter placement, slot-local filtering, current-selection preservation, same-deck duplicate disabling, cross-deck duplicate allowance, slot clearing, and preview updates. The complete frontend, Python, bridge, snapshot, runtime, Pages, production-build, and browser smoke checks run before the GitHub Pages deployment.
