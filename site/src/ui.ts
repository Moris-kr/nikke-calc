import { ResultCache, type StorageLike, type StorageSource } from './cache';
import { renderCharacterSettings } from './character-settings';
import { parseRosterCsv } from './csv-import';
import {
  buildAddPrompt,
  CUSTOM_KEY,
  customToMeta,
  customToSettings,
  loadCustom,
  parseCustomInput,
  unsupportedEffects,
} from './custom-nikke';
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

  // 임의 니케(커스텀). localStorage에만 저장되고 요청마다 엔진에 주입된다.
  const customChars = loadCustom((key) => resolveStorage()?.getItem(key) ?? null);
  const saveCustom = () => {
    try {
      resolveStorage()?.setItem(CUSTOM_KEY, JSON.stringify(customChars));
    } catch {
      /* 무시 */
    }
  };
  const registerCustom = (name: string) => {
    const custom = customChars[name];
    if (!custom) return;
    if (!catalogByName.has(name)) {
      const meta = customToMeta(custom);
      catalog.push(meta);
      catalogByName.set(name, meta);
    }
    settings.characters[name] = customToSettings(custom);
  };
  const customPayload = (): Record<string, { nikke: Record<string, unknown>; skills: unknown[] }> =>
    Object.fromEntries(Object.entries(customChars).map(([n, c]) => [n, { nikke: c.nikke, skills: c.skills }]));

  // 편성·설정·전투 조건을 localStorage에 저장해 새로고침해도 마지막 상태로 복원한다.
  const STATE_KEY = 'nikke-state-v1';
  interface SavedState {
    decks: DeckState[];
    fiveDeckMode: boolean;
    activeDeckId: number;
    battle: BattleSettings;
  }
  // 큐브 이름이 짧은 통칭에서 인게임 정식 명칭으로 바뀌었다. 이전 버전에서 저장된
  // 편성에는 옛 이름이 남아 있어 그대로 두면 엔진이 요청을 거부한다. 불러올 때 한 번
  // 옮겨주고, 카탈로그에 없는 이름은 캐릭터 기본값으로 되돌아가도록 지운다.
  const LEGACY_CUBE_NAMES: Record<string, string> = {
    재장: '렐릭 베어 큐브',
    탄충: '택티컬 베어 큐브',
    체력: '렐릭 비고르 큐브',
    차속: '렐릭 부스트 큐브',
    파츠: '렐릭 디스트로이 큐브',
    분배: '렐릭 디바이드 큐브',
  };
  const migrateSavedCubes = (state: Partial<SavedState>): Partial<SavedState> => {
    for (const deck of state.decks ?? []) {
      for (const overrides of Object.values(deck.characters ?? {})) {
        const cube = overrides.cube;
        if (!cube) continue;
        const renamed = LEGACY_CUBE_NAMES[cube.name];
        if (renamed) cube.name = renamed;
        if (!settings.cubes[cube.name]) delete overrides.cube;
      }
    }
    return state;
  };
  const loadSavedState = (): Partial<SavedState> | null => {
    try {
      const raw = resolveStorage()?.getItem(STATE_KEY);
      return raw ? migrateSavedCubes(JSON.parse(raw) as Partial<SavedState>) : null;
    } catch {
      return null;
    }
  };
  const savedState = loadSavedState();
  // 실제 구현은 refs·readBattle이 준비된 뒤 할당한다. 그전 호출은 no-op.
  let saveState: () => void = () => undefined;

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
              <button type="button" class="roster-import" data-add-nikke title="미출시·미등록 니케를 직접 추가">새 니케 추가</button>
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
          <div class="result-cache-tools"><button type="button" class="clear-cache" data-clear-cache title="같은 조건에 저장된 결과를 지우고 다음 실행부터 새로 계산합니다">저장된 결과 지우기</button></div>
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

      <div class="custom-modal" data-custom-modal hidden>
        <div class="custom-card" role="dialog" aria-label="새 니케 추가">
          <div class="custom-head"><h2>새 니케 추가</h2><button type="button" class="custom-close" data-custom-close aria-label="닫기">✕</button></div>
          <p class="custom-desc">미출시·미등록 니케를 직접 추가합니다. 서버로 전송되지 않고 이 브라우저에만 저장됩니다.</p>
          <ol class="custom-steps">
            <li>아래 <b>프롬프트 복사</b>를 눌러 다른 LLM(챗봇)에 붙여넣고, 그 아래에 니케 이름·스킬 설명을 붙여 결과 JSON을 받으세요.</li>
            <li>받은 JSON을 아래 칸에 붙여넣고 <b>추가</b>를 누르세요. 또는 <b>직접 입력 도움말</b>을 보고 손으로 작성해도 됩니다.</li>
          </ol>
          <div class="custom-caution">
            <b>참고하세요</b>
            <ul>
              <li>특이하거나 복잡한 스킬(조건부 발동·게이지·모드 전환·스택 조건 등)은 계산에 <b>반영되지 않습니다.</b> 기본 사격·버프·버스트 위주로만 근사됩니다. 그런 스킬이 주력 딜인 캐릭터(예: 게이지로 대미지가 커지는 캐릭터)는 <b>결과가 실제보다 훨씬 낮게</b> 나오니 참고만 하세요.</li>
              <li>LLM 성능에 따라 <b>정확한 변환이 어려울 수 있으니 참고용</b>으로 쓰고, 값을 직접 확인·보정하시길 권합니다.</li>
              <li>가능하면 아래 <b>직접 입력 도움말</b>을 보고 사람이 직접 값을 넣는 편이 정확합니다.</li>
            </ul>
          </div>
          <details class="custom-help">
            <summary>직접 입력 도움말 (스키마 · 사람이 작성할 때)</summary>
            <div class="custom-help-body">
              <p><b>최상위</b>: <code>{ "name": "정식 명칭", "nikke": {…스탯}, "skills": [ …효과 ] }</code></p>
              <p><b>nikke 공통</b>: rarity(SSR/SR/R) · element_code(전격/작열/수냉/풍압/철갑) · class(화력형/방어형/지원형) · manufacturer(엘리시온/미실리스/테트라/필그림/어브노멀) · weapon_type(AR/SMG/MG/SR/RL/SG) · burst_stage(1~3) · burst_cooldown(초) · max_ammo · reload_time(초) · fire_rate(초당 발사) · pellets(SG만 2↑) · muzzles(대개 1) · damage_coeff(1발 계수 %)</p>
              <p><b>무기별 추가</b>: 연사형(AR·SMG·MG·SG)은 <code>core_dmg_mult</code>(코어 %, 예 200). 차지형(SR·RL)은 <code>charge_time</code>(풀차지 초, 예 1.0~1.5)과 <code>full_charge_mult</code>(풀차지 %, 예 250·350). 차지형에 안 넣으면 각각 1.0·250으로 기본 적용됩니다.</p>
              <p><b>skills 각 원소</b>: source(스킬1/스킬2/버스트스킬) · type(buff 또는 damage) · name · trigger:{ timing:[…], condition:[…] } · target · stat · polarity(beneficial/harmful) · max_stack(대개 1) · values:{ "1":값, "10":값 } 또는 fixed_value:값 · duration(지속 초, 즉발/영구는 생략 또는 -1)</p>
              <p><b>인식되는 timing</b>: battle_start · full_burst_start · full_burst_start_count:N · full_burst_end · burst_cast · burst_cast_count:N · last_bullet · last_bullet_fire · hit_count:N · full_charge_hit · passive</p>
              <p><b>인식되는 target</b>: self · all_allies · all_allies_excl_self · all_enemies · target · same_target · allies:N · allies_top_atk:N · allies_weapon:&lt;무기&gt; · allies_class:공격|방어|지원 · allies_code:&lt;속성&gt; · allies_code_weapon:&lt;속성&gt;:&lt;무기&gt; · enemies_top_atk:N</p>
              <p><b>인식되는 buff stat</b>: atk_pct · atk_flat · atk_dmg_pct · normal_atk_dmg_pct · crit_rate · crit_dmg · core_dmg_pct · element_bonus_pct · burst_dmg_pct · pierce_dmg_pct · charge_dmg_pct · charge_speed_pct · max_ammo_pct · max_ammo_flat · reload_speed_pct · attack_speed_pct · accuracy_pct · def_pct · def_ignore_pct · enemy_def_down_pct · received_dmg(적이 받는 대미지 증가) · burst_cooldown(초)</p>
              <p><b>damage stat</b>(type이 damage): bonus_damage · burst_damage · damage (values가 대미지 계수)</p>
              <p class="custom-help-note">목록에 없는 stat·timing·target은 계산에서 무시됩니다. 애매하면 가장 가까운 표준값을 쓰세요.</p>
            </div>
          </details>
          <button type="button" class="custom-btn" data-copy-prompt>① 프롬프트 복사</button>
          <textarea class="custom-json" data-custom-json placeholder="② 여기에 결과 JSON을 붙여넣거나, 도움말을 보고 직접 작성하세요" rows="8"></textarea>
          <div class="custom-actions"><button type="button" class="custom-btn primary" data-custom-submit>추가</button></div>
          <p class="custom-msg" data-custom-msg hidden></p>
          <div class="custom-list" data-custom-list></div>
        </div>
      </div>
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
        saveState();
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
        saveState();
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
          saveState();
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
    saveState();
    renderDeckTabs();
    renderSquad();
    showErrors([]);
  });
  coreToggle.addEventListener('change', () => {
    corePxInput.disabled = !coreToggle.checked;
  });
  // 전투 조건 입력이 바뀌면 저장한다.
  form.addEventListener('change', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.settings-panel')) saveState();
  });
  element<HTMLButtonElement>(root, '[data-reset-enemy]').addEventListener('click', () => {
    writeBattle(resetEnemy(readBattle()));
    saveState();
    showErrors([]);
  });
  element<HTMLButtonElement>(root, '[data-clear-cache]').addEventListener('click', () => {
    cache.clear();
    showErrors([]);
    status.textContent = '저장된 결과를 지웠습니다. 다시 실행하면 새로 계산합니다.';
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
      saveState();
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

  const customModal = element<HTMLElement>(root, '[data-custom-modal]');
  const customJson = element<HTMLTextAreaElement>(root, '[data-custom-json]');
  const customMsg = element<HTMLElement>(root, '[data-custom-msg]');
  const customList = element<HTMLElement>(root, '[data-custom-list]');
  const showCustomMsg = (text: string, ok = false) => {
    customMsg.textContent = text;
    customMsg.hidden = !text;
    customMsg.classList.toggle('is-ok', ok);
  };
  const renderCustomList = () => {
    customList.replaceChildren();
    const names = Object.keys(customChars);
    if (names.length === 0) return;
    customList.append(createText('p', '추가된 니케', 'custom-list-title'));
    for (const name of names) {
      const meta = customToMeta(customChars[name]!);
      const row = document.createElement('div');
      row.className = 'custom-list-row';
      row.append(createText('span', `${name} · B${meta.burstStage} · ${meta.elementCode} · ${meta.weaponType}`, 'custom-list-name'));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'custom-remove';
      remove.textContent = '삭제';
      remove.addEventListener('click', () => {
        delete customChars[name];
        saveCustom();
        const index = catalog.findIndex((char) => char.name === name);
        if (index >= 0) catalog.splice(index, 1);
        catalogByName.delete(name);
        delete settings.characters[name];
        for (const deck of decks) {
          deck.squad = deck.squad.map((member) => (member === name ? '' : member));
          delete deck.characters[name];
        }
        saveState();
        renderCustomList();
        renderDeckTabs();
        renderSquad();
      });
      row.append(remove);
      customList.append(row);
    }
  };
  element<HTMLButtonElement>(root, '[data-add-nikke]').addEventListener('click', () => {
    customModal.hidden = false;
    showCustomMsg('');
    renderCustomList();
  });
  element<HTMLButtonElement>(root, '[data-custom-close]').addEventListener('click', () => {
    customModal.hidden = true;
  });
  customModal.addEventListener('click', (event) => {
    if (event.target === customModal) customModal.hidden = true;
  });
  element<HTMLButtonElement>(root, '[data-copy-prompt]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildAddPrompt());
      showCustomMsg('프롬프트를 복사했습니다. 다른 LLM에 붙여넣고 니케 설명을 이어 붙이세요.', true);
    } catch {
      showCustomMsg('자동 복사에 실패했습니다. 브라우저 권한을 확인하거나 직접 복사해 주세요.');
    }
  });
  element<HTMLButtonElement>(root, '[data-custom-submit]').addEventListener('click', () => {
    try {
      const custom = parseCustomInput(customJson.value);
      customChars[custom.name] = custom;
      saveCustom();
      registerCustom(custom.name);
      renderCustomList();
      renderDeckTabs();
      renderSquad();
      customJson.value = '';
      const ignored = unsupportedEffects(custom.skills);
      if (ignored.length > 0) {
        showCustomMsg(
          `'${custom.name}' 추가됨. 다만 인식되지 않는 효과가 있어 반영되지 않습니다: `
          + `${ignored.join(', ')}. 이 효과가 캐릭터의 주력 딜이면 결과가 실제보다 크게 낮게 나옵니다`
          + `(게이지·모드 전환·조건부 스택형 스킬은 이 방식으로 재현하기 어렵습니다). `
          + `도움말의 어휘와 대조해 stat·timing·target을 고치면 일부는 반영됩니다.`,
        );
      } else {
        showCustomMsg(`'${custom.name}' 추가됨 · 스쿼드 슬롯에서 선택할 수 있습니다.`, true);
      }
    } catch (error) {
      showCustomMsg(error instanceof Error ? error.message : String(error));
    }
  });

  saveState = () => {
    try {
      resolveStorage()?.setItem(STATE_KEY, JSON.stringify({
        decks, fiveDeckMode, activeDeckId, battle: readBattle(),
      }));
    } catch {
      /* 저장 실패 무시 */
    }
  };
  const applySavedState = () => {
    if (!savedState) return;
    if (Array.isArray(savedState.decks)) {
      savedState.decks.forEach((saved, index) => {
        const deck = decks[index];
        if (!deck || !saved) return;
        deck.squad = (saved.squad ?? ['', '', '', '', ''])
          .map((name) => (name && catalogByName.has(name) ? name : ''));
        deck.characters = {};
        for (const [name, override] of Object.entries(saved.characters ?? {})) {
          if (deck.squad.includes(name)) deck.characters[name] = override;
        }
      });
    }
    const savedActive = savedState.activeDeckId;
    if (typeof savedActive === 'number' && savedActive >= 1 && savedActive <= 5) {
      activeDeckId = savedActive;
    }
    if (savedState.fiveDeckMode) {
      fiveDeckMode = true;
      element<HTMLInputElement>(root, '#squad-mode').checked = true;
      deckTabs.hidden = false;
      deckNote.hidden = false;
    }
    if (savedState.battle) writeBattle(savedState.battle);
  };

  for (const name of Object.keys(customChars)) registerCustom(name);
  applySavedState();
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
    const custom = customPayload();
    const requests = selectedDecks.map((deck) => ({
      deck,
      request: requestForDeck(deck, battle, Object.keys(custom).length > 0 ? custom : undefined),
    }));
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
