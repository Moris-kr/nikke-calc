# GitHub Pages NIKKE Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish an AI-free, browser-only NIKKE squad calculator at `https://jgaram.github.io/nikke-calc/` using the existing Python simulation engine.

**Architecture:** A Vite/TypeScript single-page UI sends validated requests to one classic Web Worker. The worker loads pinned Pyodide, copies the repository's Python engine and JSON tables into Pyodide's virtual filesystem, runs `context.spec` and `calculator.timeline.simulate`, then returns a compact JSON result. GitHub Actions builds `site/dist` and deploys it to Pages.

**Tech Stack:** TypeScript 7, Vite 8, Vitest 4, vanilla DOM/CSS, Pyodide 0.27.7, GitHub Pages Actions

## Global Constraints

- Runtime calculation must use no AI API, backend, database, login, analytics, or user-data collection.
- Only real characters present in `data/parsed_skills.json` are selectable; exclude `test_` entries.
- Preview characters must display a visible unverified warning.
- Simulations run in one Web Worker so Python's process-global RNG cannot interleave across requests.
- Battle duration is limited to 10–180 seconds, squads to 1–5 unique members, defense to 0–999999, core diameter to 0–1000 px, and seed to 0–2147483647.
- The production Vite base path is `/nikke-calc/`.
- The existing Python engine and source JSON remain the source of truth; generated browser runtime files are not edited by hand.

---

## File Structure

- `site/package.json`: development, test, sync, build, and preview scripts.
- `site/vite.config.ts`: GitHub Pages base path and Vitest configuration.
- `site/index.html`: semantic mount point and Korean metadata.
- `site/src/types.ts`: request, result, catalog, and worker protocol types.
- `site/src/model.ts`: validation, request normalization, cache key, and formatting functions.
- `site/src/model.test.ts`: unit tests for all model boundaries.
- `site/src/worker-client.ts`: single-request queue and worker message correlation.
- `site/src/main.ts`: application state, DOM rendering, events, cache, and result UI.
- `site/src/styles.css`: responsive visual system and accessible states.
- `site/public/calculator.worker.js`: Pyodide bootstrap, virtual filesystem loader, and Python bridge.
- `site/scripts/sync-runtime.mjs`: deterministic engine/data/image copy plus catalog/manifest generation.
- `site/scripts/check-runtime.mjs`: verifies every manifest file and catalog image before builds.
- `site/public/runtime/`: generated browser engine and data, ignored by Git.
- `site/public/characters/`: generated supported-character portraits, ignored by Git.
- `.github/workflows/pages.yml`: build and Pages deployment.
- `.gitignore`: generated site assets and package output.
- `README.md`: local run, verification, architecture, and deployment notes.

---

### Task 1: Site model and deterministic runtime sync

**Files:**
- Create: `site/package.json`
- Create: `site/tsconfig.json`
- Create: `site/vite.config.ts`
- Create: `site/index.html`
- Create: `site/src/types.ts`
- Create: `site/src/model.ts`
- Create: `site/src/model.test.ts`
- Create: `site/scripts/sync-runtime.mjs`
- Create: `site/scripts/check-runtime.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `validateRequest(request: SimulationRequest): string[]`
- Produces: `normalizeRequest(request: SimulationRequest): SimulationRequest`
- Produces: `cacheKey(request: SimulationRequest, version: string): string`
- Produces: `formatDamage(value: number): string`
- Produces: `site/public/catalog.json` as `CharacterMeta[]`
- Produces: `site/public/runtime/manifest.json` as `{ version: string; files: string[] }`

- [x] **Step 1: Write failing model tests**

```ts
import { describe, expect, it } from 'vitest';
import { cacheKey, formatDamage, normalizeRequest, validateRequest } from './model';

const valid = {
  squad: ['리타'], duration: 180, enemyDef: 31784,
  enemyCode: '', corePx: 0, hasParts: false, seed: 42,
};

