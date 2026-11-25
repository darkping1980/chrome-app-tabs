# Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
# Copyright (C) 2026 darkping1980
# SPDX-License-Identifier: GPL-3.0-only
# This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
# and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
# Registers / removes a SEPARATE development native host (com.kbj.chrome_app_tabs_dev -> host\bin\AppTabsHost.exe)
# so tests never touch the installed host (com.kbj.chrome_app_tabs). The dev host keeps its data in
# %LOCALAPPDATA%\ChromeAppTabs-dev (see AppTabsHost.cs), so it cannot restore windows attached by the installed host.
# Usage: powershell -File tests\dev-host.ps1 [-Remove]
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$name = 'com.kbj.chrome_app_tabs_dev'
$key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$name"
$root = Split-Path $PSScriptRoot -Parent
if ($Remove) { if (Test-Path $key) { Remove-Item $key }; Write-Output "removed $key"; return }
$exe = Join-Path $root 'host\bin\AppTabsHost.exe'
if (-not (Test-Path $exe)) { & (Join-Path $root 'host\build.ps1') | Out-Null }
$manifest = Join-Path $root "host\bin\$name.json"
[ordered]@{ name = $name; description = 'App Tabs DEV host (tests only)'; path = $exe; type = 'stdio'
  allowed_origins = @('chrome-extension://bahmlmpijalpgcnbnkgplggendgjhdlk/') } | ConvertTo-Json | Out-File -Encoding ascii $manifest
New-Item -Force $key | Out-Null
Set-ItemProperty $key -Name '(default)' -Value $manifest
Write-Output "registered $key -> $manifest"
