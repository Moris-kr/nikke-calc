import type { McpShare } from './mcp-share';
import type { SimulationRequest, SimulationResult, GrowthComparisonRequest, RecommendationOptions, RecommendationRequest } from './types';
import { CalculatorWorkerClient } from './worker-client';

const RELAY = import.meta.env.DEV && import.meta.env.VITE_MCP_RELAY_URL
  ? import.meta.env.VITE_MCP_RELAY_URL : 'https://nikke-calc-mcp.onrender.com/browser';
export interface BrowserJob {
  id: string;
  kind: 'inspect' | 'simulate' | 'shared' | 'growth' | 'recommend';
  options?: RecommendationOptions;
  name?: string;
  scenarios?: GrowthComparisonRequest['scenarios'];
  requests?: SimulationRequest[];
  state?: McpShare;
  deck_index?: number;
  squad?: string[];
  detail?: boolean;
}
interface BrowserEngine {
  prepare(): Promise<void>;
  simulateMcp(request: SimulationRequest): Promise<{ result: SimulationResult; effectiveCharacters: unknown[]; engineVersion: string }>;
  compareGrowth?(request: GrowthComparisonRequest): Promise<Record<string, unknown>>;
  recommend?(request: RecommendationRequest): Promise<Record<string, unknown>>;
  dispose(): void;
}
export interface ConnectionState { code: string; message: string; connecting: boolean; }

/** Only allowlisted data jobs; nothing received from the relay is executable code. */
export async function executeBrowserJob(job: BrowserJob, getShare: () => McpShare, engine: BrowserEngine): Promise<Record<string, unknown>> {
  if (job.kind === 'inspect') return { ...getShare() };
  if (job.kind === 'recommend') {
    if (!job.options?.candidates || !engine.recommend) throw new Error('추천 후보를 확인하고 계산기 페이지를 새로고침해 주세요.');
    const state = getShare();
    const { candidates, squadCount, include, exclude, scenarios } = job.options;
    // Never spread remote options: roster and battle belong to this browser.
    const request: RecommendationRequest = JSON.parse(JSON.stringify({
      candidates, squadCount, include, exclude, scenarios, roster: state.roster, battle: state.battle,
    }));
    return { ...await engine.recommend(request), execution: 'user-browser', source: 'current-browser-roster', request };
  }
  if (job.kind === 'growth') {
    const state = getShare();
    if (!job.name || !Object.hasOwn(state.roster, job.name) || !Object.keys(state.roster[job.name]!).length) {
      throw new Error(`현재 육성 정보가 없습니다: ${job.name ?? ''}`);
    }
    if (!engine.compareGrowth) throw new Error('계산기 페이지를 새로고침하고 AI 연결을 다시 켜 주세요.');
    const request: GrowthComparisonRequest = JSON.parse(JSON.stringify({ name: job.name,
      baseline: state.roster[job.name], scenarios: job.scenarios,
      synchroLevel: state.battle.synchroLevel, console: state.battle.console }));
    return { ...await engine.compareGrowth(request), execution: 'user-browser', source: 'current-browser-roster', request };
  }
  let requests: SimulationRequest[];
  if (job.kind === 'shared') {
    const state = job.state ?? getShare();
    if (job.squad) {
      if (!job.squad.length || job.squad.length > 5 || new Set(job.squad).size !== job.squad.length) throw new Error('편성은 중복 없이 1~5명이어야 합니다.');
      const characters: SimulationRequest['characters'] = {};
      for (const name of job.squad) {
        if (!Object.hasOwn(state.roster, name)) throw new Error(`불러온 육성이 없습니다: ${name}`);
        characters[name] = state.roster[name]!;
      }
      requests = [{ ...state.battle, squad: job.squad, characters }];
    } else {
      const index = job.deck_index ?? 1;
      if (!Number.isInteger(index) || index < 1 || !state.decks[index - 1]) throw new Error('저장된 편성 번호를 확인해 주세요.');
      requests = [state.decks[index - 1]!];
    }
  } else if (job.kind === 'simulate' && job.requests?.length && job.requests.length <= 5) {
    requests = job.requests;
  } else throw new Error('지원하지 않는 브라우저 작업입니다.');
  // Capture before the first await; later UI edits cannot change an in-flight comparison.
  requests = JSON.parse(JSON.stringify(requests)) as SimulationRequest[];
  const candidates = [];
  for (const request of requests) {
    const output = await engine.simulateMcp(request);
    if (!job.detail) for (const key of ['timeline', 'buffTargets', 'states', 'shots', 'fineTimeline'] as const) delete output.result[key];
    const total = output.result.squadTotal;
    const first: number = candidates.length ? candidates[0]!.result.squadTotal : total;
    candidates.push({ ...output, execution: 'user-browser', request,
      candidate: candidates.length + 1, deltaFromFirst: total - first,
      percentFromFirst: first ? (total / first - 1) * 100 : null,
      limitations: ['사용자 브라우저에서 실행한 시뮬레이터 결과입니다. 실게임 측정값이 아닙니다.',
        '생략한 육성은 기본값입니다. 실제 적용값은 effectiveCharacters, 기본 이탈은 result.deviations를 확인하세요.',
        'random 모드는 단일 seed 시행이며 통계적 신뢰구간을 제공하지 않습니다.'] });
  }
  if (candidates.length === 1) return candidates[0]!;
  return { candidates, testedCandidates: candidates.length,
    ranking: [...candidates].sort((a, b) => b.result.squadTotal - a.result.squadTotal).map(c => c.candidate),
    scope: '입력한 후보만 비교했습니다. 전체 조합의 최적해를 보장하지 않습니다.' };
}

