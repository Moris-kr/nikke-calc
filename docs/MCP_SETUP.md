# AI에서 니케 계산기 사용하기

ChatGPT·Claude·MCP 지원 에이전트가 **기존 웹 계산기와 같은 Python 엔진**을 호출합니다.
이 서버에는 AI 모델이나 AI API 키가 필요하지 않습니다. 사용하는 AI 서비스의 이용 조건은 별도입니다.

**지금 제공하는 것:** 로컬 실행 프로그램, 자동 설치 스크립트, 원격 Docker 배포 구성.
**제공하지 않는 것:** 운영 중인 공용 MCP 주소. GitHub Pages 사이트 주소는 MCP 주소가 아닙니다.

## 1. 연결 방식 고르기

| 사용 환경 | 연결 방식 | 서버 필요 여부 |
|---|---|---|
| Claude Desktop의 로컬 MCP, 로컬 MCP 지원 에이전트 | stdio | 이 PC가 계산 실행 |
| ChatGPT 웹, Claude 웹의 사용자 지정 커넥터 | 원격 Streamable HTTP | 외부에서 접근 가능한 HTTPS 실행 환경 필요 |
| 개발 중 HTTP 점검 | `http://127.0.0.1:8000/mcp` | PC에서만 접속 |

ChatGPT에 `localhost`를 입력하는 것만으로 PC에 연결되지 않습니다.
Claude도 **원격 커넥터는 클라우드에서 접속**합니다. Claude Desktop의 로컬 MCP 설정은 다른 방식입니다.
서버가 없다면 **2~3절로 로컬 MCP부터 사용**하고, 원격 연결은 5~7절을 따르세요.

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
마지막에 `"status": "OK"`와 아래 5개 도구 이름이 나오면 실제 연결·계산 검증까지 성공한 것입니다.

```text
list_characters · get_character · get_settings · simulate_squad · compare_setups
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

## 5. 원격 서버 배포 준비

Docker를 실행할 서버와 HTTPS 도메인을 준비한 뒤 사용합니다.
이 저장소의 GitHub Pages 배포는 MCP 서버를 시작하지 않습니다.
아래 `mcp.example.com`은 설명용 예시이며 제공되는 서비스가 아닙니다.

저장소 최상위에서 이미지를 빌드합니다.

```bash
docker build -f nikke_mcp/Dockerfile -t nikke-mcp .
docker run -d --name nikke-mcp --restart unless-stopped \
  --memory=1g --cpus=2 \
  -p 127.0.0.1:8000:8000 \
  -e NIKKE_MCP_ALLOWED_HOSTS=mcp.example.com \
  nikke-mcp
```

줄 끝 `\`는 Linux 셸 문법입니다. PowerShell에서는 명령을 한 줄로 입력하세요.
서버의 HTTPS 역방향 프록시 또는 호스팅 플랫폼에서 다음을 설정합니다.

| 항목 | 값 |
|---|---|
| 외부 주소 | `https://mcp.example.com` |
| 전달 대상 | 같은 서버의 `http://127.0.0.1:8000` |
| 경로 | `/mcp`와 `/health`를 그대로 전달 |
| Host 헤더 | `mcp.example.com` 유지 |
| 연결 시간 제한 | 비교 5개가 순차 실행될 수 있으므로 330초 이상 권장 |
| 공개 주소 검증 | `https://mcp.example.com/health`와 smoke 클라이언트 |

서버가 아닌 호스팅 플랫폼의 컨테이너로 실행한다면 해당 플랫폼에서
컨테이너 포트 `8000`으로 라우팅하고 HTTPS를 설정합니다.
도메인을 변경하면 환경 변수의 허용 도메인도 바꿔 재시작해야 합니다.
쉼표로 여러 도메인을 지정할 수 있습니다. 스킴과 `/mcp`는 환경 변수에 넣지 않습니다.

```bash
python nikke_mcp/smoke.py --url https://mcp.example.com/mcp
```

검증 클라이언트에도 `nikke_mcp/requirements.txt` 설치가 필요합니다.
클라이언트의 도구 호출 시간 제한이 더 짧으면 후보 수나 전투 시간을 줄이세요.

**이 버전은 인증 없는 공개 계산 도구입니다.** 사용자 계정·프로필 보관·결과 목록 API는 없습니다.
주소를 아는 사람은 계산을 요청할 수 있으므로 운영 환경에는 요청 빈도 제한을 추가하세요.
OAuth나 사용자별 저장 기능은 이 구성에 포함되지 않습니다.
기본 프로세스당 동시 계산은 2개, 대기 제한은 2초, 계산 한 건 제한은 60초입니다.