it('rejects duplicate and out-of-range input', () => {
  expect(validateRequest({ ...valid, squad: ['리타', '리타'], duration: 181 }))
    .toEqual(expect.arrayContaining(['같은 캐릭터를 두 번 편성할 수 없습니다.', '전투 시간은 10~180초여야 합니다.']));
});

it('normalizes values before creating a stable cache key', () => {
  expect(cacheKey(normalizeRequest(valid), 'v1')).toBe(cacheKey({ ...valid }, 'v1'));
});

it('formats large damage in Korean units', () => {
  expect(formatDamage(3_207_003_887)).toBe('32.07억');
});
```

- [x] **Step 2: Run tests and confirm the missing-module failure**

Run: `cd site && npm install && npm test -- --run`

Expected: FAIL because `src/model.ts` does not exist.

- [x] **Step 3: Implement the minimal typed model**

Implement exact interfaces in `types.ts`:

```ts
export type ElementCode = '' | '풍압' | '수냉' | '작열' | '전격' | '철갑';
export interface SimulationRequest {
  squad: string[]; duration: number; enemyDef: number; enemyCode: ElementCode;
  corePx: number; hasParts: boolean; seed: number;
}
export interface CharacterMeta {
  name: string; burstStage: string; elementCode: string; weaponType: string;
  className: string; manufacturer: string; preview: boolean; image: string | null;
}
export interface SimulationResult {
  squadTotal: number; duration: number; hitCount: number;
  charTotals: Record<string, number>; previewNote: string; deviations: string;
}
```

Implement strict numeric bounds, duplicate detection, sorted-object JSON cache keys, and Korean damage formatting in `model.ts`.

- [x] **Step 4: Implement runtime sync and verification**

`sync-runtime.mjs` must copy these exact source sets:

```js
const runtimeFiles = [
  'calculator/__init__.py', 'calculator/base_stat.py', 'calculator/buff_manager.py',
  'calculator/damage.py', 'calculator/sim_result.py', 'calculator/timeline.py',
  'context/spec.py', 'data/parsed_nikke.json', 'data/parsed_skills.json',
  'data/char_defaults.json', 'data/weapon_delays.json', 'data/weapon_mechanics.json',
  'data/base_stat_tables/affinity.json', 'data/base_stat_tables/collection.json',
  'data/base_stat_tables/console.json', 'data/base_stat_tables/cube.json',
  'data/base_stat_tables/equipment_skills.json', 'data/base_stat_tables/equipment_stats.json',
  'data/base_stat_tables/level_stats.json',
];
```

Generate the catalog from the intersection of parsed character metadata and parsed skill keys, excluding names beginning with `test_`. Resolve images using the repository filename rule that replaces `\\/:*?\"<>|` with `_`. Hash copied runtime content for `manifest.version`.

- [x] **Step 5: Run unit and runtime checks**

Run: `cd site && npm run sync-runtime && npm test -- --run && npm run check-runtime`

Expected: unit tests pass; catalog contains 77 real characters; every manifest file exists.

- [x] **Step 6: Commit**

```bash
git add .gitignore site/package.json site/package-lock.json site/tsconfig.json site/vite.config.ts site/index.html site/src/types.ts site/src/model.ts site/src/model.test.ts site/scripts
git commit -m "feat: scaffold browser calculator runtime"
```

---

### Task 2: Pyodide worker bridge and queued client

**Files:**
- Create: `site/public/calculator.worker.js`
- Create: `site/src/worker-client.ts`
- Create: `site/src/worker-client.test.ts`
- Create: `site/scripts/smoke-runtime.py`

**Interfaces:**
- Consumes: `SimulationRequest`, `SimulationResult`, and `runtime/manifest.json` from Task 1.
- Produces: `CalculatorWorkerClient` with `prepare(): Promise<void>`, `simulate(request): Promise<SimulationResult>`, and `dispose(): void`.
- Worker messages: `{ id, type: 'prepare' | 'simulate', payload? }` and `{ id, type: 'ready' | 'progress' | 'result' | 'error', payload? }`.

- [ ] **Step 1: Write failing worker-client tests with a fake Worker**

