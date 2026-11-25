# Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
# Copyright (C) 2026 darkping1980
# SPDX-License-Identifier: GPL-3.0-only
# This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
# and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
<#
  Builds the distributable package dist\ChromeAppTabs-v<version>.zip (+ .sha256).
  The package contains ONLY what a user needs: the native host exe, the extension, the install/update/
  uninstall/check scripts, double-click launchers, the English/Korean manuals, LICENSE.txt and SOURCE.txt
  (where to get the Corresponding Source of the same tag). No C# sources, tests, keys or logs.
  Usage: powershell -File tools\build-release.ps1 [-SourceRoot <repo or extracted tag>] [-OutDir dist]
#>
param([string]$SourceRoot = (Split-Path $PSScriptRoot -Parent), [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'dist'),
      [string]$ScriptsFrom = (Split-Path $PSScriptRoot -Parent))   # install scripts/docs always from the current tree
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$ver = (Get-Content (Join-Path $SourceRoot 'extension\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$name = "ChromeAppTabs-v$ver"
$stage = Join-Path $OutDir $name
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $stage 'app') | Out-Null

& (Join-Path $SourceRoot 'host\build.ps1') | Out-Null
Copy-Item (Join-Path $SourceRoot 'host\bin\AppTabsHost.exe') (Join-Path $stage 'app\AppTabsHost.exe')
Copy-Item (Join-Path $SourceRoot 'extension') (Join-Path $stage 'app\extension') -Recurse
foreach ($f in 'setup.ps1', 'uninstall.ps1', 'check.ps1') { Copy-Item (Join-Path $ScriptsFrom "install\$f") (Join-Path $stage $f) }
Copy-Item (Join-Path $ScriptsFrom 'docs\MANUAL.md') (Join-Path $stage 'MANUAL_EN.md')
Copy-Item (Join-Path $ScriptsFrom 'docs\MANUAL.ko.md') (Join-Path $stage 'MANUAL_KO.md')
# GPL-3.0: the license text and where to get the Corresponding Source of this exact version
Copy-Item (Join-Path $ScriptsFrom 'LICENSE') (Join-Path $stage 'LICENSE.txt')
$repoUrl = 'https://github.com/darkping1980/chrome-app-tabs'
[IO.File]::WriteAllText((Join-Path $stage 'SOURCE.txt'), (@(
  "Chrome App Tabs v$ver",
  'Copyright (C) 2026 darkping1980',
  'License: GNU General Public License v3.0 only (GPL-3.0-only), see LICENSE.txt.',
  'This program comes with ABSOLUTELY NO WARRANTY.',
  '',
  'Corresponding Source for this package (native host source, extension, install and build scripts):',
  "  $repoUrl/tree/v$ver",
  "  $repoUrl/archive/refs/tags/v$ver.zip",
  'Build: powershell -File tools\build-release.ps1 (see README.md, "For developers").'
) -join "`r`n") + "`r`n", (New-Object Text.UTF8Encoding($false)))
# double-click launchers (ASCII only: cmd.exe reads batch files in the OEM code page)
"@echo off`r`nchcp 65001 >nul`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0setup.ps1`" %*`r`npause`r`n" | Out-File -Encoding ascii (Join-Path $stage 'Install-or-Update.cmd')
"@echo off`r`nchcp 65001 >nul`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0uninstall.ps1`" %*`r`npause`r`n" | Out-File -Encoding ascii (Join-Path $stage 'Uninstall.cmd')
Set-Content (Join-Path $stage 'VERSION.txt') $ver -Encoding ascii

# guard: nothing private or developer-only may slip into the package
$bad = Get-ChildItem $stage -Recurse -File | Where-Object { $_.Extension -in '.pem', '.key', '.pfx', '.log', '.cs', '.mjs' -or $_.Name -like '*.env*' -or $_.Name -eq 'attached.json' }
if ($bad) { throw "package contains forbidden files: $($bad.FullName -join ', ')" }

# per-file hashes (setup.ps1 verifies them before installing)
$lines = Get-ChildItem $stage -Recurse -File | Where-Object { $_.Name -ne 'SHA256SUMS.txt' } | Sort-Object FullName | ForEach-Object {
  $rel = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
  "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $rel }
[IO.File]::WriteAllLines((Join-Path $stage 'SHA256SUMS.txt'), [string[]]$lines, (New-Object Text.UTF8Encoding($false)))

$zip = Join-Path $OutDir "$name.zip"
if (Test-Path $zip) { Remove-Item $zip }
# write entries by hand with '/' separators (ZipFile.CreateFromDirectory on .NET Framework writes '')
$fs = [IO.File]::Open($zip, [IO.FileMode]::CreateNew)
$za = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
foreach ($f in Get-ChildItem $stage -Recurse -File | Sort-Object FullName) {
  $entry = $name + '/' + $f.FullName.Substring($stage.Length + 1).Replace([string][char]92, '/')
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($za, $f.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
}
$za.Dispose(); $fs.Dispose()
$h = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText("$zip.sha256", "$h  $name.zip`n", (New-Object Text.UTF8Encoding($false)))
Write-Output "package: $zip"
Write-Output "sha256 : $h"
Write-Output ("files  : {0}" -f (Get-ChildItem $stage -Recurse -File).Count)
