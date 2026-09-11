import { defineConfig } from 'vitest/config';

// 빌드마다 바뀌는 ID. calculator.worker.js는 해시가 없는 public 자산이라
// 이 값을 쿼리로 붙여 새 배포 때 옛 워커가 캐시에서 재사용되지 않게 한다.
const buildId = JSON.stringify(Date.now().toString(36));

export default defineConfig({
  base: '/nikke-calc/',
  define: {
    __BUILD_ID__: buildId,
  },
  test: {
    environment: 'node',
    /**
     * 한 시험의 상한(ms). 기본 5초는 **이 저장소에는 짧다** — `ui.test.ts`는 시험마다
     * 계산기 화면을 통째로 세우고(니케 200명·판 수십 개) 백 개 넘는 시험이 잇따라 도는데,
     * CI 기계는 개발 기계보다 서너 배 느리다. 그래서 「느린 시험 하나에 20초를 준다」를
     * 시험마다 적는 일이 세 번 반복됐고, 그때마다 배포가 한 번씩 막혔다.
     *
     * 여기서 한 번에 올린다. 상한을 올리는 것이 느린 시험을 빠르게 만들지는 않지만,
     * **멈춘 시험**은 여전히 20초에 걸려 잡힌다 — 그것이 상한이 하는 일이다.
     */
    testTimeout: 20_000,
  },
});
