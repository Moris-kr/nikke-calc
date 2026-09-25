/**
 * 편성 화면의 두 창 — «최적큐브 찾기»와 «니케 경우의 수».
 *
 * 둘 다 **누르면 창이 먼저 열린다**. 무슨 순서로 몇 판을 돌리는지 읽고 나서 «계산 시작»을
 * 눌러야 돈다 — 판이 수십 개라 잘못 누르면 한참 기다리게 되고, 결과가 어떤 방식으로 나온
 * 값인지(한 자리씩 차례로 고른 것인지, 모든 조합인지)를 모르면 숫자를 잘못 읽는다.
 *
 * 전투 조건은 계산기 화면의 지금 값을 그대로 쓰고, 난수만 **기대값으로 고정**한다 —
 * 큐브 하나의 차이는 난수 흔들림보다 작을 때가 많다(`run`은 부르는 쪽이 만든다).
 */
import { cubeDisplayName } from './cube-names';
import { buildIndex, filterByQuery } from './nikke-search';
import { formatDamage } from './model';
import { t, tName } from './i18n';
import {
  countCases, deckForCase, findBestCubes, LabStopped, runCases,
  type CaseResult, type CubeSearchResult, type LabRunner,
} from './deck-lab';
import type { CharacterMeta, CharacterOverrides, CubeSelection, DeckState, SettingsCatalog } from './types';

/** 경우의 수 한도. 이 위로는 기다림이 너무 길어 돌리지 않는다. */
export const CASE_LIMIT = 200;
/** 큐브 레벨을 모를 때 가정하는 값. */
export const DEFAULT_CUBE_LEVEL = 15;

export interface DeckLabDeps {
  settings: SettingsCatalog;
  catalog: CharacterMeta[];
  /** 지금 보고 있는 덱(살아 있는 값 — 읽기만 한다). */
  activeDeck: () => DeckState;
  deckLabel: () => string;
  run: LabRunner;
  /** 새로 서는 니케의 설정 — 편성할 때와 같은 규칙(다른 덱 설정 → 불러온 로스터 → 기본). */
  overridesFor: (name: string) => CharacterOverrides | undefined;
  /** 불러온 육성·덱들에서 확인된 큐브별 레벨. */
  knownCubeLevels: () => Record<string, number>;
  /** 계산한 덱을 지금 덱에 쓴다. 막아야 하면 까닭을 돌려준다. */
  applyDeck: (next: DeckState) => string | null;
  imageOf?: (name: string) => string | undefined;
}

