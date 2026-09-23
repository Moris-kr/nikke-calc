/**
 * 파이썬 의미 그대로 — 고속(TS) 엔진이 파이썬 엔진과 **같은 수**를 내기 위한 도구.
 *
 * 사이트의 기존 엔진은 Pyodide 0.27(= CPython 3.12)에서 돈다. 새 엔진은 그 결과와 대조하므로
 * 3.12의 동작을 기준으로 맞춘다. 결과를 바꾸는 차이만 여기 모았다:
 *
 * - `sum()` — 3.12부터 실수 합은 Neumaier 보정 합산이다(단순 누적과 마지막 자리가 다르다).
 * - `round(x)` · `round(x, n)` — 은행가 반올림(동률이면 짝수), n자리는 **정확한 이진값** 기준.
 * - `int(x)` — 0 쪽으로 자름. `//`·`%` — 내림 나눗셈과 제수 부호를 따르는 나머지.
 * - 참·거짓 — 빈 리스트·빈 사전·0·빈 문자열·None은 거짓(JS는 `[]`·`{}`가 참이다).
 * - `random` — 메르센 트위스터(MT19937), `seed(int)`, `random()`, `sample()`을 CPython과 같게.
 */

// ── 예외 ────────────────────────────────────────────────────────────────

/** 파이썬 예외 — 메시지는 파이썬과 같은 글을 쓴다(화면에 그대로 뜬다). */
export class PyError extends Error {
  constructor(public pyType: string, message: string) {
    super(message);
    this.name = pyType;
  }
}
export const ValueError = (msg: string) => new PyError('ValueError', msg);
export const KeyError = (msg: string) => new PyError('KeyError', msg);
export const TypeError_ = (msg: string) => new PyError('TypeError', msg);

// ── 참·거짓 ────────────────────────────────────────────────────────────────

/** 파이썬 `bool(v)`. NaN은 파이썬에서 참이다. */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Map || v instanceof Set) return v.size > 0;
  if (typeof v === 'object') {
    for (const k in v as object) if (Object.prototype.hasOwnProperty.call(v, k)) return true;
    return false;
  }
  return true;
}

/** 파이썬 `a or b` — a가 참이면 a, 아니면 b. */
export function or<A, B>(a: A, b: B): A | B {
  return truthy(a) ? a : b;
}

/** 파이썬 `a and b`. */
export function and<A, B>(a: A, b: B): A | B {
  return truthy(a) ? b : a;
}

// ── 사전 ──────────────────────────────────────────────────────────────────

type Dict = Record<string, any>;

/** `d.get(k, default)` — 키가 **없을 때만** 기본값. 값이 None(null)이면 null을 준다. */
export function get<T = any>(d: Dict | null | undefined, key: string | number, dflt?: T): T {
  if (d == null) return dflt as T;
  const k = typeof key === 'string' ? key : String(key);
  // 빠른 길: 값이 있고 함수가 아니면 자기 속성이다(JSON·엔진 사전에는 함수 값이 없다 —
  // 함수면 `constructor` 같은 프로토타입 속성일 수 있어 느린 길로 확인한다).
  const v = d[k];
  if (v !== undefined && typeof v !== 'function') return v as T;
  return (Object.prototype.hasOwnProperty.call(d, k) ? v : dflt) as T;
}

/**
 * 파이썬 튜플 키 → 문자열. 문자열과 수를 구분한다(`"1"` ≠ `1`). 수는 `String(x)`(왕복 가능한 최단
 * 표기)라 서로 다른 실수는 다른 키가 된다. 그 밖의 값(배열 등)은 JSON으로 싼다.
 */
export function tupleKey(...parts: unknown[]): string {
  let s = '';
  for (const p of parts) {
    if (typeof p === 'string') s += `s${p}\u0000`;
    else if (typeof p === 'number') s += `n${p}\u0000`;
    else s += `j${JSON.stringify(p)}\u0000`;
  }
  return s;
}

/** `key in d` (사전). */
export function has(d: Dict | null | undefined, key: string | number): boolean {
  return d != null && Object.prototype.hasOwnProperty.call(d, String(key));
}

/** `d.setdefault(k, v)`. */
export function setdefault<T>(d: Dict, key: string, v: T): T {
  if (!Object.prototype.hasOwnProperty.call(d, key)) d[key] = v;
  return d[key] as T;
}

