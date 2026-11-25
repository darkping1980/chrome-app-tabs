# Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
# Copyright (C) 2026 darkping1980
# SPDX-License-Identifier: GPL-3.0-only
# This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
# and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
<#
  App Tabs 설치 / 업데이트 (현재 사용자 전용, 관리자 권한 불필요)

  배포 패키지(ChromeAppTabs-vX.Y.Z.zip)를 푼 폴더에서 실행합니다. 저장소에서 직접 실행할 수도 있습니다(소스에서 빌드).
    - 설치본이 없으면: 신규 설치
    - 이전 버전이 있으면: 업데이트(같은 경로, 같은 확장 ID 유지, 연결 정보·설정 유지)
    - 실패하면: 백업에서 이전 버전을 자동 복구
  하지 않는 일: Chrome 프로필/설정 변경, Chrome·VS Code 등 다른 프로그램 종료.

  사용: powershell -ExecutionPolicy Bypass -File setup.ps1 [-DryRun] [-Yes] [-AllowDowngrade]
        -Yes            App Tabs 호스트가 실행 중이면 묻지 않고 종료 후 진행 (App Tabs 자신의 프로세스만)
        -InstallRoot / -HostName / -SimulateFailure : 테스트 전용 (격리 경로·별도 호스트 이름·복구 시험)
#>
param(
  [switch]$DryRun, [switch]$Yes, [switch]$AllowDowngrade,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'ChromeAppTabs'),
  [string]$HostName = 'com.kbj.chrome_app_tabs',
  [switch]$SimulateFailure
)
$ErrorActionPreference = 'Stop'
$ExtensionId = 'bahmlmpijalpgcnbnkgplggendgjhdlk'
$DefaultHost = 'com.kbj.chrome_app_tabs'
$pkg = $PSScriptRoot
$app = Join-Path $InstallRoot 'app'
$key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
function Step($m) { Write-Host "  - $m" }
function Fail($m) { Write-Host ""; Write-Host "[중단] $m" -ForegroundColor Red; exit 1 }

