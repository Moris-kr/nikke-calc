/* global loadPyodide */

const PYODIDE_VERSION = '0.27.7';
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const APP_ROOT = '/app';
const siteBase = new URL('.', self.location.href);

let pyodide = null;
let runtimePromise = null;
let queue = Promise.resolve();

const post = (id, type, payload) => self.postMessage({ id, type, payload });

async function fetchAsset(relativePath) {
  const url = new URL(relativePath, siteBase);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${relativePath} 파일을 불러오지 못했습니다. (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function initialize(id) {
  post(id, 'progress', '브라우저용 Python 엔진을 준비하고 있습니다…');
  importScripts(`${PYODIDE_BASE}pyodide.js`);
  pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });

  post(id, 'progress', '계산 공식과 캐릭터 데이터를 불러오고 있습니다…');
  // manifest는 항상 네트워크에서 새로 받아 최신 버전을 얻는다. 런타임 파일은
  // 그 버전을 쿼리로 붙여 받으므로, 새 배포 때 브라우저 HTTP 캐시(max-age)에
  // 걸린 옛 .py를 재사용하지 않는다 (신 JS + 구 런타임 불일치 방지).
  const manifestResponse = await fetch(
    new URL('runtime/manifest.json', siteBase), { cache: 'reload' },
  );
  if (!manifestResponse.ok) {
    throw new Error(`런타임 목록을 불러오지 못했습니다. (${manifestResponse.status})`);
  }
  const manifest = await manifestResponse.json();
  const version = encodeURIComponent(manifest.version || '');
  pyodide.FS.mkdirTree(APP_ROOT);

  for (const file of manifest.files) {
    const target = `${APP_ROOT}/${file}`;
    const parent = target.slice(0, target.lastIndexOf('/'));
    pyodide.FS.mkdirTree(parent);
    pyodide.FS.writeFile(target, await fetchAsset(`runtime/${file}?v=${version}`));
  }

  await pyodide.runPythonAsync(`
import sys
if "${APP_ROOT}" not in sys.path:
    sys.path.insert(0, "${APP_ROOT}")
from bridge import run_request, run_combat_power
`);
  return manifest.version;
}

function ensureRuntime(id) {
  if (!runtimePromise) {
    runtimePromise = initialize(id).catch((error) => {
      runtimePromise = null;
      pyodide = null;
      throw error;
    });
  }
  return runtimePromise;
}

async function handle(message) {
  const { id, type, payload } = message;
  try {
    const version = await ensureRuntime(id);
    if (type === 'prepare') {
      post(id, 'ready', version);
      return;
    }
    // 전투력은 목록 정렬용이라 타임라인 계산과 별개로 돈다 — 훨씬 가볍다.
    if (type === 'combatPower') {
      pyodide.globals.set('__nikke_request_json', JSON.stringify(payload ?? {}));
      const cp = await pyodide.runPythonAsync('run_combat_power(__nikke_request_json)');
      post(id, 'result', JSON.parse(cp));
      return;
    }
    if (type !== 'simulate' || !payload) {
      throw new Error('지원하지 않는 계산 요청입니다.');
    }

    post(id, 'progress', '전투 타임라인을 계산하고 있습니다…');
    pyodide.globals.set('__nikke_request_json', JSON.stringify(payload));
    const raw = await pyodide.runPythonAsync('run_request(__nikke_request_json)');
    post(id, 'result', JSON.parse(raw));
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    post(id, 'error', messageText);
  }
}

self.onmessage = (event) => {
  queue = queue.then(() => handle(event.data));
};
