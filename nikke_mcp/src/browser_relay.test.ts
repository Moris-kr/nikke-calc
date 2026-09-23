// py: nikke_mcp/test_browser_relay.py, test_overload_exchange.py
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { BrowserRelay } from './browser_relay.ts';
import { ToolError } from './errors.ts';
import { NikkeServer } from './server.ts';
import { CalculatorService } from './service.ts';
import { connect } from './testing.ts';
import { createHttpServer } from './transport.ts';

/** A CalculatorService that fails the test if the public (browser) server ever computes. */
class ForbiddenService extends CalculatorService {
  override simulate(): Promise<Record<string, unknown>> {
    throw new Error('server compute');
  }
}

describe('browser protocol', () => {
  let base = '';
  let server: ReturnType<typeof createHttpServer>;
  before(async () => {
    server = createHttpServer(new NikkeServer({ browserMode: true }), {
      host: '127.0.0.1', port: 0, allowedHosts: ['127.0.0.1:*'], allowedOrigins: [], maxRequestBodySize: 1048576,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const request = (path: string, body: string = '{}', origin: string | null = 'https://moris-kr.github.io', method = 'POST') =>
    fetch(base + path, { method, body: method === 'POST' ? body : undefined,
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) } });

  it('routes enforce CORS, body limits and validation', async () => {
    assert.equal((await request('/browser/connect', '{}', null)).status, 403);
    const options = await request('/browser/connect', '{}', 'https://moris-kr.github.io', 'OPTIONS');
    assert.equal(options.headers.get('access-control-allow-origin'), 'https://moris-kr.github.io');
    assert.equal(options.headers.get('cache-control'), 'no-store');
    assert.equal((await request('/browser/connect', '{"bad":1}')).status, 400);
    assert.equal((await request('/browser/connect', ' '.repeat(1048577))).status, 413);
    assert.equal((await request('/browser/result', ' '.repeat(4 * 1048576 + 1))).status, 413);
    const connected = await request('/browser/connect');
    assert.equal(connected.status, 200);
    const { browserToken } = await connected.json() as { browserToken: string };
    const disconnected = await request('/browser/disconnect', JSON.stringify({ browserToken }));
    assert.deepEqual(await disconnected.json(), { ok: true });
  });

  it('remote requires a browser and never constructs the calculator', async () => {
    const nikke = new NikkeServer({ browserMode: true, service: new ForbiddenService() });
    assert.equal(nikke.service, null);
    const client = await connect(nikke);
    const result = await client.call('simulate_squad', { request: { squad: ['리타'] } });
    assert.equal(result.isError, true);
    assert.match(result.text, /CONNECTION_REQUIRED/);
    await client.close();
  });

  it('remote tools queue browser work and comparison validates conditions', async () => {
    const relay = new BrowserRelay();
    const { connectionCode: code, browserToken: token } = relay.connect() as Record<string, string>;
    const client = await connect({ browserMode: true, relay, service: new ForbiddenService() });
    const state = { format: 'nikke-calc-mcp', version: 1, battle: {}, roster: { '리타': {} }, decks: [] };
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['simulate_squad', { request: { squad: ['리타'] } }, 'simulate'],
      ['compare_setups', { requests: [{ squad: ['리타'] }, { squad: ['리타'] }] }, 'simulate'],
      ['simulate_shared_state', { state, squad: ['리타'] }, 'shared'],
      ['inspect_browser_state', {}, 'inspect'],
      ['simulate_browser_state', { squad: ['리타'] }, 'shared'],
      ['compare_browser_growth', { name: '민트', scenarios: [{ label: 'SR5', changes: { collection: { stage: 'SR5' } } }] }, 'growth'],
    ];
    for (const [tool, args, kind] of cases) {
      const response = await client.call(tool, { ...args, connection_code: code });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured['status'], 'queued');
      const job = relay.poll(token)['job'] as Record<string, any>;
      assert.equal(job['kind'], kind);
      if (kind === 'growth') assert.deepEqual(job['scenarios'][0]['changes'], { collection: { stage: 'SR5' } });
      relay.finish(token, job['id'], null, 'test cancellation');
    }
    const invalid = await client.call('compare_setups', { connection_code: code,
      requests: [{ squad: ['리타'] }, { squad: ['리타'], enemyDef: 1 }] });
    assert.equal(invalid.isError, true);
    assert.match(invalid.text, /INVALID_SETTINGS/);
    await client.close();
  });
});

