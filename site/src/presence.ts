/**
 * 지금 보고 있는 사람 수.
 *
 * 45초마다 «나 여기 있다»를 한 번 보내고, 서버가 최근에 인사한 사람을 세어 돌려준다.
 * 표식은 **탭마다 하나인 무작위 문자열**이라 사람을 가려내지 않는다 — 같은 사람이
 * 두 탭을 열면 둘로 세는 대신, 우리가 방문자를 추적할 방법이 없는 쪽을 골랐다.
 * 표식을 sessionStorage에 둔 것은 그 «탭마다 하나»를 지키기 위해서다: 매번 새로
 * 만들면 새로고침 한 번이 새 사람 하나가 되어, 혼자 다섯 번 눌러도 다섯 명이 된다.
 *
 * 탭이 숨으면 인사를 멈춘다. 배경에 열어 둔 탭까지 세면 «지금 보는 중»이 아니게 되고,
 * 서버 요청도 그만큼 헛돈다.
 */

/** 인사 주기(ms). 서버의 판정 창(100초)보다 넉넉히 짧아야 한 번 놓쳐도 안 빠진다. */
export const BEAT_MS = 45_000;

export interface PresenceHandle {
  stop(): void;
}

const newTag = (): string => {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random.replace(/-/g, '').slice(0, 32);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

/** 표식을 두는 자리. sessionStorage는 **탭 하나에만 살고 새로고침을 넘겨 산다** — 우리가 바라는 그 수명이다. */
const TAG_KEY = 'nikke-presence-tag';

/** 서버가 받아 주는 길이(8~64). 남의 값이나 깨진 값이 들어 있으면 새로 만든다. */
const usable = (tag: string | null): tag is string =>
  typeof tag === 'string' && tag.length >= 8 && tag.length <= 64;

const tagFrom = (store: Storage | null): string => {
  try {
    const kept = store?.getItem(TAG_KEY) ?? null;
    if (usable(kept)) return kept;
  } catch { /* 저장이 막혀 있으면 그냥 새로 만든다 */ }
  const made = newTag();
  try { store?.setItem(TAG_KEY, made); } catch { /* 못 적어도 이번 판은 굴러간다 */ }
  return made;
};

const sessionStore = (): Storage | null => {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
};

/**
 * 인사를 시작한다. `onCount`는 서버가 준 수로 불린다 — 실패하면 부르지 않는다
 * (숫자가 0으로 깜빡이느니 직전 값을 그대로 두는 편이 덜 거슬린다).
 */
export function startPresence(
  api: string,
  onCount: (online: number) => void,
  options: { beatMs?: number; fetcher?: typeof fetch; doc?: Document; store?: Storage | null } = {},
): PresenceHandle {
  const base = api.trim().replace(/\/+$/, '');
  if (!base) return { stop: () => undefined };
  const beatMs = options.beatMs ?? BEAT_MS;
  const fetcher = options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const doc = options.doc ?? document;
  const tag = tagFrom(options.store !== undefined ? options.store : sessionStore());
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const beat = async () => {
    if (stopped || doc.visibilityState === 'hidden') return;
    try {
      const response = await fetcher(`${base}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tag }),
      });
      if (!response.ok) return;
      const payload = await response.json() as { online?: number };
      if (typeof payload.online === 'number' && payload.online >= 0) onCount(payload.online);
    } catch {
      /* 접속자 수는 있으면 좋은 값이다 — 실패해도 화면은 그대로 둔다 */
    }
  };

  const onVisible = () => { if (doc.visibilityState === 'visible') void beat(); };
  doc.addEventListener('visibilitychange', onVisible);
  void beat();
  timer = setInterval(() => { void beat(); }, beatMs);

  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      doc.removeEventListener('visibilitychange', onVisible);
    },
  };
}
