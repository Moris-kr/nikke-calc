/**
 * 고속 엔진 작업 스레드 — 파이썬 워커(`public/calculator.worker.js`)와 **같은 메시지 약속**을 쓴다.
 * 그래서 `CalculatorWorkerClient`·`CalculatorPool`을 그대로 씌운다.
 *
 * 파이썬 런타임(Pyodide)은 받지 않는다. 사이트 런타임 목록(`runtime/manifest.json`)에서 엔진 데이터
 * JSON 14개만 받아 `setEngineData`로 넣는다 — 파이썬 워커와 같은 파일·같은 버전 쿼리다.
 *
 * 전투 계산(`simulate`)만 맡는다. 나머지 요청(전투력·추천·육성 비교·AI 연결)은 라우터가 파이썬으로 보낸다.
 */
import { ENGINE_DATA_FILES, setEngineData } from './data';
import { run_request } from './bridge';
import type { WorkerRequest } from '../types';

const siteBase = new URL(import.meta.env.BASE_URL, self.location.href);
let ready: Promise<string> | null = null;

const post = (id: number, type: string, payload?: unknown) => self.postMessage({ id, type, payload });

async function initialize(): Promise<string> {
  const manifestResponse = await fetch(new URL('runtime/manifest.json', siteBase), { cache: 'reload' });
  if (!manifestResponse.ok) throw new Error(`런타임 목록을 불러오지 못했습니다. (${manifestResponse.status})`);
  const manifest = await manifestResponse.json() as { version?: string; files: string[] };
  const version = encodeURIComponent(manifest.version || '');
  const paths = Object.keys(ENGINE_DATA_FILES);
  const listed = new Set(manifest.files);
  const missing = paths.filter((path) => !listed.has(path));
  if (missing.length) throw new Error(`고속 엔진 데이터가 런타임에 없습니다: ${missing.join(', ')}`);
  const bodies = await Promise.all(paths.map(async (path) => {
    const response = await fetch(new URL(`runtime/${path}?v=${version}`, siteBase));
    if (!response.ok) throw new Error(`${path} 파일을 불러오지 못했습니다. (${response.status})`);
    return response.json() as Promise<unknown>;
  }));
  setEngineData(Object.fromEntries(paths.map((path, index) => [path, bodies[index]])));
  return manifest.version ?? '';
}

function ensureReady(): Promise<string> {
  if (!ready) ready = initialize().catch((error) => { ready = null; throw error; });
  return ready;
}

async function handle(message: WorkerRequest): Promise<void> {
  const { id, type, payload } = message;
  try {
    const version = await ensureReady();
    if (type === 'prepare') { post(id, 'ready', version); return; }
    if (type !== 'simulate' || !payload) throw new Error('고속 엔진이 지원하지 않는 계산 요청입니다.');
    post(id, 'result', JSON.parse(run_request(JSON.stringify(payload))));
  } catch (error) {
    post(id, 'error', error instanceof Error ? `${error.name === 'Error' ? '' : `${error.name}: `}${error.message}` : String(error));
  }
}

let queue: Promise<void> = Promise.resolve();
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  queue = queue.then(() => handle(event.data));
};
