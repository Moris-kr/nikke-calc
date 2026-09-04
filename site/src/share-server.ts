import type { BattleShare } from './share-code';
import { t } from './i18n';

// 설정 공유 서버(`worker-share/`)와 이야기하는 쪽. 서버가 아는 것은 공유 코드 문자열과
// 사람이 붙인 이름뿐이고, 그 코드가 무슨 뜻인지 — 몇 초짜리 전투인지, 누가 편성됐는지 —
// 는 여기서만 안다. 목록에 함께 적히는 «설명»도 그래서 서버가 아니라 이쪽에서 만든다.

/** `maker`는 보스 메이커로 그린 보스(NK5-)다. `boss`는 전투 조건(NK3-)이다. */
export type ShareKind = 'boss' | 'squad' | 'union' | 'maker';
export type VoteValue = 1 | -1 | 0;

export interface ShareItem {
  id: string;
  name: string;
  /** 설정에서 자동으로 만든 한 줄 설명. 업로더가 손대지 못한다. */
  auto: string;
  /** 빈 문자열이면 익명. */
  by: string;
  at: string;
  up: number;
  down: number;
  /** 몇 명이 실제로 가져다 썼나. IP당 한 번만 오르고 취소가 없다. */
  uses: number;
  /** 적용에 쓰는 공유 코드. 목록과 함께 온다 — 받아서 바로 적용할 수 있다. */
  code: string;
}

export interface ShareListResult {
  items: ShareItem[];
  /** 이 브라우저(정확히는 이 IP)가 이미 누른 표. 항목 id → 1 · -1 */
  mine: Record<string, 1 | -1>;
  /** 이 IP가 이미 적용해 본 항목. 다시 적용해도 횟수가 오르지 않는다. */
  applied: Record<string, 1>;
}

export interface ShareUploadInput {
  kind: ShareKind;
  name: string;
  by: string;
  auto: string;
  code: string;
}

export interface ShareUploadResult {
  item: ShareItem;
  /** 같은 코드가 이미 있어 새로 만들지 않았다는 뜻. */
  existed: boolean;
}

export interface ShareApplyResult {
  id: string;
  uses: number;
  /** 이번 적용으로 실제로 숫자가 올랐는지. 이미 쓴 적 있으면 false다. */
  counted: boolean;
}

export interface ShareVoteResult {
  id: string;
  up: number;
  down: number;
  mine: VoteValue;
}

/** 서버가 돌려주는 약어 한 줄. `count`는 같은 답을 등록한 사람 수다. */
export interface AbbrevShare {
  key: string;
  names: string[];
  count: number;
}

/** 접수 → 진행중 → 완료 / 불가능. */
export type FeedbackStatus = 'new' | 'doing' | 'done' | 'wont';
export type FeedbackKind = 'bug' | 'idea' | 'etc';

export interface FeedbackItem {
  id: string;
  kind: FeedbackKind;
  text: string;
  /** 빈 문자열이면 익명. */
  by: string;
  at: string;
  status: FeedbackStatus;
  /** 관리자가 상태를 옮긴 시각. 한 번도 안 옮겼으면 빈 문자열. */
  movedAt: string;
  /** 운영자 코멘트. 없으면 빈 문자열 — 옛 서버는 이 값을 아예 안 준다. */
  reply?: string;
  /** 코멘트를 단 시각. 코멘트가 없으면 빈 문자열. */
  replyAt?: string;
}

export interface FeedbackInput {
  kind: FeedbackKind;
  text: string;
  by: string;
}

type Fetcher = typeof fetch;

/**
 * 아직 새 기능을 모르는 서버가 주는 말. 사이트는 먼저 나가고 Worker는 나중에 배포되므로,
 * 그 사이에 «없는 경로입니다»가 그대로 화면에 뜬다 — 무슨 뜻인지 알 수 없는 말이라 바꿔 준다.
 */
const NO_ROUTE = '없는 경로입니다.';
/** 서버가 아직 모르는 공유 종류. 사이트가 먼저 나가고 Worker는 나중에 배포된다. */
const NO_KIND = '알 수 없는 공유 종류입니다.';
const notReady = (what: string) => new Error(`${what} 서버가 아직 준비되지 않았습니다. 잠시 뒤에 다시 시도해 주세요.`);

