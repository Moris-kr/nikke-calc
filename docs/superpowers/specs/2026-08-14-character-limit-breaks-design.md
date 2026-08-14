# 캐릭터 돌파·코어 강화 설정 설계

## 목표

웹 계산기의 캐릭터별 설정에서 명함부터 3돌, 코어 강화 1~7단계를 선택할 수 있게 하고,
선택한 단계에 맞는 돌파 보정·코어 강화·호감도 최대치를 Python 계산 엔진에 함께 적용한다.
기본 계산도 동일한 성장 규칙을 사용해 필그림과 오버스펙 캐릭터의 3돌 호감도 40을 반영한다.

## 조사 결과와 정본

- 돌파 1회는 레벨 기본 스탯에 `기본 스탯의 2% + 고정 20`을 더한다. 현재
  `calculator/base_stat.py`의 `_core_formula()`가 이 공식을 이미 구현하고 있으므로 새 공식을
  만들지 않고 그대로 사용한다.
- 코어 강화는 3돌 이후 SSR만 가능하고, 1단계마다 장비를 제외한 기초 영역의 공격력·방어력·
  체력을 2%씩 올린다. 최대 코어 강화는 7단계다.
- R은 돌파할 수 없고, SR은 2돌까지, SSR은 3돌 이후 코어 강화 7까지 가능하다.
- 호감도 최대치는 명함 10, 1돌 20, 2돌 30이다. 일반 SSR은 3돌 이후에도 30이며,
  필그림과 오버스펙은 3돌부터 40이다. R은 호감도 시스템이 없으므로 계산기의 무보정 값인
  호감도 1을 사용한다.
- 현재 오버스펙 정본 목록은 `라피 : 레드 후드`, `아니스 : 스타`, `네온 : 비전 아이`다.
  새 오버스펙 캐릭터를 등록할 때 이 목록도 함께 갱신한다.

참고 자료:

- NIKKE.GG, Combat Power: https://nikke.gg/combat-power-cp/
- NIKKE.GG, Synchro Device and Leveling Guide: https://nikke.gg/synchro-device-and-leveling-guide/
- NIKKE.GG, Advise & Bond: https://nikke.gg/advise-bond-guide/
- Prydwen, Character Progression: https://www.prydwen.gg/nikke/guides/character-progression
- 2024-12-26 패치 노트의 오버스펙 호감도 40 안내:
  https://nikke.gg/december-26-patch-notes/
- Anis: Star / Neon: Vision Eye 오버스펙 분류:
  https://nikke.gg/anis-star-analysis-should-you-pull/
  https://nikke.gg/neon-vision-eye-analysis-should-you-pull/

## 사용자 경험

캐릭터의 `개별 설정`을 켜면 스킬 레벨 위에 `돌파` 선택창 하나를 표시한다. 선택지는
캐릭터 레어도에 맞게 제한한다.

| 종류 | 선택지 |
|---|---|
| R | `명함` |
| SR | `명함`, `1돌`, `2돌` |
| SSR | `명함`, `1돌`, `2돌`, `3돌`, `코강 1` … `코강 7` |

내부 값은 `growthStage` 정수 하나다. `0~3`은 명함~3돌이고 `4~10`은 코강 1~7이다.
하나의 값만 저장하므로 `2돌·코강 3` 같은 불가능한 조합을 표현할 수 없다.

선택창 아래에는 `호감도는 돌파별 최대치로 적용합니다.`를 항상 표시한다. 설정 요약은
`3돌 · 호감도 30` 또는 `코강 2 · 호감도 40`처럼 현재 단계와 적용 호감도를 함께 보여준다.
기본 성장 단계는 해당 레어도의 최대 돌파다. 현재 지원 명단은 전부 SSR 또는 SSR 프리뷰이므로
기존과 같은 3돌·코강 0이며, 향후 SR은 2돌, R은 명함이 기본이 된다.

## 성장 프로필과 데이터 정본

`scraper/nikke_scraped.json`의 `레어도`가 수집 데이터 정본이다. `scraper/parse_nikke.py`가 이를
`data/parsed_nikke.json`의 `rarity`로 내보낸다. 프리뷰 데이터도 같은 스키마의 `레어도`를
사용한다.

새 `context/growth.py`가 다음 규칙의 단일 정본이 된다.

- 레어도별 최대 `growthStage`
- 필그림 판별: `manufacturer == "필그림"`
- 오버스펙 예외 목록
- 단계 → `breakthrough`, `core_enhancement`, `affinity` 변환
- 단계 표시 문자열과 허용 선택지 생성에 필요한 메타데이터

웹은 자체적으로 규칙을 추론하지 않는다. `site/scripts/export-settings.py`가 각 캐릭터의
`rarity`, `maxGrowthStage`, 단계별 표시명과 호감도, 레어도별 기본 단계를 `settings.json`에 내보낸다.
따라서 UI와 Python 검증은 같은 Python 정본에서 파생된다.

## 계산 데이터 흐름

브라우저 요청의 캐릭터 오버라이드는 다음처럼 성장 단계만 전달한다.

```json
{
  "growthStage": 6
}
```

