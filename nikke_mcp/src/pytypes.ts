/**
 * Python number types for the text block of tool results.
 *
 * The Python server rendered its result dict with `pydantic_core.to_json`, so a float that happens to be
 * whole printed as `40.0`. The TypeScript engine computes plain JavaScript numbers and cannot say which
 * of them Python would have held as floats. For the engine's outputs the server therefore uses a table of
 * JSON paths at which the Python engine produced floats (./python-floats.json, recorded from the last
 * Python engine over the parity corpus and the tool outputs); everything else prints like Python ints.
 * Values the MCP layer validated or read from data files carry their type directly ({@link PyFloat}).
 */
import { readFileSync } from 'node:fs';
import { character_names } from './engine.ts';
import { PyFloat, isDict } from './pyjson.ts';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Path segment for a dict key: dynamic keys (names, numeric keys) collapse to `*`. */
export function keySegment(key: string, names: ReadonlySet<string>): string {
  return IDENT.test(key) && !names.has(key) ? key : '*';
}

/** Path segment for an array element: positional for the recorded fixed-shape tuples, else `[]`. */
export function indexSegment(path: string, index: number, tuples: ReadonlySet<string>): string {
  return tuples.has(path) ? `[${index}]` : '[]';
}

export interface FloatTable {
  /** Array paths whose elements are positional (e.g. `[start, end]` pairs). */
  tuples: readonly string[];
  /** Paths at which Python held floats, per tool family. */
  floats: Record<string, readonly string[]>;
}

let table: FloatTable | null = null;
let tuples: ReadonlySet<string> | null = null;
let names: ReadonlySet<string> | null = null;

function floats(): FloatTable {
  table ??= JSON.parse(readFileSync(new URL('./python-floats.json', import.meta.url), 'utf8')) as FloatTable;
  return table;
}

/**
 * Value-dependent types the path table cannot express. A full burst still running at the end of the
 * battle closes at `min(result.duration, planned_end)`, which is the int duration itself.
 */
function pythonInt(path: string, value: number, duration: unknown): boolean {
  return /(^|\.)(timeline|fineTimeline)\.fullBurst\[\]\[1\]$/.test(path) && value === duration;
}

/** Families: which recorded table applies to a tool's result, and which prefix to strip. */
const FAMILY: Record<string, string> = {
  simulate_squad: 'simulate', simulate_shared_state: 'simulate', compare_setups: 'simulate',
  get_settings: 'get_settings',
};

/**
 * Wrap the whole numbers Python would have printed as floats in {@link PyFloat}, for {@link toText}.
 * Returns the value unchanged for tools without a recorded table.
 */
export function withPythonFloats(tool: string, value: unknown): unknown {
  const family = FAMILY[tool];
  if (!family) return value;
  names ??= new Set(character_names());
  tuples ??= new Set(floats().tuples);
  const paths = new Set(floats().floats[family] ?? []);
  let duration: unknown;
  const walk = (v: unknown, path: string): unknown => {
    if (typeof v === 'number') {
      return Number.isInteger(v) && paths.has(path) && !pythonInt(path, v, duration) ? new PyFloat(v) : v;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}${indexSegment(path, i, tuples!)}`));
    if (isDict(v)) {
      if (path === 'result') duration = v['duration'];
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        // compare_setups nests the simulate result shape; the request echo already carries its own types.
        if (family === 'simulate' && path === '' && k === 'candidates') out[k] = (x as unknown[]).map((c) => walk(c, ''));
        else if (family === 'simulate' && path === '' && k === 'request') out[k] = x;
        else out[k] = walk(x, `${path}${path ? '.' : ''}${keySegment(k, names!)}`);
      }
      return out;
    }
    return v;
  };
  return walk(value, '');
}