```ts
it('matches an out-of-order response to the request id', async () => {
  const fake = new FakeWorker();
  const client = new CalculatorWorkerClient(() => fake as unknown as Worker);
  const pending = client.simulate(validRequest);
  fake.respond({ id: fake.lastId, type: 'result', payload: expectedResult });
  await expect(pending).resolves.toEqual(expectedResult);
});

it('rejects a worker error and remains usable', async () => {
  const first = client.simulate(validRequest);
  fake.respond({ id: fake.lastId, type: 'error', payload: '실패' });
  await expect(first).rejects.toThrow('실패');
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `cd site && npm test -- --run src/worker-client.test.ts`

Expected: FAIL because `CalculatorWorkerClient` is missing.

- [ ] **Step 3: Implement the client and classic worker**

The worker must pin:

```js
const PYODIDE_VERSION = '0.27.7';
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
```

It loads all manifest files under `/app`, inserts `/app` into `sys.path`, and defines one Python `run_request(raw: str) -> str` bridge. The bridge uses `build_squad`, `build_config`, and `simulate`, returning only totals, duration, hit count, preview note, and deviation text. All messages are handled serially by the worker event loop.

- [ ] **Step 4: Add a native-Python smoke runner for the same payload**

`smoke-runtime.py` must add `site/public/runtime` to `sys.path`, run a 10-second one-character request with seed 42, and assert positive total damage, positive hit count, and the requested duration.

- [ ] **Step 5: Run client tests and native bridge smoke**

Run: `cd site && npm test -- --run src/worker-client.test.ts && python3 scripts/smoke-runtime.py`

Expected: both commands exit 0 and the smoke runner prints a positive result summary.

- [ ] **Step 6: Commit**

```bash
git add site/public/calculator.worker.js site/src/worker-client.ts site/src/worker-client.test.ts site/scripts/smoke-runtime.py
git commit -m "feat: run calculator in a browser worker"
```

---

### Task 3: Responsive calculator UI and local result cache

**Files:**
- Create: `site/src/main.ts`
- Create: `site/src/styles.css`
- Create: `site/src/cache.ts`
- Create: `site/src/cache.test.ts`
- Modify: `site/index.html`

**Interfaces:**
- Consumes: `catalog.json`, `CalculatorWorkerClient`, model helpers, and `SimulationResult`.
- Produces: `ResultCache.get(key): SimulationResult | null`, `set(key, result): void`, and `clear(): void`.
- Produces: a single-page DOM application mounted at `#app`.

- [ ] **Step 1: Write failing bounded-cache tests**

```ts
it('evicts the oldest result after 12 entries', () => {
  const storage = new MemoryStorage();
  const cache = new ResultCache(storage, 'v1', 12);
  for (let i = 0; i < 13; i += 1) cache.set(`k${i}`, result(i));
  expect(cache.get('k0')).toBeNull();
  expect(cache.get('k12')).not.toBeNull();
});

it('ignores malformed stored JSON', () => {
  storage.setItem('nikke-calc-results', '{bad');
  expect(new ResultCache(storage, 'v1').get('x')).toBeNull();
});
```

- [ ] **Step 2: Run the focused cache test and confirm failure**

Run: `cd site && npm test -- --run src/cache.test.ts`

Expected: FAIL because `ResultCache` is missing.

- [ ] **Step 3: Implement the cache and full application state**

The page must render five selectable squad slots, a searchable character picker, duration/defense/code/core/parts/seed controls, accessible validation text, a progress status region with `aria-live="polite"`, and a disabled calculate button while running. Cache only successful results and include the manifest version in each key.

- [ ] **Step 4: Implement the result and error views**

Render total damage, squad DPS, per-character damage/DPS/share bars, hit count, preview warning, deviation text, and retryable initialization errors. Use `textContent` for all dynamic strings.

- [ ] **Step 5: Implement responsive visual styling**

