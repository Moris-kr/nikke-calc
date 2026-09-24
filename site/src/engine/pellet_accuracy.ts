/**
 * Shotgun body/core probabilities. Drawing mode uses the existing radial model,
 * not a newly claimed measurement of the game's pellet distribution.
 *
 * 이식: calculator/pellet_accuracy.py
 */
import { float, get, sorted, sum, truthy } from './py';

/** 파이썬 튜플 `(kind, x, y, w, h, rotation)`. */
export type Shape = [string, number, number, number, number, number];
/** 파이썬 `scene_at` 반환 튜플 `(shapes, aim, radius, core)`. */
export type Scene = [Shape[], [number, number], number, [number, number, number] | null];

// 파이썬 `min(a, b)` / `max(a, b)` — 같으면 앞의 것(NaN·-0까지 파이썬과 같게).
function _pymin2(a: number, b: number): number {
  return b < a ? b : a;
}
function _pymax2(a: number, b: number): number {
  return b > a ? b : a;
}

/** `math.comb(n, k)` — 정확한 정수(BigInt)로 셈한 뒤 float로(파이썬 int×float 변환과 같은 반올림). */
function _comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let kk = k;
  if (kk > n - kk) kk = n - kk;
  let c = 1n;
  for (let i = 0; i < kk; i += 1) {
    c = (c * BigInt(n - i)) / BigInt(i + 1);
  }
  return Number(c);
}

/**
 * 파이썬 `x ** k`(float ** 음이 아닌 int) — C `pow()`와 같은 **정확히 반올림된** 값.
 * V8의 `**`/`Math.pow`는 정수 지수에서 마지막 자리가 libm과 다르다(예: 0.9 ** 4 → 0.6561000000000001,
 * 파이썬은 0.6561). double-double로 거듭제곱한 뒤 한 번만 반올림한다.
 */
function _two_prod(a: number, b: number): [number, number] {
  const p = a * b;
  const split = (v: number): [number, number] => {
    const t = v * 134217729.0;
    const hi = t - (t - v);
    return [hi, v - hi];
  };
  const [ah, al] = split(a);
  const [bh, bl] = split(b);
  const e = (((ah * bh - p) + ah * bl) + al * bh) + al * bl;
  return [p, e];
}
function _dd_mul(xh: number, xl: number, yh: number, yl: number): [number, number] {
  const [p, e0] = _two_prod(xh, yh);
  const e = e0 + (xh * yl + xl * yh);
  const s = p + e;
  return [s, e - (s - p)];
}
export function _pow_int(x: number, k: number): number {
  if (!Number.isInteger(k) || k < 0 || !Number.isFinite(x) || k > 1024) return x ** k;
  if (k === 0) return 1.0;
  let rh = 1.0;
  let rl = 0.0;
  let bh = x;
  let bl = 0.0;
  let n = k;
  while (true) {
    if (n & 1) [rh, rl] = _dd_mul(rh, rl, bh, bl);
    n >>>= 1;
    if (n === 0) break;
    [bh, bl] = _dd_mul(bh, bl, bh, bl);
  }
  const r = rh + rl;
  // 넘침·아주 작은 수(double-double 오차 가정이 깨지는 곳)는 그대로 둔다.
  if (!Number.isFinite(r) || Math.abs(r) < 1e-290) return x ** k;
  return r;
}

// py: calculator/pellet_accuracy.py:8
export function contains(shape: Shape, x: number, y: number): boolean {
  const [kind, sx, sy, w, h, rotation] = shape;
  if (w <= 0 || h <= 0) {
    return false;
  }
  // math.radians(x) = x * (pi / 180)
  const angle = -rotation * (Math.PI / 180.0);
  const dx = x - sx;
  const dy = y - sy;
  const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
  const ly = dx * Math.sin(angle) + dy * Math.cos(angle);
  if (kind === 'circle') {
    // `v ** 2` → v * v (정확히 반올림된 제곱)
    const a = lx / (w / 2);
    const b = ly / (h / 2);
    return a * a + b * b <= 1;
  }
  if (kind === 'rect') {
    return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
  }
  const ratio = (ly + h / 2) / h;
  return 0 <= ratio && ratio <= 1 && Math.abs(lx) <= w / 2 * ratio;
}