/** `d.pop(k, default)`. */
export function pop<T = any>(d: Dict, key: string, dflt?: T): T {
  if (Object.prototype.hasOwnProperty.call(d, key)) {
    const v = d[key];
    delete d[key];
    return v as T;
  }
  if (arguments.length < 3) throw new Error(`KeyError: ${key}`);
  return dflt as T;
}

/** `d[k]` — 없으면 KeyError. */
export function item<T = any>(d: Dict, key: string | number): T {
  const k = String(key);
  if (d == null || !Object.prototype.hasOwnProperty.call(d, k)) throw new Error(`KeyError: ${k}`);
  return d[k] as T;
}

/** 파이썬 `copy.deepcopy`(JSON 성질의 자료). */
export function deepcopy<T>(v: T): T {
  return v === undefined ? v : structuredClone(v);
}

// ── 수 ────────────────────────────────────────────────────────────────────

/** CPython 3.12 `sum(iterable, start=0)` — 실수는 Neumaier 보정 합산. */
export function sum(values: Iterable<number>, start = 0): number {
  let f = start;
  let c = 0;
  for (const x of values) {
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += (f - t) + x;
    else c += (x - t) + f;
    f = t;
  }
  // CPython: 보정값이 0이 아니고 유한할 때만 더한다.
  if (c !== 0 && Number.isFinite(c)) f += c;
  return f;
}

/** 파이썬 `int(x)` — 0 쪽으로 자른다. 문자열이면 정수로 읽는다. */
export function int(x: number | string | boolean): number {
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (typeof x === 'string') {
    const s = x.trim();
    if (!/^[+-]?\d+$/.test(s)) throw new Error(`ValueError: invalid literal for int(): '${x}'`);
    return parseInt(s, 10);
  }
  if (!Number.isFinite(x)) throw new Error('ValueError: cannot convert float NaN/inf to integer');
  return Math.trunc(x) + 0;
}

/** 파이썬 `float(x)`. */
export function float(x: number | string | boolean): number {
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (typeof x === 'string') {
    const s = x.trim().toLowerCase();
    if (s === 'inf' || s === '+inf' || s === 'infinity') return Infinity;
    if (s === '-inf' || s === '-infinity') return -Infinity;
    if (s === 'nan') return NaN;
    const v = Number(s);
    if (s === '' || Number.isNaN(v)) throw new Error(`ValueError: could not convert string to float: '${x}'`);
    return v;
  }
  return x;
}

/** 파이썬 `a // b`. */
export function floordiv(a: number, b: number): number {
  if (b === 0) throw new Error('ZeroDivisionError');
  if (Number.isInteger(a) && Number.isInteger(b)) return Math.floor(a / b);
  // 실수: CPython float_floor_div = floor((a - fmod(a,b)) / b) 보정판
  const mod = pymod(a, b);
  let div = (a - mod) / b;
  if (div) {
    const fl = Math.floor(div);
    if (div - fl > 0.5) div = fl + 1; else div = fl;
  } else div = 0 * (a / b);
  return div;
}

/** 파이썬 `a % b` — 결과 부호가 제수를 따른다. */
export function pymod(a: number, b: number): number {
  if (b === 0) throw new Error('ZeroDivisionError');
  let r = a % b;
  if (r !== 0 && (r < 0) !== (b < 0)) r += b;
  else if (r === 0) r = b < 0 ? -0 : 0;
  return r;
}

/** 파이썬 `round(x)` — 정수로, 동률이면 짝수(은행가 반올림). */
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * 파이썬 `round(x, n)`. n이 없으면 정수. n자리는 double의 **정확한 십진 전개**를 보고 반올림한다
 * (`0.125`는 동률이라 짝수 쪽 `0.12`, `2.675`는 실제 값이 2.67499…라 `2.67`).
 */
const POW10 = Array.from({ length: 23 }, (_, i) => 10 ** i);

