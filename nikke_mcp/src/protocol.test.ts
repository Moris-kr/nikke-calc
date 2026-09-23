// py: nikke_mcp/test_protocol.py
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { CalculationTimeoutError } from './errors.ts';
import { PyError } from '../../site/src/engine/py.ts';
import { CalculatorService } from './service.ts';
import { exerciseBrowserRelay, stdioTransport } from './smoke.ts';
import { connect, type TestClient } from './testing.ts';

class ThrowingService extends CalculatorService {
  constructor(private readonly error: () => Error) {
    super();
  }

  override simulate(): Promise<Record<string, unknown>> {
    return Promise.reject(this.error());
  }
}

async function exercise(client: { listTools(): Promise<Array<{ name: string }>>; call: TestClient['call'] }) {
  const names = new Set((await client.listTools()).map((tool) => tool.name));
  for (const name of ['get_character', 'get_settings', 'simulate_squad', 'compare_setups']) assert.ok(names.has(name));
  const result = await client.call('simulate_squad', { request: { squad: ['리타'], duration: 2 } });
  assert.equal(result.isError, false, result.text);
  assert.ok(result.structured['result']['squadTotal'] > 0);
  const invalid = await client.call('simulate_squad', { request: { squad: ['리타'], duration: 999 } });
  assert.equal(invalid.isError, true);
  const state = { format: 'nikke-calc-mcp', version: 1, battle: { duration: 2, synchroLevel: 321 },
    roster: { '리타': { skillLevels: { 1: 4, 2: 5, 3: 6 } } }, decks: [] };
  const inspected = await client.call('inspect_shared_state', { state });
  assert.equal(inspected.isError, false);
  assert.equal(inspected.structured['rosterCount'], 1);
  const shared = await client.call('simulate_shared_state', { state, squad: ['리타'] });
  assert.equal(shared.isError, false, shared.text);
  assert.equal(shared.structured['effectiveCharacters'][0]['level'], 321);
}

function wrap(client: Client) {
  return {
    listTools: async () => (await client.listTools()).tools,
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      return { isError: Boolean(result.isError), text: (result.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n'),
        structured: (result.structuredContent ?? {}) as Record<string, any> };
    },
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

describe('protocol', () => {
  it('busy service returns an actionable error', async () => {
    const service = new CalculatorService(60, 1);
    await service.slots.acquire(0);
    try {
      const client = await connect({ service });
      const result = await client.call('simulate_squad', { request: { squad: ['리타'] } });
      assert.equal(result.isError, true);
      assert.match(result.text, /\[SERVER_BUSY\]/);
      assert.match(result.text, /순서대로/);
      await client.close();
    } finally {
      service.slots.release();
    }
  });

  it('expected failures reach the client without masking', async () => {
    const client = await connect();
    for (const [tool, args] of [
      ['compare_setups', { requests: [{ squad: ['리타'] }, { squad: ['리타'], enemyDef: 1 }] }],
      ['get_character', { name: 'unknown' }],
    ] as const) {
      const result = await client.call(tool, args);
      assert.equal(result.isError, true);
      assert.match(result.text, /\[INVALID_SETTINGS\]/);
    }
    await client.close();
    const timeout = await connect({ service: new ThrowingService(() => new CalculationTimeoutError('계산 시간 제한')) });
    const result = await timeout.call('simulate_squad', { request: { squad: ['리타'] } });
    assert.equal(result.isError, true);
    assert.match(result.text, /\[CALCULATION_TIMEOUT\]/);
    await timeout.close();
  });

  it('unexpected exceptions stay private', async () => {
    const errors = [() => new Error('PRIVATE_INTERNAL_DETAIL'), () => new PyError('ValueError', 'PRIVATE_INTERNAL_DETAIL'),
      () => new PyError('KeyError', 'PRIVATE_INTERNAL_DETAIL'), () => new TypeError('PRIVATE_INTERNAL_DETAIL')];
    const stderr = process.stderr.write;
    process.stderr.write = () => true;
    try {
      for (const error of errors) {
        const client = await connect({ service: new ThrowingService(error) });
        const result = await client.call('simulate_squad', { request: { squad: ['리타'] } });
        assert.equal(result.isError, true);
        assert.doesNotMatch(result.text, /PRIVATE_INTERNAL_DETAIL/);
        await client.close();
      }
    } finally {
      process.stderr.write = stderr;
    }
  });

  it('worker error details are not published', async () => {
    for (const output of [{ error: 'PRIVATE_INTERNAL_DETAIL' }, 'PRIVATE_INTERNAL_DETAIL']) {
      const client = await connect({ service: new CalculatorService(60, 2, async () => output) });
      const result = await client.call('simulate_squad', { request: { squad: ['리타'] } });
      assert.equal(result.isError, true);
      assert.match(result.text, /\[ENGINE_PROCESS_FAILED\]/);
      assert.doesNotMatch(result.text, /PRIVATE_INTERNAL_DETAIL/);
      await client.close();
    }
  });

  it('in-memory protocol', async () => {
    const client = await connect();
    await exercise(client);
    await client.close();
  });

  it('stdio from an unrelated working directory', async () => {
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(stdioTransport(tmpdir()));
    try {
      await exercise(wrap(client));
    } finally {
      await client.close();
    }
  });

  it('stdio negotiates the 2026-07-28 era', async () => {
    const client = new Client({ name: 'test', version: '1' }, { versionNegotiation: { mode: 'auto' } });
    await client.connect(stdioTransport(tmpdir()));
    try {
      assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
      await exercise(wrap(client));
    } finally {
      await client.close();
    }
  });

  it('HTTP transport and host validation', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [fileURLToPath(new URL('../launch.mjs', import.meta.url)), '--transport', 'streamable-http', '--port', String(port)],
      { stdio: 'ignore' });
    const url = `http://127.0.0.1:${port}`;
    try {
      let ready = false;
      for (let i = 0; i < 100 && !ready; i += 1) {
        try {
          ready = (await fetch(`${url}/health`)).status === 200;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      assert.ok(ready, 'HTTP server did not start');
      const client = new Client({ name: 'test', version: '1' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
      await exerciseBrowserRelay(client, `${url}/mcp`);
      await client.close();
      const modern = new Client({ name: 'test', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
      await modern.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
      assert.equal(modern.getNegotiatedProtocolVersion(), '2026-07-28');
      await exerciseBrowserRelay(modern, `${url}/mcp`);
      await modern.close();
      // fetch() cannot override Host; use a raw request.
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port, path: '/mcp', method: 'POST',
          headers: { Host: 'untrusted.example', 'Content-Type': 'application/json', 'Content-Length': 2 } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        req.on('error', reject);
        req.end('{}');
      });
      assert.equal(status, 421);
    } finally {
      child.kill();
    }
  });
});
