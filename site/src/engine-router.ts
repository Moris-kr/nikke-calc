import type { CombatPowerRequest, SimulationRequest, SimulationResult } from './types';
import { CalculatorPool, isCancelled, type WorkerLike } from './worker-client';

/**
 * 계산 엔진 고르기 — 파이썬 엔진(Pyodide)과 고속 엔진(TypeScript, `src/engine/`).
 *
 * 고속 엔진은 파이썬 엔진을 옮긴 것이다(결과 대조: `src/engine/parity.test.ts`). 두 엔진을 한동안
 * 같이 운영하므로, 고속 엔진이 계산에 실패하면 **그 판을 파이썬 엔진으로 다시 계산**해 결과는 늘 나온다.
 *
 * 고속 엔진은 전투 계산(`simulate`)만 맡는다. 전투력·추천·육성 비교는 파이썬 엔진이 계속 맡으며,
 * 필요할 때 처음 불려서 그때 파이썬 런타임을 받는다.
 */
export type EngineKind = 'python' | 'fast';
export const ENGINE_KEY = 'nikke-engine-v1';
export const DEFAULT_ENGINE: EngineKind = 'fast';

export const isEngineKind = (value: unknown): value is EngineKind => value === 'python' || value === 'fast';

export interface EngineFallback { error: Error; request: SimulationRequest }

const fastWorkerFactory = (): WorkerLike =>
  new Worker(new URL('./engine/engine.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

export class EngineRouter {
  readonly python: CalculatorPool;
  private fastPool: CalculatorPool | null = null;
  private kind: EngineKind;
  private size = 1;
  private readonly fallbackListeners: Array<(event: EngineFallback) => void> = [];

  constructor(
    engine: EngineKind = DEFAULT_ENGINE,
    python: CalculatorPool = new CalculatorPool(),
    private readonly makeFast: () => CalculatorPool = () => new CalculatorPool(fastWorkerFactory),
  ) {
    this.python = python;
    this.kind = engine;
  }

  readonly maxPoolSize = 6;

  get engine(): EngineKind { return this.kind; }

  /** 엔진을 바꾼다. 바꾼 쪽은 다음 계산 때 준비된다(부르는 쪽이 `prepare()`를 걸어 두면 미리). */
  setEngine(engine: EngineKind): void { this.kind = engine; }

  /** 고속 엔진이 실패해 파이썬으로 다시 계산했을 때 알린다. 돌려주는 함수로 구독을 푼다. */
  onFallback(listener: (event: EngineFallback) => void): () => void {
    this.fallbackListeners.push(listener);
    return () => {
      const index = this.fallbackListeners.indexOf(listener);
      if (index >= 0) this.fallbackListeners.splice(index, 1);
    };
  }

  private get fast(): CalculatorPool {
    if (!this.fastPool) {
      this.fastPool = this.makeFast();
      this.fastPool.setPoolSize(this.size);
    }
    return this.fastPool;
  }

  defaultPoolSize(): number { return this.python.defaultPoolSize(); }

  setPoolSize(size: number): void {
    this.size = size;
    this.python.setPoolSize(size);
    this.fastPool?.setPoolSize(size);
  }

  /** 고른 엔진만 준비한다. 고속 엔진 준비가 실패하면 파이썬 엔진을 준비한다(계산도 그쪽으로 간다). */
  async prepare(): Promise<void> {
    if (this.kind === 'python') return this.python.prepare();
    try {
      await this.fast.prepare();
    } catch (error) {
      if (isCancelled(error)) throw error;
      await this.python.prepare();
    }
  }

  async simulate(request: SimulationRequest): Promise<SimulationResult> {
    if (this.kind === 'python') return this.python.simulate(request);
    try {
      return await this.fast.simulate(request);
    } catch (error) {
      if (isCancelled(error)) throw error;
      const reason = error instanceof Error ? error : new Error(String(error));
      console.warn('[고속 엔진] 실패 → 파이썬 엔진으로 다시 계산합니다:', reason.message);
      for (const listener of [...this.fallbackListeners]) {
        try { listener({ error: reason, request }); } catch { /* 알림 실패가 계산을 막지 않는다 */ }
      }
      return this.python.simulate(request);
    }
  }

  combatPower(request: CombatPowerRequest): Promise<Record<string, number>> {
    return this.python.combatPower(request);
  }

  cancel(): void {
    this.python.cancel();
    this.fastPool?.cancel();
  }

  dispose(): void {
    this.python.dispose();
    this.fastPool?.dispose();
  }
}
