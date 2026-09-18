# AI에서 니케 계산기 사용하기

ChatGPT·Claude에서 계산을 요청하면 **열어 둔 계산기 브라우저가 Python 엔진을 실행**합니다.
공개 Render 서버는 요청과 결과를 중계합니다. 브라우저가 끊기면 서버가 대신 계산하지 않습니다.
AI 모델이나 OpenAI API 키를 계산기에 입력할 필요는 없습니다. AI 서비스의 이용 조건은 별도입니다.

**공개 MCP 주소:** `https://nikke-calc-mcp.onrender.com/mcp` · 인증 방식: **No Authentication**

[서버 상태 확인](https://nikke-calc-mcp.onrender.com/health)에서 `status: ok`를 확인한 뒤
ChatGPT는 **6절**, Claude 웹은 **7절**에 따라 등록합니다. 이어 **8절에서 브라우저를 연결**합니다.
GitHub Pages 사이트 주소는 MCP 주소가 아닙니다. Render 절전 후 첫 응답은 늦을 수 있습니다.

## 1. 연결 방식 고르기

| 사용 환경 | 연결 방식 | 계산 위치 |
|---|---|---|
| ChatGPT·Claude 웹의 원격 커넥터 | 공개 HTTPS MCP + 브라우저 연결 코드 | 열어 둔 계산기 탭 |
| Claude Desktop의 로컬 MCP·로컬 에이전트 | stdio | 이 PC의 Python |
| 개발 중 HTTP 점검 | `http://127.0.0.1:8000/mcp` | 연결한 개발용 계산기 브라우저 |

공개 주소를 사용하면 서버나 Python을 설치하지 않아도 됩니다. 로컬 stdio를 사용하려면 2~3절을 따르세요.
원격 커넥터는 AI 서비스의 서버에서 접속하므로 `localhost`만 입력해서 PC에 연결할 수는 없습니다.

## 2. Windows 설치

Python 3.10 이상과 Git이 필요합니다. PowerShell에서 실행합니다.
이미 저장소가 있으면 clone을 반복하지 말고 기존 저장소 폴더로 이동하세요.

```powershell
git clone https://github.com/Moris-kr/nikke-calc.git
cd nikke-calc
powershell -ExecutionPolicy Bypass -File .\nikke_mcp\setup.ps1
```

`Bypass`는 위 설치 프로세스에만 적용되며 시스템 실행 정책은 바꾸지 않습니다.
`python` 명령이 없다면 설치된 Python의 경로를 지정할 수 있습니다.

```powershell
.\nikke_mcp\setup.ps1 -Python 'C:\Python312\python.exe'
```

설치기는 저장소 안에 `.venv-mcp` 가상환경을 만들고, 필요한 라이브러리와
**이 PC의 경로가 들어간 Claude 설정 예제**를 생성합니다. 기존 앱 설정은 수정하지 않습니다.
마지막에 `"status": "OK"`와 아래 도구 이름이 나오면 실제 연결·계산 검증까지 성공한 것입니다.

```text
list_characters · get_character · get_settings · simulate_squad · compare_setups
inspect_shared_state · simulate_shared_state
```

직접 다시 확인하려면:

```powershell
.\.venv-mcp\Scripts\python.exe .\nikke_mcp\smoke.py
```

macOS/Linux에서는 같은 저장소에서 다음 명령을 사용합니다.

```bash
python3 -m venv .venv-mcp
.venv-mcp/bin/python -m pip install -r nikke_mcp/requirements.txt
.venv-mcp/bin/python nikke_mcp/smoke.py
```

## 3. Claude Desktop / 로컬 에이전트 연결

Claude Desktop의 설정에서 개발자(Developer) → 설정 편집(Edit Config)을 엽니다.
메뉴 이름은 앱 버전에 따라 다를 수 있습니다. 로컬 MCP 설정 파일은
Windows의 `%APPDATA%\Claude\claude_desktop_config.json`입니다.

설치기가 만든 `.venv-mcp/claude-desktop-config.json` 내용을 확인한 뒤,
기존 파일의 `mcpServers` 안에 **`nikke-calc` 항목만 병합**합니다. 다른 서버 설정을 덮어쓰지 마세요.
아래 경로는 예시이며 실제 설치 위치로 바꿔야 합니다.

```json
{
  "mcpServers": {
    "nikke-calc": {
      "command": "C:/nikke-calc/repo/.venv-mcp/Scripts/python.exe",
      "args": ["C:/nikke-calc/repo/nikke_mcp/launch.py"]
    }
  }
}
```

macOS/Linux는 `command`에 `/설치경로/.venv-mcp/bin/python`,
`args`에는 `/설치경로/nikke_mcp/launch.py`의 절대 경로를 넣습니다.
다른 로컬 MCP 지원 에이전트도 이 **실행 파일 + 인자**를 해당 제품의 서버 설정에 등록하면 됩니다.

Claude Desktop을 완전히 종료하고 다시 실행한 뒤, 새 대화에서 도구가 표시되는지 확인하세요.
로컬 stdio 서버는 앱이 필요할 때 실행하므로 별도 터미널을 계속 켜둘 필요가 없습니다.
PC가 꺼지면 사용할 수 없습니다.

첫 대화 예시:

> 니케 계산기 도구를 사용해서 등록된 캐릭터 중 리타를 찾아줘.
> 스킬 레벨 10 원문도 보여줘. 수치를 추측하지 말고 도구 결과를 사용해줘.

조회 도구가 실제로 호출되면 연결된 것입니다. 모델이 설명만 한다면 도구 활성화 여부를 확인하세요.

## 4. 내 PC에서 HTTP 테스트

PowerShell 창 하나에서 서버를 켭니다.

```powershell
.\.venv-mcp\Scripts\python.exe -m nikke_mcp --transport streamable-http
```

다른 창에서 확인합니다.

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
.\.venv-mcp\Scripts\python.exe .\nikke_mcp\smoke.py --url http://127.0.0.1:8000/mcp
```

`/health`는 상태 확인, **`/mcp`가 AI 연결 주소**입니다.
브라우저로 `/mcp`를 여는 것은 연결 검증이 아닙니다. MCP 클라이언트가 프로토콜에 맞게 호출해야 합니다.
서버 종료는 서버 창에서 `Ctrl+C`입니다.

## 5. 공개 중계 서버의 역할

공개 서비스는 Render에서 **요청 검증·작업 전달·결과 전달만** 담당합니다.
계산기에서 명시적으로 연결할 때 임의의 `connectionCode`가 발급되며, 연결한 브라우저가 작업을 받아 계산합니다.
Render가 재시작되면 메모리의 연결·작업이 사라집니다. 계산기에서 다시 연결해 새 코드를 사용하세요.

- 연결은 2시간 뒤 만료됩니다. 브라우저 응답이 45초 이상 없으면 오프라인으로 처리됩니다.
- 연결마다 한 번에 작업 1개를 진행합니다. 완료 결과는 중계 서버 메모리에 5분간 보관됩니다.
- 계산 요청은 곧바로 `queued`와 `jobId`를 반환합니다. AI는 결과 조회 도구를 별도로 호출해야 합니다.
- 탭을 열고 기기가 잠들지 않게 유지하세요. 탭이 정지되거나 닫히면 작업을 진행할 수 없습니다.

직접 HTTP 중계 서버를 운영하는 개발자는 `nikke_mcp/Dockerfile`과 `render.yaml`을 사용할 수 있습니다.
HTTPS에서 `/mcp`, `/health`, `/browser/*` 경로를 전달하고, 허용 호스트와 브라우저 Origin을 맞춰야 합니다.
HTTP 모드에서는 직접 운영해도 서버 CPU로 계산하지 않습니다. 로컬 CPU 계산은 stdio 모드를 사용하세요.

## 6. ChatGPT 웹 연결

**공개 중계 주소 `https://nikke-calc-mcp.onrender.com/mcp`를 사용합니다.** 앱 등록 후에는 8절에 따라 계산기 브라우저도 연결하세요.
현재 공식 문서의 개발자 모드 경로는 다음과 같습니다. 계정·조직 정책에 따라 메뉴와 권한이 다를 수 있습니다.

1. ChatGPT 웹의 설정 → 보안 및 로그인(Security and login)에서 개발자 모드를 켭니다.
2. [ChatGPT Plugins](https://chatgpt.com/plugins)에서 `+`를 눌러 개발자 모드 앱을 만듭니다.
3. 이름은 `NIKKE Calculator`, MCP 주소는 **`https://nikke-calc-mcp.onrender.com/mcp`**를 입력합니다.
4. 이 버전의 인증 방식은 **No Authentication**입니다. OpenAI API 키나 블라블라링크 쿠키를 입력하지 않습니다.
5. 앱 상세 화면에서 도구 목록을 확인합니다. 서버 업데이트 후에는 Refresh로 갱신합니다.
6. 새 대화에 다음 확인 프롬프트를 보냅니다. 실제 도구 호출과 목록이 보이면 연결된 것입니다.

> NIKKE Calculator의 list_characters 도구를 호출해 사용 가능한 캐릭터 3명의 이름을 보여줘. 도구를 호출할 수 없으면 추측하지 말고 연결되지 않았다고 알려줘.

도구를 사용할 수 없다고 나오면 등록 계정과 도구 활성화를 확인하세요. 대화에서 앱 선택을 요구하는 화면이면 NIKKE Calculator를 선택합니다. 선택 메뉴는 화면마다 다를 수 있어 `+ → 개발자 모드`를 필수 경로로 안내하지 않습니다.

메뉴가 없으면 계정의 개발자 모드 제공 여부와 조직 관리자의 앱 허용 설정을 확인하세요.
일반 대화에 주소만 붙이는 것으로 MCP가 등록되지는 않습니다.

공식 기준: [OpenAI ChatGPT Developer mode](https://developers.openai.com/api/docs/guides/developer-mode).
이 절은 공식 문서를 바탕으로 작성했으며, 사용자 계정에서 실제 연결한 화면을 뜻하지 않습니다.

## 7. Claude 웹 / 원격 커넥터 연결

1. Claude의 Customize → Connectors에서 사용자 지정 커넥터를 추가합니다.
2. 이름과 **`https://nikke-calc-mcp.onrender.com/mcp`**를 입력합니다.
3. 이 서버에는 OAuth가 없으므로 고급 OAuth Client ID/Secret을 입력하지 않습니다.
4. 새 대화의 `+` → Connectors에서 연결한 도구를 활성화하고 조회 예시를 실행합니다.

Team/Enterprise는 조직 관리자가 먼저 추가해야 할 수 있습니다.
원격 커넥터는 Claude 서버에서 접속하므로 PC나 사내망에서만 열리는 주소로는 연결되지 않습니다.
공식 기준: [Claude 사용자 지정 원격 MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## 8. 내 브라우저의 육성·편성으로 계산하기

![브라우저 연결과 계산 흐름](../site/public/tutorials/mcp-share-flow.svg)

1. [계산기](https://moris-kr.github.io/nikke-calc/)에서 육성을 불러오고 덱·전투 조건을 설정합니다.
2. **편의 기능 → MCP → AI 연결**에서 연결을 시작합니다.
3. 발급된 연결 코드를 등록한 AI 대화에 전달합니다. 계산기 탭을 계속 열어 두세요.
4. 아래 요청에서 `내 연결 코드`를 실제 코드로 바꿉니다.

> 연결 코드는 `내 연결 코드`야. inspect_browser_state에 connection_code로 전달하고, 반환된 jobId를 get_browser_result의 job_id로 넣어 같은 connection_code로 조회해줘. queued나 running이면 잠시 후 다시 조회하고, complete일 때 result에서 전체 육성과 덱 목록을 확인해줘. 이어 simulate_browser_state에 같은 connection_code와 deck_index: 1을 전달해 첫 덱을 계산해줘. 그 jobId도 get_browser_result로 complete까지 확인하고 실제 결과와 적용 육성을 알려줘. 실패하면 오류를 그대로 알려주고 수치를 추측하지 마.

| 도구 | 주요 인자 | 동작 |
|---|---|---|
| `inspect_browser_state` | `connection_code` | 현재 브라우저 육성·덱 확인 작업 등록 |
| `simulate_browser_state` | `connection_code`, `deck_index: 1` | 첫 번째 비어 있지 않은 덱 계산 작업 등록 |
| `simulate_browser_state` | `connection_code`, `squad` | 전체 로스터에서 지정한 새 조합 계산 작업 등록 |
| `get_browser_result` | `connection_code`, `job_id` | `queued`·`running`·`complete`·`failed` 확인 |

`queued`는 계산 완료가 아닙니다. `complete` 응답의 `result`만 계산 결과로 사용합니다.
작업마다 브라우저가 그때의 상태를 읽습니다. 육성·편성을 바꾼 뒤 다음 작업을 요청하면 변경된 설정을 사용합니다.
조회 작업과 계산 작업 사이에 설정을 바꾸면 두 작업의 입력도 달라질 수 있습니다.

**덱과 로스터는 다릅니다.** `deck_index`는 비어 있지 않은 덱 순서대로 1부터 시작하며,
그 덱에서 수정한 육성·운용·전투 조건을 유지합니다. `squad`로 새 조합을 요청하면 전체 `roster` 육성과
공통 `battle` 조건을 사용합니다. 로스터에 없는 캐릭터는 기본값으로 대체하지 않고 거절합니다.

### 직접 조건을 지정해 비교하기

육성 파일을 따로 공유할 필요는 없습니다. `simulate_browser_state`가 요청 시점의 브라우저 설정을 읽습니다.
특정 조건을 직접 지정하려면 `simulate_squad`에 `request`, `compare_setups`에 같은 전투 조건의
2~5개 `requests`를 전달할 수도 있습니다. 원격 HTTP에서는 `connection_code`가 필요하며,
받은 `jobId`를 `get_browser_result`로 조회합니다. 로컬 stdio는 연결 코드 없이 이 PC에서 계산합니다.

생략한 육성은 계산기 기본값이므로 실제 보유·육성으로 단정하지 않습니다.
지원 입력은 `get_settings`에서 확인합니다. 커스텀 캐릭터·핵 옵션은 지원하지 않습니다.

### 전달되는 정보와 연결 코드 관리

AI 연결 중에는 **육성·편성·전투 조건과 계산 결과가 AI 서비스 및 Render 중계 서버를 거칩니다.**
Render는 연결·작업·결과를 메모리에 임시로 보관하며, 완료 결과는 5분 뒤 만료됩니다.
닉네임·계정 ID·프로필 주소·덱 이름·쿠키·대화 내역은 브라우저 공유 데이터에 포함하지 않습니다.
AI 서비스에 보낸 내용에는 해당 서비스의 보관 정책이 적용됩니다.

**연결 코드를 아는 사람은 연결된 브라우저의 전체 육성·덱을 읽고 계산을 요청할 수 있습니다.**
코드를 공개 게시물이나 스크린샷에 올리지 마세요. 사용을 마치면 **연결 해제**로 권한을 취소합니다.
새로고침·만료·Render 재시작 후에는 다시 연결해 새 코드를 AI에 전달하세요.

## 9. 결과를 읽는 기준

`complete`의 `result`에 있는 실제 입력, `effectiveCharacters`, 총딜·캐릭터별 딜과
`deviations`(기본 스펙 이탈), `previewNote`(미검증 데이터 경고)를 함께 확인하세요.
브라우저 런타임 버전도 비교해야 하며 서버 버전만 같다고 같은 결과를 보장하지는 않습니다.
상세 타임라인이 필요하면 지원하는 계산 도구에 `detail: true`를 지정합니다.

오류나 `queued`·`running`을 계산 결과처럼 해석하지 마세요. 작업을 하나씩 끝낸 뒤 다음 후보를 요청하세요.
`random` 모드는 한 번의 난수 시행이며 신뢰구간을 제공하지 않습니다.
후보 비교는 요청한 후보 안의 순위이며 전체 조합의 최적해가 아닙니다.
MCP 연결이 기존 엔진의 실게임 정확도를 새로 보증하지는 않습니다.

## 10. 문제 해결

| 증상 | 확인할 내용 |
|---|---|
| 첫 연결 응답이 느림 | Render 절전 해제 후 `/health`가 정상인지 확인 |
| 브라우저가 연결되지 않음·코드 만료 | 계산기에서 다시 연결하고 새 코드를 전달 |
| 대기 상태가 계속됨 | 계산기 탭과 기기를 깨워 두고 연결 상태 확인 |
| 이미 작업 진행 중 | 앞 작업의 결과를 조회한 뒤 다음 작업 요청 |
| 결과를 찾을 수 없음 | 완료 후 5분 경과·연결 만료·Render 재시작 여부 확인 후 다시 계산 |
| 웹과 다른 수치 | 같은 런타임·육성·편성 순서·전투 조건인지, 덱과 로스터 중 무엇을 썼는지 확인 |
| 미지원 설정 오류 | `get_settings` 형식 확인. 일반 백업 전체를 전달하지 않음 |
| 로컬 `No module named mcp` | `.venv-mcp`의 Python 사용 여부 확인 |
| 원격 커넥터에서 localhost 실패 | 공개 HTTPS MCP 주소 사용 |

개발 검증:

```powershell
.\.venv-mcp\Scripts\python.exe -m unittest discover -s nikke_mcp -p 'test_*.py' -v
```

작성 기준: 2026-09-18. 예제에 실제 사용자 연결 코드·프로필·인증 정보는 포함하지 않습니다.