describe('relay', () => {
  let now = 100;
  let relay: BrowserRelay;
  let code = '';
  let token = '';
  const state = () => ({ format: 'nikke-calc-mcp', version: 1, battle: {}, roster: {}, decks: [] });
  beforeEach(() => {
    now = 100;
    relay = new BrowserRelay(() => now, 2);
    ({ connectionCode: code, browserToken: token } = relay.connect() as { connectionCode: string; browserToken: string });
  });
  const jobId = (submitted: Record<string, unknown>) => submitted['jobId'] as string;

  it('token isolation and one active job', () => {
    assert.ok(code.length >= 22);
    assert.ok(token.length >= 43);
    assert.throws(() => relay.poll(code), ToolError);
    const job = relay.submit(code, { kind: 'inspect' });
    assert.throws(() => relay.submit(code, { kind: 'inspect' }), /BROWSER_BUSY/);
    assert.equal((relay.poll(token)['job'] as any)['id'], jobId(job));
    assert.equal(relay.poll(token)['job'], null);
    assert.throws(() => {
      const other = relay.connect();
      relay.result(other['connectionCode'], jobId(job));
    }, /JOB_NOT_FOUND/);
    relay.finish(token, jobId(job), null, 'worker failed');
    assert.equal(relay.result(code, jobId(job))['status'], 'failed');
  });

  it('offline and expired results', () => {
    const job = relay.submit(code, { kind: 'inspect' });
    now += 46;
    assert.throws(() => relay.result(code, jobId(job)), /BROWSER_OFFLINE/);
    assert.throws(() => relay.poll(token), ToolError);
  });

  it('result validation and retention', () => {
    const job = relay.submit(code, { kind: 'inspect' });
    assert.throws(() => relay.finish(token, jobId(job), {}), ToolError);
    relay.poll(token);
    relay.finish(token, jobId(job), state());
    assert.deepEqual(relay.result(code, jobId(job))['result'], state());
    assert.throws(() => relay.finish(token, jobId(job), state()), ToolError);
    for (let i = 0; i < 8; i += 1) {
      now += 40;
      relay.poll(token);
    }
    assert.throws(() => relay.result(code, jobId(job)), /JOB_NOT_FOUND/);
  });

  it('session capacity', () => {
    relay.connect();
    assert.throws(() => relay.connect(), /SERVER_BUSY/);
  });

  it('retained results have a global memory budget', () => {
    relay.maxResultBytes = 1;
    const job = relay.submit(code, { kind: 'inspect' });
    relay.poll(token);
    assert.throws(() => relay.finish(token, jobId(job), state()), /SERVER_BUSY/);
  });

  it('oldest completed job is evicted when the session is full', () => {
    const ids: string[] = [];
    for (let i = 0; i < 9; i += 1) {
      const job = relay.submit(code, { kind: 'inspect' });
      ids.push(jobId(job));
      relay.poll(token);
      relay.finish(token, jobId(job), null, 'cancelled');
    }
    assert.throws(() => relay.result(code, ids[0]!), /JOB_NOT_FOUND/);
    assert.equal(relay.result(code, ids[8]!)['status'], 'failed');
  });

  it('comparison requires ranking and candidate count', () => {
    const job = relay.submit(code, { kind: 'simulate', requests: [{}, {}] });
    relay.poll(token);
    const candidate = { engineVersion: 'test', result: {}, effectiveCharacters: [] };
    assert.throws(() => relay.finish(token, jobId(job), { candidates: [candidate, candidate] }), /INVALID_RESULT/);
    const result = { candidates: [candidate, candidate], testedCandidates: 2, ranking: [2, 1] };
    relay.finish(token, jobId(job), result);
    assert.deepEqual(relay.result(code, jobId(job))['result'], result);
  });

  it('absolute expiry despite heartbeat', () => {
    for (let i = 0; i < 179; i += 1) {
      now += 40;
      relay.poll(token);
    }
    now += 40;
    assert.throws(() => relay.poll(token), /BROWSER_OFFLINE/);
  });

  it('busy heartbeat does not dequeue the next job', () => {
    const job = relay.submit(code, { kind: 'inspect' });
    for (let i = 0; i < 2; i += 1) {
      now += 40;
      assert.equal(relay.poll(token, false)['job'], null);
    }
    assert.equal(relay.result(code, jobId(job))['status'], 'queued');
    assert.equal((relay.poll(token)['job'] as any)['id'], jobId(job));
  });

  it('active job times out despite live heartbeats', () => {
    const job = relay.submit(code, { kind: 'inspect' });
    relay.poll(token);
    for (let i = 0; i < 8; i += 1) {
      now += 40;
      relay.poll(token, false);
    }
    const result = relay.result(code, jobId(job));
    assert.equal(result['status'], 'failed');
    assert.match(result['error'] as string, /JOB_TIMEOUT/);
    assert.throws(() => relay.finish(token, jobId(job), null, 'late result'), /JOB_NOT_FOUND/);
    relay.submit(code, { kind: 'inspect' });
  });
});

describe('overload plan relay', () => {
  it('goals and calculation relay without engine exchange', async () => {
    const submitted: Array<[unknown, unknown]> = [];
    class RecordingRelay extends BrowserRelay {
      override submit(code: unknown, payload: Record<string, unknown>) {
        submitted.push([code, payload]);
        return { status: 'queued', jobId: 'job' };
      }
    }
    const client = await connect({ browserMode: true, relay: new RecordingRelay() });
    const names = new Set((await client.listTools()).map((tool) => tool.name));
    assert.ok(!names.has('import_overload_plan_result'));
    for (const name of ['export_overload_plan', 'calculate_overload_plan', 'simulate_browser_state']) assert.ok(names.has(name));
    await client.call('export_overload_plan', { connection_code: 'example' });
    assert.deepEqual(submitted.at(-1), ['example', { kind: 'module-export' }]);
    await client.call('calculate_overload_plan', { connection_code: 'example' });
    assert.deepEqual(submitted.at(-1), ['example', { kind: 'module-calculate' }]);
    await client.close();
  });

  it('real relay accepts browser goal and calculation results', () => {
    const relay = new BrowserRelay();
    const session = relay.connect() as Record<string, string>;
    const cases: Array<[string, Record<string, unknown>]> = [
      ['module-export', { execution: 'user-browser', busy: false, lockCurrency: 'keys', decks: [{ characters: [] }] }],
      ['module-calculate', { execution: 'user-browser', decks: [{ before: 100, after: 120 }], modules: [] }],
    ];
    for (const [kind, result] of cases) {
      const submitted = relay.submit(session['connectionCode'], { kind });
      relay.poll(session['browserToken']);
      relay.finish(session['browserToken'], submitted['jobId'] as string, result);
      assert.deepEqual(relay.result(session['connectionCode'], submitted['jobId'] as string)['result'], result);
    }
  });
});
