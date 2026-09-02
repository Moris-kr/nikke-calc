/**
 * 피드백 게시판 — 올린 글은 모두에게 보이고, 관리자가 상태를 옮긴다.
 *
 * 화면을 그리는 일은 `ui.ts`가 하고, 여기에는 **그리지 않아도 답이 정해지는 것**만
 * 둔다: 상태의 차례, 목록을 세우는 순서, 그리고 「진행중」을 AI에게 그대로 넘길 수 있는
 * 글로 바꾸는 일.
 */

import type { FeedbackItem, FeedbackKind, FeedbackStatus } from './share-server';

export const FEEDBACK_KINDS: FeedbackKind[] = ['bug', 'idea', 'etc'];
export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  bug: '버그', idea: '건의', etc: '기타',
};

/**
 * 접수 → 진행중 → 완료 / 불가능.
 *
 * 「불가능」을 끝에 두는 것은 «안 한다»가 결론인 글도 남겨 두기 위해서다 — 지우면
 * 같은 이야기가 다시 올라온다.
 */
export const FEEDBACK_STATUSES: FeedbackStatus[] = ['new', 'doing', 'done', 'wont'];
export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: '접수', doing: '진행중', done: '완료', wont: '불가능',
};

/** 상태 차례로, 같은 상태 안에서는 새로 올라온 것이 위로. */
export function sortFeedback(items: FeedbackItem[]): FeedbackItem[] {
  return [...items].sort((a, b) => FEEDBACK_STATUSES.indexOf(a.status) - FEEDBACK_STATUSES.indexOf(b.status)
    || b.at.localeCompare(a.at));
}

export const countByStatus = (items: FeedbackItem[]): Record<FeedbackStatus, number> => {
  const counts = { new: 0, doing: 0, done: 0, wont: 0 };
  for (const item of items) if (item.status in counts) counts[item.status] += 1;
  return counts;
};

/** 목록에 적는 날짜. 시각까지는 필요 없다. */
export const feedbackDate = (iso: string): string => (iso ? iso.slice(0, 10) : '');

/**
 * 「진행중」을 AI에게 그대로 넘길 수 있는 글로.
 *
 * 게시판을 눈으로 옮겨 적는 일을 없애려는 것이라, **그대로 붙여 넣으면 일이 되도록**
 * 적는다 — 무엇을 하는 파일인지 한 줄로 밝히고, 항목마다 종류·날짜를 붙여 번호를 매긴다.
 * 여러 줄로 쓴 글도 있으므로 본문은 인용 부호 없이 그대로 싣는다.
 */
export function doingPrompt(items: FeedbackItem[], at = new Date()): string {
  const doing = sortFeedback(items.filter((item) => item.status === 'doing'));
  const stamp = feedbackDate(at.toISOString());
  const head = [
    `# 니케 계산기 — 진행중 피드백 ${doing.length}건 (${stamp})`,
    '',
    '아래는 이용자들이 올린 피드백 가운데 관리자가 「진행중」으로 옮긴 것들이다.',
    '항목마다 무엇을 고치거나 만들어야 하는지 판단해 반영하고, 애매하면 무엇이 애매한지 적어라.',
  ];
  if (doing.length === 0) {
    return [...head, '', '(진행중으로 옮긴 항목이 없다.)', ''].join('\n');
  }
  const body = doing.map((item, index) => [
    '',
    `## ${index + 1}. [${FEEDBACK_KIND_LABEL[item.kind] ?? '기타'}] ${feedbackDate(item.at)}`
      + `${item.by ? ` · ${item.by}` : ''}`,
    '',
    item.text,
  ].join('\n'));
  return [...head, ...body, ''].join('\n');
}

export const feedbackFileName = (at = new Date()): string => {
  const stamp = [at.getFullYear(), at.getMonth() + 1, at.getDate()]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0'))).join('');
  return `니케계산기_진행중_${stamp}.txt`;
};

export const textBlob = (text: string): Blob =>
  new Blob([text], { type: 'text/plain;charset=utf-8' });
