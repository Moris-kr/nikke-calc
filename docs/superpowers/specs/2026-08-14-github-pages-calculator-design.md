# NIKKE 계산기 GitHub Pages 설계

## 목표

기존 Python 계산 엔진의 공식을 다시 작성하지 않고, AI·별도 백엔드·DB 없이 GitHub Pages에서 동작하는 공개용 5인 스쿼드 계산기를 제공한다. 사용자는 지원 캐릭터와 전투 조건을 선택해 계산을 실행하고, 스쿼드 총딜·캐릭터별 기여도·DPS를 확인할 수 있어야 한다.

## 접근 방식 비교

### 1. Pyodide Web Worker에서 기존 Python 엔진 실행 — 채택

- 장점: 기존 엔진과 JSON 데이터를 그대로 사용하므로 계산식 이식 오류가 가장 적다.
- 장점: GitHub Pages의 완전 정적 호스팅 제약을 만족한다.
- 장점: Web Worker에서 계산하므로 긴 시뮬레이션 중에도 화면이 멈추지 않는다.
- 단점: 첫 실행에 Python WebAssembly 런타임을 내려받아야 한다.
- 단점: 네이티브 Python보다 계산 시간이 길 수 있다.

### 2. 계산 엔진을 TypeScript로 이식

- 장점: 초기 다운로드와 실행 성능이 가장 좋다.
- 단점: 수천 줄의 타임라인·버프 로직을 재구현해야 하며 회귀 불일치 위험이 매우 크다.
- 결론: 초기 공개판의 범위를 넘어선다.

### 3. 외부 Python API 사용

- 장점: 기존 엔진을 서버에서 가장 빠르게 실행할 수 있다.
- 단점: GitHub Pages만으로 운영할 수 없고 별도 서버 비용·장애·보안·동시성 관리가 필요하다.
- 결론: 사용자가 요청한 독립 GitHub Pages 서비스와 맞지 않는다.

## 구조

사이트 코드는 저장소의 `site/`에 둔다. Vite와 TypeScript로 빌드하며, 결과물은 GitHub Actions가 Pages에 배포한다.

```text
site/src/main.ts
  ├─ 캐릭터 선택·전투 설정·결과 화면
  ├─ 입력 검증과 브라우저 캐시
  └─ calculator.worker.ts에 계산 요청

site/src/calculator.worker.ts
  ├─ Pyodide 1회 초기화
  ├─ public/runtime의 Python·JSON 파일을 가상 파일시스템에 적재
  ├─ context.spec.build_squad/build_config 호출
  └─ calculator.timeline.simulate 호출 후 JSON 반환

site/public/runtime
  ├─ calculator/*.py
  ├─ context/spec.py
  └─ 계산에 필요한 data/*.json

.github/workflows/pages.yml
  └─ site 빌드 → GitHub Pages 배포
```

## 사용자 화면

첫 화면에서 바로 편성을 만들 수 있게 한다.

- 상단: 서비스 이름, AI·서버 없이 브라우저에서 계산한다는 설명, 지원 범위 안내
- 편성: 5개 슬롯, 검색 가능한 캐릭터 목록, 초상화·버스트 단계·코드·무기 표시
- 전투 설정: 전투 시간, 적 방어력, 적 코드, 코어·파츠 여부, 시드
- 실행: 준비 중·계산 중·완료·실패 상태를 명확히 표시하고 중복 실행 방지
- 결과: 총딜, DPS, 캐릭터별 딜·DPS·기여도 막대, 사용한 조건, 기본 스펙 이탈·프리뷰 경고
- 하단: 비공식 팬 도구와 수치 오차 가능성 고지, 원본 저장소 링크

모바일에서는 슬롯과 결과 카드를 세로로 배치하고, 데스크톱에서는 설정과 결과를 넓게 사용한다. 키보드 포커스, 라벨, 상태 알림 영역을 제공한다.

## 데이터와 지원 범위

