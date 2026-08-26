import type { ShareItem, ShareKind, ShareServer, VoteValue } from './share-server';

// 공유 모달의 서버 쪽 판. 전투 조건과 조합이 같은 구조를 쓰므로 여기 한 번만 쓴다.
// 세 갈래다 — «올리기»는 지금 설정을 이름 붙여 보내고, «내려받기»는 남이 올린 것을
// 받아 적용하고, «코드»는 원래 있던 코드 주고받기다(서버를 거치지 않는다).

export interface SharePanelHosts {
  tabs: HTMLElement;
  upload: HTMLElement;
  list: HTMLElement;
  code: HTMLElement;
}

export interface SharePanelDeps {
  kind: ShareKind;
  server: ShareServer;
  /** 지금 설정을 «코드 + 한 줄 설명»으로. 올리기 탭을 열 때마다 새로 읽는다. */
  current: () => { code: string; auto: string };
  /**
   * 목록에서 고른 것을 적용한다. 실패하면 던진다 — 잡아서 알린다.
   * 성공했을 때 무엇을 적었는지는 모달마다 다르므로 알림도 여기서 낸다.
   */
  apply: (item: ShareItem) => void;
  /** 모달마다 자기 자리에 적는 알림. */
  notify: (message: string, ok?: boolean) => void;
}

export interface SharePanel {
  /** 모달을 열 때마다 부른다. 목록은 처음 열 때 한 번만 받는다. */
  open: () => void;
}

type TabKey = 'list' | 'upload' | 'code';

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** 「3일 전」처럼 읽히게. 목록에서 정확한 시각까지는 필요 없다. */
export function agoText(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return new Date(at).toLocaleDateString('ko-KR');
}

/** 인기순 — 엄지 차이로 세우고, 같으면 새것이 앞이다. */
export function rankItems(items: ShareItem[]): ShareItem[] {
  return [...items].sort((a, b) => (b.up - b.down) - (a.up - a.down)
    || Date.parse(b.at) - Date.parse(a.at));
}

