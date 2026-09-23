/**
 * One request per worker thread: never reuse mutable engine globals across requests. (py: nikke_mcp/worker.py)
 *
 * Receives the validated request (`CombatRequest.model_dump(exclude_none=True)`), runs the web
 * calculator's `run_request` and rebuilds the effective characters exactly as the Python worker did.
 */
import { run_request } from '../../site/src/engine/bridge.ts';
import { normalize_character_overrides } from '../../site/src/engine/customization.ts';
import { PyError } from '../../site/src/engine/py.ts';
import { DEFAULT_CHAR, build_squad } from '../../site/src/engine/spec.ts';
import { ensureEngineData } from './engine.ts';
import { pySlice } from './pyjson.ts';

export function run(request: Record<string, any>): Record<string, unknown> {
  try {
    ensureEngineData();
    const result = JSON.parse(run_request(request));
    const overrides: Record<string, Record<string, any>> = {};
    for (const [name, value] of Object.entries(request['characters'] as Record<string, unknown>)) {
      overrides[name] = normalize_character_overrides(value, { character_name: name });
    }
    for (const name of request['squad'] as string[]) {
      const own = (overrides[name] ??= {});
      own['level'] = request['synchroLevel'];
      if (request['console'] != null) own['console'] = { ...DEFAULT_CHAR['console'], ...request['console'] };
      if (request['burstRegenTime'] != null) own['burst_regen_time'] = request['burstRegenTime'];
    }
    const effective = build_squad(request['squad'], overrides);
    return { result, effectiveCharacters: JSON.parse(JSON.stringify(effective)) };
  } catch (error) {
    const expected = error instanceof PyError ? ['ValueError', 'TypeError', 'KeyError'].includes(error.pyType) : error instanceof TypeError;
    if (!expected) throw error;
    return { error: pySlice(String((error as Error).message), 1500) };
  }
}
