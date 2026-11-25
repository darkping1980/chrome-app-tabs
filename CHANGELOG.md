# Changelog

All notable changes to Chrome App Tabs are listed here. Versions follow `MAJOR.MINOR.PATCH`.

## [0.3.2] – 2026-11-25

First public, open-source release.

### Added
- Licensed under the **GNU General Public License v3.0 only** (`LICENSE`), Copyright (C) 2026 darkping1980.
- Copyright and SPDX license headers in the source files.
- License notice in the program: a footer in the App Tabs popup and copyright details in the `AppTabsHost.exe` file properties.
- Release package now includes `LICENSE.txt`, `SOURCE.txt` (where to get the matching source code) and an English manual (`MANUAL_EN.md`).
- Public documentation: `README.md` (English), `README.ko.md` (Korean), `CONTRIBUTING.md`, `SECURITY.md`, this changelog.

### Changed
- Version 0.3.1 → 0.3.2 (extension and native host). No functional changes.

### Removed
- Internal development reports, test logs and old test screenshots are not part of the public repository.

## [0.3.1] – 2026-11-25
- The internal window identifier is no longer visible in program tab titles (encoded with invisible characters).

## [0.3.0] – 2026-11-25
- Drag a program's title bar onto the Chrome tab strip to add it as a tab (drop zone, Esc to cancel, no duplicates, can be turned off).
- One release ZIP with `Install-or-Update.cmd`: integrity check, folder-swap update, automatic rollback on failure; install path, extension ID, connections and settings are kept.
- Popup shows when the extension needs a reload after an update; closed program tabs can be reopened.

## [0.2.0] – 2026-11-25
- Address-bar peek (the program steps back while you use the omnibox), global shortcuts `Ctrl+Shift+7/8/9`, management popup (rename, go to, disconnect), generic window list with icons, installer.

## [0.1.0] – 2026-11-25
- Proof of concept: overlay-based program tabs (Chrome extension + native messaging host).

Versions 0.1.0–0.3.1 were developed in a private repository before the public release; their packages are not published here.
