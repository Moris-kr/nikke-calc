# Character Skill Levels Design

## Goal

Allow every released character to use independently selected Skill 1, Skill 2, and Burst Skill levels from 1 through 10. Characters whose source data exposes only level 10 remain visibly locked at level 10 instead of using invented interpolation.

## Canonical-data audit

The calculator engine already resolves effects through `skill_levels` keys `"1"`, `"2"`, and `"3"`, with defaults of 10 for all three. The parsed skill catalog contains complete level 1–10 numeric tables for every released character. The only roster entries with level-10-only numeric data are the two current preview characters:

- 니지마 마코토
- 아마기 유키코

`context.spec.build_char()` already rejects non-10 skill levels for preview characters. This feature keeps that validation authoritative and exposes the distinction in the browser catalog and UI.

## Confirmed behavior

Every occupied character card includes skill-level information in its compact summary:

- released character: `스킬 10 / 10 / 10` or the selected values;
- preview character: `수치 미공개 · Lv10 고정`.

Enabling the existing `개별 설정` toggle reveals a `스킬 레벨` section before overload and cube settings. Released characters receive three native selects:

- 스킬 1: Lv1–Lv10;
- 스킬 2: Lv1–Lv10;
- 버스트: Lv1–Lv10.

All default to Lv10 and can be changed independently. Preview characters receive no editable select; the section displays `수치 미공개 · Lv10 고정` and explains that levels 1–9 are not calculated because their coefficients are absent from the source.

Disabling `개별 설정` removes all character overrides, including skill levels, and returns to canonical 10/10/10. Existing overload, cube, advanced numeric, five-deck, duplicate, cache, and calculation behavior remains unchanged.

## Data model and flow

The browser payload extends a character override with:

```json
{
  "skillLevels": {"1": 7, "2": 10, "3": 9}
}
```

TypeScript represents this as a required three-key `SkillLevels` object whenever custom character settings are enabled. The runtime settings catalog exports each character's resolved default levels and a `skillLevelsLocked` boolean derived from canonical preview metadata.

`calculator.customization.normalize_character_overrides()` accepts `skillLevels`, verifies that it is an object containing only keys `1`, `2`, and `3`, and requires every supplied value to be an integer from 1 through 10. It maps the browser field to the engine field `skill_levels`. The existing `context.spec.build_squad()` merge then supplies those levels to BuffManager and Timeline without a second skill-scaling implementation.

The bridge remains authoritative. A forged non-10 preview payload passes numeric schema validation but is rejected by `context.spec.build_char()` with the existing preview-specific error. The UI also refuses such state before simulation for immediate feedback.

## Runtime catalog

`site/scripts/export-settings.py` adds the following to every `characters[name]` entry:

```json
{
  "skillLevels": {"1": 10, "2": 10, "3": 10},
  "skillLevelsLocked": false
}
```

Preview entries set `skillLevelsLocked` to `true`. Locking is not inferred from names in TypeScript, so future preview roster changes remain data-driven.

## Validation and caching

- Each released skill level must be an integer from 1 through 10.
- Locked characters must remain exactly 10/10/10.
- Unknown skill keys or non-numeric/boolean/fractional values are rejected by Python.
- Character settings outside the current squad remain rejected.
- Cache keys already include the normalized `characters` object, so different skill-level combinations cannot reuse incompatible results.
- Five decks retain independent character overrides; the same character may use different skill levels in different decks.

## Testing

Python tests cover browser schema normalization, invalid keys/ranges/types, released level forwarding, preview level-10 acceptance, preview non-10 rejection, and an engine effect whose value differs between levels 1 and 10.

TypeScript tests cover exported catalog metadata, default 10/10/10 creation, summary text, independent control changes, preview lock copy, request forwarding, UI validation, cache-key sensitivity, and different levels for the same character across decks.

Before deployment, run the Python customization and bridge suites, damage checks, document lint, 25 snapshots, all frontend tests, runtime and Pages checks, TypeScript production build, and Chrome smoke tests. Public Chrome verification changes a released character's skill levels, runs a calculation, confirms a preview character is locked, and verifies cross-deck independence.

## Deployment

No dependency, backend, AI, or account storage is added. Commit to the configured `master`, push to GitHub, wait for the Pages workflow, and verify `https://moris-kr.github.io/nikke-calc/` after deployment.
