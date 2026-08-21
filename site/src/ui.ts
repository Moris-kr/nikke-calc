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
import {
  canvasToBlob,
  copyImage,
  downloadImage,
  loadPortraits,
  renderReport,
  reportFilename,
  type ReportMeta,
} from './report';
import { applyShareToDecks, decodeShareCode, encodeShareCode } from './share-code';
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
  // 완전 초기화는 저장소를 비운 뒤 페이지를 다시 띄워 메모리 상태까지 확실히
  // 되돌린다. 테스트에서는 이 자리에 가짜 함수를 넣는다.
  reload?: () => void;
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

    // 평타/스킬 딜 분해. 구버전 캐시 결과에는 없으므로 있을 때만 그린다.
    const breakdown = entry.result.charBreakdown?.[name];
    if (breakdown && value > 0) {
      const split = document.createElement('div');
      split.className = 'dmg-split';
      split.dataset.dmgSplit = '';
      const normalPct = breakdown.normal / value * 100;
      const skillPct = breakdown.skill / value * 100;

      const splitTrack = document.createElement('div');
      splitTrack.className = 'split-track';
      const normalBar = document.createElement('i');
      normalBar.className = 'split-normal';
      normalBar.style.width = `${normalPct}%`;
      const skillBar = document.createElement('i');
      skillBar.className = 'split-skill';
      skillBar.style.width = `${skillPct}%`;
      splitTrack.append(normalBar, skillBar);

      const legend = document.createElement('p');
      legend.className = 'split-legend';
      legend.append(
        createText('span', `평타 ${formatDamage(breakdown.normal)} (${normalPct.toFixed(1)}%)`, 'legend-normal'),
        createText('span', `스킬 ${formatDamage(breakdown.skill)} (${skillPct.toFixed(1)}%)`, 'legend-skill'),
      );
      split.append(splitTrack, legend);

      if (breakdown.skills.length > 0) {
        const details = document.createElement('details');
        details.className = 'skill-breakdown';
        const summary = document.createElement('summary');
        summary.textContent = `스킬 ${breakdown.skills.length}종 세부`;
        details.append(summary);
        const list = document.createElement('ul');
        for (const skill of breakdown.skills) {
          const item = document.createElement('li');
          item.append(
            createText('span', skill.name),
            createText('span', `${formatDamage(skill.damage)} · ${(skill.damage / value * 100).toFixed(1)}% · ${skill.hits}히트`),
          );
          list.append(item);
        }
        details.append(list);
        split.append(details);
      }
      row.append(split);
    }
    rows.append(row);
  }
  container.append(rows);
}

