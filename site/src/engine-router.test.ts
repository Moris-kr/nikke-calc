import { describe, expect, it, vi } from 'vitest';
import { EngineRouter } from './engine-router';
import { CalculationCancelled, type CalculatorPool } from './worker-client';
import type { SimulationRequest, SimulationResult } from './types';

const request = { squad: ['a'] } as unknown as SimulationRequest;
const result = (tag: string) => ({ tag } as unknown as SimulationResult);

function fakePool(simulate: () => Promise<SimulationResult>) {
  return {
    simulate: vi.fn(simulate),
    prepare: vi.fn(async () => undefined),
    combatPower: vi.fn(async () => ({ a: 1 })),
    setPoolSize: vi.fn(),
    defaultPoolSize: () => 2,
    cancel: vi.fn(),
    dispose: vi.fn(),
  } as unknown as CalculatorPool & Record<string, ReturnType<typeof vi.fn>>;
}

describe('계산 엔진 라우터', () => {
  it('고속 엔진을 고르면 전투 계산은 고속 엔진이 한다', async () => {
    const python = fakePool(async () => result('py'));
    const fast = fakePool(async () => result('fast'));
    const router = new EngineRouter('fast', python, () => fast);
    expect(await router.simulate(request)).toEqual({ tag: 'fast' });
    expect(python.simulate).not.toHaveBeenCalled();
  });

  it('고속 엔진이 실패하면 그 판을 파이썬 엔진으로 다시 계산하고 알린다', async () => {
    const python = fakePool(async () => result('py'));
    const fast = fakePool(async () => { throw new Error('boom'); });
    const router = new EngineRouter('fast', python, () => fast);
    const seen: string[] = [];
    router.onFallback(({ error }) => seen.push(error.message));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await router.simulate(request)).toEqual({ tag: 'py' });
    expect(seen).toEqual(['boom']);
  });

  it('사람이 끊은 계산은 파이썬으로 넘기지 않는다', async () => {
    const python = fakePool(async () => result('py'));
    const fast = fakePool(async () => { throw new CalculationCancelled(); });
    const router = new EngineRouter('fast', python, () => fast);
    await expect(router.simulate(request)).rejects.toThrow(CalculationCancelled);
    expect(python.simulate).not.toHaveBeenCalled();
  });

  it('파이썬 엔진을 고르면 고속 엔진은 띄우지도 않는다', async () => {
    const python = fakePool(async () => result('py'));
    const makeFast = vi.fn(() => fakePool(async () => result('fast')));
    const router = new EngineRouter('python', python, makeFast);
    await router.prepare();
    expect(await router.simulate(request)).toEqual({ tag: 'py' });
    expect(makeFast).not.toHaveBeenCalled();
  });

  it('전투력은 어느 엔진이든 파이썬 엔진이 한다', async () => {
    const python = fakePool(async () => result('py'));
    const fast = fakePool(async () => result('fast'));
    const router = new EngineRouter('fast', python, () => fast);
    await router.combatPower({} as never);
    expect(python.combatPower).toHaveBeenCalled();
  });

  it('고속 엔진 준비가 실패하면 파이썬 엔진을 준비한다', async () => {
    const python = fakePool(async () => result('py'));
    const fast = fakePool(async () => result('fast'));
    (fast.prepare as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('no data'));
    const router = new EngineRouter('fast', python, () => fast);
    await router.prepare();
    expect(python.prepare).toHaveBeenCalled();
  });

  it('병렬 개수는 두 엔진에 같이 걸린다', () => {
    const python = fakePool(async () => result('py'));
    const fast = fakePool(async () => result('fast'));
    const router = new EngineRouter('fast', python, () => fast);
    router.setPoolSize(3);
    void router.simulate(request);
    expect(python.setPoolSize).toHaveBeenCalledWith(3);
    expect(fast.setPoolSize).toHaveBeenCalledWith(3);
  });
});
