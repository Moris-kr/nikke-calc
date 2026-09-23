// py: nikke_mcp/test_defense_rate.py, test_optimal_range.py, test_service.py (ValidationTests)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BattleOptions, CombatRequest, RecommendationScenario } from './models.ts';
import { dump, jsonSchema, ValidationError } from './pydantic.ts';
import { PyFloat, parseJson } from './pyjson.ts';
import { get_character, list_characters } from './service.ts';
import { ensureEngineData } from './engine.ts';

ensureEngineData();
const BASE = { squad: ['리타'], duration: 10 };

describe('defense rate windows', () => {
  it('round trip and default rate', () => {
    const request = CombatRequest.validate({ squad: ['리타'], defenseRateWindows: [{ from: 30, to: 60 }] });
    assert.deepEqual(dump(request)['defenseRateWindows'], [{ from: 30, to: 60, rate: 60 }]);
    assert.deepEqual(CombatRequest.validate({ squad: ['리타'] }).v['defenseRateWindows'], []);
  });

  it('invalid windows', () => {
    for (const window of [{ from: 60, to: 30 }, { from: -1, to: 30 }, { from: 0, to: 181 }, { from: 0, to: 30, rate: -1 },
      { from: 0, to: 30, rate: 101 }, { from: 0, to: 30, rate: new PyFloat(NaN) }]) {
      assert.throws(() => CombatRequest.validate({ squad: ['리타'], defenseRateWindows: [window] }), ValidationError);
    }
  });
});

describe('optimal range windows', () => {
  it('round trip and recommendation', () => {
    const windows = [{ from: 1, to: 2, weapons: [] }];
    assert.deepEqual(dump(BattleOptions.validate({ optimalRangeWindows: windows }))['optimalRangeWindows'], windows);
    RecommendationScenario.validate({ label: 'range', battle: { optimalRangeWindows: windows } });
    assert.deepEqual(BattleOptions.validate({}).v['optimalRangeWindows'], []);
  });

  it('invalid windows', () => {
    for (const window of [{ from: 2, to: 1, weapons: [] }, { from: 0, to: new PyFloat(Infinity), weapons: [] },
      { from: 0, to: 1, weapons: ['unknown'] }, { from: 0, to: 1 }]) {
      assert.throws(() => BattleOptions.validate({ optimalRangeWindows: [window] }), ValidationError);
    }
  });
});

describe('request validation', () => {
  it('invalid or ignored inputs are rejected', () => {
    for (const fields of [{ duration: 181 }, { duration: true }, { duration: 0 }, { squad: ['없는 캐릭터'] }, { squad: ['리타', '리타'] },
      { customCharacters: {} }, { hacks: {} }, { corePx: new PyFloat(NaN) }, { characters: { '크라운': {} } },
      { characters: { '리타': { skillLevels: { 1: 11 } } } }, parseJson('{"duration": 10.0}') as object]) {
      assert.throws(() => CombatRequest.validate({ ...BASE, ...fields }), ValidationError, JSON.stringify(fields));
    }
  });

  it('nested typos and unused burst fields are rejected', () => {
    for (const burst of [{ mode: 'priority', evry: 2 }, { mode: 'skip', every: 2 }, { mode: 'endgame', seconds: true }]) {
      assert.throws(() => CombatRequest.validate({ ...BASE, characters: { '리타': { burst } } }), ValidationError);
    }
  });

  it('character schema exposes nested options', () => {
    const schema = jsonSchema(CombatRequest) as any;
    assert.ok('CharacterOverrides' in schema.$defs);
    assert.ok('control' in schema.$defs.CharacterOverrides.properties);
  });

  it('catalog uses real characters and level values', () => {
    assert.ok((list_characters('리타')['characters'] as unknown[]).length);
    assert.ok(!(list_characters()['characters'] as Array<{ name: string }>).some((row) => row.name.startsWith('test_')));
    assert.notDeepEqual(get_character('리타', 1)['skills'], get_character('리타', 10)['skills']);
  });
});
