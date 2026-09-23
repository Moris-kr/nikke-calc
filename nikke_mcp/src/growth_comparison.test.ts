// py: nikke_mcp/test_growth_comparison.py — the browser's growth comparison (TS engine) and the relay.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compare_growth } from '../../site/src/engine/growth_comparison.ts';
import { BrowserRelay } from './browser_relay.ts';
import { ensureEngineData } from './engine.ts';
import { GrowthScenario } from './models.ts';
import { dump } from './pydantic.ts';

ensureEngineData();

describe('growth comparison', () => {
  it('partial cube changes preserve the equipped cube', () => {
    const scenario = GrowthScenario.validate({ label: '큐브 10', changes: { cube: { level: 10 } } });
    const result = compare_growth({ name: '민트', baseline: { cube: { name: '렐릭 베어 큐브', level: 5 } },
      scenarios: [dump(scenario, { excludeUnset: true, excludeNone: true })] });
    const cube = result['scenarios'][0]['effectiveCharacter']['cube'];
    assert.equal(cube['name'], '렐릭 베어 큐브');
    assert.equal(cube['level'], 10);
  });

  it('real growth result passes the relay round trip', () => {
    const relay = new BrowserRelay();
    const session = relay.connect() as Record<string, string>;
    const scenarios = [{ label: 'SR5', changes: { collection: { stage: 'SR5' } } }];
    const job = relay.submit(session['connectionCode'], { kind: 'growth', name: '민트', scenarios });
    relay.poll(session['browserToken']);
    const result = compare_growth({ name: '민트', baseline: { collection: { stage: 'R15' } }, scenarios });
    result['engineVersion'] = 'test';
    relay.finish(session['browserToken'], job['jobId'] as string, result);
    assert.equal(relay.result(session['connectionCode'], job['jobId'] as string)['status'], 'complete');
  });

  it('independent scenarios preserve current growth', () => {
    const request = { name: '민트', synchroLevel: 250,
      baseline: { growthStage: 0, equipLevels: { '머리': 0, '팔': 0, '몸통': 0, '다리': 0 },
        collection: { stage: 'R15', favorite: 0 }, skillLevels: { 1: 4, 2: 5, 3: 6 } },
      scenarios: [{ label: '장비 4310', changes: { equipLevels: { '머리': 4, '팔': 3, '몸통': 1, '다리': 0 } } },
        { label: 'SR5', changes: { collection: { stage: 'SR5' } } },
        { label: 'SR15', changes: { collection: { stage: 'SR15' } } }] };
    const original = structuredClone(request);
    const result = compare_growth(request);
    assert.deepEqual(request, original);
    const [equip, sr5, sr15] = result['scenarios'];
    assert.ok(equip['delta'] > 0);
    // R15 -> SR5 can decrease CP: grade alone does not guarantee a gain.
    assert.ok(sr5['delta'] < 0);
    assert.ok(sr15['combatPower'] > sr5['combatPower']);
    assert.equal(sr5['effectiveCharacter']['equipment']['머리']['level'], 0);
    assert.equal(equip['effectiveCharacter']['collection_stage'], 'R15');
    assert.equal(equip['effectiveCharacter']['level'], 250);
    assert.equal(result['baseline']['effectiveCharacter']['skill_levels']['1'], 4);
    assert.ok(Math.abs(equip['delta'] - (equip['combatPower'] - result['baseline']['combatPower'])) < 0.005);
  });

  it('invalid and missing baselines do not silently default', () => {
    for (const request of [{ name: '민트', baseline: {}, scenarios: [] },
      { name: '민트', baseline: { growthStage: 0 }, scenarios: [{ label: 'bad', changes: { equipLevels: { '머리': 6 } } }] }]) {
      assert.throws(() => compare_growth(request), (error: Error) => error.name === 'ValueError');
    }
  });
});