- `parsed_skills.json`에 존재하는 실캐릭터만 선택지로 노출한다.
- `test_` 더미는 제외한다.
- `parsed_nikke.json`의 `preview` 항목은 미검증 배지를 표시한다.
- 이미지가 없는 캐릭터는 텍스트 이니셜 폴백을 사용한다.
- 신규 데이터 반영은 `npm run sync-runtime`으로 원본 엔진·데이터·이미지를 다시 복사한다.

## 계산 데이터 흐름

1. 사용자가 1~5명을 중복 없이 선택한다.
2. UI가 범위와 필수값을 검증한다.
3. 정규화된 입력의 해시를 브라우저 캐시에서 조회한다.
4. 캐시가 없으면 Worker가 Pyodide와 엔진을 준비한다.
5. Worker가 요청별로 시드를 설정하고 시뮬레이션한다. Worker는 계산을 직렬 처리해 전역 난수 상태가 섞이지 않게 한다.
6. `SimResult`에서 총딜·캐릭터별 딜·히트 수·경고를 직렬화해 UI에 반환한다.
7. UI가 결과를 렌더링하고 동일 입력은 로컬 캐시에서 재사용한다.

## 오류 처리

- 잘못된 인원·중복 캐릭터·숫자 범위는 Worker 호출 전에 차단한다.
- Pyodide나 런타임 자산 다운로드 실패 시 재시도 버튼과 네트워크 안내를 표시한다.
- 엔진의 `ValueError`는 사용자용 한국어 메시지로 표시한다.
- 180초를 초과하는 전투와 상세 히트 로그는 초기 공개판에서 지원하지 않는다.
- 계산 중 새 요청이 들어오면 기존 요청이 끝난 뒤 최신 요청만 실행한다.

## 성능 전략

- Pyodide는 Worker당 한 번만 초기화한다.
- 계산 결과는 입력 버전과 함께 `localStorage`에 제한적으로 캐시한다.
- 초상화는 WebP를 그대로 사용하고 지연 로드한다.
- 초기 화면에 필요하지 않은 Python 런타임은 첫 계산 준비 시 로드하되, 사용자가 페이지에 진입하면 Worker를 미리 생성한다.
- 진행 상태를 단계별로 표시해 첫 계산의 대기 시간을 설명한다.

## 보안과 개인정보

- 모든 계산은 브라우저에서 수행하며 입력을 서버로 전송하지 않는다.
- 사용자 계정, 쿠키, 개인식별정보를 수집하지 않는다.
- Worker가 불러오는 Pyodide 버전을 고정한다.
- HTML에 사용자 입력을 문자열로 삽입하지 않고 DOM 속성 또는 `textContent`로 렌더링한다.

## 테스트

- TypeScript 단위 테스트: 입력 검증, 캐시 키, 결과 포맷, 지원 캐릭터 필터링
- 동기화 검사: 브라우저 런타임에 필요한 Python·JSON 파일이 모두 존재하는지 확인
- 기존 Python 검증: `calculator/damage.py`, `context.doclint`, `context.snapshot`
- 빌드 검사: GitHub Pages 하위 경로 base에서 Vite production build 성공
- 브라우저 검사: 실제 개발 서버에서 초기화, 캐릭터 선택, 계산 실행, 결과 표시, 모바일 레이아웃 확인

## 배포

- `master` 브랜치의 변경을 푸시한다.
- GitHub Actions 공식 Pages 액션으로 `site/dist`를 배포한다.
- 공개 URL은 `https://moris-kr.github.io/nikke-calc/`이다.
- Actions 완료 후 공개 URL의 HTTP 응답과 실제 계산 동작을 확인한다.

## 제외 범위

- 로그인과 편성 서버 저장
- 다수 사용자의 공유 링크
- 여러 스쿼드 일괄 최적화
- 모든 미파싱 캐릭터 지원
- 계산 엔진의 TypeScript 재작성
- 광고·결제·분석 추적
