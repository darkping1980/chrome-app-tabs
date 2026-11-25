# Contributing to Chrome App Tabs

Thank you for your interest. Chrome App Tabs is a small free-software project maintained in spare time,
so responses may take a while, and there is no guaranteed support.

## Bug reports and feature ideas

Use [GitHub Issues](https://github.com/darkping1980/chrome-app-tabs/issues). Please include:

- Chrome App Tabs version (popup badge, or `VERSION.txt` in the release folder)
- Windows version, Chrome version, monitor setup (number of monitors, display scaling)
- The program you tried to add (for example VS Code, DBeaver)
- What you did, what you expected, what happened
- The output of `check.ps1`, and the relevant lines of `%LOCALAPPDATA%\ChromeAppTabs\host.log` if useful

**Before attaching logs or screenshots, remove personal information** such as your Windows user name, file paths,
window titles of unrelated programs, e-mail addresses or anything visible on your screen that you do not want to publish.

Security problems: please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Pull requests

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Keep changes focused. Follow the existing style (plain JavaScript in the extension, C# 5 compatible with the
   compiler that ships with .NET Framework 4.x, Windows PowerShell 5.1 scripts).
3. Keep the design principles: only window position, size, visibility, z-order and focus are changed; no injection,
   no re-parenting, no closing of user programs, nothing outside the current user's profile.
4. Build with `powershell -File host\build.ps1` and run the relevant tests (see "For developers" in the README).
   Tests use the separate dev host (`tests\dev-host.ps1`) and never touch an installed copy.
5. Do not commit build output, test results, logs, screenshots with personal information, or keys.

## License of contributions

Chrome App Tabs is licensed under the **GNU General Public License v3.0 only** (GPL-3.0-only).
By submitting a contribution (pull request, patch or code in an issue), you agree that it is licensed under the
same GPL-3.0-only license. There is no separate contributor license agreement.

Only submit code you wrote yourself or that is available under a license compatible with GPL-3.0-only;
say clearly where any third-party code comes from and keep its copyright and license notices.

## Authorship and attribution

- **Original author and copyright holder:** darkping1980 (`Copyright (C) 2026 darkping1980`).
- Every source file starts with a header containing the copyright line and `SPDX-License-Identifier: GPL-3.0-only`.
  Do not remove or change existing copyright notices, including third-party notices.
- If you make a substantial contribution to a file, you may add your own line below the existing one, for example:
  `// Copyright (C) 2027 Your Name`
- Contributors are credited through the Git history (commit author) and in the release notes / [CHANGELOG.md](CHANGELOG.md)
  for notable changes.
- If you distribute a modified version, GPL v3 section 5 requires that it carries prominent notices stating that you
  modified it and a relevant date, and that it is released under GPL v3.
