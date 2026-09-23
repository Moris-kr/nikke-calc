// py: nikke_mcp/test_service.py (SimulationTests)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { run_request } from '../../site/src/engine/bridge.ts';
import { ensureEngineData } from './engine.ts';
import { CalculationTimeoutError, InvalidSettingsError } from './errors.ts';
import { CombatRequest } from './models.ts';
import { dump } from './pydantic.ts';
import { CalculatorService } from './service.ts';

ensureEngineData();
const BASE = { squad: ['리타'], duration: 10 };
const bridge = (request: ReturnType<typeof CombatRequest.validate>) => JSON.parse(run_request(dump(request, { excludeNone: true })));

describe('simulation', () => {
  it('matches the web bridge and reports conditions', async () => {
    const request = CombatRequest.validate({ ...BASE, characters: { '리타': { cube: { name: '없음', level: 0 } } } });
    const output = await new CalculatorService().simulate(request, true);
    assert.deepEqual(output['result'], bridge(request));
    assert.equal((output['request'] as any)['characters']['리타']['cube']['name'], '없음');
    assert.ok(output['engineVersion']);
    assert.ok('effectiveCharacters' in output);
  });

  it('compares only equal battle conditions', async () => {
    const service = new CalculatorService();
    const a = CombatRequest.validate(BASE);
    const b = CombatRequest.validate({ ...BASE, enemyDef: 1 });
    await assert.rejects(service.compare([a, b]), InvalidSettingsError);
    const result = await service.compare([a, a]);
    assert.equal((result['candidates'] as any[])[1]['deltaFromFirst'], 0);
    assert.equal(result['testedCandidates'], 2);
  });

  it('concurrent requests do not share equipment and a five-member result matches', async () => {
    const service = new CalculatorService();
    const base = { squad: ['리타', '크라운', '신데렐라', '모더니아', '나가'], duration: 30 };
    const normal = CombatRequest.validate(base);
    const changed = CombatRequest.validate({ ...base, characters: { '신데렐라': { cube: { name: '없음', level: 0 } } } });
    const [first, second] = await Promise.all([service.simulate(normal, true), service.simulate(changed, true)]);
    const again = await service.simulate(normal, true);
    assert.deepEqual(first, again);
    assert.notEqual((first['result'] as any)['squadTotal'], (second['result'] as any)['squadTotal']);
    assert.deepEqual(first['result'], bridge(normal));
  });

  it('timeout is reported and the worker is terminated', async () => {
    const service = new CalculatorService(0.001);
    await assert.rejects(service.simulate(CombatRequest.validate(BASE)), CalculationTimeoutError);
  });
});
