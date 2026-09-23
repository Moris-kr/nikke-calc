// py: nikke_mcp/test_render.py
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UsageError, parseConfig } from './main.ts';

const HTTP = ['--transport', 'streamable-http', '--host', '0.0.0.0'];

describe('Render configuration', () => {
  it('uses the Render port and the exact public host', () => {
    const config = parseConfig([...HTTP, '--public'], {
      PORT: '10000', RENDER_EXTERNAL_HOSTNAME: 'nikke-example.onrender.com', NIKKE_MCP_MAX_CONCURRENT: '1', NIKKE_MCP_TIMEOUT: '120',
    });
    assert.equal(config.port, 10000);
    assert.ok(config.allowedHosts.includes('nikke-example.onrender.com'));
    assert.ok(!config.allowedHosts.includes('*.onrender.com'));
    assert.ok(config.allowedOrigins.includes('https://nikke-example.onrender.com'));
    assert.deepEqual([config.timeout, config.maxConcurrent, config.transport], [120, 1, 'streamable-http']);
  });

  it('public binding still requires explicit opt-in', () => {
    assert.throws(() => parseConfig(HTTP, { RENDER_EXTERNAL_HOSTNAME: 'example.onrender.com' }), UsageError);
    assert.throws(() => parseConfig([...HTTP, '--public'], {}), UsageError);
  });

  it('defaults, allowed hosts and environment limits', () => {
    const local = parseConfig([], {});
    assert.deepEqual([local.transport, local.host, local.port, local.timeout, local.maxConcurrent], ['stdio', '127.0.0.1', 8000, 60, 2]);
    const hosts = parseConfig([...HTTP, '--public'], { NIKKE_MCP_ALLOWED_HOSTS: ' a.example , 127.0.0.1:8000 ,' });
    assert.deepEqual(hosts.allowedHosts, ['127.0.0.1:*', 'localhost:*', '[::1]:*', 'a.example', '127.0.0.1:8000']);
    assert.deepEqual(hosts.allowedOrigins, ['http://127.0.0.1:*', 'http://localhost:*', 'https://a.example', 'https://127.0.0.1:8000']);
    const flag = parseConfig([...HTTP, '--public', '--allowed-host', 'b.example'], { NIKKE_MCP_ALLOWED_HOSTS: 'a.example' });
    assert.ok(flag.allowedHosts.includes('b.example') && !flag.allowedHosts.includes('a.example'));
    for (const env of [{ NIKKE_MCP_TIMEOUT: '0' }, { NIKKE_MCP_TIMEOUT: '301' }, { NIKKE_MCP_MAX_CONCURRENT: '9' }, { NIKKE_MCP_TIMEOUT: 'x' }]) {
      assert.throws(() => parseConfig([], env), UsageError);
    }
    assert.throws(() => parseConfig(['--transport', 'sse'], {}), UsageError);
  });
});
