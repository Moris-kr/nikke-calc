/**
 * 파이썬 `json.dumps` / `json.load`와 같은 글을 내고 읽는 도구.
 *
 * 스크립트가 쓰는 JSON 파일(스냅샷 baseline·settings.json)은 파이썬 시절 파일과 **바이트까지** 같아야 한다.
 * JS의 `JSON.stringify`와 다른 점은 두 가지다.
 *  1. 수 — 파이썬은 float를 `3.0`, `1e-05`로 적는다. JS 수에는 int/float 구분이 없으므로, 파이썬에서 float였던
 *     값은 엔진의 float 표시(`_mark_float`)나 `PyFloat`로 알려 준다. 정수가 아닌 값은 표시가 없어도 float다.
 *  2. 키 순서 — JS 객체는 정수 모양 키(`"100101"`)를 앞으로 당겨 오름차순으로 둔다. 파이썬 삽입 순서를 지켜야
 *     하는 곳은 `Map`을 쓴다. `loadOrdered`가 파일 순서를 지킨 `Map`으로 읽는다.
 */
import { _is_float, _mark_float, _py_float_repr } from '../../src/engine/customization';

/** 파이썬 float임을 알리는 상자(정수값인 float를 `3.0`으로 적게 한다). */
export class PyFloat {
  constructor(readonly value: number) {}
}

/** `obj`의 `keys`가 파이썬 float임을 표시하고 `obj`를 돌려준다. */
export function floats<T extends object>(obj: T, ...keys: Array<string | number>): T {
  for (const k of keys) _mark_float(obj, k);
  return obj;
}

/** 배열의 모든 칸이 파이썬 float임을 표시한다. */
export function floatList(xs: number[]): number[] {
  xs.forEach((_, i) => _mark_float(xs, i));
  return xs;
}

function numText(v: number, isFloat: boolean, allowNan: boolean): string {
  if (!Number.isFinite(v)) {
    if (!allowNan) throw new Error(`Out of range float values are not JSON compliant: ${v}`);
    return Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity';
  }
  if (isFloat || !Number.isInteger(v)) return _py_float_repr(v);
  return String(v);
}

export interface DumpOptions {
  /** 파이썬 `indent`. 없으면 한 줄(`, `·`: ` 구분). */
  indent?: number;
  /** 파이썬 `allow_nan` (기본 참). */
  allowNan?: boolean;
}

/** 파이썬 `json.dumps(v, ensure_ascii=False, indent=...)`. */
export function pyDumps(value: unknown, opts: DumpOptions = {}): string {
  const indent = opts.indent;
  const allowNan = opts.allowNan ?? true;
  const itemSep = indent === undefined ? ', ' : ',';
  const out: string[] = [];

  const enc = (v: unknown, isFloat: boolean, level: number): void => {
    if (v === null || v === undefined) { out.push('null'); return; }
    if (v === true) { out.push('true'); return; }
    if (v === false) { out.push('false'); return; }
    if (v instanceof PyFloat) { out.push(numText(v.value, true, allowNan)); return; }
    if (typeof v === 'number') { out.push(numText(v, isFloat, allowNan)); return; }
    if (typeof v === 'string') { out.push(JSON.stringify(v)); return; }
    let entries: Array<[string | null, unknown, boolean]>;
    let open: string; let close: string;
    if (Array.isArray(v)) {
      entries = v.map((x, i) => [null, x, _is_float(v, i)]);
      open = '['; close = ']';
    } else if (v instanceof Map) {
      entries = [...v.entries()].map(([k, x]) => [String(k), x, false]);
      open = '{'; close = '}';
    } else if (v instanceof Set) {
      throw new Error('Object of type set is not JSON serializable');
    } else if (typeof v === 'object') {
      entries = Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, x, _is_float(v, k)]);
      open = '{'; close = '}';
    } else {
      throw new Error(`Object of type ${typeof v} is not JSON serializable`);
    }
    if (entries.length === 0) { out.push(open + close); return; }
    out.push(open);
    const inner = indent === undefined ? '' : '\n' + ' '.repeat(indent * (level + 1));
    const outer = indent === undefined ? '' : '\n' + ' '.repeat(indent * level);
    entries.forEach(([k, x, f], i) => {
      if (i > 0) out.push(itemSep);
      out.push(inner);
      if (k !== null) out.push(JSON.stringify(k) + ': ');
      enc(x, f, level + 1);
    });
    out.push(outer + close);
  };

  enc(value, false, 0);
  return out.join('');
}

/**
 * 파이썬 `json.load`처럼 읽되 float였던 값에 표시를 남긴다(`JSON.parse` 원문 접근).
 * 정수 모양 키의 순서는 JS 객체 규칙을 따른다 — 순서가 중요하면 `loadOrdered`.
 */
export function loadMarked(text: string): any {
  return JSON.parse(text, function reviver(this: any, key: string, value: unknown, ctx?: { source?: string }) {
    if (typeof value === 'number' && ctx?.source !== undefined && /[.eE]/.test(ctx.source)) {
      _mark_float(this, key);
    }
    return value;
  } as any);
}

/**
 * 파이썬 `json.load` — 사전은 파일 순서를 지킨 `Map`, float는 `PyFloat`로 읽는다.
 * 그대로 `pyDumps`에 넘기면 파이썬이 읽었다 다시 쓴 것과 같은 글이 된다.
 */
export function loadOrdered(text: string): unknown {
  let i = 0;
  const ws = (): void => {
    while (i < text.length && ' \t\n\r'.includes(text[i]!)) i += 1;
  };
  const fail = (what: string): never => { throw new SyntaxError(`JSON: ${what} at ${i}`); };
  const str = (): string => {
    const start = i;
    i += 1;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= text.length) fail('unterminated string');
    i += 1;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const val = (): unknown => {
    ws();
    const c = text[i];
    if (c === '{') {
      i += 1;
      const m = new Map<string, unknown>();
      ws();
      if (text[i] === '}') { i += 1; return m; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('expected key');
        const k = str();
        ws();
        if (text[i] !== ':') fail('expected :');
        i += 1;
        m.set(k, val());
        ws();
        if (text[i] === ',') { i += 1; continue; }
        if (text[i] === '}') { i += 1; return m; }
        fail('expected , or }');
      }
    }
    if (c === '[') {
      i += 1;
      const a: unknown[] = [];
      ws();
      if (text[i] === ']') { i += 1; return a; }
      for (;;) {
        a.push(val());
        ws();
        if (text[i] === ',') { i += 1; continue; }
        if (text[i] === ']') { i += 1; return a; }
        fail('expected , or ]');
      }
    }
    if (c === '"') return str();
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|NaN|-?Infinity)/.exec(text.slice(i, i + 400));
    if (!m) return fail('unexpected token');
    const tok = m[0];
    i += tok.length;
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    if (tok === 'null') return null;
    if (tok === 'NaN') return new PyFloat(NaN);
    if (tok.endsWith('Infinity')) return new PyFloat(tok.startsWith('-') ? -Infinity : Infinity);
    return /[.eE]/.test(tok) ? new PyFloat(Number(tok)) : Number(tok);
  };
  const v = val();
  ws();
  if (i !== text.length) fail('extra data');
  return v;
}
