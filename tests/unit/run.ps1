# Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
# Copyright (C) 2026 darkping1980
# SPDX-License-Identifier: GPL-3.0-only
# This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
# and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
# Builds and runs the host unit tests (pure logic; no windows, mouse or keyboard are used).
# Usage: powershell -File tests\unit\run.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$fw  = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
$out = Join-Path $root 'tests\bin'
New-Item -ItemType Directory -Force $out | Out-Null
$src = @(Get-ChildItem (Join-Path $root 'host') -Filter *.cs | ForEach-Object FullName) + @(Get-ChildItem $PSScriptRoot -Filter *.cs | ForEach-Object FullName)
& "$fw\csc.exe" /nologo /target:exe /platform:x64 /main:AppTabs.Tests.DropLogicTests "/out:$out\unit_tests.exe" `
    "/r:$fw\System.Web.Extensions.dll" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Core.dll `
    "/r:$fw\WPF\UIAutomationClient.dll" "/r:$fw\WPF\UIAutomationTypes.dll" "/r:$fw\WPF\WindowsBase.dll" $src
if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
& "$out\unit_tests.exe"
exit $LASTEXITCODE
