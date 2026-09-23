/** Bounded, ephemeral browser capability relay. No calculation runs here. (py: nikke_mcp/browser_relay.py) */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { sum } from '../../site/src/engine/py.ts';
import { ToolError, fail } from './errors.ts';
import { PyInt, isDict, numberOf, parseJson, pyDumps, unbox, utf8Length } from './pyjson.ts';
import { hashKey, pyEqual, pyGet, pyItem, pyIter, pyLenOf, pySet, pyTruthy } from './pyeq.ts';
import { SharedState } from './shared_state.ts';
import { readBody } from './http_body.ts';

export const ALLOWED_ORIGINS = new Set(['https://moris-kr.github.io', 'http://localhost:5173',
  'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174']);
export const REQUEST_LIMIT = 1024 * 1024;
export const RESULT_LIMIT = 4 * REQUEST_LIMIT;

/** Python `secrets.token_urlsafe(n)`. */
function tokenUrlsafe(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

/** Python `secrets.compare_digest` for str. */
function compareDigest(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

interface Job {
  payload?: Record<string, unknown>;
  status: 'queued' | 'running' | 'failed' | 'complete';
  started: number;
  timeout: number;
  error?: string;
  finished?: number;
  resultJson?: string;
  result?: unknown;
}

interface Session {
  token: string;
  expires: number;
  heartbeat: number;
  jobs: Map<string, Job>;
}

/** JSON-derived number (Python `type(x) in (int, float)`; bool excluded). */
function isNumber(value: unknown): boolean {
  return numberOf(value) !== null;
}

function numberValue(value: unknown): number {
  return numberOf(value)!;
}

function isInt(value: unknown): boolean {
  return (typeof value === 'number' && Number.isInteger(value)) || value instanceof PyInt;
}

function isClose(a: number, b: number, relTol: number, absTol: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const diff = Math.abs(b - a);
  return diff <= Math.abs(relTol * b) || diff <= Math.abs(relTol * a) || diff <= absTol;
}

function invalid(): never {
  throw new TypeError('invalid');
}

export class BrowserRelay {
  maxResultBytes = 32 * REQUEST_LIMIT;
  readonly sessions = new Map<string, Session>();

  constructor(private readonly clock: () => number = () => performance.now() / 1000, readonly maxSessions = 32) {}

  private prune(): void {
    const now = this.clock();
    for (const [code, session] of [...this.sessions]) {
      if (now >= session.expires || now - session.heartbeat > 45) {
        this.sessions.delete(code);
        continue;
      }
      for (const [key, job] of [...session.jobs]) {
        if ((job.status === 'queued' || job.status === 'running') && now - job.started >= job.timeout) {
          job.status = 'failed';
          job.error = '[JOB_TIMEOUT] 브라우저 작업 제한 시간을 넘었습니다. 후보나 전투 시간을 줄여 재시도하세요.';
          job.finished = now;
          delete job.payload;
        }
        if (job.finished !== undefined && now - job.finished >= 300) session.jobs.delete(key);
      }
    }
  }

  private session(key: unknown, browser = false): Session {
    this.prune();
    if (typeof key !== 'string' || !key) fail('CONNECTION_REQUIRED', '계산기에서 AI 연결을 켜고 연결 코드를 전달하세요.');
    const session = browser ? [...this.sessions.values()].find((s) => compareDigest(s.token, key)) : this.sessions.get(key);
    if (!session) fail('BROWSER_OFFLINE', '연결이 만료되었거나 브라우저가 오프라인입니다. 계산기에서 다시 연결하세요.');
    return session;
  }

  connect(): Record<string, unknown> {
    this.prune();
    if (this.sessions.size >= this.maxSessions) fail('SERVER_BUSY', '연결 한도입니다. 잠시 후 다시 연결하세요.');
    const code = tokenUrlsafe(16);
    const token = tokenUrlsafe(32);
    this.sessions.set(code, { token, expires: this.clock() + 7200, heartbeat: this.clock(), jobs: new Map() });
    return { connectionCode: code, browserToken: token, expiresIn: 7200 };
  }

  /** `payload` may hold {@link PyFloat} values: its size is measured as Python's `json.dumps`. */
  submit(code: unknown, payload: Record<string, unknown>): Record<string, unknown> {
    const session = this.session(code);
    if (utf8Length(pyDumps(payload, { ensureAscii: false })) > REQUEST_LIMIT) fail('INVALID_SETTINGS', '요청이 너무 큽니다.');
    const jobs = session.jobs;
    if ([...jobs.values()].some((j) => j.status === 'queued' || j.status === 'running')) {
      fail('BROWSER_BUSY', '기존 작업 결과를 확인한 뒤 순서대로 실행하세요.');
    }
    if (jobs.size >= 8) jobs.delete(jobs.keys().next().value!);
    const jobId = tokenUrlsafe(16);
    jobs.set(jobId, {
      payload: { id: jobId, ...unbox(payload) }, status: 'queued', started: this.clock(),
      timeout: payload['kind'] === 'recommend' || payload['kind'] === 'module-calculate' ? 1260 : 300,
    });
    return { status: 'queued', jobId, instruction: '계산기 탭을 열어 두고 get_browser_result(connection_code, job_id)로 결과를 확인하세요.' };
  }

  poll(token: unknown, ready: boolean = true): Record<string, unknown> {
    const session = this.session(token, true);
    session.heartbeat = this.clock();
    if (!ready) return { job: null };
    for (const job of session.jobs.values()) {
      if (job.status === 'queued') {
        job.status = 'running';
        return { job: job.payload };
      }
    }
    return { job: null };
  }

  /** `result` is JSON parsed with {@link parseJson} (Python number types kept) or `null`. */
  finish(token: unknown, jobId: string, result: unknown = null, error: unknown = null): Record<string, unknown> {
    const session = this.session(token, true);
    const job = session.jobs.get(jobId);
    if (!job || job.status !== 'running') fail('JOB_NOT_FOUND', '실행 중인 작업이 아닙니다.');
    if ((result === null) === (error === null)) fail('INVALID_RESULT', 'result 또는 error 중 하나가 필요합니다.');
    if (error !== null) {
      if (typeof error !== 'string' || !(error.length >= 1 && [...error].length <= 2000)) {
        fail('INVALID_RESULT', '오류 메시지 형식이 잘못되었습니다.');
      }
      job.status = 'failed';
      job.error = error;
    } else {
      this.validateResult(job.payload!, result);
      const encoded = pyDumps(result, { ensureAscii: false });
      let retained = 0;
      for (const s of this.sessions.values()) for (const j of s.jobs.values()) retained += j.resultJson ? utf8Length(j.resultJson) : 0;
      if (retained + utf8Length(encoded) > this.maxResultBytes) fail('SERVER_BUSY', '결과 보관 한도입니다. 잠시 후 다시 실행하세요.');
      job.status = 'complete';
      job.resultJson = encoded;
      job.result = unbox(result);
    }
    job.finished = this.clock();
    delete job.payload;
    return { ok: true };
  }

  validateResult(payload: Record<string, any>, result: unknown): void {
    try {
      if (utf8Length(pyDumps(result, { ensureAscii: false })) > RESULT_LIMIT) invalid();
      if (!isDict(result)) invalid();
      const kind = payload['kind'];
      if (kind === 'inspect') {
        SharedState.validate(result);
      } else if (kind === 'recommend') {
        this.validateRecommendation(payload, result);
      } else if (kind === 'module-export' || kind === 'module-calculate') {
        const allowed = kind === 'module-export' ? ['execution', 'busy', 'lockCurrency', 'decks'] : ['execution', 'decks', 'modules'];
        if (Object.keys(result).some((k) => !allowed.includes(k)) || result['execution'] !== 'user-browser'
          || !Array.isArray(result['decks']) || !result['decks'].length) invalid();
        if (kind === 'module-export') {
          if (!['modules', 'keys'].includes(result['lockCurrency'] as string) || typeof result['busy'] !== 'boolean') invalid();
          if (result['decks'].some((row: unknown) => !isDict(row) || !Array.isArray(row['characters']))) invalid();
        } else {
          if (!Array.isArray(result['modules'])) invalid();
          for (const row of result['decks']) {
            if (!isDict(row) || ['before', 'after'].some((key) => !isNumber(pyGet(row, key)) || numberValue(row[key]) < 0)) invalid();
          }
        }
      } else if (kind === 'growth') {
        const rows = pyGet(result, 'scenarios');
        if (!pyEqual(pyGet(result, 'name'), payload['name']) || typeof pyGet(result, 'engineVersion') !== 'string'
          || !Array.isArray(rows) || rows.length !== payload['scenarios'].length) invalid();
        for (const row of [pyGet(result, 'baseline'), ...rows]) {
          if (!isDict(row) || !isNumber(pyGet(row, 'combatPower')) || !isDict(pyGet(row, 'effectiveCharacter'))) invalid();
        }
        rows.forEach((row: unknown, i: number) => {
          if (i >= payload['scenarios'].length) return;
          if (!pyEqual(pyGet(row, 'label'), payload['scenarios'][i]['label']) || !isNumber(pyGet(row, 'delta'))) invalid();
        });
      } else {
        const requests = payload['requests'] ?? [];
        const candidates = pyLenOf(requests) > 1 ? pyGet(result, 'candidates') : [result];
        if (!Array.isArray(candidates) || candidates.length !== Math.max(1, pyLenOf(requests))) invalid();
        if (candidates.length > 1) {
          const count = candidates.length;
          const ranking = pyGet(result, 'ranking');
          if (!isInt(pyGet(result, 'testedCandidates')) || result['testedCandidates'] !== count || !Array.isArray(ranking)
            || ranking.some((rank) => !isInt(rank))
            || [...ranking].sort((a, b) => a - b).join(',') !== Array.from({ length: count }, (_, i) => i + 1).join(',')) invalid();
        }
        for (const item of candidates) {
          if (!isDict(item) || typeof pyGet(item, 'engineVersion') !== 'string' || !isDict(pyGet(item, 'result'))
            || !Array.isArray(pyGet(item, 'effectiveCharacters'))) invalid();
        }
      }
    } catch (error) {
      if (error instanceof ToolError) throw error;
      fail('INVALID_RESULT', '브라우저 결과 형식 또는 크기가 잘못되었습니다.');
    }
  }

  private validateRecommendation(payload: Record<string, any>, result: Record<string, any>): void {
    const rows = pyGet(result, 'candidates');
    const options = payload['options'];
    const scenarioCount = 1 + pyLenOf(pyGet(options, 'scenarios', []));
    if (typeof pyGet(result, 'engineVersion') !== 'string' || !Array.isArray(rows)
      || rows.length !== pyLenOf(pyItem(options, 'candidates'))
      || !Array.isArray(pyGet(result, 'selected'))
      || !(result['selected'].length === 0 || pyEqual(result['selected'].length, pyItem(pyItem(payload, 'options'), 'squadCount')))
      || !Array.isArray(pyGet(result, 'solutions'))) invalid();
    const number = (value: unknown) => isNumber(value) && Number.isFinite(numberValue(value)) && numberValue(value) >= 0;
    const requested = pyIter(options['candidates']);
    rows.forEach((row: unknown, index: number) => {
      if (index >= requested.length) return;
      if (!isDict(row) || !pyEqual(pyGet(row, 'squad'), pyItem(requested[index], 'squad'))
        || !pyEqual(pyGet(row, 'id'), index) || !['evaluated', 'rejected'].includes(pyGet(row, 'status'))) invalid();
      if (row['status'] === 'evaluated') {
        if (!pyTruthy(pyGet(pyGet(row, 'policy', {}), 'recommendedEligible'))
          || pyLenOf(pyGet(row, 'scenarios', [])) !== scenarioCount
          || pyIter(row['scenarios']).some((s) => !number(pyGet(s, 'total')))) invalid();
      }
    });
    const solutions: unknown[] = result['solutions'];
    if (solutions.length > 5 || (solutions.length > 0) !== (result['selected'].length > 0)) invalid();
    for (const solution of solutions) {
      if (!isDict(solution)) invalid();
      const ids = pyGet(solution, 'candidateIds', []);
      if (pyLenOf(ids) !== pyItem(options, 'squadCount') || pySet(pyIter(ids)).size !== pyLenOf(ids)
        || pyIter(ids).some((i) => !isInt(i) || !((i as number) >= 0 && (i as number) < rows.length) || rows[i as number]['status'] !== 'evaluated')) invalid();
      const members = (ids as number[]).flatMap((i) => pyIter(rows[i]['squad']));
      const totals = pyGet(solution, 'scenarioTotals', []);
      const memberSet = pySet(members);
      const include = pyIter(pyGet(options, 'include', []));
      const exclude = pyIter(pyGet(options, 'exclude', []));
      if (memberSet.size !== members.length || include.some((n) => !memberSet.has(hashKey(n)))
        || exclude.some((n) => memberSet.has(hashKey(n)))
        || pyLenOf(totals) !== scenarioCount || pyIter(totals).some((t) => !number(t))
        || !number(pyGet(solution, 'baseTotal')) || !number(pyGet(solution, 'maxRegret'))
        || numberValue(solution['maxRegret']) > 1) invalid();
      const expected = Array.from({ length: scenarioCount }, (_, s) => sum((ids as number[]).map((i) => numberValue(pyItem(pyItem(rows[i]['scenarios'], s), 'total')))));
      const values = (totals as unknown[]).map(numberValue);
      if (values.some((t, k) => k < expected.length && !isClose(t, expected[k]!, 1e-9, 1e-6)) || numberValue(solution['baseTotal']) !== values[0]) invalid();
    }
    if (solutions.length && !pyEqual(result['selected'], (pyItem(solutions[0], 'candidateIds') as number[]).map((i) => rows[i]))) invalid();
  }

  result(code: unknown, jobId: string): Record<string, unknown> {
    const job = this.session(code).jobs.get(jobId);
    if (!job) fail('JOB_NOT_FOUND', '작업이 없거나 결과 보관 시간(5분)이 지났습니다.');
    const output: Record<string, unknown> = { status: job.status };
    if (job.error !== undefined) output['error'] = job.error;
    if (job.resultJson !== undefined) output['result'] = structuredClone(job.result);
    return output;
  }

  disconnect(token: unknown): Record<string, unknown> {
    const session = this.session(token, true);
    for (const [code, candidate] of [...this.sessions]) if (candidate === session) this.sessions.delete(code);
    return { ok: true };
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string>): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { ...headers, 'content-length': String(Buffer.byteLength(text)), 'content-type': 'application/json' });
  res.end(text);
}

const EXPECTED: Record<string, string[]> = {
  connect: [], poll: ['browserToken', 'ready'], disconnect: ['browserToken'], result: ['browserToken', 'jobId', 'result', 'error'],
};

/** POST/OPTIONS /browser/{connect,poll,result,disconnect}. */
export async function handleBrowserRoute(relay: BrowserRelay, req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
  const origin = req.headers.origin;
  const headers: Record<string, string> = { 'cache-control': 'no-store', vary: 'Origin' };
  if (typeof origin !== 'string' || !ALLOWED_ORIGINS.has(origin)) {
    send(res, 403, { error: '[ORIGIN_DENIED] 허용되지 않은 Origin입니다.' }, headers);
    req.resume();
    return;
  }
  Object.assign(headers, { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type' });
  if (req.method === 'OPTIONS') {
    send(res, 200, {}, headers);
    req.resume();
    return;
  }
  const limit = action === 'result' ? RESULT_LIMIT : REQUEST_LIMIT;
  try {
    if ((req.headers['content-type'] ?? '').split(';')[0]!.trim() !== 'application/json') {
      fail('INVALID_REQUEST', 'Content-Type application/json이 필요합니다.');
    }
    const raw = await readBody(req, limit);
    if (raw === null) {
      const message = action === 'result'
        ? '[REQUEST_TOO_LARGE] 결과 전체가 4MB를 넘었습니다. detail=false 또는 짧은 전투 시간으로 다시 계산하세요.'
        : '[REQUEST_TOO_LARGE] 요청이 1MB를 넘었습니다.';
      send(res, 413, { error: message }, headers);
      return;
    }
    let body: any;
    try {
      body = parseJson(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      throw new SyntaxError('json');
    }
    const expected = EXPECTED[action]!;
    if (!isDict(body) || Object.keys(body).some((key) => !expected.includes(key))) fail('INVALID_REQUEST', '요청 필드가 잘못되었습니다.');
    if (action !== 'connect' && (typeof body['browserToken'] !== 'string' || [...body['browserToken']].length > 128)) {
      fail('INVALID_REQUEST', 'browserToken이 필요합니다.');
    }
    let output: Record<string, unknown>;
    if (action === 'connect') output = relay.connect();
    else if (action === 'poll') {
      const ready = Object.hasOwn(body, 'ready') ? body['ready'] : true;
      if (typeof ready !== 'boolean') fail('INVALID_REQUEST', 'ready는 boolean이어야 합니다.');
      output = relay.poll(body['browserToken'], ready);
    } else if (action === 'disconnect') output = relay.disconnect(body['browserToken']);
    else {
      if (typeof body['jobId'] !== 'string' || [...body['jobId']].length > 128) fail('INVALID_REQUEST', 'jobId가 필요합니다.');
      output = relay.finish(body['browserToken'], body['jobId'], body['result'] ?? null, body['error'] ?? null);
    }
    send(res, 200, output, headers);
  } catch (error) {
    if (error instanceof ToolError) send(res, 400, { error: error.message }, headers);
    else if (error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError) {
      send(res, 400, { error: '[INVALID_REQUEST] 잘못된 JSON 요청입니다.' }, headers);
    } else throw error;
  }
}
