import { ResultCache, type StorageLike, type StorageSource } from './cache';
import { renderCharacterSettings, type CharPanelKind } from './character-settings';
import {
  BLABLA_SERVERS,
  areaToOverrides,
  blablaServerLabel,
  consoleFrom,
  looksLikeProfileUrl,
  pickArea,
  type RawProfile,
} from './blablalink';
import { parseRosterCsv } from './csv-import';
import {
  formatEok,
  loadEnikkComps,
  WEAKNESS_KO,
  type EnikkImport,
  type EnikkPlayer,
} from './enikk';
import { buildIndex, filterByQuery } from './nikke-search';
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
import { csvBlob, csvFileName, csvText, damageCsv } from './export-csv';
import {
  applyShareToDecks, decodeBattleCode, decodeShareCode, encodeBattleCode, encodeShareCode,
} from './share-code';
import { LATEST_NOTICE_ID, NOTICES, noticeFragment, noticeToShow } from './notices';
import { mountSharePanel, squadPreview, type SharePanel } from './share-panel';
import { startPresence } from './presence';
import { mountUnionRaid } from './union-raid';
import { EXTERNAL_LINKS, hostOf } from './external-links';
import {
  BURST_STAGES,
  candidatesFor, cycleLine, cyclesFromTimeline, estimateCycles, HOTKEYS, MAX_CYCLES,
  picksFrom, progressOf, sequenceForDeck, sequenceFrom, stepKey, stepsFor, trimSequence,
  type BurstStage, type BurstStep,
} from './burst-order';
import { ShareServer, summarizeBattle, summarizeSquad } from './share-server';
import { createTimelineBlock } from './timeline';
import {
  aggregateDeckResults,
  cacheKey,
  DEFAULT_BURST_REACTION,
  DEFAULT_SYNCHRO_LEVEL,
  SYNCHRO_MAX,
  SYNCHRO_MEASURED_MAX,
  formatDamage,
  formatDps,
  formatExactDamage,
  formatExactDps,
  requestForDeck,
  resetEnemy,
  validateDecks,
  validateRequest,
} from './model';
import type {
  BatchResult,
  BattleSettings,
  BuffTargetRow,
  CombatPowerRequest,
  ElementWindow,
  PhaseWindow,
  RngMode,
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
  /** 목록 정렬용 전투력. 없는 구현(테스트 대역)도 있어 선택으로 둔다. */
  combatPower?(request: CombatPowerRequest): Promise<Record<string, number>>;
  /** 병렬 계산. 풀이 아닌 구현(테스트 대역·워커 하나)도 있어 전부 선택으로 둔다. */
  setPoolSize?(size: number): void;
  defaultPoolSize?(): number;
  maxPoolSize?: number;
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
  /** 테스트·자체 호스팅에서 빌드 환경값 대신 쓸 BlablaLink 프록시 주소. */
  blablaProxy?: string;
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

// 속성(코드) 아이콘 — 그림은 `image/icon/icon-code-*.png`가 정본이다.
// 직접 추가한 니케가 목록에 없는 코드를 쓰면 조용히 아이콘을 생략한다.
const ELEMENT_ICON: Record<string, string> = {
  작열: 'fire', 수냉: 'water', 풍압: 'wind', 전격: 'electronic', 철갑: 'iron',
};

const createElementIcon = (elementCode: string, className: string): HTMLElement | null => {
  const slug = ELEMENT_ICON[elementCode];
  if (!slug) return null;
  const icon = document.createElement('span');
  icon.className = `${className} element-icon is-${slug}`;
  icon.title = elementCode;
  icon.ariaLabel = elementCode;
  return icon;
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

/** 딜 1·2위 이름. 순서는 그대로 두고 «표시»만 얹기 위해 이름만 뽑는다. */
function topScorers(entry: DeckResultEntry): Map<string, number> {
  const ranked = [...new Set(entry.request.squad)]
    .map((name) => [name, entry.result.charTotals[name] ?? 0] as const)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  return new Map(ranked.slice(0, 2).map(([name], index) => [name, index + 1]));
}

/**
 * 캐릭터별 결과 줄. 초상화 오른쪽에 막대와 총딜이 선다 — 덱을 갈아 가며 볼 때는
 * 카드보다 이쪽이 짧고, 막대 길이로 «누가 캐리했나»가 곧바로 읽힌다.
 * 여기서도 **편성 순서 그대로**이고, 딜 1·2위는 뱃지와 테두리로만 표시한다.
 */
/** 대미지를 어떻게 적을지. 「자세히 보기」로 갈린다 — 값이 아니라 표기만 바뀐다. */
interface DamageFormat {
  dmg(value: number): string;
  dps(value: number): string;
}

function renderCharacterRows(
  container: HTMLElement,
  entry: DeckResultEntry,
  imageOf: (name: string) => string | undefined,
  fmt: DamageFormat,
): void {
  const rows = document.createElement('div');
  rows.className = 'result-rows';
  const tops = topScorers(entry);
  const best = Math.max(...entry.request.squad.map((name) => entry.result.charTotals[name] ?? 0), 0);

  for (const name of entry.request.squad) {
    const value = entry.result.charTotals[name] ?? 0;
    const share = entry.result.squadTotal > 0 ? value / entry.result.squadTotal * 100 : 0;
    const rank = tops.get(name);
    const row = document.createElement('article');
    row.className = 'character-result result-row'
      + (rank === 1 ? ' is-first' : rank === 2 ? ' is-second' : '');
    row.dataset.characterResult = name;
    if (rank) row.dataset.dmgRank = String(rank);

    const portrait = document.createElement('div');
    portrait.className = 'result-row-face';
    const source = imageOf(name);
    if (source) {
      const image = document.createElement('img');
      image.src = source;
      image.alt = '';
      image.loading = 'lazy';
      portrait.append(image);
    }
    if (rank) portrait.append(createText('b', String(rank), 'result-rank-badge'));
    row.append(portrait);

    const body = document.createElement('div');
    body.className = 'result-row-body';
    const head = document.createElement('p');
    head.className = 'result-row-name';
    head.append(
      createText('b', name),
      createText('span', `${share.toFixed(1)}% · ${fmt.dps(value / entry.result.duration)}`),
    );
    const track = document.createElement('div');
    track.className = 'share-track';
    const bar = document.createElement('i');
    bar.style.width = `${best > 0 ? Math.max(2, value / best * 100) : 2}%`;
    track.append(bar);
    body.append(head, track);
    row.append(body);

    row.append(createText('strong', Math.round(value).toLocaleString('ko-KR'), 'result-row-total'));
    rows.append(row);
  }
  container.append(rows);
}

/**
 * 캐릭터별 결과 카드. **편성 순서 그대로** 왼쪽에서 오른쪽으로 선다 — 위 편성 카드와
 * 자리가 맞아야 «누가 얼마나»를 눈으로 그대로 잇는다. 딜 1·2위는 자리를 옮기지 않고
 * 뱃지와 테두리로만 표시한다.
 */
function renderCharacterCards(
  container: HTMLElement,
  entry: DeckResultEntry,
  imageOf: (name: string) => string | undefined,
  fmt: DamageFormat,
): void {
  const grid = document.createElement('div');
  grid.className = 'result-cards';
  const tops = topScorers(entry);
  const best = Math.max(...entry.request.squad.map((name) => entry.result.charTotals[name] ?? 0), 0);

  for (const name of entry.request.squad) {
    const value = entry.result.charTotals[name] ?? 0;
    const share = entry.result.squadTotal > 0 ? value / entry.result.squadTotal * 100 : 0;
    const rank = tops.get(name);
    const card = document.createElement('article');
    card.className = 'character-result result-card'
      + (rank === 1 ? ' is-first' : rank === 2 ? ' is-second' : '');
    card.dataset.characterResult = name;
    if (rank) card.dataset.dmgRank = String(rank);

    const portrait = document.createElement('div');
    portrait.className = 'result-card-face';
    const source = imageOf(name);
    if (source) {
      const image = document.createElement('img');
      image.src = source;
      image.alt = '';
      image.loading = 'lazy';
      portrait.append(image);
    }
    if (rank) portrait.append(createText('b', `${rank}위`, 'result-rank-badge'));
    card.append(portrait);

    card.append(createText('h3', name));
    card.append(createText('span', `${share.toFixed(1)}% 기여`, 'result-card-share'));
    card.append(createText('strong', fmt.dmg(value)));
    card.append(createText('small', fmt.dps(value / entry.result.duration)));

    const track = document.createElement('div');
    track.className = 'share-track';
    const bar = document.createElement('i');
    // 막대는 «1위 대비»로 그린다 — 기여%로 그리면 다섯이 다 짧아 차이가 안 보인다.
    bar.style.width = `${best > 0 ? Math.max(2, value / best * 100) : 2}%`;
    track.append(bar);
    card.append(track);

    // 평타/스킬 분해와 스킬별 내역. 카드가 좁으니 접어 둔다.
    const breakdown = entry.result.charBreakdown?.[name];
    if (breakdown && value > 0) {
      const details = document.createElement('details');
      details.className = 'dmg-split';
      details.dataset.dmgSplit = '';
      const normalPct = breakdown.normal / value * 100;
      const skillPct = breakdown.skill / value * 100;
      const summary = document.createElement('summary');
      summary.append(createText('span', `평타 ${normalPct.toFixed(0)}%`, 'legend-normal'));
      summary.append(createText('span', `스킬 ${skillPct.toFixed(0)}%`, 'legend-skill'));
      details.append(summary);

      const splitTrack = document.createElement('div');
      splitTrack.className = 'split-track';
      const normalBar = document.createElement('i');
      normalBar.className = 'split-normal';
      normalBar.style.width = `${normalPct}%`;
      const skillBar = document.createElement('i');
      skillBar.className = 'split-skill';
      skillBar.style.width = `${skillPct}%`;
      splitTrack.append(normalBar, skillBar);
      details.append(splitTrack);

      const legend = document.createElement('p');
      legend.className = 'split-legend';
      legend.append(
        createText('span', `평타 ${fmt.dmg(breakdown.normal)}`, 'legend-normal'),
        createText('span', `스킬 ${fmt.dmg(breakdown.skill)}`, 'legend-skill'),
      );
      details.append(legend);

      if (breakdown.skills.length > 0) {
        const list = document.createElement('ul');
        list.className = 'skill-breakdown';
        for (const skill of breakdown.skills) {
          const item = document.createElement('li');
          item.append(
            createText('span', skill.name),
            createText('span', `${fmt.dmg(skill.damage)} · ${(skill.damage / value * 100).toFixed(1)}% · ${skill.hits}히트`),
          );
          list.append(item);
        }
        details.append(list);
      }
      card.append(details);
    }
    grid.append(card);
  }
  container.append(grid);
}

// 블라블라링크 조회 프록시. 빌드 때 `VITE_BLABLA_PROXY`로 박히고, 비어 있으면 연동 UI를
// 그리지 않는다 — 프록시 없이 브라우저에서 직접 부르면 CORS와 로그인 세션 두 가지가 동시에
// 막아 반드시 실패한다(`worker/README.md`).
const BLABLA_PROXY = (import.meta.env.VITE_BLABLA_PROXY ?? '').trim().replace(/\/+$/, '');
// 설정 공유 서버(`worker-share/`). 비어 있으면 공유 모달이 코드 주고받기만 그린다 —
// 서버 없이 부르면 반드시 실패하므로 탭을 만들어 두는 쪽이 더 헷갈린다.
const SHARE_API = (import.meta.env.VITE_SHARE_API ?? '').trim().replace(/\/+$/, '');

export function mountCalculator(root: HTMLElement, deps: CalculatorDependencies): () => void {
  const { catalog, settings, version, client, storage, reload } = deps;
  const blablaProxy = (deps.blablaProxy ?? BLABLA_PROXY).trim().replace(/\/+$/, '');
  const cache = new ResultCache(storage, version, 30);
  const catalogByName = new Map(catalog.map((char) => [char.name, char]));
  const decks = Array.from({ length: 5 }, (_, index) => emptyDeck(index + 1));
  decks[0]!.squad = initialSquad(catalog);
  let activeDeckId = 1;
  let activeSlot = 0;
  // 겨냥한 칸을 화면으로 끌어오는 것은 **사용자가 칸을 바꿨을 때만** 한다.
  // 결과가 도착해도 편성은 다시 그려지는데, 그때마다 끌어오면 결과를 보던 사람이
  // 편성 쪽으로 튕겨 올라간다.
  let pullActiveSlot = false;
  // 다른 덱에 만들어 둔 개별 설정을 편성할 때 따라오게 할지. 기본은 켬이다.
  let carryOverSettings = true;
  let fiveDeckMode = false;
  let activity: 'preparing' | 'ready' | 'running' | 'complete' | 'cached' | 'error' = 'preparing';

  const ROSTER_KEY = 'nikke-roster-v1';
  const resolveStorage = (): StorageLike | null => {
    const source = typeof storage === 'function' ? storage() : storage;
    return source ?? null;
  };
  // jsdom에는 scrollIntoView가 없다. 화면을 끌어오는 건 편의라, 없는 환경에서는
  // 건너뛰어도 렌더가 깨지지 않는다 — 직접 부르면 테스트가 처리되지 않은 오류로 끊긴다.
  const scrollTo = (el: HTMLElement) => {
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  };

  const cloneOverride = (value: object): CharacterOverrides =>
    JSON.parse(JSON.stringify(value)) as CharacterOverrides;
  // 예전 판(육성 프로필 불러오기)이 저장한 오버로드는 값이 **줄별 배열**일 수 있다.
  // 지금은 스칼라만 다루므로 합계로 옮긴다 — 두면 요약을 그릴 때 toFixed에서 끊긴다.
  const migrateOverloadLines = (overrides: CharacterOverrides | undefined) => {
    const overload = overrides?.overload as Record<string, unknown> | undefined;
    if (!overload) return;
    for (const [key, value] of Object.entries(overload)) {
      if (Array.isArray(value)) {
        overload[key] = value.reduce((sum: number, v) => sum + (Number(v) || 0), 0);
      }
    }
  };

  const loadRoster = (): Record<string, CharacterOverrides> => {
    try {
      const raw = resolveStorage()?.getItem(ROSTER_KEY);
      const stored = raw ? (JSON.parse(raw) as Record<string, CharacterOverrides>) : {};
      for (const overrides of Object.values(stored)) migrateOverloadLines(overrides);
      return stored;
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
    /** 다른 덱의 개별 설정을 편성할 때 이어받을지. 옛 저장본에는 없다. */
    carryOverSettings: boolean;
    battle: BattleSettings;
    buffTargets: Array<{ id: number; sig: string; rows: Record<string, BuffTargetRow[]> }>;
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
      for (const overrides of Object.values(deck.characters ?? {})) migrateOverloadLines(overrides);
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
      <p class="site-notice"><a href="https://gall.dcinside.com/mgallery/board/view/?id=gov&amp;no=6038781" target="_blank" rel="noreferrer">설명서 확인, 문의, 피드백, 착한말 등은 여기로 →</a></p>
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">BROWSER SIM <span>·</span> 60 FPS TIMELINE</p>
          <h1><span>NIKKE</span> 스쿼드 계산기</h1>
          <p class="hero-lede">캐릭터별 오버로드와 큐브, 전투 조건을 반영해 프레임 단위 예상 대미지를 계산합니다.</p>
          <div class="trust-row" aria-label="서비스 특징"><span>${catalog.length}명 지원</span><span class="online-now" data-online hidden title="최근 1~2분 사이에 이 계산기를 연 사람 수입니다. 탭을 숨기면 세지 않습니다"><b class="online-dot" aria-hidden="true"></b><span data-online-text></span></span><button type="button" class="notice-open" data-notice-open title="지금까지 무엇이 바뀌었는지 봅니다">업데이트 내역</button><a class="credit-link" href="https://github.com/Jgaram/nikke-calc" target="_blank" rel="noreferrer noopener" title="이 계산기의 원본 저장소">원본 알고리즘 개발자에게 무한한 감사를</a></div>
        </div>
        <div class="hero-orbit" aria-hidden="true"><span>01</span><strong>LOCAL<br />SIM</strong></div>
      </header>

      <nav class="view-tabs" aria-label="화면 전환">
        <button type="button" class="view-tab is-on" data-view-tab="calc" aria-pressed="true">계산기</button>
        ${blablaProxy ? '<button type="button" class="view-tab" data-view-tab="union" aria-pressed="false">유니온 레이드<b class="tab-beta">BETA</b></button>' : ''}
        <button type="button" class="view-tab" data-view-tab="enikk" aria-pressed="false">ENIKK 조합 가져오기</button>
        <button type="button" class="view-tab" data-view-tab="links" aria-pressed="false">외부고리</button>
      </nav>

      <section class="panel links-panel" data-view="links" aria-labelledby="links-heading" hidden>
        <div class="section-heading">
          <div><p class="step">LINKS</p><h2 id="links-heading">외부고리</h2></div>
        </div>
        <p class="links-lede">니케를 굴리는 데 쓰는 <b>다른 사람들의 도구</b>입니다. 새 탭에서 열립니다.</p>
        <p class="links-warn"><b>여기 적힌 곳은 우리가 운영하지 않습니다.</b> 계산기에 넣어 둔 값이나 계정 정보가 저쪽으로 넘어가지 않고, 저쪽 내용·주소가 바뀌어도 우리가 알지 못합니다.</p>
        <div class="links-grid" data-links-grid></div>
      </section>

      ${blablaProxy ? `
      <section class="panel union-panel" data-view="union" aria-labelledby="union-heading" hidden>
        <div class="section-heading">
          <div><p class="step">UNION</p><h2 id="union-heading">유니온 레이드 <b class="beta-tag">BETA</b></h2></div>
        </div>
        <div class="union-modes" role="group" aria-label="계산 대상">
          <button type="button" class="union-mode is-on" data-union-mode="union" aria-pressed="true">유니온</button>
          <button type="button" class="union-mode" data-union-mode="personal" aria-pressed="false">개인용</button>
        </div>
        <p class="union-lede" data-union-lede-union>유니온원 <b>각자의 실제 스펙과 싱크로 레벨</b>로 같은 보스·같은 덱을 돌려, 누가 얼마나 기여할 수 있는지 견줍니다. 니케 목록을 공개한 사람만 계산할 수 있습니다.</p>
        <p class="union-lede" data-union-lede-personal hidden><b>내 스펙만</b> 씁니다. 명단을 가져올 필요 없이, 보스마다 다른 전투 조건을 걸고 덱을 세 개까지 돌려 한눈에 견줍니다 — 계산기에 잡아 둔 싱크로·콘솔·니케 육성을 그대로 씁니다.</p>

        <div class="union-step" data-union-step="1">
          <h3>유니온 명단 가져오기</h3>
          <p class="field-note">유니온원 명단은 <b>지휘관님 로그인으로만</b> 열립니다(우리 서버로는 막혀 있습니다). 그래서 한 번만 직접 떠 오시면 됩니다 — 쿠키나 비밀번호는 저희가 만지지 않습니다.</p>
          <ol class="union-guide">
            <li>블라블라링크에 로그인한 채 <b>유니온 스퀘어</b>를 엽니다.</li>
            <li><kbd>F12</kbd> → <b>Console</b> 탭에 아래 내용을 붙여넣고 <kbd>Enter</kbd>.</li>
            <li>명단이 클립보드에 담깁니다. 아래 상자에 붙여넣으세요.</li>
            <li>클립보드가 막혀 있으면 <b>페이지에 상자가 뜨고 내용이 전부 선택돼 있습니다</b> — <kbd>Ctrl</kbd>+<kbd>A</kbd> → <kbd>Ctrl</kbd>+<kbd>C</kbd>로 복사한 뒤 <b>✕</b>나 <kbd>Esc</kbd>, 또는 상자 바깥을 눌러 닫으면 됩니다.</li>
          </ol>
          <textarea class="union-snippet" data-union-snippet rows="3" readonly spellcheck="false"></textarea>
          <div class="union-actions">
            <button type="button" class="roster-import" data-union-copy>스니펫 복사</button>
          </div>
          <textarea class="union-paste" data-union-paste rows="3" placeholder="여기에 명단을 붙여넣으세요" spellcheck="false"></textarea>
          <div class="union-actions">
            <button type="button" class="roster-import" data-union-read>명단 읽기</button>
            <span class="union-status" data-union-list-status></span>
          </div>
        </div>

        <div class="union-step" data-union-step="2" hidden>
          <h3>공개여부 확인</h3>
          <p class="field-note">한 명씩 실제로 조회해 봐야 알 수 있습니다. 셋씩 동시에 부르며, 공개한 사람은 니케 상세까지 함께 받아 둡니다.</p>
          <div class="union-actions">
            <button type="button" class="roster-import" data-union-scan>공개여부 스캔</button>
            <button type="button" class="roster-import" data-union-scan-stop hidden>중단</button>
            <span class="union-status" data-union-scan-status></span>
          </div>
          <div class="union-progress" data-union-scan-progress hidden><i></i></div>

          <details class="union-direct">
            <summary>내 브라우저로 직접 긁기 — 「유니온원에게만 공개」까지 봅니다</summary>
            <p class="field-note">위 스캔은 저희 서버를 거칩니다. 저희 계정은 이 유니온 소속이 아니라서, <b>「유니온원에게만 공개」로 둔 사람은 영원히 비공개로 보입니다</b>. 지휘관님 브라우저로 직접 긁으면 그분들까지 보입니다 — 서버를 안 거치는 쪽이 편한 분께도 이 길이 낫습니다.</p>
            <p class="field-note">유니온원 수만큼 조회하므로 <b>32명이면 2~3분</b> 걸리고, 진행 상황이 콘솔에 한 줄씩 찍힙니다. 다 되면 위와 같은 방법으로 복사해 아래에 붙여넣으세요.</p>
            <textarea class="union-snippet" data-union-direct-snippet rows="3" readonly spellcheck="false"></textarea>
            <div class="union-actions">
              <button type="button" class="roster-import" data-union-direct-copy>직접 긁기 스니펫 복사</button>
            </div>
            <textarea class="union-paste" data-union-direct-paste rows="3" placeholder="직접 긁은 자료를 여기에 붙여넣으세요 (NKU1-…)" spellcheck="false"></textarea>
            <div class="union-actions">
              <button type="button" class="roster-import" data-union-direct-read>직접 긁은 자료 읽기</button>
              <span class="union-status" data-union-direct-status></span>
            </div>
          </details>

          <div class="union-members" data-union-members></div>
          <div class="union-ask" data-union-ask hidden>
            <p data-union-ask-text></p>
            <button type="button" class="roster-import" data-union-pick-all>공개된 사람 전부 고르기</button>
            <button type="button" class="roster-import" data-union-pick-none>전부 해제</button>
          </div>
        </div>

        <div class="union-step" data-union-step="3" hidden>
          <h3>보스와 덱</h3>
          <p class="field-note">보스는 <b>전투 조건 코드</b>(NK3-), 덱은 <b>조합 코드</b>(NK2-)로 채웁니다. 계산기에 잡아 둔 설정을 가져오거나, <b>공유 목록에서 골라</b> 넣을 수도 있습니다. 체크를 끈 보스는 계산하지 않습니다 — 풍압엔 강한데 전격엔 약한 사람이 있으니까요.</p>
          <div class="union-board-bar">
            <span class="union-board-label">판 전체</span>
            <button type="button" class="roster-import" data-union-set-share>공유에서 판 고르기</button>
            <button type="button" class="roster-import" data-union-set-paste>판 코드 붙여넣기</button>
            <button type="button" class="roster-import" data-union-set-copy>이 판 코드 복사</button>
            <span class="union-status" data-union-set-status></span>
          </div>
          <p class="field-note">보스 다섯과 각 칸의 덱까지 <b>한 코드</b>(NK4-)에 담깁니다 — 지난 시즌 판을 통째로 옮기거나 유니온방에 뿌릴 때 스무 번 붙여넣지 않아도 됩니다. <b>유니온원 명단은 담기지 않습니다.</b></p>
          <div class="union-set-box" data-union-set-box hidden>
            <textarea class="custom-json" data-union-set-code rows="3" placeholder="판 코드 (NK4-…)"></textarea>
            <div class="deck-copy-actions">
              <button type="button" class="deck-copy-apply" data-union-set-apply>이 판 적용</button>
              <button type="button" class="deck-copy-cancel" data-union-set-close>닫기</button>
            </div>
          </div>
          <div class="union-bosses" data-union-bosses></div>

          <div class="custom-modal" data-union-share-modal hidden>
            <div class="custom-card share-card" role="dialog" aria-label="공유에서 고르기">
              <div class="custom-head"><h2 data-union-share-title>공유에서 고르기</h2><button type="button" class="custom-close" data-union-share-close aria-label="닫기">✕</button></div>
              <p class="custom-desc" data-union-share-desc></p>
              <div data-union-share-body></div>
              <p class="custom-msg" data-union-share-msg hidden></p>
            </div>
          </div>
        </div>

        <div class="union-step" data-union-step="4" hidden>
          <h3>시뮬레이션</h3>
          <p class="field-note">유니온원 × 보스 × 덱을 하나씩 돌립니다. <b>오래 걸리니 창을 열어 둔 채 기다려 주세요</b> — 결과는 나오는 대로 아래에 쌓입니다.</p>
          <div class="union-actions">
            <button type="button" class="roster-import union-run" data-union-run disabled>시뮬레이션 실행</button>
            <button type="button" class="roster-import" data-union-stop hidden>중단</button>
            <span class="union-status" data-union-run-status></span>
          </div>
          <div class="union-progress" data-union-run-progress hidden><i></i></div>
          <div class="union-report" data-union-report></div>
        </div>
      </section>` : ''}

      <section class="panel enikk-panel" data-view="enikk" aria-labelledby="enikk-heading" hidden>
        <div class="section-heading">
          <div><p class="step">ENIKK</p><h2 id="enikk-heading">ENIKK 조합 가져오기</h2></div>
        </div>
        <p class="enikk-lede">enikk.app 솔로레이드 랭킹에서 <b>그 사람이 실제로 쓴 5덱을 통째로</b> 가져옵니다. 최신 시즌 상위 <b>300명</b>(KR·JP·GLOBAL·NA·TW-HK·SEA 각 50명)이 대상이고, 누르면 우리 5덱에 그대로 깔립니다.</p>
        <p class="enikk-warn" data-enikk-warn>불러오는 데 <b>5~10초쯤</b> 걸립니다 — enikk에서 300명분을 한 번에 받아오기 때문입니다. 받아온 뒤에는 이 브라우저에 저장해 두고 다시 받지 않습니다.</p>
        <div class="enikk-actions">
          <button type="button" class="roster-import" data-enikk-load>조합 가져오기</button>
          <button type="button" class="roster-import" data-enikk-refresh hidden>다시 받기</button>
          <span class="enikk-status" data-enikk-status></span>
        </div>
        <div class="enikk-exclude">
          <label class="enikk-exclude-label" for="enikk-exclude">제외할 니케</label>
          <div class="enikk-exclude-row">
            <input id="enikk-exclude" type="search" list="enikk-exclude-list" placeholder="안 가진 니케 이름을 넣으세요" autocomplete="off" data-enikk-exclude-input />
            <datalist id="enikk-exclude-list" data-enikk-exclude-options></datalist>
            <button type="button" class="roster-import" data-enikk-exclude-add>추가</button>
          </div>
          <div class="enikk-exclude-chips" data-enikk-exclude-chips></div>
          <p class="field-note">넣은 니케가 낀 덱은 <b>가져오기에서 빠집니다</b>. 그 니케가 없어도 짤 수 있는 조합만 남기려는 것입니다.</p>
        </div>
        <div class="enikk-summary" data-enikk-summary hidden></div>
        <div class="enikk-compare" data-enikk-compare hidden></div>
        <div class="enikk-list" data-enikk-list hidden></div>
      </section>

      <form class="calculator-layout" data-view="calc" novalidate>
        <section class="panel squad-panel" aria-labelledby="squad-heading">
          <div class="section-heading">
            <div><h2 id="squad-heading">편성 및 캐릭터 설정</h2></div>
            <div class="squad-tools">
              <span class="roster-import-group">
                <label class="roster-import" title="렛츠도로 니케정보 CSV를 불러와 모든 니케 설정에 적용">
                  <input id="roster-csv" type="file" accept=".csv,text/csv" hidden />
                  <span>렛츠도로 CSV 불러오기</span>
                </label>
                <button type="button" class="roster-info" data-doro-open aria-label="렛츠도로 CSV 받는 법" title="렛츠도로에서 CSV 받는 법">i</button>
              </span>
              ${blablaProxy ? '<button type="button" class="roster-import" data-blabla-open title="블라블라링크 프로필 URL로 보유 니케의 육성을 한 번에 불러옵니다">블라블라링크 연동</button>' : ''}
              <button type="button" class="roster-import" data-add-nikke title="미출시·미등록 니케를 직접 추가">새 니케 추가</button>
              <button type="button" class="roster-import" data-share-open title="편성을 이 브라우저에 이름 붙여 저장하거나, 코드·링크로 주고받습니다. 개인 스펙과 전투 조건은 담기지 않습니다">프리셋 / 조합 공유</button>
              <button type="button" class="roster-import danger" data-reset-all title="편성·설정·CSV 로스터·추가한 니케·저장된 결과를 모두 지우고 처음 상태로 되돌립니다">완전 초기화</button>
              <label class="toggle-field mode-toggle" title="다른 덱에서 이미 만져 둔 개별 설정을 편성할 때 그대로 가져옵니다"><input id="carry-settings" type="checkbox" checked /><span class="toggle"></span><span>설정 이어받기</span></label>
              <label class="toggle-field mode-toggle"><input id="squad-mode" type="checkbox" /><span class="toggle"></span><span>5덱 모드</span></label>
            </div>
            <p class="roster-note" data-roster-note hidden></p>
          </div>
          <div class="deck-tabs" data-deck-tabs hidden></div>
          <div class="deck-controls">
            <button type="button" class="burst-order-open" data-burst-order-open title="사이클마다 1버·2버·3버를 누가 쓸지 직접 정합니다. 정한 만큼만 따르고 그 뒤는 평소 순서로 돌아갑니다"><span class="burst-order-mark" aria-hidden="true">1·2·3</span><span>버스트 순서</span><b class="burst-order-badge" data-burst-order-badge hidden></b></button>
            <span class="deck-moves" data-deck-moves hidden></span>
            <button type="button" class="deck-clear" data-deck-clear title="지금 보고 있는 덱의 편성과 개별 설정을 비웁니다">덱 비우기</button>
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
          </div>
          <p class="deck-note" data-deck-note hidden>덱 사이에는 같은 캐릭터를 다시 편성할 수 있습니다.</p>
          <div class="squad-grid" data-squad-grid></div>

          <!-- 니케 고르기. 창을 띄우지 않고 늘 펼쳐 두고, 검색은 이 판을 거른다.
               「이름을 쳤는데 아무 일도 안 일어난다」가 지적된 지점이라, 결과를
               감추는 자리를 없앴다. -->
          <section class="picker" aria-label="니케 고르기">
            <div class="picker-head">
              <h3>니케 고르기 <span data-roster-count></span></h3>
              <p class="picker-target" data-roster-desc></p>
            </div>
            <input type="search" class="roster-search" data-roster-search placeholder="이름 · 초성 · 속성으로 찾기 (ㄹㅍ, 라피레드, 전격)" autocomplete="off" aria-label="니케 이름 검색" />
            <!-- 정렬·필터는 판을 눌러 펼친다. 칩을 늘 깔아 두면 목록이 화면 밖으로
                 밀리고, 필터가 몇 개 걸렸는지도 한눈에 안 들어온다. -->
            <div class="picker-bar">
              <button type="button" class="filter-open" data-filter-open aria-expanded="false">
                <span>정렬 및 필터</span>
                <b class="filter-badge" data-filter-badge hidden></b>
                <span class="filter-caret" aria-hidden="true">▾</span>
              </button>
              <!-- 버스트는 가장 자주 거르는 축이라 판 안에 넣지 않는다 — 판을 펼치지
                   않고 바로 누를 수 있어야 한다. -->
              <div class="filter-chips burst-chips" data-burst-group></div>
              <button type="button" class="filter-reset" data-filter-reset hidden>필터 지우기</button>
              <span class="filter-summary" data-filter-summary></span>
            </div>
            <!-- 판은 목록을 밀어내지 않고 그 «위에» 얹힌다. 밀어내면 펼칠 때마다
                 목록이 화면 밖으로 내려가 무엇을 고르는 중이었는지 놓친다. -->
            <div class="picker-body">
              <div class="filter-panel" data-filter-panel hidden>
                <div class="filter-section">
                  <p class="filter-title">정렬</p>
                  <div class="filter-chips" data-sort-group></div>
                </div>
                <div class="filter-rule"></div>
                <p class="filter-title">필터</p>
                <div class="filter-groups" data-filter-groups></div>
              </div>
              <div class="picker-scroll"><div class="roster-grid" data-roster-grid></div></div>
            </div>
            <p class="roster-empty" data-roster-empty hidden>검색과 일치하는 니케가 없습니다.</p>
          </section>
        </section>

        <section class="panel settings-panel" aria-labelledby="settings-heading">
          <div class="section-heading compact target-heading">
            <div><h2 id="settings-heading">전투 조건</h2></div>
            <div class="target-actions">
              <button type="button" class="reset-enemy" data-battle-share-open title="전투 조건을 코드로 만들어 공유하거나, 받은 코드를 붙여넣어 적용합니다">전투 조건 공유</button>
              <button type="button" class="reset-enemy" data-reset-enemy>적 수치 초기화</button>
              <button type="button" class="reset-enemy" data-clear-cache title="같은 조건에 저장된 결과를 지우고 다음 실행부터 새로 계산합니다">저장된 결과 지우기</button>
            </div>
          </div>
          <!-- 조건은 한 번 정해 두면 계속 쓰는 값이다. 그 자리에서 펼치면 편성이 화면
               밖으로 밀리므로 창으로 띄우고, 이 줄에는 무엇으로 재는지만 한 줄로 남긴다. -->
          <!-- 조건과 실행을 한 막대로 붙인다. 패널 사이에 단추만 덩그러니 뜨는 자리를
               없애고, «이 조건으로 → 실행»이 한 줄로 읽히게 하려는 것이다. -->
          <div class="cond-bar">
            <button type="button" class="battle-open" data-battle-open aria-expanded="false">
              <span class="battle-open-label">전투 조건</span>
              <span class="battle-summary" data-battle-summary></span>
              <span class="disclosure-hint" aria-hidden="true">열기 ›</span>
            </button>
            <button class="calculate-button run-inline" type="submit"><span>시뮬레이션 실행</span><b aria-hidden="true">→</b></button>
          </div>
          <!-- 계산이 얼마나 빨리 끝나는지를 정하는 설정이라 실행 단추 바로 아래에 둔다. -->
          <div class="parallel-row">
            <label class="toggle-field mode-toggle parallel-pick" title="계산을 여러 작업 스레드에 나눠 돌립니다. 이 기기의 코어를 더 쓰는 대신 5덱 계산이 몇 배 빨라집니다 — 계산은 이 기기에서 도는 것이라 서버 비용과는 무관합니다">
              <input type="checkbox" data-parallel-toggle checked /><span class="toggle"></span><span>병렬 계산</span>
              <select data-parallel-size></select>
            </label>
          </div>
          <p class="status" data-status aria-live="polite">계산 엔진 준비 중…</p>
          <p class="battle-first-note" data-battle-first-note>계산하기 전에 <b>전투 조건을 한 번 확인해 주세요</b> — 몇 초짜리 전투인지, 적 코드가 무엇인지에 따라 결과가 완전히 달라집니다.</p>
          <!-- 막힌 이유는 누른 단추 바로 아래에서 읽혀야 한다. -->
          <div class="error-box" data-errors hidden role="alert"></div>

          <!-- 창은 조건 패널 «안»에 둔다 — 설정 입력을 지켜보는 리스너가 이 패널을
               기준으로 걸려 있어, 밖으로 빼면 값을 바꿔도 저장되지 않는다. -->
          <div class="custom-modal" data-battle-modal hidden>
          <div class="custom-card battle-card" role="dialog" aria-label="전투 조건">
          <div class="custom-head"><h2>전투 조건</h2><button type="button" class="custom-close" data-battle-modal-close aria-label="닫기">✕</button></div>
          <div class="battle-body" data-battle-body>
          <div class="field-grid">
            <label><span>전투 시간</span><div class="input-unit"><input id="duration" type="number" min="10" max="180" step="1" value="180" /><em>초</em></div></label>
            <label><span>적 코드</span><select id="enemy-code"><option value="">없음</option><option value="풍압">풍압(작열weak)</option><option value="수냉">수냉(전격weak)</option><option value="작열">작열(수냉weak)</option><option value="전격">전격(철갑weak)</option><option value="철갑">철갑(풍압weak)</option></select></label>
            <label><span>싱크로 레벨</span><div class="input-unit"><input id="synchro-level" type="number" min="1" max="${SYNCHRO_MAX}" step="1" value="${DEFAULT_SYNCHRO_LEVEL}" title="싱크로 디바이스 소대에 넣은 니케는 전원이 이 레벨이 됩니다. 계정 육성 상태라 전투 조건 공유 코드에는 담기지 않습니다. ${SYNCHRO_MEASURED_MAX}레벨까지는 실측값이고, 그 위는 같은 성장 곡선을 이어 붙여 계산합니다" /><em>Lv</em></div></label>
            <label class="toggle-field"><input id="has-core" type="checkbox" /><span class="toggle"></span><span>코어 있음</span></label>
            <label data-core-size><span>코어 직경</span><div class="input-unit"><input id="core-px" type="number" min="0" max="1000" step="1" value="52" disabled /><em>px</em></div></label>
            <label class="toggle-field"><input id="has-parts" type="checkbox" /><span class="toggle"></span><span>파괴 가능 파츠</span></label>
          </div>
          <fieldset class="range-field">
            <legend>적정거리</legend>
            <div class="range-options" data-optimal-range></div>
            <p class="field-note">고른 무기군의 <b>일반 공격</b>에만 대미지 보너스 +30%가 붙습니다 — 스킬 대미지에는 붙지 않습니다. 적과의 거리에 달린 조건이라 무기군 단위로 켭니다.</p>
          </fieldset>

          <!-- 고급 설정 — 자주 손대지 않는 값과 보스 페이즈를 한자리에 접어 둔다. -->
          <button type="button" class="disclosure" data-advanced-battle aria-expanded="false">
            <span class="disclosure-label">고급 설정</span><span class="disclosure-hint">펼치기</span>
          </button>
          <div class="disclosure-panel" data-advanced-battle-panel hidden>
            <div class="field-grid">
              <label><span>적 방어력</span><input id="enemy-def" type="number" min="0" max="999999" step="1" value="31784" /></label>
              <label><span>난수 시드</span><input id="seed" type="number" min="0" max="2147483647" step="1" value="42" /></label>
              <label title="게이지 충전만의 시간입니다. 여기에 단계 전환 0.3초와 버스트 쿨 여유가 더해져 실제 공백은 더 깁니다."><span>버스트 게이지 충전</span><div class="input-unit"><input id="burst-regen" type="number" min="0" max="20" step="0.1" value="2" /><em>초</em></div></label>
              <label class="toggle-field deck-regen-toggle" title="버스트 쿨이 밀리는 덱만 다른 값으로 재고 싶을 때 켭니다"><input id="burst-regen-per-deck" type="checkbox" /><span class="toggle"></span><span>버스트 충전을 덱마다 따로</span></label>
              <label title="조건이 갖춰진 뒤 실제로 버스트를 누르기까지 걸리는 시간입니다. 버스트 하나하나마다 더해지므로 3단계까지 쓰면 그 세 배만큼 늦어집니다."><span>버스트 반응속도</span><div class="input-unit"><input id="burst-reaction" type="number" min="0" max="3" step="0.01" value="${DEFAULT_BURST_REACTION}" /><em>초</em></div></label>
              <label><span>난수 처리</span><select id="rng-mode"><option value="expected">기대값 (권장)</option><option value="random">난수</option></select></label>
              <label class="toggle-field" title="족자 구간에는 평타가 빗나가므로 게이지도 차지 않는 것으로 계산합니다. 켜면 그만큼 버스트가 밀립니다."><input id="immune-blocks-burst" type="checkbox" checked /><span class="toggle"></span><span>족자 중 버스트 충전 정지</span></label>
            </div>
            <div class="deck-regen-grid" data-deck-regen hidden></div>
            <p class="field-note">기대값은 확률 대신 기대치를 태워 <b>같은 설정이면 언제나 같은 값</b>이 나옵니다. 난수는 인게임과 같은 분산을 재현하며 시드에 따라 결과가 흔들립니다.</p>

            <fieldset class="range-field">
              <legend>평타 계수</legend>
              <div class="coeff-options" data-hit-coeff></div>
              <p class="field-note">실전에서 탄퍼짐으로 빗나가는 탄을 보정합니다. <b>평타에만</b> 곱하며 스킬·버스트와 변신 모드 사격은 조준 판정이라 손대지 않습니다. 기본값은 실측 대조로 뽑은 값이고(SG 0.90), 1.00이면 보정 없음입니다.</p>
            </fieldset>

            <fieldset class="range-field phase-field">
              <legend>보스 페이즈</legend>
              <div class="phase-head">
                <button type="button" class="phase-add" data-phase-add="immune">족자 추가 <b>+</b></button>
                <button type="button" class="phase-add" data-phase-add="element">속저 추가 <b>+</b></button>
              </div>
              <div class="phase-list" data-phase-list></div>
              <p class="field-note"><b>족자</b>는 평타만 빗나갑니다. 지속 대미지·스킬 대미지와 평타로 발동한 후속 공격은 계속 들어갑니다. <b>속저</b>는 고른 속성에 <b>우월한</b> 캐릭터의 딜만 통과시킵니다 — 풍압으로 두면 작열 캐릭터만 들어갑니다. 인게임처럼 <b>우월 코드 버프</b>로 우월해진 캐릭터도 통과합니다(라피 : 레드 후드 «부착형 유탄» 등).</p>
            </fieldset>
          </div>
          <section class="console-editor">
            <h3>콘솔 <span>전초기지 재활용 연구실</span></h3>
            <div class="console-grid" data-console-grid></div>
            <p class="field-note">계정 설정이라 스쿼드 전원에게 같이 적용됩니다. 클래스·기업은 인게임에서 소속별로 따로 크므로 각각 받습니다. 기업은 공격력, 공통·클래스는 체력을 올립니다 — 체력 계수를 쓰는 캐릭터(신데렐라 등)는 공통·클래스도 딜에 반영됩니다.</p>
          </section>
          </div>
          </div>
          </div>
        </section>

        <section class="panel result-panel" aria-labelledby="result-heading" data-result-panel>
          <div class="result-empty"><h2 id="result-heading">전투 결과</h2><div class="radar-mark" aria-hidden="true"><i></i><i></i><i></i></div><p>편성과 조건을 확인한 뒤<br />시뮬레이션을 실행해 주세요.</p></div>
        </section>
      </form>

      <section class="panel timeline-panel" data-view="calc" aria-labelledby="timeline-heading" data-timeline-panel hidden>
        <div class="section-heading compact"><div><h2 id="timeline-heading">전투 타임라인</h2></div></div>
        <div data-timeline-body></div>
      </section>
      <footer><p>비공식 팬 제작 도구 · 실제 전투 환경과 차이가 있을 수 있습니다.</p><a href="https://github.com/Moris-kr/nikke-calc" target="_blank" rel="noreferrer">SOURCE / GITHUB ↗</a></footer>

      <div class="custom-modal" data-history-modal hidden>
        <div class="custom-card roster-card" role="dialog" aria-label="계산 기록">
          <div class="custom-head"><h2>계산 기록</h2><button type="button" class="custom-close" data-history-close aria-label="닫기">✕</button></div>
          <p class="custom-desc">결과에서 «결과 저장»을 누른 시점의 편성과 수치가 이 브라우저에 남습니다. 편성을 되살려 그때 조합으로 돌아갈 수 있습니다. <b>수치는 그때의 스펙·전투 조건으로 낸 값</b>이라, 지금 설정과 다르면 다시 계산해야 맞습니다.</p>
          <div class="history-list" data-history-list></div>
        </div>
      </div>

      <div class="custom-modal" data-battle-share-modal hidden>
        <div class="custom-card share-card" role="dialog" aria-label="전투 조건 공유">
          <div class="custom-head"><h2>전투 조건 공유</h2><button type="button" class="custom-close" data-battle-share-close aria-label="닫기">✕</button></div>
          <p class="custom-desc">전투 시간·적 코드·코어·족자·속저·난수 처리 같은 <b>«어떤 상황에서 쟀나»</b>를 주고받습니다. <b>콘솔과 싱크로 레벨은 담기지 않습니다</b> — 계정 육성 상태라 남의 값이 딸려 오면 자기 스펙으로 잰 결과가 아니게 됩니다. 편성과 개인 스펙도 담기지 않습니다(그쪽은 «조합 공유»).</p>
          ${SHARE_API ? '<div class="share-tabs" data-battle-share-tabs></div>' : ''}
          <div class="share-pane" data-battle-share-pane="upload" hidden></div>
          <div class="share-pane" data-battle-share-pane="list" hidden></div>
          <div class="share-pane" data-battle-share-pane="code">
            <div class="squad-code-block">
              <h4>내 전투 조건 코드</h4>
              <textarea class="share-out" data-battle-share-out readonly rows="3"></textarea>
              <button type="button" class="share-copy" data-battle-share-copy>코드 복사</button>
            </div>
            <div class="squad-code-block">
              <h4>받은 코드 적용</h4>
              <textarea class="share-in" data-battle-share-in rows="3" placeholder="NK3- 로 시작하는 코드를 붙여넣으세요"></textarea>
              <button type="button" class="share-apply" data-battle-share-apply>적용</button>
            </div>
          </div>
          <p class="share-msg" data-battle-share-msg hidden></p>
        </div>
      </div>

      <!-- 업데이트 공지. 새 내용이 있을 때 처음 들어오면 한 번 뜨고, 닫으면 그 판을
           본 것으로 적어 다시 뜨지 않는다. 「업데이트 내역」으로 언제든 다시 연다. -->
      <div class="custom-modal" data-notice-modal hidden>
        <div class="custom-card notice-card" role="dialog" aria-label="업데이트 내역">
          <div class="custom-head"><h2>업데이트 내역</h2><button type="button" class="custom-close" data-notice-close aria-label="닫기">✕</button></div>
          <div class="notice-body" data-notice-body></div>
          <div class="deck-copy-actions">
            <button type="button" class="deck-copy-apply" data-notice-dismiss>확인 · 다시 보지 않기</button>
          </div>
        </div>
      </div>

      <!-- 캐릭터 설정 뭉치를 띄우는 창. 카드가 좁아 그 자리에서 펼치면 다섯 장이
           서로를 밀어낸다 — 필터 판과 같은 방식으로 창을 띄운다. -->
      <div class="custom-modal" data-char-panel-modal hidden>
        <div class="custom-card char-panel-card" role="dialog" aria-label="캐릭터 설정">
          <div class="custom-head"><h2 data-char-panel-title>캐릭터 설정</h2><button type="button" class="custom-close" data-char-panel-close aria-label="닫기">✕</button></div>
          <div class="char-panel-body" data-char-panel-body></div>
        </div>
      </div>

      <div class="custom-modal" data-buff-order-modal hidden>
        <div class="custom-card buff-order-card" role="dialog" aria-label="버프 대상 순서">
          <div class="custom-head"><h2 data-buff-order-title>버프 대상 순서</h2><button type="button" class="custom-close" data-buff-order-close aria-label="닫기">✕</button></div>
          <p class="custom-desc" data-buff-order-desc></p>
          <div class="buff-order-list" data-buff-order-list></div>
        </div>
      </div>

      <div class="custom-modal" data-burst-order-modal hidden>
        <div class="custom-card burst-order-card" role="dialog" aria-label="버스트 순서">
          <div class="custom-head"><h2>버스트 순서</h2><button type="button" class="custom-close" data-burst-order-close aria-label="닫기">✕</button></div>
          <p class="custom-desc">사이클마다 <b>1버 → 2버 → 3버</b>를 누가 쓸지 직접 정합니다. <b>정한 사이클까지만 따릅니다</b> — 전투가 더 길면 그 뒤는 계산기가 평소 순서로 고릅니다. 초상화를 누르거나 <b>A·S·D·F·G</b> 키로 고르고, <b>←</b>로 한 칸 되돌립니다.</p>
          <div class="burst-order-bar">
            <label class="burst-cycles">풀버스트 횟수
              <button type="button" class="burst-step-btn" data-burst-cycles-down aria-label="한 사이클 줄이기">−</button>
              <output data-burst-cycles>0</output>
              <button type="button" class="burst-step-btn" data-burst-cycles-up aria-label="한 사이클 늘리기">+</button>
            </label>
            <span class="burst-order-progress" data-burst-progress></span>
            <button type="button" class="roster-import" data-burst-order-reset>처음부터</button>
          </div>
          <p class="burst-order-hint" data-burst-cycles-note></p>
          <div class="burst-now" data-burst-now></div>
          <div class="burst-picks" data-burst-picks></div>
          <div class="burst-order-list" data-burst-list></div>
          <p class="custom-msg" data-burst-order-msg hidden></p>
          <div class="deck-copy-actions">
            <button type="button" class="deck-copy-apply" data-burst-order-save>이 순서로 두기</button>
            <button type="button" class="deck-copy-cancel" data-burst-order-clear>순서 지우기(자동)</button>
          </div>
        </div>
      </div>

      <div class="custom-modal" data-share-modal hidden>
        <div class="custom-card share-card" role="dialog" aria-label="프리셋 / 조합 공유">
          <div class="custom-head"><h2>프리셋 / 조합 공유</h2><button type="button" class="custom-close" data-share-close aria-label="닫기">✕</button></div>
          <p class="custom-desc">누가 편성됐는지(캐릭터 조합)만 주고받습니다. <b>오버로드·공격력·돌파 같은 개인 스펙과 전투 조건은 담기지 않습니다</b> — 적용하면 캐릭터만 바뀌고 스펙은 각자 자기 설정(CSV 로스터를 넣었다면 그 값)이 그대로 쓰입니다. ${SHARE_API ? '<b>서버로는 «올리기»를 누를 때만 전송됩니다.</b>' : '서버로 전송되지 않습니다.'}</p>
          <div class="share-scope" data-share-scope>
            <span class="share-scope-label">범위</span>
            <button type="button" class="share-scope-pick is-on" data-share-scope-pick="one">이 덱만</button>
            <button type="button" class="share-scope-pick" data-share-scope-pick="all">5덱 전부</button>
            <span class="share-scope-note" data-share-scope-note></span>
          </div>
          ${SHARE_API ? '<div class="share-tabs" data-share-tabs></div>' : ''}
          <div class="share-pane" data-share-pane="upload" hidden></div>
          <div class="share-pane" data-share-pane="list" hidden></div>
          <div class="share-pane" data-share-pane="code">
          <div class="squad-code-block">
            <h4>내 조합 코드</h4>
            <textarea class="custom-json" data-share-out rows="3" readonly></textarea>
            <div class="deck-copy-actions"><button type="button" class="deck-copy-apply" data-share-copy>코드 복사</button></div>
          </div>
          <div class="squad-code-block">
            <h4>공유 링크</h4>
            <textarea class="custom-json" data-share-url rows="2" readonly></textarea>
            <div class="deck-copy-actions"><button type="button" class="deck-copy-apply" data-share-url-copy>링크 복사</button></div>
          </div>
          <div class="squad-code-block">
            <h4>받은 코드 적용</h4>
            <textarea class="custom-json" data-share-in rows="3" placeholder="받은 조합 코드나 공유 링크를 붙여넣으세요"></textarea>
            <div class="deck-copy-actions"><button type="button" class="deck-copy-apply" data-share-apply>이 조합 적용</button></div>
          </div>
          <div class="squad-code-block">
            <h4>이 브라우저에 저장</h4>
            <div class="preset-row">
              <input type="text" class="preset-name" data-preset-name placeholder="프리셋 이름 (예: 수냉 솔레 1덱)" maxlength="40" />
              <button type="button" class="deck-copy-apply" data-preset-save>저장</button>
            </div>
            <div class="preset-list" data-preset-list></div>
          </div>
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

      ${blablaProxy ? `
      <div class="custom-modal" data-blabla-modal hidden>
        <div class="custom-card doro-card" role="dialog" aria-label="블라블라링크 연동">
          <div class="custom-head"><h2>블라블라링크 연동</h2><button type="button" class="custom-close" data-blabla-close aria-label="닫기">✕</button></div>
          <p class="custom-desc">블라블라링크에서 <b>내 프로필 주소</b>를 복사해 넣으면 보유 니케의 육성 상태를 한 번에 가져옵니다. 돌파·코강·스킬·오버로드·장비 강화에 더해, CSV에는 없는 <b>큐브와 소장품</b>까지 들어옵니다.</p>
          <p class="custom-desc"><a href="https://www.blablalink.com/user" target="_blank" rel="noreferrer noopener">blablalink.com/user</a> 에 들어가면 주소창에 뜨는 주소가 그것입니다. 블라블라링크에서 <b>프로필과 니케 목록을 공개</b>로 바꿔야 조회됩니다 — 하나라도 비공개면 막힙니다. 전초기지까지 공개하면 콘솔(재활용 연구실) 레벨도 함께 들어옵니다.</p>
          <div class="blabla-row">
            <select class="blabla-server" data-blabla-server aria-label="블라블라링크 서버">
              <option value="">자동 (보유 니케가 가장 많은 서버)</option>
              ${BLABLA_SERVERS.map(({ area, label }) => `<option value="${area}">${label}</option>`).join('')}
            </select>
            <input type="url" class="blabla-url" data-blabla-url placeholder="https://www.blablalink.com/user?openid=..." spellcheck="false" />
            <button type="button" class="roster-import" data-blabla-sync>동기화</button>
          </div>
          <p class="custom-desc blabla-status" data-blabla-status hidden></p>
          <p class="custom-desc">받아 온 값은 이 브라우저에만 저장됩니다. 호감도는 계산기가 돌파 단계에서 끌어내므로 따로 반영하지 않습니다.</p>
        </div>
      </div>` : ''}
      <div class="custom-modal" data-doro-modal hidden>
        <div class="custom-card doro-card" role="dialog" aria-label="렛츠도로 CSV 받는 법">
          <div class="custom-head"><h2>렛츠도로 CSV 받는 법</h2><button type="button" class="custom-close" data-doro-close aria-label="닫기">✕</button></div>
          <p class="custom-desc">렛츠도로 <b>니케 정보</b> 페이지에서 목록 오른쪽 아래 <b>내려받기 아이콘</b>을 누르면 CSV가 저장됩니다. 그 파일을 <b>렛츠도로 CSV 불러오기</b>로 넣으면 보유 니케 설정이 한 번에 적용됩니다.</p>
          <p class="doro-link"><a href="https://letsdoro.com/mypage?tab=nikke" target="_blank" rel="noreferrer">letsdoro.com 니케 정보 열기 ↗</a></p>
          <p class="field-note">CSV에는 <b>큐브와 호감도</b>가 들어 있지 않습니다 — 그 둘은 기본값(기본 큐브 · 돌파별 최대 호감도)으로 계산하며, 카드의 <b>개별 설정</b>에서 실제 값으로 고칠 수 있습니다.</p>
          <img class="doro-shot" src="${import.meta.env.BASE_URL}letsdoro-csv.png" alt="렛츠도로 니케 정보 페이지에서 CSV 내려받기 위치" loading="lazy" />
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
  const deckMoves = element<HTMLElement>(root, '[data-deck-moves]');
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
  // 타임라인은 «계산 결과가 있는가»와 «지금 계산기 화면인가» 둘 다 만족할 때만 보인다.
  let timelineHasContent = false;
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
        // 덱을 옮기면 판이 겨냥하는 칸도 그 덱 기준으로 다시 잡는다.
        const empty = deck.squad.findIndex((member) => !member);
        activeSlot = empty < 0 ? 0 : empty;
        // 패널은 '현재 덱' 기준이라 덱을 옮기면 닫는다 (열린 채로 두면 대상이 헷갈린다).
        closeDeckCopy();
        saveState();
        renderDeckTabs();
        renderSquad();
      });
      deckTabs.append(button);
    }

    const moves = element<HTMLElement>(root, '[data-deck-moves]');
    moves.replaceChildren();

    // 덱 순서 바꾸기. 덱 «번호»는 자리 이름이라 그대로 두고 **내용만** 맞바꾼다 —
    // 번호까지 따라 움직이면 지금 보던 덱이 어디로 갔는지 알 수 없다.
    const swapDeck = (delta: number) => {
      const index = decks.findIndex((deck) => deck.id === activeDeckId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= decks.length) return;
      const a = decks[index]!;
      const b = decks[target]!;
      [a.squad, b.squad] = [b.squad, a.squad];
      [a.characters, b.characters] = [b.characters, a.characters];
      // 방금 옮긴 편성을 따라간다.
      activeDeckId = b.id;
      closeDeckCopy();
      saveState();
      renderDeckTabs();
      renderSquad();
    };
    for (const [delta, label, title] of [
      [-1, '‹', '앞으로'], [1, '›', '뒤로'],
    ] as const) {
      const move = document.createElement('button');
      move.type = 'button';
      move.className = 'deck-move';
      move.dataset.deckMove = String(delta);
      move.textContent = label;
      move.title = `현재 덱을 ${title} 옮기기`;
      move.ariaLabel = `덱 ${activeDeckId}을 ${title} 옮기기`;
      const index = decks.findIndex((deck) => deck.id === activeDeckId);
      move.disabled = index + delta < 0 || index + delta >= decks.length;
      move.addEventListener('click', () => swapDeck(delta));
      moves.append(move);
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

  // 최근 계산에서 나온 「누가 이 버프를 받았나」. 덱 단위로 들고 있다가 카드에 얹는다.
  // 계산 전에는 비어 있고, 그때는 빈 괄호로 자리만 잡는다.
  // 값과 함께 **무엇을 계산한 결과인가**(편성 + 개별 설정)를 적어 둔다. 편성이나
  // 스펙을 바꾸면 대상이 달라질 수 있으므로, 서명이 어긋나면 지난 값을 쓰지 않는다.
  const buffTargetsByDeck = new Map<number, { sig: string; rows: Record<string, BuffTargetRow[]> }>();

  const deckSignature = (deck: DeckState): string =>
    JSON.stringify([deck.squad, deck.characters]);

  // ── 버프 대상 미리 계산 ──────────────────────────────────────────────────
  // 수령자는 실제 발동 로그에서만 나온다(대상이 최종 공격력으로 갈리고 전투 중
  // 바뀌기도 한다). 그래서 계산 버튼을 누르기 전에 **배경으로 한 번 돌려** 미리
  // 채운다. 결과는 정식 계산과 같은 캐시를 쓰므로 이어서 «실행»을 눌러도 덤이 없다.
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
  let prefetching = false;
  // 배경 계산이 도는 덱. 그 사이 화면에는 `[계산중]`으로 나온다.
  let prefetchingDeckId: number | undefined;

  const needsPrefetch = (deck: DeckState): boolean => {
    if (!deck.squad.some((name) => name && settings.buffTargetWatch?.[name])) return false;
    return buffTargetsByDeck.get(deck.id)?.sig !== deckSignature(deck);
  };

  const prefetchBuffTargets = () => {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(async () => {
      // 정식 계산이 도는 중이면 워커를 뺏지 않는다 — 끝나면 어차피 채워진다.
      if (prefetching || submit.disabled) return;
      const deck = activeDeck();
      if (!needsPrefetch(deck)) return;
      prefetching = true;
      prefetchingDeckId = deck.id;
      renderSquad();
      try {
        await prepared;
        const custom = customPayload();
        const request = requestForDeck(deck, readBattle(),
          Object.keys(custom).length > 0 ? custom : undefined);
        if (validateRequest(request).length > 0) return;
        const key = cacheKey(request, version);
        let result = cache.get(key);
        if (!result) {
          result = await client.simulate(request);
          cache.set(key, result);
        }
        // 기다리는 사이 편성이 바뀌었을 수 있다 — 서명이 맞을 때만 반영한다.
        const now = activeDeck();
        if (now.id !== deck.id || deckSignature(now) !== deckSignature(deck)) return;
        if (result.buffTargets) {
          buffTargetsByDeck.set(deck.id, { sig: deckSignature(deck), rows: result.buffTargets });
          saveState();
          renderSquad();
        }
      } catch {
        /* 미리 계산은 편의 기능이다 — 실패해도 조용히 넘어간다 */
      } finally {
        prefetching = false;
        prefetchingDeckId = undefined;
        renderSquad();
      }
    }, 700);
  };


  /** 이 덱에서 감시 대상 버프를 가진 캐릭터의 표시 줄. 아직 안 돌렸으면 빈 대상. */
  const buffTargetRowsFor = (deckId: number, name: string): BuffTargetRow[] | undefined => {
    const deck = decks.find((d) => d.id === deckId);
    const saved = buffTargetsByDeck.get(deckId);
    const known = deck && saved && saved.sig === deckSignature(deck)
      ? saved.rows[name] : undefined;
    if (known) return known;
    const watched = settings.buffTargetWatch?.[name];
    if (!watched) return undefined;
    const pending = prefetchingDeckId === deckId;
    return watched.map((w) => ({ ...w, targets: [] as string[], count: 0, pending }));
  };

  // 「순서보기」 — 버프가 발동할 때마다 누가 받았는지 초상화로 죽 편다.
  // 대상이 갈리는 편성에서는 이 순서 자체가 정보다(앨리스-홍련-앨리스-홍련…).
  const buffOrderModal = element<HTMLElement>(root, '[data-buff-order-modal]');
  const showBuffOrder = (caster: string, row: BuffTargetRow) => {
    element<HTMLElement>(root, '[data-buff-order-title]').textContent =
      `${caster} · ${row.label}`;
    element<HTMLElement>(root, '[data-buff-order-desc]').textContent =
      row.targets.length > 1
        ? `${row.buff} — ${row.count}회 발동. 대상이 ${row.targets.length}명 사이에서 갈립니다.`
        : `${row.buff} — ${row.count}회 발동. 전투 내내 같은 대상입니다.`;
    const list = element<HTMLElement>(root, '[data-buff-order-list]');
    list.replaceChildren();
    for (const [index, step] of (row.sequence ?? []).entries()) {
      const item = document.createElement('div');
      item.className = 'buff-order-step';
      item.dataset.buffOrderStep = String(index);
      const meta = catalogByName.get(step.target);
      const shot = document.createElement('div');
      shot.className = 'buff-order-portrait';
      if (meta?.image) {
        const img = document.createElement('img');
        img.src = `${import.meta.env.BASE_URL}${meta.image}`;
        img.alt = '';
        img.loading = 'lazy';
        shot.append(img);
      }
      item.append(shot);
      item.append(createText('strong', step.target));
      item.append(createText('span', `${step.t.toFixed(2)}초`));
      list.append(item);
    }
    buffOrderModal.hidden = false;
  };
  element<HTMLButtonElement>(root, '[data-buff-order-close]').addEventListener('click', () => {
    buffOrderModal.hidden = true;
  });
  buffOrderModal.addEventListener('click', (event) => {
    if (event.target === buffOrderModal) buffOrderModal.hidden = true;
  });

  // ── 업데이트 공지 ───────────────────────────────────────────────────────
  // 본 적 있는 공지 id를 적어 둔다. 새 공지가 올라오면 id가 달라져 다시 뜬다.
  const NOTICE_KEY = 'nikke-notice-seen';
  const noticeModal = element<HTMLElement>(root, '[data-notice-modal]');
  const noticeBody = element<HTMLElement>(root, '[data-notice-body]');

  const renderNotices = () => {
    noticeBody.replaceChildren();
    for (const notice of NOTICES) {
      const block = document.createElement('section');
      block.className = 'notice-entry';
      block.dataset.notice = notice.id;
      const head = document.createElement('div');
      head.className = 'notice-head';
      head.append(createText('b', notice.date), createText('span', notice.title));
      block.append(head);
      const list = document.createElement('ul');
      for (const item of notice.items) {
        const row = document.createElement('li');
        const tag = createText('em', item.tag, 'notice-tag');
        tag.dataset.noticeTag = item.tag;
        const body = document.createElement('span');
        body.append(noticeFragment(item.text));
        row.append(tag, body);
        list.append(row);
      }
      block.append(list);
      noticeBody.append(block);
    }
  };

  const openNotice = () => {
    renderNotices();
    noticeModal.hidden = false;
  };
  /** 닫으면 최신 공지를 본 것으로 적는다 — 새 공지가 나오기 전까지 다시 뜨지 않는다. */
  const closeNotice = () => {
    noticeModal.hidden = true;
    try {
      resolveStorage()?.setItem(NOTICE_KEY, LATEST_NOTICE_ID);
    } catch {
      /* 저장 실패는 무시 — 다음에 한 번 더 뜰 뿐이다 */
    }
  };
  element<HTMLButtonElement>(root, '[data-notice-open]').addEventListener('click', openNotice);
  element<HTMLButtonElement>(root, '[data-notice-close]').addEventListener('click', closeNotice);
  element<HTMLButtonElement>(root, '[data-notice-dismiss]').addEventListener('click', closeNotice);
  noticeModal.addEventListener('click', (event) => {
    if (event.target === noticeModal) closeNotice();
  });
  {
    let seen: string | null = null;
    try {
      seen = resolveStorage()?.getItem(NOTICE_KEY) ?? null;
    } catch {
      /* 못 읽으면 처음 온 것으로 본다 */
    }
    if (noticeToShow(seen)) openNotice();
  }

  // ── 캐릭터 설정 창 ──────────────────────────────────────────────────────
  // 어떤 캐릭터의 어느 뭉치를 보고 있는지 기억한다. 값을 바꾸면 카드가 다시 그려지고
  // 뭉치도 새로 만들어지므로, 그때마다 새 뭉치를 창에 다시 넣어 준다.
  const charPanelModal = element<HTMLElement>(root, '[data-char-panel-modal]');
  const charPanelBody = element<HTMLElement>(root, '[data-char-panel-body]');
  const charPanelTitle = element<HTMLElement>(root, '[data-char-panel-title]');
  let openCharPanel: { name: string; kind: CharPanelKind } | null = null;

  const placeCharPanel = (panel: HTMLElement, name: string, label: string) => {
    panel.hidden = false;
    charPanelBody.replaceChildren(panel);
    charPanelTitle.textContent = `${name} · ${label}`;
    charPanelModal.hidden = false;
  };
  const closeCharPanel = () => {
    openCharPanel = null;
    charPanelBody.replaceChildren();
    charPanelModal.hidden = true;
  };
  element<HTMLButtonElement>(root, '[data-char-panel-close]').addEventListener('click', closeCharPanel);
  charPanelModal.addEventListener('click', (event) => {
    if (event.target === charPanelModal) closeCharPanel();
  });

  // ── 끌어다 놓기 ─────────────────────────────────────────────────────────
  // 누르는 길(칸을 고르고 카드를 누른다)은 그대로 두고 «끌어다 놓기»를 더한다.
  // 손가락에서는 HTML 끌기가 동작하지 않으므로, 누르는 길이 없어지면 안 된다.
  const DRAG_NAME = 'application/x-nikke-name';   // 니케 고르기 → 칸
  const DRAG_SLOT = 'application/x-nikke-slot';   // 칸 → 칸 (자리 맞바꾸기)

  /** 이 끌기가 우리 것인가. `dragover`에서는 값이 아니라 종류만 볼 수 있다. */
  const dragKind = (event: DragEvent): 'name' | 'slot' | null => {
    const types = event.dataTransfer?.types;
    if (!types) return null;
    const has = (type: string) => Array.prototype.includes.call(types, type);
    if (has(DRAG_NAME)) return 'name';
    if (has(DRAG_SLOT)) return 'slot';
    return null;
  };

  /** 칸 하나를 받는 자리로 만든다. */
  const makeDropTarget = (card: HTMLElement, index: number) => {
    const lit = (on: boolean) => card.classList.toggle('is-drop', on);
    card.addEventListener('dragover', (event) => {
      const kind = dragKind(event as DragEvent);
      if (!kind) return;
      event.preventDefault();                  // 이걸 해야 놓을 수 있다
      (event as DragEvent).dataTransfer!.dropEffect = kind === 'slot' ? 'move' : 'copy';
      lit(true);
    });
    card.addEventListener('dragleave', () => lit(false));
    card.addEventListener('drop', (event) => {
      const drag = event as DragEvent;
      const kind = dragKind(drag);
      if (!kind) return;
      event.preventDefault();
      lit(false);
      const deck = activeDeck();
      if (kind === 'slot') {
        const from = Number(drag.dataTransfer!.getData(DRAG_SLOT));
        if (!Number.isInteger(from) || from < 0 || from > 4 || from === index) return;
        // 자리만 맞바꾼다. 개별 설정은 이름에 걸려 있어 슬롯과 무관하다.
        [deck.squad[index], deck.squad[from]] = [deck.squad[from] ?? '', deck.squad[index] ?? ''];
        showErrors([]);
        saveState();
        renderDeckTabs();
        renderSquad();
        renderRosterGrid();
        return;
      }
      const name = drag.dataTransfer!.getData(DRAG_NAME);
      if (!name || !catalogByName.has(name)) return;
      // 한 덱에 같은 니케를 두 번 넣을 수 없다 — 누르는 길에서 막는 것과 같은 규칙이다.
      const already = deck.squad.indexOf(name);
      if (already >= 0 && already !== index) {
        showErrors([`${name}은(는) 이미 ${already + 1}번 칸에 있습니다.`]);
        return;
      }
      pickCharacter(name, index);
    });
  };

  const renderSquad = () => {
    const deck = activeDeck();
    // 버스트 순서는 편성에 매여 있다 — 편성이 바뀌면 배지도 따라간다.
    renderBurstBadge();
    squadGrid.replaceChildren();
    for (let index = 0; index < 5; index += 1) {
      const name = deck.squad[index] ?? '';
      const char = catalogByName.get(name);
      const card = document.createElement('article');
      card.className = 'squad-slot';
      card.dataset.slotCard = String(index);
      card.classList.toggle('is-preview', Boolean(char?.preview));
      makeDropTarget(card, index);
      if (name) {
        // 채워진 칸은 집어서 다른 칸에 놓을 수 있다 — ‹ › 단추와 같은 «자리 맞바꾸기»다.
        card.draggable = true;
        card.addEventListener('dragstart', (event) => {
          const drag = event as DragEvent;
          drag.dataTransfer?.setData(DRAG_SLOT, String(index));
          drag.dataTransfer?.setData('text/plain', name);
          if (drag.dataTransfer) drag.dataTransfer.effectAllowed = 'move';
          card.classList.add('is-dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
      }

      const top = document.createElement('div');
      top.className = 'slot-top';
      const portrait = document.createElement('div');
      portrait.className = 'portrait-wrap';
      // 슬롯 번호와 속성 아이콘은 좌상단에 나란히 선다. 번호 폭이 자릿수에 따라
      // 달라져도 아이콘이 겹치지 않도록 절대배치 대신 한 줄로 묶는다.
      const tags = document.createElement('div');
      tags.className = 'slot-tags';
      tags.append(createText('span', `0${index + 1}`, 'slot-number'));
      if (char) {
        const codeIcon = createElementIcon(char.elementCode, 'slot-code');
        if (codeIcon) tags.append(codeIcon);
      }
      portrait.append(tags, createText('div', '', 'portrait-fallback'));

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
          [deck.squad[index], deck.squad[target]] = [deck.squad[target] ?? '', deck.squad[index] ?? ''];
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

      // 이름 검색과 드롭다운, 교체 버튼을 걷어냈다. 카드는 «지금 채울 칸»을 정하는
      // 역할만 하고, 고르는 일은 아래 상시 판이 맡는다. 검색 결과가 어디에도 숨지
      // 않게 하는 것이 이 화면의 요점이다.
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'slot-choose';
      choose.dataset.slotChoose = String(index);
      choose.setAttribute('aria-pressed', String(activeSlot === index));
      choose.append(createText('strong', char ? char.name : '빈 칸'));
      choose.append(createText(
        'span',
        char ? `B${char.burstStage} · ${char.elementCode} · ${char.weaponType}` : '눌러서 이 칸에 넣기',
      ));
      choose.addEventListener('click', () => {
        activeSlot = index;
        pullActiveSlot = true;
        renderSquad();
        renderRosterGrid();
      });
      // 좁은 화면에서는 슬롯 줄이 옆으로 밀린다. 겨냥한 칸이 화면 밖에 있으면
      // 판이 어디를 채우는지 알 수 없으므로 끌어다 보여 준다.
      // jsdom에는 scrollIntoView가 없다. 없다고 렌더가 깨질 일은 아니므로 건너뛴다.
      if (pullActiveSlot && activeSlot === index && typeof choose.scrollIntoView === 'function') {
        requestAnimationFrame(() => choose.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      }

      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'slot-clear';
      clear.textContent = '✕';
      clear.title = `${index + 1}번 칸 비우기`;
      clear.ariaLabel = `${index + 1}번 칸 비우기`;
      clear.hidden = !name;
      clear.addEventListener('click', () => {
        if (name) delete deck.characters[name];
        deck.squad[index] = '';
        activeSlot = index;
        showErrors([]);
        saveState();
        renderDeckTabs();
        renderSquad();
        renderRosterGrid();
      });

      identity.append(choose, clear);
      top.append(portrait, identity);
      card.append(top);
      if (char) {
        const editor = document.createElement('div');
        const cname = char.name;
        /**
         * 창 안의 뭉치를 카드가 방금 그린 새 것으로 바꾼다. 값 하나를 바꾸면
         * `renderCharacterSettings`가 스스로 카드를 다시 그리는데, 그때 창에는 **옛
         * 뭉치**가 남아 있어 «직접 설정»으로 켠 체크박스가 여전히 잠겨 보였다.
         */
        const syncOpenPanel = () => {
          if (openCharPanel?.name !== cname || charPanelModal.hidden) return;
          const kind = openCharPanel.kind;
          // 그 뭉치를 여는 단추가 사라졌으면(개별 설정을 껐다) 창도 닫는다.
          const opener = editor.querySelector<HTMLElement>(`[data-char-panel-open="${kind}"]`);
          if (!opener) { closeCharPanel(); return; }
          // 없으면 이미 창에 있는 것이 최신이다 — 두 번 불려도 닫지 않는다.
          const fresh = editor.querySelector<HTMLElement>(`[data-char-panel="${kind}"]`);
          if (!fresh) return;
          placeCharPanel(fresh, cname, opener.querySelector('.disclosure-label')?.getAttribute('title') ?? '');
        };
        const renderEditor = () => {
          renderCharacterSettings(editor, cname, settings, deck.characters[cname], (next) => {
            if (next) deck.characters[cname] = next;
            else delete deck.characters[cname];
            saveState();
            // 개별 설정 안 드롭다운으로 돌파를 바꿔도 초상화의 별이 따라가게 한다.
            renderGrowthStepper();
            // 이 콜백은 카드가 다시 그려지기 **직전**에 불린다 — 다 그린 뒤에 창을 맞춘다.
            queueMicrotask(syncOpenPanel);
          }, buffTargetRowsFor(deck.id, cname), (row) => showBuffOrder(cname, row),
          (kind, panel, label) => {
            openCharPanel = { name: cname, kind };
            placeCharPanel(panel, cname, label);
          },
          // 조합 조건부 컨트롤(아인 + 에이다 = 홀드)을 카드가 스스로 판정하게 한다.
          deck.squad.filter((slot): slot is string => Boolean(slot)));
          syncOpenPanel();
        };

        // 초상화 우측하단의 돌파·코어 강화 스테퍼. blablalink 도감처럼 별 + 진화 숫자로
        // 명함~풀코를 한눈에 보이고, 좌우 −/+로 바로 조절한다. 개별 설정을 펼치지 않아도
        // 손이 닿는 자리다. R(성장 없음)은 조절할 게 없으니 아예 그리지 않는다.
        const growthDefaults = settings.characters[cname];
        const maxStage = growthDefaults?.maxGrowthStage ?? 0;
        const defStage = growthDefaults?.growthStage ?? 0;
        const stepper = document.createElement('div');
        stepper.className = 'growth-stepper';
        stepper.dataset.growthStepper = String(index);
        const stars = document.createElement('div');
        stars.className = 'growth-stars';
        const minus = document.createElement('button');
        minus.type = 'button';
        minus.className = 'growth-step';
        minus.dataset.growthStep = 'minus';
        minus.textContent = '−';
        const plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'growth-step';
        plus.dataset.growthStep = 'plus';
        plus.textContent = '+';
        const stageOf = (): number => deck.characters[cname]?.growthStage ?? defStage;
        const labelOf = (stage: number): string =>
          growthDefaults?.growthOptions.find((option) => option.value === stage)?.label
          ?? `단계 ${stage}`;
        function renderGrowthStepper(): void {
          const stage = stageOf();
          const slots = Math.min(maxStage, 3);
          const core = Math.max(0, stage - 3);
          stars.replaceChildren();
          for (let i = 0; i < slots; i += 1) {
            // 별 그림은 blablalink 도감의 스프라이트(25프레임)를 그대로 쓴다 — CSS에서
            // 채워진 별/빈 별 프레임을 background-position으로 고른다.
            const star = document.createElement('span');
            star.className = i < Math.min(stage, 3) ? 'growth-star is-on' : 'growth-star';
            stars.append(star);
          }
          // 진화 뱃지는 도감처럼 0일 때도 자리를 지킨다 — 켜졌다 꺼졌다 하면
          // 별 줄의 폭이 흔들려 카드가 들썩인다.
          const badge = document.createElement('span');
          badge.className = 'growth-core';
          badge.append(createText('span', String(core)));
          stars.append(badge);
          minus.disabled = stage <= 0;
          plus.disabled = stage >= maxStage;
          const text = labelOf(stage);
          minus.ariaLabel = `${cname} 돌파 한 단계 낮추기 (현재 ${text})`;
          plus.ariaLabel = `${cname} 돌파 한 단계 높이기 (현재 ${text})`;
          stepper.title = `돌파·코어 강화 · ${text}`;
        }
        const setStage = (next: number) => {
          const clamped = Math.max(0, Math.min(maxStage, next));
          if (clamped === stageOf()) return;
          const base = deck.characters[cname];
          const override = base ? cloneOverride(base) : {};
          if (clamped === defStage) delete override.growthStage;
          else override.growthStage = clamped;
          if (Object.keys(override).length === 0) delete deck.characters[cname];
          else deck.characters[cname] = override;
          saveState();
          renderGrowthStepper();
          renderEditor();
        };
        minus.addEventListener('click', () => setStage(stageOf() - 1));
        plus.addEventListener('click', () => setStage(stageOf() + 1));
        if (maxStage > 0) {
          stepper.append(minus, stars, plus);
          renderGrowthStepper();
          portrait.append(stepper);
        }

        renderEditor();
        card.append(editor);
      }
      squadGrid.append(card);
    }
    pullActiveSlot = false;
    // 편성·개별 설정·덱 전환이 모두 이 함수를 지난다 — 미리 계산 예약은 여기 한 곳.
    prefetchBuffTargets();
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
      // 인게임·블라블라링크와 같은 순서 — 공통 → 기업 → 클래스.
      group('공통', [commonWrap]),
      axisGroup('company', '기업'),
      axisGroup('class', '클래스'),
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

  // ── 적정거리 ────────────────────────────────────────────────────────────
  // 무기군마다 적과의 적정 사거리가 달라, 같은 전투에서도 어떤 무기군은 적정거리에
  // 들고 어떤 무기군은 못 든다 → 여럿을 함께 켤 수 있어야 한다.
  // 목록 정본은 `data/weapon_mechanics.json`(설정으로 내려온다). 콘솔과 같은 이유로
  // 선택자 대신 Map으로 들고 읽고 쓴다.
  const rangeInputs = new Map<string, HTMLInputElement>();

  const renderOptimalRange = () => {
    const box = element<HTMLElement>(root, '[data-optimal-range]');
    box.replaceChildren();
    rangeInputs.clear();
    // 적정거리가 없는 무기군(런처)은 아예 그리지 않는다 — 켤 수 있게 두면
    // 인게임에 없는 보정을 켜게 된다. 목록의 정본은 무기 데이터다.
    for (const weapon of settings.optimalRangeWeapons ?? settings.weaponTypes) {
      const label = document.createElement('label');
      label.className = 'range-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.optimalRangeWeapon = weapon;
      label.append(input, createText('span', weapon));
      box.append(label);
      rangeInputs.set(weapon, input);
    }
  };
  renderOptimalRange();

  // ── 평타 계수 ───────────────────────────────────────────────────────────
  // 시뮬은 쏜 탄이 전부 맞는다고 보지만 인게임은 탄퍼짐으로 빗나간다. 무기군마다
  // 퍼짐이 다르므로 무기군 단위로 받고, 기본값은 설정(데이터)에서 내려온다.
  const coeffInputs = new Map<string, HTMLInputElement>();

  const renderHitCoeff = () => {
    const box = element<HTMLElement>(root, '[data-hit-coeff]');
    box.replaceChildren();
    coeffInputs.clear();
    for (const weapon of settings.weaponTypes) {
      const label = document.createElement('label');
      label.className = 'coeff-option';
      label.append(createText('span', weapon));
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '2';
      input.step = '0.01';
      input.dataset.hitCoeffWeapon = weapon;
      input.value = String(settings.normalHitCoeff?.[weapon] ?? 1);
      label.append(input);
      box.append(label);
      coeffInputs.set(weapon, input);
    }
  };
  renderHitCoeff();

  const readHitCoeff = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [weapon, input] of coeffInputs) out[weapon] = Number(input.value);
    return out;
  };

  const writeHitCoeff = (values: Record<string, number> | undefined) => {
    for (const [weapon, input] of coeffInputs) {
      const v = values?.[weapon] ?? settings.normalHitCoeff?.[weapon] ?? 1;
      input.value = String(v);
    }
  };

  // ── 보스 페이즈 (족자 · 속저) ───────────────────────────────────────────
  // 구간은 개수가 정해지지 않아 입력을 미리 만들어 둘 수 없다 — 배열을 정본으로
  // 들고 그릴 때마다 새로 만든다. 입력값이 잘못돼도(시작>끝) 지우지 않고 그대로
  // 두고, 실행할 때 검증 메시지로 알린다.
  let immuneWindows: PhaseWindow[] = [];
  let elementWindows: ElementWindow[] = [];

  const renderPhases = () => {
    const list = element<HTMLElement>(root, '[data-phase-list]');
    list.replaceChildren();

    const numberField = (value: number, onInput: (v: number) => void) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '180';
      input.step = '0.1';
      input.value = String(value);
      input.addEventListener('input', () => onInput(Number(input.value)));
      return input;
    };

    const row = (kind: 'immune' | 'element', index: number, from: number, to: number) => {
      const box = document.createElement('div');
      box.className = `phase-row is-${kind}`;
      box.dataset.phaseRow = `${kind}:${index}`;
      box.append(createText('span', kind === 'immune' ? '족자' : '속저', 'phase-tag'));
      box.append(numberField(from, (v) => {
        if (kind === 'immune') immuneWindows[index]!.from = v;
        else elementWindows[index]!.from = v;
        saveState();
      }));
      box.append(createText('span', '~', 'phase-sep'));
      box.append(numberField(to, (v) => {
        if (kind === 'immune') immuneWindows[index]!.to = v;
        else elementWindows[index]!.to = v;
        saveState();
      }));
      box.append(createText('span', '초', 'phase-sep'));
      return box;
    };

    immuneWindows.forEach((w, index) => {
      const box = row('immune', index, w.from, w.to);
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'phase-drop';
      drop.dataset.phaseDrop = `immune:${index}`;
      drop.textContent = '✕';
      drop.ariaLabel = `족자 ${index + 1} 삭제`;
      drop.addEventListener('click', () => {
        immuneWindows.splice(index, 1);
        saveState();
        renderPhases();
      });
      box.append(drop);
      list.append(box);
    });

    elementWindows.forEach((w, index) => {
      const box = row('element', index, w.from, w.to);
      const code = document.createElement('select');
      code.dataset.phaseCode = String(index);
      for (const value of ['풍압', '수냉', '작열', '전격', '철갑']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        code.append(option);
      }
      code.value = w.code || '풍압';
      code.addEventListener('change', () => {
        elementWindows[index]!.code = code.value as ElementWindow['code'];
        saveState();
      });
      box.append(code);
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'phase-drop';
      drop.dataset.phaseDrop = `element:${index}`;
      drop.textContent = '✕';
      drop.ariaLabel = `속저 ${index + 1} 삭제`;
      drop.addEventListener('click', () => {
        elementWindows.splice(index, 1);
        saveState();
        renderPhases();
      });
      box.append(drop);
      list.append(box);
    });
  };

  for (const kind of ['immune', 'element'] as const) {
    element<HTMLButtonElement>(root, `[data-phase-add="${kind}"]`).addEventListener('click', () => {
      // 마지막 구간 뒤를 기본값으로 잡아, 겹치지 않는 구간을 이어 붙이기 쉽게 한다.
      const all = [...immuneWindows, ...elementWindows];
      const start = all.length > 0 ? Math.max(...all.map((w) => w.to)) : 0;
      const from = Math.min(start, 178);
      if (kind === 'immune') immuneWindows.push({ from, to: Math.min(from + 2, 180) });
      else elementWindows.push({ from, to: Math.min(from + 2, 180), code: '풍압' });
      saveState();
      renderPhases();
    });
  }

  const advancedBattle = element<HTMLButtonElement>(root, '[data-advanced-battle]');
  const advancedBattlePanel = element<HTMLElement>(root, '[data-advanced-battle-panel]');
  advancedBattle.addEventListener('click', () => {
    const next = advancedBattle.getAttribute('aria-expanded') !== 'true';
    advancedBattle.setAttribute('aria-expanded', String(next));
    advancedBattlePanel.hidden = !next;
    const hint = advancedBattle.querySelector('.disclosure-hint');
    if (hint) hint.textContent = next ? '접기' : '펼치기';
  });

  const readOptimalRange = (): string[] =>
    [...rangeInputs].filter(([, input]) => input.checked).map(([weapon]) => weapon);

  const writeOptimalRange = (weapons: string[]) => {
    const on = new Set(weapons);
    for (const [weapon, input] of rangeInputs) input.checked = on.has(weapon);
  };

  // ── 덱마다 다른 버스트 게이지 충전 ──────────────────────────────────────
  // 버스트 쿨이 밀리는 덱이 있어 하나로 묶으면 그 덱만 계속 틀린다. 기본은 일괄이고,
  // 켤 때만 다섯 칸이 나온다 — 켜는 순간 지금 값으로 다섯을 채워 두므로 «켰더니 값이
  // 사라졌다»가 없다.
  const deckRegenBox = element<HTMLElement>(root, '[data-deck-regen]');
  const deckRegenToggle = element<HTMLInputElement>(root, '#burst-regen-per-deck');
  const readDeckRegen = (): Record<number, number> => {
    const out: Record<number, number> = {};
    for (const input of deckRegenBox.querySelectorAll<HTMLInputElement>('[data-deck-regen-input]')) {
      out[Number(input.dataset.deckRegenInput)] = Number(input.value);
    }
    return out;
  };
  const renderDeckRegen = (values: Record<number, number>) => {
    deckRegenBox.replaceChildren();
    for (let id = 1; id <= 5; id += 1) {
      const label = document.createElement('label');
      label.append(createText('span', `덱 ${id}`));
      const wrap = document.createElement('div');
      wrap.className = 'input-unit';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '20';
      input.step = '0.1';
      input.value = String(values[id] ?? 2);
      input.dataset.deckRegenInput = String(id);
      wrap.append(input, createText('em', '초'));
      label.append(wrap);
      deckRegenBox.append(label);
    }
  };
  const writeDeckRegen = (values: Record<number, number> | undefined, fallback: number) => {
    const on = values !== undefined && Object.keys(values).length > 0;
    deckRegenToggle.checked = on;
    deckRegenBox.hidden = !on;
    renderDeckRegen(values ?? { 1: fallback, 2: fallback, 3: fallback, 4: fallback, 5: fallback });
  };
  deckRegenToggle.addEventListener('change', () => {
    if (deckRegenToggle.checked) {
      const now = Number(element<HTMLInputElement>(root, '#burst-regen').value);
      renderDeckRegen({ 1: now, 2: now, 3: now, 4: now, 5: now });
    }
    deckRegenBox.hidden = !deckRegenToggle.checked;
    saveState();
    refreshBattleSummary();
  });

  const readBattle = (): BattleSettings => ({
    duration: Number(element<HTMLInputElement>(root, '#duration').value),
    synchroLevel: Number(element<HTMLInputElement>(root, '#synchro-level').value),
    enemyDef: Number(element<HTMLInputElement>(root, '#enemy-def').value),
    enemyCode: element<HTMLSelectElement>(root, '#enemy-code').value as BattleSettings['enemyCode'],
    coreEnabled: coreToggle.checked,
    corePx: Number(corePxInput.value),
    hasParts: element<HTMLInputElement>(root, '#has-parts').checked,
    seed: Number(element<HTMLInputElement>(root, '#seed').value),
    optimalRangeWeapons: readOptimalRange(),
    // 배열은 화면이 아니라 이 변수가 정본이다 — 입력이 잘못돼도 지우지 않고
    // 그대로 실어 실행 시 검증 메시지로 알린다.
    immuneWindows: immuneWindows.map((w) => ({ ...w })),
    elementWindows: elementWindows.map((w) => ({ ...w })),
    rngMode: element<HTMLSelectElement>(root, '#rng-mode').value as RngMode,
    immuneBlocksBurst: element<HTMLInputElement>(root, '#immune-blocks-burst').checked,
    normalHitCoeff: readHitCoeff(),
    burstRegenTime: Number(element<HTMLInputElement>(root, '#burst-regen').value),
    ...(element<HTMLInputElement>(root, '#burst-regen-per-deck').checked
      ? { burstRegenPerDeck: readDeckRegen() } : {}),
    burstReaction: Number(element<HTMLInputElement>(root, '#burst-reaction').value),
    console: {
      common_level: Number(consoleCommon.value),
      class_level: readConsoleBuckets('class'),
      company_level: readConsoleBuckets('company'),
    },
  });

  const writeBattle = (battle: BattleSettings) => {
    element<HTMLInputElement>(root, '#duration').value = String(battle.duration);
    // 싱크로 레벨이 없던 시절에 저장된 설정을 되살릴 때가 있다 — 기본값으로 채운다.
    element<HTMLInputElement>(root, '#synchro-level').value =
      String(battle.synchroLevel ?? DEFAULT_SYNCHRO_LEVEL);
    element<HTMLInputElement>(root, '#enemy-def').value = String(battle.enemyDef);
    element<HTMLSelectElement>(root, '#enemy-code').value = battle.enemyCode;
    coreToggle.checked = battle.coreEnabled;
    corePxInput.value = String(battle.corePx);
    corePxInput.disabled = !battle.coreEnabled;
    element<HTMLInputElement>(root, '#has-parts').checked = battle.hasParts;
    element<HTMLInputElement>(root, '#seed').value = String(battle.seed);
    writeOptimalRange(battle.optimalRangeWeapons ?? []);
    immuneWindows = (battle.immuneWindows ?? []).map((w) => ({ ...w }));
    elementWindows = (battle.elementWindows ?? []).map((w) => ({ ...w }));
    renderPhases();
    element<HTMLSelectElement>(root, '#rng-mode').value = battle.rngMode ?? 'expected';
    element<HTMLInputElement>(root, '#immune-blocks-burst').checked = Boolean(battle.immuneBlocksBurst);
    writeHitCoeff(battle.normalHitCoeff);
    if (battle.burstRegenTime !== undefined) {
      element<HTMLInputElement>(root, '#burst-regen').value = String(battle.burstRegenTime);
    }
    // 이 항목이 생기기 전에 저장된 설정에는 없다 — 기본값으로 채운다.
    element<HTMLInputElement>(root, '#burst-reaction').value =
      String(battle.burstReaction ?? DEFAULT_BURST_REACTION);
    writeDeckRegen(battle.burstRegenPerDeck, battle.burstRegenTime);
    if (battle.console) {
      consoleCommon.value = String(battle.console.common_level);
      writeConsoleBuckets('class', battle.console.class_level);
      writeConsoleBuckets('company', battle.console.company_level);
    }
    // 조건이 창으로 들어간 뒤로 화면에 남는 표시는 요약 한 줄뿐이다. 프로그램이 값을
    // 써넣을 때는 change가 나지 않아 그 줄이 갱신되지 않았고, 「적 수치 초기화」와
    // 「받은 코드 적용」이 아무 일도 안 한 것처럼 보였다. 쓰는 자리에서 함께 끌고 간다.
    refreshBattleSummary();
  };

  // ── 전투 조건 접이판 ────────────────────────────────────────────────────
  // 조건은 한 번 정해 두면 계속 쓰는 값이라 접어 두고, 접힌 채로도 «무엇으로 재는지»를
  // 한 줄로 남긴다. 요약 문구는 공유 목록에 쓰는 것과 같은 함수를 쓴다.
  const battleOpen = element<HTMLButtonElement>(root, '[data-battle-open]');
  const battleModal = element<HTMLElement>(root, '[data-battle-modal]');
  const battleSummary = element<HTMLElement>(root, '[data-battle-summary]');
  const battleFirstNote = element<HTMLElement>(root, '[data-battle-first-note]');
  const refreshBattleSummary = () => {
    battleSummary.textContent = summarizeBattle(readBattle());
  };
  /** 첫 계산 전 강조. 한 번이라도 열어 봤거나 계산을 돌렸으면 더 붙잡지 않는다. */
  const settleBattleNote = () => { battleFirstNote.hidden = true; };
  const setBattleOpen = (open: boolean) => {
    battleOpen.setAttribute('aria-expanded', String(open));
    battleModal.hidden = !open;
    refreshBattleSummary();
    if (open) settleBattleNote();
  };
  battleOpen.addEventListener('click', () => { setBattleOpen(true); });
  element<HTMLButtonElement>(root, '[data-battle-modal-close]')
    .addEventListener('click', () => setBattleOpen(false));
  battleModal.addEventListener('click', (event) => {
    if (event.target === battleModal) setBattleOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !battleModal.hidden) setBattleOpen(false);
  });

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
      if (custom.weaponModeSwapAt !== undefined && (
        !Number.isFinite(custom.weaponModeSwapAt)
        || custom.weaponModeSwapAt < 0
        || custom.weaponModeSwapAt > 180
      )) {
        messages.push(`덱 ${deck.id} · ${name}: 저격 모드 변경 시점은 0~180초여야 합니다.`);
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

  // ── 설정 공유 서버 ──────────────────────────────────────────────────────
  // 전투 조건과 조합이 같은 서버·같은 판을 쓴다. 주소가 없으면 판을 아예 만들지
  // 않고 코드 주고받기만 남는다.
  const shareServer = SHARE_API ? new ShareServer(SHARE_API) : null;
  const sharePanelHosts = (prefix: 'share' | 'battle-share') => ({
    tabs: element<HTMLElement>(root, `[data-${prefix}-tabs]`),
    upload: element<HTMLElement>(root, `[data-${prefix}-pane="upload"]`),
    list: element<HTMLElement>(root, `[data-${prefix}-pane="list"]`),
    code: element<HTMLElement>(root, `[data-${prefix}-pane="code"]`),
  });

  // ── 조합 공유 코드 ──────────────────────────────────────────────────────
  const shareModal = element<HTMLElement>(root, '[data-share-modal]');
  const shareOut = element<HTMLTextAreaElement>(root, '[data-share-out]');
  const shareIn = element<HTMLTextAreaElement>(root, '[data-share-in]');
  const shareUrl = element<HTMLTextAreaElement>(root, '[data-share-url]');
  const shareMsg = element<HTMLElement>(root, '[data-share-msg]');
  const showShareMsg = (message: string, ok = false) => {
    shareMsg.hidden = message === '';
    shareMsg.textContent = message;
    shareMsg.classList.toggle('is-ok', ok);
  };
  // 편성 프리셋 — 자주 쓰는 조합을 이름 붙여 이 브라우저에 둔다. 담는 건 공유 코드
  // 하나뿐이라(=편성만) 스펙이 바뀌어도 그대로 쓸 수 있고, 저장 용량도 거의 안 든다.
  const PRESET_KEY = 'nikke-presets-v1';
  const PRESET_MAX = 50;
  interface Preset { name: string; code: string; at: string; }
  const presetName = element<HTMLInputElement>(root, '[data-preset-name]');
  const presetList = element<HTMLElement>(root, '[data-preset-list]');
  let presets: Preset[] = (() => {
    try {
      const raw = resolveStorage()?.getItem(PRESET_KEY);
      const parsed = raw ? (JSON.parse(raw) as Preset[]) : [];
      return Array.isArray(parsed) ? parsed.filter((p) => p && p.name && p.code) : [];
    } catch {
      return [];
    }
  })();
  const savePresets = () => {
    try {
      resolveStorage()?.setItem(PRESET_KEY, JSON.stringify(presets));
    } catch {
      /* 저장 실패는 무시 */
    }
  };
  const renderPresets = () => {
    presetList.replaceChildren();
    if (presets.length === 0) {
      presetList.append(createText('p', '저장된 프리셋이 없습니다.', 'preset-empty'));
      return;
    }
    for (const preset of presets) {
      const row = document.createElement('div');
      row.className = 'preset-item';
      row.dataset.preset = preset.name;
      const load = document.createElement('button');
      load.type = 'button';
      load.className = 'preset-load';
      load.textContent = preset.name;
      load.title = `${preset.at.slice(0, 10)} 저장 · 눌러서 불러오기`;
      load.addEventListener('click', () => {
        applyShareText(preset.code);
        refreshShareFields();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'preset-remove';
      remove.textContent = '삭제';
      remove.setAttribute('aria-label', `${preset.name} 삭제`);
      remove.addEventListener('click', () => {
        presets = presets.filter((item) => item.name !== preset.name);
        savePresets();
        renderPresets();
      });
      row.append(load, remove);
      presetList.append(row);
    }
  };
  element<HTMLButtonElement>(root, '[data-preset-save]').addEventListener('click', () => {
    const name = presetName.value.trim();
    if (!name) {
      showShareMsg('프리셋 이름을 적어 주세요.');
      presetName.focus();
      return;
    }
    if (!decksInScope().some((deck) => deck.squad.some(Boolean))) {
      showShareMsg(shareScope === 'all'
        ? '편성이 비어 있어 저장할 것이 없습니다.'
        : `덱 ${activeDeckId}이 비어 있습니다. 다른 덱을 담으려면 위에서 «5덱 전부»를 고르세요.`);
      return;
    }
    if (presets.length >= PRESET_MAX && !presets.some((p) => p.name === name)) {
      showShareMsg(`프리셋은 ${PRESET_MAX}개까지 저장합니다. 쓰지 않는 것을 지워 주세요.`);
      return;
    }
    const code = shareScopeCode();
    presets = [{ name, code, at: new Date().toISOString() },
      ...presets.filter((item) => item.name !== name)];
    savePresets();
    renderPresets();
    presetName.value = '';
    showShareMsg(`«${name}» 으로 저장했습니다`
      + `(${shareScope === 'all' ? '5덱 전부' : `덱 ${activeDeckId}만`}).`
      + ' 편성만 담기므로 스펙이 바뀌어도 그대로 씁니다.', true);
  });

  // 계산 기록 — 그때의 편성(공유 코드)과 수치·조건을 남긴다. 편성만 되살릴 수 있게
  // 코드로 담아, 스펙이 바뀌어도 조합은 그대로 복원된다.
  const HISTORY_KEY = 'nikke-history-v1';
  const HISTORY_MAX = 30;
  interface HistoryEntry {
    at: string; code: string; total: number; duration: number;
    decks: Array<{ id: number; total: number; squad: string[] }>;
    conditions: string;
  }
  const historyModal = element<HTMLElement>(root, '[data-history-modal]');
  const historyList = element<HTMLElement>(root, '[data-history-list]');
  let calcHistory: HistoryEntry[] = (() => {
    try {
      const raw = resolveStorage()?.getItem(HISTORY_KEY);
      const parsed = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
      return Array.isArray(parsed) ? parsed.filter((item) => item && item.code) : [];
    } catch {
      return [];
    }
  })();
  const persistHistory = () => {
    try {
      resolveStorage()?.setItem(HISTORY_KEY, JSON.stringify(calcHistory));
    } catch {
      /* 저장 실패는 무시 */
    }
  };
  const saveHistory = (batch: BatchResult) => {
    const battle = readBattle();
    const entry: HistoryEntry = {
      at: new Date().toISOString(),
      code: encodeShareCode(decks, fiveDeckMode),
      total: batch.total,
      duration: batch.decks[0]?.result.duration ?? 0,
      decks: batch.decks.map((deck) => ({
        id: deck.deckId,
        total: deck.result.squadTotal,
        squad: deck.request.squad.filter(Boolean),
      })),
      conditions: `${battle.duration}초 · 방어력 ${battle.enemyDef.toLocaleString('en-US')}`
        + `${battle.enemyCode ? ` · ${battle.enemyCode}` : ' · 코드 없음'}`
        + `${battle.coreEnabled ? ` · 코어 ${battle.corePx}px` : ''} · 시드 ${battle.seed}`,
    };
    calcHistory = [entry, ...calcHistory].slice(0, HISTORY_MAX);
    persistHistory();
    renderHistory();
    historyModal.hidden = false;
  };
  const renderHistory = () => {
    historyList.replaceChildren();
    if (calcHistory.length === 0) {
      historyList.append(createText('p', '아직 저장된 결과가 없습니다. 결과에서 «결과 저장»을 눌러 주세요.', 'preset-empty'));
      return;
    }
    for (const entry of calcHistory) {
      const row = document.createElement('article');
      row.className = 'history-item';
      row.dataset.historyItem = entry.at;
      const head = document.createElement('div');
      head.className = 'history-head';
      head.append(
        createText('strong', formatDamage(entry.total)),
        createText('span', new Date(entry.at).toLocaleString('ko-KR')),
      );
      row.append(head, createText('p', entry.conditions, 'history-cond'));
      for (const deck of entry.decks) {
        row.append(createText(
          'p',
          `덱 ${deck.id} · ${formatDamage(deck.total)} — ${deck.squad.join(', ') || '빈 덱'}`,
          'history-deck',
        ));
      }
      const actions = document.createElement('div');
      actions.className = 'history-actions';
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'preset-load';
      restore.textContent = '이 편성 되살리기';
      restore.addEventListener('click', () => {
        // 기록은 «그때 그 판»이다 — 범위 고르개와 무관하게 판 전체를 되살린다.
        applyShareText(entry.code, 'all');
        historyModal.hidden = true;
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'preset-remove';
      remove.textContent = '삭제';
      remove.addEventListener('click', () => {
        calcHistory = calcHistory.filter((item) => item.at !== entry.at);
        persistHistory();
        renderHistory();
      });
      actions.append(restore, remove);
      row.append(actions);
      historyList.append(row);
    }
  };
  element<HTMLButtonElement>(root, '[data-history-close]').addEventListener('click', () => {
    historyModal.hidden = true;
  });
  historyModal.addEventListener('click', (event) => {
    if (event.target === historyModal) historyModal.hidden = true;
  });

  /**
   * 주고받을 범위. 「이 덱만」이 기본이다 — 덱 하나를 옮기는 일이 판 전체를 옮기는
   * 일보다 훨씬 잦은데, 예전에는 그것도 5덱 코드로 나가고 받는 쪽에서는 판을 통째로
   * 덮었다(2~5덱이 조용히 지워졌다).
   *
   * 저장·복사·올리기와 **적용까지 같은 값을 본다** — 「이 덱만」으로 받으면 코드에 든
   * 첫 덱이 지금 보고 있는 덱에 들어가고 나머지 덱은 그대로 남는다.
   */
  type ShareScope = 'one' | 'all';
  let shareScope: ShareScope = 'one';
  const scopeBox = element<HTMLElement>(root, '[data-share-scope]');
  const scopeNote = element<HTMLElement>(root, '[data-share-scope-note]');

  /** 지금 보고 있는 덱의 자리(0부터). 덱 순서를 바꿔도 따라간다. */
  const activeDeckIndex = (): number => {
    const at = decks.findIndex((deck) => deck.id === activeDeckId);
    return at >= 0 ? at : 0;
  };

  /** 범위에 맞춰 담을 덱들. 「이 덱만」이면 지금 덱 하나다. */
  const decksInScope = (): DeckState[] =>
    (shareScope === 'all' ? decks : [decks[activeDeckIndex()]!]);

  const shareScopeCode = (): string =>
    (shareScope === 'all'
      ? encodeShareCode(decks, fiveDeckMode)
      : encodeShareCode([decks[activeDeckIndex()]!], false));

  const renderScope = () => {
    for (const button of scopeBox.querySelectorAll<HTMLButtonElement>('[data-share-scope-pick]')) {
      button.classList.toggle('is-on', button.dataset.shareScopePick === shareScope);
    }
    scopeNote.textContent = shareScope === 'all'
      ? '5덱을 한 코드에 담고, 받으면 판 전체가 바뀝니다.'
      : `덱 ${activeDeckId}만 담고, 받으면 덱 ${activeDeckId}에만 들어갑니다.`;
  };

  for (const button of scopeBox.querySelectorAll<HTMLButtonElement>('[data-share-scope-pick]')) {
    button.addEventListener('click', () => {
      shareScope = button.dataset.shareScopePick === 'all' ? 'all' : 'one';
      renderScope();
      refreshShareFields();
      showShareMsg('');
    });
  }

  const refreshShareFields = () => {
    const code = shareScopeCode();
    shareOut.value = code;
    // 코드가 짧아져 링크로도 무리가 없다 — 받는 쪽은 열기만 하면 적용된다.
    shareUrl.value = `${location.origin}${location.pathname}#deck=${encodeURIComponent(code)}`;
  };
  const openShareModal = (focusPreset = false) => {
    renderScope();
    refreshShareFields();
    renderPresets();
    shareIn.value = '';
    showShareMsg('');
    shareModal.hidden = false;
    squadSharePanel?.open();
    // 프리셋은 «코드» 탭 안에 있다 — 겨냥해 열었으면 그 탭으로 간다.
    if (focusPreset) {
      root.querySelector<HTMLButtonElement>('[data-share-tab="code"]')?.click();
      presetName.focus();
    }
  };
  element<HTMLButtonElement>(root, '[data-share-open]').addEventListener('click', () => {
    openShareModal();
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
  // 링크째 붙여넣어도 되게, #deck= 뒤의 코드만 뽑아 쓴다.
  const shareCodeFrom = (text: string): string => {
    const hit = text.match(/#deck=([^&\s]+)/);
    return hit ? decodeURIComponent(hit[1]!) : text;
  };
  /**
   * 받은 코드를 덱에 얹는다.
   *
   * `scope`를 안 주면 모달의 범위 고르개를 따른다. 공유 링크와 계산 기록은 «그때 그
   * 판을 통째로»라는 뜻이므로 `'all'`을 못 박아 넘긴다 — 링크를 연 사람이 덱 하나만
   * 받으면 판을 잃는다.
   */
  const applyShareText = (text: string, scope: ShareScope = shareScope) => {
    try {
      // 카탈로그 이름을 넘겨야 해시에서 캐릭터를 되찾는다(커스텀 니케도 카탈로그에 있다).
      const payload = decodeShareCode(shareCodeFrom(text), catalog.map((char) => char.name));
      const into = scope === 'all' ? 'all' : activeDeckIndex();
      const landed = scope === 'all' ? 1 : activeDeckId;
      // 스펙은 내 것을 쓴다 — CSV 로스터를 넣어 뒀으면 그대로 얹힌다.
      const { applied, skipped } = applyShareToDecks(
        payload, decks,
        (name) => catalogByName.has(name),
        (name) => (roster[name] ? cloneOverride(roster[name]!) : undefined),
        into,
      );
      if (scope === 'all') {
        fiveDeckMode = payload.fiveDeckMode || applied > 1;
        element<HTMLInputElement>(root, '#squad-mode').checked = fiveDeckMode;
        deckTabs.hidden = !fiveDeckMode;
        deckMoves.hidden = !fiveDeckMode;
        deckNote.hidden = !fiveDeckMode;
        activeDeckId = 1;
      }
      saveState();
      renderDeckTabs();
      renderSquad();
      showErrors([]);
      const missing = skipped.length > 0
        ? ` · 목록에 없는 니케 ${skipped.length}명 제외(${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''})`
        : '';
      // 5덱짜리를 한 칸에 받았으면 나머지가 어디 갔는지 반드시 말해 준다.
      const carried = payload.decks.filter((deck) => deck.squad.some((n) => n.trim() !== '')).length;
      if (scope === 'all') {
        showShareMsg(`덱 ${applied}개를 적용했습니다${missing}.`, skipped.length === 0);
      } else if (carried > 1) {
        showShareMsg(`코드에 덱이 ${carried}개 들어 있어 첫 덱만 덱 ${landed}에 넣었습니다`
          + `${missing}. 판 전체를 받으려면 위에서 «5덱 전부»를 고르세요.`);
      } else {
        showShareMsg(`덱 ${landed}에 적용했습니다${missing}. 다른 덱은 그대로입니다.`,
          skipped.length === 0);
      }
    } catch (error) {
      showShareMsg(error instanceof Error ? error.message : String(error));
    }
  };
  element<HTMLButtonElement>(root, '[data-share-apply]').addEventListener('click', () => {
    applyShareText(shareIn.value);
  });
  const squadSharePanel: SharePanel | null = shareServer && mountSharePanel(
    sharePanelHosts('share'),
    {
      kind: 'squad',
      server: shareServer,
      current: () => ({
        code: shareScopeCode(),
        auto: summarizeSquad(decksInScope(), shareScope === 'all' && fiveDeckMode),
      }),
      // applyShareText가 제외된 니케까지 세어 자기 말로 알린다 — 그대로 쓴다.
      apply: (item) => {
        applyShareText(item.code);
        refreshShareFields();
      },
      notify: showShareMsg,
      // 조합은 이름을 늘어놓는 것보다 초상화가 빠르다. 코드를 그 자리에서 풀어
      // 덱마다 한 줄씩 세운다 — 못 풀면 설명 줄로 물러난다.
      preview: (item) => {
        try {
          const payload = decodeShareCode(item.code, catalog.map((char) => char.name));
          const decks = payload.decks
            .map((deck) => deck.squad.filter((name) => name.trim() !== ''))
            .filter((squad) => squad.length > 0);
          if (decks.length === 0) return null;
          return squadPreview(decks, (name) => {
            const image = catalogByName.get(name)?.image;
            return image ? `${import.meta.env.BASE_URL}${image}` : undefined;
          });
        } catch {
          return null;
        }
      },
    },
  );
  element<HTMLButtonElement>(root, '[data-share-url-copy]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl.value);
      showShareMsg('링크를 복사했습니다. 받는 사람은 열기만 하면 편성이 들어갑니다.', true);
    } catch {
      shareUrl.select();
      showShareMsg('자동 복사가 막혀 링크를 선택해 뒀습니다. Ctrl+C로 복사해 주세요.');
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

  /**
   * 정밀 수치 CSV. **같은 계산을 0.1초 칸으로 한 번 더 받아** 표로 만든다.
   *
   * 결과에 늘 실어 두지 않는 이유는 무게다 — 칸이 열 배가 되면 저장되는 결과도
   * 그만큼 무거워지는데, 정작 쓰는 사람은 드물다. 다시 받는 데 실패하면(옛 결과를
   * 불러온 경우 등) 손에 있는 1초 표로 내보낸다 — 수치 자체는 어느 쪽이든 정확하다.
   */
  const exportDamageCsv = async (batch: BatchResult, button: HTMLButtonElement) => {
    const label = button.textContent ?? '정밀 수치 CSV';
    button.disabled = true;
    button.textContent = '수치 모으는 중…';
    try {
      const parts: string[] = [];
      let coarseOnly = false;
      for (const entry of batch.decks) {
        let result = entry.result;
        try {
          result = await client.simulate({ ...entry.request, fineTimeline: true });
        } catch {
          coarseOnly = true;   // 다시 못 받았으면 손에 있는 것으로 낸다
        }
        const timeline = result.fineTimeline ?? result.timeline;
        if (!result.fineTimeline) coarseOnly = true;
        const names = entry.request.squad.filter(Boolean);
        const note = `${entry.request.duration}초 · 적 방어력 ${entry.request.enemyDef}`;
        if (batch.decks.length > 1) parts.push(csvText([[`덱 ${entry.deckId}`]]));
        parts.push(damageCsv({ ...result, timeline }, names, note));
      }
      downloadImage(csvBlob(parts.join('\r\n\r\n')),
        csvFileName(batch.decks.length > 1 ? '5덱' : `덱 ${batch.decks[0]?.deckId ?? 1}`));
      status.textContent = coarseOnly
        ? '정밀 수치 CSV를 내려받았습니다 (1초 단위 — 0.1초 표는 다시 계산해야 나옵니다).'
        : '정밀 수치 CSV를 내려받았습니다 (0.1초 단위).';
    } catch (error) {
      status.textContent = `정밀 수치 CSV를 만들지 못했습니다: ${(error as Error).message}`;
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
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

  // ── 자세히 보기 ─────────────────────────────────────────────────────────
  // 켠 상태는 이 브라우저에 남는다 — 한 번 켜 둔 사람은 늘 그 눈으로 본다.
  const DETAIL_KEY = 'nikke-detail-damage-v1';
  let detailDamage = false;
  try {
    detailDamage = resolveStorage()?.getItem(DETAIL_KEY) === '1';
  } catch { /* 저장된 값을 못 읽으면 줄여 쓰기(기본)로 간다 */ }

  /**
   * 「자세히 보기」 — 결과의 대미지를 줄이지 않고 1의 자리까지 적는다.
   *
   * 두 덱이 「1.24억」으로 똑같이 보이는데 실제로는 수십만이 갈리는 일이 있다.
   * 켠 상태는 이 브라우저에 남는다. 타임라인 눈금과 보고서 이미지는 자리가 좁아
   * 늘 줄여 적는다 — 여기서 바뀌는 것은 결과 패널뿐이다.
   */
  const dmg = (value: number): string =>
    (detailDamage ? formatExactDamage(value) : formatDamage(value));
  const dps = (value: number): string =>
    (detailDamage ? formatExactDps(value) : formatDps(value));

  const renderBatchResult = (batch: BatchResult) => {
    // 한 번이라도 돌렸으면 «조건부터 보라»는 강조는 물러난다.
    settleBattleNote();
    // 수령자는 실제 발동 로그에서 온다 — 결과가 들어와야 카드에 채울 수 있다.
    let touchedActiveDeck = false;
    for (const entry of batch.decks) {
      const targets = entry.result.buffTargets;
      const deck = decks.find((d) => d.id === entry.deckId);
      if (!targets || !deck) continue;
      buffTargetsByDeck.set(entry.deckId, { sig: deckSignature(deck), rows: targets });
      if (entry.deckId === activeDeckId) touchedActiveDeck = true;
    }
    if (touchedActiveDeck) { saveState(); renderSquad(); }

    resultPanel.replaceChildren();
    const duration = batch.decks[0]?.result.duration ?? 1;
    const header = document.createElement('div');
    header.className = 'result-header';
    const copy = document.createElement('div');
    copy.append(createText('h2', batch.decks.length > 1 ? '5덱 전투 결과' : '전투 결과'));
    const summary = document.createElement('div');
    summary.className = 'total-block';
    const total = createText('strong', dmg(batch.total));
    total.dataset.resultTotal = '';
    total.dataset.batchTotal = '';
    summary.append(createText('span', batch.decks.length > 1 ? '전체 덱 총 대미지' : '스쿼드 총 대미지'), total, createText('small', dps(batch.total / duration)));
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
    const historySave = document.createElement('button');
    historySave.type = 'button';
    historySave.className = 'report-open';
    historySave.dataset.historySave = '';
    historySave.textContent = '결과 저장';
    historySave.title = '이때의 편성과 수치를 이 브라우저에 남깁니다';
    historySave.addEventListener('click', () => saveHistory(batch));
    const historyOpen = document.createElement('button');
    historyOpen.type = 'button';
    historyOpen.className = 'report-open';
    historyOpen.dataset.historyOpen = '';
    historyOpen.textContent = '결과 불러오기';
    historyOpen.addEventListener('click', () => { renderHistory(); historyModal.hidden = false; });
    // 정밀 수치 — 화면은 「1.24억」으로 줄여 적지만 엔진은 처음부터 정수로 정확히 센다.
    // 1의 자리까지 놓고 따지려는 사람에게 그 정수를 표로 내준다.
    const csvButton = document.createElement('button');
    csvButton.type = 'button';
    csvButton.className = 'report-open';
    csvButton.dataset.csvExport = '';
    csvButton.textContent = '정밀 수치 CSV';
    csvButton.title = '구간별·최종 대미지를 1의 자리까지 담은 표를 내려받습니다 (0.1초 단위)';
    csvButton.addEventListener('click', () => { void exportDamageCsv(batch, csvButton); });
    // 자세히 보기 — 「1.24억」 대신 1의 자리까지. 내려받지 않고 그 자리에서 본다.
    const detailLabel = document.createElement('label');
    detailLabel.className = 'inline-check detail-toggle';
    const detailBox = document.createElement('input');
    detailBox.type = 'checkbox';
    detailBox.dataset.detailDamage = '';
    detailBox.checked = detailDamage;
    detailLabel.title = '대미지를 줄여 쓰지 않고 1의 자리까지 적습니다';
    detailBox.addEventListener('change', () => {
      detailDamage = detailBox.checked;
      try {
        resolveStorage()?.setItem(DETAIL_KEY, detailDamage ? '1' : '0');
      } catch { /* 저장 실패는 무시한다 — 이번 판만 못 기억할 뿐이다 */ }
      renderBatchResult(batch);
    });
    detailLabel.append(detailBox, createText('span', '자세히 보기'));
    reportTools.append(historySave, historyOpen, reportButton, csvButton, detailLabel);
    resultPanel.append(reportTools);

    // 덱 순위 — 딜 내림차순으로 «등수»만 구한다. 세우는 순서는 끝까지 덱 번호 그대로다.
    const ordered = [...batch.decks].sort((a, b) => b.result.squadTotal - a.result.squadTotal);
    const ranking = new Map(ordered.map((entry, index) => [entry.deckId, index + 1]));
    const best = ordered[0]?.result.squadTotal ?? 0;
    const portraitOf = (name: string): string | undefined => {
      const image = catalogByName.get(name)?.image;
      return image ? `${import.meta.env.BASE_URL}${image}` : undefined;
    };

    /** 덱 하나의 속. 캐릭터 카드와 사실 줄, 이탈 목록. */
    const renderDeckDetail = (host: HTMLElement, entry: DeckResultEntry) => {
      host.replaceChildren();
      const section = document.createElement('section');
      section.className = 'deck-result';
      section.dataset.deckResult = String(entry.deckId);
      const deckHeader = document.createElement('div');
      deckHeader.className = 'deck-result-header';
      deckHeader.append(
        createText('h3', `덱 ${entry.deckId}`),
        createText('strong', dmg(entry.result.squadTotal)),
        createText('small', dps(entry.result.squadTotal / entry.result.duration)),
      );
      section.append(deckHeader);
      if (ranking.size > 1) {
        const rank = ranking.get(entry.deckId)!;
        const gap = best > 0 ? (entry.result.squadTotal / best - 1) * 100 : 0;
        const badge = createText(
          'p',
          rank === 1
            ? '1위 · 기준'
            : `${rank}위 · 1위 대비 ${gap.toFixed(1)}% (${dmg(entry.result.squadTotal - best)})`,
          'deck-rank',
        );
        badge.dataset.deckRank = String(rank);
        if (rank === 1) badge.classList.add('is-best');
        section.append(badge);
      }
      if (entry.result.previewNote) section.append(createText('p', entry.result.previewNote, 'preview-warning'));
      // 덱을 갈아 가며 볼 때는 줄이 짧고 비교가 쉽다. 한 덱만 볼 때는 카드가 편성과
      // 자리가 맞아 낫다 — 화면의 목적이 달라서 모양도 다르다.
      const fmt: DamageFormat = { dmg, dps };
      if (batch.decks.length > 1) renderCharacterRows(section, entry, portraitOf, fmt);
      else renderCharacterCards(section, entry, portraitOf, fmt);
      const facts = document.createElement('div');
      facts.className = 'result-facts';
      facts.append(
        createText('span', `${entry.result.duration}초 전투`),
        createText('span', `${entry.result.hitCount.toLocaleString('ko-KR')} 히트`),
        createText('span', `시드 ${entry.request.seed}`),
      );
      section.append(facts, createText('pre', entry.result.deviations, 'deviations'));
      host.append(section);
    };

    const detail = document.createElement('div');
    detail.className = 'deck-detail';
    if (batch.decks.length > 1) {
      // 덱마다 탭 하나. **덱 번호 순서 그대로** 왼쪽에서 오른쪽으로 세우고, 딜 1·2위는
      // 자리를 옮기지 않고 뱃지로만 표시한다. 고른 덱만 아래에 자세히 편다.
      const tabs = document.createElement('div');
      tabs.className = 'deck-result-tabs';
      tabs.dataset.deckResultTabs = '';
      const buttons = new Map<number, HTMLButtonElement>();
      const show = (entry: DeckResultEntry) => {
        for (const [id, button] of buttons) {
          button.classList.toggle('is-on', id === entry.deckId);
          button.setAttribute('aria-pressed', String(id === entry.deckId));
        }
        renderDeckDetail(detail, entry);
      };
      for (const entry of batch.decks) {
        const rank = ranking.get(entry.deckId)!;
        const tab = document.createElement('button');
        tab.type = 'button';
        // 순위는 다섯 덱 모두에 적고, 1·2위만 색으로 강조한다. 자리는 덱 번호 순 그대로다.
        tab.className = 'deck-result-tab'
          + (rank === 1 ? ' is-first' : rank === 2 ? ' is-second' : '');
        tab.dataset.deckResultTab = String(entry.deckId);
        tab.dataset.deckRank = String(rank);
        const head = document.createElement('b');
        head.append(document.createTextNode(`덱 ${entry.deckId}`));
        head.append(createText('em', `${rank}위`, 'deck-tab-rank'));
        // 덱끼리 견주는 자리라 줄이지 않고 온전한 숫자를 적는다 — «1.14억»으로는
        // 2위와의 차이가 읽히지 않는다.
        tab.append(head, createText('span', Math.round(entry.result.squadTotal).toLocaleString('ko-KR')));
        tab.addEventListener('click', () => show(entry));
        buttons.set(entry.deckId, tab);
        tabs.append(tab);
      }
      resultPanel.append(tabs);
      show(batch.decks[0]!);
    } else if (batch.decks[0]) {
      renderDeckDetail(detail, batch.decks[0]);
    }
    resultPanel.append(detail);

    // 타임라인도 한 번에 하나만 본다 — 다섯을 세로로 쌓으면 어느 덱을 보고 있는지
    // 스크롤 중에 놓친다. 탭은 결과와 같이 **덱 번호 순서 그대로** 선다.
    timelineBody.replaceChildren();
    const blocks = new Map<number, HTMLElement>();
    for (const entry of batch.decks) {
      // 버스트 핀에 쓸 초상화. 캔버스가 직접 그리므로 URL만 넘긴다.
      const portraitUrls: Record<string, string> = {};
      for (const name of entry.request.squad) {
        const image = catalogByName.get(name)?.image;
        if (image) portraitUrls[name] = `${import.meta.env.BASE_URL}${image}`;
      }
      const timelineBlock = createTimelineBlock(entry, portraitUrls);
      if (timelineBlock) blocks.set(entry.deckId, timelineBlock);
    }
    if (blocks.size > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'deck-result-tabs timeline-tabs';
      tabs.dataset.timelineTabs = '';
      const stage = document.createElement('div');
      stage.dataset.timelineStage = '';
      const buttons = new Map<number, HTMLButtonElement>();
      const show = (deckId: number) => {
        for (const [id, button] of buttons) {
          button.classList.toggle('is-on', id === deckId);
          button.setAttribute('aria-pressed', String(id === deckId));
        }
        stage.replaceChildren(blocks.get(deckId)!);
      };
      for (const deckId of blocks.keys()) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'deck-result-tab';
        tab.dataset.timelineTab = String(deckId);
        tab.append(createText('b', `덱 ${deckId}`));
        tab.addEventListener('click', () => show(deckId));
        buttons.set(deckId, tab);
        tabs.append(tab);
      }
      timelineBody.append(tabs, stage);
      show([...blocks.keys()][0]!);
    } else {
      for (const block of blocks.values()) timelineBody.append(block);
    }
    timelineHasContent = blocks.size > 0;
    timelinePanel.hidden = !timelineHasContent || currentView !== 'calc';
  };

  // ── 버스트 순서 ─────────────────────────────────────────────────────────
  /** 이 판에서만 쓰는 요소 만들기. union-raid의 같은 이름 도우미와 짝이다. */
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K, className?: string, text?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // 사이클마다 단계별로 누구를 쓸지 손으로 정한다. 창을 쓰는 이유는 **키보드를
  // 통째로 가져가기 때문**이다 — 탭 안에 두면 A·S·D·F·G가 검색칸과 부딪친다.
  const burstModal = element<HTMLElement>(root, '[data-burst-order-modal]');
  const burstOpenButton = element<HTMLButtonElement>(root, '[data-burst-order-open]');
  const burstBadge = element<HTMLElement>(root, '[data-burst-order-badge]');
  const burstNow = element<HTMLElement>(root, '[data-burst-now]');
  const burstPicksBox = element<HTMLElement>(root, '[data-burst-picks]');
  const burstList = element<HTMLElement>(root, '[data-burst-list]');
  const burstProgress = element<HTMLElement>(root, '[data-burst-progress]');
  const burstCyclesOut = element<HTMLOutputElement>(root, '[data-burst-cycles]');
  const burstCyclesNote = element<HTMLElement>(root, '[data-burst-cycles-note]');
  const burstMsg = element<HTMLElement>(root, '[data-burst-order-msg]');

  /** 창이 열려 있는 동안의 작업본. 「이 순서로 두기」를 눌러야 덱에 남는다. */
  let burstPicks: Record<string, string> = {};
  let burstCycles = 1;
  let burstAt = 0;          // 지금 서 있는 걸음
  let burstSteps: BurstStep[] = [];

  const showBurstMsg = (message: string, ok = false) => {
    burstMsg.hidden = message === '';
    burstMsg.textContent = message;
    burstMsg.classList.toggle('is-ok', ok);
  };

  /** 「버스트 안 씀」으로 잡아 둔 사람. 후보에서 뺀다. */
  const burstSkipped = (deck: DeckState): Set<string> => new Set(
    Object.entries(deck.characters)
      .filter(([, value]) => value.burst?.mode === 'skip')
      .map(([name]) => name),
  );

  const burstCandidates = (stage: BurstStage): string[] => {
    const deck = activeDeck();
    return candidatesFor(stage, {
      squad: deck.squad,
      metaOf: (name) => catalogByName.get(name),
      skipped: burstSkipped(deck),
    });
  };

  /** 덱 도구 줄의 단추에 「9사이클」처럼 적어 둔다 — 열지 않아도 걸려 있는지 보인다. */
  function renderBurstBadge(): void {
    const kept = sequenceForDeck(activeDeck());
    burstBadge.hidden = kept === null;
    burstBadge.textContent = kept ? `${kept.length}` : '';
    // 순서를 걸어 두면 단추 자체가 색을 바꾼다 — 열어 보지 않아도 걸린 게 보인다.
    burstOpenButton.classList.toggle('is-on', kept !== null);
  }

  /** 아직 안 고른 첫 칸으로 옮긴다. 창을 다시 열면 하던 자리에서 이어진다. */
  const firstUnpicked = (): number => {
    const at = burstSteps.findIndex((step) => !burstPicks[stepKey(step)]);
    return at >= 0 ? at : Math.max(0, burstSteps.length - 1);
  };

  function renderBurstOrder(): void {
    burstSteps = stepsFor(burstCycles);
    burstAt = Math.min(Math.max(0, burstAt), Math.max(0, burstSteps.length - 1));
    burstCyclesOut.textContent = String(burstCycles);

    const { done, total } = progressOf(burstPicks, burstSteps);
    burstProgress.textContent = `${done} / ${total}칸`;

    // ── 지금 걸음 ──
    burstNow.replaceChildren();
    burstPicksBox.replaceChildren();
    const step = burstSteps[burstAt];
    if (!step) {
      burstNow.append(el('p', 'burst-empty', '사이클을 하나 이상 두세요.'));
    } else {
      const head = el('div', 'burst-now-head');
      head.append(
        el('span', 'burst-now-cycle', `${step.cycle}번째 풀버스트`),
        el('span', `burst-now-stage stage-${step.stage}`, `${step.stage}버`),
      );
      const picked = burstPicks[stepKey(step)];
      head.append(el('span', 'burst-now-pick', picked ? `→ ${picked}` : '→ 자동'));
      burstNow.append(head);

      const candidates = burstCandidates(step.stage);
      if (candidates.length === 0) {
        burstPicksBox.append(el('p', 'burst-empty',
          `편성에 ${step.stage}버가 없습니다. 이 단계는 건너뜁니다.`));
      }
      candidates.forEach((name, index) => {
        const button = el('button', 'burst-pick' + (picked === name ? ' is-on' : ''));
        (button as HTMLButtonElement).type = 'button';
        const key = HOTKEYS[index];
        const face = document.createElement('div');
        face.className = 'burst-pick-face';
        const image = catalogByName.get(name)?.image;
        if (image) {
          const img = document.createElement('img');
          img.src = `${import.meta.env.BASE_URL}${image}`;
          img.alt = '';
          img.loading = 'lazy';
          face.append(img);
        } else {
          face.textContent = name.slice(0, 2);
        }
        button.append(face, el('span', 'burst-pick-name', name));
        if (key) button.append(el('b', 'burst-pick-key', key));
        button.addEventListener('click', () => pickBurst(name));
        burstPicksBox.append(button);
      });
      // 「이 단계는 자동으로」 — 고른 것을 무르는 자리다.
      const auto = el('button', 'burst-pick is-auto' + (picked ? '' : ' is-on'));
      (auto as HTMLButtonElement).type = 'button';
      auto.append(el('span', 'burst-pick-name', '자동'));
      auto.append(el('b', 'burst-pick-key', '0'));
      auto.addEventListener('click', () => pickBurst(null));
      burstPicksBox.append(auto);
    }

    // ── 적어 둔 것 ──
    // 사이클마다 **빈 칸 셋**이고, 고를 때마다 초상화가 채워진다. 글줄로 적으면
    // 스물일곱 칸 중 어디까지 왔는지가 안 읽힌다 — 빈 칸이 남아 있는 게 보여야 한다.
    burstList.replaceChildren();
    const sequence = sequenceFrom(burstPicks, burstCycles);
    sequence.forEach((cycle, index) => {
      const cycleNo = index + 1;
      const row = el('div', 'burst-row' + (burstSteps[burstAt]?.cycle === cycleNo ? ' is-now' : ''));
      row.title = cycleLine(cycle);
      row.append(el('span', 'burst-row-no', `${cycleNo}`));

      const slots = el('div', 'burst-row-slots');
      for (const stage of BURST_STAGES) {
        const name = (cycle[stage] ?? [])[0];
        const here = burstSteps[burstAt]?.cycle === cycleNo && burstSteps[burstAt]?.stage === stage;
        const slot = el('button', 'burst-slot'
          + (name ? ' is-filled' : '') + (here ? ' is-here' : ''));
        (slot as HTMLButtonElement).type = 'button';
        slot.append(el('span', `burst-slot-stage stage-${stage}`, `${stage}버`));

        const face = el('span', 'burst-slot-face');
        if (name) {
          const image = catalogByName.get(name)?.image;
          if (image) {
            const img = document.createElement('img');
            img.src = `${import.meta.env.BASE_URL}${image}`;
            img.alt = name;
            img.loading = 'lazy';
            face.append(img);
          } else {
            face.textContent = name.slice(0, 2);
          }
          slot.title = `${cycleNo}번째 ${stage}버 — ${name}`;
        } else {
          slot.title = `${cycleNo}번째 ${stage}버 — 아직 안 정함(자동)`;
        }
        slot.append(face);
        slot.addEventListener('click', () => {
          const at = burstSteps.findIndex((s) => s.cycle === cycleNo && s.stage === stage);
          if (at >= 0) burstAt = at;
          renderBurstOrder();
        });
        slots.append(slot);
      }
      row.append(slots);
      burstList.append(row);
    });
  }

  /** 한 칸 고르고 다음으로. `null`이면 그 칸을 자동으로 되돌린다. */
  function pickBurst(name: string | null): void {
    const step = burstSteps[burstAt];
    if (!step) return;
    if (name === null) delete burstPicks[stepKey(step)];
    else burstPicks[stepKey(step)] = name;
    if (burstAt < burstSteps.length - 1) burstAt += 1;
    showBurstMsg('');
    renderBurstOrder();
  }

  function openBurstOrder(): void {
    const deck = activeDeck();
    if (!deck.squad.some((name) => name.trim())) {
      showErrors(['버스트 순서를 정하려면 편성을 먼저 채워 주세요.']);
      return;
    }
    const kept = sequenceForDeck(deck);
    burstPicks = picksFrom(kept ?? undefined);
    // 사이클 수: 적어 둔 게 있으면 그만큼, 아니면 지난 계산의 **실제 횟수**,
    // 그것도 없으면 전투 시간으로 어림한다.
    const measured = cyclesFromTimeline(
      lastBatch?.decks.find((entry) => entry.deckId === deck.id)?.result.timeline);
    burstCycles = kept?.length ?? measured ?? estimateCycles(readBattle().duration);
    burstCyclesNote.textContent = kept
      ? '적어 둔 순서를 불러왔습니다.'
      : (measured !== null
        ? `지난 계산에서 풀버스트가 ${measured}번 돌았습니다.`
        : `전투 ${readBattle().duration}초로 어림한 값입니다. 한 번 계산해 보면 실제 횟수로 맞춰집니다.`);
    burstSteps = stepsFor(burstCycles);
    burstAt = firstUnpicked();
    showBurstMsg('');
    renderBurstOrder();
    burstModal.hidden = false;
  }

  const closeBurstOrder = () => { burstModal.hidden = true; };

  burstOpenButton.addEventListener('click', openBurstOrder);
  element<HTMLButtonElement>(root, '[data-burst-order-close]').addEventListener('click', closeBurstOrder);
  burstModal.addEventListener('click', (event) => {
    if (event.target === burstModal) closeBurstOrder();
  });
  element<HTMLButtonElement>(root, '[data-burst-cycles-up]').addEventListener('click', () => {
    burstCycles = Math.min(MAX_CYCLES, burstCycles + 1);
    renderBurstOrder();
  });
  element<HTMLButtonElement>(root, '[data-burst-cycles-down]').addEventListener('click', () => {
    burstCycles = Math.max(1, burstCycles - 1);
    renderBurstOrder();
  });
  element<HTMLButtonElement>(root, '[data-burst-order-reset]').addEventListener('click', () => {
    burstPicks = {};
    burstAt = 0;
    showBurstMsg('');
    renderBurstOrder();
  });
  element<HTMLButtonElement>(root, '[data-burst-order-save]').addEventListener('click', () => {
    const deck = activeDeck();
    const sequence = trimSequence(sequenceFrom(burstPicks, burstCycles));
    if (sequence) deck.burstSequence = sequence;
    else delete deck.burstSequence;
    saveState();
    renderBurstBadge();
    closeBurstOrder();
    showErrors([]);
  });
  element<HTMLButtonElement>(root, '[data-burst-order-clear]').addEventListener('click', () => {
    delete activeDeck().burstSequence;
    burstPicks = {};
    burstAt = 0;
    saveState();
    renderBurstBadge();
    renderBurstOrder();
    showBurstMsg('순서를 지웠습니다. 계산기가 평소 순서로 고릅니다.', true);
  });

  // 키보드는 창이 열려 있을 때만 가져간다. 조합키가 눌린 입력은 브라우저 것이다.
  document.addEventListener('keydown', (event) => {
    if (burstModal.hidden) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') { closeBurstOrder(); return; }
    if (event.key === 'ArrowLeft') {
      burstAt = Math.max(0, burstAt - 1);
      renderBurstOrder();
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowRight') {
      burstAt = Math.min(Math.max(0, burstSteps.length - 1), burstAt + 1);
      renderBurstOrder();
      event.preventDefault();
      return;
    }
    if (event.key === '0') { pickBurst(null); event.preventDefault(); return; }
    const at = HOTKEYS.indexOf(event.key.toUpperCase() as typeof HOTKEYS[number]);
    if (at < 0) return;
    const step = burstSteps[burstAt];
    if (!step) return;
    const name = burstCandidates(step.stage)[at];
    if (!name) return;
    pickBurst(name);
    event.preventDefault();
  });

  element<HTMLButtonElement>(root, '[data-deck-clear]').addEventListener('click', () => {
    const deck = activeDeck();
    deck.squad = ['', '', '', '', ''];
    deck.characters = {};
    activeSlot = 0;
    closeDeckCopy();
    showErrors([]);
    saveState();
    renderDeckTabs();
    renderSquad();
    renderRosterGrid();
  });

  element<HTMLInputElement>(root, '#squad-mode').addEventListener('change', (event) => {
    fiveDeckMode = (event.currentTarget as HTMLInputElement).checked;
    // 5덱을 끄면 «지금 보고 있던 덱»이 1덱 자리로 온다 — 2~5덱 중 하나만 계산하려고
    // 끄는 경우가 많은데, 그때마다 편성을 손으로 옮기는 건 번거롭다(유저 피드백).
    if (!fiveDeckMode && activeDeckId !== 1) {
      const picked = decks.find((deck) => deck.id === activeDeckId);
      const first = decks[0]!;
      if (picked) {
        [first.squad, picked.squad] = [picked.squad, first.squad];
        [first.characters, picked.characters] = [picked.characters, first.characters];
      }
    }
    activeDeckId = 1;
    deckTabs.hidden = !fiveDeckMode;
    deckMoves.hidden = !fiveDeckMode;
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
    if (target?.closest('.settings-panel')) { saveState(); refreshBattleSummary(); }
  });
  // ── 전투 조건 공유 ──────────────────────────────────────────────────────
  const battleShareModal = element<HTMLElement>(root, '[data-battle-share-modal]');
  const battleShareOut = element<HTMLTextAreaElement>(root, '[data-battle-share-out]');
  const battleShareIn = element<HTMLTextAreaElement>(root, '[data-battle-share-in]');
  const battleShareMsg = element<HTMLElement>(root, '[data-battle-share-msg]');
  const showBattleShareMsg = (message: string, ok = false) => {
    battleShareMsg.hidden = message === '';
    battleShareMsg.textContent = message;
    battleShareMsg.classList.toggle('is-ok', ok);
  };

  /** 받은 전투 조건을 얹는다. 콘솔과 싱크로 레벨은 코드에 없으므로 내 값을 그대로 둔다. */
  const applyBattleCode = (code: string): void => {
    const applied = decodeBattleCode(code);
    const mine = readBattle();
    writeBattle({ ...applied, console: mine.console, synchroLevel: mine.synchroLevel });
    corePxInput.disabled = !applied.coreEnabled;
    saveState();
    showErrors([]);
  };
  const battleSharePanel: SharePanel | null = shareServer && mountSharePanel(
    sharePanelHosts('battle-share'),
    {
      kind: 'boss',
      server: shareServer,
      current: () => ({
        code: encodeBattleCode(readBattle(), settings.normalHitCoeff ?? {}),
        auto: summarizeBattle(readBattle()),
      }),
      apply: (item) => {
        applyBattleCode(item.code);
        showBattleShareMsg(`«${item.name}»을(를) 적용했습니다. 콘솔은 내 값 그대로입니다.`, true);
      },
      notify: showBattleShareMsg,
    },
  );

  element<HTMLButtonElement>(root, '[data-battle-share-open]').addEventListener('click', () => {
    battleShareOut.value = encodeBattleCode(readBattle(), settings.normalHitCoeff ?? {});
    battleShareIn.value = '';
    showBattleShareMsg('');
    battleShareModal.hidden = false;
    battleSharePanel?.open();
  });
  element<HTMLButtonElement>(root, '[data-battle-share-close]').addEventListener('click', () => {
    battleShareModal.hidden = true;
  });
  battleShareModal.addEventListener('click', (event) => {
    if (event.target === battleShareModal) battleShareModal.hidden = true;
  });
  element<HTMLButtonElement>(root, '[data-battle-share-copy]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(battleShareOut.value);
      showBattleShareMsg('코드를 복사했습니다.', true);
    } catch {
      battleShareOut.select();
      showBattleShareMsg('자동 복사가 막혀 코드를 선택해 뒀습니다. Ctrl+C로 복사해 주세요.');
    }
  });
  element<HTMLButtonElement>(root, '[data-battle-share-apply]').addEventListener('click', () => {
    try {
      applyBattleCode(battleShareIn.value);
      showBattleShareMsg('전투 조건을 적용했습니다. 콘솔은 내 값 그대로입니다.', true);
    } catch (error) {
      showBattleShareMsg(error instanceof Error ? error.message : String(error));
    }
  });

  element<HTMLButtonElement>(root, '[data-reset-enemy]').addEventListener('click', () => {
    writeBattle(resetEnemy(readBattle()));
    saveState();
    showErrors([]);
  });
  // 니케 고르기 판. 창이 아니라 편성 바로 아래 늘 펼쳐져 있고, 검색은 이 판을 거른다.
  const rosterGrid = element<HTMLElement>(root, '[data-roster-grid]');
  const rosterSearch = element<HTMLInputElement>(root, '[data-roster-search]');
  const rosterEmpty = element<HTMLElement>(root, '[data-roster-empty]');
  const rosterCount = element<HTMLElement>(root, '[data-roster-count]');
  const rosterDesc = element<HTMLElement>(root, '[data-roster-desc]');
  // 필터는 **그룹 안에서는 OR, 그룹 사이에서는 AND**다. 무기 SG·SMG를 함께 켜면
  // 둘 중 하나면 통과하고, 거기에 클래스 화력형을 더하면 «화력형이면서 SG나 SMG»가 된다.
  // 인게임 도감이 이 방식이라 익숙하고, 하나만 고르는 것보다 훨씬 빨리 좁혀진다.
  type FilterKey = 'burst' | 'rarity' | 'class' | 'code' | 'weapon' | 'corp';
  const picked: Record<FilterKey, Set<string>> = {
    burst: new Set(), rarity: new Set(), class: new Set(),
    code: new Set(), weapon: new Set(), corp: new Set(),
  };
  type SortKey = 'power' | 'name' | 'element' | 'elementAtk';
  // 처음 보이는 순서는 전투력 높은 순이다 — 목록에서 먼저 찾는 것이 «내가 키운
  // 니케»라, 가나다순으로 세워 두면 매번 스크롤해서 찾아야 한다.
  const DEFAULT_SORT: SortKey = 'power';
  let sortKey: SortKey = DEFAULT_SORT;
  // 같은 항목을 다시 누르면 뒤집는다. 항목마다 «자연스러운» 방향이 달라서
  // (이름은 가나다순, 수치는 높은 순) 처음 고를 때는 그 방향으로 잡는다.
  let sortDesc = true;

  // ── 정렬 · 필터 판 ──────────────────────────────────────────────────────
  // 정렬은 «내 로스터에서 이 캐릭터가 얼마나 굴려졌나»를 본다. 오버로드 수치가
  // 그 척도라, CSV·프로필로 불러온 내 값이 있으면 그걸 쓰고 없으면 기본 스펙을 쓴다.
  const SORTS: Array<{ key: SortKey; label: string; hint: string }> = [
    { key: 'power', label: '전투력', hint: '인게임 투력 — 다시 누르면 뒤집습니다' },
    { key: 'name', label: '이름', hint: '가나다순 — 다시 누르면 뒤집습니다' },
    { key: 'element', label: '우월코드', hint: '오버로드 우월 코드 대미지 — 다시 누르면 뒤집습니다' },
    { key: 'elementAtk', label: '우공합', hint: '우월 코드 + 공격력 증가 합 — 다시 누르면 뒤집습니다' },
  ];

  /** 처음 고를 때의 방향. 이름은 오름차순, 수치는 높은 순이 자연스럽다. */
  const defaultDesc = (key: SortKey): boolean => key !== 'name';

  /** 이 캐릭터에게 실제로 적용될 오버로드 — 내 로스터 값이 우선이다. */
  const overloadOf = (name: string): Record<string, number> =>
    roster[name]?.overload ?? settings.characters[name]?.overload ?? {};

  // 전투력은 엔진이 기본 스탯까지 계산해야 나온다 — 워커를 한 번 돌려 받아 둔다.
  // 로스터를 바꾸면 값이 달라지므로 서명이 어긋나면 다시 받는다.
  let combatPower: Record<string, number> = {};
  let powerSig = '';
  let powerLoading = false;

  const loadCombatPower = async () => {
    if (!client.combatPower) return;
    const sig = JSON.stringify(roster);
    if (powerLoading || powerSig === sig) return;
    powerLoading = true;
    try {
      await prepared;
      const custom = customPayload();
      const got = await client.combatPower({
        names: catalog.map((meta) => meta.name),
        characters: roster,
        ...(Object.keys(custom).length > 0 ? { customCharacters: custom } : {}),
      });
      combatPower = got;
      powerSig = sig;
      renderFilterState();
      renderRosterGrid();
    } catch {
      /* 전투력은 정렬 편의 기능이다 — 실패해도 목록은 그대로 쓴다 */
    } finally {
      powerLoading = false;
    }
  };

  /** 버스트만 판 밖에 있다 — 값은 여기 두고 그리는 자리만 다르다. */
  const BURST_VALUES = ['1', '2', '3', 'A'];
  const FILTER_GROUPS: Array<{ key: FilterKey; title: string; values: string[] }> = [
    { key: 'rarity', title: '등급', values: ['SSR', 'SR', 'R'] },
    { key: 'class', title: '클래스', values: ['화력형', '방어형', '지원형'] },
    { key: 'code', title: '코드', values: ['작열', '수냉', '풍압', '전격', '철갑'] },
    { key: 'weapon', title: '무기', values: ['AR', 'SMG', 'SG', 'SR', 'RL', 'MG'] },
    { key: 'corp', title: '기업', values: ['엘리시온', '미실리스', '테트라', '필그림', '어브노말'] },
  ];

  const labelOf = (key: FilterKey, value: string) =>
    key === 'burst' ? `B${value}` : value;

  /** 고른 필터 개수. 0이면 뱃지를 감춘다. */
  const pickedCount = (): number =>
    Object.values(picked).reduce((sum, set) => sum + set.size, 0);

  function sortRoster(list: CharacterMeta[]): void {
    const byName = (a: CharacterMeta, b: CharacterMeta) => a.name.localeCompare(b.name, 'ko');
    const flip = sortDesc ? -1 : 1;
    if (sortKey === 'name') { list.sort((a, b) => flip * byName(a, b)); return; }
    const scoreOf = (char: CharacterMeta): number => {
      if (sortKey === 'power') return combatPower[char.name] ?? 0;
      const over = overloadOf(char.name);
      const element = over.element_bonus ?? 0;
      return sortKey === 'element' ? element : element + (over.atk_pct ?? 0);
    };
    // 같은 값 안에서는 늘 이름순 — 정렬 방향을 바꿔도 동점끼리 요동치지 않는다.
    list.sort((a, b) => flip * (scoreOf(a) - scoreOf(b)) || byName(a, b));
  }

  const filterPanel = element<HTMLElement>(root, '[data-filter-panel]');
  const filterOpen = element<HTMLButtonElement>(root, '[data-filter-open]');
  const filterBadge = element<HTMLElement>(root, '[data-filter-badge]');
  const filterReset = element<HTMLButtonElement>(root, '[data-filter-reset]');
  const filterSummary = element<HTMLElement>(root, '[data-filter-summary]');

  const renderFilterState = () => {
    const count = pickedCount();
    filterBadge.hidden = count === 0;
    filterBadge.textContent = String(count);
    filterReset.hidden = count === 0;
    // 판을 접어도 무엇이 걸려 있는지 알 수 있게 요약을 남긴다.
    // 정렬은 늘 적혀 있다 — 기본이 전투력순이라, 안 적어 두면 «왜 가나다순이
    // 아닌가»를 판을 펼쳐야만 알 수 있다.
    const parts: string[] = [];
    const label = SORTS.find((s) => s.key === sortKey)?.label;
    const pending = sortKey === 'power' && Object.keys(combatPower).length === 0;
    parts.push(`${label}${pending ? ' 계산중' : sortDesc ? ' ▼' : ' ▲'}`);
    for (const key of ['burst', ...FILTER_GROUPS.map((group) => group.key)] as FilterKey[]) {
      const set = picked[key];
      if (set.size > 0) {
        parts.push([...set].map((value) => labelOf(key, value)).join('·'));
      }
    }
    filterSummary.textContent = parts.join(' · ');
  };

  /** 필터 칩 하나. 같은 칩을 다시 누르면 꺼진다 — 「전체」 칩을 따로 두지 않아도 된다. */
  const filterChip = (key: FilterKey, value: string): HTMLButtonElement => {
    const chip = document.createElement('button');
    chip.type = 'button';
    const on = picked[key].has(value);
    chip.className = 'filter-chip' + (on ? ' is-on' : '');
    chip.dataset.filterChip = `${key}:${value}`;
    chip.setAttribute('aria-pressed', String(on));
    chip.textContent = labelOf(key, value);
    chip.addEventListener('click', () => {
      if (on) picked[key].delete(value);
      else picked[key].add(value);
      renderFilterPanel();
      renderFilterState();
      renderRosterGrid();
    });
    return chip;
  };

  const renderFilterPanel = () => {
    const burstBox = element<HTMLElement>(root, '[data-burst-group]');
    burstBox.replaceChildren(...BURST_VALUES.map((value) => filterChip('burst', value)));

    const sortBox = element<HTMLElement>(root, '[data-sort-group]');
    sortBox.replaceChildren();
    for (const option of SORTS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      const active = sortKey === option.key;
      chip.className = 'filter-chip' + (active ? ' is-on' : '');
      chip.dataset.sort = option.key;
      chip.dataset.sortDir = active ? (sortDesc ? 'desc' : 'asc') : '';
      chip.append(createText('span', option.label));
      // 삼각형으로 방향을 알린다 — 켜진 항목에만 붙는다.
      if (active) chip.append(createText('b', sortDesc ? '▼' : '▲', 'sort-caret'));
      chip.title = option.hint;
      chip.addEventListener('click', () => {
        // 같은 항목을 다시 누르면 뒤집고, 다른 항목이면 그 항목의 기본 방향으로 간다.
        if (active) sortDesc = !sortDesc;
        else { sortKey = option.key; sortDesc = defaultDesc(option.key); }
        // 전투력은 무거우니 고를 때 받는다. 오는 동안은 이름순으로 서 있는다.
        if (sortKey === 'power') void loadCombatPower();
        renderFilterPanel();
        renderFilterState();
        renderRosterGrid();
      });
      sortBox.append(chip);
    }

    const box = element<HTMLElement>(root, '[data-filter-groups]');
    box.replaceChildren();
    for (const group of FILTER_GROUPS) {
      const section = document.createElement('div');
      section.className = 'filter-section';
      section.append(createText('p', group.title, 'filter-title'));
      const chips = document.createElement('div');
      chips.className = 'filter-chips';
      chips.append(...group.values.map((value) => filterChip(group.key, value)));
      section.append(chips);
      box.append(section);
    }
  };

  const setFilterPanel = (open: boolean) => {
    filterOpen.setAttribute('aria-expanded', String(open));
    filterPanel.hidden = !open;
  };
  filterOpen.addEventListener('click', () => {
    setFilterPanel(filterOpen.getAttribute('aria-expanded') !== 'true');
  });
  // 목록 위에 얹히는 판이라 드롭다운과 같은 규칙을 따른다 — 바깥을 누르거나
  // Esc면 닫힌다. 판 안과 판을 여는 줄(«필터 지우기» 포함)은 바깥이 아니다.
  const pickerBar = element<HTMLElement>(root, '.picker-bar');
  document.addEventListener('pointerdown', (event) => {
    if (filterPanel.hidden) return;
    const target = event.target as Node | null;
    if (target && (filterPanel.contains(target) || pickerBar.contains(target))) return;
    setFilterPanel(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !filterPanel.hidden) setFilterPanel(false);
  });
  filterReset.addEventListener('click', () => {
    for (const set of Object.values(picked)) set.clear();
    sortKey = DEFAULT_SORT;
    sortDesc = defaultDesc(DEFAULT_SORT);
    renderFilterPanel();
    renderFilterState();
    renderRosterGrid();
  });

  const renderRosterGrid = () => {
    // 직접 추가한 니케까지 포함해 지금 고를 수 있는 전체를 보여준다.
    const all = [...catalogByName.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const narrowed = all.filter((char) => {
      const meta = settings.characters[char.name];
      const hit = (key: FilterKey, value: string | undefined) =>
        picked[key].size === 0 || (value !== undefined && picked[key].has(value));
      return hit('burst', char.burstStage)
        && hit('rarity', meta?.rarity)
        && hit('class', char.className)
        && hit('code', char.elementCode)
        && hit('weapon', char.weaponType)
        && hit('corp', char.manufacturer);
    });
    sortRoster(narrowed);
    // 칩으로 먼저 좁히고 검색어로 세운다. 검색은 초성과 구분자까지 받아
    // 「ㅋㄹㅇ」·「라피레드」가 걸리고, 친 이름이 맨 앞에 온다.
    const shown = filterByQuery(narrowed, rosterSearch.value, buildIndex);
    rosterCount.textContent = shown.length === all.length
      ? `${all.length}명` : `${shown.length} / ${all.length}명`;
    const deck = activeDeck();
    rosterGrid.replaceChildren();
    for (const char of shown) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'roster-cell';
      cell.dataset.rosterCell = char.name;
      // 이미 이 덱에 있으면 중복 편성이 안 되므로 눌리지 않게 둔다.
      const takenAt = deck.squad.indexOf(char.name);
      if (takenAt >= 0 && takenAt !== activeSlot) {
        cell.disabled = true;
        cell.classList.add('is-taken');
        cell.title = `이미 덱 ${deck.id}의 ${takenAt + 1}번에 있습니다`;
      }
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
      // 버스트 단계 맞은편(우상단)에 속성 아이콘.
      const codeIcon = createElementIcon(char.elementCode, 'roster-code');
      if (codeIcon) portrait.append(codeIcon);
      if (char.preview) {
        // (임시) — 스킬 미공개라 창작한 값으로 도는 캐릭터. 고르기 전에 보여야 한다.
        const temp = createText('i', '임시', 'roster-temp');
        temp.title = '스킬이 공개되지 않아 임의로 창작한 값으로 계산합니다';
        portrait.append(temp);
      }
      cell.append(
        portrait,
        createText('strong', char.preview ? `${char.name} (임시)` : char.name),
        createText('span', [char.elementCode, char.weaponType, char.className].filter(Boolean).join(' · ')),
      );
      cell.addEventListener('click', () => pickCharacter(char.name));
      // 끌어다 칸에 놓을 수도 있다. 이미 이 덱에 있는 니케는 누를 수 없으니 끌 수도 없다.
      if (!cell.disabled) {
        cell.draggable = true;
        cell.addEventListener('dragstart', (event) => {
          const drag = event as DragEvent;
          drag.dataTransfer?.setData(DRAG_NAME, char.name);
          drag.dataTransfer?.setData('text/plain', char.name);
          if (drag.dataTransfer) drag.dataTransfer.effectAllowed = 'copy';
          cell.classList.add('is-dragging');
        });
        cell.addEventListener('dragend', () => cell.classList.remove('is-dragging'));
      }
      rosterGrid.append(cell);
    }
    rosterEmpty.hidden = shown.length > 0;
    updatePickerTarget();
  };

  /**
   * 다른 덱에 남아 있는 그 캐릭터의 개별 설정. 지금 보고 있는 덱은 빼고, 가장
   * 가까운 덱부터 찾는다 — 방금 만진 덱의 값이 가장 그럴듯하기 때문이다.
   */
  const settingsFromOtherDeck = (name: string): CharacterOverrides | undefined => {
    const others = [...decks].sort((a, b) =>
      Math.abs(a.id - activeDeckId) - Math.abs(b.id - activeDeckId));
    for (const other of others) {
      if (other.id === activeDeckId) continue;
      const found = other.characters[name];
      if (found) return cloneOverride(found);
    }
    return undefined;
  };

  const carryToggle = element<HTMLInputElement>(root, '#carry-settings');
  carryToggle.addEventListener('change', () => {
    carryOverSettings = carryToggle.checked;
    saveState();
  });

  const pickCharacter = (name: string, targetSlot = activeSlot) => {
    const deck = activeDeck();
    const slot = Math.max(0, Math.min(4, targetSlot));
    const previous = deck.squad[slot] ?? '';
    deck.squad[slot] = name;
    if (previous && previous !== name) delete deck.characters[previous];
    if (!deck.characters[name]) {
      // 다른 덱에서 이미 만져 둔 설정이 있으면 그것을 가져온다. 없으면 CSV·프로필로
      // 불러온 내 로스터 값을 쓴다. 덱을 옮길 때마다 같은 수치를 다시 넣는 일이
      // 가장 잦은 불편이었다 — 끄면 예전처럼 덱마다 따로 논다.
      const borrowed = carryOverSettings ? settingsFromOtherDeck(name) : undefined;
      if (borrowed) deck.characters[name] = borrowed;
      else if (roster[name]) deck.characters[name] = cloneOverride(roster[name]!);
    }
    // 연달아 채울 수 있게 다음 빈 칸으로 옮겨 간다. 다 찼으면 방금 넣은 칸에 머문다.
    const next = deck.squad.findIndex((member) => !member);
    activeSlot = next < 0 ? slot : next;
    pullActiveSlot = true;
    showErrors([]);
    saveState();
    renderDeckTabs();
    renderSquad();
    renderRosterGrid();
    // (임시) 캐릭터는 넣는 순간 바로 알린다 — 결과까지 가서야 알면 이미 늦다.
    if (catalogByName.get(name)?.preview) {
      status.textContent = `${name}은(는) 아직 (임시) 등록입니다 — 스킬이 공개되지 않아 `
        + '임의로 창작한 값으로 계산합니다. 실제 성능과 무관하니 참고용으로만 봐 주세요.';
    }
  };

  /** 판이 어느 칸을 겨냥하는지 알려 준다. 창이 없으니 이 한 줄이 유일한 안내다. */
  const updatePickerTarget = () => {
    const deck = activeDeck();
    const filled = deck.squad.filter(Boolean).length;
    const current = deck.squad[activeSlot];
    rosterDesc.textContent = current
      ? `${activeSlot + 1}번 칸을 ${current} 대신 채웁니다 · ${filled}/5명`
      : `${activeSlot + 1}번 빈 칸을 채웁니다 · ${filled}/5명`;
  };

  // 접힌 채로 시작한다 — 무엇으로 재는지 한 줄은 처음부터 적혀 있어야 한다.
  refreshBattleSummary();
  renderFilterPanel();
  renderFilterState();
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
      void loadCombatPower();
      applyRosterToDecks();
      saveState();
      renderDeckTabs();
      renderSquad();
      const skipped = unmatched.length > 0 ? ` · 미지원 ${unmatched.length}명 제외` : '';
      updateRosterNote(`CSV 로스터 ${matched.length}명 적용${skipped}`
        + ' · 큐브와 호감도는 CSV에 없어 기본값으로 계산합니다(카드의 개별 설정에서 수정)');
    } catch (error) {
      updateRosterNote(`CSV 불러오기 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      rosterInput.value = '';
    }
  });

  // 블라블라링크 연동. 프록시가 설정된 빌드에서만 마크업이 있으므로 없으면 통째로 건너뛴다.
  if (blablaProxy) {
    const blablaModal = element<HTMLElement>(root, '[data-blabla-modal]');
    const blablaServer = element<HTMLSelectElement>(root, '[data-blabla-server]');
    const blablaUrl = element<HTMLInputElement>(root, '[data-blabla-url]');
    const blablaSync = element<HTMLButtonElement>(root, '[data-blabla-sync]');
    const blablaStatus = element<HTMLElement>(root, '[data-blabla-status]');

    const setStatus = (message: string) => {
      blablaStatus.textContent = message;
      blablaStatus.hidden = message === '';
    };

    const runSync = async () => {
      const url = blablaUrl.value.trim();
      if (!looksLikeProfileUrl(url)) {
        setStatus('블라블라링크 프로필 주소를 붙여넣어 주세요.');
        return;
      }
      const selectedArea = blablaServer.value === '' ? undefined : Number(blablaServer.value);
      blablaSync.disabled = true;
      blablaServer.disabled = true;
      setStatus('블라블라링크에서 받는 중… 니케가 많으면 몇 초 걸립니다.');
      try {
        const response = await fetch(`${blablaProxy}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profileUrl: url,
            ...(selectedArea === undefined ? {} : { area: selectedArea }),
          }),
        });
        const payload = await response.json() as RawProfile & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `동기화에 실패했습니다 (${response.status}).`);

        const area = pickArea(payload, selectedArea);
        if (!area) throw new Error('니케 목록이 비어 있습니다.');
        const serverLabel = blablaServerLabel(area.area);
        const { overrides, matched, unmatched, notes } = areaToOverrides(area, settings, catalog);
        if (matched.length === 0) {
          setStatus('계산기가 다루는 니케를 찾지 못했습니다. 프로필이 공개인지 확인해 주세요.');
          return;
        }

        roster = overrides;
        saveRoster();
        void loadCombatPower();
        applyRosterToDecks();

        // 콘솔은 계정 단위라 전투 설정 쪽에 있다. 전초기지가 비공개면 안 오고, 그때는
        // 손대지 않는 게 맞다 — 0으로 덮으면 멀쩡하던 값이 사라진다.
        const consoleLevels = consoleFrom(area);
        if (consoleLevels) writeBattle({ ...readBattle(), console: consoleLevels });

        saveState();
        renderDeckTabs();
        renderSquad();

        const parts = [`블라블라링크 ${serverLabel} ${matched.length}명 적용`];
        if (unmatched.length > 0) parts.push(`미지원 ${unmatched.length}명 제외`);
        if (consoleLevels) parts.push('콘솔 레벨 함께 적용');
        updateRosterNote(parts.join(' · '));
        setStatus([`${serverLabel} 서버에서 ${matched.length}명을 불러왔습니다.`, ...notes].join(' '));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        blablaSync.disabled = false;
        blablaServer.disabled = false;
      }
    };

    element<HTMLButtonElement>(root, '[data-blabla-open]').addEventListener('click', () => {
      blablaModal.hidden = false;
      blablaUrl.focus();
    });
    element<HTMLButtonElement>(root, '[data-blabla-close]').addEventListener('click', () => {
      blablaModal.hidden = true;
    });
    blablaModal.addEventListener('click', (event) => {
      if (event.target === blablaModal) blablaModal.hidden = true;
    });
    blablaSync.addEventListener('click', () => { void runSync(); });
    blablaUrl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); void runSync(); }
    });
  }

  // ── ENIKK 조합 가져오기 ─────────────────────────────────────────────────
  // enikk.app 솔로레이드 랭킹 상위 300명(서버당 50명 × 6서버)의 1~5덱을 받아
  // 같은 편성끼리 묶는다. 페이지를 넘길 필요가 없다 — GraphQL이 한 번에 다 준다.
  // v1은 조합으로 묶어 저장했다(`players`가 숫자였다). 사람 단위로 바꾸면서 모양이
  // 달라졌으므로 키를 올린다 — 안 올리면 예전 캐시를 새 코드가 읽다 터진다.
  const ENIKK_KEY = 'nikke-enikk-v2';
  const enikkStatus = element<HTMLElement>(root, '[data-enikk-status]');
  const enikkSummary = element<HTMLElement>(root, '[data-enikk-summary]');
  const enikkList = element<HTMLElement>(root, '[data-enikk-list]');
  const enikkCompare = element<HTMLElement>(root, '[data-enikk-compare]');
  const enikkLoad = element<HTMLButtonElement>(root, '[data-enikk-load]');
  const enikkRefresh = element<HTMLButtonElement>(root, '[data-enikk-refresh]');
  let enikkData: EnikkImport | null = null;
  // 300명을 한 줄로 늘어놓으면 스크롤이 끝없다 — 열 명씩 끊어 쪽으로 넘긴다.
  const ENIKK_PER_PAGE = 10;
  let enikkPage = 0;
  let currentView: 'calc' | 'union' | 'enikk' | 'links' = 'calc';

  const readEnikkCache = (): EnikkImport | null => {
    try {
      const raw = resolveStorage()?.getItem(ENIKK_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as EnikkImport;
      // 키를 올려도 남의 브라우저에는 무엇이 들어 있을지 모른다. 쓰기 전에 모양을 본다.
      if (!Array.isArray(data?.players) || !data.season) return null;
      return data;
    } catch { return null; }
  };
  const writeEnikkCache = (data: EnikkImport) => {
    try { resolveStorage()?.setItem(ENIKK_KEY, JSON.stringify(data)); } catch { /* 용량 초과면 그냥 안 남긴다 */ }
  };

  /** 초상화 다섯 장. 이름을 모르는 사람도 눈으로 알아보게. */
  const enikkPortraits = (squad: string[]): HTMLElement => {
    const box = document.createElement('div');
    box.className = 'enikk-faces';
    for (const name of squad) {
      const char = catalogByName.get(name);
      const cell = document.createElement('span');
      cell.className = 'enikk-face';
      cell.title = name;
      if (char?.image) {
        const img = document.createElement('img');
        img.src = `${import.meta.env.BASE_URL}${char.image}`;
        img.alt = name;
        img.loading = 'lazy';
        cell.append(img);
      }
      cell.append(createText('em', name));
      box.append(cell);
    }
    return box;
  };

  /** 한 플레이어의 다섯 덱을 우리 5덱에 그대로 깐다. */
  const applyPlayerToDecks = (player: EnikkPlayer) => {
    const usable = player.decks.filter(enikkDeckUsable);
    if (usable.length === 0) return;
    for (const deck of decks) { deck.squad = ['', '', '', '', '']; deck.characters = {}; }
    usable.slice(0, 5).forEach((source, index) => {
      const deck = decks[index]!;
      deck.squad = [...source.squad];
      for (const name of source.squad) {
        if (roster[name]) deck.characters[name] = cloneOverride(roster[name]!);
      }
    });
    // 다섯 덱을 한 번에 받았으니 5덱 모드가 아니면 볼 수가 없다.
    if (usable.length > 1 && !fiveDeckMode) {
      const toggle = element<HTMLInputElement>(root, '#squad-mode');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));
    }
    activeDeckId = 1;
    activeSlot = 0;
    showErrors([]);
    saveState();
    renderDeckTabs();
    renderSquad();
    renderRosterGrid();
    switchView('calc');
    scrollTo(squadGrid);
  };

  // ── 제외 니케 ───────────────────────────────────────────────────────────
  // 안 가진 니케가 낀 덱은 가져와도 못 쓴다. enikk 데이터 자체가 아니라 «내 사정»이라
  // 계산 결과가 아닌 **화면 층**에서 거른다.
  const EXCLUDE_KEY = 'nikke-enikk-excluded-v1';
  let enikkExcluded: string[] = [];
  try {
    const raw = resolveStorage()?.getItem(EXCLUDE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    if (Array.isArray(parsed)) {
      enikkExcluded = parsed.filter((n): n is string =>
        typeof n === 'string' && catalogByName.has(n));
    }
  } catch { /* 못 읽으면 빈 목록으로 시작한다 */ }

  const saveExcluded = () => {
    try {
      resolveStorage()?.setItem(EXCLUDE_KEY, JSON.stringify(enikkExcluded));
    } catch { /* 저장 실패 무시 */ }
  };

  /** 이 덱을 쓸 수 있나 — 계산기가 다룰 수 있고, 제외 니케가 안 껴 있어야 한다. */
  const enikkDeckUsable = (deck: { squad: string[]; usable: boolean }): boolean =>
    deck.usable && !deck.squad.some((name) => enikkExcluded.includes(name));

  const renderExcludeChips = () => {
    const box = element<HTMLElement>(root, '[data-enikk-exclude-chips]');
    box.replaceChildren();
    for (const name of enikkExcluded) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'enikk-exclude-chip';
      chip.dataset.enikkExcludeChip = name;
      chip.title = `${name} 제외 해제`;
      chip.append(createText('span', name));
      chip.append(createText('b', '✕'));
      chip.addEventListener('click', () => {
        enikkExcluded = enikkExcluded.filter((n) => n !== name);
        saveExcluded();
        renderExcludeChips();
        if (enikkData) renderEnikk(enikkData);
      });
      box.append(chip);
    }
  };

  const addExcluded = () => {
    const input = element<HTMLInputElement>(root, '[data-enikk-exclude-input]');
    const name = input.value.trim();
    if (!name) return;
    if (!catalogByName.has(name)) {
      setEnikkStatus(`«${name}»은(는) 목록에 없는 이름입니다.`);
      return;
    }
    if (!enikkExcluded.includes(name)) {
      enikkExcluded.push(name);
      enikkExcluded.sort((a, b) => a.localeCompare(b, 'ko'));
      saveExcluded();
      renderExcludeChips();
      if (enikkData) renderEnikk(enikkData);
    }
    input.value = '';
  };

  // 이름 자동완성 — 오타로 «목록에 없는 이름»을 만나는 일을 줄인다.
  {
    const options = element<HTMLElement>(root, '[data-enikk-exclude-options]');
    for (const meta of catalog) {
      const option = document.createElement('option');
      option.value = meta.name;
      options.append(option);
    }
    renderExcludeChips();
  }

  element<HTMLButtonElement>(root, '[data-enikk-exclude-add]').addEventListener('click', addExcluded);
  element<HTMLInputElement>(root, '[data-enikk-exclude-input]').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); addExcluded(); }
  });

  const renderEnikk = (data: EnikkImport) => {
    enikkData = data;
    enikkPage = 0;
    const weakness = WEAKNESS_KO[data.season.weakness] ?? data.season.weakness;
    enikkSummary.hidden = false;
    enikkSummary.replaceChildren();
    enikkSummary.append(createText('strong', `시즌 ${data.season.raid} · ${data.season.boss}`));
    enikkSummary.append(createText('span',
      `약점 ${weakness} · 플레이어 ${data.players.length}명 · 덱 ${data.decks.toLocaleString('ko-KR')}개`));
    if (data.unknownNames.length > 0) {
      enikkSummary.append(createText('span',
        `계산기가 모르는 니케 ${data.unknownNames.length}종이 낀 덱은 가져올 수 없습니다 — ${data.unknownNames.slice(0, 5).join(', ')}`,
        'enikk-note'));
    }

    enikkList.hidden = false;
    enikkList.replaceChildren();
    const head = document.createElement('div');
    head.className = 'enikk-list-head';
    head.append(createText('h3', `플레이어 ${data.players.length}명 · 총딜 순`));
    const compareBtn = document.createElement('button');
    compareBtn.type = 'button';
    compareBtn.className = 'roster-import';
    compareBtn.textContent = `상위 ${COMPARE_TOP}명 대조판 만들기`;
    compareBtn.title = '상위 10명의 덱을 우리 계산기로 돌려 enikk 실측과 나란히 놓습니다 — 덱 50개라 몇 분 걸립니다';
    compareBtn.addEventListener('click', () => {
      compareBtn.disabled = true;
      void renderCompare().finally(() => { compareBtn.disabled = false; });
    });
    head.append(compareBtn);
    enikkList.append(head);

    const pagerTop = document.createElement('div');
    pagerTop.className = 'enikk-pager';
    const cards = document.createElement('div');
    const pagerBottom = document.createElement('div');
    pagerBottom.className = 'enikk-pager';
    enikkList.append(pagerTop, cards, pagerBottom);

    const pages = Math.max(1, Math.ceil(data.players.length / ENIKK_PER_PAGE));
    if (enikkPage >= pages) enikkPage = 0;

    const drawCards = () => {
      cards.replaceChildren();
      const from = enikkPage * ENIKK_PER_PAGE;
      for (const [offset, player] of data.players.slice(from, from + ENIKK_PER_PAGE).entries()) {
        const index = from + offset;
      const card = document.createElement('article');
      card.className = 'enikk-player';

      const top = document.createElement('div');
      top.className = 'enikk-player-head';
      top.append(createText('span', `${index + 1}`, 'enikk-rank'));
      top.append(createText('b', player.server, 'enikk-server'));
      top.append(createText('span', `총 ${formatEok(player.damage)}`, 'enikk-total'));
      const take = document.createElement('button');
      take.type = 'button';
      take.className = 'enikk-use';
      const usable = player.decks.filter(enikkDeckUsable).length;
      take.textContent = `${usable}덱 가져오기`;
      take.disabled = usable === 0;
      take.title = usable < player.decks.length
        ? '계산기가 못 다루거나 제외한 니케가 낀 덱은 빼고 가져옵니다'
        : '이 사람의 덱을 우리 5덱에 그대로 깝니다';
      take.addEventListener('click', () => applyPlayerToDecks(player));
      top.append(take);
      card.append(top);

      for (const [n, deck] of player.decks.entries()) {
        const row = document.createElement('div');
        const blocked = !enikkDeckUsable(deck);
        row.className = 'enikk-deck' + (blocked ? ' is-blocked' : '');
        if (blocked && deck.usable) {
          row.title = `제외한 니케가 껴 있습니다 — ${deck.squad.filter((n) => enikkExcluded.includes(n)).join(', ')}`;
        }
        row.append(createText('span', `${n + 1}`, 'enikk-deckno'));
        row.append(enikkPortraits(deck.squad));
        row.append(createText('span', formatEok(deck.damage), 'enikk-deckdmg'));
        card.append(row);
      }
      cards.append(card);
      }
    };

    /** 페이지 이동 줄. 위·아래 양쪽에 둔다 — 열 명을 훑고 나면 아래가 가깝다. */
    const drawPager = (box: HTMLElement) => {
      box.replaceChildren();
      const jump = (page: number) => {
        enikkPage = Math.max(0, Math.min(pages - 1, page));
        drawCards();
        drawPager(pagerTop);
        drawPager(pagerBottom);
        scrollTo(enikkList);
      };
      const step = (label: string, page: number, disabled: boolean) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'enikk-page-step';
        b.textContent = label;
        b.disabled = disabled;
        b.addEventListener('click', () => jump(page));
        box.append(b);
      };
      step('‹ 이전', enikkPage - 1, enikkPage === 0);

      // 번호는 현재 쪽 둘레만 편다. 서른 개를 다 늘어놓으면 폰에서 줄이 넘친다.
      const window_ = new Set<number>([0, pages - 1]);
      for (let i = enikkPage - 1; i <= enikkPage + 1; i += 1) {
        if (i >= 0 && i < pages) window_.add(i);
      }
      let previous = -1;
      for (const page of [...window_].sort((a, b) => a - b)) {
        if (previous >= 0 && page - previous > 1) box.append(createText('span', '…', 'enikk-page-gap'));
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'enikk-page' + (page === enikkPage ? ' is-on' : '');
        b.textContent = String(page + 1);
        b.setAttribute('aria-current', page === enikkPage ? 'page' : 'false');
        b.addEventListener('click', () => jump(page));
        box.append(b);
        previous = page;
      }
      step('다음 ›', enikkPage + 1, enikkPage === pages - 1);
      box.append(createText('span', `${pages}쪽 중 ${enikkPage + 1}쪽`, 'enikk-page-info'));
    };

    drawCards();
    drawPager(pagerTop);
    drawPager(pagerBottom);
  };

  const setEnikkStatus = (message: string) => { enikkStatus.textContent = message; };

  // ── 상위 10 대조판 ──────────────────────────────────────────────────────
  // 실사용 조합을 우리 시뮬로 돌려 enikk 실측 평균과 나란히 놓는다. 계산기가 어느
  // 조합에서 얼마나 어긋나는지가 표본 열 개로 한눈에 보인다.
  //
  // **같은 잣대가 아니다.** enikk 평균은 사람마다 다른 육성·조작이 섞인 값이고 우리
  // 시뮬은 지금 화면의 전투 조건과 스펙으로 돈다. 배율은 «얼마나 다른가»를 보는
  // 눈금이지 정답과의 오차가 아니다 — 그 사실을 표에 적어 둔다.
  const COMPARE_TOP = 10;

  const renderCompare = async () => {
    if (!enikkData) return;
    const targets = enikkData.players.slice(0, COMPARE_TOP);
    if (targets.length === 0) return;
    const total = targets.reduce((sum, p) => sum + p.decks.filter((d) => d.usable).length, 0);

    enikkCompare.hidden = false;
    enikkCompare.replaceChildren();
    enikkCompare.append(createText('h3', `상위 ${targets.length}명 대조판`));
    enikkCompare.append(createText('p',
      `덱 ${total}개를 지금 전투 조건과 내 스펙으로 돌려 그 사람의 실제 딜과 나란히 놓습니다. `
      + '스펙이 다른 사람의 기록이므로 배율은 «얼마나 다른가»를 보는 눈금입니다. '
      + '같은 편성은 저장된 결과를 다시 쓰므로 뒤로 갈수록 빨라집니다.',
      'enikk-note'));

    const table = document.createElement('div');
    table.className = 'enikk-table';
    enikkCompare.append(table);

    const battle = readBattle();
    const custom = customPayload();
    await prepared;
    let done = 0;
    for (const [index, player] of targets.entries()) {
      let simTotal = 0;
      let realTotal = 0;
      for (const source of player.decks) {
        if (!enikkDeckUsable(source)) continue;
        done += 1;
        setEnikkStatus(`대조 계산 중 · 덱 ${done}/${total}`);
        const deck: DeckState = { id: 1, squad: [...source.squad], characters: {} };
        for (const name of source.squad) {
          if (roster[name]) deck.characters[name] = cloneOverride(roster[name]!);
        }
        const request = requestForDeck(deck, battle, Object.keys(custom).length > 0 ? custom : undefined);
        const key = cacheKey(request, version);
        let result = cache.get(key);
        if (!result) {
          result = await client.simulate(request);
          cache.set(key, result);
        }
        simTotal += result.squadTotal;
        realTotal += source.damage;
      }
      const ratio = realTotal > 0 ? simTotal / realTotal : 0;

      const row = document.createElement('div');
      row.className = 'enikk-trow';
      row.append(createText('span', `${index + 1}`, 'enikk-rank'));
      const who = document.createElement('div');
      who.className = 'enikk-who';
      who.append(createText('b', player.server, 'enikk-server'));
      who.append(createText('span', `${player.decks.filter((d) => d.usable).length}덱`));
      row.append(who);
      const nums = document.createElement('div');
      nums.className = 'enikk-nums';
      nums.append(createText('span', `실제 ${formatEok(realTotal)}`));
      nums.append(createText('span', `시뮬 ${formatEok(simTotal)}`, 'enikk-sim'));
      if (ratio > 0) {
        const tag = createText('b', `${ratio.toFixed(2)}배`, 'enikk-ratio');
        tag.classList.add(ratio > 1.15 || ratio < 0.85 ? 'is-off' : 'is-near');
        nums.append(tag);
      }
      row.append(nums);
      table.append(row);
    }
    setEnikkStatus(`상위 ${targets.length}명 대조 완료.`);
  };

  const loadEnikk = async (force: boolean) => {
    if (!force) {
      const cached = readEnikkCache();
      if (cached) {
        renderEnikk(cached);
        setEnikkStatus('저장해 둔 결과입니다. 새로 받으려면 «다시 받기»를 누르세요.');
        enikkLoad.hidden = true;
        enikkRefresh.hidden = false;
        return;
      }
    }
    enikkLoad.disabled = true;
    enikkRefresh.disabled = true;
    try {
      const supported = new Set(catalog.map((char) => char.name));
      const data = await loadEnikkComps(catalog, supported, setEnikkStatus);
      writeEnikkCache(data);
      renderEnikk(data);
      setEnikkStatus(`플레이어 ${data.players.length}명 · 덱 ${data.decks}개를 읽었습니다.`);
      enikkLoad.hidden = true;
      enikkRefresh.hidden = false;
    } catch (error) {
      setEnikkStatus(error instanceof Error ? error.message : String(error));
    } finally {
      enikkLoad.disabled = false;
      enikkRefresh.disabled = false;
    }
  };

  enikkLoad.addEventListener('click', () => { void loadEnikk(false); });
  enikkRefresh.addEventListener('click', () => { void loadEnikk(true); });

  // ── 지금 보는 사람 수 ───────────────────────────────────────────────────
  // 공유 서버가 세 준다. 주소가 없으면 아예 띄우지 않는다 — 0명이라고 적어 두면
  // «아무도 없다»로 읽히는데 사실은 «셀 곳이 없다»이기 때문이다.
  if (SHARE_API) {
    const onlineBox = element<HTMLElement>(root, '[data-online]');
    const onlineText = element<HTMLElement>(root, '[data-online-text]');
    startPresence(SHARE_API, (online) => {
      onlineText.textContent = `지금 ${online.toLocaleString('ko-KR')}명`;
      onlineBox.hidden = false;
    });
  }

  // ── 병렬 계산 ───────────────────────────────────────────────────────────
  // 계산은 이 기기에서 돈다. 워커를 여럿 띄우면 덱을 나눠 돌려 빨라지지만, 워커마다
  // 계산 런타임이 하나씩 떠서 메모리를 먹는다 — 그래서 끌 수 있고 개수도 고를 수 있다.
  // 결과는 몇 개로 나누든 같다(판마다 독립·결정론적).
  const PARALLEL_KEY = 'nikke-parallel-v1';
  const parallelToggle = element<HTMLInputElement>(root, '[data-parallel-toggle]');
  const parallelSize = element<HTMLSelectElement>(root, '[data-parallel-size]');
  const poolDefault = client.defaultPoolSize ? client.defaultPoolSize() : 1;
  const poolMax = client.maxPoolSize ?? 1;
  let parallelOn = true;
  let parallelCount = poolDefault;
  try {
    const saved = JSON.parse(resolveStorage()?.getItem(PARALLEL_KEY) ?? 'null') as
      { on?: boolean; count?: number } | null;
    if (saved) {
      if (typeof saved.on === 'boolean') parallelOn = saved.on;
      if (typeof saved.count === 'number') parallelCount = saved.count;
    }
  } catch { /* 저장된 값이 깨졌으면 기본값으로 간다 */ }
  parallelCount = Math.max(1, Math.min(poolMax, Math.trunc(parallelCount) || 1));

  for (let n = 1; n <= poolMax; n += 1) {
    const option = document.createElement('option');
    option.value = String(n);
    option.textContent = `${n}개`;
    parallelSize.append(option);
  }
  // 권장값은 칸을 넓히지 않게 설명 쪽에만 적는다 — 토글 줄이 길어지면 줄이 접힌다.
  parallelSize.title = `띄울 작업 스레드 수. 이 기기 권장 ${poolDefault}개. `
    + '하나마다 계산 런타임이 떠서 메모리를 50~80MB씩 씁니다.';
  const applyParallel = (save: boolean) => {
    parallelToggle.checked = parallelOn;
    parallelSize.value = String(parallelCount);
    parallelSize.disabled = !parallelOn;
    client.setPoolSize?.(parallelOn ? parallelCount : 1);
    if (!save) return;
    try {
      resolveStorage()?.setItem(PARALLEL_KEY, JSON.stringify({ on: parallelOn, count: parallelCount }));
    } catch { /* 저장 실패는 무시한다 — 이번 판만 못 기억할 뿐이다 */ }
  };
  parallelToggle.addEventListener('change', () => {
    parallelOn = parallelToggle.checked;
    applyParallel(true);
  });
  parallelSize.addEventListener('change', () => {
    parallelCount = Number(parallelSize.value) || 1;
    applyParallel(true);
  });
  applyParallel(false);

  // ── 유니온 레이드 (BETA) ────────────────────────────────────────────────
  // 프록시가 있어야 유니온원 스펙을 받아 올 수 있다 — 없으면 탭 자체를 안 그렸다.
  const unionPanel = root.querySelector<HTMLElement>('[data-view="union"]');
  if (unionPanel && blablaProxy) {
    mountUnionRaid({ panel: unionPanel }, {
      proxy: blablaProxy,
      shareServer,
      settings,
      catalog: [...catalogByName.values()],
      simulate: (request) => client.simulate(request),
      imageOf: (name) => {
        const image = catalogByName.get(name)?.image;
        return image ? `${import.meta.env.BASE_URL}${image}` : undefined;
      },
      currentBattleCode: () => encodeBattleCode(readBattle(), settings.normalHitCoeff),
      currentDeckCode: (index) => {
        const deck = decks[index];
        return deck ? encodeShareCode([deck], false) : '';
      },
      catalogNames: () => [...catalogByName.keys()],
      concurrency: () => (parallelOn ? parallelCount : 1),
      me: () => {
        const battle = readBattle();
        return {
          name: '내 설정',
          synchro: battle.synchroLevel,
          console: battle.console,
          // 가져온 로스터(CSV·블라블라링크)가 내 스펙이다. 없으면 기본 스펙으로 돈다.
          roster: Object.fromEntries(Object.entries(roster)
            .filter(([name]) => catalogByName.has(name))),
          owned: Object.keys(roster).length,
        };
      },
    });
  }

  // ── 화면 전환 ───────────────────────────────────────────────────────────
  /** 위쪽 탭이 고를 수 있는 화면. 「외부고리」는 우리 것이 아닌 곳으로 나가는 판이다. */
  type ViewName = 'calc' | 'union' | 'enikk' | 'links';

  function switchView(view: ViewName) {
    currentView = view;
    for (const section of root.querySelectorAll<HTMLElement>('[data-view]')) {
      const mine = section.dataset.view === view;
      // 타임라인은 계산 결과가 있을 때만 보이므로 여기서 켜지 않는다.
      if (section === timelinePanel) { section.hidden = !mine || !timelineHasContent; continue; }
      section.hidden = !mine;
    }
    for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-view-tab]')) {
      const on = tab.dataset.viewTab === view;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-pressed', String(on));
    }
    if (view === 'enikk' && !enikkData) {
      const cached = readEnikkCache();
      if (cached) {
        renderEnikk(cached);
        setEnikkStatus('저장해 둔 결과입니다. 새로 받으려면 «다시 받기»를 누르세요.');
        enikkLoad.hidden = true;
        enikkRefresh.hidden = false;
      }
    }
  }
  for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-view-tab]')) {
    tab.addEventListener('click', () => switchView(tab.dataset.viewTab as ViewName));
  }

  // ── 외부고리 ────────────────────────────────────────────────────────────
  // 표(`external-links.ts`)를 그대로 편다. 주소를 HTML에 박지 않는 이유는 고칠 곳을
  // 한 군데로 두기 위해서다 — 새 고리는 그 배열에 한 줄만 더하면 여기 나온다.
  const linksGrid = element<HTMLElement>(root, '[data-links-grid]');
  for (const link of EXTERNAL_LINKS) {
    const card = document.createElement('a');
    card.className = 'link-card';
    card.href = link.url;
    card.target = '_blank';
    // 남의 페이지에 우리 창을 넘기지 않는다.
    card.rel = 'noopener noreferrer';

    const head = document.createElement('div');
    head.className = 'link-head';
    const name = document.createElement('h3');
    name.className = 'link-name';
    name.textContent = link.label;
    const host = document.createElement('span');
    host.className = 'link-host';
    host.textContent = hostOf(link.url);
    head.append(name, host);

    const note = document.createElement('p');
    note.className = 'link-note';
    note.textContent = link.note;

    const go = document.createElement('span');
    go.className = 'link-go';
    go.setAttribute('aria-hidden', 'true');
    go.textContent = '새 탭에서 열기 ↗';

    card.append(head, note, go);
    linksGrid.append(card);
  }

  // 렛츠도로 CSV 받는 법 안내. 스크린샷이 아직 없으면 이미지만 숨긴다 — 링크·설명은 남는다.
  const doroModal = element<HTMLElement>(root, '[data-doro-modal]');
  const doroShot = element<HTMLImageElement>(root, '.doro-shot');
  doroShot.addEventListener('error', () => { doroShot.hidden = true; });
  element<HTMLButtonElement>(root, '[data-doro-open]').addEventListener('click', () => {
    doroModal.hidden = false;
  });
  element<HTMLButtonElement>(root, '[data-doro-close]').addEventListener('click', () => {
    doroModal.hidden = true;
  });
  doroModal.addEventListener('click', (event) => {
    if (event.target === doroModal) doroModal.hidden = true;
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
        decks, fiveDeckMode, activeDeckId, carryOverSettings, battle: readBattle(),
        // 새로고침해도 「누가 이 버프를 받았나」가 남게 한다 — 다시 계산하기 전까지
        // 빈 괄호만 보이면 기능이 꺼진 것처럼 보인다.
        buffTargets: [...buffTargetsByDeck].map(([id, v]) => ({ id, ...v })),
      }));
    } catch {
      /* 저장 실패 무시 */
    }
  };
  const applySavedState = () => {
    if (!savedState) return;
    if (typeof savedState.carryOverSettings === 'boolean') {
      carryOverSettings = savedState.carryOverSettings;
      carryToggle.checked = carryOverSettings;
    }
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
    // 「누가 이 버프를 받았나」는 서명이 지금 편성·설정과 맞을 때만 되살린다.
    // 어긋나면 지난 계산의 값이라 그대로 믿을 수 없다.
    for (const saved of savedState.buffTargets ?? []) {
      const deck = decks.find((d) => d.id === saved.id);
      if (deck && saved.sig === deckSignature(deck)) {
        buffTargetsByDeck.set(saved.id, { sig: saved.sig, rows: saved.rows });
      }
    }

    const savedActive = savedState.activeDeckId;
    if (typeof savedActive === 'number' && savedActive >= 1 && savedActive <= 5) {
      activeDeckId = savedActive;
    }
    if (savedState.fiveDeckMode) {
      fiveDeckMode = true;
      element<HTMLInputElement>(root, '#squad-mode').checked = true;
      deckTabs.hidden = false;
      deckMoves.hidden = false;
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
  // 판은 창이 아니라 늘 펼쳐져 있으므로 처음부터 그려 둔다.
  const firstEmpty = activeDeck().squad.findIndex((member) => !member);
  activeSlot = firstEmpty < 0 ? 0 : firstEmpty;
  renderSquad();
  renderRosterGrid();

  // 공유 링크로 들어왔으면 저장 상태 위에 그 편성을 얹는다 — 순서가 반대면
  // applySavedState가 링크로 넣은 편성을 도로 덮어쓴다. 주소는 정리해 두어
  // 새로고침할 때마다 다시 덮어쓰지 않게 한다.
  if (location.hash.startsWith('#deck=')) {
    const linked = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
    applyShareText(linked, 'all');
    refreshShareFields();
    renderPresets();
    shareIn.value = linked;
    shareModal.hidden = false;
  }

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

  // 기본 정렬이 전투력이라 목록을 열기 전에 미리 받아 둔다. 오는 동안은 이름순으로
  // 서 있고, 도착하면 그 자리에서 다시 세운다.
  void loadCombatPower();

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
    let failedIndex = -1;
    try {
      await prepared;
      // 덱 하나하나는 서로 독립이라 나눠 돌려도 결과가 같다. 도착 순서만 뒤섞이므로
      // 화면에 세울 때 **덱 번호 순으로 다시 정렬**한다 — 좌→우가 곧 1→5덱이어야 한다.
      let done = 0;
      const runOne = async (index: number) => {
        const { deck, request } = requests[index]!;
        const key = cacheKey(request, version);
        let result = cache.get(key);
        if (result) {
          cachedCount += 1;
        } else {
          result = await client.simulate(request);
          cache.set(key, result);
        }
        done += 1;
        status.textContent = `계산 중 · ${done}/${requests.length}덱`;
        completed.push({ deckId: deck.id, request, result });
        completed.sort((a, b) => a.deckId - b.deckId);
        renderBatchResult(aggregateDeckResults(completed));
      };
      // 병렬을 꺼 뒀으면 한 판씩. 켜져 있으면 풀이 알아서 워커에 나눠 준다.
      const guarded = async (index: number) => {
        try {
          await runOne(index);
        } catch (error) {
          // 어느 덱이 깨졌는지 아래 catch가 알아야 한다 — 병렬에서는 «몇 개 끝났나»로
          // 짚을 수 없다(끝난 순서와 덱 번호가 다르다).
          if (failedIndex < 0) failedIndex = index;
          throw error;
        }
      };
      if (parallelOn && requests.length > 1) {
        const settled = await Promise.allSettled(requests.map((_, index) => guarded(index)));
        const broke = settled.find((outcome) => outcome.status === 'rejected');
        if (broke && broke.status === 'rejected') throw broke.reason;
      } else {
        for (let index = 0; index < requests.length; index += 1) await guarded(index);
      }
      activity = cachedCount === requests.length ? 'cached' : 'complete';
      status.textContent = cachedCount === requests.length
        ? '저장된 결과를 불러왔습니다.'
        : `${requests.length}개 덱 계산 완료 · 같은 조건은 이 기기에 저장됩니다.`;
    } catch (error) {
      if (completed.length > 0) renderBatchResult(aggregateDeckResults(completed));
      const failedEntry = requests[failedIndex >= 0 ? failedIndex : completed.length];
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
