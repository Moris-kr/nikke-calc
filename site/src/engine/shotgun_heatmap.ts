/**
 * Opt-in deterministic diagnostics. Never consumes combat RNG or changes damage.
 *
 * 이식: calculator/shotgun_heatmap.py
 */
import { contains, scene_at } from './pellet_accuracy';
import type { Scene, Shape } from './pellet_accuracy';
import { int, maxBy, minBy, round, sum } from './py';

// ── CPython 3.12 `math.hypot` (vector_norm) — V8 Math.hypot과 마지막 자리가 다를 수 있어 그대로 옮긴다 ──

function _frexp_exp(x: number): number {
  // x > 0, 유한. frexp(x) = m·2^e, 0.5 ≤ m < 1 의 e.
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const biased = (hi >>> 20) & 0x7ff;
  if (biased === 0) {
    // 서브노멀 — 2^64를 곱해 정규화한 뒤 되돌린다.
    return _frexp_exp(x * 18446744073709551616) - 64;
  }
  return biased - 1022;
}

// 오차 없는 곱(Dekker/Veltkamp) — CPython dl_mul과 같은 (hi, lo).
function _dl_mul(x: number, y: number): [number, number] {
  const z = x * y;
  const split = (a: number): [number, number] => {
    const t = a * 134217729.0;
    const hi = t - (t - a);
    return [hi, a - hi];
  };
  const [xh, xl] = split(x);
  const [yh, yl] = split(y);
  const zz = (((xh * yh - z) + xh * yl) + xl * yh) + xl * yl;
  return [z, zz];
}

function _dl_fast_sum(a: number, b: number): [number, number] {
  const x = a + b;
  const y = (a - x) + b;
  return [x, y];
}

function _vector_norm(vec: number[], max: number, found_nan: boolean): number {
  const n = vec.length;
  if (max === Infinity) return max;
  if (found_nan) return NaN;
  if (max === 0.0 || n <= 1) return max;
  const max_e = _frexp_exp(max);
  if (max_e < -1023) {
    const DBL_MIN = 2.2250738585072014e-308;
    return DBL_MIN * _vector_norm(vec.map((v) => v / DBL_MIN), max / DBL_MIN, found_nan);
  }
  const scale = 2 ** -max_e;
  let csum = 1.0;
  let frac1 = 0.0;
  let frac2 = 0.0;
  for (let i = 0; i < n; i += 1) {
    let x = vec[i]!;
    x *= scale;
    const pr = _dl_mul(x, x);
    const sm = _dl_fast_sum(csum, pr[0]);
    csum = sm[0];
    frac1 += pr[1];
    frac2 += sm[1];
  }
  let h = Math.sqrt(csum - 1.0 + (frac1 + frac2));
  const pr = _dl_mul(-h, h);
  const sm = _dl_fast_sum(csum, pr[0]);
  csum = sm[0];
  frac1 += pr[1];
  frac2 += sm[1];
  const x = csum - 1.0 + (frac1 + frac2);
  h += x / (2.0 * h);
  return h / scale;
}

function _hypot(a: number, b: number): number {
  let max = 0.0;
  let found_nan = false;
  const coords: number[] = [];
  for (const v of [a, b]) {
    const x = Math.abs(v);
    coords.push(x);
    found_nan = found_nan || Number.isNaN(x);
    if (x > max) max = x;
  }
  return _vector_norm(coords, max, found_nan);
}

// 파이썬 `max(a, b)` — 같으면 앞의 것.
function _pymax2(a: number, b: number): number {
  return b > a ? b : a;
}

interface _SceneRecord {
  shapes: Shape[];
  aim: [number, number];
  radius: number;
  core: [number, number, number] | null;
  spatial: boolean;
  exponent: number;
}

// py: calculator/shotgun_heatmap.py:186
export class ShotgunHeatmap {
  frames: Record<string, any>[];
  scenes: _SceneRecord[];
  // 파이썬 튜플 키 (scene, radius|0, exponent) → JSON 문자열 키
  indices: Map<string, number>;

  // py: calculator/shotgun_heatmap.py:187
  constructor() {
    this.frames = [];
    this.scenes = [];
    this.indices = new Map();
  }