// py: calculator/pellet_accuracy.py:24
export function aim_at(geometry: Record<string, any>, t: number): any {
  const keys = sorted(get<any[]>(geometry, 'aimKeys', []), (k: any) => k['t']);
  if (!truthy(keys)) {
    const core = get(geometry, 'core');
    return truthy(core) ? core : get(geometry, 'center');
  }
  if (t <= keys[0]['t']) {
    return keys[0];
  }
  for (let i = 0; i < keys.length - 1; i += 1) {
    const before = keys[i];
    const after = keys[i + 1];
    if (t <= after['t']) {
      const ratio = (t - before['t']) / (after['t'] - before['t']);
      const out: Record<string, number> = {};
      for (const axis of ['x', 'y']) {
        out[axis] = before[axis] + (after[axis] - before[axis]) * ratio;
      }
      return out;
    }
  }
  return keys[keys.length - 1];
}

// @lru_cache(maxsize=4096) — 결과에는 영향이 없다(순수 함수). 키는 인자 JSON.
const _integrate_cache = new Map<string, [number, number]>();
const _INTEGRATE_MAX = 4096;

// py: calculator/pellet_accuracy.py:37
export function integrate(
  shapes: Shape[],
  aim: [number, number],
  radius: number,
  core: [number, number, number] | null,
  exponent: number,
): [number, number] {
  const cacheKey = JSON.stringify([shapes, aim, radius, core, exponent]);
  const cached = _integrate_cache.get(cacheKey);
  if (cached !== undefined) {
    _integrate_cache.delete(cacheKey);
    _integrate_cache.set(cacheKey, cached);
    return [cached[0], cached[1]];
  }
  const result = _integrate(shapes, aim, radius, core, exponent);
  _integrate_cache.set(cacheKey, result);
  if (_integrate_cache.size > _INTEGRATE_MAX) {
    const oldest = _integrate_cache.keys().next().value;
    if (oldest !== undefined) _integrate_cache.delete(oldest);
  }
  return [result[0], result[1]];
}

// py: calculator/pellet_accuracy.py:38 (본문)
function _integrate(
  shapes: Shape[],
  aim: [number, number],
  radius: number,
  core: [number, number, number] | null,
  exponent: number,
): [number, number] {
  /** Deterministic equal-probability quadrature (1024 points); overlaps count once. */
  let hits = 0;
  let cores = 0;
  for (let i = 0; i < 1024; i += 1) {
    const r = radius * ((i + 0.5) / 1024) ** (1 / exponent);
    const angle = i * 2.399963229728653;
    const x = aim[0] + r * Math.cos(angle);
    const y = aim[1] + r * Math.sin(angle);
    if (shapes.some((shape) => contains(shape, x, y))) {
      hits += 1;
      if (core) {
        const ddx = x - core[0];
        const ddy = y - core[1];
        if (ddx * ddx + ddy * ddy <= core[2] * core[2]) {
          cores += 1;
        }
      }
    }
  }
  return [hits / 1024, hits ? cores / hits : 0];
}

