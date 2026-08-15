import { ResultCache, type StorageLike, type StorageSource } from './cache';
import { renderCharacterSettings } from './character-settings';
import { parseRosterCsv } from './csv-import';
import { createTimelineBlock } from './timeline';
import {
  aggregateDeckResults,
  cacheKey,
  formatDamage,
  formatDps,
  requestForDeck,
  resetEnemy,
  validateDecks,
  validateRequest,
} from './model';
import type {
  BatchResult,
  BattleSettings,
  CharacterMeta,
  CharacterOverrides,
  DeckResultEntry,
  DeckState,
  SettingsCatalog,
  SimulationRequest,
  SimulationResult,
} from './types';

const DEFAULT_SQUAD = ['리타', '크라운', '라피 : 레드 후드', '앨리스', '나가'];

export interface CalculatorClientLike {
  prepare(): Promise<void>;
  simulate(request: SimulationRequest): Promise<SimulationResult>;
  dispose(): void;
}

interface CalculatorDependencies {
  catalog: CharacterMeta[];
  settings: SettingsCatalog;
  version: string;
  client: CalculatorClientLike;
  storage: StorageSource;
}

const element = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`화면 요소를 찾을 수 없습니다: ${selector}`);
  return found;
};

const createText = (tag: keyof HTMLElementTagNameMap, value: string, className?: string) => {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
};

// Pyodide 오류는 긴 파이썬 트레이스백으로 온다. 마지막 줄(실제 오류 메시지)만 보여준다.
const cleanEngineError = (raw: string): string => {
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? raw;
  return last.length <= 300 ? last : `${last.slice(0, 300)}…`;
};

function initialSquad(catalog: CharacterMeta[]): string[] {
  const available = new Set(catalog.map((char) => char.name));
  const defaults = DEFAULT_SQUAD.filter((name) => available.has(name));
  const fallback = catalog.map((char) => char.name).filter((name) => !defaults.includes(name));
  return [...defaults, ...fallback].slice(0, 5);
}

const emptyDeck = (id: number): DeckState => ({
  id,
  squad: ['', '', '', '', ''],
  characters: {},
});

function renderCharacterRows(container: HTMLElement, entry: DeckResultEntry): void {
  const rows = document.createElement('div');
  rows.className = 'result-rows';
  for (const name of entry.request.squad) {
    const value = entry.result.charTotals[name] ?? 0;
    const share = entry.result.squadTotal > 0 ? value / entry.result.squadTotal * 100 : 0;
    const row = document.createElement('article');
    row.className = 'character-result';
    row.dataset.characterResult = '';
    const top = document.createElement('div');
    top.className = 'result-row-top';
    const identity = document.createElement('div');
    identity.append(createText('h3', name), createText('span', `${share.toFixed(1)}% 기여`));
    const values = document.createElement('div');
    values.append(
      createText('strong', formatDamage(value)),
      createText('small', formatDps(value / entry.result.duration)),
    );
    top.append(identity, values);
    const track = document.createElement('div');
    track.className = 'share-track';
    const bar = document.createElement('i');
    bar.style.width = `${Math.max(1, share)}%`;
    track.append(bar);
    row.append(top, track);
    rows.append(row);
  }
  container.append(rows);
}

