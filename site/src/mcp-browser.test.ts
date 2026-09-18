import { afterEach, expect, it, vi } from 'vitest';
import { BrowserMcpConnection, executeBrowserJob } from './mcp-browser';
import type { McpShare } from './mcp-share';
const request = { squad: ['리타'], duration: 2, enemyDef: 0, enemyCode: '' as const, corePx: 0, hasParts: false, seed: 42 };
const state: McpShare = { format: 'nikke-calc-mcp', version: 1, battle: request,
  roster: { 리타: { skillLevels: { '1': 3, '2': 4, '3': 5 } } }, decks: [request] };
const engine = () => ({ prepare: vi.fn().mockResolvedValue(undefined), dispose: vi.fn(),
  simulateMcp: vi.fn().mockResolvedValue({ engineVersion: 'browser-runtime', effectiveCharacters: [],
    result: { squadTotal: 123, timeline: {}, buffTargets: {}, states: {} } }) });
afterEach(() => vi.useRealTimers());
it('compares growth on the captured live roster and preserves account settings without editing it', async () => {
  const saved = structuredClone(state);
  saved.battle.synchroLevel = 321;
  saved.battle.console = { common_level: 10, class_level: {}, company_level: {} };
  const before = structuredClone(saved);
  const worker = { ...engine(), compareGrowth: vi.fn().mockResolvedValue({ baseline: { combatPower: 100 }, scenarios: [] }) };
  const result = await executeBrowserJob({ id: '1', kind: 'growth', name: '리타',
    scenarios: [{ label: 'SR5', changes: { collection: { stage: 'SR5', favorite: 0 } } }] }, () => saved, worker);
  expect(worker.compareGrowth.mock.calls[0]![0]).toMatchObject({ name: '리타', synchroLevel: 321,
    console: saved.battle.console, baseline: saved.roster.리타 });
  expect(result.execution).toBe('user-browser');
  expect(saved).toEqual(before);
  expect(worker.simulateMcp).not.toHaveBeenCalled();
  await expect(executeBrowserJob({ id: '2', kind: 'growth', name: '크라운', scenarios: [] }, () => saved, worker)).rejects.toThrow('육성');
});
it('captures live roster for a new squad without changing saved deck', async () => {
  const worker = engine();
  const result = await executeBrowserJob({ id: '1', kind: 'shared', squad: ['리타'] }, () => state, worker);
  expect((worker.simulateMcp.mock.calls as any)[0][0].characters.리타.skillLevels['1']).toBe(3);
  expect(result).toMatchObject({ execution: 'user-browser', engineVersion: 'browser-runtime', result: { squadTotal: 123 } });
  expect((result as any).result.timeline).toBeUndefined();
  expect(state.decks[0]!.characters).toBeUndefined();
  await expect(executeBrowserJob({ id: '2', kind: 'shared', squad: ['크라운'] }, () => state, worker)).rejects.toThrow('육성');
});
it('compares candidates sequentially using actual results', async () => {
  const worker = engine();
  const result = await executeBrowserJob({ id: '1', kind: 'simulate', requests: [request, request] }, () => state, worker);
  expect(result).toMatchObject({ ranking: [1, 2], testedCandidates: 2 });
  expect(worker.simulateMcp).toHaveBeenCalledTimes(2);
});
it('disconnect destroys dedicated worker and revokes session', async () => {
  vi.useFakeTimers();
  const worker = engine();
  const fetcher = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () =>
    url.endsWith('/connect') ? { connectionCode: 'code', browserToken: 'secret', expiresIn: 7200 } : { job: null } }));
  const connection = new BrowserMcpConnection(() => state, () => worker, fetcher as any);
  await connection.connect();
  expect(connection.state.code).toBe('code');
  connection.disconnect();
  expect(worker.dispose).toHaveBeenCalled();
  expect(connection.state.code).toBe('');
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/disconnect'))).toBe(true);
});
it('late connection response after disconnect is revoked and never shown', async () => {
  const worker = engine();
  let respond!: (value: unknown) => void;
  const fetcher = vi.fn().mockImplementation((url: string) => url.endsWith('/connect')
    ? new Promise(resolve => { respond = resolve; }) : Promise.resolve({ ok: true, json: async () => ({ ok: true }) }));
  const connection = new BrowserMcpConnection(() => state, () => worker, fetcher as any);
  const pending = connection.connect();
  await Promise.resolve();
  connection.disconnect();
  respond({ ok: true, json: async () => ({ connectionCode: 'code', browserToken: 'secret', expiresIn: 7200 }) });
  await pending;
  expect(connection.state.code).toBe('');
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/disconnect'))).toBe(true);
});

it('keeps heartbeat but does not dequeue another job until result acknowledgement', async () => {
  vi.useFakeTimers();
  const worker = engine();
  let acknowledge!: (value: unknown) => void;
  let polls = 0;
  const fetcher = vi.fn().mockImplementation(async (url: string) => {
    if (url.endsWith('/result')) return new Promise(resolve => { acknowledge = resolve; });
    return { ok: true, json: async () => url.endsWith('/connect')
      ? { connectionCode: 'code', browserToken: 'secret' }
      : { job: url.endsWith('/poll') && ++polls === 1 ? { id: 'job', kind: 'inspect' } : null } };
  });
  const connection = new BrowserMcpConnection(() => state, () => worker, fetcher as any);
  await connection.connect();
  await vi.advanceTimersByTimeAsync(2100);
  const calls = fetcher.mock.calls.filter(([url]) => url.endsWith('/poll'));
  expect(JSON.parse(calls[1]![1].body).ready).toBe(false);
  acknowledge({ ok: true, json: async () => ({ ok: true }) });
  await vi.advanceTimersByTimeAsync(2100);
  const latest = fetcher.mock.calls.filter(([url]) => url.endsWith('/poll')).at(-1)!;
  expect(JSON.parse(latest[1].body).ready).toBe(true);
  connection.disconnect();
});
