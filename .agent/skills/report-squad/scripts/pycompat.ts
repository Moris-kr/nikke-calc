/**
 * 파이썬 의미·표기 도우미 — 보고서 스크립트(report·growth·optimize…)가 파이썬 시절과 **같은 파일**을 내게 한다.
 *
 * 계산 엔진(`site/src/engine/`)은 파이썬 엔진을 직역했고 `py.ts`가 수 의미(`sum`·`round`…)를 맞춘다.
 * 여기는 그 위의 «보고서 층»이 쓰는 나머지다.
 *
 *  - JSON — 파이썬 `json.load`/`json.dumps`. JS 수에는 int/float 구분이 없으므로 float였던 값은 담긴 객체에
 *    표시(`_mark_float`)해 두고 `2.0`으로 적는다. 읽을 때는 원문에 `.`/`e`가 있던 수를 표시한다.
 *  - 서식 — f-string 서식 지정자(`{x:,.2f}` `{x:+6.2f}` `{x:g}` `{s:<36}`), `html.escape`.
 *  - 통계 — `math.fsum`, `statistics.fmean`, `statistics.stdev`(3.12, 정확한 유리수 계산).
 *  - 파일 — 파이썬 텍스트 모드처럼 쓸 때 줄바꿈을 `os.linesep`으로 바꾼다(윈도우에서 CRLF).
 *  - 종료 — `raise SystemExit(msg)`와 같은 동작(`runMain`).
 */

import { EOL } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  _is_float, _mark_float, _py_fmt_g, _py_float_repr, _py_is_dict, _py_str,
} from '../../../../site/src/engine/customization';
import { PyError } from '../../../../site/src/engine/py';

// ── 예외·종료 ─────────────────────────────────────────────────────────────

/** 파이썬 `raise SystemExit(msg)`. `runMain`이 메시지를 표준 오류에 내고 1로 끝낸다. */
export const SystemExit = (msg: string): PyError => new PyError('SystemExit', msg);

export function isSystemExit(e: unknown): e is PyError {
  return e instanceof PyError && e.pyType === 'SystemExit';
}

/** 최상위 진입 — 파이썬 인터프리터처럼 `SystemExit`은 메시지만, 나머지는 트레이스백을 낸다. */
export function runMain(main: () => void | Promise<void>): void {
  Promise.resolve()
    .then(main)
    .catch((e) => {
      if (isSystemExit(e)) process.stderr.write(`${e.message}\n`);
      else process.stderr.write(`${(e as Error)?.stack ?? String(e)}\n`);
      process.exitCode = 1;
    });
}

/** 파이썬 `print(...)`. */
export function print(...parts: unknown[]): void {
  process.stdout.write(parts.map((p) => (typeof p === 'string' ? p : _py_str(p))).join(' ') + '\n');
}

// ── 파일 (파이썬 텍스트 모드) ──────────────────────────────────────────────

/** `Path.read_text(encoding="utf-8")` — 보편 줄바꿈(`\r\n` → `\n`). */
export function readText(path: string): string {
  return readFileSync(path, 'utf-8').replace(/\r\n?/g, '\n');
}

/** `Path.write_text(text, encoding="utf-8")` / `open(p, "w")` — `\n`을 `os.linesep`으로 쓴다. */
export function writeText(path: string, text: string): void {
  writeFileSync(path, EOL === '\n' ? text : text.replace(/\n/g, EOL), 'utf-8');
}

/** `webbrowser.open(path.as_uri())`. */
export function openInBrowser(path: string): void {
  const url = pathToFileURL(path).href;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
}