export interface DeckLabHandle {
  openCubeFinder(): void;
  openNikkeCases(): void;
  dispose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const signed = (value: number): string => `${value >= 0 ? '+' : ''}${formatDamage(value)}`;
const pct = (base: number, value: number): string => {
  if (!(base > 0)) return '—';
  const diff = (value / base - 1) * 100;
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%`;
};

/** 창 한 벌 — 머리·설명·본문. 닫기·Esc·바깥 누르기로 닫힌다. */
function modal(root: HTMLElement, title: string, key: string, onClose: () => void) {
  const wrap = el('div', 'custom-modal deck-lab-modal');
  wrap.hidden = true;
  wrap.dataset[key] = '';
  const card = el('div', 'custom-card deck-lab-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', title);
  const head = el('div', 'custom-head');
  head.append(el('h2', '', title));
  const close = el('button', 'custom-close', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', t('{name} 닫기', { name: title }));
  head.append(close);
  const body = el('div', 'deck-lab-body');
  card.append(head, body);
  wrap.append(card);
  root.append(wrap);
  const hide = () => { if (!wrap.hidden) { wrap.hidden = true; onClose(); } };
  close.addEventListener('click', hide);
  wrap.addEventListener('click', (event) => { if (event.target === wrap) hide(); });
  wrap.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); hide(); } });
  return { wrap, body, close, hide };
}

export function mountDeckLab(root: HTMLElement, deps: DeckLabDeps): DeckLabHandle {
  const cubeNames = Object.keys(deps.settings.cubes);
  const cubeLabel = (cube?: CubeSelection): string => {
    if (!cube || cube.name === '없음') return t('큐브 없음');
    return `${cubeDisplayName(tName(cube.name), deps.settings.cubes[cube.name]?.stat)} Lv${cube.level}`;
  };
  const defaultCube = (name: string): CubeSelection | undefined => deps.settings.characters[name]?.cube;
  const baseOverrides = (name: string): CharacterOverrides => {
    const defaults = deps.settings.characters[name];
    if (!defaults) return {};
    return {
      growthStage: defaults.growthStage,
      skillLevels: { ...defaults.skillLevels },
      overload: { ...defaults.overload },
      cube: { ...defaults.cube },
      collection: { ...defaults.collection },
      manualStats: {},
    };
  };

  // ── 최적큐브 찾기 ──────────────────────────────────────────────────────
  let cubeStop = false;
  let cubeRunning = false;
  const cube = modal(root, t('최적큐브 찾기'), 'cubeFinderModal', () => { cubeStop = true; });

  function renderCubeIntro(): void {
    const deck = deps.activeDeck();
    const members = deck.squad.filter(Boolean);
    cube.body.replaceChildren();
    const how = el('div', 'deck-lab-how');
    how.append(el('p', 'custom-desc', t('{deck}의 큐브를 아래 순서로 정합니다.', { deck: deps.deckLabel() })));
    const steps = el('ol', 'deck-lab-steps');
    for (const line of [
      t('지금 덱 그대로 덱 총딜을 한 번 잽니다.'),
      t('1번 자리 니케에 큐브를 하나씩 끼워 보며 덱 총딜을 잽니다. 다른 니케의 큐브는 그대로 둡니다.'),
      t('덱 총딜이 가장 높은 큐브를 끼웁니다. 지금 큐브보다 높을 때만 바꿉니다.'),
      t('그 큐브를 낀 채로 2번 → 5번 자리까지 같은 일을 차례로 반복합니다.'),
    ]) steps.append(el('li', '', line));
    how.append(steps);
    const notes = el('ul', 'deck-lab-notes');
    for (const line of [
      t('앞 자리부터 하나씩 정하는 방식이라 모든 조합을 다 보지는 않습니다. 자리 순서에 따라 결과가 조금 달라질 수 있습니다.'),
      t('전투 조건은 지금 화면 값을 쓰고, 난수는 기대값으로 고정합니다.'),
      t('계산기가 고유 효과를 아직 반영하지 않는 큐브는 스탯과 공통 효과만으로 비교됩니다.'),
      t('같은 큐브를 여러 니케에 끼울 수 있다고 보고 계산합니다.'),
    ]) notes.append(el('li', '', line));
    how.append(notes);
    cube.body.append(how);

    const levelRow = el('label', 'deck-lab-option');
    levelRow.append(el('span', '', t('큐브 레벨')));
    const level = el('select');
    level.dataset.cubeFinderLevel = '';
    const known = el('option', '', t('확인된 레벨 (모르면 Lv{n})', { n: DEFAULT_CUBE_LEVEL }));
    known.value = 'known';
    const max = el('option', '', t('모두 Lv{n}', { n: DEFAULT_CUBE_LEVEL }));
    max.value = 'max';
    level.append(known, max);
    levelRow.append(level);
    cube.body.append(levelRow);
    cube.body.append(el('p', 'custom-desc', t('확인된 레벨은 불러온 육성과 덱들에 끼워 둔 큐브에서 읽습니다.')));

    const runs = members.length * cubeNames.length + 1;
    const count = el('p', 'deck-lab-count', members.length
      ? t('니케 {n}명 × 큐브 {m}종 — 약 {runs}판을 돌립니다.', { n: members.length, m: cubeNames.length, runs })
      : t('편성된 니케가 없습니다.'));
    cube.body.append(count);

    const actions = el('div', 'deck-copy-actions');
    const start = el('button', 'deck-copy-apply', t('계산 시작'));
    start.type = 'button';
    start.dataset.cubeFinderStart = '';
    start.disabled = members.length === 0;
    actions.append(start);
    cube.body.append(actions);
    const status = el('p', 'deck-lab-status');
    status.dataset.cubeFinderStatus = '';
    status.setAttribute('aria-live', 'polite');
    cube.body.append(status);
    const output = el('div', 'deck-lab-output');
    output.dataset.cubeFinderOutput = '';
    cube.body.append(output);

    start.addEventListener('click', () => { void runCubeFinder(level.value === 'max', start, status, output); });
  }

  async function runCubeFinder(allMax: boolean, start: HTMLButtonElement, status: HTMLElement, output: HTMLElement): Promise<void> {
    if (cubeRunning) return;
    cubeRunning = true;
    cubeStop = false;
    start.disabled = true;
    output.replaceChildren();
    const known = allMax ? {} : deps.knownCubeLevels();
    const levelOf = (name: string): number => {
      const levels = Object.keys(deps.settings.cubes[name]?.levels ?? {}).map(Number).filter(Number.isFinite);
      const top = levels.length ? Math.max(...levels) : DEFAULT_CUBE_LEVEL;
      const wanted = known[name] ?? DEFAULT_CUBE_LEVEL;
      return Math.min(top, wanted);
    };
    const original = structuredClone(deps.activeDeck());
    status.textContent = t('계산 준비 중…');
    try {
      const result = await findBestCubes({
        deck: original, cubes: cubeNames, levelOf, defaultCube, baseOverrides, run: deps.run,
        stopped: () => cubeStop,
        onProgress: (done, total, slot, name) => {
          status.textContent = t('{slot}번 {name} · {done}/{total}판', { slot: slot + 1, name: tName(name), done, total });
        },
      });
      if (cubeStop) return;
      const blocked = deps.applyDeck(result.deck);
      renderCubeResult(result, original, blocked, status, output);
    } catch (error) {
      if (error instanceof LabStopped || cubeStop) status.textContent = t('중지했습니다.');
      else status.textContent = t('계산에 실패했습니다: {msg}', { msg: error instanceof Error ? error.message : String(error) });
    } finally {
      cubeRunning = false;
      start.disabled = false;
    }
  }

  function renderCubeResult(result: CubeSearchResult, original: DeckState, blocked: string | null,
    status: HTMLElement, output: HTMLElement): void {
    status.textContent = blocked
      ? t('계산은 끝났지만 적용하지 못했습니다: {msg}', { msg: blocked })
      : t('끝났습니다. 고른 큐브를 덱에 끼웠습니다.');
    const summary = el('p', 'deck-lab-summary');
    summary.dataset.cubeFinderSummary = '';
    summary.append(el('b', '', t('덱 총딜 {from} → {to}', { from: formatDamage(result.baseTotal), to: formatDamage(result.finalTotal) })),
      el('span', result.finalTotal > result.baseTotal ? 'is-up' : '', ` ${pct(result.baseTotal, result.finalTotal)}`));
    output.append(summary);
    const list = el('ol', 'deck-lab-cubes');
    for (const step of result.steps) {
      const item = el('li');
      item.dataset.cubeStep = String(step.slot + 1);
      if (step.changed) item.classList.add('is-changed');
      const head = el('div', 'deck-lab-cube-head');
      head.append(el('b', '', `${step.slot + 1}. ${tName(step.name)}`));
      head.append(el('span', '', step.changed
        ? `${cubeLabel(step.before)} → ${cubeLabel(step.after)}`
        : t('{cube} 유지', { cube: cubeLabel(step.before) })));
      head.append(el('span', step.changed ? 'is-up' : 'deck-lab-muted', step.changed
        ? `${signed(step.bestTotal - step.baseTotal)} (${pct(step.baseTotal, step.bestTotal)})` : t('변화 없음')));
      item.append(head);
      // 이 자리에서 잰 큐브 전부 — 1등만 보이면 2등과 얼마나 차이 나는지 알 수 없다.
      const more = el('details', 'deck-lab-trials');
      more.append(el('summary', '', t('큐브별 결과 {n}개', { n: step.trials.length })));
      const table = el('ol');
      for (const trial of step.trials) {
        const row = el('li');
        row.append(el('span', '', cubeLabel(trial.cube)));
        row.append(el('span', 'deck-lab-num', trial.total == null ? t('계산 실패') : `${formatDamage(trial.total)} (${pct(step.baseTotal, trial.total)})`));
        table.append(row);
      }
      more.append(table);
      item.append(more);
      list.append(item);
    }
    output.append(list);
    if (!blocked && result.steps.some((step) => step.changed)) {
      const actions = el('div', 'deck-copy-actions');
      const undo = el('button', 'deck-copy-cancel', t('원래 큐브로 되돌리기'));
      undo.type = 'button';
      undo.dataset.cubeFinderUndo = '';
      undo.addEventListener('click', () => {
        const back = deps.applyDeck(original);
        status.textContent = back ? t('되돌리지 못했습니다: {msg}', { msg: back }) : t('원래 큐브로 되돌렸습니다.');
        undo.disabled = !back;
      });
      actions.append(undo);
      output.append(actions);
    }
  }

  // ── 니케 경우의 수 ─────────────────────────────────────────────────────
  let caseStop = false;
  let caseRunning = false;
  let alternatives: string[][] = [[], [], [], [], []];
  let caseDeckId = -1;
  const cases = modal(root, t('니케 경우의 수'), 'nikkeCasesModal', () => { caseStop = true; });
  const names = deps.catalog.map((char) => char.name);
  const metaOf = new Map(deps.catalog.map((char) => [char.name, char]));
  const indexOf = (name: string) =>
    buildIndex(metaOf.get(name) ?? ({ name, aliases: [] } as unknown as CharacterMeta));

  function renderCasesIntro(): void {
    const deck = deps.activeDeck();
    // 덱을 바꿔 열면 후보를 비운다 — 다른 편성의 자리 번호에 붙은 후보는 뜻이 없다.
    if (caseDeckId !== deck.id) { alternatives = [[], [], [], [], []]; caseDeckId = deck.id; }
    cases.body.replaceChildren();
    const how = el('div', 'deck-lab-how');
    how.append(el('p', 'custom-desc', t('{deck}의 자리마다 바꿔 넣어 볼 니케를 고르면, 가능한 편성을 모두 만들어 하나씩 계산합니다.', { deck: deps.deckLabel() })));
    const notes = el('ul', 'deck-lab-notes');
    for (const line of [
      t('자리마다 «지금 니케 + 고른 후보» 중 하나씩을 곱한 모든 조합을 봅니다. 같은 니케가 두 자리에 서는 조합은 뺍니다.'),
      t('새로 들어가는 니케의 육성은 편성할 때와 같습니다 — 다른 덱에서 만진 설정, 없으면 불러온 육성, 없으면 기본값.'),
      t('전투 조건은 지금 화면 값을 쓰고, 난수는 기대값으로 고정합니다.'),
      t('한 번에 {n}개까지 계산합니다.', { n: CASE_LIMIT }),
    ]) notes.append(el('li', '', line));
    how.append(notes);
    cases.body.append(how);

    const slots = el('div', 'deck-lab-slots');
    const count = el('p', 'deck-lab-count');
    count.dataset.nikkeCasesCount = '';
    const start = el('button', 'deck-copy-apply', t('계산 시작'));
    start.type = 'button';
    start.dataset.nikkeCasesStart = '';
    const paintCount = () => {
      const n = countCases(deck.squad, alternatives);
      const any = alternatives.some((list) => list.length > 0);
      count.textContent = !any ? t('바꿔 볼 니케를 한 명 이상 고르세요.')
        : n > CASE_LIMIT ? t('경우의 수 {n}개 — {max}개를 넘어 계산할 수 없습니다. 후보를 줄여 주세요.', { n, max: CASE_LIMIT })
          : t('경우의 수 {n}개 (지금 편성 포함)', { n });
      count.classList.toggle('is-over', n > CASE_LIMIT);
      start.disabled = caseRunning || !any || n > CASE_LIMIT;
    };

    deck.squad.forEach((current, slot) => {
      const row = el('div', 'deck-lab-slot');
      row.dataset.caseSlot = String(slot + 1);
      const head = el('div', 'deck-lab-slot-head');
      head.append(el('b', '', `${slot + 1}`), el('span', '', current ? tName(current) : t('빈자리')));
      row.append(head);
      const chips = el('div', 'deck-lab-chips');
      const paintChips = () => {
        chips.replaceChildren();
        for (const name of alternatives[slot]!) {
          const chip = el('button', 'deck-lab-chip', `${tName(name)} ✕`);
          chip.type = 'button';
          chip.dataset.caseAlt = name;
          chip.title = t('후보에서 빼기');
          chip.addEventListener('click', () => {
            alternatives[slot] = alternatives[slot]!.filter((other) => other !== name);
            paintChips(); paintCount();
          });
          chips.append(chip);
        }
      };
      paintChips();
      row.append(chips);
      const search = el('input', 'deck-lab-search');
      search.type = 'search';
      search.placeholder = t('바꿔 볼 니케 추가 (이름 · 초성)');
      search.dataset.caseSearch = String(slot + 1);
      search.setAttribute('aria-label', t('{slot}번 자리 후보 찾기', { slot: slot + 1 }));
      const hits = el('div', 'deck-lab-hits');
      const paintHits = () => {
        hits.replaceChildren();
        const query = search.value.trim();
        if (!query) return;
        const shown = filterByQuery(names, query, indexOf)
          .filter((name) => name !== current && !alternatives[slot]!.includes(name)).slice(0, 8);
        for (const name of shown) {
          const hit = el('button', 'deck-lab-hit');
          hit.type = 'button';
          hit.dataset.caseHit = name;
          const image = deps.imageOf?.(name);
          if (image) {
            const img = el('img');
            img.src = image;
            img.alt = '';
            img.loading = 'lazy';
            hit.append(img);
          }
          hit.append(el('span', '', tName(name)));
          hit.addEventListener('click', () => {
            alternatives[slot] = [...alternatives[slot]!, name];
            search.value = '';
            paintHits(); paintChips(); paintCount();
            search.focus();
          });
          hits.append(hit);
        }
        if (!shown.length) hits.append(el('span', 'deck-lab-muted', t('맞는 니케가 없습니다.')));
      };
      search.addEventListener('input', paintHits);
      search.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        hits.querySelector<HTMLButtonElement>('.deck-lab-hit')?.click();
      });
      row.append(search, hits);
      slots.append(row);
    });
    cases.body.append(slots);
    const actions = el('div', 'deck-copy-actions');
    const clear = el('button', 'deck-copy-cancel', t('후보 모두 비우기'));
    clear.type = 'button';
    clear.addEventListener('click', () => { alternatives = [[], [], [], [], []]; renderCasesIntro(); });
    actions.append(start, clear);
    cases.body.append(count, actions);
    const status = el('p', 'deck-lab-status');
    status.dataset.nikkeCasesStatus = '';
    status.setAttribute('aria-live', 'polite');
    const output = el('div', 'deck-lab-output');
    output.dataset.nikkeCasesOutput = '';
    cases.body.append(status, output);
    paintCount();
    start.addEventListener('click', () => { void runNikkeCases(start, status, output, paintCount); });
  }

  async function runNikkeCases(start: HTMLButtonElement, status: HTMLElement, output: HTMLElement,
    paintCount: () => void): Promise<void> {
    if (caseRunning) return;
    caseRunning = true;
    caseStop = false;
    start.disabled = true;
    output.replaceChildren();
    const deck = structuredClone(deps.activeDeck());
    status.textContent = t('계산 준비 중…');
    try {
      const results = await runCases({
        deck, alternatives: alternatives.map((list) => [...list]), overridesFor: deps.overridesFor, run: deps.run,
        stopped: () => caseStop,
        onProgress: (done, total) => { status.textContent = t('{done}/{total}개 계산 중…', { done, total }); },
      });
      if (caseStop) return;
      status.textContent = t('끝났습니다. 덱 총딜이 높은 순입니다.');
      renderCaseResults(results, deck, status, output);
    } catch (error) {
      if (error instanceof LabStopped || caseStop) status.textContent = t('중지했습니다.');
      else status.textContent = t('계산에 실패했습니다: {msg}', { msg: error instanceof Error ? error.message : String(error) });
    } finally {
      caseRunning = false;
      paintCount();
    }
  }

  function renderCaseResults(results: CaseResult[], deck: DeckState, status: HTMLElement, output: HTMLElement): void {
    const base = results[0]?.total ?? null;
    const sorted = [...results].sort((a, b) => (b.total ?? -Infinity) - (a.total ?? -Infinity));
    const table = el('ol', 'deck-lab-cases');
    sorted.forEach((entry, rank) => {
      const row = el('li');
      row.dataset.caseRow = String(rank + 1);
      if (entry.changed.length === 0) row.classList.add('is-current');
      const head = el('div', 'deck-lab-case-head');
      head.append(el('b', 'deck-lab-rank', `${rank + 1}`));
      const squad = el('span', 'deck-lab-case-squad');
      entry.squad.forEach((name, slot) => {
        const who = el('span', entry.changed.includes(slot) ? 'is-swapped' : '', name ? tName(name) : t('빈자리'));
        const share = entry.total && name ? entry.charTotals[name] : undefined;
        if (share !== undefined && entry.total) who.title = `${formatDamage(share)} (${((share / entry.total) * 100).toFixed(1)}%)`;
        squad.append(who);
      });
      head.append(squad);
      const value = el('span', 'deck-lab-num');
      if (entry.total == null) value.textContent = t('계산 실패');
      else {
        value.append(el('b', '', formatDamage(entry.total)));
        if (entry.changed.length === 0) value.append(el('span', 'deck-lab-muted', ` ${t('지금 편성')}`));
        else if (base != null) {
          value.append(el('span', entry.total > base ? 'is-up' : 'is-down', ` ${pct(base, entry.total)}`));
        }
      }
      head.append(value);
      row.append(head);
      if (entry.error) row.append(el('p', 'deck-lab-muted', entry.error));
      if (entry.total != null && entry.changed.length > 0) {
        const apply = el('button', 'deck-lab-apply', t('이 편성 적용'));
        apply.type = 'button';
        apply.dataset.caseApply = String(rank + 1);
        apply.addEventListener('click', () => {
          const live = deps.activeDeck();
          // 창을 연 뒤 편성이 바뀌었으면 옛 편성 기준의 결과를 덮어쓰지 않는다.
          if (live.squad.join('|') !== deck.squad.join('|')) {
            status.textContent = t('계산한 뒤 편성이 바뀌어 적용하지 않았습니다. 다시 계산해 주세요.');
            return;
          }
          const blocked = deps.applyDeck(deckForCase(live, entry.squad, deps.overridesFor));
          status.textContent = blocked
            ? t('적용하지 못했습니다: {msg}', { msg: blocked })
            : t('{rank}위 편성을 {deck}에 적용했습니다.', { rank: rank + 1, deck: deps.deckLabel() });
          if (!blocked) cases.hide();
        });
        head.append(apply);
      }
      table.append(row);
    });
    output.append(table);
  }

  return {
    openCubeFinder() {
      if (cubeRunning) { cube.wrap.hidden = false; return; }
      renderCubeIntro();
      cube.wrap.hidden = false;
      cube.close.focus();
    },
    openNikkeCases() {
      if (caseRunning) { cases.wrap.hidden = false; return; }
      renderCasesIntro();
      cases.wrap.hidden = false;
      cases.body.querySelector<HTMLInputElement>('.deck-lab-search')?.focus();
    },
    dispose() {
      cubeStop = true;
      caseStop = true;
      cube.wrap.remove();
      cases.wrap.remove();
    },
  };
}
