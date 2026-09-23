/** Read-only catalog and bounded, isolated calculator execution. (py: nikke_mcp/service.py) */
import { Worker } from 'node:worker_threads';
import { character_names, data, engine_version } from './engine.ts';
import { CalculationTimeoutError, EngineProcessError, InvalidSettingsError, ServerBusyError } from './errors.ts';
import { dump, Inst } from './pydantic.ts';
import { isDict, parseJson, pyLen, pyStr, unbox } from './pyjson.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './engine.ts';
import { pyEqual } from './pyeq.ts';

export { engine_version };

export function list_characters(query: string = ''): Record<string, unknown> {
  if (pyLen(query) > 100) throw new InvalidSettingsError('검색어는 100자 이하입니다.');
  const catalog = pythonData('data/parsed_nikke.json');
  const raw = data('scraper/nikke_scraped.json');
  const needle = query.replaceAll(' ', '');
  const rows = character_names().filter((name) => name.replaceAll(' ', '').includes(needle)).map((name) => {
    const own = catalog[name];
    const id = Object.hasOwn(raw, name) && Object.hasOwn(raw[name], 'id') ? Math.trunc(Number(String(raw[name].id).trim())) : null;
    const pick = (key: string) => (Object.hasOwn(own, key) ? own[key] : null);
    return { name, resourceId: id, element_code: pick('element_code'), weapon_type: pick('weapon_type'),
      burst_stage: pick('burst_stage'), burst_cooldown: pick('burst_cooldown') };
  });
  return { characters: rows, count: rows.length, engineVersion: engine_version() };
}

const pyData = new Map<string, any>();

/** A repository JSON file with Python number types kept (`40.0` stays a float in the text block). */
export function pythonData(path: string): any {
  if (!pyData.has(path)) pyData.set(path, parseJson(readFileSync(join(ROOT, path), 'utf8')));
  return pyData.get(path);
}

export function get_character(name: string, skill_level: number = 10): Record<string, unknown> {
  if (!character_names().includes(name)) throw new InvalidSettingsError('정식 이름을 list_characters로 확인하세요.');
  if (!(skill_level >= 1 && skill_level <= 10)) throw new InvalidSettingsError('스킬 레벨은 1~10입니다.');
  const scraped = pythonData('scraper/nikke_scraped.json');
  let raw = Object.hasOwn(scraped, name) ? scraped[name] : null;
  const preview = raw === null;
  if (raw === null) {
    const previews = pythonData('scraper/preview_skills.json');
    raw = Object.hasOwn(previews, name) ? previews[name] : {};
  }
  const skills: Array<Record<string, unknown>> = [];
  const own = (d: any, key: string, fallback: unknown) => (isDict(d) && Object.hasOwn(d, key) ? d[key] : fallback);
  for (const [title, skill] of Object.entries(own(raw, '스킬', {}) as Record<string, any>)) {
    const values = own(own(skill, 'values', {}), String(skill_level), null);
    if (values === null) throw new InvalidSettingsError('요청 레벨의 원문 수치가 없습니다. 프리뷰는 Lv10만 지원합니다.');
    const text = String(own(skill, 'template', '')).replace(/\{(\d+)\}/g, (_m, index: string) => {
      const value = values[Number(index)];
      if (value === undefined) throw new RangeError('list index out of range');
      return pyStr(value);
    });
    skills.push({ name: title, description: text, cooldown: unbox(own(skill, '쿨타임', null)) });
  }
  return {
    name, skillLevel: skill_level, skills,
    stats: pythonData('data/parsed_nikke.json')[name],
    previewNote: preview ? '[프리뷰 · 미검증]' : '',
    source: !preview ? 'scraper/nikke_scraped.json' : 'scraper/preview_skills.json',
    engineVersion: engine_version(),
  };
}

/** asyncio.Semaphore with a bounded wait. */
class Slots {
  private waiters: Array<() => void> = [];
  constructor(private free: number) {}

  acquire(timeoutMs: number): Promise<boolean> {
    if (this.free > 0) {
      this.free -= 1;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const grant = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== grant);
        resolve(false);
      }, timeoutMs);
      this.waiters.push(grant);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.free += 1;
  }
}

export type WorkerRunner = (request: Record<string, unknown>, timeoutMs: number) => Promise<unknown>;

class WorkerCrash extends Error {}

