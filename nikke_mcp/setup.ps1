param([string]$Node = 'node')
$ErrorActionPreference = 'Stop'
$nodeExe = (Get-Command $Node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { throw 'Node.js 22 이상이 필요합니다. https://nodejs.org 에서 설치하거나 -Node로 경로를 지정하세요.' }
$major = [int]((& $nodeExe --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw "Node.js 22 이상이 필요합니다. (현재 $major)" }
$npm = Join-Path (Split-Path $nodeExe -Parent) 'npm.cmd'
if (-not (Test-Path $npm)) { $npm = 'npm' }
Push-Location $PSScriptRoot
try {
  & $npm ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'MCP 의존성 설치 실패' }
} finally {
  Pop-Location
}
$launchFile = Join-Path $PSScriptRoot 'launch.mjs'
$config = @{ mcpServers = @{ 'nikke-calc' = @{ command = $nodeExe; args = @($launchFile) } } }
$configFile = Join-Path $PSScriptRoot 'claude-desktop-config.json'
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configFile -Encoding utf8
Write-Host "설치 완료. Claude Desktop 설정에 병합할 예제: $configFile"
Write-Host '기존 앱 설정은 변경하지 않았습니다.'
& $nodeExe (Join-Path $PSScriptRoot 'smoke.mjs')
if ($LASTEXITCODE -ne 0) { throw 'MCP 연결 검증 실패' }
