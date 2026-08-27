/**
 * 유니온 레이드 (BETA) — 유니온원 각자의 실제 스펙으로 같은 보스·같은 덱을 돌려
 * «누가 얼마나 기여할 수 있나»를 견준다.
 *
 * 데이터가 오는 길이 둘로 갈린다. 그 이유를 여기 적어 둔다:
 *
 *   명단(닉네임·openid·싱크로) → **본인 브라우저에서만** 온다.
 *       `Game/GetGuildMembers`는 호출자가 게임 계정에 묶인 로그인이어야 한다.
 *       우리 프록시 계정은 게임 롤이 없어 `user no bind role`로 거부된다(실측
 *       2026-08-27). 그래서 붙여넣기로 받는다 — 쿠키를 우리가 만지지 않는 길이다.
 *
 *   유니온원 스펙(니케·장비·오버로드·콘솔) → 기존 프록시로 온다.
 *       공개 계정은 그대로 오고, 비공개는 `1301002`로 막힌다. 그 갈림이 곧 «공개여부»다.
 *
 * 보스와 덱은 **공유 코드**로 채운다(전투 조건 `NK3-`, 조합 `NK2-`). 이미 있는 문법을
 * 그대로 쓰면 유니온원끼리 세팅을 주고받기도 쉽고, 이 탭이 편집기를 새로 만들지 않아도 된다.
 */

import { decodeBattleCode, decodeShareCode } from './share-code';
import { DEFAULT_SYNCHRO_LEVEL } from './model';
import type { BattleSettings, DeckState, SimulationResult } from './types';

/** 유니온원 한 명. `GetGuildMembers`가 주는 것만 담는다. */
export interface UnionMember {
  name: string;
  /** `member_id` — 프로필 조회에 쓰는 intl_open_id다. */
  openid: string;
  /** 싱크로 디바이스 레벨. 계산에 그대로 반영한다(400 고정이 아니다). */
  synchro: number;
  /** 계정 레벨. 화면 참고용이다. */
  level: number;
  /** `bind_area_id` — 서버. 스펙 조회에 넣어야 5개 서버를 다 뒤지지 않는다. */
  area: number;
}

/** 공개여부 스캔 결과. */
export type MemberState = 'unknown' | 'scanning' | 'public' | 'private' | 'error';

export interface MemberRow extends UnionMember {
  state: MemberState;
  /** 공개일 때 계산기가 다루는 니케 수. */
  owned?: number;
  /** 비공개·오류일 때 사람에게 보여 줄 한 줄. */
  note?: string;
  /** 계산에 넣을지. 공개인 사람만 켤 수 있다. */
  picked: boolean;
}

/** 보스 한 칸. 체크를 끄면 그 보스는 통째로 건너뛴다. */
export interface BossSlot {
  name: string;
  code: string;
  enabled: boolean;
  battle?: BattleSettings;
  /** 코드가 잘못됐을 때의 사유. */
  error?: string;
  decks: DeckSlot[];
}

/** 덱 한 칸. 니케 이름 다섯만 쓴다 — 수치는 유니온원 각자의 것을 쓴다. */
export interface DeckSlot {
  code: string;
  squad?: string[];
  error?: string;
}

export const BOSS_SLOTS = 5;
export const DECK_SLOTS = 3;

/**
 * 명단을 뜨는 한 줄. 유니온 스퀘어에 **로그인한 채로** 콘솔에 붙여넣으면
 * 명단 JSON이 클립보드에 담긴다. 여기서 하는 일은 그 페이지가 이미 하는 호출 하나뿐이고,
 * 쿠키는 브라우저가 알아서 싣는다 — 우리가 받아 보관하는 값이 아니다.
 */