`site/pybridge/bridge.py`는 캐릭터 이름을 함께 넘겨 Python 경계에서 값을 검증한다.
`calculator/customization.py`는 숫자 형식만 검사하지 않고 해당 캐릭터 성장 프로필의 허용 범위도
검사한 뒤 다음 엔진 오버라이드로 변환한다.

```python
{
    "breakthrough": 3,
    "core_enhancement": 3,
    "affinity": 30,
}
```

필그림 또는 오버스펙의 같은 요청은 `affinity: 40`을 만든다. 명함·1돌·2돌은 각각
`affinity: 10/20/30`을 만든다. R은 `breakthrough: 0`, `core_enhancement: 0`, `affinity: 1`이다.

개별 설정이 없는 기본 요청에도 성장 프로필을 적용한다. `context/spec.py`는 캐릭터 레어도에 맞는
최대 돌파를 먼저 `breakthrough`, `core_enhancement`, `affinity`로 해석한 뒤 캐릭터별 레이어와
호출자 오버라이드를 합친다. 따라서 일반 SSR은 기존 3돌·호감도 30을 유지하고 필그림·오버스펙은
3돌·호감도 40으로 바뀐다. 호출자 오버라이드에 `breakthrough`, `core_enhancement`, `affinity` 중
하나라도 직접 들어 있으면 자동 성장 해석을 건너뛰고 기존 Python 연구 경로를 그대로 우선한다.

최종 기본 스탯 계산 순서는 기존 공식을 유지한다.

```text
돌파 반영값 = 레벨 스탯 + (레벨 스탯 × 0.02 + 20) × 돌파 수
코강 전 영역 = 돌파 반영값 + 호감도 스탯 + 콘솔 스탯
코강 반영값 = 코강 전 영역 × (1 + 0.02 × 코강 수)
최종 스탯 = 코강 반영값 + 장비 + 큐브 + 소장품
```

## 검증과 오류 처리

UI는 내보낸 선택지만 표시하지만 Python 경계도 독립적으로 다음 요청을 거부한다.

- 불리언, 소수, 음수 또는 최대 단계를 넘는 `growthStage`
- R의 1돌 이상
- SR의 3돌 또는 코어 강화
- SSR의 코강 8 이상
- 알 수 없는 레어도나 성장 프로필

오류는 캐릭터 이름과 허용 범위를 포함한 한국어 메시지로 계산 전에 반환한다. 정규화 과정에서
잘못된 값을 자르거나 기본값으로 바꾸지 않는다. 성장 단계는 덱별 캐릭터 오버라이드에 저장되어
같은 캐릭터도 서로 다른 덱에서 독립적으로 설정할 수 있으며, 기존 JSON 캐시 키에 포함된다.

## 테스트 전략

1. 파서 테스트에서 SSR/SR/R 및 프리뷰의 `rarity`가 결정적으로 생성되는지 확인한다.
2. 성장 규칙 단위 테스트에서 모든 단계의 변환, 레어도 상한, 일반/필그림/오버스펙 호감도를
   표 기반으로 검증한다.
3. 기본 스탯 테스트에서 같은 캐릭터의 명함→1돌→2돌→3돌→코강 7 공격력·방어력·체력이
   기존 공식의 정확한 기대값과 일치하는지 확인한다.
4. 브리지 테스트에서 정상 요청 전달과 조작된 레어도별 초과 요청 거부를 확인한다.
5. 런타임 자산 테스트에서 성장 메타데이터와 오버스펙 3명의 호감도 40을 확인한다.
6. DOM 테스트에서 선택지, 안내 문구, 요약, 토글 초기화, 덱 간 독립성을 확인한다.
7. 모델·캐시·UI 테스트에서 `growthStage` 보존, 캐시 분리, 제출 전 검증을 확인한다.
8. 전체 Vitest, Python 검산, 문서 린트, 골든 스냅샷, 런타임 정합성, Pages 검사와 프로덕션
   빌드를 실행한다. 필그림·오버스펙 호감도 40으로 달라진 스냅샷은 손으로 편집하지 않고 정식
   스냅샷 명령으로 재생성한 뒤 차이를 검토한다.

## 영향 파일

- 메타데이터와 성장 규칙: `scraper/parse_nikke.py`, `data/parsed_nikke.json`,
  `context/growth.py`, 관련 Python 테스트
- 기본 캐릭터 생성: `context/spec.py`, `context/HARNESS.md`, `context/CALCULATOR.md`
- 브라우저 경계: `calculator/customization.py`, `site/pybridge/bridge.py`, 관련 테스트
- 런타임 내보내기: `site/scripts/export-settings.py`, `site/scripts/sync-runtime.mjs`,
  `site/src/types.ts`, 런타임 자산 테스트
- UI·상태·캐시: `site/src/character-settings.ts`, `site/src/model.ts`, `site/src/ui.ts`,
  `site/src/styles.css`, 관련 Vitest 파일
- 회귀 기준: `context/baseline/*.json`

## 범위 밖

- 사용자가 호감도 레벨을 별도로 낮춰 입력하는 기능
- 캐릭터 레벨, 장비 레벨, 콘솔 레벨의 신규 UI
- 전투력(CP) 표시나 돌파 비용·뽑기 효율 계산
- 돌파에 따른 로비 컷신·프리즘 아이콘 같은 비전투 보상
