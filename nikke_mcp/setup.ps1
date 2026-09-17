param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$repoDir = Split-Path $PSScriptRoot -Parent
$venvDir = Join-Path $repoDir '.venv-mcp'
& $Python -m venv $venvDir
if ($LASTEXITCODE -ne 0) { throw 'Python 3.10 이상이 필요합니다.' }
$pythonExe = Join-Path $venvDir 'Scripts/python.exe'
& $pythonExe -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'MCP 의존성 설치 실패' }
$launchFile = Join-Path $PSScriptRoot 'launch.py'
$config = @{ mcpServers = @{ 'nikke-calc' = @{ command = $pythonExe; args = @($launchFile) } } }
$configFile = Join-Path $venvDir 'claude-desktop-config.json'
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configFile -Encoding utf8
Write-Host "설치 완료. Claude Desktop 설정에 병합할 예제: $configFile"
Write-Host '기존 앱 설정은 변경하지 않았습니다.'
& $pythonExe (Join-Path $PSScriptRoot 'smoke.py')
if ($LASTEXITCODE -ne 0) { throw 'MCP 연결 검증 실패' }
