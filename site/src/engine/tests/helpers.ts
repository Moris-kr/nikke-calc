/**
 * 파이썬 단위 테스트(calculator/test_*.py 등)를 옮긴 vitest 파일들이 같이 쓰는 도우미.
 *
 * 엔진 데이터는 파일마다 한 번 넣는다 — `beforeAll(loadEngineData)` 또는 모듈 맨 위에서 `loadEngineData()`.
 * 여러 번 불러도 처음 한 번만 디스크에서 읽는다(같은 워커 안에서는 캐시).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ENGINE_DATA_FILES, setEngineData } from '../data';

/** 저장소 뿌리(C:\nikke-calc\repo). */
export const ROOT = resolve(__dirname, '..', '..', '..', '..');

/** 저장소 뿌리 기준 상대 경로의 JSON을 읽는다. */
export function readJson<T = any>(rel: string): T {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf-8')) as T;
}

let loaded: Record<string, unknown> | null = null;

/** 워커가 받는 것과 같은 엔진 데이터 파일을 저장소에서 읽어 넣는다. */
export function loadEngineData(): void {
  if (!loaded) {
    loaded = Object.fromEntries(Object.keys(ENGINE_DATA_FILES).map((p) => [p, readJson(p)]));
  }
  // 테스트가 사전을 고쳤을 수 있으므로(사용자 정의 니케 등) 매번 새로 읽은 사본을 넣지는 않는다 —
  // 고치는 테스트는 스스로 되돌린다(파이썬 테스트와 같다).
  setEngineData(loaded);
}

/**
 * 파이썬 `assertAlmostEqual(a, b, places=7)` — `round(a - b, places) == 0`.
 * 실패 메시지를 위해 값을 돌려받는 형태가 아니라 참·거짓만 준다: `expect(almostEqual(a, b, 2)).toBe(true)`.
 */
export function almostEqual(a: number, b: number, places = 7): boolean {
  if (a === b) return true;
  const d = a - b;
  const f = 10 ** places;
  return Math.round(Math.abs(d) * f) === 0;
}

/** 파이썬 `assertAlmostEqual(a, b, delta=d)` — `abs(a - b) <= d`. */
export function withinDelta(a: number, b: number, delta: number): boolean {
  return Math.abs(a - b) <= delta;
}

/** 파이썬 `with self.assertRaises(ValueError): fn()` — 던진 예외가 그 파이썬 예외형(PyError.pyType)인지 본다. */
export function raisesPy(fn: () => unknown, pyType = 'ValueError'): boolean {
  try {
    fn();
  } catch (e) {
    return (e as { pyType?: string })?.pyType === pyType;
  }
  return false;
}
