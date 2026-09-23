/**
 * 스크립트(snapshot·sim·export-settings)가 계산 엔진(src/engine/)을 저장소 파일로 바로 돌리게 하는 준비.
 *
 * 사이트 워커는 `runtime/data/…`를 받아 `setEngineData`로 넣는다. 여기서는 저장소의 `data/`를 그대로 읽는다
 * (`src/engine/parity.test.ts`의 `loadEngineFiles`와 같은 파일 목록 = `ENGINE_DATA_FILES`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_DATA_FILES, hasEngineData, setEngineData } from '../../src/engine/data';
import { PyError } from '../../src/engine/py';
import { loadMarked } from './pyjson';

/** 저장소 뿌리 (`site/`의 부모). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * 엔진 데이터를 한 번 넣는다. 이미 들어 있으면 아무것도 하지 않는다.
 *
 * `marked`면 파일의 float 리터럴(`4.0`)에 엔진의 float 표시를 남긴다(`pyjson.loadMarked`) — 데이터 값을
 * 파이썬 `json.dumps`처럼 다시 적어야 하는 스크립트(export-settings)용. 계산 결과에는 영향이 없다.
 */
export function loadEngine(opts: { marked?: boolean } = {}): void {
  if (hasEngineData()) return;
  const files: Record<string, unknown> = {};
  for (const rel of Object.keys(ENGINE_DATA_FILES)) {
    const text = readFileSync(join(ROOT, rel), 'utf-8');
    files[rel] = opts.marked ? loadMarked(text) : JSON.parse(text);
  }
  setEngineData(files);
}

/** 파이썬 `print`처럼 한 줄 쓴다(표준 출력은 UTF-8, 줄바꿈은 LF). */
export function print(...parts: unknown[]): void {
  process.stdout.write(parts.map((p) => String(p)).join(' ') + '\n');
}

/** 표준 출력을 다 비운 뒤 종료한다(파이프로 받을 때 긴 출력이 잘리지 않게). */
export function exit(code: number): never {
  process.exitCode = code;
  // 쓰기 버퍼가 빌 때까지 기다렸다가 끝낸다.
  process.stdout.write('', () => process.exit(code));
  // 위 콜백이 돌기 전에 아래 코드가 이어 달리지 않게 막는다.
  throw new ExitSignal(code);
}

/** `exit()`가 던지는 표식. 최상위에서 삼킨다(`runMain`). */
export class ExitSignal {
  constructor(readonly code: number) {}
}

/**
 * 최상위 진입. `exit()`의 표식은 삼킨다. 엔진의 `SystemExit`(파이썬 `raise SystemExit(msg)`)은
 * 파이썬처럼 메시지만 표준 오류에 내고 1로 끝난다. 그 밖의 예외는 트레이스백을 내고 1로 끝난다.
 */
export function runMain(main: () => void | Promise<void>): void {
  Promise.resolve()
    .then(main)
    .catch((e) => {
      if (e instanceof ExitSignal) return;
      if (e instanceof PyError && e.pyType === 'SystemExit') {
        process.stderr.write(`${e.message}\n`);
      } else {
        process.stderr.write(`${(e as Error)?.stack ?? String(e)}\n`);
      }
      process.stdout.write('', () => process.exit(1));
    });
}
