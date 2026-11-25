# Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
# Copyright (C) 2026 darkping1980
# SPDX-License-Identifier: GPL-3.0-only
# This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
# and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
# v0.2 호환용: 설치/업데이트는 setup.ps1 이 담당합니다.
& (Join-Path $PSScriptRoot 'setup.ps1') @args
exit $LASTEXITCODE