// py: calculator/pellet_accuracy.py:52
export function scene_at(
  enemy: Record<string, any>,
  name: string,
  t: number,
  full_burst: any,
  radius: number,
): Scene | null {
  /** Resolve the exact spatial inputs once for both integration and diagnostics. */
  let size: any = null;
  for (const w of get<any[]>(enemy, 'shotgun_size_windows', [])) {
    if (w['from'] <= t && t < w['to']) {
      size = w['diameter'];
      break;
    }
  }
  const geometry = get(enemy, 'shotgun_geometry');
  const model = get(enemy, 'shotgun_model');
  // 신식 적정거리는 거리 d만큼 보스가 커지거나 작아진다(코어는 core_px에 이미 반영돼 있다).
  const dscale = get(enemy, 'range_model') === 'distance' ? float(get(enemy, 'distance_scale', 1)) : 1;
  if (geometry == null && (model === 'spatial-v1' || model === 'spatial-convergence-v1')) {
    // Same coordinate units as the existing core/boss canvas, not a claim
    // that raw CDN scale values are physical screen pixels.
    const diameter = float(size != null ? size : get(enemy, 'shotgun_target_diameter', 360)) * dscale;
    const core_d = float(get(enemy, 'core_px', 0));
    return [[['circle', 0, 0, diameter, diameter, 0]], [0, 0], radius,
      core_d > 0 ? [0, 0, core_d / 2] : null];
  }
  if (geometry == null) {
    return null;
  }
  let aim: any = aim_at(geometry, t);
  if (!truthy(full_burst) && name !== get(geometry, 'playerName')) {
    const center = get(geometry, 'center');
    aim = truthy(center) ? center : aim;
  }
  if (!truthy(aim)) {
    return [[], [0, 0], radius, null];
  }
  let shapes: Shape[] = [];
  for (const s of [...get<any[]>(geometry, 'shapes', []), ...get<any[]>(geometry, 'parts', [])]) {
    const windows = get(s, 'windows');
    if (!truthy(windows) || (s['windows'] as any[]).some(([a, b]: [number, number]) => a <= t && t < b)) {
      shapes.push([s['kind'], s['x'], s['y'], s['w'], s['h'], get(s, 'rotation', 0)]);
    }
  }
  const coreRaw = get(geometry, 'core');
  let core: [number, number, number] | null =
    truthy(coreRaw) && get(enemy, 'core_px', 0) > 0 ? [coreRaw['x'], coreRaw['y'], coreRaw['d'] / 2] : null;
  const override = get(get(geometry, 'spread', {}), name);
  if (truthy(override) && override > 0) {
    radius = override / 2;
  }
  if (size != null || dscale !== 1) {
    // Scale the drawn target around its center; keep the pellet spread fixed.
    const c1 = get(geometry, 'center');
    const cx = (truthy(c1) ? c1 : aim)['x'];
    const c2 = get(geometry, 'center');
    const cy = (truthy(c2) ? c2 : aim)['y'];
    const scale = (size != null ? size / float(get(enemy, 'shotgun_target_diameter', 360)) : 1) * dscale;
    shapes = shapes.map(([k, x, y, w, h, r]): Shape =>
      [k, cx + (x - cx) * scale, cy + (y - cy) * scale, w * scale, h * scale, r]);
    aim = { x: cx + (aim['x'] - cx) * scale, y: cy + (aim['y'] - cy) * scale };
    if (core) {
      core = [cx + (core[0] - cx) * scale, cy + (core[1] - cy) * scale, core[2] * scale];
    }
  }
  return [shapes, [aim['x'], aim['y']], radius, core];
}

// py: calculator/pellet_accuracy.py:89
export function probabilities(
  enemy: Record<string, any>,
  name: string,
  t: number,
  full_burst: any,
  radius: number,
  core_probability: any,
  exponent: number = 2.55,
): [number, any] {
  const scene = scene_at(enemy, name, t, full_burst, radius);
  if (scene == null) {
    return [_pymax2(0, _pymin2(1, float(get(enemy, 'shotgun_hit_rate', 1)))), core_probability];
  }
  return integrate(scene[0], scene[1], scene[2], scene[3], exponent);
}

// @lru_cache(maxsize=1024) — 순수 함수라 결과와 무관.
const _at_least_cache = new Map<string, number>();
const _AT_LEAST_MAX = 1024;

// py: calculator/pellet_accuracy.py:97
export function at_least(n: number, probability: number, minimum: number): number {
  const cacheKey = `${n}|${probability}|${minimum}`;
  const cached = _at_least_cache.get(cacheKey);
  if (cached !== undefined) {
    _at_least_cache.delete(cacheKey);
    _at_least_cache.set(cacheKey, cached);
    return cached;
  }
  const terms: number[] = [];
  for (let k = minimum; k < n + 1; k += 1) {
    // `probability ** k`, `(1 - probability) ** (n - k)` — float ** int는 libm pow(정확 반올림)와 같게
    terms.push(_comb(n, k) * _pow_int(probability, k) * _pow_int(1 - probability, n - k));
  }
  const result = sum(terms);
  _at_least_cache.set(cacheKey, result);
  if (_at_least_cache.size > _AT_LEAST_MAX) {
    const oldest = _at_least_cache.keys().next().value;
    if (oldest !== undefined) _at_least_cache.delete(oldest);
  }
  return result;
}
