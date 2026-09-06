import { describe, expect, it } from 'vitest';

import {
  CalculatorPool, CalculatorWorkerClient, defaultPoolSize, isCancelled, MAX_POOL,
  type WorkerLike,
} from './worker-client';
import type { SimulationRequest, SimulationResult, WorkerResponse } from './types';

const request: SimulationRequest = {
  squad: ['리타'],
  duration: 10,
  enemyDef: 31_784,
  enemyCode: '',
  corePx: 0,
  hasParts: false,
  seed: 42,
};

const result: SimulationResult = {
  squadTotal: 123_456,
  duration: 10,
  hitCount: 100,
  charTotals: { 리타: 123_456 },
  previewNote: '',
  deviations: '',
};

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: Array<{ id: number; type: string; payload?: unknown }> = [];
  terminated = false;

  postMessage(message: { id: number; type: string; payload?: unknown }): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: WorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
  }
}

describe('CalculatorWorkerClient', () => {
  it('matches out-of-order results to their request ids', async () => {
    const worker = new FakeWorker();
    const client = new CalculatorWorkerClient(() => worker);
    const first = client.simulate(request);
    const second = client.simulate({ ...request, seed: 99 });

    const firstId = worker.messages[0]?.id;
    const secondId = worker.messages[1]?.id;
    expect(firstId).toBeTypeOf('number');
    expect(secondId).toBeTypeOf('number');

    worker.respond({ id: secondId!, type: 'result', payload: { ...result, squadTotal: 99 } });
    worker.respond({ id: firstId!, type: 'result', payload: result });

    await expect(first).resolves.toEqual(result);
    await expect(second).resolves.toMatchObject({ squadTotal: 99 });
  });

  it('rejects one worker error and remains usable', async () => {
    const worker = new FakeWorker();
    const client = new CalculatorWorkerClient(() => worker);
    const failed = client.simulate(request);
    worker.respond({ id: worker.messages[0]!.id, type: 'error', payload: '계산 실패' });
    await expect(failed).rejects.toThrow('계산 실패');

    const recovered = client.simulate(request);
    worker.respond({ id: worker.messages[1]!.id, type: 'result', payload: result });
    await expect(recovered).resolves.toEqual(result);
  });

  it('terminates the worker and rejects pending work on dispose', async () => {
    const worker = new FakeWorker();
    const client = new CalculatorWorkerClient(() => worker);
    const pending = client.simulate(request);

    client.dispose();

    expect(worker.terminated).toBe(true);
    await expect(pending).rejects.toThrow('계산기가 종료되었습니다.');
  });
});

