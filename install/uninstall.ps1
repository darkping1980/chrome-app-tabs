# Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
# Copyright (C) 2026 darkping1980
# SPDX-License-Identifier: GPL-3.0-only
# This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
# and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
<#
  App Tabs 제거

  하는 일
    1) 연결되어 있던 프로그램 창을 원래 위치/크기로 복원 (프로그램은 종료하지 않음)
    2) HKCU 의 Native Messaging 호스트 등록 삭제 (App Tabs 가 만든 키만)
    3) %LOCALAPPDATA%\ChromeAppTabs\app 삭제 (-Purge 이면 로그/상태 파일까지 삭제)
  하지 않는 일
    - Chrome 의 확장 제거: chrome://extensions 에서 App Tabs "삭제" 를 직접 누르세요.
    - Chrome, VS Code 등 다른 프로그램 종료.

  호스트가 실행 중이면(확장이 켜져 있으면) 먼저 확장을 끄라고 안내하고 멈춥니다.
  -StopHost 를 주면 App Tabs 호스트 프로세스만 종료하고 창을 복원한 뒤 계속합니다.

  사용: powershell -ExecutionPolicy Bypass -File install\uninstall.ps1 [-StopHost] [-Purge] [-DryRun]
#>
param([switch]$StopHost, [switch]$Purge, [switch]$DryRun,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'ChromeAppTabs'), [string]$HostName = 'com.kbj.chrome_app_tabs')  # last two: tests only
$ErrorActionPreference = 'Stop'
$base = $InstallRoot
$app = Join-Path $base 'app'
$key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
function Step($msg) { Write-Host "  - $msg" }
Write-Host "App Tabs 제거$(if ($DryRun) { ' (DryRun: 실제 변경 없음)' })"

$running = @(Get-CimInstance Win32_Process -Filter "Name='AppTabsHost.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($app, [StringComparison]::OrdinalIgnoreCase) })
if ($running.Count -gt 0) {
  if (-not $StopHost) {
    throw "App Tabs 호스트가 실행 중입니다(PID $($running.ProcessId -join ', ')). chrome://extensions 에서 App Tabs 를 끄거나 삭제한 뒤 다시 실행하세요. (또는 -StopHost)"
  }
  foreach ($p in $running) {
    Step "App Tabs 호스트 종료: PID $($p.ProcessId)"
    if (-not $DryRun) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  if (-not $DryRun) { Start-Sleep -Milliseconds 800 }  # the watchdog restores the windows
}

# restore any window still recorded as attached (no-op when nothing is recorded)
$exe = @((Join-Path $app 'AppTabsHost.exe'), (Join-Path (Split-Path $PSScriptRoot -Parent) 'host\bin\AppTabsHost.exe')) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($exe) {
  Step "창 복원 확인: $exe --restore-all"
  if (-not $DryRun) { $out = & $exe --restore-all | Out-String; Step ("결과: " + $out.Trim()) }
}

$cur = (Get-ItemProperty $key -ErrorAction SilentlyContinue).'(default)'
if ($cur) {
  Step "레지스트리 삭제: $key (-> $cur)"
  if (-not $DryRun) { Remove-Item $key }
} else { Step '레지스트리 등록 없음' }

if (Test-Path $app) { Step "삭제: $app"; if (-not $DryRun) { Remove-Item $app -Recurse -Force } }
foreach ($d in @(Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'app.new' -or $_.Name -like 'app.prev-*' -or $_.Name -like 'app.failed-*' })) { Step "삭제(중단된 업데이트 잔여물): $($d.FullName)"; if (-not $DryRun) { Remove-Item $d.FullName -Recurse -Force } }
if ($Purge -and (Test-Path $base)) { Step "삭제(-Purge): $base"; if (-not $DryRun) { Remove-Item $base -Recurse -Force } }
elseif (Test-Path $base) { Step "로그/상태 보존: $base (지우려면 -Purge)" }

Write-Host ''
Write-Host '제거 완료. Chrome에서 chrome://extensions 를 열고 App Tabs 확장을 "삭제"하세요.'
