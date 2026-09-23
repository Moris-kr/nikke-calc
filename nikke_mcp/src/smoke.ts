/** Verify the installed MCP over stdio or a supplied HTTP URL. (py: nikke_mcp/smoke.py) */
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

type Structured = Record<string, any>;

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? '').join('\n');
  return { isError: Boolean(result.isError), text, structured: result.structuredContent as Structured | undefined };
}

/** Pair a synthetic browser: validate relay transport without server computation. */
export async function exerciseBrowserRelay(client: Client, url: string): Promise<Record<string, unknown>> {
  const base = url.replace(/\/mcp$/, '');
  const post = async (action: string, body: unknown) => {
    const response = await fetch(`${base}/browser/${action}`, {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', Origin: 'https://moris-kr.github.io' }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`/browser/${action} → ${response.status} ${await response.text()}`);
    return response.json() as Promise<Structured>;
  };
  const connection = await post('connect', {});
  const { connectionCode: code, browserToken: token } = connection;
  try {
    const missing = await call(client, 'simulate_squad', { request: { squad: ['리타'], duration: 2 } });
    if (!missing.isError || !missing.text.includes('CONNECTION_REQUIRED')) throw new Error('HTTP must require a browser connection');
    const queued = await call(client, 'simulate_squad', { connection_code: code, request: { squad: ['리타'], duration: 2 } });
    if (queued.isError || queued.structured?.['status'] !== 'queued') throw new Error('Browser job was not queued');
    const jobId = queued.structured['jobId'];
    const { job } = await post('poll', { browserToken: token });
    if (job.id !== jobId || job.kind !== 'simulate' || job.requests[0].duration !== 2) throw new Error('Browser job payload mismatch');
    const fixture = { engineVersion: 'browser-relay-smoke', result: { squadTotal: 123 }, effectiveCharacters: [] };
    await post('result', { browserToken: token, jobId, result: fixture });
    const result = await call(client, 'get_browser_result', { connection_code: code, job_id: jobId });
    if (result.isError || JSON.stringify(result.structured) !== JSON.stringify({ status: 'complete', result: fixture })) {
      throw new Error('Browser result relay mismatch');
    }
    return fixture;
  } finally {
    await post('disconnect', { browserToken: token });
  }
}

/** Local stdio: a real calculation and a shared-state calculation. */
export async function exerciseLocal(client: Client): Promise<string> {
  const result = await call(client, 'simulate_squad', { request: { squad: ['리타'], duration: 2 } });
  if (result.isError || !result.structured) throw new Error('MCP 계산 검증 실패');
  const shared = await call(client, 'simulate_shared_state', { state: {
    format: 'nikke-calc-mcp', version: 1, battle: { duration: 2, synchroLevel: 321 },
    roster: { '리타': { skillLevels: { 1: 4, 2: 5, 3: 6 } } }, decks: [] }, squad: ['리타'] });
  if (shared.isError || shared.structured?.['effectiveCharacters'][0].level !== 321) throw new Error('공유 육성 계산 검증 실패');
  return result.structured['engineVersion'];
}

export function stdioTransport(cwd?: string): StdioClientTransport {
  return new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL('../launch.mjs', import.meta.url))],
    ...(cwd && { cwd }), stderr: 'inherit',
  });
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const index = argv.indexOf('--url');
  const url = index >= 0 ? argv[index + 1] : undefined;
  if (index >= 0 && !url) throw new Error('--url 예: http://127.0.0.1:8000/mcp');
  const client = new Client({ name: 'nikke-mcp-smoke', version: '1.0.0' });
  await client.connect(url ? new StreamableHTTPClientTransport(new URL(url)) : stdioTransport());
  try {
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    if (url) {
      await exerciseBrowserRelay(client, url);
      console.log(JSON.stringify({ status: 'OK', mode: 'browser-relay', tools }));
      return;
    }
    const engineVersion = await exerciseLocal(client);
    console.log(JSON.stringify({ status: 'OK', tools, engineVersion }));
  } finally {
    await client.close();
  }
}
