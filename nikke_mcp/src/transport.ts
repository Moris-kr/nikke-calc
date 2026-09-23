/**
 * MCP transports on the official TypeScript SDK v2 (`@modelcontextprotocol/server`): stdio (Claude Desktop)
 * and stateless streamable HTTP (the public relay), each serving both protocol eras like the Python server
 * (mcp 2.2.0) did — the 2025 `initialize` handshake (2024-11-05 … 2025-11-25) and the 2026-07-28
 * per-request envelope.
 *
 * JSON-RPC is parsed with {@link parseJson} so tool arguments keep Python's int/float distinction, exactly
 * as the Python server validated them.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  Server, WebStandardStreamableHTTPServerTransport, createMcpHandler, isSpecType, type JSONRPCMessage, type McpHttpHandler,
  type Transport,
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { handleBrowserRoute } from './browser_relay.ts';
import { classifyEnvelope, isJsonRpcNotification, isJsonRpcRequest } from './jsonrpc.ts';
import { readBody } from './http_body.ts';
import { engine_version } from './engine.ts';
import { isDict, parseJson, unbox } from './pyjson.ts';
import { INSTRUCTIONS, NikkeServer, SERVER_NAME, SERVER_VERSION } from './server.ts';

export type Era = 'legacy' | 'modern';

/** Protocol revisions reachable through the `initialize` handshake (Python `HANDSHAKE_PROTOCOL_VERSIONS`). */
const HANDSHAKE_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];

/** Unbox everything except `tools/call` arguments (validated later with Python number types). */
export function prepareMessage(message: unknown): unknown {
  if (Array.isArray(message)) return message.map(prepareMessage);
  if (!isDict(message)) return unbox(message);
  if (message['method'] === 'tools/call' && isDict(message['params'])) {
    const { arguments: args, ...params } = message['params'];
    const out = unbox({ ...message, params });
    if (args !== undefined) (out['params'] as Record<string, unknown>)['arguments'] = args;
    return out;
  }
  return unbox(message);
}

type Guard = (value: unknown) => boolean;
const PARAMS: Record<string, Guard> = {
  initialize: isSpecType.InitializeRequest, ping: isSpecType.PingRequest, 'tools/list': isSpecType.ListToolsRequest,
  'tools/call': isSpecType.CallToolRequest, 'resources/list': isSpecType.ListResourcesRequest,
  'resources/templates/list': isSpecType.ListResourceTemplatesRequest, 'resources/read': isSpecType.ReadResourceRequest,
  'prompts/list': isSpecType.ListPromptsRequest, 'prompts/get': isSpecType.GetPromptRequest,
  'subscriptions/listen': isSpecType.SubscriptionsListenRequest,
};

/** Requests the Python server answered, per era; anything else was `-32601` naming the method. */
const SERVED: Record<Era, ReadonlySet<string>> = {
  legacy: new Set(['initialize', 'ping', 'tools/list', 'tools/call', 'resources/list', 'resources/templates/list',
    'resources/read', 'prompts/list', 'prompts/get']),
  modern: new Set(['server/discover', 'subscriptions/listen', 'tools/list', 'tools/call', 'resources/list',
    'resources/templates/list', 'resources/read', 'prompts/list', 'prompts/get']),
};

const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';

/** A request carrying the 2026-07-28 per-request envelope. */
export function isEnveloped(message: unknown): boolean {
  return isDict(message) && isDict(message['params']) && isDict(message['params']['_meta'])
    && Object.hasOwn(message['params']['_meta'], PROTOCOL_VERSION_META_KEY);
}

function errorReply(id: unknown, code: number, message: string, data?: unknown): { reply: JSONRPCMessage } {
  return { reply: { jsonrpc: '2.0', id: id as string | number, error: { code, message, ...(data !== undefined && { data }) } } as JSONRPCMessage };
}