컨테이너에는 필요한 엔진·공개 게임 데이터만 복사합니다.
`profiles/`, 세션 쿠키, `.git`, 로컬 환경 파일, 브라우저 데이터는 빌드 대상에서 제외합니다.
개인 계정 폴더를 컨테이너에 마운트할 필요가 없습니다.

## 6. ChatGPT 웹 연결

**먼저 5절의 HTTPS 주소가 실제로 동작해야 합니다.** 로컬 설치만으로 이 단계는 완료되지 않습니다.
현재 공식 문서의 개발자 모드 경로는 다음과 같습니다. 계정·조직 정책에 따라 메뉴와 권한이 다를 수 있습니다.

1. ChatGPT 웹의 설정 → 보안 및 로그인(Security and login)에서 개발자 모드를 켭니다.
2. [ChatGPT Plugins](https://chatgpt.com/plugins)에서 `+`를 눌러 개발자 모드 앱을 만듭니다.
3. 이름은 `NIKKE Calculator`, MCP 주소는 **본인 서버의 `https://도메인/mcp`**를 입력합니다.
4. 이 버전의 인증 방식은 **No Authentication**입니다. OpenAI API 키나 블라블라링크 쿠키를 입력하지 않습니다.
5. 새 대화에서 개발자 모드 도구로 앱을 선택하고, 3절의 조회 예시를 실행합니다.

메뉴가 없으면 계정의 개발자 모드 제공 여부와 조직 관리자의 앱 허용 설정을 확인하세요.
일반 대화에 주소만 붙이는 것으로 MCP가 등록되지는 않습니다.

공식 기준: [OpenAI ChatGPT Developer mode](https://developers.openai.com/api/docs/guides/developer-mode).
이 절은 공식 문서를 바탕으로 작성했으며, 사용자 계정에서 실제 연결한 화면을 뜻하지 않습니다.

## 7. Claude 웹 / 원격 커넥터 연결

1. Claude의 Customize → Connectors에서 사용자 지정 커넥터를 추가합니다.
2. 이름과 본인 서버의 **`https://도메인/mcp`** 주소를 입력합니다.
3. 이 서버에는 OAuth가 없으므로 고급 OAuth Client ID/Secret을 입력하지 않습니다.
4. 새 대화의 `+` → Connectors에서 연결한 도구를 활성화하고 조회 예시를 실행합니다.

Team/Enterprise는 조직 관리자가 먼저 추가해야 할 수 있습니다.
원격 커넥터는 Claude 서버에서 접속하므로 PC나 사내망에서만 열리는 주소로는 연결되지 않습니다.
공식 기준: [Claude 사용자 지정 원격 MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## 8. 계산·비교 예제

아래는 **기본 스펙을 사용하는 가상 예제**입니다. 개인 계정 정보가 아닙니다.

> 니케 계산기로 리타, 크라운, 신데렐라, 모더니아, 나가를 180초 계산해줘.
> 보스 방어력 31784, 속성 없음, 코어 크기 0, 파츠 없음, 기대값 모드로 해줘.
> 육성은 계산기 기본값을 쓰고, 적용된 기본 스펙과 기본값에서 달라진 항목도 알려줘.

`simulate_squad`의 도구 인자 예시:

```json
{
  "request": {
    "squad": ["리타", "크라운", "신데렐라", "모더니아", "나가"],
    "duration": 180,
    "enemyDef": 31784,
    "enemyCode": "",
    "corePx": 0,
    "hasParts": false,
    "rngMode": "expected",
    "seed": 42,
    "characters": {}
  }
}
```

> 같은 조건에서 신데렐라의 큐브만 미착용으로 바꾼 후보와 원래 후보를 비교해줘.
> 실제 compare_setups 결과로 총딜 차이와 비율을 알려줘.

AI는 1번 후보를 유지하고, 2번 후보의 `characters`에 다음을 지정합니다.

```json
{"신데렐라": {"cube": {"name": "없음", "level": 0}}}
```

`compare_setups`의 인자는 `{"requests": [첫번째_요청객체, 두번째_요청객체]}` 구조입니다.
앞 예제에서 `request` 안에 들어가는 객체 두 개를 사용하며, 위 표기는 구조 설명입니다.
후보마다 전투 조건이 다르면 서버가 비교를 거부합니다.

스킬 레벨을 반영하려면 해당 캐릭터 설정에 다음을 넣습니다.

```json
{"skillLevels": {"1": 7, "2": 7, "3": 10}}
```

지원하는 육성 입력은 `get_settings`로 확인합니다. 웹의 백업 JSON 전체를 넣는 기능은 없습니다.
실제 계정 육성을 쓰려면 필요한 캐릭터의 지원 설정을 명시적으로 전달해야 합니다.
계정 콘솔·싱크로 레벨·고급 보스 메이커·커스텀 캐릭터·핵 옵션은 이 첫 버전에서 지원하지 않습니다.
미지원 옵션을 보내면 무시하지 않고 오류로 처리합니다.

## 9. 결과를 읽는 기준

| 필드 | 의미 |
|---|---|
| `engineVersion` | 계산 엔진·데이터·MCP 코드 내용의 해시. 웹 런타임 버전 문자열과는 별개 |
| `request` | 생략된 기본 전투 조건을 채운 실행 입력 |
| `effectiveCharacters` | 기본 스펙과 요청을 합친 실제 캐릭터 설정 |
| `result.squadTotal`, `charTotals` | 총딜·캐릭터별 딜 |
| `result.charBreakdown` | 평타·스킬별 피해 내역 |
| `result.deviations` | 공통 기본 스펙에서 벗어난 설정 |
| `result.previewNote` | 출시 전 데이터 등의 경고. 있으면 답변에도 함께 표시 |
| `deltaFromFirst`, `percentFromFirst` | 첫 후보 대비 증감. 첫 후보 피해가 0이면 비율은 null |

상세 타임라인은 같은 요청에 `"detail": true`를 붙여 다시 계산합니다.
서버에 결과를 보관하거나 다른 사용자의 결과를 조회하는 기능은 없습니다.
같은 코드·데이터·입력·seed에서 재현할 수 있습니다. 업데이트할 때 서버를 재시작하세요.

MCP는 연결 방식이며 **실게임 정확도를 새로 보증하지는 않습니다.** 기존 엔진의 구현 범위가 그대로 적용됩니다.
`random` 모드는 한 번의 난수 시행이며 신뢰구간을 제공하지 않습니다.
비교 순위는 계산한 2~5개 후보 안의 순위로, 전체 조합의 최적해가 아닙니다.

MCP 서버는 대화 내역·프로필 사진·브라우저 쿠키를 읽지 않습니다.
직접 도구에 전달한 육성 수치는 선택한 AI 서비스와 MCP 실행 환경에서 처리됩니다.
기존 웹 계산기는 계속 브라우저 안에서 계산하며 이 MCP에 자동 연결되지 않습니다.

## 10. 문제 해결

| 증상 | 확인할 내용 |
|---|---|
| `No module named mcp` | 시스템 Python 대신 `.venv-mcp`의 Python을 사용했는지 확인 |
| 앱에서 서버 실행 실패 | `command`, `args`를 절대 경로로 지정하고 smoke 명령부터 실행 |
| `Invalid Host header` / HTTP 421 | 도메인과 `NIKKE_MCP_ALLOWED_HOSTS`, 프록시 Host 전달 설정 확인 |
| ChatGPT/Claude 웹에서 localhost 연결 실패 | 원격 HTTPS 서버가 필요. 5절 확인 |
| `계산 서버가 사용 중` | 동시 계산 제한. 잠시 후 재시도 |
| 계산 시간 제한 / 커넥터 시간 초과 | 전투 시간과 비교 후보 수를 줄임 |
| 미지원 설정 오류 | `get_settings`의 입력 형식 확인. 백업 전체를 전달하지 않음 |
| 웹과 다른 수치 | 동일 커밋, 캐릭터 육성, 편성 순서, 보스·전투 설정을 확인 |
| Docker daemon 연결 오류 | Docker Engine/Desktop을 실행하거나 Docker 가능한 서버에서 빌드 |

개발 검증:

```powershell
.\.venv-mcp\Scripts\python.exe -m unittest discover -s nikke_mcp -p 'test_*.py' -v
```

원격 컨테이너를 업데이트하려면 새 커밋을 받고 이미지를 다시 빌드한 뒤 기존 컨테이너를 교체합니다.
운영 중인 계산이 끝난 뒤 교체하세요. GitHub Actions의 **MCP checks**는 컨테이너 빌드와 HTTP 도구 호출을 검사하며,
공용 서버를 배포하는 작업은 아닙니다.

작성 기준: 2026-09-18. 예제에는 실제 사용자 대화·프로필·인증 정보가 포함되어 있지 않습니다.