export function round(x: number, n?: number): number {
  if (!Number.isFinite(x)) return x;
  if (n === undefined || n === null) return roundHalfEven(x);
  if (n > 20) return x;
  const neg = x < 0;
  const ax = Math.abs(x);
  // 빠른 길: y = |x|·10ⁿ 의 곱셈 오차(≤ y·2⁻⁵³)보다 소수부가 0.5에서 멀면 반올림 방향이 정확한 십진
  // 전개와 같다. 그때 k/10ⁿ(둘 다 정확한 정수)의 IEEE 나눗셈은 파이썬이 내는 «k×10⁻ⁿ에 가장 가까운
  // double»과 같은 값이다. 동률 근처만 아래 정확한 길로 간다.
  if (n >= 0) {
    const p = POW10[n]!;
    const y = ax * p;
    if (y < 1e15) {
      const k = Math.floor(y);
      const f = y - k;
      if (Math.abs(f - 0.5) > y * 1e-15 + 1e-300) {
        const r = (f > 0.5 ? k + 1 : k) / p;
        return neg ? -r : r;
      }
    }
  }
  // toFixed(100)은 double의 정확한 십진 전개를 준다(이 엔진이 다루는 크기에서는 잘리지 않는다).
  const exact = ax.toFixed(100);
  const dot = exact.indexOf('.');
  const intPart = exact.slice(0, dot);
  const frac = exact.slice(dot + 1);
  if (n < 0) {
    const scale = 10 ** -n;
    const q = ax / scale;
    const r = roundHalfEven(q) * scale;
    return neg ? -r : r;
  }
  const kept = frac.slice(0, n);
  const rest = frac.slice(n);
  let digits = BigInt(intPart + kept);
  const first = rest.charCodeAt(0) - 48;
  const tail = rest.slice(1).replace(/0+$/, '');
  let up: boolean;
  if (first > 5) up = true;
  else if (first < 5) up = false;
  else if (tail.length > 0) up = true;
  else up = digits % 2n === 1n; // 정확히 절반 — 짝수 쪽
  if (up) digits += 1n;
  const s = digits.toString().padStart(n + 1, '0');
  const out = Number(n === 0 ? s : `${s.slice(0, s.length - n)}.${s.slice(s.length - n)}`);
  return neg ? -out : out;
}

/** `math.isfinite`. */
export const isfinite = Number.isFinite;

/** 파이썬 `min(iterable)` / `max(iterable)` — 비면 ValueError, key가 같으면 먼저 나온 것. */
export function minBy<T>(items: Iterable<T>, key: (v: T) => number = (v) => v as unknown as number): T {
  let best: T | undefined;
  let bestK = 0;
  let any = false;
  for (const v of items) {
    const k = key(v);
    if (!any || k < bestK) { best = v; bestK = k; any = true; }
  }
  if (!any) throw new Error('ValueError: min() arg is an empty sequence');
  return best as T;
}
export function maxBy<T>(items: Iterable<T>, key: (v: T) => number = (v) => v as unknown as number): T {
  let best: T | undefined;
  let bestK = 0;
  let any = false;
  for (const v of items) {
    const k = key(v);
    if (!any || k > bestK) { best = v; bestK = k; any = true; }
  }
  if (!any) throw new Error('ValueError: max() arg is an empty sequence');
  return best as T;
}

// ── 정렬 ──────────────────────────────────────────────────────────────────

/** 파이썬 비교(`<`) — 수, 문자열(코드 포인트), 튜플(배열, 사전식), bool. */
export function cmp(a: any, b: any): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
      const c = cmp(a[i], b[i]);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    // 코드 포인트 비교(파이썬 str). 서로게이트 쌍까지 맞추려고 한 글자씩 본다.
    const A = [...a];
    const B = [...b];
    const n = Math.min(A.length, B.length);
    for (let i = 0; i < n; i += 1) {
      const x = A[i]!.codePointAt(0)!;
      const y = B[i]!.codePointAt(0)!;
      if (x !== y) return x < y ? -1 : 1;
    }
    return A.length - B.length;
  }
  const x = typeof a === 'boolean' ? Number(a) : a;
  const y = typeof b === 'boolean' ? Number(b) : b;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** 파이썬 `sorted(items, key=..., reverse=...)` — 안정 정렬. */
export function sorted<T>(items: Iterable<T>, key?: (v: T) => any, reverse = false): T[] {
  const arr = [...items];
  const k = key ?? ((v: T) => v);
  const withKey = arr.map((v, i) => ({ v, k: k(v), i }));
  withKey.sort((a, b) => {
    const c = cmp(a.k, b.k);
    if (c !== 0) return reverse ? -c : c;
    return a.i - b.i; // 안정 — reverse여도 같은 키는 원래 순서(CPython과 같다)
  });
  return withKey.map((e) => e.v);
}

// ── 문자열 ────────────────────────────────────────────────────────────────