/**
 * Python-server request semantics the SDK does not share: `params: null` and `arguments: null` mean
 * "absent"; a method the era does not serve is `-32601` with the method as `data`; a 2026-07-28 request
 * cannot `initialize`; and params that fail the method schema get `-32602 Invalid request parameters`.
 */
export function preflight(raw: unknown, channel: 'stdio' | 'http' = 'stdio'): { message: JSONRPCMessage } | { reply: JSONRPCMessage } | { drop: true } {
  const message = prepareMessage(raw);
  if (isDict(message) && typeof message['method'] === 'string' && Object.hasOwn(message, 'id')) {
    if (message['params'] === null) delete message['params'];
    const params = message['params'];
    const method = message['method'];
    const era: Era = isEnveloped(message) ? 'modern' : 'legacy';
    const wellFormed = (params === undefined || isDict(params)) && isSpecType.JSONRPCRequest({ ...message, params: {} });
    // stdio pins a 2026 connection that then refuses the handshake; the HTTP entry just has no such method.
    if (wellFormed && era === 'modern' && method === 'initialize' && channel === 'stdio') {
      return errorReply(message['id'], -32022, 'connection is serving the 2026-07-28 protocol; the initialize handshake is not accepted',
        { supported: ['2026-07-28'] });
    }
    if (wellFormed && !SERVED[era].has(method)) return errorReply(message['id'], -32601, 'Method not found', method);
    if (method === 'tools/call' && isDict(params) && params['arguments'] === null) delete params['arguments'];
    const guard = PARAMS[method];
    if (guard && wellFormed && !guard(message)) return errorReply(message['id'], -32602, 'Invalid request parameters', '');
  }
  return isSpecType.JSONRPCMessage(message) ? { message: message as JSONRPCMessage } : { drop: true };
}

/** A JSON-RPC error with an exact message (no SDK prefix). */
function rpcError(code: number, message: string, data?: unknown): Error {
  return Object.assign(new Error(message), { code, ...(data !== undefined && { data }) });
}

/** What the Python server advertised: `initialize` (2025 era) and `server/discover` (2026-07-28) differ. */
const CAPABILITIES = {
  legacy: {
    experimental: {},
    prompts: { listChanged: false },
    resources: { subscribe: false, listChanged: false },
    tools: { listChanged: false },
  },
  modern: {
    prompts: { listChanged: true },
    resources: { listChanged: true, subscribe: true },
    tools: { listChanged: true },
  },
};

/** One SDK `Server` bound to the shared tool registry (the serving entries build one per era/request). */
export function sdkServer(nikke: NikkeServer, era: Era = 'legacy'): Server {
  // The low-level server (deprecated in favour of McpServer) keeps the Python wire shapes exactly.
  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: CAPABILITIES[era], instructions: INSTRUCTIONS });
  server.setRequestHandler('tools/list', () => ({ tools: nikke.listTools() }) as never);
  server.setRequestHandler('tools/call', async (request) =>
    (await nikke.callTool(request.params.name, request.params.arguments as Record<string, unknown> | undefined)) as never);
  server.setRequestHandler('resources/list', () => ({ resources: [] }));
  server.setRequestHandler('resources/templates/list', () => ({ resourceTemplates: [] }));
  server.setRequestHandler('prompts/list', () => ({ prompts: [] }));
  server.setRequestHandler('resources/read', (request) => {
    throw rpcError(-32602, `Unknown resource: ${request.params.uri}`, { uri: request.params.uri });
  });
  server.setRequestHandler('prompts/get', (request) => {
    // The Python server raised a non-protocol error: legacy framing kept code 0, the 2026 entry masked it.
    throw era === 'modern' ? rpcError(-32603, 'Internal server error') : rpcError(0, `Unknown prompt: ${request.params.name}`);
  });
  server.fallbackRequestHandler = async (request) => {
    throw rpcError(-32601, 'Method not found', request.method);
  };
  return server;
}

