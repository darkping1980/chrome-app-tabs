# Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
# Copyright (C) 2026 darkping1980
# SPDX-License-Identifier: GPL-3.0-only
# This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
# and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
# Extracts a release zip the way a user would (Expand-Archive). Usage: expand-zip.ps1 <zip> <destDir>
param([Parameter(Mandatory)][string]$Zip, [Parameter(Mandatory)][string]$Dest)
$ErrorActionPreference = 'Stop'
Expand-Archive -LiteralPath $Zip -DestinationPath $Dest -Force
Get-ChildItem $Dest | Select-Object -ExpandProperty Name
