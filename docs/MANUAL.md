# Chrome App Tabs – Install, Update, Use, Uninstall (v0.3.4)

Latest version, screenshots and FAQ: https://github.com/darkping1980/chrome-app-tabs
(A Korean version of this manual is in `MANUAL_KO.md`. The program's own messages are in Korean.)

Chrome App Tabs shows a running Windows program (VS Code, DBeaver, File Explorer, …) as a tab in your normal Google Chrome.
It overlays the real program window on Chrome's page area; it never modifies, injects into or closes the program.

## 1. Requirements
- Windows 11 64-bit (tested). Windows 10 64-bit is not tested.
- Google Chrome (tested with Chrome 158). Other browsers are not supported.
- No administrator rights and no extra software (.NET Framework 4.x is part of Windows).
- Chrome **developer mode** (the extension is not on the Chrome Web Store).

## 2. Install
1. Extract `ChromeAppTabs-vX.Y.Z.zip` anywhere.
   (Optional) Compare `Get-FileHash .\ChromeAppTabs-vX.Y.Z.zip -Algorithm SHA256` with the `.sha256` file on the release page.
2. Double-click **`Install-or-Update.cmd`** and wait for **설치 완료** (installation complete).
   It copies files to `%LOCALAPPDATA%\ChromeAppTabs\app` and adds one registry key for the current user.
   Preview without changes: `powershell -ExecutionPolicy Bypass -File .\setup.ps1 -DryRun`.
   The files are not code-signed, so Windows may show a warning. Do not disable Windows security to run it.
3. In Chrome, open `chrome://extensions` → turn on **Developer mode** → **Load unpacked**.
4. In the **folder picker** (not the Chrome address bar!), enter `%LOCALAPPDATA%\ChromeAppTabs\app\extension` and select the
   **`extension` folder** (do not open `manifest.json`).
5. Check that App Tabs is enabled with ID `bahmlmpijalpgcnbnkgplggendgjhdlk`, pin it from the puzzle icon, and open its popup:
   it should show **호스트 v0.3.4 연결됨** (host v0.3.4 connected).

## 3. Use
- **Drag and drop:** drag a program's title bar onto the top of a Chrome window (tab strip or address bar row); release over the blue drop zone. Esc cancels.
- **Popup:** App Tabs icon → **프로그램 추가** (Add program) → click a window. Use the search box to filter.
- Click a web tab to see the web page; click the program tab to see the program again.
- Popup → **연결된 프로그램** (Connected programs): rename (edit + Enter), **이동** (go to), **탭 다시 열기** (reopen tab), **연결 해제** (disconnect; the program keeps running).
- Shortcuts (global): `Ctrl+Shift+7` program tab ↔ last web tab, `Ctrl+Shift+8` / `Ctrl+Shift+9` previous / next tab.
  Change them with **단축키 변경…**.
- Settings: when another tab is selected, send the program behind Chrome (recommended) or minimize it;
  hide the program while using the address bar; enable/disable drag and drop.

## 4. Update
1. Extract the new ZIP and run **`Install-or-Update.cmd`** (answer `Y` if asked). Only the App Tabs helper is stopped;
   Chrome and your programs keep running, and connected windows return to their original place.
2. Open `chrome://extensions` and click **↻ (reload)** on the App Tabs card. **Required.**
3. Reopen program tabs with **탭 다시 열기** if the reload closed them.
Settings, connections and the extension ID are kept. If an update fails, the previous version is restored automatically.
The last 3 versions are kept in `%LOCALAPPDATA%\ChromeAppTabs\backup`; to go back on purpose run `setup.ps1 -AllowDowngrade` from the older package.

## 5. Troubleshooting
| Problem | What to do |
|---|---|
| Popup says the host is not connected | Run `check.ps1`; run `Install-or-Update.cmd` again; reload the extension (↻). |
| Popup says a new version was installed | Reload the extension (↻) in `chrome://extensions`. |
| Window left in a wrong place | Popup → **연결 해제**, or turn the extension off and on. |
| Drag onto a maximized Chrome maximizes or snaps the program | The top screen edge belongs to Windows Snap: release a little lower (tabs or address bar). After touching the edge, move down once before dropping. |
| Log file | `%LOCALAPPDATA%\ChromeAppTabs\host.log` |

## 6. Uninstall
1. Remove App Tabs in `chrome://extensions`.
2. Run **`Uninstall.cmd`** (or `uninstall.ps1 -Purge` to also delete logs and state).
   Connected windows are restored, then the registry key
   `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.kbj.chrome_app_tabs` and `%LOCALAPPDATA%\ChromeAppTabs\app` are removed.
   Chrome and other programs are not closed.

## 7. License and source code
Copyright (C) 2026 darkping1980

Chrome App Tabs is free software under the GNU General Public License version 3 (GPL-3.0-only); see `LICENSE.txt`.
You may use, study, change, share and sell it. If you distribute it, keep the notices, use GPL v3 and provide the source.
It comes with **ABSOLUTELY NO WARRANTY** and no obligation of support.
The Corresponding Source of this package is at the GitHub tag named in `SOURCE.txt`. Report bugs and ideas in GitHub Issues.