/** Newline-delimited JSON-RPC over stdin/stdout, read with Python number semantics. */
export class StdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport['onmessage'];
  private buffer = '';
  private readonly onData = (chunk: Buffer | string) => {
    this.buffer += chunk.toString();
    let index: number;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      try {
        const outcome = preflight(parseJson(line));
        if ('reply' in outcome) void this.send(outcome.reply);
        else if ('message' in outcome) this.onmessage?.(outcome.message);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

  constructor(private readonly input: NodeJS.ReadableStream = process.stdin, private readonly output: NodeJS.WritableStream = process.stdout) {}

  async start(): Promise<void> {
    this.input.setEncoding?.('utf8');
    this.input.on('data', this.onData);
    this.input.on('end', () => void this.close());
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve) => {
      if (this.output.write(`${JSON.stringify(message)}\n`)) resolve();
      else this.output.once('drain', resolve);
    });
  }

  async close(): Promise<void> {
    this.input.off('data', this.onData);
    this.onclose?.();
  }
}

/** stdio for both eras: the opening message (`initialize` or an enveloped request) selects the era. */
export function runStdio(nikke: NikkeServer): void {
  serveStdio((ctx) => sdkServer(nikke, ctx.era), {
    transport: new StdioTransport(),
    onerror: (error) => process.stderr.write(`MCP stdio: ${error.message}\n`),
  });
}

export interface HttpOptions {
  host: string;
  port: number;
  allowedHosts: string[];
  allowedOrigins: string[];
  maxRequestBodySize: number;
}

function matches(value: string, allowed: string[]): boolean {
  return allowed.some((pattern) => value === pattern || (pattern.endsWith(':*') && value.startsWith(`${pattern.slice(0, -2)}:`)));
}

function plain(res: ServerResponse, status: number, text: string, contentType: string | null = 'text/plain; charset=utf-8',
  extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...(contentType && { 'content-type': contentType }), 'content-length': String(Buffer.byteLength(text)), ...extra });
  res.end(text);
}

function json(res: ServerResponse, status: number, value: unknown): void {
  plain(res, status, JSON.stringify(value), 'application/json');
}

/** JSON-RPC error without an id, as the Python transport rejected a request before dispatch. */
function rpcReject(res: ServerResponse, status: number, message: string, code = -32600, extra: Record<string, string> = {}): void {
  plain(res, status, JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } }), 'application/json', extra);
}

/** (has JSON, has SSE) with RFC 7231 wildcards, as `check_accept_headers`. */
function accepts(req: IncomingMessage): [boolean, boolean] {
  const types = String(req.headers.accept ?? '').split(',').map((t) => t.trim().split(';')[0]!.trim().toLowerCase());
  const any = types.includes('*/*');
  return [any || types.includes('application/json') || types.includes('application/*'), any || types.includes('text/event-stream') || types.includes('text/*')];
}

/** Stateless mode keeps no server-initiated messages: an idle event stream, like the Python server's. */
function idleEventStream(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'content-type': 'text/event-stream; charset=utf-8' });
  res.flushHeaders();
  const ping = setInterval(() => res.write(`: ping - ${new Date().toISOString().replace('T', ' ').replace('Z', '000+00:00')}\r\n\r\n`), 15000);
  req.on('close', () => clearInterval(ping));
}

/** The request as a web-standard `Request` (the body is the bytes already read). */
function webRequest(req: IncomingMessage, body: Buffer, accept?: string): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || name.startsWith(':')) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }
  if (accept) headers.set('accept', accept);
  const method = (req.method ?? 'GET').toUpperCase();
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, {
    method, headers, ...(method !== 'GET' && method !== 'HEAD' && { body: new Uint8Array(body) }),
  });
}

async function sendWeb(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  for (const [name, value] of response.headers) headers[name] = value;
  res.writeHead(response.status, headers);
  if (response.body === null) {
    res.end();
    return;
  }
  for await (const chunk of response.body) {
    if (!res.write(chunk)) await new Promise((resolve) => res.once('drain', resolve));
  }
  res.end();
}