export function mountSharePanel(hosts: SharePanelHosts, deps: SharePanelDeps): SharePanel {
  let tab: TabKey = 'list';
  let items: ShareItem[] = [];
  let mine: Record<string, VoteValue> = {};
  let loaded = false;
  let loading = false;
  let listError = '';

  const panes: Record<TabKey, HTMLElement> = {
    list: hosts.list, upload: hosts.upload, code: hosts.code,
  };

  const showTab = (next: TabKey) => {
    tab = next;
    for (const [key, pane] of Object.entries(panes)) pane.hidden = key !== next;
    renderTabs();
    if (next === 'list' && !loaded) void loadList();
    if (next === 'upload') renderUpload();
  };

  function renderTabs(): void {
    hosts.tabs.replaceChildren();
    const labels: Array<[TabKey, string]> = [
      ['upload', '올리기'],
      ['list', '내려받기'],
      ['code', '코드'],
    ];
    for (const [key, label] of labels) {
      const button = el('button', 'share-tab' + (tab === key ? ' is-on' : ''));
      button.type = 'button';
      button.dataset.shareTab = key;
      button.append(el('span', undefined, label));
      if (key === 'list' && loaded) {
        button.append(el('span', 'tab-count', String(items.length)));
      }
      button.addEventListener('click', () => showTab(key));
      hosts.tabs.append(button);
    }
  }

  /* ── 내려받기 ─────────────────────────────────────────────────────── */

  async function loadList(): Promise<void> {
    if (loading) return;
    loading = true;
    listError = '';
    renderList();
    try {
      const got = await deps.server.list(deps.kind);
      items = got.items;
      mine = got.mine;
      loaded = true;
    } catch (error) {
      listError = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
      renderTabs();
      renderList();
    }
  }

  async function vote(item: ShareItem, want: 1 | -1): Promise<void> {
    // 눌린 티는 먼저 낸다. 서버가 거절하면 되돌린다 — 매번 왕복을 기다리면
    // «눌리긴 한 건가»부터 헷갈린다.
    const before = mine[item.id] ?? 0;
    const after: VoteValue = before === want ? 0 : want;
    const undo = { up: item.up, down: item.down, mine: before };
    if (before === 1) item.up -= 1;
    if (before === -1) item.down -= 1;
    if (after === 1) item.up += 1;
    if (after === -1) item.down += 1;
    mine[item.id] = after;
    renderList();
    try {
      const result = await deps.server.vote(deps.kind, item.id, after);
      item.up = result.up;
      item.down = result.down;
      mine[item.id] = result.mine;
    } catch (error) {
      item.up = undo.up;
      item.down = undo.down;
      mine[item.id] = undo.mine;
      deps.notify(error instanceof Error ? error.message : String(error));
    }
    renderList();
  }

  function voteButton(item: ShareItem, want: 1 | -1): HTMLButtonElement {
    const on = (mine[item.id] ?? 0) === want;
    const button = el('button', `vote-btn ${want === 1 ? 'up' : 'down'}${on ? ' is-on' : ''}`);
    button.type = 'button';
    button.dataset.vote = `${item.id}:${want}`;
    button.setAttribute('aria-pressed', String(on));
    button.title = want === 1
      ? '좋아요 — 다시 누르면 취소' : '별로예요 — 다시 누르면 취소';
    button.append(
      el('span', undefined, want === 1 ? '👍' : '👎'),
      el('span', undefined, String(want === 1 ? item.up : item.down)),
    );
    button.addEventListener('click', () => void vote(item, want));
    return button;
  }

  function renderList(): void {
    hosts.list.replaceChildren();
    if (loading) {
      hosts.list.append(el('p', 'share-empty', '목록을 받는 중입니다…'));
      return;
    }
    if (listError) {
      hosts.list.append(el('p', 'share-empty', `목록을 받지 못했습니다 — ${listError}`));
      const retry = el('button', 'share-upload-btn', '다시 시도');
      retry.type = 'button';
      retry.dataset.shareRetry = '';
      retry.addEventListener('click', () => void loadList());
      hosts.list.append(retry);
      return;
    }
    if (items.length === 0) {
      hosts.list.append(el('p', 'share-empty', '아직 올라온 설정이 없습니다. 첫 번째로 올려 보세요.'));
      return;
    }
    const box = el('div', 'share-list');
    for (const item of rankItems(items)) {
      const row = el('div', 'share-item');
      row.dataset.shareItem = item.id;

      const body = el('div', 'share-body');
      body.append(el('p', 'share-name', item.name));
      if (item.auto) body.append(el('p', 'share-auto', item.auto));
      const by = el('p', 'share-by');
      if (item.by) by.append(el('span', undefined, item.by));
      else by.append(el('span', 'anon', '익명'));
      by.append(el('span', undefined, ` · ${agoText(item.at)}`));
      body.append(by);

      const votes = el('div', 'vote-pill');
      votes.append(voteButton(item, 1), voteButton(item, -1));

      const apply = el('button', 'share-apply-btn', '적용');
      apply.type = 'button';
      apply.dataset.shareApply = item.id;
      apply.addEventListener('click', () => {
        try {
          deps.apply(item);
        } catch (error) {
          deps.notify(error instanceof Error ? error.message : String(error));
        }
      });

      row.append(body, votes, apply);
      box.append(row);
    }
    hosts.list.append(box);
    hosts.list.append(el(
      'p', 'share-foot',
      '엄지는 IP당 한 표입니다 — 다시 누르면 취소, 반대쪽을 누르면 갈아탑니다.',
    ));
  }

  /* ── 올리기 ───────────────────────────────────────────────────────── */

  function renderUpload(): void {
    const { auto } = deps.current();
    hosts.upload.replaceChildren();
    const form = el('div', 'share-form-row');

    const nameField = el('div', 'share-field');
    const nameLabel = el('label');
    nameLabel.append(el('span', undefined, '이름 '), el('span', 'req', '*'));
    const name = el('input', 'share-input');
    name.type = 'text';
    name.maxLength = 40;
    name.placeholder = deps.kind === 'boss' ? '예: 솔로레이드 3주차 3페' : '예: 수냉 솔레 1덱';
    name.dataset.shareName = '';
    nameField.append(nameLabel, name);

    const autoField = el('div', 'share-field');
    const autoLabel = el('label');
    autoLabel.append(
      el('span', undefined, '설명 '),
      el('span', 'opt', '· 지금 설정에서 자동으로 만듭니다'),
    );
    const autoBox = el('div', 'share-auto-box', auto || '(설정이 비어 있습니다)');
    autoBox.dataset.shareAuto = '';
    autoField.append(autoLabel, autoBox);

    const byField = el('div', 'share-field');
    const byLabel = el('label');
    byLabel.append(el('span', undefined, '업로더 '), el('span', 'opt', '· 비우면 «익명»'));
    const by = el('input', 'share-input');
    by.type = 'text';
    by.maxLength = 16;
    by.placeholder = '익명';
    by.dataset.shareBy = '';
    byField.append(byLabel, by);

    const warn = el(
      'p', 'share-warn',
      '올린 뒤에는 스스로 지울 수 없습니다. 이름과 업로더에 개인정보를 넣지 마세요.',
    );

    const submit = el('button', 'share-upload-btn', '서버에 올리기');
    submit.type = 'button';
    submit.dataset.shareUpload = '';
    submit.disabled = true;
    name.addEventListener('input', () => {
      submit.disabled = name.value.trim() === '';
    });
    submit.addEventListener('click', () => {
      void send(name.value, by.value, submit);
    });

    form.append(
      nameField, autoField, byField, warn, submit,
      el('p', 'share-hint', '올리기를 누를 때만 서버로 전송됩니다. 그 전에는 아무것도 나가지 않습니다.'),
    );
    hosts.upload.append(form);
  }

  async function send(name: string, by: string, submit: HTMLButtonElement): Promise<void> {
    const { code, auto } = deps.current();
    submit.disabled = true;
    submit.textContent = '올리는 중…';
    try {
      const result = await deps.server.upload({ kind: deps.kind, name, by, auto, code });
      // 목록을 다시 받아 방금 올린 것이 어디에 섰는지 그 자리에서 보여 준다.
      loaded = false;
      showTab('list');
      await loadList();
      deps.notify(result.existed
        ? `같은 설정이 이미 «${result.item.name}»으로 올라와 있어 그 항목을 씁니다.`
        : `«${result.item.name}»을(를) 올렸습니다.`, true);
    } catch (error) {
      deps.notify(error instanceof Error ? error.message : String(error));
    } finally {
      submit.disabled = false;
      submit.textContent = '서버에 올리기';
    }
  }

  // 판을 만드는 것만으로 서버를 부르지는 않는다 — 모달을 열 때 비로소 받는다.
  renderTabs();
  for (const [key, pane] of Object.entries(panes)) pane.hidden = key !== tab;
  renderList();

  return { open: () => showTab(tab) };
}
