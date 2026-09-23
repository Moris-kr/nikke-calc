# 고속 계산 엔진 (TypeScript)

파이썬 엔진(`calculator/`, `context/spec.py`, `site/pybridge/bridge.py`)을 TypeScript로 옮긴 것이다.
브라우저에서 파이썬 런타임(Pyodide) 없이 돈다.

**진행 방식** (사용자 결정 2026-09-23)
1. **충실한 이식** — 파이썬과 구조·이름·연산 순서를 그대로 옮기고, `parity/` 대조 도구로 결과를 맞춘다.
2. **재설계** — 대조 도구를 켠 채로 핫 패스(버프 집계·대미지·틱·알림)를 숫자 배열 구조로 바꿔 수십 배를 노린다.
3. 사이트에서 엔진을 고를 수 있게 하고(`src/engine-router.ts`, 실행 단추 아래 「계산 엔진」), 고속 엔진이 실패하면
   그 덱을 파이썬 엔진으로 다시 계산한다. **2026-09-23부터 고속 엔진이 기본**이다(전투 계산만 — 전투력·추천·육성 비교는 파이썬).
   몇 번 두 엔진을 함께 운영해 문제가 없으면 파이썬 엔진을 걷어낸다.

**함께 운영하는 동안:** 파이썬 엔진을 고치면 여기도 고친다. 대조는 CI(`.github/workflows/ci.yml` 「고속 엔진 대조」)와 로컬
`python site/scripts/parity/ref.py` → `PARITY=1 npx vitest run src/engine/parity.test.ts`로 한다(기준 답은 파이썬 3.12 이상).

**2단계에서 바꾼 것(결과는 같다):** `[고속 엔진]` 주석이 붙은 곳 — 끝나는 시각이 있어도 값이 변하지 않는 버프를 계획에 접어 두고
만료만 보기, 효과 사전의 고정 칸·기본값·튜플 키 캐시, 최대 장탄 집계의 프레임 간 재사용, `round(x, n)`의 빠른 길.

## 모듈 대응

| 파이썬 | TS |
|---|---|
| `calculator/pellet_accuracy.py` | `pellet_accuracy.ts` |
| `calculator/cheats.py` | `cheats.ts` |
| `calculator/base_stat.py` | `base_stat.ts` |
| `calculator/damage.py` | `damage.ts` |
| `calculator/sim_result.py` | `sim_result.ts` |
| `calculator/shotgun_heatmap.py` | `shotgun_heatmap.ts` |
| `calculator/customization.py` | `customization.ts` |
| `calculator/buff_manager.py` | `buff_manager.ts` |
| `calculator/timeline.py` | `timeline.ts` |
| `context/growth.py` | `growth.ts` |
| `context/spec.py` | `spec.ts` |
| `site/pybridge/bridge.py` (`run_request` 경로만) | `bridge.ts` |

같은 이름을 export한다. 모듈끼리는 `./<모듈>`로 import한다(파이썬 import와 1:1).

## 1단계 번역 규칙 — 반드시 지킨다

결과가 파이썬과 **한 자리까지** 같아야 한다. 대조 도구가 히트 하나하나의 대미지를 비교한다.

1. **직역.** 함수·클래스·메서드·변수·사전 키 이름을 그대로 둔다(snake_case 유지). 문장 순서, 분기 순서,
   **산술 연산 순서**(`a * b * c`를 `a * (b * c)`로 바꾸지 않는다)를 그대로 둔다. 리팩터링하지 않는다.
   각 함수 위에 `// py: calculator/timeline.py:1234` 처럼 원본 위치를 적는다.