/** Python's era routing is header-only: a non-handshake `MCP-Protocol-Version` goes to the 2026-07-28 entry. */
function isModern(req: IncomingMessage): boolean {
  const header = req.headers['mcp-protocol-version'];
  const version = Array.isArray(header) ? header[0] : header;
  return version !== undefined && !HANDSHAKE_PROTOCOL_VERSIONS.includes(version);
}

/** A 2025-era POST: a fresh server over a stateless JSON-response transport, as the Python server served it. */
async function serveLegacy(nikke: NikkeServer, req: IncomingMessage, res: ServerResponse, body: Buffer, message: unknown): Promise<void> {
  const server = sdkServer(nikke);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    // The SDK insists on both media types even in JSON mode; the Python server needed only JSON.
    await sendWeb(res, await transport.handleRequest(webRequest(req, body, 'application/json, text/event-stream'), { parsedBody: message }));
  } finally {
    void transport.close();
    void server.close();
  }
}

/** HTTP status for a JSON-RPC error code on the 2026-07-28 entry (Python `ERROR_CODE_HTTP_STATUS`). */
const ERROR_STATUS: Record<number, number> = { [-32700]: 400, [-32600]: 400, [-32602]: 400, [-32020]: 400, [-32021]: 400, [-32022]: 400, [-32601]: 404 };
const NAME_BEARING_METHODS: Record<string, string> = { 'tools/call': 'name', 'prompts/get': 'name', 'resources/read': 'uri' };
const ROUTING_HEADERS = new Set(['mcp-protocol-version', 'mcp-method', 'mcp-name']);
const MODERN_VERSIONS = ['2026-07-28'];
const CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';

function modernError(res: ServerResponse, id: unknown, code: number, message: string, data?: unknown): void {
  json(res, ERROR_STATUS[code] ?? 200, { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined && { data }) } });
}

const INVALID_BODY = 'Body must be a single JSON-RPC request or notification object';

/** `=?base64?…?=` header values (Python `decode_header_value`). */
function decodeHeaderValue(value: string | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  const match = /^=\?base64\?(.*)\?=$/s.exec(value);
  if (!match) return value;
  const payload = match[1]!;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || payload.length % 4 !== 0) return null;
  const decoded = Buffer.from(payload, 'base64');
  if (decoded.toString('base64') !== payload) return null;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(decoded);
  return Buffer.from(text, 'utf8').equals(decoded) ? text : null;
}

function unsupportedVersion(requested: string): { code: number; message: string; data: unknown } | null {
  return MODERN_VERSIONS.includes(requested) ? null
    : { code: -32022, message: 'Unsupported protocol version', data: { supported: MODERN_VERSIONS, requested } };
}

/** Python `classify_inbound_request` with headers: the first failing rung, or `null`. */
function modernLadder(body: Record<string, any>, req: IncomingMessage): { code: number; message: string; data?: unknown } | null {
  const meta = isDict(body['params']) ? body['params']['_meta'] : undefined;
  if (!isDict(meta)) {
    return { code: -32602, message: `params._meta must be an object carrying the required '${PROTOCOL_VERSION_META_KEY}' and '${CLIENT_CAPABILITIES_META_KEY}' envelope keys` };
  }
  const missing = [PROTOCOL_VERSION_META_KEY, CLIENT_CAPABILITIES_META_KEY].filter((key) => !Object.hasOwn(meta, key));
  if (missing.length) return { code: -32602, message: `params._meta is missing the required envelope key(s): ${missing.join(', ')}` };
  const version = unbox(meta[PROTOCOL_VERSION_META_KEY]);
  const header = (name: string) => {
    const value = req.headers[name];
    return Array.isArray(value) ? value[value.length - 1] : value;
  };
  if (header('mcp-protocol-version') === undefined || header('mcp-protocol-version') !== version) {
    return { code: -32020, message: "mcp-protocol-version header does not match the request envelope's protocol version" };
  }
  if (header('mcp-method') !== body['method']) return { code: -32020, message: "mcp-method header does not match the request body's method" };
  const nameKey = NAME_BEARING_METHODS[body['method']];
  if (nameKey !== undefined) {
    const value = unbox(body['params'][nameKey]);
    if (value !== null && value !== undefined && decodeHeaderValue(header('mcp-name')) !== value) {
      return { code: -32020, message: `mcp-name header does not match the request body's '${nameKey}' parameter` };
    }
  }
  if (typeof version !== 'string') return { code: -32602, message: 'the protocol-version envelope value must be a string' };
  return unsupportedVersion(version);
}

