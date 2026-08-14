# Character Loadouts and Multi-Deck Design

## Goal

Extend the static NIKKE calculator so every character can use explicit overload, core, advanced numeric, and Harmony Cube settings, while optionally simulating five independent decks in one run. The deployed service remains a browser-only GitHub Pages application with no AI or backend dependency.

## Formula audit

The current engine follows the supplied NIKKE damage structure: motion coefficient × effective ATK/DEF × additive damage group × charge multiplier × typed damage modifiers × received/split group × elemental multiplier. Its baseline critical chance is 15%, baseline critical damage is +50%, and elemental advantage is 110% plus elemental-code bonuses.

This feature does not replace that damage pipeline. It exposes previously hidden per-character inputs and feeds them through the existing equipment, cube, and buff aggregation paths. The existing `element_code_override` data field remains a separately documented engine limitation and is not silently approximated here.

## Confirmed behavior

### Per-character settings

Each occupied squad slot shows a compact summary. Enabling “개별 설정” reveals final-value inputs for:

- 우월 코드 대미지: default 88.60%
- 공격력: default 22.22%
- 최대 장탄수: default 129.64%
- 크리티컬 확률: default 0%
- 크리티컬 대미지: default 0%

The UI must display the actual resolved defaults from Python layering, including character exceptions such as 0% max-ammo defaults or Mihara's 23.22% ATK. Values replace the corresponding overload total; they are not added on top of hidden defaults.

Every character also selects one of the five engine-supported Harmony Cubes and a level from 1 through 15:

- 재장: reload speed
- 탄충: ammunition recovery every ten shots
- 체력: max HP
- 차속: charge speed
- 파츠: part damage

All five also receive the cube table's common elemental bonus at the selected level. The UI shows the cube's flat ATK/DEF/HP contribution and the selected-level unique/common effects. Default remains 재장 Lv15.

### Advanced numeric mode

“고급 모드” is nested under each character's settings. It provides a searchable add-stat selector, an editable value for every added row, units, and removal. A stat may appear only once per character.

The registry includes every numeric value that the existing engine can safely express as a personal continuous modifier, including attack/defense/HP, critical, core, normal/skill/burst/charge/pierce/DoT/split/part/projectile/sequential damage, elemental/received damage, reload/charge/attack speed, accuracy, ammo, cooldown, pellets, full-burst duration, and lifesteal. It also includes the event statistic “10발마다 탄환 충전”. Boolean state, immunity, taunt, persona, weapon-change, and trigger-only mechanics are excluded because a bare number cannot define their semantics correctly.

Advanced values are additions after the selected overload and cube values. A +20 split-damage row affects only damage dealt by that character. Enemy-oriented values exposed in this personal editor, such as received-damage and enemy-defense-down, are interpreted as personal outgoing modifiers so they do not alter teammates.

### Core and enemy reset

Core is controlled by a checkbox. Unchecked sends a 0px core. Checked exposes an editable numeric diameter whose initial/reference value is 52px. Changing it affects all decks because battle conditions are shared.

“적 수치 초기화” resets only enemy settings:

- defense: 31,784
- code: none
- core: off, with editable reference restored to 52px
- parts: off

It does not reset squad composition, per-character loadouts, duration, or seed.

### Five-deck mode

A mode toggle switches between normal mode and five-deck mode. Five-deck mode uses tabs labeled 덱 1 through 덱 5, each containing one to five character slots and independent character settings. Empty decks are skipped.

The same character may appear in different decks. A duplicate within one deck remains invalid because the simulator indexes runtime state by character name and the game does not permit same-team duplicates.

Non-empty decks run sequentially through the existing worker. Progress is reported as `덱 x/y`, per-deck cache keys include all character settings, and prior completed results remain reusable. The result view displays the five-deck total, each deck's total and DPS, and per-character contributions within that deck.

## Data flow

The build exports a runtime settings catalog from the Python canonical data. For each character it contains the fully layered equipment and cube defaults. It also contains the five cube level tables and the validated advanced-stat registry used by both UI and Python validation.

The browser stores deck state as character selections plus optional overrides. For each simulation it constructs the existing single-squad payload with:

```json
{
  "squad": ["character name"],
  "characters": {
    "character name": {
      "equipment": {},
      "cube": {"name": "재장", "level": 15},
      "manual_stats": {"split_dmg_pct": 20}
    }
  },
  "duration": 60,
  "enemyDef": 31784,
  "enemyCode": "",
  "corePx": 0,
  "hasParts": false,
  "seed": 42
}
```

The bridge calls `build_squad(names, characters)` so Python remains responsible for default layering. It validates names, cube choices/levels, overload values, and advanced-stat keys before simulation. The UI validates the same ranges for immediate feedback, but Python is authoritative.

The multi-deck wrapper is UI-only orchestration. The worker and Python bridge continue to simulate one squad per request, avoiding a second simulation protocol and keeping error isolation and caching simple.

## Equipment semantics

The five overload values map to the existing final `equip_skills` totals:

- 우월 코드 → `element_bonus_pct`
- 공격력 → `atk_pct`
- 최대 장탄수 → `max_ammo_pct`
- 크리티컬 확률 → `crit_rate`
- 크리티컬 대미지 → `crit_dmg`

When custom settings are enabled, those totals replace only their matching equipment options while preserving unrelated character defaults. Disabling custom settings removes the UI overrides and returns to the canonical resolved defaults.

## Cube correction

The existing cube builder treats all cube rows as passive buffs. That is correct for 재장, 체력, 차속, 파츠, and the common element bonus, but not 탄충. 탄충 must be registered as an instant self effect triggered by `hit_count:10`, allowing the already-existing timeline handler to restore the configured flat ammunition amount. A focused regression test must prove both the trigger cadence and no battle-start-only application.

## Validation and errors

- A non-empty deck contains one through five distinct character names.
- Decks may reuse names from other decks.
- At least one deck must be non-empty.
- Duration, enemy defense, core pixels, and seed retain existing bounds.
- Cube name is one of the five choices and level is an integer from 1 through 15.
- Equipment and advanced numbers must be finite and stay inside their registry bounds.
- A failed deck reports its deck label and stops the batch without discarding already rendered successful deck results.

## Persistence and caching

The page retains its current local simulation cache. Cache keys include the normalized `characters` object, so loadout, cube, or advanced-stat changes never reuse incompatible results. UI selections remain in memory while switching tabs or mode; no account or remote storage is introduced.

## Testing and deployment

Python tests cover canonical default resolution, override replacement, manual-stat aggregation, validation, and 탄충 cadence. TypeScript tests cover payload normalization, per-deck duplicate rules, cross-deck duplicate allowance, enemy reset, cache-key sensitivity, and result aggregation. The existing bridge test confirms the extended payload end to end.

Before deployment, run the Python calculator self-tests, bridge smoke test, context snapshot/doc lint, Vitest suite, production build, and browser smoke test for normal mode and five-deck mode. Commit and push to the configured GitHub repository, wait for the Pages workflow, then verify the public URL.
