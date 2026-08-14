import { describe, expect, it } from 'vitest';

import { CalculatorWorkerClient, type WorkerLike } from './worker-client';
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