/** 파이썬 `str(float)`·f-string `{x}`의 실수 표기 — 정수값이면 `1.0`. */
export function reprFloat(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return `${x}.0`;
  const s = String(x);
  // JS는 1e21부터 지수 표기, 파이썬은 1e16부터 — 이 엔진의 로그·키에서는 그 크기가 안 나온다.
  return s.replace('e+', 'e+');
}

// ── 난수 (CPython `random`) ───────────────────────────────────────────────

/** CPython `random.Random` — MT19937과 같은 시드·같은 수열. */
export class PyRandom {
  private mt = new Uint32Array(624);
  private mti = 625;

  constructor(seed: number = 0) {
    this.seed(seed);
  }

  private initGenrand(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < 624; i += 1) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      // 1812433253 * prev + i (32비트)
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.mti = 624;
  }

  private initByArray(key: number[]): void {
    this.initGenrand(19650218);
    const mt = this.mt;
    let i = 1;
    let j = 0;
    const n = 624;
    let k = n > key.length ? n : key.length;
    for (; k; k -= 1) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = ((mt[i]! ^ Math.imul(prev, 1664525)) + key[j]! + j) >>> 0;
      i += 1; j += 1;
      if (i >= n) { mt[0] = mt[n - 1]!; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (k = n - 1; k; k -= 1) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = ((mt[i]! ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i += 1;
      if (i >= n) { mt[0] = mt[n - 1]!; i = 1; }
    }
    mt[0] = 0x80000000;
  }

  /** `random.seed(int)` — 정수의 절댓값을 32비트 조각(작은 쪽부터)으로 나눠 init_by_array. */
  seed(seed: number): void {
    let n = BigInt(Math.abs(Math.trunc(seed)));
    const key: number[] = [];
    if (n === 0n) key.push(0);
    while (n > 0n) {
      key.push(Number(n & 0xffffffffn));
      n >>= 32n;
    }
    this.initByArray(key);
  }

  private genrandUint32(): number {
    const mt = this.mt;
    let y: number;
    if (this.mti >= 624) {
      let kk = 0;
      const mag = (v: number) => ((v & 1) ? 0x9908b0df : 0);
      for (; kk < 624 - 397; kk += 1) {
        y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff);
        mt[kk] = (mt[kk + 397]! ^ (y >>> 1) ^ mag(y)) >>> 0;
      }
      for (; kk < 623; kk += 1) {
        y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff);
        mt[kk] = (mt[kk + (397 - 624)]! ^ (y >>> 1) ^ mag(y)) >>> 0;
      }
      y = (mt[623]! & 0x80000000) | (mt[0]! & 0x7fffffff);
      mt[623] = (mt[396]! ^ (y >>> 1) ^ mag(y)) >>> 0;
      this.mti = 0;
    }
    y = mt[this.mti++]!;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** `random.random()` — [0, 1) 53비트. */
  random(): number {
    const a = this.genrandUint32() >>> 5;
    const b = this.genrandUint32() >>> 6;
    return (a * 67108864 + b) * (1 / 9007199254740992);
  }

  /** `getrandbits(k)` (k ≤ 32만 쓴다). */
  getrandbits(k: number): number {
    if (k <= 0) return 0;
    if (k > 32) throw new Error('getrandbits > 32 not supported');
    return this.genrandUint32() >>> (32 - k);
  }

  /** `_randbelow_with_getrandbits(n)`. */
  randbelow(n: number): number {
    if (n <= 0) return 0;
    const k = n.toString(2).length;
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** `random.sample(population, k)` (CPython 3.12 — 작은 모집단 경로). */
  sample<T>(population: T[], k: number): T[] {
    const n = population.length;
    if (k < 0 || k > n) throw new Error('ValueError: Sample larger than population or is negative');
    const result: T[] = new Array(k);
    let setsize = 21;
    if (k > 5) setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));
    if (n <= setsize) {
      const pool = [...population];
      for (let i = 0; i < k; i += 1) {
        const j = this.randbelow(n - i);
        result[i] = pool[j]!;
        pool[j] = pool[n - i - 1]!;
      }
    } else {
      const selected = new Set<number>();
      for (let i = 0; i < k; i += 1) {
        let j = this.randbelow(n);
        while (selected.has(j)) j = this.randbelow(n);
        selected.add(j);
        result[i] = population[j]!;
      }
    }
    return result;
  }
}

/** 파이썬 모듈 전역 `random` — 엔진은 `random.seed(seed)`로 한 번 심고 전역으로 뽑는다. */
export const random = new PyRandom(0);
