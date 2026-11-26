# Changelog

All notable changes to Chrome App Tabs are listed here. Versions follow `MAJOR.MINOR.PATCH`.

## [0.3.3] – 2026-11-26

More reliable drag and drop, especially onto a **maximized** Chrome window. Background:
[docs/drag-drop-analysis.md](docs/drag-drop-analysis.md).

### Fixed
- The drop zone could land on the **web page** instead of the tab strip. UI Automation returned the page's own ARIA
  tablist, for example on documentation or repository sites. A drop on the real tab strip then failed, and a drop on
  the page added the program.
- A window **snapped** by Windows (half screen, Snap layouts) could not be dropped. Windows restores its size when the
  drag starts, and v0.3.2 took that for a resize.
- A drop was judged by where the mouse was when the helper handled the event, not where the button was released.
  Moving the mouse right after the release, or a quick flick, could lose the drop.
- Windows Snap could take a drop that was released over the tab strip after touching the top of the screen. The
  window was then left snapped, so the next drag failed as well.
- Closing the tab of a snapped program put it back at its pre-snap size instead of where it was snapped.
- The original position saved for a dropped program could be a few pixels off. Windows moves the window as soon as the
  move starts, so the position is now taken from the moment the mouse button was pressed.
- The helper could end with an unhandled exception (0xC0020001) when it exited, after it had already restored the
  windows. All event hooks are now removed before exit.

### Changed
- The drop zone is now Chrome's whole top area: tab strip, **address bar row** and bookmarks bar. It comes from window
  geometry (no UI Automation), so the helper no longer switches on Chrome's accessibility mode. On a maximized Chrome
  the zone grows from ~33 px to the full toolbar height.
- The very top edge of a monitor is left to Windows Snap. After the cursor touched it, the area where the Snap layouts
  bar may be open is skipped until the cursor has moved down once. Snap settings are only read, never changed.
- Moves and resizes are told apart by one `WM_NCHITTEST` at the start plus the window's actual behaviour.
- The release point comes from the grab offset measured at rest, or the system's mouse-move history at the release
  time. Passing over the zone a moment earlier is never enough to drop.
- Smoother blue highlight: 15 ms sampling, no blocking calls, hysteresis at the edge, and it stays in place across
  monitors with different scaling.
- Version 0.3.2 → 0.3.3 (extension and native helper).

### Added
- Unit tests for the drag decisions (`tests/unit/run.ps1`, no UI). Real-input drag test `tests/drag_test.mjs`
  (maximized and normal Chrome, several programs, Snap, Esc, success rate).

### Tested / known issues
- Unit tests 46/46. Real-input drag test: 10/10 drops onto a maximized Chrome and 5/5 onto a normal one, each for a
  test window, VS Code (portable, isolated) and DBeaver. Overall 42/50 checks.
- Not verified: Windows 11 Notepad (injected mouse input could not start its title-bar move; real use to be checked);
  VS Code dragged while snapped (the test did not start a drag); different-DPI monitors; the full `e2e`/`compat`
  regression suites were not re-run for this release. Details: [docs/drag-drop-analysis.md](docs/drag-drop-analysis.md).

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