/** 서버가 준 에러 문구를 그대로 살려 던진다 — 사용자에게 보여 줄 말이 거기 있다. */
async function unwrap<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    /* 본문이 JSON이 아니면 아래에서 일반 문구로 떨어진다 */
  }
  if (!response.ok) {
    const message = (body as { error?: string } | null)?.error;
    throw new Error(message ?? `서버가 응답하지 않았습니다 (${response.status}).`);
  }
  return body as T;
}

export class ShareServer {
  private readonly base: string;

  private readonly fetcher: Fetcher;

  constructor(base: string, fetcher?: Fetcher) {
    this.base = base.replace(/\/+$/, '');
    this.fetcher = fetcher ?? ((...args) => fetch(...args));
  }

  /**
   * `unwrap`에 «서버가 아직 이 종류를 모른다» 안내를 얹은 것.
   *
   * 종류를 새로 들이면 사이트가 먼저 나가고 Worker는 나중에 배포된다. 그 사이에
   * 서버가 주는 말은 «알 수 없는 공유 종류입니다»인데, 읽는 사람에게는 자기가 뭘
   * 잘못한 것처럼 들린다.
   */
  private async unwrapKind<T>(response: Response): Promise<T> {
    try {
      return await unwrap<T>(response);
    } catch (error) {
      if (error instanceof Error && (error.message === NO_KIND || error.message === NO_ROUTE)) {
        throw new Error('이 종류의 공유는 서버가 아직 준비되지 않았습니다. 코드로 주고받아 주세요.');
      }
      throw error;
    }
  }

  /** `unwrap`에 «아직 배포 전» 안내를 얹은 것. 새로 만든 경로에만 쓴다. */
  private async unwrapReady<T>(response: Response, what: string): Promise<T> {
    try {
      return await unwrap<T>(response);
    } catch (error) {
      if (error instanceof Error && error.message === NO_ROUTE) throw notReady(what);
      throw error;
    }
  }

  async list(kind: ShareKind): Promise<ShareListResult> {
    const response = await this.fetcher(`${this.base}/list?kind=${kind}`);
    const result = await this.unwrapKind<ShareListResult>(response);
    return {
      items: (result.items ?? []).map((item) => ({ ...item, uses: item.uses ?? 0 })),
      mine: result.mine ?? {},
      applied: result.applied ?? {},
    };
  }

  async upload(input: ShareUploadInput): Promise<ShareUploadResult> {
    const response = await this.fetcher(`${this.base}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return this.unwrapKind<ShareUploadResult>(response);
  }

  /** 「가져다 썼다」를 알린다. 세는 것은 서버이고, IP당 한 번만 오른다. */
  async apply(kind: ShareKind, id: string): Promise<ShareApplyResult> {
    const response = await this.fetcher(`${this.base}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, id }),
    });
    return unwrap<ShareApplyResult>(response);
  }

  /**
   * 모두가 모아 준 약어 사전. 약어는 비문학이라 규칙으로 풀 수 없고, 쓰는 사람들이
   * 등록해 주는 수밖에 없다 — 서버가 아는 것은 **친 글자와 니케 이름뿐**이다.
   */
  async abbrevRules(): Promise<AbbrevShare[]> {
    const response = await this.fetcher(`${this.base}/abbrev`);
    const result = await this.unwrapReady<{ rules?: AbbrevShare[] }>(response, '약어 사전');
    return (result.rules ?? []).filter((rule) => rule.key && rule.names?.length > 0);
  }

  /** 예외 하나를 등록한다. 같은 약어에 답이 갈리면 표가 많은 쪽이 사전이 된다. */
  async addAbbrev(key: string, names: string[]): Promise<void> {
    const response = await this.fetcher(`${this.base}/abbrev`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, names }),
    });
    await this.unwrapReady<unknown>(response, '약어 사전');
  }

  async feedbackList(): Promise<FeedbackItem[]> {
    const response = await this.fetcher(`${this.base}/feedback`);
    const result = await this.unwrapReady<{ items?: FeedbackItem[] }>(response, '피드백');
    return result.items ?? [];
  }

  async addFeedback(input: FeedbackInput): Promise<FeedbackItem> {
    const response = await this.fetcher(`${this.base}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const result = await this.unwrapReady<{ item: FeedbackItem }>(response, '피드백');
    return result.item;
  }

  /** 상태 옮기기·지우기는 관리자만 한다. 비밀번호는 서버가 쥐고 있다. */
  async moveFeedback(id: string, status: FeedbackStatus, password: string): Promise<FeedbackItem> {
    const response = await this.fetcher(`${this.base}/feedback/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, password }),
    });
    const result = await this.unwrapReady<{ item: FeedbackItem }>(response, '피드백');
    return result.item;
  }

  /** 운영자 코멘트. 빈 글을 주면 뗀다 — 한 글에 하나뿐이라 고치기도 같은 길이다. */
  async replyFeedback(id: string, reply: string, password: string): Promise<FeedbackItem> {
    const response = await this.fetcher(`${this.base}/feedback/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, reply, password }),
    });
    const result = await this.unwrapReady<{ item: FeedbackItem }>(response, '피드백');
    return result.item;
  }

  async removeFeedback(id: string, password: string): Promise<void> {
    const response = await this.fetcher(`${this.base}/feedback/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, password }),
    });
    await this.unwrapReady<unknown>(response, '피드백');
  }

  async adminCheck(password: string): Promise<boolean> {
    const response = await this.fetcher(`${this.base}/admin/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    await this.unwrapReady<unknown>(response, '피드백');
    return true;
  }

  async vote(kind: ShareKind, id: string, value: VoteValue): Promise<ShareVoteResult> {
    const response = await this.fetcher(`${this.base}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, id, value }),
    });
    return unwrap<ShareVoteResult>(response);
  }
}