describe('CalculatorPool', () => {
  const spawn = () => {
    const made: FakeWorker[] = [];
    const pool = new CalculatorPool(() => {
      const worker = new FakeWorker();
      made.push(worker);
      return worker;
    });
    return { pool, made };
  };
  const ready = (worker: FakeWorker) => {
    const message = worker.messages.find((m) => m.type === 'prepare');
    if (message) worker.respond({ id: message.id, type: 'ready', payload: 'v1' });
  };
  const answered = new WeakMap<FakeWorker, Set<number>>();
  const answer = (worker: FakeWorker) => {
    // 워커는 재사용되므로 **아직 답 안 한** 요청을 골라야 한다. 시험마다 id가 1부터
    // 다시 시작하므로 워커별로 따로 센다.
    let seen = answered.get(worker);
    if (!seen) answered.set(worker, (seen = new Set<number>()));
    const message = worker.messages.find((m) => m.type === 'simulate' && !seen!.has(m.id));
    if (!message) return false;
    seen.add(message.id);
    worker.respond({ id: message.id, type: 'result', payload: result });
    return true;
  };

  it('기본값은 이 기기 사정을 보고 조심스럽게 잡는다', () => {
    // 코어를 하나 남기고, 셋을 넘기지 않는다. 메모리가 적다고 알려 주면 하나로 둔다.
    expect(defaultPoolSize({ hardwareConcurrency: 8 } as unknown as Navigator)).toBe(3);
    expect(defaultPoolSize({ hardwareConcurrency: 4 } as unknown as Navigator)).toBe(3);
    expect(defaultPoolSize({ hardwareConcurrency: 2 } as unknown as Navigator)).toBe(1);
    expect(defaultPoolSize({ hardwareConcurrency: 8, deviceMemory: 2 } as unknown as Navigator)).toBe(1);
  });

  it('여분 워커는 첫 워커가 준비된 뒤에 띄운다', async () => {
    // 동시에 띄우면 캐시가 비어 있어 같은 런타임을 워커 수만큼 내려받는다.
    const { pool, made } = spawn();
    pool.setPoolSize(3);
    const first = pool.simulate(request);
    const second = pool.simulate(request);
    await Promise.resolve();
    expect(made).toHaveLength(1);          // 아직 첫 워커뿐이다
    ready(made[0]!);
    await new Promise((done) => { setTimeout(done, 0); });
    expect(made.length).toBeGreaterThan(1);
    ready(made[1]!);
    await new Promise((done) => { setTimeout(done, 0); });
    answer(made[0]!);
    answer(made[1]!);
    await expect(first).resolves.toEqual(result);
    await expect(second).resolves.toEqual(result);
  });

  it('꺼 두면(1개) 워커를 더 띄우지 않는다', async () => {
    const { pool, made } = spawn();
    pool.setPoolSize(1);
    const first = pool.simulate(request);
    const second = pool.simulate(request);
    await Promise.resolve();
    ready(made[0]!);
    await new Promise((done) => { setTimeout(done, 0); });
    expect(made).toHaveLength(1);
    answer(made[0]!);
    await expect(first).resolves.toEqual(result);
    // 첫 판이 끝나야 둘째가 같은 워커로 간다
    await new Promise((done) => { setTimeout(done, 0); });
    answer(made[0]!);
    await expect(second).resolves.toEqual(result);
    expect(made).toHaveLength(1);
  });

  it('상한을 넘겨 잡아도 상한에서 멈춘다', () => {
    const { pool } = spawn();
    pool.setPoolSize(99);
    expect(pool.maxPoolSize).toBe(MAX_POOL);
  });

  it('취소하면 돌던 계산이 «취소»로 끊기고 워커가 새로 선다', async () => {
    // 파이썬 시뮬은 한 덩어리로 돌아 협조적으로 못 멈춘다 — 스레드를 끊는 길뿐이다.
    const { pool, made } = spawn();
    const running = pool.simulate(request);
    await Promise.resolve();

    pool.cancel();

    await expect(running).rejects.toSatisfy(isCancelled);
    expect(made[0]!.terminated).toBe(true);
    // 새 워커가 대신 선다 — 취소한 뒤에도 다시 돌릴 수 있어야 한다.
    expect(made).toHaveLength(2);
    expect(made[1]!.terminated).toBe(false);

    const again = pool.simulate(request);
    await Promise.resolve();
    ready(made[1]!);
    await new Promise((done) => { setTimeout(done, 0); });
    answer(made[1]!);
    await expect(again).resolves.toEqual(result);
  });

  it('자리를 기다리던 계산도 «취소»로 풀린다 — 안 풀면 영영 안 끝난다', async () => {
    const { pool, made } = spawn();
    pool.setPoolSize(1);
    const first = pool.simulate(request);
    const waiting = pool.simulate({ ...request, seed: 99 });
    await Promise.resolve();
    ready(made[0]!);
    await new Promise((done) => { setTimeout(done, 0); });

    pool.cancel();

    await expect(first).rejects.toSatisfy(isCancelled);
    await expect(waiting).rejects.toSatisfy(isCancelled);
  });

  it('취소로 죽은 워커는 다시 자리에 안 들어간다', async () => {
    // 돌던 계산의 `finally`가 죽은 워커를 풀에 되돌리면 다음 계산이 끝난 스레드로 간다.
    const { pool, made } = spawn();
    const running = pool.simulate(request);
    await Promise.resolve();
    pool.cancel();
    await expect(running).rejects.toSatisfy(isCancelled);
    // 여기서 돌아온 워커가 섞였다면 새 계산이 죽은 0번으로 갔을 것이다.
    const sims = (worker: FakeWorker) =>
      worker.messages.filter((message) => message.type === 'simulate').length;
    const again = pool.simulate(request);
    await Promise.resolve();
    ready(made[1]!);
    await new Promise((done) => { setTimeout(done, 0); });
    expect(sims(made[0]!)).toBe(1);   // 취소되기 전에 받은 그 한 판뿐
    expect(sims(made[1]!)).toBe(1);   // 새 판은 새 워커로 갔다
    answer(made[1]!);
    await expect(again).resolves.toEqual(result);
  });
});
