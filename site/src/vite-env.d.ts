/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * 블라블라링크 조회 프록시 주소 (`worker/` 참고). 비어 있으면 사이트가 프로필 URL
   * 연동을 아예 그리지 않고 렛츠도로 CSV만 남긴다 — 프록시 없이 부르면 CORS와 세션
   * 두 가지가 동시에 막아 반드시 실패하기 때문이다.
   */
  readonly VITE_BLABLA_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