/** Run one calculation in a fresh worker thread; terminate it on timeout. */
export const runInWorker: WorkerRunner = (request, timeoutMs) => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('../worker.mjs', import.meta.url), { workerData: { request }, execArgv: [], stdout: false, stderr: false });
  let settled = false;
  const finish = (fn: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    fn();
  };
  const timer = setTimeout(() => finish(() => {
    void worker.terminate();
    reject(new CalculationTimeoutError('계산 시간 제한을 초과했습니다. 전투 시간을 줄여 다시 시도하세요.'));
  }), timeoutMs);
  worker.once('message', (message) => finish(() => {
    void worker.terminate();
    resolve(message);
  }));
  worker.once('error', (error) => finish(() => {
    process.stderr.write(`calculation worker failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    reject(new WorkerCrash());
  }));
  worker.once('exit', (code) => finish(() => reject(new WorkerCrash(`exit ${code}`))));
});

export class CalculatorService {
  readonly slots: Slots;
  constructor(readonly timeout: number = 60, maxConcurrent: number = 2, readonly runner: WorkerRunner = runInWorker) {
    this.slots = new Slots(maxConcurrent);
  }

  async simulate(request: Inst, detail = false): Promise<Record<string, unknown>> {
    if (!(await this.slots.acquire(2000))) {
      throw new ServerBusyError('다른 계산이 실행 중입니다. 동시 요청하지 말고 앞선 계산이 끝난 뒤 순서대로 다시 호출하세요. 육성이나 편성을 바꿀 필요는 없습니다.');
    }
    let output: any;
    try {
      try {
        output = await this.runner(dump(request, { excludeNone: true }), this.timeout * 1000);
      } catch (error) {
        if (error instanceof CalculationTimeoutError) throw error;
        throw new EngineProcessError('계산 프로세스 실행에 실패했습니다. 설치 및 서버 로그를 확인하세요.');
      }
      if (!isDict(output) || Object.hasOwn(output, 'error')) {
        // Worker messages may originate in unexpected engine exceptions.
        // Do not publish their raw strings as user-input errors.
        throw new EngineProcessError('검증된 요청을 계산하는 중 내부 오류가 발생했습니다. 호출 입력과 엔진 버전을 운영자에게 전달해 주세요.');
      }
    } finally {
      this.slots.release();
    }
    if (!detail) {
      for (const key of ['timeline', 'buffTargets']) delete output['result'][key];
    }
    return {
      engineVersion: engine_version(), request: dump(request, { excludeNone: true, py: true }), ...output,
      limitations: ['시뮬레이터 결과이며 실게임 측정값이 아닙니다.',
        'random 모드는 지정 seed의 단일 시행입니다. 통계적 신뢰구간을 제공하지 않습니다.',
        '생략한 육성은 공통 기본 스펙과 캐릭터별 기본 설정을 사용합니다.',
        '전투 조건은 request, 적용 육성은 effectiveCharacters, 기본 이탈은 result.deviations를 확인하세요.'],
    };
  }

  async compare(requests: Inst[]): Promise<Record<string, unknown>> {
    if (!(requests.length >= 2 && requests.length <= 5)) throw new InvalidSettingsError('비교 후보는 2~5개입니다.');
    const battle = (request: Inst) => dump(request, { exclude: new Set(['squad', 'characters']) });
    const first = battle(requests[0]!);
    if (requests.slice(1).some((request) => !pyEqual(battle(request), first))) {
      throw new InvalidSettingsError('비교 후보의 전투 시간·보스·난수 모드·seed는 같아야 합니다.');
    }
    const candidates: Array<Record<string, any>> = [];
    for (const [index, request] of requests.entries()) {
      const result = await this.simulate(request);
      const total = (result['result'] as any)['squadTotal'];
      const base = candidates.length ? candidates[0]!['result']['squadTotal'] : total;
      candidates.push({ ...result, candidate: index + 1, deltaFromFirst: total - base,
        percentFromFirst: base ? (total / base - 1) * 100 : null });
    }
    return {
      candidates, testedCandidates: candidates.length,
      ranking: [...candidates].sort((a, b) => b['result']['squadTotal'] - a['result']['squadTotal']).map((row) => row['candidate']),
      scope: '입력한 후보만 비교했습니다. 전체 조합의 최적해를 보장하지 않습니다.',
    };
  }
}
