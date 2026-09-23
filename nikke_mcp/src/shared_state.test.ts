// py: nikke_mcp/test_shared_state.py
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { run_request } from '../../site/src/engine/bridge.ts';
import { CONSOLE_CLASSES, CONSOLE_COMPANIES } from '../../site/src/engine/customization.ts';
import { ensureEngineData } from './engine.ts';
import { InvalidSettingsError } from './errors.ts';
import { dump, ValidationError } from './pydantic.ts';
import { unbox } from './pyjson.ts';
import { CalculatorService } from './service.ts';
import { SharedState, shared_request } from './shared_state.ts';

ensureEngineData();

function snapshot(): Record<string, any> {
  return { format: 'nikke-calc-mcp', version: 1, battle: { duration: 10, synchroLevel: 321 },
    roster: { '리타': { skillLevels: { 1: 4, 2: 5, 3: 6 } } },
    decks: [{ squad: ['리타'], duration: 10, synchroLevel: 456, characters: { '리타': { skillLevels: { 1: 7, 2: 8, 3: 9 } } } }] };
}

describe('shared state', () => {
  it('deck and roster remain separate', () => {
    const state = SharedState.validate(snapshot());
    assert.equal(shared_request(state).v['synchroLevel'], 456);
    const request = shared_request(state, 1, ['리타']);
    assert.equal(request.v['synchroLevel'], 321);
    assert.equal(request.v['characters']['리타'].v['skillLevels']['1'], 4);
    assert.throws(() => shared_request(state, 1, ['크라운']), InvalidSettingsError);
    for (const index of [0, -1, 2]) assert.throws(() => shared_request(state, index), InvalidSettingsError);
  });

  it('rejects versions, private metadata and unknown settings', () => {
    for (const patch of [{ version: 2 }, { nickname: 'private' }, { format: 'backup' }, { roster: { missing: {} } },
      { battle: { console: { common_level: -1 } } }, { battle: { hacks: {} } }]) {
      assert.throws(() => SharedState.validate({ ...snapshot(), ...patch }), ValidationError, JSON.stringify(patch));
    }
  });

  it('account growth matches the web engine and effective characters', async () => {
    const data = snapshot();
    Object.assign(data['decks'][0], {
      console: { common_level: 90, class_level: Object.fromEntries(CONSOLE_CLASSES.map((n) => [n, 30])),
        company_level: Object.fromEntries(CONSOLE_COMPANIES.map((n) => [n, 50])) },
      burstRegenTime: 3, burstReaction: 0.2,
      immuneWindows: [{ from: 2, to: 3 }],
      defenseRateWindows: [{ from: 6, to: 8, rate: 60 }],
      elementWindows: [{ from: 4, to: 5, code: '철갑' }],
      normalHitCoeff: { SMG: 0.8 }, optimalRangeWeapons: ['SMG'],
      optimalRangeWindows: [{ from: 1, to: 2, weapons: [] }],
      burstSequence: [{ 1: ['리타'] }],
      characters: { '리타': { growthStage: 2, skillLevels: { 1: 7, 2: 8, 3: 9 }, cube: { name: '없음', level: 0 },
        collection: { stage: 'SR5', favorite: 0 }, equipLevels: { '머리': 3, '몸통': 2, '팔': 1, '다리': 0 },
        overload: { atk_pct: 12 }, control: {} } },
    });
    const request = shared_request(SharedState.validate(data));
    const out = await new CalculatorService().simulate(request, true) as Record<string, any>;
    assert.deepEqual(out['result'], JSON.parse(run_request(dump(request, { excludeNone: true }))));
    assert.equal(out['effectiveCharacters'][0]['level'], 456);
    assert.equal(out['effectiveCharacters'][0]['console']['common_level'], 90);
    assert.equal(out['effectiveCharacters'][0]['burst_regen_time'], 3);
    const echoed = unbox(out['request']);
    assert.deepEqual(echoed['immuneWindows'], [{ from: 2, to: 3 }]);
    assert.deepEqual(echoed['optimalRangeWindows'], [{ from: 1, to: 2, weapons: [] }]);
    assert.deepEqual(echoed['defenseRateWindows'], [{ from: 6, to: 8, rate: 60 }]);
  });
});