2. **파이썬 의미는 `./py`로.** (`py.ts` 참고)
   - `sum(...)` → `sum(...)` (3.12 Neumaier 합산), `round(x[, n])` → `round`, `int(x)` → `int`,
     `a // b` → `floordiv`, `a % b` → `pymod`(음수 가능성이 있을 때. 둘 다 음이 아닌 정수면 `%` 그대로 가능).
   - `x.get(k, d)` → `get(x, k, d)`, `k in d` → `has(d, k)`, `d.setdefault` → `setdefault`, `d.pop` → `pop`,
     `d[k]`(없으면 KeyError가 나야 할 곳) → `item(d, k)`. 존재가 확실한 곳은 `d[k]`도 된다.
   - 참·거짓: `if x:` / `not x` / `x or y` / `x and y`에서 x가 리스트·사전·문자열·수일 수 있으면
     `truthy(x)` · `or(x, y)` · `and(x, y)`. (JS에서 `[]`·`{}`는 참이다!) bool이 확실하면 그대로.
   - `copy.deepcopy` → `deepcopy`. `sorted(xs, key=, reverse=)` → `sorted`. `xs.sort(key=...)` →
     `xs.splice(0, xs.length, ...sorted(xs, key))`. `min(xs)`/`max(xs)`(반복 가능 객체) → `minBy`/`maxBy`,
     두세 개 수의 `min(a, b)` → `Math.min(a, b)`.
   - `random.random()` · `random.sample()` · `random.seed()` → `import { random } from './py'`의 같은 이름.
   - `raise ValueError(msg)` → `throw ValueError(msg)` (메시지 글자 그대로).
   - `math.inf` → `Infinity`, `math.floor/ceil/sqrt/log/exp/isfinite` → `Math.*`/`isfinite`, `x ** y` → `x ** y`.
   - f-string에 실수를 넣는 곳(로그·키·메시지): 파이썬 표기와 같게 — 정수값 실수는 `reprFloat(x)`("1.0"),
     `{x:.2f}` → `x.toFixed(2)`.
3. **자료형.**
   - 파이썬 dict → 일반 객체 `Record<string, any>` (JSON에서 온 자료와 같은 모양). **정수 모양 문자열 키**
     (`"1"`, `"2"` …)가 있는 사전을 순회하면 JS 객체는 순서가 바뀐다 — 그런 사전을 **순회하는 곳**은
     `Map`을 쓰거나 파이썬 삽입 순서를 보존하도록 주석과 함께 처리한다. 조회만 하면 객체로 충분하다.
   - `id(obj)`를 키로 쓰는 사전 → `Map<object, …>` (객체 자체를 키로).
   - set → `Set`. **정수 set을 순회**하면 파이썬은 대개 오름차순이다 → 정렬해서 순회한다.
     문자열 set의 순회 순서에 결과가 달려 있으면 안 된다(파이썬도 실행마다 다르다) — 그런 곳을 보면 주석을 단다.
   - 튜플 → 배열. 튜플 비교·정렬 → `cmp`/`sorted`(사전식).
   - `@dataclass` → `class` + 생성자는 **키워드 인자 객체** 하나(`new X({ a: 1 })`), 기본값·`field(default_factory=list)`
     는 인스턴스마다 새로 만든다.
   - `isinstance(x, (int, float))` → `typeof x === 'number'`(파이썬 bool도 int임에 주의),
     `isinstance(x, list)` → `Array.isArray`, `isinstance(x, dict)` → 일반 객체 판정.
   - `None` → `null`. `is None` → `== null`.
   - 문자열: `startswith`/`endswith`/`removeprefix`/`split()`(인자 없으면 공백 덩어리로 나누고 양끝 제거)/`strip`.
4. **데이터 파일은 `./data`의 `data()`로.** 파이썬의 모듈 수준 `_load(...)`·`json.loads(...)`는 **import 시점에
   읽지 말고** 함수 안에서 `data().parsed_nikke` 등으로 꺼낸다. 캐시가 필요하면 `onDataChange`에 초기화를 건다.
   파일 → 키는 `data.ts`의 `ENGINE_DATA_FILES`.
5. **타입.** 프로젝트 tsconfig(strict, noUncheckedIndexedAccess, noUnusedLocals/Parameters)를 통과해야 한다.
   `// @ts-nocheck` 금지. 동적 자료는 `any`/`Record<string, any>`로 받아도 된다. 쓰지 않는 변수·인자는 지우거나 `_` 접두.
6. 이식 작업 중에는 파이썬 파일을 건드리지 않는다.

## 검증

- 타입: `cd site && npx tsc --noEmit` — 자기 파일의 오류가 0이어야 한다(다른 사람 파일이 아직 없어 생기는
  import 오류는 무시).
- 결과 대조: `parity/`(1단계 뒤 추가) — 파이썬 3.12 엔진과 같은 요청을 돌려 응답·히트를 비교한다.