  // py: calculator/shotgun_heatmap.py:192
  record(
    enemy: Record<string, any>,
    name: string,
    t: number,
    full_burst: any,
    radius: number,
    accuracy: number,
    pellets: number,
    hit: number,
    core: number,
    exponent: number,
  ): void {
    const scene: Scene | null = scene_at(enemy, name, t, full_burst, radius);
    const key = JSON.stringify([scene, scene == null ? radius : 0, exponent]);
    if (!this.indices.has(key)) {
      this.indices.set(key, this.scenes.length);
      const [shapes, aim, actual_radius, core_shape] = scene ?? [[], [0, 0], radius, null] as Scene;
      this.scenes.push({
        shapes: shapes, aim: aim, radius: actual_radius,
        core: core_shape, spatial: scene != null, exponent: exponent,
      });
    }
    this.frames.push({
      t: round(t, 4), scene: this.indices.get(key)!, pellets: pellets,
      hit: hit, core: core, accuracy: accuracy, fullBurst: full_burst,
    });
  }

  // py: calculator/shotgun_heatmap.py:203
  finish(): Record<string, any> {
    const size = 48;
    const extents: [number, number, number, number][] = [];
    for (const scene of this.scenes) {
      const [x, y] = scene.aim;
      let r = scene.radius;
      extents.push([x - r, y - r, x + r, y + r]);
      for (const [, sx, sy, w, h] of scene.shapes) {
        r = _hypot(w, h) / 2;
        extents.push([sx - r, sy - r, sx + r, sy + r]);
      }
    }
    const x0 = minBy(extents.map((e) => e[0]));
    const y0 = minBy(extents.map((e) => e[1]));
    const x1 = maxBy(extents.map((e) => e[2]));
    const y1 = maxBy(extents.map((e) => e[3]));
    const side = _pymax2(_pymax2(x1 - x0, y1 - y0), 1) * 1.08;
    const bounds = [(x0 + x1 - side) / 2, (y0 + y1 - side) / 2, side, side];
    const grids: Record<string, number[]> = {};
    for (const key of ['density', 'body', 'core', 'miss']) {
      grids[key] = new Array<number>(size * size).fill(0.0);
    }
    const weights = new Array<number>(this.scenes.length).fill(0);
    for (const frame of this.frames) {
      weights[frame['scene']] = weights[frame['scene']]! + frame['pellets'];
    }
    for (let si = 0; si < Math.min(this.scenes.length, weights.length); si += 1) {
      const scene = this.scenes[si]!;
      const weight = weights[si]!;
      for (let i = 0; i < 1024; i += 1) {
        const r = scene.radius * ((i + 0.5) / 1024) ** (1 / scene.exponent);
        const angle = i * 2.399963229728653;
        const x = scene.aim[0] + r * Math.cos(angle);
        const y = scene.aim[1] + r * Math.sin(angle);
        const col = Math.min(size - 1, _pymax2(0, int((x - bounds[0]!) / side * size)));
        const row = Math.min(size - 1, _pymax2(0, int((y - bounds[1]!) / side * size)));
        const cell = row * size + col;
        grids['density']![cell] = grids['density']![cell]! + weight / 1024;
        if (scene.spatial) {
          const c = scene.core;
          const hit = scene.shapes.some((s) => contains(s, x, y));
          let key: string;
          if (hit && c) {
            const dx = x - c[0];
            const dy = y - c[1];
            key = dx * dx + dy * dy <= c[2] * c[2] ? 'core' : 'body';
          } else {
            key = hit ? 'body' : 'miss';
          }
          grids[key]![cell] = grids[key]![cell]! + weight / 1024;
        }
      }
    }
    return {
      ...grids, size: size, bounds: bounds, frames: this.frames, scenes: this.scenes,
      sceneCount: this.scenes.length, spatial: this.scenes.every((s) => s.spatial),
      fired: sum(this.frames.map((f) => f['pellets'])),
      hit: sum(this.frames.map((f) => f['pellets'] * f['hit'])),
      coreHits: sum(this.frames.map((f) => f['pellets'] * f['hit'] * f['core'])),
    };
  }
}
