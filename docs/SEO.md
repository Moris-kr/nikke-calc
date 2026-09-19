# 검색 페이지 운영

## 공개 페이지

- 메인: https://moris-kr.github.io/nikke-calc/
- 가이드 목록: https://moris-kr.github.io/nikke-calc/guides/
- 사이트맵: https://moris-kr.github.io/nikke-calc/sitemap.xml

기존 앱의 `#/...` 주소는 그대로 유지한다. 검색엔진이 독립 문서로 읽을 대상은 실제 HTML이 있는 `/guides/.../` 경로다. 각 페이지는 고유 title·description·canonical, Open Graph, WebPage·BreadcrumbList JSON-LD와 화면에 보이는 사용법을 제공한다. 검색 전용 숨김 문구나 키워드 나열 페이지는 만들지 않는다.

`site/content/guides.json`이 가이드 본문의 정본이다. `cd site` 후 `npm run build-guides`로 `public/guides/`와 사이트맵을 함께 갱신한다. 생성된 HTML을 직접 고치지 않는다. 개발·테스트·빌드 전에 자동 실행된다. 가이드 추가 시 메인 하단의 관련 링크도 확인한다. 배포 후 실제 슬래시 URL이 200으로 응답하고 올바른 h1을 반환하는지 확인한다. 로컬 Vite 개발 서버는 public 디렉터리의 디렉터리 인덱스를 SPA로 처리할 수 있으므로 실제 빌드의 `vite preview`로 확인한다.

## Google Search Console에 제출

1. https://search.google.com/search-console 에서 소유자 계정으로 로그인한다.
2. URL 접두어 속성에 `https://moris-kr.github.io/nikke-calc/`를 등록한다. 기존에 확인된 속성이 있으면 재사용한다.
3. 제공된 HTML 태그 확인 방식을 선택했다면 실제 발급된 태그를 `site/index.html`에 넣고 배포한 뒤 소유 확인을 완료한다. 태그를 임의로 만들지 않는다.
4. Sitemaps에서 `https://moris-kr.github.io/nikke-calc/sitemap.xml`을 제출한다.
5. URL 검사로 메인과 가이드의 수집 가능 여부를 확인하고 필요 시 색인 생성을 요청한다.

이 작업의 코드 배포는 소유 확인이나 사이트맵 제출을 대신하지 않는다. 검색 노출·순위·반영 시간을 보장하지 않는다.

## 네이버와 호스트 루트

네이버 서치어드바이저에서 소유 확인이 완료된 사이트의 요청 → 사이트맵 제출을 사용한다. 프로젝트 하위 경로를 사이트 등록 대상으로 허용하지 않는 경우에는 호스트 루트 `https://moris-kr.github.io/`를 관리하는 저장소에서 소유 확인을 진행해야 한다. 현재 프로젝트만 수정해서 루트 소유 확인을 완료했다고 간주하지 않는다.

크롤러가 읽는 robots.txt의 정규 위치도 호스트 루트다. 이 프로젝트의 `/nikke-calc/robots.txt`는 루트 `/robots.txt`를 대체하지 않는다. 루트 사이트를 별도로 관리한다면 그 robots.txt에 위 사이트맵 주소를 추가할 수 있다. 현재 변경은 다른 저장소의 루트 파일을 수정하지 않는다.

## 공식 참고 자료

- JavaScript와 해시 URL: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- 제목 작성: https://developers.google.com/search/docs/appearance/title-link
- Search Console 속성: https://support.google.com/webmasters/answer/34592
- 사이트맵 제출: https://support.google.com/webmasters/answer/7451001
- 네이버 검색 최적화: https://searchadvisor.naver.com/guide/seo-basic-intro
