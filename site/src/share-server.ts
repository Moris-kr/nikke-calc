import type { BattleShare } from './share-code';

// 설정 공유 서버(`worker-share/`)와 이야기하는 쪽. 서버가 아는 것은 공유 코드 문자열과
// 사람이 붙인 이름뿐이고, 그 코드가 무슨 뜻인지 — 몇 초짜리 전투인지, 누가 편성됐는지 —
// 는 여기서만 안다. 목록에 함께 적히는 «설명»도 그래서 서버가 아니라 이쪽에서 만든다.

export type ShareKind = 'boss' | 'squad';
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
  /** 적용에 쓰는 공유 코드. 목록과 함께 온다 — 받아서 바로 적용할 수 있다. */
  code: string;
}

export interface ShareListResult {
  items: ShareItem[];
  /** 이 브라우저(정확히는 이 IP)가 이미 누른 표. 항목 id → 1 · -1 */
  mine: Record<string, 1 | -1>;
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

export interface ShareVoteResult {
  id: string;
  up: number;
  down: number;
  mine: VoteValue;
}

type Fetcher = typeof fetch;

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

  async list(kind: ShareKind): Promise<ShareListResult> {
    const response = await this.fetcher(`${this.base}/list?kind=${kind}`);
    const result = await unwrap<ShareListResult>(response);
    return { items: result.items ?? [], mine: result.mine ?? {} };
  }

  async upload(input: ShareUploadInput): Promise<ShareUploadResult> {
    const response = await this.fetcher(`${this.base}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return unwrap<ShareUploadResult>(response);
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
  const parts = [`${battle.duration}초`];
  parts.push(battle.enemyCode ? `적 ${battle.enemyCode}` : '무속성');
  parts.push(battle.coreEnabled ? `코어 ${battle.corePx}px` : '코어 없음');
  if (battle.hasParts) parts.push('파츠');
  if (battle.optimalRangeWeapons.length > 0) {
    parts.push(`적정 ${battle.optimalRangeWeapons.join('·')}`);
  }
  if (battle.immuneWindows.length > 0) parts.push(`족자 ${battle.immuneWindows.length}`);
  if (battle.elementWindows.length > 0) parts.push(`속저 ${battle.elementWindows.length}`);
  parts.push(battle.rngMode === 'expected' ? '기대값' : '난수');
  return parts.join(' · ');
}

/** 5덱이면 덱 수와 인원만, 한 덱이면 이름을 그대로 적는다. */
export function summarizeSquad(
  decks: Array<{ squad: string[] }>,
  fiveDeckMode: boolean,
): string {
  const filled = decks.map((deck) => deck.squad.filter((name) => name.trim() !== ''));
  if (!fiveDeckMode) return filled[0]?.join('·') ?? '';
  const used = filled.filter((squad) => squad.length > 0);
  const total = used.reduce((sum, squad) => sum + squad.length, 0);
  if (used.length <= 1) return used[0]?.join('·') ?? '';
  return `${used.length}덱 · ${total}명`;
}
