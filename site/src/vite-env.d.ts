/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * 블라블라링크 조회 프록시 주소 (`worker/` 참고). 비어 있으면 사이트가 프로필 URL
   * 연동을 아예 그리지 않고 렛츠도로 CSV만 남긴다 — 프록시 없이 부르면 CORS와 세션
   * 두 가지가 동시에 막아 반드시 실패하기 때문이다.
   */
  readonly VITE_BLABLA_PROXY?: string;
  /**
   * 설정 공유 서버 주소 (`worker-share/` 참고). 비어 있으면 공유 모달이 서버 탭을
   * 아예 그리지 않고 코드 주고받기만 남는다 — 주소 없이 부르면 반드시 실패한다.
   */
  readonly VITE_SHARE_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