/** 목록에서 «어떤 상황에서 쟀나»가 한 줄로 읽히게. 설정에서만 만든다. */
export function summarizeBattle(battle: BattleShare): string {
  // 값과 낱말이 섞인 한 줄이라 DOM 훑기로는 못 바꾼다 — 조각마다 사전을 지난다.
  const parts = [t('{n}초', { n: battle.duration })];
  parts.push(battle.enemyCode ? t('적 {code}', { code: t(battle.enemyCode) }) : t('무속성'));
  parts.push(battle.coreEnabled ? t('코어 {n}px', { n: battle.corePx }) : t('코어 없음'));
  if (battle.hasParts) parts.push(t('파츠'));
  if (battle.optimalRangeWeapons.length > 0) {
    parts.push(t('적정 {list}', { list: battle.optimalRangeWeapons.join('·') }));
  }
  if (battle.immuneWindows.length > 0) parts.push(t('족자 {n}', { n: battle.immuneWindows.length }));
  if (battle.elementWindows.length > 0) parts.push(t('속저 {n}', { n: battle.elementWindows.length }));
  parts.push(battle.rngMode === 'expected' ? t('기대값') : t('난수'));
  return parts.join(' · ');
}

/**
 * 5덱이면 덱 수와 인원만, 한 덱이면 이름을 그대로 적는다.
 *
 * 이름 사이는 슬래시로 가른다 — «라피 : 레드 후드»처럼 이름 자체에 구분점이 들어가는
 * 캐릭터가 많아, 가운뎃점으로 이으면 어디서 한 명이 끝나는지 읽히지 않는다.
 */
export function summarizeSquad(
  decks: Array<{ squad: string[] }>,
  fiveDeckMode: boolean,
): string {
  const filled = decks.map((deck) => deck.squad.filter((name) => name.trim() !== ''));
  if (!fiveDeckMode) return filled[0]?.join('/') ?? '';
  const used = filled.filter((squad) => squad.length > 0);
  const total = used.reduce((sum, squad) => sum + squad.length, 0);
  if (used.length <= 1) return used[0]?.join('/') ?? '';
  return `${used.length}덱 · ${total}명`;
}

/**
 * 유니온 레이드 판 한 줄 설명. 보스 이름을 늘어놓는 것이 가장 빨리 읽힌다 —
 * 「작열 글러트니 / 수냉 니힐」만 보여도 이번 시즌 것인지 바로 안다.
 */
export function summarizeUnion(
  bosses: Array<{ name: string; enabled: boolean; battleCode: string; deckCodes: string[] }>,
): string {
  const live = bosses.filter((boss) => boss.enabled
    && (boss.name.trim() !== '' || boss.battleCode.trim() !== ''));
  const names = live.map((boss, index) => boss.name.trim() || `보스 ${index + 1}`);
  const decks = live.reduce(
    (sum, boss) => sum + boss.deckCodes.filter((code) => code.trim() !== '').length, 0);
  if (names.length === 0) return '빈 판';
  return `${names.join(' / ')} · 덱 ${decks}개`;
}