/** 2026-07-28: one POST, one JSON response (Python `handle_modern_request` in JSON mode). */
async function serveModern(modern: McpHttpHandler, req: IncomingMessage, res: ServerResponse, body: Buffer,
  hasJson: boolean, hasSse: boolean): Promise<void> {
  if (req.method !== 'POST') return plain(res, 405, '', null, { allow: 'POST' });
  if (!hasJson) return plain(res, 406, '', null);
  let decoded: unknown;
  try {
    decoded = parseJson(body.toString('utf8'));
  } catch {
    return modernError(res, null, -32700, 'Parse error');
  }
  if (isDict(decoded) && !Object.hasOwn(decoded, 'id')) {
    if (!isJsonRpcNotification(decoded)) return modernError(res, null, -32600, INVALID_BODY);
    const rejection = unsupportedVersion(String(req.headers['mcp-protocol-version'] ?? ''));
    if (rejection) return modernError(res, null, rejection.code, rejection.message, rejection.data);
    return plain(res, 202, '', null);
  }
  if (!isDict(decoded) || !isJsonRpcRequest(decoded)) return modernError(res, null, -32600, INVALID_BODY);
  const id = unbox(decoded['id']);
  if (decoded['method'] === 'subscriptions/listen' && !hasSse) return plain(res, 406, '', null);
  const seen = new Set<string>();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i]!.toLowerCase();
    if (!ROUTING_HEADERS.has(name)) continue;
    if (seen.has(name)) return modernError(res, id, -32020, `${name} header appears more than once`);
    seen.add(name);
  }
  const rejection = modernLadder(decoded, req);
  if (rejection) return modernError(res, id, rejection.code, rejection.message, rejection.data);
  const outcome = preflight(decoded, 'http');
  if ('reply' in outcome) {
    const error = (outcome.reply as { error: { code: number; message: string; data?: unknown } }).error;
    return modernError(res, id, error.code, error.message, error.data);
  }
  const parsedBody = 'message' in outcome ? outcome.message : prepareMessage(decoded);
  const response = await modern.fetch(webRequest(req, body), { parsedBody });
  if (!(response.headers.get('content-type') ?? '').startsWith('application/json')) return sendWeb(res, response);
  // Handler-origin errors take the same table-mapped HTTP status as ladder rejections (Python `_write`).
  const text = await response.text();
  let status = response.status;
  try {
    const message = JSON.parse(text) as { error?: { code?: number } };
    const code = message.error?.code;
    if (status === 200 && code !== undefined && ERROR_STATUS[code] !== undefined) status = ERROR_STATUS[code]!;
  } catch {
    // not JSON-RPC: pass through
  }
  return plain(res, status, text, response.headers.get('content-type'));
}