export function mountCalculator(root: HTMLElement, deps: CalculatorDependencies): () => void {
  const { catalog, settings, version, client, storage } = deps;
  const cache = new ResultCache(storage, version, 30);
  const catalogByName = new Map(catalog.map((char) => [char.name, char]));
  const decks = Array.from({ length: 5 }, (_, index) => emptyDeck(index + 1));
  const characterFilters = Array.from({ length: 5 }, () => Array<string>(5).fill(''));
  decks[0]!.squad = initialSquad(catalog);
  let activeDeckId = 1;
  let fiveDeckMode = false;
  let activity: 'preparing' | 'ready' | 'running' | 'complete' | 'cached' | 'error' = 'preparing';

  const ROSTER_KEY = 'nikke-roster-v1';
  const resolveStorage = (): StorageLike | null => {
    const source = typeof storage === 'function' ? storage() : storage;
    return source ?? null;
  };
  const cloneOverride = (value: object): CharacterOverrides =>
    JSON.parse(JSON.stringify(value)) as CharacterOverrides;
  const loadRoster = (): Record<string, CharacterOverrides> => {
    try {
      const raw = resolveStorage()?.getItem(ROSTER_KEY);
      return raw ? (JSON.parse(raw) as Record<string, CharacterOverrides>) : {};
    } catch {
      return {};
    }
  };
  const saveRoster = () => {
    try {
      resolveStorage()?.setItem(ROSTER_KEY, JSON.stringify(roster));
    } catch {
      /* 저장 실패는 무시 (용량·프라이빗 모드 등) */
    }
  };
  let roster = loadRoster();

  root.innerHTML = `
    <div class="site-shell">
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">BROWSER SIM <span>·</span> 60 FPS TIMELINE</p>
          <h1><span>NIKKE</span> 스쿼드 계산기</h1>
          <p class="hero-lede">캐릭터별 오버로드와 큐브, 전투 조건을 반영해 프레임 단위 예상 대미지를 계산합니다.</p>
          <div class="trust-row" aria-label="서비스 특징"><span>AI 없음</span><span>서버 전송 없음</span><span>${catalog.length}명 지원</span></div>
        </div>
        <div class="hero-orbit" aria-hidden="true"><span>01</span><strong>LOCAL<br />SIM</strong></div>
      </header>

      <form class="calculator-layout" novalidate>
        <section class="panel squad-panel" aria-labelledby="squad-heading">
          <div class="section-heading">
            <div><p class="step">01 / SQUAD</p><h2 id="squad-heading">편성 및 캐릭터 설정</h2></div>
            <div class="squad-tools">
              <label class="roster-import" title="렛츠도로 니케정보 CSV를 불러와 모든 니케 설정에 적용">
                <input id="roster-csv" type="file" accept=".csv,text/csv" hidden />
                <span>CSV 불러오기</span>
              </label>
              <label class="toggle-field mode-toggle"><input id="squad-mode" type="checkbox" /><span class="toggle"></span><span>5덱 모드</span></label>
            </div>
            <p class="roster-note" data-roster-note hidden></p>
          </div>
          <div class="deck-tabs" data-deck-tabs hidden></div>
          <p class="deck-note" data-deck-note hidden>덱 사이에는 같은 캐릭터를 다시 편성할 수 있습니다.</p>
          <div class="squad-grid" data-squad-grid></div>
        </section>

        <section class="panel settings-panel" aria-labelledby="settings-heading">
          <div class="section-heading compact target-heading">
            <div><p class="step">02 / TARGET</p><h2 id="settings-heading">전투 조건</h2></div>
            <button type="button" class="reset-enemy" data-reset-enemy>적 수치 초기화</button>
          </div>
          <div class="field-grid">
            <label><span>전투 시간</span><div class="input-unit"><input id="duration" type="number" min="10" max="180" step="1" value="180" /><em>초</em></div></label>
            <label><span>적 방어력</span><input id="enemy-def" type="number" min="0" max="999999" step="1" value="31784" /></label>
            <label><span>적 코드</span><select id="enemy-code"><option value="">없음</option><option>풍압</option><option>수냉</option><option>작열</option><option>전격</option><option>철갑</option></select></label>
            <label><span>난수 시드</span><input id="seed" type="number" min="0" max="2147483647" step="1" value="42" /></label>
            <label class="toggle-field"><input id="has-core" type="checkbox" /><span class="toggle"></span><span>코어 있음</span></label>
            <label data-core-size><span>코어 직경</span><div class="input-unit"><input id="core-px" type="number" min="0" max="1000" step="1" value="52" disabled /><em>px</em></div></label>
            <label class="toggle-field"><input id="has-parts" type="checkbox" /><span class="toggle"></span><span>파괴 가능 파츠</span></label>
          </div>
          <div class="error-box" data-errors hidden role="alert"></div>
          <button class="calculate-button" type="submit"><span>시뮬레이션 실행</span><b aria-hidden="true">→</b></button>
          <p class="status" data-status aria-live="polite">계산 엔진 준비 중…</p>
        </section>

        <section class="panel result-panel" aria-labelledby="result-heading" data-result-panel>
          <div class="result-empty"><p class="step">03 / RESULT</p><h2 id="result-heading">전투 결과</h2><div class="radar-mark" aria-hidden="true"><i></i><i></i><i></i></div><p>편성과 조건을 확인한 뒤<br />시뮬레이션을 실행해 주세요.</p></div>
        </section>
      </form>

      <section class="panel timeline-panel" aria-labelledby="timeline-heading" data-timeline-panel hidden>
        <div class="section-heading compact"><div><p class="step">04 / TIMELINE</p><h2 id="timeline-heading">전투 타임라인</h2></div></div>
        <div data-timeline-body></div>
      </section>
      <footer><p>비공식 팬 제작 도구 · 실제 전투 환경과 차이가 있을 수 있습니다.</p><a href="https://github.com/Moris-kr/nikke-calc" target="_blank" rel="noreferrer">SOURCE / GITHUB ↗</a></footer>
    </div>
  `;

  const form = element<HTMLFormElement>(root, 'form');
  const squadGrid = element<HTMLElement>(root, '[data-squad-grid]');
  const deckTabs = element<HTMLElement>(root, '[data-deck-tabs]');
  const deckNote = element<HTMLElement>(root, '[data-deck-note]');
  const status = element<HTMLElement>(root, '[data-status]');
  const errors = element<HTMLElement>(root, '[data-errors]');
  const submit = element<HTMLButtonElement>(root, 'button[type="submit"]');
  const resultPanel = element<HTMLElement>(root, '[data-result-panel]');
  const timelinePanel = element<HTMLElement>(root, '[data-timeline-panel]');
  const timelineBody = element<HTMLElement>(root, '[data-timeline-body]');
  const coreToggle = element<HTMLInputElement>(root, '#has-core');
  const corePxInput = element<HTMLInputElement>(root, '#core-px');
  const rosterInput = element<HTMLInputElement>(root, '#roster-csv');
  const rosterNote = element<HTMLElement>(root, '[data-roster-note]');

  const activeDeck = () => decks[activeDeckId - 1]!;

  const showErrors = (messages: string[]) => {
    errors.replaceChildren();
    errors.hidden = messages.length === 0;
    for (const message of messages) errors.append(createText('p', message));
  };

  const renderDeckTabs = () => {
    deckTabs.replaceChildren();
    for (const deck of decks) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.deckTab = String(deck.id);
      button.className = deck.id === activeDeckId ? 'is-active' : '';
      const count = deck.squad.filter(Boolean).length;
      button.textContent = `덱 ${deck.id}${count ? ` · ${count}` : ''}`;
      button.addEventListener('click', () => {
        activeDeckId = deck.id;
        renderDeckTabs();
        renderSquad();
      });
      deckTabs.append(button);
    }
  };

  const renderSquad = () => {
    const deck = activeDeck();
    squadGrid.replaceChildren();
    for (let index = 0; index < 5; index += 1) {
      const name = deck.squad[index] ?? '';
      const char = catalogByName.get(name);
      const card = document.createElement('article');
      card.className = 'squad-slot';
      card.dataset.slotCard = String(index);
      card.classList.toggle('is-preview', Boolean(char?.preview));

      const top = document.createElement('div');
      top.className = 'slot-top';
      const portrait = document.createElement('div');
      portrait.className = 'portrait-wrap';
      const number = createText('span', `0${index + 1}`, 'slot-number');
      portrait.append(number, createText('div', '', 'portrait-fallback'));
      if (char?.image) {
        const image = document.createElement('img');
        image.src = `${import.meta.env.BASE_URL}${char.image}`;
        image.alt = `${char.name} 초상화`;
        image.loading = 'lazy';
        portrait.append(image);
      }
      const identity = document.createElement('div');
      identity.className = 'slot-identity';

      const filterLabel = document.createElement('label');
      filterLabel.className = 'slot-filter';
      filterLabel.htmlFor = `squad-filter-${index}`;
      filterLabel.append(createText('span', '필터'));
      const filter = document.createElement('input');
      filter.id = `squad-filter-${index}`;
      filter.type = 'search';
      filter.placeholder = '이름 검색';
      filter.autocomplete = 'off';
      filter.ariaLabel = `스쿼드 슬롯 ${index + 1} 캐릭터 필터`;
      filter.dataset.characterFilter = '';
      filter.value = characterFilters[deck.id - 1]![index] ?? '';
      filterLabel.append(filter);

      const taken = new Set(deck.squad.filter((member, slot) => slot !== index && member));
      const select = document.createElement('select');
      select.id = `squad-${index}`;
      select.dataset.squadSlot = '';
      select.ariaLabel = `스쿼드 슬롯 ${index + 1}`;

      const populateOptions = () => {
        const query = filter.value.trim().toLocaleLowerCase('ko');
        select.replaceChildren();
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = '— 비움 —';
        select.append(empty);
        for (const candidate of catalog) {
          const searchable = [
            candidate.name,
            `B${candidate.burstStage}`,
            candidate.elementCode,
            candidate.weaponType,
            candidate.className,
            candidate.manufacturer,
          ].join(' ').toLocaleLowerCase('ko');
          if (query && !searchable.includes(query) && candidate.name !== name) continue;
          const option = document.createElement('option');
          option.value = candidate.name;
          option.textContent = `${candidate.name} · B${candidate.burstStage}`;
          option.disabled = taken.has(candidate.name);
          select.append(option);
        }
        select.value = name;
      };

      populateOptions();
      filter.addEventListener('input', () => {
        characterFilters[deck.id - 1]![index] = filter.value;
        populateOptions();
      });
      select.addEventListener('change', () => {
        const previous = deck.squad[index] ?? '';
        deck.squad[index] = select.value;
        if (previous && previous !== select.value) delete deck.characters[previous];
        if (select.value && roster[select.value] && !deck.characters[select.value]) {
          deck.characters[select.value] = cloneOverride(roster[select.value]!);
        }
        showErrors([]);
        renderDeckTabs();
        renderSquad();
      });
      const meta = createText(
        'p',
        char ? `B${char.burstStage} · ${char.elementCode} · ${char.weaponType}` : '빈 슬롯',
        'char-meta',
      );
      identity.append(filterLabel, select, meta);
      top.append(portrait, identity);
      card.append(top);
      if (char) {
        const editor = document.createElement('div');
        renderCharacterSettings(editor, char.name, settings, deck.characters[char.name], (next) => {
          if (next) deck.characters[char.name] = next;
          else delete deck.characters[char.name];
        });
        card.append(editor);
      }
      squadGrid.append(card);
    }
  };

  const readBattle = (): BattleSettings => ({
    duration: Number(element<HTMLInputElement>(root, '#duration').value),
    enemyDef: Number(element<HTMLInputElement>(root, '#enemy-def').value),
    enemyCode: element<HTMLSelectElement>(root, '#enemy-code').value as BattleSettings['enemyCode'],
    coreEnabled: coreToggle.checked,
    corePx: Number(corePxInput.value),
    hasParts: element<HTMLInputElement>(root, '#has-parts').checked,
    seed: Number(element<HTMLInputElement>(root, '#seed').value),
  });

  const writeBattle = (battle: BattleSettings) => {
    element<HTMLInputElement>(root, '#duration').value = String(battle.duration);
    element<HTMLInputElement>(root, '#enemy-def').value = String(battle.enemyDef);
    element<HTMLSelectElement>(root, '#enemy-code').value = battle.enemyCode;
    coreToggle.checked = battle.coreEnabled;
    corePxInput.value = String(battle.corePx);
    corePxInput.disabled = !battle.coreEnabled;
    element<HTMLInputElement>(root, '#has-parts').checked = battle.hasParts;
    element<HTMLInputElement>(root, '#seed').value = String(battle.seed);
  };

  const validateCharacterValues = (deck: DeckState): string[] => {
    const messages: string[] = [];
    for (const [name, custom] of Object.entries(deck.characters)) {
      const characterDefaults = settings.characters[name];
      if (custom.growthStage !== undefined && (
        !Number.isInteger(custom.growthStage)
        || custom.growthStage < 0
        || custom.growthStage > (characterDefaults?.maxGrowthStage ?? -1)
      )) {
        messages.push(
          `덱 ${deck.id} · ${name}: 돌파 단계는 0~${characterDefaults?.maxGrowthStage ?? 0} 정수여야 합니다.`,
        );
      }
      if (custom.skillLevels) {
        const keys = Object.keys(custom.skillLevels);
        const hasExactKeys = keys.length === 3
          && keys.every((key) => key === '1' || key === '2' || key === '3');
        const values = Object.values(custom.skillLevels);
        if (!hasExactKeys || values.some((value) => !Number.isInteger(value) || value < 1 || value > 10)) {
          messages.push(`덱 ${deck.id} · ${name}: 스킬 레벨은 1~10 정수여야 합니다.`);
        } else if (characterDefaults?.skillLevelsLocked
          && values.some((value) => value !== 10)) {
          messages.push(`덱 ${deck.id} · ${name}: 수치 미공개 캐릭터는 스킬 Lv10만 사용할 수 있습니다.`);
        }
      }
      for (const [key, value] of Object.entries(custom.overload ?? {})) {
        const meta = settings.overloadFields[key];
        if (!meta || !Number.isFinite(value) || value < meta.min || value > meta.max) {
          messages.push(`덱 ${deck.id} · ${name}: ${meta?.label ?? key} 값이 허용 범위를 벗어났습니다.`);
        }
      }
      if (custom.cube && (!settings.cubes[custom.cube.name] || !Number.isInteger(custom.cube.level)
        || custom.cube.level < 1 || custom.cube.level > 15)) {
        messages.push(`덱 ${deck.id} · ${name}: 큐브 설정을 확인해 주세요.`);
      }
      for (const [key, value] of Object.entries(custom.manualStats ?? {})) {
        const meta = settings.manualStats[key];
        if (!meta || !Number.isFinite(value) || value < meta.min || value > meta.max) {
          messages.push(`덱 ${deck.id} · ${name}: ${meta?.label ?? key} 값이 허용 범위를 벗어났습니다.`);
        }
      }
    }
    return messages;
  };

  const renderBatchResult = (batch: BatchResult) => {
    resultPanel.replaceChildren();
    const duration = batch.decks[0]?.result.duration ?? 1;
    const header = document.createElement('div');
    header.className = 'result-header';
    const copy = document.createElement('div');
    copy.append(createText('p', '03 / RESULT', 'step'), createText('h2', batch.decks.length > 1 ? '5덱 전투 결과' : '전투 결과'));
    const summary = document.createElement('div');
    summary.className = 'total-block';
    const total = createText('strong', formatDamage(batch.total));
    total.dataset.resultTotal = '';
    total.dataset.batchTotal = '';
    summary.append(createText('span', batch.decks.length > 1 ? '전체 덱 총 대미지' : '스쿼드 총 대미지'), total, createText('small', formatDps(batch.total / duration)));
    header.append(copy, summary);
    resultPanel.append(header);

    for (const entry of batch.decks) {
      const section = document.createElement('section');
      section.className = 'deck-result';
      section.dataset.deckResult = String(entry.deckId);
      const deckHeader = document.createElement('div');
      deckHeader.className = 'deck-result-header';
      deckHeader.append(
        createText('h3', `덱 ${entry.deckId}`),
        createText('strong', formatDamage(entry.result.squadTotal)),
        createText('small', formatDps(entry.result.squadTotal / entry.result.duration)),
      );
      section.append(deckHeader);
      if (entry.result.previewNote) section.append(createText('p', entry.result.previewNote, 'preview-warning'));
      renderCharacterRows(section, entry);
      const facts = document.createElement('div');
      facts.className = 'result-facts';
      facts.append(
        createText('span', `${entry.result.duration}초 전투`),
        createText('span', `${entry.result.hitCount.toLocaleString('ko-KR')} 히트`),
        createText('span', `시드 ${entry.request.seed}`),
      );
      section.append(facts, createText('pre', entry.result.deviations, 'deviations'));
      resultPanel.append(section);
    }

    timelineBody.replaceChildren();
    let timelineCount = 0;
    for (const entry of batch.decks) {
      const timelineBlock = createTimelineBlock(entry);
      if (!timelineBlock) continue;
      if (batch.decks.length > 1) {
        timelineBlock.prepend(createText('h3', `덱 ${entry.deckId}`, 'timeline-deck-label'));
      }
      timelineBody.append(timelineBlock);
      timelineCount += 1;
    }
    timelinePanel.hidden = timelineCount === 0;
  };

  element<HTMLInputElement>(root, '#squad-mode').addEventListener('change', (event) => {
    fiveDeckMode = (event.currentTarget as HTMLInputElement).checked;
    activeDeckId = 1;
    deckTabs.hidden = !fiveDeckMode;
    deckNote.hidden = !fiveDeckMode;
    renderDeckTabs();
    renderSquad();
    showErrors([]);
  });
  coreToggle.addEventListener('change', () => {
    corePxInput.disabled = !coreToggle.checked;
  });
  element<HTMLButtonElement>(root, '[data-reset-enemy]').addEventListener('click', () => {
    writeBattle(resetEnemy(readBattle()));
    showErrors([]);
  });
  const applyRosterToDecks = () => {
    for (const deck of decks) {
      for (const member of deck.squad) {
        if (member && roster[member] && !deck.characters[member]) {
          deck.characters[member] = cloneOverride(roster[member]!);
        }
      }
    }
  };
  const updateRosterNote = (message?: string) => {
    const count = Object.keys(roster).length;
    if (message) rosterNote.textContent = message;
    else if (count > 0) rosterNote.textContent = `CSV 로스터 ${count}명 적용 중`;
    rosterNote.hidden = !message && count === 0;
  };
  rosterInput.addEventListener('change', async () => {
    const file = rosterInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { overrides, matched, unmatched } = parseRosterCsv(text, settings);
      if (matched.length === 0) {
        updateRosterNote('CSV에서 지원 캐릭터를 찾지 못했습니다. 정식 명칭이 일치하는지 확인해 주세요.');
        return;
      }
      roster = overrides;
      saveRoster();
      applyRosterToDecks();
      renderDeckTabs();
      renderSquad();
      const skipped = unmatched.length > 0 ? ` · 미지원 ${unmatched.length}명 제외` : '';
      updateRosterNote(`CSV 로스터 ${matched.length}명 적용${skipped}`);
    } catch (error) {
      updateRosterNote(`CSV 불러오기 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      rosterInput.value = '';
    }
  });

  applyRosterToDecks();
  updateRosterNote();
  renderDeckTabs();
  renderSquad();

  const prepared = client.prepare()
    .then(() => {
      if (activity !== 'preparing') return;
      activity = 'ready';
      status.textContent = '계산 준비 완료 · 모든 연산은 이 기기에서 실행됩니다.';
    })
    .catch((error: unknown) => {
      if (activity !== 'preparing') return;
      activity = 'error';
      status.textContent = `초기화 실패 · ${error instanceof Error ? error.message : String(error)}`;
    });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const battle = readBattle();
    const selectedDecks = (fiveDeckMode ? decks : [decks[0]!])
      .filter((deck) => deck.squad.some((name) => name.trim()));
    const validation = [
      ...validateDecks(selectedDecks),
      ...selectedDecks.flatMap((deck) => validateCharacterValues(deck)),
    ];
    const requests = selectedDecks.map((deck) => ({ deck, request: requestForDeck(deck, battle) }));
    for (const { deck, request } of requests) {
      validation.push(...validateRequest(request).map((message) => `덱 ${deck.id}: ${message}`));
    }
    showErrors([...new Set(validation)]);
    if (validation.length > 0) return;

    submit.disabled = true;
    submit.classList.add('is-running');
    activity = 'running';
    const completed: DeckResultEntry[] = [];
    let cachedCount = 0;
    try {
      await prepared;
      for (let index = 0; index < requests.length; index += 1) {
        const { deck, request } = requests[index]!;
        status.textContent = `계산 중 · 덱 ${index + 1}/${requests.length} (덱 ${deck.id})`;
        const key = cacheKey(request, version);
        let result = cache.get(key);
        if (result) {
          cachedCount += 1;
        } else {
          result = await client.simulate(request);
          cache.set(key, result);
        }
        completed.push({ deckId: deck.id, request, result });
        renderBatchResult(aggregateDeckResults(completed));
      }
      activity = cachedCount === requests.length ? 'cached' : 'complete';
      status.textContent = cachedCount === requests.length
        ? '저장된 결과를 불러왔습니다.'
        : `${requests.length}개 덱 계산 완료 · 같은 조건은 이 기기에 저장됩니다.`;
    } catch (error) {
      if (completed.length > 0) renderBatchResult(aggregateDeckResults(completed));
      const failedEntry = requests[completed.length];
      const failed = failedEntry?.deck.id;
      const detail = cleanEngineError(error instanceof Error ? error.message : String(error));
      const messages = [`덱 ${failed ?? '?'} 계산 실패: ${detail}`];
      const hasBurstOverride = failedEntry
        ? Object.values(failedEntry.deck.characters).some((custom) => custom.burst)
        : false;
      if (hasBurstOverride) {
        messages.push('이 조합은 버스트 운용 지정을 지원하지 않을 수 있습니다. 해당 캐릭터의 버스트 운용을 \'자동\'으로 바꿔 다시 실행해 주세요.');
      }
      showErrors(messages);
      activity = 'error';
      status.textContent = '계산에 실패했습니다. 입력값을 확인하고 다시 실행해 주세요.';
    } finally {
      submit.disabled = false;
      submit.classList.remove('is-running');
    }
  });

  return () => client.dispose();
}
