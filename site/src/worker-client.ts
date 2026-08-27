import type {
  SimulationRequest,
  SimulationResult,
  CombatPowerRequest,
  WorkerRequest,
  WorkerResponse,
} from './types';

export interface WorkerLike {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

interface PendingRequest<T> {
  expected: 'ready' | 'result';
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

type ProgressListener = (message: string) => void;

declare const __BUILD_ID__: string;

/** 워커 상한. 이 위로는 메모리만 먹고 빨라지지 않는다(코어보다 많아 봐야 서로 뺏는다). */
export const MAX_POOL = 6;

/**
 * 이 기기에 알맞은 기본 워커 수.
 *
 * 코어 하나는 화면·입력에 남겨 두고, 셋을 넘기지 않는다 — 워커마다 파이오다이드가
 * 하나씩 떠서 메모리를 50~80MB씩 먹기 때문이다. 모바일이나 메모리가 적다고 알려 주는
 * 기기는 하나로 둔다(탭이 죽는 쪽이 느린 것보다 나쁘다).
 */
export function defaultPoolSize(nav: Navigator = navigator): number {
  const memory = (nav as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof memory === 'number' && memory > 0 && memory < 4) return 1;
  const cores = nav.hardwareConcurrency;
  if (!cores || cores <= 2) return 1;
  return Math.max(1, Math.min(3, cores - 1));
}

const defaultWorkerFactory = (): WorkerLike =>
  new Worker(`${import.meta.env.BASE_URL}calculator.worker.js?v=${__BUILD_ID__}`);

export class CalculatorWorkerClient {
  private readonly worker: WorkerLike;
  private readonly pending = new Map<number, PendingRequest<unknown>>();
  private nextId = 1;
  private preparePromise: Promise<void> | null = null;

  constructor(
    workerFactory: () => WorkerLike = defaultWorkerFactory,
    private readonly onProgress: ProgressListener = () => undefined,
  ) {
    this.worker = workerFactory();
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      this.rejectAll(new Error(event.message || '계산 작업 스레드에서 오류가 발생했습니다.'));
    };
  }

  prepare(): Promise<void> {
    if (!this.preparePromise) {
      this.preparePromise = this.send<void>('prepare', 'ready').catch((error) => {
        this.preparePromise = null;
        throw error;
      });
    }
    return this.preparePromise;
  }

  simulate(request: SimulationRequest): Promise<SimulationResult> {
    return this.send<SimulationResult>('simulate', 'result', request);
  }

  /** 캐릭터별 인게임 전투력. 목록 정렬에만 쓴다. */
  combatPower(request: CombatPowerRequest): Promise<Record<string, number>> {
    return this.send<Record<string, number>>('combatPower', 'result', request);
  }

  dispose(): void {
    this.worker.terminate();
    this.rejectAll(new Error('계산기가 종료되었습니다.'));
    this.preparePromise = null;
  }

  private send<T>(
    type: WorkerRequest['type'],
    expected: PendingRequest<T>['expected'],
    payload?: WorkerRequest['payload'],
  ): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        expected,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage({ id, type, payload });
    });
  }

  private handleMessage(response: WorkerResponse): void {
    if (response.type === 'progress') {
      this.onProgress(String(response.payload ?? ''));
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) return;

    this.pending.delete(response.id);
    if (response.type === 'error') {
      pending.reject(new Error(String(response.payload ?? '계산에 실패했습니다.')));
      return;
    }
    if (response.type !== pending.expected) {
      pending.reject(new Error(`예상하지 못한 계산기 응답: ${response.type}`));
      return;
    }
    pending.resolve(response.payload);
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}

/**
 * 여러 워커에 계산을 나눠 돌리는 풀.
 *
 * 계산은 방문자 기기에서 돈다 — 서버 비용이 아니라 **그 기기의 코어와 메모리**를 쓴다.
 * 워커 하나에 파이오다이드 런타임이 하나씩 뜨므로(개당 50~80MB), 개수는 사람이 정할 수
 * 있어야 하고 기본값은 기기 사정을 보고 조심스럽게 잡는다.
 *
 * 판 하나하나는 서로 독립이고 결정론적이라, 몇 개로 나눠 돌리든 **결과는 같다**.
 * 순서만 뒤섞여 도착하므로 화면 쪽에서 덱 번호로 다시 세운다.
 */
export class CalculatorPool {
  private readonly clients: CalculatorWorkerClient[] = [];
  private readonly idle: CalculatorWorkerClient[] = [];
  private readonly waiting: Array<(client: CalculatorWorkerClient) => void> = [];
  private size = 1;

  constructor(
    private readonly workerFactory: () => WorkerLike = defaultWorkerFactory,
    private readonly onProgress: ProgressListener = () => undefined,
  ) {
    const first = new CalculatorWorkerClient(workerFactory, onProgress);
    this.clients.push(first);
    this.idle.push(first);
  }

  readonly maxPoolSize = MAX_POOL;

  /** 이 기기에 알맞은 기본값. 화면이 «권장»으로 표시한다. */
  defaultPoolSize(): number {
    return defaultPoolSize();
  }

  /** 몇 개까지 띄울지. 줄여도 이미 뜬 워커는 끄지 않는다 — 다음 계산부터 안 쓴다. */
  setPoolSize(size: number): void {
    this.size = Math.max(1, Math.min(MAX_POOL, Math.trunc(size) || 1));
  }

  get workerCount(): number {
    return this.clients.length;
  }

  prepare(): Promise<void> {
    return this.clients[0]!.prepare();
  }

  /** 전투력은 목록 정렬용이라 첫 워커에서만 돌린다 — 가볍고 자주 불린다. */
  combatPower(request: CombatPowerRequest): Promise<Record<string, number>> {
    return this.clients[0]!.combatPower(request);
  }

  async simulate(request: SimulationRequest): Promise<SimulationResult> {
    const client = await this.acquire();
    try {
      return await client.simulate(request);
    } finally {
      this.release(client);
    }
  }

  dispose(): void {
    for (const client of this.clients) client.dispose();
    this.clients.length = 0;
    this.idle.length = 0;
    this.waiting.length = 0;
  }

  private async acquire(): Promise<CalculatorWorkerClient> {
    const free = this.idle.pop();
    if (free) return free;
    if (this.clients.length < this.size) {
      // **첫 워커가 준비된 뒤에** 새로 띄운다. 동시에 띄우면 브라우저 캐시가 비어 있어
      // 같은 런타임(3MB)을 워커 수만큼 내려받는다 — 한 번 받아 두면 나머지는 캐시로 뜬다.
      await this.clients[0]!.prepare();
      const extra = new CalculatorWorkerClient(this.workerFactory, this.onProgress);
      this.clients.push(extra);
      await extra.prepare();
      return extra;
    }
    return new Promise<CalculatorWorkerClient>((resolve) => { this.waiting.push(resolve); });
  }

  private release(client: CalculatorWorkerClient): void {
    const next = this.waiting.shift();
    if (next) next(client);
    else this.idle.push(client);
  }
}