async function handleMcp(nikke: NikkeServer, modern: McpHttpHandler, options: HttpOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req, options.maxRequestBodySize);
  if (body === null) return plain(res, 413, 'Request body too large', null);
  if (req.method === 'POST' && !String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    return plain(res, 400, 'Invalid Content-Type header', null);
  }
  const host = req.headers.host;
  if (!host || !matches(host, options.allowedHosts)) return plain(res, 421, 'Invalid Host header', null);
  const origin = req.headers.origin;
  if (origin && !matches(origin, options.allowedOrigins)) return plain(res, 403, 'Invalid Origin header', null);
  const [hasJson, hasSse] = accepts(req);

  if (isModern(req)) return serveModern(modern, req, res, body, hasJson, hasSse);

  if (req.method === 'GET') {
    if (!hasSse) return rpcReject(res, 406, 'Not Acceptable: Client must accept text/event-stream');
    return idleEventStream(req, res);
  }
  if (req.method === 'DELETE') return rpcReject(res, 405, 'Method Not Allowed: Session termination not supported');
  if (req.method !== 'POST') return rpcReject(res, 405, 'Method Not Allowed', -32600, { allow: 'GET, POST, DELETE' });
  if (!hasJson) return rpcReject(res, 406, 'Not Acceptable: Client must accept application/json');
  const contentType = String(req.headers['content-type'] ?? '').split(';')[0]!.split(',').map((p) => p.trim());
  if (!contentType.includes('application/json')) return rpcReject(res, 415, 'Unsupported Media Type: Content-Type must be application/json');
  let parsed: unknown;
  try {
    parsed = parseJson(body.toString('utf8'));
  } catch (error) {
    return rpcReject(res, 400, `Parse error: ${(error as Error).message}`, -32700);
  }
  const envelope = classifyEnvelope(parsed);
  if (typeof envelope !== 'string') return rpcReject(res, 400, `Validation error: ${envelope.toString()}`, -32602);
  // Notifications and responses: accepted, nothing to answer in stateless mode.
  if (envelope !== 'request') return plain(res, 202, '', 'application/json');
  const outcome = preflight(parsed, 'http');
  if ('reply' in outcome) return json(res, 200, outcome.reply);
  return serveLegacy(nikke, req, res, body, 'message' in outcome ? outcome.message : prepareMessage(parsed));
}

export function createHttpServer(nikke: NikkeServer, options: HttpOptions) {
  const modern = createMcpHandler((ctx) => sdkServer(nikke, ctx.era), {
    legacy: 'reject', responseMode: 'json',
    onerror: (error) => process.stderr.write(`MCP HTTP: ${error.message}\n`),
  });
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const known = (p: string) => p === '/mcp' || p === '/health' || (nikke.browserMode && /^\/browser\/(connect|poll|result|disconnect)$/.test(p));
    const route = async () => {
      if (path === '/mcp') return handleMcp(nikke, modern, options, req, res);
      if (path === '/health') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return plain(res, 405, 'Method Not Allowed', undefined, { allow: 'GET, HEAD' });
        return json(res, 200, { status: 'ok', engineVersion: engine_version() });
      }
      const browser = /^\/browser\/(connect|poll|result|disconnect)$/.exec(path);
      if (browser && nikke.browserMode) {
        if (req.method !== 'POST' && req.method !== 'OPTIONS') return plain(res, 405, 'Method Not Allowed', undefined, { allow: 'POST, OPTIONS' });
        return handleBrowserRoute(nikke.relay, req, res, browser[1]!);
      }
      // Starlette redirect_slashes.
      const toggled = path.endsWith('/') ? path.slice(0, -1) : `${path}/`;
      if (path !== '/' && known(toggled)) {
        return plain(res, 307, '', null, { location: `http://${req.headers.host ?? 'localhost'}${toggled}${url.search}` });
      }
      return plain(res, 404, 'Not Found');
    };
    route().catch((error) => {
      process.stderr.write(`HTTP ${req.method} ${path} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      if (!res.headersSent) plain(res, 500, 'Internal Server Error');
      else res.end();
    });
  });
}

export function listen(nikke: NikkeServer, options: HttpOptions): Promise<ReturnType<typeof createHttpServer>> {
  const server = createHttpServer(nikke, options);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve(server));
  });
}
