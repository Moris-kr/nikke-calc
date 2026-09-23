/** Python `==`, `set()` and `len()` for JSON-derived values (numbers compare by value; True == 1). */
import { isDict, numberOf, pyLen } from './pyjson.ts';

function number(value: unknown): number | null {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return numberOf(value);
}

export function pyEqual(a: unknown, b: unknown): boolean {
  const x = number(a);
  const y = number(b);
  if (x !== null || y !== null) return x !== null && y !== null && x === y;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => pyEqual(v, b[i]));
  }
  if (isDict(a) || isDict(b)) {
    if (!isDict(a) || !isDict(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && pyEqual(a[k], b[k]));
  }
  return a === b || (a == null && b == null);
}

/** Python hash identity for set membership; lists and dicts are unhashable (TypeError). */
export function hashKey(value: unknown): string {
  const n = number(value);
  if (n !== null) return `n:${n}`;
  if (typeof value === 'string') return `s:${value}`;
  if (value === null || value === undefined) return 'None';
  throw new TypeError('unhashable type');
}

export function pySet(values: Iterable<unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const v of values) out.set(hashKey(v), v);
  return out;
}

/** Python iteration: list items, dict keys, str characters; anything else is a TypeError. */
export function pyIter(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isDict(value)) return Object.keys(value);
  if (typeof value === 'string') return Array.from(value);
  throw new TypeError('object is not iterable');
}

/** Python `len()`. */
export function pyLenOf(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (isDict(value)) return Object.keys(value).length;
  if (typeof value === 'string') return pyLen(value);
  throw new TypeError('object has no len()');
}

/** `obj.get(key, default)`: an AttributeError unless `obj` is a dict. */
export function pyGet(obj: unknown, key: string, fallback: unknown = null): any {
  if (!isDict(obj)) throw new TypeError("'object' has no attribute 'get'");
  return Object.hasOwn(obj, key) ? obj[key] : fallback;
}

/** `obj[key]`: KeyError/TypeError when missing or not subscriptable. */
export function pyItem(obj: unknown, key: string | number): any {
  if (typeof key === 'number') {
    if (!Array.isArray(obj) || key < 0 || key >= obj.length) throw new TypeError('index');
    return obj[key];
  }
  if (!isDict(obj) || !Object.hasOwn(obj, key)) throw new TypeError(`KeyError: ${key}`);
  return obj[key];
}

/** Python truthiness for JSON-derived values. */
export function pyTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  const n = number(value);
  if (n !== null) return n !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isDict(value)) return Object.keys(value).length > 0;
  return true;
}