/** Dedicated worker and session, independent of the normal calculator's cancel/pool controls. */
export class BrowserMcpConnection {
  state: ConnectionState = { code: '', message: '연결 꺼짐', connecting: false };
  private token = '';
  private generation = 0;
  private engine: BrowserEngine | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private jobTimer?: ReturnType<typeof setTimeout>;
  private activeJob = '';
  private listener?: (state: ConnectionState) => void;
  constructor(private readonly getShare: () => McpShare,
    private readonly makeEngine: () => BrowserEngine = () => new CalculatorWorkerClient(),
    private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}

  subscribe(listener: (state: ConnectionState) => void): void { this.listener = listener; listener(this.state); }
  private update(patch: Partial<ConnectionState>): void { this.state = { ...this.state, ...patch }; this.listener?.(this.state); }
  private async post(path: string, body: object): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), path === 'connect' ? 120000 : 15000);
    try {
      const response = await this.fetcher(`${RELAY}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal, cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'AI 연결이 만료되었습니다. 다시 연결해 주세요.');
      return result;
    } finally { clearTimeout(timeout); }
  }
  async connect(): Promise<void> {
    if (this.state.connecting || this.token) return;
    const generation = ++this.generation;
    this.update({ connecting: true, code: '', message: '브라우저 계산 엔진과 연결을 준비하고 있습니다… 처음에는 1~2분 걸릴 수 있습니다.' });
    try {
      this.getShare(); // Report unsupported custom settings before granting access.
      const engine = this.makeEngine();
      this.engine = engine;
      await engine.prepare();
      if (generation !== this.generation) return;
      const session = await this.post('connect', {});
      if (generation !== this.generation) {
        void this.post('disconnect', { browserToken: session.browserToken }).catch(() => {});
        return;
      }
      this.token = session.browserToken;
      this.update({ connecting: false, code: session.connectionCode, message: '연결됨 · 이 탭을 열어 두세요. 연결은 최대 2시간 유지됩니다.' });
      void this.poll(generation);
    } catch (error) {
      if (generation === this.generation) this.disconnect(`연결 실패: ${error instanceof Error ? error.message : '다시 시도해 주세요.'}`);
    }
  }
  disconnect(message = '연결을 해제했습니다. 기존 코드는 사용할 수 없습니다.'): void {
    ++this.generation;
    clearTimeout(this.timer);
    clearTimeout(this.jobTimer);
    const token = this.token;
    this.token = '';
    this.activeJob = '';
    this.engine?.dispose();
    this.engine = null;
    this.update({ code: '', connecting: false, message });
    if (token) void this.post('disconnect', { browserToken: token }).catch(() => {});
  }
  private async poll(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    try {
      const { job } = await this.post('poll', { browserToken: this.token, ready: !this.activeJob });
      if (generation !== this.generation) return;
      if (job && !this.activeJob) {
        this.activeJob = job.id;
        this.update({ message: job.kind === 'inspect' ? 'AI가 현재 육성·편성을 조회하고 있습니다.' : '이 브라우저에서 AI 요청을 계산하고 있습니다…' });
        void this.run(job, generation);
      }
      this.timer = setTimeout(() => void this.poll(generation), 2000);
    } catch (error) {
      if (generation === this.generation) this.disconnect(`연결이 끊겼습니다. 다시 AI 연결을 눌러 주세요. ${error instanceof Error ? error.message : ''}`);
    }
  }
  private async run(job: BrowserJob, generation: number): Promise<void> {
    const minutes = job.kind === 'recommend' ? 20 : 4;
    this.jobTimer = setTimeout(() => {
      if (generation === this.generation) this.disconnect(`계산이 ${minutes}분을 넘겨 연결을 해제했습니다. 후보 수나 전투 시간을 줄이고 다시 연결해 주세요.`);
    }, minutes * 60000);
    try {
      let body: object;
      try { body = { result: await executeBrowserJob(job, this.getShare, this.engine!) }; }
      catch (error) {
        const line = error instanceof Error ? error.message.trim().split('\n').at(-1) : '';
        body = { error: (line || '브라우저 계산에 실패했습니다. 입력 설정을 확인해 주세요.').slice(0, 500) };
      }
      if (generation !== this.generation) return;
      await this.post('result', { browserToken: this.token, jobId: job.id, ...body });
      if (generation === this.generation) this.update({ message: 'error' in body ? `작업 실패 · ${body.error}` : '작업 완료 · AI가 결과를 조회할 수 있습니다.' });
    } catch {
      if (generation === this.generation) this.disconnect('결과 전달에 실패했습니다. 다시 연결한 뒤 요청해 주세요.');
    } finally {
      if (generation === this.generation) { clearTimeout(this.jobTimer); this.activeJob = ''; }
    }
  }
}
