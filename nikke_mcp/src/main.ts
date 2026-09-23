/** NIKKE MCP · stdio 또는 Streamable HTTP. (py: nikke_mcp/server.py main) */
import { NikkeServer } from './server.ts';
import { listen, runStdio } from './transport.ts';

export class UsageError extends Error {}

export interface Config {
  transport: 'stdio' | 'streamable-http';
  host: string;
  port: number;
  timeout: number;
  maxConcurrent: number;
  allowedHosts: string[];
  allowedOrigins: string[];
}

const USAGE = 'usage: nikke_mcp [-h] [--transport {stdio,streamable-http}] [--host HOST] [--port PORT] [--public] [--allowed-host ALLOWED_HOST]';

function integer(text: string): number | null {
  const trimmed = text.trim().replace(/_/g, '');
  return /^[+-]?\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** argparse-compatible option parsing and the same safety rules as the Python server. */
export function parseConfig(argv: string[], env: Record<string, string | undefined>): Config {
  let transport = 'stdio';
  let host = '127.0.0.1';
  let portText = env['PORT'] ?? '8000';
  let isPublic = false;
  const allowed: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = () => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined) throw new UsageError(`argument ${flag}: expected one argument`);
      i += 1;
      return next;
    };
    if (flag === '--transport') {
      transport = value();
      if (transport !== 'stdio' && transport !== 'streamable-http') {
        throw new UsageError(`argument --transport: invalid choice: '${transport}' (choose from stdio, streamable-http)`);
      }
    } else if (flag === '--host') host = value();
    else if (flag === '--port') portText = value();
    else if (flag === '--public') isPublic = true;
    else if (flag === '--allowed-host') allowed.push(value());
    else throw new UsageError(`unrecognized arguments: ${arg}`);
  }
  const port = integer(portText);
  if (port === null) throw new UsageError(`argument --port: invalid int value: '${portText}'`);
  const timeout = integer(env['NIKKE_MCP_TIMEOUT'] ?? '60');
  const maxConcurrent = integer(env['NIKKE_MCP_MAX_CONCURRENT'] ?? '2');
  if (timeout === null || maxConcurrent === null || !(timeout >= 1 && timeout <= 300) || !(maxConcurrent >= 1 && maxConcurrent <= 8)) {
    throw new UsageError('NIKKE_MCP_TIMEOUT은 1~300, NIKKE_MCP_MAX_CONCURRENT는 1~8 정수여야 합니다.');
  }
  const hosts = allowed.length ? [...allowed] : (env['NIKKE_MCP_ALLOWED_HOSTS'] ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  // Render injects this exact hostname; never allow every onrender.com tenant.
  const renderHost = (env['RENDER_EXTERNAL_HOSTNAME'] ?? '').trim();
  if (renderHost) hosts.push(renderHost);
  if (transport === 'streamable-http' && !['127.0.0.1', 'localhost', '::1'].includes(host) && (!isPublic || !hosts.length)) {
    throw new UsageError('외부 바인딩에는 --public 및 --allowed-host 또는 NIKKE_MCP_ALLOWED_HOSTS가 필요합니다.');
  }
  const allowedHosts = ['127.0.0.1:*', 'localhost:*', '[::1]:*', ...hosts];
  return {
    transport: transport as Config['transport'], host, port, timeout, maxConcurrent, allowedHosts,
    allowedOrigins: ['http://127.0.0.1:*', 'http://localhost:*', ...allowedHosts.filter((h) => !h.endsWith(':*')).map((h) => `https://${h}`)],
  };
}

export async function main(argv = process.argv.slice(2), env: Record<string, string | undefined> = process.env): Promise<void> {
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(`${USAGE}\n\nNIKKE MCP · stdio 또는 Streamable HTTP\n`);
    return;
  }
  let config: Config;
  try {
    config = parseConfig(argv, env);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${USAGE}\nnikke_mcp: error: ${error.message}\n`);
    process.exit(2);
  }
  const nikke = new NikkeServer({ timeout: config.timeout, maxConcurrent: config.maxConcurrent, browserMode: config.transport === 'streamable-http' });
  if (config.transport === 'stdio') {
    runStdio(nikke);
    return;
  }
  const server = await listen(nikke, {
    host: config.host, port: config.port, allowedHosts: config.allowedHosts, allowedOrigins: config.allowedOrigins,
    maxRequestBodySize: 1048576,
  });
  process.stderr.write(`NIKKE MCP listening on http://${config.host}:${config.port}/mcp\n`);
  const stop = () => server.close(() => process.exit(0));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