// ── 시각 ──────────────────────────────────────────────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `datetime.now().strftime("%Y-%m-%d %H:%M")`. */
export function nowMinute(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** `datetime.now().astimezone().isoformat(timespec="seconds")`. */
export function isoSeconds(d: Date = new Date()): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:`
    + `${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${sign}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}

/** `datetime.fromtimestamp(ms/1000, tz=utc).astimezone().isoformat(timespec="seconds")`. */
export function isoFromMs(ms: number): string {
  return isoSeconds(new Date(Math.floor(ms / 1000) * 1000));
}

// ── float 표시 ────────────────────────────────────────────────────────────

/** `obj`의 `keys`가 파이썬 float임을 표시하고 `obj`를 돌려준다. */
export function floats<T extends object>(obj: T, ...keys: Array<string | number>): T {
  for (const k of keys) _mark_float(obj, k);
  return obj;
}

/** `obj[key] = value`(파이썬 float). */
export function setF(obj: Record<string, any>, key: string, value: number): void {
  obj[key] = value;
  _mark_float(obj, key);
}

/** `d[key]`의 파이썬 `str()` (float 표시 반영). */
export function strOf(d: any, key: string | number): string {
  return _py_str(d?.[key], _is_float(d, key));
}

/** `{**a, **b}` / `dict(a); d.update(b)` — 얕은 병합 + float 표시 이전. */
export function merged(...parts: Array<Record<string, any> | null | undefined>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const p of parts) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) {
      out[k] = v;
      _mark_float(out, k, _is_float(p, k));
    }
  }
  return out;
}

// ── JSON ──────────────────────────────────────────────────────────────────

/**
 * `json.loads` — float였던 수(원문에 `.`·`e`가 있거나 NaN·Infinity)에 표시를 남긴다.
 * 파이썬의 `NaN`·`Infinity` 토큰도 읽는다.
 */
export function loadsMarked(text: string): any {
  let src = text;
  const special = /(?<![\w"])(-?Infinity|NaN)(?![\w"])/;
  const hasSpecial = special.test(src) && !/^\s*"/.test(src);
  const SENT = '\u0000PYNUM:';
  if (hasSpecial) {
    // 문자열 밖의 NaN/Infinity만 문자열 표지로 바꾼다.
    let out = ''; let i = 0; let inStr = false;
    while (i < src.length) {
      const c = src[i]!;
      if (inStr) {
        out += c;
        if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; }
        if (c === '"') inStr = false;
        i += 1; continue;
      }
      if (c === '"') { inStr = true; out += c; i += 1; continue; }
      const m = /^(-?Infinity|NaN)/.exec(src.slice(i, i + 9));
      if (m) { out += JSON.stringify(SENT + m[1]); i += m[1]!.length; continue; }
      out += c; i += 1;
    }
    src = out;
  }
  return JSON.parse(src, function reviver(this: any, key: string, value: unknown, ctx?: { source?: string }) {
    if (typeof value === 'number' && ctx?.source !== undefined && /[.eE]/.test(ctx.source)) {
      _mark_float(this, key);
    } else if (hasSpecial && typeof value === 'string' && value.startsWith(SENT)) {
      const tok = value.slice(SENT.length);
      _mark_float(this, key);
      return tok === 'NaN' ? NaN : tok.startsWith('-') ? -Infinity : Infinity;
    }
    return value;
  } as any);
}

/** `json.load(open(path, encoding="utf-8"))`. */
export function loadJson(path: string): any {
  return loadsMarked(readFileSync(path, 'utf-8'));
}

export interface DumpOptions {
  /** `indent` — 없으면 한 줄. */
  indent?: number;
  /** `sort_keys`. */
  sortKeys?: boolean;
  /** `separators` — 기본은 파이썬 기본값(`(", ", ": ")`, indent가 있으면 `(",", ": ")`). */
  separators?: [string, string];
}

function numText(v: number, isFloat: boolean): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity';
  if (isFloat || !Number.isInteger(v)) return _py_float_repr(v);
  return String(v);
}