export const MEMBER_SNIPPET = `await (async () => {
  const guild = await fetch('https://api.blablalink.com/api/game/proxy/Game/GetMyGuildInfo', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Channel-Type': '2', 'X-Language': 'ko',
      'X-Common-Params': JSON.stringify({ game_id: '29080', area_id: 'global', source: 'pc_web', intl_game_id: '29080', language: 'ko', env: 'prod' }) },
    body: '{}',
  }).then((r) => r.json());
  const info = guild.data?.guild_info ?? guild.data ?? {};
  const members = await fetch('https://api.blablalink.com/api/game/proxy/Game/GetGuildMembers', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Channel-Type': '2', 'X-Language': 'ko',
      'X-Common-Params': JSON.stringify({ game_id: '29080', area_id: 'global', source: 'pc_web', intl_game_id: '29080', language: 'ko', env: 'prod' }) },
    body: JSON.stringify({ guild_id: String(info.guild_id ?? ''), nikke_area_id: String(info.nikke_area_id ?? '') }),
  }).then((r) => r.json());
  await navigator.clipboard.writeText(JSON.stringify(members));
  console.log('유니온원', (members.data?.items ?? []).length + '명을 클립보드에 담았습니다. 계산기에 붙여넣으세요.');
})();`;

const num = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * 붙여넣은 것을 명단으로 읽는다. 받아들이는 모양 셋:
 *   `{data:{items:[...]}}`  — API 응답 그대로 (스니펫이 주는 것)
 *   `{items:[...]}` / `[...]` — 안쪽만 떼어 온 경우
 *   탭·쉼표로 나눈 표 — 손으로 정리해 온 경우 (이름, openid, 싱크로)
 * 사람이 옮겨 붙이다 어디까지 집었는지 알 수 없으니, 셋 다 받아 준다.
 */
export function parseMemberList(text: string): UnionMember[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('붙여넣은 내용이 비어 있습니다.');

  let items: unknown[] | null = null;
  try {
    const raw = JSON.parse(trimmed) as unknown;
    if (Array.isArray(raw)) items = raw;
    else if (raw && typeof raw === 'object') {
      const box = raw as Record<string, any>;
      if (box.code !== undefined && box.code !== 0 && !box.data) {
        throw new Error(`블라블라링크가 «${box.msg ?? box.code}»를 돌려줬습니다. 로그인한 채로 다시 떠 주세요.`);
      }
      const found = box.data?.items ?? box.items ?? box.data?.members ?? box.members;
      if (Array.isArray(found)) items = found;
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('블라블라링크')) throw error;
    items = null;                                  // JSON이 아니면 표로 읽어 본다
  }

  if (items) {
    const rows = items
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        name: String(item.nickname ?? item.name ?? '').trim(),
        openid: String(item.member_id ?? item.intl_open_id ?? item.openid ?? '').trim(),
        synchro: num(item.synchro_level ?? item.synchro, 0),
        level: num(item.level, 0),
        area: num(item.bind_area_id ?? item.nikke_area_id ?? item.area, 0),
      }))
      .filter((row) => row.name && /^\d+$/.test(row.openid));
    if (rows.length === 0) throw new Error('명단에서 유니온원을 찾지 못했습니다. 스니펫이 알려 준 내용을 그대로 붙여넣어 주세요.');
    return dedupe(rows);
  }

  const rows: UnionMember[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const cells = line.split(/\t|,/).map((cell) => cell.trim());
    const openid = cells.find((cell) => /^\d{6,}$/.test(cell));
    const name = cells.find((cell) => cell && cell !== openid);
    if (!openid || !name) continue;
    const numbers = cells.filter((cell) => cell !== openid && /^\d+$/.test(cell)).map(Number);
    rows.push({ name, openid, synchro: numbers[0] ?? 0, level: numbers[1] ?? 0, area: numbers[2] ?? 0 });
  }
  if (rows.length === 0) {
    throw new Error('명단을 알아보지 못했습니다. 아래 스니펫을 유니온 스퀘어에서 실행한 결과를 붙여넣어 주세요.');
  }
  return dedupe(rows);
}

const dedupe = (rows: UnionMember[]): UnionMember[] => {
  const seen = new Set<string>();
  return rows.filter((row) => (seen.has(row.openid) ? false : (seen.add(row.openid), true)));
};

/**
 * 공개여부 스캔에 걸리는 시간(초). 실측(2026-08-27, 3명 동시)에서
 * 비공개는 0.7초, 공개는 니케 200종 상세까지 받느라 4~6초였다.
 * 몇 명이 공개인지는 해 봐야 아는 값이라, 절반이 공개라고 보고 어림한다.
 */