Use a dark navy surface, warm amber primary action, cyan data accents, large numeric results, portrait-led squad slots, visible focus rings, reduced-motion support, and one-column layout below 760px. Do not add model-generated SVG or decorative remote imagery.

- [ ] **Step 6: Run tests and production build**

Run: `cd site && npm test -- --run && npm run build`

Expected: all tests pass and `dist/index.html` references `/nikke-calc/` assets.

- [ ] **Step 7: Commit**

```bash
git add site/src/main.ts site/src/styles.css site/src/cache.ts site/src/cache.test.ts site/index.html
git commit -m "feat: add interactive squad calculator UI"
```

---

### Task 4: Pages deployment and project documentation

**Files:**
- Create: `.github/workflows/pages.yml`
- Create: `README.md`
- Modify: `site/package.json`

**Interfaces:**
- Consumes: `site/dist` from Tasks 1–3.
- Produces: a Pages artifact deployed by `actions/deploy-pages` from `master`.

- [ ] **Step 1: Add a deployment configuration check**

Add `site/scripts/check-pages.mjs` that parses `.github/workflows/pages.yml` as text and asserts it contains `actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages`, `working-directory: site`, and `npm ci`.

- [ ] **Step 2: Run the check and confirm failure**

Run: `cd site && node scripts/check-pages.mjs`

Expected: FAIL because `.github/workflows/pages.yml` is missing.

- [ ] **Step 3: Add the official GitHub Pages workflow**

Use `permissions: { contents: read, pages: write, id-token: write }`, one concurrency group named `pages`, Node 22, `npm ci`, `npm test -- --run`, `npm run build`, artifact path `site/dist`, and the official Pages deployment action.

- [ ] **Step 4: Document ownership and operation**

README must explain the browser-only architecture, supported-roster rule, local start, full verification commands, runtime sync, deployment URL, and unofficial-fan-tool disclaimer. It must not claim affiliation with SHIFT UP or Level Infinite.

- [ ] **Step 5: Run deployment check and all fast verification**

Run: `cd site && node scripts/check-pages.mjs && npm test -- --run && npm run check-runtime && npm run build`

Expected: every command exits 0.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/pages.yml README.md site/package.json site/scripts/check-pages.mjs
git commit -m "ci: deploy calculator to GitHub Pages"
```

---

### Task 5: End-to-end verification and publication

**Files:**
- Modify only files required by verified failures.

**Interfaces:**
- Consumes: the complete site and GitHub repository authentication.
- Produces: verified public URL `https://jgaram.github.io/nikke-calc/`.

- [ ] **Step 1: Run existing engine verification**

Run: `python3 calculator/damage.py && python3 -m context.doclint && python3 -m context.snapshot`

Expected: 8 damage checks pass, doclint reports `결과: OK`, and snapshots report `25/25 통과`.

- [ ] **Step 2: Start preview and verify the real browser flow**

Run: `cd site && npm run dev -- --host 127.0.0.1`

In the browser, confirm: catalog loads; five unique characters can be selected; duplicate selection is unavailable; a 10-second seeded calculation completes; total and character rows are positive; refreshing and rerunning the same request returns the cached result; keyboard focus is visible; the layout has no horizontal overflow at 390px width.

- [ ] **Step 3: Verify final repository state**

Run: `git status --short && git diff --check && git log --oneline -5`

Expected: only intentional changes are committed and `git status --short` is empty.

- [ ] **Step 4: Push and enable Pages**

Push `master` to `origin`. If command-line authentication is unavailable, use the signed-in GitHub browser to publish the branch and set Pages source to GitHub Actions. This external write is authorized by the user's explicit deployment request.

- [ ] **Step 5: Wait for deployment and verify production**

Wait for the Pages workflow to succeed, open `https://jgaram.github.io/nikke-calc/`, repeat the 10-second seeded calculation, and verify all worker/runtime asset requests return 200 under `/nikke-calc/`.

- [ ] **Step 6: Report handoff**

Return the public URL, supported-character count, verification summary, and the one-command local development entry point. Report any remaining legal/IP caveat without presenting it as legal advice.
