/**
 * Python value semantics for JSON that crosses the MCP boundary.
 *
 * The Python server parsed tool arguments with Python's JSON rules: `10` is an int and `10.0` a float.
 * pydantic's strict models reject a float for an int field and print inputs with `repr()`. JavaScript
 * loses that distinction in `JSON.parse`, so request bodies are parsed with {@link parseJson}, which boxes
 * every float literal in a {@link PyFloat}. Validation (./pydantic.ts) unboxes them.
 */

/** A JSON number literal written with a fraction or exponent (`10.0`, `1e3`): a Python float. */
export class PyFloat {
  constructor(readonly value: number) {}

  toJSON(): number {
    return this.value;
  }
}

/** An integer literal beyond 2**53: Python keeps it exact, so its text is kept for `repr`. */
export class PyInt {
  constructor(readonly value: number, readonly text: string) {}

  toJSON(): number {
    return this.value;
  }
}

const PLAIN_STRING = /[^"\\\u0000-\u001f]*/y;
const WHITESPACE = /[ \t\n\r]*/y;
const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const LITERALS: Array<[string, unknown]> = [['true', true], ['false', false], ['null', null], ['NaN', NaN], ['Infinity', Infinity]];

/** A JSON syntax error worded like Python's parser (pydantic-core / jiter): `… at line L column C`. */
export class JsonSyntaxError extends SyntaxError {
  override name = 'JsonSyntaxError';
}

/**
 * JSON read the way the Python server read it (jiter, as `pydantic_core.from_json`): float literals become
 * {@link PyFloat}, unsafe integers {@link PyInt}, `NaN`/`Infinity`/`-Infinity` are accepted, and objects
 * remember their key order ({@link KEY_ORDER}) because JavaScript objects move integer-like keys first.
 * Throws {@link JsonSyntaxError} with jiter's message.
 */
export function parseJson(text: string): unknown {
  let i = 0;
  // jiter reports the byte offset of the offending byte (the last byte at EOF): line = 1 + newlines up to and
  // including it, column = its distance from the last of those newlines.
  const report = (kind: string, offset: number): never => {
    const prefix = Buffer.from(text, 'utf8').subarray(0, offset + 1);
    let line = 1;
    for (const byte of prefix) if (byte === 0x0a) line += 1;
    throw new JsonSyntaxError(`${kind} at line ${line} column ${offset - prefix.lastIndexOf(0x0a)}`);
  };
  /** `at` is one past the offending character (a UTF-16 index). */
  const fail = (kind: string, at: number): never => report(kind, Buffer.byteLength(text.slice(0, at - 1)));
  const eof = (what: string): never => report(`EOF while parsing ${what}`, Buffer.byteLength(text) - 1);
  const skip = () => {
    WHITESPACE.lastIndex = i;
    WHITESPACE.exec(text);
    i = WHITESPACE.lastIndex;
  };
  const hexAt = (at: number): number => {
    if (at + 4 > text.length) eof('a string');
    for (let k = 0; k < 4; k += 1) {
      if (!/[0-9a-fA-F]/.test(text[at + k]!)) fail('invalid escape', at + k + 1);
    }
    return parseInt(text.slice(at, at + 4), 16);
  };
  const string = (): string => {
    i += 1; // opening quote
    let out = '';
    for (;;) {
      PLAIN_STRING.lastIndex = i;
      out += PLAIN_STRING.exec(text)![0];
      i = PLAIN_STRING.lastIndex;
      if (i >= text.length) eof('a string');
      const ch = text[i]!;
      if (ch === '"') {
        i += 1;
        return out;
      }
      if (ch !== '\\') fail('control character (\\u0000-\\u001F) found while parsing a string', i + 1);
      if (i + 1 >= text.length) eof('a string');
      const esc = text[i + 1]!;
      if (esc === 'u') {
        const unit = hexAt(i + 2);
        i += 6;
        if (unit >= 0xd800 && unit <= 0xdbff) {
          if (i >= text.length || (text[i] === '\\' && i + 1 >= text.length)) eof('a string');
          if (text[i] !== '\\') fail('unexpected end of hex escape', i + 1);
          if (text[i + 1] !== 'u') fail('unexpected end of hex escape', i + 2);
          const low = hexAt(i + 2);
          if (low < 0xdc00 || low > 0xdfff) fail('lone leading surrogate in hex escape', i + 6);
          out += String.fromCharCode(unit, low);
          i += 6;
        } else if (unit >= 0xdc00 && unit <= 0xdfff) {
          fail('lone leading surrogate in hex escape', i);
        } else out += String.fromCharCode(unit);
      } else if (Object.hasOwn(ESCAPES, esc)) {
        out += ESCAPES[esc];
        i += 2;
      } else fail('invalid escape', i + 2);
    }
  };
  const literal = (word: string, v: unknown): unknown => {
    for (let k = 0; k < word.length; k += 1) {
      if (i + k >= text.length) eof('a value');
      if (text[i + k] !== word[k]) fail('expected ident', i + k + 1);
    }
    i += word.length;
    return v;
  };
  const digit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
  const number = (): unknown => {
    const start = i;
    if (text[i] === '-') {
      i += 1;
      if (i >= text.length) eof('a value');
      if (text[i] === 'I') return new PyFloat(-(literal('Infinity', Infinity) as number));
    }
    if (!digit(text[i])) fail('invalid number', i + 1);
    if (text[i] === '0') {
      i += 1;
      if (digit(text[i])) fail('invalid number', i + 1);
    } else while (digit(text[i])) i += 1;
    let float = false;
    if (text[i] === '.') {
      float = true;
      i += 1;
      if (i >= text.length) eof('a value');
      if (!digit(text[i])) fail('invalid number', i + 1);
      while (digit(text[i])) i += 1;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      float = true;
      i += 1;
      if (text[i] === '+' || text[i] === '-') i += 1;
      if (i >= text.length) eof('a value');
      if (!digit(text[i])) fail('invalid number', i + 1);
      while (digit(text[i])) i += 1;
    }
    const literalText = text.slice(start, i);
    const n = Number(literalText);
    if (float) return new PyFloat(n);
    return Number.isSafeInteger(n) ? n : new PyInt(n, BigInt(literalText).toString());
  };
  const value = (depth: number): unknown => {
    if (depth > 10000) fail('recursion limit exceeded', i);
    skip();
    if (i >= text.length) eof('a value');
    const ch = text[i]!;
    if (ch === '{') {
      i += 1;
      const out: Record<string, unknown> = {};
      const keys: string[] = [];
      skip();
      if (i >= text.length) eof('an object');
      if (text[i] === '}') {
        i += 1;
        return out;
      }
      let afterComma = false;
      for (;;) {
        skip();
        if (i >= text.length) eof(afterComma ? 'a value' : 'an object');
        if (text[i] !== '"') fail(afterComma && text[i] === '}' ? 'trailing comma' : 'key must be a string', i + 1);
        const key = string();
        skip();
        if (i >= text.length) eof('an object');
        if (text[i] !== ':') fail('expected `:`', i + 1);
        i += 1;
        const v = value(depth + 1);
        if (!Object.hasOwn(out, key)) keys.push(key);
        Object.defineProperty(out, key, { value: v, enumerable: true, writable: true, configurable: true });
        skip();
        if (i >= text.length) eof('an object');
        if (text[i] === ',') {
          i += 1;
          afterComma = true;
          continue;
        }
        if (text[i] === '}') {
          i += 1;
          return keepOrder(out, keys);
        }
        fail('expected `,` or `}`', i + 1);
      }
    }
    if (ch === '[') {
      i += 1;
      const out: unknown[] = [];
      skip();
      if (i >= text.length) eof('a list');
      if (text[i] === ']') {
        i += 1;
        return out;
      }
      for (;;) {
        out.push(value(depth + 1));
        skip();
        if (i >= text.length) eof('a list');
        if (text[i] === ',') {
          i += 1;
          skip();
          if (text[i] === ']') fail('trailing comma', i + 1);
          continue;
        }
        if (text[i] === ']') {
          i += 1;
          return out;
        }
        fail('expected `,` or `]`', i + 1);
      }
    }
    if (ch === '"') return string();
    if (ch === '-' || digit(ch)) return number();
    const word = LITERALS.find(([w]) => w[0] === ch);
    if (word) {
      const v = literal(word[0], word[1]);
      return typeof v === 'number' ? new PyFloat(v) : v;
    }
    return fail('expected value', i + 1);
  };
  const result = value(0);
  skip();
  if (i !== text.length) fail('trailing characters', i + 1);
  return result;
}

/** Number value of a JSON number (boxed or not); `null` for anything else (bool included). */
export function numberOf(value: unknown): number | null {
  if (value instanceof PyFloat || value instanceof PyInt) return value.value;
  return typeof value === 'number' ? value : null;
}

/** Order of keys a Python dict kept (JavaScript moves integer-like keys first, ascending). */
export const KEY_ORDER = Symbol('keyOrder');

export function orderedKeys(value: Record<string, unknown>): string[] {
  return (value as { [KEY_ORDER]?: string[] })[KEY_ORDER] ?? Object.keys(value);
}

/** Remember `keys` as the insertion order of `target` when JavaScript would reorder them. */
export function keepOrder<T extends object>(target: T, keys: string[]): T {
  const actual = Object.keys(target);
  if (keys.length === actual.length && keys.some((k, i) => k !== actual[i])) {
    Object.defineProperty(target, KEY_ORDER, { value: keys, enumerable: false });
  }
  return target;
}

/** `JSON.stringify(value, null, 2)` honouring {@link KEY_ORDER}: the text block of a tool result. */
export function toText(value: unknown, indent = ''): string {
  if (value instanceof PyFloat) {
    const x = value.value;
    return Number.isInteger(x) && Math.abs(x) < 1e16 ? `${x === 0 && Object.is(x, -0) ? '-0' : x}.0` : JSON.stringify(x) ?? 'null';
  }
  if (value instanceof PyInt) return value.text;
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const inner = `${indent}  `;
  const newline = '\n';
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const items = value.map((v) => inner + (v === undefined || typeof v === 'function' ? 'null' : toText(v, inner)));
    return `[${newline}${items.join(`,${newline}`)}${newline}${indent}]`;
  }
  const object = value as Record<string, unknown>;
  const keys = orderedKeys(object).filter((k) => object[k] !== undefined && typeof object[k] !== 'function');
  if (!keys.length) return '{}';
  const items = keys.map((k) => `${inner}${JSON.stringify(k)}: ${toText(object[k], inner)}`);
  return `{${newline}${items.join(`,${newline}`)}${newline}${indent}}`;
}