export function estimateScanSeconds(count: number, concurrency = 2): number {
  if (count <= 0) return 0;
  const perMember = (0.7 + 5.0) / 2 + 0.7;      // 조회 + 간격 벌리기
  return Math.max(1, Math.round((count * perMember) / concurrency));
}

/** 「1분 20초」처럼 읽히게. 초 단위는 1분 아래에서만 적는다. */
export function humanSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}초`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes}분` : `${minutes}분 ${rest}초`;
}

/** 보스 칸 하나를 코드에서 읽는다. 빈 칸은 조용히 비운다 — 아직 안 채운 것뿐이다. */
export function readBossCode(slot: BossSlot, synchro = DEFAULT_SYNCHRO_LEVEL): BossSlot {
  const code = slot.code.trim();
  if (!code) return { ...slot, battle: undefined, error: undefined };
  try {
    const share = decodeBattleCode(code);
    // 싱크로와 콘솔은 코드에 담기지 않는다(계정 육성 상태다). 유니온원마다 자기 것으로 덮으므로
    // 여기서는 자리만 채워 둔다.
    return {
      ...slot,
      battle: { ...share, synchroLevel: synchro, console: emptyConsole() },
      error: undefined,
    };
  } catch (error) {
    return { ...slot, battle: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 덱 칸 하나를 조합 코드에서 읽는다. 첫 덱만 쓴다 — 이 칸이 곧 덱 하나다. */
export function readDeckCode(slot: DeckSlot, catalogNames: string[]): DeckSlot {
  const code = slot.code.trim();
  if (!code) return { ...slot, squad: undefined, error: undefined };
  try {
    const payload = decodeShareCode(code, catalogNames);
    const squad = (payload.decks[0]?.squad ?? []).map((name) => name.trim());
    const filled = squad.filter(Boolean);
    if (filled.length === 0) return { ...slot, squad: undefined, error: '코드에 니케가 없습니다.' };
    return { ...slot, squad, error: undefined };
  } catch (error) {
    return { ...slot, squad: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 시뮬레이션 한 칸. 유니온원 × 보스 × 덱. */
export interface Job {
  member: MemberRow;
  bossIndex: number;
  bossName: string;
  deckIndex: number;
  squad: string[];
  battle: BattleSettings;
}

/**
 * 돌릴 것을 늘어놓는다. 순서는 **유니온원 → 보스 → 덱**이다 — 결과가 사람 단위로
 * 완성돼 가는 편이, 보스별로 흩어져 채워지는 것보다 기다리는 동안 읽을 것이 된다.
 */
export function buildJobs(members: MemberRow[], bosses: BossSlot[]): Job[] {
  const jobs: Job[] = [];
  for (const member of members) {
    if (!member.picked || member.state !== 'public') continue;
    bosses.forEach((boss, bossIndex) => {
      if (!boss.enabled || !boss.battle) return;
      boss.decks.forEach((deck, deckIndex) => {
        if (!deck.squad) return;
        jobs.push({
          member,
          bossIndex,
          bossName: boss.name.trim() || `보스 ${bossIndex + 1}`,
          deckIndex,
          squad: deck.squad,
          battle: boss.battle!,
        });
      });
    });
  }
  return jobs;
}

/** 한 칸의 결과. 못 돌린 이유도 결과의 하나로 남긴다 — 빈칸은 «왜»를 못 말한다. */
export interface JobResult {
  job: Job;
  damage?: number;
  /** 못 돌렸을 때: 미보유 니케 이름들, 또는 오류 한 줄. */
  missing?: string[];
  error?: string;
}

/**
 * 유니온원의 로스터로 덱을 짠다. 안 가진 니케가 하나라도 있으면 **돌리지 않는다** —
 * 없는 니케를 기본 스펙으로 채워 넣으면 «이 사람이 낼 수 있는 딜»이 아니게 된다.
 */
export function deckForMember(
  squad: string[],
  roster: Record<string, DeckState['characters'][string]>,
): { deck: DeckState; missing: string[] } {
  const missing: string[] = [];
  const characters: DeckState['characters'] = {};
  for (const name of squad) {
    if (!name) continue;
    const found = roster[name];
    if (!found) { missing.push(name); continue; }
    characters[name] = found;
  }
  return { deck: { id: 1, squad: [...squad], characters }, missing };
}

/** 결과를 화면 뼈대대로 «유니온원 → 보스 → 덱»으로 접는다. */
export interface MemberReport {
  member: MemberRow;
  bosses: Array<{ name: string; rows: JobResult[] }>;
}

export function groupResults(results: JobResult[]): MemberReport[] {
  const byMember = new Map<string, MemberReport>();
  for (const result of results) {
    const key = result.job.member.openid;
    let report = byMember.get(key);
    if (!report) {
      report = { member: result.job.member, bosses: [] };
      byMember.set(key, report);
    }
    let boss = report.bosses.find((entry) => entry.name === result.job.bossName);
    if (!boss) {
      boss = { name: result.job.bossName, rows: [] };
      report.bosses.push(boss);
    }
    boss.rows.push(result);
  }
  for (const report of byMember.values()) {
    for (const boss of report.bosses) boss.rows.sort((a, b) => a.job.deckIndex - b.job.deckIndex);
    report.bosses.sort((a, b) => {
      const ai = a.rows[0]?.job.bossIndex ?? 0;
      const bi = b.rows[0]?.job.bossIndex ?? 0;
      return ai - bi;
    });
  }
  return [...byMember.values()];
}

/** 시뮬 한 판이 얼마나 걸리는지는 기기마다 달라 **재 보고** 알린다. */
export function remainingSeconds(done: number, total: number, elapsedMs: number): number {
  if (done <= 0) return 0;
  return ((elapsedMs / done) * (total - done)) / 1000;
}

export type Simulate = (squad: string[], characters: DeckState['characters'],
  battle: BattleSettings) => Promise<SimulationResult>;

// ── 화면 ────────────────────────────────────────────────────────────────────

import { areaToOverrides, consoleFrom, emptyConsole, pickArea } from './blablalink';
import type { RawProfile } from './blablalink';
import { requestForDeck } from './model';
import { squadPreview } from './share-panel';
import type { CharacterMeta, CharacterOverrides, SettingsCatalog } from './types';

export interface UnionHosts {
  panel: HTMLElement;
}

export interface UnionDeps {
  /** 블라블라링크 조회 프록시. 비어 있으면 이 탭 자체를 띄우지 않는다. */
  proxy: string;
  settings: SettingsCatalog;
  catalog: CharacterMeta[];
  simulate: (request: ReturnType<typeof requestForDeck>) => Promise<SimulationResult>;
  imageOf: (name: string) => string | undefined;
  /** 지금 계산기에 잡아 둔 전투 조건을 코드로. 「가져오기」 단추가 쓴다. */
  currentBattleCode: () => string;
  /** 지금 계산기 덱 하나를 코드로. 인자는 0부터. */
  currentDeckCode: (index: number) => string;
  /** 계산기가 아는 니케 이름 전부 — 조합 코드 해석에 쓴다. */
  catalogNames: () => string[];
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const pick = <T extends HTMLElement>(root: HTMLElement, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`유니온 탭에 ${selector}가 없습니다.`);
  return found;
};

const DAMAGE = new Intl.NumberFormat('ko-KR');

/** 엔진 오류는 파이썬 트레이스백째로 온다 — 줄마다 쏟지 않고 마지막 한 줄만 적는다. */
export function lastLine(message: string): string {
  const lines = message.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? message;
}

/** 조회 시작 사이의 최소 간격(ms). 상류가 «너무 잦다»고 되던지는 선을 피한다. */
const REQUEST_GAP_MS = 700;
/** 실패했을 때 물러서는 간격. 세 번까지 더 해 보고 포기한다. */
const BACKOFF_MS = [1500, 4000, 9000];

/** 유니온 탭 전체를 배선한다. 상태는 이 안에만 산다 — 탭을 떠나도 남는다. */
export function mountUnionRaid(hosts: UnionHosts, deps: UnionDeps): void {
  const { panel } = hosts;
  let members: MemberRow[] = [];
  let rosters = new Map<string, Record<string, CharacterOverrides>>();
  let consoles = new Map<string, BattleSettings['console']>();
  let bosses: BossSlot[] = Array.from({ length: BOSS_SLOTS }, () => ({
    name: '', code: '', enabled: true,
    decks: Array.from({ length: DECK_SLOTS }, () => ({ code: '' } as DeckSlot)),
  }));
  let results: JobResult[] = [];
  let running = false;
  let cancelled = false;

  const steps = new Map<string, HTMLElement>();
  for (const step of panel.querySelectorAll<HTMLElement>('[data-union-step]')) {
    steps.set(step.dataset.unionStep!, step);
  }
  const showStep = (id: string, on: boolean) => {
    const step = steps.get(id);
    if (step) step.hidden = !on;
  };

  // ── 1단계 · 명단 ─────────────────────────────────────────────────────────
  const snippetBox = pick<HTMLTextAreaElement>(panel, '[data-union-snippet]');
  const copyButton = pick<HTMLButtonElement>(panel, '[data-union-copy]');
  const pasteBox = pick<HTMLTextAreaElement>(panel, '[data-union-paste]');
  const readButton = pick<HTMLButtonElement>(panel, '[data-union-read]');
  const listStatus = pick(panel, '[data-union-list-status]');
  snippetBox.value = MEMBER_SNIPPET;

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(MEMBER_SNIPPET);
      listStatus.textContent = '복사했습니다. 블라블라링크 유니온 스퀘어에서 콘솔(F12)에 붙여넣으세요.';
    } catch {
      snippetBox.select();
      listStatus.textContent = '복사가 막혀 있습니다 — 위 상자의 내용을 직접 복사하세요.';
    }
  });

  readButton.addEventListener('click', () => {
    try {
      const parsed = parseMemberList(pasteBox.value);
      members = parsed.map((row) => ({ ...row, state: 'unknown', picked: false }));
      results = [];
      renderMembers();
      renderReport();
      showStep('2', true);
      listStatus.textContent = `유니온원 ${members.length}명을 읽었습니다. `
        + `공개여부 확인에 ${humanSeconds(estimateScanSeconds(members.length))}쯤 걸립니다.`;
    } catch (error) {
      listStatus.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  // ── 2단계 · 공개여부 ─────────────────────────────────────────────────────
  const scanButton = pick<HTMLButtonElement>(panel, '[data-union-scan]');
  const scanStop = pick<HTMLButtonElement>(panel, '[data-union-scan-stop]');
  const scanStatus = pick(panel, '[data-union-scan-status]');
  const scanBar = pick(panel, '[data-union-scan-progress]');
  const memberBox = pick(panel, '[data-union-members]');
  const ask = pick(panel, '[data-union-ask]');
  const askText = pick(panel, '[data-union-ask-text]');

  const setBar = (bar: HTMLElement, done: number, total: number) => {
    bar.hidden = total === 0;
    const fill = bar.firstElementChild as HTMLElement | null;
    if (fill) fill.style.width = `${total === 0 ? 0 : Math.round((done / total) * 100)}%`;
  };

  function renderMembers(): void {
    memberBox.replaceChildren();
    if (members.length === 0) return;
    const table = el('div', 'union-table');
    for (const row of members) {
      const line = el('label', 'union-row');
      line.dataset.unionMember = row.openid;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = row.picked;
      box.disabled = row.state !== 'public';
      box.addEventListener('change', () => {
        row.picked = box.checked;
        refreshRunGate();
      });
      const state = el('span', `union-state is-${row.state}`, {
        unknown: '미확인', scanning: '확인 중', public: '공개', private: '비공개', error: '오류',
      }[row.state]);
      line.append(box, el('span', 'union-name', row.name),
        el('span', 'union-sync', row.synchro > 0 ? `싱크로 ${row.synchro}` : '싱크로 ?'),
        state,
        el('span', 'union-note', [row.owned !== undefined ? `니케 ${row.owned}종` : '', row.note ?? '']
          .filter(Boolean).join(' · ')));
      table.append(line);
    }
    memberBox.append(table);

    const open = members.filter((row) => row.state === 'public');
    const done = members.filter((row) => row.state !== 'unknown' && row.state !== 'scanning');
    ask.hidden = done.length !== members.length || members.length === 0;
    if (!ask.hidden) {
      askText.textContent = open.length > 0
        ? `공개된 유니온원 ${open.length}명 대상으로 테스트를 해보시겠습니까?`
        : '공개된 유니온원이 없습니다. 「나의 니케」를 공개로 바꾼 뒤 다시 스캔해 주세요.';
    }
    refreshRunGate();
  }

  // 호출 간격을 벌리는 문지기. 한 사람을 여는 데 상류 호출이 예닐곱 번 나가서,
  // 그냥 몰아치면 «212000 request too frequently»가 돌아온다(실측 2026-08-27).
  let nextStart = 0;
  const spaced = async (): Promise<void> => {
    const now = Date.now();
    const wait = Math.max(0, nextStart - now);
    nextStart = Math.max(now, nextStart) + REQUEST_GAP_MS;
    if (wait > 0) await new Promise((done) => { setTimeout(done, wait); });
  };

  /**
   * 한 명을 조회한다. 상류가 흔들리거나 «너무 잦다»고 하면 **간격을 벌려 다시** 부른다 —
   * 여럿을 훑는 동안 잠깐 튄 것을 «비공개»로 굳혀 버리면, 실제로 공개한 사람이
   * 계산에서 빠진다. 비공개는 상류가 그렇게 말한 것이므로 다시 부르지 않는다.
   */
  const scanOne = async (row: MemberRow, attempt = 0): Promise<void> => {
    await spaced();
    row.state = 'scanning';
    try {
      const response = await fetch(`${deps.proxy}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileUrl: row.openid,
          ...(row.area > 0 ? { area: row.area } : {}),
        }),
      });
      const payload = await response.json() as RawProfile & { error?: string; reason?: string };
      if (!response.ok) {
        if (payload.reason !== 'private' && attempt < BACKOFF_MS.length) {
          await new Promise((done) => { setTimeout(done, BACKOFF_MS[attempt]); });
          return scanOne(row, attempt + 1);
        }
        row.state = payload.reason === 'private' ? 'private' : 'error';
        row.note = payload.reason === 'private' ? '니케 목록 비공개' : (payload.error ?? `조회 실패 (${response.status})`);
        return;
      }
      const area = pickArea(payload, row.area > 0 ? row.area : undefined);
      if (!area) { row.state = 'private'; row.note = '니케 목록이 비어 있습니다'; return; }
      const { overrides, matched } = areaToOverrides(area, deps.settings, deps.catalog);
      if (matched.length === 0) { row.state = 'private'; row.note = '계산기가 아는 니케가 없습니다'; return; }
      rosters.set(row.openid, overrides);
      const levels = consoleFrom(area);
      if (levels) consoles.set(row.openid, levels);
      row.state = 'public';
      row.owned = matched.length;
      // 전초기지가 비공개면 콘솔을 모른다. 0으로 치고 계산하되, 그 사실을 줄에 적는다 —
      // 딜이 낮게 나온 이유가 스펙이 아니라 «못 본 값»일 수 있어서다.
      row.note = levels ? undefined : '콘솔 비공개 · 0으로 계산';
      row.picked = true;
    } catch (error) {
      if (attempt < BACKOFF_MS.length) {
        await new Promise((done) => { setTimeout(done, BACKOFF_MS[attempt]); });
        return scanOne(row, attempt + 1);
      }
      row.state = 'error';
      row.note = error instanceof Error ? error.message : String(error);
    }
  };

  const runScan = async () => {
    if (running || members.length === 0) return;
    running = true;
    cancelled = false;
    scanButton.disabled = true;
    scanStop.hidden = false;
    const total = members.length;
    let done = 0;
    const started = Date.now();
    const queue = [...members];
    const worker = async () => {
      while (queue.length > 0 && !cancelled) {
        const row = queue.shift()!;
        await scanOne(row);
        done += 1;
        setBar(scanBar, done, total);
        scanStatus.textContent = `${done}/${total} · 남은 시간 약 `
          + humanSeconds(remainingSeconds(done, total, Date.now() - started));
        renderMembers();
      }
    };
    // 둘씩만 동시에 부른다. 셋으로 돌렸더니 공개한 사람이 실패로 튀어 «비공개»로
    // 잘못 잡히는 일이 실제로 났다(2026-08-27). 조금 느려도 맞는 답이 낫다.
    await Promise.all([worker(), worker()]);
    running = false;
    scanButton.disabled = false;
    scanStop.hidden = true;
    const open = members.filter((row) => row.state === 'public').length;
    scanStatus.textContent = cancelled
      ? `중단했습니다 (${done}/${total} 확인).`
      : `${total}명 확인 · 공개 ${open}명 · ${humanSeconds((Date.now() - started) / 1000)} 걸렸습니다.`;
    renderMembers();
    if (open > 0) showStep('3', true);
  };

  scanButton.addEventListener('click', () => { void runScan(); });
  scanStop.addEventListener('click', () => { cancelled = true; });
  pick<HTMLButtonElement>(panel, '[data-union-pick-all]').addEventListener('click', () => {
    for (const row of members) row.picked = row.state === 'public';
    renderMembers();
  });
  pick<HTMLButtonElement>(panel, '[data-union-pick-none]').addEventListener('click', () => {
    for (const row of members) row.picked = false;
    renderMembers();
  });

  // ── 3단계 · 보스와 덱 ────────────────────────────────────────────────────
  const bossBox = pick(panel, '[data-union-bosses]');

  function renderBosses(): void {
    bossBox.replaceChildren();
    bosses.forEach((boss, index) => {
      const card = el('div', 'union-boss');
      if (!boss.enabled) card.classList.add('is-off');

      const head = el('div', 'union-boss-head');
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = boss.enabled;
      toggle.title = '끄면 이 보스는 계산하지 않습니다';
      toggle.addEventListener('change', () => {
        boss.enabled = toggle.checked;
        renderBosses();
      });
      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'union-boss-name';
      name.placeholder = `보스 ${index + 1} 이름`;
      name.value = boss.name;
      name.addEventListener('input', () => { boss.name = name.value; refreshRunGate(); });
      head.append(toggle, name, el('span', 'union-boss-summary', battleSummary(boss)));
      card.append(head);

      const codeRow = el('div', 'union-code-row');
      const code = document.createElement('input');
      code.type = 'text';
      code.className = 'union-code';
      code.placeholder = '전투 조건 코드 (NK3-…)';
      code.value = boss.code;
      code.addEventListener('input', () => {
        bosses[index] = { ...readBossCode({ ...boss, code: code.value }), decks: boss.decks };
        boss = bosses[index]!;
        renderBosses();
      });
      const grab = el('button', 'roster-import', '지금 조건 가져오기');
      (grab as HTMLButtonElement).type = 'button';
      grab.addEventListener('click', () => {
        bosses[index] = { ...readBossCode({ ...boss, code: deps.currentBattleCode() }), decks: boss.decks };
        renderBosses();
      });
      codeRow.append(code, grab);
      card.append(codeRow);
      if (boss.error) card.append(el('p', 'union-error', boss.error));

      const deckBox = el('div', 'union-decks');
      boss.decks.forEach((deck, deckIndex) => {
        const row = el('div', 'union-deck');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'union-code';
        input.placeholder = `덱 ${deckIndex + 1} 조합 코드 (NK2-…)`;
        input.value = deck.code;
        input.addEventListener('input', () => {
          boss.decks[deckIndex] = readDeckCode({ code: input.value }, deps.catalogNames());
          renderBosses();
        });
        const take = el('button', 'roster-import', `${deckIndex + 1}덱 가져오기`);
        (take as HTMLButtonElement).type = 'button';
        take.title = '지금 계산기에 짜 둔 이 번호의 덱을 그대로 가져옵니다';
        take.addEventListener('click', () => {
          boss.decks[deckIndex] = readDeckCode({ code: deps.currentDeckCode(deckIndex) }, deps.catalogNames());
          renderBosses();
        });
        row.append(input, take);
        if (deck.squad) row.append(squadPreview([deck.squad.filter(Boolean)], deps.imageOf));
        if (deck.error) row.append(el('p', 'union-error', deck.error));
        deckBox.append(row);
      });
      card.append(deckBox);
      bossBox.append(card);
    });
    refreshRunGate();
  }

  const battleSummary = (boss: BossSlot): string => {
    if (!boss.battle) return '조건 없음';
    const parts = [`${boss.battle.duration}초`, boss.battle.enemyCode || '무속성',
      `방어 ${DAMAGE.format(boss.battle.enemyDef)}`];
    const decks = boss.decks.filter((deck) => deck.squad).length;
    parts.push(decks > 0 ? `덱 ${decks}개` : '덱 없음');
    return parts.join(' · ');
  };

  // ── 4단계 · 실행 ─────────────────────────────────────────────────────────
  const runButton = pick<HTMLButtonElement>(panel, '[data-union-run]');
  const runStop = pick<HTMLButtonElement>(panel, '[data-union-stop]');
  const runStatus = pick(panel, '[data-union-run-status]');
  const runBar = pick(panel, '[data-union-run-progress]');
  const reportBox = pick(panel, '[data-union-report]');

  function refreshRunGate(): void {
    const jobs = buildJobs(members, bosses);
    const ready = jobs.length > 0 && !running;
    runButton.disabled = !ready;
    showStep('4', jobs.length > 0 || results.length > 0);
    if (!running) {
      runStatus.textContent = jobs.length === 0
        ? '고른 유니온원과 보스·덱이 있어야 돌립니다.'
        : `${jobs.length}판을 돌립니다 — 유니온원 ${new Set(jobs.map((job) => job.member.openid)).size}명 × 보스·덱.`;
    }
  }

  const runAll = async () => {
    const jobs = buildJobs(members, bosses);
    if (jobs.length === 0 || running) return;
    running = true;
    cancelled = false;
    runButton.disabled = true;
    runStop.hidden = false;
    results = [];
    renderReport();
    const started = Date.now();
    for (let index = 0; index < jobs.length; index += 1) {
      if (cancelled) break;
      const job = jobs[index]!;
      const roster = rosters.get(job.member.openid) ?? {};
      const { deck, missing } = deckForMember(job.squad, roster);
      if (missing.length > 0) {
        results.push({ job, missing });
      } else {
        try {
          const battle: BattleSettings = {
            ...job.battle,
            // 싱크로와 콘솔은 **그 사람 것**을 쓴다 — 400 고정이 아니다.
            synchroLevel: job.member.synchro > 0 ? job.member.synchro : job.battle.synchroLevel,
            console: consoles.get(job.member.openid) ?? job.battle.console,
          };
          const result = await deps.simulate(requestForDeck(deck, battle));
          results.push({ job, damage: result.squadTotal });
        } catch (error) {
          results.push({ job, error: lastLine(error instanceof Error ? error.message : String(error)) });
        }
      }
      setBar(runBar, index + 1, jobs.length);
      runStatus.textContent = `${index + 1}/${jobs.length} · ${job.member.name} · ${job.bossName} `
        + `· 남은 시간 약 ${humanSeconds(remainingSeconds(index + 1, jobs.length, Date.now() - started))}`;
      renderReport();
    }
    running = false;
    runStop.hidden = true;
    runButton.disabled = false;
    // 문지기가 «몇 판을 돌립니다»로 되돌리기 전에 부르고, 마무리 문구를 마지막에 적는다.
    refreshRunGate();
    runStatus.textContent = cancelled
      ? `중단했습니다 (${results.length}/${jobs.length}판).`
      : `${jobs.length}판을 ${humanSeconds((Date.now() - started) / 1000)} 만에 마쳤습니다.`;
  };

  runButton.addEventListener('click', () => { void runAll(); });
  runStop.addEventListener('click', () => { cancelled = true; });

  function renderReport(): void {
    reportBox.replaceChildren();
    for (const report of groupResults(results)) {
      const card = el('div', 'union-report-card');
      const head = el('div', 'union-report-head');
      head.append(el('b', 'union-report-name', report.member.name),
        el('span', 'union-report-sync', `싱크로 ${report.member.synchro}`));
      card.append(head);
      for (const boss of report.bosses) {
        card.append(el('h4', 'union-report-boss', boss.name));
        for (const row of boss.rows) {
          const line = el('div', 'union-report-row');
          line.append(squadPreview([row.job.squad.filter(Boolean)], deps.imageOf));
          if (row.damage !== undefined) {
            line.append(el('b', 'union-report-damage', DAMAGE.format(Math.round(row.damage))));
          } else if (row.missing) {
            line.append(el('span', 'union-report-skip', `미보유 · ${row.missing.join(', ')}`));
          } else {
            line.append(el('span', 'union-report-skip', row.error ?? '계산 실패'));
          }
          card.append(line);
        }
      }
      reportBox.append(card);
    }
  }

  renderBosses();
  renderMembers();
}
