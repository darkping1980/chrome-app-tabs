# Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
# Copyright (C) 2026 darkping1980
# SPDX-License-Identifier: GPL-3.0-only
# This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
# and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
# Builds AppTabsHost.exe with the C# compiler that ships with .NET Framework 4.x (no SDK needed).
$ErrorActionPreference = 'Stop'
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$fw  = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
$out = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Force $out | Out-Null
& $csc /nologo /target:winexe /optimize+ /platform:x64 "/out:$out\AppTabsHost.exe" `
    "/r:$fw\System.Web.Extensions.dll" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Core.dll `
    "/r:$fw\WPF\UIAutomationClient.dll" "/r:$fw\WPF\UIAutomationTypes.dll" "/r:$fw\WPF\WindowsBase.dll" `
    (Get-ChildItem $PSScriptRoot -Filter *.cs | ForEach-Object FullName)
if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
Write-Output "built $out\AppTabsHost.exe"