/** Deep copy with every {@link PyFloat}/{@link PyInt} replaced by its number. */
export function unbox<T = unknown>(value: T): T {
  if (value instanceof PyFloat || value instanceof PyInt) return value.value as unknown as T;
  if (Array.isArray(value)) return value.map((v) => unbox(v)) as unknown as T;
  if (isDict(value)) {
    const out: Record<string, unknown> = {};
    const keys = orderedKeys(value);
    for (const k of keys) out[k] = unbox(value[k]);
    return keepOrder(out, keys) as T;
  }
  return value;
}

/** Plain JSON object (Python dict). */
export function isDict(value: unknown): value is Record<string, any> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof PyFloat || value instanceof PyInt) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Python `type(x).__name__` for JSON-derived values. */
export function pyTypeName(value: unknown): string {
  if (value === null || value === undefined) return 'NoneType';
  if (value instanceof PyFloat) return 'float';
  if (value instanceof PyInt) return 'int';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (typeof value === 'string') return 'str';
  if (Array.isArray(value)) return 'list';
  if (isDict(value)) return 'dict';
  return typeof value;
}

/** Python `repr(float)`. */
export function floatRepr(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const [mantissa, expText] = x.toExponential().split('e') as [string, string];
  const exp = Number(expText);
  const negative = mantissa.startsWith('-');
  const digits = mantissa.replace('-', '').replace('.', '');
  let body: string;
  if (exp >= -4 && exp < 16) {
    if (exp >= 0) {
      const whole = digits.slice(0, exp + 1).padEnd(exp + 1, '0');
      body = `${whole}.${digits.slice(exp + 1) || '0'}`;
    } else {
      body = `0.${'0'.repeat(-exp - 1)}${digits}`;
    }
  } else {
    const head = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    body = `${head}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return (negative ? '-' : '') + body;
}

/** Python `repr(int)`. */
export function intRepr(x: number): string {
  return Math.abs(x) < 1e21 ? String(x === 0 ? 0 : x) : BigInt(x).toString();
}

const NON_PRINTABLE = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]$/u;

/** Python `repr(str)`. */
export function strRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (let i = 0; i < s.length;) {
    const cp = s.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    i += ch.length;
    if (ch === quote || ch === '\\') out += `\\${ch}`;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (cp < 0x20 || cp === 0x7f) out += `\\x${cp.toString(16).padStart(2, '0')}`;
    else if (cp < 0x7f) out += ch;
    else if (!NON_PRINTABLE.test(ch)) out += ch;
    else if (cp <= 0xff) out += `\\x${cp.toString(16).padStart(2, '0')}`;
    else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += `\\U${cp.toString(16).padStart(8, '0')}`;
  }
  return out + quote;
}

/** Python `repr()` of a JSON-derived value (dicts keep insertion order). */
export function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (value instanceof PyFloat) return floatRepr(value.value);
  if (value instanceof PyInt) return value.text;
  if (typeof value === 'number') return Number.isInteger(value) ? intRepr(value) : floatRepr(value);
  if (typeof value === 'string') return strRepr(value);
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`;
  if (isDict(value)) return `{${orderedKeys(value).map((k) => `${strRepr(k)}: ${pyRepr(value[k])}`).join(', ')}}`;
  return String(value);
}

/** Python `str()` for values interpolated into messages (`f'{x}'`). */
export function pyStr(value: unknown): string {
  return typeof value === 'string' ? value : pyRepr(value);
}

const PY_SPACE = '[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]';
const PY_STRIP = new RegExp(`^${PY_SPACE}+|${PY_SPACE}+$`, 'g');

/** Python `str.strip()` (its whitespace set differs from JavaScript `trim`). */
export function pyStrip(s: string): string {
  return s.replace(PY_STRIP, '');
}

/** Python `len(s)`: code points, not UTF-16 units. */
export function pyLen(s: string): number {
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

/** Python `s[:n]` by code points. */
export function pySlice(s: string, n: number): string {
  return Array.from(s).slice(0, n).join('');
}

function jsonString(s: string, asciiOnly: boolean): string {
  const text = JSON.stringify(s);
  return asciiOnly ? text.replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) : text;
}

/**
 * Python `json.dumps(value, ensure_ascii=..., separators=...)` for JSON-derived values.
 * {@link PyFloat} renders as a Python float (`5.0`); used only where Python measured byte sizes.
 */
export function pyDumps(value: unknown, options: { ensureAscii?: boolean; compact?: boolean } = {}): string {
  const ascii = options.ensureAscii ?? true;
  const [itemSep, keySep] = options.compact ? [',', ':'] : [', ', ': '];
  const walk = (v: unknown): string => {
    if (v === null || v === undefined) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (v instanceof PyFloat) return pyJsonFloat(v.value);
    if (v instanceof PyInt) return v.text;
    if (typeof v === 'number') return Number.isInteger(v) ? intRepr(v) : pyJsonFloat(v);
    if (typeof v === 'string') return jsonString(v, ascii);
    if (Array.isArray(v)) return `[${v.map(walk).join(itemSep)}]`;
    if (isDict(v)) return `{${orderedKeys(v).map((k) => `${jsonString(k, ascii)}${keySep}${walk(v[k])}`).join(itemSep)}}`;
    return 'null';
  };
  return walk(value);
}

function pyJsonFloat(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  return floatRepr(x);
}

/** UTF-8 byte length. */
export function utf8Length(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