export function mountCalculator(root: HTMLElement, deps: CalculatorDependencies): () => void {
  const { catalog, settings, version, client, storage, reload } = deps;
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
          <div class="trust-row" aria-label="서비스 특징"><button type="button" class="roster-open" data-roster-open title="지원하는 니케 전체 보기">${catalog.length}명 지원</button></div>
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
              <button type="button" class="roster-import" data-share-open title="편성을 코드로 만들어 공유하거나, 받은 코드를 붙여넣어 5덱을 한 번에 적용">조합 공유</button>
              <button type="button" class="roster-import danger" data-reset-all title="편성·설정·CSV 로스터·추가한 니케·저장된 결과를 모두 지우고 처음 상태로 되돌립니다">완전 초기화</button>
              <label class="toggle-field mode-toggle"><input id="squad-mode" type="checkbox" /><span class="toggle"></span><span>5덱 모드</span></label>
            </div>
            <p class="roster-note" data-roster-note hidden></p>
          </div>
          <div class="deck-tabs" data-deck-tabs hidden></div>
          <div class="deck-copy" data-deck-copy hidden>
            <button type="button" class="deck-copy-open" data-deck-copy-open>현재 덱 복사</button>
            <div class="deck-copy-panel" data-deck-copy-panel hidden>
              <p class="deck-copy-title" data-deck-copy-title></p>
              <div class="deck-copy-targets" data-deck-copy-targets></div>
              <div class="deck-copy-actions">
                <button type="button" class="deck-copy-apply" data-deck-copy-apply>복사</button>
                <button type="button" class="deck-copy-cancel" data-deck-copy-cancel>취소</button>
              </div>
            </div>
          </div>
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
            <label><span>적 코드</span><select id="enemy-code"><option value="">없음</option><option value="풍압">풍압(작열weak)</option><option value="수냉">수냉(전격weak)</option><option value="작열">작열(수냉weak)</option><option value="전격">전격(철갑weak)</option><option value="철갑">철갑(풍압weak)</option></select></label>
            <label><span>난수 시드</span><input id="seed" type="number" min="0" max="2147483647" step="1" value="42" /></label>
            <label class="toggle-field"><input id="has-core" type="checkbox" /><span class="toggle"></span><span>코어 있음</span></label>
            <label data-core-size><span>코어 직경</span><div class="input-unit"><input id="core-px" type="number" min="0" max="1000" step="1" value="52" disabled /><em>px</em></div></label>
            <label class="toggle-field"><input id="has-parts" type="checkbox" /><span class="toggle"></span><span>파괴 가능 파츠</span></label>
          </div>
          <section class="console-editor">
            <h3>콘솔 <span>전초기지 재활용 연구실</span></h3>
            <div class="console-grid" data-console-grid></div>
            <p class="field-note">계정 설정이라 스쿼드 전원에게 같이 적용됩니다. 클래스·기업은 인게임에서 소속별로 따로 크므로 각각 받습니다. 기업은 공격력, 공통·클래스는 체력을 올립니다 — 체력 계수를 쓰는 캐릭터(신데렐라 등)는 공통·클래스도 딜에 반영됩니다.</p>
          </section>
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

      <div class="custom-modal" data-share-modal hidden>
        <div class="custom-card" role="dialog" aria-label="조합 공유">
          <div class="custom-head"><h2>조합 공유</h2><button type="button" class="custom-close" data-share-close aria-label="닫기">✕</button></div>
          <p class="custom-desc">누가 편성됐는지(캐릭터 조합)만 코드 한 줄로 주고받습니다. 5덱 모드면 5개 덱이 한 번에 담깁니다. <b>오버로드·공격력·돌파 같은 개인 스펙과 전투 조건은 코드에 담기지 않습니다</b> — 코드를 적용하면 캐릭터만 바뀌고 스펙은 각자 자기 설정(CSV 로스터를 넣었다면 그 값)이 그대로 쓰입니다. 서버로 전송되지 않습니다.</p>
          <div class="squad-code-block">
            <h4>내 조합 코드</h4>
            <textarea class="custom-json" data-share-out rows="3" readonly></textarea>
            <div class="deck-copy-actions"><button type="button" class="deck-copy-apply" data-share-copy>코드 복사</button></div>
          </div>
          <div class="squad-code-block">
            <h4>받은 코드 적용</h4>
            <textarea class="custom-json" data-share-in rows="3" placeholder="받은 조합 코드를 붙여넣으세요 (NIKKE1-...)"></textarea>
            <div class="deck-copy-actions"><button type="button" class="deck-copy-apply" data-share-apply>이 조합 적용</button></div>
          </div>
          <p class="custom-msg" data-share-msg hidden></p>
        </div>
      </div>

      <div class="custom-modal" data-report-modal hidden>
        <div class="custom-card report-card" role="dialog" aria-label="보고서 이미지">
          <div class="custom-head"><h2>보고서 이미지</h2><button type="button" class="custom-close" data-report-close aria-label="닫기">✕</button></div>
          <p class="custom-desc">아래 이미지를 복사해 커뮤니티에 바로 붙여넣을 수 있습니다. 복사가 막히면 PNG로 저장하거나, 이미지를 우클릭해 복사해도 됩니다. 이 브라우저 안에서만 만들어집니다.</p>
          <div class="report-preview" data-report-preview></div>
          <p class="report-msg" data-report-msg hidden></p>
          <div class="deck-copy-actions">
            <button type="button" class="deck-copy-apply" data-report-copy>이미지 복사</button>
            <button type="button" class="deck-copy-cancel" data-report-save>PNG 저장</button>
          </div>
        </div>
      </div>

      <div class="custom-modal" data-roster-modal hidden>
        <div class="custom-card roster-card" role="dialog" aria-label="지원 니케 목록">
          <div class="custom-head"><h2>지원 니케 <span data-roster-count></span></h2><button type="button" class="custom-close" data-roster-close aria-label="닫기">✕</button></div>
          <p class="custom-desc">스킬까지 파싱되어 계산에 쓸 수 있는 니케입니다. 이름으로 걸러 볼 수 있습니다.</p>
          <input type="search" class="roster-search" data-roster-search placeholder="이름 검색" autocomplete="off" aria-label="지원 니케 이름 검색" />
          <div class="roster-grid" data-roster-grid></div>
          <p class="roster-empty" data-roster-empty hidden>검색과 일치하는 니케가 없습니다.</p>
        </div>
      </div>

      <div class="custom-modal" data-reset-modal hidden>
        <div class="custom-card reset-card" role="dialog" aria-label="완전 초기화 확인">
          <div class="custom-head"><h2>완전 초기화</h2><button type="button" class="custom-close" data-reset-close aria-label="닫기">✕</button></div>
          <p class="custom-desc">아래 항목을 모두 지우고 처음 상태로 되돌립니다. 되돌릴 수 없습니다.</p>
          <ul class="reset-list">
            <li>모든 덱의 편성과 캐릭터별 설정</li>
            <li>CSV로 불러온 로스터</li>
            <li>직접 추가한 니케</li>
            <li>저장된 계산 결과</li>
            <li>전투 조건</li>
          </ul>
          <div class="deck-copy-actions">
            <button type="button" class="deck-copy-apply danger" data-reset-confirm>초기화</button>
            <button type="button" class="deck-copy-cancel" data-reset-cancel>취소</button>
          </div>
        </div>
      </div>

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
  const deckCopy = element<HTMLElement>(root, '[data-deck-copy]');
  const deckCopyOpen = element<HTMLButtonElement>(root, '[data-deck-copy-open]');
  const deckCopyPanel = element<HTMLElement>(root, '[data-deck-copy-panel]');
  const deckCopyTitle = element<HTMLElement>(root, '[data-deck-copy-title]');
  const deckCopyTargets = element<HTMLElement>(root, '[data-deck-copy-targets]');
  const deckCopyApply = element<HTMLButtonElement>(root, '[data-deck-copy-apply]');
  const deckCopyCancel = element<HTMLButtonElement>(root, '[data-deck-copy-cancel]');
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
        // 패널은 '현재 덱' 기준이라 덱을 옮기면 닫는다 (열린 채로 두면 대상이 헷갈린다).
        closeDeckCopy();
        saveState();
        renderDeckTabs();
        renderSquad();
      });
      deckTabs.append(button);
    }
  };

  // 덱 복사 — 같은 편성을 여러 덱에 깔아두고 딜러 한 자리만 바꿔 비교하는 용도다.
  // 편성(squad)과 캐릭터별 설정(characters)을 함께 복사해야 비교가 공정하다.
  const closeDeckCopy = () => {
    deckCopyPanel.hidden = true;
    deckCopyOpen.setAttribute('aria-expanded', 'false');
  };

  const renderDeckCopy = () => {
    const source = activeDeck();
    deckCopyTitle.textContent = `덱 ${source.id}의 편성과 캐릭터 설정을 복사할 대상`;
    deckCopyTargets.replaceChildren();
    for (const deck of decks) {
      if (deck.id === source.id) continue;
      const count = deck.squad.filter(Boolean).length;
      const label = document.createElement('label');
      label.className = 'deck-copy-target';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.deckCopyTarget = String(deck.id);
      // 비어 있는 덱은 잃을 게 없으므로 기본 선택. 이미 짜둔 덱은 사용자가 직접 고른다.
      box.checked = count === 0;
      label.append(
        box,
        createText('span', count === 0 ? `덱 ${deck.id} · 비어 있음` : `덱 ${deck.id} · ${count}명 (덮어씀)`,
          count === 0 ? undefined : 'deck-copy-warn'),
      );
      deckCopyTargets.append(label);
    }
  };

  const applyDeckCopy = () => {
    const source = activeDeck();
    const targets = Array.from(
      deckCopyTargets.querySelectorAll<HTMLInputElement>('[data-deck-copy-target]'),
    ).filter((box) => box.checked).map((box) => Number(box.dataset.deckCopyTarget));
    if (targets.length === 0) {
      showErrors(['복사할 대상 덱을 하나 이상 선택하세요.']);
      return;
    }
    for (const id of targets) {
      const target = decks[id - 1];
      if (!target) continue;
      target.squad = [...source.squad];
      target.characters = Object.fromEntries(
        Object.entries(source.characters).map(([name, value]) => [name, cloneOverride(value)]),
      );
    }
    // 슬롯별 캐릭터 필터는 화면 상태일 뿐이라 같이 옮겨 검색어가 남지 않게 한다.
    const sourceFilters = characterFilters[source.id - 1]!;
    for (const id of targets) characterFilters[id - 1] = [...sourceFilters];

    closeDeckCopy();
    showErrors([]);
    saveState();
    renderDeckTabs();
    status.textContent = `덱 ${source.id}을(를) ${targets.map((id) => `덱 ${id}`).join(' · ')}에 복사했습니다.`;
  };

  deckCopyOpen.addEventListener('click', () => {
    if (deckCopyPanel.hidden) {
      renderDeckCopy();
      deckCopyPanel.hidden = false;
      deckCopyOpen.setAttribute('aria-expanded', 'true');
    } else {
      closeDeckCopy();
    }
  });
  deckCopyCancel.addEventListener('click', closeDeckCopy);
  deckCopyApply.addEventListener('click', applyDeckCopy);

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

      // 자리 이동. 니케는 배치 순서가 전투에 영향을 주므로 캐릭터를 다시 고르지 않고
      // 자리만 맞바꿀 수 있어야 한다. 이름으로 걸린 설정(deck.characters)은 슬롯과
      // 무관하니 그대로 두고, 슬롯에 매인 편성과 검색어만 맞바꾼다.
      const moves = document.createElement('div');
      moves.className = 'slot-moves';
      for (const [delta, label, title] of [
        [-1, '‹', '왼쪽으로'], [1, '›', '오른쪽으로'],
      ] as const) {
        const move = document.createElement('button');
        move.type = 'button';
        move.className = 'slot-move';
        move.dataset.slotMove = `${index}:${delta}`;
        move.textContent = label;
        move.title = `${title} 이동`;
        move.ariaLabel = `슬롯 ${index + 1} ${title} 이동`;
        const target = index + delta;
        move.disabled = target < 0 || target > 4;
        move.addEventListener('click', () => {
          const filters = characterFilters[deck.id - 1]!;
          [deck.squad[index], deck.squad[target]] = [deck.squad[target] ?? '', deck.squad[index] ?? ''];
          [filters[index], filters[target]] = [filters[target] ?? '', filters[index] ?? ''];
          showErrors([]);
          saveState();
          renderDeckTabs();
          renderSquad();
        });
        moves.append(move);
      }
      portrait.append(moves);
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

  // ── 콘솔 ────────────────────────────────────────────────────────────────
  // 클래스·기업은 소속별로 따로 큰다. 목록은 카탈로그가 정본이라(로스터에서 뽑는다)
  // 신규 기업·클래스가 생겨도 코드는 그대로다.
  //
  // 만든 입력을 Map으로 들고 읽고 쓴다 — 소속명이 그대로 들어가는 선택자를 쓰면
  // 이스케이프에 기대게 되고(`CSS.escape`), 그 API가 없는 환경에서 통째로 깨진다.
  const CONSOLE_DEFAULTS = { common: 180, class: 100, company: 100 } as const;
  const consoleInputs: Record<'class' | 'company', Map<string, HTMLInputElement>> = {
    class: new Map(),
    company: new Map(),
  };
  let consoleCommon!: HTMLInputElement;

  const consoleBuckets = (axis: 'class' | 'company'): string[] =>
    axis === 'class' ? settings.consoleClasses : settings.consoleCompanies;

  const renderConsole = () => {
    const grid = element<HTMLElement>(root, '[data-console-grid]');
    grid.replaceChildren();
    consoleInputs.class.clear();
    consoleInputs.company.clear();

    const field = (label: string, value: number): [HTMLLabelElement, HTMLInputElement] => {
      const wrap = document.createElement('label');
      const text = document.createElement('span');
      text.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '1000';
      input.step = '1';
      input.value = String(value);
      wrap.append(text, input);
      return [wrap, input];
    };
    const group = (title: string, nodes: HTMLElement[]) => {
      const box = document.createElement('div');
      box.className = 'console-group';
      box.append(createText('h4', title), ...nodes);
      return box;
    };

    const [commonWrap, commonInput] = field('전체', CONSOLE_DEFAULTS.common);
    commonInput.id = 'console-common';
    consoleCommon = commonInput;

    const axisGroup = (axis: 'class' | 'company', title: string) => group(
      title,
      consoleBuckets(axis).map((bucket) => {
        const [wrap, input] = field(bucket, CONSOLE_DEFAULTS[axis]);
        input.dataset.consoleBucket = `${axis}:${bucket}`;
        consoleInputs[axis].set(bucket, input);
        return wrap;
      }),
    );

    grid.append(
      group('공통', [commonWrap]),
      axisGroup('class', '클래스'),
      axisGroup('company', '기업'),
    );
  };
  renderConsole();

  const readConsoleBuckets = (axis: 'class' | 'company'): Record<string, number> =>
    Object.fromEntries([...consoleInputs[axis]].map(([bucket, input]) => [bucket, Number(input.value)]));

  const writeConsoleBuckets = (axis: 'class' | 'company', levels: Record<string, number>) => {
    for (const [bucket, input] of consoleInputs[axis]) {
      const level = levels[bucket];
      if (level !== undefined) input.value = String(level);
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
    console: {
      common_level: Number(consoleCommon.value),
      class_level: readConsoleBuckets('class'),
      company_level: readConsoleBuckets('company'),
    },
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
    if (battle.console) {
      consoleCommon.value = String(battle.console.common_level);
      writeConsoleBuckets('class', battle.console.class_level);
      writeConsoleBuckets('company', battle.console.company_level);
    }
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

  // ── 조합 공유 코드 ──────────────────────────────────────────────────────
  const shareModal = element<HTMLElement>(root, '[data-share-modal]');
  const shareOut = element<HTMLTextAreaElement>(root, '[data-share-out]');
  const shareIn = element<HTMLTextAreaElement>(root, '[data-share-in]');
  const shareMsg = element<HTMLElement>(root, '[data-share-msg]');
  const showShareMsg = (message: string, ok = false) => {
    shareMsg.hidden = message === '';
    shareMsg.textContent = message;
    shareMsg.classList.toggle('is-ok', ok);
  };
  element<HTMLButtonElement>(root, '[data-share-open]').addEventListener('click', () => {
    shareOut.value = encodeShareCode(decks, fiveDeckMode);
    shareIn.value = '';
    showShareMsg('');
    shareModal.hidden = false;
  });
  element<HTMLButtonElement>(root, '[data-share-close]').addEventListener('click', () => {
    shareModal.hidden = true;
  });
  shareModal.addEventListener('click', (event) => {
    if (event.target === shareModal) shareModal.hidden = true;
  });
  element<HTMLButtonElement>(root, '[data-share-copy]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareOut.value);
      showShareMsg('조합 코드를 복사했습니다. 이대로 공유하면 됩니다.', true);
    } catch {
      shareOut.select();
      showShareMsg('자동 복사가 막혀 코드를 선택해 뒀습니다. Ctrl+C로 복사해 주세요.');
    }
  });
  element<HTMLButtonElement>(root, '[data-share-apply]').addEventListener('click', () => {
    try {
      const payload = decodeShareCode(shareIn.value);
      // 스펙은 내 것을 쓴다 — CSV 로스터를 넣어 뒀으면 그대로 얹힌다.
      const { applied, skipped } = applyShareToDecks(
        payload, decks,
        (name) => catalogByName.has(name),
        (name) => (roster[name] ? cloneOverride(roster[name]!) : undefined),
      );
      fiveDeckMode = payload.fiveDeckMode || applied > 1;
      element<HTMLInputElement>(root, '#squad-mode').checked = fiveDeckMode;
      deckTabs.hidden = !fiveDeckMode;
      deckNote.hidden = !fiveDeckMode;
      activeDeckId = 1;
      saveState();
      renderDeckTabs();
      renderSquad();
      showErrors([]);
      const missing = skipped.length > 0
        ? ` · 목록에 없는 니케 ${skipped.length}명 제외(${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''})`
        : '';
      showShareMsg(`덱 ${applied}개를 적용했습니다${missing}.`, skipped.length === 0);
    } catch (error) {
      showShareMsg(error instanceof Error ? error.message : String(error));
    }
  });

  // ── 보고서 이미지 ────────────────────────────────────────────────────────
  let lastBatch: BatchResult | null = null;
  let reportBlob: Blob | null = null;
  const reportModal = element<HTMLElement>(root, '[data-report-modal]');
  const reportPreview = element<HTMLElement>(root, '[data-report-preview]');
  const reportMsg = element<HTMLElement>(root, '[data-report-msg]');

  const showReportMsg = (message: string, ok = false) => {
    reportMsg.hidden = message === '';
    reportMsg.textContent = message;
    reportMsg.classList.toggle('is-ok', ok);
  };

  const openReport = async () => {
    if (!lastBatch) return;
    const batch = lastBatch;
    showReportMsg('');
    reportPreview.replaceChildren(createText('p', '보고서를 그리는 중…', 'report-loading'));
    reportModal.hidden = false;
    try {
      const names = batch.decks.flatMap((entry) => entry.request.squad);
      const portraits = await loadPortraits(names, catalogByName, import.meta.env.BASE_URL);
      const battle = readBattle();
      const meta: ReportMeta = {
        enemyDef: battle.enemyDef,
        enemyCode: battle.enemyCode,
        corePx: battle.coreEnabled ? battle.corePx : 0,
        hasParts: battle.hasParts,
        siteUrl: 'moris-kr.github.io/nikke-calc',
      };
      const canvas = renderReport(batch, meta, portraits);
      reportBlob = await canvasToBlob(canvas);
      const image = document.createElement('img');
      image.src = URL.createObjectURL(reportBlob);
      image.alt = '전투 결과 보고서';
      image.dataset.reportImage = '';
      reportPreview.replaceChildren(image);
    } catch (error) {
      reportBlob = null;
      reportPreview.replaceChildren();
      showReportMsg(error instanceof Error ? error.message : '보고서를 만들지 못했습니다.');
    }
  };

  const closeReport = () => { reportModal.hidden = true; };
  element<HTMLButtonElement>(root, '[data-report-close]').addEventListener('click', closeReport);
  reportModal.addEventListener('click', (event) => {
    if (event.target === reportModal) closeReport();
  });
  element<HTMLButtonElement>(root, '[data-report-copy]').addEventListener('click', () => {
    void (async () => {
      if (!reportBlob) return;
      // 이미지 클립보드 쓰기를 막는 브라우저가 있어 실패하면 저장으로 안내한다.
      const outcome = await copyImage(reportBlob);
      const message = {
        copied: '이미지를 복사했습니다. 커뮤니티 글에 붙여넣으세요.',
        unsupported: '이 브라우저는 이미지 복사를 지원하지 않습니다. PNG 저장을 사용해 주세요.',
        blocked: '복사가 차단됐습니다. 이 창을 한 번 클릭한 뒤 다시 눌러 보세요. 계속 막히면 PNG 저장을 사용해 주세요.',
      }[outcome];
      showReportMsg(message, outcome === 'copied');
    })();
  });
  element<HTMLButtonElement>(root, '[data-report-save]').addEventListener('click', () => {
    if (!reportBlob || !lastBatch) return;
    downloadImage(reportBlob, reportFilename(lastBatch));
    showReportMsg('PNG로 저장했습니다.', true);
  });

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

    // 보고서는 마지막으로 그려진 결과를 그대로 쓴다.
    lastBatch = batch;
    const reportTools = document.createElement('div');
    reportTools.className = 'report-tools';
    const reportButton = document.createElement('button');
    reportButton.type = 'button';
    reportButton.className = 'report-open';
    reportButton.dataset.reportOpen = '';
    reportButton.textContent = '보고서 이미지 만들기';
    reportButton.title = '결과를 한 장짜리 PNG로 만들어 복사하거나 저장합니다';
    reportButton.addEventListener('click', () => { void openReport(); });
    reportTools.append(reportButton);
    resultPanel.append(reportTools);

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
    deckCopy.hidden = !fiveDeckMode;
    closeDeckCopy();
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
  // 지원 니케 목록 — 카탈로그(파싱까지 끝난 실제 캐릭터)를 그리드로 보여준다.
  const rosterModal = element<HTMLElement>(root, '[data-roster-modal]');
  const rosterGrid = element<HTMLElement>(root, '[data-roster-grid]');
  const rosterSearch = element<HTMLInputElement>(root, '[data-roster-search]');
  const rosterEmpty = element<HTMLElement>(root, '[data-roster-empty]');
  const rosterCount = element<HTMLElement>(root, '[data-roster-count]');

  const renderRosterGrid = () => {
    // 직접 추가한 니케까지 포함해 지금 고를 수 있는 전체를 보여준다.
    const all = [...catalogByName.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const query = rosterSearch.value.trim().toLowerCase();
    const shown = query ? all.filter((char) => char.name.toLowerCase().includes(query)) : all;
    rosterCount.textContent = query ? `${shown.length} / ${all.length}명` : `${all.length}명`;
    rosterGrid.replaceChildren();
    for (const char of shown) {
      const cell = document.createElement('article');
      cell.className = 'roster-cell';
      cell.dataset.rosterCell = '';
      const portrait = document.createElement('div');
      portrait.className = 'roster-portrait';
      if (char.image) {
        const img = document.createElement('img');
        img.src = `${import.meta.env.BASE_URL}${char.image}`;
        img.alt = '';
        img.loading = 'lazy';
        portrait.append(img);
      }
      const badge = document.createElement('span');
      badge.className = 'roster-burst';
      badge.textContent = `B${char.burstStage}`;
      portrait.append(badge);
      cell.append(
        portrait,
        createText('strong', char.name),
        createText('span', [char.elementCode, char.weaponType, char.className].filter(Boolean).join(' · ')),
      );
      rosterGrid.append(cell);
    }
    rosterEmpty.hidden = shown.length > 0;
  };

  const closeRosterModal = () => { rosterModal.hidden = true; };
  element<HTMLButtonElement>(root, '[data-roster-open]').addEventListener('click', () => {
    rosterSearch.value = '';
    renderRosterGrid();
    rosterModal.hidden = false;
  });
  element<HTMLButtonElement>(root, '[data-roster-close]').addEventListener('click', closeRosterModal);
  rosterModal.addEventListener('click', (event) => {
    if (event.target === rosterModal) closeRosterModal();
  });
  rosterSearch.addEventListener('input', renderRosterGrid);

  // 완전 초기화 — 이 브라우저에 쌓인 저장 상태를 전부 버린다. 메모리 변수까지
  // 하나씩 되돌리는 대신 저장소를 비우고 페이지를 다시 띄워, 새로 방문한 것과
  // 같은 상태임을 보장한다.
  const resetModal = element<HTMLElement>(root, '[data-reset-modal]');
  const closeResetModal = () => { resetModal.hidden = true; };
  element<HTMLButtonElement>(root, '[data-reset-all]').addEventListener('click', () => {
    resetModal.hidden = false;
  });
  element<HTMLButtonElement>(root, '[data-reset-close]').addEventListener('click', closeResetModal);
  element<HTMLButtonElement>(root, '[data-reset-cancel]').addEventListener('click', closeResetModal);
  resetModal.addEventListener('click', (event) => {
    if (event.target === resetModal) closeResetModal();
  });
  element<HTMLButtonElement>(root, '[data-reset-confirm]').addEventListener('click', () => {
    cache.clear();
    const store = resolveStorage();
    for (const key of [STATE_KEY, ROSTER_KEY, CUSTOM_KEY]) {
      try {
        store?.removeItem(key);
      } catch {
        // 저장소를 못 쓰는 브라우저에서도 나머지 초기화는 계속한다.
      }
    }
    closeResetModal();
    (reload ?? (() => window.location.reload()))();
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
      deckCopy.hidden = false;
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