/** 파이썬 `str` 비교 순서(코드 포인트). BMP 밖 글자까지 파이썬과 같게 정렬한다. */
export function cmpStr(a: string, b: string): number {
  const ia = a[Symbol.iterator](); const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next(); const y = ib.next();
    if (x.done || y.done) return x.done && y.done ? 0 : x.done ? -1 : 1;
    const cx = x.value.codePointAt(0)!; const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

/** `json.dumps(value, ensure_ascii=False, ...)`. 사전은 일반 객체 또는 `Map`. */
export function dumps(value: unknown, opts: DumpOptions = {}): string {
  const indent = opts.indent;
  const [itemSep, keySep] = opts.separators ?? (indent === undefined ? [', ', ': '] : [',', ': ']);
  const out: string[] = [];
  const enc = (v: unknown, isFloat: boolean, level: number): void => {
    if (v === null || v === undefined) { out.push('null'); return; }
    if (v === true) { out.push('true'); return; }
    if (v === false) { out.push('false'); return; }
    if (typeof v === 'number') { out.push(numText(v, isFloat)); return; }
    if (typeof v === 'bigint') { out.push(v.toString()); return; }
    if (typeof v === 'string') { out.push(JSON.stringify(v)); return; }
    let entries: Array<[string | null, unknown, boolean]>;
    let open: string; let close: string;
    if (Array.isArray(v)) {
      entries = v.map((x, i) => [null, x, _is_float(v, i)]);
      open = '['; close = ']';
    } else if (v instanceof Map) {
      entries = [...v.entries()].map(([k, x]) => [typeof k === 'string' ? k : _py_str(k), x, false]);
      open = '{'; close = '}';
    } else if (_py_is_dict(v)) {
      entries = Object.keys(v).map((k) => [k, (v as any)[k], _is_float(v, k)]);
      open = '{'; close = '}';
    } else {
      throw new Error(`Object of type ${typeof v} is not JSON serializable`);
    }
    if (opts.sortKeys && open === '{') entries.sort((a, b) => cmpStr(a[0]!, b[0]!));
    if (entries.length === 0) { out.push(open + close); return; }
    out.push(open);
    const inner = indent === undefined ? '' : '\n' + ' '.repeat(indent * (level + 1));
    const outer = indent === undefined ? '' : '\n' + ' '.repeat(indent * level);
    entries.forEach(([k, x, f], i) => {
      if (i > 0) out.push(itemSep);
      out.push(inner);
      if (k !== null) out.push(JSON.stringify(k) + keySep);
      enc(x, f, level + 1);
    });
    out.push(outer + close);
  };
  enc(value, false, 0);
  return out.join('');
}

// ── 서식 ──────────────────────────────────────────────────────────────────

/** 음이 아닌 유한 실수 → 소수 `p`자리 고정 표기(정확한 이진값 기준, 동률이면 짝수 쪽). */
function fixedAbs(ax: number, p: number): string {
  if (ax >= 1e21) {
    // 정수부만 의미가 있는 크기 — BigInt로 정확한 정수를 적는다.
    const int = BigInt(ax).toString();
    return p > 0 ? `${int}.${'0'.repeat(p)}` : int;
  }
  const exact = ax.toFixed(100);
  const dot = exact.indexOf('.');
  const intPart = exact.slice(0, dot);
  const frac = exact.slice(dot + 1);
  const kept = intPart + frac.slice(0, p);
  const r0 = frac.charCodeAt(p) - 48;
  const tail = frac.slice(p + 1).replace(/0+$/, '');
  let n = BigInt(kept);
  let up: boolean;
  if (r0 > 5) up = true;
  else if (r0 < 5) up = false;
  else if (tail.length > 0) up = true;
  else up = n % 2n === 1n;
  if (up) n += 1n;
  let digits = n.toString().padStart(p + 1, '0');
  if (p === 0) return digits;
  digits = digits.padStart(p + 1, '0');
  return `${digits.slice(0, digits.length - p)}.${digits.slice(digits.length - p)}`;
}

function group3(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 파이썬 `format(x, spec)` — 이 스크립트들이 쓰는 부분집합.
 * `[[fill]align][sign][width][,][.precision][type]`, type은 `f`·`g`·`d`·없음.
 * 문자열이면 정렬·폭만 본다. `isFloat`은 정수값인 float를 `repr`로 적을 때(type 없음) 쓴다.
 */
export function fmt(x: unknown, spec: string, isFloat = false): string {
  const m = /^(?:(.)?([<>^=]))?([+\- ])?(\d+)?(,)?(?:\.(\d+))?([fgd%])?$/u.exec(spec);
  if (!m) throw new Error(`지원하지 않는 서식: ${spec}`);
  let [, fill, align, sign, width, comma, prec, type] = m;
  if (align && fill === undefined) fill = ' ';
  if (typeof x === 'string') {
    return padTo(x, Number(width ?? 0), align ?? '<', fill ?? ' ');
  }
  let v: number;
  if (typeof x === 'boolean') v = x ? 1 : 0;
  else if (typeof x === 'number') v = x;
  else throw new Error(`서식 대상이 수가 아니다: ${String(x)}`);
  const neg = v < 0 || Object.is(v, -0);
  const av = Math.abs(v);
  let body: string;
  if (!Number.isFinite(v)) {
    body = Number.isNaN(v) ? 'nan' : 'inf';
  } else if (type === 'f') {
    body = fixedAbs(av, prec === undefined ? 6 : Number(prec));
  } else if (type === '%') {
    body = fixedAbs(av * 100, prec === undefined ? 6 : Number(prec)) + '%';
  } else if (type === 'g') {
    if (prec !== undefined) throw new Error('g 정밀도는 지원하지 않는다');
    body = _py_fmt_g(av);
  } else if (type === 'd' || (type === undefined && Number.isInteger(v) && !isFloat)) {
    body = BigInt(Math.trunc(av)).toString();
  } else {
    body = _py_float_repr(av);
  }
  if (comma) {
    const i = body.search(/[.e%]/);
    const intPart = i < 0 ? body : body.slice(0, i);
    body = (/^\d+$/.test(intPart) ? group3(intPart) : intPart) + (i < 0 ? '' : body.slice(i));
  }
  const s = neg && !(Number.isNaN(v)) ? '-' : sign === '+' ? '+' : sign === ' ' ? ' ' : '';
  const w = Number(width ?? 0);
  if ((align ?? '>') === '=') {
    return s + padTo(body, w - s.length, '>', fill ?? ' ');
  }
  return padTo(s + body, w, align ?? '>', fill ?? ' ');
}

function padTo(s: string, width: number, align: string, fill: string): string {
  const len = [...s].length;
  if (len >= width) return s;
  const n = width - len;
  if (align === '<') return s + fill.repeat(n);
  if (align === '^') return fill.repeat(Math.floor(n / 2)) + s + fill.repeat(n - Math.floor(n / 2));
  return fill.repeat(n) + s;
}

/** `html.escape(str(v))` (quote=True). */
export function esc(v: unknown): string {
  return (typeof v === 'string' ? v : _py_str(v))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

// ── 통계 (CPython 3.12) ───────────────────────────────────────────────────

/** `math.fsum` — Shewchuk 부분합 + 마지막 반올림 보정 (CPython `math_fsum`). */
export function fsum(values: Iterable<number>): number {
  const partials: number[] = [];
  let specialSum = 0; let infSum = 0; let special = false;
  for (let x of values) {
    if (!Number.isFinite(x)) {
      if (Number.isNaN(x)) special = true;
      else infSum += x;
      specialSum += x;
      special = true;
      continue;
    }
    let i = 0;
    for (let j = 0; j < partials.length; j += 1) {
      let y = partials[j]!;
      if (Math.abs(x) < Math.abs(y)) { const t = x; x = y; y = t; }
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) { partials[i] = lo; i += 1; }
      x = hi;
    }
    partials.length = i;
    partials.push(x);
  }
  if (special) {
    if (Number.isNaN(infSum)) throw new Error('ValueError: -inf + inf in fsum');
    return specialSum;
  }
  let n = partials.length;
  let hi = 0;
  if (n > 0) {
    n -= 1;
    hi = partials[n]!;
    let lo = 0;
    while (n > 0) {
      const x = hi;
      n -= 1;
      const y = partials[n]!;
      hi = x + y;
      const yr = hi - x;
      lo = y - yr;
      if (lo !== 0) break;
    }
    if (n > 0 && ((lo < 0 && partials[n - 1]! < 0) || (lo > 0 && partials[n - 1]! > 0))) {
      const y = lo * 2;
      const x = hi + y;
      const yr = x - hi;
      if (y === yr) hi = x;
    }
  }
  return hi;
}

/** `statistics.fmean(values)`. */
export function fmean(values: number[]): number {
  if (!values.length) throw new Error('StatisticsError: fmean requires at least one data point');
  return fsum(values) / values.length;
}

/** 유한 실수 → 정확한 (분자, 분모=2^k). */
function exactRatio(x: number): [bigint, bigint] {
  if (Number.isInteger(x)) return [BigInt(x), 1n];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hiw = buf.getUint32(0); const low = buf.getUint32(4);
  const signNeg = (hiw >>> 31) === 1;
  const expBits = (hiw >>> 20) & 0x7ff;
  let mant = (BigInt(hiw & 0xfffff) << 32n) | BigInt(low);
  let e: number;
  if (expBits === 0) e = -1074;
  else { mant |= 1n << 52n; e = expBits - 1075; }
  let num = signNeg ? -mant : mant;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den = 1n << BigInt(-e);
  // 약분(분모가 2의 거듭제곱이라 2로만 나눈다)
  while (den > 1n && (num & 1n) === 0n) { num >>= 1n; den >>= 1n; }
  return [num, den];
}

function bigGcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

function bitLength(n: bigint): number {
  return n === 0n ? 0 : (n < 0n ? -n : n).toString(2).length;
}

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(bitLength(n) / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** `statistics._float_sqrt_of_frac(n, m)` — n/m의 제곱근, 정확히 반올림. */
function floatSqrtOfFrac(n: bigint, m: bigint): number {
  const rto = (a: bigint, b: bigint): bigint => {
    const r = isqrt(a / b);
    return r | (r * r * b !== a ? 1n : 0n);
  };
  const q = Math.floor((bitLength(n) - bitLength(m) - 109) / 2);
  if (q >= 0) {
    return Number(rto(n, m << BigInt(2 * q)) << BigInt(q));
  }
  const numerator = rto(n << BigInt(-2 * q), m);
  return Number(numerator) / 2 ** -q;
}

/** `statistics.stdev(values)` (3.12 — 제곱 편차 합을 정확한 유리수로). */
export function stdev(values: number[]): number {
  const n = values.length;
  if (n < 2) throw new Error('StatisticsError: stdev requires at least two data points');
  // sx = Σx, sxx = Σx² (정확한 유리수, 공통 분모)
  let sxN = 0n; let sxD = 1n; let sxxN = 0n; let sxxD = 1n;
  for (const x of values) {
    const [a, b] = exactRatio(x);
    // sx += a/b
    const d1 = sxD > b ? sxD : b; // 둘 다 2의 거듭제곱 → 큰 쪽이 공배수
    sxN = sxN * (d1 / sxD) + a * (d1 / b); sxD = d1;
    const bb = b * b;
    const d2 = sxxD > bb ? sxxD : bb;
    sxxN = sxxN * (d2 / sxxD) + a * a * (d2 / bb); sxxD = d2;
  }
  const N = BigInt(n);
  // ssd = (n*sxx - sx*sx) / n
  // n*sxx = n*sxxN/sxxD, sx² = sxN²/sxD² ; sxD² 와 sxxD 는 2의 거듭제곱
  const sx2D = sxD * sxD;
  const D = sx2D > sxxD ? sx2D : sxxD;
  const numr = N * sxxN * (D / sxxD) - sxN * sxN * (D / sx2D);
  // mss = ssd / (n-1) = numr / (D * n * (n-1))
  let mN = numr; let mD = D * N * (N - 1n);
  const g = bigGcd(mN, mD);
  if (g > 1n) { mN /= g; mD /= g; }
  return floatSqrtOfFrac(mN, mD);
}
