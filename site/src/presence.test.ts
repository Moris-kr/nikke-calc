// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startPresence } from './presence';

const fakeDoc = (state: DocumentVisibilityState = 'visible') => {
  const listeners = new Map<string, EventListener>();
  return {
    visibilityState: state,
    addEventListener: (type: string, fn: EventListener) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    fire: (type: string) => listeners.get(type)?.(new Event(type)),
    set state(next: DocumentVisibilityState) { (this as { visibilityState: string }).visibilityState = next; },
  } as unknown as Document & { fire(type: string): void; state: DocumentVisibilityState };
};

const okFetch = (online: number) => vi.fn(async () => ({
  ok: true, json: async () => ({ online }),
} as unknown as Response));

describe('접속자 수 인사', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('바로 한 번 인사하고 그 수를 알려 준다', async () => {
    const fetcher = okFetch(7);
    const seen: number[] = [];
    const handle = startPresence('https://share.example/', (n) => seen.push(n),
      { fetcher: fetcher as unknown as typeof fetch, doc: fakeDoc() });
    await vi.waitFor(() => expect(seen).toEqual([7]));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://share.example/presence');
    // 표식은 탭마다 새로 만든 무작위 문자열이다 — 사람을 가려내지 않는다.
    const sent = JSON.parse(String(init.body)) as { id: string };
    expect(sent.id).toMatch(/^[a-z0-9]{20,32}$/i);
    handle.stop();
  });

  it('탭이 숨어 있으면 인사하지 않는다', async () => {
    const fetcher = okFetch(3);
    const doc = fakeDoc('hidden');
    const handle = startPresence('https://share.example', () => undefined,
      { fetcher: fetcher as unknown as typeof fetch, doc });
    await new Promise((done) => { setTimeout(done, 10); });
    expect(fetcher).not.toHaveBeenCalled();
    // 다시 보이면 그 자리에서 인사한다 — 45초를 기다리게 두지 않는다.
    doc.state = 'visible';
    doc.fire('visibilitychange');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    handle.stop();
  });

  it('실패하면 숫자를 건드리지 않는다', async () => {
    const fetcher = vi.fn(async () => { throw new Error('네트워크 끊김'); });
    const seen: number[] = [];
    const handle = startPresence('https://share.example', (n) => seen.push(n),
      { fetcher: fetcher as unknown as typeof fetch, doc: fakeDoc() });
    await new Promise((done) => { setTimeout(done, 10); });
    expect(seen).toEqual([]);        // 0으로 깜빡이느니 직전 값을 둔다
    handle.stop();
  });

  it('멈추면 더 인사하지 않는다', async () => {
    vi.useFakeTimers();
    const fetcher = okFetch(1);
    const handle = startPresence('https://share.example', () => undefined,
      { fetcher: fetcher as unknown as typeof fetch, doc: fakeDoc(), beatMs: 1_000 });
    handle.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(1);   // 시작할 때 한 번뿐
  });

  // 새로고침 한 번이 새 사람 하나가 되면, 혼자 다섯 번 눌러도 다섯 명이 된다.
  const idOf = async (store: Storage | null): Promise<string> => {
    const fetcher = okFetch(1);
    const handle = startPresence('https://share.example', () => undefined,
      { fetcher: fetcher as unknown as typeof fetch, doc: fakeDoc(), store });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    handle.stop();
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    return (JSON.parse(String(init.body)) as { id: string }).id;
  };

  const memStore = (): Storage => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
    } as unknown as Storage;
  };

  it('새로고침해도 같은 표식으로 인사한다', async () => {
    const store = memStore();
    expect(await idOf(store)).toBe(await idOf(store));
  });

  it('다른 탭은 다른 표식이다', async () => {
    expect(await idOf(memStore())).not.toBe(await idOf(memStore()));
  });

  it('저장이 막혀 있어도 인사는 나간다', async () => {
    const locked = {
      getItem: () => { throw new Error('막힘'); },
      setItem: () => { throw new Error('막힘'); },
    } as unknown as Storage;
    expect(await idOf(locked)).toMatch(/^[a-z0-9]{20,32}$/i);
    expect(await idOf(null)).toMatch(/^[a-z0-9]{20,32}$/i);
  });

  it('주소가 비어 있으면 아무것도 하지 않는다', () => {
    const fetcher = okFetch(1);
    startPresence('  ', () => undefined,
      { fetcher: fetcher as unknown as typeof fetch, doc: fakeDoc() });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
