# Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
# Copyright (C) 2026 darkping1980
# SPDX-License-Identifier: GPL-3.0-only
# This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
# and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
# App Tabs 설치 상태 점검 (읽기 전용, 아무것도 변경하지 않음)
param([string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'ChromeAppTabs'), [string]$HostName = 'com.kbj.chrome_app_tabs')  # tests only
$ExtensionId = 'bahmlmpijalpgcnbnkgplggendgjhdlk'
$base = $InstallRoot
$key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
$ok = $true
function Item($name, $good, $detail) { Write-Host ("[{0}] {1}: {2}" -f ($(if ($good) { ' OK ' } else { 'FAIL' })), $name, $detail); if (-not $good) { $script:ok = $false } }

$manifestPath = (Get-ItemProperty $key -ErrorAction SilentlyContinue).'(default)'
Item '레지스트리 등록' ([bool]$manifestPath) $(if ($manifestPath) { $manifestPath } else { '없음 - install.ps1 실행 필요' })
if ($manifestPath -and (Test-Path $manifestPath)) {
  $m = Get-Content $manifestPath -Raw | ConvertFrom-Json
  Item '호스트 실행 파일' (Test-Path $m.path) $m.path
  Item '허용된 확장 ID' ($m.allowed_origins -contains "chrome-extension://$ExtensionId/") ($m.allowed_origins -join ', ')
  if (Test-Path $m.path) { $v = (& $m.path --version | Out-String).Trim(); Item '호스트 버전' ([bool]$v) $v }
} elseif ($manifestPath) { Item '호스트 manifest' $false "파일 없음: $manifestPath" }
$ext = Join-Path $base 'app\extension\manifest.json'
Item '확장 폴더' (Test-Path $ext) $(if (Test-Path $ext) { "$(Split-Path $ext) (v$((Get-Content $ext -Raw | ConvertFrom-Json).version))" } else { '없음' })
$running = @(Get-CimInstance Win32_Process -Filter "Name='AppTabsHost.exe'")
Write-Host ("[INFO] 실행 중인 호스트: {0}" -f $(if ($running.Count) { $running.ProcessId -join ', ' } else { '없음 (Chrome에 확장이 로드되어 있지 않거나 아직 연결 전)' }))
$state = Join-Path $base 'attached.json'
if (Test-Path $state) { Write-Host "[INFO] 연결 상태 파일: $(Get-Content $state -Raw)" }
if ($ok) { Write-Host '점검 결과: 정상' } else { Write-Host '점검 결과: 문제 있음'; exit 1 }
