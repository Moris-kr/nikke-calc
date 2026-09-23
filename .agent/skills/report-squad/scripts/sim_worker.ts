/**
 * `engine_env.run_jobs`의 워커 스레드 본체. 작업 `{i, c, seed}`를 받아 `run_one` 결과를 돌려준다.
 * 직접 실행하지 않는다.
 */
import { parentPort } from 'node:worker_threads';
import { isSystemExit } from './pycompat';
import { run_one } from './engine_env';

parentPort!.on('message', (m: { i: number; c: any; seed: number | null }) => {
  try {
    parentPort!.postMessage({ i: m.i, out: run_one(m.c, m.seed) });
  } catch (e) {
    const se = isSystemExit(e);
    const msg = se ? (e as Error).message : ((e as Error)?.stack ?? String(e));
    parentPort!.postMessage({ i: m.i, error: msg, systemExit: se });
  }
});
