import type {
  SimulationRequest,
  SimulationResult,
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

  dispose(): void {
    this.worker.terminate();
    this.rejectAll(new Error('계산기가 종료되었습니다.'));
    this.preparePromise = null;
  }

  private send<T>(
    type: WorkerRequest['type'],
    expected: PendingRequest<T>['expected'],
    payload?: SimulationRequest,
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