# ---------- 1. package ----------
# release package: <pkg>\app\AppTabsHost.exe + <pkg>\app\extension ; repository: build from source
$repoRoot = Split-Path $pkg -Parent
if (Test-Path (Join-Path $pkg 'app\AppTabsHost.exe')) {
  $srcExe = Join-Path $pkg 'app\AppTabsHost.exe'; $srcExt = Join-Path $pkg 'app\extension'
  $sums = Join-Path $pkg 'SHA256SUMS.txt'
  if (Test-Path $sums) {   # integrity of the extracted package
    foreach ($line in Get-Content $sums -Encoding UTF8) {
      if ($line -notmatch '^([0-9a-f]{64})\s+\*?(.+)$') { continue }
      $f = Join-Path $pkg $Matches[2]
      if (-not (Test-Path $f) -or (Get-FileHash $f -Algorithm SHA256).Hash.ToLower() -ne $Matches[1]) { Fail "패키지 파일이 손상되었습니다: $($Matches[2]). 배포 파일을 다시 내려받으세요." }
    }
  }
} elseif (Test-Path (Join-Path $repoRoot 'host\build.ps1')) {
  if (-not $DryRun) { & (Join-Path $repoRoot 'host\build.ps1') | Out-Null }
  $srcExe = Join-Path $repoRoot 'host\bin\AppTabsHost.exe'; $srcExt = Join-Path $repoRoot 'extension'
} else { Fail '설치할 파일을 찾을 수 없습니다. 배포 패키지를 푼 폴더에서 실행하세요.' }
$newVer = (Get-Content (Join-Path $srcExt 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version

# ---------- 2. environment ----------
$chrome = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction SilentlyContinue).'(default)'
if (-not $chrome) { $chrome = (Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction SilentlyContinue).'(default)' }
if (-not $chrome) { Fail 'Google Chrome을 찾을 수 없습니다.' }
$oldVer = $null
$oldManifest = Join-Path $app 'extension\manifest.json'
if (Test-Path $oldManifest) { $oldVer = (Get-Content $oldManifest -Raw -Encoding UTF8 | ConvertFrom-Json).version }
$mode = if (-not $oldVer) { 'install' } elseif ([version]$oldVer -lt [version]$newVer) { 'update' } elseif ([version]$oldVer -eq [version]$newVer) { 'reinstall' } else { 'downgrade' }
Write-Host ("App Tabs {0}: {1}{2}" -f $(switch ($mode) { 'install' { '신규 설치' } 'update' { "업데이트 $oldVer -> $newVer" } 'reinstall' { "재설치 $newVer" } 'downgrade' { "다운그레이드 $oldVer -> $newVer" } }), $newVer, $(if ($DryRun) { ' (DryRun: 실제 변경 없음)' }))
Step "Chrome: $chrome"
Step "설치 위치: $app"
if ($mode -eq 'downgrade' -and -not $AllowDowngrade) { Fail "설치된 버전($oldVer)이 더 새 버전입니다. 이전 버전으로 되돌리려면 -AllowDowngrade 를 붙여 실행하세요." }

# ---------- 3. running state ----------
$running = @(Get-CimInstance Win32_Process -Filter "Name='AppTabsHost.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($app, [StringComparison]::OrdinalIgnoreCase) })
$stateFile = Join-Path $InstallRoot 'attached.json'
$attached = 0
if (Test-Path $stateFile) { try { $attached = @(Get-Content $stateFile -Raw | ConvertFrom-Json).Count } catch {} }
if ($running.Count -gt 0) {
  Step "실행 중인 App Tabs 호스트: PID $($running.ProcessId -join ', ') (Chrome에서 확장이 켜져 있음), 연결된 프로그램 창: $attached 개"
  Write-Host '    업데이트하려면 App Tabs 호스트만 잠시 종료해야 합니다. 연결된 프로그램 창은 원래 위치로 돌아가며 종료되지 않습니다.'
  Write-Host '    Chrome, VS Code 등 다른 프로그램은 종료하지 않습니다. 업데이트 후 프로그램 탭을 다시 누르면 다시 연결됩니다.'
  if (-not $Yes -and -not $DryRun) {
    $ans = Read-Host '    계속할까요? (Y/N)'
    if ($ans -notmatch '^[Yy]') { Fail '사용자가 취소했습니다. 아무것도 바뀌지 않았습니다.' }
  }
}
$prevReg = (Get-ItemProperty $key -ErrorAction SilentlyContinue).'(default)'

if ($DryRun) {
  if ($running.Count) { Step "App Tabs 호스트 종료: PID $($running.ProcessId -join ', ')" }
  Step "준비: $InstallRoot\app.new 에 새 버전 복사 후 확인"
  if ($oldVer) { Step "교체: $app -> 백업($InstallRoot\backup\app-$oldVer-<시각>), app.new -> $app (같은 경로 유지)" } else { Step "설치: app.new -> $app" }
  Step "레지스트리: $key -> $app\$HostName.json"
  return
}

# ---------- 4. stop our host only (its watchdog restores attached windows) ----------
foreach ($p in $running) { Step "App Tabs 호스트 종료: PID $($p.ProcessId)"; Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
if ($running.Count) {
  $deadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $deadline -and @(Get-CimInstance Win32_Process -Filter "Name='AppTabsHost.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($app, [StringComparison]::OrdinalIgnoreCase) }).Count) { Start-Sleep -Milliseconds 200 }
  if (Test-Path (Join-Path $app 'AppTabsHost.exe')) { & (Join-Path $app 'AppTabsHost.exe') --restore-all | Out-Null } # make sure every window is back
}

# ---------- 5. stage the new version next to the current one (nothing live is touched yet) ----------
$newDir = Join-Path $InstallRoot 'app.new'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (Test-Path $newDir) { Remove-Item $newDir -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $newDir 'extension') | Out-Null
Copy-Item $srcExe (Join-Path $newDir 'AppTabsHost.exe')
Copy-Item (Join-Path $srcExt '*') (Join-Path $newDir 'extension') -Recurse
if ($HostName -ne $DefaultHost) {   # test-only: point the extension copy at the test host name
  $bg = Join-Path $newDir 'extension\background.js'
  (Get-Content $bg -Raw -Encoding UTF8).Replace("const HOST = '$DefaultHost';", "const HOST = '$HostName';") | Set-Content $bg -Encoding UTF8 -NoNewline
}
$manifestPath = Join-Path $app "$HostName.json"     # final location (after the swap)
[ordered]@{ name = $HostName; description = 'App Tabs native host'; path = (Join-Path $app 'AppTabsHost.exe'); type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/") } | ConvertTo-Json | Out-File -Encoding ascii (Join-Path $newDir "$HostName.json")
$hvStaged = (& (Join-Path $newDir 'AppTabsHost.exe') --version | Out-String).Trim()
if ($hvStaged -ne $newVer) { Remove-Item $newDir -Recurse -Force; Fail "새 호스트 실행 파일 확인 실패 ($hvStaged). 아무것도 바뀌지 않았습니다." }

# ---------- 6. swap folders: app -> app.prev-<stamp>, app.new -> app (same path => same extension path/ID) ----------
function Stop-OurHosts {
  foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='AppTabsHost.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($app, [StringComparison]::OrdinalIgnoreCase) })) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
}
$prevDir = $null
if (Test-Path $app) {
  $prevDir = Join-Path $InstallRoot "app.prev-$stamp"
  $moved = $false
  for ($i = 0; $i -lt 10 -and -not $moved; $i++) {
    try { Rename-Item $app (Split-Path $prevDir -Leaf) -ErrorAction Stop; $moved = $true }
    catch { Stop-OurHosts; Start-Sleep -Milliseconds 400 }   # Chrome may relaunch the host at any moment
  }
  if (-not $moved) { Remove-Item $newDir -Recurse -Force; Fail '현재 설치 폴더가 사용 중이라 교체할 수 없습니다. Chrome에서 App Tabs 확장을 끄고 다시 실행하세요. 아무것도 바뀌지 않았습니다.' }
}
function Restore-Previous {
  Write-Host '  - 이전 버전으로 복구 중...' -ForegroundColor Yellow
  Stop-OurHosts; Start-Sleep -Milliseconds 300
  if (Test-Path $app) { Rename-Item $app ("app.failed-$stamp") -ErrorAction SilentlyContinue }
  if ($prevDir -and (Test-Path $prevDir)) { Rename-Item $prevDir 'app' }
  if ($prevReg) { New-Item -Force $key | Out-Null; Set-ItemProperty $key -Name '(default)' -Value $prevReg }
  elseif (Test-Path $key) { Remove-Item $key }
}
try {
  Rename-Item $newDir 'app' -ErrorAction Stop
  New-Item -Force $key | Out-Null
  Set-ItemProperty $key -Name '(default)' -Value $manifestPath
  if ($SimulateFailure) { throw 'SimulateFailure: 테스트용 강제 실패' }

  # ---------- 7. verify ----------
  $extDir = Join-Path $app 'extension'
  $hv = (& (Join-Path $app 'AppTabsHost.exe') --version | Out-String).Trim()
  $ev = (Get-Content (Join-Path $extDir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  $rv = (Get-ItemProperty $key).'(default)'
  if ($hv -ne $newVer) { throw "호스트 버전 확인 실패 ($hv)" }
  if ($ev -ne $newVer) { throw "확장 버전 확인 실패 ($ev)" }
  if ($rv -ne $manifestPath -or -not (Test-Path $manifestPath)) { throw '레지스트리 등록 확인 실패' }
} catch {
  Write-Host "  - 오류: $($_.Exception.Message)" -ForegroundColor Red
  Restore-Previous
  $rb = if (Test-Path (Join-Path $app 'extension\manifest.json')) { (Get-Content (Join-Path $app 'extension\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version } else { '(없음)' }
  Fail "설치/업데이트에 실패하여 이전 상태로 복구했습니다 (현재 버전: $rb)."
}

# ---------- 8. keep the previous version as a backup (last 3) ----------
$backup = $null
if ($prevDir) {
  $backupRoot = Join-Path $InstallRoot 'backup'
  New-Item -ItemType Directory -Force $backupRoot | Out-Null
  $backup = Join-Path $backupRoot ("app-{0}-{1}" -f $oldVer, $stamp)
  Move-Item $prevDir $backup
  Step "이전 버전 백업: $backup"
  Get-ChildItem $backupRoot -Directory | Sort-Object LastWriteTime -Descending | Select-Object -Skip 3 | Remove-Item -Recurse -Force
}
Get-ChildItem $InstallRoot -Directory -Filter 'app.failed-*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

[ordered]@{ version = $newVer; previousVersion = $oldVer; mode = $mode; installedAt = (Get-Date).ToString('s'); backup = $backup; hostName = $HostName } |
  ConvertTo-Json | Out-File -Encoding utf8 (Join-Path $InstallRoot 'install-info.json')
Step "호스트 v$hv, 확장 v$ev 확인 완료"

Write-Host ''
switch ($mode) {
  'install' {
    Write-Host '설치 완료. Chrome에서 한 번만 해 주세요:'
    Write-Host '  1. 주소창에 chrome://extensions 입력 → 오른쪽 위 "개발자 모드" 켜기'
    Write-Host '  2. "압축해제된 확장 프로그램을 로드합니다" → 다음 폴더 선택:'
    Write-Host "     $extDir"
    Write-Host "  3. App Tabs 의 ID 가 $ExtensionId 인지 확인"
  }
  default {
    Write-Host "업데이트 완료 ($oldVer -> $newVer). Chrome에서 다음 한 가지만 해 주세요:" -ForegroundColor Green
    Write-Host '  chrome://extensions 를 열고 App Tabs 카드의 새로고침(↻) 버튼을 한 번 누르세요.'
    Write-Host '  (확장 프로그램 삭제/재설치는 필요 없습니다. 연결 정보와 설정은 그대로 유지됩니다.)'
    Write-Host '  새로고침 후 닫힌 프로그램 탭은 App Tabs 팝업의 "탭 다시 열기"로 다시 열 수 있습니다.'
  }
}
