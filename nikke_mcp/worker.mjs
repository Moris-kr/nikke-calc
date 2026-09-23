// Worker-thread entry for one calculation (see src/service.ts). Plain JavaScript so the thread can
// install the TypeScript loader itself; nothing is inherited from the parent's module hooks.
import { parentPort, workerData } from 'node:worker_threads';
import { register } from 'tsx/esm/api';

register();
const { run } = await import('./src/worker.ts');
parentPort.postMessage(run(workerData.request));
