// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import type { CalculatorPool, WorkerLike } from './worker-client';
import type { WorkerRequest, WorkerResponse } from './types';

const mounted = vi.hoisted(() => ({ client: null as CalculatorPool | null, cleanup: vi.fn() }));
vi.mock('./ui', () => ({ mountCalculator: (_root: HTMLElement, deps: { client: CalculatorPool }) => {
  mounted.client = deps.client;
  mounted.cleanup.mockImplementation(() => deps.client.dispose());
  return mounted.cleanup;
} }));
vi.mock('./temporary-characters', () => ({ installTemporaryCharacters: () => [] }));

it('keeps workers usable after back-forward cache restoration and changed burst timing', async () => {
  vi.stubGlobal('__BUILD_ID__', 'test');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  class Worker implements WorkerLike {
    onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
    onerror = null;
    postMessage(message: WorkerRequest) {
      queueMicrotask(() => this.onmessage?.({ data: {
        id: message.id, type: message.type === 'prepare' ? 'ready' : 'result',
        payload: message.payload,
      } } as MessageEvent<WorkerResponse>));
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', Worker);
  document.body.innerHTML = '<div id="app"></div>';
  try {
    await import('./main');
    await vi.waitFor(() => expect(mounted.client).not.toBeNull());
    const pool = mounted.client!;
    pool.setPoolSize(3);
    await pool.prepare();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    const outcomes = await Promise.allSettled([0, 1.5, 2, 2.8, 5].map(burstRegenTime => pool.simulate({
      squad: [], duration: 10, enemyDef: 0, enemyCode: '', corePx: 0,
      hasParts: false, seed: 42, burstRegenTime,
    })));
    expect(outcomes.map(outcome => outcome.status === 'rejected' ? String(outcome.reason) : 'ok'))
      .toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(mounted.cleanup).not.toHaveBeenCalled();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    expect(mounted.cleanup).toHaveBeenCalledTimes(1);
  } finally {
    mounted.client?.dispose();
    vi.unstubAllGlobals();
  }
});
