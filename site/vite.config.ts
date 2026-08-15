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
  },
});
